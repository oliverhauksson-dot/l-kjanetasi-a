/* Tower Defense. Loaded on demand by js/arcade.js the first time the game is opened.
   Monsters walk along a winding path to the castle. Build towers on the grass to stop them.
   10 monsters getting through ends the game. The waves never stop and get harder each time. */
(() => {
  const { ctx, C, cached, clamp, sfx, setScore, over, font } = Arcade;

  const CELL = 40, COLS = 12, ROWS = 10, MAP_H = ROWS * CELL; // The map is 480 x 400. The buttons sit under it.
  const LIVES = 10;

  // The path, as grid cells it turns at. It starts just off the left edge and ends at the castle.
  const TURNS = [[-1, 2], [3, 2], [3, 7], [6, 7], [6, 1], [10, 1], [10, 5], [8, 5], [8, 8], [11, 8]];
  const PTS = TURNS.map(([c, r]) => ({ x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 }));
  const SEG = []; // Each straight piece of path with its length and the distance along the path where it starts.
  let LEN = 0;
  for (let i = 1; i < PTS.length; i++) {
    const a = PTS[i - 1], b = PTS[i], len = Math.hypot(b.x - a.x, b.y - a.y);
    SEG.push({ a, b, len, at: LEN }); LEN += len;
  }
  const ROAD = new Set(); // Cells on the path (nothing can be built there).
  for (let i = 1; i < TURNS.length; i++) {
    const [c0, r0] = TURNS[i - 1], [c1, r1] = TURNS[i];
    for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) ROAD.add(c + ',' + r);
  }
  const CASTLE = { c: 11, r: 8 };
  function along(d) { // The point that is d pixels along the path.
    d = clamp(d, 0, LEN);
    let s = SEG[0];
    for (const g of SEG) { if (d >= g.at) s = g; else break; }
    const t = s.len ? (d - s.at) / s.len : 0;
    return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t, dx: Math.sign(s.b.x - s.a.x), dy: Math.sign(s.b.y - s.a.y) };
  }

  /* ---------- Towers ---------- */
  const TOWERS = [
    { id: 'arrow', name: 'ARROW', cost: 50, range: 100, rate: 0.5, dmg: 10, color: '#b8e65c', key: 'Digit1' },
    { id: 'cannon', name: 'CANNON', cost: 80, range: 92, rate: 1.4, dmg: 26, splash: 38, color: '#ffb347', key: 'Digit2' },
    { id: 'ice', name: 'ICE', cost: 60, range: 86, rate: 0.9, dmg: 4, color: '#5ce1e6', key: 'Digit3' },
    { id: 'zap', name: 'ZAP', cost: 150, range: 110, rate: 1.2, dmg: 22, color: '#a78bfa', key: 'Digit4' },
  ];
  const MAX_LV = 3;
  const stat = (t) => { // A tower's numbers at its level.
    const k = TOWERS[t.type], lv = t.lv - 1;
    return {
      range: k.range * (1 + 0.12 * lv), rate: k.rate * (1 - 0.12 * lv), dmg: k.dmg * (1 + 0.65 * lv),
      splash: (k.splash || 0) + 6 * lv, slow: 0.35 + 0.1 * lv, chain: 3 + lv,
    };
  };
  const upCost = (t) => Math.round(TOWERS[t.type].cost * 0.75 * t.lv);
  const sellValue = (t) => Math.floor(t.spent * 0.7);

  /* ---------- Monsters ---------- */
  const KINDS = {
    slime: { hp: 28, speed: 42, reward: 4, r: 11, armor: 0, leak: 1 },
    bat: { hp: 16, speed: 85, reward: 4, r: 10, armor: 0, leak: 1 },
    knight: { hp: 80, speed: 30, reward: 9, r: 12, armor: 3, leak: 1 },
    boss: { hp: 700, speed: 24, reward: 80, r: 20, armor: 5, leak: 5 },
  };
  const hpMul = (w) => 1 + (w - 1) * 0.22 + (w - 1) * (w - 1) * 0.01;
  const coinMul = (w) => 1 + (w - 1) * 0.08;

  // The list of monsters for a wave, with the wait before each one.
  function waveList(w) {
    const list = [], gap = Math.max(0.35, 0.9 - w * 0.015);
    const n = 5 + Math.floor(w * 1.6);
    if (w % 10 === 0) {
      for (let i = 0; i < w / 10; i++) list.push({ kind: 'boss', wait: 2 });
      for (let i = 0; i < Math.floor(n / 2); i++) list.push({ kind: Math.random() < 0.5 ? 'slime' : 'bat', wait: gap });
      return list;
    }
    for (let i = 0; i < n; i++) {
      let kind = 'slime';
      if (w === 3) kind = 'bat';
      else if (w === 5) kind = i % 2 ? 'knight' : 'slime';
      else {
        const r = Math.random();
        if (w >= 5 && r < 0.18 + Math.min(w, 40) * 0.006) kind = 'knight';
        else if (w >= 3 && r < 0.5) kind = 'bat';
      }
      list.push({ kind, wait: kind === 'bat' ? gap * 0.6 : gap });
    }
    return list;
  }
  const BANNERS = { 1: 'HERE THEY COME!', 3: 'BATS! THEY ARE FAST', 5: 'KNIGHTS! THEY ARE TOUGH' };

  /* ---------- Buttons under the map ---------- */
  const HUD_Y = 404, BTN_Y = 434, BTN_H = 60, ROW_Y = 502;
  const towerBtn = (i) => ({ x: 6 + i * 80, y: BTN_Y, w: 74, h: BTN_H });
  const GO_BTN = { x: 328, y: BTN_Y, w: 146, h: BTN_H };
  const UP_BTN = { x: 196, y: ROW_Y, w: 136, h: 32 };
  const SELL_BTN = { x: 338, y: ROW_Y, w: 136, h: 32 };
  const inside = (p, b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

  const tower = {
    W: COLS * CELL, H: 540, color: 'var(--amber)', title: 'Tower Defense', label: 'Score',
    quietScore: true, // Every monster gives points, so they get their own pop instead of a beep each.
    hint: '<kbd>1</kbd>-<kbd>4</kbd> pick a tower, click the grass to build, click a tower to upgrade or sell. <kbd>Space</kbd> next wave. On a phone: tap. <kbd>P</kbd> to pause',
    reset() {
      this.t = 0; this.score = 0; this.coins = 120; this.lives = LIVES; this.wave = 0;
      this.towers = []; this.foes = []; this.shots = []; this.bolts = []; this.bits = []; this.pops = [];
      this.pick = 0; this.sel = null; this.hover = null; this.fast = false; this.hurt = 0;
      this.state = 'build'; this.timer = 20; this.queue = []; this.spawnIn = 0;
      this.banner = 'BUILD TOWERS NEXT TO THE PATH'; this.bannerT = 4;
    },

    /* ---------- Input ---------- */
    key(e, down) {
      if (!down) return;
      const i = TOWERS.findIndex((k) => k.key === e.code || 'Numpad' + k.key.slice(5) === e.code);
      if (i >= 0) { this.pick = i; this.sel = null; return; }
      if (e.code === 'Space' && !e.repeat) this.goButton();
      if (e.code === 'KeyU' && this.sel) this.upgrade();
      if ((e.code === 'KeyX' || e.code === 'Delete' || e.code === 'Backspace') && this.sel) this.sell();
    },
    point(p) { this.hover = p; },
    tap() {
      const p = this.hover; if (!p) return;
      if (p.y < MAP_H) return this.tapMap(p);
      for (let i = 0; i < TOWERS.length; i++) if (inside(p, towerBtn(i))) { this.pick = i; this.sel = null; sfx.tone(660, 0.05, 'square', 0.03); return; }
      if (inside(p, GO_BTN)) return this.goButton();
      if (this.sel && inside(p, UP_BTN)) return this.upgrade();
      if (this.sel && inside(p, SELL_BTN)) return this.sell();
    },
    tapMap(p) {
      const c = Math.floor(p.x / CELL), r = Math.floor(p.y / CELL);
      const there = this.towers.find((t) => t.c === c && t.r === r);
      if (there) { this.sel = this.sel === there ? null : there; return; }
      if (this.sel) { this.sel = null; return; } // A tap next to a picked tower just lets go of it.
      if (!this.canBuild(c, r)) { sfx.tone(140, 0.08, 'square', 0.03); return; }
      const k = TOWERS[this.pick];
      if (this.coins < k.cost) { this.say('NOT ENOUGH COINS'); sfx.tone(140, 0.08, 'square', 0.03); return; }
      this.coins -= k.cost;
      this.towers.push({ type: this.pick, c, r, x: c * CELL + CELL / 2, y: r * CELL + CELL / 2, lv: 1, spent: k.cost, cool: 0, aim: 0, kick: 0 });
      this.puff(c * CELL + CELL / 2, r * CELL + CELL / 2, '#d8c79a', 10);
      sfx.tone(392, 0.08, 'square', 0.04, 784);
    },
    canBuild(c, r) {
      return c >= 0 && c < COLS && r >= 0 && r < ROWS && !ROAD.has(c + ',' + r)
        && !(c === CASTLE.c && Math.abs(r - CASTLE.r) <= 1) && !this.towers.some((t) => t.c === c && t.r === r);
    },
    goButton() {
      if (this.state === 'build') {
        const bonus = Math.floor(this.timer) * 2;
        if (bonus > 0) { this.coins += bonus; this.float(GO_BTN.x + GO_BTN.w / 2, GO_BTN.y - 4, '+' + bonus, C.amber); }
        this.startWave();
      } else { this.fast = !this.fast; sfx.tone(this.fast ? 880 : 520, 0.06, 'square', 0.03); }
    },
    upgrade() {
      const t = this.sel; if (!t) return;
      if (t.lv >= MAX_LV) { this.say('THAT TOWER IS MAXED'); return; }
      const cost = upCost(t);
      if (this.coins < cost) { this.say('NOT ENOUGH COINS'); sfx.tone(140, 0.08, 'square', 0.03); return; }
      this.coins -= cost; t.spent += cost; t.lv++;
      this.puff(t.x, t.y, TOWERS[t.type].color, 14);
      [523, 659, 784].forEach((f, i) => setTimeout(() => sfx.tone(f, 0.07, 'square', 0.03), i * 60));
    },
    sell() {
      const t = this.sel; if (!t) return;
      const v = sellValue(t);
      this.coins += v; this.float(t.x, t.y - 10, '+' + v, C.amber);
      this.towers = this.towers.filter((o) => o !== t); this.sel = null;
      this.puff(t.x, t.y, '#8a7a5a', 12);
      sfx.tone(600, 0.1, 'triangle', 0.05, 300);
    },

    /* ---------- Waves ---------- */
    startWave() {
      this.wave++; this.state = 'wave'; this.queue = waveList(this.wave); this.spawnIn = 0.4;
      const b = this.wave % 10 === 0 ? 'BOSS WAVE!' : BANNERS[this.wave];
      this.say(b || 'WAVE ' + this.wave);
      sfx.tone(this.wave % 10 === 0 ? 160 : 330, 0.25, 'sawtooth', 0.04, this.wave % 10 === 0 ? 80 : 440);
    },
    endWave() {
      const bonus = 15 + this.wave * 3;
      this.coins += bonus; this.score += this.wave * 10; setScore(this.score);
      this.state = 'build'; this.timer = 12;
      this.say('WAVE ' + this.wave + ' DONE  +' + bonus + ' COINS');
      sfx.win();
    },
    spawn(kind) {
      const k = KINDS[kind], hp = Math.round(k.hp * hpMul(this.wave));
      this.foes.push({ kind, hp, max: hp, speed: k.speed * (1 + Math.min(this.wave, 40) * 0.005), d: 0, r: k.r, armor: k.armor, leak: k.leak,
        reward: Math.round(k.reward * coinMul(this.wave)), slow: 0, slowF: 0, hit: 0, x: PTS[0].x, y: PTS[0].y, dx: 1, dy: 0, wob: Math.random() * 6 });
    },
    say(text) { this.banner = text; this.bannerT = 2.2; },
    float(x, y, text, color) { this.pops.push({ x, y, text, color, t: 0 }); },
    puff(x, y, color, n) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = 30 + Math.random() * 90;
        this.bits.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.3, color });
      }
    },

    /* ---------- Fighting ---------- */
    damage(e, amount) {
      if (e.hp <= 0) return;
      e.hp -= Math.max(1, amount - e.armor); e.hit = 0.08;
      if (e.hp > 0) return;
      this.coins += e.reward; this.score += e.reward; setScore(this.score);
      this.float(e.x, e.y - e.r, '+' + e.reward, C.amber);
      this.puff(e.x, e.y, e.kind === 'slime' ? '#b8e65c' : e.kind === 'bat' ? '#ff6b9a' : e.kind === 'knight' ? '#c7cbe0' : '#a78bfa', e.kind === 'boss' ? 30 : 10);
      sfx.tone(e.kind === 'boss' ? 200 : 520, e.kind === 'boss' ? 0.4 : 0.06, 'square', 0.04, e.kind === 'boss' ? 60 : 900);
    },
    target(t, s) { // The monster furthest along the path that the tower can reach.
      let best = null;
      for (const e of this.foes) if (e.hp > 0 && Math.hypot(e.x - t.x, e.y - t.y) <= s.range + e.r * 0.5 && (!best || e.d > best.d)) best = e;
      return best;
    },
    fire(t, e, s) {
      const k = TOWERS[t.type];
      t.aim = Math.atan2(e.y - t.y, e.x - t.x); t.kick = 0.12;
      if (k.id === 'arrow') { this.shots.push({ kind: 'arrow', x: t.x, y: t.y, foe: e, speed: 440, dmg: s.dmg }); sfx.tone(1400, 0.03, 'triangle', 0.015, 900); }
      else if (k.id === 'ice') { this.shots.push({ kind: 'ice', x: t.x, y: t.y, foe: e, speed: 320, dmg: s.dmg, slow: s.slow }); sfx.tone(1800, 0.05, 'sine', 0.02, 1200); }
      else if (k.id === 'cannon') {
        const tx = e.x, ty = e.y, dist = Math.hypot(tx - t.x, ty - t.y);
        this.shots.push({ kind: 'ball', x: t.x, y: t.y, sx: t.x, sy: t.y, tx, ty, t: 0, dur: Math.max(0.25, dist / 260), dmg: s.dmg, splash: s.splash });
        sfx.tone(120, 0.12, 'square', 0.04, 60);
      } else { // Zap: lightning jumps from monster to monster.
        const hit = [e]; let at = e;
        while (hit.length < s.chain) {
          let next = null, nd = 75;
          for (const o of this.foes) { const d = Math.hypot(o.x - at.x, o.y - at.y); if (o.hp > 0 && !hit.includes(o) && d < nd) { next = o; nd = d; } }
          if (!next) break;
          hit.push(next); at = next;
        }
        const pts = [{ x: t.x, y: t.y - 12 }].concat(hit.map((o) => ({ x: o.x, y: o.y })));
        this.bolts.push({ pts, life: 0.15 });
        hit.forEach((o, i) => this.damage(o, s.dmg * Math.pow(0.8, i)));
        sfx.tone(900, 0.1, 'sawtooth', 0.03, 200);
      }
    },

    update(dt) {
      if (this.fast) dt *= 2;
      this.t += dt;
      if (this.bannerT > 0) this.bannerT -= dt;
      if (this.hurt > 0) this.hurt -= dt;

      if (this.state === 'build') {
        this.timer -= dt;
        if (this.timer <= 0) { this.timer = 0; this.startWave(); }
      } else if (this.queue.length) {
        this.spawnIn -= dt;
        if (this.spawnIn <= 0) { const next = this.queue.shift(); this.spawn(next.kind); this.spawnIn = this.queue.length ? this.queue[0].wait : 0; }
      }

      for (const e of this.foes) {
        if (e.hp <= 0) continue;
        if (e.slow > 0) e.slow -= dt;
        if (e.hit > 0) e.hit -= dt;
        const slow = e.slow > 0 ? e.slowF * (e.kind === 'boss' ? 0.5 : 1) : 0;
        e.d += e.speed * (1 - slow) * dt;
        const p = along(e.d); e.x = p.x; e.y = p.y; e.dx = p.dx; e.dy = p.dy;
        if (e.d >= LEN) {
          e.hp = 0; e.leaked = true;
          this.lives = Math.max(0, this.lives - e.leak); this.hurt = 0.4;
          sfx.hit(); sfx.tone(200, 0.2, 'sawtooth', 0.05, 90);
          if (this.lives <= 0) {
            this.foes = this.foes.filter((o) => o.hp > 0);
            return over(this.score, 'The monsters broke into your castle on wave ' + this.wave + '. Score ' + this.score + '.');
          }
        }
      }

      for (const t of this.towers) {
        if (t.kick > 0) t.kick -= dt;
        t.cool -= dt;
        if (t.cool > 0) continue;
        const s = stat(t), e = this.target(t, s);
        if (e) { this.fire(t, e, s); t.cool = s.rate; }
      }

      for (const s of this.shots) {
        if (s.kind === 'ball') {
          s.t += dt; const k = Math.min(1, s.t / s.dur);
          s.x = s.sx + (s.tx - s.sx) * k; s.y = s.sy + (s.ty - s.sy) * k - Math.sin(k * Math.PI) * 30;
          if (k >= 1) {
            s.done = true;
            for (const e of this.foes) if (e.hp > 0 && Math.hypot(e.x - s.tx, e.y - s.ty) <= s.splash + e.r) this.damage(e, s.dmg);
            this.puff(s.tx, s.ty, '#ffb347', 12); this.bits.push({ x: s.tx, y: s.ty, ring: s.splash, life: 0.25, max: 0.25, color: '#ffd27a' });
            sfx.tone(90, 0.15, 'triangle', 0.06, 40);
          }
          continue;
        }
        const e = s.foe;
        if (e.hp <= 0) { s.done = true; continue; } // Its monster is gone, so the shot just vanishes.
        const dx = e.x - s.x, dy = e.y - s.y, d = Math.hypot(dx, dy), step = s.speed * dt;
        s.a = Math.atan2(dy, dx);
        if (d <= step + e.r * 0.5) {
          s.done = true; this.damage(e, s.dmg);
          if (s.kind === 'ice') { e.slowF = e.slow > 0 ? Math.max(e.slowF, s.slow) : s.slow; e.slow = 1.6; this.puff(e.x, e.y, '#bff6ff', 4); }
        } else { s.x += dx / d * step; s.y += dy / d * step; }
      }
      this.shots = this.shots.filter((s) => !s.done);

      for (const b of this.bolts) b.life -= dt;
      this.bolts = this.bolts.filter((b) => b.life > 0);
      for (const b of this.bits) { b.life -= dt; if (!b.ring) { b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.92; b.vy *= 0.92; } }
      this.bits = this.bits.filter((b) => b.life > 0);
      for (const p of this.pops) p.t += dt;
      this.pops = this.pops.filter((p) => p.t < 0.9);

      this.foes = this.foes.filter((e) => e.hp > 0);
      if (this.state === 'wave' && !this.queue.length && !this.foes.length) this.endWave();
    },

    /* ---------- Drawing ---------- */
    drawMap(g) {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        g.fillStyle = (r + c) % 2 ? '#2f6b3a' : '#2a6234'; g.fillRect(c * CELL, r * CELL, CELL, CELL);
      }
      // Grass tufts and flowers, in the same places every time.
      let s = 7;
      const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let i = 0; i < 90; i++) {
        const x = rnd() * this.W, y = rnd() * MAP_H, kind = rnd();
        if (ROAD.has(Math.floor(x / CELL) + ',' + Math.floor(y / CELL))) continue;
        if (kind < 0.7) { g.fillStyle = '#3f8a4a'; g.fillRect(x, y, 2, 4); g.fillRect(x + 3, y + 1, 2, 3); }
        else if (kind < 0.85) { g.fillStyle = '#ffd27a'; g.fillRect(x, y, 3, 3); }
        else { g.fillStyle = '#ff9ec0'; g.fillRect(x, y, 3, 3); }
      }
      // The dirt path, with a darker edge.
      g.lineCap = 'square'; g.lineJoin = 'miter';
      const road = (w, color) => {
        g.strokeStyle = color; g.lineWidth = w; g.beginPath();
        PTS.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
      };
      road(CELL, '#7a5a34'); road(CELL - 8, '#b88a52');
      g.fillStyle = '#a07644';
      for (let i = 0; i < 60; i++) { const p = along(rnd() * LEN); g.fillRect(p.x + (rnd() - 0.5) * 22, p.y + (rnd() - 0.5) * 22, 3, 2); }
      // The cave the monsters come out of.
      g.fillStyle = '#4a3d5e'; g.beginPath(); g.arc(4, PTS[0].y, 26, -Math.PI / 2, Math.PI / 2); g.fill();
      g.fillStyle = '#120d1c'; g.beginPath(); g.arc(0, PTS[0].y, 17, -Math.PI / 2, Math.PI / 2); g.fill();
      // The castle.
      const cx = CASTLE.c * CELL, cy = CASTLE.r * CELL;
      g.fillStyle = '#8f8aa8'; g.fillRect(cx + 2, cy - 22, 36, 58);
      g.fillStyle = '#b4afcc'; for (let i = 0; i < 4; i++) g.fillRect(cx + 2 + i * 10, cy - 30, 6, 8);
      g.fillStyle = '#6d688a'; g.fillRect(cx + 2, cy + 30, 36, 6);
      g.fillStyle = '#3a2a1a'; g.fillRect(cx + 12, cy + 10, 16, 20); g.beginPath(); g.arc(cx + 20, cy + 10, 8, Math.PI, 0); g.fill();
      g.fillStyle = '#120d1c'; g.fillRect(cx + 9, cy - 12, 5, 8); g.fillRect(cx + 26, cy - 12, 5, 8);
      g.fillStyle = '#f4ecdc'; g.fillRect(cx + 19, cy - 48, 2, 18);
      g.fillStyle = '#ff6b9a'; g.beginPath(); g.moveTo(cx + 21, cy - 48); g.lineTo(cx + 33, cy - 44); g.lineTo(cx + 21, cy - 40); g.fill();
    },
    drawTower(t, ghost, icon) {
      const k = TOWERS[t.type], x = t.x, y = t.y, kick = t.kick > 0 ? t.kick * 20 : 0, alpha = icon ? ctx.globalAlpha : 1;
      ctx.globalAlpha = ghost ? 0.55 : alpha;
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x, y + 14, 16, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6d688a'; ctx.fillRect(x - 14, y - 4, 28, 18);
      ctx.fillStyle = '#8f8aa8'; ctx.fillRect(x - 14, y - 4, 28, 4);
      if (k.id === 'arrow') {
        ctx.fillStyle = '#7a5a34'; ctx.fillRect(x - 10, y - 16, 20, 14);
        ctx.fillStyle = '#9c7444'; ctx.fillRect(x - 12, y - 20, 4, 4); ctx.fillRect(x - 2, y - 20, 4, 4); ctx.fillRect(x + 8, y - 20, 4, 4);
        ctx.save(); ctx.translate(x, y - 9); ctx.rotate(t.aim);
        ctx.strokeStyle = k.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(4 - kick, 0, 8, -1.2, 1.2); ctx.stroke();
        ctx.fillStyle = C.ink; ctx.fillRect(-4 - kick, -1, 14, 2); ctx.restore();
      } else if (k.id === 'cannon') {
        ctx.fillStyle = '#4a4560'; ctx.beginPath(); ctx.arc(x, y - 6, 11, 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.translate(x, y - 6); ctx.rotate(t.aim);
        ctx.fillStyle = '#2b2738'; ctx.fillRect(-2 - kick, -5, 18, 10); ctx.fillStyle = k.color; ctx.fillRect(13 - kick, -6, 4, 12); ctx.restore();
      } else if (k.id === 'ice') {
        ctx.fillStyle = '#bff6ff';
        ctx.beginPath(); ctx.moveTo(x, y - 26); ctx.lineTo(x + 9, y - 8); ctx.lineTo(x, y - 2); ctx.lineTo(x - 9, y - 8); ctx.fill();
        ctx.fillStyle = k.color; ctx.beginPath(); ctx.moveTo(x, y - 26); ctx.lineTo(x + 9, y - 8); ctx.lineTo(x, y - 10); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 3, y - 18, 2, 5);
      } else {
        ctx.fillStyle = '#4a3d5e'; ctx.fillRect(x - 4, y - 20, 8, 18);
        const glow = 0.6 + 0.4 * Math.sin(this.t * 8 + t.c);
        ctx.fillStyle = k.color; ctx.beginPath(); ctx.arc(x, y - 22, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(244,236,220,' + glow.toFixed(2) + ')'; ctx.beginPath(); ctx.arc(x, y - 22, 3, 0, Math.PI * 2); ctx.fill();
      }
      if (!icon) { ctx.fillStyle = k.color; for (let i = 0; i < t.lv; i++) ctx.fillRect(x - 10 + i * 8, y + 7, 5, 4); } // One mark per level.
      ctx.globalAlpha = 1;
    },
    drawFoe(e) {
      const x = e.x, y = e.y, flash = e.hit > 0, f = Math.floor(this.t * 8 + e.wob) % 2;
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x, y + e.r * 0.8, e.r, e.r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      if (e.kind === 'slime') {
        const sq = Math.sin(this.t * 10 + e.wob) * 2;
        ctx.fillStyle = flash ? '#ffffff' : '#8fd14f';
        ctx.beginPath(); ctx.ellipse(x, y + 2 - sq / 2, 11 + sq, 9 - sq, 0, Math.PI, 0); ctx.lineTo(x + 11 + sq, y + 6); ctx.lineTo(x - 11 - sq, y + 6); ctx.fill();
        ctx.fillStyle = '#e3ff9e'; ctx.fillRect(x - 6, y - 4 - sq / 2, 3, 3);
        ctx.fillStyle = C.bg; ctx.fillRect(x - 4 + e.dx * 2, y - 1, 3, 3); ctx.fillRect(x + 2 + e.dx * 2, y - 1, 3, 3);
      } else if (e.kind === 'bat') {
        const by = y - 6 + Math.sin(this.t * 12 + e.wob) * 3;
        ctx.fillStyle = flash ? '#ffffff' : '#5b3d78';
        if (f) { ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x - 14, by - 8); ctx.lineTo(x - 10, by + 3); ctx.lineTo(x + 10, by + 3); ctx.lineTo(x + 14, by - 8); ctx.fill(); }
        else { ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x - 15, by + 6); ctx.lineTo(x - 8, by + 2); ctx.lineTo(x + 8, by + 2); ctx.lineTo(x + 15, by + 6); ctx.fill(); }
        ctx.fillStyle = flash ? '#ffffff' : '#ff6b9a'; ctx.beginPath(); ctx.arc(x, by, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffd27a'; ctx.fillRect(x - 3, by - 2, 2, 2); ctx.fillRect(x + 1, by - 2, 2, 2);
      } else if (e.kind === 'knight') {
        ctx.fillStyle = flash ? '#ffffff' : '#c7cbe0'; ctx.fillRect(x - 8, y - 6, 16, 14);
        ctx.fillStyle = flash ? '#ffffff' : '#9aa0bc'; ctx.fillRect(x - 7, y - 16, 14, 11);
        ctx.fillStyle = C.bg; ctx.fillRect(x - 5, y - 12, 10, 2);
        ctx.fillStyle = '#ff6b9a'; ctx.fillRect(x - 1, y - 20, 3, 5);
        ctx.fillStyle = '#5ce1e6'; ctx.fillRect(x + (e.dx || 1) * 6 - 3, y - 4, 7, 10); // Shield
        ctx.fillStyle = '#3a3052'; ctx.fillRect(x - 6, y + 8, 5, 3 + f); ctx.fillRect(x + 1, y + 8, 5, 4 - f);
      } else {
        const bob = Math.sin(this.t * 4) * 2;
        ctx.fillStyle = flash ? '#ffffff' : '#7a4fc9'; ctx.fillRect(x - 18, y - 16 + bob, 36, 30);
        ctx.fillStyle = flash ? '#ffffff' : '#a78bfa'; ctx.fillRect(x - 14, y - 26 + bob, 28, 12);
        ctx.fillStyle = '#ffd27a'; ctx.fillRect(x - 14, y - 32 + bob, 4, 6); ctx.fillRect(x - 2, y - 34 + bob, 4, 8); ctx.fillRect(x + 10, y - 32 + bob, 4, 6); // Crown
        ctx.fillStyle = '#ff3b5c'; ctx.fillRect(x - 9, y - 22 + bob, 5, 4); ctx.fillRect(x + 4, y - 22 + bob, 5, 4);
        ctx.fillStyle = '#f4ecdc'; ctx.fillRect(x - 8, y - 10 + bob, 4, 5); ctx.fillRect(x + 4, y - 10 + bob, 4, 5);
        ctx.fillStyle = '#3a2a5a'; ctx.fillRect(x - 14, y + 14, 10, 5 + f * 2); ctx.fillRect(x + 4, y + 14, 10, 7 - f * 2);
      }
      if (e.slow > 0) { ctx.fillStyle = 'rgba(92,225,230,.35)'; ctx.beginPath(); ctx.arc(x, y - 2, e.r + 3, 0, Math.PI * 2); ctx.fill(); }
      if (e.hp < e.max) {
        const w = e.kind === 'boss' ? 40 : 22, top = y - e.r - (e.kind === 'boss' ? 22 : 12);
        ctx.fillStyle = '#120d1c'; ctx.fillRect(x - w / 2 - 1, top - 1, w + 2, 5);
        ctx.fillStyle = e.hp / e.max > 0.4 ? '#b8e65c' : '#ff6b9a'; ctx.fillRect(x - w / 2, top, w * e.hp / e.max, 3);
      }
    },
    button(b, label, sub, color, on, off) {
      ctx.fillStyle = on ? '#3a3052' : '#211b31'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = off ? '#3a3052' : color; ctx.lineWidth = 2; ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = off ? '#5d5578' : color; ctx.font = font(10);
      ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 - (sub ? 6 : 0));
      if (sub) { ctx.fillStyle = off ? '#5d5578' : C.ink; ctx.font = font(8); ctx.fillText(sub, b.x + b.w / 2, b.y + b.h / 2 + 9); }
    },
    draw() {
      ctx.drawImage(cached('tower-map', this.W, MAP_H, (g) => this.drawMap(g)), 0, 0, this.W, MAP_H);

      // Where a tower would go (and how far it reaches) under the mouse or finger.
      const h = this.hover;
      if (h && h.y < MAP_H && !this.sel) {
        const c = Math.floor(h.x / CELL), r = Math.floor(h.y / CELL);
        if (this.canBuild(c, r)) {
          const k = TOWERS[this.pick], ghost = { type: this.pick, c, r, x: c * CELL + CELL / 2, y: r * CELL + CELL / 2, lv: 1, aim: 0, kick: 0 };
          ctx.fillStyle = 'rgba(244,236,220,.08)'; ctx.strokeStyle = 'rgba(244,236,220,.4)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(ghost.x, ghost.y, k.range, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          this.drawTower(ghost, true);
          if (this.coins < k.cost) { ctx.strokeStyle = C.pink; ctx.lineWidth = 2; ctx.strokeRect(c * CELL + 2, r * CELL + 2, CELL - 4, CELL - 4); }
        }
      }
      if (this.sel) {
        const s = stat(this.sel);
        ctx.fillStyle = 'rgba(255,179,71,.1)'; ctx.strokeStyle = 'rgba(255,179,71,.7)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(this.sel.x, this.sel.y, s.range, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }

      // Things further down the screen are drawn last, so they stand in front.
      const things = this.towers.map((t) => ({ y: t.y, t })).concat(this.foes.map((e) => ({ y: e.y, e })));
      things.sort((a, b) => a.y - b.y);
      for (const o of things) if (o.t) this.drawTower(o.t); else this.drawFoe(o.e);

      for (const s of this.shots) {
        if (s.kind === 'ball') { ctx.fillStyle = '#2b2738'; ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#5d5578'; ctx.fillRect(s.x - 2, s.y - 3, 2, 2); }
        else if (s.kind === 'arrow') { ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a || 0); ctx.fillStyle = C.ink; ctx.fillRect(-7, -1, 12, 2); ctx.fillStyle = '#b8e65c'; ctx.fillRect(3, -2, 4, 4); ctx.restore(); }
        else { ctx.fillStyle = '#bff6ff'; ctx.fillRect(s.x - 3, s.y - 3, 6, 6); ctx.fillStyle = C.cyan; ctx.fillRect(s.x - 1, s.y - 1, 2, 2); }
      }
      for (const b of this.bolts) {
        ctx.strokeStyle = b.life > 0.08 ? '#f4ecdc' : '#a78bfa'; ctx.lineWidth = 3; ctx.beginPath();
        b.pts.forEach((p, i) => {
          if (!i) { ctx.moveTo(p.x, p.y); return; }
          const q = b.pts[i - 1], mx = (p.x + q.x) / 2 + Math.sin(this.t * 90 + i) * 7, my = (p.y + q.y) / 2 + Math.cos(this.t * 70 + i) * 7;
          ctx.lineTo(mx, my); ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      }
      for (const b of this.bits) {
        if (b.ring) { ctx.strokeStyle = b.color; ctx.globalAlpha = b.life / b.max; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(b.x, b.y, b.ring * (1.2 - b.life / b.max * 0.5), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
        else { ctx.fillStyle = b.color; ctx.fillRect(b.x - 2, b.y - 2, 4, 4); }
      }
      ctx.font = font(8); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const p of this.pops) { ctx.globalAlpha = 1 - p.t / 0.9; ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y - p.t * 30); }
      ctx.globalAlpha = 1;

      if (this.hurt > 0) { ctx.fillStyle = 'rgba(255,59,92,' + (this.hurt * 0.5).toFixed(2) + ')'; ctx.fillRect(0, 0, this.W, MAP_H); }
      if (this.bannerT > 0) {
        ctx.globalAlpha = Math.min(1, this.bannerT * 2);
        ctx.font = font(12); const w = ctx.measureText(this.banner).width + 28;
        ctx.fillStyle = 'rgba(13,10,21,.8)'; ctx.fillRect(this.W / 2 - w / 2, 172, w, 34);
        ctx.fillStyle = C.amber; ctx.fillText(this.banner, this.W / 2, 190);
        ctx.globalAlpha = 1;
      }

      // The bar under the map.
      ctx.fillStyle = C.bg; ctx.fillRect(0, MAP_H, this.W, this.H - MAP_H);
      ctx.fillStyle = C.line; ctx.fillRect(0, MAP_H, this.W, 2);
      ctx.font = font(11); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillStyle = this.hurt > 0 ? C.pink : '#ff6b9a'; ctx.fillText('♥ ' + this.lives, 8, HUD_Y + 13);
      ctx.fillStyle = C.amber; ctx.fillText('● ' + this.coins, 92, HUD_Y + 13);
      ctx.fillStyle = C.ink; ctx.fillText('WAVE ' + Math.max(1, this.wave + (this.state === 'build' ? 1 : 0)), 186, HUD_Y + 13);
      ctx.textAlign = 'right'; ctx.fillStyle = C.muted;
      ctx.fillText(this.state === 'build' ? 'NEXT IN ' + Math.ceil(this.timer) : this.queue.length + this.foes.length + ' LEFT', this.W - 8, HUD_Y + 13);

      TOWERS.forEach((k, i) => {
        const b = towerBtn(i), on = this.pick === i && !this.sel, off = this.coins < k.cost;
        ctx.fillStyle = on ? '#3a3052' : '#211b31'; ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = on ? k.color : off ? '#3a3052' : '#5d5578'; ctx.lineWidth = 2; ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
        ctx.save(); ctx.translate(b.x + b.w / 2, b.y + 22); ctx.scale(0.8, 0.8);
        ctx.globalAlpha = off ? 0.4 : 1;
        this.drawTower({ type: i, c: i, x: 0, y: 0, lv: 1, aim: -Math.PI / 4, kick: 0 }, false, true);
        ctx.restore(); ctx.globalAlpha = 1;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = font(8);
        ctx.fillStyle = off ? '#5d5578' : k.color; ctx.fillText(k.name, b.x + b.w / 2, b.y + 41);
        ctx.fillStyle = off ? '#5d5578' : C.amber; ctx.fillText('●' + k.cost, b.x + b.w / 2, b.y + 52);
        ctx.fillStyle = '#5d5578'; ctx.textAlign = 'left'; ctx.fillText(String(i + 1), b.x + 5, b.y + 9);
      });
      if (this.state === 'build') this.button(GO_BTN, 'GO ▶', 'BONUS +' + Math.floor(this.timer) * 2, C.lime, true);
      else this.button(GO_BTN, this.fast ? 'SPEED 2x' : 'SPEED 1x', 'TAP TO CHANGE', C.cyan, this.fast);

      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      if (this.sel) {
        const t = this.sel, k = TOWERS[t.type], cost = upCost(t);
        ctx.font = font(10); ctx.fillStyle = k.color; ctx.fillText(k.name, 8, ROW_Y + 8);
        ctx.font = font(8); ctx.fillStyle = C.muted; ctx.fillText('LEVEL ' + t.lv + ' OF ' + MAX_LV, 8, ROW_Y + 25);
        if (t.lv >= MAX_LV) this.button(UP_BTN, 'MAX LEVEL', '', C.muted, false, true);
        else this.button(UP_BTN, 'UPGRADE', '●' + cost, C.lime, false, this.coins < cost);
        this.button(SELL_BTN, 'SELL', '+●' + sellValue(t), C.pink, false);
      } else {
        ctx.font = font(8); ctx.fillStyle = C.muted;
        const tips = ['ARROW: CHEAP AND FAST', 'CANNON: HITS A GROUP', 'ICE: SLOWS MONSTERS DOWN', 'ZAP: LIGHTNING JUMPS'];
        ctx.fillText(tips[this.pick], 8, ROW_Y + 8);
        ctx.fillText('TAP THE GRASS TO BUILD', 8, ROW_Y + 25);
      }
    },
  };

  Arcade.register('tower', tower);
})();
