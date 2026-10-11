/* Maze Muncher. Loaded on demand by js/arcade.js the first time the game is opened. */
(() => {
  const { ctx, C, cached, sfx, setScore, over, font } = Arcade;

  const MAZE = [
    '###################',
    '#........#........#',
    '#o##.###.#.###.##o#',
    '#.................#',
    '#.##.#.#####.#.##.#',
    '#....#...#...#....#',
    '####.### # ###.####',
    '   #.#       #.#   ',
    '####.# ##-## #.####',
    '    .  #   #  .    ',
    '####.# ##### #.####',
    '   #.#       #.#   ',
    '####.# ##### #.####',
    '#........#........#',
    '#.##.###.#.###.##.#',
    '#o.#...........#.o#',
    '##.#.#.#####.#.#.##',
    '#....#...#...#....#',
    '#.######.#.######.#',
    '#.................#',
    '###################',
  ];
  const MW = 19, MH = 21, MT = 22;
  const DIRS = [[0, -1], [-1, 0], [0, 1], [1, 0]];
  const muncher = {
    W: MW * MT, H: MH * MT + 28, color: 'var(--cyan)', title: 'Maze Muncher', label: 'Score',
    intro: 'Eat every dot in the maze and dodge the ghosts. Grab a big dot to turn the ghosts blue, then chase them for bonus points. You have 3 lives.',
    hint: '<kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd> or <kbd>WASD</kbd> to move, swipe on a phone, <kbd>P</kbd> to pause',
    reset() { this.score = 0; this.lives = 3; this.level = 1; this.t = 0; this.fill(); this.place(); },
    fill() {
      this.dots = MAZE.map((row) => [...row].map((ch) => (ch === '.' ? 1 : ch === 'o' ? 2 : 0)));
      this.left = this.dots.flat().filter(Boolean).length;
    },
    place() {
      const spd = 6 + Math.min(this.level - 1, 5) * 0.4;
      this.pl = { x: 9, y: 15, dx: 0, dy: 0, p: 0, want: null, speed: spd };
      const cols = ['#ff6b9a', '#ffb347', '#b8e65c', '#a78bfa'];
      this.ghosts = cols.map((col, i) => ({
        col, i, x: 9, y: 7, dx: i % 2 ? 1 : -1, dy: 0, p: 0, state: 'home',
        wait: i * 3 + 1, hx: 8 + (i % 3), speed: spd * 0.9,
      }));
      this.fright = 0; this.chain = 0; this.ready = 1.2; this.dying = 0;
    },
    open(x, y) { x = (x + MW) % MW; return y >= 0 && y < MH && MAZE[y][x] !== '#' && MAZE[y][x] !== '-'; },
    key(e, down) {
      if (!down) return;
      const m = { ArrowUp: 0, KeyW: 0, ArrowLeft: 1, KeyA: 1, ArrowDown: 2, KeyS: 2, ArrowRight: 3, KeyD: 3 }[e.code];
      if (m !== undefined) this.steer(DIRS[m]);
    },
    swipe(dx, dy) { if (Math.abs(dx) > Math.abs(dy)) this.steer([Math.sign(dx), 0]); else this.steer([0, Math.sign(dy)]); },
    steer(d) {
      const pl = this.pl; pl.want = d;
      // Turning around mid-step is allowed at any time.
      if (pl.p > 0 && d[0] === -pl.dx && d[1] === -pl.dy) {
        pl.x = (pl.x + pl.dx + MW) % MW; pl.y += pl.dy; pl.dx = d[0]; pl.dy = d[1]; pl.p = 1 - pl.p;
      }
    },
    // Move an actor along the grid; choose(a) picks its next direction at each tile.
    walk(a, dist, choose) {
      while (dist > 0) {
        if (a.p === 0) {
          choose(a);
          if (!a.dx && !a.dy) return;
        }
        const stepLen = Math.min(dist, 1 - a.p);
        a.p += stepLen; dist -= stepLen;
        if (a.p >= 1) { a.x = (a.x + a.dx + MW) % MW; a.y += a.dy; a.p = 0; if (a === this.pl) this.eat(); }
      }
    },
    eat() {
      const pl = this.pl, d = this.dots[pl.y][pl.x];
      if (!d) return;
      this.dots[pl.y][pl.x] = 0; this.left--;
      if (d === 2) { this.score += 50; this.fright = Math.max(3, 8 - this.level); this.chain = 0; this.ghosts.forEach((g) => { if (g.state === 'chase') { g.dx = -g.dx; g.dy = -g.dy; g.p = g.p ? 1 - g.p : 0; if (g.p) { g.x = (g.x - g.dx + MW) % MW; g.y -= g.dy; } } }); sfx.tone(260, 0.25, 'square', 0.05, 520); }
      else { this.score += 10; sfx.tone(this.left % 2 ? 620 : 520, 0.04, 'square', 0.025); }
      setScore(this.score);
      if (!this.left) { this.level++; this.score += 500; setScore(this.score); sfx.win(); this.fill(); this.place(); }
    },
    target(g) {
      const pl = this.pl;
      if (g.state === 'eyes') return [9, 7];
      const scatter = (this.t % 27) < 7;
      const corners = [[MW - 2, 1], [1, 1], [MW - 2, MH - 2], [1, MH - 2]];
      if (scatter) return corners[g.i];
      if (g.i === 1) return [pl.x + pl.dx * 4, pl.y + pl.dy * 4];
      if (g.i === 2) return [MW - 1 - pl.x, MH - 1 - pl.y];
      if (g.i === 3 && Math.hypot(g.x - pl.x, g.y - pl.y) < 6) return corners[3];
      return [pl.x, pl.y];
    },
    update(dt) {
      this.t += dt;
      if (this.dying) {
        this.dying -= dt;
        if (this.dying <= 0) { if (--this.lives <= 0) return over(this.score); this.place(); }
        return;
      }
      if (this.ready > 0) { this.ready -= dt; return; }
      const pl = this.pl;
      this.walk(pl, pl.speed * dt, (a) => {
        if (a.want && this.open(a.x + a.want[0], a.y + a.want[1])) { a.dx = a.want[0]; a.dy = a.want[1]; }
        else if (!this.open(a.x + a.dx, a.y + a.dy)) { a.dx = 0; a.dy = 0; }
      });
      if (this.fright > 0) this.fright -= dt;
      for (const g of this.ghosts) {
        if (g.state === 'home') {
          g.wait -= dt;
          if (g.wait <= 0) { g.state = 'chase'; g.x = 9; g.y = 7; g.p = 0; g.dx = g.i % 2 ? 1 : -1; g.dy = 0; }
          continue;
        }
        const scared = this.fright > 0 && g.state === 'chase';
        const sp = g.state === 'eyes' ? g.speed * 2 : scared ? g.speed * 0.55 : (MAZE[g.y][g.x] === ' ' && g.y === 9 ? g.speed * 0.6 : g.speed);
        this.walk(g, sp * dt, (a) => {
          if (a.state === 'eyes' && a.x === 9 && a.y === 7) { a.state = 'home'; a.wait = 1; a.dx = a.dy = 0; return; }
          const opts = DIRS.filter(([dx, dy]) => !(dx === -a.dx && dy === -a.dy) && this.open(a.x + dx, a.y + dy));
          if (!opts.length) { a.dx = -a.dx; a.dy = -a.dy; return; }
          let pick;
          if (scared) pick = opts[Math.floor(Math.random() * opts.length)];
          else {
            const [tx, ty] = this.target(a);
            pick = opts.reduce((best, d) => {
              const v = Math.hypot(a.x + d[0] - tx, a.y + d[1] - ty);
              return v < best.v ? { d, v } : best;
            }, { d: opts[0], v: Infinity }).d;
          }
          a.dx = pick[0]; a.dy = pick[1];
        });
        if (g.state === 'home') continue;
        const gx = g.x + g.dx * g.p, gy = g.y + g.dy * g.p, px = pl.x + pl.dx * pl.p, py = pl.y + pl.dy * pl.p;
        if (g.state !== 'eyes' && Math.hypot(gx - px, gy - py) < 0.7) {
          if (this.fright > 0) {
            g.state = 'eyes'; this.chain++;
            this.score += 100 * 2 ** this.chain; setScore(this.score);
            sfx.tone(900, 0.2, 'square', 0.05, 1800);
          } else { this.dying = 1.4; sfx.lose(); return; }
        }
      }
    },
    // The maze walls never change, so they are drawn once and reused every frame.
    paintWalls(g) {
      const s = MT;
      const wall = (x, y) => x < 0 || y < 0 || x >= MW || y >= MH || MAZE[y][x] === '#' || MAZE[y][x] === '-';
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
        const ch = MAZE[y][x];
        if (ch === '#') {
          g.fillStyle = '#211b31'; g.fillRect(x * s, y * s, s, s);
          g.fillStyle = C.violet;
          if (!wall(x, y - 1)) g.fillRect(x * s, y * s, s, 2);
          if (!wall(x, y + 1)) g.fillRect(x * s, y * s + s - 2, s, 2);
          if (!wall(x - 1, y)) g.fillRect(x * s, y * s, 2, s);
          if (!wall(x + 1, y)) g.fillRect(x * s + s - 2, y * s, 2, s);
        } else if (ch === '-') { g.fillStyle = C.pink; g.fillRect(x * s, y * s + s / 2 - 2, s, 4); }
      }
    },
    draw() {
      const s = MT;
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, this.W, this.H);
      ctx.drawImage(cached('muncher-walls', this.W, MH * s, (g) => this.paintWalls(g)), 0, 0, this.W, MH * s);
      const bigOn = Math.floor(this.t * 4) % 2 === 0;
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
        const d = this.dots[y][x];
        if (d === 1) { ctx.fillStyle = '#f4ecdc'; ctx.fillRect(x * s + s / 2 - 2, y * s + s / 2 - 2, 4, 4); }
        else if (d === 2 && bigOn) { ctx.fillStyle = C.amber; ctx.fillRect(x * s + 5, y * s + 5, s - 10, s - 10); }
      }
      // Ghosts
      for (const g of this.ghosts) {
        let gx, gy;
        if (g.state === 'home') { gx = g.hx * s; gy = 9 * s + Math.sin(this.t * 5 + g.i) * 3; }
        else { gx = (g.x + g.dx * g.p) * s; gy = (g.y + g.dy * g.p) * s; }
        const blink = this.fright > 0 && this.fright < 1.5 && Math.floor(this.t * 6) % 2;
        const body = g.state === 'eyes' ? null : (this.fright > 0 && g.state === 'chase') ? (blink ? '#f4ecdc' : '#3d5afe') : g.col;
        if (body) {
          ctx.fillStyle = body;
          ctx.fillRect(gx + 4, gy + 2, s - 8, 4); ctx.fillRect(gx + 2, gy + 6, s - 4, s - 10);
          for (let k = 0; k < 3; k++) ctx.fillRect(gx + 2 + k * 6, gy + s - 4, 4, 3);
        }
        ctx.fillStyle = '#f4ecdc'; ctx.fillRect(gx + 5, gy + 7, 5, 5); ctx.fillRect(gx + 12, gy + 7, 5, 5);
        ctx.fillStyle = '#15111f'; ctx.fillRect(gx + 6 + g.dx * 2, gy + 9 + g.dy * 2, 3, 3); ctx.fillRect(gx + 13 + g.dx * 2, gy + 9 + g.dy * 2, 3, 3);
      }
      // Muncher: a square cyan critter with a chomping mouth.
      const pl = this.pl, px = (pl.x + pl.dx * pl.p) * s, py = (pl.y + pl.dy * pl.p) * s;
      const shrink = this.dying ? Math.max(0, 1 - (1.4 - this.dying) / 1.2) : 1;
      const sz = (s - 4) * shrink, ox = px + (s - sz) / 2, oy = py + (s - sz) / 2;
      ctx.fillStyle = C.cyan; ctx.fillRect(ox, oy, sz, sz);
      if (shrink > 0.3) {
        const open = (pl.dx || pl.dy) && !this.ready ? Math.abs(Math.sin(this.t * 14)) * 6 : 2;
        const fx = pl.dx || (pl.dy ? 0 : 1), fy = pl.dy;
        ctx.fillStyle = C.bg;
        const cx = px + s / 2, cy = py + s / 2;
        if (fx) ctx.fillRect(fx > 0 ? cx + 2 : cx - sz / 2, cy - open / 2, sz / 2 - 2, open);
        else ctx.fillRect(cx - open / 2, fy > 0 ? cy + 2 : cy - sz / 2, open, sz / 2 - 2);
        if (fx) ctx.fillRect(cx - fx * 2 - 1.5, cy - 7, 3, 3); else ctx.fillRect(cx + 5, cy - fy * 2 - 1.5, 3, 3);
      }
      // Footer: lives and level
      ctx.fillStyle = C.cyan;
      for (let k = 0; k < this.lives - (this.dying ? 0 : 1); k++) ctx.fillRect(8 + k * 22, MH * s + 8, 14, 14);
      ctx.fillStyle = C.muted; ctx.font = font(10); ctx.textAlign = 'right';
      ctx.fillText('LEVEL ' + this.level, this.W - 8, MH * s + 20);
      if (this.ready > 0) { ctx.fillStyle = C.amber; ctx.textAlign = 'center'; ctx.fillText('READY!', this.W / 2, 11 * s + 15); }
      ctx.textAlign = 'left';
    },
  };

  Arcade.register('muncher', muncher);
})();
