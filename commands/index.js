const fs   = require('fs');
const path = require('path');

const commands = new Map();
const cmdDir   = __dirname;

// ═══════════════════════════════════════════════════
// DEFAULT MENU IMAGE CACHE (Global Fallback)
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
// DEFAULT MENU STICKER CACHE (Global Fallback)
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
    path.join(__dirname, '..', 'assets', 'menu_sticker.webp'),
];

const stickerPath = scanForSticker(process.cwd(), 0) || fallbackStickers.find(p => fs.existsSync(p));
if (stickerPath) {
    try   { global.menuSticker = fs.readFileSync(stickerPath); console.log('  ✅ Menu sticker cached: ' + path.relative(process.cwd(), stickerPath)); }
    catch (e) { console.error('  ⚠️ Sticker read error:', e.message); }
} else {
    console.log('  ⚠️ No menu sticker found — put menu_sticker.webp in /assets or /public');
}

// ═══════════════════════════════════════════════════
// ★ PER-SESSION STATE STORE ★
// ═══════════════════════════════════════════════════
const sessionStates = new Map();

function getSessionState(sessionId) {
    if (!sessionId) return null;
    if (!sessionStates.has(sessionId)) {
        sessionStates.set(sessionId, {
            seen:      new Set(),
            startTime: Date.now(),
        });
    }
    return sessionStates.get(sessionId);
}

function clearSessionState(sessionId) {
    if (sessionId) sessionStates.delete(sessionId);
}

// Periodic cleanup — clear seen sets that are too large (memory safety)
setInterval(() => {
    for (const [sid, state] of sessionStates) {
        if (state.seen.size > 2000) {
            state.seen.clear();
        }
    }
}, 5 * 60 * 1000);

// ─────────────────────────────────────────────────
// Per-session duplicate check
// ─────────────────────────────────────────────────
function isDuplicate(sessionId, msgId) {
    if (!sessionId || !msgId) return false;
    const state = getSessionState(sessionId);
    if (!state) return false;
    if (state.seen.has(msgId)) return true;
    state.seen.add(msgId);
    return false;
}

// ─────────────────────────────────────────────────
// Per-session pre-startup filter
// ─────────────────────────────────────────────────
function isBeforeStartup(sessionId, msg) {
    const ts = msg.messageTimestamp;
    if (!ts || !sessionId) return false;
    const state = getSessionState(sessionId);
    if (!state) return false;
    const msgTimeMs = ts * 1000;
    if (msgTimeMs < state.startTime - 5000) {
        return true;
    }
    return false;
}

// ═══════════════════════════════════════════════════
// LOAD COMMANDS
// ═══════════════════════════════════════════════════
const SKIP = new Set([
    'index.js','handler.js','igs.js','imagine.js','img-blur.js',
    'pair.js','simage.js','stickertelegram.js',
    'textmaker.js', '_helper.js',
]);

