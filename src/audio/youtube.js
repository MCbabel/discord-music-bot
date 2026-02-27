
/**
 * YouTube audio module — uses yt-dlp for streaming and info, play-dl for search.
 *
 * SETUP: YouTube Cookie Authentication (fixes "Sign in to confirm you're not a bot")
 * ─────────────────────────────────────────────────────────────────────────────────────
 * 1. Install yt-dlp: https://github.com/yt-dlp/yt-dlp#installation
 *    - Windows: `winget install yt-dlp` or download the .exe and add to PATH
 *    - Linux:   `sudo apt install yt-dlp` or `pip install yt-dlp`
 *    - macOS:   `brew install yt-dlp`
 *
 * 2. Export YouTube cookies from your browser:
 *    - Install "Get cookies.txt LOCALLY" extension for Chrome/Firefox
 *    - Go to youtube.com while logged in
 *    - Click the extension and export cookies in Netscape format
 *    - Save the file as `cookies.txt` in the project root directory
 *
 * 3. The bot will automatically detect and use cookies.txt if present.
 *    You can also use yt-dlp's browser cookie extraction:
 *    `yt-dlp --cookies-from-browser chrome --cookies cookies.txt https://youtube.com`
 *    This creates a cookies.txt from your Chrome session.
 *
 * Without cookies.txt, yt-dlp will still work but may encounter bot-detection on
 * some videos. With cookies, YouTube treats requests as authenticated.
 */

import { spawn, exec } from 'child_process';
import { PassThrough } from 'stream';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { resolve } from 'path';
import play from 'play-dl';

const execAsync = promisify(exec);

// ── Cookie support ───────────────────────────────────────────────────

const COOKIES_PATH = resolve(process.cwd(), 'cookies.txt');

/**
 * Check if cookies.txt exists and return yt-dlp arguments for it.
 * @returns {string[]}
 */
function getCookieArgs() {
    if (existsSync(COOKIES_PATH)) {
        return ['--cookies', COOKIES_PATH];
    }
    return [];
}

/**
 * Log cookie status at startup.
 */
export function logCookieStatus() {
    if (existsSync(COOKIES_PATH)) {
        console.log('🍪 YouTube cookies.txt found — authenticated requests enabled.');
    } else {
        console.log('⚠️  No cookies.txt found — YouTube may block some requests.');
        console.log('   See src/audio/youtube.js header for setup instructions.');
    }
}

/**
 * Build a shell-safe command string from a program name and arguments.
 * Quotes arguments that contain special characters to prevent shell injection.
 * @param {string} program
 * @param {string[]} args
 * @returns {string}
 */
function buildShellCmd(program, args) {
    const quoted = args.map((a) => {
        // Simple flags (e.g. --dump-json, -f)
        if (/^--?[\w-]+(=\S*)?$/.test(a)) return a;
        // Simple safe values (alphanumeric, dots, slashes, hyphens, underscores)
        if (/^[\w./-]+$/.test(a)) return a;
        // Everything else: wrap in double-quotes for shell safety
        return `"${a.replace(/"/g, '\\"')}"`;
    });
    return [program, ...quoted].join(' ');
}

// ── Search (uses play-dl) ────────────────────────────────────────────

/**
 * Search YouTube for a query and return track info.
 * Uses play-dl which works fine for search operations.
 * @param {string} query - Search keywords
 * @returns {Promise<{title: string, artist: string, duration: number, thumbnailUrl: string|null, url: string}>}
 */
export async function searchYouTube(query) {
    const results = await play.search(query, { limit: 1, source: { youtube: 'video' } });

    if (!results || results.length === 0) {
        throw new Error(`No results found for: ${query}`);
    }

    const video = results[0];
    return {
        title: video.title || 'Unknown Title',
        artist: video.channel?.name || 'Unknown Artist',
        duration: video.durationInSec || 0,
        thumbnailUrl: video.thumbnails?.[0]?.url || null,
        url: video.url,
    };
}

// ── Video info (uses yt-dlp) ─────────────────────────────────────────

/**
 * Get track info from a YouTube URL via yt-dlp.
 * Handles YouTube auth/bot-detection much better than play-dl.
 * @param {string} url - YouTube video URL
 * @returns {Promise<{title: string, artist: string, duration: number, thumbnailUrl: string|null, url: string}>}
 */
