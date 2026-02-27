import play from 'play-dl';
import SpotifyWebApi from 'spotify-web-api-node';

let spotifyApi = null;

/**
 * Initialize Spotify API and play-dl Spotify support.
 * @param {string} clientId - Spotify client ID
 * @param {string} clientSecret - Spotify client secret
 */
export async function initSpotify(clientId, clientSecret) {
    // Initialize play-dl Spotify support
    if (clientId && clientSecret) {
        await play.setToken({
            spotify: {
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: '', // Not needed for client credentials
                market: 'US',
            },
        });
    }

    // Also init spotify-web-api-node for metadata
    spotifyApi = new SpotifyWebApi({
        clientId,
        clientSecret,
    });

    // Get access token
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body.access_token);

    // Refresh token periodically (expires in ~1 hour)
    setInterval(async () => {
        try {
            const refreshed = await spotifyApi.clientCredentialsGrant();
            spotifyApi.setAccessToken(refreshed.body.access_token);
        } catch (err) {
            console.error('Failed to refresh Spotify token:', err.message);
        }
    }, 50 * 60 * 1000); // Refresh every 50 minutes
}

/**
 * Check if a URL is a Spotify track URL.
 * @param {string} url
 * @returns {boolean}
 */
export function isSpotifyTrack(url) {
    return url.includes('open.spotify.com/track/') || url.startsWith('spotify:track:');
}

/**
 * Check if a URL is a Spotify URL but NOT a track (playlist, album, etc.)
 * Addresses BUG-36.
 * @param {string} url
 * @returns {boolean}
 */
export function isSpotifyNonTrack(url) {
    const isSpotify = url.includes('spotify.com/') || url.startsWith('spotify:');
    return isSpotify && !isSpotifyTrack(url);
}

/**
 * Resolve a Spotify track URL to YouTube track info.
 * Fetches Spotify metadata, then searches YouTube for the audio.
 * Addresses BUG-07 (returns consistent track info), BUG-08 (all async).
 *
 * @param {string} url - Spotify track URL
 * @returns {Promise<{title: string, artist: string, duration: number, thumbnailUrl: string|null, url: string, spotifyUrl: string}>}
 */
export async function resolveSpotifyTrack(url) {
    if (!spotifyApi) throw new Error('Spotify not initialized');

    // Extract track ID
    const trackId = extractTrackId(url);

    // Fetch track metadata from Spotify
    const trackData = await spotifyApi.getTrack(trackId);
    const track = trackData.body;

    const title = track.name;
    const artist = track.artists.map(a => a.name).join(', ');
    const duration = Math.floor(track.duration_ms / 1000);
    const thumbnailUrl = track.album?.images?.[0]?.url || null;

    // Search YouTube for this track
    const searchQuery = `${title} ${artist}`;
    const results = await play.search(searchQuery, { limit: 1, source: { youtube: 'video' } });

    if (!results || results.length === 0) {
        throw new Error(`No YouTube result found for Spotify track: ${title} by ${artist}`);
    }

    return {
        title,
        artist,
        duration,
        thumbnailUrl,
        url: results[0].url, // YouTube URL for streaming
        spotifyUrl: url,     // Original Spotify URL for reference
    };
}

/**
 * Extract Spotify track ID from various URL formats.
 * @param {string} url
 * @returns {string}
 */
function extractTrackId(url) {
    // https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6?si=...
    if (url.includes('open.spotify.com/track/')) {
        const match = url.match(/track\/([a-zA-Z0-9]+)/);
        if (match) return match[1];
    }
    // spotify:track:6rqhFgbbKwnb9MLmUQDhG6
    if (url.startsWith('spotify:track:')) {
        return url.split(':')[2];
    }
    throw new Error('Invalid Spotify track URL');
}

export default { initSpotify, isSpotifyTrack, isSpotifyNonTrack, resolveSpotifyTrack };
