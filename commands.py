# commands.py

import discord
from discord.ext import commands
from discord import app_commands
from youtubesearchpython import VideosSearch
import asyncio
from messages import Messages  # Ensure this is your custom Messages class
import traceback
import os
import json

# Assume that YTDLSource, SpotifySource, and other necessary classes are imported or defined elsewhere
# If not, please include them accordingly

def setup_commands(tree, bot, sp, genius, music_instances, Music, YTDLSource, SpotifySource):
    async def get_music_instance(guild):
        """Retrieve or create a Music instance for the guild."""
        if guild.id not in music_instances:
            music_instances[guild.id] = Music(bot)
        return music_instances[guild.id]
    
    async def search_youtube_video(query):
        """
        Search YouTube for a video matching the query.
        Uses the synchronous VideosSearch class within an executor to maintain async behavior.
        """
        try:
            loop = asyncio.get_event_loop()
            search = VideosSearch(query, limit=1)
            # VideosSearch is synchronous, so run it in an executor
            result = await loop.run_in_executor(None, lambda: search.result())
            if result['result']:
                video_url = result['result'][0]['link']
                return video_url
            else:
                return None
        except Exception as e:
            print(f"Error in search_youtube_video: {e}")
            return None

    @tree.command(name='join', description='Join your voice channel.')
    async def join(interaction: discord.Interaction):
        guild = interaction.guild
        if guild.voice_client is not None:
            await interaction.response.send_message("I'm already connected to a voice channel.", ephemeral=True)
            return

        if interaction.user.voice:
            channel = interaction.user.voice.channel
            try:
                await channel.connect()
                embed = Messages.success("Joined your voice channel!")
                await interaction.response.send_message(embed=embed)
            except Exception as e:
                embed = Messages.error(f"Failed to join voice channel: {e}")
                await interaction.response.send_message(embed=embed, ephemeral=True)
        else:
            embed = Messages.error("You are not connected to a voice channel.")
            await interaction.response.send_message(embed=embed, ephemeral=True)

    @tree.command(name='leave', description='Leave the voice channel.')
    async def leave(interaction: discord.Interaction):
        guild = interaction.guild
        voice_client = guild.voice_client
        if voice_client is not None:
            await voice_client.disconnect()
            embed = Messages.success("Left the voice channel.")
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.error("I'm not connected to any voice channel.")
            await interaction.response.send_message(embed=embed, ephemeral=True)

    @tree.command(name='play', description='Play a song from YouTube or Spotify or search by keywords.')
    async def play(interaction: discord.Interaction, query: str):
        await interaction.response.defer()
        guild = interaction.guild
        music = await get_music_instance(guild)
        music.channel = interaction.channel

        # Connect to voice channel if not already connected
        if guild.voice_client is None or not guild.voice_client.is_connected():
            if interaction.user.voice:
                channel = interaction.user.voice.channel
                try:
                    await channel.connect()
                except Exception as e:
                    embed = Messages.error(f"Failed to connect to the voice channel: {e}")
                    await interaction.followup.send(embed=embed, ephemeral=True)
                    return
            else:
                embed = Messages.error("You are not in a voice channel.")
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

        try:
            if 'spotify.com' in query:
                # Handle Spotify URLs
                player = await SpotifySource.from_spotify_url(query, loop=bot.loop)
            elif 'youtube.com' in query or 'youtu.be' in query:
                # Handle YouTube URLs
                player = await YTDLSource.from_url(query, loop=bot.loop, stream=True)
            else:
                # Search YouTube for the query
                search_url = await search_youtube_video(query)
                if search_url is not None:
                    player = await YTDLSource.from_url(search_url, loop=bot.loop, stream=True)
                else:
                    embed = Messages.error("No results found.")
                    await interaction.followup.send(embed=embed, ephemeral=True)
                    return
        except Exception as e:
            traceback.print_exc()
            embed = Messages.error(f"An error occurred: {e}")
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        voice_client = guild.voice_client
        if voice_client.is_playing() or voice_client.is_paused():
            # Add to queue if something is already playing
            music.queue.append(player)
            embed = Messages.added_to_queue(player.title)
            await interaction.followup.send(embed=embed)
        else:
            # Play immediately if nothing is playing
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

    @tree.command(name='pause', description='Pause the playback.')
    async def pause(interaction: discord.Interaction):
        guild = interaction.guild
        voice_client = guild.voice_client
        if voice_client and voice_client.is_playing():
            voice_client.pause()
            embed = Messages.success("Playback paused.")
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.error("Nothing is playing.")
            await interaction.response.send_message(embed=embed, ephemeral=True)

    @tree.command(name='resume', description='Resume the playback.')
    async def resume(interaction: discord.Interaction):
        guild = interaction.guild
        voice_client = guild.voice_client
        if voice_client and voice_client.is_paused():
            voice_client.resume()
            embed = Messages.success("Playback resumed.")
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.error("Playback is not paused.")
            await interaction.response.send_message(embed=embed, ephemeral=True)

    @tree.command(name='skip', description='Skip the current song.')
    async def skip(interaction: discord.Interaction):
        guild = interaction.guild
        voice_client = guild.voice_client
        if voice_client and voice_client.is_playing():
            voice_client.stop()
            embed = Messages.success("Skipped the current song.")
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.error("Nothing is playing.")
            await interaction.response.send_message(embed=embed, ephemeral=True)

    @tree.command(name='stop', description='Stop the playback and clear the queue.')
    async def stop(interaction: discord.Interaction):
        guild = interaction.guild
        music = await get_music_instance(guild)
        await music.stop(guild)
        embed = Messages.success("Playback stopped and queue cleared.")
        await interaction.response.send_message(embed=embed)

    @tree.command(name='lyrics', description='Fetch the lyrics for the current song.')
    async def lyrics(interaction: discord.Interaction):
        guild = interaction.guild
        music = await get_music_instance(guild)
        if music.current:
            try:
                song_title = music.current.title
                lyrics = genius.search_song(song_title)
                if lyrics and lyrics.lyrics:
                    embed = Messages.lyrics(song_title, lyrics.lyrics)
                    await interaction.response.send_message(embed=embed)
                else:
                    embed = Messages.error("Lyrics not found for this song.")
                    await interaction.response.send_message(embed=embed, ephemeral=True)
            except Exception as e:
                traceback.print_exc()
                embed = Messages.error(f"An error occurred while fetching lyrics: {e}")
                await interaction.followup.send(embed=embed, ephemeral=True)
        else:
            embed = Messages.error("No song is currently playing.")
            await interaction.response.send_message(embed=embed, ephemeral=True)

    @tree.command(name='help', description='Show help information.')
    async def help_command(interaction: discord.Interaction):
        embed = Messages.help()
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @tree.command(name='volume', description='Set the playback volume (0-100).')
    async def volume(interaction: discord.Interaction, percent: int):
        guild = interaction.guild
        music = await get_music_instance(guild)
        if 0 <= percent <= 100:
            if guild.voice_client and guild.voice_client.source:
                guild.voice_client.source.volume = percent / 100
                embed = Messages.success(f"Volume set to {percent}%.")
                await interaction.response.send_message(embed=embed)
            else:
                embed = Messages.error("Nothing is playing.")
                await interaction.response.send_message(embed=embed, ephemeral=True)
        else:
            embed = Messages.error("Please provide a volume between 0 and 100.")
            await interaction.response.send_message(embed=embed, ephemeral=True)

    @tree.command(name='loop', description='Enable or disable looping of the current song.')
    async def loop_command(interaction: discord.Interaction, state: str):
        guild = interaction.guild
        music = await get_music_instance(guild)
        if state.lower() in ['on', 'off']:
            music.loop = True if state.lower() == 'on' else False
            status = "enabled" if music.loop else "disabled"
            embed = Messages.success(f"Looping {status}.")
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.error("Please specify `on` or `off` for the loop command.")
            await interaction.response.send_message(embed=embed, ephemeral=True)

    @tree.command(name='add_to_playlist', description='Add a song to a custom playlist.')
    async def add_to_playlist(interaction: discord.Interaction, name: str, url: str):
        guild = interaction.guild
        # Implementation depends on how playlists are managed
        # Example:
        # Add the song to a JSON or database file under the specified playlist name
        try:
            # Placeholder implementation
            # You need to implement the actual storage logic
            # For example, using a JSON file:
            playlists_file = 'playlists.json'
            if os.path.exists(playlists_file):
                with open(playlists_file, 'r') as f:
                    playlists = json.load(f)
            else:
                playlists = {}
            if name not in playlists:
                playlists[name] = []
            playlists[name].append(url)
            with open(playlists_file, 'w') as f:
                json.dump(playlists, f, indent=4)
            embed = Messages.success(f"Added to playlist `{name}`.")
            await interaction.response.send_message(embed=embed)
        except Exception as e:
            traceback.print_exc()
            embed = Messages.error(f"Failed to add to playlist: {e}")
            await interaction.response.send_message(embed=embed, ephemeral=True)

    @tree.command(name='play_playlist', description='Play songs from a custom playlist.')
    async def play_playlist(interaction: discord.Interaction, name: str):
        guild = interaction.guild
        music = await get_music_instance(guild)
        try:
            playlists_file = 'playlists.json'
            if os.path.exists(playlists_file):
                with open(playlists_file, 'r') as f:
                    playlists = json.load(f)
            else:
                playlists = {}
            if name not in playlists or not playlists[name]:
                embed = Messages.error(f"Playlist `{name}` does not exist or is empty.")
                await interaction.response.send_message(embed=embed, ephemeral=True)
                return
            for url in playlists[name]:
                # Reuse the /play command logic
                if 'spotify.com' in url:
                    player = await SpotifySource.from_spotify_url(url, loop=bot.loop)
                elif 'youtube.com' in url or 'youtu.be' in url:
                    player = await YTDLSource.from_url(url, loop=bot.loop, stream=True)
                else:
                    search_url = await search_youtube_video(url)
                    if search_url is not None:
                        player = await YTDLSource.from_url(search_url, loop=bot.loop, stream=True)
                    else:
                        continue  # Skip if not found
                if guild.voice_client.is_playing() or guild.voice_client.is_paused():
                    music.queue.append(player)
                else:
                    music.current = player

                    # Create a new MusicControls view
                    view = MusicControls(interaction, music, guild.voice_client)
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

                    guild.voice_client.play(player, after=after_playing)
            embed = Messages.success(f"Playing playlist `{name}`.")
            await interaction.followup.send(embed=embed)
        except Exception as e:
            traceback.print_exc()
            embed = Messages.error(f"Failed to play playlist: {e}")
            await interaction.followup.send(embed=embed, ephemeral=True)

    @tree.command(name='vote_skip', description='Vote to skip the current song.')
    async def vote_skip(interaction: discord.Interaction):
        guild = interaction.guild
        music = await get_music_instance(guild)
        voice_client = guild.voice_client
        if not voice_client or not voice_client.is_playing():
            embed = Messages.error("Nothing is playing.")
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return

        user = interaction.user
        if user in music.skip_votes:
            embed = Messages.error("You have already voted to skip.")
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return

        music.skip_votes.add(user)
        total_votes = len(music.skip_votes)
        required_votes = max(1, len(voice_client.channel.members) // 2)

        if total_votes >= required_votes:
            voice_client.stop()
            embed = Messages.success("Skip vote passed. Skipping the current song.")
            music.skip_votes.clear()
            await interaction.response.send_message(embed=embed)
        else:
            embed = Messages.info(f"Skip vote added. {total_votes}/{required_votes} votes.")
            await interaction.response.send_message(embed=embed)

    @tree.command(name='clear', description='Clear a number of messages in a channel (admin only).')
    async def clear(interaction: discord.Interaction, number: int):
        if not interaction.user.guild_permissions.manage_messages:
            embed = Messages.error("You do not have permission to use this command.")
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return

        if number < 1 or number > 100:
            embed = Messages.error("Please specify a number between 1 and 100.")
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return

        try:
            deleted = await interaction.channel.purge(limit=number + 1)  # +1 to include the command message
            embed = Messages.success(f"Deleted {len(deleted) - 1} messages.")
            await interaction.channel.send(embed=embed, delete_after=5)
        except Exception as e:
            traceback.print_exc()
            embed = Messages.error(f"Failed to delete messages: {e}")
            await interaction.response.send_message(embed=embed, ephemeral=True)

    @tree.command(name='list_playlists', description='List all custom playlists and their creators.')
    async def list_playlists(interaction: discord.Interaction):
        try:
            playlists_file = 'playlists.json'
            if os.path.exists(playlists_file):
                with open(playlists_file, 'r') as f:
                    playlists = json.load(f)
            else:
                playlists = {}

            if not playlists:
                embed = Messages.info("No playlists found.")
                await interaction.response.send_message(embed=embed, ephemeral=True)
                return

            embed = discord.Embed(title="Custom Playlists", color=discord.Color.blue())
            for name, songs in playlists.items():
                embed.add_field(name=name, value=f"{len(songs)} songs", inline=False)
            await interaction.response.send_message(embed=embed)
        except Exception as e:
            traceback.print_exc()
            embed = Messages.error(f"Failed to list playlists: {e}")
            await interaction.response.send_message(embed=embed, ephemeral=True)

    # MusicControls View Class
    class MusicControls(discord.ui.View):
        def __init__(self, interaction, music, voice_client):
            super().__init__(timeout=None)
            self.interaction = interaction
            self.music = music
            self.voice_client = voice_client
            self.message = None  # Will be set when the message is sent

        async def interaction_check(self, interaction: discord.Interaction) -> bool:
            """Ensure only users in the same voice channel can interact with the controls."""
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
            """Disable all buttons in the view."""
            for item in self.children:
                item.disabled = True
            if self.message:
                await self.message.edit(view=self)
