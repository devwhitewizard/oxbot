module.exports = {
    name: 'antiedit',
    aliases: ['antied'],
    desc: 'Toggle Anti-Edit feature (detect when someone edits a message).',
    category: 'admin',
    
    async execute(sock, msg, botData, args) {
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
            // ── Self-healing: Add column if it doesn't exist in bot_settings ──
            try {
                await db.query(`ALTER TABLE bot_settings ADD COLUMN anti_edit TINYINT(1) DEFAULT 0`);
            } catch (alterErr) {
                // Error 1060 means column already exists, which is perfectly fine. Ignore it.
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

            // ── Save back to SQL (Won't overwrite other settings like autotyping) ──
            await db.query(
                `INSERT INTO bot_settings (session_id, anti_edit) 
                 VALUES (?, ?) 
                 ON DUPLICATE KEY UPDATE anti_edit = VALUES(anti_edit)`,
                [sessionId, isOn ? 1 : 0]
            );

            // ── Send confirmation ──
            await sock.sendMessage(chatId, { 
                text: `🛡️ *Anti-Edit* is now ${isOn ? "✅ ON" : "❌ OFF"}\n\n_Original versions of edited messages will be sent to the chat._` 
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
};