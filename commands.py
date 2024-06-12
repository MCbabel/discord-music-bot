import discord
from discord import app_commands
from messages import Messages
import asyncio

def setup_commands(tree, bot, sp, genius, queue, add_to_queue, play_next, YTDLSource, SpotifySource):
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
                embed = Messages.error("Only YouTube and Spotify links are supported.")
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
        else:
            await interaction.response.send_message(embed=Messages.error("Nothing is playing."))

    @tree.command(name='pause', description='Pause the playback')
    async def pause(interaction: discord.Interaction):
        voice_client = interaction.guild.voice_client
        if voice_client.is_playing():
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
        embed.add_field(name="/clear <number>", value="Clear messages in a channel", inline=False)
        await interaction.response.send_message(embed=embed)

    @tree.command(name='clear', description='Clear messages in a channel')
    async def clear(interaction: discord.Interaction, number: int):
        if not interaction.user.guild_permissions.manage_messages:
            embed = Messages.error("You do not have permission to manage messages.")
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return

        # Sende sofort eine Antwort, um die Interaktion zu bestätigen
        await interaction.response.send_message(embed=discord.Embed(title="Clearing messages...", description=f"Attempting to delete {number} messages.", color=discord.Color.blue()), ephemeral=True)

        # Lösche die Nachrichten
        await interaction.channel.purge(limit=number)
        embed = discord.Embed(title="Messages Cleared", description=f"Deleted {number} messages.", color=discord.Color.green())
        await interaction.followup.send(embed=embed, ephemeral=True)
