const name     = 'groupinfo';
const desc     = 'Get group information';
const category = 'group';
const aliases  = ['ginfo', 'group'];

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;

    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ Group only command!' }, { quoted: msg });
    }

    try {
        const meta = await sock.groupMetadata(chatId);

        let pp;
        try {
            pp = await sock.profilePictureUrl(chatId, 'image');
        } catch {
            pp = 'https://i.imgur.com/2wzGhpF.jpeg';
        }

        const participants = meta.participants;
        const admins       = participants.filter(p => p.admin);
        const owner        = meta.owner
                          || admins.find(p => p.admin === 'superadmin')?.id
                          || chatId.split('-')[0] + '@s.whatsapp.net';

        const adminList = admins.length
            ? admins.map((p, i) => `  ${i + 1}. @${p.id.split('@')[0]}`).join('\n')
            : '  None';

        const createdAt = meta.creation
            ? new Date(meta.creation * 1000).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'long', year: 'numeric'
              })
            : 'Unknown';

        const text =
            `┌──「 *GROUP INFO* 」\n` +
            `│\n` +
            `│ 🔖 *Name:* ${meta.subject}\n` +
            `│ ♻️ *ID:* ${meta.id}\n` +
            `│ 👥 *Members:* ${participants.length}\n` +
            `│ 👑 *Owner:* @${owner.split('@')[0]}\n` +
            `│ 📅 *Created:* ${createdAt}\n` +
            `│\n` +
            `│ 🛡️ *Admins (${admins.length}):*\n` +
            `${adminList}\n` +
            `│\n` +
            `│ 📌 *Description:*\n` +
            `│ ${meta.desc?.toString() || 'No description'}\n` +
            `└──────────────────`;

        const mentions = [...admins.map(p => p.id), owner];

        await sock.sendMessage(chatId, {
            image: { url: pp },
            caption: text,
            mentions
        }, { quoted: msg });

    } catch (err) {
        console.error('[groupinfo] Error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to get group info: ' + err.message
        }, { quoted: msg });
    }
}

module.exports = { name, desc, category, aliases, execute };
