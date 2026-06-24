/**
 * @file routes/auth.js
 * @description Authentication router containing endpoints for sign-up, sign-in, email verification, and password resets.
 * 
 * HOW IT WORKS:
 * - Implements Express Router.
 * - Handles bcrypt hashing for secure passwords, and generates unique hex tokens for email confirmations.
 * - Manages forgot password ticket generation via 6-digit email codes.
 * - Confirms referred registration balance payouts upon email confirmation.
 * - CREDITS 20 COINS TO NEW USERS UPON EMAIL VERIFICATION FOR BOT DEPLOYMENT.
 * 
 * CONNECTIONS TO OTHER FILES:
 * - Mounted in app.js: `app.use(require('./routes/auth'))`.
 * - Imports oxbot/database.js to run SQL queries on the users, referrals, and logs tables.
 * - Imports oxbot/mailer.js to dispatch verification and reset code emails.
 * - Imports oxbot/utils.js to write logs to console and database.
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const chalk = require('chalk');

const db = require('../oxbot/database');
const { sendVerificationEmail, sendResetCodeEmail } = require('../oxbot/mailer');
const { addLog } = require('../oxbot/utils');


// ── REGISTER ──────────────────────────────────────────────────────────────────
router.post('/api/register', async (req, res) => {
    const { name, username, email, phone, password, referralCode } = req.body;
    if (!name || !username || !email || !phone || !password)
        return res.status(400).json({ message: 'All fields required.' });
    try {
        const hash  = await bcrypt.hash(password, 10);
        const code  = username.substring(0, 4).toUpperCase() +
                      Math.random().toString(36).substring(2, 6).toUpperCase();

        // Generate a secure email verification token (64 hex chars)
        const verifyToken    = crypto.randomBytes(32).toString('hex');
        const verifyTokenExp = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        const [result] = await db.query(
            `INSERT INTO users
             (name, username, email, phone, password, referral_code,
              email_verified, verify_token, verify_token_exp)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            [name, username, email, phone, hash, code, verifyToken, verifyTokenExp]
        );

        // Save referral record — reward will be granted on email verification, NOT now
        if (referralCode) {
            const [refs] = await db.query('SELECT id FROM users WHERE referral_code=?', [referralCode]);
            if (refs.length) {
                await db.query(
                    'INSERT INTO referrals (referrer_id, referred_id, reward_given) VALUES (?, ?, 0)',
                    [refs[0].id, result.insertId]
                );
            }
        }

        // Send verification email (fire-and-forget with error logging)
        sendVerificationEmail(email, name, verifyToken).catch(err => {
            console.error(chalk.red('❌ Email send failed:'), err.message);
        });

        res.status(201).json({
            message: 'Account created! Please check your email to verify your account.',
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY')
            return res.status(400).json({ message: 'Username or email already exists.' });
        res.status(500).json({ message: 'Server error.' });
    }
});

// ── VERIFY EMAIL ──────────────────────────────────────────────────────────────
router.get('/api/verify-email', async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: 'Token required.' });

    try {
        const [rows] = await db.query(
            'SELECT id, name, email_verified, verify_token_exp FROM users WHERE verify_token=?',
            [token]
        );

        if (!rows.length)
            return res.status(400).json({ message: 'Invalid or already used verification link.' });

        const user = rows[0];

        if (user.email_verified)
            return res.json({ message: 'Email already verified. You can log in.', alreadyVerified: true });

        if (new Date() > new Date(user.verify_token_exp))
            return res.status(400).json({ message: 'Verification link has expired. Please register again or request a new link.' });

        // Mark as verified and clear token
        await db.query(
            `UPDATE users
             SET email_verified=1, verify_token=NULL, verify_token_exp=NULL
             WHERE id=?`,
            [user.id]
        );

        // ── Credit 20 Coins to the new user for bot deployment ────────────────
        await db.query('UPDATE users SET balance = balance + 20 WHERE id=?', [user.id]);
        addLog(user.id, `🎉 Welcome bonus! +20 coins credited for bot deployment.`);
        console.log(chalk.green(`[BONUS] +20 coins → user ${user.id} (${user.name}) for verifying email.`));

        // ── Grant referral reward NOW that the referred user has verified ──────
        const [pendingRefs] = await db.query(
            'SELECT * FROM referrals WHERE referred_id=? AND reward_given=0',
            [user.id]
        );
        for (const ref of pendingRefs) {
            await db.query('UPDATE users SET balance=balance+10 WHERE id=?', [ref.referrer_id]);
            await db.query('UPDATE referrals SET reward_given=1 WHERE id=?',  [ref.id]);
            addLog(ref.referrer_id, `🎉 Referral verified! +10 coins from ${user.name}`);
            console.log(chalk.green(`[REFERRAL] +10 coins → user ${ref.referrer_id} (referred ${user.id})`));
        }

        res.json({ 
            message: 'Email verified successfully! You can now log in. 20 coins have been added to your account to deploy your first bot.', 
            success: true 
        });
    } catch (err) {
        console.error(chalk.red('Verify email error:'), err.message);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ── RESEND VERIFICATION EMAIL ─────────────────────────────────────────────────
router.post('/api/resend-verification', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required.' });

    try {
        const [rows] = await db.query(
            'SELECT id, name, email_verified FROM users WHERE email=?',
            [email.trim().toLowerCase()]
        );

        if (!rows.length)
            return res.status(404).json({ message: 'No account found with that email.' });

        const user = rows[0];
        if (user.email_verified)
            return res.json({ message: 'Your email is already verified. Please log in.' });

        // Issue fresh token
        const verifyToken    = crypto.randomBytes(32).toString('hex');
        const verifyTokenExp = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await db.query(
            'UPDATE users SET verify_token=?, verify_token_exp=? WHERE id=?',
            [verifyToken, verifyTokenExp, user.id]
        );

        await sendVerificationEmail(email, user.name, verifyToken);
        res.json({ message: 'Verification email resent! Check your inbox.' });
    } catch (err) {
        console.error(chalk.red('Resend verify error:'), err.message);
        res.status(500).json({ message: 'Failed to resend. Try again.' });
    }
});

// ── LOGIN — block unverified accounts ────────────────────────────────────────
router.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password)
        return res.status(400).json({ message: 'All fields required.' });
    try {
        const [rows] = await db.query('SELECT * FROM users WHERE username=?', [username]);
        if (!rows.length) return res.status(401).json({ message: 'Invalid credentials.' });
        const user = rows[0];

        if (!await bcrypt.compare(password, user.password))
            return res.status(401).json({ message: 'Invalid credentials.' });

        if (!user.email_verified) {
            return res.status(403).json({
                message: 'Please verify your email before logging in.',
                unverified: true,
                email: user.email,
            });
        }

        if (user.blocked) {
            return res.status(403).json({
                message: 'Your account has been suspended. Contact support@oxbot.name.ng.',
                blocked: true,
            });
        }

        res.json({
            message: 'Login successful',
            token:   'mock-token-' + user.id,
            user:    { id: user.id, username: user.username, name: user.name },
        });

    } catch (err) {
        console.error('[LOGIN ERROR]', err.message);
        res.status(500).json({ message: 'Server error: ' + err.message });
    }
});

// ── FORGOT PASSWORD - SEND CODE ──────────────────────────────────────────────
router.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    if (!email || !email.includes('@'))
        return res.status(400).json({ message: 'Please enter a valid email address.' });
    
    try {
        const [rows] = await db.query(
            'SELECT id, name, email FROM users WHERE email=? LIMIT 1',
            [email.trim().toLowerCase()]
        );
        
        if (rows.length === 0) {
            return res.json({ 
                success: true, 
                message: 'If an account exists with this email, a reset code has been sent.' 
            });
        }
        
        const user = rows[0];
        
        // Generate 6-digit code
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        
        // Store code in database
        await db.query(
            'UPDATE users SET reset_code=?, reset_code_exp=? WHERE id=?',
            [code, expiresAt, user.id]
        );
        
        // Send email (fire-and-forget with logging)
        sendResetCodeEmail(user.email, user.name, code).catch(err => {
            console.error(chalk.red('❌ Reset code email failed:'), err.message);
        });
        
        console.log(chalk.cyan(`[RESET] Code sent to ${user.email}: ${code}`));
        
        res.json({ 
            success: true, 
            message: 'If an account exists with this email, a reset code has been sent.' 
        });
        
    } catch (err) {
        console.error(chalk.red('Forgot password error:'), err.message);
        res.json({ 
            success: true, 
            message: 'If an account exists with this email, a reset code has been sent.' 
        });
    }
});

// ── VERIFY RESET CODE ────────────────────────────────────────────────────────
router.post('/api/verify-reset-code', async (req, res) => {
    const { email, code } = req.body;
    
    if (!email || !code)
        return res.status(400).json({ message: 'Email and code are required.' });
    
    if (!/^\d{6}$/.test(code))
        return res.status(400).json({ message: 'Code must be 6 digits.' });
    
    try {
        const [rows] = await db.query(
            `SELECT id, name, reset_code, reset_code_exp 
             FROM users 
             WHERE email=? AND reset_code=? AND reset_code_exp > NOW()`,
            [email.trim().toLowerCase(), code]
        );
        
        if (rows.length === 0) {
            const [expired] = await db.query(
                'SELECT id FROM users WHERE email=? AND reset_code=? AND reset_code_exp <= NOW()',
                [email.trim().toLowerCase(), code]
            );
            
            if (expired.length > 0) {
                return res.status(400).json({ message: 'This code has expired. Please request a new one.' });
            }
            
            return res.status(400).json({ message: 'Invalid verification code. Please check and try again.' });
        }
        
        res.json({ 
            success: true, 
            message: 'Code verified successfully.' 
        });
        
    } catch (err) {
        console.error(chalk.red('Verify reset code error:'), err.message);
        res.status(500).json({ message: 'Verification failed. Please try again.' });
    }
});

// ── RESET PASSWORD ──────────────────────────────────────────────────────────
router.post('/api/reset-password', async (req, res) => {
    const { email, code, newPassword } = req.body;
    
    if (!email || !code || !newPassword)
        return res.status(400).json({ message: 'All fields are required.' });
    
    if (newPassword.length < 6)
        return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    
    if (!/^\d{6}$/.test(code))
        return res.status(400).json({ message: 'Invalid code format.' });
    
    try {
        const [rows] = await db.query(
            `SELECT id, name, reset_code, reset_code_exp 
             FROM users 
             WHERE email=? AND reset_code=? AND reset_code_exp > NOW()`,
            [email.trim().toLowerCase(), code]
        );
        
        if (rows.length === 0) {
            const [expired] = await db.query(
                'SELECT id FROM users WHERE email=? AND reset_code=? AND reset_code_exp <= NOW()',
                [email.trim().toLowerCase(), code]
            );
            
            if (expired.length > 0) {
                return res.status(400).json({ message: 'This code has expired. Please request a new one.' });
            }
            
            return res.status(400).json({ message: 'Invalid verification code.' });
        }
        
        const user = rows[0];
        
        // Hash new password
        const hash = await bcrypt.hash(newPassword, 10);
        
        // Update password and clear reset code
        await db.query(
            `UPDATE users 
             SET password=?, reset_code=NULL, reset_code_exp=NULL 
             WHERE id=?`,
            [hash, user.id]
        );
        
        console.log(chalk.green(`[RESET] Password changed for ${email}`));
        
        res.json({ 
            success: true, 
            message: 'Password has been reset successfully!' 
        });
        
    } catch (err) {
        console.error(chalk.red('Reset password error:'), err.message);
        res.status(500).json({ message: 'Failed to reset password. Please try again.' });
    }
});

module.exports = router;
