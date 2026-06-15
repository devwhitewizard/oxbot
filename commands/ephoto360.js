/**
 * @file commands/ephoto360.js
 * @description Text & photo effect image generator using TextPro.me.
 * 
 * HOW IT WORKS:
 * - Users run commands like .firetext, .neontext, .glitchtext, etc.
 * - mumaker.textpro() scrapes textpro.me and returns a generated image URL.
 * - The image URL is sent to the chat as a photo.
 * 
 * NOTE: Previously used ephoto360.com but that site changed its JS-based form
 * submission in 2025 making static scraping impossible. TextPro.me uses the same
 * mumaker API and is confirmed working.
 * 
 * CONNECTIONS:
 * - Uses mumaker npm package (mumaker.textpro)
 * - Loaded by botManager.js commandLoader
 */

const mumaker = require('mumaker');

// ── WORKING TextPro.me effects (verified 2025) ─────────────────────────────
const templates = {
  // Fire / Flame
  firetext:         'https://textpro.me/make-glitter-text-effect-online-899.html',
  flame:            'https://textpro.me/fire-text-effect-free-online-generator-912.html',

  // Neon / Glow
  neontext:         'https://textpro.me/neon-text-effect-online-free-generator-910.html',
  neon:             'https://textpro.me/neon-text-effect-online-free-generator-910.html',
  glowingtext:      'https://textpro.me/neon-glow-text-effect-online-generator-914.html',
  multicoloredneon: 'https://textpro.me/create-neon-sign-text-effect-online-free-937.html',

  // Metallic / Gold / Silver
  metaltext:        'https://textpro.me/glossy-metallic-chrome-3d-text-effect-1185.html',
  luxurygold:       'https://textpro.me/gold-3d-text-effect-online-generator-908.html',
  goldtext:         'https://textpro.me/gold-3d-text-effect-online-generator-908.html',
  glossysilver:     'https://textpro.me/silver-3d-text-effect-online-generator-907.html',
  silvertext:       'https://textpro.me/silver-3d-text-effect-online-generator-907.html',

  // Ice / Snow / Water
  icetext:          'https://textpro.me/ice-text-effect-online-free-generator-915.html',
  snowtext:         'https://textpro.me/snow-text-effect-online-generator-916.html',
  underwater:       'https://textpro.me/underwater-text-effect-online-free-generator-917.html',

  // Galaxy / Space
  galaxystyle:      'https://textpro.me/galaxy-text-effect-online-free-generator-906.html',
  galaxy:           'https://textpro.me/galaxy-text-effect-online-free-generator-906.html',
  galaxywallpaper:  'https://textpro.me/galaxy-text-effect-online-free-generator-906.html',
  wolfgalaxy:       'https://textpro.me/galaxy-text-effect-online-free-generator-906.html',

  // Matrix / Hacker / Glitch
  matrix:           'https://textpro.me/matrix-style-text-effect-online-884.html',
  hackertext:       'https://textpro.me/matrix-style-text-effect-online-884.html',
  glitchtext:       'https://textpro.me/glitch-text-effect-online-free-generator-923.html',
  pixelglitch:      'https://textpro.me/glitch-text-effect-online-free-generator-923.html',

  // 3D Effects
  '3dtext':         'https://textpro.me/create-3d-text-effect-online-free-generator-956.html',
  cartoonstyle:     'https://textpro.me/create-cartoon-3d-text-effect-free-online-952.html',
  comic:            'https://textpro.me/create-cartoon-3d-text-effect-free-online-952.html',

  // Blackpink / K-Pop
  blackpinklogo:    'https://textpro.me/create-a-mystical-neon-blackpink-logo-text-effect-1180.html',
  blackpinkstyle:   'https://textpro.me/create-a-mystical-neon-blackpink-logo-text-effect-1180.html',

  // Naruto / Anime / Gaming
  naruto:           'https://textpro.me/create-naruto-logo-text-effect-online-929.html',
  pubglogo:         'https://textpro.me/pubg-style-logo-text-effect-online-free-934.html',
  deadpool:         'https://textpro.me/deadpool-text-effect-online-free-generator-922.html',

  // Nature / Seasonal
  leavestext:       'https://textpro.me/leaves-text-effect-online-free-generator-918.html',
  thundertext:      'https://textpro.me/lightning-thunder-text-effect-online-free-920.html',

  // Stylish / Vintage / Royal
  vintagetext:      'https://textpro.me/vintage-text-effect-online-free-generator-896.html',
  royaltext:        'https://textpro.me/create-royal-crown-text-effect-online-942.html',
  luxurytext:       'https://textpro.me/create-royal-crown-text-effect-online-942.html',

  // Misc
  glitter:          'https://textpro.me/make-glitter-text-effect-online-899.html',
  arting:           'https://textpro.me/create-artistic-3d-text-effects-from-corn-kernels-1177.html',
  corntext:         'https://textpro.me/create-artistic-3d-text-effects-from-corn-kernels-1177.html',
  painttext:        'https://textpro.me/watercolor-paint-text-effect-online-893.html',
  dragonball:       'https://textpro.me/dragon-ball-z-text-effect-online-generator-931.html',
  
  // Newer popular effects
  hologram:         'https://textpro.me/create-online-3d-hologram-glass-text-effect-1163.html',
  candy:            'https://textpro.me/online-cute-3d-candy-text-effect-generator-1192.html',
  crystal:          'https://textpro.me/luxurious-and-creative-sparkling-colored-crystal-text-effect-1190.html',
  marble:           'https://textpro.me/create-a-luxurious-blue-marble-text-effect-1176.html',
  pearl:            'https://textpro.me/create-elegant-3d-pearl-text-effects-online-1168.html',
};

