import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import * as messages from '../messages.js';
import { getGuildPlayer, getOrCreateGuildPlayer, deleteGuildPlayer } from '../audio/player.js';
import { resolveQuery } from '../audio/resolver.js';
import { fetchLyrics } from '../services/lyrics.js';
import { addToPlaylist, getPlaylist, listPlaylists } from '../services/playlist.js';
import { t, getLocale, setLocale, getAvailableLocales } from '../i18n/index.js';
import {
    getSetting, setSetting, resetSetting, resetAllSettings,
    getGuildSettings, SETTINGS_SCHEMA,
} from '../services/settings.js';

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

// ── Settings Guards ──────────────────────────────────────────────────

/**
 * Check if DJ role is required and if the member has it.
 * Returns true if the member is allowed. Admins always bypass.
 * @param {string} guildId
 * @param {import('discord.js').GuildMember} member
 * @returns {boolean}
 */
function hasDjRole(guildId, member) {
    const djRoleId = getSetting(guildId, 'dj_role');
    if (!djRoleId) return true; // No DJ role configured — everyone can use commands
    if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true; // Admins bypass
    return member.roles.cache.has(djRoleId);
}

/**
 * Reply with a DJ role error. Returns true if the check failed (command should stop).
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string} guildId
 * @returns {Promise<boolean>} true if blocked
 */
