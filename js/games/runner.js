/* Runner. Loaded on demand by js/arcade.js the first time the game is opened. */
(() => {
  const { ctx, C, rand, sfx, setScore, over } = Arcade;

  const runner = {
    W: 680, H: 280, GY: 236, PX: 80, PW: 28, PH: 40, color: 'var(--cyan)', title: 'Runner', label: 'Distance',
    intro: 'Jump over the pink blocks. Hold jump to go higher. After 400 m, birds start flying in low: stay on the ground and let them pass over you.',
    hint: '<kbd>Space</kbd> <kbd>↑</kbd> or tap to jump (hold for a higher jump), <kbd>P</kbd> to pause',
    reset() {
      this.py = 0; this.vy = 0; this.ground = true; this.held = false;
      this.speed = 330; this.dist = 0; this.obs = []; this.next = 420; this.t = 0; this.score = 0;
    },
    jump() { if (this.ground) { this.vy = 760; this.ground = false; sfx.hop(); } },
    key(e, down) {
      if (!['Space', 'ArrowUp', 'KeyW'].includes(e.code)) return;
      if (down && !e.repeat) this.jump();
      this.held = down;
    },
    press(down) { if (down) this.jump(); this.held = down; },
    update(dt) {
      this.t += dt;
      this.speed = Math.min(780, this.speed + 10 * dt);
      const dx = this.speed * dt; this.dist += dx;
      this.vy -= (this.held && this.vy > 0 ? 1700 : 2600) * dt;
      this.py += this.vy * dt;
      if (this.py <= 0) { this.py = 0; this.vy = 0; this.ground = true; }

      this.next -= dx;
      if (this.next <= 0) {
        const flyer = this.score > 400 && Math.random() < 0.3;
        if (flyer) this.obs.push({ x: this.W + 10, w: 36, b: 50, h: 18, fly: true });
        else {
          const n = this.score > 250 && Math.random() < 0.35 ? 2 : 1;
          for (let i = 0; i < n; i++) this.obs.push({ x: this.W + 10 + i * 26, w: Math.round(rand(18, 26)), b: 0, h: Math.round(rand(28, 58)) });
        }
        this.next = this.speed * rand(0.8, 1.6) + 160;
      }
      for (const o of this.obs) o.x -= dx;
      this.obs = this.obs.filter((o) => o.x + o.w > -20);

      const p = { l: this.PX + 4, r: this.PX + this.PW - 4, b: this.py + 2, t: this.py + this.PH - 4 };
      for (const o of this.obs) {
        if (p.r > o.x + 2 && p.l < o.x + o.w - 2 && p.t > o.b + 2 && p.b < o.b + o.h - 2) return over(this.score);
      }
      const sc = Math.floor(this.dist / 10);
      if (sc !== this.score) { this.score = sc; setScore(sc); }
    },
    draw() {
      const { W, H, GY } = this;
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffe6b3'; ctx.beginPath(); ctx.arc(W - 90, 60, 22, 0, Math.PI * 2); ctx.fill();
      const hills = (amp, base, par, col, freq) => {
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, GY);
        for (let x = 0; x <= W; x += 8) ctx.lineTo(x, base - amp * (0.5 + 0.5 * Math.sin((x + this.dist * par) * freq) * Math.cos((x + this.dist * par) * freq * 0.37)));
        ctx.lineTo(W, GY); ctx.closePath(); ctx.fill();
      };
      hills(70, GY - 20, 0.15, '#1d1630', 0.012);
      hills(40, GY - 4, 0.4, '#261d3d', 0.02);
      ctx.fillStyle = C.muted; ctx.fillRect(0, GY, W, 2);
      ctx.fillStyle = '#3a3052';
      const off = this.dist % 46;
      for (let x = -off; x < W; x += 46) ctx.fillRect(x, GY + 12, 18, 2);
      for (let x = -((this.dist * 1.3) % 90); x < W; x += 90) ctx.fillRect(x + 30, GY + 26, 8, 2);

      for (const o of this.obs) {
        const y = GY - o.b - o.h;
        if (o.fly) {
          ctx.fillStyle = C.amber; ctx.fillRect(o.x, y + 5, o.w, 8);
          const flap = Math.sin(this.t * 18) > 0 ? -6 : 6;
          ctx.fillRect(o.x + 10, y + 6 + flap, 14, 4);
          ctx.fillStyle = C.bg; ctx.fillRect(o.x + 4, y + 7, 3, 3);
        } else {
          ctx.fillStyle = C.pink; ctx.fillRect(o.x, y, o.w, o.h);
          ctx.fillStyle = '#c2466f'; ctx.fillRect(o.x + o.w - 5, y, 5, o.h);
          ctx.fillStyle = '#ffb3c9'; ctx.fillRect(o.x, y, o.w, 3);
        }
      }

      const x = this.PX, top = GY - this.py - this.PH;
      ctx.fillStyle = C.cyan;
      ctx.fillRect(x + 4, top, this.PW - 8, 14);
      ctx.fillRect(x, top + 14, this.PW, 16);
      ctx.fillStyle = C.bg; ctx.fillRect(x + this.PW - 10, top + 4, 4, 4);
      ctx.fillStyle = C.cyan;
      const step = this.ground ? (Math.floor(this.t * 12) % 2) : 2;
      const legA = step === 0 ? 10 : step === 1 ? 6 : 8, legB = step === 0 ? 6 : step === 1 ? 10 : 8;
      ctx.fillRect(x + 4, top + 30, 6, legA);
      ctx.fillRect(x + this.PW - 10, top + 30, 6, legB);
    },
  };

  Arcade.register('runner', runner);
})();
