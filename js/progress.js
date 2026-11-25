/* jurtu.com progress: daily streaks, badges, the My profile page, and challenge links from friends.
   Everything here is saved in this browser only (localStorage "arcade:progress"), like the best scores. Nothing is sent anywhere,
   so the leaderboard server (leaderboard/worker.js) needs no change. It listens to js/arcade.js through Arcade.on(). */
(() => {
  const A = window.Arcade;
  if (!A) return;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const cards = () => [...$$('.menu [data-game]')];
  const card = (gid) => document.querySelector('.menu [data-game="' + gid + '"]');
  const nameOf = (gid) => { const c = card(gid); return c ? c.querySelector('h2').textContent : gid; };

  /* ---------- Saved progress ---------- */
  const KEY = 'arcade:progress';
  const fresh = () => ({ streak: { n: 0, best: 0, last: '' }, played: {}, total: 0, bests: 0, words: 0, dailyDays: [], saved: 0, sent: 0, beat: 0, flags: {}, badges: {} });
  let P = fresh();
  try { P = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} };

  // The player's own calendar day (not UTC), so a streak follows their own midnight.
  const localDay = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const dayBefore = (day) => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() - 1); return localDay(d); };
  // The streak as it stands today: still alive if the last game was today or yesterday.
  const liveStreak = () => (P.streak.last === localDay() || P.streak.last === dayBefore(localDay()) ? P.streak.n : 0);

  /* ---------- Badges ---------- */
  // [id, emoji, name, how to get it, test]. Add a new badge by adding a line here.
  // Only games that are still on the site count (old saves can have Blackjack, which was taken off).
  const tried = () => cards().filter((c) => P.played[c.dataset.game]).length;
  const BADGES = [
    ['first', '🎮', 'First game', 'Finish any game.', () => P.total >= 1],
    ['explorer', '🧭', 'Explorer', 'Play 5 different games.', () => tried() >= 5],
    ['collector', '🗂️', 'Collector', 'Play every game on jurtu.com.', () => tried() >= cards().length],
    ['regular', '🕹️', 'Regular', 'Finish 50 games.', () => P.total >= 50],
    ['legend', '👑', 'Arcade legend', 'Finish 250 games.', () => P.total >= 250],
    ['streak3', '🔥', 'On fire', 'Play 3 days in a row.', () => P.streak.best >= 3],
    ['streak7', '📅', 'Week warrior', 'Play 7 days in a row.', () => P.streak.best >= 7],
    ['streak30', '☄️', 'Unstoppable', 'Play 30 days in a row.', () => P.streak.best >= 30],
    ['daily', '☀️', 'Daily player', 'Play a Daily Challenge.', () => P.dailyDays.length >= 1],
    ['daily10', '🗓️', 'Daily devotee', 'Play the Daily Challenge on 10 different days.', () => P.dailyDays.length >= 10],
    ['pb', '📈', 'Personal best', 'Beat your own best score 10 times.', () => P.bests >= 10],
    ['board', '📋', 'On the board', 'Save a score on a leaderboard.', () => P.saved >= 1],
    ['top10', '🏆', 'Top 10', 'Make the top 10 of any leaderboard.', () => !!P.flags.top10],
    ['number1', '🥇', 'Number one', 'Be #1 on any leaderboard.', () => !!P.flags.number1],
    ['challenger', '📨', 'Challenger', 'Send a challenge to a friend.', () => P.sent >= 1],
    ['rival', '⚔️', 'Rival', 'Beat a friend\'s challenge.', () => P.beat >= 1],
    ['snake', '🐍', 'Long snake', 'Eat 25 fruit in one game of Snake.', () => !!P.flags.snake],
    ['stack', '🏙️', 'Skyscraper', 'Stack 25 blocks in Stack Tower.', () => !!P.flags.stack],
    ['ace', '⛳', 'Hole in one', 'Get a hole in one in Minigolf.', () => !!P.flags.ace],
    ['golfwin', '🏌️', 'Golf champ', 'Beat all 3 bots in a round of Minigolf.', () => !!P.flags.golfwin],
    ['words10', '🔤', 'Word nerd', 'Solve 10 words in Word Guesser.', () => P.words >= 10],
    ['words100', '📚', 'Dictionary', 'Solve 100 words in Word Guesser.', () => P.words >= 100],
    ['quiz10', '🧠', 'Know-it-all', 'Get 10 right in a row in Higher or Lower.', () => !!P.flags.quiz10],
    ['night', '🦉', 'Night owl', 'Finish a game between midnight and 5 am.', () => !!P.flags.night],
  ];
  // Checks every badge and returns the ones that were just earned.
  function check() {
    const got = [];
    BADGES.forEach(([bid, , , , test]) => { if (!P.badges[bid] && test()) { P.badges[bid] = Date.now(); got.push(bid); } });
    save();
    return got;
  }
  const badge = (bid) => BADGES.find((b) => b[0] === bid);

  /* ---------- Pop-up messages ---------- */
  // "Badge unlocked" and streak messages slide in at the top. While a game is being played they wait for game over.
  const toastBox = el('div', 'toasts'); toastBox.setAttribute('aria-live', 'polite'); document.body.appendChild(toastBox);
  let waiting = [];
  function toast(icon, title, text) {
    if (A.playing()) { waiting.push([icon, title, text]); return; }
    const t = el('div', 'toast');
    const words = el('div'); words.append(el('b', '', title), el('span', '', text));
    t.append(el('span', 'ticon', icon), words);
    toastBox.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 400); }, 3600 + toastBox.childElementCount * 400);
  }
  const flush = () => { const w = waiting; waiting = []; w.forEach((m, i) => setTimeout(() => toast(...m), i * 350)); };
  const announce = (list) => list.forEach((bid) => { const b = badge(bid); toast(b[1], 'Badge unlocked: ' + b[2], b[3]); });

  /* ---------- A friend's challenge ---------- */
  // A link like ?play=stack&beat=40&from=OLIVER (or ?daily&on=2026-11-21&beat=...) from the "Challenge a friend" button.
  const q = new URLSearchParams(location.search);
  let chal = null;
  if (q.has('beat') && Number.isFinite(Number(q.get('beat')))) {
    const day = q.has('daily') ? q.get('on') || A.today() : null;
    const gid = day ? A.dailyGame(day) : q.get('play');
    const from = String(q.get('from') || '').toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 12) || 'Your friend';
    if (gid && card(gid) && (!day || day === A.today())) chal = { gid, day, score: Math.round(Number(q.get('beat'))), from, won: false };
  }
  const chalBox = el('div', 'chal'); chalBox.hidden = true;
  $('#stage').before(chalBox);
  const forThis = (d) => chal && d && d.id === chal.gid && (d.daily || null) === chal.day;
  function paintChal(d) {
    chalBox.hidden = !forThis(d);
    if (chalBox.hidden) return;
    chalBox.textContent = '';
    const what = (d.label || 'score').toLowerCase();
    chalBox.append(el('span', 'ticon', chal.won ? '🏆' : '⚔️'), el('span', '', chal.won
      ? 'You beat ' + chal.from + '! Send them a challenge back.'
      : 'Challenge: beat ' + chal.from + '\'s ' + what + ' of ' + chal.score + (d.lowerWins ? ' (fewer is better)' : '') + '.'));
  }

  /* ---------- What happens in the games ---------- */
  A.on('open', (d) => {
    paintChal(d);
  });

  A.on('over', (d) => {
    const day = localDay();
    // The streak: the first finished game of a day adds one, or starts again at 1 after a missed day.
    let streakUp = false;
    if (P.streak.last !== day) {
      P.streak.n = P.streak.last === dayBefore(day) ? P.streak.n + 1 : 1;
      P.streak.last = day; P.streak.best = Math.max(P.streak.best, P.streak.n);
      streakUp = true;
    }
    P.total++;
    P.played[d.id] = (P.played[d.id] || 0) + 1;
    if (d.better && d.prev !== null) P.bests++;
    if (d.daily && !P.dailyDays.includes(d.daily)) { P.dailyDays.push(d.daily); P.dailyDays = P.dailyDays.slice(-400); }
    if (new Date().getHours() < 5) P.flags.night = true;
    if (d.id === 'snake' && d.score >= 25) P.flags.snake = true;
    if (d.id === 'stack' && d.score >= 25) P.flags.stack = true;

    // A friend's challenge: did this game beat it?
    const line = $('#ovp');
    if (forThis(d)) {
      const won = d.lowerWins ? d.score < chal.score : d.score > chal.score;
      const gap = Math.abs(chal.score - d.score);
      const note = el('span', 'chalres', won
        ? '🏆 You beat ' + chal.from + '\'s ' + chal.score + '!'
        : chal.from + '\'s ' + chal.score + ' still stands. ' + (gap === 0 ? 'You tied it, one more!' : gap + (d.lowerWins ? ' fewer' : ' more') + ' to go.'));
      line.append(' ', note);
      if (won && !chal.won) { chal.won = true; P.beat++; }
      paintChal(d);
    }

    const got = check();
    flush();
    if (streakUp && P.streak.n > 1) toast('🔥', P.streak.n + '-day streak!', 'Come back tomorrow to keep it going.');
    else if (streakUp) toast('🔥', 'Streak started!', 'Play a game every day to build your streak.');
    announce(got);
    paintHome();
  });

  A.on('saved', (d) => {
    P.saved++;
    if (d.me && d.me.rank <= 10) P.flags.top10 = true;
    if (d.me && d.me.rank === 1) P.flags.number1 = true;
    announce(check());
  });
  A.on('shared', () => { P.sent++; announce(check()); });
  A.on('stat', (d) => {
    if (d.kind === 'word') P.words += d.n;
    else P.flags[d.kind] = true;
    save();
    // Shown at game over, so nothing pops up while you play.
    check().forEach((bid) => { const b = badge(bid); waiting.push([b[1], 'Badge unlocked: ' + b[2], b[3]]); });
  });
  A.on('home', () => { paintHome(); flush(); });

  /* ---------- Front page: streak and profile buttons ---------- */
  const streakBtn = $('#streak'), profBtn = $('#profopen');
  function paintHome() {
    const n = liveStreak();
    streakBtn.textContent = n ? '🔥 ' + n + '-DAY STREAK' : '🔥 START A STREAK';
    streakBtn.classList.toggle('cold', !n);
    streakBtn.title = !n ? 'Finish a game today to start a streak.'
      : P.streak.last === localDay() ? 'You played today. Come back tomorrow!' : 'Play a game today to keep your streak!';
    profBtn.textContent = '🏅 MY BADGES ' + Object.keys(P.badges).filter((b) => badge(b)).length + '/' + BADGES.length;
  }

  /* ---------- My profile page ---------- */
  const prof = $('#profile'), home = $('#home');
  function stat(n, label) { const d = el('div', 'pstat'); d.append(el('b', '', String(n)), el('span', '', label)); return d; }
  function openProfile() {
    const me = A.player.get();
    $('#pname').textContent = me ? 'Playing as ' + me.name : 'No leaderboard name yet. Pick one in the Daily Challenge box.';
    const n = liveStreak();
    const nudge = !P.total ? 'Finish any game to start your first streak.'
      : P.streak.last === localDay() ? 'You played today. Come back tomorrow to make it ' + (n + 1) + '!'
        : n ? 'Play a game today to keep your ' + n + '-day streak!' : 'Your streak ended. Play a game today to start a new one.';
    $('#pnudge').textContent = nudge;
    const stats = $('#pstats'); stats.textContent = '';
    const earned = BADGES.filter((b) => P.badges[b[0]]).length;
    stats.append(stat('🔥 ' + n, 'Day streak'), stat(P.streak.best, 'Best streak'), stat(P.total, 'Games finished'),
      stat(tried() + '/' + cards().length, 'Games tried'), stat(earned + '/' + BADGES.length, 'Badges'));
    const grid = $('#pbadges'); grid.textContent = '';
    // Earned badges first, newest first, then the ones still to get.
    const order = BADGES.slice().sort((a, b) => (P.badges[b[0]] || 0) - (P.badges[a[0]] || 0));
    order.forEach(([bid, icon, title, how]) => {
      const has = !!P.badges[bid];
      const t = el('div', 'pbadge' + (has ? ' got' : ''));
      t.append(el('span', 'ticon', icon), el('b', '', title), el('span', '', how));
      if (has) t.append(el('em', '', 'Earned ' + new Date(P.badges[bid]).toLocaleDateString('en', { month: 'short', day: 'numeric' })));
      t.title = has ? 'Earned!' : 'Not yet: ' + how;
      grid.appendChild(t);
    });
    const list = $('#pbest'); list.textContent = '';
    cards().forEach((c) => {
      const gid = c.dataset.game, best = A.store.get(gid);
      const li = el('li'); li.style.setProperty('--c', c.style.getPropertyValue('--c'));
      li.append(el('span', '', nameOf(gid)), el('b', '', best === null ? '—' : String(best)), el('span', 'plays', (P.played[gid] || 0) + '×'));
      list.appendChild(li);
    });
    home.hidden = true; $('#boards').hidden = true; $('#game').hidden = true; prof.hidden = false;
    window.scrollTo(0, 0);
  }
  function closeProfile() { prof.hidden = true; home.hidden = false; paintHome(); profBtn.focus(); }
  streakBtn.addEventListener('click', openProfile);
  profBtn.addEventListener('click', openProfile);
  $('#pback').addEventListener('click', closeProfile);

  // Older players already have best scores saved: count those games as tried, so their badges show up right away.
  cards().forEach((c) => { const gid = c.dataset.game; if (A.store.get(gid) !== null && !P.played[gid]) P.played[gid] = 1; });
  if (!P.total) P.total = Object.values(P.played).reduce((s, v) => s + v, 0);
  check();
  paintHome();
  const now = A.current(); if (now) paintChal(Object.assign({}, now, { label: '' }));
  if (q.has('profile')) openProfile();
})();
