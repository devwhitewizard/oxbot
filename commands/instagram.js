const axios = require('axios');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const url = args[0]?.trim();
    if (!url || !url.includes('instagram')) {
        await sock.sendMessage(chatId, { text: '❌ Usage: .instagram <instagram URL>' }, { quoted: msg });
        return null;
    }

    await sock.sendMessage(chatId, { text: '📸 Downloading from Instagram...' }, { quoted: msg });

    try {
        const r = await axios.get(`https://instagram-downloader-download-instagram-videos-stories.p.rapidapi.com/index?url=${encodeURIComponent(url)}`, {
            headers: { 
                'x-rapidapi-host': 'instagram-downloader-download-instagram-videos-stories.p.rapidapi.com', 
                'x-rapidapi-key': 'demo' 
            },
            timeout: 15000
        });

        if (!r.data?.media) {
            return await sock.sendMessage(chatId, { text: '❌ Could not download. Make sure the post is public.' }, { quoted: msg });
        }

        const media = Array.isArray(r.data.media) ? r.data.media[0] : r.data.media;
        const buf = await axios.get(media, { responseType: 'arraybuffer', timeout: 30000 });
        
        await sock.sendMessage(chatId, {
            video: Buffer.from(buf.data),
            caption: '📸 *Instagram Media*\n\n_OxBot©_'
        }, { quoted: msg });

    } catch {
        await sock.sendMessage(chatId, { text: '❌ Instagram download failed.\n_Make sure the post is public._' }, { quoted: msg });
    }
    return null;
}

module.exports = {
    name: 'instagram',
    aliases: ['ig', 'igdl'],
    desc: 'Download Instagram media',
    category: 'general',
    execute
};