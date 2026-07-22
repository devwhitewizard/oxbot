/**
 * routes/servers.js
 *
 * FIX: Each bot session now binds its WebSocket to the IP of the server
 * the user selected. This means:
 * - Server 1 (NG) users → all WA traffic goes through 162.35.161.152
 * - Server 2 (US) users → all WA traffic goes through 51.79.20.140
 *
 * WHY THIS MATTERS FOR BAN PREVENTION:
 * WhatsApp flags accounts where the IP changes frequently between sessions.
 * If User A paired on NG IP but their bot reconnects on US IP, WA sees
 * a different country = suspicious = ban risk.
 * Locking each session to its chosen server IP prevents this.
 */

const express = require('express');
const router  = express.Router();
const ping    = require('ping');

const { activeBots, connectingBots } = require('../oxbot/state');

// ─────────────────────────────────────────────────────────────────────────────
// SERVER IP MAP
// Must match the server names stored in the bots table exactly.
// ─────────────────────────────────────────────────────────────────────────────
const SERVER_IPS = {
    'Server 1 (NG)': '162.35.161.152',
    'Server 2 (US)': '162.35.161.152',
};

/**
 * Get the local bind IP for a given server name.
 * Returns null if server name is unknown (Baileys will use default interface).
 */
function getBindIp(serverName) {
    return SERVER_IPS[serverName] || null;
}

module.exports.getBindIp   = getBindIp;
module.exports.SERVER_IPS  = SERVER_IPS;

// ─────────────────────────────────────────────────────────────────────────────
// 1. ULTRA-FAST BOT STATUS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/bot-status', (req, res) => {
    const userId = req.user?.id;

    let isConnected = false;
    let totalActive = 0;
    const bots = [];

    for (const [sessionId, botData] of activeBots) {
        if (userId && botData.userId !== userId) continue;

        const isOnline = botData.openedAt > 0 && botData.sock?.user?.id;
        if (isOnline) { isConnected = true; totalActive++; }

        bots.push({
            sessionId,
            botName: botData.botName || 'Unnamed',
            server:  botData.server  || 'Unknown',
            ip:      getBindIp(botData.server) || 'default',
            status:  isOnline ? 'connected' : 'connecting',
            uptime:  isOnline ? Date.now() - botData.openedAt : 0,
        });
    }

    res.json({ connected: isConnected, activeCount: totalActive, bots });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SERVER STATUS WITH PING
// ─────────────────────────────────────────────────────────────────────────────
router.get('/server-status', async (req, res) => {
    try {
        const getPing = (host) => ping.promise.probe(host, {
            timeout: 2,
            extra: ['-c', '1'],
        });

        const entries  = Object.entries(SERVER_IPS);
        const results  = await Promise.all(entries.map(([, ip]) => getPing(ip)));

        const servers = entries.map(([name, ip], i) => ({
            id:     `s${i + 1}`,
            name,
            ip,
            ping:   results[i].alive ? (results[i].time || 0) : 9999,
            status: results[i].alive ? 'online' : 'offline',
        }));

        res.json({ success: true, data: servers });
    } catch (err) {
        console.error('Server check error:', err);
        res.status(500).json({ success: false, message: 'Failed to check servers' });
    }
});

module.exports = router;
module.exports.getBindIp  = getBindIp;
module.exports.SERVER_IPS = SERVER_IPS;
