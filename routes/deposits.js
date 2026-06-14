/**
 * @file routes/deposits.js
 * @description Deposits and Subscription router handling coin purchases, payment confirmations, and Pro plan upgrades.
 * 
 * HOW IT WORKS:
 * - Implements Express Router.
 * - Secures routes using the `getUser` auth middleware.
 * - Houses the `PRO_PLANS` pricing definitions (Starter / Premium limits and prices).
 * - Initiates coin deposits, maps USD prices to Naira, and returns banking credentials.
 * - Handles deposit notifications (`deposit/paid`) and database-side coin updates (`deposit/confirm`).
 * - Manages Pro plan purchases (`pro/initiate`), dynamic expiration updates, and bot limit querying (`pro/status`).
 * 
 * CONNECTIONS TO OTHER FILES:
 * - Mounted in app.js: `app.use(require('./routes/deposits').router)`.
 * - Exports the router object and `PRO_PLANS` dictionary.
 * - Imported by routes/admin.js to match active plan metrics (days, prices, bot limits) when admins update a user's subscription.
 * - Imports oxbot/database.js to run queries on deposits, pro_subscriptions, and users tables.
 * - Imports oxbot/utils.js to audit transaction updates via `addLog`.
 * - Imports oxbot/middleware.js to leverage the `getUser` auth wrapper.
 */

const express = require('express');
const router = express.Router();
const chalk = require('chalk');

const db = require('../oxbot/database');
const { addLog } = require('../oxbot/utils');
const { getUser } = require('../oxbot/middleware');

const PRO_PLANS = {
    half: { name: 'OxBot Pro Starter',  price: 1.50, naira: 2250, days: 30, bots: 5, botDays: 30 },
    full: { name: 'OxBot Pro Premium', price: 3.00, naira: 4500, days: 30, bots: 8, botDays: 30 },
};

// ── MARK DEPOSIT AS PAID (user self-reports) ──────────────────────────────────
router.post('/api/deposit/paid', getUser, async (req, res) => {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ message: 'Reference required' });
    try {
        const [rows] = await db.query(
            'SELECT * FROM deposits WHERE reference=? AND user_id=? AND status="pending"',
            [reference, req.user.id]
        );
        if (!rows.length) return res.status(404).json({ message: 'Deposit not found or already processed' });

        await db.query(
            'UPDATE deposits SET paid_at=NOW() WHERE reference=?',
            [reference]
        );

        addLog(req.user.id, `💳 User marked deposit as PAID: ${reference}`);
        res.json({ success: true, message: 'Payment noted! Admin will confirm within 15 minutes.' });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── INITIATE DEPOSIT ──────────────────────────────────────────────────────────
router.post('/api/deposit/initiate', getUser, async (req, res) => {
    const { amount } = req.body;
    if (!amount || amount < 100) return res.status(400).json({ message: 'Minimum deposit is ₦100' });
    const coins = Math.floor((amount / 50) * 10);
    const ref   = 'OXB-' + Date.now() + '-' + req.user.id;
    try {
        await db.query(
            'INSERT INTO deposits (user_id,amount,coins,reference,status) VALUES (?,?,?,?,"pending")',
            [req.user.id, amount, coins, ref]
        );
        res.json({
            success: true, reference: ref, coins, amount,
            bank: { name: 'Paga', account: '3822792739', holder: 'stw-OxBot Services' },
        });
    } catch { res.status(500).json({ message: 'Failed to initiate deposit' }); }
});

// ── CONFIRM DEPOSIT (USER FRONTEND TRICK) ─────────────────────────────────────
router.post('/api/deposit/confirm', getUser, async (req, res) => {
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
        addLog(req.user.id, `✅ Deposit confirmed: +${dep.coins} coins`);
        res.json({ success: true, message: `${dep.coins} coins added!` });
    } catch { res.status(500).json({ message: 'Failed to confirm deposit' }); }
});

// ── GET DEPOSIT HISTORY ───────────────────────────────────────────────────────
router.get('/api/deposit/history', getUser, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT * FROM deposits WHERE user_id=? ORDER BY created_at DESC LIMIT 20',
            [req.user.id]
        );
        res.json(rows);
    } catch { res.status(500).json({ message: 'Error' }); }
});

