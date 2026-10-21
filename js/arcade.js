/* Pocket Arcade shell: menu, game screen, overlay, input, sound and saved scores.
   Each game lives in js/games/<id>.js and is only downloaded the first time it is opened.
   A game file calls Arcade.register(id, game) with an object that has reset() and either
   update(dt) + draw() for canvas games, or dom: true for games built from HTML (Memory, Blackjack).
   Optional input hooks: key(e, down), press(down), point({x, y}), swipe(dx, dy), tap(), stop(). */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const cv = $('#cv'), ctx = cv.getContext('2d', { alpha: false }); // Every game paints its whole background, so the canvas needs no transparency.
  const C = { bg: '#0d0a15', ink: '#f4ecdc', muted: '#a39abb', line: '#2a2240', amber: '#ffb347', cyan: '#5ce1e6', pink: '#ff6b9a', lime: '#b8e65c', violet: '#a78bfa' };
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const font = (px) => px + 'px "Press Start 2P", monospace';
  const shuffle = (list) => {
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return list;
  };

  const store = {
    get(k) { try { const v = Number(localStorage.getItem('arcade:' + k) ?? NaN); return Number.isFinite(v) ? v : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('arcade:' + k, String(v)); } catch (e) {} },
  };

  /* ---------- Sound ---------- */
  const sfx = {
    on: store.get('sound') !== 0, ac: null,
    unlock() { try { if (!this.ac) this.ac = new (window.AudioContext || window.webkitAudioContext)(); if (this.ac.state === 'suspended') this.ac.resume(); } catch (e) {} },
    tone(f, d, type = 'square', vol = 0.05, to = 0) {
      if (!this.on || !this.ac) return;
      try {
        const t = this.ac.currentTime, o = this.ac.createOscillator(), g = this.ac.createGain();
        o.type = type; o.frequency.setValueAtTime(f, t);
        if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g); g.connect(this.ac.destination); o.start(t); o.stop(t + d + 0.02);
      } catch (e) {}
    },
    point() { this.tone(880, 0.07); },
    hop() { this.tone(330, 0.12, 'square', 0.04, 660); },
    hit() { this.tone(220, 0.05, 'triangle', 0.08); },
    shoot() { this.tone(1200, 0.1, 'sawtooth', 0.03, 300); },
    lose() { this.tone(300, 0.5, 'sawtooth', 0.05, 60); },
    win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.12), i * 110)); },
  };

  /* ---------- Cached drawings ---------- */
  // Parts of a scene that never change (a maze, a board) are painted once into an off-screen canvas.
  let dpr = 1;
  const layers = new Map();
  function cached(key, w, h, paint) {
    let layer = layers.get(key);
    if (!layer || layer.dpr !== dpr) {
      layer = document.createElement('canvas');
      layer.width = w * dpr; layer.height = h * dpr; layer.dpr = dpr;
      const g = layer.getContext('2d'); g.scale(dpr, dpr); paint(g);
      layers.set(key, layer);
    }
    return layer;
  }

  /* ---------- Loading games ---------- */
  const GAMES = {};
  // Game files get the same ?v= as this file, so after an update every browser loads the new games right away.
  const VERSION = document.currentScript ? new URL(document.currentScript.src).search : '';
  const loading = {};
  function load(gid) {
    if (GAMES[gid]) return Promise.resolve(GAMES[gid]);
    if (!/^[a-z]+$/.test(gid)) return Promise.reject(new Error('Unknown game: ' + gid));
    if (!loading[gid]) {
      loading[gid] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/games/' + gid + '.js' + VERSION;
        s.onload = () => (GAMES[gid] ? resolve(GAMES[gid]) : reject(new Error('Game did not register: ' + gid)));
        s.onerror = () => { delete loading[gid]; s.remove(); reject(new Error('Could not load ' + gid)); };
        document.head.appendChild(s);
      });
    }
    return loading[gid];
  }

  /* ---------- Shell ---------- */
  let id = null, game = null, running = false, phase = 'idle', raf = 0, last = 0, ovAction = null, lastScore = 0;
  const ov = $('#ov'), stage = $('#stage'), screen = $('#game'), home = $('#home'), scoreEl = $('#score'), bestEl = $('#best');

  const fmtBest = (gid) => { const v = store.get(gid); return v === null ? '—' : String(v); };
  function refreshMenu() { $$('[data-best]').forEach((el) => { el.textContent = fmtBest(el.dataset.best); }); }
  function setScore(v) { if (phase === 'play' && v > lastScore && !game.quietScore) sfx.point(); lastScore = v; scoreEl.textContent = v; }
  function paintSound() { $$('.sound').forEach((b) => { b.textContent = sfx.on ? 'SOUND ON' : 'SOUND OFF'; b.setAttribute('aria-pressed', String(sfx.on)); }); }
  $$('.sound').forEach((b) => b.addEventListener('click', () => { sfx.on = !sfx.on; store.set('sound', sfx.on ? 1 : 0); sfx.unlock(); paintSound(); b.blur(); }));
  paintSound();

  function showOverlay(title, text, btn, action) {
    $('#ovt').textContent = title; $('#ovp').textContent = text; $('#ovb').textContent = btn;
    ovAction = action; ov.hidden = false; board.hide();
  }

  /* ---------- Leaderboard ---------- */
  // Top 100 for every game, shown under the game screen at game over, plus the player's own place (even below the top 100).
  // The scores are kept by the Cloudflare Worker in leaderboard/worker.js; if it can't be reached (or you run the site on
  // your own computer), the box just stays hidden.
  const board = {
    el: $('#lb'), ask: 0,
    MIN: { blackjack: 101, memory: 8 }, // Scores below this can't go on the board (everyone starts Blackjack with 100 coins).
    name() { try { return localStorage.getItem('arcade:name') || ''; } catch (e) { return ''; } },
    hide() { this.ask++; this.el.hidden = true; this.el.textContent = ''; },
    async show(gid, g, score) {
      const ask = ++this.ask;
      let data;
      try {
        const r = await fetch('/api/scores?game=' + gid + '&name=' + encodeURIComponent(this.name()));
        if (!r.ok) return;
        data = await r.json();
      } catch (e) { return; }
      if (ask !== this.ask || !Array.isArray(data.scores)) return;
      // Every real score can be saved, so everyone gets a place. Only ask when it beats the name's saved best.
      const beats = (best) => (g.lowerWins ? score < best : score > best);
      const fits = score >= (this.MIN[gid] ?? 1) && (!data.me || beats(data.me.score));
      this.render(data);
      if (fits) this.askName(gid, score, ask);
    },
    render({ scores, total, me }) {
      const el = this.el; el.textContent = ''; el.hidden = false;
      const h = document.createElement('h4'); h.textContent = 'Top 100'; el.appendChild(h);
      if (me) {
        const p = document.createElement('p'); p.className = 'lbme';
        p.textContent = 'Your place: #' + me.rank.toLocaleString() + ' of ' + (total || me.rank).toLocaleString() + ' (best ' + me.score + ')';
        el.appendChild(p);
      }
      if (!scores.length) { const p = document.createElement('p'); p.textContent = 'No scores yet. Be the first!'; el.appendChild(p); }
      const ol = document.createElement('ol');
      let mine = null;
      scores.forEach((s, i) => {
        const li = document.createElement('li');
        if (me && i + 1 === me.rank) { li.className = 'me'; mine = li; }
        [String(i + 1), s.name, String(s.score)].forEach((t) => { const b = document.createElement('span'); b.textContent = t; li.appendChild(b); });
        ol.appendChild(li);
      });
      el.appendChild(ol);
      if (mine) ol.scrollTop = mine.offsetTop - ol.clientHeight / 2; // Scroll the list (not the page) to you.
    },
    askName(gid, score, ask) {
      const row = document.createElement('div'); row.className = 'lbname';
      const input = document.createElement('input');
      input.maxLength = 12; input.placeholder = 'YOUR NAME'; input.autocomplete = 'nickname'; input.setAttribute('aria-label', 'Your name for the leaderboard');
      input.value = this.name();
      const send = document.createElement('button'); send.textContent = 'Save score';
      const msg = document.createElement('p');
      row.append(input, send); this.el.insertBefore(row, this.el.querySelector('ol')); this.el.insertBefore(msg, row.nextSibling);
      const submit = async () => {
        const name = input.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').trim();
        if (!name) { msg.textContent = 'Type a name first (A-Z, 0-9).'; input.focus(); return; }
        try { localStorage.setItem('arcade:name', name); } catch (e) {}
        send.disabled = true; msg.textContent = 'Saving...';
        try {
          const r = await fetch('/api/scores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game: gid, name, score }) });
          const data = await r.json();
          if (ask !== this.ask) return;
          if (!r.ok) { msg.textContent = data.error || 'Could not save. Try again.'; send.disabled = false; return; }
          this.render(data);
        } catch (e) { if (ask === this.ask) { msg.textContent = 'Could not save. Try again.'; send.disabled = false; } }
      };
      send.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    },
  };
  $('#ovb').addEventListener('click', () => ovAction && ovAction());

  // Physics runs in small steps so a fast ball can't skip through a paddle or brick when a phone drops frames.
  const STEP = 1 / 120;
  function loop(t) {
    let dt = Math.min((t - last) / 1000, 1 / 30); last = t;
    while (running && dt > 1e-6) { const s = Math.min(dt, STEP); game.update(s); dt -= s; }
    game.draw();
    if (running) raf = requestAnimationFrame(loop);
  }
  function play() {
    sfx.unlock();
    if (phase !== 'paused' && window.track) window.track('game_start', { game_name: id });
    ov.hidden = true; phase = 'play'; board.hide();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (game.dom) return;
    running = true; last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  function startGame() { game.reset(); setScore(0); if (!game.dom) game.draw(); play(); }
  function pause() {
    if (phase !== 'play' || game.dom) return;
    running = false; cancelAnimationFrame(raf); phase = 'paused';
    showOverlay('Paused', 'Take a breather.', 'Resume', play);
  }
  function over(score, msg, title) {
    running = false; cancelAnimationFrame(raf); phase = 'over';
    const prev = store.get(id);
    const better = prev === null || (game.lowerWins ? score < prev : score > prev);
    if (better && (score > 0 || game.lowerWins)) store.set(id, score);
    if (window.track) window.track('game_over', { game_name: id, score });
    bestEl.textContent = fmtBest(id);
    const line = msg || (game.label + ': ' + score + '.');
    if (title) sfx.win(); else sfx.lose();
    showOverlay(title || 'Game over', line + (better && prev !== null ? ' New best!' : ''), 'Play again', startGame);
    board.show(id, game, score);
  }

  function showScreen(gameOpen) { home.hidden = gameOpen; screen.hidden = !gameOpen; }

  async function openGame(gid) {
    id = gid;
    try { game = await load(gid); } catch (e) { game = null; setFull(false); alert('Sorry, that game could not load. Check your connection and try again.'); return; }
    if (id !== gid) return; // Another game was picked while this one was loading.
    showScreen(true);
    screen.style.setProperty('--c', game.color);
    $('#gtitle').textContent = game.title; $('#slabel').textContent = game.label;
    $('#blabel').textContent = game.lowerWins ? 'Fewest' : 'Best';
    bestEl.textContent = fmtBest(gid); $('#hint').innerHTML = game.hint;
    $('#mem').hidden = !game.dom; cv.hidden = !!game.dom;
    if (game.dom) stage.style.maxWidth = '520px';
    else {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = game.W * dpr; cv.height = game.H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stage.style.maxWidth = game.W + 'px';
    }
    game.reset(); setScore(0);
    fit();
    if (!game.dom) game.draw();
    window.scrollTo(0, 0);
    play(); // Picking a game starts it right away, with no extra Start button.
  }
  function closeGame() {
    running = false; cancelAnimationFrame(raf); phase = 'idle';
    if (game && game.stop) game.stop();
    setFull(false);
    showScreen(false);
    refreshMenu();
    const card = document.querySelector('[data-game="' + id + '"]'); if (card) card.focus();
  }

  $$('[data-game]').forEach((b) => {
    const gid = b.dataset.game;
    // Games open in full screen. The browser only allows that straight from a click, so it is asked for here.
    b.addEventListener('click', () => { setFull(true); openGame(gid); });
    // Start downloading a game as soon as the player shows interest in it.
    const warm = () => load(gid).catch(() => {});
    b.addEventListener('pointerenter', warm, { once: true });
    b.addEventListener('focus', warm, { once: true });
    b.addEventListener('touchstart', warm, { once: true, passive: true });
  });
  $('#back').addEventListener('click', closeGame);

  /* ---------- Full screen ---------- */
  // Uses the browser's Fullscreen API. Where that is missing (iPhone Safari), the game screen is
  // instead stretched over the whole page, which still hides the rest of the site.
  const fullBtn = $('#full');
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const isFull = () => screen.classList.contains('full');
  function fit() {
    // In full screen a canvas game grows as big as it can while keeping its shape.
    if (!game || game.dom) return;
    let scale = 1;
    if (isFull()) {
      const cs = getComputedStyle(screen), gap = parseFloat(cs.rowGap) || 0;
      let room = screen.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 12; // 12 = the frame around the stage
      [...screen.children].forEach((el) => { if (el !== stage && !el.hidden) room -= el.offsetHeight + gap; });
      const w = Math.max(160, Math.floor(room * game.W / game.H));
      stage.style.maxWidth = w + 'px';
      scale = Math.max(1, cv.clientWidth / game.W);
    } else stage.style.maxWidth = game.W + 'px';
    // Draw with more pixels when the game is shown bigger, so it stays sharp.
    const d = Math.min(Math.min(window.devicePixelRatio || 1, 2) * scale, 4);
    if (Math.abs(d - dpr) > 0.05) {
      dpr = d; cv.width = Math.round(game.W * dpr); cv.height = Math.round(game.H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      game.draw();
    }
  }
  function paintFull() {
    const on = isFull();
    fullBtn.textContent = on ? 'EXIT FULL' : 'FULL SCREEN';
    fullBtn.setAttribute('aria-pressed', String(on));
    document.documentElement.classList.toggle('lock', on);
    fit();
  }
  function askFull() {
    const root = document.documentElement, req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (navigator.userActivation && !navigator.userActivation.isActive) return; // No tap yet, so the browser would say no.
    if (req && !fsEl()) { try { const p = req.call(root); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
  }
  function setFull(on) {
    if (on === isFull()) return;
    screen.classList.toggle('full', on);
    paintFull();
    try {
      if (on) askFull();
      else if (fsEl()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        const p = exit.call(document); if (p && p.catch) p.catch(() => {});
      }
    } catch (e) {}
  }
  // Leaving real full screen with the browser's own Esc key or gesture also shrinks the game back.
  const onFsChange = () => { if (!fsEl() && isFull()) { screen.classList.remove('full'); paintFull(); } else fit(); };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  window.addEventListener('resize', fit);
  fullBtn.addEventListener('click', () => { setFull(!isFull()); fullBtn.blur(); });

  /* ---------- Input ---------- */
  const GAME_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  document.addEventListener('keydown', (e) => {
    if (screen.hidden) return;
    const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return; // Typing a leaderboard name.
    if (e.code === 'Escape') { closeGame(); return; }
    if (phase === 'play') {
      if (e.code === 'KeyP') { pause(); return; }
      if (GAME_KEYS.includes(e.code) && !game.dom) e.preventDefault();
      if (game.key) game.key(e, true);
    } else if (!ov.hidden && !onButton && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault(); if (!e.repeat && ovAction) ovAction();
    } else if (e.code === 'KeyP' && phase === 'paused') play();
  });
  document.addEventListener('keyup', (e) => { if (phase === 'play' && game && game.key) game.key(e, false); });

  const toGame = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * game.W, y: (e.clientY - r.top) / r.height * game.H }; };
  let swipeStart = null;
  cv.addEventListener('pointerdown', (e) => {
    if (phase !== 'play') return;
    e.preventDefault();
    // Keep getting this finger's events even if it slides off the game screen, so a held jump or drag always ends.
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    if (game.press) game.press(true);
    if (game.point) game.point(toGame(e));
    if (game.swipe || game.tap) swipeStart = { x: e.clientX, y: e.clientY, moved: false };
  });
  cv.addEventListener('pointermove', (e) => {
    if (phase !== 'play') return;
    if (game.point) game.point(toGame(e));
    if (swipeStart) {
      const dx = e.clientX - swipeStart.x, dy = e.clientY - swipeStart.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 24) { if (game.swipe) game.swipe(dx, dy); swipeStart = { x: e.clientX, y: e.clientY, moved: true }; }
    }
  });
  const release = () => { if (phase === 'play' && game && game.tap && swipeStart && !swipeStart.moved) game.tap(); swipeStart = null; if (phase === 'play' && game && game.press) game.press(false); };
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', release);
  // A game opened from a link starts without a click, so sound is switched on at the first touch or key.
  ['pointerdown', 'keydown'].forEach((t) => document.addEventListener(t, () => sfx.unlock(), { capture: true }));
  // A game opened from a link (like the Play button on a game's own page) can only fill the window at first,
  // because browsers allow real full screen only right after a tap. So the first tap or key in the game asks for it.
  ['pointerup', 'keydown'].forEach((t) => document.addEventListener(t, (e) => { if (e.key !== 'Escape' && isFull() && !(e.target.closest && e.target.closest('button'))) askFull(); }, { capture: true }));
  document.addEventListener('visibilitychange', () => { if (document.hidden && game) pause(); });

  /* ---------- What game files can use ---------- */
  window.Arcade = {
    ctx, C, $, rand, clamp, font, shuffle, cached, store, sfx, setScore, over,
    playing: () => phase === 'play',
    register(gid, g) { GAMES[gid] = g; },
  };

  refreshMenu();
  // Game pages link here as ?play=<game> so a search visitor lands right in that game.
  const startId = new URLSearchParams(location.search).get('play');
  if (startId && document.querySelector('[data-game="' + CSS.escape(startId) + '"]')) { setFull(true); openGame(startId); }
})();