export async function getYouTubeInfo(url) {
    const args = [
        '--dump-json',
        '--no-playlist',
        '--no-warnings',
        '-f', 'bestaudio/best',
        ...getCookieArgs(),
        url,
    ];

    // Use exec() (shell by default) to avoid DEP0190 deprecation
    // (spawn + args array + shell: true is deprecated)
    const cmd = buildShellCmd('yt-dlp', args);

    try {
        const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
        const data = JSON.parse(stdout);
        return {
            title: data.track || data.title || 'Unknown Title',
            artist: data.artist || data.creator || data.uploader || data.channel || 'Unknown Artist',
            duration: Math.max(0, data.duration || 0),
            thumbnailUrl: data.thumbnail || null,
            url: data.webpage_url || url,
        };
    } catch (err) {
        throw new Error(
            `yt-dlp failed: ${err.stderr?.trim() || err.message}. Ensure yt-dlp is installed and in PATH.`
        );
    }
}

// ── Audio streaming (uses yt-dlp) ────────────────────────────────────

/**
 * Create an audio stream from a YouTube URL via yt-dlp subprocess.
 * Pipes raw audio to stdout for @discordjs/voice consumption.
 *
 * Returns a Promise that resolves once yt-dlp starts producing data,
 * or rejects if the process fails to start or exits with an error.
 *
 * @param {string} url - YouTube video URL
 * @returns {Promise<{stream: import('stream').Readable, process: import('child_process').ChildProcess}>}
 */
export function createYouTubeStream(url) {
    return new Promise((resolve, reject) => {
        const args = [
            '--no-playlist',
            '-f', 'bestaudio[ext=webm][acodec=opus]/bestaudio/best',
            '-o', '-',
            '--no-warnings',
            '--quiet',
            ...getCookieArgs(),
            url,
        ];

        // Build full command string to avoid DEP0190 deprecation warning
        // (passing args array with shell: true is deprecated)
        const cmd = buildShellCmd('yt-dlp', args);
        const proc = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let settled = false;
        let stderr = '';

        proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

        proc.on('error', (err) => {
            if (!settled) {
                settled = true;
                reject(new Error(
                    `yt-dlp failed to start: ${err.message}. Ensure yt-dlp is installed and in PATH.`
                ));
            }
        });

        // FIX: Use 'data' event instead of 'readable' to ensure ACTUAL audio
        // bytes arrive. The 'readable' event can fire on EOF (empty stream),
        // which caused silent failures when yt-dlp was not found — cmd.exe
        // wrote the error to stderr but stdout got an immediate EOF that
        // resolved the Promise with an empty stream.
        proc.stdout.once('data', (firstChunk) => {
            if (!settled) {
                settled = true;
                // Wrap in a PassThrough so we don't lose the first chunk.
                // pipe() puts proc.stdout in flowing mode, and the first
                // chunk is manually pushed so createAudioResource gets
                // every byte.
                const passthrough = new PassThrough();
                passthrough.write(firstChunk);
                proc.stdout.pipe(passthrough);
                resolve({ stream: passthrough, process: proc });
            }
        });

        // If process exits before producing any audio data, reject
        proc.on('close', (code) => {
            if (!settled) {
                settled = true;
                if (code !== 0) {
                    reject(new Error(
                        `yt-dlp failed (exit code ${code}): ${stderr.trim() || 'Unknown error'}`
                    ));
                } else {
                    reject(new Error('yt-dlp produced no audio output'));
                }
            }
        });

        // Safety timeout — if nothing happens in 15 seconds, reject
        setTimeout(() => {
            if (!settled) {
                settled = true;
                try { proc.kill(); } catch {}
                reject(new Error('yt-dlp timeout: no audio data received within 15 seconds'));
            }
        }, 15_000);
    });
}

// ── URL detection ────────────────────────────────────────────────────

/**
 * Check if a string is a YouTube URL.
 * @param {string} query
 * @returns {boolean}
 */
export function isYouTubeUrl(query) {
    return query.includes('youtube.com/') || query.includes('youtu.be/');
}

export default { searchYouTube, getYouTubeInfo, createYouTubeStream, isYouTubeUrl, logCookieStatus };
