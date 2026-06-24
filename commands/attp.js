/**
 * commands/attp.js
 * Animated Text to Picture Sticker (Uses Free Cloud APIs)
 */

const axios = require('axios');

// Free ATTP APIs (No ffmpeg or local files needed!)
const ATTP_APIS = [
    {
        name: 'Violetics',
        url: (text) => `https://violetics.pw/api/text2sticker?text=${encodeURIComponent(text)}`,
        parse: async (res) => {
            // API returns either a base64 string or a URL
            let buffer;
            if (res.data?.result) {
                // If it returns base64 directly
                const b64 = res.data.result.includes('base64,') 
                    ? res.data.result.split(',')[1] 
                    : res.data.result;
                buffer = Buffer.from(b64, 'base64');
            } else if (res.data?.image) {
                const b64 = res.data.image.includes('base64,') 
                    ? res.data.image.split(',')[1] 
                    : res.data.image;
                buffer = Buffer.from(b64, 'base64');
            } else if (typeof res.data === 'string' && res.data.length > 100) {
                // Raw base64 string
                buffer = Buffer.from(res.data, 'base64');
            }
            
            if (buffer && buffer.length > 0) return buffer;
            throw new Error('No image in response');
        }
    },
    {
        name: 'OnRender',
        url: 'https://text2sticker.onrender.com/render',
        method: 'post',
        body: (text) => ({ text }),
        parse: async (res) => {
            if (res.data && Buffer.isBuffer(res.data)) return res.data;
            throw new Error('Invalid response format');
        }
    }
];

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const text = args.join(' ').trim();
    
    if (!text) {
        return await sock.sendMessage(chatId, {
            text: `❌ *Please provide text!*\n\n*Example:*\n.attp Hello World\n.attp I love OxBot`
        }, { quoted: msg });
    }

    if (text.length > 60) {
        return await sock.sendMessage(chatId, {
            text: '❌ *Text is too long!*\n\n_Maximum 60 characters for ATTP._'
        }, { quoted: msg });
    }

    await sock.sendMessage(chatId, { text: '✨ *Creating animated text...*' }, { quoted: msg });

    let stickerBuffer = null;

    // Try each API until one works
    for (const api of ATTP_APIS) {
        try {
            let response;
            if (api.method === 'post') {
                response = await axios.post(api.url(text), api.body(text), {
                    responseType: 'arraybuffer',
                    timeout: 20000,
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
            } else {
                response = await axios.get(api.url(text), {
                    responseType: 'arraybuffer',
                    timeout: 20000,
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
            }

            stickerBuffer = await api.parse(response);
            
            if (stickerBuffer) {
                console.log(`[ATTP] ✅ Success via ${api.name}`);
                break;
            }
        } catch (err) {
            console.log(`[ATTP] ❌ ${api.name} failed: ${err.message}`);
        }
    }

    if (!stickerBuffer) {
        return await sock.sendMessage(chatId, {
            text: '❌ *Failed to create sticker.*\n_The ATTP servers might be busy. Try again._'
        }, { quoted: msg });
    }

    try {
        // Check if buffer is actually a valid webp/image size (max 3MB for sticker)
        if (stickerBuffer.length > 3 * 1024 * 1024) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Generated image was too large to send as a sticker._'
            }, { quoted: msg });
        }

        await sock.sendMessage(chatId, {
            sticker: stickerBuffer
        }, { quoted: msg });

    } catch (err) {
        console.error('[ATTP] Send error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ *Failed to send sticker.*\n_The generated image format might be unsupported._'
        }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'attp',
    aliases: ['ttp'],
    desc: 'Create animated text sticker',
    category: 'general',
    execute
};