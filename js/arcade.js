/* Pocket Arcade shell: menu, game screen, overlay, input, sound and saved scores.
   Each game lives in js/games/<id>.js and is only downloaded the first time it is opened.
   A game file calls Arcade.register(id, game) with an object that has reset() and either
   update(dt) + draw() for canvas games, or dom: true for games built from HTML (Memory).
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

  /* ---------- Daily challenge ---------- */
  // One game a day, the same for everyone, with its own top 10 that starts empty at midnight (UTC).
  // While it is played, the game's random numbers come from the date, so everyone gets the same start.
  // This list must match DAILY in leaderboard/worker.js.
  const DAILY = ['snake', 'runner', 'breakout', 'memory', 'snapgrid', 'invaders', 'flappy', 'muncher', 'chase', 'ski'];
  const today = () => new Date().toISOString().slice(0, 10);
  const dailyGame = (day) => DAILY[Math.floor(Date.parse(day) / 864e5) % DAILY.length];
  const realRandom = Math.random;
  let daily = null; // The day of the challenge being played, or null in a normal game.
  function seedRandom(day) {
    let s = 2166136261;
    for (const ch of day) s = Math.imul(s ^ ch.charCodeAt(0), 16777619) >>> 0;
    Math.random = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- Smooth animation ---------- */
  // Uses tween.js (js/vendor/tween.umd.min.js). Two groups of tweens:
  // "ui" moves parts of the page (the score, the Game Over box, the screen shake) on real time;
  // "play" moves things inside a game on the game's own clock, so they freeze while the game is paused.
  // Effects only change how things look, never the game itself. They use their own random numbers,
  // because a Daily Challenge swaps Math.random for one that gives everyone the same game.
  // If tween.js fails to load, every effect simply jumps to its end.
  const TW = window.TWEEN || null;
  const noise = Math.random;
  const calmMq = matchMedia('(prefers-reduced-motion: reduce)');
  const calm = () => calmMq.matches; // The player asked their device for less motion: no shakes or bounces.
  const EASE = TW ? {
    out: TW.Easing.Quadratic.Out, in: TW.Easing.Quadratic.In, inout: TW.Easing.Sinusoidal.InOut,
    back: TW.Easing.Back.Out, elastic: TW.Easing.Elastic.Out, bounce: TW.Easing.Bounce.Out, linear: TW.Easing.Linear.None,
  } : {};
  const uiGroup = TW && new TW.Group(), playGroup = TW && new TW.Group();
  let clock = 0; // Milliseconds of play. Only moves while a game is running.
  // Moves the numbers in obj to the values in to, over ms milliseconds.
  // opt: { ease: 'out' | 'back' | 'elastic' | ..., delay, yoyo (go there and back), update(obj), done(obj) }
  function animate(group, time, obj, to, ms, opt = {}) {
    if (!TW) { if (!opt.yoyo) Object.assign(obj, to); if (opt.update) opt.update(obj); if (opt.done) opt.done(obj); return null; }
    const t = new TW.Tween(obj, group).to(to, ms).easing(EASE[opt.ease] || EASE.out).delay(opt.delay || 0)
      .onUpdate((o) => { if (opt.update) opt.update(o); })
      .onComplete((o) => { group.remove(t); if (opt.done) opt.done(o); });
    if (opt.yoyo) t.yoyo(true).repeat(1);
    return t.start(time);
  }
  let uiRaf = 0;
  function uiTick(t) { uiGroup.update(t); uiRaf = uiGroup.getAll().length ? requestAnimationFrame(uiTick) : 0; }
  function uiTween(obj, to, ms, opt) {
    const t = animate(uiGroup, performance.now(), obj, to, ms, opt);
    if (t && !uiRaf) uiRaf = requestAnimationFrame(uiTick);
    return t;
  }
  const stopTween = (t) => { if (t) { t.stop(); uiGroup.remove(t); } };
  // For game files: a tween on the game's clock.
  const tween = (obj, to, ms, opt) => animate(playGroup, clock, obj, to, ms, opt);

  // Floating text, like "+10" where points were scored. x and y are in the game's own units.
  let pops = [];
  function pop(x, y, text, color = C.ink, size = 12) {
    const p = { x, y, text, color, size, a: 1, s: calm() ? 1 : 0.5 };
    pops.push(p);
    tween(p, { y: y - 34 }, 800, { ease: 'out' });
    if (p.s < 1) tween(p, { s: 1 }, 260, { ease: 'back' });
    tween(p, { a: 0 }, 350, { delay: 450, ease: 'in', done: () => { pops = pops.filter((q) => q !== p); } });
  }
  function drawPops() {
    if (!pops.length) return;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const p of pops) {
      ctx.globalAlpha = Math.max(0, p.a);
      ctx.font = font(Math.round(p.size * p.s));
      ctx.lineWidth = 4; ctx.strokeStyle = C.bg; ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }
  function clearPlayFx() { if (playGroup) playGroup.removeAll(); pops = []; clock = 0; }

  // Shakes the game picture. power is in screen pixels.
  let shakeTw = null;
  function shake(power = 6, ms = 320) {
    if (calm()) return;
    const el = game && game.dom ? $('#mem') : cv;
    stopTween(shakeTw);
    shakeTw = uiTween({ p: power }, { p: 0 }, ms, {
      update: (o) => { el.style.transform = 'translate(' + (noise() * 2 - 1) * o.p + 'px,' + (noise() * 2 - 1) * o.p + 'px)'; },
      done: () => { el.style.transform = ''; },
    });
  }

  /* ---------- Shell ---------- */
  let id = null, game = null, running = false, phase = 'idle', raf = 0, last = 0, ovAction = null, lastScore = 0;
  const ov = $('#ov'), stage = $('#stage'), screen = $('#game'), home = $('#home'), scoreEl = $('#score'), bestEl = $('#best');

  const fmtBest = (gid) => { const v = store.get(gid); return v === null ? '—' : String(v); };
  function refreshMenu() { $$('[data-best]').forEach((el) => { el.textContent = fmtBest(el.dataset.best); }); paintDaily(); paintWho(); }
  function setScore(v) {
    if (phase === 'play' && v > lastScore && !game.quietScore) { sfx.point(); popScore(); }
    lastScore = v; scoreEl.textContent = v;
  }
  // The score number jumps up a little and settles back each time it goes up.
  let scoreTw = null;
  function popScore() {
    if (calm()) return;
    stopTween(scoreTw);
    scoreTw = uiTween({ s: 1.45 }, { s: 1 }, 380, { ease: 'back', update: (o) => { scoreEl.style.transform = 'scale(' + o.s + ')'; } });
  }
  function paintSound() { $$('.sound').forEach((b) => { b.textContent = sfx.on ? 'SOUND ON' : 'SOUND OFF'; b.setAttribute('aria-pressed', String(sfx.on)); }); }
  $$('.sound').forEach((b) => b.addEventListener('click', () => { sfx.on = !sfx.on; store.set('sound', sfx.on ? 1 : 0); sfx.unlock(); paintSound(); b.blur(); }));
  paintSound();

  function showOverlay(title, text, btn, action, share) {
    $('#ovt').textContent = title; $('#ovp').textContent = text; $('#ovb').textContent = btn;
    shareInfo = share || null; shareBtn.hidden = !share; shareBtn.textContent = 'Share';
    ovAction = action; ov.hidden = false; board.hide(); next.hidden = true;
    // The box fades in and its words slide up into place.
    stopTween(ovTw);
    const move = calm() ? 0 : 22;
    ovTw = uiTween({ o: 0, y: move }, { o: 1, y: 0 }, 420, { ease: move ? 'back' : 'out', update: (o) => {
      ov.style.opacity = Math.min(1, o.o * 1.6); ov.style.setProperty('--ovy', o.y + 'px');
    } });
  }
  let ovTw = null;

  /* ---------- Share ---------- */
  // At game over, players can send their score to a friend with a link straight into the same game.
  const shareBtn = $('#ovs');
  let shareInfo = null;
  shareBtn.addEventListener('click', async () => {
    const s = shareInfo; if (!s) return;
    const what = s.label.toLowerCase();
    const text = s.day
      ? 'My ' + what + ' in today\'s Pocket Arcade Daily Challenge (' + s.title + '): ' + s.score + '. Can you beat it?'
      : 'My ' + what + ' in ' + s.title + ' on Pocket Arcade: ' + s.score + '. Can you beat it?';
    const url = location.origin + location.pathname + (s.day ? '?daily' : '?play=' + s.id);
    if (window.track) window.track('share', { game_name: s.id });
    if (navigator.share) {
      try { await navigator.share({ title: 'Pocket Arcade', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    // No share sheet (most computers): copy the message so it can be pasted anywhere.
    try { await navigator.clipboard.writeText(text + ' ' + url); shareBtn.textContent = 'Copied!'; } catch (e) { shareBtn.textContent = 'Could not copy'; }
    setTimeout(() => { if (shareInfo === s) shareBtn.textContent = 'Share'; }, 2000);
  });

  /* ---------- Play next ---------- */
  // At game over, three other games to try, so a player who is done with one finds the next.
  const next = $('#next');
  function showNext() {
    const row = next.querySelector('div'); row.textContent = '';
    const others = [...$$('.menu [data-game]')].filter((c) => c.dataset.game !== id);
    for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(realRandom() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
    others.slice(0, 3).forEach((card) => {
      const gid = card.dataset.game, b = document.createElement('button');
      b.className = 'mini'; b.style.setProperty('--c', card.style.getPropertyValue('--c'));
      const name = document.createElement('span'); name.textContent = card.querySelector('h2').textContent;
      b.append(card.querySelector('svg').cloneNode(true), name);
      b.addEventListener('click', () => { if (window.track) window.track('play_next', { game_name: gid, from: id }); switchGame(gid); });
      b.addEventListener('pointerenter', () => load(gid).catch(() => {}), { once: true });
      row.appendChild(b);
    });
    next.hidden = false;
  }

  /* ---------- Leaderboard ---------- */
  // Top 10 for every game and for today's Daily Challenge. The scores are kept by the Cloudflare Worker in
  // leaderboard/worker.js. If it can't be reached (or you run the site on your own computer), the boxes say it is offline.
  // Every name belongs to one player: the first player to use it claims it with a 4-digit PIN. The name and PIN are kept
  // on this device, so scores save by themselves; on another device the player types the same name and PIN.
  const OFFLINE = 'The leaderboard is offline right now. Try again later.';
  const cleanName = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
  const player = {
    get() {
      try {
        const name = localStorage.getItem('arcade:name') || '', pin = localStorage.getItem('arcade:pin') || '';
        return name && /^[0-9]{4}$/.test(pin) ? { name, pin } : null;
      } catch (e) { return null; }
    },
    lastName() { try { return localStorage.getItem('arcade:name') || ''; } catch (e) { return ''; } },
    set(name, pin) { try { localStorage.setItem('arcade:name', name); localStorage.setItem('arcade:pin', pin); } catch (e) {} },
    forget() { try { localStorage.removeItem('arcade:pin'); } catch (e) {} }, // The name stays filled in for next time.
  };
  // Sends something to the leaderboard. Resolves to { data } or { error, taken }.
  async function api(path, body) {
    try {
      const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
      const data = await r.json().catch(() => null);
      if (!data) return { error: OFFLINE };
      if (!r.ok) return { error: data.error || 'Could not save. Try again.', taken: !!data.taken };
      return { data };
    } catch (e) { return { error: OFFLINE }; }
  }
  // The name + PIN boxes. submit(name, pin) resolves to an error message, or nothing when it worked.
  function nameForm(button, submit) {
    const wrap = document.createElement('div'); wrap.className = 'lbform';
    const row = document.createElement('div'); row.className = 'lbname';
    const name = document.createElement('input');
    name.maxLength = 12; name.placeholder = 'NAME'; name.autocomplete = 'nickname'; name.setAttribute('aria-label', 'Your name for the leaderboard');
    name.value = player.lastName();
    const pin = document.createElement('input');
    pin.className = 'pin'; pin.type = 'password'; pin.inputMode = 'numeric'; pin.maxLength = 4; pin.placeholder = 'PIN'; pin.autocomplete = 'off';
    pin.setAttribute('aria-label', 'Your 4-digit PIN');
    const send = document.createElement('button'); send.textContent = button;
    const msg = document.createElement('p'); msg.className = 'lbmsg'; msg.setAttribute('aria-live', 'polite');
    row.append(name, pin, send); wrap.append(row, msg);
    const go = async () => {
      const n = cleanName(name.value), p = pin.value.trim();
      if (!n) { msg.textContent = 'Type a name first (A-Z, 0-9).'; name.focus(); return; }
      if (!/^[0-9]{4}$/.test(p)) { msg.textContent = 'The PIN is 4 digits, like 2580.'; pin.focus(); return; }
      send.disabled = true; msg.textContent = 'Saving...';
      const err = await submit(n, p);
      if (err && wrap.isConnected) { msg.textContent = err; send.disabled = false; }
    };
    send.addEventListener('click', go);
    [name, pin].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } }));
    return wrap;
  }
  // Paints a top 10 list into a .lb box.
  function paintBoard(el, title, { scores, total, me }) {
    el.textContent = ''; el.hidden = false;
    const h = document.createElement('h4'); h.textContent = title; el.appendChild(h);
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
  }
  function paintOffline(el, title) {
    el.textContent = ''; el.hidden = false;
    const h = document.createElement('h4'); h.textContent = title;
    const p = document.createElement('p'); p.textContent = OFFLINE;
    el.append(h, p);
  }
  const boardUrl = (gid, day, all) => (day ? '/api/daily?' : '/api/scores?game=' + gid + (all ? '&all=1' : '') + '&') + 'name=' + encodeURIComponent((player.get() || {}).name || '');

  // The box under the game screen at game over.
  const board = {
    el: $('#lb'), ask: 0,
    MIN: { memory: 8 }, // Scores below this can't go on the board.
    hide() { this.ask++; this.el.hidden = true; this.el.textContent = ''; },
    title() { return this.day ? 'Today\'s top 10' : 'This week\'s top 10'; },
    async show(gid, g, score, day) {
      const ask = ++this.ask;
      this.day = day; // A Daily Challenge game goes on that day's board instead of the game's.
      const { data, error } = await api(boardUrl(gid, day));
      if (ask !== this.ask) return;
      if (error || !Array.isArray(data.scores) || (day && (data.day !== day || data.game !== gid))) { paintOffline(this.el, this.title()); return; }
      // Every real score can be saved, so everyone gets a place. Only save when it beats the name's saved best.
      const beats = (best) => (g.lowerWins ? score < best : score > best);
      const fits = score >= (this.MIN[gid] ?? 1) && (!data.me || beats(data.me.score));
      paintBoard(this.el, this.title(), data);
      if (!fits) return;
      const me = player.get();
      if (me) this.autoSave(gid, score, me, ask); else this.askName(gid, score, ask);
    },
    save(gid, score, name, pin) {
      return api(this.day ? '/api/daily' : '/api/scores', { game: gid, name, pin, score, day: this.day });
    },
    // Signed in on this device: the score saves by itself.
    async autoSave(gid, score, me, ask) {
      const msg = document.createElement('p'); msg.className = 'lbmsg'; msg.textContent = 'Saving as ' + me.name + '...';
      this.el.insertBefore(msg, this.el.querySelector('ol'));
      const { data, error, taken } = await this.save(gid, score, me.name, me.pin);
      if (ask !== this.ask) return;
      if (!error) { paintBoard(this.el, this.title(), data); return; }
      msg.remove();
      if (taken) { player.forget(); paintWho(); this.askName(gid, score, ask, 'The PIN saved on this device is wrong. Type it again.'); return; }
      const p = document.createElement('p'); p.className = 'lbmsg'; p.textContent = error;
      this.el.insertBefore(p, this.el.querySelector('ol'));
    },
    askName(gid, score, ask, note) {
      const help = document.createElement('p');
      help.textContent = note || 'Save your score: pick a name and a 4-digit PIN. Already have a name? Type it with your PIN.';
      const form = nameForm('Save', async (name, pin) => {
        const { data, error } = await this.save(gid, score, name, pin);
        if (ask !== this.ask) return null;
        if (error) return error;
        player.set(name, pin); paintWho();
        paintBoard(this.el, this.title(), data);
        return null;
      });
      const ol = this.el.querySelector('ol');
      this.el.insertBefore(help, ol); this.el.insertBefore(form, ol);
    },
  };

  /* ---------- Your name, under the Daily Challenge ---------- */
  const who = $('#who');
  let whoNote = '';
  function paintWho() {
    if (!who) return;
    who.textContent = '';
    const me = player.get();
    if (me) {
      const p = document.createElement('p');
      p.append('Playing as ');
      const b = document.createElement('b'); b.textContent = me.name; p.append(b, '. Your scores save by themselves.');
      const change = document.createElement('button'); change.className = 'link'; change.textContent = 'Change name';
      change.addEventListener('click', () => { player.forget(); whoNote = ''; paintWho(); });
      who.append(p, change);
      if (whoNote) { const n = document.createElement('p'); n.className = 'lbmsg'; n.textContent = whoNote; who.appendChild(n); }
      return;
    }
    const tag = document.createElement('p'); tag.className = 'dtag'; tag.textContent = 'YOUR LEADERBOARD NAME';
    const help = document.createElement('p'); help.className = 'whohelp';
    help.textContent = 'New name? Make up any 4-digit PIN and remember it. On another phone or computer, type the same name and PIN.';
    const form = nameForm('Save name', async (name, pin) => {
      const { data, error } = await api('/api/name', { name, pin });
      if (error) return error;
      player.set(data.name, pin);
      whoNote = data.created ? 'Name saved! Remember your PIN for your other devices.' : 'Welcome back, ' + data.name + '!';
      paintWho();
      return null;
    });
    who.append(tag, form, help);
  }

  /* ---------- Leaderboard page ---------- */
  const boards = $('#boards'), blist = $('#blist'), btabs = $('#btabs'), bwhen = $('#bwhen');
  let tab = 'daily', when = 'week', boardAsk = 0; // when: a game's board for this week, or 'all' for its best scores ever.
  $$('#bwhen button').forEach((b) => b.addEventListener('click', () => { when = b.dataset.when; loadTab(); }));
  async function loadTab() {
    const ask = ++boardAsk;
    const card = tab === 'daily' ? null : document.querySelector('.menu [data-game="' + tab + '"]');
    const gid = tab === 'daily' ? dailyGame(today()) : tab;
    const dcard = document.querySelector('.menu [data-game="' + gid + '"]');
    boards.style.setProperty('--c', (card || dcard) ? (card || dcard).style.getPropertyValue('--c') : 'var(--amber)');
    $$('#btabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    bwhen.hidden = tab === 'daily';
    $$('#bwhen button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.when === when)));
    const all = tab !== 'daily' && when === 'all';
    const title = tab === 'daily' ? 'Today\'s top 10 · ' + (dcard ? dcard.querySelector('h2').textContent : '') : (all ? 'All-time top 10 · ' : 'This week\'s top 10 · ') + card.querySelector('h2').textContent;
    blist.textContent = ''; const h = document.createElement('h4'); h.textContent = title; const p = document.createElement('p'); p.textContent = 'Loading...'; blist.append(h, p);
    const { data, error } = await api(boardUrl(gid, tab === 'daily', all));
    if (ask !== boardAsk) return;
    if (error || !Array.isArray(data.scores)) paintOffline(blist, title); else paintBoard(blist, title, data);
  }
  function openBoards(start) {
    if (!btabs.childElementCount) {
      const tabs = [['daily', 'TODAY']].concat([...$$('.menu [data-game]')].map((c) => [c.dataset.game, c.querySelector('h2').textContent.toUpperCase()]));
      tabs.forEach(([t, label]) => {
        const b = document.createElement('button'); b.dataset.tab = t; b.textContent = label;
        b.addEventListener('click', () => { tab = t; loadTab(); });
        btabs.appendChild(b);
      });
    }
    if (start && (start === 'daily' || document.querySelector('.menu [data-game="' + CSS.escape(start) + '"]'))) tab = start;
    home.hidden = true; screen.hidden = true; boards.hidden = false;
    window.scrollTo(0, 0);
    loadTab();
  }
  function closeBoards() { boardAsk++; boards.hidden = true; home.hidden = false; refreshMenu(); $('#lbopen').focus(); }
  $('#lbopen').addEventListener('click', () => openBoards('daily'));
  $('#bback').addEventListener('click', closeBoards);

  $('#ovb').addEventListener('click', () => ovAction && ovAction());

  // Physics runs in small steps so a fast ball can't skip through a paddle or brick when a phone drops frames.
  const STEP = 1 / 120;
  function loop(t) {
    let dt = Math.min((t - last) / 1000, 1 / 30); last = t;
    clock += dt * 1000;
    while (running && dt > 1e-6) { const s = Math.min(dt, STEP); game.update(s); dt -= s; }
    if (playGroup) playGroup.update(clock);
    paint();
    if (running) raf = requestAnimationFrame(loop);
  }
  function paint() { game.draw(); drawPops(); }
  function play() {
    sfx.unlock();
    if (phase !== 'paused' && window.track) window.track('game_start', { game_name: id });
    ov.hidden = true; phase = 'play'; board.hide(); next.hidden = true;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (game.dom) return;
    running = true; last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  function fresh() { clearPlayFx(); if (daily) seedRandom(daily); game.reset(); setScore(0); } // A daily game starts the same way every time.
  function startGame() { fresh(); if (!game.dom) game.draw(); play(); }
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
    showOverlay(title || 'Game over', line, 'Play again', startGame,
      { id, title: game.title, label: game.label, score, day: daily });
    if (better && prev !== null) newBest();
    else if (!title) shake(7, 380);
    board.show(id, game, score, daily);
    showNext();
  }

  // "New best!" pops in with a bounce after the Game Over box arrives.
  function newBest() {
    const b = document.createElement('span'); b.className = 'newbest'; b.textContent = 'New best!';
    $('#ovp').append(' ', b);
    if (calm()) return;
    b.style.transform = 'scale(0)';
    uiTween({ s: 0 }, { s: 1 }, 900, { ease: 'elastic', delay: 250, update: (o) => { b.style.transform = 'scale(' + o.s + ')'; } });
  }

  function showScreen(gameOpen) { home.hidden = gameOpen; screen.hidden = !gameOpen; boards.hidden = true; }

  async function openGame(gid, day) {
    id = gid;
    daily = day || null;
    if (!daily) Math.random = realRandom;
    try { game = await load(gid); } catch (e) { game = null; setFull(false); alert('Sorry, that game could not load. Check your connection and try again.'); return; }
    if (id !== gid) return; // Another game was picked while this one was loading.
    showScreen(true);
    screen.style.setProperty('--c', game.color);
    $('#gtitle').textContent = game.title + (daily ? ' · Daily' : ''); $('#slabel').textContent = game.label;
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
    fresh();
    fit();
    if (!game.dom) game.draw();
    window.scrollTo(0, 0);
    play(); // Picking a game starts it right away, with no extra Start button.
  }
  function stopGame() {
    running = false; cancelAnimationFrame(raf); phase = 'idle';
    if (game && game.stop) game.stop();
    daily = null; Math.random = realRandom;
    board.hide(); next.hidden = true;
    stopTween(shakeTw); cv.style.transform = ''; $('#mem').style.transform = ''; clearPlayFx();
  }
  // From the "Play next" row: the game screen stays open (and in full screen) and the new game starts.
  function switchGame(gid) { stopGame(); openGame(gid); }
  function closeGame() {
    stopGame();
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

  /* ---------- Daily challenge box on the front page ---------- */
  const dailyBox = $('#daily');
  let dailyShown = '';
  function paintDaily() {
    const day = today(), gid = dailyGame(day), card = document.querySelector('.menu [data-game="' + gid + '"]');
    if (!card) return;
    dailyBox.style.setProperty('--c', card.style.getPropertyValue('--c'));
    $('#dday').textContent = new Date(day + 'T12:00:00Z').toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();
    $('#dname').textContent = card.querySelector('h2').textContent;
    const art = $('#dart'); art.textContent = ''; art.appendChild(card.querySelector('svg').cloneNode(true));
    dailyBox.hidden = false;
    // Today's leader. Stays empty if the leaderboard can't be reached.
    const lead = $('#dlead');
    if (dailyShown !== day) lead.textContent = '';
    dailyShown = day;
    fetch('/api/daily').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d || !Array.isArray(d.scores)) throw new Error('offline');
      if (d.day !== day) return;
      lead.textContent = d.scores.length ? 'Leader: ' + d.scores[0].name + ' with ' + d.scores[0].score : 'No scores yet today. Be the first!';
    }).catch(() => { if (dailyShown === day) lead.textContent = OFFLINE; });
  }
  function openDaily() { setFull(true); const day = today(); openGame(dailyGame(day), day); }
  $('#dplay').addEventListener('click', openDaily);

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
      paint();
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
    tween, pop, shake, calm, // Smooth animation: see "Smooth animation" above.
    playing: () => phase === 'play',
    register(gid, g) { GAMES[gid] = g; },
  };

  /* ---------- Add to home screen ---------- */
  // sw.js keeps a copy of the site, so it opens like an app from the home screen and works offline after the first visit.
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const installBtn = $('#install'), installTip = $('#itip');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let installAsk = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installAsk = e; installBtn.hidden = false; });
  window.addEventListener('appinstalled', () => { installBtn.hidden = true; installTip.hidden = true; if (window.track) window.track('app_installed'); });
  // iPhones and iPads never offer the install prompt, so there the button shows how to do it by hand.
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (apple && !standalone) installBtn.hidden = false;
  installBtn.addEventListener('click', async () => {
    if (!installAsk) { installTip.hidden = !installTip.hidden; return; }
    installAsk.prompt();
    try { await installAsk.userChoice; } catch (e) {}
    installAsk = null; installBtn.hidden = true;
  });

  refreshMenu();
  // Game pages link here as ?play=<game> so a search visitor lands right in that game. ?daily opens today's Daily Challenge.
  const params = new URLSearchParams(location.search), startId = params.get('play');
  if (params.has('daily')) openDaily();
  else if (params.has('board')) openBoards(params.get('board') || 'daily');
  else if (startId && document.querySelector('[data-game="' + CSS.escape(startId) + '"]')) { setFull(true); openGame(startId); }
})();
