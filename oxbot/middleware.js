/**
 * @file oxbot/middleware.js
 * @description Authentication and Authorization middleware for users and administrators.
 * 
 * HOW IT WORKS:
 * - `getUser`: Extracts the bearer token, parses out the user ID, verifies the user in the database, validates that the user is not blocked, and attaches the user record to the request.
 * - `adminAuth`: Reads the admin token from headers and validates it against the SHA256 hashed ADMIN_KEY.
 * 
 * CONNECTIONS TO OTHER FILES:
 * - Imports oxbot/database.js to query user profile details and status.
 * - Imported by routes/users.js, routes/bots.js, routes/tickets.js, routes/deposits.js to secure client endpoints.
 * - Imported by routes/admin.js to secure administrator-level dashboard actions.
 */

const crypto = require('crypto');
const db = require('./database');

// Secret Key used for Admin verification
const ADMIN_KEY = 'dominion';

// Secure static token computed for admin header matching
const ADMIN_TOKEN = 'admin-' + crypto.createHash('sha256').update(ADMIN_KEY + '-oxbot-static').digest('hex');

/**
 * Middleware: Validates User authentication token.
 * Extracts 'mock-token-<id>' from authorization headers, queries user fields, checks for suspension.
 */
const getUser = async (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token?.startsWith('mock-token-'))
        return res.status(401).json({ message: 'Unauthorized' });
    const userId = token.replace('mock-token-', '');
    try {
        const [rows] = await db.query(
            'SELECT id,name,username,email,phone,balance,referral_code,blocked FROM users WHERE id=?',
            [userId]
        );
        if (!rows.length) return res.status(401).json({ message: 'User not found' });
        if (rows[0].blocked) return res.status(403).json({ message: 'Account suspended.', blocked: true });
        req.user = rows[0];
        next();
    } catch { res.status(500).json({ message: 'Auth error' }); }
};

/**
 * Middleware: Validates Admin authentication header.
 * Inspects multiple header casings for the static ADMIN_TOKEN string.
 */
function adminAuth(req, res, next) {
    const t = req.headers['x-admin-token']
           || req.headers['X-Admin-Token']
           || req.headers['x-admin-token'.toLowerCase()]
           || null;
    if (!t) return res.status(401).json({ message: 'Unauthorized — no token' });
    if (t !== ADMIN_TOKEN) return res.status(401).json({ message: 'Unauthorized — invalid token' });
    next();
}

module.exports = {
    getUser,
    adminAuth,
    ADMIN_KEY,
    ADMIN_TOKEN
};

