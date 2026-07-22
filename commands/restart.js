 /**
 * restart.js — Restart Bot Process (Owner Only)
 * Aliases: .restart, .reboot, .reload
 * 
 * Tries PM2 first (production servers), falls back to process.exit
 * for nodemon/panels that auto-restart on crash.
 */

const { exec } = require('child_process');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    // ── Send warning first (before process dies) ──────────────────────────
    try {
        await sock.sendMessage(chatId, {
            text: '🔄 *Restarting Bot...*\n\nBot will be back in 5-10 seconds.'
        }, { quoted: msg });
    } catch {}

    // ── Wait for message to send before killing process ────────────────────
    await new Promise(r => setTimeout(r, 1500));

    // ── Try PM2 first ──────────────────────────────────────────────────────
    try {
        await new Promise((resolve, reject) => {
            exec('pm2 restart all', (error, stdout, stderr) => {
                if (error) reject(error);
                else resolve(stdout || stderr);
            });
        });
        console.log('[restart] PM2 restart successful');
        return null;
    } catch (e) {
        console.log('[restart] PM2 not available, using process.exit');
    }

    // ── Fallback: process.exit — nodemon/panels auto-restart on exit ─────
    try {
        // If running under PM2 but "pm2 restart all" failed,
        // try restarting just this process by its name or ID
        const pm2Name = process.env.PM2_NAME || process.env.name || 'oxbot';
        try {
            await new Promise((resolve, reject) => {
                exec(`pm2 restart ${pm2Name}`, (error, stdout) => {
                    if (error) reject(error);
                    else resolve(stdout);
                });
            });
            console.log(`[restart] PM2 restart "${pm2Name}" successful`);
            return null;
        } catch {}

        // Last resort: just exit and let the process manager handle it
        console.log('[restart] Exiting process (hoping manager restarts it)');
        setTimeout(() => process.exit(0), 500);
    } catch {}

    return null;
}

module.exports = {
    name:     'restart',
    aliases:  ['reboot', 'reload'],
    desc:     'Restart the bot process',
    category: 'owner',
    execute,
};  