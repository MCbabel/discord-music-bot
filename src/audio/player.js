import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    NoSubscriberBehavior,
    StreamType,
} from '@discordjs/voice';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { createAudioStream } from './stream.js';
import * as messages from '../messages.js';
import { t } from '../i18n/index.js';
import config from '../config.js';

// Store all guild players: Map<guildId, GuildPlayer>
const guildPlayers = new Map();

/**
 * Get the GuildPlayer for a specific guild, or undefined if none exists.
 * @param {string} guildId
 * @returns {GuildPlayer|undefined}
 */
export function getGuildPlayer(guildId) {
    return guildPlayers.get(guildId);
}

/**
 * Get the GuildPlayer for a guild, creating one if it doesn't exist.
 * @param {string} guildId
 * @returns {GuildPlayer}
 */
export function getOrCreateGuildPlayer(guildId) {
    if (!guildPlayers.has(guildId)) {
        guildPlayers.set(guildId, new GuildPlayer(guildId));
    }
    return guildPlayers.get(guildId);
}

/**
 * Delete and destroy a GuildPlayer.
 * @param {string} guildId
 */
export function deleteGuildPlayer(guildId) {
    const player = guildPlayers.get(guildId);
    if (player) {
        player.destroy();
        guildPlayers.delete(guildId);
    }
}

/**
 * Per-guild audio player managing queue, playback, and voice connection.
 *
 * Addresses:
 * - BUG-11 (skip_votes cleared on song change)
 * - BUG-13 (/leave cleans up state)
 * - BUG-14 (volume persists across songs)
 * - BUG-19 (async callbacks, no blocking)
 * - BUG-27 (cleanup on inactivity)
 * - BUG-31 (queue limit)
 * - BUG-32 (handle deleted messages)
 * - BUG-33 (button timeout)
 */
class GuildPlayer {
    constructor(guildId) {
        this.guildId = guildId;
        this.queue = [];
        this.currentTrack = null;
        this.volume = config.defaultVolume / 100; // 0.0-1.0
        this.isLooping = false;
        this.isPaused = false;
        this.skipVotes = new Set();
        this.connection = null;
        this.audioPlayer = null;
        this.currentResource = null;
        this.textChannel = null; // Channel to send "Now Playing" messages
        this.nowPlayingMessage = null;
        this._nowPlayingCollector = null; // Button collector reference for cleanup
        this.inactivityTimer = null;
        this._currentProcess = null; // yt-dlp subprocess reference for cleanup
        this._isLoopReplay = false; // Flag to suppress duplicate "Now Playing" on loop
    }

