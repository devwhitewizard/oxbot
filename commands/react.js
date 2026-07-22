/**
 * commands/react.js
 *
 * Two modes:
 * 1. Reply to a message in a normal chat/group with `.react <emoji>`
 *    — unchanged from before.
 * 2. `.react <emoji> <channel-post-link>` — reacts to a specific post in
 *    a WhatsApp Channel, given its shareable link.
 *
 * IMPORTANT CAVEAT: WhatsApp Channel ("newsletter") reactions use a
 * different API from normal chat reactions in Baileys — they need the
 * channel's JID plus the post's numeric server_id, not the usual
 * {remoteJid, id, participant} message key. This requires:
 *   - @whiskeysockets/baileys recent enough to expose newsletter methods
 *     (newsletterMetadata, newsletterReactMessage). If your install is
 *     old, update it first (npm install @whiskeysockets/baileys@latest)
 *     or this mode will throw "not a function".
 *   - A channel post LINK that includes the post's server_id as the
 *     trailing path segment, e.g.
 *     https://whatsapp.com/channel/<inviteCode>/<serverId>
 *     A bare channel link (no trailing number) only identifies the
 *     channel itself, not a specific post — in that case this reacts to
 *     the most recent post instead, since there's nothing more specific
 *     to go on.
 */

const clean = (jid) => jid ? jid.split(':')[0].split('@')[0] : '';

// matches https://whatsapp.com/channel/<inviteCode>[/<serverId>]
const CHANNEL_LINK_RE = /whatsapp\.com\/channel\/([A-Za-z0-9]+)(?:\/(\d+))?/i;

async function reactToChannelPost(sock, link, emoji) {
    const match = link.match(CHANNEL_LINK_RE);
    if (!match) return { ok: false, error: 'Not a valid WhatsApp channel link.' };

    const inviteCode   = match[1];
    const linkServerId = match[2] ? Number(match[2]) : null;

    if (typeof sock.newsletterMetadata !== 'function' || typeof sock.newsletterReactMessage !== 'function') {
        return {
            ok: false,
            error: 'Your Baileys version doesn\'t support channel reactions. Run: npm install @whiskeysockets/baileys@latest'
        };
    }

    let meta;
    try {
        meta = await sock.newsletterMetadata('invite', inviteCode);
    } catch (err) {
        return { ok: false, error: `Could not resolve channel from link: ${err.message}` };
    }

    const channelJid = meta?.id;
    if (!channelJid) return { ok: false, error: 'Could not resolve channel JID from link.' };

    let serverId = linkServerId;

    // No serverId in the link — fall back to the most recent post
    if (!serverId) {
        if (typeof sock.newsletterFetchMessages !== 'function') {
            return { ok: false, error: 'Link has no post ID and this Baileys version can\'t list channel posts to find the latest one.' };
        }
        try {
            const messages = await sock.newsletterFetchMessages(channelJid, 1);
            const latest = messages?.[0];
            if (!latest?.server_id && !latest?.serverId) {
                return { ok: false, error: 'Could not find any posts in this channel.' };
            }
            serverId = latest.server_id ?? latest.serverId;
        } catch (err) {
            return { ok: false, error: `Could not fetch channel posts: ${err.message}` };
        }
    }

    try {
        await sock.newsletterReactMessage(channelJid, String(serverId), emoji);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: `Reaction failed: ${err.message}` };
    }
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const senderId = msg.key.participant || msg.key.remoteJid;

    // ✅ Fast owner check
    let isOwner = msg.key.fromMe;
    if (!isOwner) {
        const ownerPhone = sock._ownerPhone;
        const senderNum = clean(senderId).replace(/\D/g, '');
        const ownerNum  = ownerPhone ? ownerPhone.replace(/\D/g, '') : '';

        if (senderNum && ownerNum) {
            const sN = senderNum.startsWith('0') ? senderNum.slice(1) : senderNum;
            const oN = ownerNum.startsWith('0') ? ownerNum.slice(1) : ownerNum;
            isOwner = sN === oN || sN.endsWith(oN) || oN.endsWith(sN);
        }
    }

    if (!isOwner) {
        await sock.sendMessage(chatId, { text: '❌ Owner only.' }, { quoted: msg });
        return null;
    }

    // ── MODE 1: link somewhere in the args → react to a channel post ────────
    const linkArg = args.find(a => CHANNEL_LINK_RE.test(a));
    if (linkArg) {
        const emoji = args.find(a => a !== linkArg) || '❤️';
        const result = await reactToChannelPost(sock, linkArg, emoji);

        if (result.ok) {
            await sock.sendMessage(chatId, { text: `✅ Reacted ${emoji} to channel post.` }, { quoted: msg });
        } else {
            await sock.sendMessage(chatId, { text: `❌ ${result.error}` }, { quoted: msg });
        }
        return null;
    }

    // ── MODE 2: reply-to-message react (original behavior, unchanged) ───────
    const emoji = args[0] || '❤️';
    const ctx = msg.message?.extendedTextMessage?.contextInfo;

    if (!ctx?.stanzaId) {
        await sock.sendMessage(chatId, {
            text: '❌ Reply to a message with `.react <emoji>`, or use `.react <emoji> <channel-post-link>`.'
        }, { quoted: msg });
        return null;
    }

    try {
        await sock.sendMessage(chatId, {
            react: {
                text: emoji,
                key: { remoteJid: chatId, id: ctx.stanzaId, participant: ctx.participant }
            }
        });
    } catch {
        await sock.sendMessage(chatId, { text: '❌ Failed to react.' }, { quoted: msg });
    }
    return null;
}

module.exports = {
    name: 'react',
    desc: 'React to a message, or to a WhatsApp channel post via link',
    category: 'owner',
    execute
};