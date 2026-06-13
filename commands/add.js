const name     = 'add';
const desc     = 'Add a user to the group';
const category = 'group';

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;

    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ Group only!' }, { quoted: msg });
    }

    if (!args.length) {
        return await sock.sendMessage(chatId, {
            text: '❌ Provide a number!\n*.add 2348012345678*'
        }, { quoted: msg });
    }

    let meta;
    try { meta = await sock.groupMetadata(chatId); } catch {
        return await sock.sendMessage(chatId, { text: '❌ Could not fetch group info.' }, { quoted: msg });
    }

    // Check if bot is admin
    const botNum    = sock.user?.id?.split(':')[0]?.split('@')[0];
    const botMember = meta.participants.find(p => p.id.split(':')[0].split('@')[0] === botNum);

    if (!botMember || !['admin','superadmin'].includes(botMember.admin)) {
        return await sock.sendMessage(chatId, { text: '❌ Make me an admin first!' }, { quoted: msg });
    }

    // Check sender — owner bypasses admin check
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

    if (!senderIsOwner) {
        const senderMember = meta.participants.find(p =>
            p.id.split(':')[0].split('@')[0] === senderId.split(':')[0].split('@')[0]
        );
        if (!senderMember || !['admin','superadmin'].includes(senderMember.admin)) {
            return await sock.sendMessage(chatId, { text: '❌ Only admins can use this!' }, { quoted: msg });
        }
    }

    // Normalize number
    let number = args[0].replace(/[^0-9]/g, '');
    if (number.startsWith('0')) number = '234' + number.slice(1);
    if (number.length < 7) {
        return await sock.sendMessage(chatId, { text: '❌ Invalid number!' }, { quoted: msg });
    }
    const jid = number + '@s.whatsapp.net';

    try {
        const result = await sock.groupParticipantsUpdate(chatId, [jid], 'add');
        const status = result?.[0]?.status;

        if (status === '403') {
            return await sock.sendMessage(chatId, {
                text: `❌ @${number} has restricted who can add them to groups.`,
                mentions: [jid]
            }, { quoted: msg });
        }
        if (status === '408') {
            return await sock.sendMessage(chatId, {
                text: `❌ @${number} is not on WhatsApp or the number is invalid.`,
                mentions: [jid]
            }, { quoted: msg });
        }

        await sock.sendMessage(chatId, {
            text: `✅ Successfully added @${number} to the group!`,
            mentions: [jid]
        }, { quoted: msg });

    } catch (err) {
        await sock.sendMessage(chatId, {
            text: '❌ Failed to add: ' + err.message
        }, { quoted: msg });
    }
}

module.exports = { name, desc, category, execute };
