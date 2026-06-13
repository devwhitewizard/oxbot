const sharp = require('sharp');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return;

    try {
        let imageMsg = null;
        let isQuoted = false;

        // 1. Check if replying to an image
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quotedMsg?.imageMessage) {
            isQuoted = true;
            imageMsg = quotedMsg.imageMessage;
        } 
        // 2. Check if image is sent directly with the command as a caption
        else if (msg.message?.imageMessage) {
            imageMsg = msg.message.imageMessage;
        }

        if (!imageMsg) {
            return await sock.sendMessage(chatId, { 
                text: '❌ Please reply to an image or send an image with the caption *.blur*' 
            }, { quoted: msg });
        }

        // ✅ FIX: Check if WhatsApp actually gave us the media key
        if (!imageMsg.mediaKey) {
            return await sock.sendMessage(chatId, { 
                text: '❌ *Cannot blur this image.*\n\nWhatsApp privacy rules blocked the download (no media key provided for this quoted image).\n\n💡 *Fix:* Forward the image to yourself first, then reply to *your own forwarded message* and type .blur' 
            }, { quoted: msg });
        }

        // Send "processing" message
        const processingMsg = await sock.sendMessage(chatId, { text: '⏳ Blurring image...' }, { quoted: msg });

        // 3. Download image safely
        let stream;
        if (isQuoted) {
            // Pass the imageMessage object DIRECTLY (Baileys v6+ standard)
            stream = await downloadContentFromMessage(imageMsg, 'image');
        } else {
            // Pass the full message object for direct images
            stream = await downloadContentFromMessage(msg, 'image');
        }

        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const imageBuffer = Buffer.concat(chunks);

        // 4. Process with sharp (Resize + Blur)
        const blurredImage = await sharp(imageBuffer)
            .resize(800, 800, { 
                fit: 'inside', 
                withoutEnlargement: true 
            })
            .jpeg({ quality: 80 })
            .blur(10) // Blur radius of 10
            .toBuffer();

        // 5. Delete processing message and send result
        await sock.sendMessage(chatId, { delete: processingMsg.key });

        await sock.sendMessage(chatId, {
            image: blurredImage,
            caption: '*✔ Image Blurred Successfully*'
        }, { quoted: msg });

    } catch (error) {
        console.error('[blur] Error:', error.message);
        await sock.sendMessage(chatId, { 
            text: `❌ Failed to blur image: ${error.message}` 
        }, { quoted: msg });
    }
}

module.exports = {
    name: 'blur',
    execute: execute,
    desc: 'Blur an image (reply to image or send with caption)',
    category: 'general',
    aliases: ['blurimage']
};