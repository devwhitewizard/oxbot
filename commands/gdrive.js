const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const url = args[0]?.trim();
    if (!url || !url.includes('drive.google.com')) {
        return await sock.sendMessage(chatId, { text: '❌ Usage: .gdrive <google drive link>' }, { quoted: msg });
    }

    await sock.sendMessage(chatId, { text: '📦 Extracting Google Drive link...' }, { quoted: msg });

    try {
        // Extract file ID
        const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
        if (!match || !match[1]) {
            return await sock.sendMessage(chatId, { text: '❌ Invalid Google Drive URL.' }, { quoted: msg });
        }

        const fileId = match[1];
        
        // Use a reliable worker to get the direct download link
        const apiUrl = `https://api.gdriveee.workers.dev/?id=${fileId}`;
        const res = await axios.get(apiUrl, { timeout: 15000 });
        
        const downloadUrl = res.data?.downloadUrl || res.data?.url;
        if (!downloadUrl) {
            return await sock.sendMessage(chatId, { text: '❌ Could not extract download link. File might be too large or restricted.' }, { quoted: msg });
        }

        await sock.sendMessage(chatId, { text: '⬇️ Downloading file... (this may take a moment)' }, { quoted: msg });

        // Download the file
        const fileRes = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 60000 });
        const buffer = Buffer.from(fileRes.data);
        
        // Determine mimetype (basic guess)
        const contentType = fileRes.headers['content-type'] || 'application/octet-stream';
        let ext = '.bin';
        if (contentType.includes('pdf')) ext = '.pdf';
        else if (contentType.includes('zip')) ext = '.zip';
        else if (contentType.includes('image')) ext = '.jpg';
        else if (contentType.includes('video')) ext = '.mp4';
        else if (contentType.includes('audio')) ext = '.mp3';

        if (buffer.length > 50 * 1024 * 1024) { // 50MB limit for WA
            return await sock.sendMessage(chatId, { text: '❌ File is too large to send via WhatsApp (Max 50MB).' }, { quoted: msg });
        }

        await sock.sendMessage(chatId, {
            document: buffer,
            fileName: `OxBot_GDrive_${fileId.slice(0,6)}${ext}`,
            mimetype: contentType
        }, { quoted: msg });

    } catch (err) {
        console.error('[GDRIVE] Error:', err.message);
        await sock.sendMessage(chatId, { text: '❌ Download failed. Ensure the link is public (Anyone with the link).' }, { quoted: msg });
    }
    return null;
}

module.exports = { name: 'gdrive', aliases: ['gdl'], desc: 'Download files from Google Drive', category: 'general', execute };