/* Snake. Loaded on demand by js/arcade.js the first time the game is opened. */
(() => {
  const { ctx, C, cached, setScore, over, tween, pop } = Arcade;

  const N = 20;
  const snake = {
    W: 440, H: 440, color: 'var(--lime)', title: 'Snake', label: 'Score',
    intro: 'Eat the fruit to grow. Hitting a wall or yourself ends the run.',
    hint: '<kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd> or <kbd>WASD</kbd> to steer, swipe on a phone, <kbd>P</kbd> to pause',
    reset() {
      this.body = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }];
      this.dir = { x: 1, y: 0 }; this.queue = []; this.score = 0; this.acc = 0; this.step = 0.13; this.t = 0;
      this.food = this.place();
      this.wave = { p: 9 }; this.grow = { s: 1 }; // Looks only: a bulge that runs down the body after eating, and the new fruit growing in.
    },
    place() {
      let p;
      do { p = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) }; }
      while (this.body.some((s) => s.x === p.x && s.y === p.y));
      return p;
    },
    turn(dx, dy) {
      const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
      if ((last.x === -dx && last.y === -dy) || (last.x === dx && last.y === dy)) return;
      if (this.queue.length < 3) this.queue.push({ x: dx, y: dy });
    },
    key(e, down) {
      if (!down) return;
      const m = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] }[e.code];
      if (m) this.turn(m[0], m[1]);
    },
    swipe(dx, dy) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
      if (Math.abs(dx) > Math.abs(dy)) this.turn(Math.sign(dx), 0); else this.turn(0, Math.sign(dy));
    },
    update(dt) {
      this.t += dt; this.acc += dt;
      while (this.acc >= this.step) {
        this.acc -= this.step;
        if (this.queue.length) this.dir = this.queue.shift();
        const h = this.body[0], n = { x: h.x + this.dir.x, y: h.y + this.dir.y };
        const eat = n.x === this.food.x && n.y === this.food.y;
        const hitsSelf = this.body.some((s, i) => (eat || i < this.body.length - 1) && s.x === n.x && s.y === n.y);
        if (n.x < 0 || n.y < 0 || n.x >= N || n.y >= N || hitsSelf) return over(this.score);
        this.body.unshift(n);
        if (eat) {
          this.score++; setScore(this.score);
          pop(n.x * this.W / N + this.W / N / 2, n.y * this.W / N, '+1', C.amber);
          this.wave = { p: 0 }; tween(this.wave, { p: 1 }, 420, { ease: 'linear' });
          if (this.body.length >= N * N) return over(this.score, 'You filled the whole board!');
          this.food = this.place(); this.step = Math.max(0.06, this.step - 0.003);
          this.grow = { s: 0 }; tween(this.grow, { s: 1 }, 320, { ease: 'back' });
        } else this.body.pop();
      }
    },
    draw() {
      const s = this.W / N;
      ctx.drawImage(cached('snake-board', this.W, this.H, (g) => {
        g.fillStyle = C.bg; g.fillRect(0, 0, this.W, this.H);
        g.fillStyle = '#151024';
        for (let y = 0; y < N; y++) for (let x = (y % 2); x < N; x += 2) g.fillRect(x * s, y * s, s, s);
      }), 0, 0, this.W, this.H);
      const pulse = 2 + Math.sin(this.t * 8) * 1.5, fs = (s - 10 + pulse) * this.grow.s;
      ctx.fillStyle = C.amber; ctx.fillRect(this.food.x * s + s / 2 - fs / 2, this.food.y * s + s / 2 - fs / 2, fs, fs);
      if (this.grow.s > 0.6) { ctx.fillStyle = '#7a3b8a'; ctx.fillRect(this.food.x * s + s / 2 - 1, this.food.y * s + 1, 3, 4); }
      const front = this.wave.p * this.body.length;
      this.body.forEach((p, i) => {
        const bulge = 3 * Math.max(0, 1 - Math.abs(i - front) / 1.5);
        ctx.fillStyle = i === 0 ? '#e3ff9e' : (i % 2 ? C.lime : '#a3d24c');
        ctx.fillRect(p.x * s + 1 - bulge, p.y * s + 1 - bulge, s - 2 + bulge * 2, s - 2 + bulge * 2);
      });
      const h = this.body[0], d = this.dir;
      ctx.fillStyle = C.bg;
      const cx = h.x * s + s / 2 + d.x * 4, cy = h.y * s + s / 2 + d.y * 4;
      ctx.fillRect(cx - d.y * 5 - 2, cy - d.x * 5 - 2, 4, 4);
      ctx.fillRect(cx + d.y * 5 - 2, cy + d.x * 5 - 2, 4, 4);
    },
  };

  Arcade.register('snake', snake);
})();
