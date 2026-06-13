async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    
    if (!chatId || !chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: '❌ This command can only be used in groups.' }, { quoted: msg });
        return null;
    }

    const senderId = msg.key.participant || msg.key.remoteJid;

    try {
        // Fetch group members once
        const groupMetadata = await sock.groupMetadata(chatId);
        const participants = groupMetadata.participants || [];

        // Inline helper to check admin status (handles @lid safely)
        const checkAdmin = (jid) => {
            if (!jid) return false;
            const cleanTarget = jid.split(':')[0];
            return participants.some(p => {
                const pClean = p.id.split(':')[0];
                return pClean === cleanTarget && (p.admin === 'admin' || p.admin === 'superadmin');
            });
        };

        const isBotAdmin = checkAdmin(sock.user?.id);
        const isSenderAdmin = checkAdmin(senderId);

        if (!isBotAdmin) {
            await sock.sendMessage(chatId, { text: '❌ Make the bot an admin first.' }, { quoted: msg });
            return null;
        }

        if (!isSenderAdmin) {
            await sock.sendMessage(chatId, { text: '❌ Only group admins can use .tagnotadmin' }, { quoted: msg });
            return null;
        }

        // Filter out admins and group owner
        const nonAdmins = participants.filter(p => !p.admin).map(p => p.id);
        
        if (nonAdmins.length === 0) {
            await sock.sendMessage(chatId, { text: '✅ No non-admin members to tag.' }, { quoted: msg });
            return null;
        }

        let text = '📢 *Attention Non-Admins:*\n\n';
        nonAdmins.forEach(jid => {
            text += `@${jid.split('@')[0]}\n`;
        });

        await sock.sendMessage(chatId, { 
            text, 
            mentions: nonAdmins 
        }, { quoted: msg });

    } catch (error) {
        console.error('[tagnotadmin] Error:', error.message);
        await sock.sendMessage(chatId, { text: '⚠️ Failed to tag non-admin members.' }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'tagnotadmin',
    aliases: ['tagna', 'tagmembers'],
    desc: 'Tag all non-admin members in the group',
    category: 'group',
    execute
};