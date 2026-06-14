/**
 * @file routes/admin.js
 * @description Administration router securing dashboard statistics, support tickets, user moderation, coin balances, and session status views.
 * 
 * HOW IT WORKS:
 * - Implements Express Router.
 * - Secures routes using the `adminAuth` middleware and ADMIN_TOKEN comparisons.
 * - Provides overall dashboard status telemetry (`admin/stats`, `admin/online-users`, `admin/live-console`).
 * - Manages ticket responses, priorities, and closure notifications.
 * - Handles user account adjustments: plan switches, balance top-ups, blocking (which disconnects user sockets), and search/deletion.
 * - Orchestrates manual subscription activations and coin deposit reviews.
 * - Interrogates active in-memory socket sessions and allows force-termination of Baileys sessions.
 * 
 * CONNECTIONS TO OTHER FILES:
 * - Mounted in app.js: `app.use(require('./routes/admin'))`.
 * - Imports oxbot/database.js to run CRUD/delete routines across all schemas (users, bots, support, deposits, subscriptions).
 * - Imports oxbot/state.js to read or modify active sockets, reconnect locks, typing statuses, and online maps.
 * - Imports oxbot/utils.js to audit admin overrides via `addLog`.
 * - Imports oxbot/middleware.js to leverage the `adminAuth` middleware, `ADMIN_KEY`, and `ADMIN_TOKEN`.
 * - Imports oxbot/mailer.js to dispatch admin replies to users and check ticket categories.
 * - Imports PRO_PLANS from `./deposits` to pull pricing metrics and limits.
 */

const express = require('express');
const router = express.Router();
const chalk = require('chalk');
const crypto = require('crypto');

const db = require('../oxbot/database');
const {
    activeBots,
    stoppedBots,
    connectingBots,
    onlineUsers,
    typingState,
    reconnectLocks,
    reconnectAttempts
} = require('../oxbot/state');
const { addLog } = require('../oxbot/utils');
const { adminAuth, ADMIN_KEY, ADMIN_TOKEN } = require('../oxbot/middleware');
const { TICKET_CATEGORIES, sendAdminReplyToUser } = require('../oxbot/mailer');
const { PRO_PLANS } = require('./deposits');

// Helper function for time ago
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
}

// ── ADMIN LOGIN ───────────────────────────────────────────────────────────────
router.post('/api/admin/login', (req, res) => {
    const { key } = req.body;
    if (!key || key !== ADMIN_KEY) {
        console.log(chalk.yellow('[ADMIN] Failed login attempt'));
        return res.status(403).json({ message: 'Invalid admin key.' });
    }
    console.log(chalk.green('[ADMIN] ✅ Login successful'));
    res.json({ token: ADMIN_TOKEN, message: 'Authenticated' });
});

