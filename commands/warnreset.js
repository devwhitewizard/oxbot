/**
 * commands/warnreset.js
 * Reset warnings for a mentioned or replied-to user.
 */

const name     = 'warnreset';
const desc     = 'Reset warnings for a user';
const category = 'group';
const aliases  = ['resetwarn', 'clearwarn'];

function cleanNum(jid) {
    if (!jid) return '';
    return jid.replace(/[^0-9]/g, '');
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId?.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, {
            text: '❌ Group only command.'
        }, { quoted: msg });
    }

    const senderId = msg.key.participant || msg.key.remoteJid;
    const db       = botData?.db;

    // owner check
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

    // admin check
    if (!msg.key.fromMe && !senderIsOwner) {
        let meta;
        try { meta = await sock.groupMetadata(chatId); } catch {
            return await sock.sendMessage(chatId, { text: '❌ Could not fetch group info.' }, { quoted: msg });
        }
        const senderNum     = cleanNum(senderId);
        const senderIsAdmin = (meta.participants || []).some(p => {
            const pNum  = cleanNum(p.id);
            const sNorm = senderNum.startsWith('0') ? senderNum.slice(1) : senderNum;
            const pNorm = pNum.startsWith('0')      ? pNum.slice(1)      : pNum;
            return (pNorm === sNorm || pNorm.endsWith(sNorm) || sNorm.endsWith(pNorm))
                && (p.admin === 'admin' || p.admin === 'superadmin');
        });
        if (!senderIsAdmin) {
            return await sock.sendMessage(chatId, {
                text: '❌ Only admins can reset warnings!'
            }, { quoted: msg });
        }
    }

    // resolve target
    const target =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        msg.message?.extendedTextMessage?.contextInfo?.participant        ||
        null;

    if (!target) {
        return await sock.sendMessage(chatId, {
            text: '❌ Mention or reply to a user!\n_Example: *.warnreset @user*_'
        }, { quoted: msg });
    }

    // clear from DB or memory
    if (db) {
        await db.query(
            'DELETE FROM bot_warnings WHERE chat_id = ? AND user_id = ?',
            [chatId, target]
        ).catch(() => {});
    } else if (global._oxbotWarnings?.[chatId]) {
        delete global._oxbotWarnings[chatId][target];
    }

    await sock.sendMessage(chatId, {
        text: `✅ Warnings cleared for @${target.split('@')[0]}.`,
        mentions: [target],
    }, { quoted: msg });
}

module.exports = { name, desc, category, aliases, execute };