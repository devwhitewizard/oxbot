/**
 * commands/owner.js
 * Sends bot owner's contact card (vCard)
 */

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    try {
        // Get owner number from the current active socket session
        const ownerJid = sock.user?.id;
        if (!ownerJid) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Could not retrieve owner information.*'
            }, { quoted: msg });
        }

        const ownerNum = ownerJid.split(':')[0];
        // Use WhatsApp registered name, fallback to oxdominion.eth
        const ownerName = sock.user?.name || sock.user?.verifiedName || 'oxdominion.eth';

        // Format the vCard
        const vcard = `BEGIN:VCARD
VERSION:3.0
FN:${ownerName}
TEL;waid=${ownerNum}:${ownerNum}
END:VCARD`.trim();

        // Send the contact card
        await sock.sendMessage(chatId, {
            contacts: {
                displayName: ownerName,
                contacts: [{ vcard }]
            }
        }, { quoted: msg });

        // Send follow-up text
        await sock.sendMessage(chatId, {
            text: '👑 Here is the contact of my *Owner*.'
        }, { quoted: msg });

    } catch (err) {
        console.error('[OWNER] Error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ *Failed to fetch owner contact.*'
        }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'owner',
    aliases: ['creator', 'dev', 'botowner'],
    desc: 'Show bot owner contact information',
    category: 'general',
    execute
};