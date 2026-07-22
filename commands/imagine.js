/**
 * imagine.js — AI Image Generation via PrinceTech Flux API
 * ★ PRO ONLY — Pure SQL DB Version ★
 */

const axios = require('axios');

const API_BASE = 'https://api.princetechn.com/api/ai/fluximg';
const API_KEY = 'prince';

// ═══════════════════════════════════════════════════
// SQL HELPERS (Owner & Pro Checks)
// ═══════════════════════════════════════════════════

function cleanNumber(jid) {
    if (!jid) return '';
    return jid.split(':')[0].split('@')[0];
}

async function getOwnerNumber(db, sessionId) {
    try {
        const [rows] = await db.query(
            'SELECT u.phone FROM users u JOIN bots b ON b.user_id = u.id WHERE b.session_id = ? LIMIT 1',
            [sessionId]
        );
        if (!rows.length || !rows[0].phone) return null;
        return String(rows[0].phone).replace(/\D/g, '');
    } catch (err) {
        console.error('[imagine] DB error fetching owner:', err.message);
        return null;
    }
}

async function isOwner(db, sessionId, senderId, sock, chatId) {
    const ownerNumber = await getOwnerNumber(db, sessionId);
    if (!ownerNumber) return false;

    const ownerJid = ownerNumber + '@s.whatsapp.net';
    const senderClean = cleanNumber(senderId);

    if (senderId === ownerJid) return true;
    if (senderClean === ownerNumber) return true;
    if (senderId.includes(ownerNumber)) return true;

    // LID check for group chats
    if (sock && chatId && chatId.endsWith('@g.us') && senderId.includes('@lid')) {
        try {
            const metadata = await sock.groupMetadata(chatId);
            const participants = metadata.participants || [];
            const match = participants.find(p => {
                const pIdClean = cleanNumber(p.id || '');
                return pIdClean === ownerNumber || (p.id || '') === ownerJid;
            });
            if (match) return true;
        } catch (e) {
            console.error('[imagine] Group LID check error:', e.message);
        }
    }

    return false;
}

async function getOwnerUserId(db, sessionId) {
    if (!db || !sessionId) return null;
    try {
        let [rows] = await db.query(
            'SELECT user_id, session_id FROM bots WHERE session_id=? LIMIT 1',
            [sessionId]
        );
        if (rows.length) return { userId: rows[0].user_id, dbSessionId: rows[0].session_id };

        if (!String(sessionId).startsWith('oxbot_')) {
            [rows] = await db.query(
                'SELECT user_id, session_id FROM bots WHERE session_id=? LIMIT 1',
                [`oxbot_${sessionId}`]
            );
            if (rows.length) return { userId: rows[0].user_id, dbSessionId: rows[0].session_id };
        }
        return null;
    } catch (err) {
        console.error('[imagine] getOwnerUserId error:', err.message);
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
        console.error('[imagine] isProUser error:', err.message);
        return false;
    }
}

async function blockIfFree(sock, chatId, msg, db, sessionId) {
    if (!db || !sessionId) return false; // Dev mode — allow

    const ownerData = await getOwnerUserId(db, sessionId);
    const userId = ownerData?.userId;
    const proOn = await isProUser(db, userId);

    if (!proOn) {
        await sock.sendMessage(chatId, {
            text: '👑 *Pro Plan Required*\n\n_AI Image Generation is a premium feature. Free Trial users cannot use this._\n\n_Upgrade to Pro at: https://oxbot.name.ng/dashboard_'
        }, { quoted: msg });
        return true; // BLOCKED
    }
    return false; // ALLOWED
}

// ═══════════════════════════════════════════════════
// MAIN COMMAND EXECUTION
// ═══════════════════════════════════════════════════

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    if (!botData?.sessionId || !botData?.db) {
        return await sock.sendMessage(chatId, {
            text: '⚠️ Database error. Please restart the bot.'
        }, { quoted: msg });
    }

    // ★ PRO CHECK (Blocks free users immediately) ★
    if (await blockIfFree(sock, chatId, msg, botData.db, botData.sessionId)) {
        return null;
    }

    // ★ OWNER CHECK ★
    const senderId = msg.key.participant || msg.key.remoteJid;
    const senderIsOwner = await isOwner(
        botData.db, botData.sessionId, senderId, sock, chatId
    );

    if (!msg.key.fromMe && !senderIsOwner) {
        return await sock.sendMessage(chatId, {
            text: '❌ This command is only available for the owner!'
        }, { quoted: msg });
    }

    // ── PROMPT CHECK ──
    const prompt = args.join(' ').trim();
    if (!prompt) {
        return await sock.sendMessage(chatId, {
            text: `❌ *Usage:* .imagine <prompt>\n\n*Example:* .imagine a handsome gentle man in a black suit`
        }, { quoted: msg });
    }

    // ── API GENERATION ──
    try {
        // Send a processing message so the user knows the bot is working
        await sock.sendMessage(chatId, {
            text: `⏳ *Generating your image...*\n\n📝 Prompt: *${prompt}*`
        }, { quoted: msg });

        const apiUrl = `${API_BASE}?apikey=${API_KEY}&prompt=${encodeURIComponent(prompt)}`;
        
        // 1. Fetch the image URL from the API
        const { data } = await axios.get(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                Accept: 'application/json',
            },
            timeout: 120000,
        });

        if (!data?.success || data?.status !== 200 || !data?.result) {
            throw new Error(data?.message || 'API did not return an image');
        }

        // 2. Download the actual image buffer
        const imageResponse = await axios.get(data.result, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                Accept: 'image/*',
            },
            timeout: 120000,
        });

        const imageBuffer = Buffer.from(imageResponse.data);

        if (!imageBuffer || imageBuffer.length === 0) {
            throw new Error('Empty response from image URL');
        }

        const maxImageSize = 5 * 1024 * 1024;
        if (imageBuffer.length > maxImageSize) {
            throw new Error(`Image too large: ${(imageBuffer.length / 1024 / 1024).toFixed(2)}MB (max 5MB)`);
        }

        // 3. Send the generated image
        await sock.sendMessage(chatId, {
            image: imageBuffer,
            caption: `🎨 *OxBot Imagine*\n\n📝 *Prompt:* ${prompt}`
        }, { quoted: msg });

    } catch (error) {
        console.error('[imagine] Error:', error.message);

        if (error.response?.status === 429) {
            await sock.sendMessage(chatId, { text: '❌ Rate limit exceeded. Please try again later.' }, { quoted: msg });
        } else if (error.response?.status === 400) {
            await sock.sendMessage(chatId, { text: '❌ Invalid prompt. Please try a different prompt.' }, { quoted: msg });
        } else if (error.response?.status === 500) {
            await sock.sendMessage(chatId, { text: '❌ API Server error. Please try again later.' }, { quoted: msg });
        } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            await sock.sendMessage(chatId, { text: '❌ Request timed out. Image generation is taking too long. Please try again.' }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, { text: `❌ Failed to generate image: ${error.message}` }, { quoted: msg });
        }
    }
}

module.exports = {
    name: 'imagine',
    aliases: ['magic', 'magicai', 'aiimage', 'generate'],
    desc: 'Generate AI art from text prompt (Pro)',
    category: 'owner',
    execute
};