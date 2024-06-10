import discord
from discord.ext import commands
from discord import app_commands
import yt_dlp as youtube_dl
import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
import os
import asyncio
from dotenv import load_dotenv
 
load_dotenv()
TOKEN = os.getenv('DISCORD_TOKEN')
SPOTIFY_CLIENT_ID = os.getenv('SPOTIFY_CLIENT_ID')
SPOTIFY_CLIENT_SECRET = os.getenv('SPOTIFY_CLIENT_SECRET')
 
intents = discord.Intents.default()
intents.message_content = True
intents.members = True
bot = commands.Bot(command_prefix='!', intents=intents)
tree = bot.tree
 
bot.remove_command('help')
 
sp = spotipy.Spotify(client_credentials_manager=SpotifyClientCredentials(
    client_id=SPOTIFY_CLIENT_ID, client_secret=SPOTIFY_CLIENT_SECRET))
 
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
    if len(queue) :
        source = queue.pop(0)
        ctx.voice_client.play(source, after=lambda e: asyncio.run_coroutine_threadsafe(play_next(ctx), bot.loop).result())
        await ctx.send(embed=discord.Embed(title="Now playing", description=f"Playing: {source.title}", color=discord.Color.blue()))
    else:
        await ctx.voice_client.disconnect()
 
@tree.command(name='join', description='Join a voice channel')
async def join(interaction: discord.Interaction):
    if not interaction.user.voice:
        embed = discord.Embed(title="Error", description="You are not in a voice channel.", color=discord.Color.red())
        await interaction.response.send_message(embed=embed, ephemeral=True)
        return
    channel = interaction.user.voice.channel
    await channel.connect()
    embed = discord.Embed(title="Connected", description=f"Connected to {channel}.", color=discord.Color.green())
    await interaction.response.send_message(embed=embed)
 
@tree.command(name='leave', description='Leave the voice channel')
async def leave(interaction: discord.Interaction):
    if interaction.guild.voice_client:
        await interaction.guild.voice_client.disconnect()
        embed = discord.Embed(title="Disconnected", description="The bot has left the voice channel.", color=discord.Color.orange())
        await interaction.response.send_message(embed=embed)
    else:
        embed = discord.Embed(title="Error", description="The bot is not in a voice channel.", color=discord.Color.red())
        await interaction.response.send_message(embed=embed)
 
@tree.command(name='play', description='Play a YouTube or Spotify video')
async def play(interaction: discord.Interaction, url: str):
    await interaction.response.defer()
 
    if interaction.guild.voice_client is None:
        if interaction.user.voice:
            channel = interaction.user.voice.channel
            await channel.connect()
        else:
            embed = discord.Embed(title="Error", description="You are not in a voice channel.", color=discord.Color.red())
            await interaction.followup.send(embed=embed, ephemeral=True)
            return
 
    async with interaction.channel.typing():
        if 'spotify.com' in url:
            player = await SpotifySource.from_spotify_url(url, loop=bot.loop)
        else:
            player = await YTDLSource.from_url(url, loop=bot.loop, stream=True)
 
        if interaction.guild.voice_client.is_playing() or interaction.guild.voice_client.is_paused():
            add_to_queue(player)
            embed = discord.Embed(title="Added to queue", description=f"The song {player.title} has been added to the queue.", color=discord.Color.purple())
            await interaction.followup.send(embed=embed)
        else:
            interaction.guild.voice_client.play(player, after=lambda e: asyncio.run_coroutine_threadsafe(play_next(interaction.channel), bot.loop).result())
            embed = discord.Embed(title="Now playing", description=f"Playing: {player.title}", color=discord.Color.blue())
            await interaction.followup.send(embed=embed)
 
@tree.command(name='skip', description='Skip the current song')
async def skip(interaction: discord.Interaction):
    if interaction.guild.voice_client.is_playing():
        interaction.guild.voice_client.stop()
        await interaction.response.send_message(embed=discord.Embed(title="Skipped", description="The current song has been skipped.", color=discord.Color.orange()))
 
