/**
 * OxBot — Auto Status Viewer
 * Downloads status media so WhatsApp marks them as viewed
 * Owner-only — verifies owner via users table using session_id
 */

let downloadFn = null;
try {
    const baileys = require('@whiskeysockets/baileys');
    if (baileys && typeof baileys.downloadContentFromMessage === 'function') {
        downloadFn = baileys.downloadContentFromMessage;
        console.log('[autostatus] Using downloadContentFromMessage from baileys');
    } else {
        console.log('[autostatus] downloadContentFromMessage not found in baileys, will use fetch fallback');
    }
} catch (e) {
    console.log('[autostatus] Could not load baileys, using fetch fallback:', e.message);
}

// ── Strip device/LID suffix from JID ──
function cleanNumber(jid) {
    if (!jid) return '';
    return jid.split(':')[0].split('@')[0];
}

// ── Fetch owner phone from DB for this session ──
async function getOwnerNumber(db, sessionId) {
    try {
        const [rows] = await db.query(
            'SELECT u.phone FROM users u JOIN bots b ON b.user_id = u.id WHERE b.session_id = ? LIMIT 1',
            [sessionId]
        );
        if (!rows.length || !rows[0].phone) return null;
        return String(rows[0].phone).replace(/\D/g, '');
    } catch (err) {
        console.error('[autostatus] DB error fetching owner:', err.message);
        return null;
    }
}

// ── Check if sender is the bot owner ──
async function isOwner(db, sessionId, senderId, sock, chatId) {
    const ownerNumber = await getOwnerNumber(db, sessionId);
    if (!ownerNumber) return false;

    const ownerJid    = ownerNumber + '@s.whatsapp.net';
    const senderClean = cleanNumber(senderId);

    // Direct JID match
    if (senderId === ownerJid) return true;
    if (senderClean === ownerNumber) return true;
    if (ownerNumber.length >= 8 && senderId.includes(ownerNumber)) return true;

    // In group chat: check if owner is a participant
    if (chatId && chatId.endsWith('@g.us')) {
        try {
            const metadata     = await sock.groupMetadata(chatId);
            const participants = metadata?.participants || [];
            if (Array.isArray(participants)) {
                const match = participants.find(p => {
                    const pClean = cleanNumber(p.id || '');
                    return pClean === ownerNumber || (p.id || '') === ownerJid;
                });
                if (match) return true;
            }
        } catch (e) {
            console.error('[autostatus] Group metadata error:', e.message);
        }
    }

    return false;
}

