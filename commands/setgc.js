const fs   = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { delay, patchCredsIfNeeded, normalizeJid } = require('../oxbot/utils'); // Import normalizeJid

const name     = 'setgc';
const desc     = 'Update the group profile picture (Must be Admin)';
const category = 'admin';
const aliases  = ['setgcp', 'setgrouppic', 'setgroupicon'];

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;

    try {
        // ── 1. Verify it's a Group ────────────────────────────────
        if (!chatId.endsWith('@g.us')) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ *Groups Only*\n\nThis command is used to change the Group Icon.',
            }, { quoted: msg });
        }

        // ── 2. FIX: Force Session Sync ─────────────────────────────
        const sessionFolder = path.join(process.cwd(), 'sessions', botData.sessionId);
        await patchCredsIfNeeded(sessionFolder);
        await delay(1000); // Short wait for sync

        // ── 3. Check Admin Status (With ID Fix) ────────────────────────
        const metadata = await sock.groupMetadata(chatId);
        
        // Use normalizeJid to remove :123 suffix from metadata IDs
        const botJid = normalizeJid(sock.user.id);
        
        // Debug Logging: Find the bot in the list
        const botInfo = metadata.participants.find(p => normalizeJid(p.id) === botJid);

        // Debugging: Print what we found (Check your Terminal/Console)
        if (!botInfo) {
            console.log(`[setgc] Bot ID: ${botJid}`);
            console.log(`[setgc] Participants List IDs:`, metadata.participants.map(p => normalizeJid(p.id)));
            return await sock.sendMessage(chatId, {
                text: `❌ *Bot not found in list*\n\nCould not verify Admin status.\n\nBot ID: ${botJid}`,
            }, { quoted: msg });
        }

        const isAdmin = botInfo && (botInfo.admin === 'admin' || botInfo.admin === 'superadmin');

        if (!isAdmin) {
            console.log(`[setgc] Bot found, but is: ${botInfo.admin}`);
            return await sock.sendMessage(chatId, {
                text: `⛔ *Permission Denied*\n\nI am present in the group, but I am a "${botInfo.admin}".\n\nPlease make the bot an Admin in Group Settings.`,
            }, { quoted: msg });
        }

        console.log(`[setgc] Permission Check: SUCCESS (Bot is ${botInfo.admin})`);

        // ── 4. Find the image ────────────────────────────────────────
        const m = msg.message;
        let imageMessage = null;

        if (m?.imageMessage) imageMessage = m.imageMessage;
        else if (m?.stickerMessage) imageMessage = m.stickerMessage;
        else {
            const quoted = m?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted?.imageMessage)   imageMessage = quoted.imageMessage;
            else if (quoted?.stickerMessage) imageMessage = quoted.stickerMessage;
        }

        if (!imageMessage) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ *How to use .setgc:*\n\nSend an image with caption .setgc',
            }, { quoted: msg });
        }

        // ── 5. Download image ────────────────────────────────────────
        const mediaType = m?.stickerMessage || m?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage
            ? 'sticker'
            : 'image';

        const stream = await downloadContentFromMessage(imageMessage, mediaType);
        
        let buffer = Buffer.alloc(0);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        if (!buffer.length) {
            return await sock.sendMessage(chatId, {
                text: '❌ Failed to download image.',
            }, { quoted: msg });
        }

        // ── 6. Save to tmp ─────────────────────────────────────────
        const tmpDir = path.join(process.cwd(), 'tmp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        const tmpPath = path.join(tmpDir, `setgc_${Date.now()}.jpg`);
        fs.writeFileSync(tmpPath, buffer);

        // ── 7. Update Group Profile Picture ────────────────────────────
        await sock.updateProfilePicture(chatId, { url: tmpPath });

        // ── 8. Cleanup ─────────────────────────────────────────
        setTimeout(() => {
            try { fs.unlinkSync(tmpPath); } catch (err) {
                console.error('[setgc] Failed to delete temp file:', err);
            }
        }, 2000);

        await sock.sendMessage(chatId, {
            text: '✅ *Group profile picture updated successfully!*',
        }, { quoted: msg });

    } catch (err) {
        console.error('[setgc] Error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to update group picture. Error: ' + err.message,
        }, { quoted: msg });
    }
}

module.exports = { name, desc, category, aliases, execute };