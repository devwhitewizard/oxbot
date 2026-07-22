/**
 * commands/spam.js
 * Spam a user or group with a message/link every 2 seconds
 */

const name     = 'spam';
const desc     = 'Spam a user or group with a message/link';
const category = 'owner';
const aliases  = ['flood'];

function cleanNum(jid) {
    if (!jid) return '';
    return jid.replace(/[^0-9]/g, '');
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const senderId = msg.key.participant || msg.key.remoteJid;

    // ── 1. Fast Owner Check ──────────────────────────────────
    let senderIsOwner = msg.key.fromMe;
    if (!senderIsOwner && sock._ownerPhone) {
        const sN = cleanNum(senderId).replace(/^0/, '');
        const oN = cleanNum(sock._ownerPhone).replace(/^0/, '');
        senderIsOwner = sN === oN || sN.endsWith(oN) || oN.endsWith(sN);
    }

    if (!senderIsOwner) {
        return await sock.sendMessage(chatId, {
            text: '❌ Only the bot owner can use this command!'
        }, { quoted: msg });
    }

    // ── 2. Parse Arguments ───────────────────────────────────
    // Format: .spam <target> <message/link>
    if (args.length < 2) {
        return await sock.sendMessage(chatId, {
            text: `❌ *Invalid Format!*\n\n` +
                  `_Spam a user: .spam 2348012345678 Hello_\n` +
                  `_Spam a group: .spam 12345678@g.us Join link_\n` +
                  `_Spam a link: .spam 2348012345678 https://chat.whatsapp.com/xxxx_`
        }, { quoted: msg });
    }

    const rawTarget = args[0];
    const spamMessage = args.slice(1).join(' ');

    if (!spamMessage.trim()) {
        return await sock.sendMessage(chatId, {
            text: '❌ *Please provide a message or link to send!*'
        }, { quoted: msg });
    }

    // ── 3. Smart JID Formatting ──────────────────────────────
    let targetJid = rawTarget;

    // If it's just numbers, format as a private number JID
    if (/^\d+$/.test(rawTarget)) {
        targetJid = `${rawTarget}@s.whatsapp.net`;
    } 
    // If it already contains @g.us or @s.whatsapp.net, use it exactly as provided
    else if (rawTarget.includes('@g.us') || rawTarget.includes('@s.whatsapp.net')) {
        targetJid = rawTarget;
    } 
    // If it looks like a number but has a '+' or spaces, clean it
    else if (rawTarget.replace(/[^0-9]/g, '').length > 8) {
        targetJid = `${rawTarget.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    } else {
        return await sock.sendMessage(chatId, {
            text: '❌ *Invalid target!* Use a phone number or group JID (e.g., 123456@g.us).'
        }, { quoted: msg });
    }

    // ── 4. Start Spamming ────────────────────────────────────
    let count = 0;
    const MAX_SPAM = 50; // Safety limit to prevent instant bans

    const targetDisplay = targetJid.split('@')[0];
    const statusMsg = await sock.sendMessage(chatId, {
        text: `⚡ *Spamming ${targetDisplay}...*\n_Message: "${spamMessage}"_\n_Sending every 2 seconds (Max ${MAX_SPAM})..._`
    }, { quoted: msg });

    // Interval loop for 2 seconds
    const intervalId = setInterval(async () => {
        try {
            await sock.sendMessage(targetJid, { text: spamMessage });
            count++;

            // Edit the status message in the owner's chat to show live progress
            await sock.sendMessage(chatId, {
                text: `⚡ *Spamming ${targetDisplay}...*\n_Sent: ${count}/${MAX_SPAM}_`,
                edit: statusMsg.key
            }).catch(() => {});

            // Stop when it hits the safety limit
            if (count >= MAX_SPAM) {
                clearInterval(intervalId);
                await sock.sendMessage(chatId, {
                    text: `✅ *Spam Complete!*\n_Sent ${count} messages to ${targetDisplay}_`,
                    edit: statusMsg.key
                }).catch(() => {});
            }
        } catch (err) {
            console.error('[spam] Error sending:', err.message);
            clearInterval(intervalId);
            await sock.sendMessage(chatId, {
                text: `❌ *Spam Stopped!*\n_Error: ${err.message}_`,
                edit: statusMsg.key
            }).catch(() => {});
        }
    }, 2000); // 2000ms = 2 seconds

    return null;
}

module.exports = { name, desc, category, aliases, execute };