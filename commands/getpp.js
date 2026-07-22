/**
 * commands/getpp.js
 * Get profile picture of a user (reply to message or tag user)
 */

const axios = require('axios');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    let targetJid = null;

    try {
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        
        // Priority 1: Replying to someone's message
        if (contextInfo?.participant) {
            targetJid = contextInfo.participant;
        } 
        // Priority 2: Tagging someone in the text (e.g. @user)
        else if (contextInfo?.mentionedJid?.length > 0) {
            targetJid = contextInfo.mentionedJid[0];
        }
        // Priority 3: If no reply or tag, get the sender of the current message
        else {
            targetJid = msg.key.participant || msg.key.remoteJid;
        }

        if (!targetJid) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Could not identify target user.*\n\n_Reply to a message or tag someone like @user_'
            }, { quoted: msg });
        }

        // Fetch the high-quality profile picture URL
        const ppUrl = await sock.profilePictureUrl(targetJid, 'image');
        
        if (!ppUrl) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Profile picture not found.*\n_The user might have a default picture, or it is hidden._'
            }, { quoted: msg });
        }

        await sock.sendMessage(chatId, { text: '📸 *Fetching profile picture...*' }, { quoted: msg });

        // Download the image
        const response = await axios.get(ppUrl, { 
            responseType: 'arraybuffer', 
            timeout: 15000 
        });
        const imageBuffer = Buffer.from(response.data);

        // Check if it's too large
        if (imageBuffer.length > 5 * 1024 * 1024) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Image is too large to send.*'
            }, { quoted: msg });
        }

        // Extract clean phone number for the caption
        const cleanPhone = targetJid.split(':')[0].split('@')[0];

        // Send the profile picture
        await sock.sendMessage(chatId, {
            image: imageBuffer,
            caption: `👤 *Profile Picture*\n@${cleanPhone}`,
            mentions: [targetJid]
        }, { quoted: msg });

    } catch (err) {
        console.error('[GETPP] Error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ *Failed to fetch profile picture.*\n_The user might have a private profile or there is a network issue._'
        }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'getpp',
    aliases: ['gp', 'getpic'],
    desc: 'Get profile picture of a user',
    category: 'general',
    execute
}; 