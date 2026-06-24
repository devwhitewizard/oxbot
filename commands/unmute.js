/**
 * commands/unmute.js
 * Unmute the group (everyone can send)
 */

const name     = 'unmute';
const desc     = 'Unmute the group (everyone can send)';
const category = 'group';

function cleanNum(jid) {
    if (!jid) return '';
    return jid.replace(/[^0-9]/g, '');
}

async function execute(sock, msg, botData, args) {
    const chatId   = msg.key.remoteJid;
    if (!chatId) return null;
    
    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ Group only!' }, { quoted: msg });
    }

    const senderId = msg.key.participant || msg.key.remoteJid;
    const db        = botData?.db;
    const sessionId = botData?.sessionId;
    
    // 1. Check if sender is the Bot Owner
    let senderIsOwner = msg.key.fromMe;
    if (!senderIsOwner && db && sessionId) {
        try {
            const [rows] = await db.query(
                'SELECT u.phone FROM users u JOIN bots b ON b.user_id=u.id WHERE b.session_id=? LIMIT 1',
                [sessionId]
            );
            if (rows.length) {
                const ownerNum = cleanNum(String(rows[0].phone));
                senderIsOwner = cleanNum(senderId) === ownerNum || cleanNum(senderId).endsWith(ownerNum);
            }
        } catch {}
    }

    // 2. If NOT the owner, check if sender is a Group Admin
    if (!msg.key.fromMe && !senderIsOwner) {
        try {
            const meta = await sock.groupMetadata(chatId);
            const senderNum = cleanNum(senderId);
            const senderIsAdmin = meta.participants?.some(p => 
                cleanNum(p.id) === senderNum && 
                (p.admin === 'admin' || p.admin === 'superadmin')
            );

            if (!senderIsAdmin) {
                return await sock.sendMessage(chatId, { text: '❌ Only admins can use this!' }, { quoted: msg });
            }
        } catch {
            return await sock.sendMessage(chatId, { text: '❌ Could not fetch group info.' }, { quoted: msg });
        }
    }

    // 3. ATTEMPT TO UNMUTE (Bypasses Baileys cache bug!)
    try {
        await sock.groupSettingUpdate(chatId, 'not_announcement');
        await sock.sendMessage(chatId, { text: '🔊 *Group unmuted!* Everyone can send messages.' }, { quoted: msg });
    } catch (err) {
        // If WhatsApp rejects it, it means the bot is truly not an admin
        if (err?.message?.includes('not-admin') || err?.output?.statusCode === 400) {
            await sock.sendMessage(chatId, { 
                text: '❌ *Action failed:* I need to be an admin to do this.\n\n_⚠️ If you just made me admin, please REMOVE me from the group and ADD me back in to fix this bug._' 
            }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, { text: `❌ Failed to unmute: ${err.message}` }, { quoted: msg });
        }
    }
}

module.exports = { name, desc, category, execute };
