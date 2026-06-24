const axios = require('axios');

// ── API PROVIDERS (Free, no keys needed) ──────────────────────────────────────
const PROVIDERS = [
    {
        name: 'NexRay',
        url: (q) => `https://api.nexray.web.id/search/pinterest?q=${encodeURIComponent(q)}`,
        parse: (d) => {
            if (!d?.status || !Array.isArray(d.result)) return null;
            return d.result.slice(0, 5).map(item => ({
                url: item.images_url || item.image || item.url,
                desc: item.description || item.title || '',
                author: item.pinner?.full_name || ''
            })).filter(i => i.url);
        }
    },
    {
        name: 'Vreden',
        url: (q) => `https://api.vreden.my.id/api/pinterest/search?query=${encodeURIComponent(q)}`,
        parse: (d) => {
            if (!d?.status || !Array.isArray(d.result)) return null;
            return d.result.slice(0, 5).map(item => ({
                url: item.image || item.images_url || item.url,
                desc: item.title || item.description || '',
                author: ''
            })).filter(i => i.url);
        }
    },
    {
        name: 'Aemt',
        url: (q) => `https://aemt.me/api/pinterest?q=${encodeURIComponent(q)}`,
        parse: (d) => {
            if (!d?.status || !Array.isArray(d.result)) return null;
            return d.result.slice(0, 5).map(item => ({
                url: item.url || item.image || item.images_url,
                desc: item.title || item.description || '',
                author: ''
            })).filter(i => i.url);
        }
    }
];

// ── MAIN COMMAND ──────────────────────────────────────────────────────────────
async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const query = args.join(' ').trim();
    if (!query) {
        await sock.sendMessage(chatId, {
            text: '❌ *Usage:* .pinterest <search query>\n\n_Example: .pinterest aesthetic anime_'
        }, { quoted: msg });
        return null;
    }

    await sock.sendMessage(chatId, {
        text: `📌 *Searching Pinterest for:* "${query}"...\n_Please wait..._`
    }, { quoted: msg });

    let images = null;

    // ── STEP 1: Try each API until one works ──────────────────────────────────
    for (const provider of PROVIDERS) {
        try {
            const res = await axios.get(provider.url(query), { timeout: 15000 });
            const parsed = provider.parse(res.data);
            
            if (parsed && parsed.length > 0) {
                images = parsed;
                console.log(`[Pinterest] ✅ Success via ${provider.name} (${images.length} images)`);
                break; // Stop checking other APIs once we get results
            }
        } catch (err) {
            console.log(`[Pinterest] ❌ ${provider.name} failed: ${err.message}`);
        }
    }

    // ── STEP 2: Handle no results ─────────────────────────────────────────────
    if (!images) {
        return await sock.sendMessage(chatId, {
            text: '❌ *Pinterest search failed.*\n_No results found or all servers are busy. Try a different query._'
        }, { quoted: msg });
    }

    // ── STEP 3: Send images with delay (prevents WhatsApp spam ban) ───────────
    let sent = 0;
    for (const img of images) {
        try {
            const captionParts = [
                `📌 *Pinterest Image ${sent + 1}/${images.length}*`,
                img.desc ? `📝 ${img.desc.slice(0, 100)}` : '',
                img.author ? `👤 ${img.author}` : '',
                `\n_OxBot ©_`
            ].filter(Boolean).join('\n');

            await sock.sendMessage(chatId, {
                image: { url: img.url },
                caption: captionParts
            }, { quoted: msg });

            sent++;
            // 500ms delay between images is crucial for VPS to avoid temp bans
            await new Promise(r => setTimeout(r, 500)); 

        } catch (err) {
            // If one image fails to send (e.g., broken link), skip it and try the next
            console.log(`[Pinterest] ⚠️ Failed to send image ${sent + 1}: ${err.message}`);
        }
    }

    // ── STEP 4: Final check if ALL images failed to send ──────────────────────
    if (sent === 0) {
        await sock.sendMessage(chatId, {
            text: '❌ *Failed to download images.*\n_The image links might be broken. Try another query._'
        }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'pinterest',
    aliases: ['pin', 'pint'],
    desc: 'Search and download Pinterest images',
    category: 'general',
    execute
};