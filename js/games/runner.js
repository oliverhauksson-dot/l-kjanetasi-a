/* Ski Runner. Loaded on demand by js/arcade.js the first time the game is opened.
   An endless zig-zag slope seen from the side. Each slope ends in a kicker that throws the
   skier into a spin, landing on the next slope below going the other way.
   Positions on a slope are kept as u (how far along it) and h (height above the snow). */
(() => {
  const { ctx, C, rand, clamp, sfx, setScore, over } = Arcade;

  const LEFT = 26, RIGHT = 374;     // The slopes zig-zag between these two x values.
  const DROP = 46;                  // How far below a slope's end the next one starts.
  const LAND = 34;                  // Where on the new slope a turn jump lands.
  const KICK = 20;                  // Length of the kicker ramp at the end of each slope.
  const SNOW = '#e8eef7', SHADE = '#b9c6dd', ROCK = '#2a2240', ROCK2 = '#1d1630';

  const ski = {
    W: 400, H: 520, color: 'var(--cyan)', title: 'Ski Runner', label: 'Distance',
    intro: 'Ski down the endless mountain. Jump the rocks and trees. At the end of each slope you fly off the ramp and land on the next one. It keeps getting faster, steeper and tighter.',
    hint: '<kbd>Space</kbd> <kbd>↑</kbd> or tap to jump (hold for a higher jump), <kbd>P</kbd> to pause',

    reset() {
      this.t = 0; this.dist = 0; this.score = 0; this.speed = 150;
      this.held = false; this.h = 0; this.vy = 0; this.ground = true;
      this.turn = null; this.turns = 0;
      this.slopes = [];
      this.addSlope({ x: LEFT, y: 120, d: 1, L: RIGHT - LEFT, slope: 0.3, obs: [] });
      this.fill();
      this.seg = 0; this.u = 30;
      this.camY = this.pos().y - this.H * 0.36;
    },

    /* ---------- The mountain ---------- */
    level() { return clamp(this.dist / 14000, 0, 1); }, // 0 at the top, 1 after 1400 m.
    endOf(s) { return { x: s.x + s.d * s.L, y: s.y + s.L * s.slope }; },
    addSlope(s) { this.slopes.push(s); return s; },
    fill() {
      while (this.slopes.length < 5) {
        const prev = this.slopes[this.slopes.length - 1], e = this.endOf(prev), k = this.level();
        const d = -prev.d;
        // Tighter turns: slopes get shorter as you go.
        const want = rand(260 - 90 * k, 348 - 150 * k);
        const end = clamp(e.x + d * want, LEFT, RIGHT);
        const s = this.addSlope({ x: e.x, y: e.y + DROP, d, L: Math.abs(end - e.x), slope: 0.3 + 0.16 * k + rand(-0.03, 0.03), obs: [] });
        this.addObstacles(s, k);
      }
    },
    addObstacles(s, k) {
      // Leave enough room after each obstacle to land and jump again at the speed you'll have by then.
      const v = this.speed + 30;
      let u = LAND + rand(70 - 40 * k, 120 - 50 * k);
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
          if (this.h <= 0) { this.h = 0; this.vy = 0; this.ground = true; }
        }
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

      const target = this.pos().y - this.H * 0.36;
      this.camY += (target - this.camY) * Math.min(1, dt * 5);
      const sc = Math.floor(this.dist / 10);
      if (sc !== this.score) { this.score = sc; setScore(sc); }
    },
    startTurn() {
      const from = this.pos(), next = this.slopes[this.seg + 1], to = this.at(next, LAND);
      // Faster skiing makes the flight a little shorter, so the next slope comes at you quicker.
      this.turn = { t: 0, T: clamp(0.72 - (this.speed - 150) * 0.0012, 0.5, 0.72), fx: from.x, fy: from.y, tx: to.x, ty: to.y, d: next.d, x: from.x, y: from.y };
      this.h = 0; this.vy = 0; this.ground = true;
      sfx.tone(520, 0.18, 'square', 0.04, 1040);
    },
    updateTurn(dt) {
      const tr = this.turn;
      tr.t += dt;
      const p = Math.min(1, tr.t / tr.T);
      // Up off the ramp, over the edge and down onto the next slope.
      tr.x = tr.fx + (tr.tx - tr.fx) * p;
      tr.y = tr.fy + (tr.ty - tr.fy) * p * p - 70 * Math.sin(Math.PI * p);
      if (p >= 1) {
        this.turn = null; this.seg++; this.u = LAND; this.turns++;
        sfx.hit();
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
      this.drawSkier();
      ctx.restore();
      this.drawSnowfall();
    },
    drawSky() {
      const { W, H } = this;
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#f4ecdc';
      for (let i = 0; i < 26; i++) { const x = (i * 157) % W, y = ((i * 89 - this.camY * 0.03) % H + H) % H; ctx.fillRect(x, y, 2, 2); }
      ctx.fillStyle = '#ffe6b3'; ctx.beginPath(); ctx.arc(W - 64, 64, 20, 0, Math.PI * 2); ctx.fill();
      // Far-off mountains behind the slope.
      const peaks = (base, amp, step, col, seed) => {
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, H);
        for (let x = 0; x <= W + step; x += step) ctx.lineTo(x, base - amp * (0.4 + 0.6 * Math.abs(Math.sin(x / step * 1.7 + seed))));
        ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      };
      peaks(H * 0.55, 120, 70, '#1d1630', 1);
      peaks(H * 0.75, 90, 50, '#251c3a', 2);
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
      // Rock under the snow, then a thick layer of snow.
      ctx.fillStyle = ROCK2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x, b.y + 40); ctx.lineTo(a.x, a.y + 26); ctx.closePath(); ctx.fill();
      ctx.fillStyle = ROCK;
      ctx.beginPath(); ctx.moveTo(b.x, b.y + 12); ctx.lineTo(b.x, b.y + 40); ctx.lineTo(b.x - s.d * 26, b.y + 30); ctx.closePath(); ctx.fill();
      ctx.fillStyle = SNOW;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x, b.y + 12); ctx.lineTo(a.x, a.y + 12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = SHADE;
      ctx.beginPath(); ctx.moveTo(a.x, a.y + 8); ctx.lineTo(b.x, b.y + 8); ctx.lineTo(b.x, b.y + 12); ctx.lineTo(a.x, a.y + 12); ctx.closePath(); ctx.fill();
      // Kicker ramp and a flag at the end of the slope.
      const k = this.at(s, s.L - KICK);
      ctx.fillStyle = SNOW;
      ctx.beginPath(); ctx.moveTo(k.x, k.y); ctx.lineTo(b.x, b.y - 9); ctx.lineTo(b.x, b.y + 2); ctx.closePath(); ctx.fill();
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
    drawSkier() {
      const p = this.pos();
      let d, ang;
      if (this.turn) {
        const q = Math.min(1, this.turn.t / this.turn.T);
        d = q < 0.5 ? -this.turn.d : this.turn.d;
        ang = q * Math.PI * 2; // One full spin in the air.
      } else {
        const s = this.slopes[this.seg];
        d = s.d; ang = Math.atan(s.slope) - (this.ground ? clamp((this.u - (s.L - KICK)) / KICK, 0, 1) * 0.5 : 0.15);
      }
      ctx.save();
      ctx.translate(Math.round(p.x), Math.round(p.y));
      ctx.scale(d, 1); ctx.rotate(ang);
      const crouch = this.ground && !this.turn ? Math.sin(this.t * 9) * 1 : -2;
      ctx.fillStyle = C.amber; ctx.fillRect(-15, -2, 30, 3); ctx.fillRect(13, -4, 3, 3);   // skis
      ctx.fillStyle = '#3a3052'; ctx.fillRect(-5, -12 + crouch, 4, 10); ctx.fillRect(1, -12 + crouch, 4, 10); // legs
      ctx.fillStyle = C.cyan; ctx.fillRect(-6, -26 + crouch, 12, 15);   // jacket
      ctx.fillStyle = '#f4d3b5'; ctx.fillRect(-3, -33 + crouch, 9, 7);  // face
      ctx.fillStyle = C.pink; ctx.fillRect(-4, -37 + crouch, 10, 5); ctx.fillRect(-7, -36 + crouch, 3, 3); // hat
      ctx.fillStyle = C.bg; ctx.fillRect(3, -31 + crouch, 2, 2);
      ctx.fillStyle = C.muted; ctx.fillRect(-10, -20 + crouch, 2, 18);  // pole
      ctx.restore();
    },
  };

  Arcade.register('runner', ski);
})();
