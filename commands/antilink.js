/**
 * commands/antilink.js
 * Protects the group from WhatsApp invite links
 */

// Strips @s.whatsapp.net, @lid, and :0 to compare pure phone numbers
function cleanNum(jid) {
    if (!jid) return '';
    return jid.replace(/[^0-9]/g, '');
}

// ═══════════════════════════════════════════════════
// BACKGROUND WATCHER (Loaded by index.js)
// ═══════════════════════════════════════════════════
async function handleAntilink(sock, msg, botData) {
    const chatId = msg.key.remoteJid;
    const sender = msg.key.participant;
    const m = msg?.message;

    if (!chatId?.endsWith('@g.us') || !sender || !m) return;

    // ★ FIX 1: Check normal text AND image/video captions!
    const text = m.conversation 
              || m.extendedTextMessage?.text 
              || m.imageMessage?.caption 
              || m.videoMessage?.caption 
              || '';
              
    const linkRegex = /(https?:\/\/)?chat\.whatsapp\.com\/[A-Za-z0-9]/i;
    if (!linkRegex.test(text)) return;

    const db = botData?.db;
    if (!db) return;

    try {
        // Auto-create table if it doesn't exist
        await db.query(`CREATE TABLE IF NOT EXISTS group_settings (
            group_jid VARCHAR(50) PRIMARY KEY,
            antilink TINYINT(1) DEFAULT 0,
            antilink_action VARCHAR(10) DEFAULT 'delete',
            antitag TINYINT(1) DEFAULT 0,
            antitag_action VARCHAR(10) DEFAULT 'delete'
        )`).catch(() => {});

        // 1. Fetch group settings
        const [rows] = await db.query(
            'SELECT antilink, antilink_action FROM group_settings WHERE group_jid = ? LIMIT 1',
            [chatId]
        );

        if (!rows.length || rows[0].antilink !== 1) return;

        const action = rows[0].antilink_action || 'delete';

        // 2. Fetch metadata
        const metadata = await sock.groupMetadata(chatId);
        const botNum = cleanNum(sock.user?.id);
        const senderNum = cleanNum(sender);

        // ★ FIX 2: Use cleanNum() so :0 suffixes don't break admin checks
        const senderIsAdmin = metadata.participants?.some(p => 
            cleanNum(p.id) === senderNum && 
            (p.admin === 'admin' || p.admin === 'superadmin')
        );
        
        // Skip if sender is admin
        if (senderIsAdmin) return;
        
        // Skip if sender is bot owner
        if (senderNum === botNum) return;

        // 3. Execute Action
        if (action === 'kick') {
            // ★ FIX 3: Log errors instead of hiding them
            await sock.sendMessage(chatId, { delete: msg.key }).catch(err => {
                console.error(`[ANTILINK] Delete failed: ${err.message}`);
            });
            
            await sock.groupParticipantsUpdate(chatId, [sender], 'remove').catch(err => {
                console.error(`[ANTILINK] Kick failed: ${err.message}`);
            });
            
            console.log(`[ANTILINK] Action: KICK executed on ${senderNum}`);
        } else {
            await sock.sendMessage(chatId, { delete: msg.key }).catch(err => {
                console.error(`[ANTILINK] Delete failed: ${err.message}`);
            });
            
            console.log(`[ANTILINK] Action: DELETE executed on ${senderNum}`);
        }

    } catch (err) {
        console.error('[ANTILINK] Error:', err.message);
    }
}

// ═══════════════════════════════════════════════════
// COMMAND HANDLER
// ═══════════════════════════════════════════════════
async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    try {
        if (!chatId.endsWith('@g.us')) {
            return await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups.' }, { quoted: msg });
        }

        const db = botData?.db;
        const opt = args[0]?.toLowerCase();

        if (db) {
            await db.query(`CREATE TABLE IF NOT EXISTS group_settings (
                group_jid VARCHAR(50) PRIMARY KEY,
                antilink TINYINT(1) DEFAULT 0,
                antilink_action VARCHAR(10) DEFAULT 'delete',
                antitag TINYINT(1) DEFAULT 0,
                antitag_action VARCHAR(10) DEFAULT 'delete'
            )`).catch(() => {});
        }

        let currentStatus = 'OFF';
        let currentAction = 'delete';
        
        if (db) {
            const [rows] = await db.query('SELECT antilink, antilink_action FROM group_settings WHERE group_jid = ? LIMIT 1', [chatId]);
            if (rows.length > 0) {
                currentStatus = rows[0].antilink === 1 ? 'ON' : 'OFF';
                currentAction = rows[0].antilink_action || 'delete';
            }
        }

        if (!opt) {
            return await sock.sendMessage(chatId, {
                text: `🔗 *Antilink Protection*\n\n` +
                      `📌 Status: *${currentStatus}*\n` +
                      `⚔️ Action: *${currentAction}*\n\n` +
                      `*Commands:*\n` +
                      `• \`.antilink on\`\n` +
                      `• \`.antilink off\`\n` +
                      `• \`.antilink set delete\`\n` +
                      `• \`.antilink set kick\``
            }, { quoted: msg });
        }

        if (opt === 'on') {
            if (currentStatus === 'ON') return await sock.sendMessage(chatId, { text: '⚠️ Antilink is already *ON*.' }, { quoted: msg });
            await db.query(`INSERT INTO group_settings (group_jid, antilink) VALUES (?, 1) ON DUPLICATE KEY UPDATE antilink = 1`, [chatId]);
            return await sock.sendMessage(chatId, { text: '✅ *Antilink turned ON.*\n_⚠️ Bot MUST be a group admin to delete links!_' }, { quoted: msg });
        }

        if (opt === 'off') {
            await db.query(`UPDATE group_settings SET antilink = 0 WHERE group_jid = ?`, [chatId]);
            return await sock.sendMessage(chatId, { text: '❌ *Antilink turned OFF.*' }, { quoted: msg });
        }

        if (opt === 'set') {
            const setAction = args[1]?.toLowerCase();
            if (!['delete', 'kick'].includes(setAction)) {
                return await sock.sendMessage(chatId, { text: '❌ *Invalid action.*\nUse: `.antilink set delete` or `.antilink set kick`' }, { quoted: msg });
            }
            await db.query(`INSERT INTO group_settings (group_jid, antilink, antilink_action) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE antilink = 1, antilink_action = ?`, [chatId, setAction, setAction]);
            return await sock.sendMessage(chatId, { text: `✅ *Antilink action set to ${setAction.toUpperCase()}*` }, { quoted: msg });
        }

        return await sock.sendMessage(chatId, { text: '❌ Invalid option. Type `.antilink` to see menu.' }, { quoted: msg });

    } catch (err) {
        console.error('[ANTILINK CMD] Error:', err.message);
        await sock.sendMessage(chatId, { text: `❌ Error: ${err.message}` }, { quoted: msg });
    }
    return null;
}

module.exports = {
    handleAntilink,
    name: 'antilink',
    aliases: ['antilink'],
    desc: 'Configure antilink protection (delete/kick)',
    category: 'admin',
    execute
};