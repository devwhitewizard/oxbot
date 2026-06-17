const fs   = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const name     = 'setpp';
const desc     = 'Set the bot profile picture. Tag an image or reply to one.';
const category = 'owner';
const aliases  = ['setpfp', 'setavatar'];

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;

    try {
        // ── Owner check (index.js handles category:'owner' gate already) ──

        // ── Find the image: tagged (caption) OR quoted (reply) ──
        const m = msg.message;

        let imageMessage = null;

        // 1. Image sent directly with caption ".setpp"
        if (m?.imageMessage) {
            imageMessage = m.imageMessage;
        }
        // 2. Sticker sent directly
        else if (m?.stickerMessage) {
            imageMessage = m.stickerMessage;
        }
        // 3. Reply to an image or sticker
        else {
            const quoted = m?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted?.imageMessage)   imageMessage = quoted.imageMessage;
            else if (quoted?.stickerMessage) imageMessage = quoted.stickerMessage;
        }

        if (!imageMessage) {
            return await sock.sendMessage(chatId, {
                text:
                    '⚠️ *How to use .setpp:*\n\n' +
                    '• *Tag an image:* Send an image and type `.setpp` as the caption\n' +
                    '• *Reply to an image:* Reply to any image with `.setpp`',
            }, { quoted: msg });
        }

        // ── Download image ──
        const mediaType = m?.stickerMessage || m?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage
            ? 'sticker'
            : 'image';

        const stream = await downloadContentFromMessage(imageMessage, mediaType);
        let buffer = Buffer.alloc(0);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        if (!buffer.length) {
            return await sock.sendMessage(chatId, {
                text: '❌ Could not download the image. Try again.',
            }, { quoted: msg });
        }

        // ── Save to tmp ──
        const tmpDir = path.join(process.cwd(), 'tmp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        const tmpPath = path.join(tmpDir, `setpp_${Date.now()}.jpg`);
        fs.writeFileSync(tmpPath, buffer);

        // ── Update profile picture ──
        await sock.updateProfilePicture(sock.user.id, { url: tmpPath });

        // ── Cleanup ──
        try { fs.unlinkSync(tmpPath); } catch {}

        await sock.sendMessage(chatId, {
            text: '✅ *Bot profile picture updated successfully!*',
        }, { quoted: msg });

    } catch (err) {
        console.error('[setpp] Error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to update profile picture. Make sure the image is valid and try again.',
        }, { quoted: msg });
    }
}

module.exports = { name, desc, category, aliases, execute };