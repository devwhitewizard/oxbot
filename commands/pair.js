/**
 * commands/pair.js
 * 100% Standalone - Free - 1-Tap Copyable Code
 */

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    Browsers
} = require('@whiskeysockets/baileys');

const activePairingSockets = new Map();

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const senderId = msg.key.participant || msg.key.remoteJid;
    const senderDm = senderId.includes('@g.us') ? `${senderId.split('@')[0]}@s.whatsapp.net` : senderId;

    // ── 1. Validate Number ───────────────────────────────────────────────
    const rawNumber = args[0];
    if (!rawNumber) {
        return await sock.sendMessage(chatId, {
            text: '❌ Please provide a phone number.\n\n*Usage:* *.pair 2348012345678*'
        }, { quoted: msg });
    }

    const number = rawNumber.replace(/[^0-9]/g, '');
    if (number.length < 10 || number.length > 15) {
        return await sock.sendMessage(chatId, {
            text: '❌ *Invalid number.* Must be 10-15 digits with country code.'
        }, { quoted: msg });
    }

    // ── 2. Prevent duplicates ─────────────────────────────────────────────
    if (activePairingSockets.has(number)) {
        return await sock.sendMessage(chatId, {
            text: '⏳ *Pairing already in progress for this number.*'
        }, { quoted: msg });
    }

    // Tell user to check DM
    if (senderDm !== chatId) {
        await sock.sendMessage(chatId, {
            text: '⏳ *Generating code...*\n_Check your **DM**._'
        }, { quoted: msg });
    }

    try {
        // ── 3. Setup Temp Session ─────────────────────────────────────────
        const tempDir = path.join(process.cwd(), 'temp_pairing', number);
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });

        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState(tempDir);

        // ── 4. Create Socket ──────────────────────────────────────────────
        const tempSock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: Browsers.windows('Chrome'),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
            },
            markOnlineOnConnect: false
        });

        tempSock.ev.on('creds.update', saveCreds);
        activePairingSockets.set(number, tempSock);

        // ── 5. Request Code ───────────────────────────────────────────────
        if (!tempSock.authState.creds.registered) {
            setTimeout(async () => {
                if (!activePairingSockets.has(number)) return;
                try {
                    const rawCode = await tempSock.requestPairingCode(number);
                    const formattedCode = rawCode?.match(/.{1,4}/g)?.join('-') || rawCode;

                    // ★ MESSAGE 1: SEND ONLY THE CODE (1-Tap Copyable) ★
                    await sock.sendMessage(senderDm, { text: formattedCode });
                    
                    // Small delay so WhatsApp doesn't merge them
                    await new Promise(r => setTimeout(r, 1000));

                    // ★ MESSAGE 2: SEND INSTRUCTIONS ★
                    await sock.sendMessage(senderDm, {
                        text: `
📲 *LINKING STEPS:*

1. Open WhatsApp > Linked Devices
2. Tap *Link a device*
3. Select *Link with phone number instead*
4. Enter number: *+${number}*
5. Paste the code above.

⏳ _Waiting for you to link..._
                        `.trim()
                    });

                } catch (err) {
                    await sock.sendMessage(senderDm, { text: `❌ *Failed to get code:* ${err.message}` });
                    cleanupPairing(number, tempSock, tempDir);
                }
            }, 2000);
        }

        // ── 6. Wait for Link & Send Session ID ────────────────────────────
        tempSock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                await sock.sendMessage(senderDm, { text: '✅ *Linked!*\n_Generating Session ID..._' });
                
                if (senderDm !== chatId) {
                    await sock.sendMessage(chatId, { text: '✅ *Linked!* Sending Session ID to DM.' });
                }

                try {
                    await saveCreds();
                    const credsPath = path.join(tempDir, 'creds.json');

                    let credsContent = null;
                    for (let i = 0; i < 20; i++) {
                        if (fs.existsSync(credsPath)) {
                            const parsed = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                            if (parsed.registered) {
                                credsContent = fs.readFileSync(credsPath, 'utf8');
                                break;
                            }
                        }
                        await new Promise(r => setTimeout(r, 500));
                    }

                    if (credsContent) {
                        const b64 = Buffer.from(credsContent).toString('base64');
                        const sessionId = `oxbot_${number}`;
                        const fullSession = `${sessionId}::::${b64}`;

                        await new Promise(r => setTimeout(r, 5000));

                        // Send Session ID
                        await sock.sendMessage(senderDm, { text: fullSession });
                        
                        await new Promise(r => setTimeout(r, 3000));

                        // Send Instructions
                        await sock.sendMessage(senderDm, {
                            text: `⚠️ *Copy the text above and paste it in Dashboard > Add Bot to activate.*`
                        });

                        if (senderDm !== chatId) {
                            await sock.sendMessage(chatId, { text: '✅ *Session ID delivered!*' });
                        }
                    }
                } catch (err) {
                    console.error('[Pair Delivery Error]', err);
                }

                cleanupPairing(number, tempSock, tempDir);
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode === DisconnectReason.loggedOut || statusCode === 403 || statusCode === 401) {
                    await sock.sendMessage(senderDm, { 
                        text: '❌ *Pairing Failed.*\n_Too many linked devices or wrong code._' 
                    }).catch(() => {});
                    cleanupPairing(number, tempSock, tempDir);
                }
            }
        });

        // ── 7. Timeout ────────────────────────────────────────────────────
        setTimeout(() => {
            if (activePairingSockets.has(number)) {
                sock.sendMessage(senderDm, { text: '⏱️ *Pairing timed out.*' }).catch(() => {});
                cleanupPairing(number, tempSock, tempDir);
            }
        }, 8 * 60 * 1000);

    } catch (error) {
        console.error('[Pair Init Error]', error);
        await sock.sendMessage(chatId, { text: `❌ *Error:* ${error.message}` }, { quoted: msg });
        const tempDir = path.join(process.cwd(), 'temp_pairing', number);
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        activePairingSockets.delete(number);
    }

    return null;
}

function cleanupPairing(number, tempSock, tempDir) {
    activePairingSockets.delete(number);
    try { tempSock.ws?.close(); } catch {}
    try { tempSock.end(); } catch {}
    setTimeout(() => {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    }, 2000);
}

module.exports = {
    name: 'pair',
    aliases: ['link', 'paircode'],
    desc: 'Generate pairing code to link a new bot',
    category: 'general',
    execute
};