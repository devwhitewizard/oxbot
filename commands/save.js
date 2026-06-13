// commands/save.js
// .save command — reply to a status update (image/video/audio/sticker/document)
// to save it to the user's DM

const fs   = require('fs');
const path = require('path');

async function handleSaveCommand(sock, chatId, message, senderId) {
    try {
        // ── 1. Resolve the quoted / context message ───────────────────────────
        const contextInfo = message.message?.extendedTextMessage?.contextInfo || {};
        const quotedMsg   = contextInfo.quotedMessage;
        const statusOwner = contextInfo.participant || contextInfo.remoteJid || '';

        const directMsg = message.message;
        const mediaMsg  = quotedMsg || directMsg;

        if (!mediaMsg) {
            await sock.sendMessage(chatId, {
                text: '❌ Please reply to a status (image/video) with *.save* to download it.'
            }, { quoted: message });
            return;
        }

        // ── 2. Detect media type ──────────────────────────────────────────────
        const mediaTypes = {
            imageMessage    : { ext: 'jpg',  mime: 'image/jpeg',               label: '🖼️ Image'   },
            videoMessage    : { ext: 'mp4',  mime: 'video/mp4',                label: '🎥 Video'   },
            stickerMessage  : { ext: 'webp', mime: 'image/webp',               label: '🎉 Sticker' },
            audioMessage    : { ext: 'mp3',  mime: 'audio/mpeg',               label: '🎵 Audio'   },
            documentMessage : { ext: 'bin',  mime: 'application/octet-stream', label: '📄 File'    },
        };

        let mediaType = null;
        let mediaInfo = null;

        for (const [type, info] of Object.entries(mediaTypes)) {
            if (mediaMsg[type]) {
                mediaType = type;
                mediaInfo = info;
                break;
            }
        }

        if (!mediaType) {
            await sock.sendMessage(chatId, {
                text: '❌ No media found.\nReply to an image, video, sticker, or audio status with *.save*.'
            }, { quoted: message });
            return;
        }

        // ── 3. Download the media buffer ──────────────────────────────────────
        await sock.sendMessage(chatId, { text: `⏳ Saving ${mediaInfo.label}…` });

        let buffer;
        try {
            const { downloadMediaMessage } = require('@whiskeysockets/baileys');

            const msgForDownload = quotedMsg
                ? {
                    key: {
                        remoteJid  : contextInfo.remoteJid || chatId,
                        id         : contextInfo.stanzaId  || '',
                        participant: statusOwner,
                    },
                    message: quotedMsg,
                }
                : message;

            buffer = await downloadMediaMessage(msgForDownload, 'buffer', {}, {
                logger         : console,
                reuploadRequest: sock.updateMediaMessage,
            });
        } catch (dlErr) {
            console.error('[save] Download error:', dlErr.message);
            await sock.sendMessage(chatId, {
                text: '❌ Failed to download the media. The status may have expired.'
            }, { quoted: message });
            return;
        }

        if (!buffer || buffer.length === 0) {
            await sock.sendMessage(chatId, {
                text: '❌ Downloaded file appears empty. The status may have expired.'
            }, { quoted: message });
            return;
        }

        // ── 4. Persist to local temp folder ──────────────────────────────────
        const saveDir  = path.join(process.cwd(), 'temp', 'saved_status');
        if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

        const fileName = `status_${Date.now()}.${mediaInfo.ext}`;
        const filePath = path.join(saveDir, fileName);
        fs.writeFileSync(filePath, buffer);

        // ── 5. Send the media back to the requesting user's DM ────────────────
        const privateChatId = senderId.includes('@') ? senderId : `${senderId}@s.whatsapp.net`;

        const caption = '✅ *Status saved!*';

        if (mediaType === 'imageMessage') {
            await sock.sendMessage(privateChatId, {
                image   : buffer,
                caption : caption,
                mimetype: mediaInfo.mime,
            });
        } else if (mediaType === 'videoMessage') {
            await sock.sendMessage(privateChatId, {
                video   : buffer,
                caption : caption,
                mimetype: mediaInfo.mime,
            });
        } else if (mediaType === 'stickerMessage') {
            await sock.sendMessage(privateChatId, {
                sticker : buffer,
                mimetype: mediaInfo.mime,
            });
        } else if (mediaType === 'audioMessage') {
            await sock.sendMessage(privateChatId, {
                audio   : buffer,
                mimetype: mediaInfo.mime,
                ptt     : mediaMsg.audioMessage?.ptt || false,
            });
        } else {
            const docMime     = mediaMsg.documentMessage?.mimetype || mediaInfo.mime;
            const docFilename = mediaMsg.documentMessage?.fileName || fileName;
            await sock.sendMessage(privateChatId, {
                document : buffer,
                mimetype : docMime,
                fileName : docFilename,
                caption  : caption,
            });
        }

        // ── 6. Confirm in the original chat ───────────────────────────────────
        if (privateChatId !== chatId) {
            await sock.sendMessage(chatId, {
                text: `✅ ${mediaInfo.label} has been saved and sent to your DM!`
            }, { quoted: message });
        }

        // ── 7. Clean up local temp file ───────────────────────────────────────
        try { fs.unlinkSync(filePath); } catch (_) {}

    } catch (err) {
        console.error('[save] Unexpected error:', err);
        try {
            await sock.sendMessage(chatId, {
                text: '❌ An unexpected error occurred while saving the status.'
            });
        } catch (_) {}
    }
}

const name     = 'save';
const desc     = 'Reply to a status with .save to download it to your DM';
const category = 'utility';

async function execute(sock, msg, botData, args) {
    const chatId   = msg.key.remoteJid;
    const senderId = msg.key.participant || msg.key.remoteJid;
    return handleSaveCommand(sock, chatId, msg, senderId);
}

module.exports = { name, desc, category, execute, handleSaveCommand };