for (const file of fs.readdirSync(cmdDir).filter(f => f.endsWith('.js') && !SKIP.has(f))) {
    const name = file.replace('.js', '');
    try {
        const mod     = require(path.join(cmdDir, file));
        const cmdName = (mod.name || name).toLowerCase();
        const exec    = typeof mod === 'function' ? mod : mod.execute;
        if (!exec) { console.warn('  ⚠️ Skipped (no execute): ' + name); continue; }

        const entry = {
            name:     cmdName,
            execute:  exec,
            desc:     mod.desc     || '',
            category: mod.category || 'general',
            aliases:  mod.aliases  || [],
        };
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
        const m  = require(modPath);
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
const featAntilink         = tryLoad('./antilink',    'handleAntilink'); // ★ ADDED ANTILINK

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════
function extractText(m) {
    if (!m) return '';
    
    // ★★★ THE DM FIX: UNWRAP EPHEMERAL MESSAGES ★★★
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
    if (m.viewOnceMessage) m = m.viewOnceMessage.message;
    if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;

    return m.conversation
        || m.extendedTextMessage?.text
        || m.imageMessage?.caption
        || m.videoMessage?.caption
        || '';
}

function cleanNum(jid) {
    return jid ? jid.split(':')[0].split('@')[0] : '';
}

// ═══════════════════════════════════════════════════
// ★★★ SOCKET-BASED SESSION & OWNER RESOLUTION ★★★
// ═══════════════════════════════════════════════════

function getRealSessionId(sock) {
    if (!sock) return null;
    if (sock._ownerPhone) return sock._ownerPhone;
    if (sock.user?.id) return cleanNum(sock.user.id);
    return null;
}

function isOwnerSync(sock, senderId) {
    if (!sock || !senderId) return false;
    const ownerPhone = getRealSessionId(sock);
    if (!ownerPhone) return false;

    const senderClean = cleanNum(senderId).replace(/\D/g, '');
    const ownerClean  = ownerPhone.replace(/\D/g, '');
    
    const senderNorm = senderClean.startsWith('0') ? senderClean.slice(1) : senderClean;
    const ownerNorm  = ownerClean.startsWith('0') ? ownerClean.slice(1) : ownerClean;

    if (!senderNorm || !ownerNorm) return false;
    if (senderNorm === ownerNorm) return true;
    if (senderNorm.endsWith(ownerNorm)) return true;
    if (ownerNorm.endsWith(senderNorm)) return true;

    return false;
}

async function isOwnerAsync(sock, senderId, chatId) {
    if (isOwnerSync(sock, senderId)) return true;

    if (chatId?.endsWith('@g.us') && senderId?.includes('@lid')) {
        const ownerPhone = getRealSessionId(sock);
        if (!ownerPhone) return false;
        const ownerFinal = ownerPhone.replace(/\D/g, '');
        const ownerNorm = ownerFinal.startsWith('0') ? ownerFinal.slice(1) : ownerFinal;

        try {
            const meta = await sock.groupMetadata(chatId);
            return (meta.participants || []).some(p => {
                const pClean = cleanNum(p.id).replace(/\D/g, '');
                const pNorm  = pClean.startsWith('0') ? pClean.slice(1) : pClean;
                if (!pNorm || !ownerNorm) return false;
                return pNorm === ownerNorm || pNorm.endsWith(ownerNorm) || ownerNorm.endsWith(pNorm);
            });
        } catch {}
    }
    return false;
}

// ═══════════════════════════════════════════════════
// ★★★ PER-SESSION MODE (socket-keyed) ★★★
// ═══════════════════════════════════════════════════
const modeCache = new Map();
const MODE_TTL  = 30_000;

async function getModeForSocket(sock) {
    const sessionId = getRealSessionId(sock);
    if (!sessionId) return 'public';

    const c = modeCache.get(sessionId);
    if (c && Date.now() - c.ts < MODE_TTL) return c.v;

    try {
        const db = sock?._botData?.db;
        if (db) {
            const [rows] = await db.query(
                'SELECT bot_mode FROM bot_settings WHERE session_id = ? LIMIT 1',
                [sessionId]
            );
            const v = rows[0]?.bot_mode || 'public';
            modeCache.set(sessionId, { v, ts: Date.now() });
            return v;
        }
    } catch {}

    return 'public';
}

function setModeForSocket(sock, mode) {
    const sessionId = getRealSessionId(sock);
    if (sessionId) modeCache.set(sessionId, { v: mode, ts: Date.now() });
}

function clearMode(sid) { 
    if (sid) modeCache.delete(sid); 
}

// ═══════════════════════════════════════════════════
// ★★★ PER-SESSION MENU IMAGE LOADER ★★★
// 1. Checks Memory Cache (instant)
// 2. Checks DB for Pro Custom Image (using exact DB ID)
// 3. Falls back to Default Global Image
// ═══════════════════════════════════════════════════
async function getSessionMenuImage(sock) {
    // ★ FIX: Handle both direct call and method call (.call context)
    const s = sock || this;
    if (!s) return null;

    // 1. Check memory cache first (instant)
    if (s._customMenuImage) return { type: 'image', data: s._customMenuImage };

    const db = s?._botData?.db;
    const sessionId = s?._botData?.sessionId;
    
    // 2. Check database for custom menu image
    if (db && sessionId) {
        try {
            let dbSessionId = null;
            const [botRows] = await db.query('SELECT session_id FROM bots WHERE session_id = ? LIMIT 1', [sessionId]);
            if (botRows.length) {
                dbSessionId = botRows[0].session_id;
            } else if (!String(sessionId).startsWith('oxbot_')) {
                const [botRows2] = await db.query('SELECT session_id FROM bots WHERE session_id = ? LIMIT 1', [`oxbot_${sessionId}`]);
                if (botRows2.length) dbSessionId = botRows2[0].session_id;
            }

            if (dbSessionId) {
                const [settings] = await db.query('SELECT menu_image FROM bot_settings WHERE session_id = ?', [dbSessionId]);
                
                if (settings.length > 0 && settings[0].menu_image === 'custom') {
                    const [rows] = await db.query('SELECT image_data FROM bot_images WHERE session_id = ?', [dbSessionId]);
                    if (rows.length > 0 && rows[0].image_data) {
                        s._customMenuImage = rows[0].image_data; // Cache it
                        return { type: 'image', data: rows[0].image_data };
                    }
                }
            }
        } catch (err) {
            console.error('[Menu Image DB Error]:', err.message); 
        }
    }

    // 3. Fallback to default global assets
    if (global.menuImage) return { type: 'image', data: global.menuImage };
    if (global.menuSticker) return { type: 'sticker', data: global.menuSticker };
    return null;
}

// ═══════════════════════════════════════════════════
// ★ MAIN HANDLER — FULLY SOCKET-ISOLATED ★
// ═══════════════════════════════════════════════════
async function handleIncomingMessage(sock, msg, botData) {
    try {
        const m = msg?.message;
        if (!m) return;

        const chatId = msg.key.remoteJid;

        // ═══════════════════════════════════════════
        // ★ STEP 1: Get REAL session directly from socket ★
        // ═══════════════════════════════════════════
        const realSessionId = getRealSessionId(sock);
        if (!realSessionId) return;

        // ═══════════════════════════════════════════
        // ★ STEP 2: Store safe botData & attach Menu Loader ★
        // ═══════════════════════════════════════════
        const safeBotData = { ...(botData || {}), sessionId: realSessionId };
        sock._botData = safeBotData;
        sock.getSessionMenuImage = getSessionMenuImage; // Attach helper

        // ── STATUS BROADCAST ───────────────────────
        if (chatId === 'status@broadcast') {
            if (featAutostatus) featAutostatus(sock, msg, safeBotData).catch(() => {});
            if (featAutoreact)  featAutoreact(sock, msg, safeBotData).catch(() => {});
            return;
        }

        // ── FILTERS (per session) ──────────────────
        if (isBeforeStartup(realSessionId, msg)) return;
        if (isDuplicate(realSessionId, msg.key.id)) return;
        
        // ── EXTRACT TEXT ───────────────────────────
        const text      = extractText(m).trim();
        
        // ★ Dynamic Prefix Check (Checks socket cache, falls back to . and !)
        const activePrefix = sock._customPrefix || '. | !';
        const validPrefixes = activePrefix.split('|').map(p => p.trim());
        const isCommand = text.length > 0 && validPrefixes.includes(text[0]);

        // ── BACKGROUND FEATURES ────────────────────
        if (featAntideleteStore) featAntideleteStore(sock, msg, safeBotData).catch(() => {});
        if (featFakeAudio && m.audioMessage) featFakeAudio(sock, chatId, msg, safeBotData).catch(() => {});

        if (featPmBlocker && !isCommand) {
            const blocked = await featPmBlocker(sock, msg, safeBotData).catch(() => false);
            if (blocked) return;
        }

        if (featAntiban)                    featAntiban(sock, msg, safeBotData).catch(() => {});
        if (featAntilink)                   featAntilink(sock, msg, safeBotData).catch(() => {}); // ★ ADDED ANTILINK WATCHER
        if (featAutoReply && !isCommand)    featAutoReply(sock, msg, safeBotData).catch(() => {});
        if (featAutotyping)                 featAutotyping(sock, chatId, msg, safeBotData).catch(() => {});
        if (featAutoread)                   featAutoread(sock, msg, safeBotData).catch(() => {});

        // ── NOT A COMMAND — STOP ───────────────────
        if (!isCommand) return;

        // ── PARSE COMMAND ──────────────────────────
        const body = text.slice(1).trim();
        if (!body) return;

        const parts     = body.split(/\s+/);
        const cmd       = parts[0].toLowerCase();
        const args      = parts.slice(1);
        const sender    = msg.key.participant || msg.key.remoteJid;
        const senderNum = cleanNum(sender);

        console.log(`[${realSessionId}] .${cmd} ← ${senderNum} [${chatId?.endsWith('@g.us') ? 'GROUP' : 'DM'}]`);

        // ── .mode BUILT-IN ─────────────────────────
        if (cmd === 'mode') {
            const own = await isOwnerAsync(sock, sender, chatId);
            if (!msg.key.fromMe && !own) {
                return await sock.sendMessage(chatId, { text: '🔒 Only owner can change mode!' }, { quoted: msg });
            }
            const action = args[0]?.toLowerCase();
            if (!['public', 'private'].includes(action)) {
                const cur = await getModeForSocket(sock);
                return await sock.sendMessage(chatId, {
                    text: `⚙️ *Bot Mode*\n\nCurrent: *${cur.toUpperCase()}*\n\nUsage:\n• \`.mode public\` — Everyone can use\n• \`.mode private\` — Only owner can use`
                }, { quoted: msg });
            }
            const db = safeBotData.db;
            if (db) {
                await db.query(
                    `INSERT INTO bot_settings (session_id, bot_mode) VALUES (?,?) ON DUPLICATE KEY UPDATE bot_mode=?`,
                    [realSessionId, action, action]
                ).catch(() => {});
            }
            setModeForSocket(sock, action);
            return await sock.sendMessage(chatId, {
                text: action === 'public'
                    ? '🌐 *PUBLIC MODE*\n\n✅ Everyone can now use bot commands'
                    : '🔒 *PRIVATE MODE*\n\n✅ Only owner can use bot commands'
            }, { quoted: msg });
        }

        // ── MODE GATE (socket-based) ───────────────
        const mode = await getModeForSocket(sock);
        if (mode === 'private' && !msg.key.fromMe) {
            const own = await isOwnerAsync(sock, sender, chatId);
            if (!own) return;
        }

        // ── FIND COMMAND ───────────────────────────
        const command = commands.get(cmd);
        if (!command) return;

        // ── OWNER-ONLY GATE (socket-based) ─────────
        if (command.category === 'owner' && !msg.key.fromMe) {
            const own = await isOwnerAsync(sock, sender, chatId);
            if (!own) {
                return await sock.sendMessage(chatId, {
                    text: '🔒 *Owner Only!*\nThis command is restricted to the bot owner.'
                }, { quoted: msg });
            }
        }

        // ── EXECUTE ────────────────────────────────
        const result = await command.execute(sock, msg, safeBotData, args);
        if (typeof result === 'string' && result) {
            await sock.sendMessage(chatId, { text: result }, { quoted: msg });
        }

    } catch (err) {
        const sid = getRealSessionId(sock) || '???';
        console.error(`[${sid}] Handler error:`, err.message);
    }
}

module.exports = {
    commands,
    handleIncomingMessage,
    handleGroupParticipantUpdate: null,
    handleStatus:                 null,
    antideleteRevocation,  
    clearMode,
    clearSessionState, 
}; 
