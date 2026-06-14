const fs   = require('fs');
const path = require('path');
const db   = require('./database');
const { consoleLogs } = require('./state');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function addLog(userId, msg) {
    if (!consoleLogs.has(userId)) consoleLogs.set(userId, []);
    const arr = consoleLogs.get(userId);
    const entry = { time: new Date().toLocaleTimeString(), message: msg };
    arr.unshift(entry);
    if (arr.length > 200) arr.pop();

    db.query(
        'INSERT INTO console_logs (user_id, message, time) VALUES (?, ?, ?)',
        [userId, msg, entry.time]
    ).catch(() => {});

    db.query(
        `DELETE FROM console_logs WHERE user_id = ? AND id NOT IN (
            SELECT id FROM (
                SELECT id FROM console_logs WHERE user_id = ? ORDER BY id DESC LIMIT 200
            ) t
        )`,
        [userId, userId]
    ).catch(() => {});
}

function extractSessionId(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    return s.includes('::::') ? s.split('::::')[0].trim() : s;
}

function normalisePhone(raw) {
    let rawStr = String(raw).trim();
    let isInt = rawStr.startsWith('+');
    let p = rawStr.replace(/[^0-9]/g, '');
    if (isInt) return p;
    if (p.length === 11 && rawStr.startsWith('0')) return '234' + p.slice(1);
    if (p.length === 10 && ['7','8','9'].includes(p[0])) return '234' + p;
    return p;
}

function patchCredsIfNeeded(sessionFolder) {
    const cp = path.join(sessionFolder, 'creds.json');
    if (!fs.existsSync(cp)) return;
    try {
        const creds = JSON.parse(fs.readFileSync(cp, 'utf8'));
        if (!creds.registered && creds.account && creds.me) {
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
