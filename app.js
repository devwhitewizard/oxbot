/**
 * OxBot — app.js
 * ★ CONNECT ONCE — STAY CONNECTED
 * ★ Email verification required before login
 * ★ Referral reward deferred until referred user verifies email
 * ★ No self-messages / no spam detection
 * ★ Baileys native keep-alive (no custom watchdog)
 * ★ Gen counter prevents stale reconnect loops
 * ★ Per-session auto-typing in SQL
 * ★ Per-session seen statuses in SQL
 * ★ 440 Ghost Conflict fix
 * ★ Pairing code flow fixed (wipe creds + single request guard)
 * ★ Session delivered as plain text (no backtick wrapping)
 */

// ── Temp dir fix for cPanel / CloudLinux ─────────────────────────────────────
const fs   = require('fs');
const path = require('path');

const customTemp = path.join(process.cwd(), 'temp');
if (!fs.existsSync(customTemp)) fs.mkdirSync(customTemp, { recursive: true });
process.env.TMPDIR = customTemp;
process.env.TEMP   = customTemp;
process.env.TMP    = customTemp;

// Clean temp files older than 3 hours
setInterval(() => {
    try {
        for (const file of fs.readdirSync(customTemp)) {
            const fp = path.join(customTemp, file);
            try {
                if (Date.now() - fs.statSync(fp).mtimeMs > 3 * 60 * 60 * 1000)
                    fs.unlinkSync(fp);
            } catch {}
        }
    } catch {}
}, 3 * 60 * 60 * 1000);

// ── Core imports ──────────────────────────────────────────────────────────────
const express    = require('express');
const mysql      = require('mysql2/promise');
const bcrypt     = require('bcryptjs');
const cors       = require('cors');
const chalk      = require('chalk');
const NodeCache  = require('node-cache');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
    makeCacheableSignalKeyStore,
    delay,
} = require('@whiskeysockets/baileys');
const pino = require('pino');

// ── Command imports ───────────────────────────────────────────────────────────
const {
    commands: BOT_COMMANDS,
    handleIncomingMessage,
    antideleteRevocation,
} = require('./commands');
// ── Paths & constants ─────────────────────────────────────────────────────────
const PORT        = process.env.PORT || 3000;
const SESSION_DIR = path.join(__dirname, 'sessions');
const PUBLIC_DIR  = path.join(__dirname, 'public');
[SESSION_DIR, PUBLIC_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));



// ── Site base URL (used in verification emails) ───────────────────────────────
const SITE_URL = process.env.SITE_URL || 'http://oxbot.name.ng';

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ── Database pool ─────────────────────────────────────────────────────────────
const db = mysql.createPool({
    host:             'localhost',
    user:             'zestpayn_dominion',
    password:         'Dorc@s12345#',
    database:         'zestpayn_nodeapp9',
    waitForConnections: true,
    connectionLimit:  10,
    queueLimit:       0,
});

const mailer = nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   465,
    secure: true,
    auth: {
        user: 'oxbot18@gmail.com',
        pass: 'tfyr tuta igvg uqlb',
    },
});

// Verify mailer on startup
mailer.verify((err) => {
    if (err) console.error(chalk.red('❌ Mailer error:'), err.message);
    else     console.log(chalk.green('✅ Mailer ready → noreply@oxbot.name.ng'));
});

/**
 * Send a verification email to the newly registered user.
 * @param {string} toEmail
 * @param {string} name
 * @param {string} token
 */
async function sendVerificationEmail(toEmail, name, token) {
    const link = `${SITE_URL}/verify-email?token=${token}`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Verify your OxBot email</title>
  <style>
    body{margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif}
    .wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .header{background:#16a34a;padding:32px 40px;text-align:center}
    .header h1{color:#fff;margin:0;font-size:26px;font-weight:800;letter-spacing:-.5px}
    .header p{color:rgba(255,255,255,.8);margin:6px 0 0;font-size:14px}
    .body{padding:36px 40px}
    .body h2{margin:0 0 12px;font-size:20px;color:#0f172a}
    .body p{color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px}
    .btn{display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:700;font-size:16px;letter-spacing:.2px}
    .btn:hover{background:#15803d}
    .notice{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 18px;margin-top:24px;font-size:13px;color:#64748b;line-height:1.5}
    .footer{padding:20px 40px;text-align:center;font-size:12px;color:#94a3b8;border-top:1px solid #f1f5f9}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>🤖 OxBot</h1>
      <p>WhatsApp Bot Platform</p>
    </div>
    <div class="body">
      <h2>Hi ${name}, confirm your email 👋</h2>
      <p>Thanks for signing up! Click the button below to verify your email address and activate your OxBot account.</p>
      <p style="text-align:center"><a href="${link}" class="btn">✅ Verify My Email</a></p>
      <div class="notice">
        <strong>This link expires in 24 hours.</strong><br>
        If you didn't create an account on OxBot, you can safely ignore this email.
      </div>
    </div>
    <div class="footer">© ${new Date().getFullYear()} OxBot · <a href="${SITE_URL}" style="color:#16a34a;text-decoration:none">${SITE_URL.replace(/^https?:\/\//, '')}</a></div>
  </div>
</body>
</html>`;

    await mailer.sendMail({
        from:    '"OxBot" <noreply@oxbot.name.ng>',
        to:      toEmail,
        subject: '✅ Verify your OxBot account',
        html,
        text: `Hi ${name},\n\nVerify your OxBot account by clicking this link:\n${link}\n\nThis link expires in 24 hours.\n\nIf you didn't sign up, ignore this email.`,
    });
}

// ── DB init ───────────────────────────────────────────────────────────────────
(async () => {
    try {
        const c = await db.getConnection();
        console.log(chalk.green('✅ Database connected'));
        c.release();

        await db.query(`CREATE TABLE IF NOT EXISTS users (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            name             VARCHAR(100) NOT NULL,
            username         VARCHAR(50)  NOT NULL UNIQUE,
            email            VARCHAR(100) NOT NULL UNIQUE,
            phone            VARCHAR(20)  NOT NULL,
            password         VARCHAR(255) NOT NULL,
            balance          INT          NOT NULL DEFAULT 0,
            referral_code    VARCHAR(20)  NOT NULL UNIQUE,
            email_verified   TINYINT(1)   NOT NULL DEFAULT 0,
            verify_token     VARCHAR(64)  DEFAULT NULL,
            verify_token_exp DATETIME     DEFAULT NULL,
            created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
        )`);
await db.query(`CREATE TABLE IF NOT EXISTS console_logs (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT          NOT NULL,
    message    TEXT         NOT NULL,
    time       VARCHAR(20)  NOT NULL,
    created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id)
)`);

console.log(chalk.green('✅ All tables ready'));

        // Migrate existing users table if columns are missing
        const [cols] = await db.query(`SHOW COLUMNS FROM users`);
        const colNames = cols.map(c => c.Field);
        if (!colNames.includes('email_verified'))
            await db.query(`ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0`);
        if (!colNames.includes('verify_token'))
            await db.query(`ALTER TABLE users ADD COLUMN verify_token VARCHAR(64) DEFAULT NULL`);
            
                   await db.query(`CREATE TABLE IF NOT EXISTS pro_subscriptions (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            user_id     INT             NOT NULL,
            plan        ENUM('half','full') NOT NULL,
            status      ENUM('pending','active','expired','cancelled') DEFAULT 'pending',
            amount      DECIMAL(10,2)   NOT NULL,
            naira       INT             NOT NULL,
            reference   VARCHAR(100)    NOT NULL UNIQUE,
            started_at  DATETIME        DEFAULT NULL,
            expires_at  DATETIME        DEFAULT NULL,
            created_at  TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_user (user_id),
            INDEX idx_status (status)
        )`);

// ── Paired Sessions Table (tracks all pairings for admin visibility) ──
await db.query(`CREATE TABLE IF NOT EXISTS paired_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    session_id VARCHAR(255) NOT NULL UNIQUE,
    session_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    whatsapp_name VARCHAR(100) DEFAULT NULL,
    whatsapp_number VARCHAR(20) DEFAULT NULL,
    paired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('paired','activated','deleted') DEFAULT 'paired',
    INDEX idx_user (user_id),
    INDEX idx_session (session_id),
    INDEX idx_status (status)
)`);

// Migrate if table exists but missing columns
try {
    const [pairedCols] = await db.query(`SHOW COLUMNS FROM paired_sessions`);
    const pairedColNames = pairedCols.map(c => c.Field);
    if (!pairedColNames.includes('whatsapp_name'))
        await db.query(`ALTER TABLE paired_sessions ADD COLUMN whatsapp_name VARCHAR(100) DEFAULT NULL`);
    if (!pairedColNames.includes('whatsapp_number'))
        await db.query(`ALTER TABLE paired_sessions ADD COLUMN whatsapp_number VARCHAR(20) DEFAULT NULL`);
} catch {}

console.log(chalk.green('✅ All tables ready'));
        
            // Add this after the existing column migration checks in the DB init section
            
if (!colNames.includes('reset_code'))
    await db.query(`ALTER TABLE users ADD COLUMN reset_code VARCHAR(6) DEFAULT NULL`);
if (!colNames.includes('reset_code_exp'))
    await db.query(`ALTER TABLE users ADD COLUMN reset_code_exp DATETIME DEFAULT NULL`);

        if (!colNames.includes('verify_token_exp'))
            await db.query(`ALTER TABLE users ADD COLUMN verify_token_exp DATETIME DEFAULT NULL`);

        await db.query(`CREATE TABLE IF NOT EXISTS referrals (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            referrer_id  INT NOT NULL,
            referred_id  INT NOT NULL,
            reward_given TINYINT(1) DEFAULT 0,
            created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS bots (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            user_id       INT          NOT NULL,
            session_id    VARCHAR(255) NOT NULL UNIQUE,
            bot_name      VARCHAR(100) NOT NULL,
            server        VARCHAR(50)  NOT NULL,
            status        ENUM('active','inactive') DEFAULT 'active',
            whatsapp_name VARCHAR(100) DEFAULT NULL,
            expires_at    DATETIME,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        // Replace your deposits CREATE TABLE with this:
await db.query(`CREATE TABLE IF NOT EXISTS deposits (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT            NOT NULL,
    amount     DECIMAL(10,2)  NOT NULL,
    coins      INT            NOT NULL,
    reference  VARCHAR(100)   NOT NULL UNIQUE,
    status     ENUM('pending','confirmed','rejected') DEFAULT 'pending',
    paid_at    DATETIME       DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

        await db.query(`CREATE TABLE IF NOT EXISTS bot_settings (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            session_id VARCHAR(255) NOT NULL UNIQUE,
            autotyping TINYINT(1)  DEFAULT 0,
            created_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`);

        await db.query(`CREATE TABLE IF NOT EXISTS seen_statuses (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            session_id VARCHAR(255) NOT NULL,
            status_id  VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY unique_status (session_id, status_id)
        )`);

        console.log(chalk.green('✅ All tables ready'));
    } catch (err) {
        console.error(chalk.red('❌ DB Error:'), err.message);
    }
})();

// ── In-memory stores ──────────────────────────────────────────────────────────
const consoleLogs    = new Map();
const pairingMap     = new Map();
const activeSocks    = new Map();
const activeBots     = new Map();
const stoppedBots    = new Set();
const connectingBots = new Set();
const lastReply      = new Map();

const reconnectLocks    = new Map();
const reconnectAttempts = new Map();

global.botConnected = false;

setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [jid, ts] of lastReply) if (ts < cutoff) lastReply.delete(jid);
}, 60 * 60 * 1000);

setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, s] of pairingMap) {
        if (s._ts && s._ts < cutoff) {
            if (s.sock) try { s.sock.end(); } catch {}
            pairingMap.delete(id);
        }
    }
}, 5 * 60 * 1000);

// ── Utility helpers ───────────────────────────────────────────────────────────

function addLog(userId, msg) {
    // Keep in-memory for speed
    if (!consoleLogs.has(userId)) consoleLogs.set(userId, []);
    const arr = consoleLogs.get(userId);
    const entry = { time: new Date().toLocaleTimeString(), message: msg };
    arr.unshift(entry);
    if (arr.length > 200) arr.pop();

    // Also persist to DB (fire and forget)
    db.query(
        'INSERT INTO console_logs (user_id, message, time) VALUES (?, ?, ?)',
        [userId, msg, entry.time]
    ).catch(() => {});

    // Keep only last 200 rows per user in DB
    db.query(
        `DELETE FROM console_logs WHERE user_id = ? AND id NOT IN (
            SELECT id FROM (
                SELECT id FROM console_logs WHERE user_id = ? ORDER BY id DESC LIMIT 200
            ) t
        )`,
        [userId, userId]
    ).catch(() => {});
}
const getUser = async (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token?.startsWith('mock-token-'))
        return res.status(401).json({ message: 'Unauthorized' });
    const userId = token.replace('mock-token-', '');
    try {
        const [rows] = await db.query(
            'SELECT id,name,username,email,phone,balance,referral_code,blocked FROM users WHERE id=?',
            [userId]
        );
        if (!rows.length) return res.status(401).json({ message: 'User not found' });
        if (rows[0].blocked) return res.status(403).json({ message: 'Account suspended.', blocked: true });
        req.user = rows[0];
        next();
    } catch { res.status(500).json({ message: 'Auth error' }); }
};

function extractSessionId(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    return s.includes('::::') ? s.split('::::')[0].trim() : s;
}

function normalisePhone(raw) {
    let p = String(raw).replace(/[^0-9]/g, '').trim();
    if (p.length === 11 && p.startsWith('0')) p = '234' + p.slice(1);
    if (p.length === 10 && !p.startsWith('234')) p = '234' + p;
    return p;
}

function patchCredsIfNeeded(sessionFolder) {
    const cp = path.join(sessionFolder, 'creds.json');
    if (!fs.existsSync(cp)) return;
    try {
        const creds = JSON.parse(fs.readFileSync(cp, 'utf8'));
        if (!creds.registered && creds.account && creds.me) {
            creds.registered = true;
            fs.writeFileSync(cp, JSON.stringify(creds, null, 2));
        }
    } catch {}
}

async function deliverSession(sock, phone, sessionFolder, sessionName, userId) {
    try {
        const waNumber  = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : phone;
        const credsPath = path.join(sessionFolder, 'creds.json');

        for (let i = 0; i < 40; i++) {
            if (fs.existsSync(credsPath) && fs.statSync(credsPath).size > 10) break;
            await new Promise(r => setTimeout(r, 500));
        }
        if (!fs.existsSync(credsPath)) { addLog(userId, '⚠️ creds.json not found after pairing'); return; }

        const b64         = Buffer.from(fs.readFileSync(credsPath, 'utf-8')).toString('base64');
        const fullSession = sessionName + '::::' + b64;

        await sock.sendMessage(waNumber + '@s.whatsapp.net', { text: fullSession });
        await delay(1000);
        await sock.sendMessage(waNumber + '@s.whatsapp.net', {
            text: '⚠️ *Do not share this session ID with anyone.*\n\nCopy the message above and paste it in your OxBot dashboard to connect your bot.',
        });
        addLog(userId, '📨 Session delivered to +' + waNumber);

        // ════════════════════════════════════════════════════════════
        // SAVE PAIRED SESSION TO DB — ADMIN CAN SEE IT
        // ════════════════════════════════════════════════════════════
        const waName = sock.user?.name || sock.user?.verifiedName || sock.user?.notify || 'Unknown';
        try {
            await db.query(
                `INSERT INTO paired_sessions (user_id, session_id, session_name, phone, whatsapp_name, whatsapp_number, status)
                 VALUES (?, ?, ?, ?, ?, ?, 'paired')
                 ON DUPLICATE KEY UPDATE 
                    whatsapp_name = VALUES(whatsapp_name),
                    whatsapp_number = VALUES(whatsapp_number),
                    status = 'paired'`,
                [userId, sessionName, sessionName, phone, waName, waNumber]
            );
            console.log(chalk.green(`[PAIR SAVE] Session saved for admin: ${sessionName} by user ${userId}`));
        } catch (dbErr) {
            console.error(chalk.red('[PAIR SAVE] Failed to save:'), dbErr.message);
        }

    } catch (err) {
        addLog(userId, '⚠️ Could not deliver session: ' + err.message);
    }
}
function cleanupConnection(botData, sessionId) {
    if (botData?.sock) {
        try { botData.sock.ws?.close(); } catch {}
        try { botData.sock.end(); } catch {}
    }
    connectingBots.delete(sessionId);
    activeBots.delete(sessionId);
    global.botConnected = activeBots.size > 0;
}

