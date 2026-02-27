import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const PLAYLIST_FILE = 'playlists.json';

/**
 * In-memory store keyed by guild ID (BUG-18 fix: guild-scoped).
 * Shape: { [guildId]: { [playlistName]: Array<{ url: string, title: string|null }> } }
 * @type {Record<string, Record<string, Array<{ url: string, title: string|null }>>>}
 */
let store = {};

/**
 * Load playlists from disk into memory. (BUG-22 fix: async I/O)
 */
export async function loadPlaylists() {
    if (!existsSync(PLAYLIST_FILE)) {
        store = {};
        return;
    }
    try {
        const data = await readFile(PLAYLIST_FILE, 'utf-8');
        store = JSON.parse(data);
    } catch (err) {
        console.warn('Failed to load playlists, starting fresh:', err.message);
        store = {};
    }
}

/**
 * Persist playlists to disk. (BUG-22 fix: async I/O)
 */
async function savePlaylists() {
    await writeFile(PLAYLIST_FILE, JSON.stringify(store, null, 2));
}

/**
 * Validate that a string is a well-formed http(s) URL. (BUG-29 fix)
 * @param {string} url
 */
function validateUrl(url) {
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('URL must use http or https');
        }
        return true;
    } catch {
        throw new Error(`Invalid URL: ${url}`);
    }
}

/**
 * Add a URL to a guild-scoped playlist. (BUG-18, BUG-29, BUG-30 fixes)
 * @param {string} guildId
 * @param {string} playlistName
 * @param {string} url
 * @param {string|null} [title=null]
 * @param {number} [maxSize=200] - BUG-30 cap
 */
export async function addToPlaylist(guildId, playlistName, url, title = null, maxSize = 200) {
    validateUrl(url);

    if (!store[guildId]) store[guildId] = {};
    if (!store[guildId][playlistName]) store[guildId][playlistName] = [];

    const playlist = store[guildId][playlistName];
    if (playlist.length >= maxSize) {
        throw new Error(`Playlist is full (max ${maxSize} entries).`);
    }

    playlist.push({ url, title });
    await savePlaylists();
}

/**
 * Get playlist entries for a guild.
 * @param {string} guildId
 * @param {string} playlistName
 * @returns {Array<{ url: string, title: string|null }>}
 */
export function getPlaylist(guildId, playlistName) {
    const guildPlaylists = store[guildId];
    if (!guildPlaylists || !guildPlaylists[playlistName]) {
        throw new Error(`Playlist '${playlistName}' not found.`);
    }
    const playlist = guildPlaylists[playlistName];
    if (playlist.length === 0) {
        throw new Error(`Playlist '${playlistName}' is empty.`);
    }
    return playlist;
}

/**
 * List all playlists for a guild with track counts.
 * @param {string} guildId
 * @returns {Array<{ name: string, count: number }>}
 */
export function listPlaylists(guildId) {
    const guildPlaylists = store[guildId];
    if (!guildPlaylists) return [];
    return Object.entries(guildPlaylists).map(([name, entries]) => ({
        name,
        count: entries.length,
    }));
}

export default { loadPlaylists, addToPlaylist, getPlaylist, listPlaylists };
