// commands/antidelete.js
const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { writeFile } = require('fs/promises');

const messageStore = new Map();
const TEMP_DIR = path.join(__dirname, '../tmp');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Clean temp folder every 5 minutes if over 100MB
setInterval(() => {
    try {
        const files = fs.readdirSync(TEMP_DIR);
        let size = 0;
        files.forEach(f => { try { size += fs.statSync(path.join(TEMP_DIR, f)).size; } catch {} });
        if (size > 100 * 1024 * 1024) {
            files.forEach(f => { try { fs.unlinkSync(path.join(TEMP_DIR, f)); } catch {} });
        }
    } catch {}
}, 5 * 60 * 1000);

// Stream to buffer
async function toBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

// ═══════════════════════════════════════════════════════════════
// ★ ROBUST SESSION RESOLVER ★
// ═══════════════════════════════════════════════════════════════
async function getRealDbSessionId(db, sessionId) {
    if (!db || !sessionId) return null;
    try {
        const [r1] = await db.query('SELECT session_id FROM bots WHERE session_id=? LIMIT 1', [sessionId]);
        if (r1.length) return r1[0].session_id;
        
        if (!String(sessionId).startsWith('oxbot_')) {
            const [r2] = await db.query('SELECT session_id FROM bots WHERE session_id=? LIMIT 1', [`oxbot_${sessionId}`]);
            if (r2.length) return r2[0].session_id;
        }
        return null;
    } catch { return null; }
}

function cleanNum(jid) { return jid?.split(':')[0]?.split('@')[0] || ''; }

// ═══════════════════════════════════════════════════════════════
// DB helpers (Now 100% Isolated per user using REAL session_id)
// ═══════════════════════════════════════════════════════════════
async function ensureColumn(db) {
    try {
        await db.query(`ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS antidelete TINYINT(1) DEFAULT 0`);
    } catch (err) {
        if (err.errno === 1060) return;
        try {
            await db.query(`ALTER TABLE bot_settings ADD COLUMN antidelete TINYINT(1) DEFAULT 0`);
        } catch (e) {
            if (e.errno !== 1060) console.error('[antidelete] Column error:', e.message);
        }
    }
}

async function getState(db, sessionId) {
    try {
        const actualId = await getRealDbSessionId(db, sessionId);
        if (!actualId) return false;
        await ensureColumn(db);
        const [rows] = await db.query('SELECT antidelete FROM bot_settings WHERE session_id = ?', [actualId]);
        return rows.length ? rows[0].antidelete === 1 : false;
    } catch (err) {
        console.error('[antidelete] getState error:', err.message);
        return false;
    }
}

async function setState(db, sessionId, val) {
    try {
        const actualId = await getRealDbSessionId(db, sessionId);
        if (!actualId) return;
        await ensureColumn(db);
        await db.query(
            'INSERT INTO bot_settings (session_id, antidelete) VALUES (?, ?) ON DUPLICATE KEY UPDATE antidelete = ?', 
            [actualId, val ? 1 : 0, val ? 1 : 0]
        );
    } catch (err) {
        console.error('[antidelete] setState error:', err.message);
    }
}

// ★ FIXED: Fallback to socket ID if DB phone is missing ★
async function getOwnerJid(db, sessionId, sock) {
    try {
        const actualId = await getRealDbSessionId(db, sessionId);
        
        // 1. Try to get phone from DB
        if (actualId) {
            const [rows] = await db.query('SELECT u.phone FROM users u JOIN bots b ON b.user_id = u.id WHERE b.session_id = ?', [actualId]);
            if (rows.length && rows[0].phone) {
                let ownerNum = String(rows[0].phone).replace(/\D/g, '');
                if (ownerNum.startsWith('0')) ownerNum = ownerNum.slice(1); 
                return ownerNum + '@s.whatsapp.net';
            }
        }
        
        // 2. Fallback to the Bot's own WhatsApp ID (The person who paired the bot IS the owner)
        if (sock?.user?.id) {
            console.log('[ANTIDELETE] Using socket ID as owner fallback');
            return sock.user.id;
        }
        
        return null;
    } catch { 
        if (sock?.user?.id) return sock.user.id;
        return null; 
    }
}

