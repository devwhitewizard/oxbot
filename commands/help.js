const version     = '2.0.0';
const owner       = 'oxdominion.eth';

function getRAM() {
    const used  = process.memoryUsage().heapUsed / 1024 / 1024;
    const total = process.memoryUsage().rss / 1024 / 1024;
    return `${used.toFixed(1)}MB / ${total.toFixed(1)}MB`;
}

// Only returns the Day (e.g. "Monday")
function getDay() {
    const d = new Date();
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return days[d.getDay()];
}

async function execute(sock, msg, botData, args) {
    try {
        const chatId    = msg.key.remoteJid;
        if (!chatId) return null;

        const db        = botData?.db;
        const sessionId = botData?.sessionId;

        let userName = 'Unknown';
        const sender = msg.key.participant || msg.key.remoteJid;
        try {
            const status = await sock.fetchStatus(sender);
            if (status?.status) userName = status.status.substring(0, 25);
        } catch {}

        const botName = sock.user?.name || sock.user?.verifiedName || sock.user?.notify || 'OxBot';

        let ownerNumber = '';
        try {
            if (db && sessionId) {
                const [rows] = await db.query(
                    'SELECT u.phone FROM users u JOIN bots b ON b.user_id = u.id WHERE b.session_id = ? LIMIT 1',
                    [sessionId]
                );
                if (rows.length && rows[0].phone) {
                    ownerNumber = String(rows[0].phone).replace(/\D/g, '');
                }
            }
        } catch {}

        let totalCmds = 0;
        try {
            const { commands } = require('./index');
            const unique = new Set();
            commands.forEach((v, k) => unique.add(v.name || k));
            totalCmds = unique.size;
        } catch {
            try {
                const fs = require('fs');
                const skip = new Set(['index.js','handler.js','igs.js','imagine.js','img-blur.js','instagram.js','pair.js','simage.js','stickertelegram.js','textmaker.js','tiktok.js']);
                const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && !skip.has(f));
                totalCmds = files.length;
            } catch {}
        }

        const ram  = getRAM();
        const day  = getDay();

        const header = `
┌─────────────────────────┐
│  🤖 *${botName}*
│  📌 *Version:* ${version}
│  👤 *Owner:* ${owner}
│  🔑 *Prefix:* . | !
│  🧠 *RAM:* ${ram}
│  📦 *Commands:* ${totalCmds}
│  📅 *${day}*
└─────────────────────────┘`;

        const menu = `
┏━━━━━━━━━━━━━━━━━━━━━━┓
┃  🎵 *Music & Downloader*  ┃
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃  ◈ .song <name/link>   ┃
┃  ◈ .video <name/link>  ┃
┃  ◈ .play <name/link>   ┃
┃  ◈ .mp3 <name/link>    ┃
┃  ◈ .ytmp4 <yt link>    ┃
┃  ◈ .spotify <query>    ┃
┃  ◈ .lyrics <song>      ┃
┗━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━━━━━━━━━┓
┃  🎮 *Fun & Games*       ┃
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃  ◈ .truth              ┃
┃  ◈ .dare               ┃
┃  ◈ .wasted @user       ┃
┃  ◈ .circle             ┃
┃  ◈ .joke               ┃
┃  ◈ .roast @user        ┃
┃  ◈ .fact               ┃
┃  ◈ .compliment @user   ┃
┗━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━━━━━━━━━┓
┃  🖼️ *Media Tools*       ┃
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃  ◈ .sticker            ┃
┃  ◈ .take <packname>    ┃
┃  ◈ .url (reply media)  ┃
┃  ◈ .blur (caption)     ┃
┃  ◈ .save               ┃
┃  ◈ .vv                 ┃
┃  ◈ .tts <text>         ┃
┗━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━━━━━━━━━┓
┃  🔍 *Search & Utility*  ┃
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃  ◈ .weather <city>     ┃
┃  ◈ .translate <text>   ┃
┃  ◈ .ping               ┃
┃  ◈ .alive              ┃
┃  ◈ .gpt <question>     ┃
┃  ◈ .gemini <question>  ┃
┗━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━━━━━━━━━┓
┃  👥 *Group Admin*       ┃
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃  ◈ .groupinfo          ┃
┃  ◈ .promote @user      ┃
┃  ◈ .demote @user       ┃
┃  ◈ .kick @user         ┃
┃  ◈ .add <number>       ┃
┃  ◈ .tagall             ┃
┃  ◈ .tagnotadmin        ┃
┃  ◈ .mute               ┃
┃  ◈ .unmute             ┃
┗━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━━━━━━━━━┓
┃  🔒 *Owner Only*        ┃
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃  ◈ .mode <pub/priv>    ┃
┃  ◈ .autotyping         ┃
┃  ◈ .autostatus         ┃
┃  ◈ .autoreact          ┃
┃  ◈ .autoread           ┃
┃  ◈ .fakeaudio          ┃
┃  ◈ .antidelete         ┃
┃  ◈ .pmblocker          ┃
┗━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━━━━━━━━━┓
┃  🎨 *Ephoto360 Maker*  ┃
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃  ◈ .blackpinklogo      ┃
┃  ◈ .blackpinkstyle     ┃
┃  ◈ .glossysilver       ┃
┃  ◈ .glitchtext         ┃
┃  ◈ .arting             ┃
┃  ◈ .advancedglow       ┃
┃  ◈ .cartoonstyle       ┃
┃  ◈ .deadpool           ┃
┃  ◈ .deletingtext       ┃
┃  ◈ .luxurygold         ┃
┃  ◈ .1917style          ┃
┃  ◈ .pixelglitch        ┃
┃  ◈ .multicoloredneon   ┃
┃  ◈ .effectclouds       ┃
┃  ◈ .flagtext           ┃
┃  ◈ .freecreate         ┃
┃  ◈ .galaxystyle        ┃
┃  ◈ .bear               ┃
┃  ◈ .devilwings         ┃
┃  ◈ .wolfgalaxy         ┃
┃  ◈ .comic              ┃
┃  ◈ .textonwetglass     ┃
┃  ◈ .galaxywallpaper    ┃
┃  ◈ .firetext           ┃
┃  ◈ .underwater         ┃
┃  ◈ .neontext           ┃
┃  ◈ .metaltext          ┃
┃  ◈ .snowtext           ┃
┃  ◈ .icetext            ┃
┃  ◈ .purpletext         ┃
┃  ◈ .lighttext          ┃
┃  ◈ .thundertext        ┃
┃  ◈ .leavestext         ┃
┃  ◈ .hackertext         ┃
┃  ◈ .deviltext          ┃
┃  ◈ .vintagetext        ┃
┃  ◈ .wingslogo          ┃
┃  ◈ .painttext          ┃
┃  ◈ .naruto             ┃
┃  ◈ .pubglogo           ┃
┃  ◈ .glowingtext        ┃
┃  ◈ .corntext           ┃
┃  ◈ .makingneon         ┃
┃  ◈ .matrix             ┃
┃  ◈ .royaltext          ┃
┃  ◈ .sand               ┃
┃  ◈ .summerbeach        ┃
┃  ◈ .topography         ┃
┃  ◈ .typography         ┃
┃  ◈ .flux               ┃
┃  ◈ .dragonball         ┃
┗━━━━━━━━━━━━━━━━━━━━━━┛`;

        const footer = `│ 👤 *User:* ${userName}`;

        const fullMessage = header + menu + `
┌─────────────────────────┐
 ${footer}
│ 🚀 _oxbot.name.ng_
└─────────────────────────┘`;

        // ★ THE EXACT SECRET CODE FOR NEWSLETTERS ★
        const buttons = [
            {
                nativeFlowInfo: {
                    name: 'cta_open_channel',
                    buttonParamsJson: JSON.stringify({
                        channel_id: '120363421280626994@newsletter'
                    })
                }
            },
        ];

        const img = global.menuImage;

        if (img) {
            await sock.sendMessage(chatId, {
                image: img,
                caption: fullMessage,
                footer: '🤖 OxBot — oxbot.name.ng',
                templateButtons: buttons,
            }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, {
                text: fullMessage,
                footer: '🤖 OxBot — oxbot.name.ng',
                templateButtons: buttons,
            }, { quoted: msg });
        }

        return null;
    } catch (err) {
        console.error('[HELP] Error:', err.message);
        try {
            await sock.sendMessage(msg.key.remoteJid, {
                text: '❌ Failed to load menu. Try again.',
            }, { quoted: msg });
        } catch {}
        return null;
    }
}

module.exports = {
    name: 'help',
    aliases: ['menu', 'bot', 'list', 'commands'],
    desc: 'Show all commands',
    category: 'general',
    execute,
};  
