const name     = 'unmute';
const desc     = 'Unmute the group (everyone can send)';
const category = 'group';

async function execute(sock, msg, botData, args) {
    const chatId   = msg.key.remoteJid;
    if (!chatId.endsWith('@g.us')) return await sock.sendMessage(chatId, { text: '❌ Group only!' }, { quoted: msg });

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

    await sock.groupSettingUpdate(chatId, 'not_announcement');
    await sock.sendMessage(chatId, { text: '🔊 *Group unmuted!* Everyone can send messages.' }, { quoted: msg });
}

module.exports = { name, desc, category, execute };
