/**
 * commands/autoreact.js
 *
 * FIX: added ensureColumns() — antidelete.js already does this pattern for
 * its own column but autoreact.js never did. If autoreact_enabled /
 * autoreact_mode don't exist in bot_settings, every DB read/write here
 * throws "Unknown column", gets swallowed by try/catch, and .autoreact on
 * silently fails to persist (or errors out) with no obvious cause.
 *
 * Status reactions need a different sendMessage call than normal chat
 * reactions: Baileys requires `statusJidList` so it knows which JIDs to
 * notify about the reaction, since status@broadcast isn't a real chat.
 *
 * Only 'all' mode reacts to statuses — 'bot' mode only reacts to command
 * messages, and statuses never contain commands.
 *
 * Config is cached by sessionId (not sock) — sock objects get destroyed
 * and recreated on every reconnect by botManager.js.
 */

// ═══════════════════════════════════════════════════
// COLUMN SETUP — same defensive pattern as antidelete.js
// ═══════════════════════════════════════════════════
let columnsReady = false;

async function ensureColumns(db) {
    if (columnsReady || !db) return;
    try {
        await db.query(`ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS autoreact_enabled TINYINT(1) DEFAULT 0`);
    } catch (err) {
        if (err.errno !== 1060) {
            try { await db.query(`ALTER TABLE bot_settings ADD COLUMN autoreact_enabled TINYINT(1) DEFAULT 0`); }
            catch (e) { if (e.errno !== 1060) console.error('[AUTOREACT] Column error (enabled):', e.message); }
        }
    }
    try {
        await db.query(`ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS autoreact_mode VARCHAR(10) DEFAULT 'bot'`);
    } catch (err) {
        if (err.errno !== 1060) {
            try { await db.query(`ALTER TABLE bot_settings ADD COLUMN autoreact_mode VARCHAR(10) DEFAULT 'bot'`); }
            catch (e) { if (e.errno !== 1060) console.error('[AUTOREACT] Column error (mode):', e.message); }
        }
    }
    columnsReady = true;
}

// ═══════════════════════════════════════════════════
// PER-SESSION CONFIG CACHE
// ═══════════════════════════════════════════════════
const configCache = new Map(); // sessionId → { enabled, mode, ts }
const CACHE_TTL = 60_000;

function getSessionId(botData, sock) {
    return botData?.sessionId || sock?._ownerPhone || sock?._botData?.sessionId || null;
}

async function loadConfigFromDb(db, sessionId) {
    if (!db || !sessionId) return { enabled: false, mode: 'bot' };
    await ensureColumns(db);
    try {
        const [rows] = await db.query(
            'SELECT autoreact_enabled, autoreact_mode FROM bot_settings WHERE session_id = ? LIMIT 1',
            [sessionId]
        );
        if (rows?.[0]) {
            return {
                enabled: rows[0].autoreact_enabled === 1,
                mode: rows[0].autoreact_mode || 'bot',
            };
        }
    } catch (err) {
        console.error('[AUTOREACT] DB load error:', err.message);
    }
    return { enabled: false, mode: 'bot' };
}

