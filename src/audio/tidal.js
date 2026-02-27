/**
 * Tidal metadata bridge — resolves Tidal track URLs to YouTube audio.
 *
 * Tidal's public API requires OAuth, so we scrape the HTML page for
 * OpenGraph metadata, then search YouTube for the track.
 *
 * Strategy:
 *   1. Scrape Tidal HTML page for title/artist (OpenGraph meta tags)
 *   2. Search YouTube with the extracted metadata
 *   3. Return the YouTube result with Tidal metadata
 *
 * Note: yt-dlp doesn't support Tidal URLs and the oEmbed endpoint
 * returns undefined/empty data, so both are skipped to avoid ~7 seconds
 * of unnecessary latency.
 *
 * URL patterns handled:
 *   - https://tidal.com/browse/track/{trackId}
 *   - https://tidal.com/track/{trackId}
 *   - https://tidal.com/track/{trackId}/u  (trailing segments stripped)
 *   - https://listen.tidal.com/track/{trackId}
 *
 * Flow: clean URL → HTML scrape → search YouTube → return track info.
 */

import { searchYouTube } from './youtube.js';

// ── URL parsing ──────────────────────────────────────────────────────

/**
 * Extract a track ID from a Tidal URL.
 * @param {string} url
 * @returns {string|null} Track ID or null if not a track URL
 */
function extractTidalId(url) {
    const match = url.match(
        /(?:tidal\.com|listen\.tidal\.com)\/(?:browse\/)?track\/(\d+)/,
    );
    return match ? match[1] : null;
}

/**
 * Clean a Tidal URL by removing trailing segments after the track ID.
 * e.g. /track/355280089/u → /track/355280089
 * This prevents issues with oEmbed and yt-dlp not recognizing URLs with
 * tracking suffixes like `/u`.
 * @param {string} url
 * @returns {string} Cleaned URL
 */
function cleanTidalUrl(url) {
    return url.replace(/(\/track\/\d+)\/\w+/, '$1');
}

/**
 * Check if a URL is a Tidal URL but NOT a single track.
 * Albums, playlists, and artist pages are not supported.
 * @param {string} url
 * @returns {boolean}
 */
export function isTidalNonTrack(url) {
    return (
        url.includes('/album/') ||
        url.includes('/playlist/') ||
        url.includes('/artist/')
    );
}

// ── Metadata extraction ──────────────────────────────────────────────

/**
 * Scrape metadata from a Tidal track page using OpenGraph meta tags.
 * This is a fallback when oEmbed returns undefined/empty values.
 * @param {string} url - Clean Tidal track URL
 * @returns {Promise<{title: string|null, artist: string|null, thumbnailUrl: string|null}>}
 */
async function scrapeTidalMetadata(url) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
        });

        if (!response.ok) return { title: null, artist: null, thumbnailUrl: null };

        const html = await response.text();

        // Extract OpenGraph meta tags
        const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)
            || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:title"/i);
        const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i)
            || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:description"/i);
        const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)
            || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/i);

        // Also try <title> tag as last resort: "Song Name - by Artist | Tidal"
        const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);

        let title = null;
        let artist = null;
        const thumbnailUrl = ogImage ? ogImage[1] : null;

        // og:title is typically "Artist - Title" (e.g. "LSPLASH - Elevator Jam")
        if (ogTitle) {
            const rawTitle = ogTitle[1];
            const dashMatch = rawTitle.match(/^(.+?)\s*[-–—]\s*(.+)$/);
            if (dashMatch) {
                artist = dashMatch[1].trim();
                title = dashMatch[2].trim();
            } else {
                title = rawTitle;
            }
        }

        // Do NOT use og:description as artist — it's always "Listen to X on TIDAL"

        // If og:title is empty, try parsing <title> tag
        if (!title && titleTag) {
            const titleText = titleTag[1].trim();
            // Common format: "Song Name - by Artist | Tidal"
            const pipeIdx = titleText.lastIndexOf('|');
            const cleanTitle = pipeIdx > -1 ? titleText.substring(0, pipeIdx).trim() : titleText;
            const byMatch = cleanTitle.match(/^(.+?)\s*[-–—]\s*(?:by\s+)?(.+)$/i);
            if (byMatch) {
                title = byMatch[1].trim();
                artist = byMatch[2].trim();
            } else {
                title = cleanTitle;
            }
        }

        console.log(`[Tidal] HTML scrape: title="${title}", artist="${artist}"`);
        return { title, artist, thumbnailUrl };
    } catch (err) {
        console.error(`[Tidal] HTML scrape failed for ${url}:`, err.message);
        return { title: null, artist: null, thumbnailUrl: null };
    }
}

// ── Track resolution ─────────────────────────────────────────────────

/**
 * Resolve a Tidal track URL to a playable YouTube track.
 *
 * Strategy:
 *   1. Clean URL (strip trailing /u etc.)
 *   2. Scrape Tidal HTML page for title/artist (OpenGraph meta tags)
 *   3. Search YouTube with the extracted metadata
 *
 * yt-dlp doesn't support Tidal URLs and oEmbed returns empty data,
 * so both are skipped to avoid ~7 seconds of unnecessary latency.
 *
 * @param {string} url - Tidal track URL
 * @returns {Promise<{title: string, artist: string, duration: number, thumbnailUrl: string|null, url: string, tidalUrl: string}>}
 */
export async function resolveTidalTrack(url) {
    // Clean URL: strip trailing segments like /u after track ID
    const cleanUrl = cleanTidalUrl(url);
    if (cleanUrl !== url) {
        console.log(`[Tidal] Cleaned URL: ${url} → ${cleanUrl}`);
    }

    const trackId = extractTidalId(cleanUrl);
    if (!trackId) {
        throw new Error('Could not extract track ID from Tidal URL');
    }

    // Build a canonical URL for scraping
    const canonicalUrl = `https://tidal.com/track/${trackId}`;

    // ── HTML scrape → YouTube search ─────────────────────────────────
    const scraped = await scrapeTidalMetadata(canonicalUrl);
    if (scraped.title) {
        const title = scraped.title;
        const artist = scraped.artist || 'Unknown';
        const searchQuery = `${artist} ${title}`;
        console.log(`[Tidal] Searching YouTube for: "${searchQuery}"`);
        const ytResult = await searchYouTube(searchQuery);

        return {
            title,
            artist,
            duration: ytResult.duration || 0, // Use YouTube's duration (HTML scrape has none)
            thumbnailUrl: scraped.thumbnailUrl || ytResult.thumbnailUrl,
            url: ytResult.url,
            tidalUrl: url,
        };
    }

    throw new Error(
        'Could not resolve Tidal track. Try sharing the song name instead.',
    );
}

export default { isTidalNonTrack, resolveTidalTrack };
