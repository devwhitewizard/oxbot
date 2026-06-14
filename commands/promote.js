const name     = 'promote';
const desc     = 'Promote a user to admin';
const category = 'group';

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;

    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ Group only command!' }, { quoted: msg });
    }

    const senderId = msg.key.participant || msg.key.remoteJid;
    const db        = botData?.db;
    const sessionId = botData?.sessionId;
    let senderIsOwner = msg.key.fromMe;
    if (!senderIsOwner && db && sessionId) {
        try {
            const [rows] = await db.query(
                'SELECT u.phone FROM users u JOIN bots b ON b.user_id=u.id WHERE b.session_id=? LIMIT 1',
                [sessionId]
            );
            if (rows.length) {
                const ownerNum = String(rows[0].phone).replace(/\D/g, '');
                senderIsOwner = senderId.includes(ownerNum);
            }
        } catch {}
    }
    const botJid   = sock.user?.id?.split('@')[0]?.split(':')[0] + '@s.whatsapp.net';

    let meta;
    try { meta = await sock.groupMetadata(chatId); } catch {
        return await sock.sendMessage(chatId, { text: '❌ Could not fetch group info.' }, { quoted: msg });
    }

    const botMember    = meta.participants.find(p => p.id.split(':')[0].split('@')[0] === botJid.split('@')[0]);
    const senderMember = meta.participants.find(p => p.id.split(':')[0].split('@')[0] === senderId.split(':')[0].split('@')[0]);

    if (!botMember || !['admin','superadmin'].includes(botMember.admin)) {
        return await sock.sendMessage(chatId, { text: '❌ I need to be an admin first!' }, { quoted: msg });
    }
    if (!msg.key.fromMe && !senderIsOwner && (!senderMember || !["admin","superadmin"].includes(senderMember.admin))) {
        return await sock.sendMessage(chatId, { text: '❌ Only admins can use this!' }, { quoted: msg });
    }

    let targets = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!targets.length && msg.message?.extendedTextMessage?.contextInfo?.participant) {
        targets = [msg.message.extendedTextMessage.contextInfo.participant];
    }
    if (!targets.length) {
        return await sock.sendMessage(chatId, { text: '❌ Mention or reply to a user!\n*.promote @user*' }, { quoted: msg });
    }

    await sock.groupParticipantsUpdate(chatId, targets, 'promote');
    const names = targets.map(j => `@${j.split('@')[0]}`).join(', ');
    await sock.sendMessage(chatId, {
        text: `✅ *Promoted:* ${names}\n👑 *By:* @${senderId.split('@')[0]}`,
        mentions: [...targets, senderId]
    }, { quoted: msg });
}

module.exports = { name, desc, category, execute };
