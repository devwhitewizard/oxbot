/**
 * instagram.js — Instagram Media Downloader
 * Aliases: .instagram, .ig, .igdl, .reels
 * 
 * Primary:   ruhend-scraper igdl() (local, no API needed)
 * Fallback 1: Siputzx API
 * Fallback 2: SaveIG API
 * 
 * Handles: Posts, Reels, IGTV, Carousel/Slideshow
 */

const axios = require('axios');

// ─── Load ruhend-scraper ──────────────────────────────────────────────────
let igdl = null;
try {
    const scraper = require('ruhend-scraper');
    igdl = scraper.igdl;
    if (typeof igdl === 'function') {
        console.log('  ✅ ruhend-scraper igdl() loaded');
    } else {
        console.log('  ⚠️ ruhend-scraper loaded but igdl not found — using API fallback');
        igdl = null;
    }
} catch (e) {
    console.log('  ⚠️ ruhend-scraper not found — Instagram will use API-only mode');
}

// ─── URL Validation ─────────────────────────────────────────────────────────
const IG_PATTERNS = [
    /https?:\/\/(www\.)?instagram\.com\/p\//,
    /https?:\/\/(www\.)?instagram\.com\/reel\//,
    /https?:\/\/(www\.)?instagram\.com\/reels\//,
    /https?:\/\/(www\.)?instagram\.com\/tv\//,
    /https?:\/\/(www\.)?instagr\.am\//,
];

