/**
 * OxBot — View Once Command (vv)
 * Secretly sends opened view-once media to Owner's DM
 * Deletes the .vv command message immediately — zero trace
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// ✅ Fast JID cleaner (matches handler.js and promote.js)
const clean = (jid) => jid ? jid.split(':')[0].split('@')[0] : '';

// ═══════════════════════════════════════════════════
// DAILY USAGE TRACKING (Free Trial Limit)
// ═══════════════════════════════════════════════════
const FREE_DAILY_LIMIT = 50;
const dailyUsage = new Map();

function getDailyUsage(sessionId) {
    const today = new Date().toISOString().split('T')[0];
    const entry = dailyUsage.get(sessionId);
    if (!entry || entry.date !== today) {
        const fresh = { date: today, count: 0 };
        dailyUsage.set(sessionId, fresh);
        return fresh;
    }
    return entry;
}

function canUseFree(sessionId) {
    return getDailyUsage(sessionId).count < FREE_DAILY_LIMIT;
}

function incrementUsage(sessionId) {
    getDailyUsage(sessionId).count++;
}

function getRemainingUses(sessionId) {
    return Math.max(0, FREE_DAILY_LIMIT - getDailyUsage(sessionId).count);
}

setInterval(() => {
    const today = new Date().toISOString().split('T')[0];
    for (const [sid, entry] of dailyUsage) {
        if (entry.date !== today) dailyUsage.delete(sid);
    }
}, 6 * 60 * 60 * 1000);

// ═══════════════════════════════════════════════════
// PRO CHECK
// ═══════════════════════════════════════════════════

async function getOwnerUserId(db, sessionId) {
    if (!db || !sessionId) return null;
    try {
        let [rows] = await db.query(
            'SELECT user_id, session_id FROM bots WHERE session_id=? LIMIT 1', [sessionId]
        );
        if (rows.length) return { userId: rows[0].user_id, dbSessionId: rows[0].session_id };
        if (!String(sessionId).startsWith('oxbot_')) {
            [rows] = await db.query(
                'SELECT user_id, session_id FROM bots WHERE session_id=? LIMIT 1', [`oxbot_${sessionId}`]
            );
            if (rows.length) return { userId: rows[0].user_id, dbSessionId: rows[0].session_id };
        }
        return null;
    } catch (err) {
        console.error('[vv] getOwnerUserId error:', err.message);
        return null;
    }
}

async function isProUser(db, userId) {
    if (!userId) return false;
    try {
        const [rows] = await db.query(
            `SELECT id FROM pro_subscriptions WHERE user_id=? AND status='active' AND expires_at > NOW() LIMIT 1`,
            [userId]
        );
        return rows.length > 0;
    } catch (err) {
        console.error('[vv] isProUser error:', err.message);
        return false;
    }
}

async function isSessionPro(db, sessionId) {
    if (!db || !sessionId) return true;
    const ownerData = await getOwnerUserId(db, sessionId);
    return await isProUser(db, ownerData?.userId);
}

// ═══════════════════════════════════════════════════
// MAIN COMMAND
// ═══════════════════════════════════════════════════

async function execute(sock, msg, botData, args) {
    const chatId   = msg.key.remoteJid;
    const senderId = msg.key.participant || msg.key.remoteJid;
    const sessionId = botData?.sessionId;
    const db = botData?.db;

    // ── 1. Fast Owner Check ──────────────────────────────────
    let isOwner = msg.key.fromMe;
    if (!isOwner && sock._ownerPhone) {
        const senderNum = clean(senderId).replace(/\D/g, '');
        const ownerNum  = sock._ownerPhone.replace(/\D/g, '');
        if (senderNum && ownerNum) {
            const sN = senderNum.startsWith('0') ? senderNum.slice(1) : senderNum;
            const oN = ownerNum.startsWith('0') ? ownerNum.slice(1) : ownerNum;
            isOwner = sN === oN || sN.endsWith(oN) || oN.endsWith(sN);
        }
    }

    // Non-owners: completely ignored — no trace
    if (!isOwner) return null;

    // Owner's private DM JID
    const ownerJid = sock._ownerPhone + '@s.whatsapp.net';

    // ── 2. Get Media from Quoted Message ─────────────────────
    const quoted      = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedImage = quoted?.imageMessage;
    const quotedVideo = quoted?.videoMessage;

    const isViewOnceImage = quotedImage && quotedImage.viewOnce;
    const isViewOnceVideo = quotedVideo && quotedVideo.viewOnce;

    if (!isViewOnceImage && !isViewOnceVideo) {
        // Delete the .vv message first, then warn in DM
        await sock.sendMessage(chatId, { delete: msg.key }).catch(() => {});
        await sock.sendMessage(ownerJid, {
            text: '⚠️ Please reply to a view-once image or video.'
        }).catch(() => {});
        return null;
    }

    // ── 3. Pro / Free Limit Check ────────────────────────────
    const pro = await isSessionPro(db, sessionId);

    if (!pro) {
        if (!canUseFree(sessionId)) {
            // Delete .vv message immediately
            await sock.sendMessage(chatId, { delete: msg.key }).catch(() => {});

            const now = new Date();
            const midnight = new Date(now);
            midnight.setHours(24, 0, 0, 0);
            const msUntilMidnight = midnight - now;
            const hoursLeft = Math.floor(msUntilMidnight / (1000 * 60 * 60));
            const minsLeft = Math.floor((msUntilMidnight % (1000 * 60 * 60)) / (1000 * 60));

            await sock.sendMessage(ownerJid, {
                text: `⚠️ *Daily Limit Reached!*\n\n` +
                      `You've used all *${FREE_DAILY_LIMIT} free view-once opens* for today.\n\n` +
                      `🕐 *Resets in:* ~${hoursLeft}h ${minsLeft}m\n\n` +
                      `👑 *Want unlimited?* Upgrade to Pro:\nhttps://oxbot.name.ng/dashboard`
            }).catch(() => {});
            return null;
        }
    }

    // ── 4. DELETE the .vv message immediately ────────────────
    //    This happens BEFORE download so it vanishes instantly.
    //    Since the bot IS the owner's account, fromMe=true allows deletion.
    await sock.sendMessage(chatId, { delete: msg.key }).catch(() => {});

    // ── 5. Download the media ────────────────────────────────
    try {
        let buffer, type;
        let originalCaption = '';

        if (isViewOnceImage) {
            const stream = await downloadContentFromMessage(quotedImage, 'image');
            buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            type = 'image';
            originalCaption = quotedImage.caption || '';
        } else {
            const stream = await downloadContentFromMessage(quotedVideo, 'video');
            buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            type = 'video';
            originalCaption = quotedVideo.caption || '';
        }

        // ── 6. Increment usage (free only) ───────────────────
        if (!pro) incrementUsage(sessionId);

        // ── 7. Send to Owner's DM ────────────────────────────
        const senderTag = `@${clean(senderId)}`;
        const isGroup   = chatId.endsWith('@g.us');
        const location  = isGroup ? '👥 Group Chat' : '👤 Direct Message';

        let usageFooter = '';
        if (!pro) {
            const remaining = getRemainingUses(sessionId);
            usageFooter = `\n\n📊 *Free Trial:* ${remaining}/${FREE_DAILY_LIMIT} remaining today`;
        }

        const dmText = `🔓 *View-Once Revealed*\n\n` +
                       `👤 *From:* ${senderTag}\n` +
                       `📍 *Location:* ${location}\n` +
                       (originalCaption ? `💬 *Caption:* ${originalCaption}\n` : '') +
                       `_⬆️ Downloaded secretly — no trace left_${usageFooter}`;

        if (type === 'image') {
            await sock.sendMessage(ownerJid, {
                image: buffer,
                caption: dmText,
                mentions: [senderId]
            });
        } else if (type === 'video') {
            await sock.sendMessage(ownerJid, {
                video: buffer,
                caption: dmText,
                mentions: [senderId]
            });
        }

        return null;

    } catch (err) {
        console.error('[vv] Download error:', err.message);
        await sock.sendMessage(ownerJid, {
            text: `❌ Failed to download view-once media: ${err.message}`
        }).catch(() => {});
        return null;
    }
}

module.exports = {
    name: 'vv',
    aliases: ['viewonce', 'antiviewonce'],
    desc: 'View once media revealer (50/day free, unlimited Pro)',
    category: 'owner',
    execute
};