module.exports = {
    name: 'mode',
    desc: 'Change bot mode (public/private)',
    category: 'owner',
    
    async execute(sock, msg, botData, args) {
        const chatId = msg.key.remoteJid;
        const fromMe = msg.key.fromMe === true;
        
        // Resolve sender correctly for DMs and Groups
        const isGroup = chatId?.endsWith('@g.us');
        let sender;
        if (isGroup) {
            sender = msg.key.participant || msg.key.remoteJid;
        } else if (fromMe) {
            sender = sock.user?.id || msg.key.remoteJid;
        } else {
            sender = msg.key.remoteJid;
        }

        // Check if user is owner/sudo
        const isOwner = await botData.isOwnerAsync(sock, sender, chatId, fromMe);
        if (!isOwner) return;

        const action = args[0]?.toLowerCase();

        // No argument — show current mode
        if (!['public', 'private'].includes(action)) {
            const cur = await botData.getModeForSocket(sock);
            await sock.sendMessage(chatId, {
                text:
                    `*Bot Mode*\n\n` +
                    `Current: *${cur.toUpperCase()}*\n\n` +
                    `Usage:\n- \`.mode public\`\n- \`.mode private\``
            }, { quoted: msg });
            return;
        }

        // Save to database
        const db = botData.db;
        const realSessionId = botData.sessionId || sock._ownerPhone;
        
        await botData.saveModeToDb(db, realSessionId, action);

        // Always update in-memory cache
        botData.setModeCache(sock, action);

        await sock.sendMessage(chatId, {
            text: action === 'public'
                ? '*PUBLIC MODE*\n\nEveryone can now use bot commands'
                : '*PRIVATE MODE*\n\nOnly owner/sudo can use commands'
        }, { quoted: msg });
    }
};