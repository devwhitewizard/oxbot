/**
 * commands/uptime.js
 * Shows server uptime, RAM, user plan, and website link
 */

function formatUptime(totalSeconds) {
    const days = Math.floor(totalSeconds / (24 * 60 * 60));
    totalSeconds = totalSeconds % (24 * 60 * 60);
    
    const hours = Math.floor(totalSeconds / (60 * 60));
    totalSeconds = totalSeconds % (60 * 60);
    
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);

    let time = '';
    if (days > 0) time += `${days} day${days !== 1 ? 's' : ''}, `;
    if (hours > 0) time += `${hours} hour${hours !== 1 ? 's' : ''}, `;
    if (minutes > 0) time += `${minutes} minute${minutes !== 1 ? 's' : ''}, `;
    time += `${seconds} second${seconds !== 1 ? 's' : ''}`;
    
    return time;
}

function getRAM() {
    const used  = process.memoryUsage().heapUsed / 1024 / 1024;
    const total = process.memoryUsage().rss / 1024 / 1024;
    return `${used.toFixed(1)}MB / ${total.toFixed(1)}MB`;
}

async function execute(sock, msg, botData, args) {
    try {
        const chatId    = msg.key.remoteJid;
        if (!chatId) return null;

        const db        = botData?.db;
        const sessionId = botData?.sessionId;

        // ── Get User's Plan Name from DB ──────────────────────────────────────
        let planLabel = '🆓 Free Trial';
        try {
            if (db && sessionId) {
                let userId = null;
                const [r1] = await db.query('SELECT user_id FROM bots WHERE session_id=? LIMIT 1', [sessionId]);
                if (r1.length) {
                    userId = r1[0].user_id;
                } else if (!String(sessionId).startsWith('oxbot_')) {
                    const [r2] = await db.query('SELECT user_id FROM bots WHERE session_id=? LIMIT 1', [`oxbot_${sessionId}`]);
                    if (r2.length) userId = r2[0].user_id;
                }

                if (userId) {
                    const [proRows] = await db.query(
                        `SELECT plan FROM pro_subscriptions 
                         WHERE user_id=? AND status='active' AND expires_at > NOW() LIMIT 1`,
                        [userId]
                    );
                    if (proRows.length > 0) {
                        if (proRows[0].plan === 'full') planLabel = '👑 Best Value (Pro)';
                        else if (proRows[0].plan === 'half') planLabel = '⭐ Starter (Pro)';
                    }
                }
            }
        } catch (err) {}

        // ── Get Stats ─────────────────────────────────────────────────────────
        const uptimeString = formatUptime(process.uptime());
        const ramString = getRAM();

        const text = `
🟢 *OxBot Server Status*

⏱️ *Uptime:*
   ${uptimeString}

🧠 *RAM Usage:*
   ${ramString}

📦 *Your Plan:*
   ${planLabel}

━━━━━━━━━━━━━━━━━━━━

🔗 *Website:* https://oxbot.name.ng
👤 *Developer:* oxdominion.eth
        `.trim();

        await sock.sendMessage(chatId, { text }, { quoted: msg });
        
        return null;
        
    } catch (error) {
        console.error('Error in uptime command:', error.message);
        return '❌ Failed to get server status.';
    }
}

module.exports = {
    name: 'uptime',
    desc: 'Check server uptime, RAM, and your plan',
    category: 'general',
    execute: execute
};