// ── Create seen_statuses table if it doesn't exist ──
async function ensureSeenTable(db) {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS seen_statuses (
                id INT AUTO_INCREMENT PRIMARY KEY,
                session_id VARCHAR(90) NOT NULL,
                status_id VARCHAR(90) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_session_status (session_id, status_id),
                INDEX idx_session (session_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } catch (err) {
        if (!err.message.includes('already exists')) {
            console.error('[autostatus] Table creation error:', err.message);
        }
    }
}

// ── Ensure autostatus column exists in bot_settings ──
async function ensureAutostatusColumn(db) {
    try {
        await db.query(
            `ALTER TABLE bot_settings ADD COLUMN autostatus TINYINT(1) DEFAULT 0`
        );
        console.log('[autostatus] Added autostatus column to bot_settings');
    } catch (err) {
        if (err.errno !== 1060) {
            console.error('[autostatus] Column error:', err.message);
        }
    }
}

// ── Check if autostatus is enabled for this session ──
async function isEnabled(db, sessionId) {
    try {
        await ensureAutostatusColumn(db);
        const [rows] = await db.query(
            'SELECT autostatus FROM bot_settings WHERE session_id = ? LIMIT 1',
            [sessionId]
        );
        return rows.length > 0 && rows[0].autostatus === 1;
    } catch (err) {
        console.error('[autostatus] isEnabled error:', err.message);
        return false;
    }
}

// ── Check if a status was already processed ──
async function isStatusSeen(db, sessionId, statusId) {
    try {
        const [rows] = await db.query(
            'SELECT id FROM seen_statuses WHERE session_id = ? AND status_id = ? LIMIT 1',
            [sessionId, statusId]
        );
        return rows.length > 0;
    } catch (err) {
        console.error('[autostatus] isStatusSeen error:', err.message);
        return false;
    }
}

// ── Save status as processed ──
async function markStatusSeen(db, sessionId, statusId) {
    try {
        await db.query(
            'INSERT IGNORE INTO seen_statuses (session_id, status_id) VALUES (?, ?)',
            [sessionId, statusId]
        );
    } catch (err) {
        console.error('[autostatus] markStatusSeen error:', err.message);
    }
}

// ── Get media type from status message ──
function getMediaType(message) {
    const msg = message?.message;
    if (!msg) return null;
    if (msg.imageMessage) return 'image';
    if (msg.videoMessage) return 'video';
    if (msg.audioMessage) return 'audio';
    if (msg.documentMessage) return 'document';
    if (msg.stickerMessage) return 'sticker';
    if (msg.extendedTextMessage) return 'text';
    return null;
}

// ── Get direct media URL from message ──
function getMediaUrl(message) {
    const msg = message?.message;
    if (!msg) return null;
    if (msg.imageMessage?.url)  return msg.imageMessage.url;
    if (msg.videoMessage?.url)  return msg.videoMessage.url;
    if (msg.audioMessage?.url)  return msg.audioMessage.url;
    if (msg.documentMessage?.url) return msg.documentMessage.url;
    if (msg.stickerMessage?.url) return msg.stickerMessage.url;
    return null;
}

// ── Download status media via Baileys downloadContentFromMessage (preferred method) ──
async function downloadViaBaileys(message, type) {
    if (!downloadFn) return false;

    try {
        // IMPORTANT: Pass the FULL message object, NOT message.message
        // Baileys needs the full object to extract media info
        const stream = await downloadFn(message, type);

        // Properly drain the entire stream
        for await (const chunk of stream) {
            // Consume each chunk — we don't need to save it,
            // we just need WhatsApp to register the download
        }

        console.log(`[autostatus] ✓ Baileys download succeeded (${type})`);
        return true;
    } catch (err) {
        console.error('[autostatus] Baileys download failed:', err.message);
        return false;
    }
}

// ── Download status media via direct URL fetch (fallback) ──
async function downloadViaFetch(url) {
    if (!url) return false;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        const response = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
        });
        clearTimeout(timeout);

        if (!response.ok) {
            console.error(`[autostatus] Fetch returned ${response.status}`);
            return false;
        }

        // Fully consume the response body to actually download it
        const reader = response.body.getReader();
        let downloaded = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            downloaded += value.length;
        }

        console.log(`[autostatus] ✓ Fetch download succeeded (${downloaded} bytes)`);
        return true;
    } catch (err) {
        if (err.name === 'AbortError') {
            console.error('[autostatus] Fetch timed out');
        } else {
            console.error('[autostatus] Fetch error:', err.message);
        }
        return false;
    }
}

// ── Download status media to trigger WhatsApp view ──
async function downloadStatus(message) {
    const type = getMediaType(message);

    // Text statuses have no media — just send read receipt
    if (type === 'text') {
        console.log('[autostatus] Text status — skipping download, will send read receipt');
        return 'text';
    }

    // No media found at all
    if (!type) {
        console.log('[autostatus] No media type detected in message');
        console.log('[autostatus] Message keys:', Object.keys(message?.message || {}));
        return null;
    }

    // Try Baileys method first (most reliable)
    console.log(`[autostatus] Downloading ${type} status via Baileys...`);
    let downloaded = await downloadViaBaileys(message, type);
    if (downloaded) return type;

    // Fallback: direct URL fetch
    const url = getMediaUrl(message);
    if (url) {
        console.log(`[autostatus] Baileys failed, trying fetch fallback...`);
        downloaded = await downloadViaFetch(url);
    }

    if (!downloaded) {
        console.log('[autostatus] ✗ All download methods failed');
    }

    return downloaded ? type : null;
}

// ── Send read receipt for the status ──
async function sendReadReceipt(sock, message) {
    if (!message?.key) {
        console.error('[autostatus] No message key for read receipt');
        return;
    }

    try {
        // readMessages marks the message as read on WhatsApp's end
        // For statuses, we pass the status message key
        await sock.readMessages([message.key]);

        // Give WhatsApp a moment to process the read receipt
        await new Promise(r => setTimeout(r, 800));

        console.log(`[autostatus] ✓ Read receipt sent for: ${message.key.id?.substring(0, 15)}...`);
    } catch (err) {
        console.error('[autostatus] Read receipt error:', err.message);
    }
}

