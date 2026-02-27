import { EmbedBuilder } from 'discord.js';
import { t, tp } from './i18n/index.js';

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
export function error(guildId, description) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'embed.error.title'))
        .setDescription(description)
        .setColor(COLORS.ERROR);
}

/** Green success embed. */
export function success(guildId, description) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'embed.success.title'))
        .setDescription(description)
        .setColor(COLORS.SUCCESS);
}

/** Blurple info embed. (BUG-01 fix — was missing in Python version) */
export function info(guildId, description) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'embed.info.title'))
        .setDescription(description)
        .setColor(COLORS.INFO);
}

/** Yellow warning embed. */
export function warning(guildId, description) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'embed.warning.title'))
        .setDescription(description)
        .setColor(COLORS.WARNING);
}

// ── Playback embeds ──────────────────────────────────────────────────

/**
 * Now-playing embed with track metadata.
 * @param {string} guildId
 * @param {{ title: string, artist: string, duration: number, thumbnailUrl?: string, url?: string }} track
 */
export function nowPlaying(guildId, track) {
    const unknown = t(guildId, 'now_playing.unknown');
    const embed = new EmbedBuilder()
        .setTitle(t(guildId, 'now_playing.title'))
        .setColor(COLORS.NOW_PLAYING)
        .addFields(
            { name: t(guildId, 'now_playing.field.title'), value: track.title || unknown, inline: true },
            { name: t(guildId, 'now_playing.field.artist'), value: track.artist || unknown, inline: true },
            { name: t(guildId, 'now_playing.field.duration'), value: formatDuration(track.duration), inline: true },
        );

    if (track.url) embed.setURL(track.url);
    if (track.thumbnailUrl) embed.setThumbnail(track.thumbnailUrl);

    return embed;
}

/**
 * Added-to-queue embed.
 * @param {string} guildId
 * @param {{ title: string, artist?: string }} track
 * @param {number} position - 1-based queue position
 */
export function addedToQueue(guildId, track, position) {
    const description = track.artist
        ? t(guildId, 'added_to_queue.description_with_artist', { trackTitle: track.title, artist: track.artist })
        : t(guildId, 'added_to_queue.description', { trackTitle: track.title });

    return new EmbedBuilder()
        .setTitle(t(guildId, 'added_to_queue.title'))
        .setDescription(description)
        .addFields({ name: t(guildId, 'added_to_queue.field.position'), value: `#${position}`, inline: true })
        .setColor(COLORS.INFO);
}

/**
 * Queue listing embed.
 * @param {string} guildId
 * @param {Array<{ title: string, artist?: string, duration?: number }>} tracks
 * @param {{ title: string, artist?: string, duration?: number }|null} currentTrack
 */
export function queueList(guildId, tracks, currentTrack) {
    const embed = new EmbedBuilder()
        .setTitle(t(guildId, 'queue.title'))
        .setColor(COLORS.INFO);

    if (currentTrack) {
        embed.addFields({
            name: t(guildId, 'queue.now_playing'),
            value: `**${currentTrack.title}**${currentTrack.artist ? ` — ${currentTrack.artist}` : ''} [${formatDuration(currentTrack.duration)}]`,
        });
    }

    if (!tracks || tracks.length === 0) {
        embed.setDescription(currentTrack ? t(guildId, 'queue.empty') : t(guildId, 'queue.empty_nothing_playing'));
    } else {
        const lines = tracks.map(
            (tr, i) => `**${i + 1}.** ${tr.title}${tr.artist ? ` — ${tr.artist}` : ''} [${formatDuration(tr.duration)}]`,
        );
        // Discord embed description limit is 4096 chars
        let description = lines.join('\n');
        if (description.length > 4000) {
            description = description.slice(0, 4000) + '\n...';
        }
        embed.setDescription(description);
        embed.setFooter({ text: tp(guildId, 'queue.footer', tracks.length) });
    }

    return embed;
}

// ── Lyrics embed (BUG-39 fix: truncate at 4000 chars) ───────────────

/**
 * Lyrics embed. Truncates at 4000 characters with "..." to stay within
 * Discord's 4096-char description limit.
 * @param {string} guildId
 * @param {string} title
 * @param {string} artist
 * @param {string} lyricsText
 */
export function lyrics(guildId, title, artist, lyricsText) {
    let text = lyricsText || t(guildId, 'lyrics.not_available');
    if (text.length > 4000) {
        text = text.slice(0, 4000) + '...';
    }
    return new EmbedBuilder()
        .setTitle(t(guildId, 'lyrics.title', { title, artist }))
        .setDescription(text)
        .setColor(COLORS.NOW_PLAYING);
}

