require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Colors, REST, Routes, SlashCommandBuilder } = require('discord.js');
const mysql = require('mysql2/promise');

// ─── DB pool ─────────────────────────────────────────────────────────────────
// Supports Railway MySQL plugin (MYSQL_URL / MYSQL_* vars) and plain DB_* vars.

const dbConfig = (() => {
    const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
    if (url) return { uri: url, waitForConnections: true, connectionLimit: 5 };
    return {
        host:     process.env.MYSQL_HOST     || process.env.DB_HOST     || 'localhost',
        port:     parseInt(process.env.MYSQL_PORT     || process.env.DB_PORT     || '3306'),
        user:     process.env.MYSQL_USER     || process.env.DB_USER     || 'root',
        password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || process.env.DB_NAME     || 'fivem',
        waitForConnections: true,
        connectionLimit: 5,
    };
})();

const db = mysql.createPool(dbConfig);

// ─── Auto-create table ───────────────────────────────────────────────────────

async function ensureTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS \`playtime\` (
            \`license\`    VARCHAR(255) NOT NULL,
            \`discord_id\` VARCHAR(30)  DEFAULT NULL,
            \`name\`       VARCHAR(255) NOT NULL,
            \`playtime\`   INT          NOT NULL DEFAULT 0,
            PRIMARY KEY (\`license\`),
            INDEX \`idx_discord_id\` (\`discord_id\`)
        )
    `);
    console.log('✅  playtime table ready');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMinutes(totalMins) {
    if (totalMins < 1)  return 'Less than a minute';
    if (totalMins < 60) return `${totalMins} minute${totalMins !== 1 ? 's' : ''}`;
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    const hStr = `${h} hour${h !== 1 ? 's' : ''}`;
    const mStr = m > 0 ? ` ${m} minute${m !== 1 ? 's' : ''}` : '';
    return hStr + mStr;
}

function isAdmin(member) {
    const roleId = process.env.ADMIN_ROLE_ID;
    if (!roleId) return member.permissions.has('Administrator');
    return member.roles.cache.has(roleId) || member.permissions.has('Administrator');
}

// ─── Playtime embed ──────────────────────────────────────────────────────────

async function buildPlaytimeEmbed(targetUser, requesterId) {
    const [rows] = await db.query(
        'SELECT name, playtime FROM playtime WHERE discord_id = ?',
        [targetUser.id]
    );

    const isSelf        = targetUser.id === requesterId;
    const displayName   = targetUser.displayName ?? targetUser.username;
    const avatar        = targetUser.displayAvatarURL({ size: 128 });

    if (!rows.length || rows[0].playtime === 0) {
        return new EmbedBuilder()
            .setColor(0x2b2d31)
            .setDescription(
                isSelf
                    ? "You haven't played on the server yet."
                    : `**${displayName}** hasn't played on the server yet.`
            )
            .setFooter({ text: 'Next Playtime Tracker', iconURL: avatar })
            .setTimestamp();
    }

    const row   = rows[0];
    const mins  = row.playtime;
    const hours = Math.floor(mins / 60);
    const days  = Math.floor(hours / 24);
    const rem   = mins % 60;

    // Build a clean human-readable time string
    let timeStr;
    if (days > 0)        timeStr = `${days}d ${hours % 24}h ${rem}m`;
    else if (hours > 0)  timeStr = `${hours}h ${rem}m`;
    else                 timeStr = `${mins} minute${mins !== 1 ? 's' : ''}`;

    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: `${displayName}'s Playtime`, iconURL: avatar })
        .addFields(
            { name: 'Time Played', value: `\`\`\`${timeStr}\`\`\``, inline: false },
            { name: 'Total Hours', value: `${hours}h`,               inline: true  },
            { name: 'FiveM Name',  value: row.name,                  inline: true  },
        )
        .setThumbnail(avatar)
        .setFooter({ text: 'Next Playtime Tracker' })
        .setTimestamp();
}

// ─── Bot client ──────────────────────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ─── Auto-register slash commands ────────────────────────────────────────────

