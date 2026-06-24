/**
 * @file oxbot/pairing.js
 * @description WhatsApp pairing engine.
 * 
 * LOGIC UPDATE:
 * - Pairing ONLY saves to 'paired_sessions' and sends ID to DM.
 * - It does NOT add to 'bots' table.
 * - Bot only becomes active when the "Add Bot" API manually inserts into 'bots' table.
 */

const fs   = require('fs');
const path = require('path');
const chalk = require('chalk');
const pino = require('pino');
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
    activeBots
} = require('./state');
const {
    addLog,
    normalisePhone,
    patchCredsIfNeeded,
    delay
} = require('./utils');


const SESSION_DIR = path.join(__dirname, '..', 'sessions');

function cancelExistingPairings(phone, excludeRequestId) {
    for (const [id, e] of pairingMap) {
        if (id !== excludeRequestId && e.phone === phone && !['linked', 'error'].includes(e.status)) {
            console.log(chalk.yellow(`[PAIR CLEANUP] Cancelling existing pairing request ${id} for +${phone}`));
            e._reconnect = false;
            e.status     = 'error';
            e.error      = 'Superceded by a new pairing request.';
            if (e.sock) {
                try { e.sock.ws?.close(); } catch {}
                try { e.sock.end(); } catch {}
            }
        }
    }
}

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
 
    if (fs.existsSync(sessionFolder)) {
        try {
            fs.rmSync(sessionFolder, { recursive: true, force: true });
            console.log(chalk.gray(`[PAIR] Wiped old session: ${sessionName}`));
        } catch (err) {
            console.error(chalk.red('[PAIR WIPE]'), err.message);
        }
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
 
        let pairingCodeRequested = false;
        let deliveryStarted      = false;
 
        try {
            const { version } = await fetchLatestBaileysVersion();
            const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

            const sock = makeWASocket({
                version,
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                // CHANGED: Using Windows Chrome instead of Ubuntu
                browser: Browsers.windows('Chrome'),
                auth: {
                    creds: state.creds,
                    keys:  makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
                },
                markOnlineOnConnect:            false,
                generateHighQualityLinkPreview: false,
                syncFullHistory:                false,
                getMessage:                     async () => undefined,
                msgRetryCounterCache:           new NodeCache({ stdTTL: 300, checkperiod: 60 }),
                keepAliveIntervalMs:            20_000,
                defaultQueryTimeoutMs:          60_000,
                connectTimeoutMs:               60_000,
                retryRequestDelayMs:            2000,
                emitOwnEvents:                  false,
            });
 
            cur.sock = sock;
            activeSocks.set(phone, sock);
            sock.ev.on('creds.update', saveCreds);

            if (!sock.authState.creds.registered) {
                (async () => {
                    await delay(2000);
                    const e = pairingMap.get(requestId);
                    if (!e || ['linked', 'error'].includes(e.status)) return;

                    addLog(userId, '🔄 Requesting pairing code...');
                    try {
                        const rawCode = await sock.requestPairingCode(
                            phone.replace(/[^0-9]/g, '')
                        );
                        const code = rawCode?.match(/.{1,4}/g)?.join('-') || rawCode;
                        const e2 = pairingMap.get(requestId);
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
                            const rawCode2 = await sock.requestPairingCode(
                                phone.replace(/[^0-9]/g, '')
                            );
                            const code2 = rawCode2?.match(/.{1,4}/g)?.join('-') || rawCode2;
                            const e3 = pairingMap.get(requestId);
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
                const { connection, lastDisconnect, qr } = update;
 
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
 
                    addLog(userId, `⚠️ Connection closed during pairing (code: ${sc ?? 'none'}, msg: ${msg})`);

                    if (sc === 408 && cur._reconnect && !['linked', 'error'].includes(cur.status)) {
                        const isNetworkError = msg.includes('ENOTFOUND') ||
                                               msg.includes('Connection was lost') ||
                                               msg.includes('WebSocket Error') ||
                                               msg.includes('ECONNRESET') ||
                                               msg.includes('ETIMEDOUT');

                        if ((cur._attempts || 0) >= 5) {
                            cur.status = 'error';
                            cur.error  = 'Pairing failed after multiple attempts. Check your internet and try again.';
                            addLog(userId, '❌ Max pairing attempts reached. Try again.');
                            activeSocks.delete(phone);
                            try { sock.ws?.close(); } catch {}
                            try { sock.end(); } catch {}
                            return;
                        }

                        if (isNetworkError) {
                            addLog(userId, `🔄 Network error, waiting 8s before reconnect...`);
                            activeSocks.delete(phone);
                            try { sock.ws?.close(); } catch {}
                            try { sock.end(); } catch {}
                            await delay(8000);
                            connect();
                            return;
                        } else {
                            addLog(userId, `🔄 Pairing window expired, starting fresh connection...`);
                            activeSocks.delete(phone);
                            try { sock.ws?.close(); } catch {}
                            try { sock.end(); } catch {}
                            try { fs.rmSync(sessionFolder, { recursive: true, force: true }); } catch {}
                            fs.mkdirSync(sessionFolder, { recursive: true });
                            await delay(3000);
                            connect();
                            return;
                        }
                    }

                    if ((sc === 515 || sc === 428 || sc === 503) && 
                        cur._reconnect && 
                        !['linked', 'error'].includes(cur.status)) {
                        addLog(userId, `🔄 Temporary error ${sc}, reconnecting in 3s...`);
                        activeSocks.delete(phone);
                        try { sock.ws?.close(); } catch {}
                        try { sock.end(); } catch {}
                        await delay(3000);
                        connect();
                        return;
                    }
 
                    const fatal = (sc === DisconnectReason.loggedOut || sc === 403 || sc === 401);
                    if (!fatal && cur._reconnect && !['linked', 'error'].includes(cur.status)) {
                        addLog(userId, `🔄 Reconnecting in 5s... (code: ${sc})`);
                        activeSocks.delete(phone);
                        try { sock.ws?.close(); } catch {}
                        try { sock.end(); } catch {}
                        await delay(5000);
                        connect();
                        return;
                    }
 
                    const errMsg = sc === 403
                        ? 'Too many linked devices — unlink one in WhatsApp first.'
                        : sc === 401
                        ? 'Session rejected. Try pairing again.'
                        : `Connection failed (code: ${sc ?? 'unknown'})`;
 
                    cur.status = 'error';
                    cur.error  = errMsg;
                    addLog(userId, `❌ ${errMsg}`);
                    activeSocks.delete(phone);
                    try { sock.ws?.close(); } catch {}
                    try { sock.end(); } catch {}
                }
            });
 
            setTimeout(() => {
                const e = pairingMap.get(requestId);
                if (e && !['linked', 'error'].includes(e.status)) {
                    e._reconnect = false;
                    e.status     = 'error';
                    e.error      = 'Timed out — you have 8 minutes to enter the code. Try again.';
                    addLog(userId, '⏱️ Pairing timed out after 8 minutes');
                    activeSocks.delete(phone);
                    try { sock.end(); } catch {}
                }
            }, 8 * 60 * 1000);
 
        } catch (err) {
            const e = pairingMap.get(requestId);
            if (e && e._reconnect && !['linked', 'error'].includes(e.status)) {
                addLog(userId, `⚠️ Connection error: ${err.message} — retrying in 5s...`);
                console.error(chalk.red('[PAIR CRASH]'), err.message);
                await delay(5000);
                connect();
                return;
            }
            if (e) {
                e.status = 'error';
                e.error  = err.message;
            }
            addLog(userId, `❌ Fatal pairing error: ${err.message}`);
            activeBots.delete(sessionName);
            activeSocks.delete(phone);
        }
    }
 
    connect();
}

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
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                // CHANGED: Using Windows Chrome instead of Ubuntu
                browser: Browsers.windows('Chrome'),
                auth: {
                    creds: state.creds,
                    keys:  makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
                },
                markOnlineOnConnect:            false,
                generateHighQualityLinkPreview: false,
                syncFullHistory:                false,
                getMessage:                     async () => undefined,
                msgRetryCounterCache:           new NodeCache({ stdTTL: 300, checkperiod: 60 }),
                keepAliveIntervalMs:            20_000,
                defaultQueryTimeoutMs:          60_000,
                connectTimeoutMs:               60_000,
                retryRequestDelayMs:            2000,
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
 
                if (connection === 'connecting') {
                    addLog(userId, '🔄 Connecting...');
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
                    const sc  = lastDisconnect?.error?.output?.statusCode;
                    addLog(userId, `⚠️ QR connection closed (code: ${sc ?? 'none'})`);
                    console.log(chalk.blue(`[DEBUG QR CLOSE] requestId: ${requestId}, sc: ${sc}, cur._reconnect: ${cur._reconnect}, cur.status: ${cur.status}`));
 
                    if ((sc === 515 || sc === 428) && cur._reconnect && !['linked','error'].includes(cur.status)) {
                        console.log(chalk.green(`[DEBUG QR CLOSE] Match temporary error 515/428. Reconnecting...`));
                        activeSocks.delete(phone);
                        try { sock.ws?.close(); } catch {}
                        try { sock.end(); } catch {}
                        await delay(3000);
                        connect();
                        return;
                    }
                    const fatal = (sc === DisconnectReason.loggedOut || sc === 403);
                    if (!fatal && cur._reconnect && !['linked','error'].includes(cur.status)) {
                        console.log(chalk.green(`[DEBUG QR CLOSE] Match non-fatal error. Reconnecting...`));
                        activeSocks.delete(phone);
                        try { sock.ws?.close(); } catch {}
                        try { sock.end(); } catch {}
                        await delay(5000);
                        connect();
                        return;
                    }
 
                    console.log(chalk.red(`[DEBUG QR CLOSE] Reconnection skipped. Setting status to error.`));
                    cur.status = 'error';
                    cur.error  = `QR connection failed (code: ${sc ?? 'unknown'})`;
                    addLog(userId, `❌ QR pairing failed`);
                    activeSocks.delete(phone);
                    try { sock.ws?.close(); } catch {}
                    try { sock.end(); } catch {}
                }
            });
 
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
            if (e && e._reconnect && !['linked','error'].includes(e.status)) {
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

async function deliverSession(sock, phone, sessionFolder, sessionName, userId, cur) {
    try {
        const path = require('path');
        const fs   = require('fs');
 
        addLog(userId, `📦 Preparing session delivery for ${sessionName}...`);
 
        // ── STEP 1: WAIT FOR HANDSHAKE & READ CREDS ───────────────────────────
        const credsPath = path.join(sessionFolder, 'creds.json');
 
        let credsContent = null;
        let registered = false;
        
        for (let i = 0; i < 40; i++) {
            if (fs.existsSync(credsPath)) {
                try {
                    const raw = fs.readFileSync(credsPath, 'utf8');
                    const parsed = JSON.parse(raw);
                    if (parsed.registered && parsed.me?.id) {
                        credsContent = raw;
                        registered = true;
                        break;
                    }
                } catch {}
            }
            await delay(500);
        }
 
        if (!registered) {
            addLog(userId, '⚠️ Registration handshake not complete after 20s. Fetching current credentials...');
            if (fs.existsSync(credsPath)) {
                try {
                    credsContent = fs.readFileSync(credsPath, 'utf8');
                } catch (err) {
                    addLog(userId, `❌ Error reading credentials: ${err.message}`);
                }
            }
        }
 
        if (!credsContent) {
            addLog(userId, '❌ Fatal: creds.json missing. Re-pair device.');
            return;
        }
 
        // ── STEP 2: BUILD FULL SESSION STRING ───────────────────────────────────
        const b64         = Buffer.from(credsContent).toString('base64');
        const fullSession = sessionName + '::::' + b64;
 
        if (cur) {
            cur.fullSession = fullSession;
            cur.waName      = sock.user?.name || sock.user?.verifiedName || sock.user?.notify || 'Unknown';
            cur.waNumber    = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : phone;
        }
 
        addLog(userId, `✅ Session string built (${fullSession.length} chars)`);
 
        // ── STEP 3: SAVE TO DB (BACKUP ONLY) ─────────────────────────────────
        const waName   = sock.user?.name || sock.user?.verifiedName || sock.user?.notify || 'Unknown';
        const waNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : String(phone).replace(/\D/g,'');
 
        try {
            // ONLY SAVE TO 'paired_sessions' TABLE.
            // WE DO NOT TOUCH 'bots' TABLE. 
            // The 'bots' table is ONLY touched when the user manually clicks "Add Bot".
            await db.query(
                `INSERT INTO paired_sessions
                 (user_id, session_id, session_name, phone, whatsapp_name, whatsapp_number, session_data, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'paired')
                 ON DUPLICATE KEY UPDATE
                   whatsapp_name   = VALUES(whatsapp_name),
                   whatsapp_number = VALUES(whatsapp_number),
                   session_data    = VALUES(session_data),
                   status          = 'paired'`,
                [userId, sessionName, sessionName, phone, waName, waNumber, fullSession]
            );
 
            addLog(userId, `💾 Session saved to 'paired_sessions' (History only).`);
        } catch (dbErr) {
            addLog(userId, `⚠️ DB save warning: ${dbErr.message}`);
        }
 
        // ── STEP 4: SEND SESSION ID TO USER'S WHATSAPP DM ─────────────────────
        let targetNum = String(phone).replace(/[^0-9]/g, '');
        if (targetNum.startsWith('0')) targetNum = '234' + targetNum.slice(1);
        const jid = targetNum + '@s.whatsapp.net';
 
        addLog(userId, `📤 Sending session ID to ${jid}...`);
 
        await delay(4000);
 
        let sent = false;
        const MAX_ATTEMPTS = 5;
 
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                addLog(userId, `📨 Delivery attempt ${attempt}/${MAX_ATTEMPTS}...`);
 
                await sock.sendMessage(jid, { text: fullSession });
                await delay(1500);
                const instructions = `⚠️ *Do not share this session ID with anyone.*\n\n1. Copy the ID above.\n2. Go to Dashboard > Add Bot.\n3. Paste it to activate your bot.`;
                await sock.sendMessage(jid, { text: instructions });
 
                addLog(userId, `✅ Session ID delivered successfully!`);
                sent = true;
                break;
            } catch (sendErr) {
                addLog(userId, `⚠️ Attempt ${attempt} failed: ${sendErr.message}`);
                if (attempt < MAX_ATTEMPTS) {
                    const waitMs = 3000 * attempt;
                    addLog(userId, `⏳ Waiting ${waitMs/1000}s before retry...`);
                    await delay(waitMs);
                }
            }
        }
 
        if (!sent) {
            addLog(userId, `⚠️ WhatsApp delivery failed.`);
        } else {
            addLog(userId, `🎉 Pairing complete. Waiting for manual activation.`);
        }
 
        // ── STEP 5: DISCONNECT IMMEDIATELY ────────────────────────────────────
        // Since we did not add to 'bots' table, bot.js will not pick this up.
        // We must disconnect to prevent the pairing socket from staying open.
        addLog(userId, `🔌 Disconnecting pairing socket...`);
        await delay(2000);
        try { sock.ws?.close(); } catch {}
        try { sock.end(); } catch {}
        
        // Remove from memory just in case
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
    deliverSession
};
