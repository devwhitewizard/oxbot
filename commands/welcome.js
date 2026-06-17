
/**
 * welcome.js — OxBot Welcome Message System
 * Commands: .welcome on | off | set <msg> | reset | test | status
 */

const name     = 'welcome';
const desc     = 'Manage group welcome messages. Usage: .welcome on/off/set/reset/test/status';
const category = 'general';
const aliases  = ['setwelcome', 'welcomemsg'];

// In-memory store per group (persists until restart)
// Structure: { [groupId]: { enabled: bool, message: string|null } }
const welcomeStore = new Map();

// ── DB helpers ──────────────────────────────────────────────────────────────

async function dbGet(db, groupId) {
    if (!db) return null;
    try {
        const [rows] = await db.query(
            'SELECT enabled, message FROM welcome_settings WHERE group_id = ? LIMIT 1',
            [groupId]
        );
        return rows[0] || null;
    } catch { return null; }
}

async function dbSet(db, groupId, enabled, message) {
    if (!db) return;
    try {
        await db.query(
            `INSERT INTO welcome_settings (group_id, enabled, message)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), message = VALUES(message)`,
            [groupId, enabled ? 1 : 0, message || null]
        );
    } catch (e) { console.error('[welcome] DB write error:', e.message); }
}

async function getSettings(db, groupId) {
    // Check memory first
    if (welcomeStore.has(groupId)) return welcomeStore.get(groupId);
    // Fall back to DB
    const row = await dbGet(db, groupId);
    const settings = {
        enabled: row ? !!row.enabled : false,
        message: row?.message || null,
    };
    welcomeStore.set(groupId, settings);
    return settings;
}

async function saveSettings(db, groupId, settings) {
    welcomeStore.set(groupId, settings);
    await dbSet(db, groupId, settings.enabled, settings.message);
}

// ── Build welcome message ────────────────────────────────────────────────────

