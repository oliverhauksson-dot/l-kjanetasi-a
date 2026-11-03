/* Snake. Loaded on demand by js/arcade.js the first time the game is opened. */
(() => {
  const { ctx, C, cached, setScore, over } = Arcade;

  const N = 15;
  const snake = {
    W: 420, H: 420, color: 'var(--lime)', title: 'Snake', label: 'Score',
    intro: 'Eat the fruit to grow. Hitting a wall or yourself ends the run.',
    hint: '<kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd> or <kbd>WASD</kbd> to steer, swipe on a phone, <kbd>P</kbd> to pause',
    reset() {
      this.body = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }];
      this.dir = { x: 1, y: 0 }; this.queue = []; this.score = 0; this.acc = 0; this.step = 0.16; this.t = 0;
      this.worn = new Float32Array(N * N); // Dirt the snake has worn into the grass, 0 to 1.
      this.food = this.place();
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
      for (let i = 0; i < this.worn.length; i++) if (this.worn[i] > 0) this.worn[i] = Math.max(0, this.worn[i] - dt * 0.12);
      while (this.acc >= this.step) {
        this.acc -= this.step;
        if (this.queue.length) this.dir = this.queue.shift();
        const h = this.body[0], n = { x: h.x + this.dir.x, y: h.y + this.dir.y };
        const eat = n.x === this.food.x && n.y === this.food.y;
        const hitsSelf = this.body.some((s, i) => (eat || i < this.body.length - 1) && s.x === n.x && s.y === n.y);
        if (n.x < 0 || n.y < 0 || n.x >= N || n.y >= N || hitsSelf) return over(this.score);
        this.body.unshift(n); this.worn[n.y * N + n.x] = 1;
        if (eat) {
          this.score++; setScore(this.score);
          if (this.body.length >= N * N) return over(this.score, 'You filled the whole board!');
          this.food = this.place(); this.step = Math.max(0.08, this.step - 0.003);
        } else this.body.pop();
      }
    },
    draw() {
      const s = this.W / N;
      ctx.drawImage(cached('snake-board', this.W, this.H, (g) => {
        // Grass: two greens in a checkerboard, tufts of darker and lighter blades, and a few bare dirt spots.
        let seed = 7;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          g.fillStyle = (x + y) % 2 ? '#4f9e2f' : '#5bad36'; g.fillRect(x * s, y * s, s, s);
        }
        for (let i = 0; i < 14; i++) {
          const x = rnd() * this.W, y = rnd() * this.H, r = 5 + rnd() * 7;
          g.fillStyle = 'rgba(122, 86, 48, 0.55)';
          g.beginPath(); g.ellipse(x, y, r * 1.4, r, rnd() * Math.PI, 0, Math.PI * 2); g.fill();
          g.fillStyle = 'rgba(92, 62, 34, 0.6)';
          g.beginPath(); g.ellipse(x + 2, y + 1, r * 0.6, r * 0.4, 0, 0, Math.PI * 2); g.fill();
        }
        for (let i = 0; i < 520; i++) {
          const x = rnd() * this.W, y = rnd() * this.H, h = 3 + rnd() * 5, lean = (rnd() - 0.5) * 3;
          g.strokeStyle = rnd() < 0.55 ? '#3e8524' : '#7cc94a'; g.lineWidth = 1.2;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + lean, y - h); g.stroke();
        }
      }), 0, 0, this.W, this.H);
      // Brown dirt where the snake has been, fading back to grass.
      for (let i = 0; i < this.worn.length; i++) {
        const w = this.worn[i]; if (!w) continue;
        ctx.fillStyle = `rgba(140, 92, 46, ${(w * 0.85).toFixed(3)})`;
        ctx.fillRect((i % N) * s, Math.floor(i / N) * s, s, s);
      }
      const pulse = 2 + Math.sin(this.t * 8) * 1.5, fx = this.food.x * s + s / 2, fy = this.food.y * s + s / 2;
      ctx.fillStyle = '#e8343b'; ctx.beginPath(); ctx.arc(fx, fy + 1, s / 2 - 6 + pulse / 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)'; ctx.fillRect(fx - 6, fy - 4, 3, 3);
      ctx.fillStyle = '#6b3d1e'; ctx.fillRect(fx - 1, fy - s / 2 + 3, 3, 6);
      ctx.fillStyle = '#3e8524'; ctx.fillRect(fx + 2, fy - s / 2 + 4, 5, 3);
      this.body.forEach((p, i) => {
        ctx.fillStyle = '#1f3d10'; ctx.fillRect(p.x * s + 1, p.y * s + 1, s - 2, s - 2);
        ctx.fillStyle = i === 0 ? '#f2ff9e' : (i % 2 ? '#e3f26b' : '#c9e04a');
        ctx.fillRect(p.x * s + 3, p.y * s + 3, s - 6, s - 6);
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