async function isOwner(db, sessionId, senderId) {
    try {
        const actualId = await getRealDbSessionId(db, sessionId);
        if (!actualId) return false;
        const [rows] = await db.query('SELECT u.phone FROM users u JOIN bots b ON b.user_id = u.id WHERE b.session_id = ?', [actualId]);
        if (!rows.length || !rows[0].phone) return true; // ★ Allow toggle if phone is missing
        let ownerNum = String(rows[0].phone).replace(/\D/g, '');
        let senderNum = cleanNum(senderId);
        if (ownerNum.startsWith('0')) ownerNum = ownerNum.slice(1);
        if (senderNum.startsWith('0')) senderNum = senderNum.slice(1);
        return senderNum === ownerNum;
    } catch { return true; } // ★ Allow toggle on DB error
}

// ═══════════════════════════════════════════════════════════════
// Command
// ═══════════════════════════════════════════════════════════════
async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    const db = botData?.db;
    const sessionId = botData?.sessionId;
    const senderId = msg.key.participant || msg.key.remoteJid;

    if (!db || !sessionId) return sock.sendMessage(chatId, { text: '⚠️ DB error' }, { quoted: msg });
    if (!msg.key.fromMe && !await isOwner(db, sessionId, senderId)) return;

    const action = (args[0] || '').toLowerCase();

    if (action !== 'on' && action !== 'off') {
        const cur = await getState(db, sessionId);
        return sock.sendMessage(chatId, {
            text: `*🔰 ANTIDELETE*\n\nStatus: ${cur ? '✅ ON' : '❌ OFF'}\n\n*.antidelete on*\n*.antidelete off*`
        }, { quoted: msg });
    }

    await setState(db, sessionId, action === 'on');
    sock.sendMessage(chatId, {
        text: action === 'on' ? '✅ Antidelete enabled' : '❌ Antidelete disabled'
    }, { quoted: msg });
}

