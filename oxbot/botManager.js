/**
 * @file oxbot/botManager.js
 * 
 * ARCHITECTURE MATCHED TO STEADY SINGLE-USER SCRIPT:
 * 1. setImmediate() for instant parallel message processing
 * 2. 3-second simple reconnect (no complex backoff locks)
 * 3. 5-minute message age limit (prevents zombie processing)
 * 4. Aggressive memory cleanup (clears dedup cache every 5 mins)
 * 5. Strict 'notify' type filtering + System JID blocking
 */

const fs    = require('fs');
const path  = require('path');
const chalk = require('chalk');
const pino  = require('pino');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');

const db = require('./database');
const {
    consoleLogs,
    activeBots,
    connectingBots,
    stoppedBots,
} = require('./state');
const { addLog, patchCredsIfNeeded, delay } = require('./utils');
const {
    handleIncomingMessage,
    antideleteRevocation,
    clearSessionState,
} = require('../commands');

const SESSION_DIR  = path.join(__dirname, '..', 'sessions');
const WA_BROWSER   = ['Chrome (Linux)', 'Chrome', '121.0.0.0'];

// ─────────────────────────────────────────────────────────────────────────────
// AGGRESSIVE MEMORY MANAGEMENT (Copied from steady script)
// ─────────────────────────────────────────────────────────────────────────────
const processedMessages = new Map(); // sessionId -> Set of msgIds

// Clear deduplication cache every 5 minutes to prevent RAM bloat
setInterval(() => {
    for (const [sessionId, msgSet] of processedMessages.entries()) {
        // If a session is dead, delete its map entirely
        if (!activeBots.has(sessionId)) {
            processedMessages.delete(sessionId);
            continue;
        }
        // Clear IDs if they grow too large
        if (msgSet.size > 1000) {
            msgSet.clear();
        }
    }
}, 5 * 60 * 1000);


// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function isCurrentGen(sessionId, gen) {
    return activeBots.get(sessionId)?.gen === gen;
}

