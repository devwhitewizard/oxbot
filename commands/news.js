const axios = require('axios');

const API_KEY = 'dcd720a6f1914e2d9dba9790c188c08c';

const name     = 'news';
const desc     = 'Get latest world news. Usage: .news | .news tech | .news sports | .news business';
const category = 'general';
const aliases  = [];

// Topic → NewsAPI category map
const TOPICS = {
  tech:        'technology',
  technology:  'technology',
  sports:      'sports',
  sport:       'sports',
  business:    'business',
  finance:     'business',
  money:       'business',
  health:      'health',
  science:     'science',
  entertainment: 'entertainment',
  music:       'entertainment',
  movies:      'entertainment',
  general:     'general',
  world:       'general',
  news:        'general',
};

const TOPIC_EMOJI = {
  technology:    '💻',
  sports:        '⚽',
  business:      '💼',
  health:        '🏥',
  science:       '🔬',
  entertainment: '🎬',
  general:       '🌍',
};

// Top sources to pull from (NewsAPI source IDs)
const SOURCES = 'bbc-news,cnn,reuters,al-jazeera-english,the-guardian-uk,associated-press,bloomberg,techcrunch,espn,the-verge';

async function execute(sock, msg, botData, args) {
  const chatId = msg.key.remoteJid;

  try {
    const topicInput = (args || []).join(' ').toLowerCase().trim();
    const category   = TOPICS[topicInput] || 'general';
    const emoji      = TOPIC_EMOJI[category] || '📰';

    // If unknown topic typed, tell user
    if (topicInput && !TOPICS[topicInput]) {
      return await sock.sendMessage(chatId, {
        text:
          `📰 *NewsBot*\n\n` +
          `Unknown topic *"${topicInput}"*.\n\n` +
          `*Available topics:*\n` +
          `• .news _(world headlines)_\n` +
          `• .news tech\n` +
          `• .news sports\n` +
          `• .news business\n` +
          `• .news health\n` +
          `• .news science\n` +
          `• .news entertainment`,
      }, { quoted: msg });
    }

    // Fetch from top sources
    // Use sources endpoint for general; category endpoint for specific topics
    let url;
    if (category === 'general' && !topicInput) {
      // Mix of top sources
      url = `https://newsapi.org/v2/top-headlines?sources=${SOURCES}&pageSize=7&apiKey=${API_KEY}`;
    } else {
      // Category-based (works across all countries)
      url = `https://newsapi.org/v2/top-headlines?category=${category}&language=en&pageSize=7&apiKey=${API_KEY}`;
    }

    const { data } = await axios.get(url, { timeout: 10000 });

    const articles = (data.articles || []).filter(
      (a) => a.title && a.title !== '[Removed]' && a.description
    );

    if (!articles.length) {
      return await sock.sendMessage(chatId, {
        text: `📰 No headlines available right now. Try again in a moment.`,
      }, { quoted: msg });
    }

    const now = new Date().toLocaleString('en-NG', {
      timeZone: 'Africa/Lagos',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    const topicLabel = topicInput
      ? topicInput.charAt(0).toUpperCase() + topicInput.slice(1)
      : 'World';

    let out  = `${emoji} *${topicLabel} Headlines*\n`;
    out     += `🕐 _${now} (WAT)_\n`;
    out     += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    articles.slice(0, 6).forEach((article, i) => {
      const title  = article.title.replace(/\s*[-–]\s*[^-–]+$/, '').trim();
      const desc   = article.description.slice(0, 120) + (article.description.length > 120 ? '…' : '');
      const source = article.source?.name || 'Unknown';

      out += `*${i + 1}.* ${title}\n`;
      out += `${desc}\n`;
      out += `📌 _${source}_\n\n`;
    });

    out += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    out += `_Sources: BBC, CNN, Reuters, Al Jazeera & more_\n`;
    out += `_Try: .news tech • .news sports • .news business_`;

    await sock.sendMessage(chatId, { text: out }, { quoted: msg });

  } catch (err) {
    console.error('[news] Error:', err?.response?.data || err.message);

    const status  = err?.response?.status;
    const errMsg  = status === 429
      ? '⚠️ Too many requests. Wait a minute and try again.'
      : status === 401
      ? '⚠️ Invalid NewsAPI key. Update API_KEY in news.js.'
      : '❌ Could not fetch news right now. Check internet and try again.';

    await sock.sendMessage(chatId, { text: errMsg }, { quoted: msg });
  }
}

module.exports = { name, desc, category, aliases, execute };