module.exports = {
    name: 'readmore',
    aliases: ['rm'],
    desc: 'Hide text behind a read more button',
    category: 'media',
    
    async execute(sock, msg, botData, args) {
        const chatId = msg.key.remoteJid;
        if (!args || args.length === 0) {
            return await sock.sendMessage(chatId, { 
                text: `❌ Provide text and hidden text.\n\n*Example:*\n.readmore Hello | This is the hidden secret message!` 
            }, { quoted: msg });
        }

        const text = args.join(' ');
        const parts = text.split('|');
        
        if (parts.length < 2) {
            return await sock.sendMessage(chatId, { 
                text: '❌ Use `|` to separate visible text and hidden text.\n*Example:* .readmore Hi | Hidden text' 
            }, { quoted: msg });
        }

        const visibleText = parts[0].trim();
        const hiddenText = parts.slice(1).join('|').trim();
        
        // 10,000 invisible characters force WhatsApp to collapse it into "Read More"
        const readMoreChar = '\u200E'.repeat(10000);
        const finalText = `${visibleText}${readMoreChar}${hiddenText}`;

        await sock.sendMessage(chatId, { text: finalText }, { quoted: msg });
    }
};