const commandName = 'firetext';
const aliases = Object.keys(templates).filter(k => k !== commandName);

module.exports = {
  name: commandName,
  aliases,
  category: 'textmaker',
  desc: 'Generate stylish text effects using TextPro.me',

  async execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return;

    // Get the exact command name used
    const text = (
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption || ''
    ).trim();
    if (!text) return;

    const rawCmd  = text.split(/\s+/)[0].toLowerCase();
    const cmdName = rawCmd.replace(/^[.!]+/, '');

    const templateUrl = templates[cmdName];
    if (!templateUrl) {
      return await sock.sendMessage(chatId, { text: '❌ Invalid effect name.' }, { quoted: msg });
    }

    const inputText = args.join(' ').trim();
    if (!inputText) {
      return await sock.sendMessage(chatId, {
        text: `❌ Please provide text!\nExample: .${cmdName} OxBot`
      }, { quoted: msg });
    }

    try {
      await sock.sendMessage(chatId, {
        text: `⏳ Generating *${cmdName.toUpperCase()}* effect...`
      }, { quoted: msg });

      // 20-second timeout
      const result = await Promise.race([
        mumaker.textpro(templateUrl, inputText),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), 20000)
        )
      ]);

      if (!result || !result.image) {
        throw new Error('No image returned from server.');
      }

      await sock.sendMessage(chatId, {
        image: { url: result.image },
        caption: `🎨 *${cmdName.toUpperCase()} EFFECT*\n\n📝 *Text:* ${inputText}\n\n🛡️ *Powered by OxBot*`
      }, { quoted: msg });

    } catch (e) {
      console.error(`[TextEffect:${cmdName}]`, e.message);
      let errMsg = e.message;

      if (errMsg.includes('403') || errMsg.includes('Forbidden')) {
        errMsg = 'The text effect server is temporarily blocking requests. Try again in a moment.';
      } else if (errMsg.includes('TIMEOUT')) {
        errMsg = 'Request timed out. The server might be busy — please try again.';
      } else if (errMsg.includes('Cannot find module')) {
        errMsg = 'Required dependency is not installed on this server.';
      } else if (errMsg.includes('No image')) {
        errMsg = 'The server returned no image. Please try a different effect or try again.';
      }

      await sock.sendMessage(chatId, {
        text: `❌ *Error generating image.*\n_${errMsg}_`
      }, { quoted: msg });
    }
  }
};
