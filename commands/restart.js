const clean = (jid) => jid ? jid.split(':')[0].split('@')[0] : '';

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    const senderId = msg.key.participant || msg.key.remoteJid;

    // Fast owner check
    let isOwner = msg.key.fromMe;
    if (!isOwner && sock._ownerPhone) {
        const sN = clean(senderId).replace(/\D/g, '');
        const oN = sock._ownerPhone.replace(/\D/g, '');
        if (sN.startsWith('0')) sN.slice(1);
        if (oN.startsWith('0')) oN.slice(1);
        if (sN === oN || sN.endsWith(oN) || oN.endsWith(sN)) isOwner = true;
    }

    if (!isOwner) {
        await sock.sendMessage(chatId, { text: '❌ Owner only.' }, { quoted: msg });
        return null;
    }

    try {
        await sock.sendMessage(chatId, { text: '🔄 *Restarting Bot Session...*\n\nPlease wait about 5-10 seconds.' }, { quoted: msg });
        
        // Gracefully close the socket. 
        // botManager.js will detect the 'close' event and automatically reconnect this specific bot!
        setTimeout(() => {
            try { sock.ws?.close(); } catch {}
            try { sock.end(); } catch {}
        }, 1000);

    } catch (err) {
        await sock.sendMessage(chatId, { text: '❌ Failed to restart.' }, { quoted: msg });
    }
    return null;
}

module.exports = { name: 'restart', desc: 'Restart your bot session', category: 'owner', execute };