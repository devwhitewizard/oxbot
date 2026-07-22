/**
 * commands/add.js
 * Add a user to the group
 */
 //fixed

const name     = 'add';
const desc     = 'Add a user to the group';
const category = 'group';

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

    if (!args.length) {
        return await sock.sendMessage(chatId, {
            text: '❌ Provide a number!\n_*.add 2348012345678*_'
        }, { quoted: msg });
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

    // 3. Normalize number (Kept your exact 234 logic)
    let number = args[0].replace(/[^0-9]/g, '');
    if (number.startsWith('0')) number = '234' + number.slice(1);
    if (number.length < 7) {
        return await sock.sendMessage(chatId, { text: '❌ Invalid number!' }, { quoted: msg });
    }
    const jid = number + '@s.whatsapp.net';

    // 4. ATTEMPT TO ADD (Bypasses Baileys cache bug!)
    try {
        const result = await sock.groupParticipantsUpdate(chatId, [jid], 'add');
        const status = result?.[0]?.status;

        if (status === '403') {
            return await sock.sendMessage(chatId, {
                text: `❌ @${number} has restricted who can add them to groups.`,
                mentions: [jid]
            }, { quoted: msg });
        }
        if (status === '408') {
            return await sock.sendMessage(chatId, {
                text: `❌ @${number} is not on WhatsApp or the number is invalid.`,
                mentions: [jid]
            }, { quoted: msg });
        }

        await sock.sendMessage(chatId, {
            text: `✅ Successfully added @${number} to the group!`,
            mentions: [jid]
        }, { quoted: msg });

    } catch (err) {
        // If WhatsApp rejects it, it means the bot is truly not an admin
        if (err?.message?.includes('not-admin') || err?.output?.statusCode === 400) {
            await sock.sendMessage(chatId, { 
                text: '❌ *Action failed:* I need to be an admin to add members.\n\n_⚠️ If you just made me admin, please REMOVE me from the group and ADD me back in to fix this bug._' 
            }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, {
                text: `❌ Failed to add: ${err.message || 'They might have strict privacy settings enabled.'}`
            }, { quoted: msg });
        }
    }

    return null;
}

module.exports = { name, desc, category, execute };
