const name     = 'antiban';
const desc     = 'Protect bot from WhatsApp ban (Pro only)';
const category = 'owner';

const cache = new Map();
const TTL   = 30_000;

// ── Helper: Get antiban state from DB ────────────────────────────────────────
async function getState(db, sessionId) {
    const c = cache.get(sessionId);
    if (c && Date.now() - c.ts < TTL) return c.v;
    try {
        const [rows] = await db.query('SELECT antiban FROM bot_settings WHERE session_id=? LIMIT 1', [sessionId]);
        const v = rows[0]?.antiban === 1;
        cache.set(sessionId, { v, ts: Date.now() });
        return v;
    } catch { return false; }
}

// ── Helper: Robust DB Session Lookup ─────────────────────────────────────────
async function getOwnerUserId(db, sessionId) {
    if (!db || !sessionId) return null;
    try {
        // Exact match
        const [r1] = await db.query('SELECT user_id FROM bots WHERE session_id=? LIMIT 1', [sessionId]);
        if (r1.length) return r1[0].user_id;
        
        // Try oxbot_ prefix
        if (!String(sessionId).startsWith('oxbot_')) {
            const [r2] = await db.query('SELECT user_id FROM bots WHERE session_id=? LIMIT 1', [`oxbot_${sessionId}`]);
            if (r2.length) return r2[0].user_id;
        }
        return null;
    } catch { return null; }
}

// ── Helper: Clean Pro Check (Ignores Free Trial) ─────────────────────────────
async function isPro(db, userId) {
    if (!userId) return false;
    try {
        const [rows] = await db.query(
            `SELECT id FROM pro_subscriptions 
             WHERE user_id=? AND status='active' AND expires_at > NOW() LIMIT 1`,
            [userId]
        );
        return rows.length > 0;
    } catch { return false; }
}

// ── Background Handler (Called by index.js on every message) ─────────────────
async function handleAntiban(sock, msg, botData) {
    if (!botData?.db || !botData?.sessionId) return;
    const enabled = await getState(botData.db, botData.sessionId);
    if (!enabled) return;
    
    if (!msg.key.fromMe) return;
    
    // Random delay 1-3 seconds between bot responses to mimic human behavior
    const delayMs = Math.floor(Math.random() * 2000) + 1000;
    await new Promise(r => setTimeout(r, delayMs));
}

// ── Main Command Execution ───────────────────────────────────────────────────
async function execute(sock, msg, botData, args) {
    const chatId    = msg.key.remoteJid;
    const db        = botData?.db;
    const sessionId = botData?.sessionId;

    if (!db || !sessionId) {
        return await sock.sendMessage(chatId, { text: '❌ Database error.' }, { quoted: msg });
    }

    // ── CHECK PRO PLAN (Block Free Trial Users) ──────────────────────────────
    const userId = await getOwnerUserId(db, sessionId);
    const proOn  = await isPro(db, userId);

    if (!proOn) {
        return await sock.sendMessage(chatId, {
            text: '👑 *Pro Plan Required*\n\n_Antiban is a premium feature. Free Trial users cannot use this._\n\n_Upgrade to Pro at: https://oxbot.name.ng/dashboard_'
        }, { quoted: msg });
    }

    const action = args[0]?.toLowerCase();

    if (!['on', 'off'].includes(action)) {
        const cur = await getState(db, sessionId);
        return await sock.sendMessage(chatId, {
            text: `🛡️ *Antiban Protection*\n\nStatus: *${cur ? 'ENABLED ✅' : 'DISABLED ❌'}*\n\n*What it does:*\n• Adds 1-3s random delay between responses\n• Prevents spam detection by WhatsApp\n• Reduces risk of ban from automated behavior\n\nUsage:\n\`.antiban on\` — Enable\n\`.antiban off\` — Disable`
        }, { quoted: msg });
    }

    const enabled = action === 'on' ? 1 : 0;
    
    await db.query(
        `INSERT INTO bot_settings (session_id, antiban) VALUES (?,?) ON DUPLICATE KEY UPDATE antiban=?`,
        [sessionId, enabled, enabled]
    ).catch(() => {});
    
    // Update cache instantly
    cache.set(sessionId, { v: !!enabled, ts: Date.now() });

    return await sock.sendMessage(chatId, {
        text: enabled
            ? '🛡️ *Antiban ENABLED*\n\n✅ Bot will now add smart delays between responses to avoid ban detection.'
            : '🛡️ *Antiban DISABLED*\n\n❌ Smart delays removed.'
    }, { quoted: msg });
}

module.exports = { name, desc, category, execute, handleAntiban, getState };