    /**
     * Connect to a voice channel.
     * @param {import('discord.js').VoiceChannel} voiceChannel
     * @param {import('discord.js').TextChannel} textChannel
     */
    connect(voiceChannel, textChannel) {
        this.textChannel = textChannel;

        this.connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: this.guildId,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });

        this.audioPlayer = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play,
            },
        });

        this.connection.subscribe(this.audioPlayer);

        // Handle player state changes
        this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
            this._onTrackEnd();
        });

        this.audioPlayer.on('error', (error) => {
            console.error(`Audio error in guild ${this.guildId}:`, error.message);
            this._onTrackEnd();
        });

        // Handle connection disconnect
        this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
                // Reconnecting...
            } catch {
                // Truly disconnected
                this.destroy();
                guildPlayers.delete(this.guildId);
            }
        });

        this._clearInactivityTimer();
    }

    /**
     * Add a track to the queue and play if nothing is playing.
     * Addresses BUG-31 (queue limit).
     * @param {{title: string, artist: string, duration: number, thumbnailUrl: string|null, url: string}} track
     * @param {import('discord.js').ChatInputCommandInteraction|null} interaction - Optional interaction to reply to
     * @returns {Promise<'playing'|'queued'>}
     */
    async addTrack(track, interaction = null) {
        const status = this.audioPlayer?.state.status;
        const isActive = this.currentTrack && (
            status === AudioPlayerStatus.Playing ||
            status === AudioPlayerStatus.Buffering ||
            status === AudioPlayerStatus.Paused
        );
        if (isActive) {
            if (this.queue.length >= config.maxQueueSize) {
                throw new Error(`Queue is full (max ${config.maxQueueSize} tracks).`);
            }
            this.queue.push(track);
            return 'queued';
        } else {
            await this._playTrack(track, interaction);
            return 'playing';
        }
    }

    /**
     * Play a specific track.
     * @param {{title: string, artist: string, duration: number, thumbnailUrl: string|null, url: string}} track
     * @param {import('discord.js').ChatInputCommandInteraction|null} interaction - Optional interaction to reply to
     */
    async _playTrack(track, interaction = null) {
        this._clearInactivityTimer();
        this.skipVotes.clear(); // BUG-11 fix: clear votes on song change
        this.currentTrack = track;
        this.isPaused = false;

        const isLoopReplay = this._isLoopReplay;
        this._isLoopReplay = false;

        try {
            this._killCurrentProcess(); // Kill any lingering subprocess
            const audioStream = await createAudioStream(track);
            this._currentProcess = audioStream.process;
            this.currentResource = createAudioResource(audioStream.stream, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true,
            });
            this.currentResource.volume?.setVolume(this.volume); // BUG-14: apply persisted volume
            this.audioPlayer.play(this.currentResource);

            if (isLoopReplay) {
                // Update existing "Now Playing" message with loop indicator instead of sending a new one
                await this._updateNowPlayingLoop(track);
            } else {
                // Send "Now Playing" embed with buttons
                await this._sendNowPlaying(track, interaction);
            }
        } catch (err) {
            console.error('Error playing track:', err.message);
            this._onTrackEnd(); // Skip to next
        }
    }

    /**
     * Handle track end — play next or start inactivity timer.
     * Addresses BUG-11 (clear votes), BUG-19 (async, non-blocking).
     */
    async _onTrackEnd() {
        this.skipVotes.clear(); // BUG-11

        if (this.isLooping && this.currentTrack) {
            // Re-play the same track — keep existing "Now Playing" message
            this._isLoopReplay = true;
            await this._playTrack(this.currentTrack);
        } else {
            // Disable buttons on old "Now Playing" message (BUG-32: handle deleted messages)
            await this._disableNowPlayingButtons();

            if (this.queue.length > 0) {
                const nextTrack = this.queue.shift();
                await this._playTrack(nextTrack);
            } else {
                // Queue empty
                this.currentTrack = null;
                this._startInactivityTimer(); // BUG-27: auto-cleanup

                if (this.textChannel) {
                    try {
                        await this.textChannel.send({ embeds: [messages.info(this.guildId, t(this.guildId, 'player.queue_finished'))] });
                    } catch { /* channel might not exist anymore */ }
                }
            }
        }
    }

    /**
     * Build the button row for the "Now Playing" message.
     * The pause/resume button toggles based on current playback state.
     * @returns {ActionRowBuilder}
     */
    _buildNowPlayingButtons() {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('pause_resume')
                .setLabel(this.isPaused ? '▶️' : '⏸️')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('skip').setLabel('⏭️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('loop').setLabel('🔁').setStyle(ButtonStyle.Secondary),
        );
    }

    /**
     * Send "Now Playing" embed with interactive buttons.
     * If an interaction is provided (from /play), uses interaction.editReply() so the
     * "Now Playing" message appears as the command reply (showing who requested it).
     * For auto-advance (no interaction), falls back to channel.send().
     * Includes button collector with timeout (BUG-33 fix).
     * @param {{title: string, artist: string, duration: number, thumbnailUrl: string|null, url: string}} track
     * @param {import('discord.js').ChatInputCommandInteraction|null} interaction - Optional interaction to reply to
     */
    async _sendNowPlaying(track, interaction = null) {
        if (!interaction && !this.textChannel) return;

        // Stop the old collector before creating a new one (prevents stale collectors
        // from disabling the new message's buttons)
        if (this._nowPlayingCollector) {
            try { this._nowPlayingCollector.stop('replaced'); } catch { /* already stopped */ }
            this._nowPlayingCollector = null;
        }

        const embed = messages.nowPlaying(this.guildId, track);
        const row = this._buildNowPlayingButtons();

        try {
            if (interaction) {
                // Reply to the /play command so the user's name/avatar is shown
                this.nowPlayingMessage = await interaction.editReply({
                    embeds: [embed],
                    components: [row],
                });
            } else {
                // Auto-advance: send as a standalone channel message
                this.nowPlayingMessage = await this.textChannel.send({
                    embeds: [embed],
                    components: [row],
                });
            }

            // Capture reference to THIS specific message for the collector's end handler
            const thisMessage = this.nowPlayingMessage;

            // Set up button collector with timeout (BUG-33 fix)
            // Guard with Math.max to prevent TimeoutNegativeWarning
            const collectorTime = Math.max(60_000, 600_000);
            const collector = this.nowPlayingMessage.createMessageComponentCollector({
                time: collectorTime,
            });
            this._nowPlayingCollector = collector;

            collector.on('collect', async (interaction) => {
                // Check if user is in same voice channel (BUG-12)
                const member = interaction.member;
                const userChannel = member?.voice?.channelId;
                const botChannel = this.connection?.joinConfig?.channelId;

                if (userChannel !== botChannel) {
                    await interaction.reply({
                        embeds: [messages.error(this.guildId, t(this.guildId, 'player.button_not_same_channel'))],
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                switch (interaction.customId) {
                    case 'pause_resume':
                        if (this.isPaused) {
                            this.resume();
                        } else {
                            this.pause();
                        }
                        // Update the button in-place to reflect new state
                        await interaction.update({
                            components: [this._buildNowPlayingButtons()],
                        });
                        break;
                    case 'skip':
                        this.skip();
                        await interaction.reply({ embeds: [messages.skipped(this.guildId, this.currentTrack?.title || t(this.guildId, 'now_playing.unknown'))], flags: MessageFlags.Ephemeral });
                        break;
                    case 'loop':
                        this.isLooping = !this.isLooping;
                        // Update the "Now Playing" embed in-place with/without the loop footer
                        const currentEmbed = interaction.message.embeds[0];
                        const updatedEmbed = EmbedBuilder.from(currentEmbed);
                        if (this.isLooping) {
                            updatedEmbed.setFooter({ text: '🔁 Looping' });
                        } else {
                            updatedEmbed.setFooter(null);
                        }
                        await interaction.update({
                            embeds: [updatedEmbed],
                            components: [this._buildNowPlayingButtons()],
                        });
                        break;
                }
            });

            collector.on('end', (_collected, reason) => {
                // Only disable buttons if this collector's message is still the current
                // now-playing message and wasn't replaced by a newer one
                if (reason !== 'replaced' && this.nowPlayingMessage === thisMessage) {
                    this._disableNowPlayingButtons();
                }
            });
        } catch (err) {
            console.error('Error sending now playing:', err.message);
        }
    }

    /**
     * Update existing "Now Playing" message with a loop indicator instead of sending a new one.
     * Falls back to sending a new message if the existing one was deleted.
     * @param {{title: string, artist: string, duration: number, thumbnailUrl: string|null, url: string}} track
     */
    async _updateNowPlayingLoop(track) {
        if (!this.nowPlayingMessage) {
            // Fallback: if no existing message, send a new one
            await this._sendNowPlaying(track);
            return;
        }

        try {
            const embed = messages.nowPlaying(this.guildId, track);
            embed.setFooter({ text: '🔁 Looping' });
            const row = this._buildNowPlayingButtons();
            await this.nowPlayingMessage.edit({ embeds: [embed], components: [row] });
        } catch {
            // Message was deleted — send a fresh one
            await this._sendNowPlaying(track);
        }
    }

    /**
     * Disable buttons on the "Now Playing" message. (BUG-32 fix)
     */
    async _disableNowPlayingButtons() {
        if (!this.nowPlayingMessage) return;
        try {
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('pause_resume').setLabel('⏸️').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('skip').setLabel('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('loop').setLabel('🔁').setStyle(ButtonStyle.Secondary).setDisabled(true),
            );
            await this.nowPlayingMessage.edit({ components: [disabledRow] });
        } catch {
            // Message was deleted (BUG-32 fix: just ignore)
        }
        this.nowPlayingMessage = null;
    }

    /** Pause the audio player. */
    pause() {
        if (this.audioPlayer) {
            this.audioPlayer.pause();
            this.isPaused = true;
        }
    }

    /** Resume the audio player. */
    resume() {
        if (this.audioPlayer) {
            this.audioPlayer.unpause();
            this.isPaused = false;
        }
    }

    /** Skip the current track (triggers 'idle' event → _onTrackEnd). */
    skip() {
        if (this.audioPlayer) {
            this.audioPlayer.stop(); // Triggers 'idle' event → _onTrackEnd
        }
    }

    /**
     * Stop playback and clear queue. (BUG-13 fix)
     */
    stop() {
        this.queue = [];
        this.currentTrack = null;
        this.isLooping = false;
        this.isPaused = false;
        this.skipVotes.clear();
        this._killCurrentProcess();
        if (this.audioPlayer) {
            this.audioPlayer.stop();
        }
    }

    /**
     * Set volume (0-100). Persists across songs. (BUG-14 fix)
     * @param {number} percent - Volume level 0-100
     */
    setVolume(percent) {
        this.volume = percent / 100;
        if (this.currentResource?.volume) {
            this.currentResource.volume.setVolume(this.volume);
        }
    }

    /**
     * Kill the current yt-dlp subprocess if running.
     */
    _killCurrentProcess() {
        if (this._currentProcess) {
            try {
                this._currentProcess.kill();
            } catch { /* already exited */ }
            this._currentProcess = null;
        }
    }

    /**
     * Disconnect and clean up all state. (BUG-13 fix)
     */
    destroy() {
        this._clearInactivityTimer();
        this.stop();
        this._disableNowPlayingButtons();
        if (this.connection) {
            try {
                this.connection.destroy();
            } catch { /* already destroyed */ }
        }
        this.connection = null;
        this.audioPlayer = null;
    }

    /**
     * Reset state without disconnecting (for /stop).
     * Note: volume intentionally preserved (BUG-14).
     */
    reset() {
        this.queue = [];
        this.currentTrack = null;
        this.isLooping = false;
        this.isPaused = false;
        this.skipVotes.clear();
    }

    /**
     * Start inactivity timer. (BUG-27 fix)
     */
    _startInactivityTimer() {
        this._clearInactivityTimer();
        // Guard with Math.max to prevent TimeoutNegativeWarning (Node.js warns on negative setTimeout values)
        const timeout = Math.max(1_000, config.inactivityTimeout);
        this.inactivityTimer = setTimeout(() => {
            if (!this.currentTrack && this.queue.length === 0) {
                if (this.textChannel) {
                    this.textChannel.send({ embeds: [messages.disconnected(this.guildId)] }).catch(() => {});
                }
                this.destroy();
                guildPlayers.delete(this.guildId);
            }
        }, timeout);
    }

    /** Clear the inactivity timer if running. */
    _clearInactivityTimer() {
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }
    }
}

export default { getGuildPlayer, getOrCreateGuildPlayer, deleteGuildPlayer };
