/**
 * commands/devicename.js
 * Shows the REAL device data WhatsApp allows us to see
 */

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    // Real device data is only available in group metadata
    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, {
            text: '❌ Device detection only works in groups.'
        }, { quoted: msg });
    }

    // Get target user (Reply, Tag, or Self)
    let targetJid = msg.key.participant || msg.key.remoteJid;
    const ctx = msg.message?.extendedTextMessage?.contextInfo;

    if (ctx?.participant) {
        targetJid = ctx.participant;
    } else if (ctx?.mentionedJid?.length > 0) {
        targetJid = ctx.mentionedJid[0];
    }

    try {
        // Fetch real group metadata from WhatsApp servers
        const metadata = await sock.groupMetadata(chatId);
        const participant = metadata.participants?.find(p => p.id === targetJid);

        if (!participant) {
            return await sock.sendMessage(chatId, {
                text: '❌ User not found.'
            }, { quoted: msg });
        }

        const cleanNum = targetJid.split('@')[0];
        
        // This is the REAL data WhatsApp gives us. Nothing more, nothing less.
        const rawDevice = participant.device || 'unknown';

        // Map the real raw codes to readable OS names
        const realOsNames = {
            'android': '📱 Android',
            'ios': '🍎 iOS (iPhone/iPad)',
            'business_android': '💼 Android (WhatsApp Business)',
            'business_ios': '💼 iOS (WhatsApp Business)',
            'web': '💻 Web Browser (PC)',
            'desktop': '🖥️ Desktop App',
            'unknown': '❓ Hidden/Unknown Device'
        };

        const realName = realOsNames[rawDevice] || `🔧 Unrecognized (${rawDevice})`;

        const text = `📱 *Real Device Data*\n\n` +
                     `👤 *@${cleanNum}*\n` +
                     `🖥️ *Platform:* ${realName}\n\n` +
                     `⚠️ _Note: This is the real data provided by WhatsApp. Exact phone models (e.g., Samsung S24) are strictly blocked by WhatsApp servers for privacy and cannot be scanned by any bot._`;

        await sock.sendMessage(chatId, {
            text: text,
            mentions: [targetJid]
        }, { quoted: msg });

    } catch (err) {
        console.error('[devicename] Error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to fetch device info.'
        }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'devicename',
    aliases: ['device', 'os', 'platform'],
    desc: 'Check the real OS platform a user is on',
    category: 'general',
    execute
};