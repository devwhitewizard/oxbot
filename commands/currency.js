const axios = require('axios');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    if (args.length < 3) {
        return await sock.sendMessage(chatId, { 
            text: '❌ Usage: .currency <amount> <from> <to>\n*Example: .currency 100 USD ZWL*' 
        }, { quoted: msg });
    }

    const amount = parseFloat(args[0]);
    const from   = args[1].toUpperCase();
    const to     = args[2].toUpperCase();

    if (isNaN(amount)) {
        return await sock.sendMessage(chatId, { text: '❌ Amount must be a number.' }, { quoted: msg });
    }

    try {
        const res = await axios.get(`https://api.exchangerate-api.com/v4/latest/${from}`, { timeout: 10000 });
        const rate = res.data.rates[to];
        
        if (!rate) {
            return await sock.sendMessage(chatId, { text: `❌ Currency *${to}* not found.` }, { quoted: msg });
        }

        const text = `💱 *Currency Converter*\n\n` +
                      `💵 ${amount} *${from}*\n` +
                      `💰 = ${(amount * rate).toFixed(2)} *${to}*\n\n` +
                      `📊 Rate: 1 ${from} = ${rate.toFixed(4)} ${to}`;

        await sock.sendMessage(chatId, { text }, { quoted: msg });

    } catch {
        await sock.sendMessage(chatId, { text: '❌ Conversion failed.' }, { quoted: msg });
    }
    return null;
}

module.exports = {
    name: 'currency',
    aliases: ['exrate', 'convert'],
    desc: 'Convert currency exchange rates',
    category: 'general',
    execute
};