const words = [
    'javascript', 'whatsapp', 'nodejs', 'oxbot', 'database', 
    'server', 'android', 'computer', 'internet', 'telegram',
    'programming', 'developer', 'software', 'algorithm', 'function'
];

// ✅ Multi-user safe: Keyed by chatId so different users don't overwrite each other
const hangmanGames = new Map();

module.exports = {
    name: 'hangman',
    aliases: ['h'], // Users can just type .h a
    desc: 'Play a game of Hangman',
    category: 'fun',
    
    async execute(sock, msg, botData, args) {
        const chatId = msg.key.remoteJid;
        
        // If no arguments, START a new game
        if (!args || args.length === 0) {
            const word = words[Math.floor(Math.random() * words.length)];
            const maskedWord = Array(word.length).fill('_');
            
            hangmanGames.set(chatId, {
                word: word.toLowerCase(),
                maskedWord,
                guessedLetters: [],
                wrongGuesses: 0,
                maxWrongGuesses: 6,
            });

            return await sock.sendMessage(chatId, { 
                text: `🎮 *HANGMAN GAME STARTED*\n\n` +
                      `Word: ${maskedWord.join(' ')}\n` +
                      `Lives: ❤️❤️❤️❤️❤️❤️\n\n` +
                      `Guess a letter by typing:\n*.h a* or *.hangman a*`
            }, { quoted: msg });
        }

        // If arguments exist, it's a GUESS
        const letter = args[0].toLowerCase();
        
        // Make sure they only type 1 letter
        if (!/^[a-z]$/.test(letter)) {
            return await sock.sendMessage(chatId, { 
                text: '❌ Please guess a single letter (a-z).\nExample: *.h a*' 
            }, { quoted: msg });
        }

        const game = hangmanGames.get(chatId);
        if (!game) {
            return await sock.sendMessage(chatId, { 
                text: '❌ No game in progress. Start one with *.hangman*' 
            }, { quoted: msg });
        }

        // Check if already guessed
        if (game.guessedLetters.includes(letter)) {
            return await sock.sendMessage(chatId, { 
                text: `⚠️ You already guessed "${letter}". Try another letter.` 
            }, { quoted: msg });
        }

        game.guessedLetters.push(letter);

        if (game.word.includes(letter)) {
            // Correct guess
            for (let i = 0; i < game.word.length; i++) {
                if (game.word[i] === letter) {
                    game.maskedWord[i] = letter.toUpperCase();
                }
            }

            // WIN CONDITION
            if (!game.maskedWord.includes('_')) {
                hangmanGames.delete(chatId);
                return await sock.sendMessage(chatId, { 
                    text: `🎉 *CONGRATULATIONS!*\n\nYou guessed the word: *${game.word.toUpperCase()}*` 
                }, { quoted: msg });
            }

            const hearts = '❤️'.repeat(game.maxWrongGuesses - game.wrongGuesses);
            await sock.sendMessage(chatId, { 
                text: `✅ *Correct!*\n\nWord: ${game.maskedWord.join(' ')}\nLives: ${hearts}\nGuessed: ${game.guessedLetters.join(', ')}` 
            }, { quoted: msg });

        } else {
            // Wrong guess
            game.wrongGuesses += 1;
            const hearts = '❤️'.repeat(game.maxWrongGuesses - game.wrongGuesses) + '🖤'.repeat(game.wrongGuesses);

            // LOSE CONDITION
            if (game.wrongGuesses >= game.maxWrongGuesses) {
                hangmanGames.delete(chatId);
                return await sock.sendMessage(chatId, { 
                    text: `💀 *GAME OVER!*\n\nThe word was: *${game.word.toUpperCase()}*\n\nStart a new game with *.hangman*` 
                }, { quoted: msg });
            }

            await sock.sendMessage(chatId, { 
                text: `❌ *Wrong!*\n\nWord: ${game.maskedWord.join(' ')}\nLives: ${hearts}\nGuessed: ${game.guessedLetters.join(', ')}` 
            }, { quoted: msg });
        }
    }
};