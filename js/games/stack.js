/* Stack Tower. Loaded on demand by js/arcade.js the first time the game is opened.
   A block slides back and forth above the tower. Tap to drop it: the part that hangs over the edge is cut off
   and falls, so the tower gets narrower. Drop it right on top (a "perfect") and nothing is cut; three perfects
   in a row make the block a little wider again. Miss the tower completely and the game is over. */
(() => {
  const { ctx, C, clamp, font, sfx, setScore, over, tween, pop, shake } = Arcade;

  const W = 360, H = 560, BH = 24, D = 16; // BH: block height. D: how deep the top face looks.
  const START_W = 180, BASE_Y = H - 70, PERFECT = 5, GROW = 10;
  const color = (i, light) => 'hsl(' + ((205 + i * 9) % 360) + ',' + (light > 0 ? 75 : 62) + '%,' + (56 + light) + '%)';

  const stack = {
    W, H, color: 'var(--cyan)', title: 'Stack Tower', label: 'Height',
    intro: 'Tap to drop each block on the tower. Whatever hangs over the edge gets cut off. Line them up perfectly to keep them wide.',
    hint: '<kbd>Space</kbd>, click or tap to drop the block. <kbd>P</kbd> to pause',
    reset() {
      this.blocks = [{ x: (W - START_W) / 2, w: START_W, i: 0, sy: 1, flash: 0 }];
      this.bits = []; this.score = 0; this.combo = 0; this.cam = 0; this.dead = 0; this.t = 0;
      this.next(-1);
    },
    // A new block comes in from the left or the right side.
    next(dir) {
      const top = this.blocks[this.blocks.length - 1], n = this.blocks.length;
      this.cur = { x: dir > 0 ? -top.w * 0.6 : W - top.w * 0.4, w: top.w, i: n, dir, sp: Math.min(150 + n * 6, 470) };
    },
    key(e, down) { if (down && !e.repeat && ['Space', 'ArrowDown', 'Enter'].includes(e.code)) this.drop(); },
    press(down) { if (down) this.drop(); },
    drop() {
      if (this.dead || !this.cur) return;
      const c = this.cur, top = this.blocks[this.blocks.length - 1];
      const y = this.rowY(c.i);
      const left = Math.max(c.x, top.x), right = Math.min(c.x + c.w, top.x + top.w);
      if (right - left <= 0) {
        // Missed: the whole block tumbles down.
        this.bits.push({ x: c.x, y, w: c.w, i: c.i, vx: c.dir * 60, vy: 0, r: 0, vr: c.dir * 2 });
        this.cur = null; this.dead = 0.9; sfx.lose(); shake(6, 300);
        return;
      }
      let b;
      if (Math.abs(c.x - top.x) <= PERFECT) {
        this.combo++;
        b = { x: top.x, w: top.w, i: c.i, sy: 1, flash: 1 };
        if (this.combo >= 3) { const grow = Math.min(GROW, START_W - b.w); b.x -= grow / 2; b.w += grow; }
        tween(b, { flash: 0 }, 500, { ease: 'out' });
        sfx.tone(520 + Math.min(this.combo, 12) * 60, 0.12, 'triangle', 0.06);
        pop(b.x + b.w / 2, y - 18, this.combo >= 3 ? 'PERFECT x' + this.combo : 'PERFECT', '#fff6c8', 10);
      } else {
        this.combo = 0;
        b = { x: left, w: right - left, i: c.i, sy: 1, flash: 0 };
        // The piece that hung over falls away.
        const cutX = c.x < top.x ? c.x : right, cutW = c.w - b.w;
        this.bits.push({ x: cutX, y, w: cutW, i: c.i, vx: (c.x < top.x ? -1 : 1) * 50, vy: -40, r: 0, vr: (c.x < top.x ? -1 : 1) * 2.5 });
        sfx.hit();
      }
      b.sy = 0.7; tween(b, { sy: 1 }, 380, { ease: 'elastic' }); // A little squash as it lands.
      this.blocks.push(b);
      this.score++; setScore(this.score);
      this.next(-c.dir);
    },
    rowY(i) { return BASE_Y - i * BH; },
    update(dt) {
      this.t += dt;
      const c = this.cur;
      if (c) {
        c.x += c.dir * c.sp * dt;
        const lo = -c.w * 0.6, hi = W - c.w * 0.4;
        if (c.x < lo) { c.x = lo; c.dir = 1; } else if (c.x > hi) { c.x = hi; c.dir = -1; }
      }
      for (const b of this.bits) { b.vy += 900 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.r += b.vr * dt; }
      this.bits = this.bits.filter((b) => b.y - this.cam < H + 120);
      // The camera follows the top of the tower.
      const want = Math.max(0, (this.blocks.length - 9) * BH);
      this.cam += (want - this.cam) * clamp(dt * 5, 0, 1);
      if (this.dead) {
        this.dead -= dt;
        if (this.dead <= 0) { this.dead = 0; return over(this.score, 'Your tower is ' + this.score + ' block' + (this.score === 1 ? '' : 's') + ' high.'); }
      }
    },
    block(x, y, w, i, sy = 1, flash = 0) {
      const h = BH * sy, top = y + BH - h, dx = D * 0.7;
      ctx.fillStyle = color(i, -14); // the right side
      ctx.beginPath(); ctx.moveTo(x + w, top); ctx.lineTo(x + w + dx, top - D); ctx.lineTo(x + w + dx, top - D + h); ctx.lineTo(x + w, top + h); ctx.fill();
      ctx.fillStyle = color(i, 14); // the top
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x + dx, top - D); ctx.lineTo(x + w + dx, top - D); ctx.lineTo(x + w, top); ctx.fill();
      ctx.fillStyle = color(i, 0); ctx.fillRect(x, top, w, h); // the front
      ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(x, top, w, 3);
      if (flash > 0) {
        ctx.globalAlpha = flash;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 + flash * 4;
        ctx.strokeRect(x - flash * 10, top - D - flash * 10, w + dx + flash * 20, h + D + flash * 20);
        ctx.globalAlpha = 1;
      }
    },
    draw() {
      // The sky gets darker and starrier the higher the tower grows.
      const k = clamp(this.cam / 2400, 0, 1);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'hsl(' + (225 + k * 25) + ',60%,' + (22 - k * 14) + '%)');
      g.addColorStop(1, 'hsl(' + (200 + k * 40) + ',55%,' + (42 - k * 28) + '%)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (k > 0.05) {
        ctx.fillStyle = '#ffffff';
        for (let s = 0; s < 40; s++) {
          const sx = (s * 97) % W, sy = ((s * 61 + this.cam * 0.2) % (H + 40)) - 20;
          ctx.globalAlpha = k * (0.3 + (s % 5) / 7); ctx.fillRect(sx, sy, s % 3 ? 1 : 2, s % 3 ? 1 : 2);
        }
        ctx.globalAlpha = 1;
      }
      // Clouds drifting past the lower floors.
      ctx.fillStyle = 'rgba(255,255,255,' + (0.1 * (1 - k)) + ')';
      for (let s = 0; s < 4; s++) {
        const cx = ((s * 140 + this.t * (8 + s * 3)) % (W + 160)) - 80, cy = (s * 170 + this.cam * 0.5) % (H + 100) - 50;
        ctx.beginPath(); ctx.ellipse(cx, cy, 50, 14, 0, 0, Math.PI * 2); ctx.ellipse(cx + 26, cy - 8, 30, 12, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.save(); ctx.translate(0, this.cam);
      // The ground the tower stands on.
      const gy = BASE_Y + BH;
      if (gy - D < H - this.cam + 40) {
        ctx.fillStyle = '#1b2a55'; ctx.fillRect(-10, gy, W + 20, 200);
        ctx.fillStyle = '#26407a'; ctx.fillRect(-10, gy, W + 20, 4);
      }
      const from = Math.max(0, Math.floor((BASE_Y + BH - (H - this.cam)) / BH) - 1);
      for (let n = from; n < this.blocks.length; n++) { const b = this.blocks[n]; this.block(b.x, this.rowY(b.i), b.w, b.i, b.sy, b.flash); }
      if (this.cur) { const c = this.cur; this.block(c.x, this.rowY(c.i), c.w, c.i); }
      for (const b of this.bits) {
        ctx.save(); ctx.translate(b.x + b.w / 2, b.y + BH / 2); ctx.rotate(b.r);
        this.block(-b.w / 2, -BH / 2, b.w, b.i);
        ctx.restore();
      }
      ctx.restore();
      if (this.combo >= 2) {
        ctx.save(); ctx.font = font(9); ctx.textAlign = 'center'; ctx.fillStyle = '#fff6c8';
        ctx.fillText('COMBO ' + this.combo, W / 2, 28); ctx.restore();
      }
    },
  };

  Arcade.register('stack', stack);
})();
