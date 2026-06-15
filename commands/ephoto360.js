/**
 * @file commands/ephoto360.js
 * @description Text & photo effect image generator using ephoto360.com.
 * 
 * HOW IT WORKS:
 * - Users run commands like .firetext, .neontext, .glitchtext, etc.
 * - mumaker.ephoto() scrapes en.ephoto360.com and returns a generated image URL.
 * - The image URL is sent to the chat as a photo.
 * 
 * CONNECTIONS:
 * - Uses mumaker npm package (mumaker.ephoto)
 * - Loaded by commands/index.js
 */

const mumaker = require('mumaker');

// ── ALL Ephoto360.com effects (matched to menu in help.js) ────────────────────
const templates = {
  // Fire / Flame
  fire:             'https://en.ephoto360.com/flame-lettering-effect-372.html',
  flame:            'https://en.ephoto360.com/flame-lettering-effect-372.html',
  firetext:         'https://en.ephoto360.com/flame-lettering-effect-372.html',

  // Neon / Glow
  neon:             'https://en.ephoto360.com/create-colorful-neon-light-text-effects-online-797.html',
  neontext:         'https://en.ephoto360.com/create-colorful-neon-light-text-effects-online-797.html',
  makingneon:       'https://en.ephoto360.com/create-colorful-neon-light-text-effects-online-797.html',
  multicoloredneon: 'https://en.ephoto360.com/create-colorful-neon-light-text-effects-online-797.html',
  glowingtext:      'https://en.ephoto360.com/create-colorful-neon-light-text-effects-online-797.html',
  advancedglow:     'https://en.ephoto360.com/create-colorful-neon-light-text-effects-online-797.html',

  // Glitch / Digital
  glitch:           'https://en.ephoto360.com/create-digital-glitch-text-effects-online-767.html',
  glitchtext:       'https://en.ephoto360.com/create-digital-glitch-text-effects-online-767.html',
  pixelglitch:      'https://en.ephoto360.com/create-digital-glitch-text-effects-online-767.html',

  // Devil / Wings
  devil:            'https://en.ephoto360.com/neon-devil-wings-text-effect-online-683.html',
  deviltext:        'https://en.ephoto360.com/neon-devil-wings-text-effect-online-683.html',
  devilwings:       'https://en.ephoto360.com/neon-devil-wings-text-effect-online-683.html',
  wingslogo:        'https://en.ephoto360.com/neon-devil-wings-text-effect-online-683.html',

  // Hacker / Anonymous
  hacker:           'https://en.ephoto360.com/create-anonymous-hacker-avatars-cyan-neon-677.html',
  hackertext:       'https://en.ephoto360.com/create-anonymous-hacker-avatars-cyan-neon-677.html',

  // Ice / Snow
  ice:              'https://en.ephoto360.com/ice-text-effect-online-101.html',
  icetext:          'https://en.ephoto360.com/ice-text-effect-online-101.html',
  snow:             'https://en.ephoto360.com/create-a-snow-3d-text-effect-free-online-621.html',
  snowtext:         'https://en.ephoto360.com/create-a-snow-3d-text-effect-free-online-621.html',
  underwater:       'https://en.ephoto360.com/create-underwater-3d-text-effect-online-633.html',

  // Leaves / Nature
  leaves:           'https://en.ephoto360.com/green-brush-text-effect-typography-maker-online-153.html',
  leavestext:       'https://en.ephoto360.com/green-brush-text-effect-typography-maker-online-153.html',
  galaxystyle:      'https://en.ephoto360.com/create-galaxy-text-effect-online-641.html',
  galaxywallpaper:  'https://en.ephoto360.com/create-galaxy-text-effect-online-641.html',
  wolfgalaxy:       'https://en.ephoto360.com/create-galaxy-text-effect-online-641.html',

  // Light / Futuristic
  light:            'https://en.ephoto360.com/light-text-effect-futuristic-technology-style-648.html',
  lighttext:        'https://en.ephoto360.com/light-text-effect-futuristic-technology-style-648.html',
  flux:             'https://en.ephoto360.com/light-text-effect-futuristic-technology-style-648.html',

  // Matrix
  matrix:           'https://en.ephoto360.com/matrix-text-effect-154.html',
  matrixtext:       'https://en.ephoto360.com/matrix-text-effect-154.html',

  // Metallic / Gold / Silver
  metallic:         'https://en.ephoto360.com/impressive-decorative-3d-metal-text-effect-798.html',
  metal:            'https://en.ephoto360.com/impressive-decorative-3d-metal-text-effect-798.html',
  metaltext:        'https://en.ephoto360.com/impressive-decorative-3d-metal-text-effect-798.html',
  glossysilver:     'https://en.ephoto360.com/impressive-decorative-3d-metal-text-effect-798.html',
  luxurygold:       'https://en.ephoto360.com/impressive-decorative-3d-metal-text-effect-798.html',
  royaltext:        'https://en.ephoto360.com/impressive-decorative-3d-metal-text-effect-798.html',

  // Purple
  purple:           'https://en.ephoto360.com/purple-text-effect-online-100.html',
  purpletext:       'https://en.ephoto360.com/purple-text-effect-online-100.html',
  vintagetext:      'https://en.ephoto360.com/purple-text-effect-online-100.html',

  // Sand / Beach
  sand:             'https://en.ephoto360.com/write-names-and-messages-on-the-sand-online-582.html',
  sandtext:         'https://en.ephoto360.com/write-names-and-messages-on-the-sand-online-582.html',
  summerbeach:      'https://en.ephoto360.com/write-names-and-messages-on-the-sand-online-582.html',

  // Thunder
  thunder:          'https://en.ephoto360.com/thunder-text-effect-online-97.html',
  thundertext:      'https://en.ephoto360.com/thunder-text-effect-online-97.html',

  // Blackpink / K-Pop
  blackpink:        'https://en.ephoto360.com/create-a-blackpink-style-logo-with-members-signatures-810.html',
  blackpinklogo:    'https://en.ephoto360.com/create-a-blackpink-style-logo-with-members-signatures-810.html',
  blackpinkstyle:   'https://en.ephoto360.com/create-a-blackpink-style-logo-with-members-signatures-810.html',

  // Arena / Gaming
  arena:            'https://en.ephoto360.com/create-cover-arena-of-valor-by-mastering-360.html',
  pubglogo:         'https://en.ephoto360.com/create-cover-arena-of-valor-by-mastering-360.html',

  // Paint / Colorful
  paint:            'https://en.ephoto360.com/create-3d-colorful-paint-text-effect-online-801.html',
  painttext:        'https://en.ephoto360.com/create-3d-colorful-paint-text-effect-online-801.html',
  arting:           'https://en.ephoto360.com/create-3d-colorful-paint-text-effect-online-801.html',

  // 1917 / Film Style
  '1917':           'https://en.ephoto360.com/1917-style-text-effect-523.html',
  '1917style':      'https://en.ephoto360.com/1917-style-text-effect-523.html',

  // Cartoon / Comic
  cartoonstyle:     'https://en.ephoto360.com/cartoon-text-effect-generator-online-free-819.html',
  comic:            'https://en.ephoto360.com/cartoon-text-effect-generator-online-free-819.html',
  bear:             'https://en.ephoto360.com/cartoon-text-effect-generator-online-free-819.html',

  // Deadpool
  deadpool:         'https://en.ephoto360.com/deadpool-text-effect-online-763.html',

  // Naruto
  naruto:           'https://en.ephoto360.com/create-naruto-text-logo-online-826.html',

  // Typography / Text Art
  typography:       'https://en.ephoto360.com/green-brush-text-effect-typography-maker-online-153.html',
  topography:       'https://en.ephoto360.com/green-brush-text-effect-typography-maker-online-153.html',
  corntext:         'https://en.ephoto360.com/green-brush-text-effect-typography-maker-online-153.html',

  // Deleting / Glitch Delete
  deletingtext:     'https://en.ephoto360.com/create-digital-glitch-text-effects-online-767.html',

  // Effect Clouds / Smoke
  effectclouds:     'https://en.ephoto360.com/smoke-text-effect-online-620.html',
  freecreate:       'https://en.ephoto360.com/smoke-text-effect-online-620.html',

  // Flag Text
  flagtext:         'https://en.ephoto360.com/create-flag-text-effect-online-627.html',

  // Dragon Ball
  dragonball:       'https://en.ephoto360.com/dragon-ball-logo-maker-online-828.html',

  // Text on Wet Glass
  textonwetglass:   'https://en.ephoto360.com/write-text-on-wet-glass-effect-618.html',
};

