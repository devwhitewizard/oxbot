/**
 * commands/supportresponse.js
 * View admin replies to your support tickets from WhatsApp (OWNER ONLY)
 */

// Robust session lookup — same as support.js
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
    // ══════════════════════════════════════════════════════════════════════════
    const sender = msg.key.participant || msg.key.remoteJid;
    const ownerPhone = sock._ownerPhone || (sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : null);

    if (!ownerPhone) {
        return await sock.sendMessage(chatId, { text: '❌ Cannot verify owner identity.' }, { quoted: msg });
    }

    const senderClean = String(sender).replace(/[^0-9]/g, '');
    const ownerClean  = String(ownerPhone).replace(/[^0-9]/g, '');

    const senderNorm = senderClean.startsWith('0') ? senderClean.slice(1) : senderClean;
    const ownerNorm  = ownerClean.startsWith('0') ? ownerClean.slice(1) : ownerClean;

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

    // ── Optional: filter by specific ticket number ────────────────────────────
    // Usage: .supportresponse          → shows all tickets with replies
    // Usage: .supportresponse TKT-XXX  → shows replies for that specific ticket
    const filterTicket = args.join(' ').trim().toUpperCase();

    await sock.sendMessage(chatId, { text: '⏳ *Fetching your ticket replies...*' }, { quoted: msg });

    try {
        // ── Get User ID ───────────────────────────────────────────────────────
        const userId = await getOwnerUserId(db, sessionId);
        if (!userId) {
            return await sock.sendMessage(chatId, { text: '❌ Could not find your account in the database.' }, { quoted: msg });
        }

        // ── Build query based on whether a ticket number was provided ──────────
        let tickets;

        if (filterTicket) {
            // Search for a specific ticket
            const [rows] = await db.query(
                `SELECT id, ticket_number, category, subject, status, created_at
                 FROM support_tickets
                 WHERE user_id=? AND ticket_number=?
                 ORDER BY created_at DESC`,
                [userId, filterTicket]
            );
            tickets = rows;
        } else {
            // Get all tickets that have admin replies
            const [rows] = await db.query(
                `SELECT t.id, t.ticket_number, t.category, t.subject, t.status, t.created_at
                 FROM support_tickets t
                 INNER JOIN ticket_messages m ON m.ticket_id = t.id
                 WHERE t.user_id=? AND m.sender_type='admin'
                 ORDER BY t.created_at DESC
                 LIMIT 20`,
                [userId]
            );
            tickets = rows;
        }

        // ── No tickets found ──────────────────────────────────────────────────
        if (!tickets.length) {
            if (filterTicket) {
                return await sock.sendMessage(chatId, {
                    text: `❌ *Ticket not found!*\n\nNo ticket with ID *${filterTicket}* found for your account.\n\n_Tip: Use \`.supportresponse\` without a ticket number to see all tickets with replies._`
                }, { quoted: msg });
            }
            return await sock.sendMessage(chatId, {
                text: `📭 *No replies yet!*\n\nYou have no tickets with admin replies at the moment.\n\n_To create a new ticket, use:*\n.support Your message here`
            }, { quoted: msg });
        }

        // ── Fetch admin replies for each ticket ───────────────────────────────
        const ticketIds = tickets.map(t => t.id);

        const [replies] = await db.query(
            `SELECT ticket_id, message, created_at
             FROM ticket_messages
             WHERE ticket_id IN (?) AND sender_type='admin'
             ORDER BY created_at ASC`,
            [ticketIds]
        );

        // Group replies by ticket_id
        const repliesByTicket = {};
        for (const r of replies) {
            if (!repliesByTicket[r.ticket_id]) repliesByTicket[r.ticket_id] = [];
            repliesByTicket[r.ticket_id].push(r);
        }

        // ── Format Response ───────────────────────────────────────────────────
        const statusEmoji = {
            open: '🟢',
            pending: '🟡',
            replied: '🔵',
            closed: '🔴',
            resolved: '✅'
        };

        // If only one ticket, show detailed view
        if (tickets.length === 1) {
            const t = tickets[0];
            const ticketReplies = repliesByTicket[t.id] || [];
            const emoji = statusEmoji[t.status] || '⚪';
            const dateStr = new Date(t.created_at).toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            let text = `📨 *Ticket #${t.ticket_number}*\n\n`;
            text += `${emoji} *Status:* ${t.status.charAt(0).toUpperCase() + t.status.slice(1)}\n`;
            text += `📁 *Category:* ${t.category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}\n`;
            text += `📝 *Subject:* ${t.subject}\n`;
            text += `📅 *Created:* ${dateStr}\n`;
            text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

            if (ticketReplies.length === 0) {
                text += `📭 _No admin replies yet. Please check back later._\n\n`;
            } else {
                text += `💬 *Admin Replies (${ticketReplies.length}):*\n\n`;
                ticketReplies.forEach((r, i) => {
                    const rDate = new Date(r.created_at).toLocaleDateString('en-GB', {
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                    });
                    text += `*_Reply ${i + 1} — ${rDate}_*\n`;
                    text += `${r.message}\n\n`;
                });
            }

            text += `━━━━━━━━━━━━━━━━━━━━\n`;
            text += `🔗 *View full conversation:*\nhttps://oxbot.name.ng/dashboard#tickets`;

            // WhatsApp message length limit is ~4096 chars
            if (text.length > 4000) {
                // Split into two messages if too long
                const mid = text.lastIndexOf('\n\n', 2000);
                const part1 = text.substring(0, mid > 0 ? mid : 2000);
                const part2 = text.substring(mid > 0 ? mid : 2000);
                await sock.sendMessage(chatId, { text: part1 }, { quoted: msg });
                await sock.sendMessage(chatId, { text: part2 });
            } else {
                await sock.sendMessage(chatId, { text }, { quoted: msg });
            }

            return null;
        }

        // ── Multiple tickets: summary view ────────────────────────────────────
        let text = `📨 *Your Ticket Replies*\n\n`;
        text += `Found *${tickets.length}* ticket(s) with admin replies:\n\n`;

        tickets.forEach((t, i) => {
            const ticketReplies = repliesByTicket[t.id] || [];
            const emoji = statusEmoji[t.status] || '⚪';
            const dateStr = new Date(t.created_at).toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short'
            });
            // Show the latest reply preview (last message in the array)
            const latestReply = ticketReplies[ticketReplies.length - 1];
            const preview = latestReply
                ? latestReply.message.substring(0, 60) + (latestReply.message.length > 60 ? '...' : '')
                : '_No reply text_';

            text += `*${i + 1}.* ${emoji} *#${t.ticket_number}*\n`;
            text += `   📁 ${t.category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} · ${dateStr}\n`;
            text += `   💬 ${ticketReplies.length} repl${ticketReplies.length === 1 ? 'y' : 'ies'} · ${t.status}\n`;
            text += `   _"${preview}"_\n\n`;
        });

        text += `━━━━━━━━━━━━━━━━━━━━\n`;
        text += `💡 _Reply with a ticket number to see full details:_\n_.supportresponse TKT-XXXXX_\n\n`;
        text += `🔗 *Dashboard:* https://oxbot.name.ng/dashboard#tickets`;

        // Handle long messages
        if (text.length > 4000) {
            const mid = text.lastIndexOf('\n\n', 2000);
            const part1 = text.substring(0, mid > 0 ? mid : 2000);
            const part2 = text.substring(mid > 0 ? mid : 2000);
            await sock.sendMessage(chatId, { text: part1 }, { quoted: msg });
            await sock.sendMessage(chatId, { text: part2 });
        } else {
            await sock.sendMessage(chatId, { text }, { quoted: msg });
        }

    } catch (err) {
        console.error('[SUPPORT RESPONSE CMD ERROR]:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ *Failed to fetch replies.*\n_An internal error occurred. Please try again later._'
        }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'supportresponse',
    aliases: ['ticketreply', 'ticketreplies', 'supportreplies', 'myreplies'],
    desc: 'View admin replies to your support tickets (Owner Only)',
    category: 'owner',
    execute
};