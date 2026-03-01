import { Client, GatewayIntentBits, Collection, Events, REST, Routes, MessageFlags } from 'discord.js';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import config from './config.js';
import commands from './commands/index.js';
import * as messages from './messages.js';
import { initSpotify } from './audio/spotify.js';
import { initLyrics } from './services/lyrics.js';
import { loadPlaylists } from './services/playlist.js';
import { logCookieStatus } from './audio/youtube.js';
import { t } from './i18n/index.js';
import { loadSettings } from './services/settings.js';

/**
 * Resolve FFmpeg's full path and ensure its directory is in process.env.PATH.
 * On Windows, child_process.spawn('ffmpeg') may fail to locate PATH executables
 * without shell: true. prism-media (used by @discordjs/voice) spawns FFmpeg this
 * way, so we resolve the path at startup and prepend it to PATH.
 *
 * Falls back to the ffmpeg-static npm package if FFmpeg is not found in PATH.
 */
async function resolveFFmpeg() {
    // Try 1: Check system PATH
    try {
        const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
        const ffmpegFullPath = execSync(cmd, { encoding: 'utf-8', shell: true }).trim().split(/\r?\n/)[0];
        if (ffmpegFullPath) {
            const ffmpegDir = dirname(ffmpegFullPath);
            const sep = process.platform === 'win32' ? ';' : ':';
            if (!process.env.PATH?.includes(ffmpegDir)) {
                process.env.PATH = ffmpegDir + sep + (process.env.PATH || '');
            }
            console.log(`🎵 FFmpeg found in PATH: ${ffmpegFullPath}`);
            return;
        }
    } catch { /* not in PATH */ }

    // Try 2: Use ffmpeg-static package
    try {
        const ffmpegStatic = await import('ffmpeg-static');
        const ffmpegPath = ffmpegStatic.default || ffmpegStatic;
        if (ffmpegPath) {
            process.env.FFMPEG_PATH = ffmpegPath;
            // Also add to PATH so spawn('ffmpeg') works
            const ffmpegDir = dirname(ffmpegPath);
            const sep = process.platform === 'win32' ? ';' : ':';
            process.env.PATH = ffmpegDir + sep + (process.env.PATH || '');
            console.log(`🎵 FFmpeg found via ffmpeg-static: ${ffmpegPath}`);
            return;
        }
    } catch { /* package not installed */ }

    console.warn('⚠️  FFmpeg not found. Install it or run: npm install ffmpeg-static');
}

/**
 * Resolve yt-dlp's location and add it to PATH if needed.
 * On Windows with winget installs, yt-dlp may live in a WinGet packages
 * directory that isn't in the shell's PATH. This mirrors resolveFFmpeg().
 */
function resolveYtDlp() {
    // Try 1: Check system PATH
    try {
        const cmd = process.platform === 'win32' ? 'where yt-dlp' : 'which yt-dlp';
        const ytdlpFullPath = execSync(cmd, { encoding: 'utf-8', shell: true }).trim().split(/\r?\n/)[0];
        if (ytdlpFullPath) {
            console.log(`🎵 yt-dlp found in PATH: ${ytdlpFullPath}`);
            return;
        }
    } catch { /* not in PATH */ }

    // Try 2: Check common winget install locations (Windows)
    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local');
        const wingetPkgs = join(localAppData, 'Microsoft', 'WinGet', 'Packages');

        try {
            if (existsSync(wingetPkgs)) {
                // Search for yt-dlp.exe inside winget packages
                const result = execSync(
                    `dir /s /b "${wingetPkgs}\\yt-dlp.exe"`,
                    { encoding: 'utf-8', shell: true }
                ).trim().split(/\r?\n/)[0];

                if (result && existsSync(result)) {
                    const ytdlpDir = dirname(result);
                    const sep = ';';
                    if (!process.env.PATH?.includes(ytdlpDir)) {
                        process.env.PATH = ytdlpDir + sep + (process.env.PATH || '');
                    }
                    console.log(`🎵 yt-dlp found via WinGet packages: ${result}`);
                    return;
                }
            }
        } catch { /* not found in winget packages */ }
    }

    console.warn('⚠️  yt-dlp not found. Install it: https://github.com/yt-dlp/yt-dlp#installation');
    console.warn('   Windows: winget install yt-dlp   |   Linux: sudo apt install yt-dlp');
}

async function main() {
    console.log('🎶 Starting Discord Music Bot...');

    // Resolve FFmpeg path before any audio operations (needed by @discordjs/voice / prism-media)
    await resolveFFmpeg();

    // Resolve yt-dlp path (needed for YouTube streaming and info)
    resolveYtDlp();

    // Initialize services
    console.log('Initializing Spotify...');
    await initSpotify(config.spotifyClientId, config.spotifyClientSecret);

    console.log('Initializing Genius Lyrics...');
    initLyrics(config.geniusAccessToken);

    console.log('Loading playlists...');
    await loadPlaylists();

    console.log('Loading guild settings...');
    loadSettings();

    console.log('Checking YouTube cookie auth...');
    logCookieStatus();

    // Create Discord client
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.MessageContent,
        ],
    });

    // Register commands in collection
    client.commands = new Collection();
    for (const command of commands) {
        client.commands.set(command.data.name, command);
    }

    // Handle interactions — robust error handling to prevent "Application didn't respond"
    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);
        if (!command) {
            // Unknown command — reply with error instead of silently ignoring
            const guildId = interaction.guildId;
            await interaction.reply({
                embeds: [messages.error(guildId, t(guildId, 'error.unknown_command', { command: interaction.commandName }))],
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`Error executing /${interaction.commandName}:`, error);
            const guildId = interaction.guildId;
            const embed = messages.error(guildId, error.message || t(guildId, 'error.unexpected'));
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                }
            } catch (replyError) {
                console.error('Failed to send error response:', replyError.message);
            }
        }
    });

    // BUG-09: Register slash commands ONCE on ready, use a flag to prevent re-registration
    let commandsRegistered = false;

    client.on(Events.ClientReady, async (c) => {
        console.log(`✅ Bot is ready! Logged in as ${c.user.tag}`);

        if (!commandsRegistered) {
            commandsRegistered = true;

            const rest = new REST().setToken(config.discordToken);
            const commandData = commands.map(cmd => cmd.data.toJSON());

            console.log(`Registering ${commandData.length} slash commands...`);
            try {
                await rest.put(
                    Routes.applicationCommands(c.user.id),
                    { body: commandData },
                );
                console.log(`✅ Successfully registered ${commandData.length} slash commands.`);
            } catch (err) {
                console.error('Failed to register slash commands:', err);
            }
        }
    });

    // Login
    await client.login(config.discordToken);
}

main().catch(console.error);
