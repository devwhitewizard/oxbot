const { downloadMediaMessage } = require('@whiskeysockets/baileys');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const m = msg.message;
    const db = botData?.db || sock?._botData?.db;
    const sessionId = botData?.sessionId || sock?._botData?.sessionId;

    if (!db || !sessionId) {
        return await sock.sendMessage(chatId, { text: '❌ Cannot access database or session.' }, { quoted: msg });
    }

    const isQuotedImage = m.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
    const isDirectImage = m.imageMessage;

    if (!isQuotedImage && !isDirectImage) {
        return await sock.sendMessage(chatId, {
            text: '❌ *Reply to an image* to set it as your menu picture.\n\n_Hold the image message, select "Reply", and type .setmenupicture_'
        }, { quoted: msg });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ★ ROBUST DB LOOKUP ★
    // ══════════════════════════════════════════════════════════════════════════
    let actualDbSessionId = null;
    let userId = null; // ★ FIXED: Declare userId up here so both checks can set it

    const [botRows] = await db.query(
        'SELECT user_id, session_id FROM bots WHERE session_id = ? LIMIT 1', [sessionId]
    );
    
    if (botRows.length) {
        actualDbSessionId = botRows[0].session_id;
        userId = botRows[0].user_id;
    } else if (!String(sessionId).startsWith('oxbot_')) {
        const [botRows2] = await db.query(
            'SELECT user_id, session_id FROM bots WHERE session_id = ? LIMIT 1', [`oxbot_${sessionId}`]
        );
        if (botRows2.length) {
            actualDbSessionId = botRows2[0].session_id;
            userId = botRows2[0].user_id; // ★ FIXED: Grab userId from the second check too!
        }
    }

    if (!actualDbSessionId || !userId) {
        return await sock.sendMessage(chatId, { text: '❌ Bot session not found in database.' }, { quoted: msg });
    }

    // ── CHECK PRO PLAN ────────────────────────────────────────────────────────
    const [proRows] = await db.query(
        `SELECT id FROM pro_subscriptions WHERE user_id = ? AND status = 'active' AND expires_at > NOW() LIMIT 1`,
        [userId] // Now this will correctly have your real user ID
    );

    if (!proRows.length) {
        return await sock.sendMessage(chatId, {
            text: '👑 *Pro Plan Required*\n\n_Changing the menu picture is a premium feature._\n\n_Upgrade to Pro to customize your bot._'
        }, { quoted: msg });
    }

    await sock.sendMessage(chatId, { text: '🖼️ *Processing image...*' }, { quoted: msg });

    try {
        let buffer;

        if (isQuotedImage) {
            buffer = await downloadMediaMessage(
                { key: msg.key, message: { imageMessage: isQuotedImage } },
                'buffer', {}
            );
        } else {
            buffer = await downloadMediaMessage(msg, 'buffer', {});
        }

        if (!buffer || !(buffer.length || buffer.byteLength)) {
            throw new Error('Failed to download image');
        }

        const finalBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

        if (finalBuffer.length > 5 * 1024 * 1024) {
            return await sock.sendMessage(chatId, { text: '❌ Image is too large. Maximum size is 5MB.' }, { quoted: msg });
        }

        const mimeType = isQuotedImage?.mimetype || isDirectImage?.mimetype || 'image/jpeg';

        // ── Save to Database ──────────────────────────────────────────────────
        await db.query(`ALTER TABLE bot_settings ADD COLUMN menu_image VARCHAR(20) DEFAULT 'default'`).catch(() => {});

        await db.query(
            `INSERT INTO bot_images (user_id, session_id, image_data, mime_type)
             VALUES (?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE image_data = ?, mime_type = ?, uploaded_at = NOW()`,
            [userId, actualDbSessionId, finalBuffer, mimeType, finalBuffer, mimeType]
        );

        await db.query(
            `INSERT INTO bot_settings (session_id, menu_image) VALUES (?, 'custom')
             ON DUPLICATE KEY UPDATE menu_image = 'custom'`,
            [actualDbSessionId]
        );

        // ── Cache in Memory ───────────────────────────────────────────────────
        sock._customMenuImage = finalBuffer;

        await sock.sendMessage(chatId, {
            text: '✅ *Menu Picture Updated Successfully!*\n\n_Your custom image will now appear when you use commands like .pro_'
        }, { quoted: msg });

    } catch (err) {
        console.error('[SetMenuPic] Error:', err.message);
        await sock.sendMessage(chatId, {
            text: `❌ *Failed to save image.*\n_Error: ${err.message}_`
        }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'setmenupicture',
    aliases: ['setmenu', 'menuimg', 'setmenupic'],
    desc: 'Set a custom menu image for your bot (Pro only)',
    category: 'owner',
    execute
};