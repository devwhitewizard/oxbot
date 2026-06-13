const name     = 'demote';
const desc     = 'Demote an admin to member';
const category = 'group';

async function execute(sock, msg, botData, args) {
    const chatId   = msg.key.remoteJid;
    if (!chatId.endsWith('@g.us')) return await sock.sendMessage(chatId, { text: '❌ Group only!' }, { quoted: msg });

    const senderId = msg.key.participant || msg.key.remoteJid;
    const botJid   = sock.user?.id?.split('@')[0]?.split(':')[0] + '@s.whatsapp.net';

    let meta;
    try { meta = await sock.groupMetadata(chatId); } catch {
        return await sock.sendMessage(chatId, { text: '❌ Could not fetch group info.' }, { quoted: msg });
    }

    const botMember    = meta.participants.find(p => p.id.split(':')[0].split('@')[0] === botJid.split('@')[0]);
    const senderMember = meta.participants.find(p => p.id.split(':')[0].split('@')[0] === senderId.split(':')[0].split('@')[0]);

    if (!botMember || !['admin','superadmin'].includes(botMember.admin)) {
        return await sock.sendMessage(chatId, { text: '❌ I need to be an admin first!' }, { quoted: msg });
    }
    if (!msg.key.fromMe && !senderIsOwner && (!senderMember || !["admin","superadmin"].includes(senderMember.admin))) {
        return await sock.sendMessage(chatId, { text: '❌ Only admins can use this!' }, { quoted: msg });
    }

    let targets = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!targets.length && msg.message?.extendedTextMessage?.contextInfo?.participant) {
        targets = [msg.message.extendedTextMessage.contextInfo.participant];
    }
    if (!targets.length) return await sock.sendMessage(chatId, { text: '❌ Mention or reply to a user!\n*.demote @user*' }, { quoted: msg });

    await sock.groupParticipantsUpdate(chatId, targets, 'demote');
    const names = targets.map(j => `@${j.split('@')[0]}`).join(', ');
    await sock.sendMessage(chatId, {
        text: `⬇️ *Demoted:* ${names}\n👑 *By:* @${senderId.split('@')[0]}`,
        mentions: [...targets, senderId]
    }, { quoted: msg });
}

module.exports = { name, desc, category, execute };
