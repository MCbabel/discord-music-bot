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
| `/help` | Show help information. |

## Installation

1. **Clone the repository:**

    ```sh
    git clone https://github.com/your-username/discord-music-bot.git
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

## Contributing

Contributions are welcome! Please fork this repository and submit a pull request for any changes you would like to make.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Acknowledgements

This project was created with the assistance of [ChatGPT](https://www.openai.com/chatgpt), demonstrating the power of AI in software development. Special thanks to the OpenAI team for providing such an incredible tool. 

---

Happy listening! 🎵
