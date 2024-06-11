import discord

class Messages:
    @staticmethod
    def error(message):
        return discord.Embed(title="Error", description=message, color=discord.Color.red())

    @staticmethod
    def connected(channel):
        return discord.Embed(title="Connected", description=f"Connected to {channel}.", color=discord.Color.green())

    @staticmethod
    def disconnected():
        return discord.Embed(title="Disconnected", description="The bot has left the voice channel.", color=discord.Color.orange())

    @staticmethod
    def now_playing(title):
        return discord.Embed(title="Now playing", description=f"Playing: {title}", color=discord.Color.blue())

    @staticmethod
    def added_to_queue(title):
        return discord.Embed(title="Added to queue", description=f"The song {title} has been added to the queue.", color=discord.Color.purple())

    @staticmethod
    def skipped():
        return discord.Embed(title="Skipped", description="The current song has been skipped.", color=discord.Color.orange())

    @staticmethod
    def paused():
        return discord.Embed(title="Paused", description="Playback has been paused.", color=discord.Color.yellow())

    @staticmethod
    def resumed():
        return discord.Embed(title="Resumed", description="Playback has been resumed.", color=discord.Color.green())

    @staticmethod
    def stopped():
        return discord.Embed(title="Stopped", description="Playback has been stopped.", color=discord.Color.red())

    @staticmethod
    def lyrics(title, lyrics):
        return discord.Embed(title=f"Lyrics for {title}", description=lyrics[:2048], color=discord.Color.blue())
