/* Invaders. Loaded on demand by js/arcade.js the first time the game is opened. */
(() => {
  const { ctx, C, cached, clamp, sfx, setScore, over, font } = Arcade;

  const invaders = {
    W: 480, H: 440, PY: 400, color: 'var(--lime)', title: 'Invaders', label: 'Score',
    intro: 'Shoot the aliens before they land. Dodge their shots. You have 3 ships.',
    hint: '<kbd>←</kbd><kbd>→</kbd> move, <kbd>Space</kbd> fire. On a phone: drag to move, tap to fire. <kbd>P</kbd> to pause',
    reset() {
      this.score = 0; this.lives = 3; this.wave = 1; this.px = this.W / 2 - 16; this.left = this.right = false; this.target = null;
      this.newWave();
    },
    newWave() {
      this.aliens = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) this.aliens.push({ c, r, alive: true });
      this.fx = 40; this.fy = 50 + Math.min(this.wave - 1, 4) * 12; this.dir = 1; this.acc = 0; this.frame = 0;
      this.shot = null; this.bombs = []; this.inv = 0;
    },
    pos(a) { return { x: this.fx + a.c * 40, y: this.fy + a.r * 32, w: 26, h: 18 }; },
    fire() { if (!this.shot) { this.shot = { x: this.px + 15, y: this.PY - 6 }; sfx.shoot(); } },
    key(e, down) {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { this.left = down; this.target = null; }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { this.right = down; this.target = null; }
      if (e.code === 'Space' && down) this.fire();
    },
    point(p) { this.target = p.x; },
    tap() { this.fire(); },
    update(dt) {
      if (this.target !== null) this.px += clamp(this.target - 16 - this.px, -400 * dt, 400 * dt);
      if (this.left) this.px -= 300 * dt;
      if (this.right) this.px += 300 * dt;
      this.px = clamp(this.px, 8, this.W - 40);
      if (this.inv > 0) this.inv -= dt;

      const alive = this.aliens.filter((a) => a.alive);
      this.acc += dt;
      const interval = Math.max(0.04, (0.06 + 0.6 * alive.length / 45) / (1 + (this.wave - 1) * 0.15));
      if (this.acc >= interval) {
        this.acc = 0; this.frame ^= 1;
        const xs = alive.map((a) => this.pos(a));
        const minX = Math.min(...xs.map((p) => p.x)), maxX = Math.max(...xs.map((p) => p.x + p.w));
        if ((this.dir > 0 && maxX + 10 > this.W - 8) || (this.dir < 0 && minX - 10 < 8)) { this.fy += 16; this.dir *= -1; }
        else this.fx += 10 * this.dir;
        if (Math.max(...xs.map((p) => p.y + p.h)) + 16 >= this.PY) return over(this.score, 'The aliens landed. Score ' + this.score + '.');
      }
      if (Math.random() < dt * (0.9 + this.wave * 0.3)) {
        const cols = [...new Set(alive.map((a) => a.c))];
        const col = cols[Math.floor(Math.random() * cols.length)];
        const low = alive.filter((a) => a.c === col).sort((a, b) => b.r - a.r)[0];
        const p = this.pos(low); this.bombs.push({ x: p.x + 12, y: p.y + p.h });
      }
      if (this.shot) {
        this.shot.y -= 560 * dt;
        if (this.shot.y < 0) this.shot = null;
        else for (const a of alive) {
          const p = this.pos(a);
          if (this.shot.x > p.x && this.shot.x < p.x + p.w && this.shot.y > p.y && this.shot.y < p.y + p.h) {
            a.alive = false; this.shot = null; this.score += [30, 20, 20, 10, 10][a.r]; setScore(this.score); break;
          }
        }
      }
      for (const b of this.bombs) b.y += (200 + this.wave * 20) * dt;
      this.bombs = this.bombs.filter((b) => b.y < this.H);
      if (this.inv <= 0) for (const b of this.bombs) {
        if (b.x > this.px && b.x < this.px + 32 && b.y > this.PY && b.y < this.PY + 16) {
          this.lives--; this.bombs = []; this.inv = 1.5;
          if (this.lives <= 0) return over(this.score, 'Your last ship was hit. Score ' + this.score + '.');
          break;
        }
      }
      if (!this.aliens.some((a) => a.alive)) { this.wave++; this.newWave(); }
    },
    draw() {
      ctx.drawImage(cached('invaders-sky', this.W, this.H, (g) => {
        g.fillStyle = C.bg; g.fillRect(0, 0, this.W, this.H);
        for (let i = 0; i < 40; i++) { g.fillStyle = i % 3 ? '#2a2240' : '#3a3052'; g.fillRect((i * 97) % this.W, (i * 53) % (this.PY - 20), 2, 2); }
      }), 0, 0, this.W, this.H);
      const cols = ['#ff6b9a', '#ffb347', '#ffb347', '#b8e65c', '#b8e65c'];
      for (const a of this.aliens) {
        if (!a.alive) continue;
        const p = this.pos(a); ctx.fillStyle = cols[a.r];
        ctx.fillRect(p.x + 4, p.y, p.w - 8, 4); ctx.fillRect(p.x, p.y + 4, p.w, 8);
        ctx.fillStyle = C.bg; ctx.fillRect(p.x + 6, p.y + 6, 4, 4); ctx.fillRect(p.x + p.w - 10, p.y + 6, 4, 4);
        ctx.fillStyle = cols[a.r];
        if (this.frame) { ctx.fillRect(p.x, p.y + 12, 4, 6); ctx.fillRect(p.x + p.w - 4, p.y + 12, 4, 6); }
        else { ctx.fillRect(p.x + 6, p.y + 12, 4, 6); ctx.fillRect(p.x + p.w - 10, p.y + 12, 4, 6); }
      }
      if (!(this.inv > 0 && Math.floor(this.inv * 10) % 2)) {
        ctx.fillStyle = C.cyan; ctx.fillRect(this.px, this.PY + 6, 32, 10); ctx.fillRect(this.px + 12, this.PY, 8, 6);
      }
      ctx.fillStyle = C.ink; if (this.shot) ctx.fillRect(this.shot.x - 1, this.shot.y, 3, 10);
      ctx.fillStyle = C.pink; for (const b of this.bombs) { ctx.fillRect(b.x - 2, b.y, 4, 4); ctx.fillRect(b.x, b.y + 4, 4, 4); }
      ctx.fillStyle = C.muted; ctx.fillRect(0, this.PY + 22, this.W, 2);
      ctx.font = font(9); ctx.textBaseline = 'top';
      ctx.textAlign = 'left'; ctx.fillText('SHIPS', 12, 14);
      ctx.fillStyle = C.cyan; for (let i = 0; i < this.lives; i++) ctx.fillRect(66 + i * 22, 14, 16, 8);
      ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.fillText('WAVE ' + this.wave, this.W - 12, 14);
    },
  };

  Arcade.register('invaders', invaders);
})();
