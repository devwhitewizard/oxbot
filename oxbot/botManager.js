/**
 * oxbot/botManager.js — UPDATED VERSION
 *
 * FIXES:
 * ✅ IP binding per server (Server 1 NG / Server 2 US) — prevents WA bans
 * ✅ Per-bot isolated message store — User A and User B never share state
 * ✅ extractOwnerPhone from sessionId only — LID JID fix
 * ✅ reconnectLocks prevents duplicate reconnect loops
 * ✅ Generation counter kills stale socket handlers
 * ✅ Anti-sleep ping every 4 minutes
 * ✅ Escalating reconnect backoff
 * ✅ Call rejection handler
 * ✅ BAE5 junk filter
 * ✅ Memory guard + temp cleanup
 * ✅ Graceful shutdown (ws.close not logout)
 * ✅ attachBotDataToSocket once on connect not per message
 * ✅ All cache busters on disconnect
 * ✅ ANTI-DELETE: Fixed botData passing with helper functions
 * ✅ NEW: msgRetryCounterCache added — fixes strangers' FIRST message
 *    silently failing to decrypt (missing here, present in pairing.js —
 *    without it, WhatsApp's message-retry protocol can't establish a
 *    fresh Signal session with a brand-new contact, so their first .menu
 *    or any command just vanishes with no error, no reply)
 * ✅ NEW: memory guard now closes sockets gracefully before restarting,
 *    instead of process.exit(1) yanking every socket uncleanly (which
 *    caused mass 440-conflict storms across ALL bots on restart)
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const chalk = require('chalk');
const pino  = require('pino');
const https = require('https');
const NodeCache = require('node-cache');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    jidNormalizedUser,
    Browsers,
} = require('@whiskeysockets/baileys');

const db = require('./database');
const {
    consoleLogs,
    activeBots,
    connectingBots,
    stoppedBots,
    reconnectLocks,
    reconnectAttempts,
} = require('./state');
const { addLog, patchCredsIfNeeded, delay } = require('./utils');
const {
    handleIncomingMessage,
    antideleteRevocation,
    attachBotDataToSocket,
    clearSessionState,
    clearPrefixCache,
    bustSudoCache,
    clearMode,
    getOwnerUserId,
    getOwnerJid,
    isPro,
} = require('../commands');
const SESSION_DIR = path.join(__dirname, '..', 'sessions');
const TEMP_DIR    = path.join(process.cwd(), 'temp');

// ─────────────────────────────────────────────────────────────────────────────
// SERVER → IP MAP
// Must match server names stored in bots.server column exactly.
// Each bot binds its WebSocket to this IP so WA always sees
// the same server IP — prevents country-change bans.
// ─────────────────────────────────────────────────────────────────────────────
const SERVER_IPS = {
    'Server 1 (NG)': '162.35.161.152',
    'Server 2 (US)': '51.79.20.140',
};

/**
 * Create an HTTPS agent bound to a specific local IP.
 * Baileys passes this to the underlying WebSocket — all WA
 * traffic for this bot goes through the chosen server IP.
 */
