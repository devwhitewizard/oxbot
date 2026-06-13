async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    // By default, get the sender's own PP
    let targetJid = msg.key.participant || msg.key.remoteJid;

    // If the user replied to someone or tagged someone, get THEIR PP instead
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    if (contextInfo) {
        if (contextInfo.participant) {
            targetJid = contextInfo.participant;
        } else if (contextInfo.mentionedJid && contextInfo.mentionedJid.length > 0) {
            targetJid = contextInfo.mentionedJid[0];
        }
    }

    try {
        // Fetch the profile picture URL from WhatsApp
        const ppUrl = await sock.profilePictureUrl(targetJid, 'image');

        if (!ppUrl) {
            await sock.sendMessage(chatId, {
                text: '❌ No profile picture found. This user might have it hidden or removed.'
            }, { quoted: msg });
            return null;
        }

        const senderName = targetJid.split('@')[0];

        // Send the profile picture
        await sock.sendMessage(chatId, {
            image: { url: ppUrl },
            caption: `📷 *Profile Picture*\n\n@${senderName}`,
            mentions: [targetJid]
        }, { quoted: msg });

    } catch (error) {
        console.error('[circle] Error:', error.message);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to fetch profile picture. They might have it hidden from everyone.'
        }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'circle',
    aliases: ['pp', 'pfp', 'profilepic', 'getpp'],
    desc: 'Get user profile picture (reply to user or tag them)',
    category: 'general',
    execute
};