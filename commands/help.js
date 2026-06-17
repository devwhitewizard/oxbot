/**
 * help.js — OxBot Menu / Command List
 * Aliases: .menu, .bot, .list, .commands, .help
 */

const version = '2.0.0';
const owner   = 'oxdominion.eth';

function getRAM() {
    const used  = process.memoryUsage().heapUsed / 1024 / 1024;
    const total = process.memoryUsage().rss / 1024 / 1024;
    return `${used.toFixed(1)}MB / ${total.toFixed(1)}MB`;
}

function getDay() {
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return days[new Date().getDay()];
}

async function execute(sock, msg, botData, args) {
    try {
        const chatId    = msg.key.remoteJid;
        if (!chatId) return null;

        const db        = botData?.db;
        const sessionId = botData?.sessionId;

        // ── Fetch user WhatsApp status as display name ────────────────────────
        let userName = 'Unknown';
        const sender = msg.key.participant || msg.key.remoteJid;
        try {
            const status = await sock.fetchStatus(sender);
            if (status?.status) userName = status.status.substring(0, 25);
        } catch {}

        // ── Bot name from WhatsApp ─────────────────────────────────────────────
        const botName = sock.user?.name || sock.user?.verifiedName || sock.user?.notify || 'OxBot';

        // ── Owner phone from DB ───────────────────────────────────────────────
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

        // ── Total command count ───────────────────────────────────────────────
        let totalCmds = 0;
        try {
            const { commands } = require('./index');
            const unique = new Set();
            commands.forEach((v, k) => unique.add(v.name || k));
            totalCmds = unique.size;
        } catch {
            try {
                const fs   = require('fs');
                const skip = new Set(['index.js','handler.js','igs.js','imagine.js','img-blur.js','instagram.js','pair.js','simage.js','stickertelegram.js','textmaker.js']);
                const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && !skip.has(f));
                totalCmds = files.length;
            } catch {}
        }

        const ram = getRAM();
        const day = getDay();

        // ══════════════════════════════════════════════════════════════════════
        // MENU SECTIONS
        // ══════════════════════════════════════════════════════════════════════

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
┃  🎵 *Music & Downloader*
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃  ◈ .song <name/link>
┃  ◈ .video <name/link>
┃  ◈ .play <name/link>
┃  ◈ .mp3 <name/link>
┃  ◈ .ytmp4 <yt link>
┃  ◈ .spotify <query>
┃  ◈ .lyrics <song>
┗━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━━━━━━━━━┓
┃  📱 *Social Media*
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃  ◈ .tiktok <link>
┃  ◈ .tt <link>
┃  ◈ .tk <link>
┃  ◈ .tikdown <link>
┃  ◈ .ss <url>
┃  ◈ .ssweb <url>
┃  ◈ .screenshot <url>
┗━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━━━━━━━━━┓
┃  🎮 *Fun & Games*
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃  ◈ .truth
┃  ◈ .dare
┃  ◈ .wasted @user
┃  ◈ .circle
┃  ◈ .joke
┃  ◈ .roast @user
┃  ◈ .fact
┃  ◈ .compliment @user
┗━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━━━━━━━━━┓
┃  🖼️ *Media Tools*
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃  ◈ .sticker
┃  ◈ .take <packname>
┃  ◈ .url (reply media)
┃  ◈ .blur (caption)
┃  ◈ .save
┃  ◈ .vv
┃  ◈ .tts <text>
┃  ◈ .regenerate (tag/reply image)
┗━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━━━━━━━━━┓
┃  🔍 *Search & Info*
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃  ◈ .weather <city>
┃  ◈ .translate <text>
┃  ◈ .ping
┃  ◈ .alive
┃  ◈ .gpt <question>
┃  ◈ .gemini <question>
┃  ◈ .news
┃  ◈ .news tech
┃  ◈ .news sports
┃  ◈ .news business
┃  ◈ .news health
┃  ◈ .news science
┃  ◈ .news entertainment
┗━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━━━━━━━━━┓
┃  ⏰ *Reminders*
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃  ◈ .remind 30m <msg>
┃  ◈ .remind 2h <msg>
┃  ◈ .remind 1d <msg>
┃  ◈ .remind 1w <msg>
┃  ◈ .remind tomorrow <msg>
┃  ◈ .remind next week <msg>
┃  ◈ .remind 25/12 <msg>
┃  ◈ .reminders (list all)
┃  ◈ .remind cancel <ID>
┗━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━━━━━━━━━┓
┃  👥 *Group Admin*
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃  ◈ .groupinfo
┃  ◈ .promote @user
┃  ◈ .demote @user
┃  ◈ .kick @user
┃  ◈ .add <number>
┃  ◈ .tagall
┃  ◈ .tagnotadmin
┃  ◈ .mute
┃  ◈ .unmute
┗━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━━━━━━━━━┓
┃  🔒 *Owner Only*
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃  ◈ .mode <pub/priv>
┃  ◈ .autotyping
┃  ◈ .autostatus
┃  ◈ .autoreact
┃  ◈ .autoread
┃  ◈ .fakeaudio
┃  ◈ .antidelete
┃  ◈ .pmblocker
┃  ◈ .setpp (tag/reply image)
┃  ◈ .autobio set <text>
┃  ◈ .autobio off
┃  ◈ .autobio status
┗━━━━━━━━━━━━━━━━━━━━━━┛

┏━━━━━━━━━━━━━━━━━━━━━━┓
┃  🎨 *Ephoto360 Maker*
┣━━━━━━━━━━━━━━━━━━━━━━┫
┃  ◈ .firetext <text>
┃  ◈ .neontext <text>
┃  ◈ .glitchtext <text>
┃  ◈ .matrix <text>
┃  ◈ .metaltext <text>
┃  ◈ .glossysilver <text>
┃  ◈ .luxurygold <text>
┃  ◈ .purpletext <text>
┃  ◈ .lighttext <text>
┃  ◈ .thundertext <text>
┃  ◈ .icetext <text>
┃  ◈ .snowtext <text>
┃  ◈ .underwater <text>
┃  ◈ .leavestext <text>
┃  ◈ .hackertext <text>
┃  ◈ .deviltext <text>
┃  ◈ .devilwings <text>
┃  ◈ .painttext <text>
┃  ◈ .sand <text>
┃  ◈ .summerbeach <text>
┃  ◈ .blackpinklogo <text>
┃  ◈ .blackpinkstyle <text>
┃  ◈ .pixelglitch <text>
┃  ◈ .multicoloredneon <text>
┃  ◈ .glowingtext <text>
┃  ◈ .advancedglow <text>
┃  ◈ .galaxystyle <text>
┃  ◈ .galaxywallpaper <text>
┃  ◈ .wolfgalaxy <text>
┃  ◈ .cartoonstyle <text>
┃  ◈ .comic <text>
┃  ◈ .deadpool <text>
┃  ◈ .naruto <text>
┃  ◈ .dragonball <text>
┃  ◈ .1917 <text>
┃  ◈ .pubglogo <text>
┃  ◈ .flagtext <text>
┃  ◈ .effectclouds <text>
┃  ◈ .textonwetglass <text>
┃  ◈ .typography <text>
┃  ◈ .royaltext <text>
┃  ◈ .vintagetext <text>
┃  ◈ .wingslogo <text>
┃  ◈ .makingneon <text>
┃  ◈ .corntext <text>
┃  ◈ .flux <text>
┃  ◈ .arting <text>
┗━━━━━━━━━━━━━━━━━━━━━━┛`;

        const footer = `│ 👤 *User:* ${userName}`;

        const fullMessage = header + menu + `
┌─────────────────────────┐
 ${footer}
│ 🚀 _oxbot.name.ng_
└─────────────────────────┘`;

        // ── Newsletter context (shows OxBot channel follow button) ────────────
        const contextInfo = {
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid:     '120363421280626994@newsletter',
                newsletterName:    'OxBot',
                serverMessageId:   -1,
            },
        };

        const img = global.menuImage;

        if (img) {
            await sock.sendMessage(chatId, {
                image:       img,
                caption:     fullMessage,
                contextInfo,
            }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, {
                text:        fullMessage,
                contextInfo,
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
    name:     'help',
    aliases:  ['menu', 'bot', 'list', 'commands'],
    desc:     'Show all bot commands',
    category: 'general',
    execute,
};
