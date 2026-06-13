/**
 * commands/fakeaudio.js
 * .fakeaudio on/off — stored in database per user/session
 */
const fs   = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════
// Database helpers — per session storage
// ═══════════════════════════════════════════════════════════════

/** Ensure fakeaudio column exists in bot_settings table */
async function ensureColumn(db) {
    try {
        await db.query(
            `ALTER TABLE bot_settings ADD COLUMN IF NOT EXISTS fakeaudio TINYINT(1) DEFAULT 0`
        );
    } catch (err) {
        console.error('[fakeaudio] ensureColumn error:', err.message);
    }
}

/** Get fakeaudio state from database */
async function getState(db, sessionId) {
    try {
        if (!db || !sessionId) return false;
        await ensureColumn(db);
        
        const [rows] = await db.query(
            'SELECT fakeaudio FROM bot_settings WHERE session_id = ? LIMIT 1',
            [sessionId]
        );
        
        if (!rows.length) return false;
        return rows[0].fakeaudio === 1 || rows[0].fakeaudio === true;
    } catch (err) {
        console.error('[fakeaudio] getState error:', err.message);
        return false;
    }
}

/** Set fakeaudio state in database */
async function setState(db, sessionId, enabled) {
    try {
        if (!db || !sessionId) return;
        await ensureColumn(db);
        
        const val = enabled ? 1 : 0;
        
        await db.query(
            `INSERT INTO bot_settings (session_id, fakeaudio) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE fakeaudio = ?`,
            [sessionId, val, val]
        );
    } catch (err) {
        console.error('[fakeaudio] setState error:', err.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// Main command execute
// ═══════════════════════════════════════════════════════════════

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const db        = botData?.db;
    const sessionId = botData?.sessionId;

    if (!db || !sessionId) {
        await sock.sendMessage(chatId, {
            text: '⚠️ Database not connected. Cannot save settings.'
        }, { quoted: msg });
        return null;
    }

    const action = (args[0] || '').trim().toLowerCase();

    // ── Show current status ──
    if (!action || (action !== 'on' && action !== 'off')) {
        const cur = await getState(db, sessionId);
        const status = cur ? '🟢 ON' : '🔴 OFF';
        
        await sock.sendMessage(chatId, {
            text: `🎙️ *Fake Audio Recording*\n\nCurrent status: *${status}*\n\nUsage:\n*.fakeaudio on* — enable\n*.fakeaudio off* — disable\n\nWhen ON: if someone sends a voice note, the bot will show "recording audio…" for 8 seconds then go silent.`
        }, { quoted: msg });
        return null;
    }

    // ── Toggle on/off ──
    const enabled = action === 'on';
    await setState(db, sessionId, enabled);

    await sock.sendMessage(chatId, {
        text: enabled
            ? `✅ *Fake Audio Recording is now ON*\n\n🎙️ When anyone sends a voice note, I'll show "recording audio…" for 8 seconds and then go quiet.`
            : `❌ *Fake Audio Recording is now OFF*\n\nAudio messages will be handled normally.`
    }, { quoted: msg });

    return null;
}

// ═══════════════════════════════════════════════════════════════
// Trigger: called by index.js when audio/voice is detected
// ═══════════════════════════════════════════════════════════════

async function handleFakeAudio(sock, chatId, message, botData) {
    if (!botData?.db || !botData?.sessionId) return false;

    const enabled = await getState(botData.db, botData.sessionId);
    if (!enabled) return false;

    const m = message.message;
    if (!m || !m.audioMessage) return false;

    try {
        // Show "recording audio" presence for 8 seconds
        await sock.sendPresenceUpdate('recording', chatId);
        await new Promise(r => setTimeout(r, 8000));
        await sock.sendPresenceUpdate('paused', chatId);
    } catch (err) {
        console.error('[fakeaudio] handleFakeAudio error:', err.message);
    }

    return true;
}

module.exports = {
    name: 'fakeaudio',
    aliases: [],
    desc: 'Fake audio recording presence',
    category: 'owner',
    execute: execute,
    handleFakeAudio: handleFakeAudio,
    getState: getState,
    setState: setState
};