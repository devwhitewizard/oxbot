/**
 * commands/setnewsletter.js
 * Set or change the newsletter JID for menu forwarding (Owner Only)
 */

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    let newsletterJid = '';

    try {
        // Priority 1: If command is typed directly inside a newsletter chat
        if (chatId.endsWith('@newsletter')) {
            newsletterJid = chatId;
        }
        // Priority 2: Replying to a forwarded newsletter message
        else if (msg.message?.extendedTextMessage?.contextInfo) {
            const contextInfo = msg.message.extendedTextMessage.contextInfo;
            
            // Deep search the message context for any @newsletter string
            const findNewsletterJid = (obj, depth = 0) => {
                if (depth > 5 || !obj || typeof obj !== 'object') return null;
                for (const key in obj) {
                    const value = obj[key];
                    if (typeof value === 'string' && value.endsWith('@newsletter')) return value;
                    if (typeof value === 'object' && value !== null) {
                        const found = findNewsletterJid(value, depth + 1);
                        if (found) return found;
                    }
                }
                return null;
            };
            
            newsletterJid = findNewsletterJid(contextInfo);
        }
        
        // Priority 3: Provided manually as an argument
        if (!newsletterJid && args[0]) {
            newsletterJid = args[0].trim();
        }

        // If no JID found, show current status and usage
        if (!newsletterJid) {
            const currentJid = sock._newsletterJid || '120363421280626994@newsletter';
            return await sock.sendMessage(chatId, {
                text: `📰 *Newsletter Configuration*\n\n` +
                      `Current JID: \`${currentJid}\`\n\n` +
                      `*Usage:*\n` +
                      `• Reply to a newsletter msg: \`.setnewsletter\`\n` +
                      `• Type inside newsletter: \`.setnewsletter\`\n` +
                      `• Manual JID: \`.setnewsletter 123@newsletter\``
            }, { quoted: msg });
        }

        // Validate format
        if (!newsletterJid.endsWith('@newsletter')) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Invalid JID format!*\n\nNewsletter JID must end with `@newsletter`\nExample: `120363161513685998@newsletter`'
            }, { quoted: msg });
        }

        // ── Save to Database ───────────────────────────────────────────────
        const db = botData?.db;
        const sessionId = botData?.sessionId;
        
        if (db && sessionId) {
            try {
                await db.query(
                    `INSERT INTO bot_settings (session_id, newsletter_jid) VALUES (?, ?) 
                     ON DUPLICATE KEY UPDATE newsletter_jid = ?`,
                    [sessionId, newsletterJid, newsletterJid]
                );
            } catch (err) {
                console.error('[SETNEWSLETTER] DB Error:', err.message);
            }
        }

        // ── Cache on socket for instant use (no DB reads needed) ───────────
        sock._newsletterJid = newsletterJid;

        await sock.sendMessage(chatId, {
            text: `✅ *Newsletter Updated Successfully!*\n\n` +
                  `📰 JID: \`${newsletterJid}\`\n\n` +
                  `The menu will now forward from this newsletter.`
        }, { quoted: msg });

    } catch (err) {
        console.error('[SETNEWSLETTER] Error:', err.message);
        await sock.sendMessage(chatId, {
            text: `❌ Failed to set newsletter: ${err.message}`
        }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'setnewsletter',
    aliases: ['setnl', 'setchannel'],
    desc: 'Set the newsletter JID for menu forwarding',
    category: 'owner',
    execute
};