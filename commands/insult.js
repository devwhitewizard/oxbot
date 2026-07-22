/**
 * commands/insult.js
 * Insult a mentioned or replied-to user with savage lines.
 * Works in DMs and groups. Mention or reply to a user to target them.
 */

const name     = 'insult';
const desc     = 'Roast someone with a savage insult';
const category = 'fun';
const aliases  = ['roast', 'savage'];

const insults = [
    "Your mother had to tie a pork chop around your neck just to get the dog to play with you.",
    "You're the human equivalent of a participation trophy.",
    "I'd call you an idiot but that would be an insult to idiots.",
    "You have the personality of a wet cardboard box left in the rain for three days.",
    "If brains were petrol, you wouldn't have enough to power an ant's motorcycle around the inside of a Smartie.",
    "You're so ugly, when you were born the doctor slapped your mother.",
    "The only way you'll ever get laid is if you crawl up a chicken's backside and wait.",
    "You're like a software bug — nobody wants you, nobody created you on purpose, and nobody knows how to get rid of you.",
    "Your family tree must be a cactus because everybody on it is a prick.",
    "You're the reason your parents regret not using protection.",
    "I've seen better looking faces on a blocked drain.",
    "You are living proof that even sperm can make mistakes.",
    "If stupidity was a currency, you'd be the richest person on earth.",
    "You're not the dumbest person alive, but you better hope they don't die.",
    "Your brain is so small it got lost inside an empty peanut shell.",
    "You're the type of person who would drown looking up during a rainstorm.",
    "I would roast you harder but my mother told me not to burn trash.",
    "You have something special — the unique ability to walk into a room and immediately lower the average IQ.",
    "You're like a stray dog — nobody wants you, but you keep showing up anyway.",
    "I'd explain it to you, but I left my crayons at home.",
    "You're so annoying even your imaginary friend needed therapy after meeting you.",
    "The trash gets collected more times a week than you get useful thoughts.",
    "You must have been born on a highway because that's where most accidents happen.",
    "Your gene pool could use a little chlorine.",
    "You bring as much value to this world as a screen door on a submarine.",
    "You're so fake, Barbie is jealous.",
    "Even your reflection probably winces when it sees you.",
    "You're like Monday morning — nobody is happy to see you and you just ruin everything.",
    "I've met furniture with more personality than you.",
    "You're the type of person that makes their ancestors embarrassed to have reproduced.",
    "If being ugly was a crime, you'd get a life sentence with no parole.",
    "You're so irrelevant, your own shadow tries to walk away from you.",
    "Somewhere out there, a tree is producing oxygen for you to breathe. You owe that tree an apology.",
    "You're so slow it takes you an hour to watch 60 Minutes.",
    "Your parents must look at you sometimes and think, 'We should've gotten a goldfish.'",
    "You have the charm of a parking ticket and the charisma of a soggy biscuit.",
    "You're like a cloud with no silver lining — just permanent gloom and inconvenience.",
    "If you were any more dense, light would bend around you.",
    "Your life must be like a romantic comedy — except there's no romance and nobody's laughing.",
    "You're the type of person Wikipedia would reject as a source.",
    "I'd say you were born stupid but clearly this has been a lifelong commitment.",
    "You're living proof that evolution can go in reverse.",
    "I've seen smarter decisions made by people playing darts blindfolded.",
    "Even your village misses its idiot — please go back.",
    "You're so unimportant, spam emails skip you.",
    "You're the human version of a typo.",
    "Your IQ is so low it shows up as a negative number on standardised tests.",
    "You're like a broken compass — always pointing people in the wrong direction.",
    "You've achieved something remarkable — making everyone around you feel smarter just by existing.",
    "If you were a spice, you'd be flour.",
];

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return;

    // ── resolve target: mention first, then reply, then args ─────────────────
    let target =
        msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
        msg.message?.extendedTextMessage?.contextInfo?.participant        ||
        null;

    // fallback: someone typed .insult +2348012345678
    if (!target && args[0]) {
        const num = args[0].replace(/\D/g, '');
        if (num.length >= 7) target = num + '@s.whatsapp.net';
    }

    if (!target) {
        return await sock.sendMessage(chatId, {
            text: '❌ Mention someone or reply to their message!\n_Example: *.insult @user*_'
        }, { quoted: msg });
    }

    // ── don't let the bot insult itself ──────────────────────────────────────
    const botNum    = (sock.user?.id || '').replace(/[^0-9]/g, '');
    const targetNum = target.replace(/[^0-9]/g, '');
    if (botNum && targetNum && (botNum.endsWith(targetNum) || targetNum.endsWith(botNum))) {
        return await sock.sendMessage(chatId, {
            text: "😏 Nice try. I don't insult royalty."
        }, { quoted: msg });
    }

    // ── don't let someone insult the owner ───────────────────────────────────
    const ownerNum = (sock._ownerPhone || '').replace(/[^0-9]/g, '');
    if (ownerNum && targetNum) {
        const tNorm = targetNum.startsWith('0') ? targetNum.slice(1) : targetNum;
        const oNorm = ownerNum.startsWith('0')  ? ownerNum.slice(1)  : ownerNum;
        if (tNorm === oNorm || tNorm.endsWith(oNorm) || oNorm.endsWith(tNorm)) {
            return await sock.sendMessage(chatId, {
                text: "🤐 I don't insult my creator. Pick someone else."
            }, { quoted: msg });
        }
    }

    // ── pick random insult ────────────────────────────────────────────────────
    const insult = insults[Math.floor(Math.random() * insults.length)];
    const handle = `@${target.split('@')[0]}`;

    // ── send ──────────────────────────────────────────────────────────────────
    try {
        await sock.sendMessage(chatId, {
            text: `💀 ${handle} — ${insult}`,
            mentions: [target],
        }, { quoted: msg });
    } catch (err) {
        // rate limited — wait 2s and retry once
        if (err?.data === 429 || err?.output?.statusCode === 429) {
            await new Promise(r => setTimeout(r, 2000));
            try {
                await sock.sendMessage(chatId, {
                    text: `💀 ${handle} — ${insult}`,
                    mentions: [target],
                }, { quoted: msg });
            } catch {}
        } else {
            console.error('[insult] error:', err.message);
        }
    }
}

module.exports = { name, desc, category, aliases, execute };