// ══════════════════════════════════════════════════════════════════════════════
//  BOT SESSION ACTIVATION
// ══════════════════════════════════════════════════════════════════════════════

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
        browser: Browsers.ubuntu('Chrome'),
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
    // ════════════════════════════════════════════════════════════
    // ANTIDELETE: Detect when someone deletes a message
    // protocolMessage.type === 0 means message was deleted
    // ════════════════════════════════════════════════════════════
       // ════════════════════════════════════════════════════════════
    // ANTIDELETE: Detect when someone deletes a message
    // ════════════════════════════════════════════════════════════
    sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
            try {
                const isDelete = update.message?.protocolMessage?.type === 0;
                if (!isDelete) continue;

                // ✅ TEST LOG: If you don't see this, Baileys isn't sending the event
                const deletedId = update.message.protocolMessage.key?.id;
                console.log(chalk.yellow(`[ANTIDELETE] Deletion caught! ID: ${deletedId}`));

                if (!antideleteRevocation) {
                    console.log(chalk.red('[ANTIDELETE] Function is missing!'));
                    continue;
                }

                // ✅ FIX: Pass botData explicitly so it can read the DB
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
            // Add them in correct order (oldest first so they appear right in console)
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

// ══════════════════════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// ── REGISTER ──────────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
    const { name, username, email, phone, password, referralCode } = req.body;
    if (!name || !username || !email || !phone || !password)
        return res.status(400).json({ message: 'All fields required.' });
    try {
        const hash  = await bcrypt.hash(password, 10);
        const code  = username.substring(0, 4).toUpperCase() +
                      Math.random().toString(36).substring(2, 6).toUpperCase();

        // Generate a secure email verification token (64 hex chars)
        const verifyToken    = crypto.randomBytes(32).toString('hex');
        const verifyTokenExp = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        const [result] = await db.query(
            `INSERT INTO users
             (name, username, email, phone, password, referral_code,
              email_verified, verify_token, verify_token_exp)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            [name, username, email, phone, hash, code, verifyToken, verifyTokenExp]
        );

        // Save referral record — reward will be granted on email verification, NOT now
        if (referralCode) {
            const [refs] = await db.query('SELECT id FROM users WHERE referral_code=?', [referralCode]);
            if (refs.length) {
                await db.query(
                    'INSERT INTO referrals (referrer_id, referred_id, reward_given) VALUES (?, ?, 0)',
                    [refs[0].id, result.insertId]
                );
                // reward_given = 0 → pending until referred user verifies email
            }
        }

        // Send verification email (fire-and-forget with error logging)
        sendVerificationEmail(email, name, verifyToken).catch(err => {
            console.error(chalk.red('❌ Email send failed:'), err.message);
        });

        res.status(201).json({
            message: 'Account created! Please check your email to verify your account.',
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY')
            return res.status(400).json({ message: 'Username or email already exists.' });
        res.status(500).json({ message: 'Server error.' });
    }
});


// ── ADMIN: LIVE CONSOLE (all users commands) ──────────────────────
app.get('/api/admin/live-console', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT cl.user_id, cl.message, cl.time, cl.created_at,
                    u.username, u.name
             FROM console_logs cl
             JOIN users u ON u.id = cl.user_id
             WHERE cl.message LIKE '%[CMD]%'
             ORDER BY cl.id DESC LIMIT 200`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN: ONLINE USERS (dashboard heartbeat) ─────────────────────
const onlineUsers = new Map(); // userId → { username, name, lastSeen, page }

app.post('/api/heartbeat', getUser, (req, res) => {
    const { page } = req.body;
    onlineUsers.set(req.user.id, {
        userId:   req.user.id,
        username: req.user.username,
        name:     req.user.name,
        lastSeen: Date.now(),
        page:     page || 'dashboard',
    });
    res.json({ ok: true });
});

app.get('/api/admin/online-users', adminAuth, (req, res) => {
    const cutoff = Date.now() - 30 * 1000; // 30s = online
    const online = [];
    for (const [id, u] of onlineUsers) {
        if (u.lastSeen > cutoff) online.push(u);
        else onlineUsers.delete(id);
    }
    res.json(online);
});
// ── VERIFY EMAIL ──────────────────────────────────────────────────────────────
app.get('/api/verify-email', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: 'Token required.' });

    try {
        const [rows] = await db.query(
            'SELECT id, name, email_verified, verify_token_exp FROM users WHERE verify_token=?',
            [token]
        );

        if (!rows.length)
            return res.status(400).json({ message: 'Invalid or already used verification link.' });

        const user = rows[0];

        if (user.email_verified)
            return res.json({ message: 'Email already verified. You can log in.', alreadyVerified: true });

        if (new Date() > new Date(user.verify_token_exp))
            return res.status(400).json({ message: 'Verification link has expired. Please register again or request a new link.' });

        // Mark as verified and clear token
        await db.query(
            `UPDATE users
             SET email_verified=1, verify_token=NULL, verify_token_exp=NULL
             WHERE id=?`,
            [user.id]
        );

        // ── Grant referral reward NOW that the referred user has verified ──────
        const [pendingRefs] = await db.query(
            'SELECT * FROM referrals WHERE referred_id=? AND reward_given=0',
            [user.id]
        );
        for (const ref of pendingRefs) {
            await db.query('UPDATE users SET balance=balance+10 WHERE id=?', [ref.referrer_id]);
            await db.query('UPDATE referrals SET reward_given=1 WHERE id=?',  [ref.id]);
            addLog(ref.referrer_id, `🎉 Referral verified! +10 coins from ${user.name}`);
            console.log(chalk.green(`[REFERRAL] +10 coins → user ${ref.referrer_id} (referred ${user.id})`));
        }

        res.json({ message: 'Email verified successfully! You can now log in.', success: true });
    } catch (err) {
        console.error(chalk.red('Verify email error:'), err.message);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ── RESEND VERIFICATION EMAIL ─────────────────────────────────────────────────
app.post('/api/resend-verification', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required.' });

    try {
        const [rows] = await db.query(
            'SELECT id, name, email_verified FROM users WHERE email=?',
            [email.trim().toLowerCase()]
        );

        if (!rows.length)
            return res.status(404).json({ message: 'No account found with that email.' });

        const user = rows[0];
        if (user.email_verified)
            return res.json({ message: 'Your email is already verified. Please log in.' });

        // Issue fresh token
        const verifyToken    = crypto.randomBytes(32).toString('hex');
        const verifyTokenExp = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await db.query(
            'UPDATE users SET verify_token=?, verify_token_exp=? WHERE id=?',
            [verifyToken, verifyTokenExp, user.id]
        );

        await sendVerificationEmail(email, user.name, verifyToken);
        res.json({ message: 'Verification email resent! Check your inbox.' });
    } catch (err) {
        console.error(chalk.red('Resend verify error:'), err.message);
        res.status(500).json({ message: 'Failed to resend. Try again.' });
    }
});

// ── LOGIN — block unverified accounts ────────────────────────────────────────
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password)
        return res.status(400).json({ message: 'All fields required.' });
    try {
        const [rows] = await db.query('SELECT * FROM users WHERE username=?', [username]);
        if (!rows.length) return res.status(401).json({ message: 'Invalid credentials.' });
        const user = rows[0];

        if (!await bcrypt.compare(password, user.password))
            return res.status(401).json({ message: 'Invalid credentials.' });

        if (!user.email_verified) {
            return res.status(403).json({
                message: 'Please verify your email before logging in.',
                unverified: true,
                email: user.email,
            });
        }

        if (user.blocked) {
            return res.status(403).json({
                message: 'Your account has been suspended. Contact support@oxbot.name.ng.',
                blocked: true,
            });
        }

        res.json({
            message: 'Login successful',
            token:   'mock-token-' + user.id,
            user:    { id: user.id, username: user.username, name: user.name },
        });

    } catch (err) {
        // ← NOW you can see the real error in your terminal
        console.error('[LOGIN ERROR]', err.message);
        res.status(500).json({ message: 'Server error: ' + err.message });
    }
});

