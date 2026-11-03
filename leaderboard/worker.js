/* Pocket Arcade leaderboard: a Cloudflare Worker that keeps the top scores for every game in a D1 database.
   It runs on pocketarcade.net/api/* so the games can call it without any cross-site setup.
   GET  /api/scores?game=snake[&name=BOB] -> { scores: [{ name, score }, ...], total, me }   (top 100)
   POST /api/scores { game, name, score }  -> { ok: true, scores, total, me }
   me is { rank, score } for that name's best score (also when it is outside the top 100), or null.
   Daily Challenge (one game a day, with a board that starts empty at midnight UTC):
   GET  /api/daily[?name=BOB]              -> { day, game, scores, total, me }   (today's board)
   POST /api/daily { day, name, pin, score } -> { ok: true, day, game, scores, total, me }
   Names belong to one player. The first player to use a name claims it with a 4-digit PIN they pick; after that the name
   only works with that PIN (on any device). Two players can have the same PIN, since it always goes with the name.
   POST /api/name { name, pin }           -> { ok: true, name, created }   (claims a free name, or checks the PIN)
   Scores also need the name's PIN, and a free name is claimed by its first score. */

// The best score a very good player can really reach in each game (for Memory, the fewest moves).
// Anything outside is refused, so a faked "Snake: 400" can't take the top spot. Raise a number if real players hit it.
const GAMES = {
  snake: { max: 397 }, // The 20x20 board is full at 397 fruit.
  runner: { max: 30000 }, // About 6 minutes at top speed.
  breakout: { max: 50000 }, // 400 x level points per board, so about 15 boards.
  memory: { min: 8, max: 999, lowerWins: true }, // 8 moves is a perfect game.
  pong: { max: 200 },
  snapgrid: { max: 1000000 },
  invaders: { max: 50000 }, // 810 points per wave, so about 60 waves.
  flappy: { max: 1000 },
  muncher: { max: 200000 },
  blackjack: { min: 101, max: 100000 }, // Everyone starts with 100 coins.
  cube: { max: 30000 }, // Cube Rush Endless, in tiles. About 70 minutes at top speed.
  chase: { max: 60000 }, // 10 points a second plus coins and crashes, so about an hour of play.
  ski: { max: 100000 }, // About 40 minutes at top speed, plus coins and jumps.
};

// The Daily Challenge game for a day (YYYY-MM-DD). This list must match DAILY in js/arcade.js.
const DAILY = ['snake', 'runner', 'breakout', 'memory', 'snapgrid', 'invaders', 'flappy', 'muncher', 'chase', 'ski'];
const dailyGame = (day) => DAILY[Math.floor(Date.parse(day) / 864e5) % DAILY.length];
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const GRACE = 30 * 60 * 1000; // A game that ends just after midnight can still go on yesterday's board.
const KEEP_DAYS = 60; // Older Daily Challenge boards are deleted.

// Names that are refused. Checked after removing spaces, dashes and look-alike digits (5H1T -> SHIT).
// LONG words are blocked anywhere in a name; SHORT ones only as the whole name, so a name like CLASS still works.
const LONG = ['FUCK', 'SHIT', 'CUNT', 'BITCH', 'DICK', 'COCK', 'PUSSY', 'WHORE', 'SLUT', 'FAG', 'NIGG', 'NIGA', 'RETARD',
  'PENIS', 'VAGINA', 'BOOB', 'PORN', 'NAZI', 'HITLER', 'KKK', 'WANK', 'TWAT', 'BASTARD', 'ASSHOLE', 'DILDO',
  'KUNTA', 'TYPPI', 'HORA', 'HELVIT', 'DJOFULL', 'FOKK'];
