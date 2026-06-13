const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Converts any raw audio/video buffer into a standard MP3 buffer using FFmpeg
 */
async function toAudio(buffer, ext = 'bin') {
    // Use the OS temp directory to avoid permission issues
    const tmpDir = os.tmpdir();
    const inputExt = ext === 'ignore' ? 'bin' : ext;
    const inputPath = path.join(tmpDir, `oxbot_in_${Date.now()}.${inputExt}`);
    const outputPath = path.join(tmpDir, `oxbot_out_${Date.now()}.mp3`);

    try {
        // 1. Write the raw downloaded buffer to a temporary file
        fs.writeFileSync(inputPath, buffer);

        // 2. Run FFmpeg to force-convert to MP3 (ignores video tracks, sets standard bitrate)
        await new Promise((resolve, reject) => {
            exec(
                `ffmpeg -y -i "${inputPath}" -vn -ab 128k -ar 44100 -f mp3 "${outputPath}"`,
                (error, stdout, stderr) => {
                    // FFmpeg outputs debug info to stderr, so we check the error object
                    if (error) {
                        reject(new Error(stderr || error.message));
                    } else {
                        resolve();
                    }
                }
            );
        });

        // 3. Read the converted MP3 file back into memory
        if (!fs.existsSync(outputPath)) {
            throw new Error('FFmpeg process finished but output file is missing.');
        }

        const mp3Buffer = fs.readFileSync(outputPath);
        
        // Verify the output is actually an MP3 (ID3 header or MPEG frame sync)
        if (mp3Buffer.length < 3) {
            throw new Error('Converted file is too small or corrupted.');
        }

        return mp3Buffer;

    } finally {
        // 4. ALWAYS clean up temporary files, even if it crashes
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch {}
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    }
}

module.exports = { toAudio };