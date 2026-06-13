const axios = require('axios');
const yts = require('yt-search');

const AXIOS_DEFAULTS = {
    timeout: 60000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
    }
};

async function tryRequest(getter, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await getter();
        } catch (err) {
            lastError = err;
            if (attempt < attempts) {
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
    }
    throw lastError;
}

// EliteProTech API - Primary
async function getEliteProTechVideoByUrl(youtubeUrl) {
    const apiUrl = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(youtubeUrl)}&format=mp4`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.downloadURL) {
        return { download: res.data.downloadURL, title: res.data.title };
    }
    throw new Error('EliteProTech ytdown returned no download');
}

// Yupra API - Fallback 1
async function getYupraVideoByUrl(youtubeUrl) {
    const apiUrl = `https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.data?.download_url) {
        return {
            download: res.data.data.download_url,
            title: res.data.data.title,
            thumbnail: res.data.data.thumbnail
        };
    }
    throw new Error('Yupra returned no download');
}

// Okatsu API - Fallback 2
async function getOkatsuVideoByUrl(youtubeUrl) {
    const apiUrl = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.result?.mp4) {
        return { download: res.data.result.mp4, title: res.data.result.title };
    }
    throw new Error('Okatsu ytmp4 returned no mp4');
}

async function execute(sock, msg, botData, args) {
    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    // Use the args array provided by index.js instead of manually parsing text
    const query = args.join(' ').trim();

    if (!query) {
        await sock.sendMessage(chatId, { 
            text: '📹 *Video Download*\n\nUsage: *.video <video name or YouTube link>*' 
        }, { quoted: msg });
        return null;
    }

    try {
        let videoUrl = '';
        let videoTitle = '';
        let videoThumbnail = '';

        // Check if input is a YouTube link
        if (query.startsWith('http://') || query.startsWith('https://')) {
            videoUrl = query;
        } else {
            // Search YouTube for the video
            const { videos } = await yts(query);
            if (!videos || videos.length === 0) {
                await sock.sendMessage(chatId, { text: `❌ No videos found for: *${query}*` }, { quoted: msg });
                return null;
            }
            videoUrl = videos[0].url;
            videoTitle = videos[0].title;
            videoThumbnail = videos[0].thumbnail;
        }

        // Send thumbnail immediately
        try {
            const ytId = (videoUrl.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) || [])[1];
            const thumb = videoThumbnail || (ytId ? `https://i.ytimg.com/vi/${ytId}/sddefault.jpg` : undefined);
            
            if (thumb) {
                await sock.sendMessage(chatId, {
                    image: { url: thumb },
                    caption: `*${videoTitle || query}*\n\n⏳ Downloading video...`
                }, { quoted: msg });
            } else {
                await sock.sendMessage(chatId, { text: `⏳ Downloading: *${videoTitle || query}*...` }, { quoted: msg });
            }
        } catch (e) { 
            console.error('[video] thumb error:', e?.message || e); 
        }

        // Validate YouTube URL format
        const isValidYt = videoUrl.match(/(?:https?:\/\/)?(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|v\/|embed\/|shorts\/|playlist\?list=)?)([a-zA-Z0-9_-]{11})/gi);
        if (!isValidYt) {
            await sock.sendMessage(chatId, { text: '❌ This is not a valid YouTube link!' }, { quoted: msg });
            return null;
        }

        // Try multiple APIs with fallback chain
        const apiMethods = [
            { name: 'EliteProTech', method: () => getEliteProTechVideoByUrl(videoUrl) },
            { name: 'Yupra', method: () => getYupraVideoByUrl(videoUrl) },
            { name: 'Okatsu', method: () => getOkatsuVideoByUrl(videoUrl) }
        ];
        
        let videoData = null;
        let downloadSuccess = false;
        
        for (const api of apiMethods) {
            try {
                console.log(`[video] Trying ${api.name}...`);
                videoData = await api.method();
                
                if (!videoData.download) {
                    console.log(`[video] ${api.name} returned no URL, trying next...`);
                    continue;
                }
                
                console.log(`[video] ${api.name} ✅ Success`);
                downloadSuccess = true;
                break; 
            } catch (apiErr) {
                console.log(`[video] ${api.name} ❌ Failed:`, apiErr.message);
                continue;
            }
        }
        
        if (!downloadSuccess || !videoData) {
            throw new Error('All download sources failed. The video may be unavailable or region-locked.');
        }

        // Send video directly using the URL (Baileys streams it automatically)
        await sock.sendMessage(chatId, {
            video: { url: videoData.download },
            mimetype: 'video/mp4',
            fileName: `${(videoData.title || videoTitle || 'video').replace(/[^\w\s-]/g, '')}.mp4`,
            caption: `*${videoData.title || videoTitle || 'Video'}*\n\n> *_Downloaded by OxBot_*`
        }, { quoted: msg });

        console.log(`[video] ✅ Sent successfully`);
        return null;

    } catch (error) {
        console.error('[video] Command Error:', error?.message || error);
        
        let errorMessage = '❌ Failed to download video.';
        if (error.message?.includes('blocked')) {
            errorMessage = '❌ Download blocked. The content may be unavailable in your region.';
        } else if (error.response?.status === 451) {
            errorMessage = '❌ Content unavailable (451). Regional blocking or legal restrictions.';
        } else if (error.message?.includes('All download sources failed')) {
            errorMessage = '❌ All download sources failed. The video may be unavailable.';
        } else if (error.message) {
            errorMessage = '❌ Download failed: ' + error.message;
        }
        
        await sock.sendMessage(chatId, { text: errorMessage }, { quoted: msg });
        return null;
    }
}

module.exports = {
    name: 'video',
    aliases: ['ytmp4', 'vid', 'playvid'],
    desc: 'Download video from YouTube',
    category: 'general',
    execute
};