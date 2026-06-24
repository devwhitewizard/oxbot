const sharp = require('sharp');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const name     = 'stickertoimg';
const desc     = 'Tag a sticker and I will convert it to an image for you.';
const category = 'converter';
const aliases  = ['s2i', 'sticker2img', 'webp2img'];

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;

    try {
        // ── Check for Dependency ───────────────────────────────
        if (!sharp) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Missing Dependency*\n\nTo use this command, the server admin needs to install "sharp".\n\nRun: `npm install sharp`',
            }, { quoted: msg });
        }

        // ── Find Sticker: Tagged OR Quoted ─────────────────────────
        const m = msg.message;
        let stickerMessage = null;

        // 1. Direct Tag (User sent sticker with caption)
        if (m?.stickerMessage) {
            stickerMessage = m.stickerMessage;
        }
        // 2. Quoted Sticker (User replied to a sticker)
        else {
            const quoted = m?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted?.stickerMessage) stickerMessage = quoted.stickerMessage;
        }

        if (!stickerMessage) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ *Usage*\n\n• Tag a sticker: Send a sticker and type `.stickertoimg`\n• Reply to a sticker: Reply to a sticker with `.stickertoimg`',
            }, { quoted: msg });
        }

        // ── 1. Send "Converting..." message ─────────────────────────
        const convertingMsg = await sock.sendMessage(chatId, {
            text: '⏳ Converting sticker to image...',
        }, { quoted: msg });

        // ── 2. Download Sticker ───────────────────────────────────
        const stream = await downloadContentFromMessage(stickerMessage, 'sticker');
        let buffer = Buffer.alloc(0);
        
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        if (!buffer.length) {
            return await sock.sendMessage(chatId, {
                text: '❌ Failed to download sticker.',
            }, { quoted: msg });
        }

        // ── 3. Convert to Image (WebP -> PNG) ───────────────────────
        // Sharp takes the WebP buffer and converts it to PNG.
        // It automatically handles extraction of the first frame if the sticker is animated.
        const imageBuffer = await sharp(buffer)
            .png()
            .toBuffer();

        // ── 4. Send the Converted Image ─────────────────────────────
        await sock.sendMessage(chatId, {
            image: imageBuffer,
            caption: '✅ Here is your image (Converted from Sticker)',
        }, { quoted: msg });

        // ── 5. Delete the "Converting..." message (Optional Cleanup) ───
        await sock.sendMessage(chatId, { delete: convertingMsg.key });

    } catch (err) {
        console.error('[stickertoimg] Error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to convert sticker. ' + err.message,
        }, { quoted: msg });
    }
}

module.exports = { name, desc, category, aliases, execute };