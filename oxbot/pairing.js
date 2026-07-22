/**
 * oxbot/pairing.js
 *
 * MATCHES botManager.js EXACTLY:
 * ─ browser: Browsers.windows('Chrome')  ← same as botManager
 * ─ markOnlineOnConnect: false
 * ─ keepAliveIntervalMs: 15_000
 * ─ defaultQueryTimeoutMs: 30_000
 * ─ connectTimeoutMs: 30_000
 * ─ retryRequestDelayMs: 1000
 *
 * DELIVERY DELAYS (reduces WA spam detection):
 * ─ 8s before sending session ID
 * ─ 3s between the two messages
 * ─ 3s before disconnecting
 */

const fs    = require('fs');
const path  = require('path');
const chalk = require('chalk');
const pino  = require('pino');
const NodeCache = require('node-cache');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers,
} = require('@whiskeysockets/baileys');

const db = require('./database');
const {
    pairingMap,
    activeSocks,
    activeBots,
} = require('./state');
const {
    addLog,
    normalisePhone,
    delay,
} = require('./utils');

const SESSION_DIR = path.join(__dirname, '..', 'sessions');

function cancelExistingPairings(phone, excludeRequestId) {
    for (const [id, e] of pairingMap) {
        if (id !== excludeRequestId && e.phone === phone && !['linked', 'error'].includes(e.status)) {
            console.log(chalk.yellow(`[PAIR CLEANUP] Cancelling ${id} for +${phone}`));
            e._reconnect = false;
            e.status     = 'error';
            e.error      = 'Superseded by a new pairing request.';
            if (e.sock) {
                try { e.sock.ws?.close(); } catch {}
                try { e.sock.end();       } catch {}
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PAIRING CODE FLOW
// ─────────────────────────────────────────────────────────────────────────────

async function startPairing(requestId, rawPhone, userId) {
    const entry = pairingMap.get(requestId);
    if (!entry) return;

    const phone         = normalisePhone(rawPhone);
    const sessionName   = 'oxbot_' + phone;
    const sessionFolder = path.join(SESSION_DIR, sessionName);

    cancelExistingPairings(phone, requestId);

    if (activeSocks.has(phone)) {
        try { activeSocks.get(phone).end(); } catch {}
        activeSocks.delete(phone);
    }

    if (activeBots.has(sessionName)) {
        const existing = activeBots.get(sessionName);
        try { existing.sock?.end(); } catch {}
        activeBots.delete(sessionName);
        global.botConnected = activeBots.size > 0;
    }

    // Wipe old session folder — fresh keys prevent stale Bad MAC errors
    if (fs.existsSync(sessionFolder)) {
        try { fs.rmSync(sessionFolder, { recursive: true, force: true }); } catch {}
    }
    fs.mkdirSync(sessionFolder, { recursive: true });

    entry.phone         = phone;
    entry.sessionName   = sessionName;
    entry.sessionFolder = sessionFolder;
    entry.status        = 'connecting';
    entry._reconnect    = true;
    entry._attempts     = 0;

    addLog(userId, `📱 Pairing code flow started for +${phone}`);

    async function connect() {
        const cur = pairingMap.get(requestId);
        if (!cur || ['linked', 'error'].includes(cur.status)) return;
        cur._attempts = (cur._attempts || 0) + 1;

        let deliveryStarted = false;

        try {
            const { version }          = await fetchLatestBaileysVersion();
            const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

            const sock = makeWASocket({
                version,
                logger:            pino({ level: 'silent' }),
                printQRInTerminal: false,

                // ★ Matches botManager.js exactly
                browser: Browsers.windows('Chrome'),

                auth: {
                    creds: state.creds,
                    keys:  makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
                },

                markOnlineOnConnect:            false,
                generateHighQualityLinkPreview: false,
                syncFullHistory:                false,
                downloadHistory:                false,
                shouldSyncHistoryMessage:       () => false,
                getMessage:                     async () => undefined,
                msgRetryCounterCache:           new NodeCache({ stdTTL: 300, checkperiod: 60 }),
                keepAliveIntervalMs:            15_000,
                defaultQueryTimeoutMs:          30_000,
                connectTimeoutMs:               30_000,
                retryRequestDelayMs:            1000,
                emitOwnEvents:                  false,
            });

            cur.sock = sock;
            activeSocks.set(phone, sock);
            sock.ev.on('creds.update', saveCreds);

            // Request pairing code once socket is open and unregistered
            if (!sock.authState.creds.registered) {
                (async () => {
                    await delay(2000);
                    const e = pairingMap.get(requestId);
                    if (!e || ['linked', 'error'].includes(e.status)) return;

                    addLog(userId, '🔄 Requesting pairing code...');
                    try {
                        const rawCode = await sock.requestPairingCode(phone.replace(/[^0-9]/g, ''));
                        const code    = rawCode?.match(/.{1,4}/g)?.join('-') || rawCode;
                        const e2      = pairingMap.get(requestId);
                        if (e2 && !['linked', 'error'].includes(e2.status)) {
                            e2.status = 'code_ready';
                            e2.code   = code;
                            addLog(userId, `📲 Pairing code ready: ${code}`);
                        }
                    } catch (codeErr) {
                        const e2 = pairingMap.get(requestId);
                        if (!e2 || ['linked', 'error'].includes(e2.status)) return;
                        addLog(userId, `⚠️ Code request failed: ${codeErr.message} — retrying in 3s...`);
                        await delay(3000);
                        try {
                            const rawCode2 = await sock.requestPairingCode(phone.replace(/[^0-9]/g, ''));
                            const code2    = rawCode2?.match(/.{1,4}/g)?.join('-') || rawCode2;
                            const e3       = pairingMap.get(requestId);
                            if (e3 && !['linked', 'error'].includes(e3.status)) {
                                e3.status = 'code_ready';
                                e3.code   = code2;
                                addLog(userId, `📲 Pairing code ready (retry): ${code2}`);
                            }
                        } catch (retryErr) {
                            const e3 = pairingMap.get(requestId);
                            if (e3 && !['linked', 'error'].includes(e3.status)) {
                                e3.status = 'error';
                                e3.error  = 'Failed to get code: ' + retryErr.message;
                                addLog(userId, '❌ Code request failed twice. Try again.');
                            }
                        }
                    }
                })();
            }

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    if (deliveryStarted) return;
                    deliveryStarted = true;

                    const curNow = pairingMap.get(requestId);
                    if (!curNow) return;

                    await saveCreds();

                    const waName   = sock.user?.name || sock.user?.verifiedName || sock.user?.notify || 'Unknown';
                    const waNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : phone;

                    addLog(userId, `✅ WhatsApp linked! Account: ${waName} (+${waNumber})`);
                    curNow.waName   = waName;
                    curNow.waNumber = waNumber;
                    activeSocks.delete(phone);
                    curNow.status = 'linked';

                    await deliverSession(sock, phone, sessionFolder, sessionName, userId, curNow);
                }

                if (connection === 'close' && cur.status !== 'linked') {
                    const sc  = lastDisconnect?.error?.output?.statusCode;
                    const msg = lastDisconnect?.error?.message || 'unknown';

                    addLog(userId, `⚠️ Connection closed (code: ${sc ?? 'none'})`);

                    if (sc === 408 && cur._reconnect && !['linked', 'error'].includes(cur.status)) {
                        if ((cur._attempts || 0) >= 5) {
                            cur.status = 'error';
                            cur.error  = 'Pairing failed after multiple attempts. Try again.';
                            addLog(userId, '❌ Max pairing attempts reached.');
                            activeSocks.delete(phone);
                            try { sock.ws?.close(); } catch {}
                            try { sock.end();       } catch {}
                            return;
                        }

                        const isNetworkErr =
                            msg.includes('ENOTFOUND') || msg.includes('ECONNRESET') ||
                            msg.includes('ETIMEDOUT') || msg.includes('WebSocket Error') ||
                            msg.includes('Connection was lost');

                        activeSocks.delete(phone);
                        try { sock.ws?.close(); } catch {}
                        try { sock.end();       } catch {}

                        if (isNetworkErr) {
                            addLog(userId, `🔄 Network error, waiting 8s...`);
                            await delay(8000);
                        } else {
                            addLog(userId, `🔄 Pairing window expired, starting fresh...`);
                            try { fs.rmSync(sessionFolder, { recursive: true, force: true }); } catch {}
                            fs.mkdirSync(sessionFolder, { recursive: true });
                            await delay(3000);
                        }
                        connect();
                        return;
                    }

                    if ((sc === 515 || sc === 428 || sc === 503) && cur._reconnect && !['linked', 'error'].includes(cur.status)) {
                        addLog(userId, `🔄 Temporary error ${sc}, reconnecting in 3s...`);
                        activeSocks.delete(phone);
                        try { sock.ws?.close(); } catch {}
                        try { sock.end();       } catch {}
                        await delay(3000);
                        connect();
                        return;
                    }

                    const fatal = sc === DisconnectReason.loggedOut || sc === 403 || sc === 401;
                    if (!fatal && cur._reconnect && !['linked', 'error'].includes(cur.status)) {
                        addLog(userId, `🔄 Reconnecting in 5s... (code: ${sc})`);
                        activeSocks.delete(phone);
                        try { sock.ws?.close(); } catch {}
                        try { sock.end();       } catch {}
                        await delay(5000);
                        connect();
                        return;
                    }

                    cur.status = 'error';
                    cur.error  = sc === 403
                        ? 'Too many linked devices — unlink one in WhatsApp first.'
                        : sc === 401
                        ? 'Session rejected. Try pairing again.'
                        : `Connection failed (code: ${sc ?? 'unknown'})`;
                    addLog(userId, `❌ ${cur.error}`);
                    activeSocks.delete(phone);
                    try { sock.ws?.close(); } catch {}
                    try { sock.end();       } catch {}
                }
            });

            // 8 min timeout
            setTimeout(() => {
                const e = pairingMap.get(requestId);
                if (e && !['linked', 'error'].includes(e.status)) {
                    e._reconnect = false;
                    e.status     = 'error';
                    e.error      = 'Timed out — 8 minutes exceeded. Try again.';
                    addLog(userId, '⏱️ Pairing timed out after 8 minutes');
                    activeSocks.delete(phone);
                    try { sock.end(); } catch {}
                }
            }, 8 * 60 * 1000);

        } catch (err) {
            const e = pairingMap.get(requestId);
            if (e && e._reconnect && !['linked', 'error'].includes(e.status)) {
                addLog(userId, `⚠️ Connection error: ${err.message} — retrying in 5s...`);
                await delay(5000);
                connect();
                return;
            }
            if (e) { e.status = 'error'; e.error = err.message; }
            addLog(userId, `❌ Fatal pairing error: ${err.message}`);
            activeBots.delete(sessionName);
            activeSocks.delete(phone);
        }
    }

    connect();
}

// ─────────────────────────────────────────────────────────────────────────────
// QR PAIRING FLOW
// ─────────────────────────────────────────────────────────────────────────────

async function startQRPairing(requestId, rawPhone, userId) {
    const entry = pairingMap.get(requestId);
    if (!entry) return;

    const phone         = normalisePhone(rawPhone);
    const sessionName   = 'oxbot_' + phone;
    const sessionFolder = path.join(SESSION_DIR, sessionName);

    cancelExistingPairings(phone, requestId);

    if (activeSocks.has(phone)) {
        try { activeSocks.get(phone).end(); } catch {}
        activeSocks.delete(phone);
    }
    if (activeBots.has(sessionName)) {
        const existing = activeBots.get(sessionName);
        try { existing.sock?.end(); } catch {}
        activeBots.delete(sessionName);
        global.botConnected = activeBots.size > 0;
    }

    if (fs.existsSync(sessionFolder)) {
        try { fs.rmSync(sessionFolder, { recursive: true, force: true }); } catch {}
    }
    fs.mkdirSync(sessionFolder, { recursive: true });

    entry.phone         = phone;
    entry.sessionName   = sessionName;
    entry.sessionFolder = sessionFolder;
    entry.status        = 'connecting';
    entry._reconnect    = true;

    addLog(userId, `📷 QR pairing started for +${phone}`);

    async function connect() {
        const cur = pairingMap.get(requestId);
        if (!cur || ['linked', 'error'].includes(cur.status)) return;

        let deliveryStarted = false;

        try {
            const { version }          = await fetchLatestBaileysVersion();
            const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

            const sock = makeWASocket({
                version,
                logger:            pino({ level: 'silent' }),
                printQRInTerminal: false,

                // ★ Matches botManager.js exactly
                browser: Browsers.windows('Chrome'),

                auth: {
                    creds: state.creds,
                    keys:  makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
                },

                markOnlineOnConnect:            false,
                generateHighQualityLinkPreview: false,
                syncFullHistory:                false,
                downloadHistory:                false,
                shouldSyncHistoryMessage:       () => false,
                getMessage:                     async () => undefined,
                msgRetryCounterCache:           new NodeCache({ stdTTL: 300, checkperiod: 60 }),
                keepAliveIntervalMs:            15_000,
                defaultQueryTimeoutMs:          30_000,
                connectTimeoutMs:               30_000,
                retryRequestDelayMs:            1000,
                emitOwnEvents:                  false,
            });

            cur.sock = sock;
            activeSocks.set(phone, sock);
            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    cur.status = 'qr_ready';
                    cur.qr     = qr;
                    addLog(userId, '📷 QR code ready — scan now');
                }

                if (connection === 'open') {
                    if (deliveryStarted) return;
                    deliveryStarted = true;

                    const curNow = pairingMap.get(requestId);
                    if (!curNow) return;

                    await saveCreds();

                    const waName   = sock.user?.name || sock.user?.verifiedName || sock.user?.notify || 'Unknown';
                    const waNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : phone;

                    addLog(userId, `✅ QR linked! Account: ${waName}`);
                    curNow.waName   = waName;
                    curNow.waNumber = waNumber;
                    activeSocks.delete(phone);
                    curNow.status = 'linked';

                    await deliverSession(sock, phone, sessionFolder, sessionName, userId, curNow);
                }

                if (connection === 'close' && cur.status !== 'linked') {
                    const sc = lastDisconnect?.error?.output?.statusCode;
                    addLog(userId, `⚠️ QR connection closed (code: ${sc ?? 'none'})`);

                    if ((sc === 515 || sc === 428) && cur._reconnect && !['linked', 'error'].includes(cur.status)) {
                        activeSocks.delete(phone);
                        try { sock.ws?.close(); } catch {}
                        try { sock.end();       } catch {}
                        await delay(3000);
                        connect();
                        return;
                    }

                    const fatal = sc === DisconnectReason.loggedOut || sc === 403;
                    if (!fatal && cur._reconnect && !['linked', 'error'].includes(cur.status)) {
                        activeSocks.delete(phone);
                        try { sock.ws?.close(); } catch {}
                        try { sock.end();       } catch {}
                        await delay(5000);
                        connect();
                        return;
                    }

                    cur.status = 'error';
                    cur.error  = `QR connection failed (code: ${sc ?? 'unknown'})`;
                    addLog(userId, `❌ QR pairing failed`);
                    activeSocks.delete(phone);
                    try { sock.ws?.close(); } catch {}
                    try { sock.end();       } catch {}
                }
            });

            // 3 min QR timeout
            setTimeout(() => {
                const e = pairingMap.get(requestId);
                if (e && !['linked', 'error'].includes(e.status)) {
                    e._reconnect = false;
                    e.status     = 'error';
                    e.error      = 'QR timed out. Generate a new one.';
                    addLog(userId, '⏱️ QR timed out after 3 minutes');
                    activeSocks.delete(phone);
                    try { sock.end(); } catch {}
                }
            }, 3 * 60 * 1000);

        } catch (err) {
            const e = pairingMap.get(requestId);
            if (e && e._reconnect && !['linked', 'error'].includes(e.status)) {
                await delay(5000);
                connect();
                return;
            }
            if (e) { e.status = 'error'; e.error = err.message; }
            addLog(userId, `❌ QR error: ${err.message}`);
            activeSocks.delete(phone);
        }
    }

    connect();
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION DELIVERY
// ─────────────────────────────────────────────────────────────────────────────

