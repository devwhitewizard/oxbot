/**
 * help.js — OxBot Menu / Command List
 * Aliases: .menu, .bot, .list, .commands, .help
 */

const version = '2.1.0';
const owner   = 'oxdominion.eth';

function getRAM() {
    const used  = process.memoryUsage().heapUsed;
    const total = process.memoryUsage().heapTotal;
    const pct   = Math.min(100, Math.round((used / total) * 100));
    
    const filled  = Math.round((pct / 100) * 10);
    const empty   = 10 - filled;
    const bar     = '█'.repeat(filled) + '░'.repeat(empty);
    
    let icon = '🟢';
    if (pct > 70) icon = '🟡';
    if (pct > 90) icon = '🔴';
    
    return `${icon} [${bar}] ${pct}%`;
}

function getDay() {
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return days[new Date().getDay()];
}

async function execute(sock, msg, botData, args) {
    try {
        const chatId    = msg.key.remoteJid;
        if (!chatId) return null;

        const sender    = msg.key.participant || msg.key.remoteJid;
        const senderNum = sender?.split('@')[0] || 'User';
        const db        = botData?.db;
        const sessionId = botData?.sessionId;

        // ── Bot name from WhatsApp ─────────────────────────────────────────────
        const botName = sock.user?.name || sock.user?.verifiedName || sock.user?.notify || 'OxBot';

        // ── Get User's Plan Name from DB ──────────────────────────────────────
        let planLabel = '🆓 Free Trial';
        try {
            if (db && sessionId) {
                let userId = null;
                const [r1] = await db.query('SELECT user_id FROM bots WHERE session_id=? LIMIT 1', [sessionId]);
                if (r1.length) {
                    userId = r1[0].user_id;
                } else if (!String(sessionId).startsWith('oxbot_')) {
                    const [r2] = await db.query('SELECT user_id FROM bots WHERE session_id=? LIMIT 1', [`oxbot_${sessionId}`]);
                    if (r2.length) userId = r2[0].user_id;
                }

                if (userId) {
                    const [proRows] = await db.query(
                        `SELECT plan FROM pro_subscriptions 
                         WHERE user_id=? AND status='active' AND expires_at > NOW() LIMIT 1`,
                        [userId]
                    );
                    if (proRows.length > 0) {
                        if (proRows[0].plan === 'full') planLabel = '👑 Best Value (Pro)';
                        else if (proRows[0].plan === 'half') planLabel = '⭐ Starter (Pro)';
                    }
                }
            }
        } catch (err) {}

        // ── Total command count ───────────────────────────────────────────────
        let totalCmds = 0;
        try {
            const { commands } = require('./index');
            const unique = new Set();
            commands.forEach((v, k) => unique.add(v.name || k));
            totalCmds = unique.size;
        } catch (err) {
            try {
                const fs   = require('fs');
                const skip = new Set(['index.js','handler.js','igs.js','imagine.js','img-blur.js','instagram.js','pair.js','simage.js','stickertelegram.js','textmaker.js']);
                const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && !skip.has(f));
                totalCmds = files.length;
            } catch (err) {}
        }

        const ram = getRAM();
        const day = getDay();

        // ══════════════════════════════════════════════════════════════════════
        // MENU SECTIONS (Clean Aesthetic Design)
        // ══════════════════════════════════════════════════════════════════════

        let menuText = `╭━━━『 *${botName}* 』━━━╮\n\n`;
        menuText += `👋 Hello @${senderNum}!\n\n`;
        menuText += `⚡ Prefix: . | !\n`;
        menuText += `📌 Version: ${version}\n`;
        menuText += `👑 Owner: ${owner}\n`;
        menuText += `📦 Commands: ${totalCmds}\n`;
        menuText += `🧠 RAM: ${ram}\n`;
        menuText += `📅 ${day}\n`;
        menuText += `🏷️ Plan: ${planLabel}\n`;
        menuText += `🌐 Site: https://oxbot.name.ng/\n\n`;

        // ── Music & Downloader ─────────────────────────────────────────────
        menuText += `┏━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 🎵 MUSIC & DOWNLOADER\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `│ ➜ .song <name/link>\n`;
        menuText += `│ ➜ .video <name/link>\n`;
        menuText += `│ ➜ .play <name/link>\n`;
        menuText += `│ ➜ .mp3 <name/link>\n`;
        menuText += `│ ➜ .ytmp4 <yt link>\n`;
        menuText += `│ ➜ .spotify <query>\n`;
        menuText += `│ ➜ .lyrics <song>\n`;
        menuText += `│ ➜ .gdrive <link>\n`;
        menuText += `\n`;

        // ── Social Media ───────────────────────────────────────────────────
        menuText += `┏━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 📱 SOCIAL MEDIA\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `│ ➜ .twitter <link>\n`;
        menuText += `│ ➜ .tiktok <link>\n`;
        menuText += `│ ➜ .tt <link>\n`;
        menuText += `│ ➜ .tk <link>\n`;
        menuText += `│ ➜ .tikdown <link>\n`;
        menuText += `│ ➜ .pinterest <query>\n`;
        menuText += `│ ➜ .ss <url>\n`;
        menuText += `│ ➜ .ssweb <url>\n`;
        menuText += `│ ➜ .screenshot <url>\n`;
        menuText += `│ ➜ .instagram <link>\n`;
        menuText += `│ ➜ .facebook <link>\n`;
        menuText += `\n`;

        // ── Fun & Games ────────────────────────────────────────────────────
        menuText += `┏━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 🎮 FUN & GAMES\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `│ ➜ .hangman <letter>\n`;
        menuText += `│ ➜ .truth\n`;
        menuText += `│ ➜ .dare\n`;
        menuText += `│ ➜ .question\n`;
        menuText += `│ ➜ .wasted @user\n`;
        menuText += `│ ➜ .circle\n`;
        menuText += `│ ➜ .joke\n`;
        menuText += `│ ➜ .roast @user\n`;
        menuText += `│ ➜ .fact\n`;
        menuText += `│ ➜ .compliment @user\n`;
        menuText += `│ ➜ .random\n`;
        menuText += `\n`;

        // ── Media Tools ────────────────────────────────────────────────────
        menuText += `┏━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 🖼️ MEDIA TOOLS\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `│ ➜ .sticker\n`;
        menuText += `│ ➜ .take <packname>\n`;
        menuText += `│ ➜ .url (reply media)\n`;
        menuText += `│ ➜ .blur (caption)\n`;
        menuText += `│ ➜ .save\n`;
        menuText += `│ ➜ .vv\n`;
        menuText += `│ ➜ .vv2 (reply to view once)\n`;
        menuText += `│ ➜ .tts <text>\n`;
        menuText += `│ ➜ .qr <text/url>\n`;
        menuText += `│ ➜ .readmore text|hidden\n`;
        menuText += `│ ➜ .ocr (reply to image)\n`;
        menuText += `│ ➜ .regenerate (tag/reply)\n`;
        menuText += `\n`;

        // ════════════════════════════════════════════════════════════════════
        // ── NEW TOOLS SECTION (Encrypt & Decrypt Added Here) ───────────────
        // ════════════════════════════════════════════════════════════════════
        menuText += `┏━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 🛠️ TOOLS\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `│ ➜ .encrypt <text/code>\n`;
        menuText += `│ ➜ .decrypt <string>\n`;
        menuText += `│ ➜ .getchannel (use in channel)\n`;
        menuText += `\n`;

        // ── Search & Info ──────────────────────────────────────────────────
        menuText += `┏━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 🔍 SEARCH & INFO\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `│ ➜ .weather <city>\n`;
        menuText += `│ ➜ .translate <text>\n`;
        menuText += `│ ➜ .github <username>\n`;
        menuText += `│ ➜ .bible <ref>\n`;
        menuText += `│ ➜ .calc <math>\n`;    
        menuText += `│ ➜ .ping\n`;
        menuText += `│ ➜ .alive\n`;
        menuText += `│ ➜ .uptime\n`;
        menuText += `│ ➜ .pro\n`;
        menuText += `│ ➜ .gpt <question>\n`;
        menuText += `│ ➜ .gemini <question>\n`;
        menuText += `│ ➜ .deepseek <question>\n`;
        menuText += `│ ➜ .news\n`;
        menuText += `│ ➜ .news tech\n`;
        menuText += `│ ➜ .news sports\n`;
        menuText += `│ ➜ .news business\n`;
        menuText += `│ ➜ .news health\n`;
        menuText += `│ ➜ .news science\n`;
        menuText += `│ ➜ .news entertainment\n`;
        menuText += `│ ➜ .currency <amt> <from> <to>\n`;
        menuText += `│ ➜ .imagine <text>\n`;
        menuText += `│ ➜ .getpp @user\n`;
        menuText += `│ ➜ .getgc\n`;
        menuText += `│ ➜ .tinyurl <link>\n`;   
        menuText += `│ ➜ .owner\n`; 
        menuText += `\n`;

        // ── Reminders ──────────────────────────────────────────────────────
        menuText += `┏━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ ⏰ REMINDERS\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `│ ➜ .remind 30m <msg>\n`;
        menuText += `│ ➜ .remind 2h <msg>\n`;
        menuText += `│ ➜ .remind 1d <msg>\n`;
        menuText += `│ ➜ .remind 1w <msg>\n`;
        menuText += `│ ➜ .remind tomorrow <msg>\n`;
        menuText += `│ ➜ .remind next week <msg>\n`;
        menuText += `│ ➜ .remind 25/12 <msg>\n`;
        menuText += `│ ➜ .reminders (list all)\n`;
        menuText += `│ ➜ .remind cancel <ID>\n`;
        menuText += `\n`;

        // ── Group Admin ────────────────────────────────────────────────────
        menuText += `┏━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 👥 GROUP ADMIN\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `│ ➜ .setname <name>\n`;
        menuText += `│ ➜ .groupinfo\n`;
        menuText += `│ ➜ .promote @user\n`;
        menuText += `│ ➜ .demote @user\n`;
        menuText += `│ ➜ .kick @user\n`;
        menuText += `│ ➜ .add <number>\n`;
        menuText += `│ ➜ .tagall\n`;
        menuText += `│ ➜ .tagnotadmin\n`;
        menuText += `│ ➜ .mute\n`;
        menuText += `│ ➜ .antilink <on/off/set>\n`;
        menuText += `│ ➜ .antisticker <on/off/set>\n`;
        menuText += `│ ➜ .unmute\n`;
        menuText += `│ ➜ .grouplink\n`;
        menuText += `│ ➜ .goodbye <on/off/set>\n`; 
        menuText += `\n`;

        // ── Owner Only ─────────────────────────────────────────────────────
        menuText += `┏━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 🔒 OWNER ONLY\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `│ ➜ .mode <pub/priv>\n`;
        menuText += `│ ➜ .react <emoji> (reply)\n`;
        menuText += `│ ➜ .broadcast <msg>\n`;
        menuText += `│ ➜ .setprefix <prefix>\n`;
        menuText += `│ ➜ .setnewsletter <jid>\n`; 
        menuText += `│ ➜ .restart\n`;
        menuText += `│ ➜ .autotyping\n`;
        menuText += `│ ➜ .autostatus\n`;
        menuText += `│ ➜ .autoreact\n`;
        menuText += `│ ➜ .autoread\n`;
        menuText += `│ ➜ .fakeaudio\n`;
        menuText += `│ ➜ .pmblocker\n`;
        menuText += `│ ➜ .setpp (tag/reply image)\n`;
        menuText += `│ ➜ .setmenupicture (reply img)\n`;
        menuText += `│ ➜ .support <message>\n`;
        menuText += `│ ➜ .block @user\n`;
        menuText += `│ ➜ .unblock @user\n`;
        menuText += `│ ➜ .spam <number> <msg>\n`;
        menuText += `│ ➜ .autobio set <text>\n`;
        menuText += `│ ➜ .autobio off\n`;
        menuText += `│ ➜ .autobio status\n`;
        menuText += `\n`;

        // ── Ephoto360 Maker ────────────────────────────────────────────────
        menuText += `┏━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 🎨 EPHOTO360 MAKER\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━━━\n`;
        menuText += `│ ➜ .firetext <text>\n`;
        menuText += `│ ➜ .neontext <text>\n`;
        menuText += `│ ➜ .glitchtext <text>\n`;
        menuText += `│ ➜ .matrix <text>\n`;
        menuText += `│ ➜ .metaltext <text>\n`;
        menuText += `│ ➜ .glossysilver <text>\n`;
        menuText += `│ ➜ .luxurygold <text>\n`;
        menuText += `│ ➜ .purpletext <text>\n`;
        menuText += `│ ➜ .lighttext <text>\n`;
        menuText += `│ ➜ .thundertext <text>\n`;
        menuText += `│ ➜ .icetext <text>\n`;
        menuText += `│ ➜ .snowtext <text>\n`;
        menuText += `│ ➜ .underwater <text>\n`;
        menuText += `│ ➜ .leavestext <text>\n`;
        menuText += `│ ➜ .hackertext <text>\n`;
        menuText += `│ ➜ .deviltext <text>\n`;
        menuText += `│ ➜ .devilwings <text>\n`;
        menuText += `│ ➜ .painttext <text>\n`;
        menuText += `│ ➜ .sand <text>\n`;
        menuText += `│ ➜ .summerbeach <text>\n`;
        menuText += `│ ➜ .blackpinklogo <text>\n`;
        menuText += `│ ➜ .blackpinkstyle <text>\n`;
        menuText += `│ ➜ .pixelglitch <text>\n`;
        menuText += `│ ➜ .multicoloredneon <text>\n`;
        menuText += `│ ➜ .glowingtext <text>\n`;
        menuText += `│ ➜ .advancedglow <text>\n`;
        menuText += `│ ➜ .galaxystyle <text>\n`;
        menuText += `│ ➜ .galaxywallpaper <text>\n`;
        menuText += `│ ➜ .wolfgalaxy <text>\n`;
        menuText += `│ ➜ .cartoonstyle <text>\n`;
        menuText += `│ ➜ .comic <text>\n`;
        menuText += `│ ➜ .deadpool <text>\n`;
        menuText += `│ ➜ .naruto <text>\n`;
        menuText += `│ ➜ .dragonball <text>\n`;
        menuText += `│ ➜ .1917 <text>\n`;
        menuText += `│ ➜ .pubglogo <text>\n`;
        menuText += `│ ➜ .flagtext <text>\n`;
        menuText += `│ ➜ .effectclouds <text>\n`;
        menuText += `│ ➜ .textonwetglass <text>\n`;
        menuText += `│ ➜ .typography <text>\n`;
        menuText += `│ ➜ .royaltext <text>\n`;
        menuText += `│ ➜ .vintagetext <text>\n`;
        menuText += `│ ➜ .wingslogo <text>\n`;
        menuText += `│ ➜ .makingneon <text>\n`;
        menuText += `│ ➜ .corntext <text>\n`;
        menuText += `│ ➜ .flux <text>\n`;
        menuText += `│ ➜ .arting <text>\n`;
        menuText += `\n`;

        // ── Footer ─────────────────────────────────────────────────────────
        menuText += `╰━━━━━━━━━━━━━━━━━━━\n\n`;
        menuText += `💡 Type .help <command> for more info`;

        // ── Newsletter context (shows OxBot channel follow button) ────────────
        const contextInfo = {
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid:     sock._newsletterJid || '120363421280626994@newsletter', 
                newsletterName:    'OxBot',
                serverMessageId:   -1,
            },
        };

        // ══════════════════════════════════════════════════════════════════════
        // ★ BULLETPROOF IMAGE SENDER (Custom Pro Image OR Default Fallback) ★
        // ══════════════════════════════════════════════════════════════════════
        let menuAsset = null;

        if (typeof sock.getSessionMenuImage === 'function') {
            try {
                menuAsset = await sock.getSessionMenuImage();
            } catch (e) {
                console.error('[Menu Asset Fetch Error]:', e.message);
            }
        }

        if (!menuAsset) {
            if (global.menuImage) {
                menuAsset = { type: 'image', data: global.menuImage };
            } else if (global.menuSticker) {
                menuAsset = { type: 'sticker', data: global.menuSticker };
            }
        }

        if (menuAsset?.type === 'image') {
            await sock.sendMessage(chatId, {
                image:       menuAsset.data,
                caption:     menuText,
                contextInfo,
                mentions:    [sender],
            }, { quoted: msg });
        } else if (menuAsset?.type === 'sticker') {
            await sock.sendMessage(chatId, {
                sticker: menuAsset.data,
                contextInfo,
            }, { quoted: msg });
            await sock.sendMessage(chatId, {
                text:        menuText,
                contextInfo,
                mentions:    [sender],
            }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, {
                text:        menuText,
                contextInfo,
                mentions:    [sender],
            }, { quoted: msg });
        }

        return null;

    } catch (err) {
        console.error('[HELP] Error:', err.message);
        try {
            await sock.sendMessage(msg.key.remoteJid, {
                text: '❌ Failed to load menu. Try again.',
            }, { quoted: msg });
        } catch (err) {}
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
