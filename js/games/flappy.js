/* Flappy. Loaded on demand by js/arcade.js the first time the game is opened. */
(() => {
  const { ctx, C, rand, clamp, sfx, setScore, over } = Arcade;

  const flappy = {
    W: 360, H: 480, BX: 90, GAP: 140, color: 'var(--pink)', title: 'Flappy', label: 'Pipes',
    intro: 'Tap to flap and fly through the gaps. Touching a pipe or the ground ends the flight.',
    hint: '<kbd>Space</kbd> <kbd>↑</kbd>, click or tap to flap. <kbd>P</kbd> to pause',
    reset() { this.by = this.H / 2 - 40; this.vy = -300; this.pipes = []; this.score = 0; this.t = 0; this.dist = 0; },
    flap() { this.vy = -400; sfx.hop(); },
    key(e, down) { if (down && !e.repeat && ['Space', 'ArrowUp', 'KeyW'].includes(e.code)) this.flap(); },
    press(down) { if (down) this.flap(); },
    update(dt) {
      this.t += dt; const sp = 150 + Math.min(this.score, 40) * 2; this.dist += sp * dt;
      this.vy = Math.min(this.vy + 1400 * dt, 600); this.by += this.vy * dt;
      const last = this.pipes[this.pipes.length - 1];
      if (!last || last.x < this.W - 190) this.pipes.push({ x: this.W + 20, gy: rand(70, this.H - 90 - this.GAP), passed: false });
      for (const p of this.pipes) {
        p.x -= sp * dt;
        if (!p.passed && p.x + 52 < this.BX) { p.passed = true; this.score++; setScore(this.score); }
      }
      this.pipes = this.pipes.filter((p) => p.x > -60);
      const r = 11;
      if (this.by + r > this.H - 40 || this.by - r < 0) return over(this.score, 'You flew through ' + this.score + ' pipes.');
      for (const p of this.pipes) {
        if (this.BX + r > p.x && this.BX - r < p.x + 52 && (this.by - r < p.gy || this.by + r > p.gy + this.GAP)) return over(this.score, 'You flew through ' + this.score + ' pipes.');
      }
    },
    draw() {
      const { W, H } = this;
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#1d1630';
      for (let i = 0; i < 6; i++) { const x = ((i * 90 - this.dist * 0.2) % (W + 90) + W + 90) % (W + 90) - 60; ctx.fillRect(x, H - 40 - 60 - (i % 3) * 30, 50, 60 + (i % 3) * 30); }
      for (const p of this.pipes) {
        ctx.fillStyle = C.lime; ctx.fillRect(p.x, 0, 52, p.gy); ctx.fillRect(p.x, p.gy + this.GAP, 52, H - 40 - p.gy - this.GAP);
        ctx.fillStyle = '#e3ff9e'; ctx.fillRect(p.x - 4, p.gy - 16, 60, 16); ctx.fillRect(p.x - 4, p.gy + this.GAP, 60, 16);
        ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(p.x + 40, 0, 12, p.gy - 16); ctx.fillRect(p.x + 40, p.gy + this.GAP + 16, 12, H - 40 - p.gy - this.GAP - 16);
      }
      ctx.fillStyle = '#2b2340'; ctx.fillRect(0, H - 40, W, 40);
      ctx.fillStyle = C.muted; ctx.fillRect(0, H - 40, W, 3);
      ctx.fillStyle = '#3a3052'; for (let x = -(this.dist % 24); x < W; x += 24) ctx.fillRect(x, H - 28, 12, 3);
      ctx.save(); ctx.translate(this.BX, this.by); ctx.rotate(clamp(this.vy / 900, -0.5, 0.9));
      ctx.fillStyle = C.amber; ctx.fillRect(-12, -10, 24, 20);
      ctx.fillStyle = '#ffd9a0'; ctx.fillRect(-10, Math.sin(this.t * 20) > 0 ? -2 : 2, 10, 6);
      ctx.fillStyle = C.ink; ctx.fillRect(4, -7, 6, 6); ctx.fillStyle = C.bg; ctx.fillRect(7, -5, 3, 3);
      ctx.fillStyle = C.pink; ctx.fillRect(12, 0, 7, 5);
      ctx.restore();
    },
  };

  Arcade.register('flappy', flappy);
})();
