/**
 * tiktok.js — TikTok Video Downloader
 * Aliases: .tiktok, .tt, .tk, .tikdown, .tdown
 * Downloads: No-watermark video via Siputzx API → ttdl fallback
 * Caption: DOWNLOADED BY OX BOT
 */

const axios = require('axios');

// Lazy-load ttdl so startup doesn't crash if package missing
let ttdl = null;
try {
    const scraper = require('ruhend-scraper');
    ttdl = scraper.ttdl;
    if (ttdl) console.log('  ✅ ruhend-scraper loaded for TikTok');
} catch {
    console.log('  ⚠️ ruhend-scraper not found — TikTok will use API-only mode');
}

// ─── Valid TikTok URL patterns ────────────────────────────────────────────────
const TIKTOK_PATTERNS = [
    /https?:\/\/(?:www\.)?tiktok\.com\//,
    /https?:\/\/(?:vm\.)?tiktok\.com\//,
    /https?:\/\/(?:vt\.)?tiktok\.com\//,
    /https?:\/\/(?:www\.)?tiktok\.com\/@/,
    /https?:\/\/(?:www\.)?tiktok\.com\/t\//,
];

function isValidTikTokUrl(url) {
    return TIKTOK_PATTERNS.some(p => p.test(url));
}

// ─── Download helpers ─────────────────────────────────────────────────────────

/**
 * Try Siputzx API first — returns { videoUrl, title } or null
 */
async function tryApiDownload(url) {
    try {
        const apiUrl = `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`;
        const { data } = await axios.get(apiUrl, {
            timeout: 15000,
            headers: {
                accept: '*/*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        });

        if (!data?.status || !data?.data) return null;

        const d = data.data;
        const title = d.metadata?.title || 'TikTok Video';

        // Try all known key names the API might return
        const videoUrl = (d.urls && d.urls[0])
            || d.video_url
            || d.url
            || d.download_url
            || null;

        return videoUrl ? { videoUrl, title } : null;
    } catch {
        return null;
    }
}

/**
 * Download video buffer from a direct URL
 */
async function downloadBuffer(videoUrl) {
    const { data } = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 100 * 1024 * 1024, // 100 MB
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'video/mp4,video/*,*/*;q=0.9',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            Connection: 'keep-alive',
            Referer: 'https://www.tiktok.com/',
        },
    });
    const buf = Buffer.from(data);
    if (!buf || buf.length < 1000) throw new Error('Empty or too-small buffer');
    return buf;
}

// ─── Main execute ─────────────────────────────────────────────────────────────

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    // ── Show usage if no URL ──────────────────────────────────────────────────
    if (!args || args.length === 0) {
        return `*📱 TIKTOK DOWNLOADER*

*.tiktok <link>* — Download TikTok video without watermark

*Aliases:* .tt  .tk  .tikdown  .tdown

*Examples:*
• \`.tiktok https://vm.tiktok.com/xxxxx\`
• \`.tt https://www.tiktok.com/@user/video/123\`

_Supports all TikTok link formats._`;
    }

    const url = args[0].trim();

    // ── Validate URL ──────────────────────────────────────────────────────────
    if (!isValidTikTokUrl(url)) {
        return `❌ *Invalid TikTok link*\n\nMake sure the link looks like:\n• https://vm.tiktok.com/xxxxx\n• https://www.tiktok.com/@user/video/123\n\nTry again with a valid TikTok URL.`;
    }

    // ── Typing indicator ──────────────────────────────────────────────────────
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('composing', chatId);
    } catch {}

    // ── React to show we're working ───────────────────────────────────────────
    try {
        await sock.sendMessage(chatId, { react: { text: '⬇️', key: msg.key } });
    } catch {}

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 1 — Try Siputzx API
    // ══════════════════════════════════════════════════════════════════════════
    const apiResult = await tryApiDownload(url);

    if (apiResult) {
        const { videoUrl, title } = apiResult;
        const caption = `🎵 *${title}*\n\n_𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 𝗢𝗫 𝗕𝗢𝗧_`;

        // Try buffer download first (more reliable for WhatsApp)
        try {
            const videoBuffer = await downloadBuffer(videoUrl);
            await sock.sendMessage(chatId, {
                video:    videoBuffer,
                mimetype: 'video/mp4',
                caption,
            }, { quoted: msg });

            // Success react
            try { await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } }); } catch {}
            return null;
        } catch (bufErr) {
            console.log('[TT] Buffer download failed, trying URL method:', bufErr.message);
        }

        // Fallback — stream from URL directly
        try {
            await sock.sendMessage(chatId, {
                video:    { url: videoUrl },
                mimetype: 'video/mp4',
                caption,
            }, { quoted: msg });

            try { await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } }); } catch {}
            return null;
        } catch (urlErr) {
            console.log('[TT] URL stream also failed:', urlErr.message);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 2 — Fallback: ttdl (ruhend-scraper)
    // ══════════════════════════════════════════════════════════════════════════
    if (ttdl) {
        try {
            const result = await ttdl(url);
            const mediaData = result?.data;

            if (mediaData && mediaData.length > 0) {
                const caption = `_𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 𝗢𝗫 𝗕𝗢𝗧_`;
                const limit   = Math.min(mediaData.length, 10); // max 10 slides

                for (let i = 0; i < limit; i++) {
                    const media    = mediaData[i];
                    const mediaUrl = media.url;
                    const isVideo  = /\.(mp4|mov|avi|mkv|webm)$/i.test(mediaUrl) || media.type === 'video';

                    try {
                        if (isVideo) {
                            await sock.sendMessage(chatId, {
                                video:    { url: mediaUrl },
                                mimetype: 'video/mp4',
                                caption,
                            }, { quoted: msg });
                        } else {
                            await sock.sendMessage(chatId, {
                                image:   { url: mediaUrl },
                                caption,
                            }, { quoted: msg });
                        }
                    } catch (sendErr) {
                        console.error(`[TT] Failed to send media ${i}:`, sendErr.message);
                    }
                }

                try { await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } }); } catch {}
                return null;
            }
        } catch (ttdlErr) {
            console.error('[TT] ttdl fallback failed:', ttdlErr.message);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // All methods failed
    // ══════════════════════════════════════════════════════════════════════════
    try { await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } }); } catch {}

    return `❌ *Failed to download TikTok video*

All download methods failed. Possible reasons:
• Video is private or deleted
• TikTok blocked the download
• Link has expired

Try again or use a different link.`;
}

module.exports = {
    name:     'tiktok',
    aliases:  ['tt', 'tk', 'tikdown', 'tdown'],
    desc:     'Download TikTok video without watermark',
    category: 'downloader',
    execute,
};