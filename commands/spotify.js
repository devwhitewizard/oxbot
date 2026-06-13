const axios = require('axios');

module.exports = {
    name: 'spotify',
    desc: 'Download music from Spotify',
    category: 'downloader',
    
    async execute(sock, msg, botData, args) {
        const chatId = msg.key.remoteJid;
        
        // The handler already splits the command, so args is just the song name
        const query = args.join(' ').trim();

        if (!query) {
            await sock.sendMessage(chatId, { 
                text: 'Usage: .spotify <song/artist/keywords>\nExample: .spotify con calma' 
            }, { quoted: msg });
            return;
        }

        try {
            await sock.sendMessage(chatId, { 
                text: `🔍 Searching for *"${query}"* on Spotify...` 
            }, { quoted: msg });

            const apiUrl = `https://okatsu-rolezapiiz.vercel.app/search/spotify?q=${encodeURIComponent(query)}`;
            const { data } = await axios.get(apiUrl, { 
                timeout: 20000, 
                headers: { 'user-agent': 'Mozilla/5.0' } 
            });

            if (!data?.status || !data?.result) {
                throw new Error('No result from Spotify API');
            }

            const r = data.result;
            const audioUrl = r.audio;
            
            if (!audioUrl) {
                await sock.sendMessage(chatId, { 
                    text: 'No downloadable audio found for this query.' 
                }, { quoted: msg });
                return;
            }

            const caption = `🎵 *${r.title || r.name || 'Unknown Title'}*\n👤 ${r.artist || 'Unknown Artist'}\n⏱ ${r.duration || 'Unknown Duration'}\n🔗 ${r.url || ''}`.trim();

            // Send cover image and song info first
            if (r.thumbnails) {
                await sock.sendMessage(chatId, { 
                    image: { url: r.thumbnails }, 
                    caption: caption
                }, { quoted: msg });
            } else {
                await sock.sendMessage(chatId, { text: caption }, { quoted: msg });
            }

            // Send the actual audio file
            await sock.sendMessage(chatId, {
                audio: { url: audioUrl },
                mimetype: 'audio/mpeg',
                fileName: `${(r.title || r.name || 'track').replace(/[\\/:*?"<>|]/g, '')}.mp3`
            }, { quoted: msg });

        } catch (error) {
            console.error('[SPOTIFY] error:', error?.message || error);
            await sock.sendMessage(chatId, { 
                text: '❌ Failed to fetch Spotify audio. Try another query later.' 
            }, { quoted: msg });
        }
    }
};