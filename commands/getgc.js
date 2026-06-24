/**
 * commands/getgc.js
 * Get profile picture of the current group
 */

const axios = require('axios');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    try {
        // Must be a group
        if (!chatId.endsWith('@g.us')) {
            return await sock.sendMessage(chatId, {
                text: '❌ *This command only works in groups.*'
            }, { quoted: msg });
        }

        await sock.sendMessage(chatId, { text: '📸 *Fetching group profile picture...*' }, { quoted: msg });

        // Fetch the group profile picture URL
        let ppUrl;
        try {
            ppUrl = await sock.profilePictureUrl(chatId, 'image');
        } catch (e) {
            // profilePictureUrl throws if no picture is set
            return await sock.sendMessage(chatId, {
                text: '❌ *This group has no profile picture set.*\n_An admin needs to set one first._'
            }, { quoted: msg });
        }

        if (!ppUrl) {
            return await sock.sendMessage(chatId, {
                text: '❌ *Group profile picture not found.*'
            }, { quoted: msg });
        }

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

        // Get group metadata for the name
        let groupName = 'Unknown Group';
        try {
            const metadata = await sock.groupMetadata(chatId);
            groupName = metadata.subject || 'Unknown Group';
        } catch (e) {}

        // Get member count
        let memberCount = 0;
        try {
            const metadata = await sock.groupMetadata(chatId);
            memberCount = metadata.participants?.length || 0;
        } catch (e) {}

        // Get group ID (clean format)
        const cleanId = chatId.split('@')[0];

        // Send the group profile picture
        await sock.sendMessage(chatId, {
            image: imageBuffer,
            caption: `👥 *Group Profile Picture*\n\n📌 *Name:* ${groupName}\n🔢 *Members:* ${memberCount}\n🆔 *ID:* ${cleanId}`
        }, { quoted: msg });

    } catch (err) {
        console.error('[GETGC] Error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ *Failed to fetch group profile picture.*\n_The group might not have a picture set, or there is a network issue._'
        }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'getgc',
    aliases: ['gcpp', 'gcicon', 'groupicon'],
    desc: 'Get profile picture of the current group',
    category: 'general',
    execute
}; 