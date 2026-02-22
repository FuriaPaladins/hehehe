const express = require('express');
const path = require('path');
const fs = require('fs');
const YTDlpWrap = require('yt-dlp-wrap').default;
const rateLimit = require('express-rate-limit');

const app = express();

// Rate limiting: 10 requests per 1 minute per IP
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // Limit each IP to 10 requests per windowMs
    message: { error: 'Too many requests, please try again after a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply the limiter to all API and download routes
app.use('/api/', limiter);

const PORT = process.env.PORT || 3000;

// OS detection for binary naming
const IS_WINDOWS = process.platform === 'win32';
const BINARY_NAME = IS_WINDOWS ? 'yt-dlp.exe' : 'yt-dlp';
const YTDLP_PATH = path.join(__dirname, BINARY_NAME);

let ytDlpWrap;

// Initialize yt-dlp binary
async function initYtDlp() {
    if (!fs.existsSync(YTDLP_PATH)) {
        console.log(`Downloading yt-dlp binary for ${process.platform}...`);
        await YTDlpWrap.downloadFromGithub(YTDLP_PATH);
        console.log('yt-dlp binary downloaded successfully.');
    }

    // Fix permissions for Linux/macOS
    if (!IS_WINDOWS) {
        try {
            console.log('Applying execution permissions to yt-dlp...');
            fs.chmodSync(YTDLP_PATH, '755');
        } catch (err) {
            console.error('Failed to set execution permissions:', err);
        }
    }

    ytDlpWrap = new YTDlpWrap(YTDLP_PATH);
}

// Update this to your desired redirect URL
const TARGET_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API: Fetch video info and formats
app.get('/api/info', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).json({ error: 'URL is required' });

    try {
        const metadata = await ytDlpWrap.getVideoInfo([
            videoUrl,
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '--no-check-certificates'
        ]);

        // Process formats
        const formats = (metadata.formats || [])
            .filter(f => f.vcodec !== 'none' && f.resolution !== 'audio only')
            .map(f => ({
                format_id: f.format_id,
                extension: f.ext,
                resolution: f.resolution,
                quality_label: f.format_note || f.height + 'p'
            }))
            .filter((v, i, a) => a.findIndex(t => (t.resolution === v.resolution && t.extension === v.extension)) === i)
            .sort((a, b) => (parseInt(b.resolution) || 0) - (parseInt(a.resolution) || 0))
            .slice(0, 8);

        // Add MP3 option to the top
        formats.unshift({
            format_id: 'mp3',
            extension: 'mp3',
            resolution: 'Audio Only',
            quality_label: 'MP3 Extraction'
        });

        res.json({
            title: metadata.title,
            thumbnail: metadata.thumbnail,
            uploader: metadata.uploader,
            duration: metadata.duration_string,
            formats: formats
        });
    } catch (err) {
        console.error('Error fetching info:', err);
        res.status(500).json({ error: 'Failed to fetch video information.' });
    }
});

// API: Download video or audio
app.get('/api/download', async (req, res) => {
    const videoUrl = req.query.url;
    const formatId = req.query.format || 'best';

    if (!videoUrl) return res.status(400).send('URL is required');

    try {
        console.log(`Preparing download for: ${videoUrl} [Format: ${formatId}]`);

        const metadata = await ytDlpWrap.getVideoInfo([
            videoUrl,
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '--no-check-certificates'
        ]);

        const isMp3 = formatId === 'mp3';
        const filename = `${metadata.title.replace(/[^\w\s-]/g, '')}.${isMp3 ? 'mp3' : 'mp4'}`;

        res.header('Content-Disposition', `attachment; filename="${filename}"`);

        // Setup yt-dlp arguments
        let args = [
            videoUrl,
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            '--no-check-certificates',
            '--concurrent-fragments', '5',
            '--buffer-size', '16K'
        ];

        if (isMp3) {
            args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
        } else {
            args.push('-f', formatId === 'best' ? 'bestvideo+bestaudio/best' : `${formatId}+bestaudio/best`);
        }

        const targetFormat = metadata.formats.find(f => f.format_id === formatId);
        if (targetFormat && (targetFormat.filesize || targetFormat.filesize_approx)) {
            res.header('Content-Length', targetFormat.filesize || targetFormat.filesize_approx);
        }

        const ytDlpEventEmitter = ytDlpWrap.execStream(args);

        ytDlpEventEmitter.on('error', (err) => {
            console.error('Download error:', err);
            if (!res.headersSent) res.status(500).send('Download failed');
        });

        ytDlpEventEmitter.pipe(res);
    } catch (err) {
        console.error('Preparation error:', err);
        res.status(500).send('Failed to prepare download');
    }
});

// Redirect Route
app.get('/r', (req, res) => {
    console.log(`Redirecting request to ${TARGET_URL}`);
    res.redirect(TARGET_URL);
});

// For any other route (like root), serve the downloader UI
app.use((req, res, next) => {
    if (req.url.startsWith('/api') || req.url === '/r') return next();
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server after initializing yt-dlp
initYtDlp().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
        console.log(`Redirect tool available at: http://localhost:${PORT}/r`);
    });
}).catch(err => {
    console.error('Failed to initialize yt-dlp:', err);
});
