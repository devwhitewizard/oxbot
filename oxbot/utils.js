/**
 * @file oxbot/utils.js
 * @description Core utility helpers for console logging, string manipulation, telephone normalization, and filesystem patches.
 * 
 * HOW IT WORKS:
 * - `addLog`: Writes log messages both to the database and to the in-memory cache, keeping only the most recent 200 logs per user.
 * - `extractSessionId`: Strips unnecessary metadata from raw session ID identifiers.
 * - `normalisePhone`: Standardizes phone numbers to International format (detecting and appending Nigeria country code 234 if needed).
 * - `patchCredsIfNeeded`: Patches Baileys session identity files to fix registration flags if incomplete.
 * 
 * CONNECTIONS TO OTHER FILES:
 * - Imports oxbot/database.js and oxbot/state.js to write logs to DB/cache.
 * - Imported by app.js (running warning crons, database status).
 * - Imported by oxbot/botManager.js, oxbot/pairing.js.
 * - Imported by all route modules (routes/auth.js, routes/users.js, routes/bots.js, routes/tickets.js, routes/deposits.js, routes/admin.js) to clean params and record audit logs.
 */

const fs   = require('fs');
const path = require('path');
const db   = require('./database');
const { consoleLogs } = require('./state');

// Simple promise wrapper for timeout delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Pushes a status log to the user's terminal console logs (both database and map cache).
 * Caps database/memory records to the most recent 200 logs.
 * @param {number|string} userId 
 * @param {string} msg 
 */
function addLog(userId, msg) {
    if (!consoleLogs.has(userId)) consoleLogs.set(userId, []);
    const arr = consoleLogs.get(userId);
    const entry = { time: new Date().toLocaleTimeString(), message: msg };
    arr.unshift(entry);
    if (arr.length > 200) arr.pop();

    // Insert log to database
    db.query(
        'INSERT INTO console_logs (user_id, message, time) VALUES (?, ?, ?)',
        [userId, msg, entry.time]
    ).catch(() => {});

    // Delete older records keeping only 200 logs
    db.query(
        `DELETE FROM console_logs WHERE user_id = ? AND id NOT IN (
            SELECT id FROM (
                SELECT id FROM console_logs WHERE user_id = ? ORDER BY id DESC LIMIT 200
            ) t
        )`,
        [userId, userId]
    ).catch(() => {});
}

/**
 * Parses and returns a clean session ID, stripping auxiliary metadata suffix if present.
 * @param {string} raw 
 * @returns {string}
 */
function extractSessionId(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    return s.includes('::::') ? s.split('::::')[0].trim() : s;
}

/**
 * Normalizes phone numbers to international numeric string format.
 * Defaults local Nigeria formats (e.g. 080... or 80...) to 23480...
 * @param {string|number} raw 
 * @returns {string}
 */
function normalisePhone(raw) {
    let rawStr = String(raw).trim();
    let isInt = rawStr.startsWith('+');
    let p = rawStr.replace(/[^0-9]/g, '');
    if (isInt) return p;
    if (p.length === 11 && rawStr.startsWith('0')) return '234' + p.slice(1);
    if (p.length === 10 && ['7','8','9'].includes(p[0])) return '234' + p;
    return p;
}

/**
 * Patches baileys creds.json file if registered status is false but WhatsApp details are valid.
 * Solves the ghost reconnection conflict on startup.
 * @param {string} sessionFolder 
 */
function patchCredsIfNeeded(sessionFolder) {
    const cp = path.join(sessionFolder, 'creds.json');
    if (!fs.existsSync(cp)) return;
    try {
        const creds = JSON.parse(fs.readFileSync(cp, 'utf8'));
        // Patch registered=true if the session has valid key material but registered is false.
        // Handles both internal pairing sessions (me+account present) and external QR sessions
        // (noiseKey present but me may be missing until the bot first connects).
        const hasValidKeys = !!(creds.noiseKey || creds.signedIdentityKey);
        if (!creds.registered && (creds.account && creds.me || hasValidKeys)) {
            creds.registered = true;
            fs.writeFileSync(cp, JSON.stringify(creds, null, 2));
        }
    } catch {}
}

module.exports = {
    addLog,
    extractSessionId,
    normalisePhone,
    patchCredsIfNeeded,
    delay
};

