/**
 * Deezer metadata bridge — resolves Deezer track URLs to YouTube audio.
 *
 * Uses the free Deezer public API (no authentication needed):
 *   https://api.deezer.com/track/{trackId}
 *
 * URL patterns handled:
 *   - https://www.deezer.com/track/{trackId}
 *   - https://www.deezer.com/{lang}/track/{trackId}
 *   - https://deezer.page.link/{shortId}  (short links — followed via redirect)
 *   - https://link.deezer.com/{shortId}   (short links — followed via redirect)
 *
 * Flow: extract track ID → Deezer API metadata → search YouTube → return track info.
 */

import { searchYouTube } from './youtube.js';

// ── URL parsing ──────────────────────────────────────────────────────

/**
 * Extract a track ID from a Deezer URL.
 * @param {string} url
 * @returns {string|null} Track ID or null if not a track URL
 */
function extractDeezerId(url) {
    // Handle language prefixes like /en/, /de/, /us/, /pt-BR/, etc.
    // Also handles URLs without language prefix: deezer.com/track/123456
    const match = url.match(/deezer\.com\/(?:[\w-]+\/)?track\/(\d+)/i);
    return match ? match[1] : null;
}

/**
 * Check if a URL is a Deezer URL but NOT a single track.
 * Playlists, albums, and artist pages are not supported.
 * @param {string} url
 * @returns {boolean}
 */
export function isDeezerNonTrack(url) {
    return (
        url.includes('/playlist/') ||
        url.includes('/album/') ||
        url.includes('/artist/')
    );
}

// ── Track resolution ─────────────────────────────────────────────────

/**
 * Resolve a Deezer track URL to a playable YouTube track.
 *
 * @param {string} url - Deezer track URL (or deezer.page.link short URL)
 * @returns {Promise<{title: string, artist: string, duration: number, thumbnailUrl: string|null, url: string, deezerUrl: string}>}
 */
export async function resolveDeezerTrack(url) {
    // Handle short-URL redirects (deezer.page.link and link.deezer.com)
    let resolvedUrl = url;
    if (url.includes('deezer.page.link') || url.includes('link.deezer.com')) {
        try {
            const redirectResponse = await fetch(url, { redirect: 'follow' });
            resolvedUrl = redirectResponse.url;
            console.log(`[Deezer] Short URL resolved: ${url} → ${resolvedUrl}`);
        } catch (err) {
            console.error(`[Deezer] Failed to resolve short URL: ${url}`, err.message);
            throw new Error('Could not resolve Deezer short URL. Try using the full track URL instead.');
        }
    }

    const trackId = extractDeezerId(resolvedUrl);
    if (!trackId) {
        console.error(`[Deezer] Could not extract track ID from URL: ${resolvedUrl}`);
        throw new Error('Could not extract track ID from Deezer URL');
    }

    // Fetch metadata from the free Deezer public API
    const response = await fetch(`https://api.deezer.com/track/${trackId}`);
    if (!response.ok) {
        throw new Error('Failed to fetch Deezer track info');
    }

    const track = await response.json();
    if (track.error) {
        throw new Error(track.error.message || 'Track not found on Deezer');
    }

    const title = track.title;
    const artist = track.artist?.name || 'Unknown';
    const searchQuery = `${artist} - ${title}`;

    // Search YouTube for the matching audio
    const ytResult = await searchYouTube(searchQuery);

    // Prefer Deezer album cover (XL or big), fall back to YouTube thumbnail
    const thumbnailUrl =
        track.album?.cover_xl ||
        track.album?.cover_big ||
        ytResult.thumbnailUrl;

    return {
        title,
        artist,
        duration: track.duration || 0,
        thumbnailUrl,
        url: ytResult.url,
        deezerUrl: url,
    };
}

export default { isDeezerNonTrack, resolveDeezerTrack };
