import discord
from discord import app_commands
from messages import Messages
from datetime import datetime, timedelta, timezone
import asyncio
import json
import aiofiles
import os

MAX_VOLUME = 1000

# Dictionary to store playlists
playlists = {}
PLAYLISTS_FILE = "playlists.json"

# Load playlists from file if it exists
if os.path.exists(PLAYLISTS_FILE):
    with open(PLAYLISTS_FILE, "r") as file:
        playlists = json.load(file)

async def save_playlists_async():
    async with aiofiles.open(PLAYLISTS_FILE, "w") as file:
        await file.write(json.dumps(playlists, indent=4))

def setup_commands(tree, bot, sp, genius, music_instances, Music, YTDLSource, SpotifySource):

    async def get_music_instance(guild):
        if guild.id not in music_instances:
            music_instances[guild.id] = Music(bot)
        return music_instances[guild.id]

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
        guild = interaction.guild
        music = await get_music_instance(guild)
        if guild.voice_client:
            await music.stop(guild)
            del music_instances[guild.id]
            embed = Messages.disconnected()
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.error("The bot is not in a voice channel.")
            await interaction.response.send_message(embed=embed)

    @tree.command(name='play', description='Play a YouTube or Spotify video')
    async def play(interaction: discord.Interaction, url: str):
        await interaction.response.defer()
        guild = interaction.guild
        music = await get_music_instance(guild)
        music.channel = interaction.channel  # Set the text channel

        if guild.voice_client is None or not guild.voice_client.is_connected():
            if interaction.user.voice:
                channel = interaction.user.voice.channel
                await channel.connect()
            else:
                embed = Messages.error("You are not in a voice channel.")
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

        try:
            async with interaction.channel.typing():
                if 'spotify.com' in url:
                    player = await SpotifySource.from_spotify_url(url, loop=bot.loop)
                elif 'youtube.com' in url or 'youtu.be' in url:
                    player = await YTDLSource.from_url(url, loop=bot.loop, stream=True)
                else:
                    embed = Messages.error("Invalid URL. Only YouTube and Spotify URLs are supported.")
                    await interaction.followup.send(embed=embed, ephemeral=True)
                    return
        except Exception as e:
            embed = Messages.error(f"An error occurred: {e}")
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        voice_client = guild.voice_client
        if voice_client.is_playing() or voice_client.is_paused():
            music.queue.append(player)
            embed = Messages.added_to_queue(player.title)
            await interaction.followup.send(embed=embed)
        else:
            music.current = player

            # Create a new MusicControls view
            view = MusicControls(interaction, music, voice_client)
            message = await interaction.followup.send(embed=Messages.now_playing(player.title), view=view)
            view.message = message  # Reference to the message containing the view
            music.view = view  # Store the view in the music instance

            def after_playing(error):
                if error:
                    print(f"Player error: {error}")
                coro = music.play_next(guild)
                fut = asyncio.run_coroutine_threadsafe(coro, bot.loop)
                try:
                    fut.result()
                except Exception as e:
                    print(f"Error in after_playing: {e}")

            voice_client.play(player, after=after_playing)

    @tree.command(name='skip', description='Skip the current song')
    async def skip(interaction: discord.Interaction):
        guild = interaction.guild
        music = await get_music_instance(guild)
        voice_client = guild.voice_client
        if voice_client and voice_client.is_playing():
            if music.queue or music.loop:
                voice_client.stop()
                embed = Messages.skipped()
                await interaction.response.send_message(embed=embed)
            else:
                embed = Messages.error("No more songs in the queue to skip to.")
                await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.error("Nothing is playing.")
            await interaction.response.send_message(embed=embed)

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
            embed = Messages.error("Playback is not paused.")
            await interaction.response.send_message(embed=embed)

    @tree.command(name='stop', description='Stop the playback')
    async def stop(interaction: discord.Interaction):
        guild = interaction.guild
        music = await get_music_instance(guild)
        voice_client = guild.voice_client
        if voice_client and (voice_client.is_playing() or voice_client.is_paused()):
            await music.stop(guild)
            del music_instances[guild.id]
            embed = Messages.stopped()
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.error("Nothing is playing.")
            await interaction.response.send_message(embed=embed)

    @tree.command(name='lyrics', description='Fetch the lyrics for the current song')
    async def lyrics_command(interaction: discord.Interaction):
        guild = interaction.guild
        music = await get_music_instance(guild)
        voice_client = guild.voice_client
        if voice_client and (voice_client.is_playing() or voice_client.is_paused()):
            current_song = music.current.title if music.current else "Unknown"
            try:
                song = genius.search_song(current_song)
                if song:
                    embed = Messages.lyrics(song.title, song.lyrics)
                    await interaction.response.send_message(embed=embed)
                else:
                    embed = Messages.error("Lyrics not found.")
                    await interaction.response.send_message(embed=embed)
            except Exception as e:
                embed = Messages.error(f"An error occurred: {e}")
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
        embed.add_field(name="/list_playlists", value="List all playlists and their creators", inline=False)
        await interaction.response.send_message(embed=embed)

    @tree.command(name='volume', description='Set the volume of the playback')
    async def volume(interaction: discord.Interaction, percent: int):
        if percent > MAX_VOLUME:
            percent = MAX_VOLUME

        voice_client = interaction.guild.voice_client
        if voice_client and voice_client.is_playing():
            voice_client.source.volume = percent / 100
            embed = Messages.volume_set(percent)
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.error("Nothing is playing.")
            await interaction.response.send_message(embed=embed)

    @tree.command(name='loop', description='Loop the current song')
    async def loop_command(interaction: discord.Interaction, option: str):
        guild = interaction.guild
        music = await get_music_instance(guild)
        if option.lower() == 'on':
            music.loop = True
            embed = Messages.loop_on()
        elif option.lower() == 'off':
            music.loop = False
            embed = Messages.loop_off()
        else:
            embed = Messages.error("Invalid option. Use /loop on or /loop off.")
            await interaction.response.send_message(embed=embed)
            return
        await interaction.response.send_message(embed=embed)

    @tree.command(name='add_to_playlist', description='Add a song to a playlist')
    async def add_to_playlist(interaction: discord.Interaction, name: str, url: str):
        if name not in playlists:
            playlists[name] = {"creator": interaction.user.name, "songs": []}
        playlists[name]["songs"].append(url)
        await save_playlists_async()
        embed = Messages.added_to_playlist(name, url)
        await interaction.response.send_message(embed=embed)

    @tree.command(name='play_playlist', description='Play songs from a playlist')
    async def play_playlist(interaction: discord.Interaction, name: str):
        await interaction.response.defer()
        guild = interaction.guild
        music = await get_music_instance(guild)
        music.channel = interaction.channel

        if name not in playlists:
            embed = Messages.error(f"Playlist {name} does not exist.")
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        if guild.voice_client is None or not guild.voice_client.is_connected():
            if interaction.user.voice:
                channel = interaction.user.voice.channel
                await channel.connect()
            else:
                embed = Messages.error("You are not in a voice channel.")
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

        for url in playlists[name]["songs"]:
            try:
                if 'spotify.com' in url:
                    player = await SpotifySource.from_spotify_url(url, loop=bot.loop)
                elif 'youtube.com' in url or 'youtu.be' in url:
                    player = await YTDLSource.from_url(url, loop=bot.loop, stream=True)
                else:
                    continue
            except Exception as e:
                print(f"Error loading song from playlist: {e}")
                continue

            voice_client = guild.voice_client
            if voice_client.is_playing() or voice_client.is_paused():
                music.queue.append(player)
            else:
                music.current = player

                # Create a new MusicControls view
                view = MusicControls(interaction, music, voice_client)
                message = await interaction.followup.send(embed=Messages.now_playing(player.title), view=view)
                view.message = message  # Reference to the message containing the view
                music.view = view  # Store the view in the music instance

                def after_playing(error):
                    if error:
                        print(f"Player error: {error}")
                    coro = music.play_next(guild)
                    fut = asyncio.run_coroutine_threadsafe(coro, bot.loop)
                    try:
                        fut.result()
                    except Exception as e:
                        print(f"Error in after_playing: {e}")

                voice_client.play(player, after=after_playing)

        embed = Messages.playlist_started(name)
        await interaction.followup.send(embed=embed)

    @tree.command(name='clear', description='Clear messages in a channel')
    async def clear(interaction: discord.Interaction, number: int):
        if not interaction.user.guild_permissions.manage_messages:
            embed = Messages.error("You do not have permission to manage messages.")
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return

        # Defer the interaction
        await interaction.response.defer()

        # Calculate the time 14 days ago as a timezone-aware datetime
        fourteen_days_ago = datetime.now(timezone.utc) - timedelta(days=14)

        def check(msg):
            # Exclude pinned messages, messages older than 14 days, and messages from the bot
            return (
                not msg.pinned and
                msg.created_at >= fourteen_days_ago and
                msg.author != bot.user
            )

        try:
            deleted = await interaction.channel.purge(limit=number, check=check)
            if deleted:
                embed = Messages.messages_cleared(len(deleted))
                await interaction.followup.send(embed=embed)
            else:
                embed = Messages.error("No messages were deleted. There may be no messages to delete or messages are too old.")
                await interaction.followup.send(embed=embed)
        except Exception as e:
            embed = Messages.error(f"An error occurred: {e}")
            await interaction.followup.send(embed=embed)

    @tree.command(name='vote_skip', description='Vote to skip the current song')
    async def vote_skip(interaction: discord.Interaction):
        guild = interaction.guild
        music = await get_music_instance(guild)
        voice_client = guild.voice_client
        if not voice_client or not voice_client.is_playing():
            embed = Messages.error("Nothing is playing right now.")
            await interaction.response.send_message(embed=embed)
            return

        user_id = interaction.user.id
        if user_id in music.skip_votes:
            embed = Messages.error("You have already voted to skip.")
            await interaction.response.send_message(embed=embed)
            return

        music.skip_votes.add(user_id)
        num_votes = len(music.skip_votes)
        num_members = len(voice_client.channel.members) - 1  # Exclude the bot itself

        if num_votes >= (num_members // 2) + 1:
            voice_client.stop()
            music.skip_votes.clear()
            embed = Messages.skipped()
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.vote_skip(interaction.user.name, num_votes, num_members)
            await interaction.response.send_message(embed=embed)

    @tree.command(name='list_playlists', description='List all playlists and their creators')
    async def list_playlists(interaction: discord.Interaction):
        if not playlists:
            embed = Messages.no_playlists_available()
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return

        embed = discord.Embed(title="Playlists", color=discord.Color.blue())
        for name, details in playlists.items():
            if isinstance(details, dict):
                creator = details.get('creator', 'Unknown')
            else:
                creator = 'Unknown'
            embed.add_field(name=name, value=f"Created by: {creator}", inline=False)

        await interaction.response.send_message(embed=embed)