async function getConfig(db, sessionId) {
    if (!sessionId) return { enabled: false, mode: 'bot' };

    const cached = configCache.get(sessionId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached;

    const loaded = await loadConfigFromDb(db, sessionId);
    const entry  = { ...loaded, ts: Date.now() };
    configCache.set(sessionId, entry);
    return entry;
}

function setConfig(sessionId, enabled, mode) {
    if (!sessionId) return;
    configCache.set(sessionId, { enabled, mode, ts: Date.now() });
}

function clearAutoReactCache(sessionId) {
    if (sessionId) configCache.delete(sessionId);
}

function randomDelay(minMs, maxMs) {
    return new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

const BOT_EMOJIS = ['⏳', '⌛', '🫡'];
const ALL_EMOJIS = ['❤️', '🔥', '👀', '😂', '😭', '🥺', '💯', '✨', '🙌', '🤝'];

// ═══════════════════════════════════════════════════
// BACKGROUND HANDLER
// ═══════════════════════════════════════════════════
async function handleAutoReact(sock, msg, botData) {
    const sessionId = getSessionId(botData, sock);
    if (!sessionId) return;

    const db     = botData?.db || sock?._botData?.db;
    const config = await getConfig(db, sessionId);

    if (!config.enabled) return;

    const m = msg?.message;
    if (!m) return;

    const isStatus = msg.key.remoteJid === 'status@broadcast';

    if (isStatus) {
        if (config.mode !== 'all') return;
        if (msg.key.fromMe) return;

        await randomDelay(1500, 5000);

        const emoji = ALL_EMOJIS[Math.floor(Math.random() * ALL_EMOJIS.length)];

        try {
            await sock.sendMessage('status@broadcast', {
                react: { text: emoji, key: msg.key }
            }, {
                statusJidList: [msg.key.participant, sock.user?.id].filter(Boolean)
            });
        } catch (err) {
            console.error('[AUTOREACT] Status react failed:', err.message);
        }
        return;
    }

    const text = m.conversation || m.extendedTextMessage?.text || '';
    const isCommand = text.startsWith('.') || text.startsWith('!') || text.startsWith('#');

    if (config.mode === 'bot' && !isCommand) return;

    const emojiList   = config.mode === 'all' ? ALL_EMOJIS : BOT_EMOJIS;
    const randomEmoji = emojiList[Math.floor(Math.random() * emojiList.length)];

    try {
        await sock.sendMessage(msg.key.remoteJid, {
            react: { text: randomEmoji, key: msg.key }
        });
    } catch {}
}

// ═══════════════════════════════════════════════════
// .autoreact COMMAND
// ═══════════════════════════════════════════════════
async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    try {
        const db        = botData?.db;
        const sessionId = botData?.sessionId;

        await ensureColumns(db);

        const opt = args.join(' ').toLowerCase();
        const currentConfig = await getConfig(db, sessionId);

        if (!opt) {
            const status = currentConfig.enabled ? '✅ *Enabled*' : '❌ *Disabled*';
            const mode   = currentConfig.mode === 'all' ? '🌟 All Messages + Statuses' : '🤖 Bot Commands Only';

            return await sock.sendMessage(chatId, {
                text: `📋 *Auto-React Configuration*\n\n` +
                      `Status: ${status}\n` +
                      `Mode: ${mode}\n\n` +
                      `*Options:*\n` +
                      `• \`.autoreact on\` - Enable auto-react\n` +
                      `• \`.autoreact off\` - Disable auto-react\n` +
                      `• \`.autoreact set bot\` - React only to commands (⏳)\n` +
                      `• \`.autoreact set all\` - React to all messages AND statuses (random emojis)`
            }, { quoted: msg });
        }

        let newEnabled = currentConfig.enabled;
        let newMode    = currentConfig.mode;

        if (opt === 'on') newEnabled = true;
        else if (opt === 'off') newEnabled = false;
        else if (opt === 'set bot') { newEnabled = true; newMode = 'bot'; }
        else if (opt === 'set all') { newEnabled = true; newMode = 'all'; }
        else {
            return await sock.sendMessage(chatId, {
                text: '❌ *Invalid option.*\n\nUse: `on` | `off` | `set bot` | `set all`'
            }, { quoted: msg });
        }

        if (db && sessionId) {
            try {
                await db.query(
                    `INSERT INTO bot_settings (session_id, autoreact_enabled, autoreact_mode) 
                     VALUES (?, ?, ?) 
                     ON DUPLICATE KEY UPDATE autoreact_enabled = ?, autoreact_mode = ?`,
                    [sessionId, newEnabled ? 1 : 0, newMode, newEnabled ? 1 : 0, newMode]
                );
            } catch (err) {
                console.error('[AUTOREACT CMD] DB Error:', err.message);
                return await sock.sendMessage(chatId, {
                    text: `❌ Failed to save setting: ${err.message}`
                }, { quoted: msg });
            }
        }

        setConfig(sessionId, newEnabled, newMode);

        let replyText = '';
        if (opt === 'on') replyText = '✅ *Auto-react enabled.*';
        else if (opt === 'off') replyText = '❌ *Auto-react disabled.*';
        else if (opt === 'set bot') replyText = '🤖 *Auto-react mode:* Bot commands only (⏳) — statuses not included';
        else if (opt === 'set all') replyText = '🌟 *Auto-react mode:* All messages AND statuses (random emojis)';

        await sock.sendMessage(chatId, { text: replyText }, { quoted: msg });

    } catch (err) {
        console.error('[AUTOREACT CMD] Error:', err.message);
        await sock.sendMessage(chatId, { text: `❌ Error configuring auto-react: ${err.message}` }, { quoted: msg });
    }
    return null;
}

module.exports = {
    handleAutoReact,
    clearAutoReactCache,
    name: 'autoreact',
    aliases: ['ar'],
    desc: 'Configure automatic reactions to messages and statuses',
    category: 'owner',
    execute
};