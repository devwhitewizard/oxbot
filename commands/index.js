 /**
 * commands/index.js — OxBot (SQL Version)
 *
 * ALL database operations use db.query() with proper SQL syntax.
 * Supports both MySQL/MariaDB and SQLite.
 */

const fs   = require('fs');
const path = require('path');

const commands = new Map();
const cmdDir   = __dirname;

// ═══════════════════════════════════════════════════
// MENU ASSET CACHE
// ═══════════════════════════════════════════════════
global.menuImage   = null;
global.menuSticker = null;

function scanForFile(dir, depth, nameParts, exts) {
    if (depth > 2 || !fs.existsSync(dir)) return null;
    try {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
            const full  = path.join(dir, item.name);
            const lower = item.name.toLowerCase();
            if (item.isFile()) {
                if (nameParts.some(p => lower.includes(p)) && exts.some(e => lower.endsWith(e)))
                    return full;
            } else if (item.isDirectory() &&
                !item.name.startsWith('.') &&
                item.name !== 'node_modules' &&
                item.name !== 'sessions' &&
                item.name !== 'data') {
                const found = scanForFile(full, depth + 1, nameParts, exts);
                if (found) return found;
            }
        }
    } catch {}
    return null;
}

const imgPath = scanForFile(process.cwd(), 0,
    ['menu', 'bot', 'logo', 'oxbot'], ['.jpg', '.jpeg', '.png']) ||
    [
        path.join(process.cwd(), 'assets', 'bot_image.jpg'),
        path.join(process.cwd(), 'assets', 'menu.jpg'),
    ].find(p => fs.existsSync(p));

if (imgPath) {
    try   { global.menuImage = fs.readFileSync(imgPath); console.log('  Menu image cached'); }
    catch (e) { console.error('  Image read error:', e.message); }
} else {
    console.log('  No menu image found — put bot_image.jpg in /assets');
}

const stickerPath = scanForFile(process.cwd(), 0,
    ['menu', 'bot', 'sticker'], ['.webp']) ||
    [
        path.join(process.cwd(), 'assets', 'menu_sticker.webp'),
    ].find(p => fs.existsSync(p));

if (stickerPath) {
    try   { global.menuSticker = fs.readFileSync(stickerPath); console.log('  Menu sticker cached'); }
    catch (e) { console.error('  Sticker read error:', e.message); }
} else {
    console.log('  No menu sticker found — put menu_sticker.webp in /assets');
}

// ═══════════════════════════════════════════════════
// PER-SESSION DEDUP
// ═══════════════════════════════════════════════════
const sessionSeen = new Map();

function isDuplicate(sessionId, msgId) {
    if (!sessionId || !msgId) return false;
    if (!sessionSeen.has(sessionId)) sessionSeen.set(sessionId, new Set());
    const seen = sessionSeen.get(sessionId);
    if (seen.has(msgId)) return true;
    seen.add(msgId);
    if (seen.size > 1000) {
        const arr = [...seen];
        seen.clear();
        arr.slice(-200).forEach(id => seen.add(id));
    }
    return false;
}

function clearSessionState(sessionId) {
    if (sessionId) sessionSeen.delete(sessionId);
}

// ═══════════════════════════════════════════════════
// GROUP PRIMARY BOT SYSTEM
// ═══════════════════════════════════════════════════
const groupPrimaryBot = new Map();

function isPrimaryBotForGroup(chatId, sessionId) {
    if (!chatId?.endsWith('@g.us')) return true;
    if (!groupPrimaryBot.has(chatId)) {
        groupPrimaryBot.set(chatId, sessionId);
        return true;
    }
    return groupPrimaryBot.get(chatId) === sessionId;
}

function clearPrimaryBotClaims(sessionId) {
    if (!sessionId) return;
    for (const [chatId, sid] of groupPrimaryBot) {
        if (sid === sessionId) groupPrimaryBot.delete(chatId);
    }
}

// ═══════════════════════════════════════════════════
// LOAD COMMANDS
// ═══════════════════════════════════════════════════
const SKIP = new Set([
    'index.js', 'handler.js', 'igs.js', 'img-blur.js',
    'simage.js', 'stickertelegram.js', 'textmaker.js', '_helper.js',
]);

