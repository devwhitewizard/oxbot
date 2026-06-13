const fetch = require('node-fetch');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    try {
        // Show typing indicator
        await sock.sendPresenceUpdate('composing', chatId);

        let textToTranslate = '';
        let lang = '';

        // Check if it's a reply to a message
        const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quotedMessage) {
            // Get text from the quoted message
            textToTranslate = quotedMessage.conversation || 
                            quotedMessage.extendedTextMessage?.text || 
                            quotedMessage.imageMessage?.caption || 
                            quotedMessage.videoMessage?.caption || 
                            '';

            // The language code should be the only argument (e.g., .translate fr)
            lang = args.join(' ').trim();
        } else {
            // Direct text translation (e.g., .translate Hello world fr)
            if (args.length < 2) {
                await sock.sendMessage(chatId, {
                    text: `*🌐 TRANSLATOR*\n\n*Usage:*\n1. Reply to a message with: \`.translate <lang>\`\n2. Or type: \`.translate <text> <lang>\`\n\n*Example:*\n.translate hello fr\n.translate I love you es\n\n*Language Codes:*\nfr - French\nes - Spanish\nde - German\nit - Italian\npt - Portuguese\nru - Russian\nja - Japanese\nko - Korean\nzh - Chinese\nar - Arabic\nhi - Hindi`
                }, { quoted: msg });
                return null;
            }

            lang = args.pop(); // Get the last word as the language code
            textToTranslate = args.join(' '); // Join the remaining words as the text
        }

        if (!textToTranslate || !lang) {
            await sock.sendMessage(chatId, {
                text: '❌ Invalid format. Provide text and language code.\n\nExample: `.translate hello fr`'
            }, { quoted: msg });
            return null;
        }

        // Try multiple translation APIs in sequence for reliability
        let translatedText = null;

        // Try API 1 (Google Translate Unofficial)
        try {
            const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(textToTranslate)}`);
            if (response.ok) {
                const data = await response.json();
                if (data && data[0] && data[0][0] && data[0][0][0]) {
                    translatedText = data[0][0][0];
                }
            }
        } catch (e) {
            console.error('[translate] Google API failed:', e.message);
        }

        // If API 1 fails, try API 2 (MyMemory)
        if (!translatedText) {
            try {
                const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=auto|${lang}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data && data.responseData && data.responseData.translatedText) {
                        translatedText = data.responseData.translatedText;
                    }
                }
            } catch (e) {
                console.error('[translate] MyMemory API failed:', e.message);
            }
        }

        // If API 2 fails, try API 3 (Dreaded)
        if (!translatedText) {
            try {
                const response = await fetch(`https://api.dreaded.site/api/translate?text=${encodeURIComponent(textToTranslate)}&lang=${lang}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data && data.translated) {
                        translatedText = data.translated;
                    }
                }
            } catch (e) {
                console.error('[translate] Dreaded API failed:', e.message);
            }
        }

        if (!translatedText) {
            throw new Error('All translation APIs failed');
        }

        // Send the translated text
        await sock.sendMessage(chatId, {
            text: `🌐 *Translation (${lang.toUpperCase()})*\n\n${translatedText}`
        }, { quoted: msg });

    } catch (error) {
        console.error('[translate] Error:', error.message);
        await sock.sendMessage(chatId, {
            text: '❌ Failed to translate text. Please check the language code or try again later.'
        }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'translate',
    aliases: ['trt', 'trans'],
    desc: 'Translate text to any language',
    category: 'general',
    execute
};