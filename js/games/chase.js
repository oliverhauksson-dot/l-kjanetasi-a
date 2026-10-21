/* Police Chase ("Don't let the police catch you"). Loaded on demand by js/arcade.js the first time the game is opened.
   A 3D city seen from above. You drive the yellow getaway car and the police chase you through the streets.
   The police find their way round the buildings with a distance map of the roads that is worked out
   from your position a few times a second. Police that crash into each other or a wall stop for a while. */
(() => {
  const { ctx, C, rand, clamp, cached, sfx, setScore, over, font } = Arcade;

  // The city is a 7 x 7 grid of blocks with roads between them and round the outside.
  const ROAD = 80, BLOCK = 200, PITCH = ROAD + BLOCK, NB = 7, WORLD = ROAD + NB * PITCH;
  // For finding the way, the city is also split into small cells. 7 cells make one PITCH (2 road + 5 block).
  const CELL = 40, GN = WORLD / CELL;
  const R = 13;                     // Every car is a circle this big when it bumps into things.
  const LIVES = 3, SAFE = 3;      // Seconds you can't be caught after the police catch you.
  const ASPHALT = '#2b2738', WALK = '#4b4366', CURB = '#7a7099';
  const PLAYER = { acc: 420, max: 240, turn: 4.2, grip: 5.5 };
  const BOOSTED = { acc: 650, max: 350, turn: 4.4, grip: 5 };

  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const open = (cx, cy) => cx >= 0 && cy >= 0 && cx < GN && cy < GN && (cx % 7 < 2 || cy % 7 < 2);
  function rr(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
  }

  /* ---------- The city ----------
     The city is drawn in 3D: every building is a box seen from a camera high above the middle of the
     screen. A point at height z is pushed away from the middle by D / (D - z), so roofs lean out and
     you see the walls that face you. A dozen block designs are made once and reused all over the map. */
  const D = 700;
  const lift = (z) => D / (D - z);
  const hash = (a, b, c, d) => {
    let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177) + Math.imul(d, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16), ch = (s) => clamp(Math.round(((n >> s) & 255) * f), 0, 255);
    return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')';
  }
  // Apartment colours: [roof, wall].
  const PAINT = [['#a78bfa', '#8a6fe0'], ['#ff6b9a', '#e0577f'], ['#ffb347', '#e8973a'], ['#b8e65c', '#94c445'],
    ['#f4ecdc', '#d9ccb4'], ['#5ce1e6', '#3fc2c8'], ['#ff8a65', '#e06d4c']];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  let nextId = 1;
  function house(x, y, w, h, kind) {
    const b = { x, y, w, h, kind, id: nextId++ };
    if (kind === 'sky') {
      b.z = rand(270, 360); b.roof = '#9aa8d6'; b.wall = pick(['#34507f', '#2f6f86', '#4a4a8c']); b.glass = pick(['#7fe3f0', '#9fd0ff']);
      b.fh = 14; b.sp = 12; b.lit = 0.25; b.antenna = Math.random() < 0.6;
    } else if (kind === 'apt') {
      const p = pick(PAINT); b.z = rand(80, 170); b.roof = p[0]; b.wall = p[1]; b.glass = '#2a2240';
      b.fh = 20; b.sp = 17; b.lit = 0.22; b.tank = Math.random() < 0.6; b.garden = Math.random() < 0.3;
    } else {
      const p = pick(PAINT); b.z = rand(38, 52); b.roof = p[0]; b.wall = p[1]; b.glass = '#7fe3f0';
      b.fh = 100; b.sp = 100; b.lit = 0; b.awning = pick([C.pink, C.cyan, C.amber, C.lime]);
    }
    b.wallX = shade(b.wall, 0.78); b.wallY = shade(b.wall, 0.95);
    if (kind !== 'shop') b.z = Math.round(b.z / b.fh) * b.fh + 6;
    return b;
  }
  const DESIGNS = [
    { ground: 'plaza', houses: () => [house(35, 35, 130, 130, 'sky')] },
    { ground: 'plaza', houses: () => [house(40, 40, 120, 120, 'sky')] },
    { ground: 'plaza', houses: () => [house(18, 18, 74, 164, 'sky'), house(108, 18, 74, 164, 'sky')] },
    { ground: 'walk', houses: () => [house(10, 10, 86, 180, 'apt'), house(104, 10, 86, 180, 'apt')] },
    { ground: 'walk', houses: () => [house(10, 10, 180, 86, 'apt'), house(10, 104, 180, 86, 'apt')] },
    { ground: 'walk', houses: () => [house(10, 10, 86, 86, 'apt'), house(104, 10, 86, 86, 'apt'), house(10, 104, 86, 86, 'shop'), house(104, 104, 86, 86, 'apt')] },
    { ground: 'walk', houses: () => [house(10, 10, 180, 100, 'apt'), house(10, 118, 86, 72, 'shop'), house(104, 118, 86, 72, 'shop')] },
    { ground: 'walk', houses: () => [house(10, 10, 110, 110, 'apt'), house(128, 10, 62, 110, 'shop'), house(10, 128, 180, 62, 'apt')] },
    { ground: 'plaza', houses: () => [house(14, 14, 90, 90, 'sky'), house(116, 14, 70, 172, 'apt'), house(14, 116, 90, 70, 'shop')] },
    { ground: 'park', pond: false }, { ground: 'park', pond: true }, { ground: 'park', pond: false },
  ].map((d, k) => {
    d.n = k; d.houses = d.houses ? d.houses() : [];
    if (d.ground === 'park') {
      d.trees = [];
      while (d.trees.length < 10) {
        const x = rand(26, 174), y = rand(26, 174);
        if (Math.abs(x - 100) > 28 && Math.abs(y - 100) > 28) d.trees.push({ x, y, r: rand(11, 16), z: rand(24, 40) });
      }
    }
    return d;
  });
  const city = [];
  for (let j = 0; j < NB; j++) for (let i = 0; i < NB; i++) city.push(Math.random() < 0.14 ? 9 + Math.floor(Math.random() * 3) : Math.floor(Math.random() * 9));

  // The flat part of a block: pavement, plaza tiles or park grass.
  function paintGround(g, d) {
    g.fillStyle = WALK; g.fillRect(0, 0, BLOCK, BLOCK);
    g.strokeStyle = CURB; g.lineWidth = 3; g.strokeRect(1.5, 1.5, BLOCK - 3, BLOCK - 3);
    if (d.ground === 'plaza') {
      g.fillStyle = '#5c5478'; g.fillRect(6, 6, 188, 188);
      g.fillStyle = 'rgba(21,17,31,0.18)';
      for (let k = 6; k < 194; k += 16) { g.fillRect(k, 6, 1, 188); g.fillRect(6, k, 188, 1); }
      g.fillStyle = '#3f8f5a';
      for (const [x, y] of [[10, 10], [180, 10], [10, 180], [180, 180]]) g.fillRect(x - 4, y - 4, 18, 18);
    }
    if (d.ground === 'park') {
      g.fillStyle = '#2f6e45'; g.fillRect(10, 10, 180, 180);
      g.fillStyle = '#3f8f5a'; g.fillRect(13, 13, 174, 174);
      g.fillStyle = '#d9c39a'; g.fillRect(93, 13, 14, 174); g.fillRect(13, 93, 174, 14);
      if (d.pond) {
        g.fillStyle = '#d8d0e8'; g.beginPath(); g.arc(100, 100, 24, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#5ce1e6'; g.beginPath(); g.arc(100, 100, 19, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#f4ecdc'; g.beginPath(); g.arc(100, 100, 5, 0, Math.PI * 2); g.fill();
      }
    }
    for (const b of d.houses) { g.fillStyle = shade(b.wall, 0.5); g.fillRect(b.x, b.y, b.w, b.h); }
  }
  // A roof seen from straight above, painted once per building.
  function paintRoof(g, b) {
    const w = b.w, h = b.h, rnd = (k) => hash(b.id, 7, k, 3);
    g.fillStyle = shade(b.roof, 0.75); g.fillRect(0, 0, w, h);
    g.fillStyle = b.roof; g.fillRect(4, 4, w - 8, h - 8);
    if (b.kind === 'sky') {
      if (w >= 110 && h >= 110) {
        g.fillStyle = 'rgba(21,17,31,0.3)'; g.beginPath(); g.arc(w / 2, h / 2, 36, 0, Math.PI * 2); g.fill();
        g.fillStyle = shade(b.roof, 1.1); g.beginPath(); g.arc(w / 2, h / 2, 30, 0, Math.PI * 2); g.fill();
        g.fillStyle = C.amber;
        g.fillRect(w / 2 - 13, h / 2 - 15, 6, 30); g.fillRect(w / 2 + 7, h / 2 - 15, 6, 30); g.fillRect(w / 2 - 7, h / 2 - 3, 14, 6);
      } else {
        g.fillStyle = '#2a3768';
        for (let y = 12; y < h - 20; y += 14) for (let x = 10; x < w - 18; x += 18) g.fillRect(x, y, 14, 9);
      }
      return;
    }
    if (b.garden) {
      g.fillStyle = '#3f8f5a'; g.fillRect(10, 10, w * 0.45, h * 0.45);
      g.fillStyle = '#58a96c'; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(16 + rnd(k) * (w * 0.45 - 12), 16 + rnd(k + 9) * (h * 0.45 - 12), 4, 0, Math.PI * 2); g.fill(); }
    }
    const n = b.kind === 'shop' ? 1 : 2 + Math.floor(rnd(1) * 2);
    for (let k = 0; k < n; k++) {
      const ax = 8 + rnd(k + 20) * (w - 34), ay = 8 + rnd(k + 30) * (h - 26);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(ax + 3, ay + 3, 18, 12);
      g.fillStyle = '#d8d0e8'; g.fillRect(ax, ay, 18, 12);
      g.fillStyle = '#8f86a8'; g.beginPath(); g.arc(ax + 9, ay + 6, 4, 0, Math.PI * 2); g.fill();
    }
    if (b.tank) {
      const tx = w - 20, ty = h - 20;
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(tx + 3, ty + 3, 10, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#8d5a3a'; g.beginPath(); g.arc(tx, ty, 10, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#b07a4f'; g.beginPath(); g.arc(tx, ty, 6, 0, Math.PI * 2); g.fill();
    }
    if (b.kind === 'apt') { g.fillStyle = shade(b.roof, 0.6); g.fillRect(w / 2 - 8, 6, 16, 12); }
  }

  /* ---------- Cars ---------- */
  function drive(car, aim, throttle, brake, dt, s) {
    if (aim !== null) { const d = wrap(aim - car.a); car.a += clamp(d, -s.turn * dt, s.turn * dt); }
    const c = Math.cos(car.a), n = Math.sin(car.a);
    let f = car.vx * c + car.vy * n, l = -car.vx * n + car.vy * c;
    if (throttle > 0) { if (f < s.max) f = Math.min(s.max, f + s.acc * throttle * dt); }
    else if (throttle < 0) f = Math.max(-90, f + s.acc * throttle * 0.6 * dt);
    else f -= f * 1.6 * dt;
    if (brake) f -= f * 3.5 * dt;
    if (f > s.max) f -= (f - s.max) * 4 * dt;
    l -= l * Math.min(1, s.grip * dt);   // Low grip lets the car slide sideways a little (a drift).
    car.vx = f * c - l * n; car.vy = f * n + l * c;
    car.slide = Math.abs(l); car.speed = Math.hypot(car.vx, car.vy);
    car.x += car.vx * dt; car.y += car.vy * dt;
  }
  // Push a car out of the buildings and the edge of the map. Returns how hard it hit.
  function bump(car) {
    let hit = 0;
    const lo = (v) => Math.floor((v - R - ROAD) / PITCH), hi = (v) => Math.floor((v + R - ROAD) / PITCH);
    for (let j = Math.max(0, lo(car.y)); j <= Math.min(NB - 1, hi(car.y)); j++) {
      for (let i = Math.max(0, lo(car.x)); i <= Math.min(NB - 1, hi(car.x)); i++) {
        const bx = ROAD + i * PITCH, by = ROAD + j * PITCH;
        const px = clamp(car.x, bx, bx + BLOCK), py = clamp(car.y, by, by + BLOCK);
        const dx = car.x - px, dy = car.y - py, d = Math.hypot(dx, dy);
        if (d >= R || d === 0) continue;
        const nx = dx / d, ny = dy / d;
        car.x += nx * (R - d); car.y += ny * (R - d);
        const vn = car.vx * nx + car.vy * ny;
        if (vn < 0) { car.vx -= 1.4 * vn * nx; car.vy -= 1.4 * vn * ny; car.vx *= 0.9; car.vy *= 0.9; hit = Math.max(hit, -vn); }
      }
    }
    if (car.x < R) { hit = Math.max(hit, -car.vx); car.x = R; car.vx = Math.abs(car.vx) * 0.4; }
    if (car.x > WORLD - R) { hit = Math.max(hit, car.vx); car.x = WORLD - R; car.vx = -Math.abs(car.vx) * 0.4; }
    if (car.y < R) { hit = Math.max(hit, -car.vy); car.y = R; car.vy = Math.abs(car.vy) * 0.4; }
    if (car.y > WORLD - R) { hit = Math.max(hit, car.vy); car.y = WORLD - R; car.vy = -Math.abs(car.vy) * 0.4; }
    return hit;
  }

  const chase = {
    W: 400, H: 560, color: 'var(--pink)', title: 'Police Chase', label: 'Score',
    quietScore: true, // The score ticks up every moment you survive, so coins get their own sound instead of a beep.
    intro: "Don't let the police catch you! Drive round the city, grab coins and speed boosts, and make the police crash into each other. They catch you 3 times and it's over.",
    hint: '<kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd> or <kbd>WASD</kbd> to drive, drag anywhere on a phone, <kbd>P</kbd> to pause',

    reset() {
      this.t = 0; this.clock = 0; this.bonus = 0; this.score = 0; this.lives = LIVES;
      const sx = ROAD + 3 * PITCH - ROAD / 2, sy = ROAD + 3 * PITCH - ROAD / 2; // The middle crossing of the city.
      this.pl = { x: sx, y: sy, a: -Math.PI / 2, vx: 0, vy: 0, speed: 0, slide: 0, safe: 0, boost: 0 };
      this.cam = { x: sx, y: sy }; this.shake = 0;
      this.cops = []; this.coins = []; this.power = null; this.powerAt = 8;
      this.marks = []; this.puffs = []; this.pops = [];
      this.keys = {}; this.stick = { down: false, base: null, x: 0, y: 0 };
      this.freeze = 0; this.siren = 0; this.sirenHi = false;
      this.field = new Int16Array(GN * GN); this.fieldAt = 0; this.map();
      while (this.coins.length < 7) this.addCoin();
    },

    /* ---------- Input ---------- */
    key(e, down) {
      const k = { ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r' }[e.code];
      if (k) this.keys[k] = down;
    },
    press(down) { this.stick.down = down; if (!down) this.stick.base = null; },
    point(p) {
      const s = this.stick;
      if (!s.down) return;
      if (!s.base) s.base = { x: p.x, y: p.y };
      let dx = (p.x - s.base.x) / 40, dy = (p.y - s.base.y) / 40;
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      s.x = dx; s.y = dy;
    },
    // Where the player wants to go: a direction and how much (0 to 1).
    wish() {
      const k = this.keys, kx = (k.r ? 1 : 0) - (k.l ? 1 : 0), ky = (k.d ? 1 : 0) - (k.u ? 1 : 0);
      if (kx || ky) return { a: Math.atan2(ky, kx), m: 1 };
      const s = this.stick, m = s.base ? Math.hypot(s.x, s.y) : 0;
      return m > 0.2 ? { a: Math.atan2(s.y, s.x), m: Math.min(1, m * 1.2) } : null;
    },

    /* ---------- Finding the way ---------- */
    // How many road cells every cell is from the player. The police drive "downhill" on this map.
    map() {
      const f = this.field, q = new Int32Array(GN * GN);
      f.fill(32767);
      let cx = clamp(Math.floor(this.pl.x / CELL), 0, GN - 1), cy = clamp(Math.floor(this.pl.y / CELL), 0, GN - 1);
      let head = 0, tail = 0;
      f[cy * GN + cx] = 0; q[tail++] = cy * GN + cx;
      while (head < tail) {
        const c = q[head++], x = c % GN, y = (c - x) / GN, d = f[c] + 1;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (!open(nx, ny) || f[ny * GN + nx] <= d) continue;
          f[ny * GN + nx] = d; q[tail++] = ny * GN + nx;
        }
      }
    },
    far(c) { const x = Math.floor(c.x / CELL), y = Math.floor(c.y / CELL); return open(x, y) ? this.field[y * GN + x] : 999; },
    // A random road spot at least `min` cells from the player, and off screen if asked.
    spot(min, hidden) {
      let best = null;
      for (let tries = 0; tries < 80; tries++) {
        const cx = Math.floor(rand(0, GN)), cy = Math.floor(rand(0, GN));
        if (!open(cx, cy)) continue;
        const d = this.field[cy * GN + cx], x = cx * CELL + CELL / 2, y = cy * CELL + CELL / 2;
        if (d < min || d > 900) continue;
        if (hidden && Math.abs(x - this.cam.x) < this.W / 2 + 40 && Math.abs(y - this.cam.y) < this.H / 2 + 40) continue;
        if (this.coins.some((c) => Math.hypot(c.x - x, c.y - y) < 60)) continue;
        best = { x, y };
        break;
      }
      return best;
    },
    addCoin() { const s = this.spot(4, false); if (s) this.coins.push({ x: s.x, y: s.y, t: rand(0, 6) }); },
    addCop() {
      const s = this.spot(12, true);
      if (!s) return;
      this.cops.push({ x: s.x, y: s.y, a: Math.atan2(this.pl.y - s.y, this.pl.x - s.x), vx: 0, vy: 0, speed: 0, slide: 0, wreck: 0, spin: 0, stuck: 0, back: 0, flash: rand(0, 1) });
    },

    /* ---------- Game logic ---------- */
    update(dt) {
      this.clock += dt;
      this.shake = Math.max(0, this.shake - dt);
      this.tickBits(dt);
      if (this.freeze > 0) {
        this.freeze -= dt;
        if (this.freeze <= 0) {
          if (this.lives <= 0) return over(this.score, 'The police caught you after ' + Math.floor(this.t) + ' seconds. Score ' + this.score + '.');
          // Clear the police away from you and give you a head start.
          this.cops = this.cops.filter((c) => Math.hypot(c.x - this.pl.x, c.y - this.pl.y) > 320);
          this.pl.safe = SAFE;
        }
        return;
      }
      this.t += dt;
      const pl = this.pl;

      // You
      const w = this.wish(), spec = pl.boost > 0 ? BOOSTED : PLAYER;
      let throttle = 0;
      if (w) { throttle = w.m * (Math.abs(wrap(w.a - pl.a)) > 1.8 && pl.speed > 120 ? 0.2 : 1); }
      drive(pl, w ? w.a : null, throttle, false, dt, spec);
      if (bump(pl) > 120) { sfx.hit(); this.shake = 0.15; this.sparks(pl.x, pl.y); }
      pl.safe = Math.max(0, pl.safe - dt); pl.boost = Math.max(0, pl.boost - dt);
      this.skid(pl, dt);
      if (pl.boost > 0 && Math.random() < dt * 40) this.puff(pl.x - Math.cos(pl.a) * 16, pl.y - Math.sin(pl.a) * 16, Math.random() < 0.5 ? C.amber : C.pink, 4, 0.3);

      // Camera: follows you and looks a little ahead.
      const k = 1 - Math.exp(-5 * dt);
      this.cam.x += (clamp(pl.x + pl.vx * 0.35, this.W / 2, WORLD - this.W / 2) - this.cam.x) * k;
      this.cam.y += (clamp(pl.y + pl.vy * 0.35, this.H / 2, WORLD - this.H / 2) - this.cam.y) * k;

      // Police
      this.fieldAt -= dt;
      if (this.fieldAt <= 0) { this.map(); this.fieldAt = 0.2; }
      const want = Math.min(8, 1 + Math.floor(this.t / 15));
      if (this.t > 1 && this.cops.length < want && Math.random() < dt * 2) this.addCop();
      const cop = { acc: 270, max: Math.min(228, 165 + this.t * 0.5), turn: 3, grip: 4 };
      for (const c of this.cops) this.think(c, cop, dt);
      this.crashes();

      // Caught?
      if (pl.safe <= 0 && this.cops.some((c) => !c.wreck && Math.hypot(c.x - pl.x, c.y - pl.y) < R * 2 - 2)) return this.busted();

      // Coins and the speed boost
      for (const c of this.coins) c.t += dt;
      this.coins = this.coins.filter((c) => {
        if (Math.hypot(c.x - pl.x, c.y - pl.y) > 24) return true;
        this.bonus += 50; this.pop(c.x, c.y, '+50', C.amber);
        sfx.tone(1320, 0.07, 'square', 0.04, 1760);
        return false;
      });
      while (this.coins.length < 7) this.addCoin();
      if (this.power) {
        this.power.t += dt;
        if (Math.hypot(this.power.x - pl.x, this.power.y - pl.y) < 26) {
          pl.boost = 3; this.power = null; this.powerAt = 14;
          this.pop(pl.x, pl.y - 20, 'BOOST!', C.cyan); sfx.tone(300, 0.4, 'sawtooth', 0.04, 1200);
        }
      } else if ((this.powerAt -= dt) <= 0) {
        const s = this.spot(6, false);
        if (s) this.power = { x: s.x, y: s.y, t: 0 };
      }

      // Siren: a wail that gets louder as the nearest police car gets closer.
      const near = Math.min(...this.cops.filter((c) => !c.wreck).map((c) => Math.hypot(c.x - pl.x, c.y - pl.y)), 9999);
      if ((this.siren -= dt) <= 0 && near < 400) {
        this.siren = 0.5; this.sirenHi = !this.sirenHi;
        sfx.tone(this.sirenHi ? 940 : 700, 0.48, 'triangle', 0.012 + 0.03 * (1 - near / 400), this.sirenHi ? 700 : 940);
      }

      const score = Math.floor(this.t * 10) + this.bonus;
      if (score !== this.score) { this.score = score; setScore(score); }
    },
    // One police car: drive down the distance map towards you, or straight at you when close.
    think(c, spec, dt) {
      if (c.wreck > 0) {
        c.wreck -= dt; c.a += c.spin * dt; c.spin *= 1 - Math.min(1, 2 * dt);
        drive(c, null, 0, true, dt, spec); bump(c);
        if (Math.random() < dt * 12) this.puff(c.x, c.y, '#6a6188', 6, 0.9);
        return;
      }
      const pl = this.pl;
      let aim;
      const gap = Math.hypot(pl.x - c.x, pl.y - c.y);
      if (gap < 150 && this.far(c) <= 4) aim = Math.atan2(pl.y + pl.vy * 0.25 - c.y, pl.x + pl.vx * 0.25 - c.x);
      else {
        let cx = Math.floor(c.x / CELL), cy = Math.floor(c.y / CELL);
        for (let s = 0; s < 2; s++) {
          let best = open(cx, cy) ? this.field[cy * GN + cx] : 32767, bx = cx, by = cy;
          for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
            if (open(nx, ny) && this.field[ny * GN + nx] < best) { best = this.field[ny * GN + nx]; bx = nx; by = ny; }
          }
          cx = bx; cy = by;
        }
        aim = Math.atan2(cy * CELL + CELL / 2 - c.y, cx * CELL + CELL / 2 - c.x);
      }
      // Stuck against a wall? Back up for a moment.
      if (c.back > 0) { c.back -= dt; drive(c, null, -1, false, dt, spec); }
      else {
        const turn = Math.abs(wrap(aim - c.a));
        drive(c, aim, turn > 1.1 ? 0.25 : 1, turn > 1.1 && c.speed > 110, dt, spec);
        c.stuck = c.speed < 25 ? c.stuck + dt : 0;
        if (c.stuck > 1) { c.back = 0.6; c.stuck = 0; }
      }
      const hit = bump(c);
      if (hit > 175) this.wreck(c, 2.5);
      this.skid(c, dt);
    },
    // Police cars that run into each other both spin out.
    crashes() {
      const cs = this.cops;
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i], b = cs[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= R * 2 || d === 0) continue;
        const nx = dx / d, ny = dy / d, push = (R * 2 - d) / 2;
        a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel > 0) { a.vx -= rel * nx; a.vy -= rel * ny; b.vx += rel * nx; b.vy += rel * ny; }
        if (rel > 120 && !a.wreck && !b.wreck) {
          this.wreck(a, 3); this.wreck(b, 3);
          this.bonus += 100; this.pop((a.x + b.x) / 2, (a.y + b.y) / 2, 'CRASH +100', C.lime);
        }
      }
    },
    wreck(c, secs) {
      c.wreck = secs; c.spin = rand(5, 9) * (Math.random() < 0.5 ? -1 : 1);
      this.sparks(c.x, c.y); sfx.tone(160, 0.3, 'sawtooth', 0.06, 50);
      if (Math.hypot(c.x - this.cam.x, c.y - this.cam.y) < 400) this.shake = Math.max(this.shake, 0.2);
    },
    busted() {
      const pl = this.pl;
      this.lives--; this.freeze = 1.3; this.shake = 0.5;
      pl.vx = 0; pl.vy = 0; pl.speed = 0;
      sfx.tone(600, 0.6, 'square', 0.05, 150);
    },

    /* ---------- Effects ---------- */
    skid(car, dt) {
      if (car.slide > 60 && car.speed > 90) {
        const c = Math.cos(car.a), n = Math.sin(car.a);
        for (const side of [-6, 6]) {
          const x = car.x - c * 10 - n * side, y = car.y - n * 10 + c * side;
          const last = side < 0 ? car.lastL : car.lastR;
          if (last) this.marks.push({ x1: last.x, y1: last.y, x2: x, y2: y, life: 6 });
          if (side < 0) car.lastL = { x, y }; else car.lastR = { x, y };
        }
        if (Math.random() < dt * 20) this.puff(car.x - c * 12, car.y - n * 12, '#8f86a8', 4, 0.5);
        if (this.marks.length > 500) this.marks.splice(0, this.marks.length - 500);
      } else { car.lastL = null; car.lastR = null; }
    },
    puff(x, y, col, r, life) { if (this.puffs.length < 220) this.puffs.push({ x, y, vx: rand(-20, 20), vy: rand(-20, 20), r, col, life, max: life }); },
    sparks(x, y) { for (let k = 0; k < 10; k++) this.puff(x + rand(-8, 8), y + rand(-8, 8), Math.random() < 0.5 ? C.amber : '#f4ecdc', 2, 0.35); },
    pop(x, y, text, col) { this.pops.push({ x, y, text, col, life: 1.1 }); },
    tickBits(dt) {
      for (const m of this.marks) m.life -= dt;
      if (this.marks.length && this.marks[0].life <= 0) this.marks = this.marks.filter((m) => m.life > 0);
      for (const p of this.puffs) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += dt * 8; }
      this.puffs = this.puffs.filter((p) => p.life > 0);
      for (const p of this.pops) { p.life -= dt; p.y -= dt * 30; }
      this.pops = this.pops.filter((p) => p.life > 0);
      for (const c of this.cops) c.flash += dt;
    },

    /* ---------- Drawing ---------- */
    draw() {
      const W = this.W, H = this.H, t = this.clock;
      const sh = this.shake > 0 ? this.shake * 14 : 0;
      const ox = Math.round(W / 2 - this.cam.x + rand(-sh, sh)), oy = Math.round(H / 2 - this.cam.y + rand(-sh, sh));
      const x0 = this.cam.x - W / 2 - 20, x1 = this.cam.x + W / 2 + 20, y0 = this.cam.y - H / 2 - 20, y1 = this.cam.y + H / 2 + 20;
      ctx.fillStyle = ASPHALT; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.translate(ox, oy);

      // Roads: dashed middle lines, then crossings with zebra stripes.
      const i0 = Math.max(0, Math.floor(x0 / PITCH)), i1 = Math.min(NB, Math.floor(x1 / PITCH));
      const j0 = Math.max(0, Math.floor(y0 / PITCH)), j1 = Math.min(NB, Math.floor(y1 / PITCH));
      ctx.fillStyle = 'rgba(255,179,71,0.55)';
      for (let i = i0; i <= i1; i++) for (let y = Math.floor(y0 / 40) * 40; y < y1; y += 40) ctx.fillRect(i * PITCH + ROAD / 2 - 1.5, y, 3, 20);
      for (let j = j0; j <= j1; j++) for (let x = Math.floor(x0 / 40) * 40; x < x1; x += 40) ctx.fillRect(x, j * PITCH + ROAD / 2 - 1.5, 20, 3);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i * PITCH, y = j * PITCH;
        ctx.fillStyle = ASPHALT; ctx.fillRect(x, y, ROAD, ROAD);
        ctx.fillStyle = 'rgba(216,208,232,0.55)';
        for (let s = 8; s < ROAD - 4; s += 12) {
          if (j > 0) ctx.fillRect(x + s, y - 16, 6, 12);
          if (j < NB) ctx.fillRect(x + s, y + ROAD + 4, 6, 12);
          if (i > 0) ctx.fillRect(x - 16, y + s, 12, 6);
          if (i < NB) ctx.fillRect(x + ROAD + 4, y + s, 12, 6);
        }
      }
      // Skid marks
      ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (const m of this.marks) {
        ctx.strokeStyle = 'rgba(12,9,20,' + (Math.min(1, m.life / 2) * 0.55).toFixed(2) + ')';
        ctx.beginPath(); ctx.moveTo(m.x1, m.y1); ctx.lineTo(m.x2, m.y2); ctx.stroke();
      }
      // The flat part of each block, then the shadows the buildings throw onto it and the road.
      const seen = [];
      for (let j = j0; j < Math.min(NB, j1 + 1); j++) for (let i = i0; i < Math.min(NB, i1 + 1); i++) {
        const bx = ROAD + i * PITCH, by = ROAD + j * PITCH, d = DESIGNS[city[j * NB + i]];
        ctx.drawImage(cached('chase-ground' + d.n, BLOCK, BLOCK, (g) => paintGround(g, d)), bx, by, BLOCK, BLOCK);
        seen.push({ bx, by, d });
      }
      ctx.fillStyle = 'rgba(8,6,14,0.35)';
      for (const { bx, by, d } of seen) {
        for (const b of d.houses) {
          const x0 = bx + b.x, y0 = by + b.y, x1 = x0 + b.w, y1 = y0 + b.h, s = Math.min(70, b.z * 0.22);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1 + s, y0 + s); ctx.lineTo(x1 + s, y1 + s); ctx.lineTo(x0 + s, y1 + s); ctx.lineTo(x0, y1); ctx.closePath(); ctx.fill();
        }
        for (const t of d.trees || []) { ctx.beginPath(); ctx.ellipse(bx + t.x + t.z * 0.22, by + t.y + t.z * 0.22, t.r, t.r * 0.8, 0, 0, Math.PI * 2); ctx.fill(); }
      }
      // Edge of the city: a striped barrier.
      ctx.fillStyle = C.amber; ctx.fillRect(-6, -6, WORLD + 12, 6); ctx.fillRect(-6, WORLD, WORLD + 12, 6); ctx.fillRect(-6, 0, 6, WORLD); ctx.fillRect(WORLD, 0, 6, WORLD);

      // Coins and the boost
      for (const c of this.coins) {
        const sq = Math.abs(Math.cos(c.t * 4)), y = c.y + Math.sin(c.t * 3) * 2;
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(c.x + 3, c.y + 6, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#d68a26'; ctx.beginPath(); ctx.ellipse(c.x, y, 9 * sq + 1.5, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.amber; ctx.beginPath(); ctx.ellipse(c.x, y, 6.5 * sq + 1, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      }
      if (this.power) {
        const p = this.power, glow = 0.35 + Math.sin(p.t * 6) * 0.15;
        ctx.fillStyle = 'rgba(92,225,230,' + glow.toFixed(2) + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, 20, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.cyan; ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#15111f';
        ctx.beginPath(); ctx.moveTo(p.x + 2, p.y - 9); ctx.lineTo(p.x - 5, p.y + 1); ctx.lineTo(p.x, p.y + 1); ctx.lineTo(p.x - 2, p.y + 9); ctx.lineTo(p.x + 5, p.y - 1); ctx.lineTo(p.x, p.y - 1); ctx.closePath(); ctx.fill();
      }

      // Flashing red and blue light on the road round each police car.
      for (const c of this.cops) {
        if (c.wreck || !this.near(c, 60)) continue;
        const red = Math.floor(c.flash * 6) % 2 === 0;
        const g = ctx.createRadialGradient(c.x, c.y, 4, c.x, c.y, 46);
        g.addColorStop(0, red ? 'rgba(255,60,90,0.38)' : 'rgba(70,120,255,0.38)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(c.x - 46, c.y - 46, 92, 92);
      }
      for (const c of this.cops) if (this.near(c, 30)) this.car(c, true);
      const pl = this.pl;
      if (!(pl.safe > 0 && Math.floor(pl.safe * 10) % 2)) this.car(pl, false);
      this.city3d(seen, W / 2 - ox, H / 2 - oy);

      for (const p of this.puffs) {
        ctx.globalAlpha = Math.max(0, p.life / p.max) * 0.8; ctx.fillStyle = p.col;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = font(10);
      for (const p of this.pops) {
        ctx.globalAlpha = Math.min(1, p.life * 2);
        ctx.fillStyle = '#15111f'; ctx.fillText(p.text, p.x + 2, p.y + 2);
        ctx.fillStyle = p.col; ctx.fillText(p.text, p.x, p.y);
      }
      ctx.globalAlpha = 1;
      // Joystick, drawn where the thumb went down (in screen space, so undo the camera first).
      ctx.restore();
      const s = this.stick;
      if (s.base) {
        ctx.strokeStyle = 'rgba(244,236,220,0.35)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(s.base.x, s.base.y, 42, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(244,236,220,0.45)';
        ctx.beginPath(); ctx.arc(s.base.x + s.x * 40, s.base.y + s.y * 40, 18, 0, Math.PI * 2); ctx.fill();
      }
      this.arrows(ox, oy);
      this.hud();
    },
    // Buildings and trees in 3D, furthest from the middle of the screen first so nearer ones cover them.
    city3d(seen, mx, my) {
      const things = [];
      for (const { bx, by, d } of seen) {
        for (const b of d.houses) things.push({ b, x: bx + b.x, y: by + b.y, far: Math.hypot(bx + b.x + b.w / 2 - mx, by + b.y + b.h / 2 - my) });
        for (const t of d.trees || []) things.push({ t, x: bx + t.x, y: by + t.y, far: Math.hypot(bx + t.x - mx, by + t.y - my) });
      }
      things.sort((a, b) => b.far - a.far);
      for (const th of things) {
        if (th.t) this.tree(th.x, th.y, th.t, mx, my);
        else this.building(th.x, th.y, th.b, mx, my);
      }
    },
    tree(x, y, t, mx, my) {
      const k = lift(t.z), cx = mx + (x - mx) * k, cy = my + (y - my) * k;
      ctx.strokeStyle = '#6b3a1f'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.fillStyle = '#24583a'; ctx.beginPath(); ctx.arc(cx, cy, t.r * k, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#58a96c'; ctx.beginPath(); ctx.arc(cx - t.r * 0.3 * k, cy - t.r * 0.3 * k, t.r * 0.55 * k, 0, Math.PI * 2); ctx.fill();
    },
    building(x0, y0, b, mx, my) {
      const x1 = x0 + b.w, y1 = y0 + b.h, k = lift(b.z);
      const X = (x, z) => mx + (x - mx) * lift(z), Y = (y, z) => my + (y - my) * lift(z);
      // Each wall you can see: its two ground corners, and which way it faces.
      const walls = [];
      if (mx < x0) walls.push([x0, y0, x0, y1, 0]);
      if (mx > x1) walls.push([x1, y0, x1, y1, 0]);
      if (my < y0) walls.push([x0, y0, x1, y0, 1]);
      if (my > y1) walls.push([x0, y1, x1, y1, 1]);
      walls.forEach(([ax, ay, bx, by, side], wi) => {
        const at = (t, z) => [X(ax + (bx - ax) * t, z), Y(ay + (by - ay) * t, z)];
        const quad = (t0, t1, z0, z1) => {
          const a = at(t0, z0), c = at(t1, z0), e = at(t1, z1), f = at(t0, z1);
          ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(e[0], e[1]); ctx.lineTo(f[0], f[1]); ctx.closePath();
        };
        ctx.fillStyle = side ? b.wallY : b.wallX; ctx.beginPath(); quad(0, 1, 0, b.z); ctx.fill();
        const len = side ? b.w : b.h;
        if (b.kind === 'shop') {
          ctx.fillStyle = b.glass; ctx.beginPath(); quad(0.06, 0.94, 5, 24); ctx.fill();
          ctx.fillStyle = b.awning; ctx.beginPath(); quad(0.03, 0.97, 25, 32); ctx.fill();
          return;
        }
        const cols = Math.max(1, Math.floor(len / b.sp)), floors = Math.floor((b.z - 6) / b.fh);
        const ww = b.kind === 'sky' ? 0.36 : 0.3, top = b.kind === 'sky' ? 0.8 : 0.6;
        const lit = [], dark = [];
        for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
          (hash(b.id, wi + side * 5, f, c) < b.lit ? lit : dark).push([(c + 0.5 - ww) / cols, (c + 0.5 + ww) / cols, f * b.fh + b.fh * 0.25, f * b.fh + b.fh * top]);
        }
        ctx.fillStyle = b.glass; ctx.beginPath(); for (const q of dark) quad(...q); ctx.fill();
        ctx.fillStyle = '#ffe08a'; ctx.beginPath(); for (const q of lit) quad(...q); ctx.fill();
        if (b.kind === 'apt') {
          // Balconies under every other window.
          ctx.fillStyle = '#d8d0e8'; ctx.beginPath();
          for (const q of [...lit, ...dark]) if (Math.round(q[0] * cols) % 2 === 0 && q[2] > b.fh) quad(q[0] - 0.08 / cols, q[1] + 0.08 / cols, q[2] - 4, q[2] - 1);
          ctx.fill();
        } else {
          ctx.fillStyle = shade(b.wall, 1.25); ctx.beginPath(); quad(0, 1, b.z - 8, b.z); ctx.fill();
        }
      });
      // The roof
      const rx = X(x0, b.z), ry = Y(y0, b.z), rw = b.w * k, rh = b.h * k;
      ctx.drawImage(cached('chase-roof' + b.id, b.w * 1.3, b.h * 1.3, (g) => { g.scale(1.3, 1.3); paintRoof(g, b); }), rx, ry, rw, rh);
      if (b.antenna && (b.w < 110 || b.h < 110)) {
        const cx = x0 + b.w / 2, cy = y0 + b.h / 2, top = b.z + 60;
        ctx.strokeStyle = '#d8d0e8'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(X(cx, b.z), Y(cy, b.z)); ctx.lineTo(X(cx, top), Y(cy, top)); ctx.stroke();
        if (Math.floor(this.clock * 2) % 2) { ctx.fillStyle = '#ff3b5c'; ctx.beginPath(); ctx.arc(X(cx, top), Y(cy, top), 3, 0, Math.PI * 2); ctx.fill(); }
      }
    },
    near(c, pad) { return Math.abs(c.x - this.cam.x) < this.W / 2 + pad && Math.abs(c.y - this.cam.y) < this.H / 2 + pad; },
    // A car seen from above, pointing along its angle.
    car(c, police) {
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; rr(ctx, -13, -6, 30, 17, 5);
      if (police && c.wreck) ctx.globalAlpha = 0.75;
      ctx.fillStyle = police ? '#f4ecdc' : C.amber; rr(ctx, -15, -8.5, 30, 17, 5);
      if (police) { ctx.fillStyle = '#2c3e91'; ctx.fillRect(7, -8.5, 6, 17); ctx.fillRect(-14, -8.5, 4, 17); }
      else { ctx.fillStyle = C.pink; ctx.fillRect(-15, -3, 30, 2); ctx.fillRect(-15, 1, 30, 2); }
      ctx.fillStyle = '#2a2240'; rr(ctx, 2, -6.5, 5, 13, 2); rr(ctx, -10, -6, 3.5, 12, 1.5);
      ctx.fillStyle = police ? '#ddd3c0' : '#e0932a'; rr(ctx, -6.5, -6.5, 8.5, 13, 2);
      ctx.fillStyle = '#fff6c9'; ctx.fillRect(13, -7, 2, 3.5); ctx.fillRect(13, 3.5, 2, 3.5);
      ctx.fillStyle = '#ff3b5c'; ctx.fillRect(-15, -7, 1.5, 3.5); ctx.fillRect(-15, 3.5, 1.5, 3.5);
      if (police) {
        const red = Math.floor(c.flash * 6) % 2 === 0 && !c.wreck;
        ctx.fillStyle = red ? '#ff3b5c' : '#7a2032'; ctx.fillRect(-4, -7, 3.5, 7);
        ctx.fillStyle = !red && !c.wreck ? '#4f7dff' : '#22306b'; ctx.fillRect(-4, 0, 3.5, 7);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    },
    // Little arrows at the edge of the screen pointing at police cars you can't see yet.
    arrows(ox, oy) {
      const W = this.W, H = this.H;
      for (const c of this.cops) {
        if (c.wreck || this.near(c, 0)) continue;
        const sx = c.x + ox - W / 2, sy = c.y + oy - H / 2;
        const k = Math.min((W / 2 - 16) / Math.abs(sx || 1e-6), (H / 2 - 16) / Math.abs(sy || 1e-6));
        const x = W / 2 + sx * k, y = H / 2 + sy * k, a = Math.atan2(sy, sx);
        ctx.save(); ctx.translate(x, y); ctx.rotate(a);
        ctx.fillStyle = Math.floor(c.flash * 6) % 2 ? '#4f7dff' : '#ff3b5c';
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-7, -7); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    },
    hud() {
      const W = this.W, H = this.H;
      // Lives as hearts, top left.
      for (let k = 0; k < LIVES; k++) {
        const x = 18 + k * 24, y = 20;
        ctx.fillStyle = k < this.lives ? C.pink : 'rgba(42,34,64,0.9)';
        ctx.beginPath(); ctx.arc(x - 4, y - 2, 5, 0, Math.PI * 2); ctx.arc(x + 4, y - 2, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.lineTo(x, y + 9); ctx.closePath(); ctx.fill();
      }
      // Wanted level: one star for each police car hunting you (up to 5).
      const stars = Math.min(5, Math.ceil(this.cops.length * 5 / 8));
      for (let k = 0; k < 5; k++) {
        const x = W - 18 - k * 20, y = 20;
        ctx.fillStyle = 4 - k < stars ? C.amber : 'rgba(42,34,64,0.9)';
        ctx.beginPath();
        for (let p = 0; p < 10; p++) { const r = p % 2 ? 3.5 : 8.5, a = -Math.PI / 2 + p * Math.PI / 5; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
        ctx.closePath(); ctx.fill();
      }
      if (this.pl.boost > 0) {
        ctx.fillStyle = 'rgba(42,34,64,0.9)'; ctx.fillRect(8, 36, 80, 6);
        ctx.fillStyle = C.cyan; ctx.fillRect(8, 36, 80 * this.pl.boost / 3, 6);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const big = (text, col) => { ctx.font = font(22); ctx.fillStyle = '#15111f'; ctx.fillText(text, W / 2 + 3, H / 2 - 77); ctx.fillStyle = col; ctx.fillText(text, W / 2, H / 2 - 80); };
      if (this.freeze > 0) big('BUSTED!', C.pink);
      else if (this.t < 1.6) big('GET AWAY!', C.amber);
    },
  };

  Arcade.register('chase', chase);
})();
