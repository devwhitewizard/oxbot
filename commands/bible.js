const axios = require('axios');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    try {
        let verse;
        if (args.length) {
            const ref = args.join(' ').trim();
            const r = await axios.get(`https://bible-api.com/${encodeURIComponent(ref)}`, { timeout: 10000 });
            verse = r.data;
        } else {
            const r = await axios.get('https://bible-api.com/?random=verse', { timeout: 10000 });
            verse = r.data;
        }

        const text = `📖 *Bible*\n━━━━━━━━━━━━\n📝 *${verse.reference}*\n\n_"${verse.text.trim()}"_`;
        await sock.sendMessage(chatId, { text }, { quoted: msg });

    } catch (err) {
        await sock.sendMessage(chatId, { text: '❌ Could not fetch Bible verse.\nUsage: .bible John 3:16 OR .bible (random)' }, { quoted: msg });
    }
    return null;
}

module.exports = {
    name: 'bible',
    aliases: ['verse'],
    desc: 'Get a Bible verse',
    category: 'general',
    execute
};