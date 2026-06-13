/**
 * commands/alive.js
 * Check if bot is running
 */

const version = '2.0.0';
const channelLink = 'https://whatsapp.com/channel/0029VaZJW9qLikl6KhJPcs2B';

async function execute(sock, msg, botData, args) {
    try {
        const chatId = msg.key.remoteJid;
        if (!chatId) return null;

        // Get owner number for button
        let ownerNumber = '';
        try {
            const db = botData?.db;
            const sessionId = botData?.sessionId;
            if (db && sessionId) {
                const [rows] = await db.query(
                    'SELECT u.phone FROM users u JOIN bots b ON b.user_id = u.id WHERE b.session_id = ? LIMIT 1',
                    [sessionId]
                );
                if (rows.length && rows[0].phone) {
                    ownerNumber = String(rows[0].phone).replace(/\D/g, '');
                }
            }
        } catch {}

        // Using urlButton so WhatsApp opens the link DIRECTLY (no handler needed)
        const templateButtons = [
            {
                urlButton: {
                    displayText: '📌 View Channel',
                    url: channelLink
                }
            },
            {
                urlButton: {
                    displayText: '👑 Owner',
                    url: `https://wa.me/${ownerNumber || '2348000000000'}`
                }
            }
        ];

        await sock.sendMessage(chatId, {
            text: `┏━━━━━━━━━━━━━━━━━━━━━┓
┃   🤖 *OxBot Is Alive*   ┃
┗━━━━━━━━━━━━━━━━━━━━━┛

┌──────────────────────┐
│ ✅ Status   : *Online* │
│ 📦 Version  : *v${version}* │
└──────────────────────┘

💡 Type *.menu* for all commands`,
            footer: '🤖 OxBot',
            templateButtons: templateButtons
        }, { quoted: msg });

        return null;
    } catch (error) {
        console.error('Error in alive command:', error.message);
        return '❌ Failed.';
    }
}

module.exports = {
    name: 'alive',
    desc: 'Check if bot is online',
    category: 'general',
    execute: execute
};