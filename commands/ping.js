/**
 * commands/ping.js
 * Shows bot ping, uptime, and version
 */

const version = '2.0.0';

function formatTime(seconds) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    seconds = seconds % (24 * 60 * 60);
    const hours = Math.floor(seconds / (60 * 60));
    seconds = seconds % (60 * 60);
    const minutes = Math.floor(seconds / 60);
    seconds = Math.floor(seconds % 60);
    let time = '';
    if (days > 0)    time += `${days}d `;
    if (hours > 0)   time += `${hours}h `;
    if (minutes > 0) time += `${minutes}m `;
    if (seconds > 0 || time === '') time += `${seconds}s`;
    return time.trim();
}

// This MUST match the signature: execute(sock, msg, botData, args)
async function execute(sock, msg, botData, args) {
    try {
        // Extract chatId from msg (not passed separately)
        const chatId = msg.key.remoteJid;
        if (!chatId) return '❌ Cannot determine chat.';

        const start = Date.now();
        await sock.sendMessage(chatId, { text: 'Pong!' }, { quoted: msg });
        const end  = Date.now();
        const ping = Math.round((end - start) / 2);

        const botInfo = `
┏━━〔 🤖 𝐎𝐱𝐁𝐨𝐭 〕━━┓
┃ 🚀 Ping     : ${ping} ms
┃ ⏱️ Uptime   : ${formatTime(process.uptime())}
┃ 🔖 Version  : v${version}
┃ 👤 By       : oxdominion.eth
┗━━━━━━━━━━━━━━━━━━━┛`.trim();

        await sock.sendMessage(chatId, { text: botInfo }, { quoted: msg });
        
        return null; // Already sent, no need to return text
    } catch (error) {
        console.error('Error in ping command:', error);
        return '❌ Failed to get bot status.';
    }
}

// Export in the format expected by commands/index.js
module.exports = {
    name: 'ping',
    desc: 'Check bot speed and uptime',
    execute: execute
};