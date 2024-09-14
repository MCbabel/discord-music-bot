import discord
from discord.ext import commands
import yt_dlp as youtube_dl
import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
import os
import asyncio
from dotenv import load_dotenv
import lyricsgenius
from commands import setup_commands
import logging
from messages import Messages  # Ensure Messages is imported

# Logging configuration
logging.basicConfig(level=logging.INFO)

# Load environment variables
load_dotenv()
TOKEN = os.getenv('DISCORD_TOKEN')
SPOTIFY_CLIENT_ID = os.getenv('SPOTIFY_CLIENT_ID')
SPOTIFY_CLIENT_SECRET = os.getenv('SPOTIFY_CLIENT_SECRET')
GENIUS_ACCESS_TOKEN = os.getenv('GENIUS_ACCESS_TOKEN')

# Initialize Genius API client
genius = lyricsgenius.Genius(GENIUS_ACCESS_TOKEN)

intents = discord.Intents.default()
intents.message_content = True
intents.members = True
intents.voice_states = True  # Ensure voice_states intent is enabled
bot = commands.Bot(command_prefix='/', intents=intents)
tree = bot.tree

# Spotify client setup
sp = spotipy.Spotify(client_credentials_manager=SpotifyClientCredentials(
    client_id=SPOTIFY_CLIENT_ID, client_secret=SPOTIFY_CLIENT_SECRET))

# Ensure FFmpeg is installed
ffmpeg_path = 'ffmpeg'  # Adjust this path if necessary

# yt-dlp options
youtube_dl.utils.bug_reports_message = lambda: ''
ytdl_format_options = {
    'format': 'bestaudio/best',
    'quiet': True,
    'default_search': 'auto',
    'nocheckcertificate': True,
    'no_warnings': True,
    'ignoreerrors': True,
    'logtostderr': False,
    'skip_download': True,
    'source_address': '0.0.0.0',
    'noplaylist': True,
    'youtube_skip_dash_manifest': True,
    'geo_bypass': True,
    'geo_bypass_country': 'DE',  # Germany
}
ffmpeg_options = {
    'options': '-vn -nostdin',
    'before_options': '-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5',
}
ytdl = youtube_dl.YoutubeDL(ytdl_format_options)

class BaseSource(discord.PCMVolumeTransformer):
    def __init__(self, source, *, data, url, volume=0.5):
        super().__init__(source, volume)
        self.data = data
        self.title = data.get('title')
        self.web_url = data.get('webpage_url')
        self.url = url  # Original URL used to create the source

class YTDLSource(BaseSource):
    @classmethod
    async def from_url(cls, url, *, loop=None, stream=True):
        loop = loop or asyncio.get_event_loop()
        data = await loop.run_in_executor(
            None, lambda: ytdl.extract_info(url, download=not stream)
        )
        if data is None:
            raise Exception("Could not extract information from the URL.")
        if 'entries' in data:
            data = data['entries'][0]
        if data is None:
            raise Exception("Could not retrieve any data.")
        filename = data['url'] if stream else ytdl.prepare_filename(data)
        return cls(
            discord.FFmpegPCMAudio(filename, **ffmpeg_options),
            data=data,
            url=url
        )

class SpotifySource(BaseSource):
    @classmethod
    async def from_spotify_url(cls, url, *, loop=None):
        loop = loop or asyncio.get_event_loop()
        data = sp.track(url)
        if data is None:
            raise Exception("Could not retrieve track information from Spotify.")
        track_name = f"{data['name']} {data['artists'][0]['name']}"
        youtube_url = await cls.search_youtube_url(track_name)
        return await YTDLSource.from_url(youtube_url, loop=loop, stream=True)

    @staticmethod
    async def search_youtube_url(query):
        ytdl_opts = {
            'format': 'bestaudio/best',
            'quiet': True,
            'default_search': 'ytsearch1',
            'nocheckcertificate': True,
            'no_warnings': True,
            'ignoreerrors': True,
            'logtostderr': False,
            'skip_download': True,
            'source_address': '0.0.0.0',
            'youtube_skip_dash_manifest': True,
        }
        ytdl_search = youtube_dl.YoutubeDL(ytdl_opts)
        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(
            None, lambda: ytdl_search.extract_info(query, download=False)
        )
        if 'entries' in data and len(data['entries']) > 0:
            return data['entries'][0]['webpage_url']
        else:
            raise Exception("No results found on YouTube.")

