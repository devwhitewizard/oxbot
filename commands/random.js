/**
 * commands/random.js
 * Fetches a random anime and sends the image + details
 */

const axios = require('axios');

// Free APIs with no keys required (tries the next one if one fails)
const ANIME_APIS = [
    {
        name: 'Jikan',
        url: 'https://api.jikan.moe/v4/random/anime',
        parse: (d) => {
            if (!d?.data) return null;
            return {
                title: d.data.title || d.data.title_english || 'Unknown Anime',
                image: d.data.images?.jpg?.image_url || d.data.images?.webp?.image_url,
                synopsis: d.data.synopsis || '',
                episodes: d.data.episodes || '?',
                score: d.data.score || '?',
                status: d.data.status || '?',
                url: d.data.url || ''
            };
        }
    },
    {
        name: 'Waifu.pics',
        url: 'https://api.waifu.pics/sfw/waifu',
        parse: (d) => {
            if (!d?.url) return null;
            return {
                title: 'Random Waifu',
                image: d.url,
                synopsis: 'Powered by waifu.pics',
                episodes: '∞',
                score: '∞',
                status: 'SFW',
                url: 'https://waifu.pics'
            };
        }
    }
];

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    await sock.sendMessage(chatId, { text: '🔍 *Fetching random anime...*' }, { quoted: msg });

    let anime = null;

    // Try each API until one works
    for (const api of ANIME_APIS) {
        try {
            const res = await axios.get(api.url, {
                timeout: 15000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            
            const parsed = api.parse(res.data);
            if (parsed && parsed.image) {
                anime = parsed;
                console.log(`[RANDOM ANIME] ✅ Success via ${api.name}`);
                break;
            }
        } catch (err) {
            console.log(`[RANDOM ANIME] ❌ ${api.name} failed: ${err.message}`);
        }
    }

    if (!anime) {
        return await sock.sendMessage(chatId, {
            text: '❌ *Failed to fetch anime.*\n_All anime servers are busy. Try again in a few seconds._'
        }, { quoted: msg });
    }

    try {
        // Download the image into memory (No saving to disk!)
        const imgRes = await axios.get(anime.image, {
            responseType: 'arraybuffer',
            timeout: 20000,
            headers: { 
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://myanimelist.net/'
            }
        });
        const imageBuffer = Buffer.from(imgRes.data);

        // Check if image is too large for WhatsApp (max 10MB)
        if (imageBuffer.length > 10 * 1024 * 1024) {
            return await sock.sendMessage(chatId, {
                text: `*${anime.title}*\n\n⚠️ _Image was too large to send._\n\n📺 Episodes: ${anime.episodes}\n⭐ Score: ${anime.score}\n📊 Status: ${anime.status}${anime.url ? `\n\n🔗 ${anime.url}` : ''}`
            }, { quoted: msg });
        }

        // Build clean caption
        let caption = `🌟 *${anime.title}*\n\n`;
        if (anime.episodes !== '∞') caption += `📺 *Episodes:* ${anime.episodes}\n`;
        if (anime.score !== '∞') caption += `⭐ *Score:* ${anime.score}/10\n`;
        if (anime.status !== '∞') caption += `📊 *Status:* ${anime.status}\n`;
        
        if (anime.synopsis && anime.synopsis.length > 0) {
            // Truncate long summaries so WhatsApp doesn't cut off the message
            const shortSynopsis = anime.synopsis.length > 200 
                ? anime.synopsis.substring(0, 200) + '...' 
                : anime.synopsis;
            caption += `\n\n📝 *Synopsis:*\n${shortSynopsis}`;
        }

        if (anime.url) {
            caption += `\n\n🔗 *MyAnimeList:* ${anime.url}`;
        }

        caption += `\n\n_OxBot ©_`;

        // Send image directly from memory
        await sock.sendMessage(chatId, {
            image: imageBuffer,
            caption
        }, { quoted: msg });

    } catch (err) {
        console.error('[RANDOM ANIME] Image download failed:', err.message);
        
        // Fallback to text only if image fails
        await sock.sendMessage(chatId, {
            text: `🌟 *${anime.title}*\n\n⚠️ _Failed to download image._\n\n📺 *Episodes:* ${anime.episodes}\n⭐ *Score:* ${anime.score}\n📊 *Status:* ${anime.status}\n\n🔗 *Link:* ${anime.url || 'N/A'}\n\n_OxBot ©_`
        }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'random',
    aliases: ['animerandom', 'randomanime', 'anime'],
    desc: 'Get a random anime recommendation',
    category: 'anime',
    execute
};