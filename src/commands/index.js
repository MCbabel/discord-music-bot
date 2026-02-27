import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import * as messages from '../messages.js';
import { getGuildPlayer, getOrCreateGuildPlayer, deleteGuildPlayer } from '../audio/player.js';
import { searchYouTube, getYouTubeInfo, isYouTubeUrl } from '../audio/youtube.js';
import { isSpotifyTrack, isSpotifyNonTrack, resolveSpotifyTrack } from '../audio/spotify.js';
import { fetchLyrics } from '../services/lyrics.js';
import { addToPlaylist, getPlaylist, listPlaylists } from '../services/playlist.js';
import { t, getLocale, setLocale, getAvailableLocales } from '../i18n/index.js';
import config from '../config.js';

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Get the user's voice channel or return null if not in one.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {import('discord.js').VoiceChannel|null}
 */
function getUserVoiceChannel(interaction) {
    const channel = interaction.member?.voice?.channel;
    if (!channel) return null;
    return channel;
}

/**
 * Check if bot is in the same voice channel as the user.
 * Returns true if same channel or bot not connected yet.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {import('../audio/player.js').GuildPlayer} guildPlayer
 * @returns {boolean}
 */
function isSameChannel(interaction, guildPlayer) {
    if (!guildPlayer?.connection) return true;
    const userChannel = interaction.member?.voice?.channelId;
    const botChannel = guildPlayer.connection.joinConfig?.channelId;
    return userChannel === botChannel;
}

// ── 1. /join ─────────────────────────────────────────────────────────

const join = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Join your voice channel'),
    async execute(interaction) {
        const guildId = interaction.guildId;
        const channel = getUserVoiceChannel(interaction);
        if (!channel) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_in_voice'))], flags: MessageFlags.Ephemeral });
        }

        const player = getOrCreateGuildPlayer(guildId);
        player.connect(channel, interaction.channel);

        await interaction.reply({ embeds: [messages.connected(guildId, channel.name)] });
    },
};

// ── 2. /leave — BUG-13: full state cleanup ──────────────────────────

const leave = {
    data: new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Leave the voice channel'),
    async execute(interaction) {
        const guildId = interaction.guildId;
        const player = getGuildPlayer(guildId);
        if (!player || !player.connection) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.bot_not_in_voice'))], flags: MessageFlags.Ephemeral });
        }

        player.destroy();
        deleteGuildPlayer(guildId);

        await interaction.reply({ embeds: [messages.disconnected(guildId)] });
    },
};

// ── 3. /play <query> — BUG-02, BUG-12, BUG-36 ──────────────────────

const play = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or add it to the queue')
        .addStringOption(option =>
            option.setName('query').setDescription('Song name or URL').setRequired(true),
        ),
    async execute(interaction) {
        await interaction.deferReply(); // BUG-02: defer for long operations

        const guildId = interaction.guildId;
        const channel = getUserVoiceChannel(interaction);
        if (!channel) {
            return interaction.editReply({ embeds: [messages.error(guildId, t(guildId, 'error.not_in_voice'))] });
        }

        const player = getOrCreateGuildPlayer(guildId);

        // Auto-join if not connected
        if (!player.connection) {
            player.connect(channel, interaction.channel);
        }

        // BUG-12: check same channel
        if (!isSameChannel(interaction, player)) {
            return interaction.editReply({ embeds: [messages.error(guildId, t(guildId, 'error.not_same_channel'))] });
        }

        const query = interaction.options.getString('query');

        let track;
        if (isSpotifyNonTrack(query)) {
            // BUG-36: Spotify playlists/albums not supported
            return interaction.editReply({
                embeds: [messages.error(guildId, t(guildId, 'error.spotify_non_track'))],
            });
        } else if (isSpotifyTrack(query)) {
            track = await resolveSpotifyTrack(query);
        } else if (isYouTubeUrl(query)) {
            track = await getYouTubeInfo(query);
        } else {
            track = await searchYouTube(query);
        }

        const result = await player.addTrack(track);

        if (result === 'playing') {
            // Brief confirmation only — the player sends the rich "Now Playing" embed with buttons
            await interaction.editReply({ embeds: [messages.success(guildId, t(guildId, 'success.now_playing', { title: track.title }))] });
        } else {
            await interaction.editReply({ embeds: [messages.addedToQueue(guildId, track, player.queue.length)] });
        }
    },
};

// ── 4. /pause ────────────────────────────────────────────────────────

