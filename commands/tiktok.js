/**
 * tiktok.js — TikTok Video Downloader
 * Aliases: .tiktok, .tt, .tk, .tikdown, .tdown
 * 
 * Method 1: Tikwm API (most reliable, no-watermark)
 * Method 2: Siputzx API (fallback)
 * Method 3: Tikiox API (last resort)
 * 
 * Handles: Videos + Slideshow/image posts
 */

const axios = require('axios');

// ─── URL Validation ─────────────────────────────────────────────────────────
const TIKTOK_REGEX = /https?:\/\/(vm|vt|m|www)?\.?tiktok\.com\//i;

function isValidTikTokUrl(url) {
    return TIKTOK_REGEX.test(url);
}

// ─── Number formatter ───────────────────────────────────────────────────────
function formatNum(n) {
    if (n == null) return '0';
    n = Number(n);
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
}

// ═══════════════════════════════════════════════════
// METHOD 1 — Tikwm API (most reliable)
// ═══════════════════════════════════════════════════
async function tryTikwm(url) {
    try {
        const { data } = await axios.post('https://www.tikwm.com/api/', 
            new URLSearchParams({ url: url, count: 12, cursor: 0, web: 1, hd: 1 }).toString(),
            {
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    Accept: 'application/json',
                },
            }
        );

        if (data.code !== 0 || !data.data) return null;

        const d = data.data;
        const title = d.title || 'TikTok Video';
        const author = d.author?.nickname || d.author?.unique_id || '';
        const stats = d.play_count || 0;
        const likes = d.digg_count || 0;
        const comments = d.comment_count || 0;
        const shares = d.share_count || 0;

        // Build caption
        const captionParts = [`🎵 *${title}*`];
        if (author) captionParts.push(`👤 ${author}`);
        captionParts.push('');
        captionParts.push(`▶️ ${formatNum(stats)}  ❤️ ${formatNum(likes)}  💬 ${formatNum(comments)}  🔗 ${formatNum(shares)}`);
        captionParts.push('\n_𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 𝗢𝗫 𝗕𝗢𝗧_');
        const caption = captionParts.join('\n');

        // Check for slideshow (images)
        if (d.images && d.images.length > 0) {
            return { type: 'slideshow', images: d.images, caption };
        }

        // Video — prefer HD, fallback to SD
        const videoUrl = d.hdplay || d.play || null;
        if (!videoUrl) return null;

        return { type: 'video', videoUrl, caption };
    } catch (err) {
        console.error('[TT] Tikwm error:', err.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════
// METHOD 2 — Siputzx API
// ═══════════════════════════════════════════════════
async function trySiputzx(url) {
    try {
        const { data } = await axios.get(
            `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`,
            {
                timeout: 15000,
                headers: {
                    accept: '*/*',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
            }
        );

        if (!data?.status || !data?.data) return null;

        const d = data.data;
        const title = d.metadata?.title || d.desc || 'TikTok Video';
        const videoUrl = (d.urls && d.urls[0])
            || d.video_url
            || d.url
            || d.download_url
            || d.video
            || null;

        if (!videoUrl) return null;

        const caption = `🎵 *${title}*\n\n_𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 𝗢𝗫 𝗕𝗢𝗧_`;
        return { type: 'video', videoUrl, caption };
    } catch (err) {
        console.error('[TT] Siputzx error:', err.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════
// METHOD 3 — Tikiox API
// ═══════════════════════════════════════════════════
async function tryTikiox(url) {
    try {
        const { data } = await axios.get(
            `https://tikiox.hyzer69420.workers.dev/?url=${encodeURIComponent(url)}`,
            {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
            }
        );

        if (!data?.status || !data?.result) return null;

        const r = data.result;
        const title = r.title || r.desc || 'TikTok Video';
        const videoUrl = r.video || r.hdvideo || r.nowm || null;

        if (!videoUrl) return null;

        const caption = `🎵 *${title}*\n\n_𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 𝗢𝗫 𝗕𝗢𝗧_`;
        return { type: 'video', videoUrl, caption };
    } catch (err) {
        console.error('[TT] Tikiox error:', err.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════
// BUFFER DOWNLOADERS
// ═══════════════════════════════════════════════════
async function downloadVideoBuffer(videoUrl) {
    const { data } = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 100 * 1024 * 1024,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'video/mp4,video/*,*/*;q=0.9',
            Referer: 'https://www.tiktok.com/',
        },
    });
    const buf = Buffer.from(data);
    if (!buf || buf.length < 5000) throw new Error('File too small');
    return buf;
}

async function downloadImageBuffer(imageUrl) {
    const { data } = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 20 * 1024 * 1024,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'image/*,*/*;q=0.9',
            Referer: 'https://www.tiktok.com/',
        },
    });
    const buf = Buffer.from(data);
    if (!buf || buf.length < 1000) throw new Error('Image too small');
    return buf;
}

// ═══════════════════════════════════════════════════
// SEND HELPERS
// ═══════════════════════════════════════════════════
async function sendVideo(sock, chatId, videoUrl, caption, quoted) {
    // Try buffer first (most reliable)
    try {
        const buf = await downloadVideoBuffer(videoUrl);
        await sock.sendMessage(chatId, {
            video: buf,
            mimetype: 'video/mp4',
            caption,
        }, { quoted });
        return true;
    } catch (e) {
        console.log('[TT] Buffer failed:', e.message);
    }

    // Fallback: stream from URL
    try {
        await sock.sendMessage(chatId, {
            video: { url: videoUrl },
            mimetype: 'video/mp4',
            caption,
        }, { quoted });
        return true;
    } catch (e) {
        console.log('[TT] URL stream failed:', e.message);
    }

    return false;
}

async function sendImage(sock, chatId, imageUrl, caption, quoted) {
    try {
        const buf = await downloadImageBuffer(imageUrl);
        await sock.sendMessage(chatId, { image: buf, caption }, { quoted });
        return true;
    } catch {
        try {
            await sock.sendMessage(chatId, { image: { url: imageUrl }, caption }, { quoted });
            return true;
        } catch (e) {
            console.error('[TT] Image send failed:', e.message);
            return false;
        }
    }
}

// ═══════════════════════════════════════════════════
// MAIN EXECUTE
// ═══════════════════════════════════════════════════
async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    // ── Usage ─────────────────────────────────────────────────────────────
    if (!args || args.length === 0) {
        return `*📱 TIKTOK DOWNLOADER*

*.tiktok <link>* — Download no-watermark video

*Aliases:* .tt  .tk  .tikdown  .tdown

*Examples:*
• \`.tiktok https://vm.tiktok.com/xxxxx\`
• \`.tt https://www.tiktok.com/@user/video/123\`

_Supports videos & slideshow posts._`;
    }

    const url = args[0].trim();

    // ── Validate ───────────────────────────────────────────────────────────
    if (!isValidTikTokUrl(url)) {
        return `❌ *Invalid TikTok link*

Make sure it looks like:
• https://vm.tiktok.com/xxxxx
• https://www.tiktok.com/@user/video/123`;
    }

    // ── Working indicator ──────────────────────────────────────────────────
    try { await sock.sendPresenceUpdate('composing', chatId); } catch {}
    try { await sock.sendMessage(chatId, { react: { text: '⬇️', key: msg.key } }); } catch {}

    // ══════════════════════════════════════════════════════════════════════
    // TRY ALL METHODS IN ORDER
    // ══════════════════════════════════════════════════════════════════════
    let result = null;

    // Method 1: Tikwm (best — returns HD, slideshow support, stats)
    result = await tryTikwm(url);

    // Method 2: Siputzx
    if (!result) {
        console.log('[TT] Tikwm failed, trying Siputzx...');
        result = await trySiputzx(url);
    }

    // Method 3: Tikiox
    if (!result) {
        console.log('[TT] Siputzx failed, trying Tikiox...');
        result = await tryTikiox(url);
    }

    // ══════════════════════════════════════════════════════════════════════
    // SEND RESULT
    // ══════════════════════════════════════════════════════════════════════
    if (!result) {
        try { await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } }); } catch {}
        return `❌ *Download failed*

All 3 methods failed. Possible reasons:
• Video is private or deleted
• TikTok temporarily blocked the request
• Link is invalid or expired

Try again in a few seconds.`;
    }

    try {
        if (result.type === 'slideshow') {
            // Send images one by one (caption on last one)
            const limit = Math.min(result.images.length, 10);
            for (let i = 0; i < limit; i++) {
                const isLast = i === limit - 1;
                const cap = isLast ? result.caption : '';
                await sendImage(sock, chatId, result.images[i], cap, msg);
            }
        } else if (result.type === 'video') {
            const sent = await sendVideo(sock, chatId, result.videoUrl, result.caption, msg);
            if (!sent) throw new Error('Buffer and URL methods both failed');
        }

        try { await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } }); } catch {}
        return null;

    } catch (err) {
        console.error('[TT] Send error:', err.message);
        try { await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } }); } catch {}
        return `❌ *Failed to send video*

 ${err.message}`;
    }
}

module.exports = {
    name:     'tiktok',
    aliases:  ['tt', 'tk', 'tikdown', 'tdown'],
    desc:     'Download TikTok video without watermark',
    category: 'downloader',
    execute,
};
