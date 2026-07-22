/**
 * commands/jid.js
 * Get the JID of a group or a replied user
 */

const name     = 'jid';
const desc     = 'Get group or user JID';
const category = 'general';
const aliases  = ['getjid', 'id'];

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    // 1. If replying to a message, get the quoted user's JID
    const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant;
    
    // Also check for multiple mentions
    const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

    if (quotedParticipant || mentionedJids.length > 0) {
        // Combine and remove duplicates
        const uniqueJids = [...new Set([quotedParticipant, ...mentionedJids].filter(Boolean))];
        
        let text = `👤 *User JID(s):*\n\n`;
        uniqueJids.forEach(jid => {
            text += `▸ \`\`\`${jid}\`\`\`\n`;
        });

        return await sock.sendMessage(chatId, {
            text: text.trim()
        }, { quoted: msg });
    }

    // 2. If in a group, send the Group JID
    if (chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, {
            text: `👥 *Group JID:*\n\n\`\`\`${chatId}\`\`\``
        }, { quoted: msg });
    }

    // 3. If in a DM, send the User's JID
    return await sock.sendMessage(chatId, {
        text: `👤 *User JID:*\n\n\`\`\`${chatId}\`\`\``
    }, { quoted: msg });
}

module.exports = { name, desc, category, aliases, execute };