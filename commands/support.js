/**
 * commands/support.js
 * Creates a support ticket directly from WhatsApp (OWNER ONLY)
 */

// Replicates the exact ticket number generator used in routes/tickets.js
function generateTicketNumber() {
    const prefix = 'TKT';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
}

// Robust session lookup
async function getOwnerUserId(db, sessionId) {
    if (!db || !sessionId) return null;
    try {
        const [r1] = await db.query('SELECT user_id FROM bots WHERE session_id=? LIMIT 1', [sessionId]);
        if (r1.length) return r1[0].user_id;
        
        if (!String(sessionId).startsWith('oxbot_')) {
            const [r2] = await db.query('SELECT user_id FROM bots WHERE session_id=? LIMIT 1', [`oxbot_${sessionId}`]);
            if (r2.length) return r2[0].user_id;
        }
        return null;
    } catch { return null; }
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const db = botData?.db;
    const sessionId = botData?.sessionId;

    if (!db || !sessionId) {
        return await sock.sendMessage(chatId, { text: '❌ Database error.' }, { quoted: msg });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ★ STRICT OWNER VERIFICATION ★
    // Uses index.js logic to ensure ONLY the person who paired the bot can use this
    // ══════════════════════════════════════════════════════════════════════════
    const sender = msg.key.participant || msg.key.remoteJid;
    const ownerPhone = sock._ownerPhone || (sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : null);
    
    if (!ownerPhone) {
        return await sock.sendMessage(chatId, { text: '❌ Cannot verify owner identity.' }, { quoted: msg });
    }

    // Clean numbers to compare safely (removes +, @s.whatsapp.net, etc.)
    const senderClean = String(sender).replace(/[^0-9]/g, '');
    const ownerClean  = String(ownerPhone).replace(/[^0-9]/g, '');
    
    // Handle local 080... vs international 23480... formats
    const senderNorm = senderClean.startsWith('0') ? senderClean.slice(1) : senderClean;
    const ownerNorm  = ownerClean.startsWith('0') ? ownerClean.slice(1) : ownerClean;

    // Exact match or partial match (handles LID and number length differences)
    const isOwner = (
        senderNorm === ownerNorm || 
        senderNorm.endsWith(ownerNorm) || 
        ownerNorm.endsWith(senderNorm)
    );

    if (!isOwner && !msg.key.fromMe) {
        return await sock.sendMessage(chatId, {
            text: '🔒 *Owner Only!*\n\n_This command is restricted to the bot owner._'
        }, { quoted: msg });
    }

    // ── Message Validation ────────────────────────────────────────────────────
    const userMessage = args.join(' ').trim();

    if (!userMessage || userMessage.length < 10) {
        return await sock.sendMessage(chatId, {
            text: `❌ *Message too short!*\n\nPlease describe your issue in detail (at least 10 characters).\n\n*Usage:*\n.support My bot is not connecting to the server`
        }, { quoted: msg });
    }

    await sock.sendMessage(chatId, { text: '⏳ *Creating support ticket...*' }, { quoted: msg });

    try {
        // ── Get User ID ───────────────────────────────────────────────────────
        const userId = await getOwnerUserId(db, sessionId);
        if (!userId) {
            return await sock.sendMessage(chatId, { text: '❌ Could not find your account in the database.' }, { quoted: msg });
        }

        // Uses 'owner_request' category so you know it's from the actual owner via WA
        const category = 'owner_request'; 
        const subject = `Owner WhatsApp Support Request`;
        const ticketNumber = generateTicketNumber();

        // ── Spam Prevention (Matches backend rules exactly) ────────────────────
        const [recentTickets] = await db.query(
            `SELECT id FROM support_tickets 
             WHERE user_id=? AND category=? AND status IN ('open','pending','replied')
             AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
            [userId, category]
        );
        
        if (recentTickets.length >= 2) {
            return await sock.sendMessage(chatId, {
                text: `⏳ *Slow down!*\n\nYou've submitted too many tickets recently. Please wait a while or check your existing tickets on the dashboard.`
            }, { quoted: msg });
        }

        // ── Create Ticket in Database ──────────────────────────────────────────
        const [ticketResult] = await db.query(
            `INSERT INTO support_tickets 
             (user_id, ticket_number, category, subject, status, last_reply_at, last_reply_by)
             VALUES (?, ?, ?, ?, 'open', NOW(), 'user')`,
            [userId, ticketNumber, category, subject]
        );
        
        const ticketId = ticketResult.insertId;
        
        // ── Add User Message ──────────────────────────────────────────────────
        await db.query(
            `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, message)
             VALUES (?, 'user', ?, ?)`,
            [ticketId, userId, userMessage]
        );

        console.log(`[TICKET] Owner created #${ticketNumber} via WhatsApp`);

        // ── Success Response ──────────────────────────────────────────────────
        const successText = `
🎫 *Support Ticket Created!*

📋 *Ticket ID:* #${ticketNumber}
📁 *Category:* Owner Request
💬 *Message:* _"${userMessage.substring(0, 80)}${userMessage.length > 80 ? '...' : ''}"_

━━━━━━━━━━━━━━━━━━━━

✅ Your message has been sent to the server admin.

To view replies or continue the conversation:
🔗 *https://oxbot.name.ng/dashboard#tickets
        `.trim();

        await sock.sendMessage(chatId, { text: successText }, { quoted: msg });

    } catch (err) {
        console.error('[SUPPORT CMD ERROR]:', err.message);
        await sock.sendMessage(chatId, { 
            text: '❌ *Failed to create ticket.*\n_An internal error occurred. Please try again later._' 
        }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'support',
    aliases: ['ticket', 'helpdesk'],
    desc: 'Open a support ticket to admin (Owner Only)',
    category: 'owner', // ★ Locked to owner category
    execute
};