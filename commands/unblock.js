/**
 * unblock.js — Unblock a user on WhatsApp
 * Aliases: .unblock
 * Usage: .unblock @user OR .unblock 923xxxxxxxxx
 * Category: owner
 */

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    // ── Find target ──────────────────────────────────────────────────────────
    let target = null;

    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const mentioned = ctx?.mentionedJid || [];

    if (mentioned.length > 0) {
        target = mentioned[0];
    } else if (args[0]) {
        const num = args[0].replace(/[^0-9]/g, '');
        if (num.length >= 10) {
            target = num + '@s.whatsapp.net';
        }
    }

    if (!target) {
        return `❌ *Usage: .unblock @user*

_Or: .unblock 923xxxxxxxxx_`;
    }

    // ── Unblock ──────────────────────────────────────────────────────────────
    try {
        await sock.updateBlockStatus(target, 'unblock');

        const num = target.split('@')[0];
        return `✅ *@${num}* has been *unblocked*.`;
    } catch (err) {
        return `❌ Failed to unblock: ${err.message}`;
    }
}

module.exports = {
    name:     'unblock',
    aliases:  [],
    desc:     'Unblock a user on WhatsApp',
    category: 'owner',
    execute,
};