# 🎶 Discord Music Bot

Welcome to the Discord Music Bot repository! This bot is a powerful, feature-rich music bot built with Python and `discord.py`, offering seamless integration with YouTube and Spotify. This project was created with the assistance of ChatGPT to demonstrate the capabilities of AI-driven development.

## Table of Contents

1. [Features](#features)
2. [Commands](#commands)
3. [Installation](#installation)
   - [Option 1: Clone the repository](#option-1-clone-the-repository)
   - [Option 2: Use the setup installer](#option-2-use-the-setup-installer)
4. [Getting Spotify Credentials](#getting-spotify-credentials)
5. [Getting Genius API Key](#getting-genius-api-key)
6. [Discord Bot Permissions](#discord-bot-permissions)
   - [Required Permissions](#required-permissions)
7. [Contributing](#contributing)
8. [License](#license)
9. [Acknowledgements](#acknowledgements)
10. [Planned Features](#planned-features)

## Features

- **YouTube Playback**: Play your favorite tracks directly from YouTube.
- **Spotify Integration**: Add songs from Spotify and enjoy high-quality music.
- **Queue Management**: Add, skip, pause, resume, and stop songs with ease.
- **Looping**: Loop the current song indefinitely.
- **Volume Control**: Adjust the playback volume to your preference.
- **Interactive Slash Commands**: Utilize modern slash commands for an enhanced user experience.
- **Lyrics Fetching**: Fetch lyrics for the currently playing song using the Genius API.
- **Voting System**: Users can vote to skip the current song.
- **Inactivity Auto-Disconnect**: The bot disconnects after a period of inactivity to save resources.
- **Custom Playlists**: Create and play custom playlists.
- **Playback Controls with Buttons**: Control playback using interactive buttons.
- **Multi-Language Support**: Get help and feedback in multiple languages.

## Commands

| Command                            | Description                                             |
|------------------------------------|---------------------------------------------------------|
| `/join`                            | Join your voice channel.                                |
| `/leave`                           | Leave the voice channel.                                |
| `/play <URL>`                      | Play a YouTube or Spotify track.                        |
| `/pause`                           | Pause the playback.                                     |
| `/resume`                          | Resume the playback.                                    |
| `/skip`                            | Skip the current song.                                  |
| `/stop`                            | Stop the playback and clear the queue.                  |
| `/lyrics`                          | Fetch the lyrics for the current song.                  |
| `/help`                            | Show help information.                                  |
| `/volume <percent>`                | Set the playback volume (0-100%).                       |
| `/loop <on/off>`                   | Enable or disable looping of the current song.          |
| `/add_to_playlist <name> <url>`    | Add a song to a custom playlist.                        |
| `/play_playlist <name>`            | Play songs from a custom playlist.                      |
| `/vote_skip`                       | Vote to skip the current song.                          |
| `/clear <number>`                  | Clear a number of messages in a channel (admin only).   |
| `/list_playlists`                  | List all custom playlists and their creators.           |

## YouTube Authentication Setup

Due to YouTube's bot detection mechanisms, you may encounter authentication errors when playing YouTube videos. This section provides solutions to resolve these issues.

### Common YouTube Error

If you see an error like this:
```
ERROR: [youtube] ODDRRXMi22E: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for authentication.
```

The bot has automatic fallback mechanisms but manual setup may be required.

### Automatic Cookie Detection

The bot automatically tries to use cookies from your browsers in this order:
1. Chrome
2. Firefox  
3. Edge
4. Safari

### Manual Setup Options

If automatic detection fails, you have several options:

#### Option 1: Sign into YouTube in Your Browser (Easiest)
1. Open your web browser (Chrome, Firefox, etc.)
2. Go to [YouTube](https://youtube.com) and sign in to your account
3. Watch a few videos to establish your session
4. Restart the Discord bot

#### Option 2: Export Cookies Manually
1. Install a browser extension like "Get cookies.txt" for your browser
2. Go to YouTube and sign in
3. Use the extension to export cookies to a file named `cookies.txt`
4. Place the `cookies.txt` file in the same directory as `bot.py`
5. Restart the Discord bot

*Note: A template file `cookies.txt.example` is provided to show the expected format.*

#### Option 3: Use Browser Developer Tools
1. Open YouTube in your browser and sign in
2. Press F12 to open Developer Tools
3. Go to the Network tab
4. Refresh the page
5. Look for any request to YouTube
6. Right-click → Copy → Copy as cURL
7. Extract the cookies from the cURL command and save to `cookies.txt`

### Troubleshooting

- **Bot still can't play YouTube videos**: Try clearing your browser cookies and signing in to YouTube again
- **"No browser cookies found" warning**: The bot will still try to work but may fail on some videos
- **Persistent issues**: Consider using Spotify URLs instead, which don't require cookies

### Technical Details

The bot uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) for YouTube downloads. For more detailed information about cookie authentication, see:
- [yt-dlp FAQ on authentication](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp)
- [YouTube cookie export guide](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies)

## Installation

You have two options to set up the Discord Music Bot: cloning the repository or using the provided setup installer.

### Option 1: Clone the repository

1. **Clone the repository:**

    ```sh
    git clone https://github.com/MCbabel/discord-music-bot.git
    cd discord-music-bot
    ```

2. **Install the required dependencies:**

    ```sh
    pip install -r requirements.txt
    ```

3. **Set up your environment variables:**

    Create a `.env` file in the root directory and add your Discord token, Spotify credentials, and Genius API key:

    ```env
    DISCORD_TOKEN=your_discord_token
    SPOTIFY_CLIENT_ID=your_spotify_client_id
    SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
    GENIUS_ACCESS_TOKEN=your_genius_api_key
    ```

4. **Run the bot:**

    ```sh
    python bot.py
    ```

### Option 2: Use the setup installer

1. **Download the setup file:**

   - [Download setup.bat](https://github.com/MCbabel/discord-music-bot/releases/download/v1.4.0/setup.bat)

2. **Run the setup file:**

   Double-click on the `setup.bat` file and follow the prompts to enter your Discord Bot Token, Spotify Client ID, Spotify Client Secret, and Genius API Key. This will automatically set up your environment variables and install the required dependencies.

3. **Run the bot:**

   Once the setup is complete, simply run the `bot.py` file to start the bot.

   ```sh
   python bot.py
   ```

## Getting Spotify Credentials

To integrate Spotify, you need to obtain a Client ID and Client Secret from the Spotify Developer Dashboard. Here are the steps:

1. **Create a Spotify Developer Account:**
   - Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/login).
   - Log in with your Spotify account or create a new account.

2. **Create an App:**
   - Click on "Create an App".
   - Fill in the required details like App name and description.
   - Agree to the terms and conditions and click "Create".

3. **Retrieve Your Credentials:**
   - Once your app is created, you will be redirected to the app dashboard.
   - Here, you can find your **Client ID** and **Client Secret**. Copy these values.

4. **Add Credentials to .env File:**
   - Update your `.env` file with the obtained credentials.

    ```env
    DISCORD_TOKEN=your_discord_token
    SPOTIFY_CLIENT_ID=your_spotify_client_id
    SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
    GENIUS_ACCESS_TOKEN=your_genius_api_key
    ```

## Getting Genius API Key

To fetch lyrics, you need to obtain a Genius API Key. Here are the steps:

1. **Create a Genius Account:**
   - Go to the [Genius API Clients](https://genius.com/api-clients) page.
   - Log in with your Genius account or create a new account.

   ![Genius API Account](Images/Genius_API_Account.png)

2. **Create an API Client:**
   - Click on "Create an API Client".
   - Fill in the required details like App name and description.
   - Agree to the terms and conditions and click "Save".

   ![Create API Client](Images/Create_API_Client.png)

3. **Retrieve Your API Key:**
   - Once your app is created, you will be redirected to the app dashboard.
   - Here, you can find your **Client Access Token**. Copy this value.

   ![Retrieve API Key](Images/Retrieve_API_Key.png)

4. **Add API Key to .env File:**
   - Update your `.env` file with the obtained API Key.

    ```env
    DISCORD_TOKEN=your_discord_token
    SPOTIFY_CLIENT_ID=your_spotify_client_id
    SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
    GENIUS_ACCESS_TOKEN=your_genius_api_key
    ```

## Discord Bot Permissions

To ensure that your bot works correctly, you need to invite it to your server with the necessary permissions. Use the following OAuth2 URL to generate an invite link for your bot:

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=277083450752&scope=bot%20applications.commands
```

Replace `YOUR_CLIENT_ID` with your bot's client ID, which you can find in the [Discord Developer Portal](https://discord.com/developers/applications).

### Required Permissions

- `View Channels`: Allows the bot to see text channels and read messages.
- `Send Messages`: Allows the bot to send messages in text channels.
- `Connect`: Allows the bot to connect to voice channels.
- `Speak`: Allows the bot to play audio in voice channels.
- `Use Slash Commands`: Allows the bot to register and use slash commands.
- `Manage Messages`: Required for the `/clear` command to delete messages.
- `Embed Links`: Allows the bot to send embedded rich content.
- `Read Message History`: Allows the bot to read message history (useful for commands like `/lyrics`).

## Contributing

Contributions are welcome! Please fork this repository and submit a pull request for any changes you would like to make.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Acknowledgements

This project was created with the assistance of [ChatGPT](https://www.openai.com/chatgpt), demonstrating the power of AI in software development. Special thanks to the OpenAI team for providing such an incredible tool.

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
- [x] Song crossfade: Smoothly transition between songs with a configurable crossfade duration.
- [x] DJ Mode: Allow certain users to have elevated control over the bot, including song reordering and queue management.
- [ ] Genre and Mood Playlists: Generate playlists based on specific genres or moods using AI recommendations.
- [ ] Scheduled Playlists: Schedule specific playlists to play at designated times (e.g., morning playlists or weekend vibes).
- [ ] Karaoke Mode: Display scrolling lyrics in sync with the song for a karaoke experience.
- [ ] Advanced Equalizer: Allow users to adjust bass, treble, and other sound settings for a customized listening experience.
- [ ] Real-time Voting for Upcoming Songs: Users can vote on which song in the queue should play next.
- [ ] Music Trivia Game: Add a fun music quiz game that users can play in the server.
- [ ] Save Favorite Tracks: Users can save their favorite tracks and easily access them for future playback.

---

Happy listening! 🎵
