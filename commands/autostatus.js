/**
 * autostatus.js — Auto Status Viewer (Pure SQL Version)
 * 
 * Safely handles SQL databases. Auto-creates the column if missing.
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');

// ═══════════════════════════════════════════════════
// SAFE SQL DATABASE HANDLERS
// ═══════════════════════════════════════════════════
const checkedSessions = new Set();

// Automatically adds 'autostatus' column to DB if it doesn't exist
async function ensureColumnExists(db, sessionId) {
    if (!db?.query || !sessionId || checkedSessions.has(sessionId)) return;
    checkedSessions.add(sessionId); // Prevent spamming ALTER TABLE

    try {
        // Test if column exists
        await db.query('SELECT autostatus FROM bot_settings WHERE session_id = ?', [sessionId]);
    } catch (err) {
        if (err.message.includes('Unknown column')) {
            console.log('[autostatus] Column missing, adding to database...');
            try {
                await db.query('ALTER TABLE bot_settings ADD COLUMN autostatus TINYINT(1) DEFAULT 0');
                console.log('[autostatus] ✅ Column added successfully.');
            } catch (alterErr) {
                console.error('[autostatus] Failed to add column:', alterErr.message);
            }
        }
    }
}

async function isEnabled(db, sessionId) {
    if (!db?.query || !sessionId) return false;
    
    await ensureColumnExists(db, sessionId);

    try {
        const [rows] = await db.query(
            'SELECT autostatus FROM bot_settings WHERE session_id = ?',
            [sessionId]
        );
        return rows?.length > 0 && (rows[0].autostatus === 1 || rows[0].autostatus === '1');
    } catch (err) {
        console.error('[autostatus] isEnabled error:', err.message);
        return false;
    }
}

async function setEnabled(db, sessionId, value) {
    if (!db?.query || !sessionId) return;

    await ensureColumnExists(db, sessionId);

    // Attempt 1: MySQL / MariaDB
    try {
        await db.query(
            'INSERT INTO bot_settings (session_id, autostatus) VALUES (?, ?) ON DUPLICATE KEY UPDATE autostatus = ?',
            [sessionId, value, value]
        );
        return;
    } catch (e1) {}

    // Attempt 2: SQLite
    try {
        await db.query(
            'INSERT OR REPLACE INTO bot_settings (session_id, autostatus) VALUES (?, ?)',
            [sessionId, value]
        );
        return;
    } catch (e2) {}

    // Attempt 3: Manual check-then-update-or-insert
    try {
        const [rows] = await db.query('SELECT session_id FROM bot_settings WHERE session_id = ?', [sessionId]);
        if (rows && rows.length > 0) {
            await db.query('UPDATE bot_settings SET autostatus = ? WHERE session_id = ?', [value, sessionId]);
        } else {
            await db.query('INSERT INTO bot_settings (session_id, autostatus) VALUES (?, ?)', [sessionId, value]);
        }
    } catch (e3) {
        console.error('[autostatus] All DB save attempts failed:', e3.message);
    }
}

// ═══════════════════════════════════════════════════
// IN-MEMORY SEEN-STATUS TRACKING (Anti-spam)
// ═══════════════════════════════════════════════════
const seenStatusMap = new Map();
const SEEN_CAP = 500;

function isStatusSeen(sessionId, statusId) {
    return seenStatusMap.get(sessionId)?.has(statusId) || false;
}

function markStatusSeen(sessionId, statusId) {
    if (!seenStatusMap.has(sessionId)) seenStatusMap.set(sessionId, new Set());
    const set = seenStatusMap.get(sessionId);
    set.add(statusId);
    if (set.size > SEEN_CAP) {
        const arr = [...set];
        set.clear();
        arr.slice(-200).forEach(id => set.add(id));
    }
}

function clearAutostatusMemory(sessionId) {
    if (sessionId) seenStatusMap.delete(sessionId);
}

// ═══════════════════════════════════════════════════
// PER-SESSION HOURLY VIEW CAP (Anti-ban safety)
// ═══════════════════════════════════════════════════
const VIEW_CAP_PER_HOUR = 40;
const viewTimestamps = new Map();

function underHourlyCap(sessionId) {
    const now = Date.now();
    const arr = (viewTimestamps.get(sessionId) || []).filter(ts => now - ts < 60 * 60 * 1000);
    viewTimestamps.set(sessionId, arr);
    return arr.length < VIEW_CAP_PER_HOUR;
}

function recordView(sessionId) {
    const arr = viewTimestamps.get(sessionId) || [];
    arr.push(Date.now());
    viewTimestamps.set(sessionId, arr);
}

setInterval(() => {
    const now = Date.now();
    for (const [sid, arr] of viewTimestamps) {
        const recent = arr.filter(ts => now - ts < 60 * 60 * 1000);
        if (recent.length) viewTimestamps.set(sid, recent);
        else viewTimestamps.delete(sid);
    }
}, 30 * 60 * 1000);

// ═══════════════════════════════════════════════════
// MEDIA DOWNLOAD & VIEW LOGIC
// ═══════════════════════════════════════════════════
function getMediaType(message) {
    const m = message?.message;
    if (!m) return null;
    if (m.imageMessage)        return 'image';
    if (m.videoMessage)        return 'video';
    if (m.audioMessage)        return 'audio';
    if (m.documentMessage)     return 'document';
    if (m.stickerMessage)      return 'sticker';
    if (m.extendedTextMessage) return 'text';
    if (m.conversation)        return 'text';
    return null;
}

function getMediaUrl(message) {
    const m = message?.message;
    if (!m) return null;
    return m.imageMessage?.url || m.videoMessage?.url || m.audioMessage?.url || m.documentMessage?.url || m.stickerMessage?.url || null;
}

async function downloadViaBaileys(message, type) {
    try {
        const stream = await downloadContentFromMessage(message, type);
        for await (const chunk of stream) { /* Consume stream to trigger view */ }
        return true;
    } catch (err) {
        return false;
    }
}

