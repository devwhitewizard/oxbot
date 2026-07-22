/**
 * getnewsletter.js — Get WhatsApp Channel (Newsletter) JID
 * Aliases: .getnewsletter, .getchannel
 * 
 * Use this command inside a WhatsApp Channel to get its exact ID (JID).
 */

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    const sender = msg.key.participant || chatId;
    const isNewsletter = chatId?.endsWith('@newsletter');

    // 1. Check if the command was sent inside a WhatsApp Channel
    if (isNewsletter) {
        await sock.sendMessage(chatId, {
            text: `✅ *WhatsApp Channel Detected!*\n\n` +
                  `Here is the Channel JID:\n` +
                  `> \`${chatId}\`\n\n` +
                  `_Copy this JID and use it in your .setnewsletter command._`
        }, { quoted: msg });
        return;
    }

    // 2. Fallback: Check if they are replying to a forwarded channel message in a group
    const quotedMsgContext = msg.message?.extendedTextMessage?.contextInfo;
    if (quotedMsgContext) {
        const remoteJid = quotedMsgContext.remoteJid;
        if (remoteJid?.endsWith('@newsletter')) {
            await sock.sendMessage(chatId, {
                text: `✅ *Forwarded Channel Detected!*\n\n` +
                      `Here is the Channel JID:\n` +
                      `> \`${remoteJid}\`\n\n` +
                      `_Copy this JID and use it in your .setnewsletter command._`
            }, { quoted: msg });
            return;
        }
    }

    // 3. If it's just a normal group or DM
    await sock.sendMessage(chatId, {
        text: `⚠️ This is not a WhatsApp Channel!\n\n` +
              `To get a Channel's JID:\n` +
              `1. Go to the specific WhatsApp Channel.\n` +
              `2. Type \`.getchannel\` directly in that channel.\n` +
              `3. The bot will reply with the ID.`
    }, { quoted: msg });
}

module.exports = {
    name:     'getnewsletter',
    aliases:  ['getchannel', 'channeljid'],
    desc:     'Get the JID of a WhatsApp Channel (Newsletter)',
    category: 'tools',
    execute,
};