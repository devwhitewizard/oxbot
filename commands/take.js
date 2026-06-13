const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const webp = require('node-webpmux');
const crypto = require('crypto');

const name     = 'take';
const desc     = 'Take a sticker and add your pack name';
const category = 'general';

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;

    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quoted?.stickerMessage) {
        return await sock.sendMessage(chatId, {
            text: '❌ Reply to a sticker with *.take <packname>*'
        }, { quoted: msg });
    }

    const packname = args.join(' ') || 'OxBot';

    try {
        // Build a fake message object for downloadMediaMessage
        const quotedKey = msg.message.extendedTextMessage.contextInfo;
        const fakeMsg = {
            key: {
                remoteJid: chatId,
                id: quotedKey.stanzaId,
                fromMe: false,
            },
            message: quoted,
        };

        const stickerBuffer = await downloadMediaMessage(
            fakeMsg,
            'buffer',
            {},
            { logger: { info: () => {}, error: () => {}, warn: () => {} }, reuploadRequest: sock.updateMediaMessage }
        );

        if (!stickerBuffer || stickerBuffer.length === 0) {
            return await sock.sendMessage(chatId, { text: '❌ Failed to download sticker' }, { quoted: msg });
        }

        const img = new webp.Image();
        await img.load(stickerBuffer);

        const json = {
            'sticker-pack-id':   crypto.randomBytes(32).toString('hex'),
            'sticker-pack-name': packname,
            'sticker-pack-publisher': 'OxBot',
            'emojis': ['🤖'],
        };

        const exifAttr  = Buffer.from([
            0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
            0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x16, 0x00, 0x00, 0x00
        ]);
        const jsonBuf   = Buffer.from(JSON.stringify(json), 'utf8');
        const exif      = Buffer.concat([exifAttr, jsonBuf]);
        exif.writeUIntLE(jsonBuf.length, 14, 4);

        img.exif = exif;
        const finalBuffer = await img.save(null);

        await sock.sendMessage(chatId, { sticker: finalBuffer }, { quoted: msg });

    } catch (err) {
        console.error('[take] Error:', err.message);
        await sock.sendMessage(chatId, { text: '❌ Error: ' + err.message }, { quoted: msg });
    }
}

module.exports = { name, desc, category, execute };