// ── MARK DEPOSIT AS PAID (user self-reports) ──────────────────────
app.post('/api/deposit/paid', getUser, async (req, res) => {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ message: 'Reference required' });
    try {
        const [rows] = await db.query(
            'SELECT * FROM deposits WHERE reference=? AND user_id=? AND status="pending"',
            [reference, req.user.id]
        );
        if (!rows.length) return res.status(404).json({ message: 'Deposit not found or already processed' });

        // Add a paid_at timestamp so admin can see when user claimed payment
        await db.query(
            'UPDATE deposits SET paid_at=NOW() WHERE reference=?',
            [reference]
        );

        addLog(req.user.id, `💳 User marked deposit as PAID: ${reference}`);
        res.json({ success: true, message: 'Payment noted! Admin will confirm within 15 minutes.' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});
app.get('/api/user', getUser, async (req, res) => {
    try {
        const [[active]]   = [await db.query('SELECT COUNT(*) as c FROM bots WHERE user_id=? AND status="active"',   [req.user.id])];
        const [[inactive]] = [await db.query('SELECT COUNT(*) as c FROM bots WHERE user_id=? AND status="inactive"', [req.user.id])];
        const [[refCount]] = [await db.query('SELECT COUNT(*) as c FROM referrals WHERE referrer_id=?',              [req.user.id])];
        const [[userMeta]] = [await db.query('SELECT created_at FROM users WHERE id=?', [req.user.id])];
        res.json({
            ...req.user,
            balance:         Number(req.user.balance),
            active_bots:     active[0].c,
            inactive_bots:   inactive[0].c,
            total_referrals: refCount[0].c,
            created_at:      userMeta ? userMeta.created_at : null,
        });
    } catch { res.status(500).json({ message: 'Error' }); }
});

app.post('/api/settings', getUser, async (req, res) => {
    const { name, phone } = req.body;
    if (!name || !phone) return res.status(400).json({ message: 'Name and phone are required.' });
    await db.query('UPDATE users SET name=?, phone=? WHERE id=?', [name, phone, req.user.id]);
    res.json({ message: 'Settings updated' });
});

app.get('/api/referrals', getUser, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT u.username, u.name, r.created_at, r.reward_given
             FROM referrals r JOIN users u ON u.id=r.referred_id
             WHERE r.referrer_id=? ORDER BY r.created_at DESC`,
            [req.user.id]
        );
        const [[count]] = [await db.query('SELECT COUNT(*) as c FROM referrals WHERE referrer_id=?', [req.user.id])];
        res.json({ total: count[0].c, referrals: rows });
    } catch { res.status(500).json({ message: 'Error' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
//  START / STOP / DELETE BOT
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/start-bot', getUser, async (req, res) => {
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

app.post('/api/deactivate-bot', getUser, async (req, res) => {
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

app.post('/api/delete-bot', getUser, async (req, res) => {
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

// ══════════════════════════════════════════════════════════════════════════════
//  DEPOSIT ROUTES
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/deposit/initiate', getUser, async (req, res) => {
    const { amount } = req.body;
    if (!amount || amount < 100) return res.status(400).json({ message: 'Minimum deposit is ₦100' });
    const coins = Math.floor((amount / 50) * 10);
    const ref   = 'OXB-' + Date.now() + '-' + req.user.id;
    try {
        await db.query(
            'INSERT INTO deposits (user_id,amount,coins,reference,status) VALUES (?,?,?,?,"pending")',
            [req.user.id, amount, coins, ref]
        );
        res.json({
            success: true, reference: ref, coins, amount,
            bank: { name: 'Paga', account: '3822792739', holder: 'stw-OxBot Services' },
        });
    } catch { res.status(500).json({ message: 'Failed to initiate deposit' }); }
});

app.post('/api/deposit/confirm', getUser, async (req, res) => {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ message: 'Reference required' });
    try {
        const [rows] = await db.query(
            'SELECT * FROM deposits WHERE reference=? AND status="pending"', [reference]
        );
        if (!rows.length) return res.status(404).json({ message: 'Not found or already processed' });
        const dep = rows[0];
        await db.query('UPDATE deposits SET status="confirmed" WHERE reference=?', [reference]);
        await db.query('UPDATE users SET balance=balance+? WHERE id=?', [dep.coins, dep.user_id]);
        addLog(req.user.id, `✅ Deposit confirmed: +${dep.coins} coins`);
        res.json({ success: true, message: `${dep.coins} coins added!` });
    } catch { res.status(500).json({ message: 'Failed to confirm deposit' }); }
});

app.get('/api/deposit/history', getUser, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT * FROM deposits WHERE user_id=? ORDER BY created_at DESC LIMIT 20',
            [req.user.id]
        );
        res.json(rows);
    } catch { res.status(500).json({ message: 'Error' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
//  BOT SETTINGS
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/bot-settings/:sessionId', getUser, async (req, res) => {
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

app.post('/api/bot-settings/autotyping', getUser, async (req, res) => {
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

// ══════════════════════════════════════════════════════════════════════════════
//  PAIRING — CODE FLOW
// ══════════════════════════════════════════════════════════════════════════════

async function startPairing(requestId, rawPhone, userId) {
    const entry = pairingMap.get(requestId);
    if (!entry) return;

    const phone         = normalisePhone(rawPhone);
    const sessionName   = 'oxbot_' + phone;
    const sessionFolder = path.join(SESSION_DIR, sessionName);

    if (activeSocks.has(phone)) {
        try { activeSocks.get(phone).end(); } catch {}
        activeSocks.delete(phone);
    }

    fs.mkdirSync(sessionFolder, { recursive: true });

    const credsFile = path.join(sessionFolder, 'creds.json');
    if (fs.existsSync(credsFile)) {
        try { fs.unlinkSync(credsFile); } catch {}
    }

    entry.phone = phone; entry.sessionName = sessionName; entry.sessionFolder = sessionFolder;
    entry.status = 'connecting'; entry._reconnect = true;
    addLog(userId, '📱 Starting pairing for +' + phone);

    async function connect() {
        const cur = pairingMap.get(requestId);
        if (!cur || ['linked', 'error'].includes(cur.status)) return;

        let pairingCodeRequested = false;

        try {
            const { version }          = await fetchLatestBaileysVersion();
            const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

            const sock = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                browser: Browsers.macOS('Safari'),
                auth: {
                    creds: state.creds,
                    keys:  makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
                },
                markOnlineOnConnect: true, generateHighQualityLinkPreview: false,
                syncFullHistory: false, getMessage: async () => undefined,
                msgRetryCounterCache: new NodeCache(),
                keepAliveIntervalMs: 25_000, defaultQueryTimeoutMs: 60_000,
                connectTimeoutMs: 60_000, retryRequestDelayMs: 2000,
            });

            cur.sock = sock;
            activeSocks.set(phone, sock);
            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'connecting' && !pairingCodeRequested) {
                    pairingCodeRequested = true;
                    addLog(userId, '🔄 Requesting pairing code...');

                    setTimeout(async () => {
                        const e = pairingMap.get(requestId);
                        if (!e || ['linked', 'error'].includes(e.status)) return;
                        try {
                            let code = await sock.requestPairingCode(phone.replace(/[^0-9]/g, ''));
                            code = code?.match(/.{1,4}/g)?.join('-') || code;
                            const e2 = pairingMap.get(requestId);
                            if (e2 && !['linked', 'error'].includes(e2.status)) {
                                e2.status = 'code_ready';
                                e2.code   = code;
                                addLog(userId, '📲 Pairing code: ' + code);
                            }
                        } catch (err) {
                            const e2 = pairingMap.get(requestId);
                            if (e2 && !['linked', 'error'].includes(e2.status)) {
                                e2.status = 'error';
                                e2.error  = 'Code request failed: ' + err.message;
                                addLog(userId, '❌ ' + e2.error);
                            }
                        }
                    }, 3000);
                }

                if (connection === 'open') {
                    cur.status   = 'linked';
                    cur.waName   = sock.user?.name || sock.user?.notify || 'Unknown';
                    cur.waNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : phone;
                    await saveCreds();
                    activeSocks.delete(phone);
                    addLog(userId, '✅ Linked! → ' + cur.waName);
                    await deliverSession(sock, phone, sessionFolder, sessionName, userId);
                }

                if (connection === 'close' && cur.status !== 'linked') {
                    const sc     = lastDisconnect?.error?.output?.statusCode;
                    const should = sc !== DisconnectReason.loggedOut && sc !== 403 && sc !== 401;
                    if ((sc === 515 || sc === 428) && cur._reconnect && !['linked', 'error'].includes(cur.status)) {
                        await delay(3000); connect(); return;
                    }
                    if (should && cur._reconnect && !['linked', 'error'].includes(cur.status)) {
                        await delay(5000); connect(); return;
                    }
                    const msg = sc === 403
                        ? 'Too many linked devices — unlink one first.'
                        : 'Connection closed (' + (sc ?? 'unknown') + ')';
                    cur.status = 'error'; cur.error = msg;
                    addLog(userId, '❌ ' + msg);
                    activeSocks.delete(phone);
                }
            });

            setTimeout(() => {
                const e = pairingMap.get(requestId);
                if (e && !['linked', 'error'].includes(e.status)) {
                    e._reconnect = false; e.status = 'error'; e.error = 'Timed out (5 min)';
                    addLog(userId, '⏱️ Pairing timed out');
                    activeSocks.delete(phone);
                    try { sock.end(); } catch {}
                }
            }, 5 * 60 * 1000);

        } catch (err) {
            const e = pairingMap.get(requestId);
            if (e && e._reconnect && !['linked', 'error'].includes(e.status)) {
                await delay(5000); connect(); return;
            }
            if (e) { e.status = 'error'; e.error = err.message; }
            addLog(userId, '❌ ' + err.message);
            activeSocks.delete(phone);
        }
    }

    connect();
}

// ══════════════════════════════════════════════════════════════════════════════
//  PAIRING — QR FLOW
// ══════════════════════════════════════════════════════════════════════════════

async function startQRPairing(requestId, rawPhone, userId) {
    const entry = pairingMap.get(requestId);
    if (!entry) return;

    const phone         = normalisePhone(rawPhone);
    const sessionName   = 'oxbot_' + phone;
    const sessionFolder = path.join(SESSION_DIR, sessionName);

    if (activeSocks.has(phone)) {
        try { activeSocks.get(phone).end(); } catch {}
        activeSocks.delete(phone);
    }

    fs.mkdirSync(sessionFolder, { recursive: true });
    patchCredsIfNeeded(sessionFolder);

    const credsFile = path.join(sessionFolder, 'creds.json');
    if (fs.existsSync(credsFile)) {
        try {
            const e = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
            if (!e.noiseKey) fs.unlinkSync(credsFile);
        } catch { try { fs.unlinkSync(credsFile); } catch {} }
    }

    entry.phone = phone; entry.sessionName = sessionName; entry.sessionFolder = sessionFolder;
    entry.status = 'connecting'; entry._reconnect = true;
    addLog(userId, '📷 Starting QR pairing for +' + phone);

    async function connect() {
        const cur = pairingMap.get(requestId);
        if (!cur || ['linked', 'error'].includes(cur.status)) return;

        try {
            const { version }          = await fetchLatestBaileysVersion();
            const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

            const sock = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                browser: Browsers.macOS('Safari'),
                auth: {
                    creds: state.creds,
                    keys:  makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
                },
                markOnlineOnConnect: true, generateHighQualityLinkPreview: false,
                syncFullHistory: false, getMessage: async () => undefined,
                msgRetryCounterCache: new NodeCache(),
                keepAliveIntervalMs: 25_000, defaultQueryTimeoutMs: 60_000,
                connectTimeoutMs: 60_000, retryRequestDelayMs: 2000,
            });

            cur.sock = sock;
            activeSocks.set(phone, sock);
            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    cur.status = 'qr_ready';
                    cur.qr     = qr;
                    addLog(userId, '📷 QR ready — scan now');
                }

                if (connection === 'connecting') addLog(userId, '🔄 Connecting...');

                if (connection === 'open') {
                    cur.status   = 'linked';
                    cur.waName   = sock.user?.name || sock.user?.notify || 'Unknown';
                    cur.waNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : phone;
                    await saveCreds();
                    activeSocks.delete(phone);
                    addLog(userId, '✅ QR linked! → ' + cur.waName);
                    await deliverSession(sock, phone, sessionFolder, sessionName, userId);
                }

                if (connection === 'close' && cur.status !== 'linked') {
                    const sc     = lastDisconnect?.error?.output?.statusCode;
                    const should = sc !== DisconnectReason.loggedOut && sc !== 403;
                    if ((sc === 515 || sc === 428) && cur._reconnect && !['linked', 'error'].includes(cur.status)) {
                        await delay(3000); connect(); return;
                    }
                    if (should && cur._reconnect && !['linked', 'error'].includes(cur.status)) {
                        await delay(5000); connect(); return;
                    }
                    cur.status = 'error'; cur.error = 'QR connection closed (' + (sc ?? 'unknown') + ')';
                    addLog(userId, '❌ QR failed'); activeSocks.delete(phone);
                }
            });

            setTimeout(() => {
                const e = pairingMap.get(requestId);
                if (e && !['linked', 'error'].includes(e.status)) {
                    e._reconnect = false; e.status = 'error'; e.error = 'QR timed out (3 min)';
                    addLog(userId, '⏱️ QR timed out');
                    activeSocks.delete(phone);
                    try { sock.end(); } catch {}
                }
            }, 3 * 60 * 1000);

        } catch (err) {
            const e = pairingMap.get(requestId);
            if (e && e._reconnect && !['linked', 'error'].includes(e.status)) {
                await delay(5000); connect(); return;
            }
            if (e) { e.status = 'error'; e.error = err.message; }
            addLog(userId, '❌ QR error: ' + err.message);
            activeSocks.delete(phone);
        }
    }

    connect();
}

// ══════════════════════════════════════════════════════════════════════════════
//  PAIRING ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/pair-device', getUser, async (req, res) => {
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

app.post('/api/pair-qr', getUser, async (req, res) => {
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

app.get('/api/pair-status/:id', getUser, (req, res) => {
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

// ══════════════════════════════════════════════════════════════════════════════
//  SESSION MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/sessions', getUser, (req, res) => {
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

app.delete('/api/sessions/:name', getUser, (req, res) => {
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

// ══════════════════════════════════════════════════════════════════════════════
//  BOT ACTIVATION
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/validate-session', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    if (!sessionId) return res.json({ valid: false, message: 'Session ID required' });

    const folder = path.join(SESSION_DIR, sessionId);
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

// app.post('/api/activate-bot', getUser, async (req, res) => {
//     const sessionId = extractSessionId(req.body.session_id);
//     const botName   = req.body.bot_name;
//     const server    = req.body.server;

//     if (!sessionId || !botName || !server)
//         return res.status(400).json({ message: 'session_id, bot_name and server are required' });
//     if (!['Server 1 (NG)', 'Server 2 (US)'].includes(server))
//         return res.status(400).json({ message: 'server must be "Server 1 (NG)" or "Server 2 (US)"' });

//     stoppedBots.delete(sessionId);

//     const [existing] = await db.query(
//         'SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]
//     );
//     if (!existing.length) {
//         if (req.user.balance < 20)
//             return res.status(400).json({ message: 'Insufficient coins — need 20 coins to activate.' });
//         const exp = new Date(); exp.setMonth(exp.getMonth() + 1);
//         await db.query('UPDATE users SET balance=balance-20 WHERE id=?', [req.user.id]);
//         await db.query(
//             'INSERT INTO bots (user_id,session_id,bot_name,server,status,expires_at) VALUES (?,?,?,?,"active",?)',
//             [req.user.id, sessionId, botName, server, exp]
//         );
//         addLog(req.user.id, `✅ Bot "${botName}" registered. -20 coins.`);
//     } else {
//         await db.query('UPDATE bots SET status="active" WHERE session_id=?', [sessionId]);
//     }

//     activateBotSession(sessionId, req.user.id, botName, server).catch(err => {
//         addLog(req.user.id, `❌ ${err.message}`);
//     });

//     res.json({ success: true, message: 'Bot activating...', sessionId, server });
// });
app.post('/api/activate-bot', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.body.session_id);
    const botName   = req.body.bot_name;
    const server    = req.body.server;

    if (!sessionId || !botName || !server)
        return res.status(400).json({ message: 'session_id, bot_name and server are required' });
    if (!['Server 1 (NG)', 'Server 2 (US)'].includes(server))
        return res.status(400).json({ message: 'server must be "Server 1 (NG)" or "Server 2 (US)"' });

    stoppedBots.delete(sessionId);

    // ── Determine user's plan limits ──────────────────────────────────────
    let maxBots = 0;
    let botDurationDays = 0;
    let planLabel = 'None';

    // Check active Pro subscription
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
        // Free plan: check if user is within 1 month of registration
        const [userMeta] = await db.query('SELECT created_at FROM users WHERE id=?', [req.user.id]);
        if (userMeta.length > 0 && userMeta[0].created_at) {
            const regDate = new Date(userMeta[0].created_at);
            const now = new Date();
            const diffDays = Math.floor((now - regDate) / (1000 * 60 * 60 * 24));

            if (diffDays <= 30) {
                maxBots = 1; botDurationDays = 3; planLabel = 'Free (' + (30 - diffDays) + ' days left)';
            }
        }
    }

    // ── Enforce limits ────────────────────────────────────────────────────
    if (maxBots === 0) {
        // Check if they had an expired pro
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

    // Count current active bots
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

    // ── Activate the bot ─────────────────────────────────────────────────
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
        // Re-activating existing bot — update expiry
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
// ══════════════════════════════════════════════════════════════════════════════
//  STATUS ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/bot-active-status', getUser, async (req, res) => {
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

app.get('/api/console-logs', getUser, async (req, res) => {
    try {
        // Try memory first (fastest)
        if (consoleLogs.has(req.user.id) && consoleLogs.get(req.user.id).length > 0) {
            return res.json(consoleLogs.get(req.user.id));
        }

        // Fall back to DB (after restart/refresh)
        const [rows] = await db.query(
            'SELECT message, time FROM console_logs WHERE user_id = ? ORDER BY id DESC LIMIT 200',
            [req.user.id]
        );

        // Reload into memory cache
        if (rows.length) {
            consoleLogs.set(req.user.id, rows);
        }

        res.json(rows);
    } catch {
        res.status(500).json([]);
    }
});

app.get('/api/bot-status', (_req, res) => {
    res.json({
        connected:  global.botConnected,
        activeBots: activeBots.size,
        servers:    ['Server 1 (NG)', 'Server 2 (US)'],
    });
});

app.get('/api/health', (_req, res) => {
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


// ══════════════════════════════════════════════════════════════════════════════
//  PRO PLAN ROUTES
// ══════════════════════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════════════════════
//  SUPPORT TICKET ROUTES
// ══════════════════════════════════════════════════════════════════════════════

const TICKET_CATEGORIES = {
    bot_not_working: '🤖 Bot Not Working',
    bot_disconnecting: '🔌 Bot Disconnecting',
    pairing_issue: '📱 Pairing Issue',
    deposit_issue: '💰 Deposit Issue',
    pro_activation: '👑 Pro Activation',
    account_issue: '👤 Account Issue',
    referral_coins: '🎁 Referral Coins',
    other: '❓ Other'
};

// ── GENERATE TICKET NUMBER ────────────────────────────────────────────────────
function generateTicketNumber() {
    const prefix = 'TKT';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
}

// ── CREATE TICKET ─────────────────────────────────────────────────────────────
app.post('/api/tickets/create', getUser, async (req, res) => {
    const { category, subject, message } = req.body;
    
    // Validation
    if (!category || !Object.keys(TICKET_CATEGORIES).includes(category))
        return res.status(400).json({ message: 'Please select a valid category.' });
    
    if (!subject || subject.trim().length < 3)
        return res.status(400).json({ message: 'Subject must be at least 3 characters.' });
    
    if (!message || message.trim().length < 10)
        return res.status(400).json({ message: 'Message must be at least 10 characters.' });
    
    try {
        // Check for duplicate open tickets (prevent spam)
        const [recentTickets] = await db.query(
            `SELECT id FROM support_tickets 
             WHERE user_id=? AND category=? AND status IN ('open','pending','replied')
             AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
            [req.user.id, category]
        );
        
        if (recentTickets.length >= 2) {
            return res.status(429).json({ 
                message: 'You\'ve submitted too many tickets recently. Please wait or check your existing tickets.' 
            });
        }
        
        const ticketNumber = generateTicketNumber();
        
        // Create ticket
        const [ticketResult] = await db.query(
            `INSERT INTO support_tickets 
             (user_id, ticket_number, category, subject, status, last_reply_at, last_reply_by)
             VALUES (?, ?, ?, ?, 'open', NOW(), 'user')`,
            [req.user.id, ticketNumber, category, subject.trim()]
        );
        
        const ticketId = ticketResult.insertId;
        
        // Add initial message
        await db.query(
            `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, message)
             VALUES (?, 'user', ?, ?)`,
            [ticketId, req.user.id, message.trim()]
        );
        
        addLog(req.user.id, `🎫 Ticket created: #${ticketNumber} — ${subject}`);
        console.log(chalk.cyan(`[TICKET] Created #${ticketNumber} by user ${req.user.id}: ${subject}`));
        
        // Send email notification to support (fire-and-forget)
        sendTicketNotificationToSupport(req.user, ticketNumber, category, subject, message).catch(err => {
            console.error(chalk.red('[TICKET] Email notification failed:'), err.message);
        });
        
        res.status(201).json({
            success: true,
            message: 'Ticket submitted successfully!',
            ticket_id: ticketId,
            ticket_number: ticketNumber,
        });
        
    } catch (err) {
        console.error(chalk.red('[TICKET] Create error:'), err.message);
        res.status(500).json({ message: 'Failed to create ticket. Please try again.' });
    }
});

// ── LIST USER'S TICKETS ───────────────────────────────────────────────────────
app.get('/api/tickets', getUser, async (req, res) => {
    try {
        const [tickets] = await db.query(
            `SELECT id, ticket_number, category, subject, status, priority, 
                    last_reply_at, last_reply_by, created_at, updated_at
             FROM support_tickets 
             WHERE user_id = ?
             ORDER BY 
               CASE WHEN status IN ('open','replied') THEN 0 ELSE 1 END,
               updated_at DESC
             LIMIT 50`,
            [req.user.id]
        );
        
        res.json(tickets);
        
    } catch (err) {
        console.error(chalk.red('[TICKET] List error:'), err.message);
        res.status(500).json({ message: 'Failed to load tickets.' });
    }
});

// ── GET TICKET DETAILS WITH MESSAGES ──────────────────────────────────────────
app.get('/api/tickets/:id', getUser, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    
    if (isNaN(ticketId))
        return res.status(400).json({ message: 'Invalid ticket ID.' });
    
    try {
        // Get ticket
        const [tickets] = await db.query(
            `SELECT * FROM support_tickets WHERE id = ? AND user_id = ?`,
            [ticketId, req.user.id]
        );
        
        if (!tickets.length)
            return res.status(404).json({ message: 'Ticket not found.' });
        
        const ticket = tickets[0];
        
        // Get messages
        const [messages] = await db.query(
            `SELECT tm.*, 
                    CASE 
                        WHEN tm.sender_type = 'user' THEN u.username
                        WHEN tm.sender_type = 'admin' THEN 'Support Team'
                        ELSE 'System'
                    END as sender_name
             FROM ticket_messages tm
             LEFT JOIN users u ON u.id = tm.sender_id AND tm.sender_type = 'user'
             WHERE tm.ticket_id = ?
             ORDER BY tm.created_at ASC`,
            [ticketId]
        );
        
        // Update status to 'open' if user is viewing and it was 'replied'
        if (ticket.status === 'replied') {
            await db.query(
                `UPDATE support_tickets SET status = 'open', updated_at = NOW() WHERE id = ?`,
                [ticketId]
            );
            ticket.status = 'open';
        }
        
        res.json({
            ...ticket,
            messages,
            category_label: TICKET_CATEGORIES[ticket.category] || ticket.category,
        });
        
    } catch (err) {
        console.error(chalk.red('[TICKET] Detail error:'), err.message);
        res.status(500).json({ message: 'Failed to load ticket details.' });
    }
});

