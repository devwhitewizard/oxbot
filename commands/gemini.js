const fetch = require('node-fetch');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const query = args.join(' ').trim();
    if (!query) {
        await sock.sendMessage(chatId, { 
            text: '✨ *Gemini AI*\n\nPlease provide a question after the command.\n\nExample: *.gemini what is gravity?*' 
        }, { quoted: msg });
        return null;
    }

    // Show processing reaction
    try {
        await sock.sendMessage(chatId, {
            react: { text: '✨', key: msg.key }
        });
    } catch {}

    const apis = [
        `https://vapis.my.id/api/gemini?q=${encodeURIComponent(query)}`,
        `https://api.siputzx.my.id/api/ai/gemini-pro?content=${encodeURIComponent(query)}`,
        `https://api.ryzendesu.vip/api/ai/gemini?text=${encodeURIComponent(query)}`,
        `https://zellapi.autos/ai/chatbot?text=${encodeURIComponent(query)}`,
        `https://api.giftedtech.my.id/api/ai/geminiai?apikey=gifted&q=${encodeURIComponent(query)}`
    ];

    for (const api of apis) {
        try {
            const response = await fetch(api);
            if (!response.ok) continue;

            const data = await response.json();
            const answer = data.message || data.data || data.answer || data.result;
            if (answer) {
                await sock.sendMessage(chatId, { text: answer }, { quoted: msg });
                return null;
            }
        } catch (e) {
            console.error(`Gemini API fallback error (${api}):`, e.message);
        }
    }

    await sock.sendMessage(chatId, { 
        text: "❌ All Gemini APIs failed. Please try again later."
    }, { quoted: msg });

    return null;
}

module.exports = {
    name: 'gemini',
    desc: 'Ask Google Gemini AI a question',
    category: 'general',
    execute
};
