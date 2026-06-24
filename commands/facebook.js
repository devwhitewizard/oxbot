const axios = require('axios');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const url = args[0]?.trim();
    if (!url || !url.includes('facebook')) {
        await sock.sendMessage(chatId, { text: '❌ Usage: .facebook <facebook video URL>' }, { quoted: msg });
        return null;
    }

    await sock.sendMessage(chatId, { text: '📘 Downloading from Facebook...' }, { quoted: msg });

    try {
        const r = await axios.get(`https://fdown.net/download.php?URLz=${encodeURIComponent(url)}`, { 
            timeout: 15000, 
            headers: { 'User-Agent': 'Mozilla/5.0' } 
        });
        
        const match = r.data.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/);
        if (!match) {
            return await sock.sendMessage(chatId, { text: '❌ Could not download. Make sure the video is public.' }, { quoted: msg });
        }

        const buf = await axios.get(match[1], { responseType: 'arraybuffer', timeout: 30000 });
        
        await sock.sendMessage(chatId, {
            video: Buffer.from(buf.data),
            caption: '📘 *Facebook Video*\n\n_OxBot©_'
        }, { quoted: msg });

    } catch {
        await sock.sendMessage(chatId, { text: '❌ Facebook download failed.' }, { quoted: msg });
    }
    return null;
}

module.exports = {
    name: 'facebook',
    aliases: ['fb', 'fbdl'],
    desc: 'Download Facebook videos',
    category: 'general',
    execute
};