# 🎶 Discord Music Bot

A feature-rich Discord music bot built with **discord.js v14** and **Node.js**. Supports YouTube and Spotify playback, lyrics fetching via Genius, custom playlists, queue management, and more — all through modern slash commands.

## Table of Contents

- [Features](#features)
- [Commands](#commands)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running](#running)
- [YouTube Authentication (cookies.txt)](#youtube-authentication-cookiestxt)
- [Getting Spotify Credentials](#getting-spotify-credentials)
- [Getting a Genius API Key](#getting-a-genius-api-key)
- [Discord Bot Permissions](#discord-bot-permissions)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🎵 **YouTube Playback** — Play any song or video from YouTube via URL or search query
- 🟢 **Spotify Integration** — Paste a Spotify track link and the bot resolves it to YouTube for playback
- 📜 **Lyrics Fetching** — Retrieve song lyrics from the Genius API
- 📋 **Queue Management** — View, skip, loop, and control the playback queue
- 🔊 **Volume Control** — Adjust playback volume from 0–100%
- 🗳️ **Vote Skip** — Democratic skip voting for shared listening sessions
- 🎶 **Custom Playlists** — Save and play user-created playlists
- ⏱️ **Now Playing** — See what's currently playing with track details
- 🤖 **Auto-Disconnect** — Leaves the voice channel after 3 minutes of inactivity
- 🧹 **Message Cleanup** — Bulk-delete messages with the `/clear` command

## Commands

### 🎵 Music

| Command | Description |
|---|---|
| `/play <query>` | Play a song by name, YouTube URL, or Spotify link |
| `/pause` | Pause the current playback |
| `/resume` | Resume paused playback |
| `/skip` | Skip the current track |
| `/stop` | Stop playback and clear the queue |
| `/queue` | Show the current queue |
| `/nowplaying` | Show the currently playing track |

### 🔊 Controls

| Command | Description |
|---|---|
| `/volume <percent>` | Set the playback volume (0–100) |
| `/loop <on/off>` | Toggle loop for the current track |
| `/vote_skip` | Vote to skip the current track |

### 📜 Lyrics

| Command | Description |
|---|---|
| `/lyrics` | Fetch lyrics for the currently playing song |

### 🎶 Playlists

| Command | Description |
|---|---|
| `/add_to_playlist <name> <url>` | Add a song to a custom playlist |
| `/play_playlist <name>` | Play a saved playlist |
| `/list_playlists` | List all saved playlists |

### 🔗 Voice

| Command | Description |
|---|---|
| `/join` | Join your voice channel |
| `/leave` | Leave the voice channel |

### 🧹 Utility

| Command | Description |
|---|---|
| `/clear <number>` | Delete recent messages (1–100, requires Manage Messages) |
| `/help` | Show all available commands |

## Prerequisites

Before running the bot, make sure you have the following installed:

| Requirement | Details |
|---|---|
| **Node.js** | v18.0.0 or higher — [Download](https://nodejs.org/) |
| **yt-dlp** | Must be installed and available in your system PATH — [Install guide](https://github.com/yt-dlp/yt-dlp#installation) |
| **FFmpeg** | Auto-bundled via `ffmpeg-static`, but a system install also works — [Download](https://ffmpeg.org/download.html) |
| **Discord Bot Token** | Create a bot at the [Discord Developer Portal](https://discord.com/developers/applications) |
| **Spotify API Credentials** | Client ID + Client Secret from the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) |
| **Genius API Token** | Client Access Token from [Genius API Clients](https://genius.com/api-clients) |

## Installation

1. **Clone the repository:**

   ```sh
   git clone https://github.com/MCbabel/discord-music-bot.git
   cd discord-music-bot
   ```

2. **Install dependencies:**

   ```sh
   npm install
   ```

## Configuration

Create a `.env` file in the project root with the following required variables:

```env
DISCORD_TOKEN=your_discord_bot_token
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
GENIUS_ACCESS_TOKEN=your_genius_access_token
```

> **Tip:** You can copy the structure above or reference the environment variables in [`src/config.js`](src/config.js) for the full list.

All four variables are **required** — the bot will exit with an error message if any are missing.

## Running

Start the bot with:

```sh
npm start
```

Or directly:

```sh
node src/index.js
```

For development with auto-restart on file changes:

```sh
npm run dev
```

## YouTube Authentication (cookies.txt)

Some YouTube videos are age-restricted or region-locked. To access them, you can provide a `cookies.txt` file exported from your browser.

**When is this needed?**
- Age-restricted videos return errors without authentication
- Some region-locked content requires a logged-in session

**How to set it up:**

1. See [`cookies.txt.example`](cookies.txt.example) for detailed instructions
2. Export your YouTube cookies using a browser extension like "Get cookies.txt LOCALLY" or via `yt-dlp --cookies-from-browser`
3. Save the file as `cookies.txt` in the project root
4. Restart the bot — it will automatically detect and use the cookies

## Getting Spotify Credentials

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in
2. Click **Create an App** and fill in the required details
3. Copy your **Client ID** and **Client Secret** from the app dashboard
4. Add them to your `.env` file as `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`

## Getting a Genius API Key

1. Go to the [Genius API Clients](https://genius.com/api-clients) page and log in or create an account

   ![Genius API Account](Images/Genius_API_Account.png)

2. Click **Create an API Client** and fill in the app details

   ![Create API Client](Images/Create_API_Client.png)

3. Copy your **Client Access Token**

   ![Retrieve API Key](Images/Retrieve_API_Key.png)

4. Add it to your `.env` file as `GENIUS_ACCESS_TOKEN`

## Discord Bot Permissions

Invite the bot to your server with the necessary permissions using the OAuth2 URL generator in the [Discord Developer Portal](https://discord.com/developers/applications). The bot requires:

- **View Channels** — See text channels
- **Send Messages** — Respond to commands
- **Embed Links** — Send rich embed messages
- **Read Message History** — Context for commands like `/lyrics`
- **Manage Messages** — Required for the `/clear` command
- **Connect** — Join voice channels
- **Speak** — Play audio in voice channels
- **Use Slash Commands** — Register and respond to slash commands

## Tech Stack

| Technology | Purpose |
|---|---|
| [discord.js](https://discord.js.org/) v14 | Discord API framework |
| [@discordjs/voice](https://github.com/discordjs/discord.js/tree/main/packages/voice) | Voice connection & audio streaming |
| [@discordjs/opus](https://github.com/discordjs/opus) | Opus audio encoding |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | YouTube audio extraction (subprocess) |
| [play-dl](https://github.com/play-dl/play-dl) | YouTube search |
| [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) | Bundled FFmpeg binary |
| [spotify-web-api-node](https://github.com/thelinmichael/spotify-web-api-node) | Spotify metadata → YouTube bridge |
| [genius-lyrics](https://github.com/zyrouge/genius-lyrics) | Lyrics fetching |
| [dotenv](https://github.com/motdotla/dotenv) | Environment variable management |
| [sodium-native](https://github.com/sodium-friends/sodium-native) | Voice encryption |

## Project Structure

```
src/
├── index.js              # Entry point — client setup, command registration
├── config.js             # Configuration & environment variable validation
├── messages.js           # Discord embed builders (now playing, queue, errors, etc.)
├── audio/
│   ├── player.js         # GuildPlayer — per-guild queue & playback management
│   ├── youtube.js        # yt-dlp integration — search, stream, info extraction
│   └── spotify.js        # Spotify → YouTube bridge (resolve track metadata)
├── commands/
│   └── index.js          # All 18 slash command definitions & handlers
└── services/
    ├── lyrics.js         # Genius lyrics fetching
    └── playlist.js       # Playlist persistence (JSON file storage)
```

## Contributing

Contributions are welcome! Fork this repository and submit a pull request with your changes. Please make sure any modifications are clearly documented.

## Planned Features

- [x] Lyrics fetching using Genius API
- [x] Music playback controls via buttons
- [x] Custom playlists
- [x] Voting to skip songs
- [x] Auto-disconnect after inactivity
- [x] Volume control
- [x] User-specific playlists
- [x] Song search functionality
- [x] Now playing message with song progress
- [ ] Integration with more streaming services
- [ ] Customizable bot settings
- [ ] Song crossfade: Smoothly transition between songs with a configurable crossfade duration.
- [ ] DJ Mode: Allow certain users to have elevated control over the bot, including song reordering and queue management.
- [ ] Genre and Mood Playlists: Generate playlists based on specific genres or moods using AI recommendations.
- [ ] Scheduled Playlists: Schedule specific playlists to play at designated times (e.g., morning playlists or weekend vibes).
- [ ] Karaoke Mode: Display scrolling lyrics in sync with the song for a karaoke experience.
- [ ] Advanced Equalizer: Allow users to adjust bass, treble, and other sound settings for a customized listening experience.
- [ ] Real-time Voting for Upcoming Songs: Users can vote on which song in the queue should play next.
- [ ] Music Trivia Game: Add a fun music quiz game that users can play in the server.
- [ ] Save Favorite Tracks: Users can save their favorite tracks and easily access them for future playback.

## License

This project is licensed under the **MelodyBot License** — a non-commercial, attribution-required license. See the [LICENSE](LICENSE) file for full terms.

---

Happy listening! 🎵
