const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const webp = require('node-webpmux');
const crypto = require('crypto');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const messageToQuote = msg;
    let targetMessage = msg;

    // If replying to media, use the quoted message
    if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const ctx = msg.message.extendedTextMessage.contextInfo;
        targetMessage = {
            key: {
                remoteJid: chatId,
                id: ctx.stanzaId,
                participant: ctx.participant
            },
            message: ctx.quotedMessage
        };
    }

    const mediaMessage = targetMessage.message?.imageMessage
        || targetMessage.message?.videoMessage
        || targetMessage.message?.documentMessage;

    if (!mediaMessage) {
        await sock.sendMessage(chatId, {
            text: 'Send an image/video with *.sticker* as caption, or reply to an image/video with *.sticker*.'
        }, { quoted: messageToQuote });
        return null;
    }

    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const tempInput  = path.join(tmpDir, `in_${Date.now()}`);
    const tempOutput = path.join(tmpDir, `out_${Date.now()}.webp`);

    try {
        const mediaBuffer = await downloadMediaMessage(targetMessage, 'buffer', {}, {
            logger: undefined,
            reuploadRequest: sock.updateMediaMessage
        });

        if (!mediaBuffer) {
            await sock.sendMessage(chatId, { text: 'Failed to download media. Try again.' }, { quoted: messageToQuote });
            return null;
        }

        fs.writeFileSync(tempInput, mediaBuffer);

        const isAnimated = mediaMessage.mimetype?.includes('gif')
            || mediaMessage.mimetype?.includes('video')
            || (mediaMessage.seconds || 0) > 0;

        // Primary encode
        const baseCmd = isAnimated
            ? `ffmpeg -y -i "${tempInput}" -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 75 -compression_level 6 "${tempOutput}"`
            : `ffmpeg -y -i "${tempInput}" -vf "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 75 -compression_level 6 "${tempOutput}"`;

        await new Promise((resolve, reject) => {
            exec(baseCmd, (err) => err ? reject(err) : resolve());
        });

        let webpBuffer = fs.readFileSync(tempOutput);

        // Fallback #1 — if animated & over 1MB, re-encode shorter/lower quality
        if (isAnimated && webpBuffer.length > 1000 * 1024) {
            const fb1 = path.join(tmpDir, `fb1_${Date.now()}.webp`);
            const huge = mediaBuffer.length > 5000 * 1024;
            const fbCmd = huge
                ? `ffmpeg -y -i "${tempInput}" -t 2 -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=8,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 30 -compression_level 6 -b:v 100k -max_muxing_queue_size 1024 "${fb1}"`
                : `ffmpeg -y -i "${tempInput}" -t 3 -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=12,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 45 -compression_level 6 -b:v 150k -max_muxing_queue_size 1024 "${fb1}"`;
            try {
                await new Promise((resolve, reject) => {
                    exec(fbCmd, (err) => err ? reject(err) : resolve());
                });
                if (fs.existsSync(fb1)) {
                    webpBuffer = fs.readFileSync(fb1);
                    fs.unlinkSync(fb1);
                }
            } catch {}
        }

        // Fallback #2 — still too big, shrink to 320px
        if (isAnimated && webpBuffer.length > 900 * 1024) {
            const fb2 = path.join(tmpDir, `fb2_${Date.now()}.webp`);
            const smallCmd = `ffmpeg -y -i "${tempInput}" -t 2 -vf "scale=320:320:force_original_aspect_ratio=decrease,fps=8,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 30 -compression_level 6 -b:v 80k -max_muxing_queue_size 1024 "${fb2}"`;
            try {
                await new Promise((resolve, reject) => {
                    exec(smallCmd, (err) => err ? reject(err) : resolve());
                });
                if (fs.existsSync(fb2)) {
                    webpBuffer = fs.readFileSync(fb2);
                    fs.unlinkSync(fb2);
                }
            } catch {}
        }

        // Inject EXIF metadata
        const img = new webp.Image();
        await img.load(webpBuffer);

        const packName = (botData?.settings?.packname) || 'OxBot';
        const json = {
            'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
            'sticker-pack-name': packName,
            'emojis': ['🤖']
        };

        const exifAttr = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
        const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
        const exif = Buffer.concat([exifAttr, jsonBuf]);
        exif.writeUIntLE(jsonBuf.length, 14, 4);
        img.exif = exif;

        const finalBuffer = await img.save(null);

        await sock.sendMessage(chatId, {
            sticker: finalBuffer
        }, { quoted: messageToQuote });

    } catch (error) {
        console.error('[sticker] Error:', error.message);
        await sock.sendMessage(chatId, {
            text: 'Failed to create sticker! Try again.'
        }, { quoted: messageToQuote });
    } finally {
        try { fs.unlinkSync(tempInput); }  catch {}
        try { fs.unlinkSync(tempOutput); } catch {}
    }

    return null;
}

module.exports = {
    name: 'sticker',
    aliases: ['s', 'stick', 'stiker'],
    desc: 'Convert image/video to sticker',
    category: 'general',
    execute
};