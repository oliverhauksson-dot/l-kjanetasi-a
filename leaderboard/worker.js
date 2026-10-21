/* Pocket Arcade leaderboard: a Cloudflare Worker that keeps the top scores for every game in a D1 database.
   It runs on pocketarcade.net/api/* so the games can call it without any cross-site setup.
   GET  /api/scores?game=snake[&name=BOB] -> { scores: [{ name, score }, ...], total, me }   (top 100)
   POST /api/scores { game, name, score }  -> { ok: true, scores, total, me }
   me is { rank, score } for that name's best score (also when it is outside the top 100), or null. */

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
};

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

async function top(db, game) {
  const order = GAMES[game].lowerWins ? 'ASC' : 'DESC';
  const { results } = await db.prepare(`SELECT name, score FROM scores WHERE game = ? ORDER BY score ${order}, at ASC LIMIT ?`).bind(game, TOP).all();
  return results;
}

// Where a name stands in a game: 1 + everyone with a better score (or the same score, set earlier).
async function place(db, game, name) {
  if (!name) return null;
  const row = await db.prepare('SELECT score, at FROM scores WHERE game = ? AND name = ?').bind(game, name).first();
  if (!row) return null;
  const better = GAMES[game].lowerWins ? 'score < ?' : 'score > ?';
  const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM scores WHERE game = ? AND (${better} OR (score = ? AND at < ?))`)
    .bind(game, row.score, row.score, row.at).first();
  return { rank: n + 1, score: row.score };
}

async function board(db, game, name) {
  const [scores, me, { n }] = await Promise.all([
    top(db, game), place(db, game, name),
    db.prepare('SELECT COUNT(*) AS n FROM scores WHERE game = ?').bind(game).first(),
  ]);
  return { scores, total: n, me };
}

async function visitor(request) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  const day = new Date().toISOString().slice(0, 10); // The hash changes every day, so it can't follow anyone for long.
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + day));
  return [...new Uint8Array(bytes)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/scores') return json({ error: 'Not found' }, 404);

    if (request.method === 'GET') {
      const game = url.searchParams.get('game');
      if (!GAMES[game]) return json({ error: 'Unknown game' }, 400);
      return json(await board(env.DB, game, cleanName(url.searchParams.get('name'))));
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    // Scores only come from the site itself. (A determined cheater can fake this; it stops casual abuse.)
    if (request.headers.get('origin') !== SITE) return json({ error: 'Forbidden' }, 403);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'Bad request' }, 400); }
    const rules = GAMES[body.game];
    const name = cleanName(body.name);
    const score = Number(body.score);
    if (!rules || !name || !Number.isInteger(score) || score < (rules.min ?? 1) || score > rules.max) return json({ error: 'Invalid score' }, 400);
    if (rude(name)) return json({ error: 'Please pick a different name.' }, 400);

    const now = Date.now();
    const who = await visitor(request);
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM hits WHERE who = ? AND at > ?').bind(who, now - WINDOW).first();
    if (n >= LIMIT) return json({ error: 'Slow down! Try again in a few minutes.' }, 429);

    const better = rules.lowerWins ? 'excluded.score < scores.score' : 'excluded.score > scores.score';
    await env.DB.batch([
      env.DB.prepare('INSERT INTO hits (who, at) VALUES (?, ?)').bind(who, now),
      env.DB.prepare('DELETE FROM hits WHERE at < ?').bind(now - WINDOW),
      env.DB.prepare(`INSERT INTO scores (game, name, score, at) VALUES (?, ?, ?, ?)
        ON CONFLICT (game, name) DO UPDATE SET score = excluded.score, at = excluded.at WHERE ${better}`).bind(body.game, name, score, now),
    ]);

    return json(Object.assign({ ok: true }, await board(env.DB, body.game, name)));
  },
};