// ── Connection embeds ────────────────────────────────────────────────

export function connected(guildId, channelName) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'connected.title'))
        .setDescription(t(guildId, 'connected.description', { channel: channelName }))
        .setColor(COLORS.SUCCESS);
}

export function disconnected(guildId) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'disconnected.title'))
        .setDescription(t(guildId, 'disconnected.description'))
        .setColor(COLORS.INFO);
}

// ── Transport control embeds ─────────────────────────────────────────

export function skipped(guildId, title) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'skipped.title'))
        .setDescription(t(guildId, 'skipped.description', { title }))
        .setColor(COLORS.INFO);
}

export function paused(guildId) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'paused.title'))
        .setDescription(t(guildId, 'paused.description'))
        .setColor(COLORS.INFO);
}

export function resumed(guildId) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'resumed.title'))
        .setDescription(t(guildId, 'resumed.description'))
        .setColor(COLORS.INFO);
}

export function stopped(guildId) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'stopped.title'))
        .setDescription(t(guildId, 'stopped.description'))
        .setColor(COLORS.INFO);
}

// ── Volume / Loop ────────────────────────────────────────────────────

export function volumeSet(guildId, percent) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'volume.title'))
        .setDescription(t(guildId, 'volume.description', { percent }))
        .setColor(COLORS.SUCCESS);
}

export function loopOn(guildId) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'loop_on.title'))
        .setDescription(t(guildId, 'loop_on.description'))
        .setColor(COLORS.SUCCESS);
}

export function loopOff(guildId) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'loop_off.title'))
        .setDescription(t(guildId, 'loop_off.description'))
        .setColor(COLORS.SUCCESS);
}

// ── Vote skip ────────────────────────────────────────────────────────

export function voteSkipRegistered(guildId, currentVotes, requiredVotes) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'vote_skip.title'))
        .setDescription(t(guildId, 'vote_skip.description', { current: currentVotes, required: requiredVotes }))
        .setColor(COLORS.INFO);
}

export function voteSkipPassed(guildId, title) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'vote_skip_passed.title'))
        .setDescription(t(guildId, 'vote_skip_passed.description', { title }))
        .setColor(COLORS.SUCCESS);
}

// ── Playlist embeds ──────────────────────────────────────────────────

export function playlistAdded(guildId, name, url) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'playlist_added.title'))
        .setDescription(t(guildId, 'playlist_added.description', { name, url }))
        .setColor(COLORS.SUCCESS);
}

/**
 * List all playlists.
 * @param {string} guildId
 * @param {Array<{ name: string, count: number }>} playlists
 */
export function playlistList(guildId, playlists) {
    const embed = new EmbedBuilder()
        .setTitle(t(guildId, 'playlist_list.title'))
        .setColor(COLORS.INFO);

    if (!playlists || playlists.length === 0) {
        embed.setDescription(t(guildId, 'playlist_list.empty'));
    } else {
        const lines = playlists.map((p) => tp(guildId, 'playlist_list.entry', p.count, { name: p.name }));
        embed.setDescription(lines.join('\n'));
    }

    return embed;
}

// ── Help embed ───────────────────────────────────────────────────────

export function helpEmbed(guildId) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'help.title'))
        .setColor(COLORS.INFO)
        .setDescription(t(guildId, 'help.description'))
        .addFields(
            { name: t(guildId, 'help.playback.name'),   value: t(guildId, 'help.playback.value'), inline: false },
            { name: t(guildId, 'help.audio.name'),       value: t(guildId, 'help.audio.value'), inline: false },
            { name: t(guildId, 'help.queue.name'),       value: t(guildId, 'help.queue.value'), inline: false },
            { name: t(guildId, 'help.voting.name'),      value: t(guildId, 'help.voting.value'), inline: false },
            { name: t(guildId, 'help.lyrics.name'),      value: t(guildId, 'help.lyrics.value'), inline: false },
            { name: t(guildId, 'help.playlists.name'),   value: t(guildId, 'help.playlists.value'), inline: false },
            { name: t(guildId, 'help.connection.name'),  value: t(guildId, 'help.connection.value'), inline: false },
            { name: t(guildId, 'help.utility.name'),     value: t(guildId, 'help.utility.value'), inline: false },
        );
}

// ── Utility embeds ───────────────────────────────────────────────────

export function messagesCleared(guildId, count) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'cleared.title'))
        .setDescription(tp(guildId, 'cleared.description', count))
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
