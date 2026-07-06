require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Colors } = require('discord.js');
const mysql = require('mysql2/promise');

// ─── DB pool ─────────────────────────────────────────────────────────────────

const db = mysql.createPool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306'),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'fivem',
    waitForConnections: true,
    connectionLimit: 5,
});

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

function progressBar(current, max, length = 20) {
    const filled = Math.round((current / max) * length);
    return '█'.repeat(filled) + '░'.repeat(length - filled);
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

    const isSelf = targetUser.id === requesterId;
    const displayName = targetUser.displayName ?? targetUser.username;

    if (!rows.length || rows[0].playtime === 0) {
        return new EmbedBuilder()
            .setColor(Colors.Orange)
            .setTitle('No playtime found')
            .setDescription(
                isSelf
                    ? "You haven't played on the server yet — or your account hasn't been linked."
                    : `**${displayName}** hasn't played on the server yet.`
            )
            .setThumbnail(targetUser.displayAvatarURL())
            .setTimestamp();
    }

    const row   = rows[0];
    const mins  = row.playtime;
    const hours = Math.floor(mins / 60);

    // Milestones for the progress bar (next 10-hour checkpoint)
    const nextMilestone = Math.ceil(hours / 10) * 10 || 10;
    const bar = progressBar(hours % 10, 10);

    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({
            name:    isSelf ? 'Your Playtime' : `${displayName}'s Playtime`,
            iconURL: targetUser.displayAvatarURL(),
        })
        .setTitle(`${isSelf ? '🕹️ Your Stats' : `🕹️ ${displayName}'s Stats`}`)
        .addFields(
            { name: '⏱️ Total Playtime',  value: formatMinutes(mins),                    inline: true  },
            { name: '📅 Hours',            value: `${hours}h ${mins % 60}m`,              inline: true  },
            { name: '\u200b',              value: '\u200b',                               inline: false },
            { name: `Progress to ${nextMilestone}h`, value: `\`${bar}\` ${hours % 10}/10h`, inline: false },
        )
        .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
        .setFooter({ text: `FiveM Name: ${row.name}` })
        .setTimestamp();
}

// ─── Bot client ──────────────────────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
    console.log(`✅  Logged in as ${client.user.tag}`);
    await ensureTable();
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

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
