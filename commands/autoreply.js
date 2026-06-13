const name     = 'autoreply';
const desc     = 'Auto-reply to DMs (Pro only)';
const category = 'owner';
const aliases  = ['ar'];

const stateCache = new Map();
const TTL        = 30_000;
const lastReplied = new Map(); // Tracks last reply time per JID

async function getState(db, sessionId) {
    const c = stateCache.get(sessionId);
    if (c && Date.now() - c.ts < TTL) return c;
    try {
        const [rows] = await db.query(
            'SELECT autoreply, autoreply_message FROM bot_settings WHERE session_id=? LIMIT 1',
            [sessionId]
        );
        const v = {
            enabled: rows[0]?.autoreply === 1,
            message: rows[0]?.autoreply_message || '👋 Hi! I am currently unavailable. I will get back to you soon!'
        };
        stateCache.set(sessionId, { ...v, ts: Date.now() });
        return v;
    } catch { return { enabled: false, message: '' }; }
}

async function getOwnerUserId(db, sessionId) {
    try {
        const [rows] = await db.query('SELECT user_id FROM bots WHERE session_id=? LIMIT 1', [sessionId]);
        return rows[0]?.user_id || null;
    } catch { return null; }
}

async function isPro(db, userId) {
    try {
        const [rows] = await db.query(
            `SELECT id FROM pro_subscriptions WHERE user_id=? AND status='active' AND expires_at > NOW() LIMIT 1`,
            [userId]
        );
        return rows.length > 0;
    } catch { return false; }
}

// Called from index.js on every incoming message
async function handleAutoReply(sock, msg, botData) {
    try {
        if (!botData?.db || !botData?.sessionId) return;
        if (msg.key.fromMe) return;

        const chatId = msg.key?.remoteJid;
        if (!chatId || chatId === 'status@broadcast') return;
        if (chatId.endsWith('@g.us')) return; // Groups only DM

        const state = await getState(botData.db, botData.sessionId);
        if (!state.enabled || !state.message) return;

        // Rate limit — max 1 autoreply per contact per 60 seconds
        const key = `${botData.sessionId}_${chatId}`;
        const last = lastReplied.get(key) || 0;
        if (Date.now() - last < 60_000) return;
        lastReplied.set(key, Date.now());

        // ★ 8-second delay to look natural and avoid WhatsApp detection ★
        await new Promise(r => setTimeout(r, 8000));

        // Show typing for 2 seconds before reply
        await sock.sendPresenceUpdate('composing', chatId);
        await new Promise(r => setTimeout(r, 2000));
        await sock.sendPresenceUpdate('paused', chatId);

        await sock.sendMessage(chatId, { text: state.message });
    } catch {}
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
            text: '👑 *Pro Plan Required*\n\nAutoreply is a Pro-only feature.\n\nUpgrade at: https://oxbot.name.ng/dashboard'
        }, { quoted: msg });
    }

    const action = args[0]?.toLowerCase();

    // .autoreply set <message>
    if (action === 'set') {
        const newMsg = args.slice(1).join(' ').trim();
        if (!newMsg) {
            return await sock.sendMessage(chatId, {
                text: '❌ Provide a message!\n\nExample:\n*.autoreply set Hi! I am busy, will reply soon* 😊'
            }, { quoted: msg });
        }
        await db.query(
            `INSERT INTO bot_settings (session_id, autoreply_message) VALUES (?,?) ON DUPLICATE KEY UPDATE autoreply_message=?`,
            [sessionId, newMsg, newMsg]
        ).catch(() => {});
        stateCache.delete(sessionId);
        return await sock.sendMessage(chatId, {
            text: `✅ *Autoreply message saved!*\n\n_"${newMsg}"_`
        }, { quoted: msg });
    }

    if (!['on','off'].includes(action)) {
        const state = await getState(db, sessionId);
        return await sock.sendMessage(chatId, {
            text: `💬 *Autoreply*\n\nStatus: *${state.enabled ? 'ON ✅' : 'OFF ❌'}*\nMessage: _"${state.message}"_\n\nUsage:\n\`.autoreply on\` — Enable\n\`.autoreply off\` — Disable\n\`.autoreply set <your message>\` — Set message\n\n⏱ Replies after 8 seconds to avoid detection`
        }, { quoted: msg });
    }

    const enabled = action === 'on' ? 1 : 0;
    await db.query(
        `INSERT INTO bot_settings (session_id, autoreply) VALUES (?,?) ON DUPLICATE KEY UPDATE autoreply=?`,
        [sessionId, enabled, enabled]
    ).catch(() => {});
    stateCache.delete(sessionId);
    botData.addLog?.(`💬 Autoreply ${enabled ? 'ON' : 'OFF'}`);

    return await sock.sendMessage(chatId, {
        text: enabled
            ? `💬 *Autoreply ENABLED*\n\n✅ Bot will auto-reply to DMs after 8 seconds.\n\nTo change message:\n\`.autoreply set <message>\``
            : '💬 *Autoreply DISABLED*\n\n❌ Bot will no longer auto-reply.'
    }, { quoted: msg });
}

module.exports = { name, desc, category, aliases, execute, handleAutoReply, getState };
