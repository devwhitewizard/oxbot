/**
 * commands/antiedit.js
 * Detects when users edit their messages and sends the new text
 */

// ═══════════════════════════════════════════════════
// BACKGROUND WATCHER (Loaded by index.js)
// ═══════════════════════════════════════════════════
async function handleAntiEdit(sock, msg, botData) {
    const m = msg?.message;
    const chatId = msg.key.remoteJid;
    
    // 1. Check if this is a Message Edit (Protocol Message Type 14)
    // If it's not an edit, or it's a status, ignore it.
    if (!m?.protocolMessage || m.protocolMessage.type !== 14) return;
    if (!chatId || chatId === 'status@broadcast') return;

    const db = botData?.db;
    const sessionId = botData?.sessionId;
    if (!db || !sessionId) return;

    try {
        // 2. Check if anti-edit is turned ON in the database
        const [rows] = await db.query(
            'SELECT anti_edit FROM bot_settings WHERE session_id = ?', 
            [sessionId]
        );
        
        // If it's off or not set, do nothing
        if (!rows.length || rows[0].anti_edit !== 1) return;

        // 3. Extract who edited and what they changed it to
        const sender = msg.key.participant || chatId;
        const senderNum = sender.split('@')[0];
        const editedMessage = m.protocolMessage.editedMessage;
        
        // Get the new text (works for normal text, image captions, etc.)
        const newText = editedMessage?.conversation 
                     || editedMessage?.extendedTextMessage?.text 
                     || editedMessage?.imageMessage?.caption 
                     || '[Media/File]';

        if (!newText) return;

        // 4. Send the alert to the chat
        await sock.sendMessage(chatId, {
            text: `⚠️ *Message Edited Detected*\n\n👤 *@${senderNum}*\n📝 *New Text:*\n${newText}`,
            mentions: [sender]
        });

    } catch (err) {
        console.error('[ANTIEDIT] Error:', err.message);
    }
}

// ═══════════════════════════════════════════════════
// COMMAND HANDLER
// ═══════════════════════════════════════════════════
async function execute(sock, msg, botData, args) {
    const chatId    = msg.key.remoteJid;
    if (!chatId) return null;

    const db        = botData?.db;
    const sessionId = botData?.sessionId;

    if (!db || !sessionId) {
        return await sock.sendMessage(chatId, { 
            text: '❌ Database error.' 
        }, { quoted: msg });
    }

    try {
        // ── Self-healing: Add column if it doesn't exist ──
        try {
            await db.query(`ALTER TABLE bot_settings ADD COLUMN anti_edit TINYINT(1) DEFAULT 0`);
        } catch (alterErr) {
            // Error 1060 means column already exists, which is perfectly fine.
            if (alterErr.code !== 'ER_DUP_FIELDNAME') {
                console.error('[ANTIEDIT] Alter table error:', alterErr.message);
            }
        }

        // ── Get current setting from SQL ──
        const [rows] = await db.query(
            'SELECT anti_edit FROM bot_settings WHERE session_id = ?', 
            [sessionId]
        );
        
        let isOn = rows.length > 0 ? Boolean(rows[0].anti_edit) : false;

        // ── Toggle or set based on args ──
        if (args[0] === 'on') {
            isOn = true;
        } else if (args[0] === 'off') {
            isOn = false;
        } else {
            isOn = !isOn; // Toggle if no arg provided
        }

        // ── Save back to SQL ──
        await db.query(
            `INSERT INTO bot_settings (session_id, anti_edit) 
             VALUES (?, ?) 
             ON DUPLICATE KEY UPDATE anti_edit = VALUES(anti_edit)`,
            [sessionId, isOn ? 1 : 0]
        );

        // ── Send confirmation ──
        await sock.sendMessage(chatId, { 
            text: `🛡️ *Anti-Edit* is now ${isOn ? "✅ ON" : "❌ OFF"}\n\n_Edited messages will now be exposed in the chat._` 
        }, { quoted: msg });

        return null;

    } catch (err) {
        console.error('[ANTIEDIT] Error:', err.message);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to update anti-edit setting.' 
        }, { quoted: msg });
        return null;
    }
}

module.exports = {
    handleAntiEdit, // Exported for index.js
    name: 'antiedit',
    aliases: ['antied'],
    desc: 'Toggle Anti-Edit feature (detect when someone edits a message).',
    category: 'admin',
    execute
};