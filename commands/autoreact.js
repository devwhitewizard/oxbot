/**
 * OxBot — Auto Status Reactor
 * Automatically "Likes" (❤️) new statuses from contacts
 * Owner-only — verifies owner via users table using session_id
 * Uses in-memory cache to handle thousands of users without DB lag
 */

// ═══════════════════════════════════════════════════════════════
// IN-MEMORY CACHE (Prevents DB spam for thousands of users)
// ═══════════════════════════════════════════════════════════════
const reactCache = new Map();
const CACHE_TTL = 30 * 1000; // Remember setting for 30 seconds

function clearReactCache(sessionId) {
    reactCache.delete(sessionId);
}

// ═══════════════════════════════════════════════════════════════
// DB Helpers (Per-user isolation)
// ═══════════════════════════════════════════════════════════════
function cleanNumber(jid) {
    if (!jid) return '';
    return jid.split(':')[0].split('@')[0];
}

async function ensureColumn(db) {
    try {
        await db.query(`ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS autoreact TINYINT(1) DEFAULT 0`);
    } catch (err) {
        if (err.errno !== 1060) {
            try { await db.query(`ALTER TABLE bot_settings ADD COLUMN autoreact TINYINT(1) DEFAULT 0`); } catch {}
        }
    }
}

async function getState(db, sessionId) {
    try {
        if (!db || !sessionId) return false;
        
        // Check cache first (Speeds up bot for thousands of users)
        const cached = reactCache.get(sessionId);
        if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.on;

        await ensureColumn(db);
        const [rows] = await db.query('SELECT autoreact FROM bot_settings WHERE session_id = ?', [sessionId]);
        const isEnabled = rows.length ? rows[0].autoreact === 1 : false;
        
        // Save to cache
        reactCache.set(sessionId, { on: isEnabled, ts: Date.now() });
        return isEnabled;
    } catch (err) {
        console.error('[autoreact] getState error:', err.message);
        return false;
    }
}

async function setState(db, sessionId, val) {
    try {
        if (!db || !sessionId) return;
        await ensureColumn(db);
        await db.query(
            'INSERT INTO bot_settings (session_id, autoreact) VALUES (?, ?) ON DUPLICATE KEY UPDATE autoreact = ?',
            [sessionId, val ? 1 : 0, val ? 1 : 0]
        );
        // Update cache immediately
        reactCache.set(sessionId, { on: val, ts: Date.now() });
    } catch (err) {
        console.error('[autoreact] setState error:', err.message);
    }
}

async function isOwner(db, sessionId, senderId) {
    try {
        const [rows] = await db.query('SELECT u.phone FROM users u JOIN bots b ON b.user_id = u.id WHERE b.session_id = ?', [sessionId]);
        if (!rows.length || !rows[0].phone) return false;
        const ownerNum = String(rows[0].phone).replace(/\D/g, '');
        return cleanNumber(senderId) === ownerNum;
    } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════
// .autoreact Command
// ═══════════════════════════════════════════════════════════════
async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    if (!botData?.sessionId || !botData?.db) {
        return await sock.sendMessage(chatId, { text: '⚠️ Database error.' }, { quoted: msg });
    }

    const senderId = msg.key.participant || msg.key.remoteJid;
    if (!msg.key.fromMe && !await isOwner(botData.db, botData.sessionId, senderId)) {
        return await sock.sendMessage(chatId, { text: '❌ Owner only!' }, { quoted: msg });
    }

    const action = (args[0] || '').toLowerCase().trim();

    if (['on', 'enable', '1', 'yes'].includes(action)) {
        await setState(botData.db, botData.sessionId, true);
        return await sock.sendMessage(chatId, {
            text: '❤️ *Auto-React ENABLED!*\n\nBot will automatically like all new statuses.'
        }, { quoted: msg });
    }

    if (['off', 'disable', '0', 'no'].includes(action)) {
        await setState(botData.db, botData.sessionId, false);
        return await sock.sendMessage(chatId, {
            text: '🚫 *Auto-React DISABLED!*\n\nBot will no longer like statuses.'
        }, { quoted: msg });
    }

    if (action) {
        return await sock.sendMessage(chatId, {
            text: '❌ Invalid option! Use:\n\n```.autoreact on```\n```.autoreact off```'
        }, { quoted: msg });
    }

    // No args -> toggle
    const current = await getState(botData.db, botData.sessionId);
    const newState = !current;
    await setState(botData.db, botData.sessionId, newState);

    return await sock.sendMessage(chatId, {
        text: `${newState ? '❤️' : '🚫'} Auto-React has been *${newState ? 'ENABLED' : 'DISABLED'}*!`
    }, { quoted: msg });
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER — Called from index.js when status arrives
// ═══════════════════════════════════════════════════════════════
async function handleAutoReact(sock, message, botData) {
    try {
        if (!botData?.sessionId || !botData?.db) return;
        if (message.key.remoteJid !== 'status@broadcast') return;
        if (!message.key.id) return;

        // Check cache/DB (Lightning fast because of cache)
        const enabled = await getState(botData.db, botData.sessionId);
        if (!enabled) return;

        // Send the "Like" (Heart reaction) to the status
        await sock.sendMessage('status@broadcast', {
            react: {
                text: '❤️',
                key: message.key
            }
        });

        console.log(`[autoreact] ❤️ Liked status: ${message.key.id.substring(0, 15)}...`);
    } catch (err) {
        // Silent fail to prevent loop crashes
        console.error('[autoreact] error:', err.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// Init function
// ═══════════════════════════════════════════════════════════════
async function init(db) {
    await ensureColumn(db);
    console.log('  ✅ Auto-react initialized');
}

module.exports = {
    name: 'autoreact',
    execute: execute,
    handleAutoReact: handleAutoReact,
    init: init,
    desc: 'Auto-like all contacts\' statuses (Owner Only)',
    category: 'owner',
    aliases: ['statuslike', 'autolike']
};