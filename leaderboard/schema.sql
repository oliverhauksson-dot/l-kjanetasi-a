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
