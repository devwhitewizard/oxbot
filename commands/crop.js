
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const sharp = require('sharp');

const name     = 'crop';
const desc     = 'Crop & clean screenshots — removes status bar, battery, notch. Tag image or reply with .crop';
const category = 'general';
const aliases  = ['cropimg', 'cleanss', 'trimss'];

// Common status bar heights as % of image height (we'll auto-detect)
// Most Android: 24-72px, iOS: 44-59px notch area
// We crop from top and optionally bottom nav bar

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    const m      = msg.message;

    try {
        // ── Find image: tagged (caption) or replied ──
        let imageMessage = null;

        if (m?.imageMessage) {
            imageMessage = m.imageMessage;
        } else {
            const quoted = m?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted?.imageMessage) imageMessage = quoted.imageMessage;
        }

        if (!imageMessage) {
            return await sock.sendMessage(chatId, {
                text:
                    `✂️ *Screenshot Cropper*\n\n` +
                    `Removes status bar, battery %, time, notch & nav bar from screenshots.\n\n` +
                    `*How to use:*\n` +
                    `• Send a screenshot with *.crop* as caption\n` +
                    `• Or reply to a screenshot with *.crop*\n\n` +
                    `*Options:*\n` +
                    `• \`.crop\` — auto crop top status bar\n` +
                    `• \`.crop full\` — crop top + bottom nav bar\n` +
                    `• \`.crop top 80\` — crop exactly 80px from top\n` +
                    `• \`.crop bottom 60\` — crop exactly 60px from bottom\n` +
                    `• \`.crop 80 60\` — crop 80px top, 60px bottom`,
            }, { quoted: msg });
        }

        // ── Parse args for crop mode ──
        // .crop              → auto (smart top crop)
        // .crop full         → auto top + auto bottom
        // .crop top 80       → exact 80px from top
        // .crop bottom 60    → exact 60px from bottom
        // .crop 80 60        → exact top + bottom
        const arg1 = (args[0] || '').toLowerCase();
        const arg2 = (args[1] || '').toLowerCase();

        let mode       = 'auto';      // auto | full | exact
        let exactTop   = null;
        let exactBot   = null;

        if (arg1 === 'full') {
            mode = 'full';
        } else if (arg1 === 'top' && arg2 && !isNaN(arg2)) {
            mode     = 'exact';
            exactTop = parseInt(arg2);
            exactBot = 0;
        } else if (arg1 === 'bottom' && arg2 && !isNaN(arg2)) {
            mode     = 'exact';
            exactTop = 0;
            exactBot = parseInt(arg2);
        } else if (arg1 && !isNaN(arg1)) {
            mode     = 'exact';
            exactTop = parseInt(arg1);
            exactBot = arg2 && !isNaN(arg2) ? parseInt(arg2) : 0;
        }

        // ── Download image ──
        const stream = await downloadContentFromMessage(imageMessage, 'image');
        let buffer = Buffer.alloc(0);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        if (!buffer.length) {
            return await sock.sendMessage(chatId, {
                text: '❌ Could not download image. Try again.',
            }, { quoted: msg });
        }

        // ── Get image dimensions ──
        const meta = await sharp(buffer).metadata();
        const W    = meta.width;
        const H    = meta.height;

        // ── Calculate crop amounts ──
        let topCrop = 0;
        let botCrop = 0;

        if (mode === 'exact') {
            topCrop = Math.min(exactTop || 0, Math.floor(H * 0.3));
            botCrop = Math.min(exactBot || 0, Math.floor(H * 0.3));

        } else if (mode === 'auto' || mode === 'full') {
            // Smart detection: status bars are usually 5-10% of height
            // For phones: 1080x2340 → top ~72px (~3%), 1080x1920 → top ~60px (~3%)
            // We scan top rows for high contrast horizontal band = status bar

            const rawPixels = await sharp(buffer)
                .resize(W, H)
                .raw()
                .toBuffer({ resolveWithObject: true });

            const { data, info } = rawPixels;
            const channels = info.channels; // 3=RGB, 4=RGBA

            // Scan top 15% of image row by row
            // Look for row where content starts (high variance = content, low = solid bar)
            const scanRows = Math.floor(H * 0.15);
            let detectedTop = 0;

            for (let row = scanRows; row >= 8; row--) {
                let rowVariance = 0;
                const sampleStep = Math.max(1, Math.floor(W / 20)); // sample 20 points per row
                let prevL = -1;
                let samples = 0;

                for (let col = 0; col < W; col += sampleStep) {
                    const idx = (row * W + col) * channels;
                    const r = data[idx], g = data[idx+1], b = data[idx+2];
                    // Luminance
                    const L = 0.299*r + 0.587*g + 0.114*b;
                    if (prevL >= 0) rowVariance += Math.abs(L - prevL);
                    prevL = L;
                    samples++;
                }

                const avgVariance = rowVariance / samples;
                // Low variance row = solid color = likely status bar boundary
                if (avgVariance < 12 && row > 20) {
                    detectedTop = row + 1;
                    break;
                }
            }

            // Fallback: if detection failed, use % of height
            if (detectedTop < 20) {
                // Common status bar heights as % of image height
                if (H > 2000)      detectedTop = Math.round(H * 0.042); // ~100px on tall phones
                else if (H > 1500) detectedTop = Math.round(H * 0.050); // ~80px
                else               detectedTop = Math.round(H * 0.055); // ~60px
            }

            topCrop = detectedTop;

            if (mode === 'full') {
                // Bottom nav bar: usually ~48-100px or 5-8% of height
                if (H > 2000)      botCrop = Math.round(H * 0.050);
                else if (H > 1500) botCrop = Math.round(H * 0.055);
                else               botCrop = Math.round(H * 0.060);
            }
        }

        // ── Safety: don't crop more than 30% total ──
        topCrop = Math.max(0, Math.min(topCrop, Math.floor(H * 0.3)));
        botCrop = Math.max(0, Math.min(botCrop, Math.floor(H * 0.3)));

        const newH = H - topCrop - botCrop;
        if (newH <= 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ Crop values too large for this image.',
            }, { quoted: msg });
        }

        // ── Crop with sharp ──
        const cropped = await sharp(buffer)
            .extract({ left: 0, top: topCrop, width: W, height: newH })
            .sharpen({ sigma: 0.5 })
            .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
            .toBuffer();

        // ── Build caption ──
        let modeLabel = mode === 'full' ? 'Top + Bottom' : mode === 'exact' ? 'Custom' : 'Auto (Top)';
        let cropInfo  = `Top: ${topCrop}px`;
        if (botCrop > 0) cropInfo += ` • Bottom: ${botCrop}px`;

        await sock.sendMessage(chatId, {
            image:   cropped,
            caption:
                `✂️ *Screenshot Cleaned!*\n\n` +
                `📐 Original: ${W}×${H}\n` +
                `📐 Cropped: ${W}×${newH}\n` +
                `✂️ Mode: ${modeLabel} (${cropInfo})\n\n` +
                `_Downloaded by OxBot • oxbot.name.ng_`,
        }, { quoted: msg });

    } catch (err) {
        console.error('[crop] Error:', err.message);

        if (err.code === 'MODULE_NOT_FOUND') {
            return await sock.sendMessage(chatId, {
                text: '❌ Missing dependency. Run: `npm install sharp` on your server.',
            }, { quoted: msg });
        }

        await sock.sendMessage(chatId, {
            text: '❌ Failed to crop image. Make sure it\'s a valid photo and try again.',
        }, { quoted: msg });
    }
}

module.exports = { name, desc, category, aliases, execute };

