/**
 * commands/grouplink.js
 * Get group invite link (Admin & Owner Only)
 */

const name     = 'grouplink';
const aliases  = ['link', 'invite'];
const desc     = 'Get group invite link';
const category = 'admin';

// ✅ Robust JID cleaner
function cleanNum(jid) {
    if (!jid) return '';
    return jid.replace(/[^0-9]/g, '');
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ Group only!' }, { quoted: msg });
    }

    const senderId = msg.key.participant || chatId;
    
    // 1. Check if sender is Owner
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

    // 3. Get Group Name for a nice display
    let groupName = 'Unknown Group';
    try {
        const meta = await sock.groupMetadata(chatId);
        groupName = meta.subject || 'Unknown Group';
    } catch (e) {}

    // 4. ATTEMPT TO GET LINK (Bypasses Baileys cache bug!)
    try {
        const code = await sock.groupInviteCode(chatId);
        const link = `https://chat.whatsapp.com/${code}`;

        let text = `╭━━━【 *GROUP INVITE LINK* 】━━━╮\n`;
        text += `│ 📱 *Group:* ${groupName}\n`;
        text += `│ 🔗 *Link:* ${link}\n`;
        text += `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n`;
        text += `⚠️ _Don't share this link publicly!_`;

        await sock.sendMessage(chatId, { text }, { quoted: msg });
    } catch (err) {
        // If WhatsApp rejects it, it means the bot is truly not an admin
        if (err?.message?.includes('not-admin') || err?.output?.statusCode === 400) {
            await sock.sendMessage(chatId, { 
                text: '❌ *Action failed:* I need to be an admin to generate the invite link.\n\n_⚠️ If you just made me admin, please REMOVE me from the group and ADD me back in to fix this bug._' 
            }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, { text: `❌ Failed to get link: ${err.message}` }, { quoted: msg });
        }
    }

    return null;
}

module.exports = { name, aliases, desc, category, execute };