const commandName = 'firetext';
const aliases = Object.keys(templates).filter(k => k !== commandName);

module.exports = {
  name: commandName,
  aliases,
  category: 'textmaker',
  desc: 'Generate stylish text effects using Ephoto360',

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

    const rawCmd = text.split(/\s+/)[0].toLowerCase();
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

      // 25-second timeout
      const result = await Promise.race([
        mumaker.ephoto(templateUrl, inputText),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('TIMEOUT')), 25000)
        )
      ]);

      if (!result || !result.image) {
        throw new Error('No image returned from server.');
      }

      await sock.sendMessage(chatId, {
        image: { url: result.image },
        caption: `🎨 *${cmdName.toUpperCase()} EFFECT*\n\n📝 *Text:* ${inputText}\n\n🛡️ *Powered by OxBot*`,
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
      console.error(`[TextEffect:${cmdName}]`, e.message);
      let errMsg = e.message;

      if (errMsg.includes('403') || errMsg.includes('Forbidden')) {
        errMsg = '⚠️ Ephoto360 is temporarily blocking requests (Cloudflare). Try again in a moment.';
      } else if (errMsg.includes('TIMEOUT')) {
        errMsg = '⌛ Request timed out. The server might be busy — please try again.';
      } else if (errMsg.includes('Cannot find module')) {
        errMsg = '📦 Required dependency (mumaker) is not installed on this server.';
      } else if (errMsg.includes('No image')) {
        errMsg = '🖼️ The server returned no image. Try a different effect or try again.';
      }

      await sock.sendMessage(chatId, {
        text: `❌ *Error generating image.*\n_${errMsg}_`
      }, { quoted: msg });
    }
  }
};
