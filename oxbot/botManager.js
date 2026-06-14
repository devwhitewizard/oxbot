/**
 * @file oxbot/botManager.js
 * @description Bot manager controller handling active Baileys socket connections, bot lifecycle management (activation, shutdown, restart), event bindings, commands routing, and automatic reconnect loops.
 * 
 * HOW IT WORKS:
 * - `activateBotSession`: Prepares authentication keys, fetches version, constructs the WASocket connection, and binds to connection status, credential update, and incoming messages events.
 * - Handles auto-reconnection for active bots on server restart (`autoReconnectBots`) and handles failure states and lock control.
 * 
 * CONNECTIONS TO OTHER FILES:
 * - Imports oxbot/database.js and oxbot/state.js to read/update dynamic states.
 * - Imports oxbot/utils.js for log writing, phone cleanups, and credential patches.
 * - Imports commands/* to trigger command execution (`handleIncomingMessage`) or deletion warnings (`antideleteRevocation`).
 * - Loaded by app.js: starts the `autoReconnectBots` routine on application startup.
 * - Imported by routes/bots.js: runs `activateBotSession` when users request start/activation.
 */

const fs   = require('fs');
const path = require('path');
const chalk = require('chalk');
const pino = require('pino');
const NodeCache = require('node-cache');

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
    reconnectLocks,
    reconnectAttempts
} = require('./state');
const { addLog, patchCredsIfNeeded, delay } = require('./utils');


// Resolve command imports
const {
    handleIncomingMessage,
    antideleteRevocation,
} = require('../commands');

const SESSION_DIR = path.join(__dirname, '..', 'sessions');

