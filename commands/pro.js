async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const db = botData?.db || sock?._botData?.db;
    const sessionId = botData?.sessionId || sock?._botData?.sessionId;

    if (!db) {
        await sock.sendMessage(chatId, { text: '❌ Database not available.' }, { quoted: msg });
        return null;
    }

    if (!sessionId) {
        await sock.sendMessage(chatId, { text: '❌ Session ID not found.' }, { quoted: msg });
        return null;
    }

    // ── ROBUST SESSION LOOKUP ────────────────────────────────────────────────
    let botRows = [];
    [botRows] = await db.query('SELECT user_id, bot_name, server, status, expires_at, session_id FROM bots WHERE session_id = ? LIMIT 1', [sessionId]);
    if (!botRows.length && !String(sessionId).startsWith('oxbot_')) {
        [botRows] = await db.query('SELECT user_id, bot_name, server, status, expires_at, session_id FROM bots WHERE session_id = ? LIMIT 1', [`oxbot_${sessionId}`]);
    }
    if (!botRows.length) {
        const cleanId = String(sessionId).replace(/[^0-9]/g, '');
        if (cleanId.length > 5) {
            [botRows] = await db.query('SELECT user_id, bot_name, server, status, expires_at, session_id FROM bots WHERE session_id LIKE ? LIMIT 1', [`%${cleanId}%`]);
        }
    }

    if (!botRows.length) {
        return await sock.sendMessage(chatId, { text: '❌ Bot not found in database.\n_Make sure you have activated this bot from the dashboard._' }, { quoted: msg });
    }

    const userId = botRows[0].user_id;
    const thisBot = botRows[0];
    const actualSessionId = thisBot.session_id;

    // ── FETCH ALL DATA ────────────────────────────────────────────────────────
    const [proRows] = await db.query(`SELECT plan, status, expires_at, created_at FROM pro_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`, [userId]);
    const [userRows] = await db.query('SELECT created_at, balance FROM users WHERE id = ?', [userId]);
    const [allBots] = await db.query('SELECT bot_name, server, status, expires_at, created_at FROM bots WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    const [settings] = await db.query('SELECT bot_mode, antiban, autoreply, autotyping, antidelete, bot_image_url, menu_image FROM bot_settings WHERE session_id = ?', [actualSessionId]).catch(() => [[]]); // ★ Catch missing column error
    const [[countRow]] = await db.query('SELECT COUNT(*) as c FROM bots WHERE user_id = ? AND status = "active"', [userId]);
    
    const user = userRows[0] || {};
    const s = settings[0] || {};
    const activeCount = countRow.c;

    // ══════════════════════════════════════════════════════════════════════════
    // BUILD RESPONSE DATA
    // ══════════════════════════════════════════════════════════════════════════
    const now = new Date();
    let planType = 'Free Plan';
    let planIcon = '🆓';
    let daysLeft = 0;
    let maxBots = 1;
    let isPro = false;
    let proStatus = '❌ No active subscription';
    let proExpires = '';
    let proStarted = '';

    if (proRows.length > 0) {
        const pro = proRows[0];
        proStarted = formatDate(pro.created_at);
        proExpires = formatDate(pro.expires_at);

        if (pro.status === 'active' && new Date(pro.expires_at) > now) {
            isPro = true;
            const diffMs = new Date(pro.expires_at) - now;
            daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            if (pro.plan === 'full') { planType = 'Best Value (Pro)'; planIcon = '👑'; maxBots = 8; }
            else if (pro.plan === 'half') { planType = 'Starter (Pro)'; planIcon = '⭐'; maxBots = 5; }
            proStatus = `✅ Active — ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`;
        } else {
            proStatus = '❌ Expired';
        }
    }

    // ★ NO MORE 2-DAY TRIAL — If not pro, they are strictly on Free Plan ★


    let botList = '';
    if (allBots.length === 0) {
        botList = '  _No bots created yet_';
    } else {
        for (const b of allBots) {
            const expDate = new Date(b.expires_at);
            const isExpired = expDate <= now;
            const isActive = b.status === 'active' && !isExpired;
            const statusIcon = isActive ? '🟢' : (isExpired ? '🔴' : '⚪');
            const daysUntilExpiry = Math.max(0, Math.ceil((expDate - now) / (1000 * 60 * 60 * 24)));
            const expiryText = isExpired ? 'EXPIRED' : `${daysUntilExpiry}d left`;
            const isThisBot = b.bot_name === thisBot.bot_name ? ' ◀ *current*' : '';
            botList += `\n${statusIcon} *${b.bot_name}*${isThisBot}\n   📍 ${b.server || 'Unknown'}\n   ⏰ Expires: ${expiryText}\n`;
        }
    }

    const feat = (name, available) => available ? `  ✅ ${name}` : `  🔒 ${name} _(Pro only)_`;
    let features = '';
    features += feat('Public/Private Mode', true) + '\n';
    features += feat('Auto Typing', isPro) + '\n';
    features += feat('Anti Delete', isPro) + '\n';
    features += feat('Anti Ban', isPro) + '\n';
    features += feat('Auto Reply', isPro) + '\n';
    features += feat('Sticker Maker', isPro) + '\n';
    features += feat('Status Saver', isPro) + '\n';
    features += feat('Custom Menu Picture', isPro) + '\n';
    features += feat('Custom Bot Image', isPro);

    let currentFeatures = '';
    currentFeatures += `  Mode: ${s.bot_mode === 'private' ? '🔒 Private' : '🌐 Public'}\n`;
    if (isPro) {
        currentFeatures += `  Auto Typing: ${s.autotyping ? '🟢 ON' : '⚪ OFF'}\n`;
        currentFeatures += `  Anti Delete: ${s.antidelete ? '🟢 ON' : '⚪ OFF'}\n`;
        currentFeatures += `  Anti Ban: ${s.antiban ? '🟢 ON' : '⚪ OFF'}\n`;
        currentFeatures += `  Auto Reply: ${s.autoreply ? '🟢 ON' : '⚪ OFF'}\n`;
        currentFeatures += `  Menu Image: ${s.menu_image === 'custom' ? '🖼️ Custom' : '⚪ Default'}\n`;
    } else {
        currentFeatures += `  _Upgrade to Pro to configure premium settings_\n`;
    }

    const serverInfo = thisBot.server || 'Unknown';
    const serverFlag = serverInfo.includes('NG') ? '🇳🇬' : '🇺🇸';

    // ★ Updated bar logic (Uses 1 as base for free to prevent division by zero, showing 0%) ★
    const totalDays = isPro ? 30 : 1; 
    const pct = Math.min(100, Math.max(0, Math.round((daysLeft / totalDays) * 100)));
    const filled = Math.round(pct / 10);
    const empty = 10 - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const barColor = pct > 50 ? '🟢' : (pct > 20 ? '🟡' : '🔴');

    const text = `
 ${planIcon} *OxBot — Plan & Subscription*

━━━━━━━━━━━━━━━━━━━━

📦 *Current Plan:* ${planType}
📊 *Status:* ${proStatus}
 ${barColor} [${bar}] ${pct}%
   ${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining out of ${isPro ? 30 : 0}

 ${isPro ? `🗓️ Started: ${proStarted}\n⏰ Expires: ${proExpires}` : `🗓️ Joined: ${formatDate(user.created_at)}`}

━━━━━━━━━━━━━━━━━━━━

🤖 *Your Bots (${activeCount}/${maxBots} active)*
 ${botList}

━━━━━━━━━━━━━━━━━━━━

🖥️ *Current Server*
  ${serverFlag} ${serverInfo}

⚙️ *Current Bot Settings*
 ${currentFeatures}

━━━━━━━━━━━━━━━━━━━━

📋 *Features*
 ${features}

━━━━━━━━━━━━━━━━━━━━

💰 *Coins Balance:* ${user.balance || 0}

 ${!isPro ? '\n_👑 Upgrade to Pro to unlock all features_\n_Contact admin or visit the dashboard_' : ''}
    `.trim();

    // ══════════════════════════════════════════════════════════════════════════
    // ★ BULLETPROOF IMAGE SENDER ★
    // ══════════════════════════════════════════════════════════════════════════
    const sendOpts = { quoted: msg };
    let menuAsset = null;

    // Safely check for custom image function from index.js
    if (typeof sock.getSessionMenuImage === 'function') {
        try {
            menuAsset = await sock.getSessionMenuImage();
        } catch (e) {
            console.error('[Pro Menu Asset Error]:', e.message);
        }
    }

    // If it failed or doesn't exist, manually fall back to the default global image
    if (!menuAsset) {
        if (global.menuImage) {
            menuAsset = { type: 'image', data: global.menuImage };
        } else if (global.menuSticker) {
            menuAsset = { type: 'sticker', data: global.menuSticker };
        }
    }

    // Send the message safely
    if (menuAsset?.type === 'image') {
        await sock.sendMessage(chatId, { image: menuAsset.data, caption: text }, sendOpts);
    } else if (menuAsset?.type === 'sticker') {
        await sock.sendMessage(chatId, { sticker: menuAsset.data }, sendOpts);
        await sock.sendMessage(chatId, { text }, sendOpts);
    } else {
        await sock.sendMessage(chatId, { text }, sendOpts);
    }

    return null;
}

function formatDate(dateStr) {
    if (!dateStr) return 'Unknown';
    try {
        const d = new Date(dateStr);
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch { return 'Unknown'; }
}

module.exports = {
    name: 'pro',
    aliases: ['plan', 'status', 'subscription'],
    desc: 'View your plan details, bot status, and features',
    category: 'general',
    execute
};