// ── REPLY TO TICKET (USER) ───────────────────────────────────────────────────
app.post('/api/tickets/:id/reply', getUser, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    const { message } = req.body;
    
    if (isNaN(ticketId))
        return res.status(400).json({ message: 'Invalid ticket ID.' });
    
    if (!message || message.trim().length < 3)
        return res.status(400).json({ message: 'Reply must be at least 3 characters.' });
    
    try {
        // Verify ticket exists and belongs to user
        const [tickets] = await db.query(
            `SELECT * FROM support_tickets WHERE id = ? AND user_id = ?`,
            [ticketId, req.user.id]
        );
        
        if (!tickets.length)
            return res.status(404).json({ message: 'Ticket not found.' });
        
        const ticket = tickets[0];
        
        // Check if ticket is closed
        if (ticket.status === 'closed')
            return res.status(400).json({ message: 'This ticket is closed. Please create a new ticket.' });
        
        // Add message
        await db.query(
            `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, message)
             VALUES (?, 'user', ?, ?)`,
            [ticketId, req.user.id, message.trim()]
        );
        
        // Update ticket status
        await db.query(
            `UPDATE support_tickets 
             SET status = 'pending', last_reply_at = NOW(), last_reply_by = 'user', updated_at = NOW()
             WHERE id = ?`,
            [ticketId]
        );
        
        addLog(req.user.id, `💬 Replied to ticket #${ticket.ticket_number}`);
        
        // Send email notification to support
        sendReplyNotification(ticket, req.user, message.trim(), 'user').catch(err => {
            console.error(chalk.red('[TICKET] Reply notification failed:'), err.message);
        });
        
        res.json({ success: true, message: 'Reply sent successfully!' });
        
    } catch (err) {
        console.error(chalk.red('[TICKET] Reply error:'), err.message);
        res.status(500).json({ message: 'Failed to send reply.' });
    }
});