const SHORT = ['ASS', 'TIT', 'TITS', 'SEX', 'CUM', 'FAP', 'GAY', 'HOMO', 'PISS', 'POO', 'POOP', 'JEW', 'KYS', 'FU', 'STFU', 'WTF', 'RAPE'];
function rude(name) {
  const flat = name.replace(/[ _-]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').replace(/3/g, 'E').replace(/4/g, 'A').replace(/5/g, 'S').replace(/7/g, 'T').replace(/8/g, 'B');
  return SHORT.includes(flat) || LONG.some((w) => flat.includes(w));
}

const TOP = 100;
const PIN = /^[0-9]{4}$/;
const TRIES = 10; // Wrong PINs one visitor can get in an hour...
const NAME_TRIES = 50; // ...and one name can get in an hour from everyone, so nobody can guess a PIN by trying all 10,000.
const TRY_WINDOW = 60 * 60 * 1000;
const SITE = 'https://pocketarcade.net';
const LIMIT = 20; // Score submissions one visitor can make...
const WINDOW = 10 * 60 * 1000; // ...in this many milliseconds.

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

// Names are 1 to 12 characters of capital letters, digits, spaces, dashes and underscores, like an arcade cabinet.
function cleanName(raw) {
  const name = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
  return name.length ? name : null;
}

// A list is one board of scores: a game's own board (table scores, by game) or one day's Daily Challenge (table daily, by day).
const gameList = (game) => ({ table: 'scores', col: 'game', key: game, game });
const dayList = (day) => ({ table: 'daily', col: 'day', key: day, game: dailyGame(day) });

async function top(db, l) {
  const order = GAMES[l.game].lowerWins ? 'ASC' : 'DESC';
  const { results } = await db.prepare(`SELECT name, score FROM ${l.table} WHERE ${l.col} = ? ORDER BY score ${order}, at ASC LIMIT ?`).bind(l.key, TOP).all();
  return results;
}

// Where a name stands on a board: 1 + everyone with a better score (or the same score, set earlier).
async function place(db, l, name) {
  if (!name) return null;
  const row = await db.prepare(`SELECT score, at FROM ${l.table} WHERE ${l.col} = ? AND name = ?`).bind(l.key, name).first();
  if (!row) return null;
  const better = GAMES[l.game].lowerWins ? 'score < ?' : 'score > ?';
  const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM ${l.table} WHERE ${l.col} = ? AND (${better} OR (score = ? AND at < ?))`)
    .bind(l.key, row.score, row.score, row.at).first();
  return { rank: n + 1, score: row.score };
}

async function board(db, l, name) {
  const [scores, me, { n }] = await Promise.all([
    top(db, l), place(db, l, name),
    db.prepare(`SELECT COUNT(*) AS n FROM ${l.table} WHERE ${l.col} = ?`).bind(l.key).first(),
  ]);
  return { scores, total: n, me };
}

async function visitor(request) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  const day = new Date().toISOString().slice(0, 10); // The hash changes every day, so it can't follow anyone for long.
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + day));
  return [...new Uint8Array(bytes)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The PIN is never stored, only a hash of it mixed with the name.
async function pinHash(name, pin) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pocketarcade|' + name + '|' + pin));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Claims the name if nobody has it yet, or checks the PIN if someone does. Returns { created } or { error, status }.
async function login(db, name, pin, who) {
  if (!PIN.test(String(pin ?? ''))) return { error: 'The PIN must be 4 digits.', status: 400 };
  if (rude(name)) return { error: 'Please pick a different name.', status: 400 };
  const now = Date.now();
  const [mine, theirs] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM tries WHERE who = ? AND at > ?').bind(who, now - TRY_WINDOW).first(),
    db.prepare('SELECT COUNT(*) AS n FROM tries WHERE name = ? AND at > ?').bind(name, now - TRY_WINDOW).first(),
  ]);
  if (mine.n >= TRIES || theirs.n >= NAME_TRIES) return { error: 'Too many wrong PINs. Try again in an hour.', status: 429 };
  const hash = await pinHash(name, pin);
  const made = await db.prepare('INSERT INTO players (name, pin, at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING').bind(name, hash, now).run();
  if (made.meta.changes) return { created: true };
  const row = await db.prepare('SELECT pin FROM players WHERE name = ?').bind(name).first();
  if (row && row.pin === hash) return { created: false };
  await db.batch([
    db.prepare('INSERT INTO tries (who, name, at) VALUES (?, ?, ?)').bind(who, name, now),
    db.prepare('DELETE FROM tries WHERE at < ?').bind(now - TRY_WINDOW),
  ]);
  return { error: 'That name is taken. Type its PIN, or pick another name.', status: 403, taken: true };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isDaily = url.pathname === '/api/daily';
    const isName = url.pathname === '/api/name';
    if (url.pathname !== '/api/scores' && !isDaily && !isName) return json({ error: 'Not found' }, 404);

    if (request.method === 'GET' && !isName) {
      const name = cleanName(url.searchParams.get('name'));
      if (isDaily) {
        const day = dayOf(Date.now());
        return json(Object.assign({ day, game: dailyGame(day) }, await board(env.DB, dayList(day), name)));
      }
      const game = url.searchParams.get('game');
      if (!GAMES[game]) return json({ error: 'Unknown game' }, 400);
      return json(await board(env.DB, gameList(game), name));
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    // Scores only come from the site itself. (A determined cheater can fake this; it stops casual abuse.)
    if (request.headers.get('origin') !== SITE) return json({ error: 'Forbidden' }, 403);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'Bad request' }, 400); }
    const now = Date.now();
    const who = await visitor(request);
    if (isName) {
      const name = cleanName(body.name);
      if (!name) return json({ error: 'Type a name first (A-Z, 0-9).' }, 400);
      const r = await login(env.DB, name, body.pin, who);
      if (r.error) return json({ error: r.error, taken: !!r.taken }, r.status);
      return json({ ok: true, name, created: r.created });
    }
    let list = gameList(body.game);
    if (isDaily) {
      // Only today's challenge, or yesterday's for a few minutes after midnight.
      const day = String(body.day);
      if (day !== dayOf(now) && day !== dayOf(now - GRACE)) return json({ error: 'That Daily Challenge is over.' }, 400);
      list = dayList(day);
      if (body.game !== list.game) return json({ error: 'Invalid score' }, 400);
    }
    const rules = GAMES[body.game];
    const name = cleanName(body.name);
    const score = Number(body.score);
    if (!rules || !name || !Number.isInteger(score) || score < (rules.min ?? 1) || score > rules.max) return json({ error: 'Invalid score' }, 400);
    const me = await login(env.DB, name, body.pin, who);
    if (me.error) return json({ error: me.error, taken: !!me.taken }, me.status);

    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM hits WHERE who = ? AND at > ?').bind(who, now - WINDOW).first();
    if (n >= LIMIT) return json({ error: 'Slow down! Try again in a few minutes.' }, 429);

    const better = rules.lowerWins ? `excluded.score < ${list.table}.score` : `excluded.score > ${list.table}.score`;
    const steps = [
      env.DB.prepare('INSERT INTO hits (who, at) VALUES (?, ?)').bind(who, now),
      env.DB.prepare('DELETE FROM hits WHERE at < ?').bind(now - WINDOW),
    ];
    if (isDaily) {
      steps.push(
        env.DB.prepare(`INSERT INTO daily (day, game, name, score, at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (day, name) DO UPDATE SET score = excluded.score, at = excluded.at WHERE ${better}`).bind(list.key, list.game, name, score, now),
        env.DB.prepare('DELETE FROM daily WHERE day < ?').bind(dayOf(now - KEEP_DAYS * 864e5)),
      );
    } else {
      steps.push(env.DB.prepare(`INSERT INTO scores (game, name, score, at) VALUES (?, ?, ?, ?)
        ON CONFLICT (game, name) DO UPDATE SET score = excluded.score, at = excluded.at WHERE ${better}`).bind(body.game, name, score, now));
    }
    await env.DB.batch(steps);

    const extra = isDaily ? { ok: true, day: list.key, game: list.game } : { ok: true };
    return json(Object.assign(extra, await board(env.DB, list, name)));
  },
};
