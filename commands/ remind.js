/**
 * remind.js — Smart Reminder System
 * Aliases: .remind, .reminder, .remindme, .setreminder
 *
 * Usage:
 *   .remind 30m Call John
 *   .remind 2h Meeting with team
 *   .remind 1d Pay rent
 *   .remind 3d Submit report
 *   .remind 1w Birthday party
 *   .remind 2 weeks Check invoice
 *   .remind in 3 hours Take medicine
 *   .remind tomorrow morning Wake up early
 *   .remind 25/12 Christmas celebration
 *   .reminders     — list your active reminders
 *   .cancelremind  — cancel a reminder
 */

// ─── In-memory store ──────────────────────────────────────────────────────────
// Map<userId, Reminder[]>
// Reminder = { id, chatId, jid, text, fireAt, setAt, timer }
const reminders = new Map();
let reminderCounter = 1;

// ─── Time parser ──────────────────────────────────────────────────────────────
/**
 * Parse natural language time from args array
 * Returns { ms, label } or null if unparseable
 */
function parseTime(args) {
    const raw = args.join(' ').toLowerCase().trim();

    // ── Shorthand: 30m / 2h / 1d / 3w ───────────────────────────────────────
    const shortMatch = raw.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|day|days?|w|wk|wks|weeks?)/i);
    if (shortMatch) {
        const num  = parseFloat(shortMatch[1]);
        const unit = shortMatch[2].toLowerCase();
        let ms = 0;
        if (/^m/.test(unit))    ms = num * 60 * 1000;
        else if (/^h/.test(unit)) ms = num * 60 * 60 * 1000;
        else if (/^d/.test(unit)) ms = num * 24 * 60 * 60 * 1000;
        else if (/^w/.test(unit)) ms = num * 7 * 24 * 60 * 60 * 1000;
        if (ms > 0) return { ms, label: formatDuration(ms) };
    }

    // ── "in X unit" ───────────────────────────────────────────────────────────
    const inMatch = raw.match(/^in\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|wks?)/i);
    if (inMatch) {
        const num  = parseFloat(inMatch[1]);
        const unit = inMatch[2].toLowerCase();
        let ms = 0;
        if (/^min/.test(unit))  ms = num * 60 * 1000;
        else if (/^h/.test(unit)) ms = num * 60 * 60 * 1000;
        else if (/^d/.test(unit)) ms = num * 24 * 60 * 60 * 1000;
        else if (/^w/.test(unit)) ms = num * 7 * 24 * 60 * 60 * 1000;
        if (ms > 0) return { ms, label: formatDuration(ms) };
    }

    // ── "tomorrow" ────────────────────────────────────────────────────────────
    if (/^tomorrow/.test(raw)) {
        const ms = 24 * 60 * 60 * 1000;
        return { ms, label: 'tomorrow (24 hours)' };
    }

    // ── "next week" ───────────────────────────────────────────────────────────
    if (/^next\s+week/.test(raw)) {
        const ms = 7 * 24 * 60 * 60 * 1000;
        return { ms, label: 'next week (7 days)' };
    }

    // ── "next month" ─────────────────────────────────────────────────────────
    if (/^next\s+month/.test(raw)) {
        const ms = 30 * 24 * 60 * 60 * 1000;
        return { ms, label: 'next month (30 days)' };
    }

    // ── Date format: DD/MM or DD/MM/YYYY ─────────────────────────────────────
    const dateMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
    if (dateMatch) {
        const day   = parseInt(dateMatch[1]);
        const month = parseInt(dateMatch[2]) - 1;
        const year  = dateMatch[3]
            ? (dateMatch[3].length === 2 ? 2000 + parseInt(dateMatch[3]) : parseInt(dateMatch[3]))
            : new Date().getFullYear();

        const target = new Date(year, month, day, 9, 0, 0); // 9 AM on that day
        const now    = Date.now();

        // If date already passed this year, move to next year
        if (target.getTime() <= now) target.setFullYear(target.getFullYear() + 1);

        const ms = target.getTime() - now;
        if (ms > 0) {
            return {
                ms,
                label: target.toLocaleDateString('en-GB', {
                    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                }),
            };
        }
    }

    return null;
}

/**
 * Split args into [timePart, messagePart]
 * Strategy: try to find where the time expression ends and message begins
 */
