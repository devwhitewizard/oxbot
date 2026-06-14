const mumaker = require('mumaker');

const templates = {
  blackpinklogo: 'https://en.ephoto360.com/create-blackpink-logo-online-free-607.html',
  blackpinkstyle: 'https://en.ephoto360.com/online-blackpink-style-logo-generator-671.html',
  glossysilver: 'https://en.ephoto360.com/glossy-silver-3d-text-effect-180.html',
  glitchtext: 'https://en.ephoto360.com/create-digital-glitch-text-effects-online-767.html',
  arting: 'https://en.ephoto360.com/create-artistic-typography-art-online-763.html',
  advancedglow: 'https://en.ephoto360.com/create-advanced-glow-text-effect-online-813.html',
  cartoonstyle: 'https://en.ephoto360.com/create-cartoon-style-3d-text-effect-online-766.html',
  deadpool: 'https://en.ephoto360.com/create-deadpool-logo-style-text-effect-online-765.html',
  deletingtext: 'https://en.ephoto360.com/create-eraser-deleting-text-effect-online-522.html',
  luxurygold: 'https://en.ephoto360.com/gilded-gold-text-effect-223.html',
  '1917style': 'https://en.ephoto360.com/1917-style-text-effect-523.html',
  pixelglitch: 'https://en.ephoto360.com/create-pixel-glitch-text-effect-online-761.html',
  multicoloredneon: 'https://en.ephoto360.com/create-multicolored-neon-light-signatures-online-508.html',
  effectclouds: 'https://en.ephoto360.com/create-effect-clouds-text-effect-online-760.html',
  flagtext: 'https://en.ephoto360.com/create-flag-text-effect-online-759.html',
  freecreate: 'https://en.ephoto360.com/free-create-neon-light-text-effects-online-758.html',
  galaxystyle: 'https://en.ephoto360.com/create-galaxy-style-text-effect-online-757.html',
  bear: 'https://en.ephoto360.com/create-bear-logo-online-free-756.html',
  devilwings: 'https://en.ephoto360.com/create-devil-wings-logo-online-free-755.html',
  wolfgalaxy: 'https://en.ephoto360.com/create-wolf-galaxy-logo-online-free-754.html',
  comic: 'https://en.ephoto360.com/create-3d-comic-text-effects-online-753.html',
  textonwetglass: 'https://en.ephoto360.com/write-text-on-wet-glass-online-659.html',
  galaxywallpaper: 'https://en.ephoto360.com/create-galaxy-wallpaper-online-free-752.html',
  firetext: 'https://en.ephoto360.com/create-fire-text-effect-online-751.html',
  underwater: 'https://en.ephoto360.com/create-underwater-text-effect-online-750.html',
  neontext: 'https://en.ephoto360.com/create-neon-text-effect-online-749.html',
  metaltext: 'https://en.ephoto360.com/create-metal-text-effect-online-748.html',
  snowtext: 'https://en.ephoto360.com/create-snow-text-effect-online-747.html',
  icetext: 'https://en.ephoto360.com/create-ice-text-effect-online-746.html',
  purpletext: 'https://en.ephoto360.com/create-purple-text-effect-online-745.html',
  lighttext: 'https://en.ephoto360.com/create-light-text-effect-online-744.html',
  thundertext: 'https://en.ephoto360.com/create-thunder-text-effect-online-743.html',
  leavestext: 'https://en.ephoto360.com/create-leaves-text-effect-online-742.html',
  hackertext: 'https://en.ephoto360.com/create-hacker-text-effect-online-741.html',
  deviltext: 'https://en.ephoto360.com/create-devil-text-effect-online-740.html',
  vintagetext: 'https://en.ephoto360.com/create-vintage-text-effect-online-739.html',
  wingslogo: 'https://en.ephoto360.com/create-wings-logo-online-free-738.html',
  painttext: 'https://en.ephoto360.com/create-paint-text-effect-online-737.html',
  naruto: 'https://en.ephoto360.com/create-naruto-logo-online-free-736.html',
  pubglogo: 'https://en.ephoto360.com/create-pubg-logo-online-free-735.html',
  glowingtext: 'https://en.ephoto360.com/create-glowing-text-effect-online-734.html',
  corntext: 'https://en.ephoto360.com/create-corn-text-effect-online-733.html',
  makingneon: 'https://en.ephoto360.com/create-making-neon-text-effect-online-732.html',
  matrix: 'https://en.ephoto360.com/create-matrix-text-effect-online-731.html',
  royaltext: 'https://en.ephoto360.com/create-royal-text-effect-online-730.html',
  sand: 'https://en.ephoto360.com/create-sand-text-effect-online-729.html',
  summerbeach: 'https://en.ephoto360.com/create-summer-beach-text-effect-online-728.html',
  topography: 'https://en.ephoto360.com/create-topography-text-effect-online-727.html',
  typography: 'https://en.ephoto360.com/create-typography-text-effect-online-726.html',
  flux: 'https://en.ephoto360.com/create-flux-text-effect-online-725.html',
  dragonball: 'https://en.ephoto360.com/create-dragonball-text-effect-online-724.html',
};

module.exports = {
  name: 'blackpinklogo',
  aliases: Object.keys(templates).filter(k => k !== 'blackpinklogo'),
  category: 'textmaker',
  desc: 'Generate Ephoto360 text/image effects',

  async execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return;

    // Extract the exact command name used from the message text
    const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '').trim();
    if (!text) return;

    // Command prefix could be . or ! or custom. Get the first word and clean prefix.
    const rawCmd = text.split(/\s+/)[0].toLowerCase();
    const cmdName = rawCmd.replace(/^[.!]+/, '');

    const templateUrl = templates[cmdName];
    if (!templateUrl) {
      return await sock.sendMessage(chatId, { text: '❌ Invalid effect name.' }, { quoted: msg });
    }

    try {
      const inputText = args.join(' ');
      if (!inputText) {
        return await sock.sendMessage(chatId, {
          text: `❌ Please provide text!\nExample: .${cmdName} OxBot`
        }, { quoted: msg });
      }

      await sock.sendMessage(chatId, {
        text: `⏳ Generating *${cmdName.toUpperCase()}* effect...`
      }, { quoted: msg });

      // 15-second timeout for the scraper request
      const result = await Promise.race([
        mumaker.ephoto(templateUrl, inputText),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), 15000)
        )
      ]);

      if (!result || !result.image) {
        throw new Error('API did not return an image.');
      }

      await sock.sendMessage(chatId, {
        image: { url: result.image },
        caption: `🎨 *${cmdName.toUpperCase()} EFFECT*\n\n📝 *Text:* ${inputText}\n\n🛡️ *Powered by OxBot*`
      }, { quoted: msg });

    } catch (e) {
      console.error(`[Ephoto360:${cmdName}] Error:`, e.message);
      let errorMessage = e.message;

      if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
        errorMessage = 'Ephoto360 is currently blocking server requests (Cloudflare). Try again later.';
      } else if (errorMessage.includes('TIMEOUT')) {
        errorMessage = 'The request took too long. The ephoto360 site might be down.';
      } else if (errorMessage.includes('Cannot find module')) {
        errorMessage = 'Required dependency package is not installed.';
      }

      await sock.sendMessage(chatId, {
        text: `❌ *Error generating image.*\n_${errorMessage}_`
      }, { quoted: msg });
    }
  }
};
