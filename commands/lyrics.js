/**
 * lyrics.js — Song Lyrics Finder
 * Aliases: .lyrics, .lyric, .lirik
 * 
 * Method 1: Vreden API (best metadata)
 * Method 2: Siputzx API (fallback)
 * Method 3: LyricsAPI (last resort)
 */

const axios = require('axios');

// ═══════════════════════════════════════════════════
// METHOD 1 — Vreden API
// ═══════════════════════════════════════════════════
async function tryVreden(query) {
    try {
        const { data } = await axios.get(
            `https://api.vreden.my.id/api/lyrics?query=${encodeURIComponent(query)}`,
            { timeout: 15000 }
        );

        if (!data?.result?.lyrics) return null;

        return {
            title: data.result.title || query,
            artist: data.result.artist || 'Unknown',
            lyrics: data.result.lyrics,
            thumbnail: data.result.thumbnail || null,
        };
    } catch (err) {
        console.error('[Lyrics] Vreden error:', err.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════
// METHOD 2 — Siputzx API
// ═══════════════════════════════════════════════════
async function trySiputzx(query) {
    try {
        const { data } = await axios.get(
            `https://api.siputzx.my.id/api/s/lyrics?query=${encodeURIComponent(query)}`,
            { timeout: 15000 }
        );

        if (!data?.status || !data?.data?.lyrics) return null;

        return {
            title: data.data.title || query,
            artist: data.data.artist || 'Unknown',
            lyrics: data.data.lyrics,
            thumbnail: data.data.image || null,
        };
    } catch (err) {
        console.error('[Lyrics] Siputzx error:', err.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════
// METHOD 3 — LyricsAPI
// ═══════════════════════════════════════════════════
async function tryLyricsAPI(query) {
    try {
        const { data } = await axios.get(
            `https://lyricsapi.fly.dev/api/lyrics?q=${encodeURIComponent(query)}`,
            { timeout: 15000 }
        );

        if (!data?.result?.lyrics) return null;

        return {
            title: query,
            artist: '',
            lyrics: data.result.lyrics,
            thumbnail: null,
        };
    } catch (err) {
        console.error('[Lyrics] LyricsAPI error:', err.message);
        return null;
    }
}

// ═══════════════════════════════════════════════════
// MAIN EXECUTE
// ═══════════════════════════════════════════════════
async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    if (!args || args.length === 0) {
        return `❌ *Please provide a song name!*

_Usage: .lyrics <song name>_

_Example: .lyrics Despacito_`;
    }

    const query = args.join(' ').trim();

    // Working indicator
    try { await sock.sendPresenceUpdate('composing', chatId); } catch {}
    try { await sock.sendMessage(chatId, { react: { text: '🎵', key: msg.key } }); } catch {}

    // ── Try all APIs ────────────────────────────────────────────────────
    let result = await tryVreden(query);

    if (!result) {
        console.log('[Lyrics] Vreden failed, trying Siputzx...');
        result = await trySiputzx(query);
    }

    if (!result) {
        console.log('[Lyrics] Siputzx failed, trying LyricsAPI...');
        result = await tryLyricsAPI(query);
    }

    // ── All failed ───────────────────────────────────────────────────────
    if (!result) {
        try { await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } }); } catch {}
        return `❌ *No lyrics found for:* "${query}"

Try with a different song name or check the spelling.`;
    }

    // ── Format lyrics ────────────────────────────────────────────────────
    let lyrics = result.lyrics;
    if (lyrics.length > 4096) {
        lyrics = lyrics.slice(0, 4093) + '...';
    }

    // Build caption
    const captionParts = [`🎵 *${result.title}*`];
    if (result.artist) captionParts.push(`👤 *Artist:* ${result.artist}`);
    captionParts.push(`\n${lyrics}`);
    captionParts.push(`\n_𝗙𝗘𝗧𝗖𝗛𝗘𝗗 𝗕𝗬 𝗢𝗫 𝗕𝗢𝗧_`);
    const caption = captionParts.join('\n');

    // ── Send with thumbnail if available ─────────────────────────────────
    try {
        if (result.thumbnail) {
            await sock.sendMessage(chatId, {
                image: { url: result.thumbnail },
                caption,
            }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, {
                text: caption,
            }, { quoted: msg });
        }

        try { await sock.sendMessage(chatId, { react: { text: '✅', key: msg.key } }); } catch {}
        return null;

    } catch (err) {
        console.error('[Lyrics] Send error:', err.message);
        try { await sock.sendMessage(chatId, { react: { text: '❌', key: msg.key } }); } catch {}
        return `❌ *Failed to send lyrics*\n\n${err.message}`;
    }
}

module.exports = {
    name:     'lyrics',
    aliases:  ['lyric', 'lirik'],
    desc:     'Get lyrics of any song',
    category: 'general',
    execute,
};
