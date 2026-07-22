/**
 * uptime.js — Bot Status
 * Aliases: .uptime, .runtime, .botuptime, .alive
 */

function formatTime(ms) {
    if (ms <= 0) return '0s';
    let seconds = Math.floor(ms / 1000);
    const days    = Math.floor(seconds / 86400);
    seconds %= 86400;
    const hours   = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    seconds %= 60;

    const parts = [];
    if (days > 0)    parts.push(`${days}d`);
    if (hours > 0)   parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);
    return parts.join(' ') || '0s';
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const sessionMs = Date.now() - (sock._connectedAt || Date.now());
    const serverMs = process.uptime() * 1000;

    let devName = 'oxdominion.eth';
    let siteName = 'oxbot.name.ng';
    let siteUrl = 'https://oxbot.name.ng';

    try {
        const cfg = require('./../config');
        if (cfg.developerName) devName = cfg.developerName;
        if (cfg.siteName)    siteName = cfg.siteName;
        if (cfg.siteUrl)     siteUrl = cfg.siteUrl;
    } catch {}

    const botName = botData?.botName || 'OxBot';

    return (
        `*Bot Status*\n\n` +
        `🤖 *Name:* ${botName}\n` +
        `⏱️ *Session:* ${formatTime(sessionMs)}\n` +
        `🖥️ *Server:* ${formatTime(serverMs)}\n` +
        `👤 *Developer:* ${devName}\n` +
        `🔗 *Site:* ${siteUrl}`
    );
}

module.exports = {
    name:     'uptime',
    aliases:  ['runtime', 'botuptime', 'alive'],
    desc:     'Check bot status, uptime, and info',
    category: 'general',
    execute,
};