function createBoundAgent(serverName) {
    const ip = SERVER_IPS[serverName];
    if (!ip) return undefined;
    try {
        const agent = new https.Agent({ localAddress: ip, keepAlive: true });
        console.log(chalk.cyan(`[IP BIND] ${serverName} → ${ip}`));
        return agent;
    } catch (err) {
        console.warn(chalk.yellow(`[IP BIND] Failed to bind ${ip}: ${err.message} — using default`));
        return undefined;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN — declared early so both signal handlers AND the
// memory guard below can share the exact same clean-close logic.
// ws.close(1000) not logout() — preserves WA session server-side so
// bots reconnect without re-pairing after PM2 restart.
// ─────────────────────────────────────────────────────────────────────────────
let isShuttingDown = false;

function gracefulShutdown(reason) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(chalk.cyan(`\n[${reason}] Graceful shutdown — closing all sockets first...`));
    for (const [, bd] of activeBots) {
        try { bd.sock?.ws?.close(1000, reason); } catch {}
    }
    // give WhatsApp's servers time to register each close before the
    // process exits and PM2 spins up fresh sockets — without this delay,
    // new sockets can open before WA sees the old ones as closed, causing
    // 440 "ghost conflict" storms across every bot at once
    setTimeout(() => {
        console.log(chalk.green('✅ Shutdown complete — sessions preserved'));
        process.exit(0);
    }, 2000);
}

function setupGracefulShutdown() {
    process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGHUP',  () => gracefulShutdown('SIGHUP'));
    process.on('message', (m) => { if (m === 'shutdown') gracefulShutdown('PM2'); });
    process.on('uncaughtException', (err) => {
        const m = err?.message || '';
        if (
            !m.includes('decrypt')          &&
            !m.includes('Bad MAC')          &&
            !m.includes('Session error')    &&
            !m.includes('Connection Closed') &&
            !m.includes('rate-overlimit')   &&
            !m.includes('Closing session')
        ) console.error(chalk.red('[UNCAUGHT]'), m);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// MEMORY GUARD + GC
// FIX: was process.exit(1) at a flat 500MB — far too low for a
// multi-tenant host, and process.exit() bypasses graceful shutdown
// entirely, killing every socket uncleanly and causing mass 440
// conflicts on restart. Now routes through gracefulShutdown() and
// requires 3 consecutive high readings (90s sustained) before acting,
// so a brief spike doesn't take every bot down together.
// Tune MEMORY_LIMIT_MB via env var to your actual server's available RAM.
// ─────────────────────────────────────────────────────────────────────────────
setInterval(() => { try { if (global.gc) global.gc(); } catch {} }, 60_000);

const MEMORY_LIMIT_MB = Number(process.env.MEMORY_LIMIT_MB) || 2048;
let highMemStreak = 0;

setInterval(() => {
    const mb = process.memoryUsage().rss / 1024 / 1024;
    if (mb > MEMORY_LIMIT_MB) {
        highMemStreak++;
        console.log(chalk.yellow(`⚠️ RAM ${mb.toFixed(0)}MB over ${MEMORY_LIMIT_MB}MB limit (${highMemStreak}/3)`));
        if (highMemStreak >= 3) {
            console.log(chalk.red(`🔴 RAM sustained high — shutting down gracefully`));
            gracefulShutdown('MEMORY_LIMIT');
        }
    } else {
        highMemStreak = 0;
    }
}, 30_000);

// ─────────────────────────────────────────────────────────────────────────────
// TEMP FILE CLEANUP every 3 hours
// ─────────────────────────────────────────────────────────────────────────────
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

setInterval(() => {
    fs.readdir(TEMP_DIR, (err, files) => {
        if (err) return;
        for (const f of files) {
            const fp = path.join(TEMP_DIR, f);
            fs.stat(fp, (e, s) => {
                if (!e && Date.now() - s.mtimeMs > 3 * 60 * 60 * 1000)
                    fs.unlink(fp, () => {});
            });
        }
    });
}, 3 * 60 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────────────────
// extractOwnerPhone
//
// ALWAYS read from sessionId — never from sock.user.id.
// sock.user.id on linked devices is a LID like "131301847920653:8@lid"
// which is NOT a phone number.
//
// sessionId format: "oxbot_2349037288167" → "2349037288167" ✅
// ─────────────────────────────────────────────────────────────────────────────
function extractOwnerPhone(sessionId) {
    const digits = sessionId.replace(/^[a-z_]+/i, '').replace(/\D/g, '');
    return digits.length >= 7 ? digits : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-BOT ISOLATED MESSAGE STORE
//
// Each bot gets its own store. Lifecycle = socket lifecycle.
// When socket dies the store is garbage collected automatically.
// No global Map or manual cleanup needed.
//
// This is the key fix for "User A and User B sharing state" —
// each bot's store is a closure, invisible to other bots.
// ─────────────────────────────────────────────────────────────────────────────
function createMessageStore() {
    const store = new Map(); // jid → msg[]
    const MAX   = 30;

    function bind(ev) {
        ev.on('messages.upsert', ({ messages }) => {
            for (const msg of messages) {
                const jid = msg.key?.remoteJid;
                if (!jid) continue;
                if (!store.has(jid)) store.set(jid, []);
                const arr = store.get(jid);
                arr.push(msg);
                if (arr.length > MAX) arr.splice(0, arr.length - MAX);
            }
        });
    }

    async function loadMessage(jid, id) {
        const norm = jidNormalizedUser ? jidNormalizedUser(jid) : jid;
        return (store.get(norm) || store.get(jid) || [])
            .find(m => m.key?.id === id);
    }

    return { bind, loadMessage };
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-SESSION PREFIX CACHE for dashboard logging
// ─────────────────────────────────────────────────────────────────────────────
const managerPrefixCache = new Map();
const MANAGER_PREFIX_TTL = 60_000;

async function getManagerPrefixes(sessionId) {
    const c = managerPrefixCache.get(sessionId);
    if (c && Date.now() - c.ts < MANAGER_PREFIX_TTL) return c.prefixes;
    try {
        const [rows] = await db.query(
            'SELECT prefix FROM bot_settings WHERE session_id = ? ORDER BY id DESC LIMIT 1', [sessionId]
        );
        if (rows[0]?.prefix) {
            const prefixes = rows[0].prefix
                .split(/[|,]/).map(p => p.trim()).filter(Boolean);
            if (prefixes.length) {
                managerPrefixCache.set(sessionId, { prefixes, ts: Date.now() });
                return prefixes;
            }
        }
    } catch {}
    const fallback = ['.', '!'];
    managerPrefixCache.set(sessionId, { prefixes: fallback, ts: Date.now() });
    return fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEDUP STORE — second safety net after index.js
// ─────────────────────────────────────────────────────────────────────────────
const processedMessages = new Map();

setInterval(() => {
    for (const [sid, set] of processedMessages) {
        if (!activeBots.has(sid)) {
            processedMessages.delete(sid);
            managerPrefixCache.delete(sid);
            continue;
        }
        if (set.size > 500) {
            const arr = [...set];
            set.clear();
            arr.slice(-100).forEach(id => set.add(id));
        }
    }
}, 3 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function isCurrentGen(sessionId, gen) {
    return activeBots.get(sessionId)?.gen === gen;
}

function cleanupConnection(botData, sessionId) {
    if (botData?.sleepInterval) {
        clearInterval(botData.sleepInterval);
        botData.sleepInterval = null;
    }
    if (botData?.sock) {
        try { botData.sock.ev?.removeAllListeners(); } catch {}
        try { botData.sock.ws?.close(1000, 'reconnect'); } catch {}
        try { botData.sock.end(); } catch {}
    }
    activeBots.delete(sessionId);
    connectingBots.delete(sessionId);
    processedMessages.delete(sessionId);
    managerPrefixCache.delete(sessionId);
    global.botConnected = activeBots.size > 0;
}

function clearMemoryState(sessionId) {
    processedMessages.delete(sessionId);
    managerPrefixCache.delete(sessionId);
    reconnectLocks.delete(sessionId);
    reconnectAttempts.delete(sessionId);
    if (typeof clearSessionState === 'function') clearSessionState(sessionId);
    if (typeof clearPrefixCache  === 'function') clearPrefixCache(sessionId);
    if (typeof bustSudoCache     === 'function') bustSudoCache(sessionId);
    if (typeof clearMode         === 'function') clearMode(sessionId);
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATE BOT SESSION
// ─────────────────────────────────────────────────────────────────────────────
async function activateBotSession(sessionId, userId, botName, server) {

    if (isShuttingDown)             return;
    if (stoppedBots.has(sessionId)) return;

    // ── reconnect lock — prevents duplicate sessions ──────────────────────────
    // Without this, a reconnect timeout firing at the same time as a
    // connection.close event spawns TWO sockets for the same session.
    // Two sockets = WA sees ghost conflict (440) = endless disconnect loop.
    if (reconnectLocks.get(sessionId)) {
        console.log(chalk.gray(`[LOCK] ${botName} — reconnect already in progress, skipping`));
        return;
    }
    reconnectLocks.set(sessionId, true);

    try {
        if (activeBots.get(sessionId)?.openedAt > 0) {
            addLog(userId, `✅ "${botName}" already connected`);
            reconnectLocks.delete(sessionId);
            return;
        }

        const existing = activeBots.get(sessionId);
        if (existing) cleanupConnection(existing, sessionId);

        const sessionFolder = path.join(SESSION_DIR, sessionId);
        const credsPath     = path.join(sessionFolder, 'creds.json');

        if (!fs.existsSync(credsPath)) {
            reconnectLocks.delete(sessionId);
            throw new Error(`No creds for "${botName}" — re-pair device`);
        }

        connectingBots.add(sessionId);
        try { patchCredsIfNeeded(sessionFolder); } catch {}

        addLog(userId, `🔄 Connecting "${botName}"…`);

                     const { version }          = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

        // ═══════════════════════════════════════════════════════════════
        // ★ PRE-KEY FIX — Forces generation if next === firstUnuploaded
        // Without this, new users' DMs silently fail to decrypt.
        // ═══════════════════════════════════════════════════════════════
        if (state.creds.firstUnuploadedPreKeyId === state.creds.nextPreKeyId) {
            console.log(chalk.yellow(`[PREKEY FIX] ${botName} has 0 pre-keys. Forcing generation...`));
            try {
                const nodeCrypto = require('crypto');
                const countToGenerate = 10;
                
                for (let i = 0; i < countToGenerate; i++) {
                    const id = state.creds.nextPreKeyId;
                    const keyPair = nodeCrypto.generateKeyPairSync('x25519');
                    
                    // Extract raw 32-byte keys from DER format
                    const priv = keyPair.privateKey.export({ type: 'pkcs8', format: 'der' }).slice(-32);
                    const pub = keyPair.publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
                    
                    await state.keys.set({ preKey: id }, { privateKey: priv, publicKey: pub });
                    state.creds.nextPreKeyId = id + 1;
                }
                
                await saveCreds();
                console.log(chalk.green(`[PREKEY FIX] Generated ${countToGenerate} pre-keys for ${botName}`));
            } catch (e) {
                console.error(chalk.red(`[PREKEY FIX] Failed: ${e.message}`));
            }
        }

        const thisGen              = (activeBots.get(sessionId)?.gen || 0) + 1;
        // per-bot isolated store — User A and User B NEVER share this
        const msgStore = createMessageStore();

        // IP agent — binds WA WebSocket to the server the user chose
        // Server 1 (NG) users → 162.35.161.152
        // Server 2 (US) users → 51.79.20.140
        const agent = createBoundAgent(server);

        const botData = {
            sessionId,
            userId,
            botName,
            server,
            waName:        null,
            sock:          null,
            openedAt:      0,
            gen:           thisGen,
            sleepInterval: null,
            db,
            addLog: (msg) => addLog(userId, msg),
            // ★ CRITICAL: Add helper functions for anti-delete
            getOwnerUserId: getOwnerUserId,
            getOwnerJid: getOwnerJid,
            isPro: isPro,
        };

        const sock = makeWASocket({
            version,
            logger:            pino({ level: 'silent' }),
            printQRInTerminal: false,

            // MUST match pairing.js browser exactly
            // Mismatch = WA fingerprint conflict = session killed
            browser: Browsers.windows('Chrome'),

            auth: {
                creds: state.creds,
                keys:  makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
            },

            // ★ IP BINDING — all WA WebSocket traffic goes through
            //   the server IP the user selected at activation time.
            //   WA sees a consistent IP per session = no ban risk.
            agent,

            // false = don't appear always-online
            // WA detects permanently-online linked devices as bots
            markOnlineOnConnect: false,

            generateHighQualityLinkPreview: false,
            syncFullHistory:                false,
            downloadHistory:                false,
            shouldSyncHistoryMessage:       () => false,

            // per-bot getMessage — fixes Bad MAC on new-contact DMs
            getMessage: async (key) => {
                const msg = await msgStore.loadMessage(key.remoteJid, key.id);
                return msg?.message || undefined;
            },

            // ★ FIX: was missing entirely — this is what pairing.js already
            // had and botManager.js didn't. Without it, WhatsApp's message-
            // retry protocol can't properly track/complete the Signal
            // session handshake with a brand-new contact, so a stranger's
            // FIRST message to the bot silently fails to decrypt and never
            // successfully retries. Existing contacts (session already
            // established) were never affected — which is exactly why this
            // only broke DMs from people who'd never messaged the bot before.
            msgRetryCounterCache: new NodeCache({ stdTTL: 300, checkperiod: 60 }),

            keepAliveIntervalMs:   15_000,
            defaultQueryTimeoutMs: 30_000,
            connectTimeoutMs:      60_000,
            retryRequestDelayMs:   2_000,
            emitOwnEvents:         false,

            patchMessageBeforeSending: (msg) => {
                if (msg.buttonsMessage || msg.listMessage || msg.templateMessage) {
                    msg = {
                        viewOnceMessage: {
                            message: {
                                messageContextInfo: {
                                    deviceListMetadataVersion: 2,
                                    deviceListMetadata: {},
                                },
                                ...msg,
                            },
                        },
                    };
                }
                return msg;
            },
        });

        botData.sock = sock;
        activeBots.set(sessionId, botData);

        // bind per-bot store — MUST be before any messages arrive
        msgStore.bind(sock.ev);
        sock.ev.on('creds.update', saveCreds);

        // ─────────────────────────────────────────────────────────────────────
        // messages.upsert
        //
        // Per-bot handler — this closure captures `sessionId`, `thisGen`,
        // `userId` from the outer activateBotSession call.
        // User A's handler never runs for User B's messages.
        // ─────────────────────────────────────────────────────────────────────
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (isShuttingDown) return;
            if (!isCurrentGen(sessionId, thisGen)) return;

            const current = activeBots.get(sessionId);
            if (!current || current.openedAt <= 0) return;
            if (type !== 'notify') return;

            // load prefixes once per batch — cached 60s
            const prefixes = await getManagerPrefixes(sessionId).catch(() => ['.', '!']);

            for (const msg of messages) {
                if (!msg.message || !msg.key?.id) continue;

                const from = msg.key.remoteJid;
                if (!from) continue;

                // route statuses to autostatus handler, then skip normal command processing
                if (from.includes('@broadcast') && from !== 'status@broadcast') continue;
                if (from.includes('@newsletter')) continue;
                // WA internal junk messages (reactions, receipts)
                if (msg.key.id?.startsWith('BAE5') && msg.key.id.length === 16) continue;

                // dedup
                if (!processedMessages.has(sessionId))
                    processedMessages.set(sessionId, new Set());
                const seen = processedMessages.get(sessionId);
                if (seen.has(msg.key.id)) continue;
                seen.add(msg.key.id);

                // 5-min age filter — drops zombie messages from before restart
                if (msg.messageTimestamp) {
                    if (Date.now() - msg.messageTimestamp * 1000 > 5 * 60 * 1000) continue;
                }

                // skip protocol messages (deletions are handled separately)
                if (msg.message?.protocolMessage) continue;
                if (msg.message?.ephemeralMessage?.message?.protocolMessage) continue;

                // extract text for echo-loop guard + dashboard log
                const txt =
                    msg.message?.conversation                                         ||
                    msg.message?.extendedTextMessage?.text                            ||
                    msg.message?.ephemeralMessage?.message?.conversation              ||
                    msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
                    msg.message?.imageMessage?.caption                                ||
                    msg.message?.videoMessage?.caption                                ||
                    '';

                const isOwnMessage = msg.key.fromMe === true;
                const looksLikeCmd = prefixes.some(p => txt.startsWith(p));

                // echo loop prevention — ONLY skip own non-command messages
                // never skip messages from other people (fromMe=false)
                if (isOwnMessage && !looksLikeCmd) continue;

                // dashboard log
                if (looksLikeCmd) {
                    const isGroup  = from.endsWith('@g.us');
                    const sender   = isOwnMessage
                        ? (sock.user?.name || 'You')
                        : (msg.pushName || from.split('@')[0]);
                    const usedPfx  = prefixes.find(p => txt.startsWith(p)) || txt[0];
                    const cmdPart  = txt.slice(usedPfx.length).split(' ')[0];
                    const preview  = txt.slice(usedPfx.length + cmdPart.length).trim().slice(0, 30);
                    addLog(userId,
                        `💬 [CMD] ${isGroup ? '👥 Group' : '👤 DM'} | ${sender} → ${usedPfx}${cmdPart}${preview ? ' ' + preview : ''}`
                    );
                }

                // hand off to commands/index.js
                // index.js uses sock._ownerPhone (set below on connect) to
                // identify WHICH bot this is — User A's bot answers User A's
                // messages, User B's bot answers User B's messages
                handleIncomingMessage(sock, msg, current).catch(err => {
                    const m = err?.message || '';
                    if (
                        !m.includes('decrypt')          &&
                        !m.includes('Bad MAC')          &&
                        !m.includes('Session error')    &&
                        !m.includes('rate-overlimit')   &&
                        !m.includes('Connection Closed')
                    ) console.error(chalk.red('[CMD ERROR]'), m);
                });
            }
        });

        // ─────────────────────────────────────────────────────────────────────
        // messages.update — ANTIDELETE
        // type 0 = REVOKE (delete for everyone) — must always have a key
        // pointing at the deleted message
        // ─────────────────────────────────────────────────────────────────────
        sock.ev.on('messages.update', (updates) => {
            if (isShuttingDown) return;
            if (!isCurrentGen(sessionId, thisGen)) return;
            const current = activeBots.get(sessionId);
            if (!current || current.openedAt <= 0 || !antideleteRevocation) return;

            for (const update of updates) {
                const pm = update.message?.protocolMessage;
                if (!pm) continue;

                const isRevoke = pm.type === 0 && !!pm.key;
                if (!isRevoke) continue;

                setImmediate(() => {
                    antideleteRevocation(sock, update, current).catch((err) => {
                        console.error(chalk.red(`[ANTIDELETE ERROR] ${botName}:`), err.message);
                    });
                });
            }
        });

        // ─────────────────────────────────────────────────────────────────────
        // call — reject incoming calls if anticall=on
        // Unanswered calls on bot numbers trigger WA spam detection
        // ─────────────────────────────────────────────────────────────────────
        sock.ev.on('call', async (calls) => {
            if (!isCurrentGen(sessionId, thisGen)) return;
            let anticallOn = false;
            try {
                const [rows] = await db.query(
                    'SELECT anticall FROM bot_settings WHERE session_id = ? ORDER BY id DESC LIMIT 1',
                    [sessionId]
                );
                anticallOn = rows[0]?.anticall === 1 || rows[0]?.anticall === 'on';
            } catch {}
            if (!anticallOn) return;

            for (const call of calls) {
                if (call.status !== 'offer') continue;
                const jid = call.from || call.peerJid || call.chatId;
                if (!jid) continue;
                try {
                    if (typeof sock.rejectCall === 'function' && call.id) {
                        await sock.rejectCall(call.id, jid);
                        await sock.sendMessage(jid, {
                            text: '📵 *Anti-Call is ON*\n\nCalls are blocked. Send a message instead.\n\n_OxBot_'
                        });
                    }
                } catch {}
            }
        });

        // ─────────────────────────────────────────────────────────────────────
        // group-participants.update
        // ─────────────────────────────────────────────────────────────────────
        sock.ev.on('group-participants.update', (update) => {
            if (isShuttingDown) return;
            if (!isCurrentGen(sessionId, thisGen)) return;
            const current = activeBots.get(sessionId);
            if (!current || current.openedAt <= 0) return;
            if (typeof current.handleGroupUpdate === 'function') {
                setImmediate(() => current.handleGroupUpdate(sock, update).catch(() => {}));
            }
        });

        // ─────────────────────────────────────────────────────────────────────
        // contacts.upsert — name resolution
        // Uses ownerPhone (not raw sock.user.id) for matching
        // ─────────────────────────────────────────────────────────────────────
        sock.ev.on('contacts.upsert', (contacts) => {
            if (!isCurrentGen(sessionId, thisGen)) return;
            const ownerPhone = sock._ownerPhone || '';
            if (!ownerPhone) return;

            const self = contacts.find(c => {
                const cNum = c.id?.replace(/[^0-9]/g, '') || '';
                return cNum === ownerPhone ||
                       cNum.endsWith(ownerPhone) ||
                       ownerPhone.endsWith(cNum);
            });
            if (!self) return;

            const name = self.name || self.verifiedName || self.notify || self.pushName;
            if (name && name !== botData.waName) {
                botData.waName = name;
                db.query(
                    'UPDATE bots SET whatsapp_name=? WHERE session_id=?',
                    [name, sessionId]
                ).catch(() => {});
            }
        });

        // ─────────────────────────────────────────────────────────────────────
        // connection.update
        // ─────────────────────────────────────────────────────────────────────
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            // ── OPEN ─────────────────────────────────────────────────────────
            if (connection === 'open') {
                if (isShuttingDown) return;
                if (!isCurrentGen(sessionId, thisGen)) return;

                connectingBots.delete(sessionId);
                reconnectLocks.delete(sessionId);      // release lock on success
                reconnectAttempts.delete(sessionId);   // reset backoff counter

                botData.openedAt    = Date.now();
                global.botConnected = true;

                // ★ CRITICAL: set _ownerPhone from sessionId digits ONLY
                // sock.user.id on linked devices is a LID — not a phone number
                // Commands/index.js reads sock._ownerPhone to identify this bot
                // If this is wrong, EVERY message is dropped silently
                sock._ownerPhone  = extractOwnerPhone(sessionId);
                sock._connectTime = Date.now();
                sock._server      = server; // store server for reference

                botData.waName = sock.user?.name || sock.user?.verifiedName || botData.waName || 'Unknown';

                console.log(chalk.green(
                    `[ONLINE] ${botName} → +${sock._ownerPhone} via ${server} (${SERVER_IPS[server] || 'default'})`
                ));

                // ★ FIX: Attach botData ONCE on connect — not on every message
                // Make sure all helper functions are included
                const fullBotData = {
                    ...botData,
                    sessionId,
                    db,
                    getOwnerUserId,
                    getOwnerJid,
                    isPro
                };
                attachBotDataToSocket(sock, fullBotData);

                // anti-sleep ping every 4 minutes
                // WA silently kills idle linked device connections
                if (botData.sleepInterval) clearInterval(botData.sleepInterval);
                botData.sleepInterval = setInterval(async () => {
                    if (!isCurrentGen(sessionId, thisGen)) {
                        clearInterval(botData.sleepInterval);
                        return;
                    }
                    try { await sock.sendPresenceUpdate('available'); } catch {}
                }, 4 * 60 * 1000);

                try {
                    const [botRows] = await db.query(
                        'SELECT session_id FROM bots WHERE session_id=?', [sessionId]
                    );

                    if (botRows.length > 0) {
                        // registered bot — update status
                        await db.query(
                            'UPDATE bots SET whatsapp_name=?, status="active" WHERE session_id=?',
                            [botData.waName, sessionId]
                        ).catch(() => {});

                        addLog(userId, `✅ "${botName}" connected as ${botData.waName}`);

                        // resolve name if WA returned Unknown
                        if (botData.waName === 'Unknown') {
                            setImmediate(async () => {
                                try {
                                    const profile = await sock.fetchProfile(sock.user.id);
                                    if (profile?.name?.trim()) {
                                        botData.waName = profile.name.trim();
                                        await db.query(
                                            'UPDATE bots SET whatsapp_name=? WHERE session_id=?',
                                            [botData.waName, sessionId]
                                        ).catch(() => {});
                                        // re-attach with updated name
                                        const updatedBotData = { ...botData, sessionId, db, getOwnerUserId, getOwnerJid, isPro };
                                        attachBotDataToSocket(sock, updatedBotData);
                                    }
                                } catch {}
                            });
                        }

                    } else {
                        // fresh pairing session
                        console.log(chalk.yellow(`[PAIRING] ${botName} — fresh pair`));

                        // reset bot_mode to public on every genuinely fresh
                        // pairing — otherwise a reused phone number silently
                        // inherits whatever mode was set on it previously
                        try {
                            const [existingRows] = await db.query(
                                'SELECT id FROM bot_settings WHERE session_id = ? ORDER BY id DESC LIMIT 1',
                                [sessionId]
                            );
                            if (existingRows && existingRows.length > 0) {
                                await db.query(
                                    'UPDATE bot_settings SET bot_mode = ? WHERE id = ?',
                                    ['public', existingRows[0].id]
                                );
                            } else {
                                await db.query(
                                    'INSERT INTO bot_settings (session_id, bot_mode) VALUES (?, ?)',
                                    [sessionId, 'public']
                                );
                            }
                        } catch (err) {
                            console.error(chalk.red('[PAIRING] Failed to reset bot_mode:'), err.message);
                        }

                        const credsContent = fs.readFileSync(credsPath, 'utf8');
                        const fullSession  = sessionId + '::::' +
                            Buffer.from(credsContent).toString('base64');
                        const waNumber = sock._ownerPhone ||
                            sessionId.replace(/^[a-z_]+/i, '');

                        await db.query(
                            `INSERT INTO paired_sessions
                             (user_id, session_id, session_name, phone, whatsapp_name, whatsapp_number, session_data, status)
                             VALUES (?,?,?,?,?,?,?,'paired')
                             ON DUPLICATE KEY UPDATE
                               whatsapp_name   = VALUES(whatsapp_name),
                               whatsapp_number = VALUES(whatsapp_number),
                               session_data    = VALUES(session_data),
                               status          = 'paired'`,
                            [userId, sessionId, sessionId, waNumber,
                             botData.waName, waNumber, fullSession]
                        ).catch(() => {});

                        await delay(3000);

                        await sock.sendMessage(waNumber + '@s.whatsapp.net', {
                            text: `🔑 *SESSION ID*\n\n${fullSession}\n\n⚠️ Paste this in Dashboard › Add Bot to activate.`,
                        }).catch(() => {});

                        addLog(userId, `📤 Session ID sent to +${waNumber}`);
                        addLog(userId, `🔌 Pairing complete — disconnecting`);

                        await delay(2000);
                        cleanupConnection(botData, sessionId);
                        return;
                    }

                } catch (dbErr) {
                    // DB error must NOT crash the bot
                    // _ownerPhone and openedAt already set above
                    console.error(chalk.red('[DB ERROR on open]'), dbErr.message);
                }
            }

            // ── CLOSE ────────────────────────────────────────────────────────
            if (connection === 'close') {
                if (isShuttingDown) return;
                if (!isCurrentGen(sessionId, thisGen)) return;

                // clear anti-sleep on disconnect
                if (botData.sleepInterval) {
                    clearInterval(botData.sleepInterval);
                    botData.sleepInterval = null;
                }

                const code   = lastDisconnect?.error?.output?.statusCode;
                const errMsg = lastDisconnect?.error?.message || 'unknown';

                // suppress noisy but harmless codes
                if (code !== 515 && code !== 503 && code !== 408 && code !== 428) {
                    console.log(chalk.yellow(`[CLOSE] ${botName} code=${code} msg="${errMsg}"`));
                }

                // stopped by user — do NOT reconnect
                if (stoppedBots.has(sessionId)) {
                    cleanupConnection(botData, sessionId);
                    clearMemoryState(sessionId);
                    return;
                }

                // session permanently invalidated — must re-pair
                if (
                    code === DisconnectReason.loggedOut ||
                    code === 401 ||
                    code === 403
                ) {
                    addLog(userId, `🔐 "${botName}" session invalidated — re-pair device.`);
                    db.query(
                        'UPDATE bots SET status="inactive" WHERE session_id=?', [sessionId]
                    ).catch(() => {});
                    cleanupConnection(botData, sessionId);
                    clearMemoryState(sessionId);
                    return;
                }

                // 440 ghost conflict — another WA instance took over
                if (code === 440) {
                    addLog(userId, `👻 "${botName}" conflict (440) — reconnecting in 10s…`);
                    cleanupConnection(botData, sessionId);
                    reconnectLocks.delete(sessionId);
                    setTimeout(() => {
                        if (!isShuttingDown && !stoppedBots.has(sessionId))
                            activateBotSession(sessionId, userId, botName, server).catch(() => {});
                    }, 10_000);
                    return;
                }

                // temporary disconnect — escalating backoff
                const attempts = (reconnectAttempts.get(sessionId) || 0) + 1;
                reconnectAttempts.set(sessionId, attempts);

                const backoff = attempts === 1 ? 3_000
                              : attempts === 2 ? 6_000
                              : attempts === 3 ? 15_000
                              : 30_000;

                cleanupConnection(botData, sessionId);
                reconnectLocks.delete(sessionId); // release so next call can proceed

                addLog(userId, `🔄 "${botName}" reconnecting in ${backoff / 1000}s… (attempt ${attempts})`);

                setTimeout(() => {
                    if (!isShuttingDown && !stoppedBots.has(sessionId))
                        activateBotSession(sessionId, userId, botName, server).catch(() => {});
                }, backoff);
            }
        });

        // ── 60s connect timeout ───────────────────────────────────────────────
        setTimeout(() => {
            if (isShuttingDown) return;
            if (isCurrentGen(sessionId, thisGen) && connectingBots.has(sessionId)) {
                console.log(chalk.yellow(`[TIMEOUT] ${botName} — no connection in 60s, retrying`));
                cleanupConnection(botData, sessionId);
                reconnectLocks.delete(sessionId);

                const attempts = (reconnectAttempts.get(sessionId) || 0) + 1;
                reconnectAttempts.set(sessionId, attempts);
                const backoff = attempts <= 2 ? 5_000 : 15_000;

                setTimeout(() => {
                    if (!isShuttingDown && !stoppedBots.has(sessionId))
                        activateBotSession(sessionId, userId, botName, server).catch(() => {});
                }, backoff);
            }
        }, 60_000);

    } catch (err) {
        // always release lock on error so next attempt can proceed
        reconnectLocks.delete(sessionId);
        connectingBots.delete(sessionId);
        console.error(chalk.red(`[ACTIVATE ERROR] ${botName}:`), err.message);
        throw err;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-RECONNECT ON STARTUP
//
// Called by app.js after DB connects.
// Reads all status="active" bots and reconnects them using saved creds.
// No re-pairing needed as long as creds.json exists and WA
// hasn't invalidated the session.
// ─────────────────────────────────────────────────────────────────────────────
async function autoReconnectBots() {
    try {
        const [rows] = await db.query(
            'SELECT session_id, user_id, bot_name, server FROM bots WHERE status="active"'
        );

        // reload console logs into memory
        try {
            const [logUsers] = await db.query(
                'SELECT DISTINCT user_id FROM console_logs'
            );
            for (const u of logUsers) {
                const [logs] = await db.query(
                    'SELECT message, time FROM console_logs WHERE user_id=? ORDER BY id DESC LIMIT 200',
                    [u.user_id]
                );
                if (logs.length) consoleLogs.set(u.user_id, logs);
            }
            console.log(chalk.cyan(`   📋 Logs reloaded for ${logUsers.length} user(s)`));
        } catch {}

        if (!rows.length) {
            console.log(chalk.gray('   No active bots to restore'));
            return;
        }

        console.log(chalk.cyan(`   🔄 Restoring ${rows.length} bot(s)…`));

        let queued = 0;
        for (let i = 0; i < rows.length; i++) {
            const bot       = rows[i];
            const credsPath = path.join(SESSION_DIR, bot.session_id, 'creds.json');

            if (!fs.existsSync(credsPath)) {
                console.log(chalk.yellow(`   ⚠️  ${bot.bot_name} — no creds, marking inactive`));
                await db.query(
                    'UPDATE bots SET status="inactive" WHERE session_id=?',
                    [bot.session_id]
                ).catch(() => {});
                continue;
            }

            queued++;
            // stagger 4s each — prevents WA flagging mass-connect
            setTimeout(() => {
                if (!isShuttingDown && !stoppedBots.has(bot.session_id)) {
                    activateBotSession(
                        bot.session_id, bot.user_id, bot.bot_name, bot.server
                    ).catch(err =>
                        console.log(chalk.red(`   ❌ ${bot.bot_name}: ${err.message}`))
                    );
                }
            }, i * 4_000);
        }

        console.log(chalk.green(`   ✅ Queued ${queued} bot(s)`));

    } catch (err) {
        console.error(chalk.red('   ❌ Auto-reconnect error:'), err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
function getAnySocket() {
    for (const [, bd] of activeBots) {
        if (bd.sock && bd.openedAt > 0) return bd.sock;
    }
    return null;
}

setupGracefulShutdown();

module.exports = {
    activateBotSession,
    cleanupConnection,
    autoReconnectBots,
    getAnySocket,
    clearMemoryState,
    SERVER_IPS, // export so routes/servers.js can share the same map
};
