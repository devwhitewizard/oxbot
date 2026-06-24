/**
 * commands/goodbye.js
 * Send a message when a member leaves the group
 */

const name     = 'goodbye';
const aliases  = ['goodbyeon', 'goodbyeoff'];
const desc     = 'Enable/disable goodbye messages';
const category = 'admin';

function cleanNum(jid) {
    if (!jid) return '';
    return jid.replace(/[^0-9]/g, '');
}

// ═══════════════════════════════════════════════════
// BACKGROUND WATCHER (Called when someone leaves)
// ═══════════════════════════════════════════════════
async function handleGoodbye(sock, groupJid, action, participants) {
    // Only trigger when someone is removed or leaves
    if (action !== 'remove' && action !== 'leave') return;
    if (!groupJid?.endsWith('@g.us') || !participants?.length) return;

    const db = sock._botData?.db;
    if (!db) return;

    try {
        // Auto-create columns if they don't exist
        await db.query(`ALTER TABLE group_settings ADD COLUMN goodbye TINYINT(1) DEFAULT 0`).catch(() => {});
        await db.query(`ALTER TABLE group_settings ADD COLUMN goodbye_message TEXT DEFAULT NULL`).catch(() => {});

        // 1. Check if goodbye is enabled for this specific group
        const [rows] = await db.query(
            'SELECT goodbye, goodbye_message FROM group_settings WHERE group_jid = ? LIMIT 1',
            [groupJid]
        );

        if (!rows.length || rows[0].goodbye !== 1) return;

        // 2. Get the custom message or use default
        const defaultMsg = `👋 *@user* has left the group.`;
        let text = rows[0].goodbye_message || defaultMsg;

        // 3. Replace @user with actual numbers
        const mentions = participants.map(p => {
            const num = cleanNum(p);
            text = text.replace('@user', `@${num}`);
            return num + '@s.whatsapp.net'; // Force @s.whatsapp.net for reliable tagging
        });

        // 4. Send the goodbye message
        await sock.sendMessage(groupJid, { text, mentions });

    } catch (err) {
        console.error('[GOODBYE] Error:', err.message);
    }
}

// ═══════════════════════════════════════════════════
// COMMAND HANDLER
// ═══════════════════════════════════════════════════
async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ Group only!' }, { quoted: msg });
    }

    const senderId = msg.key.participant || chatId;
    const db = botData?.db;
    const opt = args[0]?.toLowerCase();

    // 1. Check if sender is Owner or Admin
    let senderIsOwner = msg.key.fromMe;
    if (!senderIsOwner) {
        const ownerPhone = sock._ownerPhone;
        const senderNum = cleanNum(senderId);
        const ownerNum  = ownerPhone ? cleanNum(ownerPhone) : '';
        if (senderNum && ownerNum) {
            const sNorm = senderNum.startsWith('0') ? senderNum.slice(1) : senderNum;
            const oNorm = ownerNum.startsWith('0') ? ownerNum.slice(1) : ownerNum;
            senderIsOwner = sNorm === oNorm || sNorm.endsWith(oNorm) || oNorm.endsWith(sNorm);
        }
    }

    if (!msg.key.fromMe && !senderIsOwner) {
        try {
            const meta = await sock.groupMetadata(chatId);
            const senderNum = cleanNum(senderId);
            const senderIsAdmin = meta.participants?.some(p => 
                cleanNum(p.id) === senderNum && 
                (p.admin === 'admin' || p.admin === 'superadmin')
            );
            if (!senderIsAdmin) return await sock.sendMessage(chatId, { text: '❌ Only admins can use this.' }, { quoted: msg });
        } catch {}
    }

    // 2. Ensure DB table/columns exist
    if (db) {
        await db.query(`CREATE TABLE IF NOT EXISTS group_settings (
            group_jid VARCHAR(50) PRIMARY KEY,
            antilink TINYINT(1) DEFAULT 0,
            antilink_action VARCHAR(10) DEFAULT 'delete',
            antitag TINYINT(1) DEFAULT 0,
            antitag_action VARCHAR(10) DEFAULT 'delete',
            goodbye TINYINT(1) DEFAULT 0,
            goodbye_message TEXT DEFAULT NULL
        )`).catch(() => {});
    }

    // 3. Fetch current status
    let currentStatus = 'OFF';
    let currentMsg = 'Not set';
    if (db) {
        const [rows] = await db.query('SELECT goodbye, goodbye_message FROM group_settings WHERE group_jid = ? LIMIT 1', [chatId]);
        if (rows.length > 0) {
            currentStatus = rows[0].goodbye === 1 ? 'ON' : 'OFF';
            currentMsg = rows[0].goodbye_message || 'Not set';
        }
    }

    // 4. Handle Commands
    if (!opt) {
        return await sock.sendMessage(chatId, {
            text: `👋 *Goodbye Messages*\n\n` +
                  `📌 Status: *${currentStatus}*\n` +
                  `📝 Message: ${currentMsg}\n\n` +
                  `*Commands:*\n` +
                  `• \`.goodbye on\`\n` +
                  `• \`.goodbye off\`\n` +
                  `• \`.goodbye set <text>\` (Use @user as placeholder)`
        }, { quoted: msg });
    }

    if (opt === 'on') {
        await db.query(`INSERT INTO group_settings (group_jid, goodbye) VALUES (?, 1) ON DUPLICATE KEY UPDATE goodbye = 1`, [chatId]);
        return await sock.sendMessage(chatId, { text: '✅ *Goodbye messages enabled!*\n_Members will be greeted when they leave._' }, { quoted: msg });
    }

    if (opt === 'off') {
        await db.query(`UPDATE group_settings SET goodbye = 0 WHERE group_jid = ?`, [chatId]);
        return await sock.sendMessage(chatId, { text: '❌ *Goodbye messages disabled.*' }, { quoted: msg });
    }

    if (opt === 'set') {
        const customMsg = args.slice(1).join(' ').trim();
        if (!customMsg) return await sock.sendMessage(chatId, { text: '❌ Provide a message!\n_Example: .goodbye set Goodbye @user, we will miss you!_' }, { quoted: msg });
        
        await db.query(`INSERT INTO group_settings (group_jid, goodbye, goodbye_message) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE goodbye = 1, goodbye_message = ?`, [chatId, customMsg, customMsg]);
        return await sock.sendMessage(chatId, { text: `✅ *Goodbye message set to:*\n"${customMsg}"` }, { quoted: msg });
    }

    return await sock.sendMessage(chatId, { text: '❌ Invalid option. Type `.goodbye` to see menu.' }, { quoted: msg });
}

module.exports = {
    handleGoodbye, // Exported for main connection file
    name, aliases, desc, category, execute
};