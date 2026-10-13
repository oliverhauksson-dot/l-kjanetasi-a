/* Ski Runner. Loaded on demand by js/arcade.js the first time the game is opened.
   An endless zig-zag slope seen from the side. Each slope ends in a kicker that throws the
   skier forward over the edge and down onto the next slope, which sticks out a little further.
   They land, carve a hard turn in a spray of snow, and ski off the other way.
   Positions on a slope are kept as u (how far along it) and h (height above the snow). */
(() => {
  const { ctx, C, rand, clamp, cached, sfx, setScore, over } = Arcade;

  const LEFT = 46, RIGHT = 354;     // Slopes end between these two x values.
  const OUT = 32;                   // Each new slope starts this far out past the edge above it, so you land on it.
  const DROP = 46;                  // How far below a slope's end the next one starts.
  const LAND = 12;                  // Where on the new slope a turn jump lands.
  const CARVE = 0.2;                // Seconds the turn on the snow takes after landing.
  const KICK = 20;                  // Length of the kicker ramp at the end of each slope.
  const SNOW = '#e8eef7', LIGHT = '#ffffff', SHADE = '#b9c6dd', DEEP = '#8f9cc0', ROCK = '#5d5180', ROCK2 = '#463b66', ROCK3 = '#2e2645';

  const ski = {
    W: 400, H: 520, color: 'var(--cyan)', title: 'Ski Runner', label: 'Distance',
    intro: 'Ski down the endless mountain. Jump the rocks and trees. At the end of each slope you fly off the ramp and land on the next one. It keeps getting faster, steeper and tighter.',
    hint: '<kbd>Space</kbd> <kbd>↑</kbd> or tap to jump (hold for a higher jump), <kbd>P</kbd> to pause',

    reset() {
      this.t = 0; this.dist = 0; this.score = 0; this.speed = 150;
      this.held = false; this.h = 0; this.vy = 0; this.ground = true;
      this.turn = null; this.turns = 0; this.spray = []; this.carve = 0;
      this.slopes = [];
      this.addSlope({ x: LEFT, y: 120, d: 1, L: RIGHT - LEFT, slope: 0.3, obs: [] });
      this.fill();
      this.seg = 0; this.u = 30;
      this.camY = this.pos().y - this.H * 0.36;
    },

    /* ---------- The mountain ---------- */
    level() { return clamp(this.dist / 14000, 0, 1); }, // 0 at the top, 1 after 1400 m.
    endOf(s) { return { x: s.x + s.d * s.L, y: s.y + s.L * s.slope }; },
    addSlope(s) {
      // A ragged rock face under each slope, fixed when the slope is made so it doesn't flicker.
      s.jag = Array.from({ length: Math.ceil(s.L / 14) + 1 }, () => rand(18, 34));
      this.slopes.push(s); return s;
    },
    fill() {
      while (this.slopes.length < 5) {
        const prev = this.slopes[this.slopes.length - 1], e = this.endOf(prev), k = this.level();
        const d = -prev.d;
        // Tighter turns: slopes get shorter as you go.
        const want = rand(260 - 90 * k, 348 - 150 * k);
        const x = e.x - d * OUT, end = clamp(x + d * want, LEFT, RIGHT);
        const s = this.addSlope({ x, y: e.y + DROP, d, L: Math.abs(end - x), slope: 0.3 + 0.16 * k + rand(-0.03, 0.03), obs: [] });
        this.addObstacles(s, k);
      }
    },
    addObstacles(s, k) {
      // Leave enough room after each obstacle to land and jump again at the speed you'll have by then.
      const v = this.speed + 30;
      // Keep the landing and the carve after it clear.
      let u = LAND + v * CARVE + rand(60 - 25 * k, 110 - 40 * k);
      while (u < s.L - KICK - 26) {
        const r = Math.random();
        let o;
        if (k > 0.45 && r < 0.18) o = { kind: 'ball', w: 18, h: 18, roll: rand(50, 80) };
        else if (k > 0.25 && r < 0.38) o = { kind: 'rocks', w: 44, h: 16 };
        else if (k > 0.1 && r < 0.62) o = { kind: 'tree', w: 20, h: 40 };
        else o = { kind: 'rock', w: Math.round(rand(16, 24)), h: Math.round(rand(12, 18)) };
        o.u = u; s.obs.push(o);
        u += v * rand(0.62 - 0.12 * k, 1.25 - 0.3 * k) + o.w + 30;
        // Sometimes a second obstacle right behind the first, so one long jump clears both.
        if (k > 0.35 && Math.random() < 0.25 && u < s.L - KICK - 60) { s.obs.push({ kind: 'rock', w: 18, h: 14, u: o.u + o.w / 2 + 34 }); u += 40; }
      }
    },
    at(s, u) { return { x: s.x + s.d * u, y: s.y + u * s.slope }; },
    pos() {
      if (this.turn) return { x: this.turn.x, y: this.turn.y };
      const s = this.slopes[this.seg], p = this.at(s, this.u);
      return { x: p.x, y: p.y - this.h - this.kickLift() };
    },
    kickLift() { const s = this.slopes[this.seg]; return this.ground ? clamp((this.u - (s.L - KICK)) / KICK, 0, 1) * 9 : 0; },

    /* ---------- Input ---------- */
    jump() { if (this.ground && !this.turn) { this.vy = 470; this.ground = false; sfx.hop(); } },
    key(e, down) {
      if (!['Space', 'ArrowUp', 'KeyW'].includes(e.code)) return;
      if (down && !e.repeat) this.jump();
      this.held = down;
    },
    press(down) { if (down) this.jump(); this.held = down; },

    /* ---------- Game loop ---------- */
    update(dt) {
      this.t += dt;
      this.speed = Math.min(340, 150 + this.dist * 0.016);
      this.dist += this.speed * dt;

      // Rolling snowballs come up the slope toward you.
      for (const s of this.slopes) for (const o of s.obs) if (o.roll) o.u -= o.roll * dt;

      if (this.turn) this.updateTurn(dt);
      else {
        const s = this.slopes[this.seg];
        this.u += this.speed * dt;
        if (!this.ground) {
          this.vy -= (this.held && this.vy > 0 ? 1150 : 2100) * dt;
          this.h += this.vy * dt;
          if (this.h <= 0) { this.h = 0; this.vy = 0; this.ground = true; this.kick(6, 0.4); }
        }
        if (this.carve > 0) { this.carve = Math.max(0, this.carve - dt); this.kick(1, 0.9); }
        else if (this.ground && Math.random() < dt * 40) this.kick(1, 0.5);
        if (this.u >= s.L) this.startTurn();
        else {
          for (const o of s.obs) {
            if (Math.abs(o.u - this.u) < o.w / 2 + 6 && this.h < o.h - 3) {
              const what = o.kind === 'tree' ? 'a tree' : o.kind === 'ball' ? 'a snowball' : 'a rock';
              return over(this.score, 'You hit ' + what + ' after ' + this.score + ' m.');
            }
          }
        }
      }

      for (const f of this.spray) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 320 * dt; f.life -= dt; }
      this.spray = this.spray.filter((f) => f.life > 0);

      const target = this.pos().y - this.H * 0.36;
      this.camY += (target - this.camY) * Math.min(1, dt * 5);
      const sc = Math.floor(this.dist / 10);
      if (sc !== this.score) { this.score = sc; setScore(sc); }
    },
    // Little bits of snow thrown up behind the skis.
    kick(n, power) {
      const p = this.pos(), d = this.turn ? this.turn.d : this.slopes[this.seg].d;
      for (let i = 0; i < n; i++) this.spray.push({ x: p.x - d * rand(6, 14), y: p.y - 1, vx: -d * rand(20, 90) * power + rand(-30, 30) * (1 - power), vy: -rand(30, 110) * power - 20, life: rand(0.25, 0.5) });
    },
    startTurn() {
      const from = this.pos(), cur = this.slopes[this.seg], next = this.slopes[this.seg + 1], to = this.at(next, LAND);
      // Off the ramp, a little hop up, then forward and down onto the next slope.
      // Faster skiing makes it a little shorter, so the next slope comes at you quicker.
      this.turn = {
        t: 0, T: clamp(0.62 - (this.speed - 150) * 0.001, 0.45, 0.62), d: cur.d,
        fx: from.x, fy: from.y, cx: from.x + cur.d * 14, cy: from.y - 34, tx: to.x, ty: to.y,
        a0: Math.atan(cur.slope), a1: -Math.atan(next.slope), x: from.x, y: from.y,
      };
      this.h = 0; this.vy = 0; this.ground = true;
      sfx.tone(520, 0.18, 'square', 0.04, 1040);
    },
    updateTurn(dt) {
      const tr = this.turn;
      tr.t += dt;
      const p = Math.min(1, tr.t / tr.T);
      // Always moving forward, so the jump never looks like it hits something.
      const q = 1 - p;
      tr.x = q * q * tr.fx + 2 * q * p * tr.cx + p * p * tr.tx;
      tr.y = q * q * tr.fy + 2 * q * p * tr.cy + p * p * tr.ty;
      if (p >= 1) {
        this.turn = null; this.seg++; this.u = LAND; this.turns++; this.carve = CARVE;
        sfx.hit(); this.kick(14, 0.7);
        // Forget slopes far above the screen and build more below.
        if (this.seg > 2) { this.slopes.shift(); this.seg--; }
        this.fill();
      }
    },

    /* ---------- Drawing ---------- */
    draw() {
      this.drawSky();
      ctx.save();
      ctx.translate(0, -Math.round(this.camY));
      for (const s of this.slopes) this.drawSlope(s);
      for (const s of this.slopes) for (const o of s.obs) this.drawObstacle(s, o);
      this.drawShadow();
      this.drawSkier();
      ctx.fillStyle = LIGHT;
      for (const f of this.spray) { ctx.globalAlpha = Math.min(1, f.life * 3); ctx.fillRect(Math.round(f.x), Math.round(f.y), 2, 2); }
      ctx.globalAlpha = 1;
      ctx.restore();
      this.drawSnowfall();
    },
    drawSky() {
      const { W, H } = this;
      // The far background never changes, so it is painted once and reused.
      ctx.drawImage(cached('ski-sky', W, H, (g) => {
        const sky = g.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, '#0d0a15'); sky.addColorStop(0.6, '#1b1533'); sky.addColorStop(1, '#2a2148');
        g.fillStyle = sky; g.fillRect(0, 0, W, H);
        g.fillStyle = '#f4ecdc';
        for (let i = 0; i < 34; i++) g.fillRect((i * 157) % W, (i * 89) % (H * 0.6), i % 4 ? 1 : 2, i % 4 ? 1 : 2);
        g.fillStyle = '#ffe6b3'; g.beginPath(); g.arc(W - 64, 64, 18, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#f0d49a'; g.fillRect(W - 72, 56, 6, 6); g.fillRect(W - 60, 70, 4, 4);
        // Two rows of mountains with snowy tops.
        const range = (base, peaks, col, cap) => {
          for (const [x, w, h] of peaks) {
            g.fillStyle = col; g.beginPath(); g.moveTo(x - w, base); g.lineTo(x, base - h); g.lineTo(x + w, base); g.closePath(); g.fill();
            g.fillStyle = cap; g.beginPath(); g.moveTo(x - w * 0.3, base - h * 0.7); g.lineTo(x, base - h); g.lineTo(x + w * 0.3, base - h * 0.7);
            g.lineTo(x + w * 0.12, base - h * 0.76); g.lineTo(x, base - h * 0.68); g.lineTo(x - w * 0.14, base - h * 0.77); g.closePath(); g.fill();
          }
          g.fillStyle = col; g.fillRect(0, base, W, H - base);
        };
        range(H * 0.62, [[40, 110, 150], [170, 120, 210], [310, 130, 170], [420, 90, 120]], '#2b2346', '#6f6a94');
        range(H * 0.8, [[-10, 90, 90], [110, 100, 130], [250, 110, 100], [380, 90, 140]], '#211a38', '#57527a');
        // A line of pine trees at the foot of the near mountains.
        g.fillStyle = '#17122a';
        for (let x = -4; x < W + 8; x += 9) {
          const h = 14 + ((x * 37) % 13);
          g.beginPath(); g.moveTo(x - 5, H * 0.8 + 4); g.lineTo(x, H * 0.8 + 4 - h); g.lineTo(x + 5, H * 0.8 + 4); g.closePath(); g.fill();
        }
        g.fillRect(0, H * 0.8 + 4, W, H);
      }), 0, 0, W, H);
    },
    drawSnowfall() {
      const { W, H } = this;
      ctx.fillStyle = 'rgba(244,236,220,.7)';
      for (let i = 0; i < 40; i++) {
        const sp = 30 + (i % 5) * 12;
        const y = ((i * 71 + this.t * sp - this.camY * 0.5) % H + H) % H;
        const x = ((i * 113 + Math.sin(this.t + i) * 12) % W + W) % W;
        ctx.fillRect(x, y, i % 3 ? 2 : 3, i % 3 ? 2 : 3);
      }
    },
    drawSlope(s) {
      const a = { x: s.x, y: s.y }, b = this.endOf(s), top = this.camY - 40, bottom = this.camY + this.H + 40;
      if (b.y < top - 60 || a.y > bottom) return;
      const n = s.jag.length - 1;
      // Rock face under the snow with a ragged bottom edge.
      ctx.fillStyle = ROCK2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      for (let i = n; i >= 0; i--) { const p = this.at(s, s.L * i / n); ctx.lineTo(p.x, p.y + s.jag[i] + (i === n ? 10 : 0)); }
      ctx.closePath(); ctx.fill();
      // Darker cracks and lighter ledges in the rock.
      for (let i = 0; i < n; i++) {
        const p = this.at(s, s.L * (i + 0.5) / n);
        ctx.fillStyle = i % 2 ? ROCK3 : ROCK;
        ctx.fillRect(Math.round(p.x) - 3, Math.round(p.y + 15 + (i * 7) % 9), 7, 2);
      }
      ctx.fillStyle = ROCK;
      ctx.beginPath(); ctx.moveTo(b.x, b.y + 10); ctx.lineTo(b.x, b.y + s.jag[n] + 10); ctx.lineTo(b.x - s.d * 22, b.y + 18); ctx.closePath(); ctx.fill();
      // Snow: a bright top, the snow pack, and a shaded underside with drips over the rock.
      const band = (y0, y1, col) => {
        ctx.fillStyle = col; ctx.beginPath();
        ctx.moveTo(a.x, a.y + y0); ctx.lineTo(b.x, b.y + y0); ctx.lineTo(b.x, b.y + y1); ctx.lineTo(a.x, a.y + y1); ctx.closePath(); ctx.fill();
      };
      band(0, 13, SNOW); band(8, 11, SHADE); band(11, 13, DEEP); band(0, 2, LIGHT);
      // Lumpy snow hanging over the edge of the rock.
      for (let i = 0; i < n; i++) {
        const p = this.at(s, s.L * (i + 0.5) / n), w = 4 + Math.round(s.jag[i]) % 7, h = 1 + Math.round(s.jag[i + 1]) % 4;
        ctx.fillStyle = DEEP; ctx.fillRect(Math.round(p.x - w / 2), Math.round(p.y + 12), w, h + 1);
        ctx.fillStyle = SHADE; ctx.fillRect(Math.round(p.x - w / 2), Math.round(p.y + 11), w, h);
      }
      // Sparkles in the snow.
      ctx.fillStyle = LIGHT;
      for (let i = 0; i < n; i += 3) { const p = this.at(s, s.L * (i + 0.3) / n); ctx.fillRect(Math.round(p.x), Math.round(p.y + 5), 1, 1); }
      // Kicker ramp and a flag at the end of the slope.
      const k = this.at(s, s.L - KICK);
      ctx.fillStyle = SNOW;
      ctx.beginPath(); ctx.moveTo(k.x, k.y); ctx.quadraticCurveTo(b.x - s.d * 6, b.y, b.x, b.y - 9); ctx.lineTo(b.x, b.y + 4); ctx.lineTo(k.x, k.y + 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = SHADE; ctx.fillRect(Math.min(b.x, b.x - s.d * 2), b.y - 8, 2, 12);
      ctx.fillStyle = C.muted; ctx.fillRect(b.x - s.d * 4 - 1, b.y - 40, 2, 40);
      ctx.fillStyle = (this.slopes.indexOf(s) + this.turns) % 2 ? C.pink : C.amber;
      ctx.beginPath(); ctx.moveTo(b.x - s.d * 4, b.y - 40); ctx.lineTo(b.x - s.d * 4 + s.d * 14, b.y - 35); ctx.lineTo(b.x - s.d * 4, b.y - 30); ctx.closePath(); ctx.fill();
    },
    drawObstacle(s, o) {
      if (o.u < -12 || o.u > s.L) return;
      const p = this.at(s, o.u), x = p.x, y = p.y + 2;
      if (o.kind === 'tree') {
        ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x - 3, y - 8, 6, 8);
        ctx.fillStyle = '#3f8f5a';
        for (let i = 0; i < 3; i++) {
          const ty = y - 8 - i * 10, hw = 10 - i * 2.5;
          ctx.beginPath(); ctx.moveTo(x - hw, ty); ctx.lineTo(x + hw, ty); ctx.lineTo(x, ty - 16); ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = SNOW; ctx.fillRect(x - 2, y - o.h - 2, 4, 4);
      } else if (o.kind === 'ball') {
        const r = o.h / 2;
        ctx.fillStyle = SNOW; ctx.beginPath(); ctx.arc(x, y - r, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = SHADE; const a = -o.u / r * s.d;
        ctx.fillRect(x + Math.cos(a) * r * 0.5 - 2, y - r + Math.sin(a) * r * 0.5 - 2, 4, 4);
        ctx.fillRect(x - Math.cos(a) * r * 0.5 - 2, y - r - Math.sin(a) * r * 0.5 - 2, 4, 4);
      } else {
        const lumps = o.kind === 'rocks' ? [[-o.w / 2 + 11, 11, o.h], [o.w / 2 - 11, 11, o.h - 3]] : [[0, o.w / 2, o.h]];
        for (const [dx, hw, hh] of lumps) {
          ctx.fillStyle = '#8a82a3';
          ctx.beginPath(); ctx.moveTo(x + dx - hw, y); ctx.lineTo(x + dx - hw * 0.6, y - hh); ctx.lineTo(x + dx + hw * 0.5, y - hh); ctx.lineTo(x + dx + hw, y); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#5d5675'; ctx.fillRect(x + dx + hw * 0.1, y - hh + 3, hw * 0.5, hh - 3);
          ctx.fillStyle = SNOW; ctx.fillRect(x + dx - hw * 0.6, y - hh, hw * 1.1, 3);
        }
      }
    },
    // A soft shadow on the snow while you are in the air over an obstacle.
    drawShadow() {
      if (this.turn || this.ground) return;
      const s = this.slopes[this.seg], p = this.at(s, this.u), w = clamp(16 - this.h * 0.12, 6, 16);
      ctx.fillStyle = 'rgba(60,70,110,.35)';
      ctx.save(); ctx.translate(p.x, p.y + 1); ctx.rotate(Math.atan(s.slope) * s.d);
      ctx.fillRect(-w, -1, w * 2, 3); ctx.restore();
    },
    drawSkier() {
      const p = this.pos();
      let face, ski, tuck;
      if (this.turn) {
        const q = Math.min(1, this.turn.t / this.turn.T);
        // Still facing forward in the air: tips up off the ramp, then down to meet the slope below.
        face = this.turn.d;
        ski = this.turn.a0 + (this.turn.a1 - this.turn.a0) * q - 0.45 * Math.sin(Math.PI * q);
        tuck = 5;
      } else if (this.carve > 0) {
        // Carving round on the snow: the skier swings from the old direction to the new one.
        const s = this.slopes[this.seg], q = 1 - this.carve / CARVE;
        face = -s.d * Math.cos(Math.PI * q);
        if (Math.abs(face) < 0.25) face = face < 0 ? -0.25 : 0.25;
        ski = Math.atan(s.slope) * Math.sign(face) * s.d;
        tuck = 6;
      } else {
        const s = this.slopes[this.seg];
        face = s.d;
        ski = Math.atan(s.slope) - (this.ground ? clamp((this.u - (s.L - KICK)) / KICK, 0, 1) * 0.5 : 0.2);
        tuck = this.ground ? 2 + Math.round(Math.sin(this.t * 7) * 0.8) : 4;
      }
      ctx.save();
      ctx.translate(Math.round(p.x), Math.round(p.y));
      ctx.scale(face, 1); ctx.rotate(ski);
      ctx.fillStyle = C.amber; ctx.fillRect(-15, -3, 30, 3); ctx.fillRect(14, -5, 3, 3);   // skis, tips up
      // The body stays fairly upright over the skis, leaning forward into the slope.
      ctx.rotate(-ski * 0.65 + 0.12);
      ctx.fillStyle = '#1d1630'; ctx.fillRect(-3, -7, 7, 4);                                  // boots
      ctx.fillStyle = '#3a3052'; ctx.fillRect(-1, -13 + tuck * 0.4, 5, 7);                    // shins
      ctx.fillRect(-4, -19 + tuck, 7, 7);                                                     // thighs
      ctx.fillStyle = C.cyan; ctx.fillRect(-4, -31 + tuck, 11, 13);                           // jacket
      ctx.fillStyle = '#2fb3b8'; ctx.fillRect(-4, -21 + tuck, 11, 2);                         // belt
      ctx.fillStyle = C.cyan; ctx.fillRect(4, -27 + tuck, 7, 4);                              // arm reaching forward
      ctx.fillStyle = '#f4d3b5'; ctx.fillRect(-1, -38 + tuck, 8, 7);                          // face
      ctx.fillStyle = C.amber; ctx.fillRect(1, -36 + tuck, 7, 2);                             // goggles
      ctx.fillStyle = C.pink; ctx.fillRect(-2, -42 + tuck, 9, 5); ctx.fillRect(-5, -41 + tuck, 3, 3); // hat and bobble
      // Pole from the hand back to the snow behind.
      ctx.strokeStyle = C.muted; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(10, -25 + tuck); ctx.lineTo(-10, -2); ctx.stroke();
      ctx.restore();
    },
  };

  Arcade.register('runner', ski);
})();
