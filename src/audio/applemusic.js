/**
 * Apple Music metadata bridge — resolves Apple Music track URLs to YouTube audio.
 *
 * Uses the free iTunes Search/Lookup API (no authentication needed):
 *   https://itunes.apple.com/lookup?id={trackId}&entity=song
 *
 * URL patterns handled:
 *   - https://music.apple.com/{country}/album/{album-name}/{albumId}?i={trackId}
 *   - https://music.apple.com/{country}/song/{song-name}/{trackId}
 *
 * Flow: extract track ID → iTunes API metadata → search YouTube → return track info.
 */

import { searchYouTube } from './youtube.js';

// ── URL parsing ──────────────────────────────────────────────────────

/**
 * Extract a track ID from an Apple Music URL.
 * @param {string} url
 * @returns {string|null} Track ID or null if not a track URL
 */
function extractAppleMusicId(url) {
    // Pattern 1: /album/name/123?i=456 → trackId is 456
    const albumMatch = url.match(/[?&]i=(\d+)/);
    if (albumMatch) return albumMatch[1];

    // Pattern 2: /song/name/123 → trackId is 123
    const songMatch = url.match(/\/song\/[^/]+\/(\d+)/);
    if (songMatch) return songMatch[1];

    // Pattern 3: Just album without ?i= → that's an album, not a track
    return null;
}

/**
 * Check if a URL is an Apple Music URL but NOT a single track.
 * Albums without ?i= and playlists are not supported.
 * @param {string} url
 * @returns {boolean}
 */
export function isAppleMusicNonTrack(url) {
    if (url.includes('/playlist/')) return true;
    if (url.includes('/album/') && !url.includes('?i=')) return true;
    return false;
}

// ── Track resolution ─────────────────────────────────────────────────

/**
 * Resolve an Apple Music track URL to a playable YouTube track.
 *
 * @param {string} url - Apple Music track URL
 * @returns {Promise<{title: string, artist: string, duration: number, thumbnailUrl: string|null, url: string, appleMusicUrl: string}>}
 */
export async function resolveAppleMusicTrack(url) {
    const trackId = extractAppleMusicId(url);
    if (!trackId) {
        throw new Error('Could not extract track ID from Apple Music URL');
    }

    // Fetch metadata from the free iTunes Lookup API
    const response = await fetch(
        `https://itunes.apple.com/lookup?id=${trackId}&entity=song`,
    );
    if (!response.ok) {
        throw new Error('Failed to fetch Apple Music track info');
    }

    const data = await response.json();
    const track = data.results?.find((r) => r.wrapperType === 'track');
    if (!track) {
        throw new Error('Track not found on Apple Music');
    }

    const title = track.trackName;
    const artist = track.artistName;
    const searchQuery = `${artist} - ${title}`;

    // Search YouTube for the matching audio
    const ytResult = await searchYouTube(searchQuery);

    // Prefer Apple Music artwork (up-scaled to 600×600), fall back to YouTube thumbnail
    const thumbnailUrl =
        track.artworkUrl100?.replace('100x100', '600x600') ||
        ytResult.thumbnailUrl;

    return {
        title,
        artist,
        duration: Math.round((track.trackTimeMillis || 0) / 1000),
        thumbnailUrl,
        url: ytResult.url,
        appleMusicUrl: url,
    };
}

export default { isAppleMusicNonTrack, resolveAppleMusicTrack };
