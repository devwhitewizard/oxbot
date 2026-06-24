/**
 * commands/tagall.js
 * Tag all members in a group (Available to everyone)
 */

const name     = 'tagall';
const desc     = 'Tag all members in a group';
const category = 'group';

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ Group only!' }, { quoted: msg });
    }

    try {
        // Fetch group metadata
        const meta = await sock.groupMetadata(chatId);
        const participants = meta.participants || [];
        
        if (participants.length === 0) {
            return await sock.sendMessage(chatId, { text: '❌ Could not find any members in this group.' }, { quoted: msg });
        }

        const customMsg = args.join(' ').trim() || 'Attention everyone!';
        const senderNum = (msg.key.participant || msg.key.remoteJid).split('@')[0];

        // ═══════════════════════════════════════
        // ★ BUILD CLEAN FORMATTED TEXT ★
        // ═══════════════════════════════════════
        let text = `╭━━━【 *${customMsg}* 】━━━╮\n`;
        text += `│ 👥 *Total Members: ${participants.length}*\n`;
        text += `│ 📢 *By: @${senderNum}*\n`;
        text += `│\n`;
        
        participants.forEach(p => {
            text += `│ ➤ @${p.id.split('@')[0]}\n`;
        });
        
        text += `╰━━━━━━━━━━━━━━━━━━━━━━━━╯`;

        // Get exact JIDs for mentions (Baileys handles @lid automatically)
        const mentions = participants.map(p => p.id);

        await sock.sendMessage(chatId, {
            text,
            mentions
        }, { quoted: msg });

    } catch (error) {
        console.error('[TAGALL] Error:', error.message);
        await sock.sendMessage(chatId, { text: '❌ Failed to fetch group members.' }, { quoted: msg });
    }

    return null;
}

module.exports = { name, desc, category, execute };
