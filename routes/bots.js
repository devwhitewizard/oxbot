/**
 * @file routes/bots.js
 */

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const pino    = require('pino');
const { v4: uuidv4 } = require('uuid');
const {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeWASocket,
    DisconnectReason,
    Browsers,
} = require('@whiskeysockets/baileys');
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
    reconnectAttempts,
} = require('../oxbot/state');
const {
    addLog,
    extractSessionId,
    normalisePhone,
    patchCredsIfNeeded,
    delay,
} = require('../oxbot/utils');
const {
    activateBotSession,
    getAnySocket,
} = require('../oxbot/botManager');
const {
    startPairing,
    startQRPairing,
    deliverSession,
} = require('../oxbot/pairing');
const { getUser }                    = require('../oxbot/middleware');
const { commands: BOT_COMMANDS, clearMode } = require('../commands');

const SESSION_DIR = path.join(__dirname, '..', 'sessions');
const SITE_URL    = process.env.SITE_URL || 'http://oxbot.name.ng';

// ─────────────────────────────────────────────────────────────────────────────
// CONSOLE LOG HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clear console logs for a user from both memory and DB.
 * Called when their bot is deactivated, deleted, or goes inactive.
 */
async function clearUserLogs(userId) {
    consoleLogs.delete(userId);
    try {
        await db.query('DELETE FROM console_logs WHERE user_id = ?', [userId]);
    } catch {}
}

/**
 * Clear console logs for a specific session (bot).
 * Leaves logs from OTHER bots belonging to the same user intact.
 */
