import { EmbedBuilder } from 'discord.js';

// ── Color constants ──────────────────────────────────────────────────
const COLORS = {
    SUCCESS:     0x57F287, // green
    ERROR:       0xED4245, // red
    INFO:        0x5865F2, // blurple
    NOW_PLAYING: 0xEB459E, // pink
    WARNING:     0xFEE75C, // yellow
};

// ── Helper ───────────────────────────────────────────────────────────

/**
 * Format seconds into "M:SS" display string.
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
    if (seconds == null || isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ── Basic status embeds ──────────────────────────────────────────────

/** Red error embed. */
export function error(description) {
    return new EmbedBuilder()
        .setTitle('❌ Error')
        .setDescription(description)
        .setColor(COLORS.ERROR);
}

/** Green success embed. */
export function success(description) {
    return new EmbedBuilder()
        .setTitle('✅ Success')
        .setDescription(description)
        .setColor(COLORS.SUCCESS);
}

/** Blurple info embed. (BUG-01 fix — was missing in Python version) */
export function info(description) {
    return new EmbedBuilder()
        .setTitle('ℹ️ Info')
        .setDescription(description)
        .setColor(COLORS.INFO);
}

/** Yellow warning embed. */
export function warning(description) {
    return new EmbedBuilder()
        .setTitle('⚠️ Warning')
        .setDescription(description)
        .setColor(COLORS.WARNING);
}

// ── Playback embeds ──────────────────────────────────────────────────

/**
 * Now-playing embed with track metadata.
 * @param {{ title: string, artist: string, duration: number, thumbnailUrl?: string, url?: string }} track
 */
export function nowPlaying(track) {
    const embed = new EmbedBuilder()
        .setTitle('🎵 Now Playing')
        .setColor(COLORS.NOW_PLAYING)
        .addFields(
            { name: 'Title', value: track.title || 'Unknown', inline: true },
            { name: 'Artist', value: track.artist || 'Unknown', inline: true },
            { name: 'Duration', value: formatDuration(track.duration), inline: true },
        );

    if (track.url) embed.setURL(track.url);
    if (track.thumbnailUrl) embed.setThumbnail(track.thumbnailUrl);

    return embed;
}

/**
 * Added-to-queue embed.
 * @param {{ title: string, artist?: string }} track
 * @param {number} position - 1-based queue position
 */
export function addedToQueue(track, position) {
    return new EmbedBuilder()
        .setTitle('➕ Added to Queue')
        .setDescription(`**${track.title}**${track.artist ? ` by ${track.artist}` : ''}`)
        .addFields({ name: 'Position', value: `#${position}`, inline: true })
        .setColor(COLORS.INFO);
}

/**
 * Queue listing embed.
 * @param {Array<{ title: string, artist?: string, duration?: number }>} tracks
 * @param {{ title: string, artist?: string, duration?: number }|null} currentTrack
 */
export function queueList(tracks, currentTrack) {
    const embed = new EmbedBuilder()
        .setTitle('📋 Queue')
        .setColor(COLORS.INFO);

    if (currentTrack) {
        embed.addFields({
            name: '🎵 Now Playing',
            value: `**${currentTrack.title}**${currentTrack.artist ? ` — ${currentTrack.artist}` : ''} [${formatDuration(currentTrack.duration)}]`,
        });
    }

    if (!tracks || tracks.length === 0) {
        embed.setDescription(currentTrack ? 'The queue is empty.' : 'Nothing is playing and the queue is empty.');
    } else {
        const lines = tracks.map(
            (t, i) => `**${i + 1}.** ${t.title}${t.artist ? ` — ${t.artist}` : ''} [${formatDuration(t.duration)}]`,
        );
        // Discord embed description limit is 4096 chars
        let description = lines.join('\n');
        if (description.length > 4000) {
            description = description.slice(0, 4000) + '\n...';
        }
        embed.setDescription(description);
        embed.setFooter({ text: `${tracks.length} track${tracks.length === 1 ? '' : 's'} in queue` });
    }

    return embed;
}

// ── Lyrics embed (BUG-39 fix: truncate at 4000 chars) ───────────────

/**
 * Lyrics embed. Truncates at 4000 characters with "..." to stay within
 * Discord's 4096-char description limit.
 * @param {string} title
 * @param {string} artist
 * @param {string} lyricsText
 */
export function lyrics(title, artist, lyricsText) {
    let text = lyricsText || 'No lyrics available.';
    if (text.length > 4000) {
        text = text.slice(0, 4000) + '...';
    }
    return new EmbedBuilder()
        .setTitle(`📜 ${title} — ${artist}`)
        .setDescription(text)
        .setColor(COLORS.NOW_PLAYING);
}

// ── Connection embeds ────────────────────────────────────────────────

export function connected(channelName) {
    return new EmbedBuilder()
        .setTitle('🔗 Connected')
        .setDescription(`Connected to **${channelName}**.`)
        .setColor(COLORS.SUCCESS);
}

export function disconnected() {
    return new EmbedBuilder()
        .setTitle('🔌 Disconnected')
        .setDescription('The bot has left the voice channel.')
        .setColor(COLORS.INFO);
}

// ── Transport control embeds ─────────────────────────────────────────