const pause = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause playback'),
    async execute(interaction) {
        const guildId = interaction.guildId;
        const channel = getUserVoiceChannel(interaction);
        if (!channel) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_in_voice'))], flags: MessageFlags.Ephemeral });
        }

        const player = getGuildPlayer(guildId);
        if (!player || !player.connection) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_playing'))], flags: MessageFlags.Ephemeral });
        }

        if (!isSameChannel(interaction, player)) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_same_channel'))], flags: MessageFlags.Ephemeral });
        }

        player.pause();
        await interaction.reply({ embeds: [messages.paused(guildId)] });
    },
};

// ── 5. /resume ───────────────────────────────────────────────────────

const resume = {
    data: new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume playback'),
    async execute(interaction) {
        const guildId = interaction.guildId;
        const channel = getUserVoiceChannel(interaction);
        if (!channel) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_in_voice'))], flags: MessageFlags.Ephemeral });
        }

        const player = getGuildPlayer(guildId);
        if (!player || !player.connection) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_playing'))], flags: MessageFlags.Ephemeral });
        }

        if (!isSameChannel(interaction, player)) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_same_channel'))], flags: MessageFlags.Ephemeral });
        }

        player.resume();
        await interaction.reply({ embeds: [messages.resumed(guildId)] });
    },
};

// ── 6. /skip ─────────────────────────────────────────────────────────

const skip = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current track'),
    async execute(interaction) {
        const guildId = interaction.guildId;
        const channel = getUserVoiceChannel(interaction);
        if (!channel) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_in_voice'))], flags: MessageFlags.Ephemeral });
        }

        const player = getGuildPlayer(guildId);
        if (!player || !player.currentTrack) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.nothing_playing'))], flags: MessageFlags.Ephemeral });
        }

        if (!isSameChannel(interaction, player)) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_same_channel'))], flags: MessageFlags.Ephemeral });
        }

        const title = player.currentTrack.title;
        player.skip();
        await interaction.reply({ embeds: [messages.skipped(guildId, title)] });
    },
};

// ── 7. /stop — BUG-37: check if connected first ─────────────────────

const stop = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop playback and clear the queue'),
    async execute(interaction) {
        const guildId = interaction.guildId;
        const channel = getUserVoiceChannel(interaction);
        if (!channel) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_in_voice'))], flags: MessageFlags.Ephemeral });
        }

        const player = getGuildPlayer(guildId);

        // BUG-37: check if connected first
        if (!player || !player.connection) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_connected'))], flags: MessageFlags.Ephemeral });
        }

        if (!isSameChannel(interaction, player)) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_same_channel'))], flags: MessageFlags.Ephemeral });
        }

        player.stop();
        player.destroy();
        deleteGuildPlayer(guildId);

        await interaction.reply({ embeds: [messages.stopped(guildId)] });
    },
};

// ── 8. /lyrics — BUG-06: MUST defer, fully async ────────────────────

const lyrics = {
    data: new SlashCommandBuilder()
        .setName('lyrics')
        .setDescription('Get lyrics for the current song'),
    async execute(interaction) {
        await interaction.deferReply(); // BUG-06: must defer

        const guildId = interaction.guildId;
        const player = getGuildPlayer(guildId);
        if (!player || !player.currentTrack) {
            return interaction.editReply({ embeds: [messages.error(guildId, t(guildId, 'error.nothing_currently_playing'))] });
        }

        const track = player.currentTrack;
        const query = `${track.title} ${track.artist}`;
        const result = await fetchLyrics(query);

        await interaction.editReply({ embeds: [messages.lyrics(guildId, result.title, result.artist, result.lyrics)] });
    },
};

// ── 9. /help ─────────────────────────────────────────────────────────

const help = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all available commands'),
    async execute(interaction) {
        const guildId = interaction.guildId;
        await interaction.reply({ embeds: [messages.helpEmbed(guildId)] });
    },
};

// ── 10. /volume <percent> — BUG-14: persists in player ──────────────

const volume = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Set the playback volume')
        .addIntegerOption(option =>
            option.setName('percent').setDescription('Volume level (0-100)').setRequired(true).setMinValue(0).setMaxValue(100),
        ),
    async execute(interaction) {
        const guildId = interaction.guildId;
        const channel = getUserVoiceChannel(interaction);
        if (!channel) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_in_voice'))], flags: MessageFlags.Ephemeral });
        }

        const player = getGuildPlayer(guildId);
        if (!player || !player.connection) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_connected'))], flags: MessageFlags.Ephemeral });
        }

        if (!isSameChannel(interaction, player)) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_same_channel'))], flags: MessageFlags.Ephemeral });
        }

        const percent = interaction.options.getInteger('percent');
        player.setVolume(percent); // BUG-14: persists across songs

        await interaction.reply({ embeds: [messages.volumeSet(guildId, percent)] });
    },
};