function isValidIgUrl(url) {
    return IG_PATTERNS.some(p => p.test(url));
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
// METHOD 1 — ruhend-scraper igdl() [PRIMARY]
// ═══════════════════════════════════════════════════
async function tryRuhend(url) {
    if (!igdl) return null;

    try {
        const result = await igdl(url);
        if (!result || !result.data || !Array.isArray(result.data) || result.data.length === 0) {
            return null;
        }

        const mediaList = [];
        const seenUrls = new Set();

        for (const media of result.data) {
            if (!media.url) continue;

            // Deduplicate exact URLs
            if (seenUrls.has(media.url)) continue;
            seenUrls.add(media.url);

            // Determine type
            const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(media.url) 
                         || media.type === 'video'
                         || url.includes('/reel/')
                         || url.includes('/tv/');

            mediaList.push({
                url: media.url,
                type: isVideo ? 'video' : 'image',
            });
        }

        if (mediaList.length === 0) return null;

        // Build simple caption for scraper (no metadata returned)
        const caption = '_𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 𝗢𝗫 𝗕𝗢𝗧_';
        return { mediaList, caption };
    } catch (err) {
        console.error('[IG] ruhend-scraper error:', err.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════
// METHOD 2 — Siputzx API [FALLBACK]
// ═══════════════════════════════════════════════════
async function trySiputzx(url) {
    try {
        const { data } = await axios.get(
            `https://api.siputzx.my.id/api/d/instagram?url=${encodeURIComponent(url)}`,
            {
                timeout: 20000,
                headers: {
                    accept: 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
            }
        );

        if (!data?.status || !data?.data) return null;

        const d = data.data;
        const caption = buildCaption(d);
        const mediaList = [];

        if (Array.isArray(d.medias) && d.medias.length > 0) {
            for (const m of d.medias) {
                if (m.url) {
                    mediaList.push({
                        url: m.url,
                        type: (m.type === 'video' || /\.(mp4|mov|webm)/i.test(m.url)) ? 'video' : 'image',
                    });
                }
            }
        } else if (d.url) {
            mediaList.push({
                url: d.url,
                type: (d.type === 'video' || /\.(mp4|mov|webm)/i.test(d.url)) ? 'video' : 'image',
            });
        } else if (d.video_url) {
            mediaList.push({ url: d.video_url, type: 'video' });
        } else if (d.image_url) {
            mediaList.push({ url: d.image_url, type: 'image' });
        }

        if (mediaList.length === 0) return null;
        return { mediaList, caption };
    } catch (err) {
        console.error('[IG] Siputzx error:', err.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════
// METHOD 3 — SaveIG API [LAST RESORT]
// ═══════════════════════════════════════════════════
async function trySaveIG(url) {
    try {
        const { data } = await axios.post(
            'https://v3.saveig.app/api/ajaxSearch',
            new URLSearchParams({ q: url, t: 'media', lang: 'en' }).toString(),
            {
                timeout: 20000,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    Accept: 'application/json',
                    Origin: 'https://www.saveig.app',
                    Referer: 'https://www.saveig.app/',
                },
            }
        );

        if (data.status !== 'ok' || !data.data) return null;

        const d = data.data;
        const caption = buildCaption(d);
        const mediaList = [];
        const items = Array.isArray(d) ? d : (d.medias || [d]);

        for (const item of items) {
            if (item.video_url) {
                mediaList.push({ url: item.video_url, type: 'video' });
            } else if (item.image_url) {
                mediaList.push({ url: item.image_url, type: 'image' });
            } else if (item.url) {
                const isVid = /\.(mp4|mov|webm)/i.test(item.url) || item.type === 'video';
                mediaList.push({ url: item.url, type: isVid ? 'video' : 'image' });
            }
        }

        if (mediaList.length === 0) return null;
        return { mediaList, caption };
    } catch (err) {
        console.error('[IG] SaveIG error:', err.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════
// CAPTION BUILDER — for API responses (have metadata)
// ═══════════════════════════════════════════════════
function buildCaption(d) {
    const parts = [];

    const author = d.author || d.user || d.owner || {};
    const name = author.username || author.nickname || author.name || '';
    if (name) parts.push(`👤 *@${name.replace('@', '')}*`);

    const desc = d.title || d.description || d.caption || d.text || '';
    if (desc.trim()) {
        const truncated = desc.length > 200 ? desc.slice(0, 200) + '...' : desc;
        parts.push(`\n${truncated}`);
    }

    const stats = d.statistics || d.stats || {};
    const likeCount = stats.likes || d.like_count || d.likes || 0;
    const commentCount = stats.comments || d.comment_count || d.comments || 0;

    if (likeCount || commentCount) {
        parts.push('');
        const statParts = [];
        if (likeCount) statParts.push(`❤️ ${formatNum(likeCount)}`);
        if (commentCount) statParts.push(`💬 ${formatNum(commentCount)}`);
        parts.push(statParts.join('  '));
    }

    parts.push('\n_𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 𝗢𝗫 𝗕𝗢𝗧_');
    return parts.join('\n');
}

// ═══════════════════════════════════════════════════
// BUFFER DOWNLOADER
// ═══════════════════════════════════════════════════
async function downloadBuffer(mediaUrl) {
    const { data } = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 100 * 1024 * 1024,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'video/mp4,video/*,image/*,*/*;q=0.9',
            Referer: 'https://www.instagram.com/',
        },
    });
    const buf = Buffer.from(data);
    if (!buf || buf.length < 1000) throw new Error('Downloaded file too small');
    return buf;
}

// ═══════════════════════════════════════════════════
// SEND HELPER
// ═══════════════════════════════════════════════════
async function sendMedia(sock, chatId, mediaItem, caption, quoted) {
    const isVideo = mediaItem.type === 'video';

    // Try buffer first (more reliable)
    try {
        const buf = await downloadBuffer(mediaItem.url);
        if (isVideo) {
            await sock.sendMessage(chatId, { video: buf, mimetype: 'video/mp4', caption }, { quoted });
        } else {
            await sock.sendMessage(chatId, { image: buf, caption }, { quoted });
        }
        return true;
    } catch (e) {
        console.log('[IG] Buffer failed:', e.message);
    }

    // Fallback: stream from URL
    try {
        if (isVideo) {
            await sock.sendMessage(chatId, { video: { url: mediaItem.url }, mimetype: 'video/mp4', caption }, { quoted });
        } else {
            await sock.sendMessage(chatId, { image: { url: mediaItem.url }, caption }, { quoted });
        }
        return true;
    } catch (e) {
        console.log('[IG] URL stream failed:', e.message);
    }

    return false;
}

// ═══════════════════════════════════════════════════
// MAIN EXECUTE — OxBot format: (sock, msg, botData, args)
// ═══════════════════════════════════════════════════
async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    // ── Usage ─────────────────────────────────────────────────────────────
    if (!args || args.length === 0) {
        return `*📸 INSTAGRAM DOWNLOADER*

*.instagram <link>* — Download Instagram media

*Aliases:* .ig  .igdl  .reels

*Supported:*
• https://instagram.com/p/xxxxx  (Post)
• https://instagram.com/reel/xxxxx  (Reel)
• https://instagram.com/tv/xxxxx  (IGTV)

_Downloads videos, images & carousels._`;
    }

    const url = args[0].trim();

    // ── Validate ───────────────────────────────────────────────────────────
    if (!isValidIgUrl(url)) {
        return `❌ *Invalid Instagram link*

Supported formats:
• https://instagram.com/p/xxxxx
• https://instagram.com/reel/xxxxx
• https://instagram.com/tv/xxxxx

_Make sure the post is public._`;
    }

    // ── Working indicator ──────────────────────────────────────────────────
    try { await sock.sendPresenceUpdate('composing', chatId); } catch {}
    try { await sock.sendMessage(chatId, { react: { text: '⬇️', key: msg.key } }); } catch {}

    // ══════════════════════════════════════════════════════════════════════
    // TRY ALL METHODS IN ORDER
    // ══════════════════════════════════════════════════════════════════════
    let result = null;

    // Method 1: ruhend-scraper (local, fastest, no API dependency)
    result = await tryRuhend(url);

    // Method 2: Siputzx API
    if (!result) {
        console.log('[IG] ruhend failed, trying Siputzx...');
        result = await trySiputzx(url);
    }

    // Method 3: SaveIG API
    if (!result) {
        console.log('[IG] Siputzx failed, trying SaveIG...');
        result = await trySaveIG(url);
    }

    // ══════════════════════════════════════════════════════════════════════
    // SEND RESULT
    // ══════════════════════════════════════════════════════════════════════
    if (!result || !result.mediaList.length) {
        try { await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } }); } catch {}
        return `❌ *Download failed*

All 3 methods failed. Possible reasons:
• Post is private
• Link is invalid or expired
• Instagram blocked the request

_Try again or use a different link._`;
    }

    try {
        const { mediaList, caption } = result;
        const total = Math.min(mediaList.length, 10);

        for (let i = 0; i < total; i++) {
            const isLast = i === total - 1;
            const cap = isLast ? caption : (total > 1 ? `_[${i + 1}/${total}]_` : caption);

            const sent = await sendMedia(sock, chatId, mediaList[i], cap, msg);
            if (!sent) {
                console.error(`[IG] Failed to send media ${i + 1}/${total}`);
            }
        }

        if (mediaList.length > total) {
            await sock.sendMessage(chatId, {
                text: `_...and ${mediaList.length - total} more media (max 10 shown)_`,
            }, { quoted: msg });
        }

        try { await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } }); } catch {}
        return null;

    } catch (err) {
        console.error('[IG] Send error:', err.message);
        try { await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } }); } catch {}
        return `❌ *Failed to send media*\n\n${err.message}`;
    }
}

module.exports = {
    name:     'instagram',
    aliases:  ['ig', 'igdl', 'reels', 'insta'],
    desc:     'Download Instagram media (posts, reels, carousels)',
    category: 'downloader',
    execute,
};