export function skipped(title) {
    return new EmbedBuilder()
        .setTitle('⏩ Skipped')
        .setDescription(`Skipped **${title}**.`)
        .setColor(COLORS.INFO);
}

export function paused() {
    return new EmbedBuilder()
        .setTitle('⏸️ Paused')
        .setDescription('Playback has been paused.')
        .setColor(COLORS.INFO);
}

export function resumed() {
    return new EmbedBuilder()
        .setTitle('▶️ Resumed')
        .setDescription('Playback has been resumed.')
        .setColor(COLORS.INFO);
}

export function stopped() {
    return new EmbedBuilder()
        .setTitle('⏹️ Stopped')
        .setDescription('Playback has been stopped and the queue has been cleared.')
        .setColor(COLORS.INFO);
}

// ── Volume / Loop ────────────────────────────────────────────────────

export function volumeSet(percent) {
    return new EmbedBuilder()
        .setTitle('🔊 Volume Set')
        .setDescription(`Volume set to **${percent}%**.`)
        .setColor(COLORS.SUCCESS);
}

export function loopOn() {
    return new EmbedBuilder()
        .setTitle('🔁 Loop On')
        .setDescription('The current track will now loop.')
        .setColor(COLORS.SUCCESS);
}

export function loopOff() {
    return new EmbedBuilder()
        .setTitle('🔁 Loop Off')
        .setDescription('Looping has been disabled.')
        .setColor(COLORS.SUCCESS);
}

// ── Vote skip ────────────────────────────────────────────────────────

export function voteSkipRegistered(currentVotes, requiredVotes) {
    return new EmbedBuilder()
        .setTitle('🗳️ Vote Skip')
        .setDescription(`Vote registered! **${currentVotes}/${requiredVotes}** votes needed to skip.`)
        .setColor(COLORS.INFO);
}

export function voteSkipPassed(title) {
    return new EmbedBuilder()
        .setTitle('⏩ Vote Skip Passed')
        .setDescription(`Enough votes received — skipping **${title}**.`)
        .setColor(COLORS.SUCCESS);
}

// ── Playlist embeds ──────────────────────────────────────────────────

export function playlistAdded(name, url) {
    return new EmbedBuilder()
        .setTitle('🎶 Added to Playlist')
        .setDescription(`**${url}** has been added to playlist **${name}**.`)
        .setColor(COLORS.SUCCESS);
}

/**
 * List all playlists.
 * @param {Array<{ name: string, count: number }>} playlists
 */
export function playlistList(playlists) {
    const embed = new EmbedBuilder()
        .setTitle('📂 Playlists')
        .setColor(COLORS.INFO);

    if (!playlists || playlists.length === 0) {
        embed.setDescription('No playlists found. Create one with `/add_to_playlist`.');
    } else {
        const lines = playlists.map((p) => `• **${p.name}** — ${p.count} track${p.count === 1 ? '' : 's'}`);
        embed.setDescription(lines.join('\n'));
    }

    return embed;
}

// ── Help embed ───────────────────────────────────────────────────────

export function helpEmbed() {
    return new EmbedBuilder()
        .setTitle('📖 Music Bot Help')
        .setColor(COLORS.INFO)
        .setDescription('Here are all available commands:')
        .addFields(
            { name: '🎵 Playback',          value: '`/play <query>` — Play a song or add to queue\n`/skip` — Skip the current track\n`/stop` — Stop playback and clear queue\n`/pause` — Pause playback\n`/resume` — Resume playback', inline: false },
            { name: '🔊 Audio',             value: '`/volume <0-100>` — Set playback volume\n`/loop` — Toggle loop for current track', inline: false },
            { name: '📋 Queue',             value: '`/queue` — Show the current queue\n`/nowplaying` — Show current track info', inline: false },
            { name: '🗳️ Voting',            value: '`/vote_skip` — Vote to skip the current track', inline: false },
            { name: '📜 Lyrics',            value: '`/lyrics` — Fetch lyrics for the current song', inline: false },
            { name: '🎶 Playlists',         value: '`/add_to_playlist <name> <url>` — Add a song to a playlist\n`/play_playlist <name>` — Play a saved playlist\n`/list_playlists` — List all playlists', inline: false },
            { name: '🔗 Connection',        value: '`/join` — Join your voice channel\n`/leave` — Leave the voice channel', inline: false },
            { name: '🧹 Utility',           value: '`/clear [count]` — Delete recent messages\n`/help` — Show this help message', inline: false },
        );
}

// ── Utility embeds ───────────────────────────────────────────────────

export function messagesCleared(count) {
    return new EmbedBuilder()
        .setTitle('🧹 Messages Cleared')
        .setDescription(`Deleted **${count}** message${count === 1 ? '' : 's'}.`)
        .setColor(COLORS.SUCCESS);
}

// ── Default export (all functions) ───────────────────────────────────

export default {
    formatDuration,
    error,
    success,
    info,
    warning,
    nowPlaying,
    addedToQueue,
    queueList,
    lyrics,
    connected,
    disconnected,
    skipped,
    paused,
    resumed,
    stopped,
    volumeSet,
    loopOn,
    loopOff,
    voteSkipRegistered,
    voteSkipPassed,
    playlistAdded,
    playlistList,
    helpEmbed,
    messagesCleared,
};
