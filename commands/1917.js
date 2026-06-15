const mumaker = require('mumaker');

module.exports = {
  name: '1917',
  aliases: [],
  category: 'textmaker',
  desc: 'Create 1917 style text effect',
  
  async execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    
    try {
      const text = args.join(' ');
      
      if (!text) {
        return await sock.sendMessage(chatId, { 
          text: `❌ Please provide text!\nExample: .1917 OxBot` 
        }, { quoted: msg });
      }

      await sock.sendMessage(chatId, { 
        text: `⏳ Generating 1917 effect...` 
      }, { quoted: msg });

      // ★ FIX: Switched back to working ephoto360 url from Nexus
      const result = await Promise.race([
        mumaker.ephoto(
          'https://en.ephoto360.com/1917-style-text-effect-523.html',
          text
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), 20000)
        )
      ]);

      if (!result || !result.image) throw new Error('API did not return an image.');

      await sock.sendMessage(chatId, { 
        image: { url: result.image }, 
        caption: `🎬 *1917 EFFECT*\n\n📝 *Text:* ${text}\n\n🛡️ *Powered by OxBot*`,
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: '120363421280626994@newsletter',
            newsletterName: 'OxBot',
            serverMessageId: -1
          }
        }
      }, { quoted: msg });

    } catch (e) {
      console.error('[1917] Error:', e.message);
      let errorMessage = e.message;
      
      // ★ FIX: Give the user a clear reason why it failed
      if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
        errorMessage = 'Ephoto360 is currently blocking server requests (Cloudflare). Try again later.';
      } else if (errorMessage.includes('TIMEOUT')) {
        errorMessage = 'The request took too long. The ephoto360 site might be down.';
      } else if (errorMessage.includes('Cannot find module')) {
        errorMessage = 'Mumaker package is not installed.';
      }

      await sock.sendMessage(chatId, { 
        text: `❌ *Error generating image.*\n_${errorMessage}_` 
      }, { quoted: msg });
    }
  }
};