async function clearSessionLogs(userId, sessionId) {
    // rebuild in-memory log without entries mentioning this sessionId
    const existing = consoleLogs.get(userId) || [];
    const filtered = existing.filter(l =>
        !l.message?.includes(sessionId) &&
        !l.message?.includes(sessionId.slice(-8))
    );
    if (filtered.length) {
        consoleLogs.set(userId, filtered);
    } else {
        consoleLogs.delete(userId);
    }
    // DB: remove entries that reference this session
    try {
        await db.query(
            'DELETE FROM console_logs WHERE user_id = ? AND (message LIKE ? OR message LIKE ?)',
            [userId, `%${sessionId}%`, `%${sessionId.slice(-8)}%`]
        );
    } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND: auto-clear logs for bots that are no longer active
// Runs every 10 minutes. If a bot has been inactive for > 30 minutes
// AND has no reconnect in progress, its logs are cleared from DB.
// ─────────────────────────────────────────────────────────────────────────────
setInterval(async () => {
    try {
        // find all bots marked inactive in DB
        const [inactiveBots] = await db.query(
            `SELECT b.session_id, b.user_id, b.bot_name
             FROM bots b
             WHERE b.status = 'inactive'
             AND b.session_id NOT IN (
                 SELECT session_id FROM bots WHERE status = 'active'
             )`
        );

        for (const bot of inactiveBots) {
            // skip if it's currently reconnecting in memory
            if (
                activeBots.has(bot.session_id) ||
                connectingBots.has(bot.session_id) ||
                reconnectLocks.get(bot.session_id)
            ) continue;

            // clear its logs
            await clearSessionLogs(bot.user_id, bot.session_id);
        }

        // also clear logs for any user who has NO active bots at all
        const [usersWithActiveBots] = await db.query(
            `SELECT DISTINCT user_id FROM bots WHERE status = 'active'`
        );
        const activeUserIds = new Set(usersWithActiveBots.map(r => r.user_id));

        // get all userIds that have logs in memory
        for (const [userId] of consoleLogs) {
            if (!activeUserIds.has(userId) && !activeUserIds.has(String(userId))) {
                consoleLogs.delete(userId);
            }
        }

        // get all userIds in DB log table that have no active bots
        const [logUsers] = await db.query(
            `SELECT DISTINCT user_id FROM console_logs
             WHERE user_id NOT IN (
                 SELECT DISTINCT user_id FROM bots WHERE status = 'active'
             )`
        );
        for (const row of logUsers) {
            try {
                await db.query(
                    'DELETE FROM console_logs WHERE user_id = ?', [row.user_id]
                );
            } catch {}
        }

    } catch (err) {
        console.error(chalk.red('[LOG CLEANUP]'), err.message);
    }
}, 10 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
async function checkProPlan(userId) {
    const [rows] = await db.query(
        `SELECT id FROM pro_subscriptions
         WHERE user_id=? AND status='active' AND expires_at > NOW() LIMIT 1`,
        [userId]
    );
    return rows.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// START BOT
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// DEACTIVATE BOT
// ─────────────────────────────────────────────────────────────────────────────
router.post('/api/deactivate-bot', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    if (!sessionId) return res.status(400).json({ message: 'Session ID required' });

    stoppedBots.add(sessionId);
    connectingBots.delete(sessionId);
    reconnectLocks.delete(sessionId);
    reconnectAttempts.delete(sessionId);

    const bot = activeBots.get(sessionId);
    if (bot?.sock) {
        // ws.close(1000) not logout() — preserves creds so bot can restart
        try { bot.sock.ws?.close(1000, 'paused'); } catch {}
        try { bot.sock.end(); } catch {}
    }
    activeBots.delete(sessionId);
    global.botConnected = activeBots.size > 0;

    await db.query('UPDATE bots SET status="inactive" WHERE session_id=?', [sessionId]).catch(() => {});

    // ── clear this bot's logs from memory + DB ────────────────────────────────
    // check if user has OTHER active bots first
    const [otherActive] = await db.query(
        `SELECT COUNT(*) as c FROM bots
         WHERE user_id=? AND status='active' AND session_id != ?`,
        [req.user.id, sessionId]
    );
    if (otherActive[0].c === 0) {
        // no other active bots — clear all logs
        await clearUserLogs(req.user.id);
        addLog(req.user.id, `⏸️ Bot paused. No active bots — logs cleared.`);
    } else {
        // other bots still running — only clear this bot's entries
        await clearSessionLogs(req.user.id, sessionId);
        addLog(req.user.id, `⏸️ Bot paused: ${sessionId.slice(-8)}`);
    }

    console.log(chalk.yellow('[BOT] Paused by user: ' + sessionId));
    res.json({ success: true, message: 'Bot paused' });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE BOT
// ─────────────────────────────────────────────────────────────────────────────
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
        // DELETE = permanent removal, so logout is correct here
        try { await bot.sock.logout(); } catch {}
        try { bot.sock.ws?.close(); } catch {}
        try { bot.sock.end(); } catch {}
    }
    activeBots.delete(sessionId);
    global.botConnected = activeBots.size > 0;

    await db.query('DELETE FROM bots         WHERE session_id=? AND user_id=?', [sessionId, req.user.id]).catch(() => {});
    await db.query('DELETE FROM bot_settings WHERE session_id=?', [sessionId]).catch(() => {});
    await db.query('DELETE FROM seen_statuses WHERE session_id=?', [sessionId]).catch(() => {});
    await db.query('DELETE FROM bot_warnings WHERE session_id=?', [sessionId]).catch(() => {});
    await db.query('DELETE FROM bot_sudo     WHERE session_id=?', [sessionId]).catch(() => {});

    // clear logs — if no other active bots, wipe all
    const [otherActive] = await db.query(
        `SELECT COUNT(*) as c FROM bots WHERE user_id=? AND status='active'`,
        [req.user.id]
    );
    if (otherActive[0].c === 0) {
        await clearUserLogs(req.user.id);
    } else {
        await clearSessionLogs(req.user.id, sessionId);
    }

    const sessionFolder = path.join(SESSION_DIR, sessionId);
    if (fs.existsSync(sessionFolder)) {
        try {
            fs.rmSync(sessionFolder, { recursive: true, force: true });
        } catch (err) {
            addLog(req.user.id, `⚠️ Files not removed: ${err.message}`);
        }
    }

    console.log(chalk.red(`[BOT] Permanently deleted: ${sessionId}`));
    res.json({ success: true, message: 'Bot deleted permanently' });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET CONSOLE LOGS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/console-logs', getUser, async (req, res) => {
    try {
        const userId = req.user.id;

        // check if user has ANY active bots
        const [activeBotRows] = await db.query(
            `SELECT session_id FROM bots WHERE user_id=? AND status='active' LIMIT 1`,
            [userId]
        );

        if (!activeBotRows.length) {
            // no active bots — clear and return empty
            await clearUserLogs(userId);
            return res.json([]);
        }

        // return from memory if available
        if (consoleLogs.has(userId) && consoleLogs.get(userId).length > 0) {
            return res.json(consoleLogs.get(userId));
        }

        // load from DB
        const [rows] = await db.query(
            'SELECT message, time FROM console_logs WHERE user_id=? ORDER BY id DESC LIMIT 200',
            [userId]
        );

        if (rows.length) {
            consoleLogs.set(userId, rows);
        }

        res.json(rows);
    } catch {
        res.status(500).json([]);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// CLEAR CONSOLE LOGS (manual endpoint)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/api/clear-logs', getUser, async (req, res) => {
    try {
        await clearUserLogs(req.user.id);
        res.json({ success: true, message: 'Logs cleared' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET BOT SETTINGS
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE AUTOTYPING
// ─────────────────────────────────────────────────────────────────────────────
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
             VALUES (?,?) ON DUPLICATE KEY UPDATE autotyping=?`,
            [sessionId, val, val]
        );
        addLog(req.user.id, `⚙️ Auto-typing ${enabled ? 'ON' : 'OFF'} for "${bots[0].bot_name}"`);
        res.json({ success: true, session_id: sessionId, autotyping: enabled });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PAIR (ULTIMATE VERSION)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/api/pair', getUser, async (req, res) => {
    const { phone, sessionId } = req.body;
    const userId = req.user.id;

    if (!phone || !sessionId)
        return res.status(400).json({ message: 'Phone number and Session ID are required.' });

    const safeSessionId  = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
    const sessionFolder  = path.join(SESSION_DIR, safeSessionId);

    if (fs.existsSync(sessionFolder)) {
        try { fs.rmSync(sessionFolder, { recursive: true, force: true }); } catch {}
    }
    fs.mkdirSync(sessionFolder, { recursive: true });

    addLog(userId, `🔄 Starting pairing for ${phone} (${safeSessionId})…`);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
        const { version }          = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger:               pino({ level: 'silent' }),
            printQRInTerminal:    false,
            auth:                 { creds: state.creds, keys: state.keys },
            browser:              Browsers.ubuntu('Chrome'),
            markOnlineOnConnect:  false,
            generateHighQualityLinkPreview: false,
            keepAliveIntervalMs:  30_000,
            connectTimeoutMs:     60_000,
            defaultQueryTimeoutMs: 60_000,
            emitOwnEvents:        false,
        });

        sock.ev.on('creds.update', saveCreds);

        let delivered = false;
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (connection === 'open') {
                if (!delivered) {
                    delivered = true;
                    addLog(userId, `✅ Connection open — sending session ID…`);
                    deliverSession(sock, phone, sessionFolder, safeSessionId, userId, null)
                        .catch(err => addLog(userId, `❌ Delivery error: ${err.message}`));
                }
            } else if (connection === 'close') {
                if (statusCode !== DisconnectReason.connectionClosed)
                    addLog(userId, `⚠️ Connection closed (code: ${statusCode})`);
            }
        });

        let normalizedPhone = phone.replace(/[^0-9]/g, '');
        if (normalizedPhone.length === 11 && normalizedPhone.startsWith('0'))
            normalizedPhone = '234' + normalizedPhone.slice(1);

        if (!sock.user) {
            const codePromise    = sock.requestPairingCode(normalizedPhone);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Code request timed out (20s). Try again.')), 20000)
            );
            const pairingCode     = await Promise.race([codePromise, timeoutPromise]);
            const formattedCode   = pairingCode?.match(/.{1,4}/g)?.join('-') || pairingCode;
            addLog(userId, `📱 Code generated: ${formattedCode}`);
            return res.json({
                success: true,
                code:    formattedCode,
                message: 'Enter this code on your WhatsApp linked devices.',
            });
        }

    } catch (error) {
        console.error(chalk.red('[FATAL PAIR ERROR]'), error);
        addLog(userId, `❌ Pairing crashed: ${error.message}`);
        if (!res.headersSent)
            res.status(500).json({ message: 'Internal Server Error during pairing.' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PAIR DEVICE
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// PAIR QR
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// GET PAIR STATUS
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// GET SESSIONS
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// DELETE SESSION
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATE SESSION
// ─────────────────────────────────────────────────────────────────────────────
router.post('/api/validate-session', getUser, async (req, res) => {
    const rawInput  = (req.body.session_id || '').trim();
    const sessionId = extractSessionId(rawInput);
    if (!sessionId) return res.json({ valid: false, message: 'Session ID required' });

    const folder = path.join(SESSION_DIR, sessionId);
    const creds  = path.join(folder, 'creds.json');

    if (!fs.existsSync(creds)) {
        let restored = false;

        if (rawInput.includes('::::')) {
            try {
                const b64Part   = rawInput.split('::::')[1];
                const credsJson = Buffer.from(b64Part, 'base64').toString('utf8');
                const parsed    = JSON.parse(credsJson);
                if (parsed && (parsed.noiseKey || parsed.signedIdentityKey || parsed.me)) {
                    fs.mkdirSync(folder, { recursive: true });
                    fs.writeFileSync(creds, credsJson, 'utf8');
                    restored = true;
                    addLog(req.user.id, `🔄 Session restored from pasted string: ${sessionId}`);
                }
            } catch {}
        }

        if (!restored) {
            try {
                const [rows] = await db.query(
                    'SELECT session_data FROM paired_sessions WHERE session_id=? AND user_id=? LIMIT 1',
                    [sessionId, req.user.id]
                );
                if (rows.length && rows[0].session_data) {
                    const b64Part   = rows[0].session_data.includes('::::')
                        ? rows[0].session_data.split('::::')[1]
                        : rows[0].session_data;
                    const credsJson = Buffer.from(b64Part, 'base64').toString('utf8');
                    const parsed    = JSON.parse(credsJson);
                    if (parsed && (parsed.noiseKey || parsed.signedIdentityKey || parsed.me)) {
                        fs.mkdirSync(folder, { recursive: true });
                        fs.writeFileSync(creds, credsJson, 'utf8');
                        restored = true;
                        addLog(req.user.id, `🔄 Session restored from DB: ${sessionId}`);
                    }
                }
            } catch {}
        }

        if (!restored)
            return res.json({ valid: false, message: 'Session not found — pair a device first.' });
    }

    patchCredsIfNeeded(folder);

    try {
        const data = JSON.parse(fs.readFileSync(creds, 'utf8'));
        if (!data.noiseKey && !data.signedIdentityKey && !data.me && !data.registered)
            return res.json({ valid: false, message: 'Session incomplete — re-pair the device.' });
        if (activeBots.has(sessionId))
            return res.json({ valid: true, message: 'Already active!', isActive: true });
        res.json({ valid: true, message: 'Valid and ready', isActive: false });
    } catch {
        res.json({ valid: false, message: 'Corrupted session file' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATE BOT
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATE BOT
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATE BOT
// ─────────────────────────────────────────────────────────────────────────────
router.post('/api/activate-bot', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    const botName   = req.body.bot_name;
    const server    = req.body.server;

    if (!sessionId || !botName || !server)
        return res.status(400).json({ message: 'session_id, bot_name and server are required' });
    if (!['Server 1 (NG)', 'Server 2 (US)'].includes(server))
        return res.status(400).json({ message: 'server must be "Server 1 (NG)" or "Server 2 (US)"' });

    stoppedBots.delete(sessionId);

    let maxBots         = 0;
    let botDurationDays = 0;
    let planLabel       = 'None';

    // ── CHECK PRO SUBSCRIPTION FIRST ─────────────────────────────────────────
    const [proRows] = await db.query(
        `SELECT plan, expires_at FROM pro_subscriptions
         WHERE user_id=? AND status='active' AND expires_at > NOW()
         ORDER BY expires_at DESC LIMIT 1`,
        [req.user.id]
    );

    if (proRows.length > 0) {
        const sub = proRows[0];
        if (sub.plan === 'full')      { maxBots = 8; botDurationDays = 30; planLabel = 'Best Value'; }
        else if (sub.plan === 'half') { maxBots = 5; botDurationDays = 30; planLabel = 'Starter'; }
    } else {
        // ── FREE PLAN: ALWAYS AVAILABLE, 1 BOT, 7 DAYS ──────────────────────
        maxBots         = 1;
        botDurationDays = 7;
        planLabel       = 'Free';
    }

    // ── CHECK BOT LIMIT ──────────────────────────────────────────────────────
    const [[botCount]] = [await db.query(
        'SELECT COUNT(*) as c FROM bots WHERE user_id=? AND status="active"', [req.user.id]
    )];

    if (botCount[0].c >= maxBots) {
        return res.status(403).json({
            message:     `You've reached the ${maxBots} bot limit for the ${planLabel} plan.`,
            reason:      'bot_limit',
            maxBots,
            currentBots: botCount[0].c,
        });
    }

    // ── CHECK IF BOT ALREADY EXISTS ──────────────────────────────────────────
    const [existing] = await db.query(
        'SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]
    );

    if (!existing.length) {
        // ✅ NEW BOT: 20 COINS REQUIRED
        if (req.user.balance < 20)
            return res.status(400).json({ message: 'Insufficient coins — need 20 coins to activate.' });

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + botDurationDays);

        await db.query('UPDATE users SET balance=balance-20 WHERE id=?', [req.user.id]);
        await db.query(
            'INSERT INTO bots (user_id,session_id,bot_name,server,status,expires_at) VALUES (?,?,?,?,"active",?)',
            [req.user.id, sessionId, botName, server, expiresAt]
        );
        addLog(req.user.id, `✅ Bot "${botName}" registered (${planLabel}, ${botDurationDays}d). -20 coins.`);
    } else {
        // ✅ RE-ACTIVATING EXISTING BOT: 20 COINS TO RENEW
        if (req.user.balance < 20)
            return res.status(400).json({ message: 'Insufficient coins — need 20 coins to renew.' });

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + botDurationDays);

        await db.query('UPDATE users SET balance=balance-20 WHERE id=?', [req.user.id]);
        await db.query(
            'UPDATE bots SET status="active", expires_at=? WHERE session_id=?',
            [expiresAt, sessionId]
        );
        addLog(req.user.id, `🔄 Bot "${botName}" renewed (${planLabel}, +${botDurationDays}d). -20 coins.`);
    }

    activateBotSession(sessionId, req.user.id, botName, server).catch(err => {
        addLog(req.user.id, `❌ ${err.message}`);
    });

    res.json({
        success:      true,
        message:      'Bot activating…',
        sessionId,
        server,
        plan:         planLabel,
        durationDays: botDurationDays,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-RENEW: Checks every 1 hour for expiring bots on FREE plan
// If user has 20+ coins, auto-deduct and extend by 7 days
// ─────────────────────────────────────────────────────────────────────────────
setInterval(async () => {
    try {
        // Find bots that expire within 24 hours (or already expired) on FREE plan
        const [expiringBots] = await db.query(
            `SELECT b.id, b.user_id, b.session_id, b.bot_name, b.expires_at, u.balance
             FROM bots b
             JOIN users u ON u.id = b.user_id
             WHERE b.status = 'active'
             AND b.expires_at <= DATE_ADD(NOW(), INTERVAL 24 HOUR)
             AND b.user_id NOT IN (
                 SELECT user_id FROM pro_subscriptions
                 WHERE status='active' AND expires_at > NOW()
             )`
        );

        for (const bot of expiringBots) {
            // Skip if user doesn't have enough coins
            if (bot.balance < 20) {
                addLog(bot.user_id, `⚠️ Bot "${bot.bot_name}" expires soon. Add 20 coins to auto-renew.`);
                continue;
            }

            // Auto-renew: deduct 20 coins, extend by 7 days
            const newExpiry = new Date();
            newExpiry.setDate(newExpiry.getDate() + 7);

            await db.query('UPDATE users SET balance=balance-20 WHERE id=?', [bot.user_id]);
            await db.query(
                'UPDATE bots SET expires_at=? WHERE id=?',
                [newExpiry, bot.id]
            );

            addLog(bot.user_id, `🔄 Auto-renewed "${bot.bot_name}" (+7 days). -20 coins. Balance: ${bot.balance - 20}`);
            console.log(chalk.green(`[AUTO-RENEW] ${bot.bot_name} for user ${bot.user_id}`));
        }

        // ── DEACTIVATE BOTS THAT EXPIRED AND USER HAS NO COINS ───────────────
        const [expiredBots] = await db.query(
            `SELECT b.id, b.user_id, b.session_id, b.bot_name
             FROM bots b
             WHERE b.status = 'active'
             AND b.expires_at < NOW()
             AND b.user_id NOT IN (
                 SELECT user_id FROM pro_subscriptions
                 WHERE status='active' AND expires_at > NOW()
             )`
        );

        for (const bot of expiredBots) {
            // Deactivate the bot
            stoppedBots.add(bot.session_id);
            const botData = activeBots.get(bot.session_id);
            if (botData?.sock) {
                try { botData.sock.ws?.close(1000, 'expired'); } catch {}
                try { botData.sock.end(); } catch {}
            }
            activeBots.delete(bot.session_id);
            global.botConnected = activeBots.size > 0;

            await db.query('UPDATE bots SET status="inactive" WHERE id=?', [bot.id]);
            await clearSessionLogs(bot.user_id, bot.session_id);
            addLog(bot.user_id, `⏰ Bot "${bot.bot_name}" expired. Add 20 coins to reactivate.`);
            console.log(chalk.yellow(`[EXPIRED] ${bot.bot_name} for user ${bot.user_id}`));
        }

    } catch (err) {
        console.error(chalk.red('[AUTO-RENEW ERROR]'), err.message);
    }
}, 60 * 60 * 1000); // Run every 1 hour
// ─────────────────────────────────────────────────────────────────────────────
// GET BOT ACTIVE STATUS
// ─────────────────────────────────────────────────────────────────────────────
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
            commands:     BOT_COMMANDS instanceof Map
                ? Array.from(BOT_COMMANDS.keys())
                : Array.isArray(BOT_COMMANDS)
                    ? BOT_COMMANDS
                    : Object.keys(BOT_COMMANDS),
        });
    }
    res.json(result);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET BOT STATUS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/bot-status', (_req, res) => {
    res.json({
        connected:  global.botConnected,
        activeBots: activeBots.size,
        servers:    ['Server 1 (NG)', 'Server 2 (US)'],
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET HEALTH
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/health', (_req, res) => {
    res.json({
        ok:             true,
        uptime:         Math.floor(process.uptime()) + 's',
        activeBots:     activeBots.size,
        connectingBots: connectingBots.size,
        commands:       BOT_COMMANDS instanceof Map
            ? Array.from(BOT_COMMANDS.keys())
            : Array.isArray(BOT_COMMANDS)
                ? BOT_COMMANDS
                : Object.keys(BOT_COMMANDS),
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET BOT FEATURES
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/bot-features/:sessionId', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.params.sessionId);
    const [bots]    = await db.query('SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]);
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
            is_pro: isPro,
        });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// TOGGLE BOT MODE
// ─────────────────────────────────────────────────────────────────────────────
router.post('/api/bot-features/mode', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    const mode      = req.body.enabled ? 'public' : 'private';
    const [bots]    = await db.query('SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]);
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });
    await db.query(
        `INSERT INTO bot_settings (session_id, bot_mode) VALUES (?,?) ON DUPLICATE KEY UPDATE bot_mode=?`,
        [sessionId, mode, mode]
    );
    clearMode(sessionId);
    addLog(req.user.id, `⚙️ Bot Mode → ${mode.toUpperCase()} (${sessionId.slice(-8)})`);
    res.json({ success: true, bot_mode: mode });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOGGLE ANTIBAN
// ─────────────────────────────────────────────────────────────────────────────
router.post('/api/bot-features/antiban', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    const enabled   = req.body.enabled ? 1 : 0;
    const [bots]    = await db.query('SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]);
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });
    const isPro = await checkProPlan(req.user.id);
    if (!isPro) return res.status(403).json({ message: '👑 Pro plan required for Antiban.', pro_required: true });
    await db.query(
        `INSERT INTO bot_settings (session_id, antiban) VALUES (?,?) ON DUPLICATE KEY UPDATE antiban=?`,
        [sessionId, enabled, enabled]
    );
    addLog(req.user.id, `🛡️ Antiban ${enabled ? 'ON' : 'OFF'} (${sessionId.slice(-8)})`);
    res.json({ success: true, antiban: !!enabled });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOGGLE AUTOREPLY
// ─────────────────────────────────────────────────────────────────────────────
router.post('/api/bot-features/autoreply', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    const enabled   = req.body.enabled ? 1 : 0;
    const message   = (req.body.message || '').trim().slice(0, 500);
    const [bots]    = await db.query('SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]);
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });
    const isPro = await checkProPlan(req.user.id);
    if (!isPro) return res.status(403).json({ message: '👑 Pro plan required for Autoreply.', pro_required: true });
    await db.query(
        `INSERT INTO bot_settings (session_id, autoreply, autoreply_message) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE autoreply=?, autoreply_message=?`,
        [sessionId, enabled, message, enabled, message]
    );
    addLog(req.user.id, `💬 Autoreply ${enabled ? 'ON' : 'OFF'} (${sessionId.slice(-8)})`);
    res.json({ success: true, autoreply: !!enabled, autoreply_message: message });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOGGLE AUTOTYPING (BOT FEATURES)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/api/bot-features/autotyping', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    const enabled   = req.body.enabled ? 1 : 0;
    const [bots]    = await db.query('SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]);
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });
    await db.query(
        `INSERT INTO bot_settings (session_id, autotyping) VALUES (?,?) ON DUPLICATE KEY UPDATE autotyping=?`,
        [sessionId, enabled, enabled]
    );
    addLog(req.user.id, `⌨️ Autotyping ${enabled ? 'ON' : 'OFF'} (${sessionId.slice(-8)})`);
    res.json({ success: true, autotyping: !!enabled });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOGGLE ANTIDELETE
// ─────────────────────────────────────────────────────────────────────────────
router.post('/api/bot-features/antidelete', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    const enabled   = req.body.enabled ? 1 : 0;
    const [bots]    = await db.query('SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]);
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });
    await db.query(
        `INSERT INTO bot_settings (session_id, antidelete) VALUES (?,?) ON DUPLICATE KEY UPDATE antidelete=?`,
        [sessionId, enabled, enabled]
    );
    addLog(req.user.id, `🗑️ Antidelete ${enabled ? 'ON' : 'OFF'} (${sessionId.slice(-8)})`);
    res.json({ success: true, antidelete: !!enabled });
});

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD BOT IMAGE
// ─────────────────────────────────────────────────────────────────────────────
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
                addLog(req.user.id, `🖼️ Profile picture updated (${sessionId.slice(-8)})`);
            } catch (e) {
                addLog(req.user.id, `⚠️ Image saved but WA update failed: ${e.message}`);
            }
        }
        res.json({ success: true, message: 'Bot image updated!' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET BOT IMAGE
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// CREATE CHANNEL
// ─────────────────────────────────────────────────────────────────────────────
router.post('/api/create-channel', async (req, res) => {
    const { name, description } = req.body;
    const channelName = name || 'OxBot Updates';
    const channelDesc = description || 'Latest OxBot news';
    const sock = getAnySocket();
    if (!sock) return res.status(503).json({ error: 'No bot online. Start a bot first.' });
    try {
        const result = await sock.query({
            tag: 'iq',
            attrs: { type: 'set', id: 'create_ch_' + Date.now(), to: 's.whatsapp.net', xmlns: 'w:news:1' },
            content: [{
                tag: 'create', attrs: {},
                content: [
                    { tag: 'name',        attrs: {}, content: channelName },
                    { tag: 'description', attrs: {}, content: channelDesc },
                ],
            }],
        });

        let foundJid = null, foundName = null;
        function extractJid(node) {
            if (!node) return;
            if (node.attrs) {
                if (node.attrs.jid?.includes('@newsletter')) foundJid = node.attrs.jid;
                if (node.attrs.name) foundName = node.attrs.name;
            }
            if (Array.isArray(node.content))
                for (const child of node.content) if (typeof child === 'object') extractJid(child);
            if (node.content && typeof node.content === 'object' && !Array.isArray(node.content))
                extractJid(node.content);
        }
        extractJid(result);

        if (foundJid)
            return res.json({ success: true, jid: foundJid, name: foundName || channelName,
                channelInfo: { newsletterJid: foundJid, newsletterName: foundName || channelName, serverMessageId: -1 } });

        res.json({ success: false, message: 'JID not found in response', raw: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVE CHANNEL
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/resolve-channel', async (req, res) => {
    const sock = getAnySocket();
    if (!sock) return res.status(503).json({ error: 'No bot online' });
    try {
        const meta = await sock.newsletterMetadata('invite', '0029VbBwz6gDTkK9heWqFy1v');
        if (meta?.id)
            return res.json({ success: true, jid: meta.id, name: meta.subject || meta.name || '', raw: meta });
        res.json({ success: false, message: 'JID not found', raw: meta });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// DEBUG BOTS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/api/debug-bots', (_req, res) => {
    const list = [];
    for (const [id, bot] of activeBots) {
        list.push({
            sessionId: id,
            botName:   bot.botName,
            hasSocket: !!bot.sock,
            openedAt:  bot.openedAt,
            isOnline:  bot.openedAt > 0,
        });
    }
    res.json({
        totalInMap:     activeBots.size,
        bots:           list,
        connectingCount: connectingBots.size,
        globalConnected: global.botConnected,
    });
});

module.exports = router;