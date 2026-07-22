const name     = 'antidelete';
const desc     = '🛡️ Recover deleted messages in groups & DMs (Pro only)';
const category = 'premium';

const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const messageStore = new Map();
const TEMP_DIR = path.join(__dirname, '../tmp');
const ANTIDELETE_DB = path.join(__dirname, '../database/antidelete.json');

// Ensure database directory exists
if (!fs.existsSync(path.join(__dirname, '../database'))) {
    fs.mkdirSync(path.join(__dirname, '../database'), { recursive: true });
}
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ── Enhanced Temp File Cleaner ──────────────────────────────────────────────
setInterval(() => {
    try {
        const files = fs.readdirSync(TEMP_DIR);
        let totalSize = 0;
        const now = Date.now();
        
        files.forEach(f => {
            try {
                const filePath = path.join(TEMP_DIR, f);
                const stats = fs.statSync(filePath);
                totalSize += stats.size;
                
                // Delete files older than 30 minutes
                if (now - stats.mtimeMs > 30 * 60 * 1000) {
                    fs.unlinkSync(filePath);
                }
            } catch {}
        });
        
        // If total size exceeds 200MB, delete oldest files
        if (totalSize > 200 * 1024 * 1024) {
            const sortedFiles = files
                .map(f => ({ name: f, path: path.join(TEMP_DIR, f), stats: fs.statSync(path.join(TEMP_DIR, f)) }))
                .sort((a, b) => a.stats.mtimeMs - b.stats.mtimeMs);
            
            let sizeToDelete = totalSize - 150 * 1024 * 1024;
            for (const file of sortedFiles) {
                if (sizeToDelete <= 0) break;
                try {
                    fs.unlinkSync(file.path);
                    sizeToDelete -= file.stats.size;
                } catch {}
            }
        }
    } catch {}
}, 10 * 60 * 1000);

async function toBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

// ── Database Helpers ─────────────────────────────────────────────────────────
async function getOwnerUserId(db, sessionId) {
    if (!db || !sessionId) return null;
    try {
        const [rows] = await db.query(
            'SELECT user_id FROM bots WHERE session_id = ? OR session_id = ? LIMIT 1',
            [sessionId, `oxbot_${sessionId}`]
        );
        return rows.length ? rows[0].user_id : null;
    } catch { return null; }
}

async function isPro(db, userId) {
    if (!userId) return false;
    try {
        const [rows] = await db.query(
            `SELECT id FROM pro_subscriptions 
             WHERE user_id = ? AND status = 'active' AND expires_at > NOW() 
             LIMIT 1`,
            [userId]
        );
        return rows.length > 0;
    } catch { return false; }
}

async function getOwnerJid(db, sessionId) {
    const userId = await getOwnerUserId(db, sessionId);
    if (!userId) return null;
    return `${userId}@s.whatsapp.net`;
}

function cleanNum(jid) { 
    return jid?.split(':')[0]?.split('@')[0] || ''; 
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

function getFileExtension(mimetype) {
    const types = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'video/mp4': 'mp4',
        'video/3gpp': '3gp',
        'audio/mpeg': 'mp3',
        'audio/ogg': 'ogg',
        'audio/aac': 'aac',
        'audio/wav': 'wav',
        'application/pdf': 'pdf',
        'text/plain': 'txt',
        'application/json': 'json'
    };
    return types[mimetype] || 'bin';
}

