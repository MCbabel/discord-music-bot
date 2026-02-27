import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error('❌ DISCORD_TOKEN not found in .env');
    process.exit(1);
}

const rest = new REST().setToken(token);

async function resetCommands() {
    try {
        // Get bot's application ID
        const me = await rest.get(Routes.user());
        const appId = me.id;
        console.log(`🤖 Bot: ${me.username}#${me.discriminator} (${appId})`);

        // Clear global commands
        console.log('🗑️  Clearing all global slash commands...');
        await rest.put(Routes.applicationCommands(appId), { body: [] });
        console.log('✅ Global commands cleared.');

        // Clear guild-specific commands
        const guilds = await rest.get(Routes.userGuilds());
        for (const guild of guilds) {
            console.log(`🗑️  Clearing commands for guild: ${guild.name} (${guild.id})`);
            await rest.put(Routes.applicationGuildCommands(appId, guild.id), { body: [] });
        }
        console.log(`✅ Cleared commands for ${guilds.length} guild(s).`);

        console.log('\n🔄 Now restart the bot with: node src/index.js');
        console.log('   Commands will be re-registered automatically on startup.');
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

resetCommands();
