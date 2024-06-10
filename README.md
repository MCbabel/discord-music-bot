# 🎶 Discord Music Bot

Welcome to the Discord Music Bot repository! This bot is a powerful, feature-rich music bot built with Python and `discord.py`, offering seamless integration with YouTube and Spotify. This project was created with the assistance of ChatGPT to demonstrate the capabilities of AI-driven development.

## Features

- **YouTube Playback**: Play your favorite tracks directly from YouTube.
- **Spotify Integration**: Add songs from Spotify and enjoy high-quality music.
- **Queue Management**: Add, skip, pause, resume, and stop songs with ease.
- **Interactive Slash Commands**: Utilize modern slash commands for an enhanced user experience.
- **Multilingual Help**: Get help in multiple languages.

## Commands

| Command | Description |
|---------|-------------|
| `/join` | Join the voice channel. |
| `/leave` | Leave the voice channel. |
| `/play <URL>` | Play a YouTube or Spotify video. |
| `/pause` | Pause the playback. |
| `/resume` | Resume the playback. |
| `/skip` | Skip the current song. |
| `/stop` | Stop the playback. |
| `/help` | Show help information. (This command is currently not fully updated and still displays a message from an older version of the bot. It will be fixed in the next update.) |

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

    Create a `.env` file in the root directory and add your Discord token and Spotify credentials:

    ```
    DISCORD_TOKEN=your_discord_token
    SPOTIFY_CLIENT_ID=your_spotify_client_id
    SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
    ```

4. **Run the bot:**

    ```sh
    python bot.py
    ```

### Option 2: Use the setup installer

1. **Download the setup file:**

    - [Download setup.bat](https://github.com/MCbabel/discord-music-bot/releases/download/v1.0.0/setup.bat)

2. **Run the setup file:**

    Double-click on the `setup.bat` file and follow the prompts to enter your Discord Bot Token, Spotify Client ID, and Spotify Client Secret. This will automatically set up your environment variables and install the required dependencies.

3. **Run the bot:**

    Once the setup is complete, simply run the `bot.py` file to start the bot.

    ```sh
    python bot.py
    ```

## Discord Bot Permissions

To ensure that your bot works correctly, you need to invite it to your server with the necessary permissions. Use the following OAuth2 URL to generate an invite link for your bot:

https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=3147776&scope=bot%20applications.commands

Replace `YOUR_CLIENT_ID` with your bot's client ID.

### Required Permissions

- `View Channels`: Allows the bot to see text channels and read messages.
- `Send Messages`: Allows the bot to send messages in text channels.
- `Connect`: Allows the bot to connect to voice channels.
- `Speak`: Allows the bot to play audio in voice channels.
- `Use Slash Commands`: Allows the bot to register and use slash commands.

## Contributing

Contributions are welcome! Please fork this repository and submit a pull request for any changes you would like to make.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Acknowledgements

This project was created with the assistance of [ChatGPT](https://www.openai.com/chatgpt), demonstrating the power of AI in software development. Special thanks to the OpenAI team for providing such an incredible tool. 

---

Happy listening! 🎵
