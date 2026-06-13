const fs = require('fs');
const { channelInfo } = require('../lib/messageConfig');
const isAdmin = require('../lib/isAdmin');
const { isSudo } = require('../lib/index');

const BAN_FILE = './data/banned.json';

function getBanned() {
    if (!fs.existsSync(BAN_FILE)) fs.writeFileSync(BAN_FILE, '[]');
    return JSON.parse(fs.readFileSync(BAN_FILE));
}

function saveBanned(list) {
    fs.writeFileSync(BAN_FILE, JSON.stringify(list, null, 2));
}

async function banCommand(sock, chatId, message) {
    const senderId = message.key.participant || message.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');

    // Permission check
    if (isGroup) {
        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
        if (!isBotAdmin) return sock.sendMessage(chatId, { text: 'Bot must be admin to use .ban', ...channelInfo }, { quoted: message });
        if (!isSenderAdmin && !message.key.fromMe) return sock.sendMessage(chatId, { text: 'Only admins can use .ban', ...channelInfo }, { quoted: message });
    } else {
        if (!message.key.fromMe && !await isSudo(senderId)) {
            return sock.sendMessage(chatId, { text: 'Only owner can use .ban in private chat', ...channelInfo }, { quoted: message });
        }
    }

    // Get target user
    const ctx = message.message?.extendedTextMessage?.contextInfo;
    const userToBan = ctx?.mentionedJid?.[0] || ctx?.participant;

    if (!userToBan) {
        return sock.sendMessage(chatId, { text: 'Mention or reply to a user to ban', ...channelInfo }, { quoted: message });
    }

    // Don't ban bot
    const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    if (userToBan === botId) {
        return sock.sendMessage(chatId, { text: 'Cannot ban the bot', ...channelInfo }, { quoted: message });
    }

    // Ban logic
    try {
        const banned = getBanned();

        if (banned.includes(userToBan)) {
            return sock.sendMessage(chatId, { text: `@${userToBan.split('@')[0]} is already banned`, mentions: [userToBan], ...channelInfo }, { quoted: message });
        }

        banned.push(userToBan);
        saveBanned(banned);

        await sock.sendMessage(chatId, { text: `Banned @${userToBan.split('@')[0]} successfully`, mentions: [userToBan], ...channelInfo }, { quoted: message });
    } catch (err) {
        console.error('Ban error:', err);
        sock.sendMessage(chatId, { text: 'Failed to ban user', ...channelInfo }, { quoted: message });
    }
}

module.exports = banCommand;