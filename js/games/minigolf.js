/* Minigolf. Loaded on demand by js/arcade.js the first time the game is opened.
   Nine holes seen from above. Pull back and let go to putt (like a slingshot), or aim with the arrow keys.
   The score is the total number of shots for the round, so fewer is better. A hole stops at 7 shots.
   Water costs one extra shot and puts the ball back where it was. Sand slows the ball down. */
(() => {
  const { ctx, C, clamp, font, sfx, setScore, over, tween, pop, shake } = Arcade;

  const W = 380, H = 580, R = 6, CUP = 10, MAX_SHOTS = 7, MAX_SPEED = 900, PULL = 130;
  // A hole: the outline the ball stays inside, solid blocks, sand, water, round bumpers and a spinning windmill bar.
  // Rectangles are [x, y, width, height]. Bumpers are [x, y, radius].
  const rectPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const HOLES = [
    { par: 2, tee: [190, 500], cup: [190, 130], outline: rectPts(120, 80, 140, 470) },
    { par: 3, tee: [115, 500], cup: [275, 130], outline: [[60, 550], [170, 550], [170, 190], [330, 190], [330, 80], [60, 80]] },
    { par: 3, tee: [190, 500], cup: [190, 125], outline: rectPts(70, 80, 240, 470), blocks: [[140, 280, 100, 34]], sand: [[130, 160, 120, 34]] },
    { par: 3, tee: [125, 500], cup: [135, 130], outline: rectPts(70, 80, 240, 470), water: [[70, 250, 160, 100]], sand: [[230, 330, 80, 40]] },
    { par: 2, tee: [190, 500], cup: [190, 125], outline: [[110, 550], [270, 550], [270, 380], [310, 340], [310, 260], [270, 220], [270, 80], [110, 80], [110, 220], [70, 260], [70, 340], [110, 380]], spin: { x: 190, y: 300, len: 78, speed: 1.5 } },
    { par: 3, tee: [290, 500], cup: [240, 130], outline: rectPts(50, 80, 280, 470), blocks: [[50, 380, 205, 16], [125, 250, 205, 16]], sand: [[50, 80, 70, 70]] },
    { par: 3, tee: [190, 505], cup: [190, 120], outline: [[130, 550], [250, 550], [320, 470], [320, 160], [250, 80], [130, 80], [60, 160], [60, 470]], bumpers: [[190, 380, 16], [130, 290, 14], [250, 290, 14], [190, 210, 16], [120, 180, 10], [260, 180, 10]] },
    { par: 3, tee: [190, 510], cup: [190, 120], outline: rectPts(60, 80, 260, 470), water: [[60, 200, 110, 210], [210, 200, 110, 210]], sand: [[160, 150, 60, 26]] },
    { par: 4, tee: [115, 500], cup: [265, 480], outline: rectPts(50, 80, 280, 470), blocks: [[180, 190, 20, 360]], spin: { x: 190, y: 135, len: 36, speed: -2 }, sand: [[230, 330, 100, 40]] },
  ];
  const PAR = HOLES.reduce((s, h) => s + h.par, 0);
  const NAMES = { '-3': 'ALBATROSS!', '-2': 'EAGLE!', '-1': 'BIRDIE!', 0: 'PAR', 1: 'BOGEY', 2: 'DOUBLE BOGEY' };

  // Turns a hole into the straight wall pieces the ball bounces off.
  function segmentsOf(h) {
    const segs = [], ring = (pts) => pts.forEach((p, i) => segs.push([p, pts[(i + 1) % pts.length]]));
    ring(h.outline);
    (h.blocks || []).forEach((b) => ring(rectPts(...b)));
    return segs;
  }
  const inRect = (x, y, r) => x > r[0] && x < r[0] + r[2] && y > r[1] && y < r[1] + r[3];
  function closest(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const t = l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0;
    return [ax + dx * t, ay + dy * t];
  }

  const golf = {
    W, H, color: 'var(--lime)', title: 'Minigolf', label: 'Shots', lowerWins: true, quietScore: true,
    intro: 'Pull back and let go to putt. Sink all 9 holes in as few shots as you can.',
    hint: 'Drag back from anywhere and let go to putt. Or <kbd>←</kbd><kbd>→</kbd> to aim, <kbd>↑</kbd><kbd>↓</kbd> for power, <kbd>Space</kbd> to putt. <kbd>P</kbd> to pause',
    reset() {
      this.total = 0; this.cards = []; this.t = 0; this.keys = {};
      this.start(0);
    },
    start(n) {
      const h = HOLES[n];
      this.n = n; this.hole = h; this.segs = segmentsOf(h);
      this.ball = { x: h.tee[0], y: h.tee[1], vx: 0, vy: 0, s: 1 };
      this.safe = { x: h.tee[0], y: h.tee[1] };
      this.shots = 0; this.moving = false; this.sunk = false; this.wait = 0;
      this.aim = { a: Math.atan2(h.cup[1] - h.tee[1], h.cup[0] - h.tee[0]), p: 0.45 };
      this.drag = null; this.spinA = 0; this.fade = { a: 1 };
      tween(this.fade, { a: 0 }, 500, { ease: 'in', delay: 350 });
    },
    ready() { return !this.moving && !this.sunk && !this.wait; },
    shoot(angle, power) {
      if (!this.ready() || power < 0.04) return;
      const sp = power * MAX_SPEED;
      this.safe = { x: this.ball.x, y: this.ball.y };
      this.ball.vx = Math.cos(angle) * sp; this.ball.vy = Math.sin(angle) * sp;
      this.moving = true; this.shots++; this.total++; setScore(this.total);
      sfx.tone(180 + power * 260, 0.06, 'triangle', 0.08);
    },
    key(e, down) {
      this.keys[e.code] = down;
      if (down && !e.repeat && (e.code === 'Space' || e.code === 'Enter')) this.shoot(this.aim.a, this.aim.p);
    },
    // Mouse and touch: press, pull back, let go. The pull can start anywhere on the screen.
    press(down) {
      if (down) { this.drag = this.ready() ? { from: null, to: null } : null; return; }
      const d = this.drag; this.drag = null;
      if (!d || !d.from || !d.to) return;
      const dx = d.from.x - d.to.x, dy = d.from.y - d.to.y, len = Math.hypot(dx, dy);
      if (len > 8) this.shoot(Math.atan2(dy, dx), Math.min(len / PULL, 1));
    },
    point(p) {
      const d = this.drag; if (!d) return;
      if (!d.from) d.from = p; else d.to = p;
      if (d.to) {
        const dx = d.from.x - d.to.x, dy = d.from.y - d.to.y, len = Math.hypot(dx, dy);
        if (len > 8) this.aim = { a: Math.atan2(dy, dx), p: Math.min(len / PULL, 1) };
      }
    },
    update(dt) {
      this.t += dt;
      const h = this.hole, b = this.ball;
      if (h.spin) this.spinA += h.spin.speed * dt;
      if (this.ready()) {
        if (this.keys.ArrowLeft || this.keys.KeyA) this.aim.a -= 2.2 * dt;
        if (this.keys.ArrowRight || this.keys.KeyD) this.aim.a += 2.2 * dt;
        if (this.keys.ArrowUp || this.keys.KeyW) this.aim.p = Math.min(1, this.aim.p + 0.8 * dt);
        if (this.keys.ArrowDown || this.keys.KeyS) this.aim.p = Math.max(0.05, this.aim.p - 0.8 * dt);
      }
      if (this.wait) {
        this.wait -= dt;
        if (this.wait <= 0) { this.wait = 0; this.next(); }
        return;
      }
      if (this.sunk) return;
      // The windmill bar can push a ball that is lying still, too.
      if (!this.moving && h.spin && this.hitSpinner(b)) this.moving = true;
      if (!this.moving) return;
      // Move in small steps so a fast ball can't slip through a thin wall.
      const sp = Math.hypot(b.vx, b.vy), steps = Math.max(1, Math.ceil(sp * dt / 2)), sdt = dt / steps;
      for (let i = 0; i < steps; i++) {
        b.x += b.vx * sdt; b.y += b.vy * sdt;
        for (const [p, q] of this.segs) this.bounce(b, p, q, 0.72);
        for (const [x, y, r] of h.bumpers || []) {
          const dx = b.x - x, dy = b.y - y, d = Math.hypot(dx, dy);
          if (d < r + R && d > 0) {
            const nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
            b.x = x + nx * (r + R); b.y = y + ny * (r + R);
            if (vn < 0) { b.vx -= 2.15 * vn * nx; b.vy -= 2.15 * vn * ny; sfx.tone(660, 0.05, 'square', 0.04); }
          }
        }
        if (h.spin) this.hitSpinner(b);
      }
      // Rolling slows the ball; sand slows it a lot more.
      const sandy = (h.sand || []).some((r) => inRect(b.x, b.y, r));
      let v = Math.hypot(b.vx, b.vy);
      if (v > MAX_SPEED * 1.2) { b.vx *= MAX_SPEED * 1.2 / v; b.vy *= MAX_SPEED * 1.2 / v; v = MAX_SPEED * 1.2; }
      const slow = (sandy ? 520 : 70) + v * (sandy ? 2.2 : 0.75);
      const nv = Math.max(0, v - slow * dt);
      if (v > 0) { b.vx *= nv / v; b.vy *= nv / v; }
      // The cup: a slow enough ball drops in, a fast one only gets nudged.
      const cx = h.cup[0] - b.x, cy = h.cup[1] - b.y, cd = Math.hypot(cx, cy);
      if (cd < CUP) {
        if (nv < 340) return this.sink();
        b.vx += cx / cd * 900 * dt; b.vy += cy / cd * 900 * dt;
      } else if (cd < CUP + 6 && nv < 120) { b.vx += cx / cd * 500 * dt; b.vy += cy / cd * 500 * dt; }
      if ((h.water || []).some((r) => inRect(b.x, b.y, r))) return this.splash();
      if (nv < 6) { b.vx = 0; b.vy = 0; this.moving = false; this.afterShot(); }
    },
    bounce(b, p, q, e, vq) {
      const [qx, qy] = closest(b.x, b.y, p[0], p[1], q[0], q[1]);
      const dx = b.x - qx, dy = b.y - qy, d = Math.hypot(dx, dy);
      const reach = R + (vq ? 4 : 0);
      if (d >= reach || d === 0) return false;
      const nx = dx / d, ny = dy / d;
      b.x = qx + nx * reach; b.y = qy + ny * reach;
      const rvx = b.vx - (vq ? vq[0] : 0), rvy = b.vy - (vq ? vq[1] : 0), vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
        if (-vn > 120) sfx.hit();
      }
      return true;
    },
    spinnerEnds() {
      const s = this.hole.spin, c = Math.cos(this.spinA) * s.len, n = Math.sin(this.spinA) * s.len;
      return [[s.x - c, s.y - n], [s.x + c, s.y + n]];
    },
    hitSpinner(b) {
      const s = this.hole.spin, [p, q] = this.spinnerEnds();
      const [qx, qy] = closest(b.x, b.y, p[0], p[1], q[0], q[1]);
      // How fast the bar is moving where it touches the ball.
      const vq = [-(qy - s.y) * s.speed, (qx - s.x) * s.speed];
      return this.bounce(b, p, q, 0.6, vq);
    },
    splash() {
      const b = this.ball;
      sfx.tone(140, 0.35, 'sawtooth', 0.05, 60); shake(4, 260);
      pop(b.x, b.y - 10, 'SPLASH +1', C.cyan, 10);
      const add = this.shots < MAX_SHOTS ? 1 : 0; // The extra shot never goes past the 7-shot limit.
      this.shots += add; this.total += add; setScore(this.total);
      b.x = this.safe.x; b.y = this.safe.y; b.vx = 0; b.vy = 0; this.moving = false;
      b.s = 0; tween(b, { s: 1 }, 300, { ease: 'back' });
      this.afterShot();
    },
    afterShot() {
      if (this.shots >= MAX_SHOTS && !this.sunk) {
        pop(this.ball.x, this.ball.y - 14, 'MAX ' + MAX_SHOTS, C.pink, 10);
        this.cards.push(this.shots); this.wait = 1.2; sfx.lose();
      }
    },
    sink() {
      const b = this.ball, h = this.hole;
      this.sunk = true; this.moving = false; b.vx = 0; b.vy = 0;
      tween(b, { x: h.cup[0], y: h.cup[1], s: 0.4 }, 220, { ease: 'in' });
      this.cards.push(this.shots);
      const diff = this.shots - h.par;
      const word = this.shots === 1 ? 'HOLE IN ONE!' : (NAMES[diff] || '+' + diff);
      pop(h.cup[0], h.cup[1] - 22, word, this.shots === 1 ? C.amber : diff < 0 ? C.lime : C.ink, this.shots === 1 ? 13 : 11);
      if (diff < 0) sfx.win(); else sfx.tone(784, 0.18, 'triangle', 0.07);
      this.wait = 1.4;
    },
    next() {
      if (this.n + 1 < HOLES.length) { this.start(this.n + 1); return; }
      const diff = this.total - PAR;
      over(this.total, '9 holes in ' + this.total + ' shots (' + (diff === 0 ? 'even par' : diff > 0 ? diff + ' over par' : -diff + ' under par') + ').', 'Round done!');
    },
    draw() {
      const h = this.hole, b = this.ball, t = this.t;
      ctx.fillStyle = '#0c1a14'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#10241b';
      for (let y = 0; y < H; y += 20) for (let x = (y / 20) % 2 ? 0 : 10; x < W; x += 20) ctx.fillRect(x, y, 3, 3);
      const path = (pts) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); };
      // Wooden rails, then the grass with mowing stripes.
      path(h.outline); ctx.lineJoin = 'round'; ctx.lineWidth = 16; ctx.strokeStyle = '#6b4a2b'; ctx.stroke();
      ctx.lineWidth = 10; ctx.strokeStyle = '#9a6d40'; ctx.stroke();
      ctx.save(); path(h.outline); ctx.clip();
      ctx.fillStyle = '#3d9a4c'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#45a755'; for (let y = 0; y < H; y += 36) ctx.fillRect(0, y, W, 18);
      for (const r of h.water || []) {
        ctx.fillStyle = '#2a6fc0'; ctx.fillRect(...r);
        ctx.fillStyle = '#4f97e6';
        for (let y = r[1] + 10; y < r[1] + r[3] - 4; y += 16) for (let x = r[0] + ((y / 16) % 2) * 14 + Math.sin(t * 2 + y) * 4; x < r[0] + r[2] - 14; x += 28) ctx.fillRect(x, y, 12, 2);
        ctx.strokeStyle = '#1d4f8e'; ctx.lineWidth = 3; ctx.strokeRect(r[0] + 1.5, r[1] + 1.5, r[2] - 3, r[3] - 3);
      }
      for (const r of h.sand || []) {
        ctx.fillStyle = '#e3cf94'; ctx.beginPath(); ctx.roundRect(r[0], r[1], r[2], r[3], 12); ctx.fill();
        ctx.fillStyle = '#c9b276'; for (let i = 0; i < r[2] * r[3] / 90; i++) ctx.fillRect(r[0] + 6 + (i * 37) % (r[2] - 12), r[1] + 5 + (i * 23) % (r[3] - 10), 2, 2);
      }
      ctx.restore();
      for (const r of h.blocks || []) {
        ctx.fillStyle = '#6b4a2b'; ctx.fillRect(r[0] - 3, r[1] - 3, r[2] + 6, r[3] + 6);
        ctx.fillStyle = '#9a6d40'; ctx.fillRect(r[0], r[1], r[2], r[3]);
        ctx.fillStyle = '#b5844f'; ctx.fillRect(r[0], r[1], r[2], 3);
      }
      for (const [x, y, r] of h.bumpers || []) {
        ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.arc(x + 2, y + 3, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.pink; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffd0de'; ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
      }
      // The cup and its flag. The flag fades when the ball is close, so it never hides the ball.
      ctx.fillStyle = '#2e7a3b'; ctx.beginPath(); ctx.arc(h.cup[0], h.cup[1], CUP + 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#05080a'; ctx.beginPath(); ctx.arc(h.cup[0], h.cup[1], CUP, 0, Math.PI * 2); ctx.fill();
      if (!(this.sunk && b.s < 0.6)) {
        ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(b.x + 2, b.y + 3, R * b.s, R * b.s * 0.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(b.x, b.y, R * b.s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#d7dde6'; ctx.beginPath(); ctx.arc(b.x + 1.5 * b.s, b.y + 1.5 * b.s, R * 0.55 * b.s, 0, Math.PI * 2); ctx.fill();
      }
      const near = Math.hypot(b.x - h.cup[0], b.y - h.cup[1]);
      ctx.globalAlpha = clamp((near - 14) / 50, 0.25, 1);
      ctx.fillStyle = C.ink; ctx.fillRect(h.cup[0] - 1, h.cup[1] - 44, 2, 44);
      ctx.fillStyle = C.pink; ctx.beginPath(); ctx.moveTo(h.cup[0] + 1, h.cup[1] - 44); ctx.lineTo(h.cup[0] + 20 + Math.sin(t * 5) * 2, h.cup[1] - 38); ctx.lineTo(h.cup[0] + 1, h.cup[1] - 31); ctx.fill();
      ctx.globalAlpha = 1;
      if (h.spin) {
        const [p, q] = this.spinnerEnds();
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(p[0] + 3, p[1] + 4); ctx.lineTo(q[0] + 3, q[1] + 4); ctx.stroke();
        ctx.strokeStyle = '#f4ecdc'; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
        ctx.strokeStyle = C.pink; ctx.lineWidth = 4; ctx.setLineDash([10, 10]); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.setLineDash([]);
        ctx.lineCap = 'butt';
        ctx.fillStyle = '#6b4a2b'; ctx.beginPath(); ctx.arc(h.spin.x, h.spin.y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.amber; ctx.beginPath(); ctx.arc(h.spin.x, h.spin.y, 4, 0, Math.PI * 2); ctx.fill();
      }
      // The aiming dots: longer and redder for a harder putt.
      if (this.ready() && (!this.drag || this.drag.to)) {
        const { a, p } = this.aim, col = p < 0.5 ? C.lime : p < 0.8 ? C.amber : C.pink;
        ctx.fillStyle = col;
        const len = 24 + p * 110;
        for (let d = 14; d < len; d += 9) ctx.fillRect(b.x + Math.cos(a) * d - 1.5, b.y + Math.sin(a) * d - 1.5, 3, 3);
        ctx.save(); ctx.translate(b.x + Math.cos(a) * len, b.y + Math.sin(a) * len); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -5); ctx.lineTo(-4, 5); ctx.fill(); ctx.restore();
      }
      // The bar at the top.
      ctx.fillStyle = 'rgba(5,10,8,.75)'; ctx.fillRect(0, 0, W, 40);
      ctx.font = font(9); ctx.textBaseline = 'middle'; ctx.fillStyle = C.ink;
      ctx.textAlign = 'left'; ctx.fillText('HOLE ' + (this.n + 1) + '/9', 12, 20);
      ctx.textAlign = 'center'; ctx.fillStyle = C.muted; ctx.fillText('PAR ' + h.par, W / 2, 20);
      ctx.textAlign = 'right'; ctx.fillStyle = this.shots >= MAX_SHOTS - 1 ? C.pink : C.ink; ctx.fillText('SHOTS ' + this.shots, W - 12, 20);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      if (this.fade.a > 0) { ctx.fillStyle = 'rgba(12,26,20,' + this.fade.a + ')'; ctx.fillRect(0, 40, W, H - 40); }
      if (this.fade.a > 0.05) {
        ctx.font = font(14); ctx.textAlign = 'center'; ctx.fillStyle = C.ink; ctx.globalAlpha = this.fade.a;
        ctx.fillText('HOLE ' + (this.n + 1), W / 2, H / 2); ctx.globalAlpha = 1; ctx.textAlign = 'left';
      }
    },
  };

  Arcade.register('minigolf', golf);
})();
