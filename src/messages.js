import { EmbedBuilder } from 'discord.js';
import { t, tp } from './i18n/index.js';
import { getSetting } from './services/settings.js';
import { SourceInfo } from './audio/resolver.js';

// ── Color constants ──────────────────────────────────────────────────
const COLORS = {
    SUCCESS:     0x57F287, // green
    ERROR:       0xED4245, // red
    INFO:        0x5865F2, // blurple
    NOW_PLAYING: 0xEB459E, // pink
    WARNING:     0xFEE75C, // yellow
};

// ── Color helper ─────────────────────────────────────────────────────

/**
 * Get the embed color for a guild, respecting custom embed_color setting.
 * Custom color overrides accent colors (INFO, SUCCESS, NOW_PLAYING) but NOT error/warning.
 * @param {string} guildId
 * @param {string} colorKey - Key from COLORS (e.g. 'INFO', 'SUCCESS', 'NOW_PLAYING')
 * @returns {number} Integer color value for Discord embed
 */
export function getEmbedColor(guildId, colorKey) {
    // Error and warning embeds always use their standard colors
    if (colorKey === 'ERROR' || colorKey === 'WARNING') {
        return COLORS[colorKey];
    }
    const custom = getSetting(guildId, 'embed_color');
    if (custom) {
        return parseInt(custom.replace('#', ''), 16);
    }
    return COLORS[colorKey] || COLORS.INFO;
}

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
        .setColor(getEmbedColor(guildId, 'SUCCESS'));
}

/** Blurple info embed. (BUG-01 fix — was missing in Python version) */
export function info(guildId, description) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'embed.info.title'))
        .setDescription(description)
        .setColor(getEmbedColor(guildId, 'INFO'));
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
    const sourceInfo = SourceInfo[track.source];
    const sourceDisplay = sourceInfo
        ? `${sourceInfo.emoji} ${t(guildId, 'source.' + track.source)}`
        : `▶️ ${t(guildId, 'source.youtube')}`;

    const embed = new EmbedBuilder()
        .setTitle(t(guildId, 'now_playing.title'))
        .setColor(getEmbedColor(guildId, 'NOW_PLAYING'))
        .addFields(
            { name: t(guildId, 'now_playing.field.title'), value: track.title || unknown, inline: true },
            { name: t(guildId, 'now_playing.field.artist'), value: track.artist || unknown, inline: true },
            { name: t(guildId, 'now_playing.field.duration'), value: formatDuration(track.duration), inline: true },
            { name: t(guildId, 'now_playing.source'), value: sourceDisplay, inline: true },
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

    const sourceInfo = SourceInfo[track.source];
    const sourceDisplay = sourceInfo
        ? `${sourceInfo.emoji} ${t(guildId, 'source.' + track.source)}`
        : `▶️ ${t(guildId, 'source.youtube')}`;

    return new EmbedBuilder()
        .setTitle(t(guildId, 'added_to_queue.title'))
        .setDescription(description)
        .addFields(
            { name: t(guildId, 'added_to_queue.field.position'), value: `#${position}`, inline: true },
            { name: t(guildId, 'now_playing.source'), value: sourceDisplay, inline: true },
        )
        .setColor(getEmbedColor(guildId, 'INFO'));
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
        .setColor(getEmbedColor(guildId, 'INFO'));

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
        .setColor(getEmbedColor(guildId, 'NOW_PLAYING'));
}

// ── Connection embeds ────────────────────────────────────────────────

export function connected(guildId, channelName) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'connected.title'))
        .setDescription(t(guildId, 'connected.description', { channel: channelName }))
        .setColor(getEmbedColor(guildId, 'SUCCESS'));
}

export function disconnected(guildId) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'disconnected.title'))
        .setDescription(t(guildId, 'disconnected.description'))
        .setColor(getEmbedColor(guildId, 'INFO'));
}

// ── Transport control embeds ─────────────────────────────────────────

export function skipped(guildId, title) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'skipped.title'))
        .setDescription(t(guildId, 'skipped.description', { title }))
        .setColor(getEmbedColor(guildId, 'INFO'));
}

export function paused(guildId) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'paused.title'))
        .setDescription(t(guildId, 'paused.description'))
        .setColor(getEmbedColor(guildId, 'INFO'));
}

export function resumed(guildId) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'resumed.title'))
        .setDescription(t(guildId, 'resumed.description'))
        .setColor(getEmbedColor(guildId, 'INFO'));
}

export function stopped(guildId) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'stopped.title'))
        .setDescription(t(guildId, 'stopped.description'))
        .setColor(getEmbedColor(guildId, 'INFO'));
}

// ── Volume / Loop ────────────────────────────────────────────────────

export function volumeSet(guildId, percent) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'volume.title'))
        .setDescription(t(guildId, 'volume.description', { percent }))
        .setColor(getEmbedColor(guildId, 'SUCCESS'));
}

export function loopOn(guildId) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'loop_on.title'))
        .setDescription(t(guildId, 'loop_on.description'))
        .setColor(getEmbedColor(guildId, 'SUCCESS'));
}

export function loopOff(guildId) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'loop_off.title'))
        .setDescription(t(guildId, 'loop_off.description'))
        .setColor(getEmbedColor(guildId, 'SUCCESS'));
}

// ── Vote skip ────────────────────────────────────────────────────────

