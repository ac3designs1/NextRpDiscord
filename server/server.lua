-- next-playtime | server.lua
-- Made by ace
-- Tracks player sessions and saves playtime to MySQL via oxmysql.
-- Discord ID is stored so the bot can look up playtime by Discord user.

local sessions = {} -- [source] = { license, discord_id, name, joinTime }
local ox = exports['oxmysql']

-- ─── Auto-create table ───────────────────────────────────────────────────────

AddEventHandler('onResourceStart', function(resourceName)
    if GetCurrentResourceName() ~= resourceName then return end
    ox:query([[
        CREATE TABLE IF NOT EXISTS `playtime` (
            `license`     VARCHAR(255) NOT NULL,
            `discord_id`  VARCHAR(30)  DEFAULT NULL,
            `name`        VARCHAR(255) NOT NULL,
            `playtime`    INT          NOT NULL DEFAULT 0,
            `first_joined` DATETIME    DEFAULT NULL,
            PRIMARY KEY (`license`),
            INDEX `idx_discord_id` (`discord_id`)
        )
    ]], {}, function()
        -- Add column to existing tables that predate this field
        ox:query([[
            ALTER TABLE `playtime`
            ADD COLUMN IF NOT EXISTS `first_joined` DATETIME DEFAULT NULL
        ]])
        print('[next-playtime] playtime table ready')
    end)
end)

-- ─── Helpers ─────────────────────────────────────────────────────────────────

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
    if mins < 60 then return mins .. 'm' end
    local h = math.floor(mins / 60)
    local m = mins % 60
    return h .. 'h ' .. m .. 'm'
end

-- ─── Session start ───────────────────────────────────────────────────────────

local function startSession(src)
    local license   = getIdentifier(src, 'license')
    local discordId = getIdentifier(src, 'discord')
    local name      = GetPlayerName(src) or 'Unknown'

    if not license then
        print('[next-playtime] No license for src ' .. src .. ' – skipping')
        return
    end

    sessions[src] = {
        license   = license,
        discordId = discordId,
        name      = name,
        joinTime  = os.time(),
    }

    ox:query(
        [[INSERT INTO playtime (license, discord_id, name, playtime, first_joined)
          VALUES (?, ?, ?, 0, NOW())
          ON DUPLICATE KEY UPDATE
            discord_id   = COALESCE(VALUES(discord_id), discord_id),
            name         = VALUES(name),
            first_joined = IF(first_joined IS NULL, NOW(), first_joined)]],
        { license, discordId, name }
    )

    print(('[next-playtime] Session started – %s (%s | discord:%s)'):format(
        name, license, discordId or 'none'
    ))
end

-- ─── Save elapsed time ───────────────────────────────────────────────────────

local function saveSession(src, andRemove)
    local s = sessions[src]
    if not s then return end

    local elapsed = math.floor((os.time() - s.joinTime) / 60)
    if elapsed > 0 then
        ox:query(
            'UPDATE playtime SET playtime = playtime + ? WHERE license = ?',
            { elapsed, s.license }
        )
    end

    if andRemove then
        sessions[src] = nil
    else
        s.joinTime = os.time()
    end
end

-- ─── Events ──────────────────────────────────────────────────────────────────

AddEventHandler('esx:playerLoaded', function(playerId)
    startSession(playerId)
end)

-- Fallback for non-ESX servers
AddEventHandler('playerJoining', function()
    local src = source
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

-- ─── Periodic save (every 5 minutes) ─────────────────────────────────────────

Citizen.CreateThread(function()
    while true do
        Citizen.Wait(300000)
        for src in pairs(sessions) do
            if GetPlayerName(src) then
                saveSession(src, false)
            else
                sessions[src] = nil
            end
        end
    end
end)

-- ─── Debug command (server console only) ─────────────────────────────────────

RegisterCommand('np_sessions', function(src)
    if src ~= 0 then return end
    print('[next-playtime] Active sessions:')
    for s, data in pairs(sessions) do
        local elapsed = math.floor((os.time() - data.joinTime) / 60)
        print(('  src=%d  name=%-20s  discord=%-20s  session=%s'):format(
            s, data.name, data.discordId or 'none', formatMinutes(elapsed)
        ))
    end
end, true)