function buildMessage(template, displayName, participantJid, groupName, groupDesc, memberCount) {
    const now  = new Date();
    const time = now.toLocaleString('en-NG', {
        timeZone: 'Africa/Lagos',
        hour: '2-digit', minute: '2-digit',
        day: '2-digit', month: 'short', year: 'numeric',
    });

    if (template) {
        return template
            .replace(/{user}/gi,        `@${participantJid.split('@')[0]}`)
            .replace(/{name}/gi,        displayName)
            .replace(/{group}/gi,       groupName)
            .replace(/{desc}/gi,        groupDesc)
            .replace(/{count}/gi,       memberCount)
            .replace(/{time}/gi,        time)
            .replace(/\\n/g,            '\n');
    }

    // Default welcome message
    return (
        `╭━━━━━━━━━━━━━━━━━━╮\n` +
        `┃  👋 *NEW MEMBER*\n` +
        `┃\n` +
        `┃  Welcome @${participantJid.split('@')[0]}!\n` +
        `┃\n` +
        `┃  📌 *Group:* ${groupName}\n` +
        `┃  👥 *Members:* ${memberCount}\n` +
        `┃  🕐 *Joined:* ${time}\n` +
        `┃\n` +
        `┃  ${groupDesc ? groupDesc.slice(0, 80) + (groupDesc.length > 80 ? '…' : '') : 'Welcome aboard! 🎉'}\n` +
        `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
        `_Powered by OxBot • oxbot.name.ng_`
    );
}

// ── Get display name ─────────────────────────────────────────────────────────

async function getDisplayName(sock, participantJid, groupMetadata) {
    // Try group participant name first
    try {
        const p = (groupMetadata.participants || []).find(x => x.id === participantJid);
        if (p?.name) return p.name;
        if (p?.notify) return p.notify;
    } catch {}

    // Try business profile
    try {
        const biz = await sock.getBusinessProfile(participantJid);
        if (biz?.name) return biz.name;
    } catch {}

    // Fallback to phone number
    return participantJid.split('@')[0];
}

// ── Get profile picture ───────────────────────────────────────────────────────

async function getProfilePic(sock, participantJid) {
    try {
        const url = await sock.profilePictureUrl(participantJid, 'image');
        if (url) {
            const axios = require('axios');
            const res   = await axios.get(url, { responseType: 'arraybuffer', timeout: 6000 });
            return Buffer.from(res.data);
        }
    } catch {}
    return null;
}

// ── HANDLE JOIN EVENT (called from app.js / index.js group participant update) ──

async function handleJoinEvent(sock, groupId, participants, botData) {
    const db       = botData?.db;
    const settings = await getSettings(db, groupId);
    if (!settings.enabled) return;

    let groupMetadata;
    try { groupMetadata = await sock.groupMetadata(groupId); }
    catch { return; }

    const groupName  = groupMetadata.subject || 'this group';
    const groupDesc  = groupMetadata.desc    || '';
    const memberCount = groupMetadata.participants?.length || 0;

    for (const participant of participants) {
        try {
            const pJid       = typeof participant === 'string' ? participant : (participant.id || String(participant));
            const displayName = await getDisplayName(sock, pJid, groupMetadata);
            const text        = buildMessage(settings.message, displayName, pJid, groupName, groupDesc, memberCount);

            // Try with profile picture
            const picBuffer = await getProfilePic(sock, pJid);
            if (picBuffer) {
                await sock.sendMessage(groupId, {
                    image:    picBuffer,
                    caption:  text,
                    mentions: [pJid],
                });
            } else {
                await sock.sendMessage(groupId, {
                    text,
                    mentions: [pJid],
                });
            }
        } catch (err) {
            console.error('[welcome] Join handler error:', err.message);
        }
    }
}

// ── COMMAND HANDLER ──────────────────────────────────────────────────────────

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    const db     = botData?.db;

    // Group only
    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, {
            text: '❌ Welcome commands only work inside groups.',
        }, { quoted: msg });
    }

    const sub = (args[0] || '').toLowerCase();

    // ── .welcome on ──
    if (sub === 'on' || sub === 'enable') {
        const settings = await getSettings(db, chatId);
        settings.enabled = true;
        await saveSettings(db, chatId, settings);
        return await sock.sendMessage(chatId, {
            text:
                `✅ *Welcome messages ON!*\n\n` +
                `New members will be greeted automatically.\n\n` +
                (settings.message
                    ? `📝 Using your custom message.`
                    : `📝 Using default message. Set a custom one with:\n*.welcome set <your message>*`),
        }, { quoted: msg });
    }

    // ── .welcome off ──
    if (sub === 'off' || sub === 'disable') {
        const settings = await getSettings(db, chatId);
        settings.enabled = false;
        await saveSettings(db, chatId, settings);
        return await sock.sendMessage(chatId, {
            text: `🛑 *Welcome messages OFF.*\nNew members will not be greeted.`,
        }, { quoted: msg });
    }

    // ── .welcome set <message> ──
    if (sub === 'set') {
        const newMsg = args.slice(1).join(' ').trim();
        if (!newMsg) {
            return await sock.sendMessage(chatId, {
                text:
                    `⚠️ *Usage:* .welcome set <your message>\n\n` +
                    `*Placeholders you can use:*\n` +
                    `• \`{user}\` — @mention the new member\n` +
                    `• \`{name}\` — their display name\n` +
                    `• \`{group}\` — group name\n` +
                    `• \`{desc}\` — group description\n` +
                    `• \`{count}\` — member count\n` +
                    `• \`{time}\` — time they joined\n` +
                    `• \`\\n\` — new line\n\n` +
                    `*Example:*\n` +
                    `\`.welcome set 🎉 Welcome {user} to {group}!\\nWe now have {count} members.\``,
            }, { quoted: msg });
        }

        const settings = await getSettings(db, chatId);
        settings.message = newMsg;
        await saveSettings(db, chatId, settings);

        return await sock.sendMessage(chatId, {
            text:
                `✅ *Custom welcome message saved!*\n\n` +
                `📝 *Preview:*\n${newMsg}\n\n` +
                (settings.enabled
                    ? `✅ Welcome is ON — will use this message.`
                    : `⚠️ Welcome is OFF. Type *.welcome on* to activate.`),
        }, { quoted: msg });
    }

    // ── .welcome reset ──
    if (sub === 'reset') {
        const settings = await getSettings(db, chatId);
        settings.message = null;
        await saveSettings(db, chatId, settings);
        return await sock.sendMessage(chatId, {
            text: `🔄 *Welcome message reset to default.*`,
        }, { quoted: msg });
    }

    // ── .welcome test ──
    if (sub === 'test') {
        const settings = await getSettings(db, chatId);
        const sender   = msg.key.participant || msg.key.remoteJid;

        let groupMetadata;
        try { groupMetadata = await sock.groupMetadata(chatId); }
        catch { groupMetadata = { subject: 'Test Group', desc: '', participants: [] }; }

        const displayName = await getDisplayName(sock, sender, groupMetadata);
        const groupName   = groupMetadata.subject || 'Test Group';
        const groupDesc   = groupMetadata.desc    || '';
        const memberCount = groupMetadata.participants?.length || 0;
        const text        = buildMessage(settings.message, displayName, sender, groupName, groupDesc, memberCount);

        // Try to send with their profile picture
        const picBuffer = await getProfilePic(sock, sender);
        if (picBuffer) {
            await sock.sendMessage(chatId, {
                image:    picBuffer,
                caption:  `🧪 *TEST WELCOME*\n\n${text}`,
                mentions: [sender],
            }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, {
                text:     `🧪 *TEST WELCOME*\n\n${text}`,
                mentions: [sender],
            }, { quoted: msg });
        }
        return;
    }

    // ── .welcome status ──
    if (sub === 'status' || sub === 'info') {
        const settings = await getSettings(db, chatId);
        return await sock.sendMessage(chatId, {
            text:
                `📋 *Welcome Status*\n\n` +
                `*Status:* ${settings.enabled ? '✅ ON' : '📴 OFF'}\n` +
                `*Message:* ${settings.message ? '📝 Custom set' : '🔧 Default'}\n\n` +
                (settings.message ? `*Custom message:*\n${settings.message}\n\n` : '') +
                `*Commands:*\n` +
                `• \`.welcome on\` — enable\n` +
                `• \`.welcome off\` — disable\n` +
                `• \`.welcome set <msg>\` — custom message\n` +
                `• \`.welcome reset\` — back to default\n` +
                `• \`.welcome test\` — preview it now`,
        }, { quoted: msg });
    }

    // ── No subcommand → show help ──
    const settings = await getSettings(db, chatId);
    return await sock.sendMessage(chatId, {
        text:
            `👋 *Welcome System*\n\n` +
            `*Status:* ${settings.enabled ? '✅ ON' : '📴 OFF'}\n\n` +
            `*Commands:*\n` +
            `• \`.welcome on\` — turn on welcome messages\n` +
            `• \`.welcome off\` — turn off welcome messages\n` +
            `• \`.welcome set <msg>\` — set custom message\n` +
            `• \`.welcome reset\` — reset to default message\n` +
            `• \`.welcome test\` — preview welcome message now\n` +
            `• \`.welcome status\` — see current settings\n\n` +
            `*Placeholders:* \`{user}\` \`{name}\` \`{group}\` \`{desc}\` \`{count}\` \`{time}\``,
    }, { quoted: msg });
}

module.exports = { name, desc, category, aliases, execute, handleJoinEvent };