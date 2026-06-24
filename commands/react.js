const clean = (jid) => jid ? jid.split(':')[0].split('@')[0] : '';

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const senderId = msg.key.participant || msg.key.remoteJid;
    
    // ✅ Fast owner check
    let isOwner = msg.key.fromMe;
    if (!isOwner) {
        const ownerPhone = sock._ownerPhone;
        const senderNum = clean(senderId).replace(/\D/g, '');
        const ownerNum  = ownerPhone ? ownerPhone.replace(/\D/g, '') : '';
        
        if (senderNum && ownerNum) {
            const sN = senderNum.startsWith('0') ? senderNum.slice(1) : senderNum;
            const oN = ownerNum.startsWith('0') ? ownerNum.slice(1) : ownerNum;
            isOwner = sN === oN || sN.endsWith(oN) || oN.endsWith(sN);
        }
    }

    if (!isOwner) {
        await sock.sendMessage(chatId, { text: '❌ Owner only.' }, { quoted: msg });
        return null;
    }

    const emoji = args[0] || '❤️';
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    
    if (!ctx?.stanzaId) {
        await sock.sendMessage(chatId, { text: '❌ Reply to a message with .react <emoji>' }, { quoted: msg });
        return null;
    }

    try {
        await sock.sendMessage(chatId, {
            react: {
                text: emoji,
                key: { remoteJid: chatId, id: ctx.stanzaId, participant: ctx.participant }
            }
        });
    } catch {
        await sock.sendMessage(chatId, { text: '❌ Failed to react.' }, { quoted: msg });
    }
    return null;
}

module.exports = {
    name: 'react',
    desc: 'React to a message',
    category: 'owner',
    execute
};