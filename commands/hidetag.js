/**
 * commands/hidetag.js
 * Tag all non-admin members silently (hidden mention)
 * Deletes the original command message automatically.
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const path = require('path');
const fs   = require('fs');

const name     = 'hidetag';
const desc     = 'Tag all non-admin members silently';
const category = 'group';
const aliases  = ['ht', 'htag'];

// ─── temp dir ─────────────────────────────────────────────────────────────────
const TEMP_DIR = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ─── same cleanNum as promote.js ──────────────────────────────────────────────
function cleanNum(jid) {
    if (!jid) return '';
    return jid.replace(/[^0-9]/g, '');
}

// ─── media downloader ─────────────────────────────────────────────────────────
async function downloadMedia(msgContent, mediaType) {
    const stream = await downloadContentFromMessage(msgContent, mediaType);
    let buf = Buffer.alloc(0);
    for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);

    const extMap = { image: 'jpg', video: 'mp4', document: 'bin', audio: 'ogg', sticker: 'webp' };
    const file   = path.join(TEMP_DIR, `hidetag_${Date.now()}.${extMap[mediaType] || mediaType}`);
    fs.writeFileSync(file, buf);
    return file;
}

function deleteLater(file, ms = 30_000) {
    setTimeout(() => { try { fs.unlinkSync(file); } catch {} }, ms);
}

// ─── detect a genuine "bot lacks permission" rejection from WhatsApp ─────────
function isPermissionError(err) {
    const msg = (err?.message || '').toLowerCase();
    const code = err?.output?.statusCode;
    return msg.includes('not-admin')
        || msg.includes('forbidden')
        || msg.includes('not authorized')
        || code === 403
        || code === 400;
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return;

    // ── group only ────────────────────────────────────────────────────────────
    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, {
            text: '❌ *.hidetag* only works in groups.'
        }, { quoted: msg });
    }

    const senderId = msg.key.participant || msg.key.remoteJid;

    // ── STEP 1: fast owner check (same as promote.js) ─────────────────────────
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

    // ── STEP 2: fetch group metadata ───────────────────────────────────────────
    let meta;
    try { meta = await sock.groupMetadata(chatId); }
    catch {
        return await sock.sendMessage(chatId, {
            text: '❌ Could not fetch group info.'
        }, { quoted: msg });
    }

    const participants = meta.participants || [];

    // ── STEP 3: if NOT owner, check sender is group admin ──────────────────────
    if (!msg.key.fromMe && !senderIsOwner) {
        const senderNum      = cleanNum(senderId);
        const senderIsAdmin  = participants.some(p => {
            const pNum  = cleanNum(p.id);
            const sNorm = senderNum.startsWith('0') ? senderNum.slice(1) : senderNum;
            const pNorm = pNum.startsWith('0')      ? pNum.slice(1)      : pNum;
            return (pNorm === sNorm || pNorm.endsWith(sNorm) || sNorm.endsWith(pNorm))
                && (p.admin === 'admin' || p.admin === 'superadmin');
        });

        if (!senderIsAdmin) {
            return await sock.sendMessage(chatId, {
                text: '❌ Only admins can use *.hidetag*!'
            }, { quoted: msg });
        }
    }

    // ── STEP 4: build mention list (non-admins only) ──────────────────────────
    const mentions = participants.filter(p => !p.admin).map(p => p.id);

    if (!mentions.length) {
        return await sock.sendMessage(chatId, {
            text: '⚠️ No non-admin members to tag.'
        }, { quoted: msg });
    }

    // ── STEP 5: get caption from args ─────────────────────────────────────────
    const caption = args.join(' ').trim();

    // ── STEP 6: get quoted message (reply) ────────────────────────────────────
    const quoted =
        msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
        msg.message?.imageMessage?.contextInfo?.quotedMessage        ||
        msg.message?.videoMessage?.contextInfo?.quotedMessage        ||
        msg.message?.documentMessage?.contextInfo?.quotedMessage     ||
        null;

    // ── STEP 7: send ───────────────────────────────────────────────────────────
    try {
        if (quoted?.imageMessage) {
            const file = await downloadMedia(quoted.imageMessage, 'image');
            deleteLater(file);
            await sock.sendMessage(chatId, {
                image:    { url: file },
                caption:  caption || quoted.imageMessage.caption || '',
                mentions,
            });

        } else if (quoted?.videoMessage) {
            const file = await downloadMedia(quoted.videoMessage, 'video');
            deleteLater(file);
            await sock.sendMessage(chatId, {
                video:    { url: file },
                caption:  caption || quoted.videoMessage.caption || '',
                mentions,
            });

        } else if (quoted?.audioMessage) {
            const file = await downloadMedia(quoted.audioMessage, 'audio');
            deleteLater(file);
            await sock.sendMessage(chatId, {
                audio:    { url: file },
                mimetype: quoted.audioMessage.mimetype || 'audio/ogg; codecs=opus',
                ptt:      !!quoted.audioMessage.ptt,
                mentions,
            });

        } else if (quoted?.documentMessage) {
            const file = await downloadMedia(quoted.documentMessage, 'document');
            deleteLater(file);
            await sock.sendMessage(chatId, {
                document: { url: file },
                fileName: quoted.documentMessage.fileName || 'file',
                mimetype: quoted.documentMessage.mimetype || 'application/octet-stream',
                caption:  caption || quoted.documentMessage.caption || '',
                mentions,
            });

        } else if (quoted?.stickerMessage) {
            const file = await downloadMedia(quoted.stickerMessage, 'sticker');
            deleteLater(file);
            await sock.sendMessage(chatId, {
                sticker: { url: file },
                mentions,
            });

        } else if (quoted?.conversation || quoted?.extendedTextMessage) {
            const quotedText = quoted.conversation || quoted.extendedTextMessage?.text || '';
            await sock.sendMessage(chatId, {
                text:     caption || quotedText,
                mentions,
            });

        } else {
            // no reply — plain hidden tag
            await sock.sendMessage(chatId, {
                text:     caption || '​', // zero-width space so WA accepts it
                mentions,
            });
        }

        // ✅ DELETE THE ORIGINAL .hidetag COMMAND MESSAGE
        // It deletes the command for everyone so they only see the tagged message
        await sock.sendMessage(chatId, { delete: msg.key }).catch(() => {});

    } catch (err) {
        console.error('[hidetag] error:', err.message);

        if (isPermissionError(err)) {
            await sock.sendMessage(chatId, {
                text: '❌ *Action failed:* This group restricts sending to admins only, and I\'m not an admin here.\n\n_⚠️ If you just made me admin, please REMOVE me from the group and ADD me back in to fix this bug._'
            }, { quoted: msg }).catch(() => {});
        } else {
            await sock.sendMessage(chatId, {
                text: `❌ Failed to send hidetag: ${err.message}`
            }, { quoted: msg }).catch(() => {});
        }
    }
}

module.exports = { name, desc, category, aliases, execute };