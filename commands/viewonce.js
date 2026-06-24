/**
 * OxBot — View Once Command (vv)
 * Secretly sends opened view-once media to Owner's DM
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// ✅ Fast JID cleaner (matches handler.js and promote.js)
const clean = (jid) => jid ? jid.split(':')[0].split('@')[0] : '';

async function execute(sock, msg, botData, args) {
    const chatId   = msg.key.remoteJid;
    const senderId = msg.key.participant || msg.key.remoteJid;

    // ── 1. Fast Owner Check ──────────────────────────────────
    let isOwner = msg.key.fromMe;
    if (!isOwner && sock._ownerPhone) {
        const senderNum = clean(senderId).replace(/\D/g, '');
        const ownerNum  = sock._ownerPhone.replace(/\D/g, '');
        if (senderNum && ownerNum) {
            const sN = senderNum.startsWith('0') ? senderNum.slice(1) : senderNum;
            const oN = ownerNum.startsWith('0') ? ownerNum.slice(1) : ownerNum;
            isOwner = sN === oN || sN.endsWith(oN) || oN.endsWith(sN);
        }
    }

    // If a non-owner uses this, completely ignore it so they don't even know it exists
    if (!isOwner) return null;

    // ── 2. Get Media from Quoted Message ─────────────────────
    const quoted      = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedImage = quoted?.imageMessage;
    const quotedVideo = quoted?.videoMessage;

    // Owner's private DM JID
    const ownerJid = sock._ownerPhone + '@s.whatsapp.net';

    try {
        let buffer, type;
        let originalCaption = '';

        if (quotedImage && quotedImage.viewOnce) {
            const stream = await downloadContentFromMessage(quotedImage, 'image');
            buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            type = 'image';
            originalCaption = quotedImage.caption || '';
        } 
        else if (quotedVideo && quotedVideo.viewOnce) {
            const stream = await downloadContentFromMessage(quotedVideo, 'video');
            buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            type = 'video';
            originalCaption = quotedVideo.caption || '';
        } 
        else {
            // If not a view-once, warn the owner in their DM
            await sock.sendMessage(ownerJid, { text: '⚠️ Please reply to a view-once image or video.' });
            return null;
        }

        // ── 3. Send Secretly to Owner's DM ───────────────────
        const senderTag = `@${clean(senderId)}`;
        const isGroup   = chatId.endsWith('@g.us');
        const location  = isGroup ? '👥 Group Chat' : '👤 Direct Message';

        const dmText = `🔓 *View-Once Revealed*\n\n` +
                       `👤 *From:* ${senderTag}\n` +
                       `📍 *Location:* ${location}\n` +
                       (originalCaption ? `💬 *Caption:* ${originalCaption}\n\n` : '\n') +
                       `_⬆️ Downloaded secretly and sent to your DM_`;

        if (type === 'image') {
            await sock.sendMessage(ownerJid, {
                image: buffer,
                caption: dmText,
                mentions: [senderId]
            });
        } else if (type === 'video') {
            await sock.sendMessage(ownerJid, {
                video: buffer,
                caption: dmText,
                mentions: [senderId]
            });
        }

        // ✅ DO NOT send anything back to the original chat! 
        // The group/user will have no idea the bot caught it.
        return null;

    } catch (err) {
        console.error('[vv] Download error:', err.message);
        // Send error silently to owner's DM instead of the group
        await sock.sendMessage(ownerJid, { 
            text: `❌ Failed to download view-once media: ${err.message}` 
        }).catch(() => {});
        return null;
    }
}

module.exports = {
    name: 'vv',
    aliases: ['viewonce', 'antiviewonce'],
    desc: 'View once media revealer (Owner Only)',
    category: 'owner',
    execute
};