// ── 11. /loop <enabled> ─────────────────────────────────────────────

const loop = {
    data: new SlashCommandBuilder()
        .setName('loop')
        .setDescription('Toggle loop for the current track')
        .addBooleanOption(option =>
            option.setName('enabled').setDescription('Enable or disable loop').setRequired(true),
        ),
    async execute(interaction) {
        const guildId = interaction.guildId;
        const channel = getUserVoiceChannel(interaction);
        if (!channel) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_in_voice'))], flags: MessageFlags.Ephemeral });
        }

        const player = getGuildPlayer(guildId);
        if (!player || !player.connection) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_connected'))], flags: MessageFlags.Ephemeral });
        }

        if (!isSameChannel(interaction, player)) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_same_channel'))], flags: MessageFlags.Ephemeral });
        }

        const enabled = interaction.options.getBoolean('enabled');
        player.isLooping = enabled;

        await interaction.reply({ embeds: [enabled ? messages.loopOn(guildId) : messages.loopOff(guildId)] });
    },
};

// ── 12. /add_to_playlist <name> <url> — BUG-18, BUG-29, BUG-30 ─────

const addToPlaylistCmd = {
    data: new SlashCommandBuilder()
        .setName('add_to_playlist')
        .setDescription('Add a song to a playlist')
        .addStringOption(option =>
            option.setName('name').setDescription('Playlist name').setRequired(true),
        )
        .addStringOption(option =>
            option.setName('url').setDescription('Song URL').setRequired(true),
        ),
    async execute(interaction) {
        const guildId = interaction.guildId;
        const name = interaction.options.getString('name');
        const url = interaction.options.getString('url');

        try {
            // BUG-18: guild-scoped, BUG-29: URL validation, BUG-30: playlist size cap
            await addToPlaylist(guildId, name, url);
        } catch (error) {
            return interaction.reply({ embeds: [messages.error(guildId, error.message)], flags: MessageFlags.Ephemeral });
        }

        await interaction.reply({ embeds: [messages.playlistAdded(guildId, name, url)] });
    },
};

// ── 13. /play_playlist <name> — BUG-02, BUG-03, BUG-23, BUG-28 ─────

const playPlaylist = {
    data: new SlashCommandBuilder()
        .setName('play_playlist')
        .setDescription('Play a saved playlist')
        .addStringOption(option =>
            option.setName('name').setDescription('Playlist name').setRequired(true),
        ),
    async execute(interaction) {
        await interaction.deferReply(); // BUG-02: defer for long operations

        const guildId = interaction.guildId;
        const channel = getUserVoiceChannel(interaction);
        if (!channel) {
            return interaction.editReply({ embeds: [messages.error(guildId, t(guildId, 'error.not_in_voice'))] });
        }

        const player = getOrCreateGuildPlayer(guildId);

        // BUG-03: auto-join voice channel
        if (!player.connection) {
            player.connect(channel, interaction.channel);
        }

        if (!isSameChannel(interaction, player)) {
            return interaction.editReply({ embeds: [messages.error(guildId, t(guildId, 'error.not_same_channel'))] });
        }

        const name = interaction.options.getString('name');
        const entries = getPlaylist(guildId, name); // BUG-23: throws if not found

        let successCount = 0; // BUG-28: track success count

        for (const entry of entries) {
            try {
                let track;
                if (isYouTubeUrl(entry.url)) {
                    track = await getYouTubeInfo(entry.url);
                } else if (isSpotifyTrack(entry.url)) {
                    track = await resolveSpotifyTrack(entry.url);
                } else {
                    track = await searchYouTube(entry.url);
                }
                await player.addTrack(track);
                successCount++;
            } catch (err) {
                console.warn(`Failed to load playlist entry ${entry.url}:`, err.message);
            }
        }

        await interaction.editReply({
            embeds: [messages.success(guildId, t(guildId, 'success.playlist_loaded', { loaded: successCount, total: entries.length, name }))],
        });
    },
};

// ── 14. /vote_skip — BUG-01, BUG-17 ─────────────────────────────────

