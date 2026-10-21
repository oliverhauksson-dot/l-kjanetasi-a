/* Cube Rush. Loaded on demand by js/arcade.js the first time the game is opened.
   A one-button jumping game: the cube slides right on its own and you jump over spikes and onto blocks.
   It opens on its own level picker (Level 1-3 and Endless). Levels are built from the small pieces in PARTS. */
(() => {
  const { ctx, C, font, clamp, rand, store, sfx, setScore, over } = Arcade;

  const T = 30; // One tile. The cube is one tile big.
  const GY = 300, PX = 150; // Where the ground and the cube are on screen.
  const G = 3000, JUMP = 640, PAD = 900, ORB = 660, FALL = 1100; // Jump about 2 tiles high and 4 tiles far.
  const SPIN = 7.4; // Turns the cube half a turn in one normal jump.

  /* ---------- Level pieces ----------
     Each piece is drawn as rows of text, top row first. The bottom row sits on the ground.
     # block   ^ spike   v spike hanging down   _ jump pad (bounces you high)   o jump ring (tap in the air)   . empty
     The number is how hard the piece is, used by Endless. */
  const PARTS = {
    run: [1, ['......']],
    s1: [1, ['.....^.....']],
    s2: [1, ['.....^^......']],
    b1: [1, ['.....#......']],
    b2: [1, ['....##.......']],
    bb: [1, ['....#....#......']],
    bs: [1, ['....#^.......']],
    stairs: [1, ['.......##.....', '.....####.....', '...######.....']],
    ledge: [1, ['.......###.......', '....######^^.....']],
    pad: [1, ['...._...^^^.......']],
    s3: [2, ['.....^^^........']],
    s1s1: [2, ['....^.....^.......']],
    wall: [2, ['....##.......', '....##^^.....']],
    towers: [2, ['....#..#..#......', '....#^^#^^#......']],
    ring: [2, ['.......o.........', '.................', '....^^^^^^^......']],
    padwall: [2, ['.........###......', '.._.....####^^^...']],
    tunnel: [2, ['..##########......', '..vvvvvvvvvv......', '................', '................', '.....^....^......']],
    hop: [2, ['......##....##.......', '....^^##^^^^##^^.....']],
    s3s3: [3, ['....^^^.....^^^........']],
    rings: [3, ['.........o...........', '.....o...............', '.....................', '..^^^^^^^^^^^^.......']],
    climb: [3, ['..........##.......', '.......#####.......', '....#####..#^^^....', '..###.......#^^^...']],
    padring: [3, ['........o.............', '......................', '.._.^^^^^^^^^.........']],
    pillars: [3, ['.......#.....#.......', '....#..#..#..#.......', '....#^^#^^#^^#^^^....']],
  };

  // Each level is a list of pieces in order. A short gap is put between pieces.
  const LEVELS = [
    { name: 'LEVEL 1', tag: 'Easy', speed: 300, theme: 0, parts: ['run', 's1', 'b1', 's1', 'run', 'b2', 's2', 'bb', 'stairs', 's1', 'bs', 'pad', 's2', 'ledge', 'b1', 's1', 'stairs', 's2', 'bb', 'pad', 'run', 'b2', 's2', 'ledge', 's1', 'bs', 'stairs', 's2', 'pad', 'b1', 's2', 'bb', 'ledge', 's2', 'run'] },
    { name: 'LEVEL 2', tag: 'Medium', speed: 330, theme: 1, parts: ['run', 's2', 'b2', 's3', 'stairs', 'wall', 's1s1', 'pad', 'ring', 'bs', 'towers', 's3', 'padwall', 'ledge', 'tunnel', 's2', 'hop', 'ring', 'b2', 's3', 'wall', 's1s1', 'towers', 'padwall', 'hop', 'tunnel', 'ring', 's3', 'stairs', 'wall', 's1s1', 'run'] },
    { name: 'LEVEL 3', tag: 'Hard', speed: 360, theme: 2, parts: ['run', 's3', 'wall', 's3s3', 'towers', 'rings', 'climb', 'hop', 'padring', 's1s1', 'pillars', 'ring', 's3s3', 'tunnel', 'padwall', 'climb', 'rings', 'hop', 'pillars', 's3', 'padring', 'towers', 's3s3', 'climb', 'rings', 'pillars', 'hop', 'padring', 's3s3', 'run'] },
  ];
  const ENDLESS = 3;
  const THEMES = [
    { sky: '#12305a', bg: '#0b0f22', main: '#5ce1e6', dark: '#0e2436', glow: 'rgba(92,225,230,' },
    { sky: '#3a1450', bg: '#120a1c', main: '#ff6b9a', dark: '#2a1030', glow: 'rgba(255,107,154,' },
    { sky: '#4a1d10', bg: '#140a08', main: '#ffb347', dark: '#2e1a0c', glow: 'rgba(255,179,71,' },
    { sky: '#1d3a12', bg: '#0a1208', main: '#b8e65c', dark: '#18280e', glow: 'rgba(184,230,92,' },
    { sky: '#2a1d5a', bg: '#0d0a1e', main: '#a78bfa', dark: '#1d1638', glow: 'rgba(167,139,250,' },
  ];

  /* ---------- The world ---------- */
  // cols[c] is the list of things in tile column c, each { k: kind, r: row from the ground }.
  function addPart(w, name) {
    const rows = PARTS[name][1], n = rows[0].length;
    rows.forEach((line, i) => {
      const r = rows.length - 1 - i;
      for (let j = 0; j < n; j++) {
        const k = line[j];
        if (k !== '.') (w.cols[w.end + j] ||= []).push({ k, r });
      }
    });
    w.end += n + 2;
  }
  function buildLevel(L) {
    const w = { cols: [], end: 10 };
    for (const p of L.parts) addPart(w, p);
    w.finish = (w.end + 6) * T;
    return w;
  }

  /* ---------- Moving the cube (one physics step) ---------- */
  // p is the cube: x (left edge), h (height of its bottom above the ground), vy (up is positive).
  function step(p, w, dt, hold) {
    p.x += p.speed * dt;
    if (p.buf > 0) p.buf -= dt;
    if (p.ground && (hold || p.buf > 0)) { p.vy = JUMP; p.ground = false; p.buf = 0; p.jumped = true; }
    const ph = p.h;
    p.vy = Math.max(p.vy - G * dt, -FALL);
    p.h += p.vy * dt;
    const was = p.ground; p.ground = false;
    // Landing: on the ground, or on top of a block it just came down onto (a small step up is allowed).
    if (p.vy <= 0) {
      let top = p.h <= 0 ? 0 : -1;
      for (let c = Math.floor((p.x + 1) / T); c <= Math.floor((p.x + T - 1) / T); c++) {
        for (const o of w.cols[c] || []) {
          if (o.k !== '#') continue;
          const t = (o.r + 1) * T;
          if (t >= p.h - 0.01 && t <= ph + 6 && t > top) top = t;
        }
      }
      if (top >= 0) { p.h = top; p.vy = 0; p.ground = true; if (!was) p.landed = true; }
    }
    // Hits: a slightly smaller box than the cube, so only a real hit counts.
    const x = p.x, h = p.h;
    for (let c = Math.floor((x + 3) / T); c <= Math.floor((x + 27) / T); c++) {
      const bx = c * T;
      for (const o of w.cols[c] || []) {
        const by = o.r * T;
        if (o.k === '#') {
          if (x + 27 > bx && x + 3 < bx + T && h + 27 > by && h + 3 < by + T) { p.dead = true; return; }
        } else if (o.k === '^') {
          if (x + 26 > bx + 10 && x + 4 < bx + 20 && h + 2 < by + 14 && h + 28 > by) { p.dead = true; return; }
        } else if (o.k === 'v') {
          if (x + 26 > bx + 10 && x + 4 < bx + 20 && h + 28 > by + 16 && h + 2 < by + T) { p.dead = true; return; }
        } else if (o.k === '_') {
          if (p.vy <= 0 && x + 28 > bx + 3 && x + 2 < bx + 27 && h <= by + 6 && h + T > by) { p.vy = PAD; p.ground = false; p.padded = true; }
        } else if (o.k === 'o') {
          const dx = clamp(bx + 15, x, x + T) - (bx + 15), dy = clamp(by + 15, h, h + T) - (by + 15);
          const id = c * 16 + o.r;
          if (p.buf > 0 && !p.used.includes(id) && dx * dx + dy * dy < 20 * 20) { p.used = p.used.concat(id); p.vy = ORB; p.buf = 0; p.ground = false; p.ringed = true; }
        }
      }
    }
  }

  /* ---------- The game ---------- */
  const BTN = { x: 130, w: 300, h: 42, y0: 86, gap: 9 }; // The level picker buttons.
  const MENU = { x: 8, y: 8, w: 34, h: 26 }; // The small "back to levels" button in a run.

  const cube = {
    W: 560, H: 360, color: 'var(--violet)', title: 'Cube Rush', label: 'Score',
    quietScore: true, // The score climbs every tile, so there is no beep for each one.
    intro: 'Jump over spikes and onto blocks. Pick Level 1, 2 or 3, or Endless, which keeps getting faster.',
    hint: '<kbd>Space</kbd> <kbd>↑</kbd>, click or tap to jump, hold to keep jumping. Tap a yellow ring in the air for a second jump. <kbd>M</kbd> for the level picker, <kbd>P</kbd> to pause',
    PARTS, LEVELS, step, buildLevel, // Used by the level checker in tests.

    reset() {
      // "Play again" after Endless goes straight into a new run. Anything else opens the level picker.
      const again = this.again; this.again = null;
      this.t = 0; this.sel = this.sel || 0; this.ptr = null; this.hold = false; this.parts = [];
      if (again === ENDLESS) this.start(ENDLESS);
      else { this.mode = 'menu'; this.p = null; this.cam = 0; this.scroll = 0; this.th = THEMES[4]; setScore(0); }
    },
    stop() { this.again = null; },

    best(i) { return store.get('cube-' + (i + 1)); },
    start(i) {
      this.lvl = i; this.mode = 'play'; this.hold = false;
      this.attempts = this.lvl === this.lastLvl ? this.attempts : 0; this.lastLvl = i;
      this.run();
    },
    run() {
      const i = this.lvl;
      this.attempts++;
      if (i === ENDLESS) { this.w = { cols: [], end: 14 }; this.gen = 0; this.fill(0); this.w.finish = Infinity; }
      else this.w = buildLevel(LEVELS[i]);
      this.p = { x: 0, h: 0, vy: 0, ground: true, buf: 0, used: [], speed: i === ENDLESS ? 300 : LEVELS[i].speed };
      this.mode = 'play'; this.ang = 0; this.cam = 0; this.trail = []; this.trailT = 0; this.bits = [];
      this.dieT = 0; this.score = 0; this.th = THEMES[i === ENDLESS ? 3 : LEVELS[i].theme]; this.flash = 0; this.zone = 0;
      setScore(0);
    },
    fill(x) {
      // Endless: keep adding random pieces ahead of the cube. Harder pieces join in as you go.
      const w = this.w, d = x / T < 250 ? 1 : x / T < 700 ? 2 : 3;
      const names = Object.keys(PARTS).filter((n) => PARTS[n][0] <= d && n !== 'run');
      while (w.end < x / T + 40) {
        let n = names[Math.floor(rand(0, names.length))];
        if (n === this.lastPart) n = 'run';
        this.lastPart = n; addPart(w, n);
      }
    },

    /* ---------- Input ---------- */
    jump(down) {
      if (this.mode !== 'play') return;
      if (down && !this.hold && this.p) this.p.buf = 0.12; // A tap just before landing still jumps.
      this.hold = down;
    },
    key(e, down) {
      const jumpKey = ['Space', 'ArrowUp', 'KeyW'].includes(e.code);
      if (!down) { if (jumpKey) this.jump(false); return; }
      if (e.repeat) return;
      if (this.mode === 'menu') {
        if (e.code === 'ArrowDown' || e.code === 'KeyS') this.sel = (this.sel + 1) % 4;
        else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.sel = (this.sel + 3) % 4;
        else if (e.code === 'Space' || e.code === 'Enter') this.start(this.sel);
        else if (/^Digit[1-4]$/.test(e.code)) this.start(Number(e.code[5]) - 1);
        return;
      }
      if (e.code === 'KeyM') { this.again = null; this.reset(); return; }
      if (this.mode === 'done') {
        if (e.code === 'Space' || e.code === 'Enter') this.next();
        return;
      }
      if (jumpKey) this.jump(true);
    },
    press(down) { this.jump(down); },
    point(q) { this.ptr = q; },
    tap() {
      const q = this.ptr; if (!q) return;
      const inside = (b) => q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h;
      if (this.mode === 'menu') {
        for (let i = 0; i < 4; i++) if (inside(this.button(i))) { this.sel = i; this.start(i); return; }
      } else if (inside(MENU)) { this.reset(); }
      else if (this.mode === 'done') {
        if (inside(this.doneBtn(0))) this.next();
        else if (inside(this.doneBtn(1))) this.reset();
      }
    },
    button(i) { return { x: BTN.x, y: BTN.y0 + i * (BTN.h + BTN.gap), w: BTN.w, h: BTN.h }; },
    doneBtn(i) { return { x: i ? 290 : 110, y: 220, w: 160, h: 40 }; },
    next() { this.start(this.lvl < 2 ? this.lvl + 1 : ENDLESS); },

    /* ---------- Update ---------- */
    update(dt) {
      this.t += dt;
      if (this.flash > 0) this.flash -= dt;
      for (const b of this.bits || []) { b.x += b.vx * dt; b.y += b.vy * dt; b.vy -= 900 * dt; b.life -= dt; b.a += b.va * dt; }
      if (this.bits) this.bits = this.bits.filter((b) => b.life > 0);
      if (this.mode === 'menu') { this.scroll += 120 * dt; return; }
      if (this.mode === 'done') { this.p.x += this.p.speed * dt; return; }
      if (this.mode === 'dead') {
        this.dieT -= dt;
        if (this.dieT <= 0) {
          if (this.lvl === ENDLESS) { this.again = ENDLESS; this.mode = 'over'; over(this.score, 'You got ' + this.score + ' m in Endless.'); }
          else this.run();
        }
        return;
      }
      if (this.mode !== 'play') return;
      const p = this.p;
      if (this.lvl === ENDLESS) {
        p.speed = Math.min(300 + p.x / T * 0.12, 470);
        this.fill(p.x);
        const z = Math.floor(p.x / T / 200);
        if (z !== this.zone) { this.zone = z; this.th = THEMES[(3 + z) % THEMES.length]; this.flash = 0.4; sfx.win(); }
      }
      p.jumped = p.landed = p.padded = p.ringed = false;
      step(p, this.w, dt, this.hold);
      if (p.jumped) sfx.hop();
      if (p.padded || p.ringed) sfx.tone(p.padded ? 520 : 700, 0.15, 'square', 0.04, 1200);
      if (p.landed) this.dust(p.x + T / 2, p.h, 5);
      // Spin in the air, then settle flat on landing.
      if (p.ground) { const q = Math.PI / 2, to = Math.round(this.ang / q) * q; this.ang += (to - this.ang) * Math.min(1, dt * 30); }
      else this.ang += SPIN * dt;
      this.cam += (Math.max(0, p.h - 150) - this.cam) * Math.min(1, dt * 6);
      this.trailT += dt;
      if (this.trailT > 1 / 40) { this.trailT = 0; this.trail.push({ x: p.x, h: p.h, a: this.ang }); if (this.trail.length > 8) this.trail.shift(); }

      if (p.dead) return this.crash();
      const score = this.lvl === ENDLESS ? Math.floor(p.x / T) : Math.min(99, Math.floor(p.x / this.w.finish * 100));
      if (score !== this.score) { this.score = score; setScore(score); }
      if (p.x >= this.w.finish) this.win();
    },
    crash() {
      const p = this.p;
      this.mode = 'dead'; this.trail = []; this.dieT = this.lvl === ENDLESS ? 0.7 : 0.9; this.hold = false;
      sfx.lose();
      for (let i = 0; i < 18; i++) {
        const a = rand(0, Math.PI * 2), s = rand(120, 380);
        this.bits.push({ x: p.x + T / 2, y: p.h + T / 2, vx: Math.cos(a) * s, vy: Math.sin(a) * s + 150, life: rand(0.5, 0.9), a: 0, va: rand(-10, 10), size: rand(4, 9), c: i % 3 ? '#ffd23f' : this.th.main });
      }
      if (this.lvl !== ENDLESS) {
        const k = 'cube-' + (this.lvl + 1), b = store.get(k);
        if (b === null || this.score > b) store.set(k, this.score);
      }
    },
    win() {
      this.mode = 'done'; this.score = 100; setScore(100); this.hold = false;
      store.set('cube-' + (this.lvl + 1), 100);
      sfx.win();
      for (let i = 0; i < 40; i++) this.bits.push({ x: this.p.x + rand(-40, 200), y: rand(40, 260), vx: rand(-80, 80), vy: rand(100, 400), life: rand(0.8, 1.6), a: 0, va: rand(-8, 8), size: rand(4, 8), c: [C.amber, C.cyan, C.pink, C.lime][i % 4] });
    },
    dust(x, h, n) {
      for (let i = 0; i < n; i++) this.bits.push({ x: x + rand(-14, 14), y: h + 2, vx: rand(-90, 30), vy: rand(40, 140), life: rand(0.2, 0.4), a: 0, va: 0, size: rand(2, 4), c: this.th.main });
    },

    /* ---------- Drawing ---------- */
    draw() {
      const { W, H } = this, th = this.th;
      const camX = this.p ? this.p.x - PX : this.scroll, cam = this.cam || 0;
      const sy = (h) => GY - h + cam; // Height above the ground -> screen y.
      // Sky with a soft pulse to the beat.
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, th.sky); g.addColorStop(1, th.bg);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const beat = Math.pow(1 - ((this.t * 2) % 1), 3);
      // Far squares drifting slowly behind everything.
      ctx.strokeStyle = th.glow + (0.08 + beat * 0.06) + ')'; ctx.lineWidth = 2;
      for (let i = 0; i < 9; i++) {
        const s = 40 + (i % 3) * 26, x = ((i * 97 - camX * 0.15) % (W + 140) + W + 140) % (W + 140) - 100, y = 30 + ((i * 53) % 170) + cam * 0.3;
        ctx.save(); ctx.translate(x, y); ctx.rotate(i + this.t * 0.2 * (i % 2 ? 1 : -1)); ctx.strokeRect(-s / 2, -s / 2, s, s); ctx.restore();
      }
      // Grid lines that move faster, so the ground feels quick.
      ctx.strokeStyle = th.glow + '0.07)'; ctx.lineWidth = 1;
      for (let x = -((camX * 0.5) % 60); x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, sy(0)); ctx.stroke(); }
      for (let y = sy(0) - 60; y > -60; y -= 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

      if (this.mode === 'menu') { this.drawGround(camX, sy); this.drawMenu(); return; }

      // Level things in view.
      const w = this.w, c0 = Math.floor(camX / T) - 1, c1 = Math.ceil((camX + W) / T) + 1;
      for (let c = Math.max(0, c0); c <= c1; c++) {
        for (const o of w.cols[c] || []) this.drawThing(o, c * T - camX, sy(o.r * T) - T, th, this.p.used.includes(c * 16 + o.r));
      }
      // Finish gate.
      if (w.finish < Infinity && w.finish - camX < W + 40) {
        const x = w.finish - camX + T;
        ctx.fillStyle = th.glow + (0.25 + beat * 0.2) + ')'; ctx.fillRect(x - 10, 0, 34, sy(0));
        ctx.fillStyle = C.ink; ctx.fillRect(x, 0, 6, sy(0));
        for (let y = 0; y < sy(0); y += 24) { ctx.fillStyle = (y / 24) % 2 ? C.ink : '#111'; ctx.fillRect(x + 6, y, 10, 12); ctx.fillStyle = (y / 24) % 2 ? '#111' : C.ink; ctx.fillRect(x + 6, y + 12, 10, 12); }
      }
      this.drawGround(camX, sy);
      // "Attempt 3" floats at the start of a level, like a sign.
      if (this.lvl !== ENDLESS) {
        ctx.fillStyle = 'rgba(244,236,220,.85)'; ctx.font = font(14); ctx.textAlign = 'center';
        ctx.fillText('ATTEMPT ' + this.attempts, 260 - camX, sy(0) - 150);
      }

      const p = this.p;
      // Trail.
      this.trail.forEach((q, i) => {
        const a = (i + 1) / this.trail.length * 0.35, s = 10 + i * 1.5;
        ctx.fillStyle = th.glow + a + ')'; ctx.fillRect(q.x - camX + 15 - s / 2 - (this.trail.length - i) * 2, sy(q.h) - 15 - s / 2, s, s);
      });
      if (this.mode !== 'dead' && this.mode !== 'over') this.drawCube(PX + (p.x - camX - PX) + T / 2, sy(p.h) - T / 2, this.ang, th);
      for (const b of this.bits) {
        ctx.globalAlpha = clamp(b.life * 2, 0, 1); ctx.fillStyle = b.c;
        ctx.save(); ctx.translate(b.x - camX, sy(b.y)); ctx.rotate(b.a); ctx.fillRect(-b.size / 2, -b.size / 2, b.size, b.size); ctx.restore();
      }
      ctx.globalAlpha = 1;
      if (this.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + this.flash * 0.6 + ')'; ctx.fillRect(0, 0, W, H); }

      // Top bar: back button, progress bar (levels) or distance (endless).
      this.drawMenuBtn();
      ctx.textAlign = 'center';
      if (this.lvl === ENDLESS) {
        ctx.font = font(12); ctx.fillStyle = C.ink; ctx.fillText(this.score + ' m', W / 2, 28);
        const best = store.get('cube'); if (best) { ctx.font = font(8); ctx.fillStyle = C.muted; ctx.fillText('BEST ' + best + ' m', W / 2, 44); }
      } else {
        const bw = 240, bx = (W - bw) / 2, pct = this.score / 100;
        ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(bx, 14, bw, 12);
        ctx.fillStyle = th.main; ctx.fillRect(bx + 2, 16, (bw - 4) * pct, 8);
        const best = this.best(this.lvl); if (best) { ctx.fillStyle = C.ink; ctx.fillRect(bx + 2 + (bw - 4) * best / 100 - 1, 12, 2, 16); }
        ctx.font = font(10); ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.fillText(this.score + '%', bx + bw + 10, 26);
      }
      if (this.mode === 'dead' && this.lvl !== ENDLESS) {
        ctx.textAlign = 'center'; ctx.font = font(18); ctx.fillStyle = C.ink; ctx.fillText(this.score + '%', W / 2, 130);
      }
      if (this.mode === 'done') this.drawDone();
    },
    drawGround(camX, sy) {
      const th = this.th, y = sy(0), { W, H } = this;
      ctx.fillStyle = th.dark; ctx.fillRect(0, y, W, H - y);
      ctx.strokeStyle = th.glow + '0.25)'; ctx.lineWidth = 2;
      for (let x = -(camX % 60); x < W; x += 60) ctx.strokeRect(x + 1, y + 4, 58, 56);
      ctx.fillStyle = th.glow + '0.35)'; ctx.fillRect(0, y - 2, W, 6);
      ctx.fillStyle = C.ink; ctx.fillRect(0, y, W, 2);
    },
    drawThing(o, x, y, th, used) {
      if (o.k === '#') {
        ctx.fillStyle = th.dark; ctx.fillRect(x, y, T, T);
        ctx.strokeStyle = th.main; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, T - 2, T - 2);
        ctx.strokeStyle = th.glow + '0.35)'; ctx.strokeRect(x + 7, y + 7, T - 14, T - 14);
      } else if (o.k === '^' || o.k === 'v') {
        const up = o.k === '^', b = up ? y + T : y, tip = up ? y + 3 : y + T - 3;
        ctx.beginPath(); ctx.moveTo(x + 3, b); ctx.lineTo(x + T / 2, tip); ctx.lineTo(x + T - 3, b); ctx.closePath();
        ctx.fillStyle = '#0a0812'; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 10, up ? b - 4 : b + 4); ctx.lineTo(x + T / 2, up ? tip + 9 : tip - 9); ctx.lineTo(x + T - 10, up ? b - 4 : b + 4); ctx.closePath();
        ctx.fillStyle = th.glow + '0.5)'; ctx.fill();
      } else if (o.k === '_') {
        ctx.fillStyle = 'rgba(255,210,63,.25)'; ctx.fillRect(x + 2, y + T - 22, T - 4, 16);
        ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.ellipse(x + T / 2, y + T - 2, 13, 6, 0, Math.PI, 0); ctx.fill();
      } else if (o.k === 'o') {
        const s = 1 + Math.sin(this.t * 8) * 0.12, cx = x + T / 2, cy = y + T / 2;
        ctx.strokeStyle = used ? 'rgba(255,210,63,.3)' : 'rgba(255,210,63,.45)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, 16 * s, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = used ? 'rgba(255,210,63,.3)' : '#ffd23f'; ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(cx - 3, cy - 3, 3, 0, Math.PI * 2); ctx.fill();
      }
    },
    drawCube(x, y, a, th) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = th.glow + '0.3)'; ctx.fillRect(-19, -19, 38, 38);
      ctx.fillStyle = '#ffd23f'; ctx.fillRect(-15, -15, 30, 30);
      ctx.fillStyle = '#0a0812'; ctx.fillRect(-11, -11, 22, 22);
      ctx.fillStyle = th.main; ctx.fillRect(-8, -8, 16, 16);
      ctx.fillStyle = '#0a0812'; ctx.fillRect(-5, -4, 4, 4); ctx.fillRect(2, -4, 4, 4); ctx.fillRect(-5, 3, 11, 2);
      ctx.restore();
    },
    drawMenuBtn() {
      const b = MENU;
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = C.muted; ctx.lineWidth = 2; ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      ctx.fillStyle = C.ink; for (let i = 0; i < 3; i++) ctx.fillRect(b.x + 9, b.y + 7 + i * 5, 16, 2);
    },
    drawMenu() {
      const { W } = this;
      ctx.textAlign = 'center';
      ctx.font = font(26); ctx.fillStyle = '#3a1450'; ctx.fillText('CUBE RUSH', W / 2 + 3, 51);
      ctx.fillStyle = '#ffd23f'; ctx.fillText('CUBE RUSH', W / 2, 48);
      this.drawCube(W / 2 - 200, 40 - Math.abs(Math.sin(this.t * 4)) * 14, this.t * 4, this.th);
      this.drawCube(W / 2 + 200, 40 - Math.abs(Math.cos(this.t * 4)) * 14, -this.t * 4, this.th);
      ctx.font = font(8); ctx.fillStyle = C.muted; ctx.fillText('PICK A LEVEL', W / 2, 74);
      const hover = this.ptr;
      for (let i = 0; i < 4; i++) {
        const b = this.button(i), th = THEMES[i === ENDLESS ? 3 : LEVELS[i].theme];
        const on = i === this.sel || (hover && hover.x >= b.x && hover.x <= b.x + b.w && hover.y >= b.y && hover.y <= b.y + b.h);
        ctx.fillStyle = on ? th.dark : 'rgba(0,0,0,.5)'; ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = on ? th.main : '#3a3052'; ctx.lineWidth = 2; ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
        ctx.fillStyle = th.main; ctx.fillRect(b.x + 12, b.y + 11, 20, 20);
        ctx.fillStyle = '#0a0812'; ctx.fillRect(b.x + 16, b.y + 15, 12, 12);
        ctx.textAlign = 'left'; ctx.font = font(11); ctx.fillStyle = C.ink;
        ctx.fillText(i === ENDLESS ? 'ENDLESS' : LEVELS[i].name, b.x + 44, b.y + 20);
        ctx.font = font(7); ctx.fillStyle = th.main;
        ctx.fillText(i === ENDLESS ? 'Gets harder and harder' : LEVELS[i].tag, b.x + 44, b.y + 33);
        const best = i === ENDLESS ? store.get('cube') : this.best(i);
        ctx.textAlign = 'right'; ctx.font = font(9);
        ctx.fillStyle = best === 100 ? C.lime : C.muted;
        ctx.fillText(best === null ? '—' : i === ENDLESS ? best + ' m' : best === 100 ? '★ 100%' : best + '%', b.x + b.w - 12, b.y + 26);
      }
    },
    drawDone() {
      const { W } = this;
      ctx.fillStyle = 'rgba(10,8,18,.7)'; ctx.fillRect(90, 90, W - 180, 190);
      ctx.strokeStyle = this.th.main; ctx.lineWidth = 2; ctx.strokeRect(91, 91, W - 182, 188);
      ctx.textAlign = 'center'; ctx.font = font(16); ctx.fillStyle = '#ffd23f';
      ctx.fillText('LEVEL COMPLETE!', W / 2, 140);
      ctx.font = font(9); ctx.fillStyle = C.ink;
      ctx.fillText(this.attempts === 1 ? 'First try!' : 'Attempts: ' + this.attempts, W / 2, 175);
      ['NEXT', 'LEVELS'].forEach((label, i) => {
        const b = this.doneBtn(i);
        ctx.fillStyle = i ? 'rgba(0,0,0,.5)' : this.th.dark; ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = i ? C.muted : this.th.main; ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
        ctx.fillStyle = C.ink; ctx.font = font(10);
        ctx.fillText(i ? label : this.lvl < 2 ? 'NEXT LEVEL' : 'ENDLESS', b.x + b.w / 2, b.y + 25);
      });
    },
  };

  Arcade.register('cube', cube);
})();