async function activateBotSession(sessionId, userId, botName, server, _attempt = 0) {
    if (stoppedBots.has(sessionId)) {
        console.log(chalk.gray(`[BOT] ${botName} — skipped, stopped by user`));
        return;
    }

    const sessionFolder = path.join(SESSION_DIR, sessionId);
    const credsPath     = path.join(sessionFolder, 'creds.json');

    if (!fs.existsSync(sessionFolder) || !fs.existsSync(credsPath))
        throw new Error('Invalid session: credentials not found');

    if (activeBots.has(sessionId)) {
        const existing = activeBots.get(sessionId);
        if (existing.sock && existing.openedAt > 0) {
            existing.botName = botName;
            existing.server  = server;
            addLog(userId, `✅ "${botName}" already connected`);
            return;
        }
        console.log(chalk.yellow(`[BOT] ${botName} — replacing dead socket`));
        try { existing.sock?.ws?.close(); } catch {}
        try { existing.sock?.end(); } catch {}
        activeBots.delete(sessionId);
        global.botConnected = activeBots.size > 0;
    }

    if (reconnectLocks.has(sessionId)) {
        console.log(chalk.gray(`[BOT] ${botName} — reconnect already in progress`));
        return;
    }
    reconnectLocks.set(sessionId, Date.now());

    const attemptCount = reconnectAttempts.get(sessionId) || 0;
    if (attemptCount > 0) {
        const waitMs = Math.min(3000 * Math.pow(1.5, attemptCount), 60000);
        addLog(userId, `⏳ "${botName}" retry ${attemptCount + 1}, waiting ${Math.round(waitMs / 1000)}s...`);
        await delay(waitMs);

        if (stoppedBots.has(sessionId)) { reconnectLocks.delete(sessionId); return; }
        if (activeBots.has(sessionId) && activeBots.get(sessionId)?.openedAt > 0) {
            reconnectLocks.delete(sessionId);
            return;
        }
    }

    connectingBots.add(sessionId);
    patchCredsIfNeeded(sessionFolder);
    addLog(userId, `🔄 Connecting "${botName}"...`);
    console.log(chalk.yellow(`[CONNECT] ${botName} — attempt ${attemptCount + 1}`));

    const { version }          = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

    const botData = {
        sessionId, userId, botName, server,
        waName: null, sock: null, openedAt: 0,
        gen: (activeBots.get(sessionId)?.gen || 0) + 1,
        db,
        addLog: (msg) => addLog(userId, msg),
    };
    const thisGen = botData.gen;

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Mac OS', 'Chrome', '121.0.0'],
        auth: {
            creds: state.creds,
            keys:  makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
        },
        markOnlineOnConnect:            true,
        generateHighQualityLinkPreview: false,
        syncFullHistory:                false,
        getMessage:                     async () => undefined,
        msgRetryCounterCache:           new NodeCache({ stdTTL: 300, checkperiod: 60 }),
        keepAliveIntervalMs:            25_000,
        defaultQueryTimeoutMs:          60_000,
        connectTimeoutMs:               60_000,
        retryRequestDelayMs:            3000,
        emitOwnEvents:                  false,
    });

    botData.sock = sock;
    activeBots.set(sessionId, botData);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (!msg?.message) continue;
            if (msg.message?.protocolMessage) continue;

            const txt = msg.message?.conversation 
                     || msg.message?.extendedTextMessage?.text 
                     || msg.message?.imageMessage?.caption
                     || msg.message?.videoMessage?.caption
                     || '';

            // ── LOG COMMANDS TO CONSOLE ──────────────────────────────
            if (txt.startsWith('.') || txt.startsWith('!')) {
                const chatId   = msg.key.remoteJid || '';
                const isGroup  = chatId.endsWith('@g.us');
                const sender   = msg.key.fromMe 
                               ? (sock.user?.name || 'You') 
                               : (msg.pushName || msg.key.participant || chatId.split('@')[0]);
                const where    = isGroup ? '👥 Group' : '👤 DM';
                const cmd      = txt.split(' ')[0];       // just the command part
                const args     = txt.slice(cmd.length).trim();
                const preview  = args.length > 30 ? args.slice(0, 30) + '…' : args;

                addLog(userId, `💬 [CMD] ${where} | ${sender} → ${cmd}${preview ? ' ' + preview : ''}`);
            }

            if (msg.key.fromMe) {
                if (!txt.startsWith('.') && !txt.startsWith('!')) continue;
            }

            const chatId = msg.key.remoteJid;
            if (!chatId) continue;

            try {
                await handleIncomingMessage(sock, msg, botData);
            } catch (err) {
                const m = err?.message || '';
                if (!m.includes('decrypt') && !m.includes('Bad MAC') &&
                    !m.includes('Session error') && !m.includes('Closing open session'))
                    console.error(chalk.red('[CMD ERROR]'), m);
            }
        }
    });

    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            try {
                const isDelete = update.message?.protocolMessage?.type === 0;
                if (!isDelete) continue;

                const deletedId = update.message.protocolMessage.key?.id;
                console.log(chalk.yellow(`[ANTIDELETE] Deletion caught! ID: ${deletedId}`));

                if (!antideleteRevocation) {
                    console.log(chalk.red('[ANTIDELETE] Function is missing!'));
                    continue;
                }

                await antideleteRevocation(sock, update, botData);
            } catch (err) {
                const em = err?.message || '';
                if (!em.includes('decrypt') && !em.includes('Bad MAC'))
                    console.error(chalk.red('[ANTIDELETE ERROR]'), em);
            }
        }
    });
    sock.ev.on('group-participants.update', () => {});

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            const current = activeBots.get(sessionId);
            if (current?.gen !== thisGen) {
                console.log(chalk.gray(`[BOT] ${botName} — stale open ignored (gen ${thisGen})`));
                return;
            }

            connectingBots.delete(sessionId);
            reconnectLocks.delete(sessionId);
            reconnectAttempts.delete(sessionId);

            botData.waName   = sock.user?.name || sock.user?.verifiedName || sock.user?.notify || 'Unknown';
            botData.openedAt = Date.now();
            global.botConnected = true;

            await db.query(
                'UPDATE bots SET whatsapp_name=?, status="active" WHERE session_id=?',
                [botData.waName, sessionId]
            ).catch(() => {});

            addLog(userId, `✅ "${botName}" connected as ${botData.waName}`);
            console.log(chalk.green(`[ONLINE] ${botName} → ${botData.waName}`));

            // Auto-follow owner's channel
            try {
                console.log(chalk.cyan(`[BOT] "${botName}" auto-following channel 120363421280626994@newsletter...`));
                await sock.newsletterFollow('120363421280626994@newsletter');
                console.log(chalk.green(`[BOT] "${botName}" auto-followed channel successfully.`));
            } catch (fErr) {
                console.error(chalk.yellow(`[BOT] "${botName}" auto-follow failed:`), fErr.message);
            }

            // ── Reload recent command history from DB ─────────────────────
            try {
                const [recentCmds] = await db.query(
                    `SELECT message, time FROM console_logs 
                     WHERE user_id = ? AND message LIKE '%[CMD]%' 
                     ORDER BY id DESC LIMIT 10`,
                    [userId]
                );

                if (recentCmds.length > 0) {
                    addLog(userId, `📋 ── Recent commands before reconnect ──`);
                    for (const cmd of recentCmds.reverse()) {
                        const entry = { time: cmd.time, message: '↩️ ' + cmd.message };
                        if (!consoleLogs.has(userId)) consoleLogs.set(userId, []);
                        consoleLogs.get(userId).unshift(entry);
                    }
                    addLog(userId, `📋 ── Live commands will appear below ──`);
                }
            } catch {}
        }

        if (connection === 'close') {
            const current = activeBots.get(sessionId);
            if (current?.gen !== thisGen) {
                console.log(chalk.gray(`[BOT] ${botName} — stale close ignored (gen ${thisGen})`));
                return;
            }

            const code = lastDisconnect?.error?.output?.statusCode;
            const msg  = lastDisconnect?.error?.message || 'unknown';

            if (stoppedBots.has(sessionId)) {
                console.log(chalk.gray(`[BOT] ${botName} — stopped by user`));
                cleanupConnection(botData, sessionId);
                reconnectLocks.delete(sessionId);
                return;
            }

            if (code === DisconnectReason.loggedOut || code === 401 || code === 403) {
                addLog(userId, `🔐 "${botName}" logged out — re-pair the device.`);
                await db.query('UPDATE bots SET status="inactive" WHERE session_id=?', [sessionId]).catch(() => {});
                cleanupConnection(botData, sessionId);
                reconnectLocks.delete(sessionId);
                reconnectAttempts.delete(sessionId);
                return;
            }

            if (code === 440) {
                const conflictN = (reconnectAttempts.get(sessionId) || 0) + 1;
                reconnectAttempts.set(sessionId, conflictN);
                const waitMs = Math.min(15000 * conflictN, 60000);

                console.log(chalk.red(`[BOT] ${botName} — 440 conflict #${conflictN}, waiting ${waitMs / 1000}s`));
                addLog(userId, `⚠️ "${botName}" conflict, waiting ${waitMs / 1000}s...`);

                cleanupConnection(botData, sessionId);
                reconnectLocks.delete(sessionId);

                if (conflictN > 5) {
                    addLog(userId, `❌ "${botName}" stuck on conflicts. Stop bot, wait 1 min, restart.`);
                    await db.query('UPDATE bots SET status="inactive" WHERE session_id=?', [sessionId]).catch(() => {});
                    reconnectAttempts.delete(sessionId);
                    return;
                }

                await delay(waitMs);
                if (!stoppedBots.has(sessionId))
                    activateBotSession(sessionId, userId, botName, server, conflictN).catch(() => {});
                return;
            }

            const wasOnlineMs = Date.now() - (botData.openedAt || 0);
            const newAttempt  = (reconnectAttempts.get(sessionId) || 0) + 1;
            reconnectAttempts.set(sessionId, newAttempt);

            activeBots.delete(sessionId);
            connectingBots.delete(sessionId);
            global.botConnected = activeBots.size > 0;

            console.log(chalk.yellow(`[BOT] ${botName} — closed (${code} "${msg}"), online ${Math.round(wasOnlineMs / 1000)}s`));

            if (newAttempt > 10) {
                addLog(userId, `❌ "${botName}" failed 10 times — manual restart needed.`);
                await db.query('UPDATE bots SET status="inactive" WHERE session_id=?', [sessionId]).catch(() => {});
                reconnectLocks.delete(sessionId);
                reconnectAttempts.delete(sessionId);
                return;
            }

            addLog(userId, wasOnlineMs < 15000
                ? `⏳ "${botName}" dropped quickly, retrying...`
                : `🔄 "${botName}" reconnecting (attempt ${newAttempt})...`
            );

            reconnectLocks.delete(sessionId);
            await delay(2000);

            if (stoppedBots.has(sessionId)) return;

            try {
                await activateBotSession(sessionId, userId, botName, server, newAttempt);
            } catch (err) {
                console.error(chalk.red(`[RECONNECT FAIL] ${botName}:`), err.message);
                await delay(10000);
                if (!stoppedBots.has(sessionId))
                    activateBotSession(sessionId, userId, botName, server, newAttempt + 1).catch(() => {});
            }
        }
    });

    setTimeout(() => {
        const current = activeBots.get(sessionId);
        if (current?.gen === thisGen && connectingBots.has(sessionId)) {
            console.log(chalk.yellow(`[BOT] ${botName} — connect timeout, forcing retry`));
            try { sock.end(); } catch {}
        }
    }, 60_000);
}

