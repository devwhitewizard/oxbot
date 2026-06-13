/**
 * commands/index.js — OxBot Command Handler
 * Fixed: old message filtering, DM command support, public mode, menu sticker
 */
const fs   = require('fs');
const path = require('path');

const commands = new Map();
const cmdDir   = __dirname;

// ═══════════════════════════════════════════════════
// MENU IMAGE CACHE
// ═══════════════════════════════════════════════════
global.menuImage = null;

function scanForImage(dir, depth) {
    if (depth > 2 || !fs.existsSync(dir)) return null;
    try {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
            const full  = path.join(dir, item.name);
            const lower = item.name.toLowerCase();
            if (item.isFile()) {
                if ((lower.includes('menu') || lower.includes('bot') || lower.includes('logo') || lower.includes('oxbot'))
                    && (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png')))
                    return full;
            } else if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules' && item.name !== 'sessions') {
                const found = scanForImage(full, depth + 1);
                if (found) return found;
            }
        }
    } catch {}
    return null;
}

const fallbackPaths = [
    path.join(process.cwd(), 'assets', 'bot_image.jpg'),
    path.join(process.cwd(), 'assets', 'menu.jpg'),
    path.join(process.cwd(), 'public',  'bot_image.jpg'),
    path.join(process.cwd(), 'public',  'menu.jpg'),
    path.join(__dirname, '..', 'assets', 'bot_image.jpg'),
    path.join(__dirname, '..', 'assets', 'menu.jpg'),
];

const imgPath = scanForImage(process.cwd(), 0) || fallbackPaths.find(p => fs.existsSync(p));
if (imgPath) {
    try   { global.menuImage = fs.readFileSync(imgPath); console.log('  ✅ Menu image cached: ' + path.relative(process.cwd(), imgPath)); }
    catch (e) { console.error('  ⚠️ Image read error:', e.message); }
} else {
    console.log('  ⚠️ No menu image found — put bot_image.jpg in /assets or /public');
}

// ═══════════════════════════════════════════════════
// MENU STICKER CACHE
// ═══════════════════════════════════════════════════
global.menuSticker = null;

function scanForSticker(dir, depth) {
    if (depth > 2 || !fs.existsSync(dir)) return null;
    try {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
            const full  = path.join(dir, item.name);
            const lower = item.name.toLowerCase();
            if (item.isFile()) {
                if ((lower.includes('menu') || lower.includes('bot') || lower.includes('sticker'))
                    && lower.endsWith('.webp'))
                    return full;
            } else if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules' && item.name !== 'sessions') {
                const found = scanForSticker(full, depth + 1);
                if (found) return found;
            }
        }
    } catch {}
    return null;
}

const fallbackStickers = [
    path.join(process.cwd(), 'assets', 'menu_sticker.webp'),
    path.join(process.cwd(), 'assets', 'bot_sticker.webp'),
    path.join(process.cwd(), 'public',  'menu_sticker.webp'),
    path.join(process.cwd(), 'public',  'bot_sticker.webp'),
    path.join(__dirname, '..', 'assets', 'menu_sticker.webp'),
    path.join(__dirname, '..', 'assets', 'bot_sticker.webp'),
];

const stickerPath = scanForSticker(process.cwd(), 0) || fallbackStickers.find(p => fs.existsSync(p));
if (stickerPath) {
    try   { global.menuSticker = fs.readFileSync(stickerPath); console.log('  ✅ Menu sticker cached: ' + path.relative(process.cwd(), stickerPath)); }
    catch (e) { console.error('  ⚠️ Sticker read error:', e.message); }
} else {
    console.log('  ⚠️ No menu sticker found — put menu_sticker.webp in /assets or /public');
}

// ═══════════════════════════════════════════════════
// ANTI-SPAM (Duplicate Message Filter)
// ═══════════════════════════════════════════════════
const seen = new Set();
setInterval(() => { if (seen.size > 1000) seen.clear(); }, 5 * 60 * 1000);

function isDuplicate(id) {
    if (!id || seen.has(id)) return !!id;
    seen.add(id);
    return false;
}

