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
   Scores also need the name's PIN, and a free name is claimed by its first score.
   POST /api/chat { action, name, pin, ... } -> chats with friends (see "Chat" further down). */

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

/* ---------- Chat ----------
   A player makes a chat and gets a 6-letter code. Friends join with the code, at most 20 people in one chat.
   Everything goes through POST /api/chat { action, name, pin, ... } and needs the name's PIN, so only people
   in a chat can read it. Actions:
     list                       -> { chats: [{ code, title, owner, people }], blocked: [names] }
     create { title }           -> { ok, code }
     join { code }              -> { ok, code }
     leave { code }             -> { ok }
     read { code, after }       -> { chat: { code, title, owner, people: [names] }, messages: [{ id, name, text, at }] }
     send { code, text, after } -> same as read, with the new message in it
     remove { code, who }       -> { ok }   (only the person who made the chat)
     block { who } / unblock { who } -> { ok, blocked }
     report { code, id }        -> { ok }   (the message is copied to the reports table for you to read)
   Messages from someone you blocked are hidden from you. Messages are deleted after 7 days. */
const CHAT_MAX = 20; // People in one chat.
const CHATS_EACH = 20; // Chats one player can be in.
const MADE_EACH = 5; // Chats one player can make.
const TEXT_MAX = 150; // Letters in one message.
const SENDS = 15; // Messages one player can send...
const SEND_WINDOW = 60 * 1000; // ...in one minute.
const KEEP_CHAT = 7 * 864e5; // Messages are deleted after 7 days.
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0/O or 1/I, so codes are easy to read out loud.
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;
// In chat, short words are only blocked as whole words, and a few that are fine to say are allowed (SEX is "six" in Icelandic).
const CHAT_SHORT = SHORT.filter((w) => !['GAY', 'HOMO', 'JEW', 'POO', 'POOP', 'SEX'].includes(w));
// Normal words that happen to have a blocked word inside them, like THORA (Þóra) or FAGNA.
const FINE = /THORA|FAGN|FAGUR|FAGR|PEACOCK|HANCOCK|SCUNTHORPE|DICKENS/g;

// Why a message can't be sent, or null when it's fine.
function badText(text) {
  if (/https?:|www\.|\.(com|net|org|is|io|gg|co|me|app|xyz|tk|ly|tv|be)\b/i.test(text)) return 'Links are not allowed in chat.';
  if (/[^\s@]+@[^\s@]+\.[a-z]/i.test(text)) return 'Don\'t share email addresses in chat.';
  if (/(\d[\s.-]*){7,}/.test(text)) return 'Don\'t share phone numbers in chat.';
  const flat = text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ðÐ]/g, 'd').replace(/[þÞ]/g, 'th').replace(/[æÆ]/g, 'ae')
    .toUpperCase().replace(/0/g, 'O').replace(/1/g, 'I').replace(/3/g, 'E').replace(/4/g, 'A').replace(/5/g, 'S').replace(/7/g, 'T').replace(/8/g, 'B').replace(/\$/g, 'S').replace(/@/g, 'A');
  const words = flat.split(/[^A-Z*]+/).map((w) => w.replace(/\*/g, '')).filter(Boolean);
  const joined = flat.replace(/[^A-Z]/g, ''); // Catches spaced out words like "F U C K".
  if (words.some((w) => CHAT_SHORT.includes(w) || CHAT_SHORT.includes(w.replace(/S$/, '')) || LONG.some((l) => w.replace(FINE, '').includes(l)))) return 'That message has a word that isn\'t allowed.';
  if (/(^|[^A-Z])([A-Z][^A-Z]){3,}/.test(flat + ' ') && LONG.some((l) => joined.includes(l))) return 'That message has a word that isn\'t allowed.';
  return null;
}

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => LETTERS[b % LETTERS.length]).join('');
}

async function chatInfo(db, code) {
  const room = await db.prepare('SELECT code, title, owner FROM rooms WHERE code = ?').bind(code).first();
  if (!room) return null;
  const { results } = await db.prepare('SELECT name FROM members WHERE code = ? ORDER BY at').bind(code).all();
  return { code: room.code, title: room.title, owner: room.owner, people: results.map((r) => r.name) };
}