const voteSkip = {
    data: new SlashCommandBuilder()
        .setName('vote_skip')
        .setDescription('Vote to skip the current track'),
    async execute(interaction) {
        const guildId = interaction.guildId;
        const channel = getUserVoiceChannel(interaction);
        if (!channel) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_in_voice'))], flags: MessageFlags.Ephemeral });
        }

        const player = getGuildPlayer(guildId);
        if (!player || !player.currentTrack) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.nothing_playing'))], flags: MessageFlags.Ephemeral });
        }

        if (!isSameChannel(interaction, player)) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_same_channel'))], flags: MessageFlags.Ephemeral });
        }

        // BUG-17: exclude bots from member count
        const members = channel.members.filter(m => !m.user.bot);
        const humanMembers = members.size;
        const required = Math.max(1, Math.floor(humanMembers / 2));

        player.skipVotes.add(interaction.user.id);

        if (player.skipVotes.size >= required) {
            const title = player.currentTrack.title;
            player.skipVotes.clear();
            player.skip();
            await interaction.reply({ embeds: [messages.voteSkipPassed(guildId, title)] });
        } else {
            // BUG-01: uses info-style embed (voteSkipRegistered), not a missing method
            await interaction.reply({ embeds: [messages.voteSkipRegistered(guildId, player.skipVotes.size, required)] });
        }
    },
};

// ── 15. /clear <number> — BUG-04, BUG-16 ────────────────────────────

const clear = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Delete recent messages')
        .addIntegerOption(option =>
            option.setName('number').setDescription('Number of messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // BUG-04: ephemeral defer

        const guildId = interaction.guildId;
        const number = interaction.options.getInteger('number');

        // BUG-16: delete exactly `number` messages, NOT number+1
        const deleted = await interaction.channel.bulkDelete(number, true);

        await interaction.editReply({ embeds: [messages.messagesCleared(guildId, deleted.size)] });
    },
};

// ── 16. /list_playlists ──────────────────────────────────────────────

const listPlaylistsCmd = {
    data: new SlashCommandBuilder()
        .setName('list_playlists')
        .setDescription('List all saved playlists'),
    async execute(interaction) {
        const guildId = interaction.guildId;
        const playlists = listPlaylists(guildId);
        await interaction.reply({ embeds: [messages.playlistList(guildId, playlists)] });
    },
};

// ── 17. /queue ───────────────────────────────────────────────────────

const queue = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show the current queue'),
    async execute(interaction) {
        const guildId = interaction.guildId;
        const channel = getUserVoiceChannel(interaction);
        if (!channel) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_in_voice'))], flags: MessageFlags.Ephemeral });
        }

        const player = getGuildPlayer(guildId);
        if (!player || (!player.currentTrack && player.queue.length === 0)) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.queue_empty_nothing_playing'))], flags: MessageFlags.Ephemeral });
        }

        await interaction.reply({ embeds: [messages.queueList(guildId, player.queue, player.currentTrack)] });
    },
};

// ── 18. /nowplaying ──────────────────────────────────────────────────

const nowPlayingCmd = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Show the currently playing track'),
    async execute(interaction) {
        const guildId = interaction.guildId;
        const channel = getUserVoiceChannel(interaction);
        if (!channel) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_in_voice'))], flags: MessageFlags.Ephemeral });
        }

        const player = getGuildPlayer(guildId);
        if (!player || !player.currentTrack) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.nothing_currently_playing'))], flags: MessageFlags.Ephemeral });
        }

        await interaction.reply({ embeds: [messages.nowPlaying(guildId, player.currentTrack)] });
    },
};

// ── 19. /language ────────────────────────────────────────────────────

const language = {
    data: new SlashCommandBuilder()
        .setName('language')
        .setDescription('Change the bot language for this server')
        .addStringOption(opt =>
            opt.setName('lang')
                .setDescription('Language to use')
                .setRequired(false)
                .addChoices(
                    { name: '🇬🇧 English', value: 'en' },
                    { name: '🇩🇪 Deutsch', value: 'de' },
                    { name: '🇪🇸 Español', value: 'es' },
                ),
        ),
    async execute(interaction) {
        const lang = interaction.options.getString('lang');
        const guildId = interaction.guildId;

        if (!lang) {
            // Show current language
            const current = getLocale(guildId);
            const locales = getAvailableLocales();
            const currentInfo = locales.find(l => l.code === current);
            return interaction.reply({
                embeds: [messages.info(guildId, t(guildId, 'language.current', { language: `${currentInfo.flag} ${currentInfo.name}` }))],
                flags: MessageFlags.Ephemeral,
            });
        }

        setLocale(guildId, lang);
        // Reply in the NEW language
        return interaction.reply({
            embeds: [messages.success(guildId, t(guildId, 'language.changed', { language: t(guildId, 'locale.name') }))],
        });
    },
};

// ── Export all commands ──────────────────────────────────────────────

export default [
    join, leave, play, pause, resume, skip, stop, lyrics,
    help, volume, loop, addToPlaylistCmd, playPlaylist,
    voteSkip, clear, listPlaylistsCmd, queue, nowPlayingCmd,
    language,
];