// ═══════════════════════════════════════════════════
// ★ CRITICAL: OLD MESSAGE FILTER ★
// Prevents processing messages from before bot restart
// ═══════════════════════════════════════════════════
const MESSAGE_AGE_LIMIT = 15000; // 15 seconds — ignore older messages

function isOldMessage(msg) {
    const ts = msg.messageTimestamp;
    if (!ts) return false; // If no timestamp, allow it
    
    const msgTimeMs = ts * 1000;
    const ageMs = Date.now() - msgTimeMs;
    
    if (ageMs > MESSAGE_AGE_LIMIT) {
        console.log(`  ⏭️ Skipping old message (${Math.round(ageMs / 1000)}s ago)`);
        return true;
    }
    return false;
}

// Track bot start time to filter messages from before startup
const botStartTime = Date.now();

function isBeforeStartup(msg) {
    const ts = msg.messageTimestamp;
    if (!ts) return false;
    const msgTimeMs = ts * 1000;
    if (msgTimeMs < botStartTime - 5000) { // 5s grace period
        console.log(`  ⏭️ Skipping pre-startup message`);
        return true;
    }
    return false;
}

// ═══════════════════════════════════════════════════
// LOAD COMMANDS
// ═══════════════════════════════════════════════════
const SKIP = new Set([
    'index.js','handler.js','igs.js','imagine.js','img-blur.js',
    'instagram.js','pair.js','simage.js','stickertelegram.js',
    'textmaker.js','tiktok.js',
]);

for (const file of fs.readdirSync(cmdDir).filter(f => f.endsWith('.js') && !SKIP.has(f))) {
    const name = file.replace('.js', '');
    try {
        const mod     = require(path.join(cmdDir, file));
        const cmdName = (mod.name || name).toLowerCase();
        const exec    = typeof mod === 'function' ? mod : mod.execute;
        if (!exec) { console.warn('  ⚠️ Skipped (no execute): ' + name); continue; }

        const entry = { name: cmdName, execute: exec, desc: mod.desc || '', category: mod.category || 'general', aliases: mod.aliases || [] };
        commands.set(cmdName, entry);
        console.log('  ✅ Loaded: .' + cmdName);

        for (const alias of (mod.aliases || [])) {
            const key = alias.toLowerCase().replace(/^[.!]+/, '');
            if (!commands.has(key)) commands.set(key, entry);
        }
    } catch (err) {
        console.error('  ❌ Failed: ' + name + ' — ' + err.message);
    }
}

// ═══════════════════════════════════════════════════
// FEATURE HANDLERS
// ═══════════════════════════════════════════════════
function tryLoad(modPath, exportName) {
    try {
        const m = require(modPath);
        const fn = m[exportName] || null;
        if (fn) console.log('  ✅ Feature loaded: ' + exportName);
        return fn;
    } catch { return null; }
}

const featAutotyping       = tryLoad('./autotyping',  'handleAutotypingForMessage');
const featAutostatus       = tryLoad('./autostatus',  'handleAutoStatus');
const featAutoreact        = tryLoad('./autoreact',   'handleAutoReact');
const featAutoread         = tryLoad('./autoread',    'handleAutoRead');
const featFakeAudio        = tryLoad('./fakeaudio',   'handleFakeAudio');
const featPmBlocker        = tryLoad('./pmblocker',   'handlePmBlocker');
const featAntideleteStore  = tryLoad('./antidelete',  'storeMessage');
const antideleteRevocation = tryLoad('./antidelete',  'handleMessageRevocation');
const featAntiban          = tryLoad('./antiban',     'handleAntiban');
const featAutoReply        = tryLoad('./autoreply',   'handleAutoReply');

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════
function extractText(m) {
    if (!m) return '';
    return m.conversation
        || m.extendedTextMessage?.text
        || m.imageMessage?.caption
        || m.videoMessage?.caption
        || '';
}

function cleanNum(jid) {
    return jid ? jid.split(':')[0].split('@')[0] : '';
}