for (const file of fs.readdirSync(cmdDir).filter(f => f.endsWith('.js') && !SKIP.has(f))) {
    const name = file.replace('.js', '');
    try {
        const mod     = require(path.join(cmdDir, file));
        const cmdName = (mod.name || name).toLowerCase();
        const exec    = typeof mod === 'function' ? mod : mod.execute;
        if (!exec) { console.warn('  Skipped (no execute):', name); continue; }

        const entry = {
            name:     cmdName,
            execute:  exec,
            desc:     mod.desc     || '',
            category: mod.category || 'general',
            aliases:  mod.aliases  || [],
        };
        commands.set(cmdName, entry);
        console.log('  Loaded: .' + cmdName);

        for (const alias of (mod.aliases || [])) {
            const key = alias.toLowerCase().replace(/^[.!\/]+/, '');
            if (!commands.has(key)) commands.set(key, entry);
        }
    } catch (err) {
        console.error('  Failed:', name, '-', err.message);
    }
}

// ═══════════════════════════════════════════════════
// FEATURE HANDLERS
// ═══════════════════════════════════════════════════
function tryLoad(modPath, exportName) {
    try {
        const m  = require(modPath);
        const fn = m[exportName] || null;
        if (fn) console.log('  Feature loaded:', exportName);
        return fn;
    } catch {
        return null;
    }
}

const featAutotyping       = tryLoad('./autotyping',  'handleAutotypingForMessage');
const featAutostatus       = tryLoad('./autostatus',  'handleAutoStatus');
const featAutoreact        = tryLoad('./autoreact',   'handleAutoReact');
const featAutoread         = tryLoad('./autoread',    'handleAutoRead');
const featFakeAudio        = tryLoad('./fakeaudio',   'handleFakeAudio');

const featAntideleteStore  = tryLoad('./antidelete',  'storeMessage');
const antideleteRevocation = tryLoad('./antidelete',  'handleMessageRevocation');
const featAntiban          = tryLoad('./antiban',     'handleAntiban');
const featAutoReply        = tryLoad('./autoreply',   'handleAutoReply');
const featAntilink         = tryLoad('./antilink',    'handleAntilink');
const featAntisticker      = tryLoad('./antisticker', 'handleAntiSticker');

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

function extractText(m) {
    if (!m) return '';
    if (m.ephemeralMessage)           m = m.ephemeralMessage.message           || m;
    if (m.viewOnceMessageV2)          m = m.viewOnceMessageV2.message          || m;
    if (m.viewOnceMessage)            m = m.viewOnceMessage.message            || m;
    if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message || m;

    if (m.conversation)                    return m.conversation;
    if (m.extendedTextMessage?.text)       return m.extendedTextMessage.text;
    if (m.imageMessage?.caption)           return m.imageMessage.caption;
    if (m.videoMessage?.caption)           return m.videoMessage.caption;
    if (m.documentMessage?.caption)        return m.documentMessage.caption;
    if (m.templateButtonReplyMessage?.selectedId)
        return m.templateButtonReplyMessage.selectedId;
    if (m.templateButtonReplyMessage?.selectedDisplayText)
        return m.templateButtonReplyMessage.selectedDisplayText;
    if (m.listResponseMessage?.singleSelectReply?.selectedRowId)
        return m.listResponseMessage.singleSelectReply.selectedRowId;
    if (m.listResponseMessage?.title)
        return m.listResponseMessage.title;
    if (m.buttonsResponseMessage?.selectedButtonId)
        return m.buttonsResponseMessage.selectedButtonId;
    if (m.buttonsResponseMessage?.selectedDisplayText)
        return m.buttonsResponseMessage.selectedDisplayText;
    if (m.interactiveResponseMessage?.body?.text)
        return m.interactiveResponseMessage.body.text;
    if (m.interactiveMessage?.body?.text)
        return m.interactiveMessage.body.text;
    return '';
}

function cleanNum(jid) {
    return jid ? jid.replace(/[^0-9]/g, '') : '';
}

function norm(num) {
    const n = cleanNum(num);
    return n.startsWith('0') ? n.slice(1) : n;
}

