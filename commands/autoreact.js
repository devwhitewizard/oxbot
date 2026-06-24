/**
 * commands/autoreact.js
 * Handles background auto-reactions AND the .autoreact command
 */

// ═══════════════════════════════════════════════════
// BACKGROUND HANDLER (Called by index.js on every message)
// ═══════════════════════════════════════════════════
async function handleAutoReact(sock, msg, botData) {
    const config = sock._autoReactConfig;
    
    // If not configured or disabled, do nothing
    if (!config || !config.enabled) return;

    const m = msg?.message;
    if (!m) return;

    // Skip status broadcasts
    if (msg.key.remoteJid === 'status@broadcast') return;

    const text = m.conversation || m.extendedTextMessage?.text || '';
    const isCommand = text.startsWith('.') || text.startsWith('!') || text.startsWith('#');

    // If mode is 'bot', ONLY react to commands
    if (config.mode === 'bot' && !isCommand) return;

    // Random emojis for 'all' mode, specific emoji for 'bot' mode
    const botEmojis = ['⏳', '⌛', '🫡'];
    const allEmojis = ['❤️', '🔥', '👀', '😂', '😭', '🥺', '💯', '✨', '🙌', '🤝'];
    
    const emojiList = config.mode === 'all' ? allEmojis : botEmojis;
    const randomEmoji = emojiList[Math.floor(Math.random() * emojiList.length)];

    try {
        await sock.sendMessage(msg.key.remoteJid, { 
            react: { text: randomEmoji, key: msg.key } 
        });
    } catch {}
}

// ═══════════════════════════════════════════════════
// COMMAND HANDLER (Called when user types .autoreact)
// ═══════════════════════════════════════════════════
async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    try {
        const db = botData?.db;
        const sessionId = botData?.sessionId;
        const opt = args.join(' ').toLowerCase();

        const currentConfig = sock._autoReactConfig || { enabled: false, mode: 'bot' };

        if (!opt) {
            const status = currentConfig.enabled ? '✅ *Enabled*' : '❌ *Disabled*';
            const mode = currentConfig.mode === 'all' ? '🌟 All Messages' : '🤖 Bot Commands Only';
            
            return await sock.sendMessage(chatId, {
                text: `📋 *Auto-React Configuration*\n\n` +
                      `Status: ${status}\n` +
                      `Mode: ${mode}\n\n` +
                      `*Options:*\n` +
                      `• \`.autoreact on\` - Enable auto-react\n` +
                      `• \`.autoreact off\` - Disable auto-react\n` +
                      `• \`.autoreact set bot\` - React only to commands (⏳)\n` +
                      `• \`.autoreact set all\` - React to all messages (random emojis)`
            }, { quoted: msg });
        }

        let newEnabled = currentConfig.enabled;
        let newMode = currentConfig.mode;

        if (opt === 'on') newEnabled = true;
        else if (opt === 'off') newEnabled = false;
        else if (opt === 'set bot') { newEnabled = true; newMode = 'bot'; }
        else if (opt === 'set all') { newEnabled = true; newMode = 'all'; }
        else {
            return await sock.sendMessage(chatId, {
                text: '❌ *Invalid option.*\n\nUse: `on` | `off` | `set bot` | `set all`'
            }, { quoted: msg });
        }

        // Save to DB
        if (db && sessionId) {
            try {
                await db.query(
                    `INSERT INTO bot_settings (session_id, autoreact_enabled, autoreact_mode) 
                     VALUES (?, ?, ?) 
                     ON DUPLICATE KEY UPDATE autoreact_enabled = ?, autoreact_mode = ?`,
                    [sessionId, newEnabled ? 1 : 0, newMode, newEnabled ? 1 : 0, newMode]
                );
            } catch (err) { console.error('[AUTOREACT CMD] DB Error:', err.message); }
        }

        // Update socket cache instantly
        sock._autoReactConfig = { enabled: newEnabled, mode: newMode };

        let replyText = '';
        if (opt === 'on') replyText = '✅ *Auto-react enabled.*';
        else if (opt === 'off') replyText = '❌ *Auto-react disabled.*';
        else if (opt === 'set bot') replyText = '🤖 *Auto-react mode:* Bot commands only (⏳)';
        else if (opt === 'set all') replyText = '🌟 *Auto-react mode:* All messages (random emojis)';

        await sock.sendMessage(chatId, { text: replyText }, { quoted: msg });

    } catch (err) {
        console.error('[AUTOREACT CMD] Error:', err.message);
        await sock.sendMessage(chatId, { text: '❌ Error configuring auto-react.' }, { quoted: msg });
    }
    return null;
}

module.exports = {
    handleAutoReact, // Exported for index.js background feature
    name: 'autoreact',
    aliases: ['ar'],
    desc: 'Configure automatic reactions to messages',
    category: 'owner',
    execute
};