/**
 * @file routes/tickets.js
 * @description Support Ticket router handling creation, management, user replies, and real-time typing statuses for customer support.
 * 
 * HOW IT WORKS:
 * - Implements Express Router.
 * - Secures routes using the `getUser` auth middleware.
 * - Generates unique ticket identifiers via `generateTicketNumber`.
 * - Handles new ticket submissions, spam prevention checks, and support notification emails.
 * - Fetches ticket lists, specific conversation history, and user replies.
 * - Manages ticket closures and records user/admin typing statuses dynamically using in-memory state.
 * 
 * CONNECTIONS TO OTHER FILES:
 * - Mounted in app.js: `app.use(require('./routes/tickets'))`.
 * - Imports oxbot/database.js to run queries on the support_tickets and ticket_messages tables.
 * - Imports oxbot/state.js to read and update `typingState` flags.
 * - Imports oxbot/utils.js to add log entries to audit trails.
 * - Imports oxbot/middleware.js to leverage the `getUser` auth wrapper.
 * - Imports oxbot/mailer.js to resolve category labels and dispatch notification emails to support/users.
 */

const express = require('express');
const router = express.Router();
const chalk = require('chalk');

const db = require('../oxbot/database');
const { typingState } = require('../oxbot/state');
const { addLog } = require('../oxbot/utils');
const { getUser } = require('../oxbot/middleware');
const {
    TICKET_CATEGORIES,
    sendTicketNotificationToSupport,
    sendReplyNotification
} = require('../oxbot/mailer');

// ── GENERATE TICKET NUMBER ────────────────────────────────────────────────────
function generateTicketNumber() {
    const prefix = 'TKT';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
}

// ── CREATE TICKET ─────────────────────────────────────────────────────────────
router.post('/api/tickets/create', getUser, async (req, res) => {
    const { category, subject, message } = req.body;
    
    // Validation
    if (!category || !Object.keys(TICKET_CATEGORIES).includes(category))
        return res.status(400).json({ message: 'Please select a valid category.' });
    
    if (!subject || subject.trim().length < 3)
        return res.status(400).json({ message: 'Subject must be at least 3 characters.' });
    
    if (!message || message.trim().length < 10)
        return res.status(400).json({ message: 'Message must be at least 10 characters.' });
    
    try {
        // Check for duplicate open tickets (prevent spam)
        const [recentTickets] = await db.query(
            `SELECT id FROM support_tickets 
             WHERE user_id=? AND category=? AND status IN ('open','pending','replied')
             AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
            [req.user.id, category]
        );
        
        if (recentTickets.length >= 2) {
            return res.status(429).json({ 
                message: 'You\'ve submitted too many tickets recently. Please wait or check your existing tickets.' 
            });
        }
        
        const ticketNumber = generateTicketNumber();
        
        // Create ticket
        const [ticketResult] = await db.query(
            `INSERT INTO support_tickets 
             (user_id, ticket_number, category, subject, status, last_reply_at, last_reply_by)
             VALUES (?, ?, ?, ?, 'open', NOW(), 'user')`,
            [req.user.id, ticketNumber, category, subject.trim()]
        );
        
        const ticketId = ticketResult.insertId;
        
        // Add initial message
        await db.query(
            `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, message)
             VALUES (?, 'user', ?, ?)`,
            [ticketId, req.user.id, message.trim()]
        );
        
        addLog(req.user.id, `🎫 Ticket created: #${ticketNumber} — ${subject}`);
        console.log(chalk.cyan(`[TICKET] Created #${ticketNumber} by user ${req.user.id}: ${subject}`));
        
        // Send email notification to support (fire-and-forget)
        sendTicketNotificationToSupport(req.user, ticketNumber, category, subject, message).catch(err => {
            console.error(chalk.red('[TICKET] Email notification failed:'), err.message);
        });
        
        res.status(201).json({
            success: true,
            message: 'Ticket submitted successfully!',
            ticket_id: ticketId,
            ticket_number: ticketNumber,
        });
        
    } catch (err) {
        console.error(chalk.red('[TICKET] Create error:'), err.message);
        res.status(500).json({ message: 'Failed to create ticket. Please try again.' });
    }
});

// ── LIST USER'S TICKETS ───────────────────────────────────────────────────────
router.get('/api/tickets', getUser, async (req, res) => {
    try {
        const [tickets] = await db.query(
            `SELECT id, ticket_number, category, subject, status, priority, 
                    last_reply_at, last_reply_by, created_at, updated_at
             FROM support_tickets 
             WHERE user_id = ?
             ORDER BY 
               CASE WHEN status IN ('open','replied') THEN 0 ELSE 1 END,
               updated_at DESC
             LIMIT 50`,
            [req.user.id]
        );
        
        res.json(tickets);
        
    } catch (err) {
        console.error(chalk.red('[TICKET] List error:'), err.message);
        res.status(500).json({ message: 'Failed to load tickets.' });
    }
});

