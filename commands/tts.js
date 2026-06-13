const name     = 'tts';
const desc     = 'Convert text to voice note';
const category = 'general';
const aliases  = ['voice', 'speak'];

const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { exec } = require('child_process');

function runFFmpeg(input, output) {
    return new Promise((resolve, reject) => {
        exec(
            `ffmpeg -y -i "${input}" -c:a libopus -b:a 128k -vbr on -compression_level 10 "${output}"`,
            (err) => err ? reject(err) : resolve()
        );
    });
}

async function downloadTTS(text) {
    const encoded = encodeURIComponent(text);
    const url     = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=en&client=tw-ob`;

    return new Promise((resolve, reject) => {
        const chunks = [];
        const req = https.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        }, (res) => {
            if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;

    // Get text
    let text = args.join(' ').trim();
    if (!text) {
        const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        text = q?.conversation || q?.extendedTextMessage?.text || '';
    }

    if (!text) {
        return await sock.sendMessage(chatId, {
            text: '❌ Provide text!\n\n*.tts hello world*\nOr reply to a message with *.tts*'
        }, { quoted: msg });
    }

    if (text.length > 300) {
        return await sock.sendMessage(chatId, {
            text: '❌ Max 300 characters!'
        }, { quoted: msg });
    }

    await sock.sendPresenceUpdate('recording', chatId);

    const tmpMp3  = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);
    const tmpOgg  = path.join(os.tmpdir(), `tts_${Date.now()}.ogg`);

    try {
        // Download MP3
        const mp3Buffer = await downloadTTS(text);
        if (!mp3Buffer || mp3Buffer.length < 100) throw new Error('Empty audio');

        fs.writeFileSync(tmpMp3, mp3Buffer);

        // Convert to OGG Opus (WhatsApp voice note format)
        await runFFmpeg(tmpMp3, tmpOgg);

        // Send as PTT voice note
        await sock.sendMessage(chatId, {
            audio:    fs.readFileSync(tmpOgg),
            mimetype: 'audio/ogg; codecs=opus',
            ptt:      true,
        }, { quoted: msg });

    } catch (err) {
        console.error('[tts] Error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ TTS failed: ' + err.message
        }, { quoted: msg });
    } finally {
        await sock.sendPresenceUpdate('available', chatId);
        try { fs.unlinkSync(tmpMp3); } catch {}
        try { fs.unlinkSync(tmpOgg); } catch {}
    }
}

module.exports = { name, desc, category, aliases, execute };
