/**
 * OxBot — GPT Image Editor (MagicEraser)
 * Reply to an image/sticker with a prompt to edit it with AI
 */

const axios = require('axios');
const FormData = require('form-data');
const sharp = require('sharp');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const EDITIMG_API = 'https://restapis.xrizaldev.my.id/api/ai2/editimg';
const UGUU_UPLOAD = 'https://uguu.se/upload';

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

async function uploadToUguu(buffer, filename = 'image.jpg') {
    const form = new FormData();
    form.append('files[]', buffer, { filename, contentType: 'image/jpeg' });
    const { data } = await axios.post(UGUU_UPLOAD, form, {
        headers: form.getHeaders(),
        timeout: 30000,
        maxBodyLength: 20 * 1024 * 1024,
    });
    const url = data?.files?.[0]?.url || data?.data?.files?.[0]?.url || data?.[0]?.url;
    if (!url) throw new Error('No URL returned from upload');
    return url;
}

async function downloadQuotedMedia(quotedMsg) {
    const isImage = !!quotedMsg.imageMessage;
    const isSticker = !!quotedMsg.stickerMessage;

    if (!isImage && !isSticker) return null;

    const mediaMsg = quotedMsg.imageMessage || quotedMsg.stickerMessage;
    const type = isImage ? 'image' : 'sticker';

    const stream = await downloadContentFromMessage(mediaMsg, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

    return { buffer, isImage, isSticker };
}

// ═══════════════════════════════════════════════════
// MAIN COMMAND
// ═══════════════════════════════════════════════════

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = ctxInfo?.quotedMessage;

    // ── No reply? Show usage ─────────────────────────────────
    if (!quotedMsg) {
        await sock.sendMessage(chatId, {
            text: `📷 *GPT Image Editor*\n\n` +
                  `Reply to an *image* or *sticker* with a prompt to edit it.\n\n` +
                  `*Usage:*\n\`.gptimage <your prompt>\`\n\n` +
                  `*Example:*\nReply to an image with:\n\`.gptimage change the background to a beach sunset\``
        }, { quoted: msg });
        return null;
    }

    // ── No prompt? Ask for one ───────────────────────────────
    const prompt = args.join(' ').trim();
    if (!prompt) {
        await sock.sendMessage(chatId, {
            text: `❌ Please provide a prompt!\n\n` +
                  `*Usage:*\n\`.gptimage <your prompt>\`\n\n` +
                  `*Example:* change the background to a beach`
        }, { quoted: msg });
        return null;
    }

    // ── Check if quoted is image or sticker ──────────────────
    const isQuotedImage = !!quotedMsg.imageMessage;
    const isQuotedSticker = !!quotedMsg.stickerMessage;

    if (!isQuotedImage && !isQuotedSticker) {
        await sock.sendMessage(chatId, {
            text: `❌ Please reply to an *image* or *sticker*!`
        }, { quoted: msg });
        return null;
    }

    // ── Animated sticker check ───────────────────────────────
    if (isQuotedSticker) {
        const stickerMsg = quotedMsg.stickerMessage;
        const isAnimated = stickerMsg.isAnimated || stickerMsg.mimetype?.includes('animated') || stickerMsg.mimetype?.includes('gif');
        if (isAnimated) {
            await sock.sendMessage(chatId, {
                text: `❌ Animated stickers are not supported. Use a static image or sticker.`
            }, { quoted: msg });
            return null;
        }
    }

    // ── Processing indicator ─────────────────────────────────
    const processingMsg = await sock.sendMessage(chatId, {
        text: `⏳ *Processing your image...*\n\n_This may take up to 60 seconds depending on complexity._`
    }, { quoted: msg });

    try {
        // ── 1. Download quoted media ─────────────────────────
        const media = await downloadQuotedMedia(quotedMsg);
        if (!media || !media.buffer || media.buffer.length === 0) {
            await sock.sendMessage(chatId, { text: `❌ Failed to download image. Try again.`, delete: processingMsg?.key }).catch(() => {});
            return null;
        }

        // ── 2. Convert to JPEG ───────────────────────────────
        let imageBuffer;
        try {
            imageBuffer = await sharp(media.buffer)
                .jpeg({ quality: 90 })
                .toBuffer();
        } catch (err) {
            console.error('[gptimage] Sharp conversion error:', err.message);
            imageBuffer = media.buffer;
        }

        // ── 3. Upload to get public URL ──────────────────────
        let imageUrl;
        try {
            imageUrl = await uploadToUguu(imageBuffer, 'image.jpg');
        } catch (err) {
            console.error('[gptimage] Upload error:', err.message);
            await sock.sendMessage(chatId, {
                text: `❌ Failed to upload image. Please try again.`,
                edit: processingMsg?.key
            }).catch(() => {});
            return null;
        }

        // ── 4. Call AI Editor API ────────────────────────────
        const apiUrl = `${EDITIMG_API}?image_url=${encodeURIComponent(imageUrl)}&prompt=${encodeURIComponent(prompt)}`;

        const response = await axios.get(apiUrl, {
            timeout: 120000,
            maxContentLength: 10 * 1024 * 1024,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });

        const result = response.data?.result || response.data;

        if (response.data?.status === false) {
            await sock.sendMessage(chatId, {
                text: `❌ API couldn't process this. Try a different image or prompt.`,
                edit: processingMsg?.key
            }).catch(() => {});
            return null;
        }

        const outputImageUrl = result?.output_image;
        if (!outputImageUrl) {
            await sock.sendMessage(chatId, {
                text: `❌ No image returned. Try again with a different prompt.`,
                edit: processingMsg?.key
            }).catch(() => {});
            return null;
        }

        // ── 5. Download result image ─────────────────────────
        const imgRes = await axios.get(outputImageUrl, {
            responseType: 'arraybuffer',
            timeout: 60000,
        });

        const resultBuffer = Buffer.from(imgRes.data);

        if (!resultBuffer || resultBuffer.length === 0) {
            await sock.sendMessage(chatId, {
                text: `❌ Empty image received. Please try again.`,
                edit: processingMsg?.key
            }).catch(() => {});
            return null;
        }

        // ── 6. Size check (5MB max) ──────────────────────────
        if (resultBuffer.length > 5 * 1024 * 1024) {
            const sizeMB = (resultBuffer.length / 1024 / 1024).toFixed(2);
            await sock.sendMessage(chatId, {
                text: `❌ Result too large (${sizeMB}MB). Try a simpler prompt.`,
                edit: processingMsg?.key
            }).catch(() => {});
            return null;
        }

        // ── 7. Send result ───────────────────────────────────
        await sock.sendMessage(chatId, {
            image: resultBuffer,
            caption: `✨ *AI Image Editor*\n\n📝 *Prompt:* ${prompt}`
        }, { quoted: msg });

        // Delete the processing message
        await sock.sendMessage(chatId, { delete: processingMsg?.key }).catch(() => {});

        return null;

    } catch (err) {
        console.error('[gptimage] Error:', err.message);

        let errorMsg = `❌ Something went wrong. Please try again.`;

        if (err.code === 'ECONNABORTED') {
            errorMsg = `❌ Request timed out. The image took too long to process. Try a simpler prompt.`;
        } else if (err.response) {
            const status = err.response.status;
            if (status === 429) errorMsg = `❌ Rate limit hit. Wait a moment and try again.`;
            else if (status === 500) errorMsg = `❌ API server error. Try again later.`;
            else if (status === 400) errorMsg = `❌ Invalid request. Check your prompt and image.`;
        } else if (err.message) {
            errorMsg = `❌ ${err.message}`;
        }

        await sock.sendMessage(chatId, {
            text: errorMsg,
            edit: processingMsg?.key
        }).catch(() => {});

        return null;
    }
}

module.exports = {
    name: 'gptimage',
    aliases: ['gptimg', 'editimage', 'aiimage', 'vision', 'gi'],
    desc: 'Edit image using AI with a prompt',
    category: 'ai',
    execute,
};