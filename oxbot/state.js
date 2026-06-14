/**
 * @file oxbot/state.js
 * @description In-memory state containers, caches, locks, and status maps used by the application.
 * 
 * HOW IT WORKS:
 * - Uses JavaScript Map, Set, and plain Objects to hold active, non-persistent session data.
 * - This prevents database queries on every heartbeat, command, or reconnect request.
 * - Variables are exported as references, allowing dynamic modification across different modules.
 * 
 * CONNECTIONS TO OTHER FILES:
 * - Imported by app.js: runs intervals to purge stale data (e.g. lastReply, pairingMap).
 * - Imported by oxbot/botManager.js: manages active/stopped bots, locks, and Baileys connections.
 * - Imported by oxbot/utils.js: adds console logs to the cache.
 * - Imported by oxbot/pairing.js: uses pairingMap to track device/QR pairing requests.
 * - Imported by routes/*: heartbeats edit onlineUsers; admin.js views stats; tickets.js/admin.js query typingState.
 */

// Global console log buffer (caches last 200 logs per user in-memory)
const consoleLogs    = new Map();

// Active pairing session descriptors (reqId -> connection details)
const pairingMap     = new Map();

// Active Baileys socket links (sessionId -> raw socket object)
const activeSocks    = new Map();

// Active bot structures (sessionId -> { botName, sock, openedAt })
const activeBots     = new Map();

// Set of bot IDs explicitly stopped by user (prevents auto-reconnect)
const stoppedBots    = new Set();

// Set of bot IDs currently in the process of establishing a link
const connectingBots = new Set();

// Tracks timestamps of last outgoing replies (jid -> timestamp)
const lastReply      = new Map();

// Map tracking online dashboard users (userId -> user details + heartbeat TS)
const onlineUsers    = new Map();

// Mutex locks for bot reconnect attempts (prevent duplicate attempts)
const reconnectLocks    = new Map();

// Reconnection attempt counter map (sessionId -> retry count)
const reconnectAttempts = new Map();

// Support ticket typing statuses (ticketId -> { admin: TS, user: TS })
const typingState = {};

module.exports = {
    consoleLogs,
    pairingMap,
    activeSocks,
    activeBots,
    stoppedBots,
    connectingBots,
    lastReply,
    onlineUsers,
    reconnectLocks,
    reconnectAttempts,
    typingState
};


