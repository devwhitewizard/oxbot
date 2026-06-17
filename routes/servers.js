const express = require('express');
const router = express.Router();
// Import the ping library to check real internet speed
const ping = require('ping');

// GET /api/servers - Checks REAL internet speed
router.get('/server-status', async (req, res) => {
    try {
        // We define real IP addresses to ping in each region
        // NG Server IP: Fast Nigerian IP (e.g., MTN/Lagos)
        const NG_IP = '162.35.161.152'; // Google Nigeria DNS
        // US Server IP: Fast US IP (e.g., Google US DNS)
        const US_IP = '51.79.20.140'; // Cloudflare US DNS

        // Function to ping a specific IP and return the time
        const getPing = (host) => {
            return ping.promise.probe(host, {
                timeout: 2, // Wait max 2 seconds for reply
                extra: ['-c', '1'] // Send 1 packet
            });
        };

        // Ping both servers at the same time
        const [s1Res, s2Res] = await Promise.all([
            getPing(NG_IP),
            getPing(US_IP)
        ]);

        const servers = [
            {
                id: 's1',
                name: 'Server 1 (NG)',
                // 'time' is in milliseconds
                ping: s1Res.time || 0,
                region: 'NG',
                status: 'online'
            },
            {
                id: 's2',
                name: 'Server 2 (US)',
                ping: s2Res.time || 0,
                region: 'US',
                status: 'online'
            }
        ];

        res.json({ success: true, data: servers });

    } catch (error) {
        console.error('Server Check Error:', error);
        // Send error response so frontend can handle it
        res.status(500).json({ success: false, message: 'Failed to check servers' });
    }
});

module.exports = router;
