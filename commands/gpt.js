const axios = require('axios');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const query = args.join(' ').trim();
    if (!query) {
        await sock.sendMessage(chatId, { 
            text: '🤖 *GPT AI*\n\nPlease provide a question after the command.\n\nExample: *.gpt write a basic HTML code*' 
        }, { quoted: msg });
        return null;
    }

    try {
        // Show processing reaction
        try {
            await sock.sendMessage(chatId, {
                react: { text: '🤖', key: msg.key }
            });
        } catch {}

        const response = await axios.get(`https://zellapi.autos/ai/chatbot?text=${encodeURIComponent(query)}`);
        
        if (response.data && response.data.status && response.data.result) {
            const answer = response.data.result;
            await sock.sendMessage(chatId, { text: answer }, { quoted: msg });
        } else {
            throw new Error('Invalid response structure from GPT API');
        }
    } catch (error) {
        console.error('Error in gpt command:', error);
        await sock.sendMessage(chatId, { 
            text: "❌ Failed to get response from GPT. Please try again later."
        }, { quoted: msg });
    }
    return null;
}

module.exports = {
    name: 'gpt',
    aliases: ['chatgpt', 'ai'],
    desc: 'Ask ChatGPT a question',
    category: 'general',
    execute
};
