const name     = 'tagall';
const desc     = 'Tag all members in a group';
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

    const senderMember = meta.participants.find(p => p.id.split(':')[0].split('@')[0] === senderId.split(':')[0].split('@')[0]);
    if (!msg.key.fromMe && (!senderMember || !['admin','superadmin'].includes(senderMember.admin))) {
        return await sock.sendMessage(chatId, { text: '❌ Only admins can use this!' }, { quoted: msg });
    }

    const customMsg = args.join(' ') || '📢 Attention everyone!';
    const mentions  = meta.participants.map(p => p.id);
    const tags      = mentions.map(j => `@${j.split('@')[0]}`).join(' ');

    await sock.sendMessage(chatId, {
        text: `*${customMsg}*\n\n${tags}`,
        mentions
    }, { quoted: msg });
}

module.exports = { name, desc, category, execute };
