const name     = 'url';
const desc     = 'Upload media and get a URL';
const category = 'general';
const aliases  = ['upload', 'link'];

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const axios    = require('axios');
const FormData = require('form-data');

// ── Upload to pomf2.lain.la ──
async function uploadPomf(buffer, ext) {
    const form = new FormData();
    form.append('files[]', buffer, { filename: 'file' + ext });
    const res = await axios.post('https://pomf2.lain.la/upload.php', form, {
        headers: form.getHeaders(),
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024,
    });
    const url = res.data?.files?.[0]?.url;
    if (!url) throw new Error('Pomf failed');
    return url;
}

// ── Upload to catbox.moe ──
async function uploadCatbox(buffer, ext) {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', buffer, { filename: 'file' + ext });
    const res = await axios.post('https://catbox.moe/user/api.php', form, {
        headers: form.getHeaders(),
        timeout: 30000,
    });
    if (typeof res.data === 'string' && res.data.startsWith('https://')) return res.data.trim();
    throw new Error('Catbox failed');
}

// ── Upload to telegra.ph (images only) ──
async function uploadTelegraph(buffer, ext) {
    const form = new FormData();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    form.append('file', buffer, { filename: 'file' + ext, contentType: mime });
    const res = await axios.post('https://telegra.ph/upload', form, {
        headers: form.getHeaders(),
        timeout: 20000,
    });
    if (Array.isArray(res.data) && res.data[0]?.src) return 'https://telegra.ph' + res.data[0].src;
    throw new Error('Telegraph failed');
}

// ── Upload to tmpfiles.org ──
async function uploadTmpfiles(buffer, ext) {
    const form = new FormData();
    form.append('file', buffer, { filename: 'file' + ext });
    const res = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
        headers: form.getHeaders(),
        timeout: 30000,
    });
    const url = res.data?.data?.url;
    if (!url) throw new Error('Tmpfiles failed');
    // Convert to direct URL
    return url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
}

// ── Download media from message ──
async function getMedia(msg) {
    const m = msg.message || {};
    const types = [
        ['imageMessage',    'image',    '.jpg'],
        ['videoMessage',    'video',    '.mp4'],
        ['audioMessage',    'audio',    '.mp3'],
        ['stickerMessage',  'sticker',  '.webp'],
        ['documentMessage', 'document', null],
    ];
    for (const [key, type, defaultExt] of types) {
        if (!m[key]) continue;
        try {
            const stream = await downloadContentFromMessage(m[key], type);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            const ext    = defaultExt || path.extname(m[key]?.fileName || '') || '.bin';
            return { buffer, ext, type };
        } catch {}
    }
    return null;
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;

    // Try current message first, then quoted
    let media = await getMedia(msg);
    if (!media) {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quoted) media = await getMedia({ message: quoted });
    }

    if (!media) {
        return await sock.sendMessage(chatId, {
            text: '❌ Send or reply to a media file!\n\nSupports: image, video, audio, sticker, document'
        }, { quoted: msg });
    }

    await sock.sendPresenceUpdate('composing', chatId);

    try {
        const { buffer, ext, type } = media;
        const isImage = ['.jpg','.jpeg','.png','.webp'].includes(ext);
        let url = '';
        let usedServer = '';

        // Try servers in order
        const servers = [];

        if (isImage) servers.push(
            async () => { const u = await uploadTelegraph(buffer, ext); usedServer = 'telegra.ph'; return u; }
        );

        servers.push(
            async () => { const u = await uploadPomf(buffer, ext);     usedServer = 'pomf2.lain.la'; return u; },
            async () => { const u = await uploadCatbox(buffer, ext);   usedServer = 'catbox.moe';    return u; },
            async () => { const u = await uploadTmpfiles(buffer, ext); usedServer = 'tmpfiles.org';  return u; },
        );

        for (const fn of servers) {
            try { url = await fn(); if (url) break; } catch (e) { console.error('[url] Server error:', e.message); }
        }

        if (!url) {
            return await sock.sendMessage(chatId, {
                text: '❌ All upload servers failed. Try again later.'
            }, { quoted: msg });
        }

        const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
        await sock.sendMessage(chatId, {
            text: `✅ *${typeLabel} uploaded!*\n\n🔗 ${url}\n\n📡 _Server: ${usedServer}_`
        }, { quoted: msg });

    } catch (err) {
        console.error('[url] Error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ Upload failed: ' + err.message
        }, { quoted: msg });
    } finally {
        await sock.sendPresenceUpdate('available', chatId);
    }
}

module.exports = { name, desc, category, aliases, execute };
