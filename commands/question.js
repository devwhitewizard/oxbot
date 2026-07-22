/**
 * question.js — Random questions, truth or dare, would you rather
 * Aliases: .question, .q, .truth, .dare, 'would you rather', .wyr
 * 
 * Sub-commands:
 *   .question         — Random question
 *   .question truth   — Truth question
 *   .question dare    — Dare
 *   .question wyr     — Would you rather
 *   .question riddle  — Riddle
 *   .question flirty  — Flirty question
 */

// ═══════════════════════════════════════════════════
// QUESTION POOLS
// ═══════════════════════════════════════════════════

const TRUTH_QUESTIONS = [
    "What's the last lie you told?",
    "What's the most embarrassing thing you've done?",
    "What's a secret you've never told anyone?",
    "What's the worst thing you've ever done that nobody knows about?",
    "Have you ever stalked someone on social media?",
    "What's the most childish thing you still do?",
    "What's the biggest mistake you've made in your life?",
    "Have you ever pretended to like a gift?",
    "What's the most cringe thing you did as a kid?",
    "Have you ever lied to get out of plans?",
    "What's the longest you've gone without showering?",
    "Have you ever cried over a movie?",
    "What's the weirdest dream you've ever had?",
    "What's something you're really bad at but love doing?",
    "Have you ever eavesdropped on someone's conversation?",
    "What's the most embarrassing song on your playlist?",
    "Have you ever sent a message to the wrong person?",
    "What's the pettiest thing you've ever done?",
    "What's a weird food combination you secretly love?",
    "Have you ever pretended to be sick to avoid something?",
    "What's the most ridiculous thing you've googled?",
    "Have you ever blamed someone else for something you did?",
    "What's the longest you've gone without sleep?",
    "What's the most awkward date you've been on?",
    "Have you ever re-gifted something?",
    "What's the most embarrassing thing on your phone right now?",
    "Have you ever ghosted someone? Why?",
    "What's the dumbest thing you've ever argued about?",
    "Have you ever laughed at the wrong moment?",
    "What's a talent nobody knows you have?",
];

const DARE_QUESTIONS = [
    "Send your last screenshot to the group.",
    "Let someone go through your gallery for 30 seconds.",
    "Send a voice note singing the chorus of any song.",
    "Type a random word and send it to the last person you chatted with.",
    "Call the third person in your contacts and sing happy birthday.",
    "Let the group choose your profile picture for 24 hours.",
    "Send a message to your crush right now.",
    "Do your best impression of someone in the group.",
    "Speak in an accent for the next 5 messages.",
    "Post 'I'm a potato' on your status for 1 hour.",
    "Let someone change your group nickname.",
    "Send your most recent selfie to the group.",
    "Write a poem about the person who sent this dare.",
    "Hold your breath for 30 seconds and send a voice note proving it.",
    "Say the alphabet backwards in a voice note.",
    "Describe your day using only emojis.",
    "Compliment everyone in the group individually.",
    "Share the last thing you copied.",
    "Try to make the group laugh in one message.",
    "Send a voice note telling a joke.",
    "Write 'I believe in aliens' and send it to a family member.",
    "Dance for 10 seconds and send a video.",
    "Let the group ask you any 3 questions and you must answer honestly.",
    "Send a picture of your current view.",
    "Type with your eyes closed for the next 3 messages.",
    "Share your most used emoji.",
    "Tell an embarrassing story about yourself in 3 sentences.",
];

const WOULD_YOU_RATHER = [
    "Would you rather be able to fly or be invisible?",
    "Would you rather have unlimited money or unlimited time?",
    "Would you rather live in the past or the future?",
    "Would you rather have no internet or no phone?",
    "Would you rather be famous or be the best friend of someone famous?",
    "Would you rather always be 10 minutes late or 20 minutes early?",
    "Would you rather have a rewind button or a pause button for life?",
    "Would you rather only eat pizza or only eat burgers for a year?",
    "Would you rather have no music or no movies?",
    "Would you rather be able to read minds or see the future?",
    "Would you rather have a pet dragon or a pet unicorn?",
    "Would you rather live in space or underwater?",
    "Would you rather always be cold or always be hot?",
    "Would you rather have 3 close friends or 100 acquaintances?",
    "Would you rather never use social media again or never watch TV again?",
    "Would you rather be the funniest person alive or the smartest?",
    "Would you rather have a teleporter or a time machine?",
    "Would you rather speak every language or play every instrument?",
    "Would you rather have no taste buds or no sense of smell?",
    "Would you rather always know what time it is or always know what day it is?",
    "Would you rather have a personal chef or a personal trainer?",
    "Would you rather live in a mansion alone or a small house with friends?",
    "Would you rather have a photographic memory or be able to forget anything?",
    "Would you rather be able to talk to animals or speak all human languages?",
    "Would you rather have free Wi-Fi everywhere or free food everywhere?",
    "Would you rather only wear one color forever or never wear the same outfit twice?",
    "Would you rather have a robot servant or a flying car?",
    "Would you rather be a genius with no friends or average with many friends?",
    "Would you rather have the ability to heal anyone or bring back one person from the dead?",
    "Would you rather always have perfect weather or always have perfect sleep?",
];

