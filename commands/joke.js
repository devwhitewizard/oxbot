/**
 * OxBot — Joke Command
 * Replies with a random, clean joke from a curated list.
 */

async function execute(sock, message, botData, args) {
    const chatId = message.key.remoteJid;

    // Curated clean / programming jokes
    const jokes = [
        "Why do programmers prefer dark mode? Because light attracts bugs.",
        "A SQL query walks into a bar, walks up to two tables and asks: 'Can I join you?'.",
        "Why do Java developers wear glasses? Because they don't C#.",
        "There are only 10 types of people in the world: those who understand binary and those who don't.",
        "I told my computer I needed a break, and it said: 'No problem — I'll go to sleep.'",
        "Why was the developer unhappy at their job? They wanted arrays.",
        "Debugging: Removing the needles from the haystack.",
        "A programmer's wife tells him: 'Run to the store and pick up a loaf of bread. If they have eggs, get a dozen.' He returns with 12 loaves of bread because they had eggs.",
        "How many programmers does it take to change a light bulb? None — it's a hardware problem.",
        "I asked ChatGPT for a joke about recursion. It replied: 'See joke about recursion.'"
    ];

    const pick = jokes[Math.floor(Math.random() * jokes.length)];

    try {
        await sock.sendMessage(chatId, { text: pick }, { quoted: message });
    } catch (err) {
        console.error('[joke] Send error:', err?.message || err);
    }
}

module.exports = {
    name: 'joke',
    execute,
    desc: 'Tell a random funny joke',
    category: 'fun',
    aliases: ['telljoke', 'haha']
};
