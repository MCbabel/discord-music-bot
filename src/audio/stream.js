/**
 * Unified audio stream creation — routes track objects to the correct
 * streaming backend based on `track.source`.
 *
 * Streaming strategies:
 *   yt-dlp    — YouTube, Spotify (resolved), SoundCloud, Bandcamp, unknown
 *   FFmpeg    — Direct HTTP audio URLs, internet radio streams
 *
 * Every function returns the same shape that GuildPlayer._playTrack()
 * expects:  { stream: Readable, process: ChildProcess | null }
 */

import { createYouTubeStream } from './youtube.js';
import { Source } from './resolver.js';
import { spawn } from 'child_process';
import { PassThrough } from 'stream';

// ── Public API ───────────────────────────────────────────────────────

/**
 * Create an audio stream from a resolved track object.
 *
 * @param {object} track - Resolved track from resolver.js
 * @returns {Promise<{stream: import('stream').Readable, process: import('child_process').ChildProcess|null}>}
 */
export function createAudioStream(track) {
    switch (track.source) {
        case Source.YOUTUBE:
        case Source.SPOTIFY:       // Spotify resolves to a YouTube URL
        case Source.SOUNDCLOUD:
        case Source.BANDCAMP:
            return createYtDlpStream(track);

        case Source.DIRECT:
        case Source.RADIO:
            return createDirectStream(track);

        // Future metadata-bridge services resolve to YouTube URLs
        case Source.APPLE_MUSIC:
        case Source.DEEZER:
        case Source.TIDAL:
            return createYtDlpStream(track);

        default:
            // Fallback: try yt-dlp (it supports 1000+ sites)
            return createYtDlpStream(track);
    }
}

// ── Internal stream creators ─────────────────────────────────────────

/**
 * Stream via yt-dlp subprocess. Delegates to the existing
 * `createYouTubeStream()` which is really a generic yt-dlp wrapper.
 *
 * @param {object} track
 * @returns {Promise<{stream: Readable, process: ChildProcess}>}
 */
function createYtDlpStream(track) {
    return createYouTubeStream(track.url);
}

/**
 * Stream a direct HTTP audio URL or internet radio stream via FFmpeg.
 *
 * Spawns an FFmpeg process that reads from the HTTP URL and pipes
 * transcoded audio to stdout. Uses the same `{stream, process}` shape
 * as `createYouTubeStream()` so GuildPlayer can manage the subprocess.
 *
 * @param {object} track
 * @returns {Promise<{stream: Readable, process: ChildProcess}>}
 */
function createDirectStream(track) {
    const url = track.streamUrl || track.url;

    return new Promise((resolve, reject) => {
        const args = [
            // Reconnect options for unreliable HTTP streams
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            // Input
            '-i', url,
            // No video
            '-vn',
            // Audio output format: Opus in OGG container
            '-f', 'opus',
            '-ar', '48000',
            '-ac', '2',
            // Suppress noisy logs
            '-loglevel', 'error',
            // Pipe output to stdout
            'pipe:1',
        ];

        const proc = spawn('ffmpeg', args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let settled = false;
        let stderr = '';

        proc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        proc.on('error', (err) => {
            if (!settled) {
                settled = true;
                reject(
                    new Error(
                        `FFmpeg failed to start: ${err.message}. Ensure FFmpeg is installed and in PATH.`,
                    ),
                );
            }
        });

        // Wait for first audio bytes before resolving (mirrors createYouTubeStream pattern)
        proc.stdout.once('data', (firstChunk) => {
            if (!settled) {
                settled = true;
                const passthrough = new PassThrough();
                passthrough.write(firstChunk);
                proc.stdout.pipe(passthrough);
                resolve({ stream: passthrough, process: proc });
            }
        });

        // If process exits before producing any audio, reject
        proc.on('close', (code) => {
            if (!settled) {
                settled = true;
                if (code !== 0) {
                    reject(
                        new Error(
                            `FFmpeg failed (exit code ${code}): ${stderr.trim() || 'Unknown error'}`,
                        ),
                    );
                } else {
                    reject(new Error('FFmpeg produced no audio output'));
                }
            }
        });

        // Safety timeout — 15 seconds matches yt-dlp timeout in youtube.js
        setTimeout(() => {
            if (!settled) {
                settled = true;
                try {
                    proc.kill();
                } catch {
                    /* already exited */
                }
                reject(
                    new Error(
                        'FFmpeg timeout: no audio data received within 15 seconds',
                    ),
                );
            }
        }, 15_000);
    });
}

export default { createAudioStream };
