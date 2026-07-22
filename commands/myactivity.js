/**
 * myactivity.js — User Activity Stats (Group & DM)
 * Adapted for OxBot standard structure
 */

// Safe require for stats tracker (prevents crash if file path changes)
let getStats = null;
try {
    // If your file is in commands/general/, change to: require('./groupstats')
    // If your file is in a utils folder, change to: require('../utils/groupstats')
    const statsModule = require('./groupstats'); 
    if (typeof statsModule.getStats === 'function') {
        getStats = statsModule.getStats;
    }
} catch (e) {
    console.log('[myactivity] groupstats.js not found, stats tracking disabled.');
}

async function execute(sock, msg, botData, args) {
    try {
        const chatId = msg.key.remoteJid;
        if (!chatId) return;

        // Works for both groups (participant) and DMs (remoteJid)
        const sender = msg.key.participant || msg.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');

        // Fetch stats safely
        let stats = null;
        if (getStats) {
            try {
                stats = getStats(chatId);
            } catch (err) {
                console.error('[myactivity] Error fetching stats:', err.message);
            }
        }

        // If no stats found or user hasn't spoken
        if (!stats || !stats.users || !stats.users[sender]) {
            return await sock.sendMessage(chatId, {
                text: `📊 You haven't sent any messages ${isGroup ? 'in this group' : 'to me'} today yet!`
            }, { quoted: msg });
        }

        const userCount = stats.users[sender];
        const totalMessages = stats.total || 1; // Prevent divide by zero
        const percentage = ((userCount / totalMessages) * 100).toFixed(1);

        let text = `📊 *Your Activity Today*\n\n`;
        text += `👤 *User:* @${sender.split('@')[0]}\n`;
        text += `📝 *Messages Sent:* ${userCount}\n`;
        text += `📈 *Your Share:* ${percentage}%\n`;

        // Only show rank in group chats (rank in DMs is useless)
        if (isGroup) {
            const sortedUsers = Object.entries(stats.users)
                .sort((a, b) => b[1] - a[1]);
            
            const rank = sortedUsers.findIndex(([id]) => id === sender) + 1;
            text += `🏆 *Rank:* #${rank} of ${sortedUsers.length}\n`;
        }

        text += `\nKeep chatting! 💬`;

        await sock.sendMessage(chatId, {
            text: text.trim(),
            mentions: [sender] // Tags the user in the message
        }, { quoted: msg });

    } catch (err) {
        console.error('[myactivity cmd] error:', err);
        await sock.sendMessage(msg.key.remoteJid, {
            text: '❌ Error loading your activity stats.'
        }, { quoted: msg });
    }
}

module.exports = {
    name: 'myactivity',
    aliases: ['mystats', 'mymsgs', 'rank'],
    desc: 'Check your activity stats for today',
    category: 'general',
    execute
};