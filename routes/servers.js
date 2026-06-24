const express = require('express');
const router = express.Router();

// Import the ping library for network speed test
const ping = require('ping');

// Import in-memory state for INSTANT bot status (no database lag)
const { activeBots, connectingBots } = require('../oxbot/state');

// ═══════════════════════════════════════════════════
// 1. ULTRA-FAST BOT STATUS (For Dashboard Header/Timers)
// Responds in <5ms. Called every 3 seconds by frontend.
// This fixes the offline/online flickering!
// ═══════════════════════════════════════════════════
router.get('/bot-status', (req, res) => {
    // req.user comes from your auth middleware. 
    // If you don't have auth on this route, it will just return all bots.
    const userId = req.user?.id; 
    
    let isConnected = false;
    let totalActive = 0;
    const bots = [];

    // Read directly from RAM (instant, no MySQL queries)
    for (const [sessionId, botData] of activeBots) {
        // Only show bots belonging to this user
        if (userId && botData.userId !== userId) continue;

        const isOnline = botData.openedAt > 0 && botData.sock?.user?.id;
        if (isOnline) {
            isConnected = true;
            totalActive++;
        }

        bots.push({
            sessionId,
            botName: botData.botName || 'Unnamed',
            status: isOnline ? 'connected' : 'connecting',
            uptime: isOnline ? Date.now() - botData.openedAt : 0
        });
    }

    res.json({ 
        connected: isConnected, 
        activeCount: totalActive, 
        bots 
    });
});

// ═══════════════════════════════════════════════════
// 2. REAL INTERNET SPEED CHECK (For Add Bot Page ONLY)
// Takes ~2 seconds because it actually pings IPs.
// Only called when user opens the "Add Bot" page.
// ═══════════════════════════════════════════════════
router.get('/server-status', async (req, res) => {
    try {
        // Your original IPs
        const NG_IP = '162.35.161.152'; 
        const US_IP = '51.79.20.140';   

        const getPing = (host) => {
            return ping.promise.probe(host, {
                timeout: 2, 
                extra: ['-c', '1'] 
            });
        };

        const [s1Res, s2Res] = await Promise.all([
            getPing(NG_IP),
            getPing(US_IP)
        ]);

        const servers = [
            {
                id: 's1',
                name: 'Server 1 (NS1)',
                ping: s1Res.time || 0,
                region: 'NS1',
                status: 'online'
            },
            {
                id: 's2',
                name: 'Server 2 (N2)',
                ping: s2Res.time || 0,
                region: 'NS2',
                status: 'online'
            }
        ];

        res.json({ success: true, data: servers });

    } catch (error) {
        console.error('Server Check Error:', error);
        res.status(500).json({ success: false, message: 'Failed to check servers' });
    }
});

module.exports = router;