// ── GET TICKET DETAILS WITH MESSAGES ──────────────────────────────────────────
router.get('/api/tickets/:id', getUser, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    
    if (isNaN(ticketId))
        return res.status(400).json({ message: 'Invalid ticket ID.' });
    
    try {
        // Get ticket
        const [tickets] = await db.query(
            `SELECT * FROM support_tickets WHERE id = ? AND user_id = ?`,
            [ticketId, req.user.id]
        );
        
        if (!tickets.length)
            return res.status(404).json({ message: 'Ticket not found.' });
        
        const ticket = tickets[0];
        
        // Get messages
        const [messages] = await db.query(
            `SELECT tm.*, 
                    CASE 
                        WHEN tm.sender_type = 'user' THEN u.username
                        WHEN tm.sender_type = 'admin' THEN 'Support Team'
                        ELSE 'System'
                    END as sender_name
             FROM ticket_messages tm
             LEFT JOIN users u ON u.id = tm.sender_id AND tm.sender_type = 'user'
             WHERE tm.ticket_id = ?
             ORDER BY tm.created_at ASC`,
            [ticketId]
        );
        
        // Update status to 'open' if user is viewing and it was 'replied'
        if (ticket.status === 'replied') {
            await db.query(
                `UPDATE support_tickets SET status = 'open', updated_at = NOW() WHERE id = ?`,
                [ticketId]
            );
            ticket.status = 'open';
        }
        
        res.json({
            ...ticket,
            messages,
            category_label: TICKET_CATEGORIES[ticket.category] || ticket.category,
        });
        
    } catch (err) {
        console.error(chalk.red('[TICKET] Detail error:'), err.message);
        res.status(500).json({ message: 'Failed to load ticket details.' });
    }
});

// ── REPLY TO TICKET (USER) ───────────────────────────────────────────────────
router.post('/api/tickets/:id/reply', getUser, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    const { message } = req.body;
    
    if (isNaN(ticketId))
        return res.status(400).json({ message: 'Invalid ticket ID.' });
    
    if (!message || message.trim().length < 3)
        return res.status(400).json({ message: 'Reply must be at least 3 characters.' });
    
    try {
        // Verify ticket exists and belongs to user
        const [tickets] = await db.query(
            `SELECT * FROM support_tickets WHERE id = ? AND user_id = ?`,
            [ticketId, req.user.id]
        );
        
        if (!tickets.length)
            return res.status(404).json({ message: 'Ticket not found.' });
        
        const ticket = tickets[0];
        
        // Check if ticket is closed
        if (ticket.status === 'closed')
            return res.status(400).json({ message: 'This ticket is closed. Please create a new ticket.' });
        
        // Add message
        await db.query(
            `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, message)
             VALUES (?, 'user', ?, ?)`,
            [ticketId, req.user.id, message.trim()]
        );
        
        // Update ticket status
        await db.query(
            `UPDATE support_tickets 
             SET status = 'pending', last_reply_at = NOW(), last_reply_by = 'user', updated_at = NOW()
             WHERE id = ?`,
            [ticketId]
        );
        
        addLog(req.user.id, `💬 Replied to ticket #${ticket.ticket_number}`);
        
        // Send email notification to support
        sendReplyNotification(ticket, req.user, message.trim(), 'user').catch(err => {
            console.error(chalk.red('[TICKET] Reply notification failed:'), err.message);
        });
        
        res.json({ success: true, message: 'Reply sent successfully!' });
        
    } catch (err) {
        console.error(chalk.red('[TICKET] Reply error:'), err.message);
        res.status(500).json({ message: 'Failed to send reply.' });
    }
});

// ── CLOSE TICKET (USER) ──────────────────────────────────────────────────────
router.post('/api/tickets/:id/close', getUser, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    
    if (isNaN(ticketId))
        return res.status(400).json({ message: 'Invalid ticket ID.' });
    
    try {
        const [tickets] = await db.query(
            `SELECT * FROM support_tickets WHERE id = ? AND user_id = ? AND status != 'closed'`,
            [ticketId, req.user.id]
        );
        
        if (!tickets.length)
            return res.status(404).json({ message: 'Ticket not found or already closed.' });
        
        await db.query(
            `UPDATE support_tickets SET status = 'closed', updated_at = NOW() WHERE id = ?`,
            [ticketId]
        );
        
        addLog(req.user.id, `🔒 Closed ticket #${tickets[0].ticket_number}`);
        console.log(chalk.yellow(`[TICKET] User closed #${tickets[0].ticket_number}`));
        
        res.json({ success: true, message: 'Ticket closed.' });
        
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── USER SETS TYPING ─────────────────────────────────────────────────────────
router.post('/api/tickets/:id/typing', getUser, async (req, res) => {
    const id = req.params.id;
    if (!typingState[id]) typingState[id] = {};
    typingState[id].user = Date.now();
    res.json({ ok: true });
});

// ── USER CHECKS IF ADMIN IS TYPING ───────────────────────────────────────────
router.get('/api/tickets/:id/typing-status', getUser, async (req, res) => {
    const id = req.params.id;
    const state = typingState[id];
    const adminTyping = state && state.admin && (Date.now() - state.admin < 3000);
    res.json({ support_typing: !!adminTyping });
});

module.exports = router;
