/**
 * commands/promote.js
 * Promote a user to admin
 */

const name     = 'promote';
const desc     = 'Promote a user to admin';
const category = 'group';

// ✅ Robust JID cleaner (strips @s.whatsapp.net, @lid, :0)
function cleanNum(jid) {
    if (!jid) return '';
    return jid.replace(/[^0-9]/g, '');
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ Group only command!' }, { quoted: msg });
    }

    const senderId = msg.key.participant || msg.key.remoteJid;
    
    // 1. Fast owner check using socket identity
    let senderIsOwner = msg.key.fromMe;
    if (!senderIsOwner) {
        const ownerPhone = sock._ownerPhone;
        const senderNum = cleanNum(senderId);
        const ownerNum  = ownerPhone ? cleanNum(ownerPhone) : '';
        
        if (senderNum && ownerNum) {
            const sNorm = senderNum.startsWith('0') ? senderNum.slice(1) : senderNum;
            const oNorm = ownerNum.startsWith('0') ? ownerNum.slice(1) : ownerNum;
            senderIsOwner = sNorm === oNorm || sNorm.endsWith(oNorm) || oNorm.endsWith(sNorm);
        }
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

    // 3. Extract target users (Mentions or Reply)
    let targets = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!targets.length && msg.message?.extendedTextMessage?.contextInfo?.participant) {
        targets = [msg.message.extendedTextMessage.contextInfo.participant];
    }
    
    if (!targets.length) {
        return await sock.sendMessage(chatId, { text: '❌ Mention or reply to a user!\n_*.promote @user*_' }, { quoted: msg });
    }

    // 4. ATTEMPT TO PROMOTE (Bypasses Baileys cache bug!)
    try {
        await sock.groupParticipantsUpdate(chatId, targets, 'promote');
        
        const names = targets.map(j => `@${j.split('@')[0]}`).join(', ');
        await sock.sendMessage(chatId, {
            text: `✅ *Promoted:* ${names}\n👑 *By:* @${cleanNum(senderId)}`,
            mentions: [...targets, senderId]
        }, { quoted: msg });
    } catch (err) {
        // If WhatsApp rejects it, it means the bot is truly not an admin
        if (err?.message?.includes('not-admin') || err?.output?.statusCode === 400) {
            await sock.sendMessage(chatId, { 
                text: '❌ *Action failed:* I need to be an admin to promote members.\n\n_⚠️ If you just made me admin, please REMOVE me from the group and ADD me back in to fix this bug._' 
            }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, { text: `❌ Failed to promote: ${err.message}` }, { quoted: msg });
        }
    }
}

module.exports = { name, desc, category, execute };
