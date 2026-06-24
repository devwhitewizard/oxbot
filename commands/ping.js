/**
 * commands/ping.js
 * Per-user ping, real session uptime, and version
 */

const version = '2.0.0';
const { activeBots } = require('../oxbot/state'); // Pull real connection state

function formatTime(ms) {
    let seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / (24 * 60 * 60));
    seconds = seconds % (24 * 60 * 60);
    const hours = Math.floor(seconds / (60 * 60));
    seconds = seconds % (60 * 60);
    const minutes = Math.floor(seconds / 60);
    seconds = seconds % 60;
    let time = '';
    if (days > 0)    time += `${days}d `;
    if (hours > 0)   time += `${hours}h `;
    if (minutes > 0) time += `${minutes}m `;
    if (seconds > 0 || time === '') time += `${seconds}s`;
    return time.trim();
}

async function execute(sock, msg, botData, args) {
    try {
        const chatId = msg.key.remoteJid;
        if (!chatId) return null;

        // ── Calculate Ping Speed ──────────────────────────────────────────────
        const start = Date.now();
        await sock.sendMessage(chatId, { text: 'Pong!' }, { quoted: msg });
        const end  = Date.now();
        const ping = Math.round((end - start) / 2);

        // ── Determine Color & Status ──────────────────────────────────────────
        let pingIcon, pingStatus;
        if (ping < 500) {
            pingIcon = '🟢';
            pingStatus = 'Excellent';
        } else if (ping <= 1500) {
            pingIcon = '🟡';
            pingStatus = 'Normal';
        } else {
            pingIcon = '🔴';
            pingStatus = 'Slow / Lagging';
        }

        // ── Get REAL Session Uptime ───────────────────────────────────────────
        const sessionId = botData?.sessionId;
        let sessionUptimeMs = 0;

        if (sessionId && activeBots.has(sessionId)) {
            // ★ FIX: openedAt is in SECONDS in state.js, so multiply by 1000
            const realConnectTimeSec = activeBots.get(sessionId).openedAt;
            if (realConnectTimeSec && realConnectTimeSec > 0) {
                sessionUptimeMs = Date.now() - (realConnectTimeSec * 1000);
            }
        }

        // Fallback to server uptime if bot state is missing
        if (sessionUptimeMs <= 0) {
            sessionUptimeMs = process.uptime() * 1000;
        }

        const botInfo = `
 ${pingIcon} *Ping Status: ${pingStatus}*

⚡ *Speed:* ${ping} ms
⏱️ *Session Uptime:* ${formatTime(sessionUptimeMs)}
🔖 *Version:* v${version}
        `.trim();

        await sock.sendMessage(chatId, { text: botInfo }, { quoted: msg });
        
        return null;
    } catch (error) {
        console.error('Error in ping command:', error.message);
        return '❌ Failed to get bot status.';
    }
}

module.exports = {
    name: 'ping',
    desc: 'Check bot speed and uptime',
    execute: execute
};