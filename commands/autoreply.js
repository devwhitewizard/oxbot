const name     = 'autoreply';
const desc     = 'Auto-reply to DMs (Pro only)';
const category = 'owner';
const aliases  = ['ar'];

const stateCache = new Map();
const TTL        = 30_000;
const lastReplied = new Map(); // Tracks last reply time per JID

// ── Helper: Get autoreply state (handles oxbot_ prefix mismatch) ─────────────
async function getState(db, sessionId) {
    const c = stateCache.get(sessionId);
    if (c && Date.now() - c.ts < TTL) return c;
    try {
        // Try exact match first
        let [rows] = await db.query(
            'SELECT autoreply, autoreply_message FROM bot_settings WHERE session_id=? LIMIT 1',
            [sessionId]
        );
        // Fallback to oxbot_ prefix for background handler
        if (!rows.length && !String(sessionId).startsWith('oxbot_')) {
            [rows] = await db.query(
                'SELECT autoreply, autoreply_message FROM bot_settings WHERE session_id=? LIMIT 1',
                [`oxbot_${sessionId}`]
            );
        }

        const v = {
            enabled: rows[0]?.autoreply === 1,
            message: rows[0]?.autoreply_message || '👋 Hi! I am currently unavailable. I will get back to you soon!'
        };
        stateCache.set(sessionId, { ...v, ts: Date.now() });
        return v;
    } catch { return { enabled: false, message: '' }; }
}

// ── Helper: Robust DB Session Lookup ─────────────────────────────────────────
async function getOwnerUserId(db, sessionId) {
    if (!db || !sessionId) return null;
    try {
        const [r1] = await db.query('SELECT user_id, session_id FROM bots WHERE session_id=? LIMIT 1', [sessionId]);
        if (r1.length) return { userId: r1[0].user_id, dbSessionId: r1[0].session_id };
        
        // Try oxbot_ prefix
        if (!String(sessionId).startsWith('oxbot_')) {
            const [r2] = await db.query('SELECT user_id, session_id FROM bots WHERE session_id=? LIMIT 1', [`oxbot_${sessionId}`]);
            if (r2.length) return { userId: r2[0].user_id, dbSessionId: r2[0].session_id };
        }
        return null;
    } catch { return null; }
}

// ── Helper: Clean Pro Check ──────────────────────────────────────────────────
async function isPro(db, userId) {
    if (!userId) return false;
    try {
        const [rows] = await db.query(
            `SELECT id FROM pro_subscriptions WHERE user_id=? AND status='active' AND expires_at > NOW() LIMIT 1`,
            [userId]
        );
        return rows.length > 0;
    } catch { return false; }
}

// ── Background Handler (Called from index.js on every incoming message) ──────
async function handleAutoReply(sock, msg, botData) {
    try {
        if (!botData?.db || !botData?.sessionId) return;
        if (msg.key.fromMe) return;

        const chatId = msg.key?.remoteJid;
        if (!chatId || chatId === 'status@broadcast') return;
        if (chatId.endsWith('@g.us')) return; // Only DMs

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

// ── Main Command Execution ───────────────────────────────────────────────────
async function execute(sock, msg, botData, args) {
    const chatId    = msg.key.remoteJid;
    const db        = botData?.db;
    const sessionId = botData?.sessionId;

    if (!db || !sessionId) {
        return await sock.sendMessage(chatId, { text: '❌ Database error.' }, { quoted: msg });
    }

    // ── CHECK PRO PLAN (Block Free Trial Users) ──────────────────────────────
    const ownerData = await getOwnerUserId(db, sessionId);
    const userId = ownerData?.userId;
    const actualDbSessionId = ownerData?.dbSessionId || sessionId; // ★ Exact DB ID to prevent split data
    const proOn  = await isPro(db, userId);

    if (!proOn) {
        return await sock.sendMessage(chatId, {
            text: '👑 *Pro Plan Required*\n\n_Autoreply is a premium feature. Free Trial users cannot use this._\n\n_Upgrade to Pro at: https://oxbot.name.ng/dashboard_'
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
        
        // ★ Use actualDbSessionId so it updates the SAME row as the dashboard ★
        await db.query(
            `INSERT INTO bot_settings (session_id, autoreply_message) VALUES (?,?) ON DUPLICATE KEY UPDATE autoreply_message=?`,
            [actualDbSessionId, newMsg, newMsg]
        ).catch(() => {});
        stateCache.delete(sessionId); // Clear cache to show new message
        
        return await sock.sendMessage(chatId, {
            text: `✅ *Autoreply message saved!*\n\n_"${newMsg}"_`
        }, { quoted: msg });
    }

    if (!['on', 'off'].includes(action)) {
        const state = await getState(db, sessionId);
        return await sock.sendMessage(chatId, {
            text: `💬 *Autoreply*\n\nStatus: *${state.enabled ? 'ON ✅' : 'OFF ❌'}*\nMessage: _"${state.message}"_\n\nUsage:\n\`.autoreply on\` — Enable\n\`.autoreply off\` — Disable\n\`.autoreply set <your message>\` — Set message\n\n⏱ Replies after 8 seconds to avoid detection`
        }, { quoted: msg });
    }

    const enabled = action === 'on' ? 1 : 0;
    
    // ★ Use actualDbSessionId so it updates the SAME row as the dashboard ★
    await db.query(
        `INSERT INTO bot_settings (session_id, autoreply) VALUES (?,?) ON DUPLICATE KEY UPDATE autoreply=?`,
        [actualDbSessionId, enabled, enabled]
    ).catch(() => {});
    stateCache.delete(sessionId);

    return await sock.sendMessage(chatId, {
        text: enabled
            ? `💬 *Autoreply ENABLED*\n\n✅ Bot will auto-reply to DMs after 8 seconds.\n\nTo change message:\n\`.autoreply set <message>\``
            : '💬 *Autoreply DISABLED*\n\n❌ Bot will no longer auto-reply.'
    }, { quoted: msg });
}

module.exports = { name, desc, category, aliases, execute, handleAutoReply, getState };
