/* Blocks. Loaded on demand by js/arcade.js the first time the game is opened. */
(() => {
  const { ctx, C, cached, setScore, over, font } = Arcade;

  const COLS = 10, ROWS = 20, CS = 21;
  const PIECES = [
    [[[1, 1, 1, 1]], '#5ce1e6'], [[[1, 1], [1, 1]], '#ffd56b'], [[[0, 1, 0], [1, 1, 1]], '#a78bfa'],
    [[[0, 1, 1], [1, 1, 0]], '#b8e65c'], [[[1, 1, 0], [0, 1, 1]], '#ff6b9a'], [[[1, 0, 0], [1, 1, 1]], '#6b8cff'], [[[0, 0, 1], [1, 1, 1]], '#ffb347'],
  ];
  const rotate = (m) => m[0].map((_, i) => m.map((r) => r[i]).reverse());
  const blocks = {
    W: 350, H: 440, color: 'var(--cyan)', title: 'Blocks', label: 'Score',
    intro: 'Fit the falling pieces together. A full row disappears. Clear more rows at once for more points.',
    hint: '<kbd>←</kbd><kbd>→</kbd> move, <kbd>↑</kbd> turn, <kbd>↓</kbd> drop faster, <kbd>Space</kbd> drop. On a phone: drag to move, tap to turn',
    reset() {
      this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
      this.score = 0; this.lines = 0; this.level = 1; this.acc = 0; this.next = this.pick(); this.spawn();
    },
    pick() { const [m, c] = PIECES[Math.floor(Math.random() * PIECES.length)]; return { m, c }; },
    spawn() {
      this.p = this.next; this.next = this.pick();
      this.x = Math.floor((COLS - this.p.m[0].length) / 2); this.y = 0;
      if (this.collide(this.p.m, this.x, this.y)) { this.dead = true; }
    },
    collide(m, x, y) {
      for (let r = 0; r < m.length; r++) for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const nx = x + c, ny = y + r;
        if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
        if (ny >= 0 && this.board[ny][nx]) return true;
      }
      return false;
    },
    move(dx) { if (!this.collide(this.p.m, this.x + dx, this.y)) this.x += dx; },
    turn() {
      const m = rotate(this.p.m);
      for (const k of [0, -1, 1, -2, 2]) if (!this.collide(m, this.x + k, this.y)) { this.p.m = m; this.x += k; return; }
    },
    fall() {
      if (!this.collide(this.p.m, this.x, this.y + 1)) { this.y++; return true; }
      this.lock(); return false;
    },
    lock() {
      this.p.m.forEach((row, r) => row.forEach((v, c) => { if (v && this.y + r >= 0) this.board[this.y + r][this.x + c] = this.p.c; }));
      let cleared = 0;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (this.board[r].every(Boolean)) { this.board.splice(r, 1); this.board.unshift(Array(COLS).fill(null)); cleared++; r++; }
      }
      if (cleared) {
        this.score += [0, 100, 300, 500, 800][cleared] * this.level; this.lines += cleared;
        this.level = 1 + Math.floor(this.lines / 10); setScore(this.score);
      }
      this.spawn();
    },
    key(e, down) {
      if (!down) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.move(-1);
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.move(1);
      else if ((e.code === 'ArrowUp' || e.code === 'KeyW') && !e.repeat) this.turn();
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') { if (this.fall()) { this.score += 1; setScore(this.score); } this.acc = 0; }
      else if (e.code === 'Space' && !e.repeat) { let n = 0; while (this.fall()) n++; this.score += n * 2; setScore(this.score); this.acc = 0; }
    },
    swipe(dx, dy) {
      if (Math.abs(dx) > Math.abs(dy)) this.move(Math.sign(dx));
      else if (dy > 0) { this.fall(); this.acc = 0; }
    },
    tap() { this.turn(); },
    update(dt) {
      if (this.dead) return over(this.score, 'The stack hit the top. ' + this.lines + ' rows cleared, score ' + this.score + '.');
      this.acc += dt;
      const step = Math.max(0.1, 0.8 - (this.level - 1) * 0.07);
      while (this.acc >= step) { this.acc -= step; this.fall(); }
      if (this.dead) return over(this.score, 'The stack hit the top. ' + this.lines + ' rows cleared, score ' + this.score + '.');
    },
    cell(x, y, col, s = CS) {
      ctx.fillStyle = col; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(x + 1, y + 1, s - 2, 3);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + 1, y + s - 4, s - 2, 3);
    },
    draw() {
      const ox = 10, oy = 10;
      ctx.drawImage(cached('blocks-well', this.W, this.H, (g) => {
        g.fillStyle = C.bg; g.fillRect(0, 0, this.W, this.H);
        g.fillStyle = '#151024'; g.fillRect(ox, oy, COLS * CS, ROWS * CS);
        g.strokeStyle = '#1f1832'; g.lineWidth = 1; g.beginPath();
        for (let c = 1; c < COLS; c++) { g.moveTo(ox + c * CS + 0.5, oy); g.lineTo(ox + c * CS + 0.5, oy + ROWS * CS); }
        g.stroke();
      }), 0, 0, this.W, this.H);
      this.board.forEach((row, r) => row.forEach((v, c) => { if (v) this.cell(ox + c * CS, oy + r * CS, v); }));
      let gy = this.y; while (!this.collide(this.p.m, this.x, gy + 1)) gy++;
      this.p.m.forEach((row, r) => row.forEach((v, c) => {
        if (!v) return;
        if (gy + r >= 0) { ctx.strokeStyle = this.p.c; ctx.globalAlpha = 0.35; ctx.strokeRect(ox + (this.x + c) * CS + 2.5, oy + (gy + r) * CS + 2.5, CS - 5, CS - 5); ctx.globalAlpha = 1; }
        if (this.y + r >= 0) this.cell(ox + (this.x + c) * CS, oy + (this.y + r) * CS, this.p.c);
      }));
      const sx = ox + COLS * CS + 16;
      ctx.font = font(9); ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = C.muted; ctx.fillText('NEXT', sx, 14);
      this.next.m.forEach((row, r) => row.forEach((v, c) => { if (v) this.cell(sx + c * 18, 34 + r * 18, this.next.c, 18); }));
      ctx.fillStyle = C.muted; ctx.fillText('ROWS', sx, 110); ctx.fillText('LEVEL', sx, 160);
      ctx.font = font(14); ctx.fillStyle = C.ink;
      ctx.fillText(this.lines, sx, 126); ctx.fillText(this.level, sx, 176);
    },
  };

  Arcade.register('blocks', blocks);
})();
