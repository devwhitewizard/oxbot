const fetch = require('node-fetch');

/**
 * .dare — Random dare challenge
 * Usage: .dare
 */
async function dareCommand(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;

    try {
        const res = await fetch('https://shizoapi.onrender.com/api/texts/dare?apikey=shizo');

        if (!res.ok) {
            throw await res.text();
        }

        const json = await res.json();
        const dare = json.result;

        if (!dare) {
            return '❌ No dare received. Try again.';
        }

        await sock.sendMessage(
            chatId,
            {
                text: `😈 *DARE*\n\n${dare}`,
            },
            { quoted: msg }
        );

    } catch (error) {
        console.error('[DARE ERROR]', error.message);
        await sock.sendMessage(
            chatId,
            { text: '❌ Failed to get dare. Try again later.' },
            { quoted: msg }
        );
    }
}

module.exports = {
    name: 'dare',
    desc: 'Random dare challenge',
    category: 'fun',
    usage: '.dare',
    execute: dareCommand,
};