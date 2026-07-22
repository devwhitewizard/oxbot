module.exports = {
    name: 'calc',
    aliases: ['calculate', 'math'],
    desc: 'Calculate a math expression',
    category: 'search',
    
    async execute(sock, msg, botData, args) {
        const chatId = msg.key.remoteJid;
        if (!args || args.length === 0) {
            return await sock.sendMessage(chatId, { 
                text: '❌ Provide a math problem.\n*Example:* .calc 25 * 4 + 10\n*Symbols:* +, -, *, /, %, (, )' 
            }, { quoted: msg });
        }

        const expression = args.join(' ');
        
        // Security: Only allow numbers and math symbols
        if (!/^[0-9+\-*/().%\s]+$/.test(expression)) {
            return await sock.sendMessage(chatId, { text: '❌ Invalid characters! Only use numbers and +, -, *, /, %, (, )' }, { quoted: msg });
        }

        try {
            // Safe evaluation
            const result = new Function(`return (${expression})`)();
            
            if (isNaN(result) || !isFinite(result)) {
                return await sock.sendMessage(chatId, { text: '❌ Math Error (Cannot divide by zero or invalid result)' }, { quoted: msg });
            }

            await sock.sendMessage(chatId, { 
                text: `🧮 *Calculator*\n\n📝 *Expression:* ${expression}\n✅ *Result:* ${result}` 
            }, { quoted: msg });
        } catch (err) {
            await sock.sendMessage(chatId, { text: '❌ Invalid math expression. Check your syntax.' }, { quoted: msg });
        }
    }
};