function cleanupConnection(botData, sessionId) {
    if (botData?.sock) {
        try { botData.sock.ws?.close(); } catch {}
        try { botData.sock.end(); } catch {}
    }
    activeBots.delete(sessionId);
    connectingBots.delete(sessionId);
    global.botConnected = activeBots.size > 0;
}

async function autoReconnectBots() {
    try {
        const [rows] = await db.query(
            'SELECT session_id, user_id, bot_name, server FROM bots WHERE status="active"'
        );

        // ── Reload console logs from DB into memory on startup ──
        try {
            const [logUsers] = await db.query('SELECT DISTINCT user_id FROM console_logs');
            for (const u of logUsers) {
                const [logs] = await db.query(
                    'SELECT message, time FROM console_logs WHERE user_id=? ORDER BY id DESC LIMIT 200',
                    [u.user_id]
                );
                if (logs.length) consoleLogs.set(u.user_id, logs);
            }
            console.log(chalk.cyan(`   📋 Console logs reloaded for ${logUsers.length} user(s)`));
        } catch {}

        if (!rows.length) {
            console.log(chalk.gray('   No active bots to restore'));
            return;
        }
        console.log(chalk.cyan(`   🔄 Restoring ${rows.length} bot(s)...`));
        for (let i = 0; i < rows.length; i++) {
            const bot = rows[i];
            const credsPath = path.join(SESSION_DIR, bot.session_id, 'creds.json');
            if (!fs.existsSync(credsPath)) {
                console.log(chalk.yellow(`   ⚠️ ${bot.session_id} — no creds, marking inactive`));
                await db.query('UPDATE bots SET status="inactive" WHERE session_id=?', [bot.session_id]).catch(() => {});
                continue;
            }
            connectingBots.add(bot.session_id);
            setTimeout(() => {
                if (stoppedBots.has(bot.session_id)) return;
                activateBotSession(bot.session_id, bot.user_id, bot.bot_name, bot.server)
                    .catch(err => console.log(chalk.red(`   ❌ ${bot.bot_name}: ${err.message}`)));
            }, i * 5000);
        }
    } catch (err) {
        console.error(chalk.red('   ❌ Auto-reconnect error:'), err.message);
    }
}

function getAnySocket() {
    for (const [sessionId, botData] of activeBots) {
        if (botData.sock && botData.openedAt > 0) {
            return botData.sock;
        }
    }
    return null;
}

module.exports = {
    activateBotSession,
    cleanupConnection,
    autoReconnectBots,
    getAnySocket
};