async function getOwnerNum(db, sessionId) {
    try {
        const [rows] = await db.query(
            'SELECT u.phone FROM users u JOIN bots b ON b.user_id=u.id WHERE b.session_id=? LIMIT 1',
            [sessionId]
        );
        return rows.length ? String(rows[0].phone).replace(/\D/g, '') : null;
    } catch { return null; }
}

async function isOwner(db, sessionId, senderId, sock, chatId) {
    const own = await getOwnerNum(db, sessionId);
    if (!own) return false;
    const clean = cleanNum(senderId);
    if (clean === own || senderId.includes(own)) return true;
    // LID fallback for groups
    if (sock && chatId?.endsWith('@g.us') && senderId.includes('@lid')) {
        try {
            const meta = await sock.groupMetadata(chatId);
            return (meta.participants || []).some(p => cleanNum(p.id) === own);
        } catch {}
    }
    return false;
}

// Per-session mode cache
const modeCache = new Map();
const MODE_TTL  = 30_000;

async function getMode(db, sessionId) {
    const c = modeCache.get(sessionId);
    if (c && Date.now() - c.ts < MODE_TTL) return c.v;
    try {
        const [rows] = await db.query('SELECT bot_mode FROM bot_settings WHERE session_id=? LIMIT 1', [sessionId]);
        const v = rows[0]?.bot_mode || 'private';
        modeCache.set(sessionId, { v, ts: Date.now() });
        return v;
    } catch { return 'private'; }
}

function clearMode(sid) { modeCache.delete(sid); }