// ── Load Antidelete State ─────────────────────────────────────────────────────
function loadAntideleteState() {
    try {
        if (fs.existsSync(ANTIDELETE_DB)) {
            const data = fs.readFileSync(ANTIDELETE_DB, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('[antidelete] Load error:', err.message);
    }
    return {};
}

function saveAntideleteState(state) {
    try {
        // Ensure the database directory exists
        const dbDir = path.dirname(ANTIDELETE_DB);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        fs.writeFileSync(ANTIDELETE_DB, JSON.stringify(state, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('[antidelete] Save error:', err.message);
        return false;
    }
}

// ── Store Message ─────────────────────────────────────────────────────────────────
async function storeMessage(sock, message, botData) {
    try {
        if (!message.key?.id || message.key.fromMe) return;
        if (message.key.remoteJid === 'status@broadcast') return;

        const msgId = message.key.id;
        const sender = message.key.participant || message.key.remoteJid;
        const chatId = message.key.remoteJid;

        // Check if antidelete is enabled
        const state = loadAntideleteState();
        if (!state[chatId]?.enabled) return;

        let content = '';
        let mediaType = '';
        let mediaPath = '';
        let mediaMimetype = '';
        let isViewOnce = false;
        let isForwarded = false;
        let quotedMsg = null;

        const msg = message.message;
        if (!msg) return;

        // Check for forwarded message
        if (msg.extendedTextMessage?.contextInfo?.isForwarded) {
            isForwarded = true;
        }

        // Handle view once messages
        const voMsg = msg.viewOnceMessageV2?.message || msg.viewOnceMessage?.message;
        if (voMsg) {
            isViewOnce = true;
            if (voMsg.imageMessage) {
                mediaType = 'image';
                content = voMsg.imageMessage.caption || '';
                mediaMimetype = voMsg.imageMessage.mimetype || 'image/jpeg';
                const buf = await toBuffer(await downloadContentFromMessage(voMsg.imageMessage, 'image'));
                mediaPath = path.join(TEMP_DIR, `${msgId}.${getFileExtension(mediaMimetype)}`);
                fs.writeFileSync(mediaPath, buf);
            } else if (voMsg.videoMessage) {
                mediaType = 'video';
                content = voMsg.videoMessage.caption || '';
                mediaMimetype = voMsg.videoMessage.mimetype || 'video/mp4';
                const buf = await toBuffer(await downloadContentFromMessage(voMsg.videoMessage, 'video'));
                mediaPath = path.join(TEMP_DIR, `${msgId}.${getFileExtension(mediaMimetype)}`);
                fs.writeFileSync(mediaPath, buf);
            }
        } 
        // Text messages
        else if (msg.conversation) {
            content = msg.conversation;
        } else if (msg.extendedTextMessage?.text) {
            content = msg.extendedTextMessage.text;
            if (msg.extendedTextMessage.contextInfo?.quotedMessage) {
                quotedMsg = msg.extendedTextMessage.contextInfo.quotedMessage;
            }
        } 
        // Media messages
        else if (msg.imageMessage) {
            mediaType = 'image';
            content = msg.imageMessage.caption || '';
            mediaMimetype = msg.imageMessage.mimetype || 'image/jpeg';
            const buf = await toBuffer(await downloadContentFromMessage(msg.imageMessage, 'image'));
            mediaPath = path.join(TEMP_DIR, `${msgId}.${getFileExtension(mediaMimetype)}`);
            fs.writeFileSync(mediaPath, buf);
        } else if (msg.videoMessage) {
            mediaType = 'video';
            content = msg.videoMessage.caption || '';
            mediaMimetype = msg.videoMessage.mimetype || 'video/mp4';
            const buf = await toBuffer(await downloadContentFromMessage(msg.videoMessage, 'video'));
            mediaPath = path.join(TEMP_DIR, `${msgId}.${getFileExtension(mediaMimetype)}`);
            fs.writeFileSync(mediaPath, buf);
        } else if (msg.stickerMessage) {
            mediaType = 'sticker';
            mediaMimetype = msg.stickerMessage.mimetype || 'image/webp';
            const buf = await toBuffer(await downloadContentFromMessage(msg.stickerMessage, 'sticker'));
            mediaPath = path.join(TEMP_DIR, `${msgId}.webp`);
            fs.writeFileSync(mediaPath, buf);
        } else if (msg.audioMessage) {
            mediaType = 'audio';
            mediaMimetype = msg.audioMessage.mimetype || 'audio/mpeg';
            const ext = getFileExtension(mediaMimetype);
            const buf = await toBuffer(await downloadContentFromMessage(msg.audioMessage, 'audio'));
            mediaPath = path.join(TEMP_DIR, `${msgId}.${ext}`);
            fs.writeFileSync(mediaPath, buf);
        } else if (msg.documentMessage) {
            mediaType = 'document';
            content = msg.documentMessage.caption || '';
            mediaMimetype = msg.documentMessage.mimetype || 'application/octet-stream';
            const ext = getFileExtension(mediaMimetype) || 'bin';
            const buf = await toBuffer(await downloadContentFromMessage(msg.documentMessage, 'document'));
            mediaPath = path.join(TEMP_DIR, `${msgId}.${ext}`);
            fs.writeFileSync(mediaPath, buf);
        }

        if (!content && !mediaType) return;

        // Get sender name
        let senderName = cleanNum(sender);
        try {
            const contact = await sock.getContact(sender);
            senderName = contact.name || contact.notify || senderName;
        } catch {}

        messageStore.set(msgId, {
            content,
            mediaType,
            mediaPath,
            mediaMimetype,
            sender,
            senderName,
            chatId,
            time: Date.now(),
            isViewOnce,
            isForwarded,
            quotedMsg
        });

        // Auto-delete from store after 15 minutes
        setTimeout(() => {
            const old = messageStore.get(msgId);
            if (old?.mediaPath) {
                try { fs.unlinkSync(old.mediaPath); } catch {}
            }
            messageStore.delete(msgId);
        }, 15 * 60 * 1000);

        // Handle view once messages (send to owner)
        if (isViewOnce && mediaPath) {
            const ownerJid = await getOwnerJid(botData?.db, botData?.sessionId);
            if (ownerJid) {
                try {
                    const cap = `👁️ *View-Once ${mediaType}*\nFrom: ${senderName} (@${cleanNum(sender)})`;
                    const sendOpts = mediaType === 'image'
                        ? { image: { url: mediaPath }, caption: cap, mentions: [sender] }
                        : { video: { url: mediaPath }, caption: cap, mentions: [sender] };
                    await sock.sendMessage(ownerJid, sendOpts);
                    const state = loadAntideleteState();
                    if (state[chatId]) {
                        state[chatId].recovered = (state[chatId].recovered || 0) + 1;
                        saveAntideleteState(state);
                    }
                } catch {}
            }
            try { fs.unlinkSync(mediaPath); } catch {}
        }

    } catch (err) {
        console.error('[antidelete] store error:', err.message);
    }
}

// ── Handle Message Deletion ──────────────────────────────────────────────────────
async function handleMessageRevocation(sock, message, botData) {
    try {
        const protoMsg = message.message?.protocolMessage;
        if (!protoMsg || protoMsg.type !== 0) return;

        const deletedMsgId = protoMsg.key?.id;
        if (!deletedMsgId) return;

        const deletedBy = message.key.participant || message.key.remoteJid;
        const chatId = message.key.remoteJid;

        const state = loadAntideleteState();
        if (!state[chatId]?.enabled) return;

        const original = messageStore.get(deletedMsgId);
        if (!original) return;

        let chatName = '';
        let chatType = 'DM';
        if (original.chatId?.endsWith('@g.us')) {
            chatType = 'Group';
            try {
                const meta = await sock.groupMetadata(original.chatId);
                chatName = meta.subject || '';
            } catch {}
        } else {
            try {
                const contact = await sock.getContact(original.chatId);
                chatName = contact.name || contact.notify || cleanNum(original.chatId);
            } catch {}
        }

        let deletedByName = cleanNum(deletedBy);
        try {
            const contact = await sock.getContact(deletedBy);
            deletedByName = contact.name || contact.notify || deletedByName;
        } catch {}

        const time = formatTime(original.time);
        let text = `*🔰 DELETED MESSAGE RECOVERED*\n\n`;
        text += `🗑️ *Deleted by:* ${deletedByName} (@${cleanNum(deletedBy)})\n`;
        text += `👤 *From:* ${original.senderName} (@${cleanNum(original.sender)})\n`;
        text += `📱 *Chat:* ${chatName} (${chatType})\n`;
        text += `🕒 *Time:* ${time}\n`;
        
        if (original.isForwarded) {
            text += `↗️ *Forwarded:* Yes\n`;
        }
        
        if (original.content) {
            text += `\n💬 *Message:*\n${original.content}\n`;
        }

        const ownerJid = await getOwnerJid(botData?.db, botData?.sessionId);
        if (ownerJid) {
            await sock.sendMessage(ownerJid, {
                text,
                mentions: [deletedBy, original.sender]
            });

            if (original.mediaType && original.mediaPath && fs.existsSync(original.mediaPath)) {
                try {
                    const cap = `📎 *Deleted ${original.mediaType}*\nFrom: ${original.senderName}`;
                    let sendOpts;
                    const mediaUrl = { url: original.mediaPath };
                    
                    switch (original.mediaType) {
                        case 'image':
                            sendOpts = { image: mediaUrl, caption: cap, mentions: [original.sender] };
                            break;
                        case 'video':
                            sendOpts = { video: mediaUrl, caption: cap, mentions: [original.sender] };
                            break;
                        case 'sticker':
                            sendOpts = { sticker: mediaUrl };
                            break;
                        case 'audio':
                            sendOpts = { audio: mediaUrl, mimetype: original.mediaMimetype || 'audio/mpeg' };
                            break;
                        case 'document':
                            sendOpts = { 
                                document: mediaUrl, 
                                mimetype: original.mediaMimetype || 'application/octet-stream',
                                caption: cap,
                                fileName: `deleted_${original.mediaType}_${Date.now()}.${getFileExtension(original.mediaMimetype)}`
                            };
                            break;
                    }
                    
                    if (sendOpts) {
                        await sock.sendMessage(ownerJid, sendOpts);
                    }
                } catch (err) {
                    await sock.sendMessage(ownerJid, { 
                        text: `⚠️ Could not send ${original.mediaType}: ${err.message}` 
                    });
                }
                
                try { fs.unlinkSync(original.mediaPath); } catch {}
            }

            if (state[chatId]) {
                state[chatId].recovered = (state[chatId].recovered || 0) + 1;
                saveAntideleteState(state);
            }
        }

        messageStore.delete(deletedMsgId);

    } catch (err) {
        console.error('[antidelete] revocation error:', err.message);
    }
}

// ── Main Command ──────────────────────────────────────────────────────────────────
async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    const db = botData?.db;
    const sessionId = botData?.sessionId;

    if (!db || !sessionId) {
        return await sock.sendMessage(chatId, { 
            text: '❌ Database error. Please contact support.' 
        }, { quoted: msg });
    }

    const userId = await getOwnerUserId(db, sessionId);
    const isProUser = await isPro(db, userId);

    if (!isProUser) {
        return await sock.sendMessage(chatId, {
            text: `👑 *Pro Plan Required*\n\n` +
                  `🛡️ *Anti-Delete* is a premium feature that recovers deleted messages.\n\n` +
                  `💎 *Pro Benefits:*\n` +
                  `• Anti-Delete in groups & DMs\n` +
                  `• Recover text & media messages\n` +
                  `• View-once message recovery\n` +
                  `• Premium support\n\n` +
                  `💰 *Price:* ₦3000/month\n` +
                  `📌 *Contact:* @youngzee to upgrade\n\n` +
                  `_📝 Reply with .pro to learn more_`
        }, { quoted: msg });
    }

    const isGroup = chatId.endsWith('@g.us');
    const chatType = isGroup ? 'Group' : 'DM';

    const state = loadAntideleteState();
    const action = args[0]?.toLowerCase();

    // Show status
    if (!action || action === 'status') {
        const isEnabled = state[chatId]?.enabled || false;
        const statusEmoji = isEnabled ? '✅' : '❌';
        const statusText = isEnabled ? 'ENABLED' : 'DISABLED';
        const recovered = state[chatId]?.recovered || 0;
        const totalStored = messageStore.size;

        let statusMsg = `🛡️ *Anti-Delete Status*\n\n`;
        statusMsg += `📱 *Chat:* ${chatType}\n`;
        statusMsg += `🔰 *Status:* ${statusEmoji} ${statusText}\n`;
        statusMsg += `📊 *Recovered:* ${recovered} messages\n`;
        statusMsg += `💾 *Cached:* ${totalStored} messages\n\n`;
        statusMsg += `📌 *Commands:*\n`;
        statusMsg += `• *.antidelete on* — Enable anti-delete\n`;
        statusMsg += `• *.antidelete off* — Disable anti-delete\n`;
        statusMsg += `• *.antidelete status* — Show this status\n`;
        statusMsg += `• *.antidelete stats* — Show detailed stats\n`;

        return sock.sendMessage(chatId, { text: statusMsg }, { quoted: msg });
    }

    // Show stats
    if (action === 'stats' || action === 'statistics') {
        const isEnabled = state[chatId]?.enabled || false;
        const recovered = state[chatId]?.recovered || 0;
        const totalStored = messageStore.size;
        
        let statsMsg = `📊 *Anti-Delete Statistics*\n\n`;
        statsMsg += `📱 *Chat:* ${chatType}\n`;
        statsMsg += `🔰 *Status:* ${isEnabled ? '✅ Active' : '❌ Inactive'}\n`;
        statsMsg += `📊 *Messages Recovered:* ${recovered}\n`;
        statsMsg += `💾 *Messages in Cache:* ${totalStored}\n`;
        statsMsg += `⏱️ *Cache Duration:* 15 minutes\n\n`;
        
        if (isEnabled) {
            statsMsg += `_📌 This ${isGroup ? 'group' : 'chat'} is protected_`;
        } else {
            statsMsg += `_📌 Use .antidelete on to enable protection_`;
        }

        return sock.sendMessage(chatId, { text: statsMsg }, { quoted: msg });
    }

    // Enable anti-delete
    if (action === 'on' || action === 'enable') {
        if (state[chatId]?.enabled) {
            return sock.sendMessage(chatId, {
                text: `⚠️ Anti-Delete is already ENABLED in this ${chatType.toLowerCase()}!`
            }, { quoted: msg });
        }

        // Initialize state for this chat
        if (!state[chatId]) {
            state[chatId] = {};
        }
        
        state[chatId].enabled = true;
        state[chatId].recovered = state[chatId].recovered || 0;
        state[chatId].enabledAt = Date.now();

        const saved = saveAntideleteState(state);
        
        if (saved) {
            let msg = `✅ *Anti-Delete ENABLED!*\n\n`;
            msg += `🛡️ This ${chatType.toLowerCase()} is now protected.\n`;
            msg += `🔰 Deleted messages will be recovered and sent to you.\n\n`;
            msg += `_⚡ Premium Feature Active_\n`;
            msg += `_📌 Bot owner will receive deleted messages privately_`;
            
            return sock.sendMessage(chatId, { text: msg }, { quoted: msg });
        } else {
            return sock.sendMessage(chatId, {
                text: '❌ Failed to enable anti-delete. Please try again.\n\nMake sure the bot has write permissions to the database folder.'
            }, { quoted: msg });
        }
    }

    // Disable anti-delete
    if (action === 'off' || action === 'disable') {
        if (!state[chatId]?.enabled) {
            return sock.sendMessage(chatId, {
                text: `⚠️ Anti-Delete is already DISABLED in this ${chatType.toLowerCase()}!`
            }, { quoted: msg });
        }

        if (state[chatId]) {
            state[chatId].enabled = false;
            state[chatId].disabledAt = Date.now();
            saveAntideleteState(state);
        } else {
            delete state[chatId];
            saveAntideleteState(state);
        }

        let msg = `❌ *Anti-Delete DISABLED!*\n\n`;
        msg += `🛡️ This ${chatType.toLowerCase()} is no longer protected.\n`;
        msg += `📊 ${state[chatId]?.recovered || 0} messages were recovered while active.\n\n`;
        msg += `_📌 Use .antidelete on to re-enable_`;
        
        return sock.sendMessage(chatId, { text: msg }, { quoted: msg });
    }

    // Reset statistics
    if (action === 'reset') {
        if (state[chatId]) {
            state[chatId].recovered = 0;
            saveAntideleteState(state);
            
            return sock.sendMessage(chatId, {
                text: '🔄 *Recovered counter reset!*'
            }, { quoted: msg });
        }
        return sock.sendMessage(chatId, {
            text: '❌ No data to reset.'
        }, { quoted: msg });
    }

    // Help
    return sock.sendMessage(chatId, {
        text: `📖 *Anti-Delete Commands*\n\n` +
              `🛡️ *Available Commands:*\n` +
              `• *.antidelete* — Show status\n` +
              `• *.antidelete on* — Enable protection\n` +
              `• *.antidelete off* — Disable protection\n` +
              `• *.antidelete stats* — Show detailed stats\n` +
              `• *.antidelete reset* — Reset counter\n` +
              `• *.antidelete status* — Show status\n\n` +
              `_💡 Deleted messages are sent to bot owner privately_`
    }, { quoted: msg });
}

module.exports = { 
    name, 
    desc, 
    category, 
    execute, 
    storeMessage, 
    handleMessageRevocation 
};
