/**
 * commands/setprefix.js
 * Change bot command prefix (Owner Only)
 */

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    try {
        if (!args[0]) {
            const currentPrefix = sock._customPrefix || '. | !';
            return await sock.sendMessage(chatId, {
                text: `📌 *Current Prefix:* ${currentPrefix}\n\n_Usage: .setprefix <new prefix>_`
            }, { quoted: msg });
        }

        const newPrefix = args[0];

        // Limit prefix length to prevent weird behavior
        if (newPrefix.length > 3) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Invalid Prefix!*\n_Prefix must be 1 to 3 characters long._'
            }, { quoted: msg });
        }

        // ── Save to Database ───────────────────────────────────────────────
        const db = botData?.db;
        const sessionId = botData?.sessionId;
        
        if (db && sessionId) {
            try {
                await db.query(
                    `INSERT INTO bot_settings (session_id, custom_prefix) VALUES (?, ?) 
                     ON DUPLICATE KEY UPDATE custom_prefix = ?`,
                    [sessionId, newPrefix, newPrefix]
                );
            } catch (err) {
                console.error('[SETPREFIX] DB Error:', err.message);
            }
        }

        // ── Cache on socket for instant use (no DB reads needed) ───────────
        sock._customPrefix = newPrefix;

        await sock.sendMessage(chatId, {
            text: `✅ *Prefix Changed Successfully!*\n\n📌 *New Prefix:* ${newPrefix}\n_Example: ${newPrefix}menu_`
        }, { quoted: msg });

    } catch (err) {
        console.error('[SETPREFIX] Error:', err.message);
        await sock.sendMessage(chatId, {
            text: `❌ Failed to set prefix: ${err.message}`
        }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'setprefix',
    aliases: ['prefix'],
    desc: 'Change bot command prefix',
    category: 'owner',
    execute
};