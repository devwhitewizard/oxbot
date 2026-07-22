/**
 * commands/sticker.js
 * Convert image/video to sticker (PRO ONLY) — Self-contained
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const webp = require('node-webpmux');
const crypto = require('crypto');

const name     = 'sticker';
const aliases  = ['s', 'stick', 'stiker'];
const desc     = 'Convert image/video to sticker (Pro)';
const category = 'general';

// ═══════════════════════════════════════════════════════════════════════════════
// PRO CHECK — Built directly into this file (no external dependency)
// ═══════════════════════════════════════════════════════════════════════════════

async function getOwnerUserId(db, sessionId) {
    if (!db || !sessionId) return null;
    try {
        // Try exact match
        let [rows] = await db.query(
            'SELECT user_id, session_id FROM bots WHERE session_id=? LIMIT 1',
            [sessionId]
        );
        if (rows.length) return { userId: rows[0].user_id, dbSessionId: rows[0].session_id };

        // Try oxbot_ prefix
        if (!String(sessionId).startsWith('oxbot_')) {
            [rows] = await db.query(
                'SELECT user_id, session_id FROM bots WHERE session_id=? LIMIT 1',
                [`oxbot_${sessionId}`]
            );
            if (rows.length) return { userId: rows[0].user_id, dbSessionId: rows[0].session_id };
        }
        return null;
    } catch (err) {
        console.error('[sticker] getOwnerUserId error:', err.message);
        return null;
    }
}

async function isProUser(db, userId) {
    if (!userId) return false;
    try {
        const [rows] = await db.query(
            `SELECT id FROM pro_subscriptions WHERE user_id=? AND status='active' AND expires_at > NOW() LIMIT 1`,
            [userId]
        );
        return rows.length > 0;
    } catch (err) {
        console.error('[sticker] isProUser error:', err.message);
        return false;
    }
}

/**
 * Check if user is Pro, block if not
 * @returns {boolean} true = blocked (free user), false = allowed (pro user)
 */
