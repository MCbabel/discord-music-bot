import discord
from discord.ext import commands
from discord import app_commands
import yt_dlp as youtube_dl
import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
import os
import asyncio
from dotenv import load_dotenv
import lyricsgenius
from commands import setup_commands

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
bot = commands.Bot(command_prefix='/', intents=intents)
tree = bot.tree

# Spotify client setup
sp = spotipy.Spotify(client_credentials_manager=SpotifyClientCredentials(
    client_id=SPOTIFY_CLIENT_ID, client_secret=SPOTIFY_CLIENT_SECRET))

# Ensure FFmpeg is installed
ffmpeg_path = 'ffmpeg'  # Adjust this path if necessary

# YouTube-DL options
youtube_dl.utils.bug_reports_message = lambda: ''
ytdl_format_options = {
    'format': 'bestaudio/best',
    'outtmpl': '%(extractor)s-%(id)s-%(title)s.%(ext)s',
    'restrictfilenames': True,
    'noplaylist': True,
    'nocheckcertificate': True,
    'ignoreerrors': False,
    'logtostderr': False,
    'quiet': True,
    'no_warnings': True,
    'default_search': 'auto',
    'source_address': '0.0.0.0',
    'hls_prefer_native': True,
    'external_downloader_args': ['-loglevel', 'panic']
}
ffmpeg_options = {
    'before_options': '-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5',
    'options': '-vn'
}
ytdl = youtube_dl.YoutubeDL(ytdl_format_options)

class YTDLSource(discord.PCMVolumeTransformer):
    def __init__(self, source, *, data, volume=0.5):
        super().__init__(source, volume)
        self.data = data
        self.title = data.get('title')
        self.url = data.get('url')

    @classmethod
    async def from_url(cls, url, *, loop=None, stream=False):
        loop = loop or asyncio.get_event_loop()
        data = await loop.run_in_executor(None, lambda: ytdl.extract_info(url, download=not stream))
        if 'entries' in data:
            data = data['entries'][0]
        filename = data['url'] if stream else ytdl.prepare_filename(data)
        return cls(discord.FFmpegPCMAudio(filename, **ffmpeg_options), data=data)

class SpotifySource(discord.PCMVolumeTransformer):
    def __init__(self, source, *, data, volume=0.5):
        super().__init__(source, volume)
        self.data = data
        self.title = data['name']
        self.url = data['external_urls']['spotify']

    @classmethod
    async def from_spotify_url(cls, url, *, loop=None):
        loop = loop or asyncio.get_event_loop()
        data = await loop.run_in_executor(None, lambda: sp.track(url))
        track_name = data['name'] + " " + data['artists'][0]['name']
        youtube_url = await cls.search_youtube_url(track_name)
        return await YTDLSource.from_url(youtube_url, loop=loop, stream=True)

    @staticmethod
    async def search_youtube_url(query):
        ytdl_opts = {
            'format': 'bestaudio/best',
            'quiet': True,
            'default_search': 'ytsearch1',
            'source_address': '0.0.0.0'
        }
        ytdl = youtube_dl.YoutubeDL(ytdl_opts)
        info = ytdl.extract_info(query, download=False)
        return info['entries'][0]['webpage_url']

queue = []

def add_to_queue(source):
    queue.append(source)

async def play_next(ctx):
    if len(queue) > 0:
        source = queue.pop(0)
        ctx.guild.voice_client.play(source, after=lambda e: asyncio.run_coroutine_threadsafe(play_next(ctx), bot.loop).result())
        await ctx.send(embed=discord.Embed(title="Now playing", description=f"Playing: {source.title}", color=discord.Color.blue()))
    else:
        await ctx.guild.voice_client.disconnect()

@bot.event
async def on_ready():
    setup_commands(tree, bot, sp, genius, queue, add_to_queue, play_next, YTDLSource, SpotifySource)
    await tree.sync()
    print(f'Bot is logged in as {bot.user}')

bot.run(TOKEN)
