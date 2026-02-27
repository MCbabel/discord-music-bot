import 'dotenv/config';

/**
 * Require an environment variable to be set and non-empty.
 * Exits with a helpful message if missing. (BUG-25, BUG-26 fixes)
 * @param {string} name - Environment variable name
 * @returns {string} Trimmed value
 */
function requireEnv(name) {
    const value = process.env[name];
    if (!value || value.trim() === '') {
        console.error(`\n❌ Required environment variable '${name}' is not set or empty!`);
        console.error(`   Please add it to your .env file:\n   ${name}=your_value_here\n`);
        process.exit(1);
    }
    return value.trim();
}

const config = {
    discordToken: requireEnv('DISCORD_TOKEN'),
    spotifyClientId: requireEnv('SPOTIFY_CLIENT_ID'),
    spotifyClientSecret: requireEnv('SPOTIFY_CLIENT_SECRET'),
    geniusAccessToken: requireEnv('GENIUS_ACCESS_TOKEN'),

    // Constants
    maxQueueSize: 100,          // BUG-31 fix: cap queue length
    maxPlaylistSize: 200,       // BUG-30 fix: cap playlist length
    inactivityTimeout: 180_000, // 3 minutes in ms
    defaultVolume: 50,          // 0-100
};

export default config;
