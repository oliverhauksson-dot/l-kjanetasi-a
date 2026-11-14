/* Sleigh Ride (game id "flappy", so old scores, links and boards still work).
   Loaded on demand by js/arcade.js the first time the game is opened.
   The rules are the same as the old Flappy: tap to fly up, pass the gaps, a hit ends the flight.
   Only the look changed: Santa's sleigh over a snowy night town, chimneys from below and icicles from above. */
(() => {
  const { ctx, C, rand, clamp, sfx, setScore, over, tween, pop, cached } = Arcade;

  const RED = '#e2384d', DARK_RED = '#9e1f33', GOLD = '#f3cf7c', SNOW = '#f4f8ff', BRICK = '#a8473a', BRICK_D = '#7c3027';
  // A bell instead of a flap.
  // Looks-only random numbers, so snow and sparkles never change the pipes of a Daily Challenge.
  let seed = 12345;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const jingle = () => { sfx.tone(1568, 0.09, 'triangle', 0.035); setTimeout(() => sfx.tone(2093, 0.07, 'triangle', 0.025), 45); };

  const flappy = {
    W: 360, H: 480, BX: 90, GAP: 140, color: 'var(--gold)', title: 'Sleigh Ride', label: 'Chimneys',
    intro: 'Tap to fly Santa\'s sleigh up and steer between the chimneys and the icicles. A bump or the snow ends the ride.',
    hint: '<kbd>Space</kbd> <kbd>↑</kbd>, click or tap to fly up. <kbd>P</kbd> to pause',
    reset() {
      this.by = this.H / 2 - 40; this.vy = -300; this.pipes = []; this.score = 0; this.t = 0; this.dist = 0;
      this.sq = { x: 1, y: 1 }; this.gifts = []; this.dust = [];
      if (!this.flakes) this.flakes = Array.from({ length: 46 }, () => ({ x: noise() * this.W, y: noise() * this.H, r: 0.8 + noise() * 1.6, s: 18 + noise() * 30 }));
    },
    flap() {
      this.vy = -400; jingle();
      this.sq = { x: 0.8, y: 1.22 }; tween(this.sq, { x: 1, y: 1 }, 450, { ease: 'elastic' }); // The sleigh stretches up, then wobbles back.
    },
    key(e, down) { if (down && !e.repeat && ['Space', 'ArrowUp', 'KeyW'].includes(e.code)) this.flap(); },
    press(down) { if (down) this.flap(); },
    update(dt) {
      this.t += dt; const sp = 150 + Math.min(this.score, 40) * 2; this.dist += sp * dt;
      this.vy = Math.min(this.vy + 1400 * dt, 600); this.by += this.vy * dt;
      const last = this.pipes[this.pipes.length - 1];
      if (!last || last.x < this.W - 190) this.pipes.push({ x: this.W + 20, gy: rand(70, this.H - 90 - this.GAP), passed: false });
      for (const p of this.pipes) {
        p.x -= sp * dt;
        if (!p.passed && p.x + 52 < this.BX) {
          p.passed = true; this.score++; setScore(this.score); pop(this.BX, this.by - 26, '+1', GOLD);
          // A present drops down the chimney just passed (looks only).
          const g = { x: this.BX - 12, y: this.by + 6, p, a: 1, c: [C.cyan, C.lime, C.violet, C.pink][this.score % 4] };
          this.gifts.push(g);
        }
      }
      this.pipes = this.pipes.filter((p) => p.x > -60);
      for (const g of this.gifts) { g.x -= sp * dt * 0.55; g.y += 260 * dt; }
      this.gifts = this.gifts.filter((g) => g.y < this.H - 40 && g.y < g.p.gy + this.GAP + 18);
      // Sparkly dust behind the sleigh.
      if (Math.floor(this.t * 40) !== Math.floor((this.t - dt) * 40)) this.dust.push({ x: this.BX - 18, y: this.by + 4 + (noise() - 0.5) * 8, l: 1 });
      for (const d of this.dust) { d.x -= sp * dt; d.l -= dt * 1.8; }
      this.dust = this.dust.filter((d) => d.l > 0);
      for (const f of this.flakes) { f.y += f.s * dt; f.x -= sp * dt * 0.15; if (f.y > this.H) f.y -= this.H; if (f.x < 0) f.x += this.W; }
      const r = 11;
      const end = () => over(this.score, 'You flew past ' + this.score + ' chimney' + (this.score === 1 ? '' : 's') + '.');
      if (this.by + r > this.H - 40 || this.by - r < 0) return end();
      for (const p of this.pipes) {
        if (this.BX + r > p.x && this.BX - r < p.x + 52 && (this.by - r < p.gy || this.by + r > p.gy + this.GAP)) return end();
      }
    },
    sky() {
      const { W, H } = this;
      return cached('sleigh-sky', W, H, (g) => {
        const sky = g.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, '#050a24'); sky.addColorStop(0.7, '#12245a'); sky.addColorStop(1, '#1d3a7a');
        g.fillStyle = sky; g.fillRect(0, 0, W, H);
        let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
        g.fillStyle = '#dfe9ff';
        for (let i = 0; i < 60; i++) { const sz = rnd() < 0.2 ? 2 : 1; g.globalAlpha = 0.4 + rnd() * 0.6; g.fillRect(rnd() * W, rnd() * H * 0.7, sz, sz); }
        g.globalAlpha = 1;
        // The moon.
        g.fillStyle = 'rgba(255,244,200,.12)'; g.beginPath(); g.arc(280, 80, 46, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff4c8'; g.beginPath(); g.arc(280, 80, 28, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#f0e2a8'; g.beginPath(); g.arc(272, 74, 5, 0, Math.PI * 2); g.arc(288, 90, 4, 0, Math.PI * 2); g.fill();
      });
    },
    // A row of little snowy houses with lit windows, scrolling slower than the chimneys.
    town() {
      const { W, H } = this, span = 480;
      const off = -((this.dist * 0.25) % span);
      const strip = cached('sleigh-town', span, 140, (g) => {
        g.fillStyle = '#16285c';
        g.beginPath(); g.moveTo(0, 140); for (let x = 0; x <= span; x += 20) g.lineTo(x, 70 + Math.sin(x / span * Math.PI * 4) * 16); g.lineTo(span, 140); g.fill();
        const houses = [[20, 44, 36], [84, 54, 46], [160, 40, 34], [226, 60, 50], [312, 46, 40], [388, 56, 42]];
        for (const [x, w, h] of houses) {
          const top = 140 - h;
          g.fillStyle = '#20356f'; g.fillRect(x, top, w, h);
          g.fillStyle = SNOW; g.beginPath(); g.moveTo(x - 5, top + 1); g.lineTo(x + w / 2, top - 18); g.lineTo(x + w + 5, top + 1); g.fill();
          g.fillStyle = '#ffd46b';
          g.fillRect(x + 7, top + 10, 8, 8); g.fillRect(x + w - 15, top + 10, 8, 8);
          if (h > 44) g.fillRect(x + w / 2 - 4, top + h - 16, 8, 16);
        }
      });
      ctx.drawImage(strip, off, H - 40 - 140 + 6, span, 140);
      ctx.drawImage(strip, off + span, H - 40 - 140 + 6, span, 140);
    },
    chimney(x, top, h) {
      ctx.fillStyle = BRICK; ctx.fillRect(x, top, 52, h);
      ctx.fillStyle = BRICK_D;
      for (let y = top + 22; y < top + h; y += 12) {
        ctx.fillRect(x, y, 52, 2);
        const o = ((y - top) / 12) % 2 ? 0 : 13;
        for (let bx = x + o; bx < x + 52; bx += 26) ctx.fillRect(bx, y - 10, 2, 10);
      }
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(x + 40, top + 16, 12, h - 16);
      // The cap with snow on it.
      ctx.fillStyle = '#5a2620'; ctx.fillRect(x - 4, top, 60, 16);
      ctx.fillStyle = SNOW; ctx.fillRect(x - 6, top - 5, 64, 8); ctx.fillRect(x + 4, top + 3, 10, 4); ctx.fillRect(x + 34, top + 3, 8, 5);
    },
    icicles(x, h) {
      // A frozen ice column hanging from a snow cloud, with icicles at the bottom.
      const ice = ctx.createLinearGradient(x, 0, x + 52, 0);
      ice.addColorStop(0, '#9fd8ff'); ice.addColorStop(0.5, '#dff3ff'); ice.addColorStop(1, '#7cb8e8');
      ctx.fillStyle = ice; ctx.fillRect(x, 0, 52, h - 16);
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(x + 8, 0, 4, h - 22); ctx.fillRect(x + 18, 0, 2, h - 30);
      ctx.fillStyle = '#c9ecff'; ctx.fillRect(x - 4, h - 16, 60, 16);
      ctx.fillStyle = SNOW; ctx.fillRect(x - 6, h - 18, 64, 6);
      // Icicles poke below the gap edge a little, only as a look: the hit box is still the straight edge.
      ctx.fillStyle = '#bfe6ff';
      for (let i = 0; i < 5; i++) {
        const ix = x - 2 + i * 13, len = 5 + ((i * 7 + Math.floor(x)) % 3) * 2;
        ctx.beginPath(); ctx.moveTo(ix, h); ctx.lineTo(ix + 8, h); ctx.lineTo(ix + 4, h + len - 4); ctx.fill();
      }
    },
    sleigh() {
      const t = this.t;
      // Runners.
      ctx.fillStyle = GOLD;
      ctx.fillRect(-15, 9, 26, 2);
      ctx.fillRect(10, 5, 2, 6); ctx.fillRect(12, 4, 4, 2);
      ctx.fillRect(-10, 6, 2, 4); ctx.fillRect(4, 6, 2, 4);
      // The sack of presents at the back.
      ctx.fillStyle = '#8a5a34'; ctx.beginPath(); ctx.arc(-11, -6, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6b4226'; ctx.fillRect(-13, -14, 4, 3);
      // Santa.
      ctx.fillStyle = RED; ctx.fillRect(-3, -12, 10, 10);
      ctx.fillStyle = '#ffd3b0'; ctx.fillRect(-1, -18, 7, 6);
      ctx.fillStyle = SNOW; ctx.fillRect(-2, -14, 9, 4); ctx.fillRect(4, -13, 4, 4); // beard
      ctx.fillStyle = RED; ctx.fillRect(-2, -22, 8, 4); ctx.fillRect(-5, -20 + Math.sin(t * 10), 4, 3);
      ctx.fillStyle = SNOW; ctx.fillRect(-3, -19, 10, 2); ctx.fillRect(-7, -20 + Math.sin(t * 10), 3, 3); // hat trim and pompom
      ctx.fillStyle = C.bg; ctx.fillRect(4, -16, 2, 2); // eye
      // The sleigh body.
      ctx.fillStyle = RED;
      ctx.beginPath(); ctx.moveTo(-17, -4); ctx.lineTo(9, -4); ctx.lineTo(14, -9); ctx.lineTo(16, -6); ctx.lineTo(12, 6); ctx.lineTo(-14, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = DARK_RED; ctx.fillRect(-14, 3, 26, 3);
      ctx.fillStyle = GOLD; ctx.fillRect(-15, -4, 24, 2); ctx.fillRect(-8, 0, 3, 3); ctx.fillRect(2, 0, 3, 3);
    },
    draw() {
      const { W, H } = this;
      ctx.drawImage(this.sky(), 0, 0, W, H);
      this.town();
      for (const p of this.pipes) {
        this.icicles(p.x, p.gy);
        const top = p.gy + this.GAP;
        this.chimney(p.x, top, H - 40 - top);
        // Smoke puffs out of the chimney.
        ctx.fillStyle = 'rgba(220,230,255,.18)';
        for (let i = 0; i < 3; i++) {
          const k = (this.t * 0.8 + i / 3) % 1;
          ctx.beginPath(); ctx.arc(p.x + 26 + Math.sin((k + i) * 6) * 5, top - 8 - k * 26, 4 + k * 6, 0, Math.PI * 2); ctx.fill();
        }
      }
      for (const g of this.gifts) {
        ctx.fillStyle = g.c; ctx.fillRect(g.x - 5, g.y - 5, 10, 10);
        ctx.fillStyle = GOLD; ctx.fillRect(g.x - 1, g.y - 5, 2, 10); ctx.fillRect(g.x - 5, g.y - 1, 10, 2);
      }
      // Snowy ground.
      ctx.fillStyle = '#dfe9fb'; ctx.fillRect(0, H - 40, W, 40);
      ctx.fillStyle = SNOW; ctx.fillRect(0, H - 40, W, 4);
      ctx.fillStyle = '#c3d3ee'; for (let x = -(this.dist % 24); x < W; x += 24) ctx.fillRect(x, H - 26, 12, 3);
      for (const d of this.dust) { ctx.globalAlpha = d.l; ctx.fillStyle = d.l > 0.5 ? '#fff6c8' : GOLD; ctx.fillRect(d.x, d.y, 2, 2); }
      ctx.globalAlpha = 1;
      ctx.save(); ctx.translate(this.BX, this.by); ctx.rotate(clamp(this.vy / 900, -0.5, 0.9)); ctx.scale(this.sq.x, this.sq.y);
      this.sleigh();
      ctx.restore();
      ctx.fillStyle = SNOW;
      for (const f of this.flakes) { ctx.globalAlpha = 0.75; ctx.fillRect(f.x, f.y, f.r, f.r); }
      ctx.globalAlpha = 1;
    },
  };

  Arcade.register('flappy', flappy);
})();