// ── MAIN HANDLER — called from index.js when status@broadcast message arrives ──
async function handleAutoStatus(sock, message, botData) {
    if (!botData?.sessionId || !botData?.db) return;

    const chatId = message?.key?.remoteJid;
    if (chatId !== 'status@broadcast') return;

    const statusId = message?.key?.id;
    if (!statusId) {
        console.log('[autostatus] ⚠️ No status ID in message key, skipping');
        return;
    }

    // Ensure tables/columns exist (runs once, safe to call repeatedly)
    await ensureSeenTable(botData.db);
    await ensureAutostatusColumn(botData.db);

    // Check if auto-status is enabled
    const enabled = await isEnabled(botData.db, botData.sessionId);
    if (!enabled) return;

    // Check if already processed this status
    const seen = await isStatusSeen(botData.db, botData.sessionId, statusId);
    if (seen) return;

    console.log(`[autostatus] ▶ Processing status: ${statusId.substring(0, 20)}...`);

    try {
        // STEP 1: Download the status media
        // THIS is what actually triggers the "viewed" state on WhatsApp
        const result = await downloadStatus(message);

        // STEP 2: Send read receipt (only if download succeeded OR it's a text status)
        if (result === 'text' || result) {
            await sendReadReceipt(sock, message);
        }

        // STEP 3: Mark in DB so we never process this status again
        await markStatusSeen(botData.db, botData.sessionId, statusId);

        const label = result ? '✓' : '✗';
        console.log(`[autostatus] ${label} Status ${statusId.substring(0, 20)}... done`);
    } catch (err) {
        console.error('[autostatus] handleAutoStatus error:', err.message);
        // ALWAYS mark as seen even on error to prevent infinite retries
        await markStatusSeen(botData.db, botData.sessionId, statusId);
    }
}

// ── .autostatus command ──
// Signature: execute(sock, msg, botData, args)
async function execute(sock, msg, botData, args) {
    const chatId = msg?.key?.remoteJid;
    if (!chatId) return null;

    if (!botData?.sessionId || !botData?.db) {
        await sock.sendMessage(chatId, {
            text: '⚠️ Database error. Please restart the bot.'
        }, { quoted: msg });
        return null;
    }

    // ── Owner verification ──
    const senderId = msg?.key?.participant || msg?.key?.remoteJid;
    const senderIsOwner = await isOwner(botData.db, botData.sessionId, senderId, sock, chatId);

    if (!msg?.key?.fromMe && !senderIsOwner) {
        await sock.sendMessage(chatId, {
            text: '❌ This command is only available for the bot owner!'
        }, { quoted: msg });
        return null;
    }

    // Ensure column exists
    await ensureAutostatusColumn(botData.db);

    const action = (args[0] || '').toLowerCase().trim();

    // Explicit ON
    if (['on', 'enable', '1', 'yes'].includes(action)) {
        try {
            await botData.db.query(
                `INSERT INTO bot_settings (session_id, autostatus) VALUES (?, 1)
                 ON DUPLICATE KEY UPDATE autostatus = 1`,
                [botData.sessionId]
            );
        } catch (err) {
            console.error('[autostatus] DB error (enable):', err.message);
        }
        return await sock.sendMessage(chatId, {
            text: '✅ *Auto-Status ENABLED!*\n\n👁️ Bot will now automatically view all your contacts\' statuses as they come in.\n\n• Image statuses\n• Video statuses\n• Voice notes\n• Text statuses'
        }, { quoted: msg });
    }

    // Explicit OFF
    if (['off', 'disable', '0', 'no'].includes(action)) {
        try {
            await botData.db.query(
                `INSERT INTO bot_settings (session_id, autostatus) VALUES (?, 0)
                 ON DUPLICATE KEY UPDATE autostatus = 0`,
                [botData.sessionId]
            );
        } catch (err) {
            console.error('[autostatus] DB error (disable):', err.message);
        }
        return await sock.sendMessage(chatId, {
            text: '⛔ *Auto-Status DISABLED!*\n\n📝 Bot will no longer auto-view statuses.'
        }, { quoted: msg });
    }

    // Unknown action
    if (action) {
        return await sock.sendMessage(chatId, {
            text: '❌ Invalid option! Use:\n\n```.autostatus on```\n```.autostatus off```'
        }, { quoted: msg });
    }

    // No args → toggle
    const current = await isEnabled(botData.db, botData.sessionId);
    const newState = current ? 0 : 1;
    try {
        await botData.db.query(
            `INSERT INTO bot_settings (session_id, autostatus) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE autostatus = ?`,
            [botData.sessionId, newState, newState]
        );
    } catch (err) {
        console.error('[autostatus] DB error (toggle):', err.message);
    }

    return await sock.sendMessage(chatId, {
        text: `${newState ? '✅' : '⛔'} Auto-Status has been *${newState ? 'ENABLED' : 'DISABLED'}*!`
    }, { quoted: msg });
}

// ── Call this once when bot starts, after DB is ready ──
async function init(db) {
    await ensureSeenTable(db);
    await ensureAutostatusColumn(db);
    console.log('[autostatus] Initialized successfully');
}

module.exports = {
    name: 'autostatus',
    execute: execute,
    handleAutoStatus: handleAutoStatus,
    init: init,
    desc: 'Auto-view all contacts\' statuses (Owner Only)',
    category: 'owner',
    aliases: ['statusview', 'autoview']
};