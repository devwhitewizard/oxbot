/**
 * commands/antisticker.js
 * Auto-delete stickers (Saves to data/group_settings.json automatically)
 */

const fs = require('fs');
const path = require('path');

function cleanNum(jid) {
    if (!jid) return '';
    return jid.replace(/[^0-9]/g, '');
}

// ═══════════════════════════════════════════════════
// FILE SYSTEM (Creates folder & file automatically)
// ═══════════════════════════════════════════════════
const FILE_PATH = path.join(__dirname, '..', 'data', 'group_settings.json');
const cache = new Map();

function loadFromFile() {
    try {
        if (fs.existsSync(FILE_PATH)) {
            const data = JSON.parse(fs.readFileSync(FILE_PATH, 'utf-8'));
            for (const [jid, config] of Object.entries(data)) {
                cache.set(jid, config);
            }
            console.log(`[antisticker] Loaded ${cache.size} group rules from file.`);
        }
    } catch (err) {
        console.error('[antisticker] Read error:', err.message);
    }
}

function saveToFile() {
    try {
        const dir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true }); // Creates folder automatically!
        }
        fs.writeFileSync(FILE_PATH, JSON.stringify(Object.fromEntries(cache), null, 2));
    } catch (err) {
        console.error('[antisticker] Save error:', err.message);
    }
}

// Load rules when bot starts
loadFromFile();

function getConfig(chatId) {
    if (!cache.has(chatId)) cache.set(chatId, { enabled: false, action: 'delete' });
    return cache.get(chatId);
}

function setConfig(chatId, enabled, action) {
    const config = getConfig(chatId);
    config.enabled = enabled;
    config.action = action;
    saveToFile(); // Saves instantly
}

// ═══════════════════════════════════════════════════
// COMMAND
// ═══════════════════════════════════════════════════
async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ Group only command!' }, { quoted: msg });
    }

    const senderId = msg.key.participant || msg.key.remoteJid;

    let senderIsOwner = msg.key.fromMe;
    if (!senderIsOwner && sock._ownerPhone) {
        const senderNum = cleanNum(senderId);
        const ownerNum  = cleanNum(sock._ownerPhone);
        if (senderNum && ownerNum) {
            const sN = senderNum.startsWith('0') ? senderNum.slice(1) : senderNum;
            const oN = ownerNum.startsWith('0') ? ownerNum.slice(1) : ownerNum;
            senderIsOwner = sN === oN || sN.endsWith(oN) || oN.endsWith(sN);
        }
    }

    if (!msg.key.fromMe && !senderIsOwner) {
        try {
            const meta = await sock.groupMetadata(chatId);
            const senderNum = cleanNum(senderId);
            const senderIsAdmin = meta.participants?.some(p => 
                cleanNum(p.id) === senderNum && (p.admin === 'admin' || p.admin === 'superadmin')
            );
            if (!senderIsAdmin) {
                return await sock.sendMessage(chatId, { text: '❌ Only admins can use this!' }, { quoted: msg });
            }
        } catch {
            return await sock.sendMessage(chatId, { text: '❌ Could not fetch group info.' }, { quoted: msg });
        }
    }

    const opt = (args[0] || '').toLowerCase();
    const config = getConfig(chatId);

    if (!opt || opt === 'get') {
        const status = config.enabled ? '✅ ON' : '❌ OFF';
        return await sock.sendMessage(chatId, {
            text: `🖼️ *Antisticker Status*\n\n>Status: *${status}*\n>Action: *${config.action.toUpperCase()}*\n\n*Usage:*\n  .antisticker on\n  .antisticker off\n  .antisticker set delete\n  .antisticker set kick`
        }, { quoted: msg });
    }

    if (opt === 'on') {
        if (config.enabled) return await sock.sendMessage(chatId, { text: '⚠️ Already ON.' }, { quoted: msg });
        setConfig(chatId, true, config.action);
        return await sock.sendMessage(chatId, { text: `✅ *Antisticker ON*\n\nAction: *${config.action.toUpperCase()}*\n_⚠️ I must be an admin to delete messages!_` }, { quoted: msg });
    }

    if (opt === 'off') {
        setConfig(chatId, false, config.action);
        return await sock.sendMessage(chatId, { text: '⛔ *Antisticker OFF*' }, { quoted: msg });
    }

    if (opt === 'set') {
        const setAction = (args[1] || '').toLowerCase();
        if (!['delete', 'kick'].includes(setAction)) {
            return await sock.sendMessage(chatId, { text: '❌ Choose *.antisticker set delete* or *.antisticker set kick*' }, { quoted: msg });
        }
        setConfig(chatId, true, setAction);
        return await sock.sendMessage(chatId, { text: `✅ Action set to *${setAction.toUpperCase()}*` }, { quoted: msg });
    }

    return await sock.sendMessage(chatId, { text: '❌ Invalid option.' }, { quoted: msg });
}

// ═══════════════════════════════════════════════════
// BACKGROUND DELETER
// ═══════════════════════════════════════════════════
async function handleAntiSticker(sock, message, botData) {
    const chatId = message.key.remoteJid;
    if (!chatId?.endsWith('@g.us') || message.key.fromMe) return;

    const config = getConfig(chatId); // Instant memory read
    if (!config.enabled || !message.message?.stickerMessage) return;

    try {
        await sock.sendMessage(chatId, { delete: message.key });
        
        if (config.action === 'kick') {
            const sender = message.key.participant;
            if (sender) await sock.groupParticipantsUpdate(chatId, [sender], 'remove');
        }
    } catch (err) {
        console.error(`[antisticker] Action failed:`, err.message);
    }
}

module.exports = { name: 'antisticker', aliases: ['nosticker'], desc: 'Delete or kick sticker senders', category: 'group', execute, handleAntiSticker }; 