async function readChat(db, code, name, after) {
  const chat = await chatInfo(db, code);
  const from = Number.isInteger(after) && after > 0 ? after : 0;
  const q = 'SELECT id, name, text, at FROM messages WHERE code = ? AND id > ? AND name NOT IN (SELECT blocked FROM blocks WHERE name = ?) ORDER BY id DESC LIMIT 60';
  const { results } = await db.prepare(q).bind(code, from, name).all();
  return { chat, messages: results.reverse() };
}

async function chat(db, body, who) {
  const name = cleanName(body.name);
  if (!name) return json({ error: 'Pick a name first.' }, 400);
  const me = await login(db, name, body.pin, who);
  if (me.error) return json({ error: me.error, taken: !!me.taken }, me.status);
  const now = Date.now();
  const code = String(body.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const inChat = async () => code && !!(await db.prepare('SELECT 1 AS y FROM members WHERE code = ? AND name = ?').bind(code, name).first());
  const notIn = () => json({ error: 'You are not in that chat anymore.', gone: true }, 403);

  switch (body.action) {
    case 'list': {
      const { results } = await db.prepare(`SELECT r.code, r.title, r.owner, (SELECT COUNT(*) FROM members m2 WHERE m2.code = r.code) AS people,
        (SELECT MAX(id) FROM messages g WHERE g.code = r.code) AS last
        FROM members m JOIN rooms r ON r.code = m.code WHERE m.name = ? ORDER BY m.at`).bind(name).all();
      const blocked = await db.prepare('SELECT blocked FROM blocks WHERE name = ? ORDER BY blocked').bind(name).all();
      return json({ chats: results, blocked: blocked.results.map((r) => r.blocked) });
    }
    case 'create': {
      const title = String(body.title ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
      if (!title) return json({ error: 'Give the chat a name.' }, 400);
      if (badText(title)) return json({ error: 'Please pick a different chat name.' }, 400);
      const [made, mine] = await Promise.all([
        db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE owner = ?').bind(name).first(),
        db.prepare('SELECT COUNT(*) AS n FROM members WHERE name = ?').bind(name).first(),
      ]);
      if (made.n >= MADE_EACH) return json({ error: 'You can make ' + MADE_EACH + ' chats. Leave one first.' }, 400);
      if (mine.n >= CHATS_EACH) return json({ error: 'You are in ' + CHATS_EACH + ' chats already. Leave one first.' }, 400);
      for (let i = 0; i < 5; i++) {
        const c = newCode();
        if (rude(c)) continue;
        const r = await db.prepare('INSERT INTO rooms (code, title, owner, at) VALUES (?, ?, ?, ?) ON CONFLICT (code) DO NOTHING').bind(c, title, name, now).run();
        if (!r.meta.changes) continue;
        await db.prepare('INSERT INTO members (code, name, at) VALUES (?, ?, ?)').bind(c, name, now).run();
        return json({ ok: true, code: c });
      }
      return json({ error: 'Could not make the chat. Try again.' }, 500);
    }
    case 'join': {
      if (!CODE.test(code)) return json({ error: 'A chat code is 6 letters and numbers, like K7P2QX.' }, 400);
      const room = await db.prepare('SELECT code FROM rooms WHERE code = ?').bind(code).first();
      if (!room) {
        // Wrong codes count like wrong PINs, so nobody can guess their way into a chat.
        await db.prepare('INSERT INTO tries (who, name, at) VALUES (?, ?, ?)').bind(who, '#chat', now).run();
        return json({ error: 'No chat has that code. Check it and try again.' }, 404);
      }
      if (await inChat()) return json({ ok: true, code });
      const [kicked, people, mine] = await Promise.all([
        db.prepare('SELECT 1 AS y FROM kicked WHERE code = ? AND name = ?').bind(code, name).first(),
        db.prepare('SELECT COUNT(*) AS n FROM members WHERE code = ?').bind(code).first(),
        db.prepare('SELECT COUNT(*) AS n FROM members WHERE name = ?').bind(name).first(),
      ]);
      if (kicked) return json({ error: 'You were removed from that chat, so you can\'t join it again.' }, 403);
      if (people.n >= CHAT_MAX) return json({ error: 'That chat is full (' + CHAT_MAX + ' people).' }, 400);
      if (mine.n >= CHATS_EACH) return json({ error: 'You are in ' + CHATS_EACH + ' chats already. Leave one first.' }, 400);
      await db.prepare('INSERT INTO members (code, name, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(code, name, now).run();
      return json({ ok: true, code });
    }
    case 'leave': {
      const room = await db.prepare('SELECT owner FROM rooms WHERE code = ?').bind(code).first();
      await db.prepare('DELETE FROM members WHERE code = ? AND name = ?').bind(code, name).run();
      if (room) {
        const next = await db.prepare('SELECT name FROM members WHERE code = ? ORDER BY at LIMIT 1').bind(code).first();
        if (!next) {
          // The last person left: the chat and its messages are deleted.
          await db.batch([
            db.prepare('DELETE FROM rooms WHERE code = ?').bind(code),
            db.prepare('DELETE FROM messages WHERE code = ?').bind(code),
            db.prepare('DELETE FROM kicked WHERE code = ?').bind(code),
          ]);
        } else if (room.owner === name) {
          await db.prepare('UPDATE rooms SET owner = ? WHERE code = ?').bind(next.name, code).run(); // The next person in charge.
        }
      }
      return json({ ok: true });
    }
    case 'read': {
      if (!(await inChat())) return notIn();
      return json(await readChat(db, code, name, Number(body.after)));
    }
    case 'send': {
      if (!(await inChat())) return notIn();
      const text = String(body.text ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text) return json({ error: 'Type a message first.' }, 400);
      if (text.length > TEXT_MAX) return json({ error: 'Messages can be ' + TEXT_MAX + ' letters at most.' }, 400);
      const bad = badText(text);
      if (bad) return json({ error: bad }, 400);
      const { n } = await db.prepare('SELECT COUNT(*) AS n FROM messages WHERE name = ? AND at > ?').bind(name, now - SEND_WINDOW).first();
      if (n >= SENDS) return json({ error: 'Slow down! Wait a minute before sending more.' }, 429);
      await db.batch([
        db.prepare('INSERT INTO messages (code, name, text, at) VALUES (?, ?, ?, ?)').bind(code, name, text, now),
        db.prepare('DELETE FROM messages WHERE at < ?').bind(now - KEEP_CHAT),
      ]);
      return json(Object.assign({ ok: true }, await readChat(db, code, name, Number(body.after))));
    }
    case 'remove': {
      const who2 = cleanName(body.who);
      const room = await db.prepare('SELECT owner FROM rooms WHERE code = ?').bind(code).first();
      if (!room || room.owner !== name) return json({ error: 'Only the person who made the chat can remove people.' }, 403);
      if (!who2 || who2 === name) return json({ error: 'Pick someone to remove.' }, 400);
      await db.batch([
        db.prepare('DELETE FROM members WHERE code = ? AND name = ?').bind(code, who2),
        db.prepare('INSERT INTO kicked (code, name) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(code, who2),
      ]);
      return json({ ok: true });
    }
    case 'block':
    case 'unblock': {
      const who2 = cleanName(body.who);
      if (!who2 || who2 === name) return json({ error: 'Pick someone to block.' }, 400);
      if (body.action === 'block') await db.prepare('INSERT INTO blocks (name, blocked) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(name, who2).run();
      else await db.prepare('DELETE FROM blocks WHERE name = ? AND blocked = ?').bind(name, who2).run();
      const { results } = await db.prepare('SELECT blocked FROM blocks WHERE name = ? ORDER BY blocked').bind(name).all();
      return json({ ok: true, blocked: results.map((r) => r.blocked) });
    }
    case 'report': {
      if (!(await inChat())) return notIn();
      const msg = await db.prepare('SELECT id, name, text FROM messages WHERE id = ? AND code = ?').bind(Number(body.id), code).first();
      if (!msg) return json({ error: 'That message is gone.' }, 404);
      await db.prepare('INSERT INTO reports (code, message, author, text, reporter, at) VALUES (?, ?, ?, ?, ?, ?)').bind(code, msg.id, msg.name, msg.text, name, now).run();
      return json({ ok: true });
    }
    default:
      return json({ error: 'Bad request' }, 400);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isDaily = url.pathname === '/api/daily';
    const isName = url.pathname === '/api/name';
    const isChat = url.pathname === '/api/chat';
    if (url.pathname !== '/api/scores' && !isDaily && !isName && !isChat) return json({ error: 'Not found' }, 404);

    if (request.method === 'GET' && !isName && !isChat) {
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
    if (isChat) return chat(env.DB, body, who);
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
