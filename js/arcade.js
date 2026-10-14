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
  const loading = {};
  function load(gid) {
    if (GAMES[gid]) return Promise.resolve(GAMES[gid]);
    if (!/^[a-z]+$/.test(gid)) return Promise.reject(new Error('Unknown game: ' + gid));
    if (!loading[gid]) {
      loading[gid] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/games/' + gid + '.js';
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
  function setScore(v) { if (phase === 'play' && v > lastScore) sfx.point(); lastScore = v; scoreEl.textContent = v; }
  function paintSound() { $$('.sound').forEach((b) => { b.textContent = sfx.on ? 'SOUND ON' : 'SOUND OFF'; b.setAttribute('aria-pressed', String(sfx.on)); }); }
  $$('.sound').forEach((b) => b.addEventListener('click', () => { sfx.on = !sfx.on; store.set('sound', sfx.on ? 1 : 0); sfx.unlock(); paintSound(); b.blur(); }));
  paintSound();

  function showOverlay(title, text, btn, action) {
    $('#ovt').textContent = title; $('#ovp').textContent = text; $('#ovb').textContent = btn;
    ovAction = action; ov.hidden = false;
  }
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
    ov.hidden = true; phase = 'play';
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
  }

  function showScreen(gameOpen) { home.hidden = gameOpen; screen.hidden = !gameOpen; }

  async function openGame(gid) {
    id = gid;
    try { game = await load(gid); } catch (e) { game = null; alert('Sorry, that game could not load. Check your connection and try again.'); return; }
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
    if (!game.dom) game.draw();
    phase = 'idle';
    showOverlay(game.title, game.intro, 'Start', play);
    window.scrollTo(0, 0);
  }
  function closeGame() {
    running = false; cancelAnimationFrame(raf); phase = 'idle';
    if (game && game.stop) game.stop();
    showScreen(false);
    refreshMenu();
    const card = document.querySelector('[data-game="' + id + '"]'); if (card) card.focus();
  }

  $$('[data-game]').forEach((b) => {
    const gid = b.dataset.game;
    b.addEventListener('click', () => openGame(gid));
    // Start downloading a game as soon as the player shows interest in it.
    const warm = () => load(gid).catch(() => {});
    b.addEventListener('pointerenter', warm, { once: true });
    b.addEventListener('focus', warm, { once: true });
    b.addEventListener('touchstart', warm, { once: true, passive: true });
  });
  $('#back').addEventListener('click', closeGame);

  /* ---------- Input ---------- */
  const GAME_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  document.addEventListener('keydown', (e) => {
    if (screen.hidden) return;
    const onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
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
  if (startId && document.querySelector('[data-game="' + CSS.escape(startId) + '"]')) openGame(startId);
})();
