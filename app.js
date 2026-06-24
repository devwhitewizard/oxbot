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


const serverRoutes = require('./routes/servers');
require('dotenv').config();



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

const cors       = require('cors');

const chalk      = require('chalk');



// ── Paths & constants ─────────────────────────────────────────────────────────

const PORT        = process.env.PORT || 3000;

const SESSION_DIR = path.join(__dirname, 'sessions');

const PUBLIC_DIR  = path.join(__dirname, 'public');

[SESSION_DIR, PUBLIC_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));



// ── Site base URL ─────────────────────────────────────────────────────────────

const SITE_URL = process.env.SITE_URL || 'http://oxbot.name.ng';



// ── Express ───────────────────────────────────────────────────────────────────

const app = express();

app.use(cors());

app.use(express.json());

app.use(express.static(PUBLIC_DIR));



// ── Modular OxBot Modules ─────────────────────────────────────────────────────

const db = require('./oxbot/database');

const {

    consoleLogs,

    pairingMap,

    activeSocks,

    activeBots,

    stoppedBots,

    connectingBots,

    lastReply,

    reconnectLocks,

    reconnectAttempts

} = require('./oxbot/state');

const {

    addLog,

    delay

} = require('./oxbot/utils');

const {

    autoReconnectBots

} = require('./oxbot/botManager');



// ── DB init & Auto-reconnect ───────────────────────────────────────────────────

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

            blocked          TINYINT(1)   NOT NULL DEFAULT 0,

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



        // Migrate existing users table if columns are missing

        const [cols] = await db.query(`SHOW COLUMNS FROM users`);

        const colNames = cols.map(c => c.Field);

        if (!colNames.includes('email_verified'))

            await db.query(`ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0`);

        if (!colNames.includes('verify_token'))

            await db.query(`ALTER TABLE users ADD COLUMN verify_token VARCHAR(64) DEFAULT NULL`);

        if (!colNames.includes('blocked'))

            await db.query(`ALTER TABLE users ADD COLUMN blocked TINYINT(1) NOT NULL DEFAULT 0`);

            

        // Migrate existing bot_settings table if columns are missing

        try {

            const [bsCols] = await db.query(`SHOW COLUMNS FROM bot_settings`);

            const bsColNames = bsCols.map(c => c.Field);

            if (bsColNames.length > 0) {

                if (!bsColNames.includes('bot_mode'))

                    await db.query(`ALTER TABLE bot_settings ADD COLUMN bot_mode VARCHAR(20) NOT NULL DEFAULT 'public'`);

                if (!bsColNames.includes('antiban'))

                    await db.query(`ALTER TABLE bot_settings ADD COLUMN antiban TINYINT(1) DEFAULT 0`);

                if (!bsColNames.includes('autoreply'))

                    await db.query(`ALTER TABLE bot_settings ADD COLUMN autoreply TINYINT(1) DEFAULT 0`);

                if (!bsColNames.includes('autoreply_message'))

                    await db.query(`ALTER TABLE bot_settings ADD COLUMN autoreply_message TEXT DEFAULT NULL`);

                if (!bsColNames.includes('bot_image_url'))

                    await db.query(`ALTER TABLE bot_settings ADD COLUMN bot_image_url VARCHAR(255) DEFAULT NULL`);

                if (!bsColNames.includes('antidelete'))

                    await db.query(`ALTER TABLE bot_settings ADD COLUMN antidelete TINYINT(1) DEFAULT 0`);

            }

        } catch (mErr) { console.error('  ⚠️ bot_settings migration error:', mErr.message); }

            

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



        await db.query(`CREATE TABLE IF NOT EXISTS paired_sessions (

            id INT AUTO_INCREMENT PRIMARY KEY,

            user_id INT NOT NULL,

            session_id VARCHAR(90) NOT NULL UNIQUE,

            session_name VARCHAR(90) NOT NULL,

            phone VARCHAR(20) NOT NULL,

            whatsapp_name VARCHAR(100) DEFAULT NULL,

            whatsapp_number VARCHAR(20) DEFAULT NULL,

            session_data TEXT DEFAULT NULL,

            paired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

            status ENUM('paired','activated','deleted') DEFAULT 'paired',

            INDEX idx_user (user_id),

            INDEX idx_session (session_id),

            INDEX idx_status (status)

        )`);



        try {

            const [pairedCols] = await db.query(`SHOW COLUMNS FROM paired_sessions`);

            const pairedColNames = pairedCols.map(c => c.Field);

            if (!pairedColNames.includes('whatsapp_name'))

                await db.query(`ALTER TABLE paired_sessions ADD COLUMN whatsapp_name VARCHAR(100) DEFAULT NULL`);

            if (!pairedColNames.includes('whatsapp_number'))

                await db.query(`ALTER TABLE paired_sessions ADD COLUMN whatsapp_number VARCHAR(20) DEFAULT NULL`);

            if (!pairedColNames.includes('session_data'))

                await db.query(`ALTER TABLE paired_sessions ADD COLUMN session_data TEXT DEFAULT NULL`);

        } catch {}

        

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

            session_id    VARCHAR(90)  NOT NULL UNIQUE,

            bot_name      VARCHAR(100) NOT NULL,

            server        VARCHAR(50)  NOT NULL,

            status        ENUM('active','inactive') DEFAULT 'active',

            whatsapp_name VARCHAR(100) DEFAULT NULL,

            expires_at    DATETIME,

            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP

        )`);



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

            session_id VARCHAR(90) NOT NULL UNIQUE,

            autotyping TINYINT(1)  DEFAULT 0,

            bot_mode   VARCHAR(20) NOT NULL DEFAULT 'public',

            antiban    TINYINT(1)  DEFAULT 0,

            autoreply  TINYINT(1)  DEFAULT 0,

            autoreply_message TEXT DEFAULT NULL,

            bot_image_url VARCHAR(255) DEFAULT NULL,

            antidelete TINYINT(1)  DEFAULT 0,

            created_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,

            updated_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

        )`);



        await db.query(`CREATE TABLE IF NOT EXISTS seen_statuses (

            id         INT AUTO_INCREMENT PRIMARY KEY,

            session_id VARCHAR(90) NOT NULL,

            status_id  VARCHAR(90) NOT NULL,

            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

            UNIQUE KEY unique_status (session_id, status_id)

        )`);



        console.log(chalk.green('✅ All tables ready'));

        autoReconnectBots().catch(() => {});

    } catch (err) {

        console.error(chalk.red('❌ DB Error:'), err.message);

    }

})();



