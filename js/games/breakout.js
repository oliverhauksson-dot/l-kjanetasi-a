/* Breakout. Loaded on demand by js/arcade.js the first time the game is opened. */
(() => {
  const { ctx, C, rand, clamp, sfx, setScore, over, font } = Arcade;

  const R = 6;
  const breakout = {
    W: 480, H: 440, PY: 404, color: 'var(--pink)', title: 'Breakout', label: 'Score',
    intro: 'Keep the ball in play and clear every brick. You get 3 balls. Each cleared wall brings a faster one.',
    hint: 'Move the mouse or drag on the screen, or use <kbd>←</kbd><kbd>→</kbd>. <kbd>P</kbd> to pause',
    rows: ['#ff6b9a', '#ffb347', '#b8e65c', '#5ce1e6', '#a78bfa'],
    reset() {
      this.score = 0; this.lives = 3; this.level = 1; this.pw = 84; this.px = (this.W - this.pw) / 2;
      this.left = this.right = false; this.build(); this.serve();
    },
    build() {
      const cols = 8, pad = 6, side = 16, top = 60, bh = 16;
      const bw = (this.W - side * 2 - pad * (cols - 1)) / cols;
      this.bricks = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < cols; c++) this.bricks.push({ x: side + c * (bw + pad), y: top + r * (bh + pad), w: bw, h: bh, r });
    },
    serve() {
      this.stuck = 1; this.speed = 260 + this.level * 30;
      const a = rand(-0.35, 0.35);
      this.vx = this.speed * Math.sin(a); this.vy = -this.speed * Math.cos(a);
      this.bx = this.px + this.pw / 2; this.by = this.PY - R;
    },
    key(e, down) {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.left = down;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.right = down;
    },
    point(p) { this.px = clamp(p.x - this.pw / 2, 0, this.W - this.pw); },
    update(dt) {
      if (this.left) this.px -= 520 * dt;
      if (this.right) this.px += 520 * dt;
      this.px = clamp(this.px, 0, this.W - this.pw);
      if (this.stuck > 0) { this.stuck -= dt; this.bx = this.px + this.pw / 2; this.by = this.PY - R; return; }

      this.bx += this.vx * dt; this.by += this.vy * dt;
      if (this.bx < R) { this.bx = R; this.vx = Math.abs(this.vx); }
      if (this.bx > this.W - R) { this.bx = this.W - R; this.vx = -Math.abs(this.vx); }
      if (this.by < R) { this.by = R; this.vy = Math.abs(this.vy); }

      if (this.vy > 0 && this.by + R >= this.PY && this.by + R <= this.PY + 16 && this.bx >= this.px - R && this.bx <= this.px + this.pw + R) {
        const hit = clamp(((this.bx - this.px) / this.pw) * 2 - 1, -1, 1);
        this.speed = Math.min(this.speed * 1.02, 560);
        this.vx = this.speed * Math.sin(hit * 1.05); this.vy = -this.speed * Math.cos(hit * 1.05);
        this.by = this.PY - R; sfx.hit();
      }
      if (this.by > this.H + R) {
        this.lives--;
        if (this.lives <= 0) return over(this.score);
        this.serve(); return;
      }
      for (let i = 0; i < this.bricks.length; i++) {
        const b = this.bricks[i];
        const nx = clamp(this.bx, b.x, b.x + b.w), ny = clamp(this.by, b.y, b.y + b.h);
        const dx = this.bx - nx, dy = this.by - ny;
        if (dx * dx + dy * dy < R * R) {
          this.bricks.splice(i, 1);
          this.score += 10 * this.level; setScore(this.score);
          const ox = Math.min(this.bx + R - b.x, b.x + b.w - (this.bx - R));
          const oy = Math.min(this.by + R - b.y, b.y + b.h - (this.by - R));
          if (ox < oy) this.vx = this.bx < b.x + b.w / 2 ? -Math.abs(this.vx) : Math.abs(this.vx);
          else this.vy = this.by < b.y + b.h / 2 ? -Math.abs(this.vy) : Math.abs(this.vy);
          break;
        }
      }
      if (!this.bricks.length) { this.level++; this.build(); this.serve(); }
    },
    draw() {
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, this.W, this.H);
      for (const b of this.bricks) {
        ctx.fillStyle = this.rows[b.r]; ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(b.x, b.y + b.h - 4, b.w, 4);
      }
      ctx.fillStyle = C.ink; ctx.fillRect(this.px, this.PY, this.pw, 10);
      ctx.fillStyle = C.pink; ctx.fillRect(this.px, this.PY, 6, 10); ctx.fillRect(this.px + this.pw - 6, this.PY, 6, 10);
      ctx.fillStyle = C.amber; ctx.beginPath(); ctx.arc(this.bx, this.by, R, 0, Math.PI * 2); ctx.fill();
      ctx.font = font(10); ctx.textBaseline = 'top';
      ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.fillText('BALLS', 16, 22);
      ctx.fillStyle = C.amber;
      for (let i = 0; i < this.lives; i++) { ctx.beginPath(); ctx.arc(80 + i * 16, 27, 5, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.fillText('WALL ' + this.level, this.W - 16, 22);
      if (this.stuck > 0) { ctx.textAlign = 'center'; ctx.fillStyle = C.ink; ctx.fillText('GET READY', this.W / 2, 300); }
    },
  };

  Arcade.register('breakout', breakout);
})();
