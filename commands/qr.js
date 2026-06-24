const axios = require('axios');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const text = args.join(' ').trim();
    if (!text) {
        await sock.sendMessage(chatId, { text: '❌ Usage: .qr <text or URL>' }, { quoted: msg });
        return null;
    }

    try {
        const res = await axios.get(`https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(text)}`, {
            responseType: 'arraybuffer',
            timeout: 15000
        });
        
        await sock.sendMessage(chatId, {
            image: Buffer.from(res.data),
            caption: `✅ *QR Code*\n📝 ${text.slice(0, 80)}`
        }, { quoted: msg });

    } catch {
        await sock.sendMessage(chatId, { text: '❌ QR generation failed.' }, { quoted: msg });
    }
    return null;
}

module.exports = {
    name: 'qr',
    desc: 'Generate a QR code',
    category: 'general',
    execute
};

