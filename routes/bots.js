/**
 * @file routes/bots.js
 * @description Bot management router exposing user-facing endpoints for bot lifecycles, configuration settings, and features.
 * 
 * HOW IT WORKS:
 * - Implements Express Router.
 * - Secures routes using the `getUser` auth middleware.
 * - Triggers bot controls (`start-bot`, `deactivate-bot`, `delete-bot`, `activate-bot`, `validate-session`).
 * - Manages multi-file authorization setups, pairing status monitors, and QR code streaming.
 * - Handles per-session config parameters (autotyping, seen status, mode, antiban, autoreply, antidelete, custom avatar uploads).
 * 
 * CONNECTIONS TO OTHER FILES:
 * - Mounted in app.js: `app.use(require('./routes/bots'))`.
 * - Imports oxbot/database.js, oxbot/state.js, and oxbot/utils.js.
 * - Imports oxbot/botManager.js to request socket initialization (`activateBotSession`, `getAnySocket`).
 * - Imports oxbot/pairing.js to execute WhatsApp code generation (`startPairing`, `startQRPairing`, `deliverSession`).
 * - Imports oxbot/middleware.js to leverage the `getUser` auth wrapper.
 * - Imports commands/* to update local bot modes (`clearMode`, `BOT_COMMANDS`).
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const { v4: uuidv4 } = require('uuid');
const { useMultiFileAuthState, fetchLatestBaileysVersion, makeWASocket, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const chalk = require('chalk');

const db = require('../oxbot/database');
const {
    consoleLogs,
    pairingMap,
    activeSocks,
    activeBots,
    stoppedBots,
    connectingBots,
    reconnectLocks,
    reconnectAttempts
} = require('../oxbot/state');
const {
    addLog,
    extractSessionId,
    normalisePhone,
    patchCredsIfNeeded,
    delay
} = require('../oxbot/utils');
const {
    activateBotSession,
    getAnySocket
} = require('../oxbot/botManager');
const {
    startPairing,
    startQRPairing,
    deliverSession
} = require('../oxbot/pairing');
const { getUser } = require('../oxbot/middleware');
const { commands: BOT_COMMANDS, clearMode } = require('../commands');

const SESSION_DIR = path.join(__dirname, '..', 'sessions');
const SITE_URL = process.env.SITE_URL || 'http://oxbot.name.ng';

// Helper to check active Pro subscription
async function checkProPlan(userId) {
    const [rows] = await db.query(
        `SELECT id FROM pro_subscriptions WHERE user_id=? AND status='active' AND expires_at > NOW() LIMIT 1`,
        [userId]
    );
    return rows.length > 0;
}

// ── START BOT ─────────────────────────────────────────────────────────────────
router.post('/api/start-bot', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    if (!sessionId) return res.status(400).json({ message: 'Session ID required' });

    const [bots] = await db.query(
        'SELECT * FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]
    );
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });

    if (connectingBots.has(sessionId))
        return res.json({ success: true, message: 'Bot is already connecting...' });

    if (activeBots.has(sessionId)) {
        const existing = activeBots.get(sessionId);
        if (existing.sock && existing.openedAt > 0)
            return res.json({ success: true, message: 'Bot already connected!' });
        try { existing.sock?.end(); } catch {}
        activeBots.delete(sessionId);
        global.botConnected = activeBots.size > 0;
    }

    const credsPath = path.join(SESSION_DIR, sessionId, 'creds.json');
    if (!fs.existsSync(credsPath))
        return res.status(400).json({ message: 'Session files missing — re-pair device.' });

    stoppedBots.delete(sessionId);
    await db.query('UPDATE bots SET status="active" WHERE session_id=?', [sessionId]).catch(() => {});

    try {
        await activateBotSession(sessionId, req.user.id, bots[0].bot_name, bots[0].server);
        addLog(req.user.id, `🟢 Bot started: ${bots[0].bot_name}`);
        res.json({ success: true, message: 'Bot started!' });
    } catch (err) {
        addLog(req.user.id, `❌ Start failed: ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

// ── DEACTIVATE BOT ────────────────────────────────────────────────────────────
router.post('/api/deactivate-bot', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    if (!sessionId) return res.status(400).json({ message: 'Session ID required' });

    stoppedBots.add(sessionId);
    connectingBots.delete(sessionId);
    reconnectLocks.delete(sessionId);
    reconnectAttempts.delete(sessionId);

    const bot = activeBots.get(sessionId);
    if (bot?.sock) {
        try { bot.sock.logout().catch(() => {}); } catch {}
        try { bot.sock.ws?.close(); } catch {}
        try { bot.sock.end(); } catch {}
    }
    activeBots.delete(sessionId);
    global.botConnected = activeBots.size > 0;

    await db.query('UPDATE bots SET status="inactive" WHERE session_id=?', [sessionId]).catch(() => {});
    addLog(req.user.id, `🔴 Stopped: ${sessionId}`);
    console.log(chalk.red('[BOT] Stopped by user: ' + sessionId));
    res.json({ success: true, message: 'Bot stopped' });
});

// ── DELETE BOT ────────────────────────────────────────────────────────────────
router.post('/api/delete-bot', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    if (!sessionId) return res.status(400).json({ message: 'Session ID required' });

    const [bots] = await db.query(
        'SELECT * FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]
    );
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });

    stoppedBots.add(sessionId);
    connectingBots.delete(sessionId);
    reconnectLocks.delete(sessionId);
    reconnectAttempts.delete(sessionId);

    const bot = activeBots.get(sessionId);
    if (bot?.sock) {
        try {
            console.log(chalk.yellow(`[BOT] Logging out ${sessionId} from WhatsApp...`));
            await bot.sock.logout();
        } catch {
            console.log(chalk.gray(`[BOT] ${sessionId} already dead, forcing local close`));
        }
        try { bot.sock.ws?.close(); } catch {}
        try { bot.sock.end(); } catch {}
    }
    activeBots.delete(sessionId);
    global.botConnected = activeBots.size > 0;

    await db.query('DELETE FROM bots          WHERE session_id=? AND user_id=?', [sessionId, req.user.id]).catch(() => {});
    await db.query('DELETE FROM bot_settings  WHERE session_id=?',               [sessionId]).catch(() => {});
    await db.query('DELETE FROM seen_statuses WHERE session_id=?',               [sessionId]).catch(() => {});

    const sessionFolder = path.join(SESSION_DIR, sessionId);
    if (fs.existsSync(sessionFolder)) {
        try {
            fs.rmSync(sessionFolder, { recursive: true, force: true });
            addLog(req.user.id, `🗑️ Bot deleted: ${sessionId}`);
        } catch (err) {
            addLog(req.user.id, `⚠️ Files not removed: ${err.message}`);
        }
    }

    console.log(chalk.red(`[BOT] Permanently deleted: ${sessionId}`));
    res.json({ success: true, message: 'Bot deleted permanently' });
});

// ── GET BOT SETTINGS ──────────────────────────────────────────────────────────
router.get('/api/bot-settings/:sessionId', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.params.sessionId);
    if (!sessionId) return res.status(400).json({ message: 'Session ID required' });

    const [bots] = await db.query(
        'SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]
    );
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });

    try {
        const [rows] = await db.query('SELECT * FROM bot_settings WHERE session_id=?', [sessionId]);
        res.json(rows.length ? rows[0] : { session_id: sessionId, autotyping: false });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── UPDATE AUTOTYPING (BOT SETTINGS) ──────────────────────────────────────────
router.post('/api/bot-settings/autotyping', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    const enabled   = req.body.enabled === true || req.body.enabled === 'true' || req.body.enabled === 1;
    if (!sessionId) return res.status(400).json({ message: 'Session ID required' });

    const [bots] = await db.query(
        'SELECT id, bot_name FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]
    );
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });

    try {
        const val = enabled ? 1 : 0;
        await db.query(
            `INSERT INTO bot_settings (session_id, autotyping)
             VALUES (?, ?) ON DUPLICATE KEY UPDATE autotyping=?`,
            [sessionId, val, val]
        );
        addLog(req.user.id, `⚙️ Auto-typing ${enabled ? 'ON' : 'OFF'} for "${bots[0].bot_name}"`);
        res.json({ success: true, session_id: sessionId, autotyping: enabled });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PAIR (ULTIMATE VERSION) ───────────────────────────────────────────────────
router.post('/api/pair', getUser, async (req, res) => {
    const { phone, sessionId } = req.body;
    const userId = req.user.id;

    if (!phone || !sessionId) {
        return res.status(400).json({ message: 'Phone number and Session ID are required.' });
    }

    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
    const sessionFolder = path.join(SESSION_DIR, safeSessionId);

    if (fs.existsSync(sessionFolder)) {
        try {
            fs.rmSync(sessionFolder, { recursive: true, force: true });
        } catch (err) {
            console.error("Failed to clean session folder:", err);
        }
    }
    fs.mkdirSync(sessionFolder, { recursive: true });

    addLog(userId, `🔄 Starting pairing process for ${phone} (ID: ${safeSessionId})...`);

    let pairingCode = null;

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: state.keys,
            },
            browser: Browsers.ubuntu('Chrome'),
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            keepAliveIntervalMs: 30_000,
            connectTimeoutMs: 60_000,
            defaultQueryTimeoutMs: 60_000,
            emitOwnEvents: false,
        });

        sock.ev.on('creds.update', saveCreds);

        let delivered = false;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const reason = lastDisconnect?.error?.message;

            if (connection === 'open') {
                if (!delivered) {
                    delivered = true;
                    addLog(userId, `✅ Connection Open! Sending Session ID...`);
                    deliverSession(sock, phone, sessionFolder, safeSessionId, userId, null)
                        .catch(err => {
                            console.error('[Delivery Error]', err);
                            addLog(userId, `❌ Delivery error: ${err.message}`);
                        });
                }
            } 
            else if (connection === 'close') {
                if (statusCode === DisconnectReason.loggedOut) {
                    addLog(userId, `❌ Logged out during pairing.`);
                } else if (statusCode !== DisconnectReason.connectionClosed) {
                     addLog(userId, `⚠️ Connection closed (Code: ${statusCode}). Reason: ${reason}`);
                }
            }
        });

        let normalizedPhone = phone.replace(/[^0-9]/g, '');
        if (normalizedPhone.length === 11 && normalizedPhone.startsWith('0')) {
            normalizedPhone = '234' + normalizedPhone.slice(1);
        }

        if (!sock.user) {
            try {
                const codePromise = sock.requestPairingCode(normalizedPhone);
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Code request timed out (20s). Try again.')), 20000)
                );
                
                pairingCode = await Promise.race([codePromise, timeoutPromise]);
                const formattedCode = pairingCode?.match(/.{1,4}/g)?.join("-") || pairingCode;
                
                addLog(userId, `📱 Code generated: ${formattedCode}`);
                
                return res.json({ 
                    success: true, 
                    code: formattedCode,
                    message: "Enter this code on your WhatsApp linked devices."
                });
            } catch (err) {
                console.error("[PAIR CODE ERROR]", err);
                return res.status(500).json({ message: err.message || "Failed to get pairing code." });
            }
        }

    } catch (error) {
        console.error(chalk.red('[FATAL PAIR ERROR]'), error);
        addLog(userId, `❌ Pairing crashed: ${error.message}`);
        if (!res.headersSent) {
            res.status(500).json({ message: "Internal Server Error during pairing." });
        }
    }
});

// ── PAIR DEVICE ───────────────────────────────────────────────────────────────
router.post('/api/pair-device', getUser, async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: 'Phone number required' });
    const n = normalisePhone(phone);
    if (n.length < 7 || n.length > 15) return res.status(400).json({ message: 'Invalid phone number' });
    const rid = uuidv4();
    pairingMap.set(rid, {
        status: 'pending', code: null, error: null, qr: null,
        phone: n, sock: null, _ts: Date.now(), _reconnect: true,
        waName: null, waNumber: null,
    });
    addLog(req.user.id, '📲 Code pairing started for +' + n);
    startPairing(rid, n, req.user.id).catch(err => addLog(req.user.id, '❌ ' + err.message));
    res.json({ success: true, requestId: rid, phone: n });
});

// ── PAIR QR ───────────────────────────────────────────────────────────────────
router.post('/api/pair-qr', getUser, async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: 'Phone number required' });
    const n = normalisePhone(phone);
    if (n.length < 7 || n.length > 15) return res.status(400).json({ message: 'Invalid phone number' });
    const rid = uuidv4();
    pairingMap.set(rid, {
        status: 'pending', code: null, error: null, qr: null,
        phone: n, sock: null, _ts: Date.now(), _reconnect: true,
        waName: null, waNumber: null,
    });
    addLog(req.user.id, '📷 QR pairing started for +' + n);
    startQRPairing(rid, n, req.user.id).catch(err => addLog(req.user.id, '❌ ' + err.message));
    res.json({ success: true, requestId: rid, phone: n });
});

// ── GET PAIR STATUS ───────────────────────────────────────────────────────────
router.get('/api/pair-status/:id', getUser, (req, res) => {
    const e = pairingMap.get(req.params.id);
    if (!e) return res.status(404).json({ error: 'Invalid or expired request' });
    res.json({
        status:      e.status,
        code:        e.code        || null,
        qr:          e.qr          || null,
        error:       e.error       || null,
        phone:       e.phone       || null,
        sessionName: e.sessionName || null,
        waName:      e.waName      || null,
        waNumber:    e.waNumber    || null,
    });
});

// ── GET SESSIONS ──────────────────────────────────────────────────────────────
router.get('/api/sessions', getUser, (req, res) => {
    try {
        const list = fs.readdirSync(SESSION_DIR)
            .filter(n => n.startsWith('oxbot_'))
            .map(n => ({
                name:     n,
                phone:    n.replace('oxbot_', ''),
                hasCreds: fs.existsSync(path.join(SESSION_DIR, n, 'creds.json')),
            }));
        res.json(list);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE SESSION ────────────────────────────────────────────────────────────
router.delete('/api/sessions/:name', getUser, (req, res) => {
    const { name } = req.params;
    if (!name.startsWith('oxbot_')) return res.status(400).json({ message: 'Invalid session name' });
    const folder = path.join(SESSION_DIR, name);
    if (!fs.existsSync(folder)) return res.status(404).json({ message: 'Not found' });
    try {
        fs.rmSync(folder, { recursive: true, force: true });
        addLog(req.user.id, '🗑️ Session deleted: ' + name);
        res.json({ message: 'Deleted' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── VALIDATE SESSION ──────────────────────────────────────────────────────────
router.post('/api/validate-session', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    if (!sessionId) return res.json({ valid: false, message: 'Session ID required' });

    const folder = path.join(SESSION_DIR, sessionId);
    patchCredsIfNeeded(folder);

    const creds  = path.join(folder, 'creds.json');
    if (!fs.existsSync(folder) || !fs.existsSync(creds))
        return res.json({ valid: false, message: 'Session not found — pair a device first.' });
    try {
        const data = JSON.parse(fs.readFileSync(creds, 'utf8'));
        if (!data.registered || !data.signedIdentityKey)
            return res.json({ valid: false, message: 'Session incomplete — re-pair the device.' });
        if (activeBots.has(sessionId))
            return res.json({ valid: true, message: 'Already active!', isActive: true });
        res.json({ valid: true, message: 'Valid and ready', isActive: false });
    } catch { res.json({ valid: false, message: 'Corrupted session file' }); }
});

// ── ACTIVATE BOT ──────────────────────────────────────────────────────────────
router.post('/api/activate-bot', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    const botName   = req.body.bot_name;
    const server    = req.body.server;

    if (!sessionId || !botName || !server)
        return res.status(400).json({ message: 'session_id, bot_name and server are required' });
    if (!['Server 1 (NG)', 'Server 2 (US)'].includes(server))
        return res.status(400).json({ message: 'server must be "Server 1 (NG)" or "Server 2 (US)"' });

    stoppedBots.delete(sessionId);

    let maxBots = 0;
    let botDurationDays = 0;
    let planLabel = 'None';

    const [proRows] = await db.query(
        `SELECT plan, expires_at FROM pro_subscriptions
         WHERE user_id=? AND status='active' AND expires_at > NOW()
         ORDER BY expires_at DESC LIMIT 1`,
        [req.user.id]
    );

    if (proRows.length > 0) {
        const sub = proRows[0];
        if (sub.plan === 'full') {
            maxBots = 8; botDurationDays = 30; planLabel = 'Best Value';
        } else if (sub.plan === 'half') {
            maxBots = 5; botDurationDays = 45; planLabel = 'Starter';
        }
    } else {
        const [userMeta] = await db.query('SELECT created_at FROM users WHERE id=?', [req.user.id]);
        if (userMeta.length > 0 && userMeta[0].created_at) {
            const regDate = new Date(userMeta[0].created_at);
            const diffDays = Math.floor((Date.now() - regDate) / (1000 * 60 * 60 * 24));

            if (diffDays <= 30) {
                maxBots = 1; botDurationDays = 3; planLabel = 'Free (' + (30 - diffDays) + ' days left)';
            }
        }
    }

    if (maxBots === 0) {
        const [expiredPro] = await db.query(
            `SELECT plan FROM pro_subscriptions
             WHERE user_id=? AND status='expired'
             ORDER BY created_at DESC LIMIT 1`,
            [req.user.id]
        );
        if (expiredPro.length > 0) {
            return res.status(403).json({
                message: 'Your Pro plan has expired. Renew your plan to add bots.',
                reason: 'pro_expired'
            });
        }
        return res.status(403).json({
            message: 'Your 1-month free trial has expired. Upgrade to a Pro plan to continue using OxBot.',
            reason: 'free_expired'
        });
    }

    const [[botCount]] = [await db.query(
        'SELECT COUNT(*) as c FROM bots WHERE user_id=? AND status="active"',
        [req.user.id]
    )];

    if (botCount[0].c >= maxBots) {
        return res.status(403).json({
            message: `You've reached the ${maxBots} bot limit for the ${planLabel} plan. Upgrade to connect more bots.`,
            reason: 'bot_limit',
            maxBots,
            currentBots: botCount[0].c,
        });
    }

    const [existing] = await db.query(
        'SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]
    );

    if (!existing.length) {
        if (req.user.balance < 20)
            return res.status(400).json({ message: 'Insufficient coins — need 20 coins to activate.' });

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + botDurationDays);

        await db.query('UPDATE users SET balance=balance-20 WHERE id=?', [req.user.id]);
        await db.query(
            'INSERT INTO bots (user_id,session_id,bot_name,server,status,expires_at) VALUES (?,?,?,?,"active",?)',
            [req.user.id, sessionId, botName, server, expiresAt]
        );
        addLog(req.user.id, `✅ Bot "${botName}" registered (${planLabel}, ${botDurationDays} days). -20 coins.`);
    } else {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + botDurationDays);
        await db.query(
            'UPDATE bots SET status="active", expires_at=? WHERE session_id=?',
            [expiresAt, sessionId]
        );
        addLog(req.user.id, `🔄 Bot "${botName}" re-activated (${planLabel}, ${botDurationDays} days).`);
    }

    activateBotSession(sessionId, req.user.id, botName, server).catch(err => {
        addLog(req.user.id, `❌ ${err.message}`);
    });

    res.json({
        success: true,
        message: 'Bot activating...',
        sessionId,
        server,
        plan: planLabel,
        durationDays: botDurationDays,
    });
});

// ── GET BOT ACTIVE STATUS ─────────────────────────────────────────────────────
router.get('/api/bot-active-status', getUser, async (req, res) => {
    const [bots] = await db.query(
        'SELECT * FROM bots WHERE user_id=? ORDER BY created_at DESC', [req.user.id]
    );
    const result = [];
    for (const b of bots) {
        const [settings] = await db.query(
            'SELECT autotyping FROM bot_settings WHERE session_id=?', [b.session_id]
        );
        const botData = activeBots.get(b.session_id);
        result.push({
            ...b,
            isActive:     !!(botData && botData.sock && botData.openedAt > 0),
            isConnecting: connectingBots.has(b.session_id),
            isStopped:    stoppedBots.has(b.session_id),
            autotyping:   settings.length ? !!settings[0].autotyping : false,
            commands:     Array.isArray(BOT_COMMANDS)
                            ? BOT_COMMANDS
                            : (BOT_COMMANDS instanceof Map
                                ? Array.from(BOT_COMMANDS.keys())
                                : Object.keys(BOT_COMMANDS)),
        });
    }
    res.json(result);
});

// ── GET CONSOLE LOGS ──────────────────────────────────────────────────────────
router.get('/api/console-logs', getUser, async (req, res) => {
    try {
        if (consoleLogs.has(req.user.id) && consoleLogs.get(req.user.id).length > 0) {
            return res.json(consoleLogs.get(req.user.id));
        }

        const [rows] = await db.query(
            'SELECT message, time FROM console_logs WHERE user_id = ? ORDER BY id DESC LIMIT 200',
            [req.user.id]
        );

        if (rows.length) {
            consoleLogs.set(req.user.id, rows);
        }

        res.json(rows);
    } catch {
        res.status(500).json([]);
    }
});

// ── GET BOT STATUS ────────────────────────────────────────────────────────────
router.get('/api/bot-status', (_req, res) => {
    res.json({
        connected:  global.botConnected,
        activeBots: activeBots.size,
        servers:    ['Server 1 (NG)', 'Server 2 (US)'],
    });
});

// ── GET HEALTH ────────────────────────────────────────────────────────────────
router.get('/api/health', (_req, res) => {
    res.json({
        ok:             true,
        uptime:         Math.floor(process.uptime()) + 's',
        activeBots:     activeBots.size,
        connectingBots: connectingBots.size,
        commands:       Array.isArray(BOT_COMMANDS)
                            ? BOT_COMMANDS
                            : (BOT_COMMANDS instanceof Map
                                ? Array.from(BOT_COMMANDS.keys())
                                : Object.keys(BOT_COMMANDS)),
    });
});

// ── GET BOT FEATURES ──────────────────────────────────────────────────────────
router.get('/api/bot-features/:sessionId', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.params.sessionId);
    const [bots] = await db.query('SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]);
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });
    try {
        const [rows] = await db.query(
            'SELECT bot_mode, antiban, autoreply, autoreply_message, autotyping, antidelete, bot_image_url FROM bot_settings WHERE session_id=?',
            [sessionId]
        );
        const isPro = await checkProPlan(req.user.id);
        res.json({
            bot_mode: 'public',
            ...(rows[0] || { antiban: 0, autoreply: 0, autoreply_message: '', autotyping: 0, antidelete: 0 }),
            is_pro: isPro
        });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── TOGGLE BOT MODE ───────────────────────────────────────────────────────────
router.post('/api/bot-features/mode', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    const enabled   = req.body.enabled;
    const mode      = enabled ? 'public' : 'private';
    const [bots] = await db.query('SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]);
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });
    await db.query(
        `INSERT INTO bot_settings (session_id, bot_mode) VALUES (?,?) ON DUPLICATE KEY UPDATE bot_mode=?`,
        [sessionId, mode, mode]
    );
    clearMode(sessionId);
    addLog(req.user.id, `⚙️ Bot Mode set to ${mode.toUpperCase()} — ${sessionId.slice(-8)}`);
    res.json({ success: true, bot_mode: mode });
});

// ── TOGGLE ANTIBAN ────────────────────────────────────────────────────────────
router.post('/api/bot-features/antiban', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    const enabled   = req.body.enabled ? 1 : 0;
    const [bots] = await db.query('SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]);
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });
    const isPro = await checkProPlan(req.user.id);
    if (!isPro) return res.status(403).json({ message: '👑 Pro plan required for Antiban.', pro_required: true });
    await db.query(
        `INSERT INTO bot_settings (session_id, antiban) VALUES (?,?) ON DUPLICATE KEY UPDATE antiban=?`,
        [sessionId, enabled, enabled]
    );
    addLog(req.user.id, `🛡️ Antiban ${enabled ? 'ON' : 'OFF'} — ${sessionId.slice(-8)}`);
    res.json({ success: true, antiban: !!enabled });
});

// ── TOGGLE AUTOREPLY ──────────────────────────────────────────────────────────
router.post('/api/bot-features/autoreply', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    const enabled   = req.body.enabled ? 1 : 0;
    const message   = (req.body.message || '').trim().slice(0, 500);
    const [bots] = await db.query('SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]);
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });
    const isPro = await checkProPlan(req.user.id);
    if (!isPro) return res.status(403).json({ message: '👑 Pro plan required for Autoreply.', pro_required: true });
    await db.query(
        `INSERT INTO bot_settings (session_id, autoreply, autoreply_message) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE autoreply=?, autoreply_message=?`,
        [sessionId, enabled, message, enabled, message]
    );
    addLog(req.user.id, `💬 Autoreply ${enabled ? 'ON' : 'OFF'} — ${sessionId.slice(-8)}`);
    res.json({ success: true, autoreply: !!enabled, autoreply_message: message });
});

// ── TOGGLE AUTOTYPING (BOT FEATURES) ──────────────────────────────────────────
router.post('/api/bot-features/autotyping', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    const enabled   = req.body.enabled ? 1 : 0;
    const [bots] = await db.query('SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]);
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });
    await db.query(
        `INSERT INTO bot_settings (session_id, autotyping) VALUES (?,?) ON DUPLICATE KEY UPDATE autotyping=?`,
        [sessionId, enabled, enabled]
    );
    addLog(req.user.id, `⌨️ Autotyping ${enabled ? 'ON' : 'OFF'} — ${sessionId.slice(-8)}`);
    res.json({ success: true, autotyping: !!enabled });
});

// ── TOGGLE ANTIDELETE ─────────────────────────────────────────────────────────
router.post('/api/bot-features/antidelete', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    const enabled   = req.body.enabled ? 1 : 0;
    const [bots] = await db.query('SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]);
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });
    await db.query(
        `INSERT INTO bot_settings (session_id, antidelete) VALUES (?,?) ON DUPLICATE KEY UPDATE antidelete=?`,
        [sessionId, enabled, enabled]
    );
    addLog(req.user.id, `🗑️ Antidelete ${enabled ? 'ON' : 'OFF'} — ${sessionId.slice(-8)}`);
    res.json({ success: true, antidelete: !!enabled });
});

// ── UPLOAD BOT IMAGE ──────────────────────────────────────────────────────────
router.post('/api/bot-features/upload-image', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    const imageData = req.body.image_data;
    const mimeType  = req.body.mime_type || 'image/jpeg';
    if (!sessionId || !imageData) return res.status(400).json({ message: 'session_id and image_data required' });
    const [bots] = await db.query('SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]);
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });
    const isPro = await checkProPlan(req.user.id);
    if (!isPro) return res.status(403).json({ message: '👑 Pro plan required to change bot image.', pro_required: true });
    try {
        const buffer = Buffer.from(imageData, 'base64');
        if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ message: 'Image too large. Max 5MB.' });
        await db.query(
            `INSERT INTO bot_images (user_id, session_id, image_data, mime_type)
             VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE image_data=?, mime_type=?, uploaded_at=NOW()`,
            [req.user.id, sessionId, buffer, mimeType, buffer, mimeType]
        );
        await db.query(
            `INSERT INTO bot_settings (session_id, bot_image_url) VALUES (?,?) ON DUPLICATE KEY UPDATE bot_image_url=?`,
            [sessionId, 'custom', 'custom']
        );
        const botData = activeBots.get(sessionId);
        if (botData?.sock && botData.openedAt > 0) {
            try {
                await botData.sock.updateProfilePicture(botData.sock.user.id, buffer);
                addLog(req.user.id, `🖼️ Bot profile picture updated for ${sessionId.slice(-8)}`);
            } catch (e) {
                addLog(req.user.id, `⚠️ Image saved but WhatsApp update failed: ${e.message}`);
            }
        }
        res.json({ success: true, message: 'Bot image updated!' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── GET BOT IMAGE ─────────────────────────────────────────────────────────────
router.get('/api/bot-features/image/:sessionId', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.params.sessionId);
    try {
        const [rows] = await db.query(
            'SELECT image_data, mime_type FROM bot_images WHERE session_id=? AND user_id=?',
            [sessionId, req.user.id]
        );
        if (!rows.length) return res.status(404).json({ message: 'No custom image' });
        res.set('Content-Type', rows[0].mime_type);
        res.send(rows[0].image_data);
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── CREATE CHANNEL ────────────────────────────────────────────────────────────
router.post('/api/create-channel', async (req, res) => {
    const { name, description } = req.body;
    const channelName = name || 'OxBot Updates';
    const channelDesc = description || 'Latest OxBot news';

    const sock = getAnySocket();
    if (!sock) return res.status(503).json({ error: 'No bot online. Start a bot first.' });

    try {
        console.log(chalk.cyan('[CHANNEL] Creating: ' + channelName));

        const result = await sock.query({
            tag: 'iq',
            attrs: {
                type: 'set',
                id: 'create_ch_' + Date.now(),
                to: 's.whatsapp.net',
                xmlns: 'w:news:1',
            },
            content: [
                {
                    tag: 'create',
                    attrs: {},
                    content: [
                        { tag: 'name', attrs: {}, content: channelName },
                        { tag: 'description', attrs: {}, content: channelDesc },
                    ]
                }
            ]
        });

        console.log(chalk.green('[CHANNEL] Response:'), JSON.stringify(result, null, 2));

        let foundJid = null;
        let foundName = null;

        function extractJid(node) {
            if (!node) return;
            if (node.attrs) {
                if (node.attrs.jid && node.attrs.jid.includes('@newsletter')) foundJid = node.attrs.jid;
                if (node.attrs.name) foundName = node.attrs.name;
            }
            if (Array.isArray(node.content)) {
                for (const child of node.content) {
                    if (typeof child === 'object') extractJid(child);
                }
            }
            if (node.content && typeof node.content === 'object' && !Array.isArray(node.content)) {
                extractJid(node.content);
            }
        }
        extractJid(result);

        if (foundJid) {
            console.log(chalk.green.bold('[CHANNEL] CREATED: ' + foundJid));
            return res.json({
                success: true,
                jid: foundJid,
                name: foundName || channelName,
                channelInfo: {
                    newsletterJid: foundJid,
                    newsletterName: foundName || channelName,
                    serverMessageId: -1,
                },
            });
        }

        res.json({ success: false, message: 'JID not found in response', raw: result });

    } catch (err) {
        console.error(chalk.red('[CHANNEL] Error:'), err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── RESOLVE CHANNEL ───────────────────────────────────────────────────────────
router.get('/api/resolve-channel', async (req, res) => {
    const sock = getAnySocket();
    if (!sock) return res.status(503).json({ error: 'No bot online' });

    try {
        console.log(chalk.cyan('[CHANNEL] Resolving invite code: 0029VbBwz6gDTkK9heWqFy1v'));
        const meta = await sock.newsletterMetadata('invite', '0029VbBwz6gDTkK9heWqFy1v');
        console.log(chalk.green('[CHANNEL] Resolved metadata:'), JSON.stringify(meta, null, 2));
        
        if (meta?.id) {
            return res.json({ success: true, jid: meta.id, name: meta.subject || meta.name || '', raw: meta });
        }
        res.json({ success: false, message: 'JID not found in metadata', raw: meta });
    } catch (err) {
        console.error(chalk.red('[CHANNEL] Resolution error:'), err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── DEBUG BOTS ────────────────────────────────────────────────────────────────
router.get('/api/debug-bots', (_req, res) => {
    const list = [];
    for (const [id, bot] of activeBots) {
        list.push({ sessionId: id, botName: bot.botName, hasSocket: !!bot.sock, openedAt: bot.openedAt, isOnline: bot.openedAt > 0 });
    }
    res.json({ totalInMap: activeBots.size, bots: list, connectingCount: connectingBots.size, globalConnected: global.botConnected });
});

module.exports = router;