// ── ADMIN: LIVE CONSOLE (all users commands) ──────────────────────────────────
router.get('/api/admin/live-console', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT cl.user_id, cl.message, cl.time, cl.created_at,
                    u.username, u.name
             FROM console_logs cl
             JOIN users u ON u.id = cl.user_id
             WHERE cl.message LIKE '%[CMD]%'
             ORDER BY cl.id DESC LIMIT 200`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN: ONLINE USERS (dashboard heartbeat) ─────────────────────────────────
router.get('/api/admin/online-users', adminAuth, (req, res) => {
    const cutoff = Date.now() - 30 * 1000;
    const online = [];
    for (const [id, u] of onlineUsers) {
        if (u.lastSeen > cutoff) online.push(u);
        else onlineUsers.delete(id);
    }
    res.json(online);
});

// ── LIST ALL TICKETS (ADMIN) ─────────────────────────────────────────────────
router.get('/api/admin/tickets', adminAuth, async (req, res) => {
    const { status, category, search } = req.query;
    
    try {
        let query = `
            SELECT t.*, 
                   u.username, u.email, u.phone, u.name as user_name,
                   (SELECT COUNT(*) FROM ticket_messages WHERE ticket_id = t.id) as message_count
            FROM support_tickets t
            JOIN users u ON u.id = t.user_id
            WHERE 1=1
        `;
        const params = [];
        
        if (status && status !== 'all') {
            query += ' AND t.status = ?';
            params.push(status);
        }
        
        if (category && category !== 'all') {
            query += ' AND t.category = ?';
            params.push(category);
        }
        
        if (search) {
            query += ' AND (t.ticket_number LIKE ? OR t.subject LIKE ? OR u.username LIKE ? OR u.email LIKE ?)';
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern, searchPattern);
        }
        
        query += ' ORDER BY CASE WHEN t.status IN ("open","replied") THEN 0 ELSE 1 END, t.updated_at DESC LIMIT 100';
        
        const [tickets] = await db.query(query, params);
        
        res.json(tickets.map(t => ({
            ...t,
            category_label: TICKET_CATEGORIES[t.category] || t.category,
        })));
        
    } catch (err) {
        console.error(chalk.red('[ADMIN] Tickets list error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

// ── GET TICKET DETAILS (ADMIN) ──────────────────────────────────────────────
router.get('/api/admin/tickets/:id', adminAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    
    try {
        const [tickets] = await db.query(
            `SELECT t.*, u.username, u.email, u.phone, u.name as user_name, u.balance, u.created_at as user_created_at
             FROM support_tickets t
             JOIN users u ON u.id = t.user_id
             WHERE t.id = ?`,
            [ticketId]
        );
        
        if (!tickets.length)
            return res.status(404).json({ message: 'Ticket not found.' });
        
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
        
        const [bots] = await db.query(
            `SELECT session_id, bot_name, status, expires_at FROM bots WHERE user_id = ?`,
            [tickets[0].user_id]
        );
        
        const [proSubs] = await db.query(
            `SELECT plan, status, expires_at FROM pro_subscriptions 
             WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
            [tickets[0].user_id]
        );
        
        res.json({
            ...tickets[0],
            category_label: TICKET_CATEGORIES[tickets[0].category] || tickets[0].category,
            messages,
            user_bots: bots,
            user_pro: proSubs.length > 0 ? proSubs[0] : null,
        });
        
    } catch (err) {
        console.error(chalk.red('[ADMIN] Ticket detail error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN REPLY TO TICKET ───────────────────────────────────────────────────
router.post('/api/admin/tickets/:id/reply', adminAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    const { message } = req.body;
    
    if (!message || message.trim().length < 3)
        return res.status(400).json({ message: 'Reply must be at least 3 characters.' });
    
    try {
        const [tickets] = await db.query('SELECT * FROM support_tickets WHERE id = ?', [ticketId]);
        if (!tickets.length)
            return res.status(404).json({ message: 'Ticket not found.' });
        
        const ticket = tickets[0];
        
        await db.query(
            `INSERT INTO ticket_messages (ticket_id, sender_type, sender_id, message)
             VALUES (?, 'admin', NULL, ?)`,
            [ticketId, message.trim()]
        );
        
        await db.query(
            `UPDATE support_tickets 
             SET status = 'replied', last_reply_at = NOW(), last_reply_by = 'admin', updated_at = NOW()
             WHERE id = ?`,
            [ticketId]
        );
        
        const [user] = await db.query('SELECT * FROM users WHERE id = ?', [ticket.user_id]);
        
        if (user.length > 0) {
            addLog(ticket.user_id, `📩 Support replied to ticket #${ticket.ticket_number}`);
            sendAdminReplyToUser(ticket, user[0], message.trim()).catch(err => {
                console.error(chalk.red('[TICKET] User notification failed:'), err.message);
            });
        }
        
        console.log(chalk.green(`[ADMIN] Replied to ticket #${ticket.ticket_number}`));
        res.json({ success: true, message: 'Reply sent!' });
        
    } catch (err) {
        console.error(chalk.red('[ADMIN] Ticket reply error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN CLOSE TICKET ──────────────────────────────────────────────────────
router.post('/api/admin/tickets/:id/close', adminAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    
    try {
        const [tickets] = await db.query('SELECT * FROM support_tickets WHERE id = ? AND status != "closed"', [ticketId]);
        if (!tickets.length)
            return res.status(404).json({ message: 'Ticket not found or already closed.' });
        
        await db.query(
            `UPDATE support_tickets SET status = 'closed', updated_at = NOW() WHERE id = ?`,
            [ticketId]
        );
        
        addLog(tickets[0].user_id, `🔒 Admin closed ticket #${tickets[0].ticket_number}`);
        console.log(chalk.yellow(`[ADMIN] Closed ticket #${tickets[0].ticket_number}`));
        
        res.json({ success: true, message: 'Ticket closed.' });
        
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN REOPEN TICKET ─────────────────────────────────────────────────────
router.post('/api/admin/tickets/:id/reopen', adminAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    
    try {
        const [tickets] = await db.query('SELECT * FROM support_tickets WHERE id = ? AND status = "closed"', [ticketId]);
        if (!tickets.length)
            return res.status(404).json({ message: 'Ticket not found or not closed.' });
        
        await db.query(
            `UPDATE support_tickets SET status = 'open', updated_at = NOW() WHERE id = ?`,
            [ticketId]
        );
        
        addLog(tickets[0].user_id, `🔓 Admin reopened ticket #${tickets[0].ticket_number}`);
        console.log(chalk.cyan(`[ADMIN] Reopened ticket #${tickets[0].ticket_number}`));
        
        res.json({ success: true, message: 'Ticket reopened.' });
        
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN UPDATE TICKET PRIORITY ────────────────────────────────────────────
router.post('/api/admin/tickets/:id/priority', adminAuth, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    const { priority } = req.body;
    
    const validPriorities = ['low', 'medium', 'high'];
    if (!priority || !validPriorities.includes(priority))
        return res.status(400).json({ message: 'Invalid priority. Use: low, medium, high' });
    
    try {
        await db.query(
            `UPDATE support_tickets SET priority = ?, updated_at = NOW() WHERE id = ?`,
            [priority, ticketId]
        );
        
        console.log(chalk.cyan(`[ADMIN] Updated ticket ${ticketId} priority to ${priority}`));
        res.json({ success: true, message: `Priority set to ${priority}` });
        
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN SETS TYPING ────────────────────────────────────────────────────────
router.post('/api/admin/tickets/:id/typing', adminAuth, async (req, res) => {
  const id = req.params.id;
  if (!typingState[id]) typingState[id] = {};
  typingState[id].admin = Date.now();
  res.json({ ok: true });
});

// ── ADMIN CHECKS IF USER IS TYPING ───────────────────────────────────────────
router.get('/api/admin/tickets/:id/typing-status', adminAuth, async (req, res) => {
  const id = req.params.id;
  const state = typingState[id];
  const userTyping = state && state.user && (Date.now() - state.user < 3000);
  res.json({ user_typing: !!userTyping });
});

// ── TICKET STATS (ADMIN) ─────────────────────────────────────────────────────
router.get('/api/admin/ticket-stats', adminAuth, async (req, res) => {
    try {
        const [statusCounts] = await db.query(`
            SELECT status, COUNT(*) as count 
            FROM support_tickets 
            GROUP BY status
        `);
        
        const [categoryCounts] = await db.query(`
            SELECT category, COUNT(*) as count 
            FROM support_tickets 
            GROUP BY category
        `);
        
        const [totalMessages] = await db.query(`
            SELECT COUNT(*) as count FROM ticket_messages
        `);
        
        const [avgResponse] = await db.query(`
            SELECT COALESCE(
                AVG(
                    TIMESTAMPDIFF(MINUTE, 
                        tm1.created_at, 
                        (SELECT MIN(created_at) FROM ticket_messages tm2 
                         WHERE tm2.ticket_id = tm1.ticket_id 
                         AND tm2.sender_type = 'admin' 
                         AND tm2.created_at > tm1.created_at)
                    )
                ), 0
            ) as avg_minutes
            FROM ticket_messages tm1
            WHERE tm1.sender_type = 'user'
            AND EXISTS (
                SELECT 1 FROM ticket_messages tm2 
                WHERE tm2.ticket_id = tm1.ticket_id 
                AND tm2.sender_type = 'admin' 
                AND tm2.created_at > tm1.created_at
            )
        `);
        
        res.json({
            by_status: statusCounts || [],
            by_category: categoryCounts || [],
            total_messages: (totalMessages && totalMessages[0]) ? totalMessages[0].count : 0,
            avg_response_minutes: Math.round((avgResponse && avgResponse[0] && avgResponse[0].avg_minutes) || 0),
        });
        
    } catch (err) {
        console.error(chalk.red('[ADMIN] Ticket stats error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

// ── ACTIVATE PRO SUBSCRIPTION (OLD ENDPOINT) ─────────────────────────────────
router.post('/api/pro/activate', async (req, res) => {
    const { reference, adminKey } = req.body;
    const ADMIN_KEY_ENV = process.env.ADMIN_KEY || 'oxbot-admin-2025';
    if (adminKey !== ADMIN_KEY_ENV)
        return res.status(403).json({ message: 'Unauthorized. Invalid admin key.' });

    if (!reference)
        return res.status(400).json({ message: 'Reference is required.' });

    try {
        const [subs] = await db.query(
            'SELECT * FROM pro_subscriptions WHERE reference=? AND status="pending"',
            [reference]
        );
        if (!subs.length)
            return res.status(404).json({ message: 'No pending subscription found with that reference.' });

        const sub = subs[0];
        const planInfo = PRO_PLANS[sub.plan];
        const now = new Date();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + planInfo.days);

        await db.query(
            `UPDATE pro_subscriptions
             SET status='active', started_at=?, expires_at=?
             WHERE id=?`,
            [now, expiresAt, sub.id]
        );

        addLog(sub.user_id, `👑 ${planInfo.name} ACTIVATED! Expires: ${expiresAt.toLocaleDateString()} — ${planInfo.bots} bots, ${planInfo.botDays} days/bot`);
        console.log(chalk.green(`[PRO] Activated: ${planInfo.name} for user ${sub.user_id}`));

        res.json({
            success: true,
            message: `${planInfo.name} activated successfully!`,
            user_id: sub.user_id,
            plan: sub.plan,
            expires_at: expiresAt,
        });

    } catch (err) {
        console.error(chalk.red('[PRO ACTIVATE ERROR]'), err.message);
        res.status(500).json({ message: 'Failed to activate subscription.' });
    }
});

// ── GET PENDING PRO SUBSCRIPTIONS (OLD ENDPOINT) ──────────────────────────────
router.get('/api/pro/pending', async (req, res) => {
    const ADMIN_KEY_ENV = process.env.ADMIN_KEY || 'oxbot-admin-2025';
    const key = req.headers['x-admin-key'];
    if (key !== ADMIN_KEY_ENV)
        return res.status(403).json({ message: 'Unauthorized.' });

    try {
        const [rows] = await db.query(
            `SELECT s.*, u.username, u.email
             FROM pro_subscriptions s
             JOIN users u ON u.id = s.user_id
             WHERE s.status='pending'
             ORDER BY s.created_at DESC`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: 'Error' });
    }
});

// ── ADMIN STATS ───────────────────────────────────────────────────────────────
router.get('/api/admin/stats', adminAuth, async (req, res) => {
    try {
        let total_users = 0, active_bots = 0, active_pro = 0, pending_pro = 0, total_coins = 0, blocked_users = 0, expiring_soon = 0, expired_today = 0;

        try { const [r] = await db.query('SELECT COUNT(*) as c FROM users'); total_users = r[0].c; } catch (e) { console.error('[STATS] users:', e.message); }
        try { const [r] = await db.query('SELECT COUNT(*) as c FROM bots WHERE status="active"'); active_bots = r[0].c; } catch (e) { console.error('[STATS] bots:', e.message); }
        try { const [r] = await db.query('SELECT COUNT(*) as c FROM pro_subscriptions WHERE status="active" AND expires_at > NOW()'); active_pro = r[0].c; } catch (e) { console.error('[STATS] pro:', e.message); }
        try { const [r] = await db.query('SELECT COUNT(*) as c FROM pro_subscriptions WHERE status="pending"'); pending_pro = r[0].c; } catch (e) { console.error('[STATS] pending:', e.message); }
        try { const [r] = await db.query('SELECT COALESCE(SUM(balance),0) as c FROM users'); total_coins = Number(r[0].c); } catch (e) { console.error('[STATS] coins:', e.message); }
        try { const [r] = await db.query('SELECT COUNT(*) as c FROM users WHERE blocked=1'); blocked_users = r[0].c; } catch (e) { console.error('[STATS] blocked:', e.message); }
        
        try {
            const [r] = await db.query(
                `SELECT COUNT(*) as c FROM bots 
                 WHERE status="active" 
                   AND expires_at IS NOT NULL 
                   AND expires_at <= DATE_ADD(NOW(), INTERVAL 24 HOUR) 
                   AND expires_at > NOW()`
            );
            expiring_soon = r[0].c;
        } catch (e) { console.error('[STATS] expiring:', e.message); }
        
        try {
            const [r] = await db.query(
                `SELECT COUNT(*) as c FROM bots 
                 WHERE status="inactive" 
                   AND expires_at IS NOT NULL 
                   AND expires_at <= NOW() 
                   AND expires_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );
            expired_today = r[0].c;
        } catch (e) { console.error('[STATS] expired_today:', e.message); }

        const data = { total_users, active_bots, active_pro, pending_pro, total_coins, blocked_users, expiring_soon, expired_today };
        console.log(chalk.cyan('[ADMIN] Stats:'), JSON.stringify(data));
        res.json(data);
    } catch (err) {
        console.error(chalk.red('[ADMIN] Stats error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN USERS (with full plan info) ────────────────────────────────────────
router.get('/api/admin/users', adminAuth, async (req, res) => {
    try {
        const [users] = await db.query(
            `SELECT u.id, u.name, u.username, u.email, u.phone, u.balance, u.blocked, u.created_at,
                    (SELECT COUNT(*) FROM bots WHERE user_id=u.id AND status="active") as active_bots,
                    (SELECT COUNT(*) FROM bots WHERE user_id=u.id) as total_bots
             FROM users u ORDER BY u.created_at DESC`
        );

        if (!users.length) {
            console.log(chalk.cyan('[ADMIN] No users found'));
            return res.json([]);
        }

        const result = [];
        for (const u of users) {
            const [activePro] = await db.query(
                `SELECT id, plan, status, expires_at, started_at FROM pro_subscriptions
                 WHERE user_id=? AND status='active' AND expires_at > NOW()
                 ORDER BY created_at DESC LIMIT 1`,
                [u.id]
            );

            const [lastPro] = await db.query(
                `SELECT id, plan, status, expires_at FROM pro_subscriptions
                 WHERE user_id=?
                 ORDER BY created_at DESC LIMIT 1`,
                [u.id]
            );

            let current_plan = 'free';
            let plan_expires = null;
            let sub_id = null;

            if (activePro.length > 0) {
                current_plan = activePro[0].plan;
                plan_expires = activePro[0].expires_at;
                sub_id = activePro[0].id;
            } else if (lastPro.length > 0 && lastPro[0].status === 'expired') {
                current_plan = 'expired';
                plan_expires = lastPro[0].expires_at;
                sub_id = lastPro[0].id;
            }

            const diffDays = Math.floor((Date.now() - new Date(u.created_at)) / (1000 * 60 * 60 * 24));
            const can_use_free = diffDays <= 30;

            result.push({
                id: u.id,
                name: u.name,
                username: u.username,
                email: u.email,
                phone: u.phone,
                balance: Number(u.balance),
                blocked: u.blocked === 1,
                created_at: u.created_at,
                active_bots: u.active_bots,
                total_bots: u.total_bots,
                current_plan,
                plan_expires,
                sub_id,
                can_use_free,
                days_registered: diffDays,
            });
        }
        
        console.log(chalk.cyan('[ADMIN] Users fetched: ' + result.length + ' users'));
        res.json(result);
    } catch (err) {
        console.error(chalk.red('[ADMIN] Users error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN CHANGE USER PLAN ──────────────────────────────────────────────────
router.post('/api/admin/users/:id/plan', adminAuth, async (req, res) => {
    const { plan, days } = req.body;
    const userId = req.params.id;

    const validPlans = [...Object.keys(PRO_PLANS), 'free'];
    if (!plan) return res.status(400).json({ message: 'Plan is required' });

    try {
        if (plan === 'free') {
            const [activeSubs] = await db.query(
                `SELECT id FROM pro_subscriptions WHERE user_id=? AND status='active' AND expires_at > NOW()`,
                [userId]
            );
            for (const s of activeSubs) {
                await db.query(
                    `UPDATE pro_subscriptions SET status='expired', expires_at=NOW() WHERE id=?`,
                    [s.id]
                );
            }
            addLog(userId, '👑 Admin changed plan to FREE');
            console.log(chalk.yellow(`[ADMIN] User ${userId} plan → FREE`));
            return res.json({ success: true, message: 'Plan changed to Free', current_plan: 'free' });
        }

        if (!PRO_PLANS[plan]) {
            return res.status(400).json({ message: `Invalid plan. Valid: ${validPlans.join(', ')}` });
        }

        const planInfo = PRO_PLANS[plan];
        const durationDays = days || planInfo.days;
        const now = new Date();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + durationDays);

        const [existing] = await db.query(
            `SELECT id, expires_at FROM pro_subscriptions 
             WHERE user_id=? AND plan=? AND status='active' AND expires_at > NOW()
             LIMIT 1`,
            [userId, plan]
        );

        if (existing.length > 0) {
            const oldExpiry = new Date(existing[0].expires_at);
            const newExpiry = new Date();
            if (oldExpiry > now) {
                newExpiry.setTime(oldExpiry.getTime() + (durationDays * 24 * 60 * 60 * 1000));
            } else {
                newExpiry.setTime(now.getTime() + (durationDays * 24 * 60 * 60 * 1000));
            }
            await db.query(`UPDATE pro_subscriptions SET expires_at=? WHERE id=?`, [newExpiry, existing[0].id]);
            addLog(userId, `👑 Admin EXTENDED ${planInfo.name} by ${durationDays} days → ${newExpiry.toLocaleDateString()}`);
            console.log(chalk.green(`[ADMIN] User ${userId} ${planInfo.name} EXTENDED → ${newExpiry.toLocaleDateString()}`));
            return res.json({ success: true, message: `${planInfo.name} extended by ${durationDays} days`, current_plan: plan, expires_at: newExpiry });
        }

        await db.query(
            `UPDATE pro_subscriptions SET status='expired', expires_at=NOW() 
             WHERE user_id=? AND status='active' AND expires_at > NOW()`,
            [userId]
        );

        const reference = 'ADMIN-' + Date.now() + '-' + crypto.randomBytes(8).toString('hex');
        await db.query(
            `INSERT INTO pro_subscriptions (user_id, plan, reference, amount, naira, status, started_at, expires_at)
             VALUES (?, ?, ?, 0, 0, 'active', ?, ?)`,
            [userId, plan, reference, now, expiresAt]
        );

        addLog(userId, `👑 Admin set plan to ${planInfo.name} (${durationDays} days) → ${expiresAt.toLocaleDateString()}`);
        console.log(chalk.green(`[ADMIN] User ${userId} plan → ${planInfo.name} (${durationDays}d) → ${expiresAt.toLocaleDateString()}`));

        res.json({ success: true, message: `${planInfo.name} activated for ${durationDays} days`, current_plan: plan, expires_at: expiresAt });
    } catch (err) {
        console.error(chalk.red('[ADMIN] Plan change error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN BLOCK ──────────────────────────────────────────────────────────────
router.post('/api/admin/users/:id/block', adminAuth, async (req, res) => {
    try {
        await db.query('UPDATE users SET blocked=1 WHERE id=?', [req.params.id]);
        const [bots] = await db.query('SELECT session_id FROM bots WHERE user_id=? AND status="active"', [req.params.id]);
        for (const b of bots) {
            stoppedBots.add(b.session_id);
            const bot = activeBots.get(b.session_id);
            if (bot?.sock) { try { bot.sock.end(); } catch {} }
            activeBots.delete(b.session_id);
            await db.query('UPDATE bots SET status="inactive" WHERE session_id=?', [b.session_id]).catch(() => {});
        }
        global.botConnected = activeBots.size > 0;
        addLog(req.params.id, '🚫 Account BLOCKED by admin');
        console.log(chalk.red(`[ADMIN] User ${req.params.id} BLOCKED, ${bots.length} bot(s) stopped`));
        res.json({ success: true, message: 'User blocked' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN UNBLOCK ────────────────────────────────────────────────────────────
router.post('/api/admin/users/:id/unblock', adminAuth, async (req, res) => {
    try {
        await db.query('UPDATE users SET blocked=0 WHERE id=?', [req.params.id]);
        addLog(req.params.id, '✅ Account UNBLOCKED by admin');
        console.log(chalk.green(`[ADMIN] User ${req.params.id} UNBLOCKED`));
        res.json({ success: true, message: 'User unblocked' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN TOP UP ──────────────────────────────────────────────────────────────
router.post('/api/admin/topup', adminAuth, async (req, res) => {
    const { user_id, coins, reason } = req.body;
    if (!user_id || !coins || coins < 1)
        return res.status(400).json({ message: 'user_id and valid coins amount required' });
    try {
        await db.query('UPDATE users SET balance=balance+? WHERE id=?', [coins, user_id]);
        addLog(user_id, `👑 Admin added ${coins} coins${reason ? ' (' + reason + ')' : ''}`);
        console.log(chalk.green(`[ADMIN] +${coins} coins → user ${user_id}`));
        res.json({ success: true, message: `Added ${coins} coins` });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN DEDUCT COINS ───────────────────────────────────────────────────────
router.post('/api/admin/deduct', adminAuth, async (req, res) => {
    const { user_id, coins, reason } = req.body;
    if (!user_id || !coins || coins < 1)
        return res.status(400).json({ message: 'user_id and valid coins amount required' });
    try {
        const [u] = await db.query('SELECT balance FROM users WHERE id=?', [user_id]);
        if (!u.length) return res.status(404).json({ message: 'User not found' });
        if (Number(u[0].balance) < coins) return res.status(400).json({ message: 'Insufficient balance' });
        await db.query('UPDATE users SET balance=balance-? WHERE id=?', [coins, user_id]);
        addLog(user_id, `👑 Admin deducted ${coins} coins${reason ? ' (' + reason + ')' : ''}`);
        console.log(chalk.yellow(`[ADMIN] -${coins} coins → user ${user_id}`));
        res.json({ success: true, message: `Deducted ${coins} coins` });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN SET BALANCE ────────────────────────────────────────────────────────
router.post('/api/admin/setbalance', adminAuth, async (req, res) => {
    const { user_id, coins, reason } = req.body;
    if (user_id === undefined || coins === undefined || coins < 0)
        return res.status(400).json({ message: 'user_id and valid coins amount required' });
    try {
        await db.query('UPDATE users SET balance=? WHERE id=?', [coins, user_id]);
        addLog(user_id, `👑 Admin set balance to ${coins} coins${reason ? ' (' + reason + ')' : ''}`);
        console.log(chalk.cyan(`[ADMIN] Balance set to ${coins} → user ${user_id}`));
        res.json({ success: true, message: `Balance set to ${coins}` });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN ALL SUBSCRIPTIONS ──────────────────────────────────────────────────
router.get('/api/admin/subscriptions', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT s.*, u.username, u.email, u.phone, u.name
             FROM pro_subscriptions s JOIN users u ON u.id = s.user_id
             ORDER BY s.created_at DESC`
        );
        const result = rows.map(s => {
            let days_left = 0;
            if (s.status === 'active' && s.expires_at) {
                days_left = Math.max(0, Math.ceil((new Date(s.expires_at) - Date.now()) / (1000 * 60 * 60 * 24)));
            }
            return { ...s, days_left, naira: Number(s.naira) };
        });
        res.json(result);
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN PENDING SUBSCRIPTIONS ──────────────────────────────────────────────
router.get('/api/admin/subscriptions/pending', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT s.*, u.username, u.email, u.phone, u.name
             FROM pro_subscriptions s JOIN users u ON u.id = s.user_id
             WHERE s.status='pending'
             ORDER BY s.created_at DESC`
        );
        res.json(rows.map(r => ({ ...r, naira: Number(r.naira) })));
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN ACTIVATE SUBSCRIPTION ──────────────────────────────────────────────
router.post('/api/admin/subscriptions/activate', adminAuth, async (req, res) => {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ message: 'Reference required' });
    try {
        const [subs] = await db.query(
            'SELECT * FROM pro_subscriptions WHERE reference=? AND status="pending"', [reference]
        );
        if (!subs.length) return res.status(404).json({ message: 'No pending subscription found' });

        const sub = subs[0];
        const planInfo = PRO_PLANS[sub.plan];
        const now = new Date();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + planInfo.days);

        await db.query(
            `UPDATE pro_subscriptions SET status='active', started_at=?, expires_at=? WHERE id=?`,
            [now, expiresAt, sub.id]
        );

        addLog(sub.user_id, `👑 ${planInfo.name} ACTIVATED! Expires: ${expiresAt.toLocaleDateString()} — ${planInfo.bots} bots, ${planInfo.botDays} days/bot`);
        console.log(chalk.green(`[ADMIN] Pro activated: ${planInfo.name} for user ${sub.user_id} → ${expiresAt.toLocaleDateString()}`));

        res.json({ success: true, message: `${planInfo.name} activated`, expires_at: expiresAt });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN CANCEL SUBSCRIPTION ────────────────────────────────────────────────
router.post('/api/admin/subscriptions/:ref/cancel', adminAuth, async (req, res) => {
    try {
        const [subs] = await db.query(
            'SELECT * FROM pro_subscriptions WHERE reference=? AND status="pending"', [req.params.ref]
        );
        if (!subs.length) return res.status(404).json({ message: 'No pending subscription found' });
        await db.query("UPDATE pro_subscriptions SET status='cancelled' WHERE id=?", [subs[0].id]);
        console.log(chalk.yellow(`[ADMIN] Sub cancelled: ${req.params.ref}`));
        res.json({ success: true, message: 'Subscription cancelled' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN ALL DEPOSITS ───────────────────────────────────────────────────────
router.get('/api/admin/deposits', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT d.*, u.username FROM deposits d JOIN users u ON u.id = d.user_id ORDER BY d.created_at DESC LIMIT 200`
        );
        res.json(rows.map(d => ({ ...d, amount: Number(d.amount), coins: Number(d.coins) })));
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN CONFIRM DEPOSIT ────────────────────────────────────────────────────
router.post('/api/admin/deposits/confirm', adminAuth, async (req, res) => {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ message: 'Reference required' });
    try {
        const [rows] = await db.query(
            'SELECT * FROM deposits WHERE reference=? AND status="pending"', [reference]
        );
        if (!rows.length) return res.status(404).json({ message: 'Not found or already processed' });
        const dep = rows[0];
        await db.query('UPDATE deposits SET status="confirmed" WHERE reference=?', [reference]);
        await db.query('UPDATE users SET balance=balance+? WHERE id=?', [dep.coins, dep.user_id]);
        addLog(dep.user_id, `✅ Admin confirmed deposit: +${dep.coins} coins`);
        console.log(chalk.green(`[ADMIN] Deposit confirmed: ${dep.coins} coins → user ${dep.user_id}`));
        res.json({ success: true, message: `${dep.coins} coins credited` });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN REJECT DEPOSIT ─────────────────────────────────────────────────────
router.post('/api/admin/deposits/reject', adminAuth, async (req, res) => {
    const { reference, reason } = req.body;
    if (!reference) return res.status(400).json({ message: 'Reference required' });
    try {
        const [rows] = await db.query(
            'SELECT * FROM deposits WHERE reference=? AND status="pending"', [reference]
        );
        if (!rows.length) return res.status(404).json({ message: 'Not found or already processed' });
        await db.query('UPDATE deposits SET status="rejected" WHERE reference=?', [reference]);
        addLog(rows[0].user_id, `❌ Admin rejected deposit${reason ? ': ' + reason : ''}`);
        console.log(chalk.red(`[ADMIN] Deposit rejected: ${reference}`));
        res.json({ success: true, message: 'Deposit rejected' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN SEARCH USER ────────────────────────────────────────────────────────
router.get('/api/admin/users/search', adminAuth, async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ message: 'Search query required' });
    try {
        const [users] = await db.query(
            `SELECT u.id, u.name, u.username, u.email, u.phone, u.balance, u.blocked, u.created_at,
                    (SELECT COUNT(*) FROM bots WHERE user_id=u.id AND status="active") as active_bots,
                    (SELECT COUNT(*) FROM bots WHERE user_id=u.id) as total_bots,
                    (SELECT plan FROM pro_subscriptions WHERE user_id=u.id AND status='active' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1) as current_plan
             FROM users u
             WHERE u.username LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR u.name LIKE ? OR CAST(u.id AS CHAR) = ?
             ORDER BY u.created_at DESC LIMIT 20`,
            [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, q]
        );
        res.json(users.map(u => ({
            ...u,
            balance: Number(u.balance),
            blocked: u.blocked === 1,
            current_plan: u.current_plan || 'free',
        })));
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN DELETE USER ────────────────────────────────────────────────────────
router.delete('/api/admin/users/:id', adminAuth, async (req, res) => {
    try {
        const userId = req.params.id;
        const [bots] = await db.query('SELECT session_id FROM bots WHERE user_id=?', [userId]);
        for (const b of bots) {
            stoppedBots.add(b.session_id);
            const bot = activeBots.get(b.session_id);
            if (bot?.sock) { try { bot.sock.end(); } catch {} }
            activeBots.delete(b.session_id);
        }
        await db.query('DELETE FROM bots WHERE user_id=?', [userId]);
        await db.query('DELETE FROM pro_subscriptions WHERE user_id=?', [userId]);
        await db.query('DELETE FROM deposits WHERE user_id=?', [userId]);
        await db.query('DELETE FROM referrals WHERE referrer_id=? OR referred_id=?', [userId]);
        await db.query('DELETE FROM users WHERE id=?', [userId]);
        global.botConnected = activeBots.size > 0;
        console.log(chalk.red(`[ADMIN] User ${userId} DELETED completely`));
        res.json({ success: true, message: 'User deleted' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── ADMIN: PAIRED SESSIONS (View and Copy Long Session IDs) ──────────────────
router.get('/api/admin/paired-sessions', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT ps.*, u.username, u.name as user_name 
            FROM paired_sessions ps
            JOIN users u ON ps.user_id = u.id
            ORDER BY ps.paired_at DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error(chalk.red('[ADMIN] Paired Sessions Error:'), err.message);
        res.status(500).json({ message: 'Server error: ' + err.message });
    }
});

// ── ADMIN: RECENT PAIRED SESSIONS (last 24 hours) ───────────────────────────
router.get('/api/admin/paired-sessions/recent', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT ps.*, u.username, u.email, u.name as user_name, u.phone as user_phone
             FROM paired_sessions ps
             JOIN users u ON u.id = ps.user_id
             WHERE ps.paired_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
               AND ps.status = 'paired'
             ORDER BY ps.paired_at DESC`
        );

        res.json(rows.map(r => ({
            ...r,
            time_ago: getTimeAgo(new Date(r.paired_at)),
        })));

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN: PAIRED SESSIONS COUNT ─────────────────────────────────────────────
router.get('/api/admin/paired-sessions/count', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT COUNT(*) as count FROM paired_sessions 
             WHERE paired_at > DATE_SUB(NOW(), INTERVAL 24 HOUR) 
               AND status = 'paired'`
        );
        res.json({ count: rows[0].count });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN: MARK PAIRED SESSION AS ACTIVATED ──────────────────────────────────
router.post('/api/admin/paired-sessions/:sessionId/mark-activated', adminAuth, async (req, res) => {
    try {
        await db.query(
            `UPDATE paired_sessions SET status = 'activated' WHERE session_id = ?`,
            [req.params.sessionId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN: DELETE PAIRED SESSION RECORD ──────────────────────────────────────
router.delete('/api/admin/paired-sessions/:sessionId', adminAuth, async (req, res) => {
    try {
        await db.query('DELETE FROM paired_sessions WHERE session_id = ?', [req.params.sessionId]);
        console.log(chalk.yellow(`[ADMIN] Paired session record deleted: ${req.params.sessionId}`));
        res.json({ success: true, message: 'Record deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN: ACTIVE BOTS MANAGEMENT ────────────────────────────────────────────
router.get('/api/admin/active-bots', adminAuth, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT b.*, u.username, u.email, u.phone, u.name as user_name
             FROM bots b
             JOIN users u ON u.id = b.user_id
             WHERE b.status = 'active'
             ORDER BY b.expires_at ASC`
        );

        const result = rows.map(b => {
            const botData = activeBots.get(b.session_id);
            const expiresAt = b.expires_at ? new Date(b.expires_at) : null;
            const now = new Date();
            let daysLeft = null;
            let hoursLeft = null;
            
            if (expiresAt) {
                const diffMs = expiresAt - now;
                daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                hoursLeft = Math.floor(diffMs / (1000 * 60 * 60));
            }

            return {
                session_id: b.session_id,
                user_id: b.user_id,
                bot_name: b.bot_name,
                whatsapp_name: b.whatsapp_name || botData?.waName || null,
                server: b.server,
                expires_at: b.expires_at,
                days_left: daysLeft,
                hours_left: hoursLeft,
                isOnline: !!(botData && botData.sock && botData.openedAt > 0),
                isConnecting: connectingBots.has(b.session_id),
                username: b.username,
                email: b.email,
                phone: b.phone,
                user_name: b.user_name,
                created_at: b.created_at,
            };
        });

        res.json(result);
    } catch (err) {
        console.error(chalk.red('[ADMIN] Active bots error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN: STOP ACTIVE BOT ───────────────────────────────────────────────────
router.post('/api/admin/stop-bot/:sessionId', adminAuth, async (req, res) => {
    const sessionId = req.params.sessionId;
    
    try {
        const [bots] = await db.query(
            'SELECT * FROM bots WHERE session_id=? AND status="active"',
            [sessionId]
        );
        
        if (!bots.length) {
            return res.status(404).json({ message: 'Bot not found or already inactive' });
        }

        const bot = bots[0];

        stoppedBots.add(sessionId);
        connectingBots.delete(sessionId);
        reconnectLocks.delete(sessionId);
        reconnectAttempts.delete(sessionId);

        const botData = activeBots.get(sessionId);
        if (botData?.sock) {
            try { botData.sock.logout().catch(() => {}); } catch {}
            try { botData.sock.ws?.close(); } catch {}
            try { botData.sock.end(); } catch {}
        }
        activeBots.delete(sessionId);
        global.botConnected = activeBots.size > 0;

        await db.query('UPDATE bots SET status="inactive" WHERE session_id=?', [sessionId]);

        addLog(bot.user_id, `🛑 Bot "${bot.bot_name}" was stopped by admin.`);

        console.log(chalk.yellow(`[ADMIN] Bot stopped: ${bot.bot_name} (${sessionId})`));
        res.json({ success: true, message: `Bot "${bot.bot_name}" stopped successfully` });

    } catch (err) {
        console.error(chalk.red('[ADMIN] Stop bot error:'), err.message);
        res.status(500).json({ message: err.message });
    }
});

// ── ADMIN: SEND MESSAGE VIA BOT ──────────────────────────────────────────────
router.post('/api/admin/send-message', adminAuth, async (req, res) => {
    const { session_id, message } = req.body;
    
    if (!session_id || !message) {
        return res.status(400).json({ message: 'session_id and message are required' });
    }

    try {
        const botData = activeBots.get(session_id);
        
        if (!botData || !botData.sock || botData.openedAt <= 0) {
            return res.status(400).json({ message: 'Bot is not online. Cannot send message.' });
        }

        const [bots] = await db.query('SELECT * FROM bots WHERE session_id=?', [session_id]);
        if (!bots.length) return res.status(404).json({ message: 'Bot not found' });

        const bot = bots[0];
        const sock = botData.sock;
        const waNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : null;
        
        if (!waNumber) {
            return res.status(400).json({ message: 'Could not determine WhatsApp number' });
        }

        await sock.sendMessage(waNumber + '@s.whatsapp.net', { text: message });

        addLog(bot.user_id, `📨 Admin sent message via "${bot.bot_name}"`);

        console.log(chalk.green(`[ADMIN] Message sent via bot ${bot.bot_name} to user ${bot.user_id}`));
        res.json({ success: true, message: 'Message sent successfully' });

    } catch (err) {
        console.error(chalk.red('[ADMIN] Send message error:'), err.message);
        res.status(500).json({ message: 'Failed to send message: ' + err.message });
    }
});

module.exports = router;
