import discord
from discord import app_commands
from messages import Messages
import asyncio
import json

# Dictionary to store playlists
playlists = {}

def setup_commands(tree, bot, sp, genius, queue, add_to_queue, play_next, YTDLSource, SpotifySource, playlists, save_playlists):
    @tree.command(name='join', description='Join a voice channel')
    async def join(interaction: discord.Interaction):
        if not interaction.user.voice:
            embed = Messages.error("You are not in a voice channel.")
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return
        channel = interaction.user.voice.channel
        await channel.connect()
        embed = Messages.connected(channel)
        await interaction.response.send_message(embed=embed)

    @tree.command(name='leave', description='Leave the voice channel')
    async def leave(interaction: discord.Interaction):
        if interaction.guild.voice_client:
            await interaction.guild.voice_client.disconnect()
            embed = Messages.disconnected()
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.error("The bot is not in a voice channel.")
            await interaction.response.send_message(embed=embed)

    @tree.command(name='play', description='Play a YouTube or Spotify video')
    async def play(interaction: discord.Interaction, url: str):
        await interaction.response.defer()

        if interaction.guild.voice_client is None:
            if interaction.user.voice:
                channel = interaction.user.voice.channel
                await channel.connect()
            else:
                embed = Messages.error("You are not in a voice channel.")
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

        async with interaction.channel.typing():
            if 'spotify.com' in url:
                player = await SpotifySource.from_spotify_url(url, loop=bot.loop)
            elif 'youtube.com' in url or 'youtu.be' in url:
                player = await YTDLSource.from_url(url, loop=bot.loop, stream=True)
            else:
                embed = Messages.error("Invalid URL. Only YouTube and Spotify URLs are supported.")
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

            if interaction.guild.voice_client.is_playing() or interaction.guild.voice_client.is_paused():
                add_to_queue(player)
                embed = Messages.added_to_queue(player.title)
                await interaction.followup.send(embed=embed)
            else:
                interaction.guild.voice_client.play(player, after=lambda e: asyncio.run_coroutine_threadsafe(play_next(interaction), bot.loop).result())
                embed = Messages.now_playing(player.title)
                await interaction.followup.send(embed=embed)

    @tree.command(name='skip', description='Skip the current song')
    async def skip(interaction: discord.Interaction):
        if interaction.guild.voice_client and interaction.guild.voice_client.is_playing():
            interaction.guild.voice_client.stop()
            await interaction.response.send_message(embed=Messages.skipped())

    @tree.command(name='pause', description='Pause the playback')
    async def pause(interaction: discord.Interaction):
        voice_client = interaction.guild.voice_client
        if voice_client and voice_client.is_playing():
            voice_client.pause()
            embed = Messages.paused()
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.error("Nothing is playing.")
            await interaction.response.send_message(embed=embed)

    @tree.command(name='resume', description='Resume the playback')
    async def resume(interaction: discord.Interaction):
        voice_client = interaction.guild.voice_client
        if voice_client and voice_client.is_paused():
            voice_client.resume()
            embed = Messages.resumed()
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.error("Nothing to resume.")
            await interaction.response.send_message(embed=embed)

    @tree.command(name='stop', description='Stop the playback')
    async def stop(interaction: discord.Interaction):
        voice_client = interaction.guild.voice_client
        if voice_client and voice_client.is_playing():
            voice_client.stop()
            embed = Messages.stopped()
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.error("Nothing is playing.")
            await interaction.response.send_message(embed=embed)

    @tree.command(name='lyrics', description='Fetch the lyrics for the current song')
    async def lyrics(interaction: discord.Interaction):
        voice_client = interaction.guild.voice_client
        if voice_client and voice_client.is_playing():
            current_song = queue[0].title if queue else voice_client.source.title
            song = genius.search_song(current_song)
            if song:
                embed = Messages.lyrics(song.title, song.lyrics)
                await interaction.response.send_message(embed=embed)
            else:
                embed = Messages.error("Lyrics not found.")
                await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.error("No song is currently playing.")
            await interaction.response.send_message(embed=embed)

    @tree.command(name='help', description='Show this help message')
    async def help_command(interaction: discord.Interaction):
        embed = discord.Embed(title="Help", description="List of commands:", color=discord.Color.blue())
        embed.add_field(name="/join", value="Join a voice channel", inline=False)
        embed.add_field(name="/leave", value="Leave the voice channel", inline=False)
        embed.add_field(name="/play <URL>", value="Play a YouTube or Spotify video", inline=False)
        embed.add_field(name="/pause", value="Pause the playback", inline=False)
        embed.add_field(name="/resume", value="Resume the playback", inline=False)
        embed.add_field(name="/skip", value="Skip the current song", inline=False)
        embed.add_field(name="/stop", value="Stop the playback", inline=False)
        embed.add_field(name="/lyrics", value="Fetch the lyrics for the current song", inline=False)
        embed.add_field(name="/volume <percent>", value="Set the volume of the playback", inline=False)
        embed.add_field(name="/loop <on/off>", value="Loop the current song", inline=False)
        embed.add_field(name="/add_to_playlist <name> <url>", value="Add a song to a playlist", inline=False)
        embed.add_field(name="/play_playlist <name>", value="Play songs from a playlist", inline=False)
        embed.add_field(name="/vote_skip", value="Vote to skip the current song", inline=False)
        embed.add_field(name="/clear <number>", value="Clear messages in a channel", inline=False)
        await interaction.response.send_message(embed=embed)

    @tree.command(name='volume', description='Set the volume of the playback')
    async def volume(interaction: discord.Interaction, percent: int):
        voice_client = interaction.guild.voice_client
        if voice_client and voice_client.is_playing():
            voice_client.source.volume = percent / 100
            embed = Messages.volume_set(percent)
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.error("Nothing is playing.")
            await interaction.response.send_message(embed=embed)

    @tree.command(name='loop', description='Loop the current song')
    async def loop(interaction: discord.Interaction, option: str):
        voice_client = interaction.guild.voice_client
        if voice_client and voice_client.is_playing():
            if option.lower() == 'on':
                voice_client.loop = True
                embed = Messages.loop_on()
            elif option.lower() == 'off':
                voice_client.loop = False
                embed = Messages.loop_off()
            else:
                embed = Messages.error("Invalid option. Use /loop on or /loop off.")
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.error("Nothing is playing.")
            await interaction.response.send_message(embed=embed)

    @tree.command(name='add_to_playlist', description='Add a song to a playlist')
    async def add_to_playlist(interaction: discord.Interaction, name: str, url: str):
        if name not in playlists:
            playlists[name] = []
        playlists[name].append({'url': url, 'added_by': interaction.user.name})
        save_playlists()
        embed = Messages.added_to_playlist(name, url)
        await interaction.response.send_message(embed=embed)

    @tree.command(name='play_playlist', description='Play songs from a playlist')
    async def play_playlist(interaction: discord.Interaction, name: str):
        await interaction.response.defer()

        if name not in playlists:
            embed = Messages.error(f"Playlist {name} does not exist.")
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        if interaction.guild.voice_client is None:
            if interaction.user.voice:
                channel = interaction.user.voice.channel
                await channel.connect()
            else:
                embed = Messages.error("You are not in a voice channel.")
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

        for item in playlists[name]:
            url = item['url']
            if 'spotify.com' in url:
                player = await SpotifySource.from_spotify_url(url, loop=bot.loop)
            elif 'youtube.com' in url or 'youtu.be' in url:
                player = await YTDLSource.from_url(url, loop=bot.loop, stream=True)
            else:
                continue

            if interaction.guild.voice_client.is_playing() or interaction.guild.voice_client.is_paused():
                add_to_queue(player)
            else:
                interaction.guild.voice_client.play(player, after=lambda e: asyncio.run_coroutine_threadsafe(play_next(interaction), bot.loop).result())

        embed = Messages.playlist_started(name)
        await interaction.followup.send(embed=embed)

    @tree.command(name='list_playlists', description='List all playlists')
    async def list_playlists(interaction: discord.Interaction):
        embed = discord.Embed(title="Playlists", description="Here are all the playlists:", color=discord.Color.blue())
        for name, items in playlists.items():
            embed.add_field(name=name, value=", ".join([item['url'] for item in items]), inline=False)
        await interaction.response.send_message(embed=embed)

    @tree.command(name='clear', description='Clear messages in a channel')
    async def clear(interaction: discord.Interaction, number: int):
        if not interaction.user.guild_permissions.manage_messages:
            embed = Messages.error("You do not have permission to manage messages.")
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return

        await interaction.channel.purge(limit=number)
        embed = discord.Embed(title="Messages Cleared", description=f"Deleted {number} messages.", color=discord.Color.green())
        await interaction.followup.send(embed=embed, ephemeral=True)

    @tree.command(name='vote_skip', description='Vote to skip the current song')
    async def vote_skip(interaction: discord.Interaction):
        voice_client = interaction.guild.voice_client
        if not voice_client or not voice_client.is_playing():
            embed = Messages.error("Nothing is playing right now.")
            await interaction.response.send_message(embed=embed)
            return

        user_id = interaction.user.id
        if user_id in skip_votes:
            embed = Messages.error("You have already voted to skip.")
            await interaction.response.send_message(embed=embed)
            return

        skip_votes.add(user_id)
        num_votes = len(skip_votes)
        num_members = len(voice_client.channel.members) - 1  # Exclude the bot itself

        if num_votes >= (num_members // 2) + 1:
            voice_client.stop()
            skip_votes.clear()
            embed = Messages.skipped()
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.vote_skip(interaction.user.name, num_votes, num_members)
            await interaction.response.send_message(embed=embed)

skip_votes = set()
