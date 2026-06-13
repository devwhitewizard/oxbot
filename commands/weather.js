const axios = require('axios');

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    // Join arguments to get the city name (e.g., ".weather London" -> "London")
    const city = args.join(' ').trim();

    if (!city) {
        await sock.sendMessage(chatId, { 
            text: '🌤️ *Weather Search*\n\nUsage: *.weather <city name>*\n\nExample: *.weather Lagos*' 
        }, { quoted: msg });
        return null;
    }

    try {
        // You can replace this with your own OpenWeather API key if this one stops working
        const apiKey = '4902c0f2550f58298ad4146a92b65e10'; 
        const response = await axios.get(
            `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`,
            { timeout: 10000 }
        );

        const w = response.data;

        // If the API returns a 404 or cod !== 200
        if (w.cod && w.cod !== 200) {
            await sock.sendMessage(chatId, { 
                text: `❌ City not found!\n\nMake sure you spelled "*${city}*" correctly.` 
            }, { quoted: msg });
            return null;
        }

        const weatherText = `
🌤️ *WEATHER REPORT*
📍 *Location:* ${w.name}, ${w.sys?.country || 'Unknown'}
☁️ *Condition:* ${w.weather[0]?.description || 'Unknown'}
🌡️ *Temperature:* ${w.main.temp}°C
🤒 *Feels Like:* ${w.main.feels_like}°C
💧 *Humidity:* ${w.main.humidity}%
💨 *Wind Speed:* ${w.wind.speed} m/s
👁️ *Visibility:* ${(w.visibility / 1000).toFixed(1)} km`;

        await sock.sendMessage(chatId, { text: weatherText }, { quoted: msg });

    } catch (error) {
        console.error('[weather] Error:', error.message);
        
        let errorMsg = '❌ Failed to fetch weather data.';
        if (error.response?.status === 404) {
            errorMsg = `❌ City "*${city}*" not found. Please check the spelling.`;
        } else if (error.code === 'ECONNABORTED') {
            errorMsg = '❌ Weather API timed out. Please try again later.';
        }
        
        await sock.sendMessage(chatId, { text: errorMsg }, { quoted: msg });
    }

    return null;
}

module.exports = {
    name: 'weather',
    aliases: ['climate', 'temp'],
    desc: 'Check the weather in a specific city',
    category: 'general',
    execute
};