function numsMatch(a, b) {
    if (!a || !b) return false;
    const aN = norm(a);
    const bN = norm(b);
    if (!aN || !bN) return false;
    return aN === bN || aN.endsWith(bN) || bN.endsWith(aN);
}

// ═══════════════════════════════════════════════════
// SESSION + OWNER RESOLUTION
// ═══════════════════════════════════════════════════
function getRealSessionId(sock) {
    if (!sock) return null;
    if (sock._ownerPhone) return sock._ownerPhone;
    if (sock.user?.id)    return cleanNum(sock.user.id);
    return null;
}

function isOwnerSync(sock, senderId) {
    if (!sock || !senderId) return false;
    const ownerPhone = getRealSessionId(sock);
    if (!ownerPhone) return false;

    if (numsMatch(cleanNum(senderId), ownerPhone)) return true;

    try {
        const config = require('./../config');
        if (config.ownerNumber?.length) {
            const senderNum = cleanNum(senderId);
            for (const owner of config.ownerNumber) {
                if (numsMatch(senderNum, owner)) return true;
            }
        }
    } catch {}

    return false;
}

// ── sudo cache ────────────────────────────────────────────────────────────────
const sudoCache = new Map();
const SUDO_TTL  = 60_000;

async function getSudoNums(db, sessionId) {
    if (!db || !sessionId) return new Set();

    const c = sudoCache.get(sessionId);
    if (c && Date.now() - c.ts < SUDO_TTL) return c.nums;

    try {
        const [rows] = await db.query(
            'SELECT user_jid FROM bot_sudo WHERE session_id = ?',
            [sessionId]
        );
        const nums = new Set((rows || []).map(r => cleanNum(r.user_jid)));
        sudoCache.set(sessionId, { nums, ts: Date.now() });
        return nums;
    } catch (err) {
        console.error('[getSudoNums Error]:', err.message);
        sudoCache.set(sessionId, { nums: new Set(), ts: Date.now() });
        return new Set();
    }
}

function bustSudoCache(sessionId) {
    if (sessionId) sudoCache.delete(sessionId);
}

async function isSudo(sock, senderJid, db) {
    const sessionId = getRealSessionId(sock);
    if (!sessionId || !senderJid) return false;
    const nums      = await getSudoNums(db, sessionId);
    const senderNum = cleanNum(senderJid);
    for (const n of nums) {
        if (numsMatch(senderNum, n)) return true;
    }
    return false;
}

async function isOwnerAsync(sock, senderId, chatId, fromMe = false) {
    if (fromMe) return true;
    if (isOwnerSync(sock, senderId)) return true;

    try {
        const db = sock?._botData?.db;
        if (await isSudo(sock, senderId, db)) return true;
    } catch {}

    if (chatId?.endsWith('@g.us') && senderId?.includes('@lid')) {
        const ownerPhone = getRealSessionId(sock);
        if (!ownerPhone) return false;
        const oNorm = norm(ownerPhone);
        try {
            const meta = await sock.groupMetadata(chatId);
            return (meta.participants || []).some(p => numsMatch(norm(cleanNum(p.id)), oNorm));
        } catch {}
    }

    return false;
}

// ── Owner JID Helper ─────────────────────────────────────────────────────────
async function getOwnerJid(db, sessionId) {
    if (!db || !sessionId) return null;
    try {
        const userId = await getOwnerUserId(db, sessionId);
        if (!userId) return null;
        return `${userId}@s.whatsapp.net`;
    } catch {
        return null;
    }
}

async function getOwnerUserId(db, sessionId) {
    if (!db || !sessionId) return null;
    try {
        const [rows] = await db.query(
            'SELECT user_id FROM bots WHERE session_id = ?',
            [sessionId]
        );
        if (rows?.[0]?.user_id) return rows[0].user_id;
    } catch {}

    try {
        const config = require('./../config');
        if (config.ownerNumber && config.ownerNumber.length > 0) {
            return cleanNum(config.ownerNumber[0]);
        }
    } catch {}

    return null;
}

async function isPro(db, userId) {
    if (!userId || !db) return false;
    try {
        const [rows] = await db.query(
            'SELECT * FROM pro_subscriptions WHERE user_id = ? AND status = ? AND expires_at > NOW()',
            [userId, 'active']
        );
        if (rows && rows.length > 0) return true;
    } catch {}
    return false;
}

