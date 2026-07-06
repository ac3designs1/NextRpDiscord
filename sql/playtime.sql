-- xdc-playtimetracker | playtime.sql
-- Run this once in your FiveM database before starting the resource.

CREATE TABLE IF NOT EXISTS `playtime` (
    `license`    VARCHAR(255) NOT NULL,
    `discord_id` VARCHAR(30)  DEFAULT NULL,
    `name`       VARCHAR(255) NOT NULL,
    `playtime`   INT          NOT NULL DEFAULT 0,  -- stored in minutes
    PRIMARY KEY (`license`),
    INDEX `idx_discord_id` (`discord_id`)
);