function splitTimeAndMessage(args) {
    if (!args || args.length === 0) return { timeArgs: [], messageArgs: [] };

    const raw = args.join(' ');

    // ── Pattern: starts with "in X unit message" ──────────────────────────────
    const inPattern = raw.match(/^(in\s+\d+(?:\.\d+)?\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|wks?))\s+(.+)/i);
    if (inPattern) {
        return {
            timeArgs:    inPattern[1].split(' '),
            messageArgs: inPattern[2].split(' '),
        };
    }

    // ── Pattern: starts with "tomorrow/next week/next month message" ──────────
    const relPattern = raw.match(/^(tomorrow|next\s+week|next\s+month)\s+(.+)/i);
    if (relPattern) {
        return {
            timeArgs:    relPattern[1].split(' '),
            messageArgs: relPattern[2].split(' '),
        };
    }

    // ── Pattern: shorthand "2h message" or "30m do something" ────────────────
    const shortPattern = raw.match(/^(\d+(?:\.\d+)?\s*(?:m|min|mins|minutes?|h|hr|hrs|hours?|d|day|days?|w|wk|wks|weeks?))\s+(.+)/i);
    if (shortPattern) {
        return {
            timeArgs:    shortPattern[1].split(' '),
            messageArgs: shortPattern[2].split(' '),
        };
    }

    // ── Pattern: date "25/12 message" ────────────────────────────────────────
    const datePattern = raw.match(/^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+)/i);
    if (datePattern) {
        return {
            timeArgs:    datePattern[1].split(' '),
            messageArgs: datePattern[2].split(' '),
        };
    }

    // Fallback: first token is time, rest is message
    return {
        timeArgs:    [args[0]],
        messageArgs: args.slice(1),
    };
}

// ─── Format helpers ───────────────────────────────────────────────────────────
function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const weeks   = Math.floor(totalSeconds / (7 * 24 * 3600));
    const days    = Math.floor((totalSeconds % (7 * 24 * 3600)) / (24 * 3600));
    const hours   = Math.floor((totalSeconds % (24 * 3600)) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    const parts = [];
    if (weeks)   parts.push(`${weeks} week${weeks > 1 ? 's' : ''}`);
    if (days)    parts.push(`${days} day${days > 1 ? 's' : ''}`);
    if (hours)   parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
    if (minutes) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
    return parts.length ? parts.join(', ') : 'less than a minute';
}

function formatFireTime(ms) {
    return new Date(Date.now() + ms).toLocaleString('en-GB', {
        weekday: 'short',
        day:     'numeric',
        month:   'short',
        year:    'numeric',
        hour:    '2-digit',
        minute:  '2-digit',
        hour12:  true,
    });
}

// ─── Reminder store helpers ───────────────────────────────────────────────────
function getUserReminders(jid) {
    if (!reminders.has(jid)) reminders.set(jid, []);
    return reminders.get(jid);
}

function addReminder(jid, chatId, text, ms, label, fireAt) {
    const list = getUserReminders(jid);
    const id   = reminderCounter++;

    const timer = setTimeout(async () => {
        fireReminder(id, jid, chatId, text);
    }, ms);

    list.push({ id, chatId, jid, text, label, fireAt, setAt: Date.now(), timer });
    return id;
}

async function fireReminder(id, jid, chatId, text) {
    // Remove from list
    if (reminders.has(jid)) {
        const list = reminders.get(jid);
        const idx  = list.findIndex(r => r.id === id);
        if (idx !== -1) list.splice(idx, 1);
    }

    // We need the sock — stored globally per reminder fire
    const sockRef = globalSockMap.get(jid);
    if (!sockRef) return;

    try {
        await sockRef.sendMessage(chatId, {
            text: `⏰ *REMINDER!*\n\n📌 ${text}\n\n_This reminder was set by you._`,
        });
    } catch (err) {
        console.error('[REMIND] Failed to fire reminder:', err.message);
    }
}

function cancelReminder(jid, id) {
    const list = getUserReminders(jid);
    const idx  = list.findIndex(r => r.id === id);
    if (idx === -1) return false;
    clearTimeout(list[idx].timer);
    list.splice(idx, 1);
    return true;
}

// ─── Global sock map (jid → sock) so reminder can fire later ─────────────────
// We store the sock per sender JID so the timer can send the reminder
const globalSockMap = new Map();

