/* Pong. Loaded on demand by js/arcade.js the first time the game is opened. */
(() => {
  const { ctx, C, rand, clamp, sfx, setScore, over, font, tween, pop, shake } = Arcade;

  const pong = {
    W: 560, H: 360, PH: 64, color: 'var(--amber)', title: 'Pong', label: 'Points',
    intro: 'You are the left paddle. Score as many points as you can before the computer gets 5.',
    hint: '<kbd>↑</kbd><kbd>↓</kbd> or <kbd>W</kbd><kbd>S</kbd>, or move the mouse / drag. <kbd>P</kbd> to pause',
    reset() {
      this.py = this.cy = (this.H - this.PH) / 2; this.score = 0; this.cpu = 0; this.up = this.down = false; this.target = null;
      this.squash = { you: 0, cpu: 0, ball: 0 }; // Looks only: how squashed each paddle and the ball are after a hit.
      this.serve(1);
    },
    serve(dir) {
      this.bx = this.W / 2; this.by = this.H / 2; this.speed = 300; this.wait = 0.8;
      const a = rand(-0.5, 0.5); this.vx = dir * this.speed * Math.cos(a); this.vy = this.speed * Math.sin(a);
    },
    key(e, down) {
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { this.up = down; this.target = null; }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { this.down = down; this.target = null; }
    },
    point(p) { this.target = p.y; },
    hit(px, dir) {
      const rel = clamp((this.by - (px + this.PH / 2)) / (this.PH / 2), -1, 1);
      this.speed = Math.min(this.speed * 1.06, 720);
      this.vx = dir * this.speed * Math.cos(rel * 1.0); this.vy = this.speed * Math.sin(rel * 1.0); sfx.hit();
      const who = dir > 0 ? 'you' : 'cpu';
      this.squash[who] = 1; this.squash.ball = 1;
      tween(this.squash, { [who]: 0, ball: 0 }, 420, { ease: 'elastic' });
    },
    update(dt) {
      if (this.target !== null) this.py += clamp(this.target - this.PH / 2 - this.py, -600 * dt, 600 * dt);
      if (this.up) this.py -= 420 * dt;
      if (this.down) this.py += 420 * dt;
      this.py = clamp(this.py, 0, this.H - this.PH);
      const cpuSpeed = 250 + this.score * 12;
      const aim = this.vx > 0 ? this.by - this.PH / 2 : (this.H - this.PH) / 2;
      this.cy = clamp(this.cy + clamp(aim - this.cy, -cpuSpeed * dt, cpuSpeed * dt), 0, this.H - this.PH);
      if (this.wait > 0) { this.wait -= dt; return; }
      this.bx += this.vx * dt; this.by += this.vy * dt;
      if (this.by < 5) { this.by = 5; this.vy = Math.abs(this.vy); }
      if (this.by > this.H - 5) { this.by = this.H - 5; this.vy = -Math.abs(this.vy); }
      if (this.vx < 0 && this.bx - 5 <= 32 && this.bx > 16 && this.by > this.py - 5 && this.by < this.py + this.PH + 5) { this.bx = 37; this.hit(this.py, 1); }
      if (this.vx > 0 && this.bx + 5 >= this.W - 32 && this.bx < this.W - 16 && this.by > this.cy - 5 && this.by < this.cy + this.PH + 5) { this.bx = this.W - 37; this.hit(this.cy, -1); }
      if (this.bx < -10) { this.cpu++; pop(100, clamp(this.by, 30, this.H - 30), 'CPU +1', C.pink, 10); if (this.cpu < 5) shake(4); if (this.cpu >= 5) return over(this.score, 'The computer reached 5. You scored ' + this.score + '.'); this.serve(1); }
      if (this.bx > this.W + 10) { this.score++; setScore(this.score); pop(this.W - 50, clamp(this.by, 30, this.H - 30), '+1', C.amber, 14); this.serve(-1); }
    },
    draw() {
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, this.W, this.H);
      ctx.fillStyle = '#2a2240';
      for (let y = 6; y < this.H; y += 22) ctx.fillRect(this.W / 2 - 2, y, 4, 12);
      ctx.font = font(28); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = '#3a3052'; ctx.fillText(this.score, this.W / 2 - 70, 20); ctx.fillText(this.cpu, this.W / 2 + 70, 20);
      ctx.font = font(9); ctx.fillStyle = C.muted;
      ctx.fillText('YOU', this.W / 2 - 70, 56); ctx.fillText('CPU (5 WINS)', this.W / 2 + 70, 56);
      // A hit squashes a paddle wider and shorter for a moment, and puffs up the ball.
      const paddle = (x, y, k) => ctx.fillRect(x - 3 * k, y + 5 * k, 12 + 6 * k, this.PH - 10 * k);
      ctx.fillStyle = C.amber; paddle(20, this.py, this.squash.you);
      ctx.fillStyle = C.pink; paddle(this.W - 32, this.cy, this.squash.cpu);
      const b = 5 + 3 * this.squash.ball;
      ctx.fillStyle = C.ink; ctx.fillRect(this.bx - b, this.by - b, b * 2, b * 2);
    },
  };

  Arcade.register('pong', pong);
})();