global.botConnected = false;



// ── In-Memory Cutoffs ─────────────────────────────────────────────────────────

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



// ── Mount Routes ──────────────────────────────────────────────────────────────
app.use(require('./routes/auth'));
app.use(require('./routes/users'));
app.use(require('./routes/bots'));
app.use(require('./routes/tickets'));
app.use(require('./routes/deposits').router);

// ── API ENDPOINTS ───────────────────────────────────────────────────────────────
// FIX: Mount server routes at /api so the dashboard can find them
app.use('/api', serverRoutes);

app.use(require('./routes/admin'));


// ── Static page routes fallback ────────────────────────────────────────────────

const PAGE_MAP = {

    '/':                'index.html',

    '/login':           'login.html',

    '/register':        'register.html',

    '/dashboard':       'dashboard.html',

    '/verify-email':    'verify-email.html',

    '/forgot-password': 'forgot-password.html',

    '/admin':           'admin.html',

    '/api-console-telegram': 'api-console-telegram.php',

    '/console-telegram': 'console-telegram.html',

};

Object.entries(PAGE_MAP).forEach(([route, file]) => {

    app.get(route, (_req, res) => {

        const fp = path.join(PUBLIC_DIR, file);

        if (fs.existsSync(fp)) return res.sendFile(fp);

        res.status(404).send('Not found');

    });

});



// ── CRON: Expire active pro plans ─────────────────────────────────────────────

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



// ── CRON: Auto-delete expired bots (runs every 30 minutes) ────────────────────

setInterval(async () => {

    try {

        const [expired] = await db.query(

            `SELECT session_id, user_id, bot_name FROM bots WHERE expires_at IS NOT NULL AND expires_at <= NOW()`

        );

        if (!expired.length) return;



        console.log(chalk.yellow(`[CRON] Found ${expired.length} expired bot(s) — cleaning up...`));



        for (const bot of expired) {

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



            await db.query('DELETE FROM bots         WHERE session_id=?', [bot.session_id]).catch(() => {});

            await db.query('DELETE FROM bot_settings WHERE session_id=?', [bot.session_id]).catch(() => {});

            await db.query('DELETE FROM seen_statuses WHERE session_id=?', [bot.session_id]).catch(() => {});



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



// ── CRON: Bot Expiry Warning & Auto-stop (runs every hour) ────────────────────

const expiryWarningsSent = new Map();



setInterval(async () => {

    try {

        const now = new Date();

        const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        

        // Send 24-hour warning

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



        // Stop expired bots

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



        // Cleanup warning map

        for (const [key, state] of expiryWarningsSent) {

            if (state.stopped && state.stopTime && Date.now() - state.stopTime > 2 * 60 * 60 * 1000) {

                expiryWarningsSent.delete(key);

            }

        }



    } catch (err) {

        console.error(chalk.red('[EXPIRY CRON] Error:'), err.message);

    }

}, 60 * 60 * 1000);



// ── CRON: Auto-close stale tickets (runs every 24 hours) ──────────────────────

setInterval(async () => {

    try {

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




// ── Handle routes fallback ─────────────────────────────────────────────────────

app.use((req, res) => {

    if (req.path.startsWith('/api/')) return res.status(404).json({ message: 'Not found' });

    const fp = path.join(PUBLIC_DIR, 'index.html');

    if (fs.existsSync(fp)) return res.sendFile(fp);

    res.send('OxBot is running.');

});



// ── Listen ────────────────────────────────────────────────────────────────────

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

});



// ── Suppress noisy WhatsApp protocol errors ───────────────────────────────────

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