// ═══════════════════════════════════════════════════════════════
// Store messages - CALL THIS ON EVERY INCOMING MESSAGE
// ═══════════════════════════════════════════════════════════════
async function storeMessage(sock, message, botData) {
    try {
        if (!await getState(botData?.db, botData?.sessionId)) return;
        if (!message.key?.id || message.key.fromMe) return;

        const msgId = message.key.id;
        const sender = message.key.participant || message.key.remoteJid;
        const chatId = message.key.remoteJid;

        if (chatId === 'status@broadcast') return;

        let content = '';
        let mediaType = '';
        let mediaPath = '';
        let isViewOnce = false;

        const msg = message.message;
        if (!msg) return;

        const voMsg = msg.viewOnceMessageV2?.message || msg.viewOnceMessage?.message;
        if (voMsg) {
            isViewOnce = true;
            if (voMsg.imageMessage) {
                mediaType = 'image'; content = voMsg.imageMessage.caption || '';
                const buf = await toBuffer(await downloadContentFromMessage(voMsg.imageMessage, 'image'));
                mediaPath = path.join(TEMP_DIR, `${msgId}.jpg`); await writeFile(mediaPath, buf);
            } else if (voMsg.videoMessage) {
                mediaType = 'video'; content = voMsg.videoMessage.caption || '';
                const buf = await toBuffer(await downloadContentFromMessage(voMsg.videoMessage, 'video'));
                mediaPath = path.join(TEMP_DIR, `${msgId}.mp4`); await writeFile(mediaPath, buf);
            }
        } else if (msg.conversation) { content = msg.conversation; }
        else if (msg.extendedTextMessage?.text) { content = msg.extendedTextMessage.text; }
        else if (msg.imageMessage) {
            mediaType = 'image'; content = msg.imageMessage.caption || '';
            const buf = await toBuffer(await downloadContentFromMessage(msg.imageMessage, 'image'));
            mediaPath = path.join(TEMP_DIR, `${msgId}.jpg`); await writeFile(mediaPath, buf);
        } else if (msg.videoMessage) {
            mediaType = 'video'; content = msg.videoMessage.caption || '';
            const buf = await toBuffer(await downloadContentFromMessage(msg.videoMessage, 'video'));
            mediaPath = path.join(TEMP_DIR, `${msgId}.mp4`); await writeFile(mediaPath, buf);
        } else if (msg.stickerMessage) {
            mediaType = 'sticker';
            const buf = await toBuffer(await downloadContentFromMessage(msg.stickerMessage, 'sticker'));
            mediaPath = path.join(TEMP_DIR, `${msgId}.webp`); await writeFile(mediaPath, buf);
        } else if (msg.audioMessage) {
            mediaType = 'audio'; const ext = msg.audioMessage.mimetype?.includes('ogg') ? 'ogg' : 'mp3';
            const buf = await toBuffer(await downloadContentFromMessage(msg.audioMessage, 'audio'));
            mediaPath = path.join(TEMP_DIR, `${msgId}.${ext}`); await writeFile(mediaPath, buf);
        }

        if (!content && !mediaType) return;

        messageStore.set(msgId, { content, mediaType, mediaPath, sender, chatId, time: Date.now() });

        setTimeout(() => {
            const old = messageStore.get(msgId);
            if (old?.mediaPath) try { fs.unlinkSync(old.mediaPath); } catch {}
            messageStore.delete(msgId);
        }, 10 * 60 * 1000);

        if (isViewOnce && mediaPath) {
            const ownerJid = await getOwnerJid(botData?.db, botData?.sessionId, sock);
            if (ownerJid) {
                try {
                    const cap = `👁️ *View-Once ${mediaType}*\nFrom: @${cleanNum(sender)}`;
                    const sendOpts = mediaType === 'image'
                        ? { image: { url: mediaPath }, caption: cap, mentions: [sender] }
                        : { video: { url: mediaPath }, caption: cap, mentions: [sender] };
                    await sock.sendMessage(ownerJid, sendOpts);
                } catch {}
            }
            try { fs.unlinkSync(mediaPath); } catch {}
        }
    } catch (err) {
        console.error('[antidelete] store:', err.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// Handle deletion - CALL THIS ON MESSAGE DELETE EVENTS
// ═══════════════════════════════════════════════════════════════
async function handleMessageRevocation(sock, message, botData) {
    try {
        if (!await getState(botData?.db, botData?.sessionId)) return;

        const protoMsg = message.message?.protocolMessage;
        if (!protoMsg || protoMsg.type !== 0) return;

        const deletedMsgId = protoMsg.key?.id;
        if (!deletedMsgId) return;

        const deletedBy = message.key.participant || message.key.remoteJid;
        
        // ★ FIXED: Pass sock to getOwnerJid so it can fallback to socket ID! ★
        const ownerJid = await getOwnerJid(botData?.db, botData?.sessionId, sock);
        if (!ownerJid) {
            console.error('[ANTIDELETE] CRITICAL ERROR: Could not find owner JID to send recovery to!');
            return;
        }

        if (cleanNum(deletedBy) === cleanNum(ownerJid)) return;

        const original = messageStore.get(deletedMsgId);
        if (!original) {
            console.log('[ANTIDELETE] Message was deleted, but it wasn\'t saved in memory (maybe media was too large or it arrived while bot was starting).');
            return;
        }

        const senderName = cleanNum(original.sender);
        let groupName = '';

        if (original.chatId?.endsWith('@g.us')) {
            try { const meta = await sock.groupMetadata(original.chatId); groupName = meta.subject || ''; } catch {}
        }

        const time = new Date(original.time).toLocaleString();

        let text = `*🔰 ANTIDELETE*\n\n`;
        text += `🗑️ *Deleted by:* @${cleanNum(deletedBy)}\n`;
        text += `👤 *From:* @${senderName}\n`;
        text += `🕒 *Time:* ${time}\n`;
        if (groupName) text += `👥 *Group:* ${groupName}\n`;
        if (original.content) text += `\n💬 *Message:*\n${original.content}`;

        await sock.sendMessage(ownerJid, { text, mentions: [deletedBy, original.sender] });

        if (original.mediaType && original.mediaPath && fs.existsSync(original.mediaPath)) {
            try {
                const cap = `Deleted ${original.mediaType} from @${senderName}`;
                let sendOpts;
                switch (original.mediaType) {
                    case 'image': sendOpts = { image: { url: original.mediaPath }, caption: cap, mentions: [original.sender] }; break;
                    case 'video': sendOpts = { video: { url: original.mediaPath }, caption: cap, mentions: [original.sender] }; break;
                    case 'sticker': sendOpts = { sticker: { url: original.mediaPath } }; break;
                    case 'audio': sendOpts = { audio: { url: original.mediaPath }, mimetype: 'audio/mpeg' }; break;
                }
                if (sendOpts) await sock.sendMessage(ownerJid, sendOpts);
            } catch (err) {
                await sock.sendMessage(ownerJid, { text: `⚠️ Media error: ${err.message}` });
            }
            try { fs.unlinkSync(original.mediaPath); } catch {}
        }

        messageStore.delete(deletedMsgId);
    } catch (err) {
        console.error('[antidelete] revoke:', err.message);
    }
}

module.exports = {
    name: 'antidelete',
    aliases: ['antidel'],
    desc: 'Recover deleted messages',
    category: 'owner',
    execute,
    storeMessage,
    handleMessageRevocation
};