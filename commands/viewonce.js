/**
 * OxBot — View Once Command (vv)
 * Owner only — fetches owner from users table via session_id
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// ── Strip device/LID suffix ──
function cleanNumber(jid) {
    if (!jid) return '';
    return jid.split(':')[0].split('@')[0];
}

// ── Fetch owner phone from users table for this session ──
async function getOwnerNumber(db, sessionId) {
    try {
        const [rows] = await db.query(
            'SELECT u.phone FROM users u JOIN bots b ON b.user_id = u.id WHERE b.session_id = ? LIMIT 1',
            [sessionId]
        );
        if (!rows.length || !rows[0].phone) return null;
        return String(rows[0].phone).replace(/\D/g, '');
    } catch (err) {
        console.error('[vv] DB error fetching owner:', err.message);
        return null;
    }
}

// ── Check if sender is the owner ──
async function isOwner(db, sessionId, senderId, sock, chatId) {
    const ownerNumber = await getOwnerNumber(db, sessionId);
    if (!ownerNumber) return false;

    const ownerJid    = ownerNumber + '@s.whatsapp.net';
    const senderClean = cleanNumber(senderId);

    if (senderId === ownerJid) return true;
    if (senderClean === ownerNumber) return true;
    if (senderId.includes(ownerNumber)) return true;

    // Group LID match
    if (sock && chatId && chatId.endsWith('@g.us') && senderId.includes('@lid')) {
        try {
            const metadata     = await sock.groupMetadata(chatId);
            const participants = metadata.participants || [];
            const match = participants.find(p => {
                const pIdClean = cleanNumber(p.id || '');
                return pIdClean === ownerNumber || (p.id || '') === ownerJid;
            });
            if (match) return true;
        } catch (e) {
            console.error('[vv] Group LID check error:', e.message);
        }
    }

    return false;
}

// ── The .vv command ──
async function execute(sock, message, botData) {
    const chatId = message.key.remoteJid;

    if (!botData?.sessionId || !botData?.db) {
        return await sock.sendMessage(chatId, {
            text: '⚠️ Database error. Please restart the bot.'
        }, { quoted: message });
    }

    const senderId      = message.key.participant || message.key.remoteJid;
    const senderIsOwner = await isOwner(botData.db, botData.sessionId, senderId, sock, chatId);

    if (!message.key.fromMe && !senderIsOwner) {
        return await sock.sendMessage(chatId, {
            text: '❌ This command is only available for the owner!'
        }, { quoted: message });
    }

    const quoted      = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedImage = quoted?.imageMessage;
    const quotedVideo = quoted?.videoMessage;

    try {
        if (quotedImage && quotedImage.viewOnce) {
            const stream = await downloadContentFromMessage(quotedImage, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            return await sock.sendMessage(chatId, {
                image:    buffer,
                fileName: 'media.jpg',
                caption:  quotedImage.caption || ''
            }, { quoted: message });
        }

        if (quotedVideo && quotedVideo.viewOnce) {
            const stream = await downloadContentFromMessage(quotedVideo, 'video');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            return await sock.sendMessage(chatId, {
                video:    buffer,
                fileName: 'media.mp4',
                caption:  quotedVideo.caption || ''
            }, { quoted: message });
        }

        return await sock.sendMessage(chatId, {
            text: '❌ Please reply to a view-once image or video.'
        }, { quoted: message });

    } catch (err) {
        console.error('[vv] Download error:', err.message);
        return await sock.sendMessage(chatId, {
            text: '❌ Failed to download media: ' + err.message
        }, { quoted: message });
    }
}

module.exports = {
    name: 'vv',
    execute,
    desc: 'View once media revealer (Owner Only)',
    category: 'owner',
    aliases: ['viewonce', 'antiviewonce']
};