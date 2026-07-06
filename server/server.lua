-- xdc-playtimetracker | server.lua
-- Tracks player sessions and saves playtime to MySQL via oxmysql.
-- Discord ID is stored so the bot can look up playtime by Discord user.

local sessions = {} -- [source] = { license, discord_id, name, joinTime }

-- ─── Auto-create table ───────────────────────────────────────────────────────

MySQL.query([[
    CREATE TABLE IF NOT EXISTS `playtime` (
        `license`    VARCHAR(255) NOT NULL,
        `discord_id` VARCHAR(30)  DEFAULT NULL,
        `name`       VARCHAR(255) NOT NULL,
        `playtime`   INT          NOT NULL DEFAULT 0,
        PRIMARY KEY (`license`),
        INDEX `idx_discord_id` (`discord_id`)
    )
]], {}, function(ok)
    print('[xdc-playtimetracker] playtime table ready')
end)

-- ─── Helpers ───────────────────────────────────────────────────────────────

local function getIdentifier(src, idType)
    for i = 0, GetNumPlayerIdentifiers(src) - 1 do
        local id = GetPlayerIdentifier(src, i)
        if string.sub(id, 1, #idType + 1) == idType .. ':' then
            return string.sub(id, #idType + 2)
        end
    end
    return nil
end

local function formatMinutes(mins)
    if mins < 60 then
        return mins .. 'm'
    end
    local h = math.floor(mins / 60)
    local m = mins % 60
    return h .. 'h ' .. m .. 'm'
end

-- ─── Session start ──────────────────────────────────────────────────────────

local function startSession(src)
    local license    = getIdentifier(src, 'license')
    local discordId  = getIdentifier(src, 'discord')
    local name       = GetPlayerName(src) or 'Unknown'

    if not license then
        print('[xdc-playtimetracker] No license for src ' .. src .. ' – skipping')
        return
    end

    sessions[src] = {
        license   = license,
        discordId = discordId,
        name      = name,
        joinTime  = os.time(),
    }

    -- Upsert player record so they always exist in the table
    MySQL.query(
        [[INSERT INTO playtime (license, discord_id, name, playtime)
          VALUES (?, ?, ?, 0)
          ON DUPLICATE KEY UPDATE
            discord_id = COALESCE(VALUES(discord_id), discord_id),
            name       = VALUES(name)]],
        { license, discordId, name }
    )

    print(('[xdc-playtimetracker] Session started – %s (%s | discord:%s)'):format(
        name, license, discordId or 'none'
    ))
end

-- ─── Save elapsed time ──────────────────────────────────────────────────────

local function saveSession(src, andRemove)
    local s = sessions[src]
    if not s then return end

    local elapsed = math.floor((os.time() - s.joinTime) / 60)
    if elapsed > 0 then
        MySQL.query(
            'UPDATE playtime SET playtime = playtime + ? WHERE license = ?',
            { elapsed, s.license }
        )
    end

    -- Reset the join-time so the next periodic save doesn't double-count
    if andRemove then
        sessions[src] = nil
    else
        s.joinTime = os.time()
    end
end

-- ─── Events ─────────────────────────────────────────────────────────────────

-- Works for both ESX and standalone setups.
-- esx:playerLoaded fires after all identifiers are available.
AddEventHandler('esx:playerLoaded', function(playerId)
    startSession(playerId)
end)

-- Fallback for non-ESX servers
AddEventHandler('playerJoining', function()
    local src = source
    -- Short delay so all identifiers are populated
    SetTimeout(2000, function()
        if not sessions[src] and GetPlayerName(src) then
            startSession(src)
        end
    end)
end)

AddEventHandler('playerDropped', function()
    local src = source
    saveSession(src, true)
end)

-- ─── Periodic save (every 5 minutes) ────────────────────────────────────────

Citizen.CreateThread(function()
    while true do
        Citizen.Wait(300000)
        for src in pairs(sessions) do
            if GetPlayerName(src) then
                saveSession(src, false)
            else
                -- Player is gone without triggering playerDropped
                sessions[src] = nil
            end
        end
    end
end)

-- ─── Debug command (server console only) ────────────────────────────────────

RegisterCommand('pt_sessions', function(src)
    if src ~= 0 then return end -- console only
    print('[xdc-playtimetracker] Active sessions:')
    for s, data in pairs(sessions) do
        local elapsed = math.floor((os.time() - data.joinTime) / 60)
        print(('  src=%d  name=%-20s  discord=%-20s  session=%s'):format(
            s, data.name, data.discordId or 'none', formatMinutes(elapsed)
        ))
    end
end, true)
