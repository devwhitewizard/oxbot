const fetch = require('node-fetch');

/**
 * .truth — Random truth question
 * Usage: .truth
 */
async function truthCommand(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;

    try {
        const res = await fetch('https://shizoapi.onrender.com/api/texts/truth?apikey=shizo');

        if (!res.ok) {
            throw await res.text();
        }

        const json = await res.json();
        const truth = json.result;

        if (!truth) {
            return '❌ No truth question received. Try again.';
        }

        await sock.sendMessage(
            chatId,
            {
                text: `🤔 *TRUTH*\n\n${truth}`,
            },
            { quoted: msg }
        );

    } catch (error) {
        console.error('[TRUTH ERROR]', error.message);
        await sock.sendMessage(
            chatId,
            { text: '❌ Failed to get truth question. Try again later.' },
            { quoted: msg }
        );
    }
}

module.exports = {
    name: 'truth',
    desc: 'Random truth question',
    category: 'fun',
    usage: '.truth',
    execute: truthCommand,
};