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
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { createYouTubeStream } from './youtube.js';
import * as messages from '../messages.js';
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
        this.inactivityTimer = null;
        this._currentProcess = null; // yt-dlp subprocess reference for cleanup
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
     * @returns {Promise<'playing'|'queued'>}
     */
    async addTrack(track) {
        if (this.currentTrack && this.audioPlayer?.state.status === AudioPlayerStatus.Playing) {
            if (this.queue.length >= config.maxQueueSize) {
                throw new Error(`Queue is full (max ${config.maxQueueSize} tracks).`);
            }
            this.queue.push(track);
            return 'queued';
        } else {
            await this._playTrack(track);
            return 'playing';
        }
    }

    /**
     * Play a specific track.
     * @param {{title: string, artist: string, duration: number, thumbnailUrl: string|null, url: string}} track
     */
    async _playTrack(track) {
        this._clearInactivityTimer();
        this.skipVotes.clear(); // BUG-11 fix: clear votes on song change
        this.currentTrack = track;
        this.isPaused = false;

        try {
            this._killCurrentProcess(); // Kill any lingering yt-dlp process
            const ytStream = await createYouTubeStream(track.url);
            this._currentProcess = ytStream.process;
            this.currentResource = createAudioResource(ytStream.stream, {
                inputType: StreamType.Arbitrary,
                inlineVolume: true,
            });
            this.currentResource.volume?.setVolume(this.volume); // BUG-14: apply persisted volume
            this.audioPlayer.play(this.currentResource);

            // Send "Now Playing" embed with buttons
            await this._sendNowPlaying(track);
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

        // Disable buttons on old "Now Playing" message (BUG-32: handle deleted messages)
        await this._disableNowPlayingButtons();

        if (this.isLooping && this.currentTrack) {
            // Re-play the same track
            await this._playTrack(this.currentTrack);
        } else if (this.queue.length > 0) {
            const nextTrack = this.queue.shift();
            await this._playTrack(nextTrack);
        } else {
            // Queue empty
            this.currentTrack = null;
            this._startInactivityTimer(); // BUG-27: auto-cleanup

            if (this.textChannel) {
                try {
                    await this.textChannel.send({ embeds: [messages.info('Queue finished. Disconnecting in 3 minutes if idle.')] });
                } catch { /* channel might not exist anymore */ }
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
     * Includes button collector with timeout (BUG-33 fix).
     * @param {{title: string, artist: string, duration: number, thumbnailUrl: string|null, url: string}} track
     */
    async _sendNowPlaying(track) {
        if (!this.textChannel) return;

        const embed = messages.nowPlaying(track);
        const row = this._buildNowPlayingButtons();

        try {
            this.nowPlayingMessage = await this.textChannel.send({
                embeds: [embed],
                components: [row],
            });

            // Set up button collector with timeout (BUG-33 fix)
            const collector = this.nowPlayingMessage.createMessageComponentCollector({
                time: 600_000, // 10 minute timeout
            });

            collector.on('collect', async (interaction) => {
                // Check if user is in same voice channel (BUG-12)
                const member = interaction.member;
                const userChannel = member?.voice?.channelId;
                const botChannel = this.connection?.joinConfig?.channelId;

                if (userChannel !== botChannel) {
                    await interaction.reply({
                        embeds: [messages.error('You must be in the same voice channel.')],
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
                        await interaction.reply({ embeds: [messages.skipped(this.currentTrack?.title || 'Unknown')], flags: MessageFlags.Ephemeral });
                        break;
                    case 'loop':
                        this.isLooping = !this.isLooping;
                        await interaction.reply({
                            embeds: [this.isLooping ? messages.loopOn() : messages.loopOff()],
                            flags: MessageFlags.Ephemeral,
                        });
                        break;
                }
            });

            collector.on('end', () => {
                this._disableNowPlayingButtons();
            });
        } catch (err) {
            console.error('Error sending now playing:', err.message);
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
        this.inactivityTimer = setTimeout(() => {
            if (!this.currentTrack && this.queue.length === 0) {
                if (this.textChannel) {
                    this.textChannel.send({ embeds: [messages.disconnected()] }).catch(() => {});
                }
                this.destroy();
                guildPlayers.delete(this.guildId);
            }
        }, config.inactivityTimeout);
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