// ═══════════════════════════════════════════════════
// PREFIX — SQL VERSION
// ═══════════════════════════════════════════════════
const prefixCache = new Map();
const PREFIX_TTL  = 60_000;

async function getPrefixes(sock) {
    const sessionId = getRealSessionId(sock);
    if (!sessionId) return ['.', '!'];

    const c = prefixCache.get(sessionId);
    if (c && Date.now() - c.ts < PREFIX_TTL) return c.prefixes;

    try {
        const db = sock?._botData?.db;
        if (db && db.query) {
            const [rows] = await db.query(
                'SELECT prefix FROM bot_settings WHERE session_id = ?',
                [sessionId]
            );
            const prefixStr = rows?.[0]?.prefix;
            if (prefixStr) {
                const prefixes = prefixStr
                    .split(/[|,]/)
                    .map(p => p.trim())
                    .filter(Boolean);
                if (prefixes.length) {
                    prefixCache.set(sessionId, { prefixes, ts: Date.now() });
                    return prefixes;
                }
            }
        }
    } catch (err) {
        console.error('[getPrefixes Error]:', err.message);
    }

    const fallback = ['.', '!'];
    prefixCache.set(sessionId, { prefixes: fallback, ts: Date.now() });
    return fallback;
}

function clearPrefixCache(sessionId) {
    if (sessionId) prefixCache.delete(sessionId);
}

// ═══════════════════════════════════════════════════
// MODE — SQL VERSION
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
        if (db && db.query) {
            const [rows] = await db.query(
                'SELECT bot_mode FROM bot_settings WHERE session_id = ?',
                [sessionId]
            );
            const v = rows?.[0]?.bot_mode || 'public';
            modeCache.set(sessionId, { v, ts: Date.now() });
            return v;
        }
    } catch (err) {
        console.error('[getModeForSocket Error]:', err.message);
    }

    return 'public';
}

function setModeCache(sock, mode) {
    const sessionId = getRealSessionId(sock);
    if (sessionId) modeCache.set(sessionId, { v: mode, ts: Date.now() });
}

function clearMode(sid) {
    if (sid) modeCache.delete(sid);
}

/**
 * Upsert bot_mode into bot_settings table.
 * Tries MySQL syntax first, falls back to SQLite.
 */
async function saveModeToDb(db, sessionId, mode) {
    if (!db || !db.query || !sessionId) return false;

    // Attempt 1: MySQL / MariaDB (ON DUPLICATE KEY UPDATE)
    try {
        await db.query(
            'INSERT INTO bot_settings (session_id, bot_mode) VALUES (?, ?) ON DUPLICATE KEY UPDATE bot_mode = ?',
            [sessionId, mode, mode]
        );
        return true;
    } catch (e1) {
        console.log('[saveMode] MySQL syntax failed:', e1.message);
    }

    // Attempt 2: SQLite (INSERT OR REPLACE)
    try {
        await db.query(
            'INSERT OR REPLACE INTO bot_settings (session_id, bot_mode) VALUES (?, ?)',
            [sessionId, mode]
        );
        return true;
    } catch (e2) {
        console.log('[saveMode] SQLite syntax failed:', e2.message);
    }

    // Attempt 3: Manual check-then-update-or-insert
    try {
        const [rows] = await db.query(
            'SELECT session_id FROM bot_settings WHERE session_id = ?',
            [sessionId]
        );
        if (rows && rows.length > 0) {
            await db.query(
                'UPDATE bot_settings SET bot_mode = ? WHERE session_id = ?',
                [mode, sessionId]
            );
        } else {
            await db.query(
                'INSERT INTO bot_settings (session_id, bot_mode) VALUES (?, ?)',
                [sessionId, mode]
            );
        }
        return true;
    } catch (e3) {
        console.error('[saveMode] All attempts failed:', e3.message);
    }

    return false;
}

