/**
 * autojoin.js — Auto-Add DB Users to Current Group
 * Aliases: .autojoin, .massadd
 * 
 * Fetches phone numbers from the 'users' table and adds them to the group.
 */

// ✅ Robust JID cleaner (matches promote.js)
function cleanNum(jid) {
    if (!jid) return '';
    return jid.replace(/[^0-9]/g, '');
}

// Helper to convert raw DB phone numbers to proper WhatsApp JIDs
function cleanToJid(input) {
    if (!input) return null;
    // Strip everything except numbers (removes +, -, spaces, etc)
    let num = String(input).replace(/[^0-9]/g, '');
    
    // Remove leading 0 (e.g., 08012345678 -> 8012345678)
    if (num.startsWith('0')) num = num.slice(1);
    
    // Basic validation (must be at least 10 digits)
    if (num.length < 10 || num.length > 15) return null;
    
    return `${num}@s.whatsapp.net`;
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    // 1. Ensure it's a group
    if (!chatId.endsWith('@g.us')) {
        return await sock.sendMessage(chatId, { text: '❌ Group only command!' }, { quoted: msg });
    }

    const senderId = msg.key.participant || msg.key.remoteJid;
    const db = botData?.db;

    // ═══════════════════════════════════════════════════════════════
    // SECURITY CHECK (Exact same logic as promote.js)
    // ═══════════════════════════════════════════════════════════════
    let senderIsOwner = msg.key.fromMe;
    if (!senderIsOwner) {
        const ownerPhone = sock._ownerPhone;
        const senderNum = cleanNum(senderId);
        const ownerNum  = ownerPhone ? cleanNum(ownerPhone) : '';
        
        if (senderNum && ownerNum) {
            const sNorm = senderNum.startsWith('0') ? senderNum.slice(1) : senderNum;
            const oNorm = ownerNum.startsWith('0') ? ownerNum.slice(1) : ownerNum;
            senderIsOwner = sNorm === oNorm || sNorm.endsWith(oNorm) || oNorm.endsWith(sNorm);
        }
    }

    if (!msg.key.fromMe && !senderIsOwner) {
        try {
            const meta = await sock.groupMetadata(chatId);
            const senderNum = cleanNum(senderId);
            const senderIsAdmin = meta.participants?.some(p => 
                cleanNum(p.id) === senderNum && 
                (p.admin === 'admin' || p.admin === 'superadmin')
            );

            if (!senderIsAdmin) {
                return await sock.sendMessage(chatId, { text: '❌ Only group admins can use this command!' }, { quoted: msg });
            }
        } catch {
            return await sock.sendMessage(chatId, { text: '❌ Could not fetch group info.' }, { quoted: msg });
        }
    }

    if (!db || !db.query) {
        return await sock.sendMessage(chatId, { text: '❌ Database error.' }, { quoted: msg });
    }

    await sock.sendMessage(chatId, {
        text: '⏳ *Auto-Join Initiated*\n\nFetching users from database...'
    }, { quoted: msg });

    try {
        const allJids = new Set();

        // ═══════════════════════════════════════════════════════════════
        // FETCH FROM 'users' TABLE (Uses the 'phone' column)
        // ═══════════════════════════════════════════════════════════════
        try {
            const [users] = await db.query('SELECT phone FROM users');
            if (users && users.length > 0) {
                users.forEach(row => {
                    const jid = cleanToJid(row.phone);
                    if (jid) allJids.add(jid);
                });
            }
        } catch (err) {
            console.error('[autojoin] Error fetching users table:', err.message);
        }

        const jidArray = [...allJids];

        if (jidArray.length === 0) {
            return await sock.sendMessage(chatId, {
                text: '⚠️ No valid phone numbers found in the `users` table.'
            }, { quoted: msg });
        }

        // 4. Send processing message
        await sock.sendMessage(chatId, {
            text: `📊 Found *${jidArray.length}* valid users in DB.\n\n` +
                  `🔄 Adding them in batches of 5 (5s delay to avoid WhatsApp ban)...\n\n` +
                  `_Please wait..._`
        }, { quoted: msg });

        // 5. Process in chunks of 5
        const CHUNK_SIZE = 5;
        const DELAY_MS = 5000; // 5 seconds
        let addedCount = 0;
        let failedCount = 0;

        for (let i = 0; i < jidArray.length; i += CHUNK_SIZE) {
            const chunk = jidArray.slice(i, i + CHUNK_SIZE);

            try {
                const response = await sock.groupParticipantsUpdate(
                    chatId, 
                    chunk, 
                    'add'
                );

                response.forEach(res => {
                    if (res.status === '200' || res.status === 200) {
                        addedCount++;
                    } else {
                        failedCount++;
                        console.log(`[autojoin] Failed to add ${res.jid}: Status ${res.status}`);
                    }
                });
            } catch (err) {
                console.error(`[autojoin] Chunk error:`, err.message);
                
                if (err?.message?.includes('not-admin') || err?.output?.statusCode === 400) {
                    return await sock.sendMessage(chatId, { 
                        text: '❌ *Action failed:* The bot needs to be an ADMIN in this group to add members.' 
                    }, { quoted: msg });
                }
                failedCount += chunk.length;
            }

            // Wait before sending the next chunk
            if (i + CHUNK_SIZE < jidArray.length) {
                await new Promise(r => setTimeout(r, DELAY_MS));
            }
        }

        // 6. Final Result
        await sock.sendMessage(chatId, {
            text: `✅ *Auto-Join Complete!*\n\n` +
                  `✅ Successfully Added: *${addedCount}*\n` +
                  `❌ Failed/Already In: *${failedCount}*\n` +
                  `📊 Total Processed: *${jidArray.length}*\n\n` +
                  `_Note: If some failed, their WhatsApp privacy settings might not allow them to be added directly._`
        }, { quoted: msg });

        return null;

    } catch (err) {
        console.error('[autojoin] Critical error:', err.message);
        return await sock.sendMessage(chatId, {
            text: '❌ An unexpected error occurred while running auto-join.'
        }, { quoted: msg });
    }
}

module.exports = {
    name:     'autojoin',
    aliases:  ['massadd', 'addall'],
    desc:     'Fetch all users from DB and add them to the current group',
    category: 'owner',
    execute
};