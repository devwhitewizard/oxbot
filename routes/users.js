/**
 * @file routes/users.js
 * @description User Profile router securing client-specific endpoints.
 * 
 * HOW IT WORKS:
 * - Implements Express Router.
 * - Secures endpoints using the `getUser` authentication middleware.
 * - Handles profile detail retrieval, username settings edits, and referral logging.
 * - Captures heartbeat intervals from active client dashboards to monitor online users.
 * 
 * CONNECTIONS TO OTHER FILES:
 * - Mounted in app.js: `app.use(require('./routes/users'))`.
 * - Imports oxbot/database.js to select user fields and count registered bots and referrals.
 * - Imports oxbot/state.js to register user heartbeats in the `onlineUsers` map cache.
 * - Imports oxbot/middleware.js to leverage the `getUser` auth wrapper.
 */

const express = require('express');
const router = express.Router();

const db = require('../oxbot/database');
const { onlineUsers } = require('../oxbot/state');
const { getUser } = require('../oxbot/middleware');


// ── GET USER PROFILE ─────────────────────────────────────────────────────────
router.get('/api/user', getUser, async (req, res) => {
    try {
        const [[active]]   = [await db.query('SELECT COUNT(*) as c FROM bots WHERE user_id=? AND status="active"',   [req.user.id])];
        const [[inactive]] = [await db.query('SELECT COUNT(*) as c FROM bots WHERE user_id=? AND status="inactive"', [req.user.id])];
        const [[refCount]] = [await db.query('SELECT COUNT(*) as c FROM referrals WHERE referrer_id=?',              [req.user.id])];
        const [[userMeta]] = [await db.query('SELECT created_at FROM users WHERE id=?', [req.user.id])];
        res.json({
            ...req.user,
            balance:         Number(req.user.balance),
            active_bots:     active[0].c,
            inactive_bots:   inactive[0].c,
            total_referrals: refCount[0].c,
            created_at:      (userMeta && userMeta.length) ? userMeta[0].created_at : null,
        });
    } catch { res.status(500).json({ message: 'Error' }); }
});

// ── UPDATE SETTINGS ──────────────────────────────────────────────────────────
router.post('/api/settings', getUser, async (req, res) => {
    const { name, phone } = req.body;
    if (!name || !phone) return res.status(400).json({ message: 'Name and phone are required.' });
    await db.query('UPDATE users SET name=?, phone=? WHERE id=?', [name, phone, req.user.id]);
    res.json({ message: 'Settings updated' });
});

// ── GET REFERRALS ────────────────────────────────────────────────────────────
router.get('/api/referrals', getUser, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT u.username, u.name, r.created_at, r.reward_given
             FROM referrals r JOIN users u ON u.id=r.referred_id
             WHERE r.referrer_id=? ORDER BY r.created_at DESC`,
            [req.user.id]
        );
        const [[count]] = [await db.query('SELECT COUNT(*) as c FROM referrals WHERE referrer_id=?', [req.user.id])];
        res.json({ total: count[0].c, referrals: rows });
    } catch { res.status(500).json({ message: 'Error' }); }
});

// ── USER HEARTBEAT ───────────────────────────────────────────────────────────
router.post('/api/heartbeat', getUser, (req, res) => {
    const { page } = req.body;
    onlineUsers.set(req.user.id, {
        userId:   req.user.id,
        username: req.user.username,
        name:     req.user.name,
        lastSeen: Date.now(),
        page:     page || 'dashboard',
    });
    res.json({ ok: true });
});

module.exports = router;