async function blockFreeUsers(sock, chatId, msg, botData) {
    const db = botData?.db;
    const sessionId = botData?.sessionId;

    // ── DEBUG: Log what we're receiving ──
    console.log('[sticker] Pro Check:', {
        hasDb: !!db,
        sessionId: sessionId || 'UNDEFINED',
        hasBotData: !!botData
    });

    // If no DB at all, this is local/dev mode — allow
    if (!db) {
        console.log('[sticker] No DB found — allowing (dev mode)');
        return false;
    }

    // If no sessionId, can't check — allow (shouldn't happen in production)
    if (!sessionId) {
        console.log('[sticker] No sessionId — allowing');
        return false;
    }

    // Get the owner's user_id from bots table
    const ownerData = await getOwnerUserId(db, sessionId);
    
    console.log('[sticker] Owner data:', ownerData ? `userId=${ownerData.userId}` : 'NOT FOUND');

    if (!ownerData) {
        // User not in DB at all — treat as free
        console.log('[sticker] Owner not found in DB — blocking');
        await sock.sendMessage(chatId, {
            text: '👑 *Pro Plan Required*\n\n_Sticker maker is a premium feature. Free Trial users cannot use this._\n\n_Upgrade to Pro at: https://oxbot.name.ng/dashboard_'
        }, { quoted: msg });
        return true; // BLOCKED
    }

    // Check pro_subscriptions table
    const proOn = await isProUser(db, ownerData.userId);
    
    console.log('[sticker] Pro status:', proOn ? 'ACTIVE ✅' : 'INACTIVE ❌');

    if (!proOn) {
        await sock.sendMessage(chatId, {
            text: '👑 *Pro Plan Required*\n\n_Sticker maker is a premium feature. Free Trial users cannot use this._\n\n_Upgrade to Pro at: https://oxbot.name.ng/dashboard_'
        }, { quoted: msg });
        return true; // BLOCKED
    }

    return false; // ALLOWED — user is Pro
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMMAND
// ═══════════════════════════════════════════════════════════════════════════════

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    // ★ PRO CHECK ★
    try {
        const isBlocked = await blockFreeUsers(sock, chatId, msg, botData);
        if (isBlocked) return null;
    } catch (err) {
        console.error('[sticker] Pro check crashed:', err.message);
        // If check crashes, block to be safe
        await sock.sendMessage(chatId, {
            text: '❌ Could not verify your plan. Please try again.'
        }, { quoted: msg });
        return null;
    }

    // ── Rest of sticker logic (UNCHANGED) ──────────────────────────────────

    let targetMessage = msg;

    if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const ctx = msg.message.extendedTextMessage.contextInfo;
        targetMessage = {
            key: { remoteJid: chatId, id: ctx.stanzaId, participant: ctx.participant },
            message: ctx.quotedMessage
        };
    }

    const mediaMessage = targetMessage.message?.imageMessage
        || targetMessage.message?.videoMessage
        || targetMessage.message?.documentMessage;

    if (!mediaMessage) {
        return await sock.sendMessage(chatId, {
            text: 'Send an image/video with *.sticker* as caption, or reply to an image/video with *.sticker*.'
        }, { quoted: msg });
    }

    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const tempInput  = path.join(tmpDir, `in_${Date.now()}`);
    const tempOutput = path.join(tmpDir, `out_${Date.now()}.webp`);

    try {
        const mediaBuffer = await downloadMediaMessage(targetMessage, 'buffer', {}, {
            logger: undefined,
            reuploadRequest: sock.updateMediaMessage
        });

        if (!mediaBuffer) {
            return await sock.sendMessage(chatId, { text: '❌ Failed to download media.' }, { quoted: msg });
        }

        fs.writeFileSync(tempInput, mediaBuffer);

        const isAnimated = mediaMessage.mimetype?.includes('gif')
            || mediaMessage.mimetype?.includes('video')
            || (mediaMessage.seconds || 0) > 0;

        const baseCmd = isAnimated
            ? `ffmpeg -y -i "${tempInput}" -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 75 -compression_level 6 "${tempOutput}"`
            : `ffmpeg -y -i "${tempInput}" -vf "scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 75 -compression_level 6 "${tempOutput}"`;

        await new Promise((resolve, reject) => {
            exec(baseCmd, (err) => err ? reject(err) : resolve());
        });

        let webpBuffer = fs.readFileSync(tempOutput);

        // Fallback #1 — Over 1MB
        if (isAnimated && webpBuffer.length > 1000 * 1024) {
            const fb1 = path.join(tmpDir, `fb1_${Date.now()}.webp`);
            const huge = mediaBuffer.length > 5000 * 1024;
            const fbCmd = huge
                ? `ffmpeg -y -i "${tempInput}" -t 2 -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=8,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 30 -compression_level 6 -b:v 100k -max_muxing_queue_size 1024 "${fb1}"`
                : `ffmpeg -y -i "${tempInput}" -t 3 -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=12,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 45 -compression_level 6 -b:v 150k -max_muxing_queue_size 1024 "${fb1}"`;
            try {
                await new Promise((resolve, reject) => { exec(fbCmd, (err) => err ? reject(err) : resolve()); });
                if (fs.existsSync(fb1)) { webpBuffer = fs.readFileSync(fb1); fs.unlinkSync(fb1); }
            } catch {}
        }

        // Fallback #2 — Still too big, 320px
        if (isAnimated && webpBuffer.length > 900 * 1024) {
            const fb2 = path.join(tmpDir, `fb2_${Date.now()}.webp`);
            const smallCmd = `ffmpeg -y -i "${tempInput}" -t 2 -vf "scale=320:320:force_original_aspect_ratio=decrease,fps=8,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=#00000000" -c:v libwebp -preset default -loop 0 -vsync 0 -pix_fmt yuva420p -quality 30 -compression_level 6 -b:v 80k -max_muxing_queue_size 1024 "${fb2}"`;
            try {
                await new Promise((resolve, reject) => { exec(smallCmd, (err) => err ? reject(err) : resolve()); });
                if (fs.existsSync(fb2)) { webpBuffer = fs.readFileSync(fb2); fs.unlinkSync(fb2); }
            } catch {}
        }

        // EXIF Metadata
        const img = new webp.Image();
        await img.load(webpBuffer);
        const packName = (botData?.settings?.packname) || 'OxBot';
        const json = {
            'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
            'sticker-pack-name': packName,
            'emojis': ['🤖']
        };
        const exifAttr = Buffer.from([0x49,0x49,0x2A,0x00,0x08,0x00,0x00,0x00,0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,0x00,0x00,0x16,0x00,0x00,0x00]);
        const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
        const exif = Buffer.concat([exifAttr, jsonBuf]);
        exif.writeUIntLE(jsonBuf.length, 14, 4);
        img.exif = exif;
        const finalBuffer = await img.save(null);

        await sock.sendMessage(chatId, { sticker: finalBuffer }, { quoted: msg });

    } catch (error) {
        console.error('[sticker] Error:', error.message);
        await sock.sendMessage(chatId, { text: '❌ Failed to create sticker!' }, { quoted: msg });
    } finally {
        try { fs.unlinkSync(tempInput); }  catch {}
        try { fs.unlinkSync(tempOutput); } catch {}
    }

    return null;
}

module.exports = { name, desc, category, aliases, execute };