// ═══════════════════════════════════════════════════
// ★ MAIN HANDLER (FIXED) ★
// ═══════════════════════════════════════════════════
async function handleIncomingMessage(sock, msg, botData) {
    try {
        const m = msg?.message;
        if (!m) return;

        const chatId    = msg.key.remoteJid;
        const db        = botData?.db;
        const sessionId = botData?.sessionId;

        // ═══════════════════════════════════════════
        // STATUS BROADCAST HANDLING
        // ═══════════════════════════════════════════
        if (chatId === 'status@broadcast') {
            if (featAutostatus) featAutostatus(sock, msg, botData).catch(() => {});
            if (featAutoreact)  featAutoreact(sock, msg, botData).catch(() => {});
            return;
        }

        // ═══════════════════════════════════════════
        // ★ OLD MESSAGE FILTER (FIX #1) ★
        // Skip messages from before restart
        // ═══════════════════════════════════════════
        if (isBeforeStartup(msg)) return;
        if (isOldMessage(msg)) return;

        // ═══════════════════════════════════════════
        // DUPLICATE CHECK
        // ═══════════════════════════════════════════
        if (isDuplicate(msg.key.id)) return;

        // ═══════════════════════════════════════════
        // EXTRACT TEXT & CHECK IF COMMAND
        // ═══════════════════════════════════════════
        const text = extractText(m).trim();
        const isCommand = text.length > 0 && (text[0] === '.' || text[0] === '!');

        // ═══════════════════════════════════════════
        // BACKGROUND FEATURES (always run)
        // ═══════════════════════════════════════════
        if (featAntideleteStore) featAntideleteStore(sock, msg, botData).catch(() => {});
        if (featFakeAudio && m.audioMessage) featFakeAudio(sock, chatId, msg, botData).catch(() => {});
        if (featAntiban)   featAntiban(sock, msg, botData).catch(() => {});
        if (featAutoReply && !isCommand) featAutoReply(sock, msg, botData).catch(() => {});
        
        // ═══════════════════════════════════════════
        // ★ PM BLOCKER FIX (FIX #2) ★
        // DO NOT block if it's a command — let commands through!
        // ═══════════════════════════════════════════
        if (featPmBlocker && !isCommand) {
            const blocked = await featPmBlocker(sock, msg, botData).catch(() => false);
            if (blocked) return;
        }

        // ═══════════════════════════════════════════
        // TYPING / AUTOREAD (for any message)
        // ═══════════════════════════════════════════
        if (featAutotyping) featAutotyping(sock, chatId, msg, botData).catch(() => {});
        if (featAutoread)   featAutoread(sock, msg, botData).catch(() => {});

        // ═══════════════════════════════════════════
        // IF NOT A COMMAND, STOP HERE
        // ═══════════════════════════════════════════
        if (!isCommand) return;

        // ═══════════════════════════════════════════
        // PARSE COMMAND
        // ═══════════════════════════════════════════
        const body   = text.slice(1).trim();
        if (!body) return;

        const parts      = body.split(/\s+/);
        const cmd        = parts[0].toLowerCase();
        const args       = parts.slice(1);
        const sender     = msg.key.participant || msg.key.remoteJid;
        const botNum     = cleanNum(sock.user?.id);
        const senderNum  = cleanNum(sender);
        const isDM       = !chatId.endsWith('@g.us');
        const isGroup    = chatId.endsWith('@g.us');

        // Skip own messages
        if (senderNum === botNum) return;

        console.log(`[${sessionId?.slice(-8)}] .${cmd} ← ${senderNum} [${isDM ? 'DM' : 'GROUP'}]`);

        // ═══════════════════════════════════════════
        // .mode BUILT-IN COMMAND
        // ═══════════════════════════════════════════
        if (cmd === 'mode') {
            const own = await isOwner(db, sessionId, sender, sock, chatId);
            if (!msg.key.fromMe && !own) {
                return await sock.sendMessage(chatId, { text: '🔒 Only owner can change mode!' }, { quoted: msg });
            }
            const action = args[0]?.toLowerCase();
            if (!['public','private'].includes(action)) {
                const cur = await getMode(db, sessionId);
                return await sock.sendMessage(chatId, {
                    text: `⚙️ *Bot Mode*\n\nCurrent: *${cur.toUpperCase()}*\n\nUsage:\n• \`.mode public\` — Everyone can use\n• \`.mode private\` — Only owner can use`
                }, { quoted: msg });
            }
            await db.query(
                `INSERT INTO bot_settings (session_id, bot_mode) VALUES (?,?) ON DUPLICATE KEY UPDATE bot_mode=?`,
                [sessionId, action, action]
            ).catch(() => {});
            clearMode(sessionId);
            return await sock.sendMessage(chatId, {
                text: action === 'public'
                    ? '🌐 *PUBLIC MODE*\n\n✅ Everyone can now use bot commands'
                    : '🔒 *PRIVATE MODE*\n\n✅ Only owner can use bot commands'
            }, { quoted: msg });
        }

        // ═══════════════════════════════════════════
        // ★ MODE GATE (FIX #3) ★
        // Works for both DM and Group
        // ═══════════════════════════════════════════
        const mode = await getMode(db, sessionId);
        
        if (mode === 'private' && !msg.key.fromMe) {
            const own = await isOwner(db, sessionId, sender, sock, chatId);
            if (!own) {
                // Silent ignore — don't reveal bot is active
                return;
            }
        }

        // ═══════════════════════════════════════════
        // FIND COMMAND
        // ═══════════════════════════════════════════
        const command = commands.get(cmd);
        if (!command) return;

        // ═══════════════════════════════════════════
        // OWNER-ONLY GATE
        // ═══════════════════════════════════════════
        if (command.category === 'owner' && !msg.key.fromMe) {
            const own = await isOwner(db, sessionId, sender, sock, chatId);
            if (!own) {
                return await sock.sendMessage(chatId, { 
                    text: '🔒 *Owner Only!*\nThis command is restricted to the bot owner.' 
                }, { quoted: msg });
            }
        }

        // ═══════════════════════════════════════════
        // EXECUTE COMMAND
        // ═══════════════════════════════════════════
        const result = await command.execute(sock, msg, botData, args);
        if (typeof result === 'string' && result) {
            await sock.sendMessage(chatId, { text: result }, { quoted: msg });
        }

    } catch (err) {
        console.error('[handler] Error:', err.message);
    }
}

module.exports = {
    commands,
    handleIncomingMessage,
    handleGroupParticipantUpdate: null,
    handleStatus: null,
    antideleteRevocation,
};