async function deliverSession(sock, phone, sessionFolder, sessionName, userId, cur) {
    try {
        addLog(userId, `📦 Preparing session delivery for ${sessionName}...`);

        const credsPath = path.join(sessionFolder, 'creds.json');

        // Wait up to 20s for creds.json to be fully written with registered=true
        let credsContent = null;
        let registered   = false;

        for (let i = 0; i < 40; i++) {
            if (fs.existsSync(credsPath)) {
                try {
                    const raw    = fs.readFileSync(credsPath, 'utf8');
                    const parsed = JSON.parse(raw);
                    if (parsed.registered && parsed.me?.id) {
                        credsContent = raw;
                        registered   = true;
                        break;
                    }
                } catch {}
            }
            await delay(500);
        }

        if (!registered) {
            addLog(userId, '⚠️ Registration not complete after 20s, using current credentials...');
            if (fs.existsSync(credsPath)) {
                try { credsContent = fs.readFileSync(credsPath, 'utf8'); } catch {}
            }
        }

        if (!credsContent) {
            addLog(userId, '❌ Fatal: creds.json missing. Re-pair device.');
            return;
        }

        const b64         = Buffer.from(credsContent).toString('base64');
        const fullSession = sessionName + '::::' + b64;

        if (cur) {
            cur.fullSession = fullSession;
            cur.waName      = sock.user?.name || sock.user?.verifiedName || sock.user?.notify || 'Unknown';
            cur.waNumber    = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : phone;
        }

        addLog(userId, `✅ Session string built (${fullSession.length} chars)`);

        // Save to paired_sessions — bots table only touched via Add Bot
        const waName   = sock.user?.name || sock.user?.verifiedName || sock.user?.notify || 'Unknown';
        const waNumber = sock.user?.id
            ? sock.user.id.split(':')[0].split('@')[0]
            : String(phone).replace(/\D/g, '');

        try {
            await db.query(
                `INSERT INTO paired_sessions
                 (user_id, session_id, session_name, phone, whatsapp_name, whatsapp_number, session_data, status)
                 VALUES (?,?,?,?,?,?,?,'paired')
                 ON DUPLICATE KEY UPDATE
                   whatsapp_name   = VALUES(whatsapp_name),
                   whatsapp_number = VALUES(whatsapp_number),
                   session_data    = VALUES(session_data),
                   status          = 'paired'`,
                [userId, sessionName, sessionName, phone, waName, waNumber, fullSession]
            );
            addLog(userId, `💾 Session saved to paired_sessions.`);
        } catch (dbErr) {
            addLog(userId, `⚠️ DB save warning: ${dbErr.message}`);
        }

        // Wait 8s before sending — instant message on fresh session = spam flag
        addLog(userId, `⏳ Waiting 8s before sending session ID...`);
        await delay(8000);

        let targetNum = String(phone).replace(/[^0-9]/g, '');
        if (targetNum.startsWith('0')) targetNum = '234' + targetNum.slice(1);
        const jid = targetNum + '@s.whatsapp.net';

        addLog(userId, `📤 Sending session ID to ${jid}...`);

        let sent = false;
        for (let attempt = 1; attempt <= 5; attempt++) {
            try {
                addLog(userId, `📨 Delivery attempt ${attempt}/5...`);
                await sock.sendMessage(jid, { text: fullSession });

                // Wait between messages — rapid fire = spam flag
                await delay(3000);

                await sock.sendMessage(jid, {
                    text:
                        `⚠️ *Do not share this session ID with anyone.*\n\n` +
                        `1. Copy the ID above.\n` +
                        `2. Go to Dashboard > Add Bot.\n` +
                        `3. Paste it to activate your bot.`,
                });

                addLog(userId, `✅ Session ID delivered!`);
                sent = true;
                break;
            } catch (sendErr) {
                addLog(userId, `⚠️ Attempt ${attempt} failed: ${sendErr.message}`);
                if (attempt < 5) await delay(3000 * attempt);
            }
        }

        if (!sent) {
            addLog(userId, `⚠️ Delivery failed after 5 attempts.`);
        } else {
            addLog(userId, `🎉 Pairing complete. Go to Dashboard > Add Bot to activate.`);
        }

        // Wait before closing — abrupt disconnect = spam flag
        addLog(userId, `🔌 Disconnecting pairing socket...`);
        await delay(3000);
        try { sock.ws?.close(); } catch {}
        await delay(500);
        try { sock.end();       } catch {}

        activeBots.delete(sessionName);
        activeSocks.delete(phone);

    } catch (err) {
        addLog(userId, `❌ deliverSession error: ${err.message}`);
        console.error('[DELIVER SESSION]', err);
    }
}

module.exports = {
    cancelExistingPairings,
    startPairing,
    startQRPairing,
    deliverSession,
};