function cleanupConnection(botData, sessionId) {
    if (botData?.sock) {
        try { botData.sock.ev?.removeAllListeners(); } catch {}
        try { botData.sock.ws?.close();              } catch {}
        try { botData.sock.end({ reason: 'cleanup' }); } catch {}
    }
    activeBots.delete(sessionId);
    connectingBots.delete(sessionId);
    processedMessages.delete(sessionId); // Free memory immediately
    global.botConnected = activeBots.size > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE: ACTIVATE BOT
// ─────────────────────────────────────────────────────────────────────────────

async function activateBotSession(sessionId, userId, botName, server) {

    // ── Guard: stopped by user ────────────────────────────────────────────────
    if (stoppedBots.has(sessionId)) return;

    // ── Guard: already alive ──────────────────────────────────────────────────
    if (activeBots.get(sessionId)?.openedAt > 0) {
        addLog(userId, `✅ "${botName}" already connected`);
        return;
    }

    // ── Kill dead socket ──────────────────────────────────────────────────────
    const existing = activeBots.get(sessionId);
    if (existing) cleanupConnection(existing, sessionId);

    // ── Creds check ───────────────────────────────────────────────────────────
    const sessionFolder = path.join(SESSION_DIR, sessionId);
    const credsPath     = path.join(sessionFolder, 'creds.json');

    if (!fs.existsSync(credsPath)) {
        throw new Error('Invalid session: credentials not found');
    }

    connectingBots.add(sessionId);
    patchCredsIfNeeded(sessionFolder);
    addLog(userId, `🔄 Connecting "${botName}"…`);

    // ── Build socket (Exact config from steady script) ────────────────────────
    const { version }         = await fetchLatestBaileysVersion();
    const { state, saveCreds} = await useMultiFileAuthState(sessionFolder);
    const thisGen = (activeBots.get(sessionId)?.gen || 0) + 1;

    const botData = {
        sessionId, userId, botName, server,
        waName:   null,
        sock:     null,
        openedAt: 0,
        gen:      thisGen,
        db,
        addLog:   (msg) => addLog(userId, msg),
    };

    const sock = makeWASocket({
        version,
        logger:                         pino({ level: 'silent' }),
        printQRInTerminal:              false,
        browser:                        WA_BROWSER,
        auth: {
            creds: state.creds,
            keys:  makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
        },
        markOnlineOnConnect:            false, // Less suspicious, exactly like steady script
        syncFullHistory:                false, // Prevent RAM overload
        downloadHistory:                false,
        getMessage:                     async () => undefined,
        keepAliveIntervalMs:            15_000, // 15s WS ping is all you need
        defaultQueryTimeoutMs:          60_000,
        emitOwnEvents:                  false,
        patchMessageBeforeSending: (msg) => {
            if (msg.buttonsMessage || msg.listMessage || msg.templateMessage) {
                msg = { viewOnceMessage: { message: { messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} }, ...msg } } };
            }
            return msg;
        },
    });

    botData.sock = sock;
    activeBots.set(sessionId, botData);

    // ─────────────────────────────────────────────────────────────────────────
    // EVENT: creds.update
    // ─────────────────────────────────────────────────────────────────────────
    sock.ev.on('creds.update', saveCreds);

    // ─────────────────────────────────────────────────────────────────────────
    // EVENT: messages.upsert (THE STEADY SCRIPT LOGIC)
    // ─────────────────────────────────────────────────────────────────────────
    sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (!isCurrentGen(sessionId, thisGen)) return;
        const current = activeBots.get(sessionId);
        if (!current || current.openedAt <= 0) return;

        // ONLY process "notify" (live messages), skip "append" (old history)
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || !msg.key?.id) continue;
            
            const from = msg.key.remoteJid;
            if (!from) continue;

            // Silently ignore system/status/broadcast/newsletter JIDs
            if (from.includes('@broadcast') || from.includes('@newsletter')) continue;

            // ── Deduplication ─────────────────────────────────────────────
            if (!processedMessages.has(sessionId)) {
                processedMessages.set(sessionId, new Set());
            }
            const sessionMsgs = processedMessages.get(sessionId);
            if (sessionMsgs.has(msg.key.id)) continue;
            sessionMsgs.add(msg.key.id);

            // ── 5-Minute Age Limit (Prevents processing delayed zombie msgs) ─
            if (msg.messageTimestamp) {
                const messageAge = Date.now() - (msg.messageTimestamp * 1000);
                if (messageAge > 5 * 60 * 1000) continue; // Older than 5 mins? Drop it.
            }

            // Skip protocol messages (read receipts, reactions, etc)
            if (msg.message?.protocolMessage) continue;

            const txt =
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption ||
                msg.message?.videoMessage?.caption ||
                '';

            // Log commands
            if (txt.startsWith('.') || txt.startsWith('!')) {
                const isGroup = from.endsWith('@g.us');
                const sender  = msg.key.fromMe ? (sock.user?.name || 'You') : (msg.pushName || from.split('@')[0]);
                const where   = isGroup ? '👥 Group' : '👤 DM';
                const cmd     = txt.split(' ')[0];
                const preview = txt.slice(cmd.length).trim().slice(0, 30);
                addLog(userId, `💬 [CMD] ${where} | ${sender} → ${cmd}${preview ? ' ' + preview : ''}`);
            }

            // Ignore own non-command messages
            if (msg.key.fromMe && !txt.startsWith('.') && !txt.startsWith('!')) continue;

            // ── STEADY TRICK: setImmediate (DON'T BLOCK THE EVENT LOOP) ──
            // This is why his bot feels instantly fast. It fires the command
            // into the background instead of waiting for it to finish.
            setImmediate(() => {
                handleIncomingMessage(sock, msg, current).catch(err => {
                    const m = err?.message || '';
                    if (!m.includes('rate-overlimit') && !m.includes('decrypt') && !m.includes('Bad MAC')) {
                        console.error(chalk.red('[CMD ERROR]'), m);
                    }
                });
            });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // EVENT: messages.update (Antidelete)
    // ─────────────────────────────────────────────────────────────────────────
    sock.ev.on('messages.update', (updates) => {
        if (!isCurrentGen(sessionId, thisGen)) return;
        const current = activeBots.get(sessionId);
        if (!current || current.openedAt <= 0 || !antideleteRevocation) return;

        for (const update of updates) {
            if (update.message?.protocolMessage?.type !== 0) continue;
            setImmediate(() => antideleteRevocation(sock, update, current).catch(() => {}));
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // EVENT: group-participants.update
    // ─────────────────────────────────────────────────────────────────────────
    sock.ev.on('group-participants.update', (update) => {
        if (!isCurrentGen(sessionId, thisGen)) return;
        const current = activeBots.get(sessionId);
        if (!current || current.openedAt <= 0) return;
        
        setImmediate(() => {
            // Assuming you have a groupUpdate handler in commands
            if (typeof current.handleGroupUpdate === 'function') {
                current.handleGroupUpdate(sock, update).catch(() => {});
            }
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // EVENT: contacts.upsert (Name resolution)
    // ─────────────────────────────────────────────────────────────────────────
    sock.ev.on('contacts.upsert', (contacts) => {
        if (!isCurrentGen(sessionId, thisGen) || !sock.user?.id) return;
        const myNum = sock.user.id.split(':')[0].split('@')[0];
        const self = contacts.find(c => c.id?.split(':')[0].split('@')[0] === myNum);
        
        if (self) {
            const freshName = self.name || self.verifiedName || self.notify || self.pushName;
            if (freshName && freshName !== botData.waName) {
                botData.waName = freshName;
                db.query('UPDATE bots SET whatsapp_name=? WHERE session_id=?', [freshName, sessionId]).catch(() => {});
            }
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // EVENT: connection.update (THE SIMPLE 3s RECONNECT LOGIC)
    // ─────────────────────────────────────────────────────────────────────────
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            // In a dashboard bot, QR usually isn't printed to terminal, but just in case:
            // console.log(`[QR] ${botName} requested QR`);
        }

        // ── OPEN ─────────────────────────────────────────────────────────────
        if (connection === 'open') {
            if (!isCurrentGen(sessionId, thisGen)) return;

            connectingBots.delete(sessionId);
            botData.openedAt    = Date.now();
            global.botConnected = true;

            const ownerPhone = sock.user?.id ? sock.user.id.split(':')[0] : 'Unknown';
            botData.waName = sock.user?.name || botData.waName || 'Unknown';

            try {
                const [botRows] = await db.query('SELECT session_id FROM bots WHERE session_id=?', [sessionId]);

                if (botRows.length > 0) {
                    // Real bot registered in DB
                    await db.query('UPDATE bots SET whatsapp_name=?, status="active" WHERE session_id=?', [botData.waName, sessionId]).catch(() => {});
                    addLog(userId, `✅ "${botName}" connected as ${botData.waName}`);
                    console.log(chalk.green(`[ONLINE] ${botName} → +${ownerPhone}`));

                } else {
                    // Fresh pairing session
                    const credsContent = fs.readFileSync(credsPath, 'utf8');
                    const b64 = Buffer.from(credsContent).toString('base64');
                    const fullSession = sessionId + '::::' + b64;

                    await db.query(
                        `INSERT INTO paired_sessions (user_id, session_id, session_name, phone, whatsapp_name, whatsapp_number, session_data, status)
                         VALUES (?,?,?,?,?,?,?,'paired')
                         ON DUPLICATE KEY UPDATE session_data=VALUES(session_data), status='paired'`,
                        [userId, sessionId, sessionId, ownerPhone, botData.waName, ownerPhone, fullSession]
                    ).catch(() => {});

                    await sock.sendMessage(ownerPhone + '@s.whatsapp.net', {
                        text: `🔑 *SESSION ID*\n\n${fullSession}\n\n⚠️ Paste this in your Dashboard › Add Bot to activate.`
                    }).catch(() => {});

                    addLog(userId, `🔌 Pairing complete — disconnecting temp socket`);
                    cleanupConnection(botData, sessionId);
                    return;
                }
            } catch (err) {
                console.error(chalk.red('[DB ERROR on open]'), err.message);
            }
        }

        // ── CLOSE ────────────────────────────────────────────────────────────
        if (connection === 'close') {
            if (!isCurrentGen(sessionId, thisGen)) return;

            const code = lastDisconnect?.error?.output?.statusCode;
            const errMsg = lastDisconnect?.error?.message || 'unknown';

            // Suppress verbose logs for common temporary WA hiccups
            if (code !== 515 && code !== 503 && code !== 408) {
                console.log(chalk.yellow(`[CLOSE] ${botName} code=${code} msg="${errMsg}"`));
            }

            // 1. Stopped by user
            if (stoppedBots.has(sessionId)) {
                cleanupConnection(botData, sessionId);
                clearSessionState(sessionId);
                return;
            }

            // 2. Logged out / Banned
            if (code === DisconnectReason.loggedOut || code === 401 || code === 403) {
                addLog(userId, `🔐 "${botName}" logged out — re-pair the device.`);
                db.query('UPDATE bots SET status="inactive" WHERE session_id=?', [sessionId]).catch(() => {});
                cleanupConnection(botData, sessionId);
                clearSessionState(sessionId);
                return;
            }

            // 3. ALL OTHER ERRORS (515, 440, 503, 408, network drop, etc.)
            // STEADY TRICK: Don't do math. Don't use locks. Just wait 3 seconds and rebuild.
            cleanupConnection(botData, sessionId);
            addLog(userId, `🔄 "${botName}" reconnecting in 3s…`);

            setTimeout(() => {
                if (!stoppedBots.has(sessionId)) {
                    activateBotSession(sessionId, userId, botName, server).catch(() => {});
                }
            }, 3000); // Exactly 3 seconds. Always.
        }
    });

    // ── 30s Timeout Safety Net ────────────────────────────────────────────────
    setTimeout(() => {
        if (isCurrentGen(sessionId, thisGen) && connectingBots.has(sessionId)) {
            console.log(chalk.yellow(`[BOT] ${botName} — connect timeout, forcing retry`));
            cleanupConnection(botData, sessionId);
            
            setTimeout(() => {
                if (!stoppedBots.has(sessionId)) {
                    activateBotSession(sessionId, userId, botName, server).catch(() => {});
                }
            }, 3000);
        }
    }, 30_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-RECONNECT ON SERVER STARTUP
// ─────────────────────────────────────────────────────────────────────────────

async function autoReconnectBots() {
    try {
        const [rows] = await db.query('SELECT session_id, user_id, bot_name, server FROM bots WHERE status="active"');

        // Reload console logs
        try {
            const [logUsers] = await db.query('SELECT DISTINCT user_id FROM console_logs');
            for (const u of logUsers) {
                const [logs] = await db.query('SELECT message, time FROM console_logs WHERE user_id=? ORDER BY id DESC LIMIT 200', [u.user_id]);
                if (logs.length) consoleLogs.set(u.user_id, logs);
            }
        } catch {}

        if (!rows.length) {
            console.log(chalk.gray('   No active bots to restore'));
            return;
        }

        console.log(chalk.cyan(`   🔄 Restoring ${rows.length} bot(s)…`));

        for (let i = 0; i < rows.length; i++) {
            const bot = rows[i];
            if (!fs.existsSync(path.join(SESSION_DIR, bot.session_id, 'creds.json'))) {
                await db.query('UPDATE bots SET status="inactive" WHERE session_id=?', [bot.session_id]).catch(() => {});
                continue;
            }

            // Stagger startups by 3 seconds
            setTimeout(() => {
                if (!stoppedBots.has(bot.session_id)) {
                    activateBotSession(bot.session_id, bot.user_id, bot.bot_name, bot.server).catch(err =>
                        console.log(chalk.red(`   ❌ ${bot.bot_name}: ${err.message}`))
                    );
                }
            }, i * 3000);
        }
    } catch (err) {
        console.error(chalk.red('   ❌ Auto-reconnect error:'), err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

function getAnySocket() {
    for (const [, botData] of activeBots) {
        if (botData.sock && botData.openedAt > 0) return botData.sock;
    }
    return null;
}

module.exports = {
    activateBotSession,
    cleanupConnection,
    autoReconnectBots,
    getAnySocket,
};
