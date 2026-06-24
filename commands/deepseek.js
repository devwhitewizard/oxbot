const axios = require('axios');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const q = args.join(' ').trim();
    if (!q) {
        await sock.sendMessage(chatId, { text: '❌ Usage: .deepseek <question>' }, { quoted: msg });
        return null;
    }

    await sock.sendMessage(chatId, { text: '🧠 *DeepSeek AI* thinking...' }, { quoted: msg });

    try {
        const res = await axios.post('https://api-inference.huggingface.co/models/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B', 
            { 
                inputs: q, 
                parameters: { max_new_tokens: 300, return_full_text: false } 
            }, 
            { 
                headers: { 'Content-Type': 'application/json' }, 
                timeout: 30000 
            }
        );

        let ans = Array.isArray(res.data) ? res.data[0]?.generated_text : res.data?.generated_text;
        ans = (ans || 'No response').replace(/<think[\s\S]*?<\/think>/g, '').trim();

        await sock.sendMessage(chatId, {
            text: `🧠 *DeepSeek AI*\n━━━━━━━━━━━━\n❓ ${q}\n\n💬 ${ans}`
        }, { quoted: msg });

    } catch {
        await sock.sendMessage(chatId, { text: '❌ DeepSeek unavailable. Try .gpt instead.' }, { quoted: msg });
    }
    return null;
}

module.exports = {
    name: 'deepseek',
    aliases: ['ds'],
    desc: 'Ask DeepSeek AI a question',
    category: 'general',
    execute
};