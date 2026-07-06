# Next Playtime Tracker

FiveM playtime tracker with a Discord bot.  
Since Discord is required to join the server, every player is already linked — no manual setup needed.

---

## Commands

| Command | Description |
|---|---|
| `/playtime` | Show **your own** playtime |
| `/playtime @user` | Show **someone else's** playtime |
| `/playtime-top [limit]` | Leaderboard (top 10 by default) |
| `/playtime-reset @user` | **Admin** — Reset one player to 0 |
| `/playtime-reset` | **Admin** — Reset **all** players to 0 |

---

## Installation

### 1. Database

Run `sql/playtime.sql` in your FiveM MySQL database:

```sql
CREATE TABLE IF NOT EXISTS `playtime` (
    `license`    VARCHAR(255) NOT NULL,
    `discord_id` VARCHAR(30)  DEFAULT NULL,
    `name`       VARCHAR(255) NOT NULL,
    `playtime`   INT          NOT NULL DEFAULT 0,
    PRIMARY KEY (`license`),
    INDEX `idx_discord_id` (`discord_id`)
);
```

### 2. FiveM Resource

Add to `server.cfg`:

```
ensure xdc-playtimetracker
```

Requires `oxmysql` to be running (already in your `[ox]` folder).

### 3. Discord Bot

```bash
cd bot
cp .env.example .env
# Fill in .env with your values (see below)
npm install
node deploy-commands.js   # registers slash commands (run once)
node index.js             # start the bot
```

### 4. `.env` Values

| Key | Where to find it |
|---|---|
| `DISCORD_TOKEN` | [Discord Developer Portal](https://discord.com/developers/applications) → Your App → Bot → Token |
| `CLIENT_ID` | Same page → General Information → Application ID |
| `GUILD_ID` | Right-click your Discord server icon → **Copy Server ID** |
| `ADMIN_ROLE_ID` | Right-click the admin role in Server Settings → **Copy Role ID** |
| `DB_HOST/PORT/USER/PASSWORD/NAME` | Your FiveM database credentials |

> **Tip:** Enable Developer Mode in Discord settings (Advanced → Developer Mode) to unlock the Copy ID options.

---

## How it works

- When a player joins, the Lua resource stores their FiveM `license` + `discord:` identifier in MySQL.
- Playtime is saved periodically (every 5 minutes) and on disconnect.
- The Discord bot queries MySQL directly — no HTTP calls to the FiveM server needed.
