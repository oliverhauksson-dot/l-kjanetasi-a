/* Pocket Arcade leaderboard: a Cloudflare Worker that keeps the top scores for every game in a D1 database.
   It runs on pocketarcade.net/api/* so the games can call it without any cross-site setup.
   GET  /api/scores?game=snake          -> { scores: [{ name, score }, ...] } (top 10)
   POST /api/scores { game, name, score } -> { ok: true, rank, scores } */

// The highest (or, for Memory, lowest) score each game can honestly reach. Anything outside is refused.
const GAMES = {
  snake: { max: 400 },
  runner: { max: 100000 },
  breakout: { max: 1000000 },
  memory: { min: 8, max: 999, lowerWins: true },
  pong: { max: 10000 },
  blocks: { max: 10000000 },
  invaders: { max: 1000000 },
  flappy: { max: 100000 },
  muncher: { max: 10000000 },
  blackjack: { min: 101, max: 10000000 }, // Everyone starts with 100 coins.
};
const TOP = 10;
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
      return json({ scores: await top(env.DB, game) });
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

    const scores = await top(env.DB, body.game);
    const i = scores.findIndex((s) => s.name === name && s.score === score);
    return json({ ok: true, rank: i < 0 ? null : i + 1, scores });
  },
};
