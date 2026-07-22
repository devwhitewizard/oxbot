/**
 * OxBot — Auto-Typing Command (Pro Only)
 * Owner number fetched from users table by session_id
 */

// ── Strip device/LID suffix so JIDs always compare cleanly ──
function cleanNumber(jid) {
    if (!jid) return '';
    return jid.split(':')[0].split('@')[0];
}

// ── Fetch owner phone from users table for this session ──
async function getOwnerNumber(db, sessionId) {
    try {
        const [rows] = await db.query(
            'SELECT u.phone FROM users u JOIN bots b ON b.user_id = u.id WHERE b.session_id = ? LIMIT 1',
            [sessionId]
        );
        if (!rows.length || !rows[0].phone) return null;
        return String(rows[0].phone).replace(/\D/g, '');
    } catch (err) {
        console.error('[autotyping] DB error fetching owner:', err.message);
        return null;
    }
}

// ── Check if sender is the owner for this session ──
async function isOwner(db, sessionId, senderId, sock, chatId) {
    const ownerNumber = await getOwnerNumber(db, sessionId);
    if (!ownerNumber) return false;

    const ownerJid    = ownerNumber + '@s.whatsapp.net';
    const senderClean = cleanNumber(senderId);

    if (senderId === ownerJid)          return true;
    if (senderClean === ownerNumber)    return true;
    if (senderId.includes(ownerNumber)) return true;

    if (sock && chatId && chatId.endsWith('@g.us') && senderId.includes('@lid')) {
        try {
            const metadata     = await sock.groupMetadata(chatId);
            const participants = metadata.participants || [];

            const match = participants.find(p => {
                const pIdClean = cleanNumber(p.id || '');
                return pIdClean === ownerNumber || (p.id || '') === ownerJid;
            });

            if (match) return true;
        } catch (e) {
            console.error('[autotyping] Group LID check error:', e.message);
        }
    }

    return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ★ PRO PLAN CHECKERS (Added) ★
// ═══════════════════════════════════════════════════════════════════════════════

async function getOwnerUserId(db, sessionId) {
    if (!db || !sessionId) return null;
    try {
        let [rows] = await db.query(
            'SELECT user_id, session_id FROM bots WHERE session_id=? LIMIT 1',
            [sessionId]
        );
        if (rows.length) return { userId: rows[0].user_id, dbSessionId: rows[0].session_id };

        // Fallback to oxbot_ prefix (fixes dashboard/bot data mismatch)
        if (!String(sessionId).startsWith('oxbot_')) {
            [rows] = await db.query(
                'SELECT user_id, session_id FROM bots WHERE session_id=? LIMIT 1',
                [`oxbot_${sessionId}`]
            );
            if (rows.length) return { userId: rows[0].user_id, dbSessionId: rows[0].session_id };
        }
        return null;
    } catch (err) {
        console.error('[autotyping] getOwnerUserId error:', err.message);
        return null;
    }
}

async function isProUser(db, userId) {
    if (!userId) return false;
    try {
        const [rows] = await db.query(
            `SELECT id FROM pro_subscriptions WHERE user_id=? AND status='active' AND expires_at > NOW() LIMIT 1`,
            [userId]
        );
        return rows.length > 0;
    } catch (err) {
        console.error('[autotyping] isProUser error:', err.message);
        return false;
    }
}

/**
 * Blocks free users and sends upgrade message
 * @returns {boolean} true = blocked, false = allowed
 */
async function blockIfFree(sock, chatId, msg, db, sessionId) {
    if (!db || !sessionId) return false; // Dev mode

    const ownerData = await getOwnerUserId(db, sessionId);
    const userId = ownerData?.userId;
    const proOn = await isProUser(db, userId);

    if (!proOn) {
        await sock.sendMessage(chatId, {
            text: '👑 *Pro Plan Required*\n\n_Auto-typing is a premium feature. Free Trial users cannot use this._\n\n_Upgrade to Pro at: https://oxbot.name.ng/dashboard_'
        }, { quoted: msg });
        return true; // BLOCKED
    }
    return false; // ALLOWED
}

// ═══════════════════════════════════════════════════════════════════════════════
// ★ BACKGROUND HANDLER ★
// ═══════════════════════════════════════════════════════════════════════════════

// ── Check if autotyping is enabled for this session ──
async function isEnabled(db, sessionId) {
    try {
        // Try exact match
        let [rows] = await db.query(
            'SELECT autotyping FROM bot_settings WHERE session_id = ? LIMIT 1',
            [sessionId]
        );
        if (rows.length) return rows[0].autotyping === 1;

        // Fallback to oxbot_ prefix
        if (!String(sessionId).startsWith('oxbot_')) {
            [rows] = await db.query(
                'SELECT autotyping FROM bot_settings WHERE session_id = ? LIMIT 1',
                [`oxbot_${sessionId}`]
            );
            return rows.length > 0 && rows[0].autotyping === 1;
        }
        
        return false;
    } catch {
        return false;
    }
}

// ── Show typing indicator for incoming messages ──
async function handleAutotypingForMessage(sock, chatId, message, botData) {
    if (!botData?.sessionId || !botData?.db) return;

    const userMessage = (
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        ''
    ).trim();

    if (!userMessage) return;

    const enabled = await isEnabled(botData.db, botData.sessionId);
    if (!enabled) return;

    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('available', chatId);
        await new Promise(r => setTimeout(r, 500));
        await sock.sendPresenceUpdate('composing', chatId);

        const delay = Math.max(3000, Math.min(8000, userMessage.length * 150));
        await new Promise(r => setTimeout(r, delay));

        await sock.sendPresenceUpdate('composing', chatId);
        await new Promise(r => setTimeout(r, 1500));
        await sock.sendPresenceUpdate('paused', chatId);
    } catch {
        // Silent fail
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ★ MAIN COMMAND ★
// ═══════════════════════════════════════════════════════════════════════════════

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    if (!botData?.sessionId || !botData?.db) {
        await sock.sendMessage(chatId, {
            text: '⚠️ Database error. Please restart the bot.'
        }, { quoted: msg });
        return null;
    }

    // ── PRO CHECK (Blocks free users immediately) ──
    if (await blockIfFree(sock, chatId, msg, botData.db, botData.sessionId)) {
        return null;
    }

    // ── Owner check ──
    const senderId = msg.key.participant || msg.key.remoteJid;
    const senderIsOwner = await isOwner(
        botData.db, botData.sessionId, senderId, sock, chatId
    );

    if (!msg.key.fromMe && !senderIsOwner) {
        await sock.sendMessage(chatId, {
            text: '❌ This command is only available for the owner!'
        }, { quoted: msg });
        return null;
    }

    // ── Use args passed directly from index.js ──
    const action = (args[0] || '').toLowerCase();
    const dbSessionId = botData.sessionId; // Default to standard

    // ★ Get actual DB session ID to prevent dashboard data split ★
    let actualDbSessionId = dbSessionId;
    const ownerData = await getOwnerUserId(botData.db, botData.sessionId);
    if (ownerData?.dbSessionId) {
        actualDbSessionId = ownerData.dbSessionId;
    }

    if (['on', 'enable', '1'].includes(action)) {
        try {
            await botData.db.query(
                `INSERT INTO bot_settings (session_id, autotyping) VALUES (?, 1)
                 ON DUPLICATE KEY UPDATE autotyping = 1`,
                [actualDbSessionId] // ★ Use actual DB ID
            );
        } catch (err) {
            console.error('[autotyping] DB error (enable):', err.message);
        }
        return await sock.sendMessage(chatId, {
            text: '✅ *Auto-typing ENABLED!*\n\n⌨️ Bot will now show typing on every message received.'
        }, { quoted: msg });
    }

    if (['off', 'disable', '0'].includes(action)) {
        try {
            await botData.db.query(
                `INSERT INTO bot_settings (session_id, autotyping) VALUES (?, 0)
                 ON DUPLICATE KEY UPDATE autotyping = 0`,
                [actualDbSessionId] // ★ Use actual DB ID
            );
        } catch (err) {
            console.error('[autotyping] DB error (disable):', err.message);
        }
        return await sock.sendMessage(chatId, {
            text: '⛔ *Auto-typing DISABLED!*\n\n📝 No more typing indicator.'
        }, { quoted: msg });
    }

    if (action) {
        return await sock.sendMessage(chatId, {
            text: '❌ Invalid option! Use:\n```.autotyping on```\n```.autotyping off```'
        }, { quoted: msg });
    }

    // No args — toggle current state
    const current = await isEnabled(botData.db, botData.sessionId);
    const newState = current ? 0 : 1;
    
    try {
        await botData.db.query(
            `INSERT INTO bot_settings (session_id, autotyping) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE autotyping = ?`,
            [actualDbSessionId, newState, newState] // ★ Use actual DB ID
        );
    } catch (err) {
        console.error('[autotyping] DB error (toggle):', err.message);
    }

    return await sock.sendMessage(chatId, {
        text: `✅ Auto-typing has been ${newState ? 'enabled' : 'disabled'}!`
    }, { quoted: msg });
}

// ── Module exports ──
module.exports = {
    name: 'autotyping',
    execute: execute,
    handleAutotypingForMessage: handleAutotypingForMessage,
    desc: 'Auto-typing per bot session (Pro)',
    category: 'owner',
    aliases: ['typing', 'autotype']
};