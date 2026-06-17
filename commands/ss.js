/**
 * ss.js — Screenshot any website
 * Aliases: .ss, .ssweb, .screenshot
 */

const fetch = require('node-fetch');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    // No URL provided — show usage
    if (!args || args.length === 0) {
        return `*🖥️ SCREENSHOT TOOL*

*.ss <url>* — Take a screenshot of any website

*Examples:*
• \`.ss https://google.com\`
• \`.ss https://youtube.com\`
• \`.ss https://oxbot.name.ng\`

_Supports any public website._`;
    }

    let url = args[0].trim();

    // Auto-add https:// if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    // Basic URL validation
    try {
        new URL(url);
    } catch {
        return `❌ Invalid URL: *${url}*\n\nMake sure it's a valid website link.\n\nExample: \`.ss https://google.com\``;
    }

    // Show typing while working
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('composing', chatId);
    } catch {}

    // Send a "working on it" message for slow sites
    let waitMsg = null;
    try {
        waitMsg = await sock.sendMessage(chatId, {
            text: `📸 Taking screenshot of:\n*${url}*\n\n_Please wait..._`,
        }, { quoted: msg });
    } catch {}

    try {
        const apiUrl = `https://api.siputzx.my.id/api/tools/ssweb?url=${encodeURIComponent(url)}&theme=light&device=desktop`;

        const response = await fetch(apiUrl, {
            headers: { accept: '*/*' },
            timeout: 30000, // 30s timeout
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const imageBuffer = await response.buffer();

        if (!imageBuffer || imageBuffer.length < 1000) {
            throw new Error('Screenshot returned empty or invalid image');
        }

        // Send the screenshot
        await sock.sendMessage(chatId, {
            image:   imageBuffer,
            caption: `📸 *Screenshot*\n🌐 ${url}`,
        }, { quoted: msg });

        // Delete the "please wait" message if we sent one
        if (waitMsg) {
            try {
                await sock.sendMessage(chatId, {
                    delete: waitMsg.key,
                });
            } catch {}
        }

        return null;

    } catch (err) {
        console.error('[SS] Error:', err.message);

        // Delete the "please wait" message on failure too
        if (waitMsg) {
            try {
                await sock.sendMessage(chatId, {
                    delete: waitMsg.key,
                });
            } catch {}
        }

        return `❌ *Screenshot failed*

*URL:* ${url}

*Possible reasons:*
• Website is blocking screenshots
• Website requires login
• Website is down or too slow
• Invalid or private URL

Try again or use a different URL.`;
    }
}

module.exports = {
    name:     'ss',
    aliases:  ['ssweb', 'screenshot', 'web'],
    desc:     'Take a screenshot of any website',
    category: 'utility',
    execute,
};