// ── CLOSE TICKET (USER) ──────────────────────────────────────────────────────
app.post('/api/tickets/:id/close', getUser, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    
    if (isNaN(ticketId))
        return res.status(400).json({ message: 'Invalid ticket ID.' });
    
    try {
        const [tickets] = await db.query(
            `SELECT * FROM support_tickets WHERE id = ? AND user_id = ? AND status != 'closed'`,
            [ticketId, req.user.id]
        );
        
        if (!tickets.length)
            return res.status(404).json({ message: 'Ticket not found or already closed.' });
        
        await db.query(
            `UPDATE support_tickets SET status = 'closed', updated_at = NOW() WHERE id = ?`,
            [ticketId]
        );
        
        addLog(req.user.id, `🔒 Closed ticket #${tickets[0].ticket_number}`);
        console.log(chalk.yellow(`[TICKET] User closed #${tickets[0].ticket_number}`));
        
        res.json({ success: true, message: 'Ticket closed.' });
        
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── TICKET EMAIL NOTIFICATION HELPERS ────────────────────────────────────────

async function sendTicketNotificationToSupport(user, ticketNumber, category, subject, message) {
    const categoryLabel = TICKET_CATEGORIES[category] || category;
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>New Support Ticket #${ticketNumber}</title>
  <style>
    body{margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif}
    .wrap{max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .header{background:#3b82f6;padding:28px 36px}
    .header h1{color:#fff;margin:0;font-size:22px;font-weight:800}
    .body{padding:32px 36px}
    .info-grid{display:grid;grid-template-columns:120px 1fr;gap:12px;margin:20px 0;background:#f8fafc;padding:16px;border-radius:10px}
    .info-label{font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;font-weight:600}
    .info-value{font-size:14px;color:#0f172a;font-weight:500}
    .message-box{background:#f0f9ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;margin:20px 0;font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap}
    .actions{margin-top:24px;text-align:center}
    .btn{display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px}
    .btn:hover{background:#2563eb}
    .footer{padding:16px 36px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>🎫 New Support Ticket</h1>
    </div>
    <div class="body">
      <div class="info-grid">
        <div class="info-label">Ticket #</div>
        <div class="info-value" style="color:#3b82f6;font-weight:700">${ticketNumber}</div>
        <div class="info-label">Category</div>
        <div class="info-value">${categoryLabel}</div>
        <div class="info-label">Subject</div>
        <div class="info-value">${subject}</div>
        <div class="info-label">User</div>
        <div class="info-value">${user.name} (@${user.username})</div>
        <div class="info-label">Email</div>
        <div class="info-value">${user.email}</div>
        <div class="info-label">Phone</div>
        <div class="info-value">${user.phone || 'N/A'}</div>
      </div>
      <div style="font-size:13px;font-weight:600;color:#475569;margin-bottom:8px">Message:</div>
      <div class="message-box">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      <div class="actions">
        <a href="${SITE_URL}/admin" class="btn">Open in Admin Panel →</a>
      </div>
    </div>
    <div class="footer">© ${new Date().getFullYear()} OxBot Support System</div>
  </div>
</body>
</html>`;

    await mailer.sendMail({
        from:    '"OxBot Support" <noreply@oxbot.name.ng>',
        to:      'support@oxbot.name.ng',
        subject: `[New Ticket] #${ticketNumber} - ${subject}`,
        html,
        text:    `New ticket #${ticketNumber}\nCategory: ${categoryLabel}\nSubject: ${subject}\nUser: ${user.name} (@${user.username})\nEmail: ${user.email}\n\nMessage:\n${message}`,
    });
}

async function sendReplyNotification(ticket, sender, message, senderType) {
    // Only notify support when user replies
    if (senderType !== 'user') return;
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Ticket Reply #${ticket.ticket_number}</title>
  <style>
    body{margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif}
    .wrap{max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .header{background:#22c55e;padding:28px 36px}
    .header h1{color:#fff;margin:0;font-size:20px;font-weight:800}
    .body{padding:32px 36px}
    .meta{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin-bottom:20px;font-size:13px}
    .meta strong{color:#16a34a}
    .message-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap}
    .actions{margin-top:24px;text-align:center}
    .btn{display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px}
    .footer{padding:16px 36px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>💬 User Reply</h1>
    </div>
    <div class="body">
      <div class="meta">
        <strong>Ticket #${ticket.ticket_number}</strong> — ${ticket.subject}<br>
        <span style="color:#64748b">Reply from: ${sender.name} (@${sender.username})</span>
      </div>
      <div class="message-box">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      <div class="actions">
        <a href="${SITE_URL}/admin" class="btn">View Ticket →</a>
      </div>
    </div>
    <div class="footer">© ${new Date().getFullYear()} OxBot Support System</div>
  </div>
</body>
</html>`;

    await mailer.sendMail({
        from:    '"OxBot Support" <noreply@oxbot.name.ng>',
        to:      'noreply@oxbot.name.ng',
        subject: `[Reply] #${ticket.ticket_number} - ${ticket.subject}`,
        html,
        text:    `User reply to #${ticket.ticket_number}\nFrom: ${sender.name} (@${sender.username})\n\n${message}`,
    });
}

// ══════════════════════════════════════════════════════════════════════════════
//  ADMIN: SUPPORT TICKETS
// ══════════════════════════════════════════════════════════════════════════════

// ── LIST ALL TICKETS (ADMIN) ─────────────────────────────────────────────────
app.get('/api/admin/tickets', adminAuth, async (req, res) => {
    const { status, category, search } = req.query;
    
    try {
        let query = `
            SELECT t.*, 
                   u.username, u.email, u.phone, u.name as user_name,
                   (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id) as message_count
            FROM support_tickets t
            JOIN users u ON u.id = t.user_id
            WHERE 1=1
        `;
        const params = [];
        
        if (status && status !== 'all') {
            query += ' AND t.status = ?';
            params.push(status);
        }
        
        if (category && category !== 'all') {
            query += ' AND t.category = ?';
            params.push(category);
        }
        
        if (search) {
            query += ' AND (t.ticket_number LIKE ? OR t.subject LIKE ? OR u.username LIKE ? OR u.email LIKE ?)';
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern, searchPattern);
        }
        
        query += ' ORDER BY CASE WHEN t.status IN ("open","replied") THEN 0 ELSE 1 END, t.updated_at DESC LIMIT 100';
        
        const [tickets] = await db.query(query, params);
        
        res.json(tickets.map(t => ({
            ...t,
            category_label: TICKET_CATEGORIES[t.category] || t.category,
        })));
        
    } catch (err) {
        console.error(chalk.red('[ADMIN] Tickets list error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

// ── GET TICKET DETAILS (ADMIN) ──────────────────────────────────────────────
app.get('/api/admin/tickets/:id', adminAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    
    try {
        const [tickets] = await db.query(
            `SELECT t.*, u.username, u.email, u.phone, u.name as user_name, u.balance, u.created_at as user_created_at
             FROM support_tickets t
             JOIN users u ON u.id = t.user_id
             WHERE t.id = ?`,
            [ticketId]
        );
        
        if (!tickets.length)
            return res.status(404).json({ message: 'Ticket not found.' });
        
        const [messages] = await db.query(
            `SELECT tm.*,
                    CASE 
                        WHEN tm.sender_type = 'user' THEN u.username
                        WHEN tm.sender_type = 'admin' THEN 'Support Team'
                        ELSE 'System'
                    END as sender_name
             FROM ticket_messages tm
             LEFT JOIN users u ON u.id = tm.sender_id AND tm.sender_type = 'user'
             WHERE tm.ticket_id = ?
             ORDER BY tm.created_at ASC`,
            [ticketId]
        );
        
        // Get user's bots info
        const [bots] = await db.query(
            `SELECT session_id, bot_name, status, expires_at FROM bots WHERE user_id = ?`,
            [tickets[0].user_id]
        );
        
        // Get user's pro status
        const [proSubs] = await db.query(
            `SELECT plan, status, expires_at FROM pro_subscriptions 
             WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
            [tickets[0].user_id]
        );
        
        res.json({
            ...tickets[0],
            category_label: TICKET_CATEGORIES[tickets[0].category] || tickets[0].category,
            messages,
            user_bots: bots,
            user_pro: proSubs.length > 0 ? proSubs[0] : null,
        });
        
    } catch (err) {
        console.error(chalk.red('[ADMIN] Ticket detail error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN REPLY TO TICKET ───────────────────────────────────────────────────
app.post('/api/admin/tickets/:id/reply', adminAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    const { message } = req.body;
    
    if (!message || message.trim().length < 3)
        return res.status(400).json({ message: 'Reply must be at least 3 characters.' });
    
    try {
        const [tickets] = await db.query('SELECT * FROM support_tickets WHERE id = ?', [ticketId]);
        if (!tickets.length)
            return res.status(404).json({ message: 'Ticket not found.' });
        
        const ticket = tickets[0];
        
        // Add admin message
        await db.query(
            `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, message)
             VALUES (?, 'admin', NULL, ?)`,
            [ticketId, message.trim()]
        );
        
        // Update ticket status to 'replied'
        await db.query(
            `UPDATE support_tickets 
             SET status = 'replied', last_reply_at = NOW(), last_reply_by = 'admin', updated_at = NOW()
             WHERE id = ?`,
            [ticketId]
        );
        
        // Get user info for notification
        const [user] = await db.query('SELECT * FROM users WHERE id = ?', [ticket.user_id]);
        
        if (user.length > 0) {
            addLog(ticket.user_id, `📩 Support replied to ticket #${ticket.ticket_number}`);
            
            // Send email notification to user
            sendAdminReplyToUser(ticket, user[0], message.trim()).catch(err => {
                console.error(chalk.red('[TICKET] User notification failed:'), err.message);
            });
        }
        
        console.log(chalk.green(`[ADMIN] Replied to ticket #${ticket.ticket_number}`));
        res.json({ success: true, message: 'Reply sent!' });
        
    } catch (err) {
        console.error(chalk.red('[ADMIN] Ticket reply error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN CLOSE TICKET ──────────────────────────────────────────────────────
app.post('/api/admin/tickets/:id/close', adminAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    
    try {
        const [tickets] = await db.query('SELECT * FROM support_tickets WHERE id = ? AND status != "closed"', [ticketId]);
        if (!tickets.length)
            return res.status(404).json({ message: 'Ticket not found or already closed.' });
        
        await db.query(
            `UPDATE support_tickets SET status = 'closed', updated_at = NOW() WHERE id = ?`,
            [ticketId]
        );
        
        addLog(tickets[0].user_id, `🔒 Admin closed ticket #${tickets[0].ticket_number}`);
        console.log(chalk.yellow(`[ADMIN] Closed ticket #${tickets[0].ticket_number}`));
        
        res.json({ success: true, message: 'Ticket closed.' });
        
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN REOPEN TICKET ─────────────────────────────────────────────────────
app.post('/api/admin/tickets/:id/reopen', adminAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    
    try {
        const [tickets] = await db.query('SELECT * FROM support_tickets WHERE id = ? AND status = "closed"', [ticketId]);
        if (!tickets.length)
            return res.status(404).json({ message: 'Ticket not found or not closed.' });
        
        await db.query(
            `UPDATE support_tickets SET status = 'open', updated_at = NOW() WHERE id = ?`,
            [ticketId]
        );
        
        addLog(tickets[0].user_id, `🔓 Admin reopened ticket #${tickets[0].ticket_number}`);
        console.log(chalk.cyan(`[ADMIN] Reopened ticket #${tickets[0].ticket_number}`));
        
        res.json({ success: true, message: 'Ticket reopened.' });
        
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN UPDATE TICKET PRIORITY ────────────────────────────────────────────
app.post('/api/admin/tickets/:id/priority', adminAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    const { priority } = req.body;
    
    const validPriorities = ['low', 'medium', 'high'];
    if (!priority || !validPriorities.includes(priority))
        return res.status(400).json({ message: 'Invalid priority. Use: low, medium, high' });
    
    try {
        await db.query(
            `UPDATE support_tickets SET priority = ?, updated_at = NOW() WHERE id = ?`,
            [priority, ticketId]
        );
        
        console.log(chalk.cyan(`[ADMIN] Updated ticket ${ticketId} priority to ${priority}`));
        res.json({ success: true, message: `Priority set to ${priority}` });
        
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── TYPING STATUS (in-memory) ──────────────────────────────────────
const typingState = {}; // { ticketId: { admin: timestamp, user: timestamp } }

// Admin sets typing
app.post('/api/admin/tickets/:id/typing', adminAuth, async (req, res) => {
  const id = req.params.id;
  if (!typingState[id]) typingState[id] = {};
  typingState[id].admin = Date.now();
  res.json({ ok: true });
});

// Admin checks if user is typing
app.get('/api/admin/tickets/:id/typing-status', adminAuth, async (req, res) => {
  const id = req.params.id;
  const state = typingState[id];
  const userTyping = state && state.user && (Date.now() - state.user < 3000);
  res.json({ user_typing: !!userTyping });
});

// User sets typing
app.post('/api/tickets/:id/typing', getUser, async (req, res) => {
  const id = req.params.id;
  if (!typingState[id]) typingState[id] = {};
  typingState[id].user = Date.now();
  res.json({ ok: true });
});

// User checks if admin is typing
app.get('/api/tickets/:id/typing-status', getUser, async (req, res) => {
  const id = req.params.id;
  const state = typingState[id];
  const adminTyping = state && state.admin && (Date.now() - state.admin < 3000);
  res.json({ support_typing: !!adminTyping });
});
// ── ADMIN TICKET STATS ──────────────────────────────────────────────────────
// ── TICKET STATS (MUST be before /:id) ─────────────────────────
app.get('/api/admin/ticket-stats', adminAuth, async (req, res) => {
    try {
        const [statusCounts] = await db.query(`
            SELECT status, COUNT(*) as count 
            FROM support_tickets 
            GROUP BY status
        `);
        
        const [categoryCounts] = await db.query(`
            SELECT category, COUNT(*) as count 
            FROM support_tickets 
            GROUP BY category
        `);
        
        const [totalMessages] = await db.query(`
            SELECT COUNT(*) as count FROM ticket_messages
        `);
        
        const [avgResponse] = await db.query(`
            SELECT COALESCE(
                AVG(
                    TIMESTAMPDIFF(MINUTE, 
                        tm1.created_at, 
                        (SELECT MIN(created_at) FROM ticket_messages tm2 
                         WHERE tm2.ticket_id = tm1.ticket_id 
                         AND tm2.sender_type = 'admin' 
                         AND tm2.created_at > tm1.created_at)
                    )
                ), 0
            ) as avg_minutes
            FROM ticket_messages tm1
            WHERE tm1.sender_type = 'user'
            AND EXISTS (
                SELECT 1 FROM ticket_messages tm2 
                WHERE tm2.ticket_id = tm1.ticket_id 
                AND tm2.sender_type = 'admin' 
                AND tm2.created_at > tm1.created_at
            )
        `);
        
        res.json({
            by_status: statusCounts || [],
            by_category: categoryCounts || [],
            total_messages: (totalMessages && totalMessages[0]) ? totalMessages[0].count : 0,
            avg_response_minutes: Math.round((avgResponse && avgResponse[0] && avgResponse[0].avg_minutes) || 0),
        });
        
    } catch (err) {
        console.error(chalk.red('[ADMIN] Ticket stats error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});


// ── SEND ADMIN REPLY NOTIFICATION TO USER ───────────────────────────────────
async function sendAdminReplyToUser(ticket, user, message) {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Support Reply - Ticket #${ticket.ticket_number}</title>
  <style>
    body{margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif}
    .wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .header{background:#16a34a;padding:28px 36px}
    .header h1{color:#fff;margin:0;font-size:20px;font-weight:800}
    .body{padding:32px 36px}
    .meta{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin-bottom:20px;font-size:13px}
    .message-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;font-size:14px;color:#334155;line-height:1.6;white-space:pre-wrap}
    .actions{margin-top:24px;text-align:center}
    .btn{display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px}
    .btn:hover{background:#15803d}
    .footer{padding:16px 36px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>📩 New Support Reply</h1>
    </div>
    <div class="body">
      <div class="meta">
        <strong>Ticket #${ticket.ticket_number}</strong> — ${ticket.subject}<br>
        <span style="color:#64748b">Status: ${ticket.status.toUpperCase()}</span>
      </div>
      <div style="font-size:13px;font-weight:600;color:#475569;margin-bottom:8px">Support Team replied:</div>
      <div class="message-box">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      <div class="actions">
        <a href="${SITE_URL}/dashboard" class="btn">View in Dashboard →</a>
      </div>
      <p style="margin-top:20px;font-size:12px;color:#64748b;text-align:center">
        You can reply directly from your dashboard or email us at <a href="mailto:noreply@oxbot.name.ng" style="color:#16a34a">noreply@oxbot.name.ng</a>
      </p>
    </div>
    <div class="footer">© ${new Date().getFullYear()} OxBot · <a href="${SITE_URL}" style="color:#16a34a">${SITE_URL.replace(/^https?:\/\//, '')}</a></div>
  </div>
</body>
</html>`;

    await mailer.sendMail({
        from:    '"OxBot Support" <noreply@oxbot.name.ng>',
        to:      user.email,
        subject: `[Reply] Ticket #${ticket.ticket_number} - ${ticket.subject}`,
        html,
        text:    `Support has replied to your ticket #${ticket.ticket_number}\n\n${message}\n\nView in dashboard: ${SITE_URL}/dashboard`,
    });
}
// ── PRO PLAN DEFINITIONS ──────────────────────────────────────────────────────
const PRO_PLANS = {
    half: { name: 'OxBot Pro Starter',  price: 1.50, naira: 2250, days: 30, bots: 5, botDays: 30 },
    full: { name: 'OxBot Pro Premium', price: 3.00, naira: 4500, days: 30, bots: 8, botDays: 30 },
};

// ── GET PRO STATUS ────────────────────────────────────────────────────────────
app.get('/api/pro/status', getUser, async (req, res) => {
    try {
        // First, expire any active subscriptions that have passed their expiry
        await db.query(
            `UPDATE pro_subscriptions SET status='expired'
             WHERE user_id=? AND status='active' AND expires_at <= NOW()`,
            [req.user.id]
        ).catch(() => {});

        // Fetch the most recent subscription (active or expired)
        const [rows] = await db.query(
            `SELECT * FROM pro_subscriptions
             WHERE user_id=? AND status IN ('active','expired')
             ORDER BY
               CASE WHEN status='active' THEN 0 ELSE 1 END,
               created_at DESC
             LIMIT 1`,
            [req.user.id]
        );

        if (rows.length === 0) {
            // No pro subscription ever — check free plan eligibility
            const [userMeta] = await db.query('SELECT created_at FROM users WHERE id=?', [req.user.id]);
            let freeDaysLeft = 0;
            if (userMeta.length > 0 && userMeta[0].created_at) {
                const regDate = new Date(userMeta[0].created_at);
                const diffDays = Math.floor((Date.now() - regDate) / (1000 * 60 * 60 * 24));
                freeDaysLeft = Math.max(0, 30 - diffDays);
            }
            return res.json({
                status: freeDaysLeft > 0 ? 'none' : 'none',
                plan: null,
                plan_name: null,
                free_days_left: freeDaysLeft,
                can_use_free: freeDaysLeft > 0,
            });
        }

        const sub = rows[0];
        const planInfo = PRO_PLANS[sub.plan] || {};

        if (sub.status === 'active') {
            const expiresAt = new Date(sub.expires_at);
            const daysLeft  = Math.max(0, Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60 * 24)));
            return res.json({
                status: 'active',
                plan: sub.plan,
                plan_name: planInfo.name || sub.plan,
                expires_at: sub.expires_at,
                days_left: daysLeft,
                max_bots: planInfo.bots,
                bot_duration_days: planInfo.botDays,
            });
        }

        // Expired
        return res.json({
            status: 'expired',
            plan: sub.plan,
            plan_name: planInfo.name || sub.plan,
            expires_at: sub.expires_at,
        });

    } catch (err) {
        console.error(chalk.red('[PRO STATUS ERROR]'), err.message);
        res.status(500).json({ message: 'Failed to fetch pro status' });
    }
});

// ── INITIATE PRO PURCHASE ────────────────────────────────────────────────────
app.post('/api/pro/initiate', getUser, async (req, res) => {
    const { plan } = req.body;
    if (!plan || !['half', 'full'].includes(plan))
        return res.status(400).json({ message: 'Invalid plan. Choose "half" or "full".' });

    const planInfo = PRO_PLANS[plan];
    if (!planInfo)
        return res.status(400).json({ message: 'Plan not found.' });

    try {
        // Check if user already has an active subscription for this plan
        const [activeSubs] = await db.query(
            `SELECT id FROM pro_subscriptions
             WHERE user_id=? AND status='active' AND plan=? AND expires_at > NOW()`,
            [req.user.id, plan]
        );
        if (activeSubs.length > 0)
            return res.status(400).json({ message: `You already have an active ${planInfo.name} subscription.` });

        // Cancel any pending subscriptions for this user
        await db.query(
            `UPDATE pro_subscriptions SET status='cancelled'
             WHERE user_id=? AND status='pending'`,
            [req.user.id]
        ).catch(() => {});

        // Create pending subscription
        const reference = 'PRO-' + plan.toUpperCase() + '-' + Date.now() + '-' + req.user.id;

        await db.query(
            `INSERT INTO pro_subscriptions (user_id, plan, status, amount, naira, reference)
             VALUES (?, ?, 'pending', ?, ?, ?)`,
            [req.user.id, plan, planInfo.price, planInfo.naira, reference]
        );

        addLog(req.user.id, `👑 Pro ${planInfo.name} initiated — ref: ${reference}`);

        res.json({
            success: true,
            reference,
            plan,
            plan_name: planInfo.name,
            amount: planInfo.price,
            naira: planInfo.naira,
            duration_days: planInfo.days,
            max_bots: planInfo.bots,
            bot_duration_days: planInfo.botDays,
            bank: {
                name: 'Paga',
                account: '3822792739',
                holder: 'stw-OxBot Services',
            },
            message: 'Transfer the exact amount and send proof to norply@oxbot.name.ng for activation.',
        });

    } catch (err) {
        console.error(chalk.red('[PRO INIT ERROR]'), err.message);
        res.status(500).json({ message: 'Failed to initiate pro plan.' });
    }
});

// ── ADMIN: ACTIVATE PRO SUBSCRIPTION ─────────────────────────────────────────
// Called by admin after confirming payment proof
app.post('/api/pro/activate', async (req, res) => {
    const { reference, adminKey } = req.body;

    // Simple admin key check — replace with proper admin auth in production
    const ADMIN_KEY = process.env.ADMIN_KEY || 'oxbot-admin-2025';
    if (adminKey !== ADMIN_KEY)
        return res.status(403).json({ message: 'Unauthorized. Invalid admin key.' });

    if (!reference)
        return res.status(400).json({ message: 'Reference is required.' });

    try {
        const [subs] = await db.query(
            'SELECT * FROM pro_subscriptions WHERE reference=? AND status="pending"',
            [reference]
        );
        if (!subs.length)
            return res.status(404).json({ message: 'No pending subscription found with that reference.' });

        const sub = subs[0];
        const planInfo = PRO_PLANS[sub.plan];
        const now = new Date();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + planInfo.days);

        await db.query(
            `UPDATE pro_subscriptions
             SET status='active', started_at=?, expires_at=?
             WHERE id=?`,
            [now, expiresAt, sub.id]
        );

        // Log to the user's console
        addLog(sub.user_id, `👑 ${planInfo.name} ACTIVATED! Expires: ${expiresAt.toLocaleDateString()} — ${planInfo.bots} bots, ${planInfo.botDays} days/bot`);

        console.log(chalk.green(`[PRO ACTIVATED] ${planInfo.name} for user ${sub.user_id} → expires ${expiresAt.toLocaleDateString()}`));

        res.json({
            success: true,
            message: `${planInfo.name} activated successfully!`,
            user_id: sub.user_id,
            plan: sub.plan,
            expires_at: expiresAt,
        });

    } catch (err) {
        console.error(chalk.red('[PRO ACTIVATE ERROR]'), err.message);
        res.status(500).json({ message: 'Failed to activate subscription.' });
    }
});

// ── ADMIN: GET PENDING PRO REQUESTS ──────────────────────────────────────────
app.get('/api/pro/pending', async (req, res) => {
    const ADMIN_KEY = process.env.ADMIN_KEY || 'oxbot-admin-2025';
    const key = req.headers['x-admin-key'];
    if (key !== ADMIN_KEY)
        return res.status(403).json({ message: 'Unauthorized.' });

    try {
        const [rows] = await db.query(
            `SELECT s.*, u.username, u.email
             FROM pro_subscriptions s
             JOIN users u ON u.id = s.user_id
             WHERE s.status='pending'
             ORDER BY s.created_at DESC`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});
// ══════════════════════════════════════════════════════════════════════════════
//  STATIC ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
//  ADD RESET PASSWORD COLUMNS TO USERS TABLE (in DB init section)
// ═════════════════════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════════════════════
//  RESET PASSWORD EMAIL TEMPLATE
// ══════════════════════════════════════════════════════════════════════════════

async function sendResetCodeEmail(toEmail, name, code) {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Reset Password - OxBot</title>
  <style>
    body{margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif}
    .wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .header{background:#16a34a;padding:32px 40px;text-align:center}
    .header h1{color:#fff;margin:0;font-size:24px;font-weight:800}
    .body{padding:36px 40px}
    .body h2{margin:0 0 8px;font-size:20px;color:#0f172a}
    .body p{color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px}
    .code-box{background:#f0fdf4;border:2px dashed #16a34a;border-radius:14px;padding:24px;text-align:center;margin:24px 0}
    .code-label{font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
    .code-value{font-size:42px;font-weight:800;color:#16a34a;letter-spacing:12px;font-family:'Courier New',monospace}
    .code-expiry{font-size:12px;color:#f59e0b;margin-top:12px}
    .warning-box{background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-top:20px;font-size:13px;color:#92400e;line-height:1.5}
    .footer{padding:20px 40px;text-align:center;font-size:12px;color:#94a3b8;border-top:1px solid #f1f5f9}
    a{color:#16a34a}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>🔐 Password Reset</h1>
    </div>
    <div class="body">
      <h2>Hi ${name},</h2>
      <p>We received a request to reset your OxBot password. Use the code below to proceed:</p>
      
      <div class="code-box">
        <div class="code-label">Verification Code</div>
        <div class="code-value">${code}</div>
        <div class="code-expiry">⏱ This code expires in 10 minutes</div>
      </div>
      
      <div class="warning-box">
        <strong>⚠️ Important:</strong><br>
        • Do not share this code with anyone.<br>
        • If you didn't request this, ignore this email — your password is safe.<br>
        • This code cannot be used to log in, only to reset your password.
      </div>
      
      <p style="margin-top:20px;text-align:center">
        <a href="${SITE_URL}/forgot-password" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:12px 32px;border-radius:10px;font-weight:600;font-size:15px">Enter Code →</a>
      </p>
    </div>
    <div class="footer">© ${new Date().getFullYear()} OxBot · <a href="${SITE_URL}">${SITE_URL.replace(/^https?:\/\//, '')}</a></div>
  </div>
</body>
</html>`;

    await mailer.sendMail({
        from:    '"OxBot" <noreply@oxbot.name.ng>',
        to:      toEmail,
        subject: `🔐 Password Reset Code: ${code}`,
        html,
        text:    `Hi ${name},\n\nYour OxBot password reset code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
    });
}

// ══════════════════════════════════════════════════════════════════════════════
//  FORGOT PASSWORD - SEND CODE
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    if (!email || !email.includes('@'))
        return res.status(400).json({ message: 'Please enter a valid email address.' });
    
    try {
        const [rows] = await db.query(
            'SELECT id, name, email FROM users WHERE email=? LIMIT 1',
            [email.trim().toLowerCase()]
        );
        
        // Always return success to prevent email enumeration
        // But only actually send if user exists
        if (rows.length === 0) {
            // Don't reveal that email doesn't exist
            return res.json({ 
                success: true, 
                message: 'If an account exists with this email, a reset code has been sent.' 
            });
        }
        
        const user = rows[0];
        
        // Generate 6-digit code
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        
        // Store code in database
        await db.query(
            'UPDATE users SET reset_code=?, reset_code_exp=? WHERE id=?',
            [code, expiresAt, user.id]
        );
        
        // Send email (fire-and-forget with logging)
        sendResetCodeEmail(user.email, user.name, code).catch(err => {
            console.error(chalk.red('❌ Reset code email failed:'), err.message);
        });
        
        console.log(chalk.cyan(`[RESET] Code sent to ${user.email}: ${code}`));
        
        res.json({ 
            success: true, 
            message: 'If an account exists with this email, a reset code has been sent.' 
        });
        
    } catch (err) {
        console.error(chalk.red('Forgot password error:'), err.message);
        // Still return generic message to prevent enumeration
        res.json({ 
            success: true, 
            message: 'If an account exists with this email, a reset code has been sent.' 
        });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
//  VERIFY RESET CODE
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/verify-reset-code', async (req, res) => {
    const { email, code } = req.body;
    
    if (!email || !code)
        return res.status(400).json({ message: 'Email and code are required.' });
    
    if (!/^\d{6}$/.test(code))
        return res.status(400).json({ message: 'Code must be 6 digits.' });
    
    try {
        const [rows] = await db.query(
            `SELECT id, name, reset_code, reset_code_exp 
             FROM users 
             WHERE email=? AND reset_code=? AND reset_code_exp > NOW()`,
            [email.trim().toLowerCase(), code]
        );
        
        if (rows.length === 0) {
            // Check if code exists but expired
            const [expired] = await db.query(
                'SELECT id FROM users WHERE email=? AND reset_code=? AND reset_code_exp <= NOW()',
                [email.trim().toLowerCase(), code]
            );
            
            if (expired.length > 0) {
                return res.status(400).json({ message: 'This code has expired. Please request a new one.' });
            }
            
            // Wrong code
            return res.status(400).json({ message: 'Invalid verification code. Please check and try again.' });
        }
        
        res.json({ 
            success: true, 
            message: 'Code verified successfully.' 
        });
        
    } catch (err) {
        console.error(chalk.red('Verify reset code error:'), err.message);
        res.status(500).json({ message: 'Verification failed. Please try again.' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
//  RESET PASSWORD
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/reset-password', async (req, res) => {
    const { email, code, newPassword } = req.body;
    
    if (!email || !code || !newPassword)
        return res.status(400).json({ message: 'All fields are required.' });
    
    if (newPassword.length < 6)
        return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    
    if (!/^\d{6}$/.test(code))
        return res.status(400).json({ message: 'Invalid code format.' });
    
    try {
        const [rows] = await db.query(
            `SELECT id, name, reset_code, reset_code_exp 
             FROM users 
             WHERE email=? AND reset_code=? AND reset_code_exp > NOW()`,
            [email.trim().toLowerCase(), code]
        );
        
        if (rows.length === 0) {
            const [expired] = await db.query(
                'SELECT id FROM users WHERE email=? AND reset_code=? AND reset_code_exp <= NOW()',
                [email.trim().toLowerCase(), code]
            );
            
            if (expired.length > 0) {
                return res.status(400).json({ message: 'This code has expired. Please request a new one.' });
            }
            
            return res.status(400).json({ message: 'Invalid verification code.' });
        }
        
        const user = rows[0];
        
        // Hash new password
        const hash = await bcrypt.hash(newPassword, 10);
        
        // Update password and clear reset code
        await db.query(
            `UPDATE users 
             SET password=?, reset_code=NULL, reset_code_exp=NULL 
             WHERE id=?`,
            [hash, user.id]
        );
        
        console.log(chalk.green(`[RESET] Password changed for ${email}`));
        
        res.json({ 
            success: true, 
            message: 'Password has been reset successfully!' 
        });
        
    } catch (err) {
        console.error(chalk.red('Reset password error:'), err.message);
        res.status(500).json({ message: 'Failed to reset password. Please try again.' });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
//  ADD FORGOT PASSWORD TO STATIC ROUTES (add to PAGE_MAP)
// ══════════════════════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ══════════════════════════════════════════════════════════════════════════════

const ADMIN_KEY = 'dominion';
// Static token derived from key — survives server restarts forever
const ADMIN_TOKEN = 'admin-' + crypto.createHash('sha256').update(ADMIN_KEY + '-oxbot-static').digest('hex');

function adminAuth(req, res, next) {
    const t = req.headers['x-admin-token']
           || req.headers['X-Admin-Token']
           || req.headers['x-admin-token'.toLowerCase()]
           || null;
    if (!t) return res.status(401).json({ message: 'Unauthorized — no token' });
    if (t !== ADMIN_TOKEN) return res.status(401).json({ message: 'Unauthorized — invalid token' });
    next();
}

// ── ADMIN LOGIN ───────────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
    const { key } = req.body;
    if (!key || key !== ADMIN_KEY) {
        console.log(chalk.yellow('[ADMIN] Failed login attempt'));
        return res.status(403).json({ message: 'Invalid admin key.' });
    }
    // Always return the same token — never changes between restarts
    console.log(chalk.green('[ADMIN] ✅ Login successful'));
    res.json({ token: ADMIN_TOKEN, message: 'Authenticated' });
});
// ── ADMIN STATS ───────────────────────────────────────────────────────────────
// ── ADMIN STATS ───────────────────────────────────────────────────────────────
// ── ADMIN STATS ───────────────────────────────────────────────────────────────
app.get('/api/admin/stats', adminAuth, async (req, res) => {
    try {
        let total_users = 0, active_bots = 0, active_pro = 0, pending_pro = 0, total_coins = 0, blocked_users = 0, expiring_soon = 0, expired_today = 0;

        try { const [r] = await db.query('SELECT COUNT(*) as c FROM users'); total_users = r[0].c; } catch (e) { console.error('[STATS] users:', e.message); }
        try { const [r] = await db.query('SELECT COUNT(*) as c FROM bots WHERE status="active"'); active_bots = r[0].c; } catch (e) { console.error('[STATS] bots:', e.message); }
        try { const [r] = await db.query('SELECT COUNT(*) as c FROM pro_subscriptions WHERE status="active" AND expires_at > NOW()'); active_pro = r[0].c; } catch (e) { console.error('[STATS] pro:', e.message); }
        try { const [r] = await db.query('SELECT COUNT(*) as c FROM pro_subscriptions WHERE status="pending"'); pending_pro = r[0].c; } catch (e) { console.error('[STATS] pending:', e.message); }
        try { const [r] = await db.query('SELECT COALESCE(SUM(balance),0) as c FROM users'); total_coins = Number(r[0].c); } catch (e) { console.error('[STATS] coins:', e.message); }
        try { const [r] = await db.query('SELECT COUNT(*) as c FROM users WHERE blocked=1'); blocked_users = r[0].c; } catch (e) { console.error('[STATS] blocked:', e.message); }
        
        // Count bots expiring within 24 hours
        try {
            const [r] = await db.query(
                `SELECT COUNT(*) as c FROM bots 
                 WHERE status="active" 
                   AND expires_at IS NOT NULL 
                   AND expires_at <= DATE_ADD(NOW(), INTERVAL 24 HOUR) 
                   AND expires_at > NOW()`
            );
            expiring_soon = r[0].c;
        } catch (e) { console.error('[STATS] expiring:', e.message); }
        
        // Count bots that expired today
        try {
            const [r] = await db.query(
                `SELECT COUNT(*) as c FROM bots 
                 WHERE status="inactive" 
                   AND expires_at IS NOT NULL 
                   AND expires_at <= NOW() 
                   AND expires_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );
            expired_today = r[0].c;
        } catch (e) { console.error('[STATS] expired_today:', e.message); }

        const data = { total_users, active_bots, active_pro, pending_pro, total_coins, blocked_users, expiring_soon, expired_today };
        console.log(chalk.cyan('[ADMIN] Stats:'), JSON.stringify(data));
        res.json(data);
    } catch (err) {
        console.error(chalk.red('[ADMIN] Stats error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});
// ── ADMIN USERS (with full plan info) ────────────────────────────────────────
app.get('/api/admin/users', adminAuth, async (req, res) => {
    try {
        const [users] = await db.query(
            `SELECT u.id, u.name, u.username, u.email, u.phone, u.balance, u.blocked, u.created_at,
                    (SELECT COUNT(*) FROM bots WHERE user_id=u.id AND status="active") as active_bots,
                    (SELECT COUNT(*) FROM bots WHERE user_id=u.id) as total_bots
             FROM users u ORDER BY u.created_at DESC`
        );

        if (!users.length) {
            console.log(chalk.cyan('[ADMIN] No users found'));
            return res.json([]);
        }

        const result = [];
        for (const u of users) {
            const [activePro] = await db.query(
                `SELECT id, plan, status, expires_at, started_at FROM pro_subscriptions
                 WHERE user_id=? AND status='active' AND expires_at > NOW()
                 ORDER BY created_at DESC LIMIT 1`,
                [u.id]
            );

            const [lastPro] = await db.query(
                `SELECT id, plan, status, expires_at FROM pro_subscriptions
                 WHERE user_id=?
                 ORDER BY created_at DESC LIMIT 1`,
                [u.id]
            );

            let current_plan = 'free';
            let plan_expires = null;
            let sub_id = null;

            if (activePro.length > 0) {
                current_plan = activePro[0].plan;
                plan_expires = activePro[0].expires_at;
                sub_id = activePro[0].id;
            } else if (lastPro.length > 0 && lastPro[0].status === 'expired') {
                current_plan = 'expired';
                plan_expires = lastPro[0].expires_at;
                sub_id = lastPro[0].id;
            }

            const diffDays = Math.floor((Date.now() - new Date(u.created_at)) / (1000 * 60 * 60 * 24));
            const can_use_free = diffDays <= 30;

            result.push({
                id: u.id,
                name: u.name,
                username: u.username,
                email: u.email,
                phone: u.phone,
                balance: Number(u.balance),
                blocked: u.blocked === 1,
                created_at: u.created_at,
                active_bots: u.active_bots,
                total_bots: u.total_bots,
                current_plan,
                plan_expires,
                sub_id,
                can_use_free,
                days_registered: diffDays,
            });
        }
        
        console.log(chalk.cyan('[ADMIN] Users fetched: ' + result.length + ' users'));
        res.json(result);
    } catch (err) {
        console.error(chalk.red('[ADMIN] Users error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN CHANGE USER PLAN ──────────────────────────────────────────────────
app.post('/api/admin/users/:id/plan', adminAuth, async (req, res) => {
    const { plan, days } = req.body;
    const userId = req.params.id;

    const validPlans = [...Object.keys(PRO_PLANS), 'free'];
    if (!plan) return res.status(400).json({ message: 'Plan is required' });

    try {
        if (plan === 'free') {
            const [activeSubs] = await db.query(
                `SELECT id FROM pro_subscriptions WHERE user_id=? AND status='active' AND expires_at > NOW()`,
                [userId]
            );
            for (const s of activeSubs) {
                await db.query(
                    `UPDATE pro_subscriptions SET status='expired', expires_at=NOW() WHERE id=?`,
                    [s.id]
                );
            }
            addLog(userId, '👑 Admin changed plan to FREE');
            console.log(chalk.yellow(`[ADMIN] User ${userId} plan → FREE`));
            return res.json({ success: true, message: 'Plan changed to Free', current_plan: 'free' });
        }

        if (!PRO_PLANS[plan]) {
            return res.status(400).json({ message: `Invalid plan. Valid: ${validPlans.join(', ')}` });
        }

        const planInfo = PRO_PLANS[plan];
        const durationDays = days || planInfo.days;
        const now = new Date();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + durationDays);

        const [existing] = await db.query(
            `SELECT id, expires_at FROM pro_subscriptions 
             WHERE user_id=? AND plan=? AND status='active' AND expires_at > NOW()
             LIMIT 1`,
            [userId, plan]
        );

        if (existing.length > 0) {
            const oldExpiry = new Date(existing[0].expires_at);
            const newExpiry = new Date();
            if (oldExpiry > now) {
                newExpiry.setTime(oldExpiry.getTime() + (durationDays * 24 * 60 * 60 * 1000));
            } else {
                newExpiry.setTime(now.getTime() + (durationDays * 24 * 60 * 60 * 1000));
            }
            await db.query(`UPDATE pro_subscriptions SET expires_at=? WHERE id=?`, [newExpiry, existing[0].id]);
            addLog(userId, `👑 Admin EXTENDED ${planInfo.name} by ${durationDays} days → ${newExpiry.toLocaleDateString()}`);
            console.log(chalk.green(`[ADMIN] User ${userId} ${planInfo.name} EXTENDED → ${newExpiry.toLocaleDateString()}`));
            return res.json({ success: true, message: `${planInfo.name} extended by ${durationDays} days`, current_plan: plan, expires_at: newExpiry });
        }

        await db.query(
            `UPDATE pro_subscriptions SET status='expired', expires_at=NOW() 
             WHERE user_id=? AND status='active' AND expires_at > NOW()`,
            [userId]
        );

       const reference = 'ADMIN-' + Date.now() + '-' + crypto.randomBytes(8).toString('hex');
await db.query(
    `INSERT INTO pro_subscriptions (user_id, plan, reference, amount, naira, status, started_at, expires_at)
     VALUES (?, ?, ?, 0, 0, 'active', ?, ?)`,
    [userId, plan, reference, now, expiresAt]
);

        addLog(userId, `👑 Admin set plan to ${planInfo.name} (${durationDays} days) → ${expiresAt.toLocaleDateString()}`);
        console.log(chalk.green(`[ADMIN] User ${userId} plan → ${planInfo.name} (${durationDays}d) → ${expiresAt.toLocaleDateString()}`));

        res.json({ success: true, message: `${planInfo.name} activated for ${durationDays} days`, current_plan: plan, expires_at: expiresAt });
    } catch (err) {
        console.error(chalk.red('[ADMIN] Plan change error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN BLOCK / UNBLOCK ───────────────────────────────────────────────────
app.post('/api/admin/users/:id/block', adminAuth, async (req, res) => {
    try {
        await db.query('UPDATE users SET blocked=1 WHERE id=?', [req.params.id]);
        const [bots] = await db.query('SELECT session_id FROM bots WHERE user_id=? AND status="active"', [req.params.id]);
        for (const b of bots) {
            stoppedBots.add(b.session_id);
            const bot = activeBots.get(b.session_id);
            if (bot?.sock) { try { bot.sock.end(); } catch {} }
            activeBots.delete(b.session_id);
            await db.query('UPDATE bots SET status="inactive" WHERE session_id=?', [b.session_id]).catch(() => {});
        }
        global.botConnected = activeBots.size > 0;
        addLog(req.params.id, '🚫 Account BLOCKED by admin');
        console.log(chalk.red(`[ADMIN] User ${req.params.id} BLOCKED, ${bots.length} bot(s) stopped`));
        res.json({ success: true, message: 'User blocked' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post('/api/admin/users/:id/unblock', adminAuth, async (req, res) => {
    try {
        await db.query('UPDATE users SET blocked=0 WHERE id=?', [req.params.id]);
        addLog(req.params.id, '✅ Account UNBLOCKED by admin');
        console.log(chalk.green(`[ADMIN] User ${req.params.id} UNBLOCKED`));
        res.json({ success: true, message: 'User unblocked' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN TOP UP ──────────────────────────────────────────────────────────────
app.post('/api/admin/topup', adminAuth, async (req, res) => {
    const { user_id, coins, reason } = req.body;
    if (!user_id || !coins || coins < 1)
        return res.status(400).json({ message: 'user_id and valid coins amount required' });
    try {
        await db.query('UPDATE users SET balance=balance+? WHERE id=?', [coins, user_id]);
        addLog(user_id, `👑 Admin added ${coins} coins${reason ? ' (' + reason + ')' : ''}`);
        console.log(chalk.green(`[ADMIN] +${coins} coins → user ${user_id}`));
        res.json({ success: true, message: `Added ${coins} coins` });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN DEDUCT COINS ───────────────────────────────────────────────────────
app.post('/api/admin/deduct', adminAuth, async (req, res) => {
    const { user_id, coins, reason } = req.body;
    if (!user_id || !coins || coins < 1)
        return res.status(400).json({ message: 'user_id and valid coins amount required' });
    try {
        const [u] = await db.query('SELECT balance FROM users WHERE id=?', [user_id]);
        if (!u.length) return res.status(404).json({ message: 'User not found' });
        if (Number(u[0].balance) < coins) return res.status(400).json({ message: 'Insufficient balance' });
        await db.query('UPDATE users SET balance=balance-? WHERE id=?', [coins, user_id]);
        addLog(user_id, `👑 Admin deducted ${coins} coins${reason ? ' (' + reason + ')' : ''}`);
        console.log(chalk.yellow(`[ADMIN] -${coins} coins → user ${user_id}`));
        res.json({ success: true, message: `Deducted ${coins} coins` });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN SET BALANCE ────────────────────────────────────────────────────────
app.post('/api/admin/setbalance', adminAuth, async (req, res) => {
    const { user_id, coins, reason } = req.body;
    if (user_id === undefined || coins === undefined || coins < 0)
        return res.status(400).json({ message: 'user_id and valid coins amount required' });
    try {
        await db.query('UPDATE users SET balance=? WHERE id=?', [coins, user_id]);
        addLog(user_id, `👑 Admin set balance to ${coins} coins${reason ? ' (' + reason + ')' : ''}`);
        console.log(chalk.cyan(`[ADMIN] Balance set to ${coins} → user ${user_id}`));
        res.json({ success: true, message: `Balance set to ${coins}` });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN SUBSCRIPTIONS ──────────────────────────────────────────────────────
app.get('/api/admin/subscriptions', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT s.*, u.username, u.email, u.phone, u.name
             FROM pro_subscriptions s JOIN users u ON u.id = s.user_id
             ORDER BY s.created_at DESC`
        );
        const result = rows.map(s => {
            let days_left = 0;
            if (s.status === 'active' && s.expires_at) {
                days_left = Math.max(0, Math.ceil((new Date(s.expires_at) - Date.now()) / (1000 * 60 * 60 * 24)));
            }
            return { ...s, days_left, naira: Number(s.naira) };
        });
        res.json(result);
    } catch (err) { res.status(500).json({ message: err.message }); }
});

app.get('/api/admin/subscriptions/pending', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT s.*, u.username, u.email, u.phone, u.name
             FROM pro_subscriptions s JOIN users u ON u.id = s.user_id
             WHERE s.status='pending'
             ORDER BY s.created_at DESC`
        );
        res.json(rows.map(r => ({ ...r, naira: Number(r.naira) })));
    } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post('/api/admin/subscriptions/activate', adminAuth, async (req, res) => {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ message: 'Reference required' });
    try {
        const [subs] = await db.query(
            'SELECT * FROM pro_subscriptions WHERE reference=? AND status="pending"', [reference]
        );
        if (!subs.length) return res.status(404).json({ message: 'No pending subscription found' });

        const sub = subs[0];
        const planInfo = PRO_PLANS[sub.plan];
        const now = new Date();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + planInfo.days);

        await db.query(
            `UPDATE pro_subscriptions SET status='active', started_at=?, expires_at=? WHERE id=?`,
            [now, expiresAt, sub.id]
        );

        addLog(sub.user_id, `👑 ${planInfo.name} ACTIVATED! Expires: ${expiresAt.toLocaleDateString()} — ${planInfo.bots} bots, ${planInfo.botDays} days/bot`);
        console.log(chalk.green(`[ADMIN] Pro activated: ${planInfo.name} for user ${sub.user_id} → ${expiresAt.toLocaleDateString()}`));

        res.json({ success: true, message: `${planInfo.name} activated`, expires_at: expiresAt });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post('/api/admin/subscriptions/:ref/cancel', adminAuth, async (req, res) => {
    try {
        const [subs] = await db.query(
            'SELECT * FROM pro_subscriptions WHERE reference=? AND status="pending"', [req.params.ref]
        );
        if (!subs.length) return res.status(404).json({ message: 'No pending subscription found' });
        await db.query("UPDATE pro_subscriptions SET status='cancelled' WHERE id=?", [subs[0].id]);
        console.log(chalk.yellow(`[ADMIN] Sub cancelled: ${req.params.ref}`));
        res.json({ success: true, message: 'Subscription cancelled' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN DEPOSITS ───────────────────────────────────────────────────────────
app.get('/api/admin/deposits', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT d.*, u.username FROM deposits d JOIN users u ON u.id = d.user_id ORDER BY d.created_at DESC LIMIT 200`
        );
        res.json(rows.map(d => ({ ...d, amount: Number(d.amount), coins: Number(d.coins) })));
    } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post('/api/admin/deposits/confirm', adminAuth, async (req, res) => {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ message: 'Reference required' });
    try {
        const [rows] = await db.query(
            'SELECT * FROM deposits WHERE reference=? AND status="pending"', [reference]
        );
        if (!rows.length) return res.status(404).json({ message: 'Not found or already processed' });
        const dep = rows[0];
        await db.query('UPDATE deposits SET status="confirmed" WHERE reference=?', [reference]);
        await db.query('UPDATE users SET balance=balance+? WHERE id=?', [dep.coins, dep.user_id]);
        addLog(dep.user_id, `✅ Admin confirmed deposit: +${dep.coins} coins`);
        console.log(chalk.green(`[ADMIN] Deposit confirmed: ${dep.coins} coins → user ${dep.user_id}`));
        res.json({ success: true, message: `${dep.coins} coins credited` });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

app.post('/api/admin/deposits/reject', adminAuth, async (req, res) => {
    const { reference, reason } = req.body;
    if (!reference) return res.status(400).json({ message: 'Reference required' });
    try {
        const [rows] = await db.query(
            'SELECT * FROM deposits WHERE reference=? AND status="pending"', [reference]
        );
        if (!rows.length) return res.status(404).json({ message: 'Not found or already processed' });
        await db.query('UPDATE deposits SET status="rejected" WHERE reference=?', [reference]);
        addLog(rows[0].user_id, `❌ Admin rejected deposit${reason ? ': ' + reason : ''}`);
        console.log(chalk.red(`[ADMIN] Deposit rejected: ${reference}`));
        res.json({ success: true, message: 'Deposit rejected' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN SEARCH USER ────────────────────────────────────────────────────────
app.get('/api/admin/users/search', adminAuth, async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ message: 'Search query required' });
    try {
        const [users] = await db.query(
            `SELECT u.id, u.name, u.username, u.email, u.phone, u.balance, u.blocked, u.created_at,
                    (SELECT COUNT(*) FROM bots WHERE user_id=u.id AND status="active") as active_bots,
                    (SELECT COUNT(*) FROM bots WHERE user_id=u.id) as total_bots,
                    (SELECT plan FROM pro_subscriptions WHERE user_id=u.id AND status='active' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1) as current_plan
             FROM users u
             WHERE u.username LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR u.name LIKE ? OR CAST(u.id AS CHAR) = ?
             ORDER BY u.created_at DESC LIMIT 20`,
            [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, q]
        );
        res.json(users.map(u => ({
            ...u,
            balance: Number(u.balance),
            blocked: u.blocked === 1,
            current_plan: u.current_plan || 'free',
        })));
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN DELETE USER ────────────────────────────────────────────────────────
app.delete('/api/admin/users/:id', adminAuth, async (req, res) => {
    try {
        const userId = req.params.id;
        const [bots] = await db.query('SELECT session_id FROM bots WHERE user_id=?', [userId]);
        for (const b of bots) {
            stoppedBots.add(b.session_id);
            const bot = activeBots.get(b.session_id);
            if (bot?.sock) { try { bot.sock.end(); } catch {} }
            activeBots.delete(b.session_id);
        }
        await db.query('DELETE FROM bots WHERE user_id=?', [userId]);
        await db.query('DELETE FROM pro_subscriptions WHERE user_id=?', [userId]);
        await db.query('DELETE FROM deposits WHERE user_id=?', [userId]);
        await db.query('DELETE FROM referrals WHERE referrer_id=? OR referred_id=?', [userId]);
        await db.query('DELETE FROM users WHERE id=?', [userId]);
        global.botConnected = activeBots.size > 0;
        console.log(chalk.red(`[ADMIN] User ${userId} DELETED completely`));
        res.json({ success: true, message: 'User deleted' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});




// ══════════════════════════════════════════════════════════════════════════════
//  ADMIN: PAIRED SESSIONS (all users' session IDs visible here)
// ══════════════════════════════════════════════════════════════════════════════

// Get all paired sessions (most recent first)
app.get('/api/admin/paired-sessions', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT ps.*, 
                    u.username, u.email, u.phone as user_phone, u.name as user_name,
                    (SELECT COUNT(*) FROM bots WHERE session_id = ps.session_id) as bot_count,
                    (SELECT status FROM bots WHERE session_id = ps.session_id LIMIT 1) as bot_status
             FROM paired_sessions ps
             JOIN users u ON u.id = ps.user_id
             ORDER BY ps.paired_at DESC
             LIMIT 200`
        );

        // Also get the actual session data (creds) for sessions that still exist
        const result = rows.map(ps => {
            const sessionFolder = path.join(SESSION_DIR, ps.session_id);
            const credsPath = path.join(sessionFolder, 'creds.json');
            let hasCreds = false;
            let credsSize = 0;
            
            try {
                if (fs.existsSync(credsPath)) {
                    hasCreds = true;
                    credsSize = fs.statSync(credsPath).size;
                }
            } catch {}

            return {
                ...ps,
                has_creds: hasCreds,
                creds_size: credsSize,
                session_exists: fs.existsSync(sessionFolder),
                time_ago: getTimeAgo(new Date(ps.paired_at)),
            };
        });

        console.log(chalk.cyan(`[ADMIN] Paired sessions fetched: ${result.length}`));
        res.json(result);

    } catch (err) {
        console.error(chalk.red('[ADMIN] Paired sessions error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

// Get only recent/unread paired sessions (last 24 hours)
app.get('/api/admin/paired-sessions/recent', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT ps.*, u.username, u.email, u.name as user_name, u.phone as user_phone
             FROM paired_sessions ps
             JOIN users u ON u.id = ps.user_id
             WHERE ps.paired_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
               AND ps.status = 'paired'
             ORDER BY ps.paired_at DESC`
        );

        res.json(rows.map(r => ({
            ...r,
            time_ago: getTimeAgo(new Date(r.paired_at)),
        })));

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get count of new/unread paired sessions (for badge notification)
app.get('/api/admin/paired-sessions/count', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT COUNT(*) as count FROM paired_sessions 
             WHERE paired_at > DATE_SUB(NOW(), INTERVAL 24 HOUR) 
               AND status = 'paired'`
        );
        res.json({ count: rows[0].count });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Mark paired session as activated (when user activates a bot with it)
app.post('/api/admin/paired-sessions/:sessionId/mark-activated', adminAuth, async (req, res) => {
    try {
        await db.query(
            `UPDATE paired_sessions SET status = 'activated' WHERE session_id = ?`,
            [req.params.sessionId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Delete a paired session record
app.delete('/api/admin/paired-sessions/:sessionId', adminAuth, async (req, res) => {
    try {
        await db.query('DELETE FROM paired_sessions WHERE session_id = ?', [req.params.sessionId]);
        console.log(chalk.yellow(`[ADMIN] Paired session record deleted: ${req.params.sessionId}`));
        res.json({ success: true, message: 'Record deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Helper function for time ago
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
}

// ── Also update paired_sessions status when bot is activated ─────────
// Add this hook inside the /api/activate-bot route after the INSERT/UPDATE bots query
// We'll add a small helper that runs after bot activation
async function markSessionActivated(sessionId) {
    try {
        await db.query(
            `UPDATE paired_sessions SET status = 'activated' WHERE session_id = ?`,
            [sessionId]
        );
    } catch {}
}
// ══════════════════════════════════════════════════════════════════════════════
//  PAGE ROUTES
// ══════════════════════════════════════════════════════════════════════════════

const PAGE_MAP = {
    '/':                'index.html',
    '/login':           'login.html',
    '/register':        'register.html',
    '/dashboard':       'dashboard.html',
    '/verify-email':    'verify-email.html',
    '/forgot-password': 'forgot-password.html',
    '/admin':           'admin.html',
    '/api-console-telegram': 'api-console-telegram.php',
    '/console-telegram': 'console-telegram.php',
};
Object.entries(PAGE_MAP).forEach(([route, file]) => {
    app.get(route, (_req, res) => {
        const fp = path.join(PUBLIC_DIR, file);
        if (fs.existsSync(fp)) return res.sendFile(fp);
        res.status(404).send('Not found');
    });
});










// // Add this line to the PAGE_MAP object:
// // '/forgot-password': 'forgot-password.html',
// const PAGE_MAP = {
//     '/':             'index.html',
//     '/login':        'login.html',
//     '/register':     'register.html',
//     '/dashboard':    'dashboard.html',
//     '/verify-email': 'verify-email.html',
//     '/forgot-password': 'forgot-password.html',  // ← ADD THIS
// };
// Object.entries(PAGE_MAP).forEach(([route, file]) => {
//     app.get(route, (_req, res) => {
//         const fp = path.join(PUBLIC_DIR, file);
//         if (fs.existsSync(fp)) return res.sendFile(fp);
//         res.status(404).send('Not found');
//     });
// });

// ── BOT SETTINGS — ANTIBAN / AUTOREPLY ───────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
//  BOT FEATURES (antiban, autoreply, bot image) — PRO ONLY
// ══════════════════════════════════════════════════════════════════════════════

async function checkProPlan(userId) {
    const [rows] = await db.query(
        `SELECT id FROM pro_subscriptions WHERE user_id=? AND status='active' AND expires_at > NOW() LIMIT 1`,
        [userId]
    );
    return rows.length > 0;
}

// ── GET BOT FEATURES ──────────────────────────────────────────────
app.get('/api/bot-features/:sessionId', getUser, async (req, res) => {
    const sessionId = extractSessionId(req.params.sessionId);
    const [bots] = await db.query('SELECT id FROM bots WHERE session_id=? AND user_id=?', [sessionId, req.user.id]);
    if (!bots.length) return res.status(404).json({ message: 'Bot not found' });
    try {
        const [rows] = await db.query(
            'SELECT antiban, autoreply, autoreply_message, autotyping, antidelete, bot_image_url FROM bot_settings WHERE session_id=?',
            [sessionId]
        );
        const isPro = await checkProPlan(req.user.id);
        res.json({
            ...(rows[0] || { antiban: 0, autoreply: 0, autoreply_message: '', autotyping: 0, antidelete: 0 }),
            is_pro: isPro
        });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── TOGGLE ANTIBAN ────────────────────────────────────────────────
app.post('/api/bot-features/antiban', getUser, async (req, res) => {
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

// ── TOGGLE AUTOREPLY ──────────────────────────────────────────────
app.post('/api/bot-features/autoreply', getUser, async (req, res) => {
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

// ── TOGGLE AUTOTYPING ─────────────────────────────────────────────
app.post('/api/bot-features/autotyping', getUser, async (req, res) => {
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

// ── TOGGLE ANTIDELETE ─────────────────────────────────────────────
app.post('/api/bot-features/antidelete', getUser, async (req, res) => {
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

// ── UPLOAD BOT IMAGE ──────────────────────────────────────────────
app.post('/api/bot-features/upload-image', getUser, async (req, res) => {
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

// ── GET BOT IMAGE ─────────────────────────────────────────────────
app.get('/api/bot-features/image/:sessionId', getUser, async (req, res) => {
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
app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ message: 'Not found' });
    const fp = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(fp)) return res.sendFile(fp);
    res.send('OxBot is running.');
});

// ══════════════════════════════════════════════════════════════════════════════
//  AUTO-RECONNECT ACTIVE BOTS ON STARTUP
// ══════════════════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════════════════
//  EXPIRE PRO SUBSCRIPTIONS CRON (runs every 5 minutes)
// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════
//  GET ANY ACTIVE SOCKET (helper for admin features)
// ══════════════════════════════════════════════════════════════════

function getAnySocket() {
    for (const [sessionId, botData] of activeBots) {
        if (botData.sock && botData.openedAt > 0) {
            return botData.sock;
        }
    }
    return null;
}

// ═══ CREATE / RESOLVE CHANNEL ════════════════════════════════════
setInterval(async () => {
    try {
        const [result] = await db.query(
            `UPDATE pro_subscriptions SET status='expired'
             WHERE status='active' AND expires_at <= NOW()`
        );
        if (result.affectedRows > 0) {
            console.log(chalk.yellow(`[PRO] Expired ${result.affectedRows} subscription(s)`));
        }
    } catch {}
}, 5 * 60 * 1000);



// ══════════════════════════════════════════════════════════════════════════════
//  AUTO-DELETE EXPIRED BOTS CRON (runs every 30 minutes)
// ══════════════════════════════════════════════════════════════════════════════
setInterval(async () => {
    try {
        const [expired] = await db.query(
            `SELECT session_id, user_id, bot_name FROM bots WHERE expires_at IS NOT NULL AND expires_at <= NOW()`
        );
        if (!expired.length) return;

        console.log(chalk.yellow(`[CRON] Found ${expired.length} expired bot(s) — cleaning up...`));

        for (const bot of expired) {
            // Stop active connection if running
            stoppedBots.add(bot.session_id);
            const active = activeBots.get(bot.session_id);
            if (active?.sock) {
                try { active.sock.logout().catch(() => {}); } catch {}
                try { active.sock.ws?.close(); } catch {}
                try { active.sock.end(); } catch {}
            }
            activeBots.delete(bot.session_id);
            connectingBots.delete(bot.session_id);
            reconnectLocks.delete(bot.session_id);
            reconnectAttempts.delete(bot.session_id);

            // Delete from DB
            await db.query('DELETE FROM bots         WHERE session_id=?', [bot.session_id]).catch(() => {});
            await db.query('DELETE FROM bot_settings WHERE session_id=?', [bot.session_id]).catch(() => {});
            await db.query('DELETE FROM seen_statuses WHERE session_id=?', [bot.session_id]).catch(() => {});

            // Delete session folder
            const folder = path.join(SESSION_DIR, bot.session_id);
            if (fs.existsSync(folder)) {
                try {
                    fs.rmSync(folder, { recursive: true, force: true });
                    console.log(chalk.red(`[CRON] Deleted session folder: ${bot.session_id}`));
                } catch (e) {
                    console.log(chalk.yellow(`[CRON] Could not delete folder ${bot.session_id}: ${e.message}`));
                }
            }

            addLog(bot.user_id, `🗑️ Bot "${bot.bot_name}" expired and was automatically deleted.`);
            console.log(chalk.red(`[CRON] Expired bot deleted: ${bot.bot_name} (${bot.session_id})`));
        }

        global.botConnected = activeBots.size > 0;
    } catch (err) {
        console.error(chalk.red('[CRON] Expired bot cleanup error:'), err.message);
    }
}, 30 * 60 * 1000);
// ══════════════════════════════════════════════════════════════════════════════
//  START SERVER
// ══════════════════════════════════════════════════════════════════════════════

// ═══ CREATE / RESOLVE CHANNEL ════════════════════════════════════

app.post('/api/create-channel', async (req, res) => {
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

app.get('/api/resolve-channel', async (req, res) => {
    const sock = getAnySocket();
    if (!sock) return res.status(503).json({ error: 'No bot online' });

    try {
        console.log(chalk.cyan('[CHANNEL] Resolving 0029VbBwz6gDTkK9heWqFy1v'));

        const result = await sock.query({
            tag: 'iq',
            attrs: {
                type: 'get',
                id: 'resolve_' + Date.now(),
                to: 's.whatsapp.net',
                xmlns: 'w:news:1',
            },
            content: [
                { tag: 'newsletter', attrs: { id: '0029VbBwz6gDTkK9heWqFy1v' } }
            ]
        });

        console.log(chalk.green('[CHANNEL] Response:'), JSON.stringify(result, null, 2));

        let foundJid = null;
        let foundName = null;
        function dig(node) {
            if (!node) return;
            if (node.attrs?.jid?.includes('@newsletter')) foundJid = node.attrs.jid;
            if (node.attrs?.name) foundName = node.attrs.name;
            if (Array.isArray(node.content)) node.content.forEach(c => typeof c === 'object' && dig(c));
            if (node.content && typeof node.content === 'object' && !Array.isArray(node.content)) dig(node.content);
        }
        dig(result);

        if (foundJid) return res.json({ success: true, jid: foundJid, name: foundName, raw: result });
        res.json({ success: false, message: 'JID not found', raw: result });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/debug-bots', (_req, res) => {
    const list = [];
    for (const [id, bot] of activeBots) {
        list.push({ sessionId: id, botName: bot.botName, hasSocket: !!bot.sock, openedAt: bot.openedAt, isOnline: bot.openedAt > 0 });
    }
    res.json({ totalInMap: activeBots.size, bots: list, connectingCount: connectingBots.size, globalConnected: global.botConnected });
});

// ══════════════════════════════════════════════════════════════════════════════
//  ADMIN: ACTIVE BOTS MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/active-bots', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT b.*, u.username, u.email, u.phone, u.name as user_name
             FROM bots b
             JOIN users u ON u.id = b.user_id
             WHERE b.status = 'active'
             ORDER BY b.expires_at ASC`
        );

        const result = rows.map(b => {
            const botData = activeBots.get(b.session_id);
            const expiresAt = b.expires_at ? new Date(b.expires_at) : null;
            const now = new Date();
            let daysLeft = null;
            let hoursLeft = null;
            
            if (expiresAt) {
                const diffMs = expiresAt - now;
                daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                hoursLeft = Math.floor(diffMs / (1000 * 60 * 60));
            }

            return {
                session_id: b.session_id,
                user_id: b.user_id,
                bot_name: b.bot_name,
                whatsapp_name: b.whatsapp_name || botData?.waName || null,
                server: b.server,
                expires_at: b.expires_at,
                days_left: daysLeft,
                hours_left: hoursLeft,
                isOnline: !!(botData && botData.sock && botData.openedAt > 0),
                isConnecting: connectingBots.has(b.session_id),
                username: b.username,
                email: b.email,
                phone: b.phone,
                user_name: b.user_name,
                created_at: b.created_at,
            };
        });

        res.json(result);
    } catch (err) {
        console.error(chalk.red('[ADMIN] Active bots error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/admin/stop-bot/:sessionId', adminAuth, async (req, res) => {
    const sessionId = req.params.sessionId;
    
    try {
        const [bots] = await db.query(
            'SELECT * FROM bots WHERE session_id=? AND status="active"',
            [sessionId]
        );
        
        if (!bots.length) {
            return res.status(404).json({ message: 'Bot not found or already inactive' });
        }

        const bot = bots[0];

        stoppedBots.add(sessionId);
        connectingBots.delete(sessionId);
        reconnectLocks.delete(sessionId);
        reconnectAttempts.delete(sessionId);

        const botData = activeBots.get(sessionId);
        if (botData?.sock) {
            try { botData.sock.logout().catch(() => {}); } catch {}
            try { botData.sock.ws?.close(); } catch {}
            try { botData.sock.end(); } catch {}
        }
        activeBots.delete(sessionId);
        global.botConnected = activeBots.size > 0;

        await db.query('UPDATE bots SET status="inactive" WHERE session_id=?', [sessionId]);

        addLog(bot.user_id, `🛑 Bot "${bot.bot_name}" was stopped by admin.`);

        console.log(chalk.yellow(`[ADMIN] Bot stopped: ${bot.bot_name} (${sessionId})`));
        res.json({ success: true, message: `Bot "${bot.bot_name}" stopped successfully` });

    } catch (err) {
        console.error(chalk.red('[ADMIN] Stop bot error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/admin/send-message', adminAuth, async (req, res) => {
    const { session_id, message } = req.body;
    
    if (!session_id || !message) {
        return res.status(400).json({ message: 'session_id and message are required' });
    }

    try {
        const botData = activeBots.get(session_id);
        
        if (!botData || !botData.sock || botData.openedAt <= 0) {
            return res.status(400).json({ message: 'Bot is not online. Cannot send message.' });
        }

        const [bots] = await db.query('SELECT * FROM bots WHERE session_id=?', [session_id]);
        if (!bots.length) return res.status(404).json({ message: 'Bot not found' });

        const bot = bots[0];
        const sock = botData.sock;
        const waNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : null;
        
        if (!waNumber) {
            return res.status(400).json({ message: 'Could not determine WhatsApp number' });
        }

        await sock.sendMessage(waNumber + '@s.whatsapp.net', { text: message });

        addLog(bot.user_id, `📨 Admin sent message via "${bot.bot_name}"`);

        console.log(chalk.green(`[ADMIN] Message sent via bot ${bot.bot_name} to user ${bot.user_id}`));
        res.json({ success: true, message: 'Message sent successfully' });

    } catch (err) {
        console.error(chalk.red('[ADMIN] Send message error:'), err.message);
        res.status(500).json({ message: 'Failed to send message: ' + err.message });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
//  EXPIRY WARNING & AUTO-STOP CRON
// ══════════════════════════════════════════════════════════════════════════════

const expiryWarningsSent = new Map();

setInterval(async () => {
    try {
        const now = new Date();
        const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        
        // ── SEND 24-HOUR WARNING ──────────────────────────────────────
        const [expiringSoon] = await db.query(
            `SELECT b.*, u.username, u.email, u.phone
             FROM bots b
             JOIN users u ON u.id = b.user_id
             WHERE b.status = 'active' 
               AND b.expires_at IS NOT NULL 
               AND b.expires_at <= ?
               AND b.expires_at > NOW()`,
            [oneDayFromNow]
        );

        for (const bot of expiringSoon) {
            const warningState = expiryWarningsSent.get(bot.session_id) || {};
            if (warningState.warned1day) continue;

            const expiresAt = new Date(bot.expires_at);
            const hoursLeft = Math.floor((expiresAt - now) / (1000 * 60 * 60));
            const botData = activeBots.get(bot.session_id);

            if (botData?.sock && botData.openedAt > 0) {
                try {
                    const waNumber = botData.sock.user?.id ? botData.sock.user.id.split(':')[0].split('@')[0] : null;
                    if (waNumber) {
                        const warningMsg = `⚠️ *BOT EXPIRY WARNING*\n\n` +
                            `Your bot "*${bot.bot_name}*" will expire in *${hoursLeft} hour${hoursLeft !== 1 ? 's' : ''}*.\n\n` +
                            `📋 *Details:*\n` +
                            `• Bot: ${bot.bot_name}\n` +
                            `• Expires: ${expiresAt.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })}\n\n` +
                            `To continue using this bot:\n` +
                            `1. Log in to ${SITE_URL}/dashboard\n` +
                            `2. Ensure you have 20 coins or upgrade to Pro\n` +
                            `3. Go to your bots and click "Start"\n\n` +
                            `_Your bot will be automatically stopped when it expires._\n\n` +
                            `— *OxBot System*`;

                        await botData.sock.sendMessage(waNumber + '@s.whatsapp.net', { text: warningMsg });
                        console.log(chalk.yellow(`[EXPIRY] Warning sent for ${bot.bot_name} (${hoursLeft}h left)`));
                        addLog(bot.user_id, `⚠️ Expiry warning sent for "${bot.bot_name}" (${hoursLeft}h left)`);
                    }
                } catch (err) {
                    console.error(chalk.red(`[EXPIRY] Failed to send warning for ${bot.bot_name}:`), err.message);
                }
            }

            expiryWarningsSent.set(bot.session_id, { ...warningState, warned1day: true });
        }

        // ── STOP EXPIRED BOTS ──────────────────────────────────────
        const [expired] = await db.query(
            `SELECT b.*, u.username, u.email, u.phone
             FROM bots b
             JOIN users u ON u.id = b.user_id
             WHERE b.status = 'active' 
               AND b.expires_at IS NOT NULL 
               AND b.expires_at <= NOW()`
        );

        for (const bot of expired) {
            const warningState = expiryWarningsSent.get(bot.session_id) || {};
            if (warningState.stopped) continue;

            const botData = activeBots.get(bot.session_id);

            // Send final message before stopping
            if (botData?.sock && botData.openedAt > 0) {
                try {
                    const waNumber = botData.sock.user?.id ? botData.sock.user.id.split(':')[0].split('@')[0] : null;
                    if (waNumber) {
                        const stopMsg = `🛑 *BOT EXPIRED & STOPPED*\n\n` +
                            `Your bot "*${bot.bot_name}*" has expired and has been automatically stopped.\n\n` +
                            `📋 *Summary:*\n` +
                            `• Bot: ${bot.bot_name}\n` +
                            `• Expired: ${now.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })}\n\n` +
                            `To reactivate this bot:\n` +
                            `1. Log in to ${SITE_URL}/dashboard\n` +
                            `2. Ensure you have 20 coins or upgrade to Pro plan\n` +
                            `3. Go to your bots and click "Start"\n\n` +
                            `Need help? Contact noreply@oxbot.name.ng\n\n` +
                            `— *OxBot System*`;

                        await botData.sock.sendMessage(waNumber + '@s.whatsapp.net', { text: stopMsg });
                        console.log(chalk.yellow(`[EXPIRY] Stop notice sent for ${bot.bot_name}`));
                    }
                } catch (err) {
                    console.error(chalk.red(`[EXPIRY] Failed to send stop notice for ${bot.bot_name}:`), err.message);
                }
            }

            // Stop the bot
            stoppedBots.add(bot.session_id);
            connectingBots.delete(bot.session_id);
            reconnectLocks.delete(bot.session_id);
            reconnectAttempts.delete(bot.session_id);

            if (botData?.sock) {
                try { botData.sock.logout().catch(() => {}); } catch {}
                try { botData.sock.ws?.close(); } catch {}
                try { botData.sock.end(); } catch {}
            }
            activeBots.delete(bot.session_id);
            global.botConnected = activeBots.size > 0;

            await db.query('UPDATE bots SET status="inactive" WHERE session_id=?', [bot.session_id]);

            addLog(bot.user_id, `🛑 Bot "${bot.bot_name}" expired and was automatically stopped.`);
            console.log(chalk.red(`[EXPIRY] Bot expired & stopped: ${bot.bot_name} (${bot.session_id})`));
            
            expiryWarningsSent.set(bot.session_id, { ...warningState, stopped: true, stopTime: Date.now() });
        }

        // Cleanup old entries from warning map
        for (const [key, state] of expiryWarningsSent) {
            if (state.stopped && state.stopTime && Date.now() - state.stopTime > 2 * 60 * 60 * 1000) {
                expiryWarningsSent.delete(key);
            }
        }

    } catch (err) {
        console.error(chalk.red('[EXPIRY CRON] Error:'), err.message);
    }
}, 60 * 60 * 1000); // Every hour


// ══════════════════════════════════════════════════════════════════════════════
//  AUTO-CLOSE STALE TICKETS CRON (runs every 24 hours)
// ══════════════════════════════════════════════════════════════════════════════
setInterval(async () => {
    try {
        // Close tickets that have been 'replied' for 7+ days with no user response
        const [result] = await db.query(`
            UPDATE support_tickets 
            SET status = 'closed', updated_at = NOW()
            WHERE status = 'replied' 
              AND last_reply_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
        `);
        
        if (result.affectedRows > 0) {
            console.log(chalk.yellow(`[TICKET CRON] Auto-closed ${result.affectedRows} stale ticket(s)`));
        }
    } catch (err) {
        console.error(chalk.red('[TICKET CRON] Error:'), err.message);
    }
}, 24 * 60 * 60 * 1000);


app.listen(PORT, () => {
    console.log('');
    console.log(chalk.green.bold(`  🚀 OxBot  →  http://oxbot.name.ng:${PORT}`));
    console.log(chalk.cyan(`  📁 Sessions  →  ${SESSION_DIR}`));
    console.log(chalk.green('  ⚡ Prefix    →  . or !'));
    console.log(chalk.gray('  💓 Keep-alive → Baileys native (25s)'));
    console.log(chalk.gray('  👻 440 Ghost Fix → Active'));
    console.log(chalk.gray('  🔑 Pairing Fix  → Creds wipe + single code request'));
    console.log(chalk.gray('  📧 Email Verify → noreply@zestpay.com.ng'));
    console.log('');
    autoReconnectBots();
});

// ── Suppress noisy WhatsApp signal / protocol errors ─────────────────────────
const NOISE = [
    'decrypt', 'Bad MAC', 'Session error', 'Closing open session',
    'Closing session:', 'prekey bundle',
];
process.on('uncaughtException',  err => { if (NOISE.some(n => err?.message?.includes(n))) return; console.error(chalk.red('Uncaught:'), err); });
process.on('unhandledRejection', err => { if (NOISE.some(n => err?.message?.includes(n))) return; console.error(chalk.red('Unhandled:'), err); });

const _origLog  = console.log;
const LOG_NOISE = ['Closing session', 'prekey bundle', 'Closing open session'];
console.log = function (...args) {
    const msg = args.join(' ');
    if (LOG_NOISE.some(n => msg.includes(n))) return;
    _origLog.apply(console, args);
};