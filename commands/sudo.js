/**
 * commands/sudo.js
 *
 * Sudo system — owner can grant trusted users access to owner-only commands.
 *
 * .sudo add @user     — add sudo user (owner only)
 * .sudo remove @user  — remove sudo user (owner only)
 * .sudo list          — list all sudo users (anyone can check)
 *
 * Sudo users are stored in DB table: bot_sudo
 * commands/index.js isOwnerAsync() is automatically aware of sudo users
 * because we expose isSudo() below and patch it in.
 */

const name     = 'sudo';
const desc     = 'Manage sudo (trusted) users who can use owner commands';
const category = 'owner';
const aliases  = ['trust'];

// ─── same cleanNum as promote.js ─────────────────────────────────────────────
function cleanNum(jid) {
    if (!jid) return '';
    return jid.replace(/[^0-9]/g, '');
}

// ─── in-memory sudo cache (avoid DB hit on every message) ────────────────────
// keyed by sessionId → Set of phone numbers (digits only, no @s.whatsapp.net)
const sudoCache = new Map(); // sessionId → { nums: Set<string>, ts: number }
const SUDO_TTL  = 60_000;   // refresh every 60s

async function getSudoNums(db, sessionId) {
    if (!db || !sessionId) return new Set();

    const c = sudoCache.get(sessionId);
    if (c && Date.now() - c.ts < SUDO_TTL) return c.nums;

    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS bot_sudo (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                session_id VARCHAR(100) NOT NULL,
                user_jid   VARCHAR(100) NOT NULL,
                added_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_session_user (session_id, user_jid)
            )
        `).catch(() => {});

        const [rows] = await db.query(
            'SELECT user_jid FROM bot_sudo WHERE session_id = ?',
            [sessionId]
        );

        const nums = new Set(rows.map(r => cleanNum(r.user_jid)));
        sudoCache.set(sessionId, { nums, ts: Date.now() });
        return nums;
    } catch {
        return new Set();
    }
}

function bustSudoCache(sessionId) {
    if (sessionId) sudoCache.delete(sessionId);
}

// ─── exported helper — used by index.js isOwnerAsync() ───────────────────────
async function isSudo(sock, senderJid, db) {
    const sessionId = sock?._ownerPhone || cleanNum(sock?.user?.id || '');
    if (!sessionId || !senderJid) return false;

    const nums      = await getSudoNums(db, sessionId);
    const senderNum = cleanNum(senderJid);
    if (!senderNum) return false;

    const sNorm = senderNum.startsWith('0') ? senderNum.slice(1) : senderNum;
    for (const n of nums) {
        const nNorm = n.startsWith('0') ? n.slice(1) : n;
        if (sNorm === nNorm || sNorm.endsWith(nNorm) || nNorm.endsWith(sNorm)) return true;
    }
    return false;
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function execute(sock, msg, botData, args) {
    const chatId    = msg.key.remoteJid;
    const senderId  = msg.key.participant || msg.key.remoteJid;
    const db        = botData?.db;
    const sessionId = sock?._ownerPhone || cleanNum(sock?.user?.id || '');

    // ── sub-command ───────────────────────────────────────────────────────────
    const sub = (args[0] || '').toLowerCase();

    if (!sub || !['add', 'remove', 'del', 'list'].includes(sub)) {
        return await sock.sendMessage(chatId, {
            text:
                `*『 🛡️ SUDO SYSTEM 』*\n\n` +
                `*.sudo add @user*    — grant sudo access\n` +
                `*.sudo remove @user* — revoke sudo access\n` +
                `*.sudo list*         — view all sudo users\n\n` +
                `_Sudo users can use owner-only bot commands._`
        }, { quoted: msg });
    }

    // ── .sudo list — anyone can view ──────────────────────────────────────────
    if (sub === 'list') {
        if (!db) {
            return await sock.sendMessage(chatId, {
                text: '❌ Database not available.'
            }, { quoted: msg });
        }

        try {
            const [rows] = await db.query(
                'SELECT user_jid, added_at FROM bot_sudo WHERE session_id = ? ORDER BY added_at ASC',
                [sessionId]
            );

            if (!rows.length) {
                return await sock.sendMessage(chatId, {
                    text: `*『 🛡️ SUDO LIST 』*\n\n_No sudo users set yet._\n\nUse *.sudo add @user* to add one.`
                }, { quoted: msg });
            }

            const lines = rows.map((r, i) => {
                const num  = cleanNum(r.user_jid);
                const date = new Date(r.added_at).toLocaleDateString();
                return `${i + 1}. +${num}  _(added ${date})_`;
            }).join('\n');

            return await sock.sendMessage(chatId, {
                text: `*『 🛡️ SUDO USERS 』*\n\n${lines}\n\n_Total: ${rows.length}_`
            }, { quoted: msg });

        } catch (err) {
            console.error('[sudo] list error:', err.message);
            return await sock.sendMessage(chatId, {
                text: '❌ Failed to fetch sudo list.'
            }, { quoted: msg });
        }
    }

    // ── add / remove — owner only ─────────────────────────────────────────────

    // STEP 1: owner check (same as promote.js)
    let senderIsOwner = msg.key.fromMe;
    if (!senderIsOwner) {
        const ownerPhone = sock._ownerPhone;
        const senderNum  = cleanNum(senderId);
        const ownerNum   = ownerPhone ? cleanNum(ownerPhone) : '';

        if (senderNum && ownerNum) {
            const sNorm = senderNum.startsWith('0') ? senderNum.slice(1) : senderNum;
            const oNorm = ownerNum.startsWith('0')  ? ownerNum.slice(1)  : ownerNum;
            senderIsOwner = sNorm === oNorm || sNorm.endsWith(oNorm) || oNorm.endsWith(sNorm);
        }
    }

    if (!senderIsOwner) {
        return await sock.sendMessage(chatId, {
            text: '❌ Only the *bot owner* can add or remove sudo users.'
        }, { quoted: msg });
    }

    // STEP 2: resolve target
    const target =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        msg.message?.extendedTextMessage?.contextInfo?.participant        ||
        (() => {
            // fallback: raw number in args e.g. .sudo add 2348012345678
            const num = (args[1] || '').replace(/\D/g, '');
            return num.length >= 7 ? num + '@s.whatsapp.net' : null;
        })();

    if (!target) {
        return await sock.sendMessage(chatId, {
            text: `❌ Mention or reply to a user!\n_Example: *.sudo ${sub} @user*_`
        }, { quoted: msg });
    }

    // STEP 3: block adding/removing the owner themselves
    const targetNum = cleanNum(target);
    const ownerNum  = cleanNum(sock._ownerPhone || '');
    if (ownerNum && targetNum) {
        const tNorm = targetNum.startsWith('0') ? targetNum.slice(1) : targetNum;
        const oNorm = ownerNum.startsWith('0')  ? ownerNum.slice(1)  : ownerNum;
        if (tNorm === oNorm || tNorm.endsWith(oNorm) || oNorm.endsWith(tNorm)) {
            return await sock.sendMessage(chatId, {
                text: `ℹ️ You are already the owner — no need to add yourself as sudo.`
            }, { quoted: msg });
        }
    }

    if (!db) {
        return await sock.sendMessage(chatId, {
            text: '❌ Database not available.'
        }, { quoted: msg });
    }

    // STEP 4: add or remove
    if (sub === 'add') {
        try {
            await db.query(`
                INSERT INTO bot_sudo (session_id, user_jid)
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE added_at = added_at
            `, [sessionId, target]);

            bustSudoCache(sessionId);

            await sock.sendMessage(chatId, {
                text:
                    `*『 ✅ SUDO GRANTED 』*\n\n` +
                    `👤 *User:* @${target.split('@')[0]}\n` +
                    `🛡️ *Role:* Sudo\n\n` +
                    `_They can now use owner-only commands._`,
                mentions: [target],
            }, { quoted: msg });

        } catch (err) {
            console.error('[sudo] add error:', err.message);
            await sock.sendMessage(chatId, {
                text: `❌ Failed to add sudo user: ${err.message}`
            }, { quoted: msg });
        }

    } else {
        // remove / del
        try {
            const [result] = await db.query(
                'DELETE FROM bot_sudo WHERE session_id = ? AND user_jid = ?',
                [sessionId, target]
            );

            bustSudoCache(sessionId);

            if (result.affectedRows === 0) {
                return await sock.sendMessage(chatId, {
                    text: `⚠️ @${target.split('@')[0]} is not a sudo user.`,
                    mentions: [target],
                }, { quoted: msg });
            }

            await sock.sendMessage(chatId, {
                text:
                    `*『 🗑️ SUDO REVOKED 』*\n\n` +
                    `👤 *User:* @${target.split('@')[0]}\n\n` +
                    `_They no longer have sudo access._`,
                mentions: [target],
            }, { quoted: msg });

        } catch (err) {
            console.error('[sudo] remove error:', err.message);
            await sock.sendMessage(chatId, {
                text: `❌ Failed to remove sudo user: ${err.message}`
            }, { quoted: msg });
        }
    }
}

module.exports = { name, desc, category, aliases, execute, isSudo };