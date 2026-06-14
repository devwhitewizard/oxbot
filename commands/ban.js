const fs = require('fs');
const path = require('path');

const BAN_FILE = './data/banned.json';

// Ensure data folder exists
const dataDir = path.dirname(BAN_FILE);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

function getBanned() {
    if (!fs.existsSync(BAN_FILE)) fs.writeFileSync(BAN_FILE, '[]');
    try {
        return JSON.parse(fs.readFileSync(BAN_FILE, 'utf8'));
    } catch {
        return [];
    }
}

function saveBanned(list) {
    fs.writeFileSync(BAN_FILE, JSON.stringify(list, null, 2));
}

// Clean target number/jid helper
function cleanNumber(jid) {
    if (!jid) return '';
    return jid.split(':')[0].split('@')[0];
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const senderId = msg.key.participant || msg.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');

    // Fetch owner phone from DB (similar to other commands)
    const db = botData?.db;
    const sessionId = botData?.sessionId;
    let senderIsOwner = msg.key.fromMe;
    if (!senderIsOwner && db && sessionId) {
        try {
            const [rows] = await db.query(
                'SELECT u.phone FROM users u JOIN bots b ON b.user_id=u.id WHERE b.session_id=? LIMIT 1',
                [sessionId]
            );
            if (rows.length) {
                const ownerNum = String(rows[0].phone).replace(/\D/g, '');
                senderIsOwner = senderId.includes(ownerNum);
            }
        } catch {}
    }

    // Permission check
    if (isGroup) {
        let meta;
        try {
            meta = await sock.groupMetadata(chatId);
        } catch {
            return await sock.sendMessage(chatId, { text: '❌ Could not fetch group info.' }, { quoted: msg });
        }

        const botJid = sock.user?.id?.split('@')[0]?.split(':')[0] + '@s.whatsapp.net';
        const botMember = meta.participants.find(p => p.id.split(':')[0].split('@')[0] === botJid.split('@')[0]);
        const senderMember = meta.participants.find(p => p.id.split(':')[0].split('@')[0] === senderId.split(':')[0].split('@')[0]);

        const isBotAdmin = botMember && ['admin', 'superadmin'].includes(botMember.admin);
        const isSenderAdmin = senderMember && ['admin', 'superadmin'].includes(senderMember.admin);

        if (!isBotAdmin) {
            return await sock.sendMessage(chatId, { text: '❌ Bot must be admin to use .ban' }, { quoted: msg });
        }
        if (!isSenderAdmin && !senderIsOwner) {
            return await sock.sendMessage(chatId, { text: '❌ Only admins can use .ban' }, { quoted: msg });
        }
    } else {
        if (!senderIsOwner) {
            return await sock.sendMessage(chatId, { text: '❌ Only owner can use .ban in private chat' }, { quoted: msg });
        }
    }

    // Get target user
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    let userToBan = ctx?.mentionedJid?.[0] || ctx?.participant;

    if (!userToBan && args.length) {
        let cleanArg = args[0].replace(/[^0-9]/g, '');
        if (cleanArg.startsWith('0')) cleanArg = '234' + cleanArg.slice(1);
        if (cleanArg.length >= 7) {
            userToBan = cleanArg + '@s.whatsapp.net';
        }
    }

    if (!userToBan) {
        return await sock.sendMessage(chatId, { text: '❌ Mention or reply to a user to ban, or use: *.ban 2348012345678*' }, { quoted: msg });
    }

    // Don't ban bot itself
    const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    if (userToBan.split('@')[0] === botId.split('@')[0]) {
        return await sock.sendMessage(chatId, { text: '❌ Cannot ban the bot' }, { quoted: msg });
    }

    // Ban logic
    try {
        const banned = getBanned();

        if (banned.includes(userToBan)) {
            return await sock.sendMessage(chatId, { 
                text: `⚠️ @${userToBan.split('@')[0]} is already banned`, 
                mentions: [userToBan] 
            }, { quoted: msg });
        }

        banned.push(userToBan);
        saveBanned(banned);

        await sock.sendMessage(chatId, { 
            text: `✅ Banned @${userToBan.split('@')[0]} successfully`, 
            mentions: [userToBan] 
        }, { quoted: msg });
    } catch (err) {
        console.error('Ban error:', err);
        await sock.sendMessage(chatId, { text: '❌ Failed to ban user' }, { quoted: msg });
    }
}

module.exports = {
    name: 'ban',
    desc: 'Ban a user from using the bot',
    category: 'admin',
    execute
};