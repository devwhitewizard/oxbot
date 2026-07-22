/**
 * encrypt.js — Encrypt Text/Data (AES-256-CBC)
 * Aliases: .encrypt, .enc
 * 
 * Encrypts any text into a secure Base64 string.
 * Uses the bot's unique session ID as the secret key.
 */

const crypto = require('crypto');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    const textToEncrypt = args.join(' ').trim();

    if (!textToEncrypt) {
        await sock.sendMessage(chatId, {
            text: '⚠️ Please provide text or code to encrypt.\n\n*Usage:*\n`.encrypt Hello World`\n`.encrypt const bot = require("baileys")`'
        }, { quoted: msg });
        return;
    }

    try {
        // 1. Generate a secret key based on the bot's session ID (AES-256 requires 32 bytes)
        const sessionId = botData?.sessionId || 'default_oxbot';
        const secretKey = crypto.createHash('sha256').update(sessionId + '_oxbot_encryption_key').digest('hex');

        // 2. Generate a random Initialization Vector (IV)
        const iv = crypto.randomBytes(16);

        // 3. Create the Cipher (AES-256-CBC)
        const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(secretKey, 'hex'), iv);

        // 4. Encrypt the data
        let encrypted = cipher.update(textToEncrypt, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        // 5. Combine IV and Encrypted text, then convert to Base64 so it's easy to copy/paste
        const combinedBuffer = Buffer.concat([iv, Buffer.from(encrypted, 'hex')]);
        const finalEncryptedString = combinedBuffer.toString('base64');

        // 6. Send the response
        await sock.sendMessage(chatId, {
            text: `🔒 *Encryption Successful*\n\n` +
                  `▢ *Algorithm:* AES-256-CBC\n` +
                  `▢ *Original Length:* ${textToEncrypt.length} characters\n\n` +
                  `*Encrypted Data:*\n${finalEncryptedString}\n\n` +
                  `_Use .decrypt <key> to decode this message._`
        }, { quoted: msg });

    } catch (err) {
        console.error('[Encrypt Error]:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ An error occurred while encrypting the text.'
        }, { quoted: msg });
    }
}

module.exports = {
    name:     'encrypt',
    aliases:  ['enc'],
    desc:     'Encrypt text/code into a secure string',
    category: 'tools',
    execute,
};