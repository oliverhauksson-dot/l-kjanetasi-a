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

-- Chats. A player makes a chat and gets a 6-letter code; friends join with the code (at most 20 people in one chat).
-- Every chat needs the player's name and PIN, so only people in the chat can read it.
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (code, name)
);
CREATE INDEX IF NOT EXISTS members_by_name ON members (name);

-- Chat messages. Old ones are deleted after 7 days.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_by_code ON messages (code, id);
CREATE INDEX IF NOT EXISTS messages_by_name ON messages (name, at);

-- Who a player has blocked. Their messages are hidden from that player in every chat.
CREATE TABLE IF NOT EXISTS blocks (
  name TEXT NOT NULL,
  blocked TEXT NOT NULL,
  PRIMARY KEY (name, blocked)
);

-- Reported messages, with a copy of the text, so you can read them in the D1 Console.
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  message INTEGER NOT NULL,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  reporter TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- People the owner removed from a chat. They can't join that chat again with the code.
CREATE TABLE IF NOT EXISTS kicked (
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (code, name)
);

-- The all-time board: one row per player name per game with that name's best score ever. The weekly boards (table scores)
-- start empty every Monday, this one never does. The INSERT copies in the scores that were already saved.
CREATE TABLE IF NOT EXISTS best (
  game TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (game, name)
);
CREATE INDEX IF NOT EXISTS best_by_game ON best (game, score);
INSERT OR IGNORE INTO best (game, name, score, at) SELECT game, name, score, at FROM scores;