// ═══════════════════════════════════════════════════
// MENU IMAGE — SQL VERSION
// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
// MENU IMAGE — SQL VERSION (Fixed Cache & Fallbacks)
// ═══════════════════════════════════════════════════
// ═══════════════════════════════════════════════════
// MENU IMAGE — SQL VERSION (Fixed for BLOB & oxbot_ Session IDs)
// ═══════════════════════════════════════════════════
async function getSessionMenuImage(sock) {
    const s = sock || this;
    if (!s) return null;

    const db        = s?._botData?.db;
    // This correctly grabs the 'oxbot_234...' string from your botData
    const sessionId = s?._botData?.sessionId || getRealSessionId(s);

    if (db && db.query && sessionId) {
        try {
            // Query your exact database table. ORDER BY uploaded_at DESC ensures it gets the newest image if you upload multiple.
            const [images] = await db.query(
                'SELECT image_data, mime_type FROM bot_images WHERE session_id = ? ORDER BY uploaded_at DESC LIMIT 1',
                [sessionId]
            );

            if (images && images.length > 0) {
                const row = images[0];
                const imgData = row.image_data;

                // Convert BLOB to strict Node.js Buffer (Fixes WhatsApp BLOB crash)
                if (imgData) {
                    const buf = Buffer.isBuffer(imgData) ? Buffer.from(imgData) : Buffer.from(imgData);
                    
                    // Check if it's a sticker (webp) or standard image (jpeg/png) based on your database
                    const isSticker = row.mime_type && row.mime_type.includes('webp');
                    
                    console.log(`  [Menu Image] Successfully loaded custom image (${buf.length} bytes, ${row.mime_type})`);
                    
                    return { 
                        type: isSticker ? 'sticker' : 'image', 
                        data: buf 
                    };
                }
            }
        } catch (err) {
            console.error('[Menu Image DB Error]:', err.message);
        }
    }

    // 2. Absolute Fallback (Loads default if nothing is in the database)
    if (global.menuImage)   return { type: 'image',   data: global.menuImage };
    if (global.menuSticker) return { type: 'sticker', data: global.menuSticker };
    return null;
}
// ═══════════════════════════════════════════════════
// ATTACH botData TO SOCKET
// ═══════════════════════════════════════════════════
function attachBotDataToSocket(sock, botData) {
    sock._botData            = botData;
    sock._connectedAt        = Date.now();
    sock.getSessionMenuImage = getSessionMenuImage;

    if (sock._botData) {
        sock._botData.getOwnerUserId  = getOwnerUserId;
        sock._botData.isPro           = isPro;
        sock._botData.getOwnerJid     = getOwnerJid;
        // Added for mode.js
        sock._botData.isOwnerAsync    = isOwnerAsync;
        sock._botData.getModeForSocket = getModeForSocket;
        sock._botData.saveModeToDb    = saveModeToDb;
        sock._botData.setModeCache    = setModeCache;
    }
}

