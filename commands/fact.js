const axios = require('axios');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    try {
        const response = await axios.get('https://uselessfacts.jsph.pl/random.json?language=en');
        const fact = response.data.text;
        await sock.sendMessage(chatId, { text: `💡 *Did you know?*\n\n${fact}` }, { quoted: msg });
    } catch (error) {
        console.error('Error fetching fact:', error);
        await sock.sendMessage(chatId, { text: '❌ Sorry, I could not fetch a fact right now.' }, { quoted: msg });
    }
    return null;
}

module.exports = {
    name: 'fact',
    aliases: ['uselessfact'],
    desc: 'Get a random useless fact',
    category: 'general',
    execute
};
