/**
 * Unified URL/query resolver — detects input type and routes to the correct handler.
 *
 * This module centralizes all URL detection and track resolution so that
 * `/play` and other commands can call a single function instead of an
 * if/else chain for each service.
 *
 * Phase 1: YouTube, Spotify, SoundCloud, Bandcamp, direct audio, radio.
 * Future phases add Apple Music, Deezer, and Tidal metadata bridges.
 */

import { getYouTubeInfo, searchYouTube } from './youtube.js';
import { resolveSpotifyTrack, isSpotifyNonTrack } from './spotify.js';
import { resolveAppleMusicTrack, isAppleMusicNonTrack } from './applemusic.js';
import { resolveDeezerTrack, isDeezerNonTrack } from './deezer.js';
import { resolveTidalTrack, isTidalNonTrack } from './tidal.js';

// ── Source constants ─────────────────────────────────────────────────

/**
 * Source types for resolved tracks.
 * Every track object returned by `resolveQuery()` has a `source` field
 * set to one of these values.
 */
export const Source = {
    YOUTUBE: 'youtube',
    SPOTIFY: 'spotify',         // resolves to YouTube via metadata bridge
    SOUNDCLOUD: 'soundcloud',
    BANDCAMP: 'bandcamp',
    APPLE_MUSIC: 'apple_music', // resolves to YouTube via metadata bridge
    DEEZER: 'deezer',           // resolves to YouTube via metadata bridge
    TIDAL: 'tidal',             // resolves to YouTube via metadata bridge
    DIRECT: 'direct',           // direct HTTP audio URL
    RADIO: 'radio',             // internet radio stream
    UNKNOWN: 'unknown',
};

/**
 * Source display info (emoji + name) for embeds.
 */
export const SourceInfo = {
    [Source.YOUTUBE]: { emoji: '▶️', name: 'YouTube' },
    [Source.SPOTIFY]: { emoji: '🟢', name: 'Spotify' },
    [Source.SOUNDCLOUD]: { emoji: '🟠', name: 'SoundCloud' },
    [Source.BANDCAMP]: { emoji: '🔵', name: 'Bandcamp' },
    [Source.APPLE_MUSIC]: { emoji: '🍎', name: 'Apple Music' },
    [Source.DEEZER]: { emoji: '💜', name: 'Deezer' },
    [Source.TIDAL]: { emoji: '🌊', name: 'Tidal' },
    [Source.DIRECT]: { emoji: '🔗', name: 'Direct Link' },
    [Source.RADIO]: { emoji: '📻', name: 'Radio' },
};

// ── URL patterns ─────────────────────────────────────────────────────

const URL_PATTERNS = {
    youtube: /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i,
    spotify: /(?:open\.spotify\.com|spotify:)/i,
    soundcloud: /soundcloud\.com/i,
    bandcamp: /bandcamp\.com/i,
    appleMusic: /music\.apple\.com/i,
    deezer: /(?:deezer\.com|deezer\.page\.link|link\.deezer\.com)/i,
    tidal: /(?:tidal\.com|listen\.tidal\.com)/i,
    directAudio: /\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)(\?.*)?$/i,
    radioStream: /\.(pls|m3u|m3u8)(\?.*)?$|icecast|shoutcast|radio/i,
};

// ── Public API ───────────────────────────────────────────────────────

/**
 * Detect the source type from a URL or query string.
 * @param {string} input - URL or search query
 * @returns {string} One of the `Source` constants
 */
export function detectSource(input) {
    // Check if it's a URL
    if (input.startsWith('http://') || input.startsWith('https://')) {
        if (URL_PATTERNS.youtube.test(input)) return Source.YOUTUBE;
        if (URL_PATTERNS.spotify.test(input)) return Source.SPOTIFY;
        if (URL_PATTERNS.soundcloud.test(input)) return Source.SOUNDCLOUD;
        if (URL_PATTERNS.bandcamp.test(input)) return Source.BANDCAMP;
        if (URL_PATTERNS.appleMusic.test(input)) return Source.APPLE_MUSIC;
        if (URL_PATTERNS.deezer.test(input)) return Source.DEEZER;
        if (URL_PATTERNS.tidal.test(input)) return Source.TIDAL;
        if (URL_PATTERNS.directAudio.test(input)) return Source.DIRECT;
        if (URL_PATTERNS.radioStream.test(input)) return Source.RADIO;
        // Unknown URL — try yt-dlp as fallback (it supports 1000+ sites)
        return Source.UNKNOWN;
    }

    // Spotify URI format (spotify:track:xxx)
    if (input.startsWith('spotify:')) return Source.SPOTIFY;

    // Plain text = search query (defaults to YouTube search)
    return Source.YOUTUBE;
}

/**
 * Resolve any input (URL or search query) to a standardized track object.
 *
 * The returned object always has these fields (backward compatible with
 * the existing track format):
 *   { title, artist, duration, thumbnailUrl, url, source }
 *
 * Additional fields may be present depending on source (e.g. `spotifyUrl`,
 * `streamUrl`, `isLive`).
 *
 * @param {string} input - URL or search query
 * @returns {Promise<{title: string, artist: string, duration: number, thumbnailUrl: string|null, url: string, source: string}>}
 */