const RIDDLES = [
    { q: "I have cities, but no houses. I have mountains, but no trees. I have water, but no fish. What am I?", a: "A map" },
    { q: "What has hands but can't clap?", a: "A clock" },
    { q: "What has a head and a tail but no body?", a: "A coin" },
    { q: "What gets wetter the more it dries?", a: "A towel" },
    { q: "I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?", a: "An echo" },
    { q: "What can you hold in your right hand but never in your left hand?", a: "Your left hand" },
    { q: "What has many keys but can't open a single lock?", a: "A piano" },
    { q: "What has a ring but no finger?", a: "A telephone" },
    { q: "What has teeth but cannot bite?", a: "A comb" },
    { q: "What goes up but never comes down?", a: "Your age" },
    { q: "I'm tall when I'm young and short when I'm old. What am I?", a: "A candle" },
    { q: "What has an eye but cannot see?", a: "A needle" },
    { q: "What has one eye but can't see anything?", a: "A needle" },
    { q: "What can travel around the world while staying in a corner?", a: "A stamp" },
    { q: "What is so fragile that saying its name breaks it?", a: "Silence" },
    { q: "I have branches but no fruit, trunk but no bark. What am I?", a: "A bank" },
    { q: "What comes once in a minute, twice in a moment, but never in a thousand years?", a: "The letter M" },
    { q: "What has a bottom at the top?", a: "Your legs" },
    { q: "What begins with T, ends with T, and has T in it?", a: "A teapot" },
    { q: "What breaks yet never falls, and what falls yet never breaks?", a: "Day and night" },
];

const FLIRTY_QUESTIONS = [
    "What's your idea of a perfect date?",
    "What's the first thing you notice about someone?",
    "What's the most attractive quality a person can have?",
    "Have you ever made the first move?",
    "What's the sweetest thing someone's done for you?",
    "Do you believe in love at first sight?",
    "What's your biggest turn-on?",
    "What's your biggest turn-off?",
    "Have you ever had a crush on a friend?",
    "What's the most romantic thing you've ever done?",
    "Do you prefer being called cute, hot, or handsome/beautiful?",
    "What's the best pickup line you've heard?",
    "What's the worst pickup line you've heard?",
    "Would you rather be hugged or kissed?",
    "What's your love language?",
    "Have you ever written a love letter?",
    "What song makes you think of someone you like?",
    "Do you believe in soulmates?",
    "What's the longest you've thought about someone before texting them?",
    "What's the most attractive non-physical feature?",
    "Have you ever dreamed about someone in this group?",
    "What's your type?",
    "Do you fall in love easily?",
    "What's the most romantic movie you've watched?",
    "Would you date someone taller or shorter than you?",
    "What's the most attractive accent?",
    "Have you ever had a secret admirer?",
    "What makes your heart skip a beat?",
    "Are you a flirt or do you not even realize when you're flirting?",
    "What's the most unforgettable compliment you've received?",
];

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function buildRiddleText(riddle, showAnswer) {
    if (showAnswer) {
        return `🧩 *RIDDLE*\n\n${riddle.q}\n\n💡 *Answer:* ||${riddle.a}||`;
    }
    return `🧩 *RIDDLE*\n\n${riddle.q}\n\n_Reply with .question answer to reveal!_`;
}

// ═══════════════════════════════════════════════════
// MAIN EXECUTE
// ═══════════════════════════════════════════════════

// Store current riddle for answer reveal
let currentRiddle = null;
let riddleChatId = null;

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const sub = (args[0] || '').toLowerCase();

    // ── Reveal riddle answer ────────────────────────────────────────────────
    if (sub === 'answer' || sub === 'ans') {
        if (riddleChatId !== chatId || !currentRiddle) {
            return '❌ No active riddle in this group. Use `.question riddle` to start one.';
        }
        const answer = currentRiddle.a;
        currentRiddle = null;
        riddleChatId = null;
        return `💡 *Answer:* ${answer}`;
    }

    // ── Usage ────────────────────────────────────────────────────────────────
    if (args.length === 0) {
        return `*❓ QUESTION GAME*

*.question* — Random question
*.question truth* — Truth question
*.question dare* — Dare challenge
*.question wyr* — Would you rather
*.question riddle* — Riddle (with hidden answer)
*.question answer* — Reveal riddle answer
*.question flirty* — Flirty question

_Aliases: .q, .truth, .dare, .wyr_`;
    }

    // ── Pick question ────────────────────────────────────────────────────────
    let text = '';

    switch (sub) {
        case 'truth':
            text = `🎵 *TRUTH*\n\n${pickRandom(TRUTH_QUESTIONS)}`;
            break;

        case 'dare':
            text = `🔥 *DARE*\n\n${pickRandom(DARE_QUESTIONS)}`;
            break;

        case 'wyr':
        case 'wouldyourather':
            text = `🤔 *WOULD YOU RATHER*\n\n${pickRandom(WOULD_YOU_RATHER)}`;
            break;

        case 'riddle':
            currentRiddle = pickRandom(RIDDLES);
            riddleChatId = chatId;
            text = buildRiddleText(currentRiddle, false);
            break;

        case 'flirty':
            text = `😏 *FLIRTY QUESTION*\n\n${pickRandom(FLIRTY_QUESTIONS)}`;
            break;

        default:
            // Random from all categories
            const allQuestions = [
                ...TRUTH_QUESTIONS.map(q => `🎵 *TRUTH*\n\n${q}`),
                ...DARE_QUESTIONS.map(q => `🔥 *DARE*\n\n${q}`),
                ...WOULD_YOU_RATHER.map(q => `🤔 *WOULD YOU RATHER*\n\n${q}`),
                ...FLIRTY_QUESTIONS.map(q => `😏 *FLIRTY*\n\n${q}`),
            ];
            text = pickRandom(allQuestions);
            break;
    }

    return text;
}

module.exports = {
    name:     'question',
    aliases:  ['q', 'truth', 'dare', 'wyr', 'wouldyourather'],
    desc:     'Random questions, truth or dare, riddles',
    category: 'general',
    execute,
};