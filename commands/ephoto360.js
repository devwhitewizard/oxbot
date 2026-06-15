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
 * - Loaded by botManager.js commandLoader
 */

const mumaker = require('mumaker');

// ── WORKING Ephoto360.com effects (verified from Nexus-1MD) ──────────────────
const templates = {
  // Fire / Flame
  fire:             'https://en.ephoto360.com/flame-lettering-effect-372.html',
  flame:            'https://en.ephoto360.com/flame-lettering-effect-372.html',
  firetext:         'https://en.ephoto360.com/flame-lettering-effect-372.html',

  // Neon / Glow
  neon:             'https://en.ephoto360.com/create-colorful-neon-light-text-effects-online-797.html',
  neontext:         'https://en.ephoto360.com/create-colorful-neon-light-text-effects-online-797.html',

  // Glitch
  glitch:           'https://en.ephoto360.com/create-digital-glitch-text-effects-online-767.html',
  glitchtext:       'https://en.ephoto360.com/create-digital-glitch-text-effects-online-767.html',

  // Devil wings
  devil:            'https://en.ephoto360.com/neon-devil-wings-text-effect-online-683.html',
  deviltext:        'https://en.ephoto360.com/neon-devil-wings-text-effect-online-683.html',

  // Hacker
  hacker:           'https://en.ephoto360.com/create-anonymous-hacker-avatars-cyan-neon-677.html',
  hackertext:       'https://en.ephoto360.com/create-anonymous-hacker-avatars-cyan-neon-677.html',

  // Ice / Snow
  ice:              'https://en.ephoto360.com/ice-text-effect-online-101.html',
  icetext:          'https://en.ephoto360.com/ice-text-effect-online-101.html',
  snow:             'https://en.ephoto360.com/create-a-snow-3d-text-effect-free-online-621.html',
  snowtext:         'https://en.ephoto360.com/create-a-snow-3d-text-effect-free-online-621.html',

  // Leaves
  leaves:           'https://en.ephoto360.com/green-brush-text-effect-typography-maker-online-153.html',
  leavestext:       'https://en.ephoto360.com/green-brush-text-effect-typography-maker-online-153.html',

  // Light
  light:            'https://en.ephoto360.com/light-text-effect-futuristic-technology-style-648.html',
  lighttext:        'https://en.ephoto360.com/light-text-effect-futuristic-technology-style-648.html',

  // Matrix
  matrix:           'https://en.ephoto360.com/matrix-text-effect-154.html',
  matrixtext:       'https://en.ephoto360.com/matrix-text-effect-154.html',

  // Metallic / Gold / Silver
  metallic:         'https://en.ephoto360.com/impressive-decorative-3d-metal-text-effect-798.html',
  metal:            'https://en.ephoto360.com/impressive-decorative-3d-metal-text-effect-798.html',
  metaltext:        'https://en.ephoto360.com/impressive-decorative-3d-metal-text-effect-798.html',

  // Purple
  purple:           'https://en.ephoto360.com/purple-text-effect-online-100.html',
  purpletext:       'https://en.ephoto360.com/purple-text-effect-online-100.html',

  // Sand
  sand:             'https://en.ephoto360.com/write-names-and-messages-on-the-sand-online-582.html',
  sandtext:         'https://en.ephoto360.com/write-names-and-messages-on-the-sand-online-582.html',

  // Thunder
  thunder:          'https://en.ephoto360.com/thunder-text-effect-online-97.html',
  thundertext:      'https://en.ephoto360.com/thunder-text-effect-online-97.html',

  // Blackpink / K-Pop
  blackpink:        'https://en.ephoto360.com/create-a-blackpink-style-logo-with-members-signatures-810.html',
  blackpinklogo:    'https://en.ephoto360.com/create-a-blackpink-style-logo-with-members-signatures-810.html',

  // Arena
  arena:            'https://en.ephoto360.com/create-cover-arena-of-valor-by-mastering-360.html',

  // Paint
  paint:            'https://en.ephoto360.com/create-3d-colorful-paint-text-effect-online-801.html',
  painttext:        'https://en.ephoto360.com/create-3d-colorful-paint-text-effect-online-801.html',
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
        mumaker.ephoto(templateUrl, inputText),
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