// ─── Execute ──────────────────────────────────────────────────────────────────
async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const sender = msg.key.participant || msg.key.remoteJid;
    const jid    = sender.split(':')[0].split('@')[0] + '@s.whatsapp.net';

    // Keep sock reference for this user so reminder can fire
    globalSockMap.set(jid, sock);
    // Also keep by chatId for group reminders
    globalSockMap.set(chatId, sock);

    // ── No args — show usage ──────────────────────────────────────────────────
    if (!args || args.length === 0) {
        return `⏰ *REMINDER SYSTEM*

*Set a reminder:*
\`.remind <time> <message>\`

*Time formats:*
• \`.remind 30m Call John\`
• \`.remind 2h Take medicine\`
• \`.remind 1d Submit assignment\`
• \`.remind 3d Pay rent\`
• \`.remind 1w Birthday party\`
• \`.remind 2 weeks Check invoice\`
• \`.remind in 3 hours Meeting\`
• \`.remind tomorrow Wake up early\`
• \`.remind next week Doctor appointment\`
• \`.remind 25/12 Christmas celebration\`
• \`.remind 01/01/2026 New Year event\`

*Manage reminders:*
• \`.reminders\` — view your active reminders
• \`.cancelremind <ID>\` — cancel a reminder`;
    }

    const cmdWord = (args[0] || '').toLowerCase();

    // ── .reminders — list active reminders ───────────────────────────────────
    if (cmdWord === 'list' || cmdWord === 'all') {
        const list = getUserReminders(jid);
        if (!list.length) return `📭 You have no active reminders.\n\nSet one with: \`.remind 1h Do something\``;

        const lines = list.map(r =>
            `*#${r.id}* — ⏰ ${r.label}\n📌 ${r.text}\n🗓 Fires: ${new Date(r.fireAt).toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', hour12:true })}`
        ).join('\n\n');

        return `⏰ *YOUR ACTIVE REMINDERS* (${list.length})\n\n${lines}\n\n_Cancel with: .cancelremind <ID>_`;
    }

    // ── .cancelremind <id> — cancel a reminder ────────────────────────────────
    if (cmdWord === 'cancel' || cmdWord === 'delete' || cmdWord === 'remove') {
        const id = parseInt(args[1]);
        if (isNaN(id)) return `❌ Please provide a reminder ID.\nExample: \`.remind cancel 3\``;
        const ok = cancelReminder(jid, id);
        return ok
            ? `✅ Reminder *#${id}* cancelled successfully.`
            : `❌ No reminder found with ID *#${id}*.\n\nCheck your reminders with: \`.reminders\``;
    }

    // ── Set a new reminder ────────────────────────────────────────────────────
    const { timeArgs, messageArgs } = splitTimeAndMessage(args);

    if (!messageArgs || messageArgs.length === 0) {
        return `❌ Please include a message for the reminder.\n\nExample: \`.remind 2h Take medicine\``;
    }

    const parsed = parseTime(timeArgs);
    if (!parsed) {
        return `❌ *Could not understand the time:* "${timeArgs.join(' ')}"\n\n*Try formats like:*\n• \`30m\` \`2h\` \`1d\` \`1w\`\n• \`in 3 hours\`\n• \`tomorrow\`\n• \`next week\`\n• \`25/12\``;
    }

    const { ms, label } = parsed;

    // Minimum 1 minute
    if (ms < 60 * 1000) {
        return `❌ Minimum reminder time is *1 minute*.\n\nExample: \`.remind 5m Check oven\``;
    }

    // Maximum 1 year
    if (ms > 365 * 24 * 60 * 60 * 1000) {
        return `❌ Maximum reminder time is *1 year*.`;
    }

    // Max 10 reminders per user
    const list = getUserReminders(jid);
    if (list.length >= 10) {
        return `❌ You can only have *10 active reminders* at a time.\n\nCancel one first with \`.remind cancel <ID>\``;
    }

    const reminderText = messageArgs.join(' ');
    const fireAt       = Date.now() + ms;
    const id           = addReminder(jid, chatId, reminderText, ms, label, fireAt);

    return `✅ *Reminder Set!*

📌 *Message:* ${reminderText}
⏰ *In:* ${label}
🗓 *Fires at:* ${formatFireTime(ms)}
🆔 *Reminder ID:* #${id}

_I'll message you here when the time comes!_
_Cancel anytime: \`.remind cancel ${id}\`_`;
}

// ─── Named exports for .reminders and .cancelremind aliases ──────────────────
// These are handled inside execute() via args[0] keyword detection
// But we also register them as separate commands via aliases

module.exports = {
    name:     'remind',
    aliases:  ['reminder', 'remindme', 'setreminder', 'reminders', 'cancelremind'],
    desc:     'Set a reminder — bot will message you when time is up',
    category: 'utility',
    execute,
};