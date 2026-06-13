const name     = 'antiban';
const desc     = 'Protect bot from WhatsApp ban (Pro only)';
const category = 'owner';

const cache = new Map();
const TTL   = 30_000;

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

async function isPro(db, userId) {
    try {
        const [rows] = await db.query(
            `SELECT id FROM pro_subscriptions 
             JOIN bots ON bots.user_id = pro_subscriptions.user_id 
             WHERE bots.session_id IN (SELECT session_id FROM bots WHERE user_id=?)
             AND pro_subscriptions.user_id=? AND pro_subscriptions.status='active' AND pro_subscriptions.expires_at > NOW() LIMIT 1`,
            [userId, userId]
        );
        return rows.length > 0;
    } catch { return false; }
}

async function getOwnerUserId(db, sessionId) {
    try {
        const [rows] = await db.query('SELECT user_id FROM bots WHERE session_id=? LIMIT 1', [sessionId]);
        return rows[0]?.user_id || null;
    } catch { return null; }
}

// Called from index.js on every message — adds smart delays
async function handleAntiban(sock, msg, botData) {
    if (!botData?.db || !botData?.sessionId) return;
    const enabled = await getState(botData.db, botData.sessionId);
    if (!enabled) return;
    if (!msg.key.fromMe) return;
    // Random delay 1-3 seconds between bot responses
    const delay = Math.floor(Math.random() * 2000) + 1000;
    await new Promise(r => setTimeout(r, delay));
}

async function execute(sock, msg, botData, args) {
    const chatId    = msg.key.remoteJid;
    const db        = botData?.db;
    const sessionId = botData?.sessionId;

    // Check pro
    const userId = await getOwnerUserId(db, sessionId);
    const proOn  = userId ? await isPro(db, userId) : false;

    if (!proOn) {
        return await sock.sendMessage(chatId, {
            text: '👑 *Pro Plan Required*\n\nAntiban is a Pro-only feature.\n\nUpgrade at: https://oxbot.name.ng/dashboard'
        }, { quoted: msg });
    }

    const action = args[0]?.toLowerCase();

    if (!['on','off'].includes(action)) {
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
    cache.set(sessionId, { v: !!enabled, ts: Date.now() });
    botData.addLog?.(`🛡️ Antiban ${enabled ? 'ON' : 'OFF'}`);

    return await sock.sendMessage(chatId, {
        text: enabled
            ? '🛡️ *Antiban ENABLED*\n\n✅ Bot will now add smart delays between responses to avoid ban detection.'
            : '🛡️ *Antiban DISABLED*\n\n❌ Smart delays removed.'
    }, { quoted: msg });
}

module.exports = { name, desc, category, execute, handleAntiban, getState };
