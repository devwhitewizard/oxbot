/**
 * ping.js — Per-session ping, real uptime, speed test
 * Aliases: .ping, .p
 * 
 * Shows THIS user's WhatsApp session uptime, not server uptime.
 * Uses message edit (like KnightBot) for cleaner UX.
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

    let parts = [];
    if (days > 0)    parts.push(days + 'd');
    if (hours > 0)   parts.push(hours + 'h');
    if (minutes > 0) parts.push(minutes + 'm');
    if (seconds > 0) parts.push(seconds + 's');
    return parts.join(' ') || '0s';
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    try {
        // ── Step 1: Send "Pinging..." message ─────────────────────────────────
        const start = Date.now();
        const sent = await sock.sendMessage(chatId, {
            text: '🏓 *Pinging...*'
        }, { quoted: msg });

        // ── Step 2: Calculate ping (time to send + process) ──────────────────
        const end = Date.now();
        const ping = end - start;

        // ── Step 3: Get THIS session's uptime ──────────────────────────────────
        // sock._connectedAt was set in handler.js initSocket()
        // This is unique per user — NOT process.uptime() (server time)
        const connectedAt = sock._connectedAt || Date.now();
        const sessionUptime = Date.now() - connectedAt;

        // ── Step 4: Ping rating ───────────────────────────────────────────────
        let icon, status;
        if (ping < 400) {
            icon = '🟢'; status = 'Excellent';
        } else if (ping < 1000) {
            icon = '🟡'; status = 'Normal';
        } else if (ping < 2500) {
            icon = '🟠'; status = 'Slow';
        } else {
            icon = '🔴'; status = 'Lagging';
        }

        // ── Step 5: Edit the "Pinging..." message with results ─────────────────
        // KnightBot does this — much cleaner than sending 2 separate messages
        const result = (
            `${icon} *Pong!*\n\n` +
            `⚡ *Speed:* ${ping}ms _(${status})_\n` +
            `⏱️ *Session Uptime:* ${formatTime(sessionUptime)}\n` +
            `🤖 *Bot:* ${botData?.botName || 'OxBot'}`
        );

        await sock.sendMessage(chatId, {
            text: result,
            edit: sent.key,
        });

        return null;

    } catch (err) {
        console.error('[ping] Error:', err.message);

        // If edit failed (some WhatsApp versions don't support it),
        // send as a new message instead
        try {
            return `🏓 *Pong!*\n\n⚡ Speed: _error_\n⏱️ Uptime: ${formatTime((sock._connectedAt ? Date.now() - sock._connectedAt : 0))}`;
        } catch {
            return '❌ Failed to ping.';
        }
    }
}

module.exports = {
    name:     'ping',
    aliases:  ['p'],
    desc:     'Check bot speed and session uptime',
    category: 'general',
    execute,
};