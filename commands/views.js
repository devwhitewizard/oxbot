/**
 * OxBot — View-Once Saver
 * Replies to a view-once message to permanently save the audio, video, or image
 */
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// Stream to buffer helper
async function toBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return;

    try {
        // 1. Get the quoted message (the view-once message being replied to)
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (!quotedMsg) {
            return await sock.sendMessage(chatId, { 
                text: '❌ Please *reply* to a View-Once Audio, Video, or Image message to save it.' 
            }, { quoted: msg });
        }

        // 2. Check for View-Once wrapper (V2 for newer WhatsApp, V1 for older)
        let innerMsg = quotedMsg.viewOnceMessageV2?.message || quotedMsg.viewOnceMessage?.message;

        if (!innerMsg) {
            return await sock.sendMessage(chatId, { 
                text: '❌ The message you replied to is not a *View-Once* message.' 
            }, { quoted: msg });
        }

        // 3. Detect media type (Audio first, then Video, then Image)
        let mediaType = null;
        let mediaContent = null;

        if (innerMsg.audioMessage) {
            mediaType = 'audio';
            mediaContent = innerMsg.audioMessage;
        } else if (innerMsg.videoMessage) {
            mediaType = 'video';
            mediaContent = innerMsg.videoMessage;
        } else if (innerMsg.imageMessage) {
            mediaType = 'image';
            mediaContent = innerMsg.imageMessage;
        }

        if (!mediaType || !mediaContent) {
            return await sock.sendMessage(chatId, { 
                text: '❌ No supported media (Audio/Video/Image) found in this view-once message.' 
            }, { quoted: msg });
        }

        // 4. React to show bot is working
        await sock.sendMessage(chatId, { react: { text: "⏬", key: msg.key } });

        // 5. Reconstruct the exact message format Baileys expects for downloads
        const msgStub = {
            message: {
                [`${mediaType}Message`]: mediaContent
            }
        };

        // 6. Download the media safely using Baileys streams
        const stream = await downloadContentFromMessage(msgStub, mediaType);
        const buffer = await toBuffer(stream);

        if (!buffer || buffer.length === 0) {
            await sock.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
            return await sock.sendMessage(chatId, { text: '❌ Downloaded file is empty.' }, { quoted: msg });
        }

        // 7. Resend permanently (removes the view-once restriction)
        if (mediaType === 'audio') {
            await sock.sendMessage(chatId, {
                audio: buffer,
                mimetype: mediaContent.mimetype || 'audio/mp4',
                ptt: mediaContent.ptt || false, // Keeps it as a voice note if it was one
                caption: '✅ *View-Once Audio Saved!*'
            }, { quoted: msg });
        } else if (mediaType === 'video') {
            await sock.sendMessage(chatId, {
                video: buffer,
                mimetype: mediaContent.mimetype || 'video/mp4',
                caption: '✅ *View-Once Video Saved!*'
            }, { quoted: msg });
        } else if (mediaType === 'image') {
            await sock.sendMessage(chatId, {
                image: buffer,
                mimetype: mediaContent.mimetype || 'image/jpeg',
                caption: '✅ *View-Once Image Saved!*'
            }, { quoted: msg });
        }

        // 8. Change reaction to success
        await sock.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    } catch (error) {
        console.error('[views] Error:', error.message);
        await sock.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
        
        // Handle WhatsApp's strict privacy blocks gracefully
        if (error.message.includes('empty media key') || error.message.includes('Cannot derive')) {
            await sock.sendMessage(chatId, { 
                text: '❌ *WhatsApp Privacy Block*\n\nWhatsApp hid the media key for this replied view-once message. Unfortunately, no bot can download it when this happens.' 
            }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, { 
                text: `❌ Failed to save view-once media: ${error.message}` 
            }, { quoted: msg });
        }
    }
}

module.exports = {
    name: 'views',
    aliases: ['savevo', 'viewonce', 'revealo'],
    desc: 'Save view-once audio/video/image (reply to it)',
    category: 'general',
    execute: execute
};