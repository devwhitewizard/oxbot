const axios = require('axios');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    const username = args[0]?.trim();
    if (!username) {
        await sock.sendMessage(chatId, { text: '❌ Usage: .github <username>' }, { quoted: msg });
        return null;
    }

    try {
        const { data } = await axios.get(`https://api.github.com/users/${username}`, {
            timeout: 10000,
            headers: { 'User-Agent': 'OxBot' }
        });

        const text = `
┏━━〔 🐙 GitHub Profile 〕━━┓
┃
┃ 👤 *Username:* @${data.login}
┃ 📛 *Name:* ${data.name || 'Not set'}
┃ 📝 *Bio:* ${data.bio || 'No bio'}
┃ 🏢 *Company:* ${data.company || 'N/A'}
┃ 📍 *Location:* ${data.location || 'N/A'}
┃ 📧 *Email:* ${data.email || 'N/A'}
┃ 🌐 *Blog:* ${data.blog || 'N/A'}
┃
┃ 📦 *Public Repos:* ${data.public_repos}
┃ 👥 *Followers:* ${data.followers}
┃ 🔗 *Following:* ${data.following}
┃
┃ 🔗 *Profile:* ${data.html_url}
┗━━━━━━━━━━━━━━━━━━━━━━┛
        `.trim();

        await sock.sendMessage(chatId, { text }, { quoted: msg });

    } catch (err) {
        await sock.sendMessage(chatId, { text: '❌ GitHub user not found or API error.' }, { quoted: msg });
    }
    return null;
}

module.exports = {
    name: 'github',
    aliases: ['gh'],
    desc: 'View GitHub user profile',
    category: 'general',
    execute
};