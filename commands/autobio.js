const name     = 'autobio';
const desc     = 'Auto-update bot WhatsApp About/Bio. Usage: .autobio set <text> | .autobio off | .autobio status';
const category = 'owner';
const aliases  = [];

// Per-session timers stored in memory
const timers = new Map();

function getUptime() {
    const s = Math.floor(process.uptime());
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function resolveBio(template) {
    const now  = new Date();
    const time = now.toLocaleTimeString('en-NG', {
        timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit'
    });
    const date = now.toLocaleDateString('en-NG', {
        timeZone: 'Africa/Lagos', day: '2-digit', month: 'short', year: 'numeric'
    });
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const day  = days[now.getDay()];

    return template
        .replace(/{time}/gi,   time)
        .replace(/{date}/gi,   date)
        .replace(/{day}/gi,    day)
        .replace(/{uptime}/gi, getUptime())
        .replace(/\\n/g,       '\n');
}

async function execute(sock, msg, botData, args) {
    const chatId    = msg.key.remoteJid;
    const sessionId = botData?.sessionId || 'default';
    const sub       = (args[0] || '').toLowerCase();

    // ── .autobio set <bio text> ──
    if (sub === 'set') {
        const template = args.slice(1).join(' ').trim();

        if (!template) {
            return await sock.sendMessage(chatId, {
                text:
                    `⚠️ *Usage:* .autobio set <bio text>\n\n` +
                    `*Optional placeholders:*\n` +
                    `• \`{time}\` — current time (WAT)\n` +
                    `• \`{date}\` — today's date\n` +
                    `• \`{day}\` — day of week\n` +
                    `• \`{uptime}\` — bot uptime\n` +
                    `• \`\\n\` — new line\n\n` +
                    `*Examples:*\n` +
                    `\`.autobio set 🤖 OxBot is online | {time}\`\n` +
                    `\`.autobio set Hey there! I'm using OxBot 🔥\`\n` +
                    `\`.autobio set Available 24/7 | Updated: {time} {date}\``,
            }, { quoted: msg });
        }

        // Clear existing timer for this session if running
        if (timers.has(sessionId)) {
            clearInterval(timers.get(sessionId).interval);
            timers.delete(sessionId);
        }

        // Update bio immediately right now
        const firstBio = resolveBio(template);
        try {
            await sock.updateProfileStatus(firstBio);
        } catch (e) {
            console.error('[autobio] Failed to set bio:', e.message);
            return await sock.sendMessage(chatId, {
                text: `❌ Failed to update bio: ${e.message}`,
            }, { quoted: msg });
        }

        // Then keep updating every 5 minutes
        const interval = setInterval(async () => {
            try {
                const bio = resolveBio(template);
                await sock.updateProfileStatus(bio);
                console.log(`[autobio:${sessionId?.slice(-6)}] Bio → ${bio.slice(0, 50)}`);
            } catch (e) {
                console.error('[autobio] Interval update failed:', e.message);
            }
        }, 5 * 60 * 1000);

        timers.set(sessionId, { interval, template });

        return await sock.sendMessage(chatId, {
            text:
                `✅ *Auto Bio activated!*\n\n` +
                `📱 *Your WhatsApp About is now:*\n"${firstBio}"\n\n` +
                `🔄 Auto-updates every *5 minutes*\n\n` +
                `Type *.autobio off* to stop.`,
        }, { quoted: msg });
    }

    // ── .autobio off ──
    if (sub === 'off' || sub === 'stop') {
        if (!timers.has(sessionId)) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ Auto Bio is not currently active.',
            }, { quoted: msg });
        }

        clearInterval(timers.get(sessionId).interval);
        timers.delete(sessionId);

        return await sock.sendMessage(chatId, {
            text: '🛑 *Auto Bio stopped.*\nYour WhatsApp About will no longer auto-update.',
        }, { quoted: msg });
    }

    // ── .autobio status ──
    if (sub === 'status') {
        if (!timers.has(sessionId)) {
            return await sock.sendMessage(chatId, {
                text: `📴 *Auto Bio:* OFF\n\nUse \`.autobio set <text>\` to activate.`,
            }, { quoted: msg });
        }

        const { template } = timers.get(sessionId);
        const current = resolveBio(template);

        return await sock.sendMessage(chatId, {
            text:
                `✅ *Auto Bio:* ON\n\n` +
                `📝 *Template:* ${template}\n\n` +
                `📱 *Current About text:*\n"${current}"\n\n` +
                `🔄 Updates every *5 minutes*`,
        }, { quoted: msg });
    }

    // ── No args — show help + current status ──
    const isOn = timers.has(sessionId);
    const statusLine = isOn
        ? `✅ *ON* — template: _${timers.get(sessionId).template}_`
        : `📴 *OFF*`;

    return await sock.sendMessage(chatId, {
        text:
            `📝 *Auto Bio — WhatsApp About Updater*\n\n` +
            `*Status:* ${statusLine}\n\n` +
            `*Commands:*\n` +
            `• \`.autobio set <text>\` — set & activate\n` +
            `• \`.autobio off\` — stop updating\n` +
            `• \`.autobio status\` — see current bio\n\n` +
            `*Placeholders:*\n` +
            `\`{time}\` \`{date}\` \`{day}\` \`{uptime}\` \`\\n\`\n\n` +
            `*Example bios:*\n` +
            `\`.autobio set 🤖 OxBot | Online | {time} WAT\`\n` +
            `\`.autobio set Hey! I'm using OxBot 🔥 oxbot.name.ng\`\n` +
            `\`.autobio set 🟢 Active | Uptime: {uptime} | {date}\``,
    }, { quoted: msg });
}

module.exports = { name, desc, category, aliases, execute };