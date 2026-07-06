require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('playtime')
        .setDescription('Check how long a player has spent on the server')
        .addUserOption(opt =>
            opt
                .setName('user')
                .setDescription('The player to check (leave empty for yourself)')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('playtime-reset')
        .setDescription('[Admin] Reset playtime for a player or everyone')
        .addUserOption(opt =>
            opt
                .setName('user')
                .setDescription('The player to reset (leave empty to reset ALL)')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('playtime-top')
        .setDescription('Show the top players by total playtime')
        .addIntegerOption(opt =>
            opt
                .setName('limit')
                .setDescription('How many players to show (default 10, max 25)')
                .setMinValue(1)
                .setMaxValue(25)
                .setRequired(false)
        ),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log(`Registering ${commands.length} slash command(s)…`);

        const guildId = process.env.GUILD_ID;
        if (guildId) {
            // Guild-scoped (instant, use during dev)
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
                { body: commands }
            );
            console.log(`✅  Commands registered to guild ${guildId}`);
        } else {
            // Global (takes up to 1 hour to propagate)
            await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commands }
            );
            console.log('✅  Commands registered globally');
        }
    } catch (err) {
        console.error(err);
    }
})();
