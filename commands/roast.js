/**
 * OxBot — Roast Command
 * Playfully roast a mentioned user or the sender.
 */

async function execute(sock, message, botData, args) {
    const chatId = message.key.remoteJid;

    const roasts = [
        "I'd explain it to you, but I left my crayons at home.",
        "You're not stupid; you just have bad luck thinking.",
        "I'd agree with you but then we'd both be wrong.",
        " You're like a cloud. When you disappear, it's a beautiful day.",
        "If I wanted to kill myself I'd climb your ego and jump to your IQ.",
        "You're the reason the gene pool needs a lifeguard.",
        "I'd call you sharp, but that would be a lie.",
        "You bring everyone so much joy when you leave the room.",
        "You're proof that even Google doesn't have all the answers.",
        "I would give you a nasty look but you've already got one."
    ];

    // Helper to extract mention from quoted context or extended text message
    function extractMention(msg) {
        try {
            // Preferred: contextInfo.mentionedJid
            const ctx = msg.message?.extendedTextMessage?.contextInfo;
            if (ctx?.mentionedJid && ctx.mentionedJid.length) return ctx.mentionedJid[0];

            // If sender included an @mention in plain text, try to pick it up from args
            const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
            const parts = text.split(/\s+/);
            if (parts.length > 1) {
                const maybe = parts[1];
                // crude phone-like match
                const cleaned = maybe.replace(/[^0-9]/g, '');
                if (cleaned.length >= 6) return cleaned + '@s.whatsapp.net';
            }
        } catch (e) {}
        return null;
    }

    // Determine target JID
    let targetJid = null;
    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage ? message.message.extendedTextMessage.contextInfo.quotedMessage : null;
    const mentionFromCtx = message.message?.extendedTextMessage?.contextInfo?.mentionedJid;
    if (mentionFromCtx && mentionFromCtx.length) targetJid = mentionFromCtx[0];
    if (!targetJid) targetJid = extractMention(message) || message.key.participant || message.key.remoteJid;

    // Friendly display name for target
    const display = (targetJid || '').split(':')[0].split('@')[0];

    const roast = roasts[Math.floor(Math.random() * roasts.length)];
    const reply = `🔥 ${display} — ${roast}`;

    try {
        await sock.sendMessage(chatId, { text: reply }, { quoted: message });
    } catch (err) {
        console.error('[roast] Send error:', err?.message || err);
    }
}

module.exports = {
    name: 'roast',
    execute,
    desc: 'Playfully roast a user or yourself',
    category: 'fun',
    aliases: ['burn', 'insult']
};