async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('playtime')
            .setDescription('Check how long a player has spent on the server')
            .addUserOption(opt =>
                opt.setName('user')
                    .setDescription('The player to check (leave empty for yourself)')
                    .setRequired(false)
            ),
        new SlashCommandBuilder()
            .setName('playtime-reset')
            .setDescription('[Admin] Reset playtime for a player or everyone')
            .addUserOption(opt =>
                opt.setName('user')
                    .setDescription('The player to reset (leave empty to reset ALL)')
                    .setRequired(false)
            ),
        new SlashCommandBuilder()
            .setName('playtime-top')
            .setDescription('Show the top players by total playtime')
            .addIntegerOption(opt =>
                opt.setName('limit')
                    .setDescription('How many players to show (default 10, max 25)')
                    .setMinValue(1)
                    .setMaxValue(25)
                    .setRequired(false)
            ),
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const guildId = process.env.GUILD_ID;

    if (guildId) {
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), { body: commands });
        console.log(`✅  Slash commands registered to guild ${guildId}`);
    } else {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('✅  Slash commands registered globally');
    }
}

client.once('ready', async () => {
    console.log(`✅  Logged in as ${client.user.tag}`);
    await registerCommands();
    await ensureTable();
});

const ALLOWED_CHANNEL = '1511322614889713784';

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.channelId !== ALLOWED_CHANNEL) {
        return interaction.reply({
            content: `❌ Playtime commands can only be used in <#${ALLOWED_CHANNEL}>.`,
            ephemeral: true,
        });
    }

    // ── /playtime [user] ────────────────────────────────────────────────────
    if (interaction.commandName === 'playtime') {
        await interaction.deferReply();

        const target = interaction.options.getUser('user') ?? interaction.user;

        try {
            const embed = await buildPlaytimeEmbed(target, interaction.user.id);
            await interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error('[playtime]', err);
            await interaction.editReply('❌ Database error — please try again later.');
        }
        return;
    }

    // ── /playtime-reset [user] ───────────────────────────────────────────────
    if (interaction.commandName === 'playtime-reset') {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({
                content: '❌ You need the admin role to use this command.',
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const target = interaction.options.getUser('user');

        try {
            if (target) {
                const [res] = await db.query(
                    'UPDATE playtime SET playtime = 0 WHERE discord_id = ?',
                    [target.id]
                );

                if (res.affectedRows === 0) {
                    return interaction.editReply(`⚠️ No record found for ${target}.`);
                }

                const embed = new EmbedBuilder()
                    .setColor(Colors.Red)
                    .setTitle('Playtime Reset')
                    .setDescription(`Reset playtime for ${target} to **0**.`)
                    .setThumbnail(target.displayAvatarURL())
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            } else {
                // Reset ALL
                await db.query('UPDATE playtime SET playtime = 0');

                const embed = new EmbedBuilder()
                    .setColor(Colors.Red)
                    .setTitle('All Playtimes Reset')
                    .setDescription('Every player\'s playtime has been set to **0**.')
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }
        } catch (err) {
            console.error('[playtime-reset]', err);
            return interaction.editReply('❌ Database error — please try again later.');
        }
    }

    // ── /playtime-top [limit] ────────────────────────────────────────────────
    if (interaction.commandName === 'playtime-top') {
        await interaction.deferReply();

        const limit = interaction.options.getInteger('limit') ?? 10;

        try {
            const [rows] = await db.query(
                'SELECT name, discord_id, playtime FROM playtime ORDER BY playtime DESC LIMIT ?',
                [limit]
            );

            if (!rows.length) {
                return interaction.editReply('No playtime data yet.');
            }

            const medals = ['🥇', '🥈', '🥉'];
            const lines  = rows.map((r, i) => {
                const mention = r.discord_id ? `<@${r.discord_id}>` : `\`${r.name}\``;
                const rank    = medals[i] ?? `**#${i + 1}**`;
                return `${rank} ${mention} — ${formatMinutes(r.playtime)}`;
            });

            const embed = new EmbedBuilder()
                .setColor(0xFFD700)
                .setTitle(`🏆 Top ${rows.length} Players`)
                .setDescription(lines.join('\n'))
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        } catch (err) {
            console.error('[playtime-top]', err);
            return interaction.editReply('❌ Database error — please try again later.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
