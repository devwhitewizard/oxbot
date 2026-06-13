const path = require('path');

// ═══════════════════════════════════════════════════════════════
// Database helpers (Per-session isolation)
// ═══════════════════════════════════════════════════════════════
async function ensureColumn(db) {
    try {
        await db.query(`ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS pmblocker TINYINT(1) DEFAULT 0`);
        await db.query(`ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS pmblocker_msg VARCHAR(500) DEFAULT NULL`);
    } catch {}
}

async function getState(db, sessionId) {
    try {
        if (!db || !sessionId) return { enabled: false, message: '⚠️ Direct messages are blocked!' };
        await ensureColumn(db);
        const [rows] = await db.query(
            'SELECT pmblocker, pmblocker_msg FROM bot_settings WHERE session_id = ? LIMIT 1',
            [sessionId]
        );
        if (!rows.length) return { enabled: false, message: '⚠️ Direct messages are blocked!' };
        return {
            enabled: rows[0].pmblocker === 1,
            message: rows[0].pmblocker_msg || '⚠️ Direct messages are blocked!\nYou cannot DM this bot. Please contact the owner in group chats only.'
        };
    } catch {
        return { enabled: false, message: '⚠️ Direct messages are blocked!' };
    }
}

async function setState(db, sessionId, enabled, message) {
    try {
        if (!db || !sessionId) return;
        await ensureColumn(db);
        const val = enabled ? 1 : 0;
        if (message) {
            await db.query(
                `INSERT INTO bot_settings (session_id, pmblocker, pmblocker_msg) VALUES (?, ?, ?) 
                 ON DUPLICATE KEY UPDATE pmblocker = ?, pmblocker_msg = ?`,
                [sessionId, val, message, val, message]
            );
        } else {
            await db.query(
                `INSERT INTO bot_settings (session_id, pmblocker) VALUES (?, ?) 
                 ON DUPLICATE KEY UPDATE pmblocker = ?`,
                [sessionId, val, val]
            );
        }
    } catch (err) {
        console.error('[pmblocker] setState error:', err.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════
function cleanNumber(jid) {
    if (!jid) return '';
    return jid.split(':')[0].split('@')[0];
}

async function checkIsOwner(db, sessionId, senderId, sock, chatId) {
    try {
        if (!db || !sessionId) return false;
        const [rows] = await db.query(
            'SELECT u.phone FROM users u JOIN bots b ON b.user_id = u.id WHERE b.session_id = ? LIMIT 1',
            [sessionId]
        );
        if (!rows.length || !rows[0].phone) return false;
        const ownerNumber = String(rows[0].phone).replace(/\D/g, '');
        const ownerJid = ownerNumber + '@s.whatsapp.net';
        const senderClean = cleanNumber(senderId);

        if (senderId === ownerJid) return true;
        if (senderClean === ownerNumber) return true;
        if (senderId.includes(ownerNumber)) return true;

        if (sock && chatId && chatId.endsWith('@g.us') && senderId.includes('@lid')) {
            try {
                const metadata = await sock.groupMetadata(chatId);
                const match = (metadata.participants || []).find(p => {
                    const pClean = cleanNumber(p.id || '');
                    return pClean === ownerNumber || (p.id || '') === ownerJid;
                });
                if (match) return true;
            } catch {}
        }
        return false;
    } catch {
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════
// Command Execution
// ═══════════════════════════════════════════════════════════════
async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const db = botData?.db;
    const sessionId = botData?.sessionId;
    const senderId = msg.key.participant || msg.key.remoteJid;

    const isOwner = await checkIsOwner(db, sessionId, senderId, sock, chatId);
    
    // Silent ignore for non-owners
    if (!msg.key.fromMe && !isOwner) {
        return null;
    }
    
    const sub = (args[0] || '').toLowerCase();
    const rest = args.slice(1);
    const state = await getState(db, sessionId);

    if (!sub || !['on', 'off', 'status', 'setmsg'].includes(sub)) {
        await sock.sendMessage(chatId, { 
            text: '*🔰 PMBLOCKER (Owner only)*\n\n.pmblocker on - Enable PM auto-block\n.pmblocker off - Disable PM blocker\n.pmblocker status - Show current status\n.pmblocker setmsg <text> - Set warning message' 
        }, { quoted: msg });
        return null;
    }

    if (sub === 'status') {
        await sock.sendMessage(chatId, { 
            text: `PM Blocker is currently *${state.enabled ? 'ON ✅' : 'OFF ❌'}*\n\nMessage: ${state.message}` 
        }, { quoted: msg });
        return null;
    }

    if (sub === 'setmsg') {
        const newMsg = rest.join(' ').trim();
        if (!newMsg) {
            await sock.sendMessage(chatId, { text: '❌ Usage: .pmblocker setmsg <message>' }, { quoted: msg });
            return null;
        }
        await setState(db, sessionId, state.enabled, newMsg);
        await sock.sendMessage(chatId, { text: '✅ PM Blocker message updated.' }, { quoted: msg });
        return null;
    }

    const enable = sub === 'on';
    await setState(db, sessionId, enable);
    await sock.sendMessage(chatId, { 
        text: `PM Blocker is now *${enable ? 'ENABLED ✅' : 'DISABLED ❌'}*.` 
    }, { quoted: msg });
    
    return null;
}

// ═══════════════════════════════════════════════════════════════
// Background Handler (Blocks users in DMs automatically)
// ═══════════════════════════════════════════════════════════════
async function handlePmBlocker(sock, msg, botData) {
    const chatId = msg.key.remoteJid;
    
    // Only run in DMs (ignore groups, status, broadcasts)
    if (!chatId || chatId.endsWith('@g.us') || chatId === 'status@broadcast') return;
    
    // Don't block the bot's own messages
    if (msg.key.fromMe) return; 

    const db = botData?.db;
    const sessionId = botData?.sessionId;
    const senderId = msg.key.participant || msg.key.remoteJid;

    const state = await getState(db, sessionId);
    if (!state.enabled) return;

    // Check if the person DMing is the owner
    const isOwner = await checkIsOwner(db, sessionId, senderId, sock, chatId);
    if (isOwner) return; // Never block the owner

    // Send warning message and block them
    try {
        await sock.sendMessage(chatId, { text: state.message });
        await sock.updateBlockStatus(chatId, 'block');
    } catch (err) {
        console.error('[pmblocker] Block error:', err.message);
    }
}

module.exports = {
    name: 'pmblocker',
    aliases: ['pmblock', 'blockpm'],
    desc: 'Block users from DMing the bot',
    category: 'owner',
    execute,
    handlePmBlocker
};