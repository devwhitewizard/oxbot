const axios = require('axios');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const url = args[0]?.trim();
    if (!url || (!url.includes('twitter') && !url.includes('x.com'))) {
        await sock.sendMessage(chatId, { text: '❌ Usage: .twitter <tweet URL>' }, { quoted: msg });
        return null;
    }

    await sock.sendMessage(chatId, { text: '🐦 Downloading from Twitter/X...' }, { quoted: msg });

    try {
        const r = await axios.get(`https://twitsave.com/info?url=${encodeURIComponent(url)}`, { timeout: 15000 });
        const match = r.data.match(/https:\/\/video\.twimg\.com[^"]+\.mp4[^"]*/);
        
        if (!match) {
            await sock.sendMessage(chatId, { text: '❌ No video found. Make sure the tweet has a video.' }, { quoted: msg });
            return null;
        }

        const buf = await axios.get(match[0], { responseType: 'arraybuffer', timeout: 30000 });
        await sock.sendMessage(chatId, {
            video: Buffer.from(buf.data),
            caption: '🐦 *Twitter/X Video*\n\n_OxBot©_'
        }, { quoted: msg });

    } catch (err) {
        await sock.sendMessage(chatId, { text: '❌ Twitter download failed.' }, { quoted: msg });
    }
    return null;
}

module.exports = {
    name: 'twitter',
    aliases: ['tweet', 'tw'],
    desc: 'Download Twitter/X videos',
    category: 'general',
    execute
};