async function downloadViaFetch(url) {
    if (!url) return false;
    try {
        const { data } = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
        return Buffer.from(data).length > 100;
    } catch (err) {
        return false;
    }
}

async function downloadStatus(message) {
    const type = getMediaType(message);
    if (type === 'text') return 'text';
    if (!type) return null;

    if (await downloadViaBaileys(message, type)) return type;

    const url = getMediaUrl(message);
    if (url && await downloadViaFetch(url)) return type;

    return null;
}

async function sendReadReceipt(sock, message) {
    if (!message?.key) return;
    try {
        await sock.readMessages([message.key]);
        await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
    } catch {}
}

function randomDelay(minMs, maxMs) {
    return new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

// ═══════════════════════════════════════════════════
// MAIN HANDLER — triggered by index.js for status@broadcast
// ═══════════════════════════════════════════════════
async function handleAutoStatus(sock, message, botData) {
    const sessionId = botData?.sessionId || sock?._ownerPhone || sock?._botData?.sessionId;
    const db = botData?.db || sock?._botData?.db;

    if (!sessionId || !db) return;

    const chatId = message?.key?.remoteJid;
    if (chatId !== 'status@broadcast') return;

    const statusId = message?.key?.id;
    if (!statusId || message.key.fromMe) return;

    const enabled = await isEnabled(db, sessionId);
    if (!enabled) return;

    if (isStatusSeen(sessionId, statusId)) return;
    if (!underHourlyCap(sessionId)) {
        markStatusSeen(sessionId, statusId);
        return;
    }

    await randomDelay(2000, 8000);

    try {
        const result = await downloadStatus(message);
        if (result === 'text' || result) {
            await sendReadReceipt(sock, message);
        }
        markStatusSeen(sessionId, statusId);
        recordView(sessionId);
        console.log(`[autostatus] ✓ Viewed (${result || 'text'}): ${statusId.substring(0, 20)}...`);
    } catch (err) {
        console.error('[autostatus] Error viewing status:', err.message);
        markStatusSeen(sessionId, statusId);
    }
}

// ═══════════════════════════════════════════════════
// .autostatus COMMAND
// ═══════════════════════════════════════════════════
async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    if (!botData?.sessionId || !botData?.db) {
        return '⚠️ Database error. Restart the bot.';
    }

    const action = (args[0] || '').toLowerCase().trim();

    if (['on', 'enable', '1', 'yes'].includes(action)) {
        await setEnabled(botData.db, botData.sessionId, 1);
        const check = await isEnabled(botData.db, botData.sessionId);
        if (!check) {
            return '⚠️ Failed to save to database. Check your bot_settings table.';
        }
        return `✅ *AutoStatus ENABLED!*\n\nBot will now automatically view contact statuses (capped at ${VIEW_CAP_PER_HOUR}/hour for safety).`;
    }

    if (['off', 'disable', '0', 'no'].includes(action)) {
        await setEnabled(botData.db, botData.sessionId, 0);
        return `⛔ *AutoStatus DISABLED!*\n\nBot will no longer view statuses.`;
    }

    if (action) {
        return `❌ Invalid option!\n\nUse:\n\`.autostatus on\`\n\`.autostatus off\``;
    }

    const current = await isEnabled(botData.db, botData.sessionId);
    const newState = current ? 0 : 1;
    await setEnabled(botData.db, botData.sessionId, newState);

    return `${newState ? '✅' : '⛔'} AutoStatus has been *${newState ? 'ENABLED' : 'DISABLED'}*!`;
}

module.exports = {
    name:     'autostatus',
    aliases:  ['statusview', 'autoview', 'astatus'],
    desc:     'Auto-view all contact statuses',
    category: 'owner',
    execute,
    handleAutoStatus,
    clearAutostatusMemory,
};