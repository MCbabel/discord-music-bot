# messages.py

import discord

class Messages:
    @staticmethod
    def error(message):
        return discord.Embed(title="❌ Error", description=message, color=discord.Color.red())

    @staticmethod
    def connected(channel):
        return discord.Embed(title="🔗 Connected", description=f"Connected to **{channel}**.", color=discord.Color.green())

    @staticmethod
    def disconnected():
        return discord.Embed(title="🔌 Disconnected", description="The bot has left the voice channel.", color=discord.Color.orange())

    @staticmethod
    def now_playing(title):
        return discord.Embed(title="🎵 Now playing", description=f"Playing: **{title}**", color=discord.Color.blue())

    @staticmethod
    def added_to_queue(title):
        return discord.Embed(title="➕ Added to queue", description=f"The song **{title}** has been added to the queue.", color=discord.Color.purple())

    @staticmethod
    def skipped():
        return discord.Embed(title="⏩ Skipped", description="The current song has been skipped.", color=discord.Color.orange())

    @staticmethod
    def paused():
        return discord.Embed(title="⏸️ Paused", description="Playback has been paused.", color=discord.Color.yellow())

    @staticmethod
    def resumed():
        return discord.Embed(title="▶️ Resumed", description="Playback has been resumed.", color=discord.Color.green())

    @staticmethod
    def stopped():
        return discord.Embed(title="⏹️ Stopped", description="Playback has been stopped.", color=discord.Color.red())

    @staticmethod
    def lyrics(title, lyrics):
        return discord.Embed(title=f"📜 Lyrics for {title}", description=lyrics[:2048], color=discord.Color.blue())

    @staticmethod
    def volume_set(percent):
        return discord.Embed(title="🔊 Volume Set", description=f"The volume has been set to **{percent}%**.", color=discord.Color.green())

    @staticmethod
    def loop_on():
        return discord.Embed(title="🔁 Loop On", description="The current song will now loop.", color=discord.Color.green())

    @staticmethod
    def loop_off():
        return discord.Embed(title="🔁 Loop Off", description="The current song will no longer loop.", color=discord.Color.red())

    @staticmethod
    def added_to_playlist(name, url):
        return discord.Embed(title="🎶 Added to Playlist", description=f"The song **{url}** has been added to the playlist **{name}**.", color=discord.Color.blue())

    @staticmethod
    def playlist_started(name):
        return discord.Embed(title="🎵 Playlist Started", description=f"Playing songs from the playlist **{name}**.", color=discord.Color.blue())

    @staticmethod
    def vote_skip(user_name, num_votes, num_members):
        return discord.Embed(title="🗳️ Vote to Skip", description=f"**{user_name}** has voted to skip the song.\nVotes: **{num_votes}/{num_members}**", color=discord.Color.blue())

    @staticmethod
    def messages_cleared(number):
        return discord.Embed(title="🧹 Messages Cleared", description=f"Deleted {number} messages.", color=discord.Color.green())

    @staticmethod
    def success(message):
        """Create a success embed."""
        return discord.Embed(title="✅ Success", description=message, color=discord.Color.green())