// ── GET PRO PLAN STATUS ───────────────────────────────────────────────────────
router.get('/api/pro/status', getUser, async (req, res) => {
    try {
        await db.query(
            `UPDATE pro_subscriptions SET status='expired'
             WHERE user_id=? AND status='active' AND expires_at <= NOW()`,
            [req.user.id]
        ).catch(() => {});

        const [rows] = await db.query(
            `SELECT * FROM pro_subscriptions
             WHERE user_id=? AND status IN ('active','expired')
             ORDER BY
               CASE WHEN status='active' THEN 0 ELSE 1 END,
               created_at DESC
             LIMIT 1`,
            [req.user.id]
        );

        if (rows.length === 0) {
            const [userMeta] = await db.query('SELECT created_at FROM users WHERE id=?', [req.user.id]);
            let freeDaysLeft = 0;
            if (userMeta.length > 0 && userMeta[0].created_at) {
                const regDate = new Date(userMeta[0].created_at);
                const diffDays = Math.floor((Date.now() - regDate) / (1000 * 60 * 60 * 24));
                freeDaysLeft = Math.max(0, 30 - diffDays);
            }
            return res.json({
                status: freeDaysLeft > 0 ? 'none' : 'none',
                plan: null,
                plan_name: null,
                free_days_left: freeDaysLeft,
                can_use_free: freeDaysLeft > 0,
            });
        }

        const sub = rows[0];
        const planInfo = PRO_PLANS[sub.plan] || {};

        if (sub.status === 'active') {
            const expiresAt = new Date(sub.expires_at);
            const daysLeft  = Math.max(0, Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60 * 24)));
            return res.json({
                status: 'active',
                plan: sub.plan,
                plan_name: planInfo.name || sub.plan,
                expires_at: sub.expires_at,
                days_left: daysLeft,
                max_bots: planInfo.bots,
                bot_duration_days: planInfo.botDays,
            });
        }

        return res.json({
            status: 'expired',
            plan: sub.plan,
            plan_name: planInfo.name || sub.plan,
            expires_at: sub.expires_at,
        });

    } catch (err) {
        console.error(chalk.red('[PRO STATUS ERROR]'), err.message);
        res.status(500).json({ message: 'Failed to fetch pro status' });
    }
});

// ── INITIATE PRO PLAN ─────────────────────────────────────────────────────────
router.post('/api/pro/initiate', getUser, async (req, res) => {
    const { plan } = req.body;
    if (!plan || !['half', 'full'].includes(plan))
        return res.status(400).json({ message: 'Invalid plan. Choose "half" or "full".' });

    const planInfo = PRO_PLANS[plan];
    if (!planInfo)
        return res.status(400).json({ message: 'Plan not found.' });

    try {
        const [activeSubs] = await db.query(
            `SELECT id FROM pro_subscriptions
             WHERE user_id=? AND status='active' AND plan=? AND expires_at > NOW()`,
            [req.user.id, plan]
        );
        if (activeSubs.length > 0)
            return res.status(400).json({ message: `You already have an active ${planInfo.name} subscription.` });

        await db.query(
            `UPDATE pro_subscriptions SET status='cancelled'
             WHERE user_id=? AND status='pending'`,
            [req.user.id]
        ).catch(() => {});

        const reference = 'PRO-' + plan.toUpperCase() + '-' + Date.now() + '-' + req.user.id;

        await db.query(
            `INSERT INTO pro_subscriptions (user_id, plan, status, amount, naira, reference)
             VALUES (?, ?, 'pending', ?, ?, ?)`,
            [req.user.id, plan, planInfo.price, planInfo.naira, reference]
        );

        addLog(req.user.id, `👑 Pro ${planInfo.name} initiated — ref: ${reference}`);

        res.json({
            success: true,
            reference,
            plan,
            plan_name: planInfo.name,
            amount: planInfo.price,
            naira: planInfo.naira,
            duration_days: planInfo.days,
            max_bots: planInfo.bots,
            bot_duration_days: planInfo.botDays,
            bank: {
                name: 'Paga',
                account: '3822792739',
                holder: 'stw-OxBot Services',
            },
            message: 'Transfer the exact amount and send proof to norply@oxbot.name.ng for activation.',
        });

    } catch (err) {
        console.error(chalk.red('[PRO INIT ERROR]'), err.message);
        res.status(500).json({ message: 'Failed to initiate pro plan.' });
    }
});

module.exports = {
    router,
    PRO_PLANS
};
