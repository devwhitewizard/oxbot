/**
 * commands/song.js
 */
const axios = require('axios');
const yts   = require('yt-search');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const { toAudio } = require('../lib/converter');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept':     'application/json, text/plain, */*'
};

async function tryRequest(fn, attempts = 3) {
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
        try { return await fn(); } catch (e) {
            lastErr = e;
            if (i < attempts) await new Promise(r => setTimeout(r, 1000 * i));
        }
    }
    throw lastErr;
}

async function apiEliteProTech(url) {
    const res = await tryRequest(() => axios.get(`https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(url)}&format=mp3`, { timeout: 60000, headers: HEADERS }));
    if (res?.data?.success && res?.data?.downloadURL) return { download: res.data.downloadURL, title: res.data.title };
    throw new Error('No URL');
}

async function apiYupra(url) {
    const res = await tryRequest(() => axios.get(`https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(url)}`, { timeout: 60000, headers: HEADERS }));
    if (res?.data?.success && res?.data?.data?.download_url) return { download: res.data.data.download_url, title: res.data.data.title, thumbnail: res.data.data.thumbnail };
    throw new Error('No URL');
}

async function apiOkatsu(url) {
    const res = await tryRequest(() => axios.get(`https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(url)}`, { timeout: 60000, headers: HEADERS }));
    if (res?.data?.dl) return { download: res.data.dl, title: res.data.title, thumbnail: res.data.thumb };
    throw new Error('No URL');
}

async function downloadBuffer(audioUrl) {
    try {
        const res = await axios.get(audioUrl, {
            responseType: 'arraybuffer', timeout: 90000,
            maxContentLength: Infinity, maxBodyLength: Infinity,
            validateStatus: s => s >= 200 && s < 400,
            headers: { 'User-Agent': HEADERS['User-Agent'], 'Accept': '*/*', 'Accept-Encoding': 'identity' }
        });
        const buf = Buffer.from(res.data);
        if (buf.length > 0) return buf;
    } catch {}

    const res = await axios.get(audioUrl, {
        responseType: 'stream', timeout: 90000,
        maxContentLength: Infinity, maxBodyLength: Infinity,
        validateStatus: s => s >= 200 && s < 400,
        headers: { 'User-Agent': HEADERS['User-Agent'], 'Accept': '*/*', 'Accept-Encoding': 'identity' }
    });
    const chunks = [];
    await new Promise((resolve, reject) => {
        res.data.on('data', c => chunks.push(c));
        res.data.on('end', resolve);
        res.data.on('error', reject);
    });
    const buf = Buffer.concat(chunks);
    if (buf.length === 0) throw new Error('Empty buffer');
    return buf;
}

// Cleans up any leftover temp files from the OS temp directory
function cleanupTemp() {
    try {
        const tmpDir = os.tmpdir();
        if (!fs.existsSync(tmpDir)) return;
        const now = Date.now();
        for (const file of fs.readdirSync(tmpDir)) {
            if (!file.startsWith('oxbot_')) continue;
            try {
                const fp = path.join(tmpDir, file);
                const stats = fs.statSync(fp);
                if (now - stats.mtimeMs > 15000) fs.unlinkSync(fp);
            } catch {}
        }
    } catch {}
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const query = args.join(' ').trim();
    if (!query) {
        await sock.sendMessage(chatId, { text: '🎵 *Song Download*\n\nUsage: *.song <song name or link>*' }, { quoted: msg });
        return null;
    }

    try {
        let video;
        if (/youtube\.com|youtu\.be/.test(query)) {
            video = { url: query, title: query, thumbnail: null, timestamp: '?' };
        } else {
            const search = await yts(query);
            if (!search?.videos?.length) {
                await sock.sendMessage(chatId, { text: `❌ No results for: *${query}*` }, { quoted: msg });
                return null;
            }
            video = search.videos[0];
        }

        if (video.thumbnail) {
            await sock.sendMessage(chatId, {
                image: { url: video.thumbnail },
                caption: `🎵 *Downloading:*\n${video.title || query}\n\n⏱ ${video.timestamp || '?'}\n📥 Fetching audio...`
            }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, { text: `🎵 *Downloading:*\n${video.title || query}\n\n⏱ ${video.timestamp || '?'}\n📥 Fetching audio...` }, { quoted: msg });
        }

        const APIS = [
            { name: 'EliteProTech', fn: () => apiEliteProTech(video.url) },
            { name: 'Yupra',        fn: () => apiYupra(video.url) },
            { name: 'Okatsu',       fn: () => apiOkatsu(video.url) }
        ];

        let audioData = null;
        let rawBuffer = null;

        for (const api of APIS) {
            try {
                console.log(`[song] Trying ${api.name}...`);
                audioData = await api.fn();
                rawBuffer = await downloadBuffer(audioData.download);
                
                // Check if API returned an error page instead of audio
                const headStr = rawBuffer.toString('utf8', 0, Math.min(200, rawBuffer.length));
                if (headStr.includes('<!DOCTYPE') || headStr.includes('<html') || (headStr.trim().startsWith('{') && headStr.includes('"error"'))) {
                    console.log(`[song] ${api.name} ❌ — Returned error page`);
                    rawBuffer = null;
                    throw new Error('Fake audio');
                }

                console.log(`[song] ${api.name} ✅ — ${(rawBuffer.length / 1024).toFixed(1)} KB`);
                break;
            } catch (err) {
                console.log(`[song] ${api.name} ❌ — ${err.message}`);
                rawBuffer = null;
            }
        }

        if (!rawBuffer || rawBuffer.length === 0) {
            await sock.sendMessage(chatId, { text: '❌ All APIs failed. The song might be unavailable or region-locked.' }, { quoted: msg });
            return null;
        }

        // ── CONVERT TO MP3 ──
        const title = (audioData?.title || video.title || 'OxBot_Song').replace(/[^\w\s\-()']/g, '').trim();
        let finalBuffer = null;

        console.log(`[song] Converting to MP3...`);
        try {
            // The toAudio function handles the temp files and ffmpeg conversion
            finalBuffer = await toAudio(rawBuffer, 'ignore');
        } catch (err) {
            console.log(`[song] Conversion Failed: ${err.message}`);
            await sock.sendMessage(chatId, {
                text: `❌ Audio conversion failed.\n\n*Reason:* ${err.message}\n\nThe downloaded file was not valid audio.`
            }, { quoted: msg });
            return null;
        }

        // ── SEND AUDIO ──
        await sock.sendMessage(chatId, {
            audio: finalBuffer,
            mimetype: 'audio/mpeg',
            fileName: `${title}.mp3`,
            ptt: false
        }, { quoted: msg });

        console.log(`[song] ✅ Sent successfully: ${title}`);
        cleanupTemp();

    } catch (err) {
        console.error('[song] Error:', err.message);
        await sock.sendMessage(chatId, { text: `❌ Error: ${err.message}` }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'song',
    aliases: ['play', 'ytmp3', 'music'],
    desc: 'Download song from YouTube as MP3',
    category: 'general',
    execute
};