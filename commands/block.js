/**
 * block.js — Block a user on WhatsApp
 * Aliases: .block
 * Usage: .block @user OR reply to a message
 * Category: owner
 */

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    // ── Find target user ────────────────────────────────────────────────────
    let target = null;

    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const mentioned = ctx?.mentionedJid || [];

    if (mentioned.length > 0) {
        target = mentioned[0];
    } else if (ctx?.participant) {
        // Replying to someone's message
        target = ctx.participant;
    } else if (args[0]) {
        // Maybe they typed a number
        const num = args[0].replace(/[^0-9]/g, '');
        if (num.length >= 10) {
            target = num + '@s.whatsapp.net';
        }
    }

    if (!target) {
        return `❌ *Usage: .block @user*

_Mention someone or reply to their message._`;
    }

    // ── Can't block yourself ────────────────────────────────────────────────
    const myJid = sock.user?.id;
    if (target === myJid) {
        return '❌ You cannot block yourself.';
    }

    // ── Block ────────────────────────────────────────────────────────────────
    try {
        await sock.updateBlockStatus(target, 'block');

        const num = target.split('@')[0];
        return `✅ *@${num}* has been *blocked*.`;
    } catch (err) {
        return `❌ Failed to block: ${err.message}`;
    }
}

module.exports = {
    name:     'block',
    aliases:  [],
    desc:     'Block a user on WhatsApp',
    category: 'owner',
    execute,
};