@tree.command(name='pause', description='Pause the playback')
async def pause(interaction: discord.Interaction):
    voice_client = interaction.guild.voice_client
    if voice_client.is_playing():
        voice_client.pause()
        embed = discord.Embed(title="Paused", description="Playback has been paused.", color=discord.Color.yellow())
        await interaction.response.send_message(embed=embed)
    else:
        embed = discord.Embed(title="Error", description="Nothing is playing.", color=discord.Color.red())
        await interaction.response.send_message(embed=embed)
 
@tree.command(name='resume', description='Resume the playback')
async def resume(interaction: discord.Interaction):
    voice_client = interaction.guild.voice_client
    if voice_client.is_paused():
        voice_client.resume()
        embed = discord.Embed(title="Resumed", description="Playback has been resumed.", color=discord.Color.green())
        await interaction.response.send_message(embed=embed)
    else:
        embed = discord.Embed(title="Error", description="Nothing to resume.", color=discord.Color.red())
        await interaction.response.send_message(embed=embed)
 
@tree.command(name='stop', description='Stop the playback')
async def stop(interaction: discord.Interaction):
    voice_client = interaction.guild.voice_client
    if voice_client.is_playing():
        voice_client.stop()
        embed = discord.Embed(title="Stopped", description="Playback has been stopped.", color=discord.Color.red())
        await interaction.response.send_message(embed=embed)
    else:
        embed = discord.Embed(title="Error", description="Nothing is playing.", color=discord.Color.red())
        await interaction.response.send_message(embed=embed)
 
@tree.command(name='help', description='Show this help message')
async def help_command(interaction: discord.Interaction):
    embed = discord.Embed(title="Help", description="Choose a language:", color=discord.Color.blue())
    embed.add_field(name="Deutsch", value="Click the button to view the help in German.", inline=False)
    embed.add_field(name="English", value="Click the button to view the help in English.", inline=False)
    view = discord.ui.View()
    view.add_item(discord.ui.Button(label="Deutsch", style=discord.ButtonStyle.primary, custom_id="help_de"))
    view.add_item(discord.ui.Button(label="English", style=discord.ButtonStyle.secondary, custom_id="help_en"))
    await interaction.response.send_message(embed=embed, view=view)
 
@bot.event
async def on_interaction(interaction: discord.Interaction):
    if 'custom_id' in interaction.data:
        if interaction.data['custom_id'] == "help_de":
            embed = discord.Embed(title="Hilfe (Deutsch)", description="List of commands", color=discord.Color.blue())
            embed.add_field(name="/join", value="Join a voice channel", inline=False)
            embed.add_field(name="/leave", value="Leave the voice channel", inline=False)
            embed.add_field(name="/play <URL>", value="Play a YouTube or Spotify video", inline=False)
            embed.add_field(name="/pause", value="Pause the playback", inline=False)
            embed.add_field(name="/resume", value="Resume the playback", inline=False)
            embed.add_field(name="/skip", value="Skip the current song", inline=False)
            embed.add_field(name="/stop", value="Stop the playback", inline=False)
            await interaction.response.send_message(embed=embed, ephemeral=True)
        elif interaction.data['custom_id'] == "help_en":
            embed = discord.Embed(title="Help (English)", description="List of commands", color=discord.Color.blue())
            embed.add_field(name="/join", value="Join a voice channel", inline=False)
            embed.add_field(name="/leave", value="Leave the voice channel", inline=False)
            embed.add_field(name="/play <URL>", value="Play a YouTube or Spotify video", inline=False)
            embed.add_field(name="/pause", value="Pause the playback", inline=False)
            embed.add_field(name="/resume", value="Resume the playback", inline=False)
            embed.add_field(name="/skip", value="Skip the current song", inline=False)
            embed.add_field(name="/stop", value="Stop the playback", inline=False)
            await interaction.response.send_message(embed=embed, ephemeral=True)
    else:
        pass
 
@bot.event
async def on_ready():
    await tree.sync()
    print(f'Bot is logged in as {bot.user}')
 
bot.run(TOKEN)
