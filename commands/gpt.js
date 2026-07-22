/**
 * commands/gpt.js
 * AI Chat Command - Directly embedded APIs (No external utils needed)
 */

const axios = require('axios');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const query = args.join(' ').trim();
    if (!query) {
        return await sock.sendMessage(chatId, { 
            text: '🤖 *GPT AI*\n\nPlease provide a question after the command.\n\nExample: *.gpt write a basic HTML code*' 
        }, { quoted: msg });
    }

    try {
        // Show robot reaction
        try {
            await sock.sendMessage(chatId, {
                react: { text: '🤖', key: msg.key }
            });
        } catch {}

        // Show typing indicator while waiting for AI
        await sock.sendPresenceUpdate('composing', chatId);

        let answer = null;

        // ── API 1: Shizo (Knight Bot's API - Free & Fast) ─────────────────
        if (!answer) {
            try {
                const response = await axios.get(`https://api.shizo.top/ai/gpt?apikey=shizo&query=${encodeURIComponent(query)}`, {
                    timeout: 30000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });
                
                // Extract the message exactly like Knight Bot does
                if (response.data && response.data.msg) {
                    answer = response.data.msg;
                }
            } catch (e) {
                console.error('[GPT] Shizo API failed, trying fallback...', e.message);
            }
        }

        // ── API 2: ZellAPI (Fallback if Shizo is down) ────────────────────
        if (!answer) {
            try {
                const response = await axios.get(`https://zellapi.autos/ai/chatbot?text=${encodeURIComponent(query)}`, {
                    timeout: 30000
                });
                
                if (response.data && response.data.status && response.data.result) {
                    answer = response.data.result;
                }
            } catch (e) {
                console.error('[GPT] ZellAPI fallback failed:', e.message);
            }
        }

        // Stop typing indicator
        await sock.sendPresenceUpdate('paused', chatId);

        // ── SEND THE ANSWER ────────────────────────────────────────────────
        if (answer) {
            await sock.sendMessage(chatId, { text: answer }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, { 
                text: "❌ Failed to get response from AI. The servers might be busy, please try again later."
            }, { quoted: msg });
        }

    } catch (error) {
        console.error('Error in gpt command:', error);
        await sock.sendPresenceUpdate('paused', chatId);
        await sock.sendMessage(chatId, { 
            text: "❌ An unexpected error occurred while contacting the AI."
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