async function requireDJ(interaction, guildId) {
    if (hasDjRole(guildId, interaction.member)) return false;
    const djRoleId = getSetting(guildId, 'dj_role');
    const role = interaction.guild?.roles?.cache?.get(djRoleId);
    const roleName = role ? role.name : 'DJ';
    await interaction.reply({
        embeds: [messages.error(guildId, t(guildId, 'error.dj_role_required', { role: roleName }))],
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

/**
 * Check if commands are restricted to a specific text channel.
 * Returns true if blocked (command should stop).
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string} guildId
 * @returns {Promise<boolean>} true if blocked
 */
async function checkChannelRestriction(interaction, guildId) {
    const restrictedChannel = getSetting(guildId, 'restricted_text_channel');
    if (!restrictedChannel) return false; // No restriction
    if (interaction.channelId === restrictedChannel) return false; // Correct channel
    // Admins bypass
    if (interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return false;
    await interaction.reply({
        embeds: [messages.error(guildId, t(guildId, 'error.channel_not_allowed'))],
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

/**
 * Check if the user's voice channel is the restricted one.
 * Returns true if blocked (command should stop).
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string} guildId
 * @param {import('discord.js').VoiceChannel} voiceChannel - The user's voice channel
 * @param {boolean} [deferred=false] - Whether the interaction has been deferred
 * @returns {Promise<boolean>} true if blocked
 */
async function checkVoiceRestriction(interaction, guildId, voiceChannel, deferred = false) {
    const restrictedVoice = getSetting(guildId, 'restricted_voice_channel');
    if (!restrictedVoice) return false; // No restriction
    if (voiceChannel.id === restrictedVoice) return false; // Correct channel
    // Admins bypass
    if (interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return false;
    const replyFn = deferred ? 'editReply' : 'reply';
    const opts = { embeds: [messages.error(guildId, t(guildId, 'error.voice_channel_not_allowed'))] };
    if (!deferred) opts.flags = MessageFlags.Ephemeral;
    await interaction[replyFn](opts);
    return true;
}

// ── 1. /join ─────────────────────────────────────────────────────────

const join = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Join your voice channel'),
    async execute(interaction) {
        const guildId = interaction.guildId;

        // Channel restriction check
        if (await checkChannelRestriction(interaction, guildId)) return;

        const channel = getUserVoiceChannel(interaction);
        if (!channel) {
            return interaction.reply({ embeds: [messages.error(guildId, t(guildId, 'error.not_in_voice'))], flags: MessageFlags.Ephemeral });
        }

        // Voice channel restriction
        if (await checkVoiceRestriction(interaction, guildId, channel)) return;

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

        // Channel restriction check
        if (await checkChannelRestriction(interaction, guildId)) return;

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

        // Channel restriction check (deferred)
        const restrictedChannel = getSetting(guildId, 'restricted_text_channel');
        if (restrictedChannel && interaction.channelId !== restrictedChannel
            && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.editReply({ embeds: [messages.error(guildId, t(guildId, 'error.channel_not_allowed'))] });
        }

        const channel = getUserVoiceChannel(interaction);
        if (!channel) {
            return interaction.editReply({ embeds: [messages.error(guildId, t(guildId, 'error.not_in_voice'))] });
        }

        // Voice channel restriction (deferred)
        if (await checkVoiceRestriction(interaction, guildId, channel, true)) return;

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

        try {
            const track = await resolveQuery(query);
            const result = await player.addTrack(track, interaction);

            if (result === 'queued') {
                await interaction.editReply({ embeds: [messages.addedToQueue(guildId, track, player.queue.length)] });
            }
            // When 'playing', the "Now Playing" embed is already sent as the interaction reply by the player
        } catch (err) {
            return interaction.editReply({
                embeds: [messages.error(guildId, err.message)],
            });
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

        if (await checkChannelRestriction(interaction, guildId)) return;
        if (await requireDJ(interaction, guildId)) return;

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

        if (await checkChannelRestriction(interaction, guildId)) return;
        if (await requireDJ(interaction, guildId)) return;

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

        if (await checkChannelRestriction(interaction, guildId)) return;
        if (await requireDJ(interaction, guildId)) return;

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

        if (await checkChannelRestriction(interaction, guildId)) return;
        if (await requireDJ(interaction, guildId)) return;

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

        // Channel restriction check (deferred)
        const restrictedChannel = getSetting(guildId, 'restricted_text_channel');
        if (restrictedChannel && interaction.channelId !== restrictedChannel
            && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.editReply({ embeds: [messages.error(guildId, t(guildId, 'error.channel_not_allowed'))] });
        }

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

        if (await checkChannelRestriction(interaction, guildId)) return;
        if (await requireDJ(interaction, guildId)) return;

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

        if (await checkChannelRestriction(interaction, guildId)) return;
        if (await requireDJ(interaction, guildId)) return;

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

        // Channel restriction check (deferred)
        const restrictedChannel = getSetting(guildId, 'restricted_text_channel');
        if (restrictedChannel && interaction.channelId !== restrictedChannel
            && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.editReply({ embeds: [messages.error(guildId, t(guildId, 'error.channel_not_allowed'))] });
        }

        const channel = getUserVoiceChannel(interaction);
        if (!channel) {
            return interaction.editReply({ embeds: [messages.error(guildId, t(guildId, 'error.not_in_voice'))] });
        }

        // Voice channel restriction (deferred)
        if (await checkVoiceRestriction(interaction, guildId, channel, true)) return;

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
                const track = await resolveQuery(entry.url);
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

        if (await checkChannelRestriction(interaction, guildId)) return;

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
        // Per-guild vote skip threshold
        const threshold = getSetting(guildId, 'vote_skip_threshold') / 100;
        const required = Math.max(1, Math.ceil(humanMembers * threshold));

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

        if (await checkChannelRestriction(interaction, guildId)) return;

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

        if (await checkChannelRestriction(interaction, guildId)) return;

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

// ── 20. /settings ────────────────────────────────────────────────────

const settings = {
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Manage bot settings for this server')
        .addSubcommand(sub => sub
            .setName('view')
            .setDescription('View current settings'))
        .addSubcommand(sub => sub
            .setName('audio')
            .setDescription('Configure audio settings')
            .addIntegerOption(opt => opt.setName('default_volume').setDescription('Default volume (1-100)').setMinValue(1).setMaxValue(100).setRequired(false))
            .addIntegerOption(opt => opt.setName('max_queue_size').setDescription('Max queue size (10-500)').setMinValue(10).setMaxValue(500).setRequired(false))
            .addIntegerOption(opt => opt.setName('inactivity_timeout').setDescription('Inactivity timeout in seconds (30-600)').setMinValue(30).setMaxValue(600).setRequired(false))
            .addIntegerOption(opt => opt.setName('max_song_duration').setDescription('Max song duration in seconds (0=unlimited, 60-3600)').setMinValue(0).setMaxValue(3600).setRequired(false))
        )
        .addSubcommand(sub => sub
            .setName('moderation')
            .setDescription('Configure moderation settings')
            .addIntegerOption(opt => opt.setName('vote_skip_threshold').setDescription('Vote skip threshold percentage (1-100)').setMinValue(1).setMaxValue(100).setRequired(false))
            .addRoleOption(opt => opt.setName('dj_role').setDescription('DJ role (users with this role can manage playback)').setRequired(false))
            .addChannelOption(opt => opt.setName('text_channel').setDescription('Restrict commands to this text channel').addChannelTypes(ChannelType.GuildText).setRequired(false))
            .addChannelOption(opt => opt.setName('voice_channel').setDescription('Restrict bot to this voice channel').addChannelTypes(ChannelType.GuildVoice).setRequired(false))
        )
        .addSubcommand(sub => sub
            .setName('display')
            .setDescription('Configure display settings')
            .addStringOption(opt => opt.setName('embed_color').setDescription('Embed color as hex (e.g. #8b5cf6)').setRequired(false))
        )
        .addSubcommand(sub => sub
            .setName('reset')
            .setDescription('Reset settings to defaults')
            .addStringOption(opt => opt.setName('setting').setDescription('Setting to reset (leave empty for all)').setRequired(false)
                .addChoices(
                    { name: 'Default Volume', value: 'default_volume' },
                    { name: 'Max Queue Size', value: 'max_queue_size' },
                    { name: 'Inactivity Timeout', value: 'inactivity_timeout' },
                    { name: 'Max Song Duration', value: 'max_song_duration' },
                    { name: 'Vote Skip Threshold', value: 'vote_skip_threshold' },
                    { name: 'DJ Role', value: 'dj_role' },
                    { name: 'Text Channel', value: 'restricted_text_channel' },
                    { name: 'Voice Channel', value: 'restricted_voice_channel' },
                    { name: 'Embed Color', value: 'embed_color' },
                )
            )
        ),
    async execute(interaction) {
        const guildId = interaction.guildId;

        // Permission check: ManageGuild required
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({
                embeds: [messages.error(guildId, t(guildId, 'error.no_permission'))],
                flags: MessageFlags.Ephemeral,
            });
        }

        const sub = interaction.options.getSubcommand();

        switch (sub) {
            // ── view ─────────────────────────────────────────────
            case 'view': {
                const allSettings = getGuildSettings(guildId);
                const embed = messages.settingsView(guildId, allSettings, interaction.guild);
                return interaction.reply({ embeds: [embed] });
            }

            // ── audio ────────────────────────────────────────────
            case 'audio': {
                const changes = [];
                const defaultVol = interaction.options.getInteger('default_volume');
                const maxQueue = interaction.options.getInteger('max_queue_size');
                const inactivity = interaction.options.getInteger('inactivity_timeout');
                const maxDuration = interaction.options.getInteger('max_song_duration');

                if (defaultVol !== null) {
                    setSetting(guildId, 'default_volume', defaultVol);
                    changes.push(t(guildId, 'settings.default_volume.set', { value: defaultVol }));
                }
                if (maxQueue !== null) {
                    setSetting(guildId, 'max_queue_size', maxQueue);
                    changes.push(t(guildId, 'settings.max_queue_size.set', { value: maxQueue }));
                }
                if (inactivity !== null) {
                    setSetting(guildId, 'inactivity_timeout', inactivity);
                    changes.push(t(guildId, 'settings.inactivity_timeout.set', { value: inactivity }));
                }
                if (maxDuration !== null) {
                    setSetting(guildId, 'max_song_duration', maxDuration);
                    if (maxDuration === 0) {
                        changes.push(t(guildId, 'settings.max_song_duration.set_unlimited'));
                    } else {
                        changes.push(t(guildId, 'settings.max_song_duration.set', { value: maxDuration }));
                    }
                }

                if (changes.length === 0) {
                    return interaction.reply({
                        embeds: [messages.info(guildId, t(guildId, 'settings.no_changes'))],
                        flags: MessageFlags.Ephemeral,
                    });
                }

                return interaction.reply({
                    embeds: [messages.success(guildId, changes.join('\n'))],
                });
            }

            // ── moderation ───────────────────────────────────────
            case 'moderation': {
                const changes = [];
                const voteThreshold = interaction.options.getInteger('vote_skip_threshold');
                const djRole = interaction.options.getRole('dj_role');
                const textChannel = interaction.options.getChannel('text_channel');
                const voiceChannel = interaction.options.getChannel('voice_channel');

                if (voteThreshold !== null) {
                    setSetting(guildId, 'vote_skip_threshold', voteThreshold);
                    changes.push(t(guildId, 'settings.vote_skip_threshold.set', { value: voteThreshold }));
                }
                if (djRole !== undefined && djRole !== null) {
                    setSetting(guildId, 'dj_role', djRole.id);
                    changes.push(t(guildId, 'settings.dj_role.set', { role: djRole.name }));
                }
                if (textChannel !== undefined && textChannel !== null) {
                    setSetting(guildId, 'restricted_text_channel', textChannel.id);
                    changes.push(t(guildId, 'settings.restricted_text_channel.set', { channel: `#${textChannel.name}` }));
                }
                if (voiceChannel !== undefined && voiceChannel !== null) {
                    setSetting(guildId, 'restricted_voice_channel', voiceChannel.id);
                    changes.push(t(guildId, 'settings.restricted_voice_channel.set', { channel: voiceChannel.name }));
                }

                if (changes.length === 0) {
                    return interaction.reply({
                        embeds: [messages.info(guildId, t(guildId, 'settings.no_changes'))],
                        flags: MessageFlags.Ephemeral,
                    });
                }

                return interaction.reply({
                    embeds: [messages.success(guildId, changes.join('\n'))],
                });
            }

            // ── display ──────────────────────────────────────────
            case 'display': {
                const embedColor = interaction.options.getString('embed_color');

                if (!embedColor) {
                    return interaction.reply({
                        embeds: [messages.info(guildId, t(guildId, 'settings.no_changes'))],
                        flags: MessageFlags.Ephemeral,
                    });
                }

                // Validate hex color
                const hexRe = /^#[0-9A-Fa-f]{6}$/;
                if (!hexRe.test(embedColor)) {
                    return interaction.reply({
                        embeds: [messages.error(guildId, t(guildId, 'settings.embed_color.invalid'))],
                        flags: MessageFlags.Ephemeral,
                    });
                }

                setSetting(guildId, 'embed_color', embedColor.toLowerCase());
                return interaction.reply({
                    embeds: [messages.success(guildId, t(guildId, 'settings.embed_color.set', { value: embedColor }))],
                });
            }

            // ── reset ────────────────────────────────────────────
            case 'reset': {
                const settingKey = interaction.options.getString('setting');

                if (!settingKey) {
                    // Reset all settings
                    resetAllSettings(guildId);
                    return interaction.reply({
                        embeds: [messages.success(guildId, t(guildId, 'settings.reset.all'))],
                    });
                }

                // Reset a specific setting
                if (!SETTINGS_SCHEMA[settingKey]) {
                    return interaction.reply({
                        embeds: [messages.error(guildId, t(guildId, 'error.invalid_setting', { key: settingKey }))],
                        flags: MessageFlags.Ephemeral,
                    });
                }

                resetSetting(guildId, settingKey);
                const settingName = t(guildId, `settings.${settingKey}.name`);
                return interaction.reply({
                    embeds: [messages.success(guildId, t(guildId, 'settings.reset.single', { setting: settingName }))],
                });
            }
        }
    },
};

// ── Export all commands ──────────────────────────────────────────────

export default [
    join, leave, play, pause, resume, skip, stop, lyrics,
    help, volume, loop, addToPlaylistCmd, playPlaylist,
    voteSkip, clear, listPlaylistsCmd, queue, nowPlayingCmd,
    language, settings,
];
