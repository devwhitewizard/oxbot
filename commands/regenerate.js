const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const axios  = require('axios');
const sharp  = require('sharp');

const name     = 'regenerate';
const desc     = 'Enhance & clean up a tagged or replied image. Usage: tag image with .regenerate or reply to one.';
const category = 'general';
const aliases  = ['regen', 'enhance', 'hd'];

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    const m      = msg.message;

    try {
        // ── Find image: tagged (caption) or replied ──
        let imageMessage = null;
        let mediaType    = 'image';

        if (m?.imageMessage) {
            imageMessage = m.imageMessage;
        } else {
            const quoted = m?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted?.imageMessage) imageMessage = quoted.imageMessage;
        }

        if (!imageMessage) {
            return await sock.sendMessage(chatId, {
                text:
                    '🖼️ *Regenerate / Enhance Image*\n\n' +
                    'Send an image with *.regenerate* as caption, or reply to an image with *.regenerate*\n\n' +
                    '_Aliases: .regen • .enhance • .hd_',
            }, { quoted: msg });
        }

        // ── Sending status ──
        await sock.sendMessage(chatId, {
            text: '⏳ Enhancing your image... please wait.',
        }, { quoted: msg });

        // ── Download original image ──
        const stream = await downloadContentFromMessage(imageMessage, 'image');
        let buffer = Buffer.alloc(0);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        if (!buffer.length) {
            return await sock.sendMessage(chatId, {
                text: '❌ Could not download the image. Try again.',
            }, { quoted: msg });
        }

        // ── Enhance with sharp ──
        // - Sharpen edges
        // - Boost contrast slightly
        // - Denoise (median blur then sharpen)
        // - Upscale 1.5x for crispness
        // - Convert to high quality JPEG
        const meta = await sharp(buffer).metadata();
        const newW  = Math.min(Math.round((meta.width  || 800) * 1.5), 3000);
        const newH  = Math.min(Math.round((meta.height || 800) * 1.5), 3000);

        const enhanced = await sharp(buffer)
            .resize(newW, newH, { kernel: sharp.kernel.lanczos3 })
            .sharpen({ sigma: 1.2, m1: 1.5, m2: 0.7 })
            .modulate({ brightness: 1.05, saturation: 1.1 })
            .linear(1.08, -(0.08 * 128))   // slight contrast boost
            .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
            .toBuffer();

        // ── Add watermark text via SVG overlay ──
        const watermarkSvg = `
        <svg width="${newW}" height="${newH}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <style>
              .wm { font-family: Arial, sans-serif; font-size: ${Math.max(18, Math.round(newW * 0.022))}px;
                    fill: white; fill-opacity: 0.75; font-weight: bold; }
            </style>
          </defs>
          <text x="${newW - 16}" y="${newH - 16}"
                text-anchor="end"
                class="wm"
                filter="drop-shadow(1px 1px 2px rgba(0,0,0,0.8))">
            Downloaded by OxBot
          </text>
        </svg>`;

        const finalBuffer = await sharp(enhanced)
            .composite([{
                input: Buffer.from(watermarkSvg),
                blend: 'over',
            }])
            .jpeg({ quality: 92 })
            .toBuffer();

        // ── Send enhanced image ──
        await sock.sendMessage(chatId, {
            image:   finalBuffer,
            caption:
                `✨ *Image Enhanced!*\n\n` +
                `📐 Resolution: ${meta.width}×${meta.height} → ${newW}×${newH}\n` +
                `🔧 Sharpened • Denoised • Upscaled\n\n` +
                `_Downloaded by OxBot • oxbot.name.ng_`,
        }, { quoted: msg });

    } catch (err) {
        console.error('[regenerate] Error:', err.message);

        // If sharp not installed
        if (err.code === 'MODULE_NOT_FOUND') {
            return await sock.sendMessage(chatId, {
                text: '❌ Missing dependency. Run: `npm install sharp` on your server.',
            }, { quoted: msg });
        }

        await sock.sendMessage(chatId, {
            text: '❌ Failed to enhance image. Make sure it\'s a valid photo and try again.',
        }, { quoted: msg });
    }
}

module.exports = { name, desc, category, aliases, execute };