/**
 * commands/setname.js
 * Change group name
 */

const name     = 'setname';
const desc     = 'Change group name';
const category = 'group';

function cleanNum(jid) {
    if (!jid) return '';
    return jid.replace(/[^0-9]/g, '');
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ Groups only.' }, { quoted: msg });
    }

    const senderId = msg.key.participant || chatId;
    const newName = args.join(' ').trim();

    if (!newName) {
        return await sock.sendMessage(chatId, { text: '❌ Usage: .setname <name>' }, { quoted: msg });
    }

    // 1. Check if sender is Owner
    let senderIsOwner = msg.key.fromMe;
    if (!senderIsOwner) {
        const ownerPhone = sock._ownerPhone;
        const senderNum = cleanNum(senderId);
        const ownerNum  = ownerPhone ? cleanNum(ownerPhone) : '';
        
        if (senderNum && ownerNum) {
            const sN = senderNum.startsWith('0') ? senderNum.slice(1) : senderNum;
            const oN = ownerNum.startsWith('0') ? ownerNum.slice(1) : ownerNum;
            senderIsOwner = sN === oN || sN.endsWith(oN) || oN.endsWith(sN);
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
                return await sock.sendMessage(chatId, { text: '❌ You need to be an admin to use this.' }, { quoted: msg });
            }
        } catch {
            return await sock.sendMessage(chatId, { text: '❌ Could not fetch group info.' }, { quoted: msg });
        }
    }

    // 3. ATTEMPT TO CHANGE NAME (Bypasses Baileys cache bug!)
    try {
        await sock.groupUpdateSubject(chatId, newName);
        await sock.sendMessage(chatId, { text: `✅ Group name changed to *${newName}*` }, { quoted: msg });
    } catch (err) {
        // If WhatsApp rejects it, it means the bot is truly not an admin
        if (err?.message?.includes('not-admin') || err?.output?.statusCode === 400) {
            await sock.sendMessage(chatId, { 
                text: '❌ *Action failed:* I need to be an admin to change the group name.\n\n_⚠️ If you just made me admin, please REMOVE me from the group and ADD me back in to fix this bug._' 
            }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, { text: `❌ Failed to change group name: ${err.message}` }, { quoted: msg });
        }
    }

    return null;
}

module.exports = { name, desc, category, execute };