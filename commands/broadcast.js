/**
 * commands/broadcast.js
 * Broadcast message (and media) to all groups & DMs
 */

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    try {
        // 1. Determine what to broadcast (Text or Quoted Media)
        const text = args.join(' ').trim();
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        const quotedMessage = contextInfo?.quotedMessage;

        let broadcastPayload = {};

        if (quotedMessage) {
            // Deep clone the quoted message and remove context to prevent quote loops
            const cleanMessage = JSON.parse(JSON.stringify(quotedMessage));
            delete cleanMessage.contextInfo; 
            
            broadcastPayload = cleanMessage;
            
            // If user typed text alongside the reply, add it to the caption
            if (text) {
                if (broadcastPayload.imageMessage) {
                    broadcastPayload.imageMessage.caption = `📢 *BROADCAST*\n\n${text}\n\n_From: Bot Owner_`;
                } else if (broadcastPayload.videoMessage) {
                    broadcastPayload.videoMessage.caption = `📢 *BROADCAST*\n\n${text}\n\n_From: Bot Owner_`;
                } else {
                    broadcastPayload.conversation = `📢 *BROADCAST*\n\n${text}\n\n_From: Bot Owner_`;
                }
            } else {
                // If no text typed, just tag the existing media as a broadcast
                if (broadcastPayload.imageMessage) {
                    broadcastPayload.imageMessage.caption = (broadcastPayload.imageMessage.caption || '') + '\n\n_📢 Broadcast Message_';
                } else if (broadcastPayload.videoMessage) {
                    broadcastPayload.videoMessage.caption = (broadcastPayload.videoMessage.caption || '') + '\n\n_📢 Broadcast Message_';
                } else if (broadcastPayload.conversation) {
                    broadcastPayload.conversation = `📢 *BROADCAST*\n\n${broadcastPayload.conversation}\n\n_From: Bot Owner_`;
                }
            }
        } else if (text) {
            // If just text is provided (no reply)
            broadcastPayload = {
                text: `╭━━━【 *BROADCAST* 】━━━╮\n│\n│ 📢 *Message:* ${text}\n│\n╰━━━━━━━━━━━━━━━━━━━╯`
            };
        } else {
            return await sock.sendMessage(chatId, {
                text: '❌ *Usage:*\n• `.broadcast <text>`\n• _Reply to an image/video/text with `.broadcast`_'
            }, { quoted: msg });
        }

        await sock.sendMessage(chatId, {
            text: '⏳ *Broadcasting...*\n_Sending to all groups and saved DMs. Please wait._'
        }, { quoted: msg });

        // 2. Fetch all target chats (100% reliable method)
        let allChats = [];

        // Fetch ALL groups the bot is in (Built-in Baileys function, doesn't need store)
        try {
            const groups = await sock.groupFetchAllParticipating();
            allChats.push(...Object.keys(groups));
        } catch (e) {
            console.error('[BC] Group fetch error:', e.message);
        }

        // Fetch DMs from store if available
        const store = sock.store;
        if (store?.chats) {
            const dms = Array.from(store.chats.values())
                .map(c => c.id)
                .filter(id => !id.endsWith('@g.us') && id !== 'status@broadcast');
            allChats.push(...dms);
        }

        if (allChats.length === 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ *No chats found.*\n_Make sure the bot is in at least one group._'
            }, { quoted: msg });
        }

        // Remove duplicates just in case
        allChats = [...new Set(allChats)];

        let success = 0;
        let failed = 0;

        // 3. Send to all chats
        for (const id of allChats) {
            try {
                await sock.sendMessage(id, broadcastPayload);
                success++;
                
                // 1.5 second delay to prevent WhatsApp temp-ban
                await new Promise(resolve => setTimeout(resolve, 1500)); 
            } catch (err) {
                failed++;
            }
        }

        // 4. Send final report
        await sock.sendMessage(chatId, {
            text: `✅ *Broadcast Complete!*\n\n📊 *Report:*\n• ✅ Success: ${success}\n• ❌ Failed: ${failed}\n• 📦 Total Chats: ${allChats.length}`
        }, { quoted: msg });

    } catch (err) {
        console.error('[BROADCAST] Error:', err.message);
        await sock.sendMessage(chatId, {
            text: `❌ *Broadcast Failed:*\n_${err.message}_`
        }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'broadcast',
    aliases: ['bc'],
    desc: 'Broadcast message/media to all chats',
    category: 'owner',
    execute
};