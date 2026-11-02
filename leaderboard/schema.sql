-- Run this once in the D1 database console (Cloudflare dashboard > D1 > your database > Console).

-- One row per player name per game, holding that name's best score.
CREATE TABLE IF NOT EXISTS scores (
  game TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (game, name)
);
CREATE INDEX IF NOT EXISTS scores_by_game ON scores (game, score);

-- Recent score submissions, used only to stop one visitor spamming. The IP address is hashed, never stored.
CREATE TABLE IF NOT EXISTS hits (
  who TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hits_by_who ON hits (who, at);

-- The Daily Challenge: one row per player name per day, holding that name's best score in that day's game.
CREATE TABLE IF NOT EXISTS daily (
  day TEXT NOT NULL,
  game TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (day, name)
);
CREATE INDEX IF NOT EXISTS daily_by_day ON daily (day, score);

-- Player names. Each name belongs to whoever used it first, and only works with that player's 4-digit PIN.
-- Only a hash of the PIN is kept.
CREATE TABLE IF NOT EXISTS players (
  name TEXT PRIMARY KEY,
  pin TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- Wrong PINs from the last hour, so nobody can try all 10,000. The visitor is hashed like in hits.
CREATE TABLE IF NOT EXISTS tries (
  who TEXT NOT NULL,
  name TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tries_by_who ON tries (who, at);
CREATE INDEX IF NOT EXISTS tries_by_name ON tries (name, at);
