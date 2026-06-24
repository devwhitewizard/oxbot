/**
 * commands/tagnotadmin.js
 * Tag all non-admin members in the group
 */

const name     = 'tagnotadmin';
const aliases  = ['tagna', 'tagmembers'];
const desc     = 'Tag all non-admin members in the group';
const category = 'group';

// ✅ Robust JID cleaner
function cleanNum(jid) {
    if (!jid) return '';
    return jid.replace(/[^0-9]/g, '');
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups.' }, { quoted: msg });
    }

    const senderId = msg.key.participant || chatId;

    // 1. Check if sender is Owner
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

    // 2. Fetch group metadata
    let meta;
    try { 
        meta = await sock.groupMetadata(chatId); 
    } catch {
        return await sock.sendMessage(chatId, { text: '❌ Could not fetch group info.' }, { quoted: msg });
    }

    const senderNum = cleanNum(senderId);

    // 3. If NOT the owner, check if sender is a Group Admin
    if (!msg.key.fromMe && !senderIsOwner) {
        const isSenderAdmin = meta.participants?.some(p => 
            cleanNum(p.id) === senderNum && 
            (p.admin === 'admin' || p.admin === 'superadmin')
        );

        if (!isSenderAdmin) {
            return await sock.sendMessage(chatId, { text: '❌ Only group admins can use this.' }, { quoted: msg });
        }
    }

    // 4. Filter out admins and group owner
    const nonAdmins = meta.participants.filter(p => !p.admin);
    
    if (nonAdmins.length === 0) {
        return await sock.sendMessage(chatId, { text: '✅ No non-admin members to tag.' }, { quoted: msg });
    }

    // 5. Build mentions array (★ FIX: Force @s.whatsapp.net so WhatsApp actually highlights them!)
    const mentions = nonAdmins.map(p => {
        const num = cleanNum(p.id);
        return num + '@s.whatsapp.net';
    });

    // 6. Build beautiful formatted text
    const customMsg = args.join(' ').trim() || 'Attention Non-Admins';
    const senderTag = (msg.key.participant || msg.key.remoteJid).split('@')[0];

    let text = `╭━━━【 *${customMsg}* 】━━━╮\n`;
    text += `│ 👥 *Members Tagged: ${nonAdmins.length}*\n`;
    text += `│ 📢 *By: @${senderTag}*\n`;
    text += `│\n`;
    
    nonAdmins.forEach(p => {
        const num = cleanNum(p.id);
        text += `│ ➤ @${num}\n`;
    });
    
    text += `╰━━━━━━━━━━━━━━━━━━━━━━━━╯`;

    await sock.sendMessage(chatId, { 
        text, 
        mentions 
    }, { quoted: msg });

    return null;
}

module.exports = { name, aliases, desc, category, execute };