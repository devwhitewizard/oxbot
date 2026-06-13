const axios = require('axios');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    let userToWaste;

    // Check for mentioned users
    const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
    const participant = msg.message?.extendedTextMessage?.contextInfo?.participant;

    if (mentionedJid && mentionedJid.length > 0) {
        userToWaste = mentionedJid[0];
    } else if (participant) {
        // If replying to a message without tagging, get their JID
        userToWaste = participant;
    }

    if (!userToWaste) {
        await sock.sendMessage(chatId, { 
            text: '⚰️ *Wasted*\n\nPlease tag someone or reply to their message to waste them!' 
        }, { quoted: msg });
        return null;
    }

    try {
        // Get user's profile picture
        let profilePic;
        try {
            profilePic = await sock.profilePictureUrl(userToWaste, 'image');
        } catch {
            // Fallback image if user has no profile picture
            profilePic = 'https://i.imgur.com/2wzGhpF.jpeg'; 
        }

        // Using popcat API since some-random-api is dead
        const wastedResponse = await axios.get(
            `https://api.popcat.xyz/wasted?image=${encodeURIComponent(profilePic)}`,
            { 
                responseType: 'arraybuffer', 
                timeout: 15000 
            }
        );

        // Send the wasted image
        await sock.sendMessage(chatId, {
            image: Buffer.from(wastedResponse.data),
            caption: `⚰️ *Wasted* : @${userToWaste.split('@')[0]} 💀\n\nRest in pieces!`,
            mentions: [userToWaste]
        }, { quoted: msg });

    } catch (error) {
        console.error('[wasted] Error:', error.message);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to create wasted image. The API might be down or the profile picture is unreachable.' 
        }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'wasted',
    aliases: ['rip', 'dead'],
    desc: 'Put a wasted overlay on a users profile picture',
    category: 'general',
    execute
};