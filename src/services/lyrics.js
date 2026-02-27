import Genius from 'genius-lyrics';

/** @type {Genius.Client|null} */
let geniusClient = null;

/**
 * Initialise the Genius lyrics client.
 * @param {string} accessToken - Genius API access token
 */
export function initLyrics(accessToken) {
    geniusClient = new Genius.Client(accessToken);
}

/**
 * Fetch lyrics for a song. Fully async (BUG-06 fix).
 * @param {string} query - Search query, e.g. "Song Name Artist Name"
 * @returns {Promise<{ title: string, artist: string, lyrics: string }>}
 */
export async function fetchLyrics(query) {
    if (!geniusClient) {
        throw new Error('Genius client not initialized. Call initLyrics() first.');
    }

    const searches = await geniusClient.songs.search(query);
    if (!searches || searches.length === 0) {
        throw new Error(`No lyrics found for: ${query}`);
    }

    const song = searches[0];
    const lyrics = await song.lyrics();

    return {
        title: song.title,
        artist: song.artist.name,
        lyrics: lyrics || 'No lyrics available.',
    };
}

export default { initLyrics, fetchLyrics };