export async function resolveQuery(input) {
    const source = detectSource(input);

    switch (source) {
        case Source.YOUTUBE:
            return await resolveYouTube(input);

        case Source.SPOTIFY:
            return await resolveSpotify(input);

        case Source.SOUNDCLOUD:
        case Source.BANDCAMP:
        case Source.UNKNOWN:
            // yt-dlp handles these natively
            return await resolveViaYtDlp(input, source);

        case Source.APPLE_MUSIC:
            return await resolveAppleMusic(input);

        case Source.DEEZER:
            return await resolveDeezer(input);

        case Source.TIDAL:
            return await resolveTidal(input);

        case Source.DIRECT:
            return resolveDirectUrl(input);

        case Source.RADIO:
            return resolveRadioStream(input);

        default:
            throw new Error(`Unsupported source: ${source}`);
    }
}

// ── Internal resolvers ───────────────────────────────────────────────

/**
 * Resolve a YouTube URL or search query via yt-dlp / play-dl.
 */
async function resolveYouTube(input) {
    const isUrl = input.startsWith('http://') || input.startsWith('https://');
    let info;
    if (isUrl) {
        info = await getYouTubeInfo(input);
    } else {
        // Plain text search — uses play-dl under the hood
        info = await searchYouTube(input);
    }
    return {
        ...info,
        source: Source.YOUTUBE,
    };
}

/**
 * Resolve a Spotify URL via the metadata bridge (Spotify API → YouTube search).
 * Throws for non-track Spotify URLs (playlists, albums).
 */
async function resolveSpotify(input) {
    if (isSpotifyNonTrack(input)) {
        throw new Error(
            'Spotify playlists and albums are not supported. Please share a single track link.',
        );
    }
    const track = await resolveSpotifyTrack(input);
    return {
        ...track,
        source: Source.SPOTIFY,
    };
}

/**
 * Resolve any URL that yt-dlp supports natively (SoundCloud, Bandcamp, etc.).
 * Falls back to `Source.YOUTUBE` for truly unknown sources since yt-dlp uses
 * the same pipeline regardless.
 */
async function resolveViaYtDlp(input, source) {
    const info = await getYouTubeInfo(input);
    return {
        ...info,
        source: source === Source.UNKNOWN ? Source.YOUTUBE : source,
    };
}

/**
 * Resolve an Apple Music URL via the metadata bridge (iTunes API → YouTube search).
 * Throws for non-track Apple Music URLs (playlists, albums without ?i=).
 */
async function resolveAppleMusic(input) {
    if (isAppleMusicNonTrack(input)) {
        throw new Error(
            'Apple Music playlists and albums are not supported. Please share a single track link.',
        );
    }
    const track = await resolveAppleMusicTrack(input);
    return {
        ...track,
        source: Source.APPLE_MUSIC,
    };
}

/**
 * Resolve a Deezer URL via the metadata bridge (Deezer API → YouTube search).
 * Throws for non-track Deezer URLs (playlists, albums, artist pages).
 */
async function resolveDeezer(input) {
    if (isDeezerNonTrack(input)) {
        throw new Error(
            'Deezer playlists, albums and artists are not supported. Please share a single track link.',
        );
    }
    const track = await resolveDeezerTrack(input);
    return {
        ...track,
        source: Source.DEEZER,
    };
}

/**
 * Resolve a Tidal URL via yt-dlp or oEmbed → YouTube search.
 * Throws for non-track Tidal URLs (playlists, albums, artist pages).
 */
async function resolveTidal(input) {
    if (isTidalNonTrack(input)) {
        throw new Error(
            'Tidal playlists and albums are not supported. Please share a single track link.',
        );
    }
    const track = await resolveTidalTrack(input);
    return {
        ...track,
        source: Source.TIDAL,
    };
}

/**
 * Resolve a direct HTTP audio URL (e.g. .mp3, .ogg file).
 * Extracts a readable title from the filename.
 */
function resolveDirectUrl(input) {
    const urlObj = new URL(input);
    const filename = urlObj.pathname.split('/').pop() || 'Unknown Track';
    const title = decodeURIComponent(
        filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
    );
    return {
        title,
        artist: urlObj.hostname,
        duration: 0, // unknown for direct URLs
        thumbnailUrl: null,
        url: input,
        source: Source.DIRECT,
        streamUrl: input, // direct URL is the stream URL
    };
}

/**
 * Resolve an internet radio stream URL.
 * Radio streams are live with unknown/infinite duration.
 */
function resolveRadioStream(input) {
    const urlObj = new URL(input);
    return {
        title: `Radio: ${urlObj.hostname}`,
        artist: 'Live Stream',
        duration: 0, // live — no fixed duration
        thumbnailUrl: null,
        url: input,
        source: Source.RADIO,
        streamUrl: input,
        isLive: true,
    };
}

export default { Source, SourceInfo, detectSource, resolveQuery };
