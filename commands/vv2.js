/**
 * vv2.js — View Once Revealer (Public Chat Version)
 * Aliases: .vv2, .reveal, .openvv
 * 
 * Reveals view-once media directly in the chat for everyone to see.
 * Free for any user to use. No limits, no DM forwarding.
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    // ── 1. Get Media from Quoted Message ─────────────────────
    const quoted      = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedImage = quoted?.imageMessage;
    const quotedVideo = quoted?.videoMessage;

    const isViewOnceImage = quotedImage && quotedImage.viewOnce;
    const isViewOnceVideo = quotedVideo && quotedVideo.viewOnce;

    if (!isViewOnceImage && !isViewOnceVideo) {
        await sock.sendMessage(chatId, {
            text: '⚠️ Please reply to a view-once image or video with `.vv2`'
        }, { quoted: msg });
        return null;
    }

    // ── 2. DELETE the .vv2 command message immediately ───────
    //    This makes it look seamless in the chat
    await sock.sendMessage(chatId, { delete: msg.key }).catch(() => {});

    // ── 3. Download the media ────────────────────────────────
    try {
        let buffer, type;
        let originalCaption = '';

        if (isViewOnceImage) {
            const stream = await downloadContentFromMessage(quotedImage, 'image');
            buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            type = 'image';
            originalCaption = quotedImage.caption || '';
        } else {
            const stream = await downloadContentFromMessage(quotedVideo, 'video');
            buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            type = 'video';
            originalCaption = quotedVideo.caption || '';
        }

        // ── 4. Send back to the SAME chat ────────────────────
        const sendText = originalCaption ? `🔓 *View-Once Revealed*\n\n${originalCaption}` : '🔓 *View-Once Revealed*';

        if (type === 'image') {
            await sock.sendMessage(chatId, {
                image: buffer,
                caption: sendText
            });
        } else if (type === 'video') {
            await sock.sendMessage(chatId, {
                video: buffer,
                caption: sendText
            });
        }

        return null;

    } catch (err) {
        console.error('[vv2] Download error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to process view-once media. The media might have expired.'
        }).catch(() => {});
        return null;
    }
}

module.exports = {
    name:     'vv2',
    aliases:  ['reveal', 'openvv'],
    desc:     'Reveal view-once media directly in the chat (Free for all)',
    category: 'general', // <-- NOTICE: It's 'general', not 'owner'
    execute
};