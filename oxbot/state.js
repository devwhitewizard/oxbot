const consoleLogs    = new Map();
const pairingMap     = new Map();
const activeSocks    = new Map();
const activeBots     = new Map();
const stoppedBots    = new Set();
const connectingBots = new Set();
const lastReply      = new Map();

const reconnectLocks    = new Map();
const reconnectAttempts = new Map();

module.exports = {
    consoleLogs,
    pairingMap,
    activeSocks,
    activeBots,
    stoppedBots,
    connectingBots,
    lastReply,
    reconnectLocks,
    reconnectAttempts
};