export function voteSkipRegistered(guildId, currentVotes, requiredVotes) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'vote_skip.title'))
        .setDescription(t(guildId, 'vote_skip.description', { current: currentVotes, required: requiredVotes }))
        .setColor(getEmbedColor(guildId, 'INFO'));
}

export function voteSkipPassed(guildId, title) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'vote_skip_passed.title'))
        .setDescription(t(guildId, 'vote_skip_passed.description', { title }))
        .setColor(getEmbedColor(guildId, 'SUCCESS'));
}

// ── Playlist embeds ──────────────────────────────────────────────────

export function playlistAdded(guildId, name, url) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'playlist_added.title'))
        .setDescription(t(guildId, 'playlist_added.description', { name, url }))
        .setColor(getEmbedColor(guildId, 'SUCCESS'));
}

/**
 * List all playlists.
 * @param {string} guildId
 * @param {Array<{ name: string, count: number }>} playlists
 */
export function playlistList(guildId, playlists) {
    const embed = new EmbedBuilder()
        .setTitle(t(guildId, 'playlist_list.title'))
        .setColor(getEmbedColor(guildId, 'INFO'));

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
        .setColor(getEmbedColor(guildId, 'INFO'))
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
            { name: t(guildId, 'help.settings.name'),    value: t(guildId, 'help.settings.value'), inline: false },
        );
}

// ── Settings view embed ──────────────────────────────────────────────

/**
 * Build a settings overview embed showing all current guild settings.
 * @param {string} guildId
 * @param {Record<string, *>} settings - Merged settings from getGuildSettings()
 * @param {import('discord.js').Guild} guild - Guild object for resolving role/channel names
 */
export function settingsView(guildId, settings, guild) {
    const embed = new EmbedBuilder()
        .setTitle(t(guildId, 'settings.title'))
        .setColor(getEmbedColor(guildId, 'INFO'))
        .setFooter({ text: t(guildId, 'settings.footer') });

    // Format timeout display
    const timeoutMins = Math.floor(settings.inactivity_timeout / 60);
    const timeoutSecs = settings.inactivity_timeout % 60;
    const timeoutDisplay = timeoutSecs > 0 ? `${timeoutMins}m ${timeoutSecs}s` : `${timeoutMins}m`;

    // Format max song duration
    const durationDisplay = settings.max_song_duration === 0
        ? t(guildId, 'settings.value.unlimited')
        : formatDuration(settings.max_song_duration);

    // Audio section
    const audioLines = [
        `• ${t(guildId, 'settings.default_volume.name')}: ${settings.default_volume}%`,
        `• ${t(guildId, 'settings.max_queue_size.name')}: ${settings.max_queue_size}`,
        `• ${t(guildId, 'settings.inactivity_timeout.name')}: ${timeoutDisplay}`,
        `• ${t(guildId, 'settings.max_song_duration.name')}: ${durationDisplay}`,
    ];

    // DJ Role display
    let djRoleDisplay = t(guildId, 'settings.value.none');
    if (settings.dj_role) {
        const role = guild?.roles?.cache?.get(settings.dj_role);
        djRoleDisplay = role ? `@${role.name}` : settings.dj_role;
    }

    // Text channel display
    let textChannelDisplay = t(guildId, 'settings.value.all_channels');
    if (settings.restricted_text_channel) {
        const ch = guild?.channels?.cache?.get(settings.restricted_text_channel);
        textChannelDisplay = ch ? `#${ch.name}` : settings.restricted_text_channel;
    }

    // Voice channel display
    let voiceChannelDisplay = t(guildId, 'settings.value.all_channels');
    if (settings.restricted_voice_channel) {
        const ch = guild?.channels?.cache?.get(settings.restricted_voice_channel);
        voiceChannelDisplay = ch ? `🔊 ${ch.name}` : settings.restricted_voice_channel;
    }

    // Moderation section
    const modLines = [
        `• ${t(guildId, 'settings.vote_skip_threshold.name')}: ${settings.vote_skip_threshold}%`,
        `• ${t(guildId, 'settings.dj_role.name')}: ${djRoleDisplay}`,
        `• ${t(guildId, 'settings.restricted_text_channel.name')}: ${textChannelDisplay}`,
        `• ${t(guildId, 'settings.restricted_voice_channel.name')}: ${voiceChannelDisplay}`,
    ];

    // Display section
    const colorSquare = '■';
    const displayLines = [
        `• ${t(guildId, 'settings.embed_color.name')}: ${settings.embed_color} ${colorSquare}`,
    ];

    embed.addFields(
        { name: t(guildId, 'settings.audio.title'), value: audioLines.join('\n'), inline: false },
        { name: t(guildId, 'settings.moderation.title'), value: modLines.join('\n'), inline: false },
        { name: t(guildId, 'settings.display.title'), value: displayLines.join('\n'), inline: false },
    );

    return embed;
}

// ── Utility embeds ───────────────────────────────────────────────────

export function messagesCleared(guildId, count) {
    return new EmbedBuilder()
        .setTitle(t(guildId, 'cleared.title'))
        .setDescription(tp(guildId, 'cleared.description', count))
        .setColor(getEmbedColor(guildId, 'SUCCESS'));
}

// ── Default export (all functions) ───────────────────────────────────

export default {
    formatDuration,
    getEmbedColor,
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
    settingsView,
    messagesCleared,
};