// ═══════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════
async function handleIncomingMessage(sock, msg, botData) {
    try {
        const m = msg?.message;
        if (!m) return;

        const chatId  = msg.key.remoteJid;
        const fromMe  = msg.key.fromMe === true;

        // ── STEP 1: resolve session ────────────────────────────────────────
        const realSessionId = getRealSessionId(sock);
        if (!realSessionId) {
            console.warn('[index] getRealSessionId returned null');
            return;
        }

        // ── STEP 2: ensure botData attached ──────────────────────────────────
        if (!sock._botData) {
            sock._botData = {
                ...(botData || {}),
                sessionId: realSessionId,
                getOwnerUserId: getOwnerUserId,
                isPro: isPro,
                getOwnerJid: getOwnerJid
            };
            sock._connectedAt = sock._connectedAt || Date.now();
            sock.getSessionMenuImage = getSessionMenuImage;
        }

        const safeBotData = sock._botData;

        // ── STATUS BROADCAST ───────────────────────────────────────────────
        if (chatId === 'status@broadcast') {
            if (featAutostatus) featAutostatus(sock, msg, safeBotData).catch(() => {});
            if (featAutoreact)  featAutoreact(sock, msg, safeBotData).catch(() => {});
            return;
        }

        // ── DEDUP ────────────────────────────────────────────────────────────
        if (isDuplicate(realSessionId, msg.key.id)) return;

        // ── EXTRACT TEXT ───────────────────────────────────────────────────
        const text = extractText(m).trim();

        // ── PREFIX CHECK ───────────────────────────────────────────────────
        const validPrefixes = await getPrefixes(sock);
        const usedPrefix    = validPrefixes.find(p => text.startsWith(p));
        const isCmd         = !!usedPrefix;

        // ── BACKGROUND FEATURES ──────────────────────────────────────────────
        if (featAntideleteStore) {
            try {
                await featAntideleteStore(sock, msg, safeBotData);
            } catch (err) {
                console.error('[Antidelete Store Error]:', err.message);
            }
        }

        if (featFakeAudio && m.audioMessage)    featFakeAudio(sock, chatId, msg, safeBotData).catch(() => {});
        if (featAntiban)                        featAntiban(sock, msg, safeBotData).catch(() => {});
        if (featAntilink)                       featAntilink(sock, msg, safeBotData).catch(() => {});
        if (featAutotyping)                     featAutotyping(sock, chatId, msg, safeBotData).catch(() => {});
        if (featAntisticker)                    featAntisticker(sock, msg, safeBotData).catch(() => {});
        if (featAutoread)                       featAutoread(sock, msg, safeBotData).catch(() => {});

        

        if (featAutoReply && !isCmd) {
            featAutoReply(sock, msg, safeBotData).catch(() => {});
        }

        // ── NOT A COMMAND — STOP ───────────────────────────────────────────
        if (!isCmd) return;

        // ── PARSE COMMAND ──────────────────────────────────────────────────
        const body = text.slice(usedPrefix.length).trim();
        if (!body) return;

        const parts = body.split(/\s+/);
        const cmd   = parts[0].toLowerCase();
        const args  = parts.slice(1);

        // ── SENDER RESOLUTION ──────────────────────────────────────────────
        const isGroup = chatId?.endsWith('@g.us');
        let sender;
        if (isGroup) {
            sender = msg.key.participant || msg.key.remoteJid;
        } else if (fromMe) {
            sender = sock.user?.id || msg.key.remoteJid;
        } else {
            sender = msg.key.remoteJid;
        }

        console.log(`[${realSessionId}] .${cmd} <- ${cleanNum(sender)} [${isGroup ? 'GROUP' : 'DM'}]${fromMe ? ' [ME]' : ''}`);

   
        // ── MODE GATE ──────────────────────────────────────────────────────
        const mode = await getModeForSocket(sock);
        if (mode === 'private' && !fromMe) {
            const own = await isOwnerAsync(sock, sender, chatId, fromMe);
            if (!own) return;
        }

        // ── FIND COMMAND ───────────────────────────────────────────────────
        const command = commands.get(cmd);
        if (!command) return;

        // ── OWNER-ONLY GATE ────────────────────────────────────────────────
        if (command.category === 'owner' && !fromMe) {
            const own = await isOwnerAsync(sock, sender, chatId, fromMe);
            if (!own) {
                await sock.sendMessage(chatId, {
                    text: '*Owner Only!*\nThis command is restricted to the bot owner and sudo users.'
                }, { quoted: msg });
                return;
            }
        }

        // ── EXECUTE ────────────────────────────────────────────────────────
        const result = await command.execute(sock, msg, safeBotData, args);
        if (typeof result === 'string' && result.trim()) {
            await sock.sendMessage(chatId, { text: result }, { quoted: msg });
        }

    } catch (err) {
        const sid = getRealSessionId(sock) || '???';
        console.error(`[${sid}] Handler error:`, err.message);
        console.error(err.stack);
    }
}

// ── Handle protocol messages (deleted messages) ──────────────────────────────
async function handleProtocolMessage(sock, msg, botData) {
    try {
        if (antideleteRevocation) {
            await antideleteRevocation(sock, msg, botData);
        }
    } catch (err) {
        console.error('[Protocol Message Error]:', err.message);
    }
}

// ═══════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════
module.exports = {
    commands,
    handleIncomingMessage,
    handleProtocolMessage,
    attachBotDataToSocket,
    handleGroupParticipantUpdate: null,
    handleStatus: null,
    antideleteRevocation,
    clearMode,
    clearSessionState,
    
    clearPrefixCache,
    bustSudoCache,
    isSudo,
    getOwnerUserId,
    getOwnerJid,
    isPro
};