class Music:
    def __init__(self, bot):
        self.bot = bot
        self.queue = []
        self.loop = False
        self.current = None
        self.skip_votes = set()
        self.channel = None  # Text channel to send messages
        self.inactivity_timer = None  # Timer for inactivity
        self.view = None  # Reference to the MusicControls view

    async def play_next(self, guild):
        # Cancel any existing inactivity timer
        if self.inactivity_timer:
            self.inactivity_timer.cancel()
            self.inactivity_timer = None

        try:
            is_looping = False
            if self.loop and self.current:
                is_looping = True
                # Recreate the audio source using the original URL
                if isinstance(self.current, YTDLSource):
                    source = await YTDLSource.from_url(self.current.url, loop=self.bot.loop, stream=True)
                elif isinstance(self.current, SpotifySource):
                    source = await SpotifySource.from_spotify_url(self.current.url, loop=self.bot.loop)
                else:
                    print("Unknown source type. Cannot loop.")
                    return
                self.current = source
            elif self.queue:
                source = self.queue.pop(0)
                self.current = source
                is_looping = False  # Not looping
            else:
                self.current = None
                # Disable the buttons when playback ends
                if self.view:
                    await self.view.disable_all_items()
                    self.view = None
                # Start inactivity timer
                self.inactivity_timer = self.bot.loop.create_task(self.disconnect_after_delay(guild))
                return

            # Check if voice client is connected
            if guild.voice_client is None:
                print("Voice client is not connected.")
                return

            def after_playing(error):
                if error:
                    print(f"Player error: {error}")
                coro = self.play_next(guild)
                fut = asyncio.run_coroutine_threadsafe(coro, self.bot.loop)
                try:
                    fut.result()
                except Exception as e:
                    print(f"Error in after_playing: {e}")

            guild.voice_client.play(self.current, after=after_playing)

            # Send new message with controls if not looping
            if not is_looping:
                # Disable previous view
                if self.view:
                    await self.view.disable_all_items()
                embed = Messages.now_playing(self.current.title)
                self.view = MusicControls(None, self, guild.voice_client)
                message = await self.channel.send(embed=embed, view=self.view)
                self.view.message = message
            else:
                # Optionally update the existing message or do nothing
                pass  # No action needed when looping the same song

        except Exception as e:
            print(f"Exception in play_next: {e}")
            # Handle the exception gracefully
            if self.view:
                await self.view.disable_all_items()
                self.view = None
            self.current = None
            # Start inactivity timer
            self.inactivity_timer = self.bot.loop.create_task(self.disconnect_after_delay(guild))

    async def stop(self, guild):
        if guild.voice_client:
            await guild.voice_client.disconnect(force=True)
        self.queue.clear()
        self.loop = False
        self.current = None
        # Cancel inactivity timer if it's running
        if self.inactivity_timer:
            self.inactivity_timer.cancel()
            self.inactivity_timer = None
        # Disable buttons if they are active
        if self.view:
            await self.view.disable_all_items()
            self.view = None

    async def disconnect_after_delay(self, guild):
        await asyncio.sleep(180)  # Wait for 3 minutes
        # Check if the voice client is still connected and not playing
        voice_client = guild.voice_client
        if not voice_client or not voice_client.is_connected():
            return
        if voice_client.is_playing() or voice_client.is_paused():
            return  # Don't disconnect if still playing or paused
        await self.stop(guild)
        if guild.id in music_instances:
            del music_instances[guild.id]
        if self.channel:
            await self.channel.send("Disconnected due to inactivity.")

# MusicControls View Class
class MusicControls(discord.ui.View):
    def __init__(self, interaction, music, voice_client):
        super().__init__(timeout=None)
        self.interaction = interaction
        self.music = music
        self.voice_client = voice_client
        self.message = None  # Will be set when the message is sent

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        # Allow only users in the same voice channel to interact
        if interaction.user.voice and interaction.user.voice.channel == self.voice_client.channel:
            return True
        else:
            await interaction.response.send_message(
                "You must be in the same voice channel to use these controls.",
                ephemeral=True
            )
            return False

    @discord.ui.button(label='Pause', style=discord.ButtonStyle.primary, emoji='⏸️')
    async def pause_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        if self.voice_client.is_playing():
            self.voice_client.pause()
            await interaction.response.send_message("Playback paused.", ephemeral=True)
        else:
            await interaction.response.send_message("Nothing is playing.", ephemeral=True)

    @discord.ui.button(label='Resume', style=discord.ButtonStyle.primary, emoji='▶️')
    async def resume_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        if self.voice_client.is_paused():
            self.voice_client.resume()
            await interaction.response.send_message("Playback resumed.", ephemeral=True)
        else:
            await interaction.response.send_message("Playback is not paused.", ephemeral=True)

    @discord.ui.button(label='Skip', style=discord.ButtonStyle.primary, emoji='⏭️')
    async def skip_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        music = self.music
        voice_client = self.voice_client
        if voice_client.is_playing():
            if music.queue or music.loop:
                voice_client.stop()
                await interaction.response.send_message("Skipped the current song.", ephemeral=True)
            else:
                await interaction.response.send_message("No more songs in the queue to skip to.", ephemeral=True)
        else:
            await interaction.response.send_message("Nothing is playing.", ephemeral=True)

    @discord.ui.button(label='Loop', style=discord.ButtonStyle.primary, emoji='🔁')
    async def loop_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.music.loop = not self.music.loop
        status = "enabled" if self.music.loop else "disabled"
        await interaction.response.send_message(f"Looping {status}.", ephemeral=True)

    async def disable_all_items(self):
        for item in self.children:
            item.disabled = True
        if self.message:
            await self.message.edit(view=self)

music_instances = {}

async def get_music_instance(guild):
    if guild.id not in music_instances:
        music_instances[guild.id] = Music(bot)
    return music_instances[guild.id]

@bot.event
async def on_ready():
    print("Bot is ready. Setting up commands...")
    try:
        setup_commands(tree, bot, sp, genius, music_instances, Music, YTDLSource, SpotifySource)
        await tree.sync()
        print("All commands synced successfully.")
    except Exception as e:
        print(f"Error during setup or sync: {e}")
    print(f'Bot is logged in as {bot.user}')

bot.run(TOKEN)
