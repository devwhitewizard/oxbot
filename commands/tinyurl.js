module.exports = {
    name: 'tinyurl',
    aliases: ['shorten', 'short'],
    desc: 'Shorten a long URL',
    category: 'search',
    
    async execute(sock, msg, botData, args) {
        const chatId = msg.key.remoteJid;
        if (!args || args.length === 0) {
            return await sock.sendMessage(chatId, { 
                text: '❌ Provide a URL to shorten.\n*Example:* .tinyurl https://example.com/very/long/link' 
            }, { quoted: msg });
        }

        const url = args[0];
        if (!url.startsWith('http')) {
            return await sock.sendMessage(chatId, { text: '❌ Invalid URL. Make sure it starts with http:// or https://' }, { quoted: msg });
        }

        try {
            const fetch = (await import('node-fetch')).default;
            const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
            const shortUrl = await response.text();

            if (shortUrl.startsWith('http')) {
                await sock.sendMessage(chatId, { 
                    text: `🔗 *Link Shortened Successfully*\n\n📏 *Original:* ${url}\n✂️ *Short:* ${shortUrl}` 
                }, { quoted: msg });
            } else {
                throw new Error('API Error');
            }
        } catch (err) {
            await sock.sendMessage(chatId, { text: '❌ Failed to shorten URL. Try again later.' }, { quoted: msg });
        }
    }
};