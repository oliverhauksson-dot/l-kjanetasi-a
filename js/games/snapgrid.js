/* Snap Grid. Loaded on demand by js/arcade.js the first time the game is opened. */
(() => {
  const { ctx, C, cached, sfx, setScore, over, font } = Arcade;

  const N = 8, CS = 40, OX = 20, OY = 20; // 8x8 board, 40px cells, board's top left corner.
  const TRAY_Y = OY + N * CS + 20, SLOT_W = 120, TRAY_H = 120; // The three pieces wait below the board.
  const COLORS = ['#5ce1e6', '#ffd56b', '#a78bfa', '#b8e65c', '#ff6b9a', '#6b8cff', '#ffb347'];
  const parse = (s) => s.split('/').map((row) => [...row].map((ch) => ch === '#'));
  // Pieces never turn, so every way round a shape can appear is listed on its own.
  const SHAPES = [
    '#', '##', '#/#', '###', '#/#/#', '####', '#/#/#/#', '#####', '#/#/#/#/#',
    '##/##', '###/###/###', '###/###', '##/##/##',
    '##/#.', '##/.#', '#./##', '.#/##',
    '###/#../#..', '###/..#/..#', '#../#../###', '..#/..#/###',
    '###/.#.', '.#./###', '#./##/#.', '.#/##/.#',
    '##./.##', '.##/##.', '#./##/.#', '.#/##/#.',
    '#../###', '..#/###', '###/#..', '###/..#', '##/#./#.', '##/.#/.#', '#./#./##', '.#/.#/##',
  ].map(parse);

  const snapgrid = {
    W: 360, H: TRAY_Y + TRAY_H + 10, color: 'var(--cyan)', title: 'Snap Grid', label: 'Score', quietScore: true,
    intro: 'Drag the pieces onto the grid. Fill a whole row or column to clear it. The game ends when none of your pieces fit.',
    hint: 'Drag a piece onto the grid with your mouse or finger. Keys: <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> pick, arrows move, <kbd>Space</kbd> place',
    reset() {
      this.board = Array.from({ length: N }, () => Array(N).fill(null));
      this.score = 0; this.combo = 0; this.miss = 0; this.end = 0;
      this.drag = null; this.down = false; this.pos = null; this.sel = null;
      this.flash = []; this.pops = [];
      this.deal();
    },
    fits(m, r, c) {
      if (r < 0 || c < 0 || r + m.length > N || c + m[0].length > N) return false;
      return m.every((row, y) => row.every((v, x) => !v || !this.board[r + y][c + x]));
    },
    fitsAnywhere(m) {
      for (let r = 0; r <= N - m.length; r++) for (let c = 0; c <= N - m[0].length; c++) if (this.fits(m, r, c)) return true;
      return false;
    },
    deal() {
      // Three new pieces. Try a few times so at least one of them fits, which keeps a hard board from ending out of the blue.
      for (let t = 0; t < 20; t++) {
        this.tray = [0, 1, 2].map(() => ({ m: SHAPES[Math.floor(Math.random() * SHAPES.length)], c: COLORS[Math.floor(Math.random() * COLORS.length)] }));
        if (this.tray.some((p) => this.fitsAnywhere(p.m))) break;
      }
    },
    // Which rows and columns would be full if piece m went at (r, c).
    fullLines(m, r, c) {
      const filled = (y, x) => this.board[y][x] || (y >= r && y < r + m.length && x >= c && x < c + m[0].length && m[y - r][x - c]);
      const rows = [], cols = [];
      for (let i = 0; i < N; i++) {
        if ([...Array(N).keys()].every((x) => filled(i, x))) rows.push(i);
        if ([...Array(N).keys()].every((y) => filled(y, i))) cols.push(i);
      }
      return { rows, cols };
    },
    place(i, r, c) {
      const p = this.tray[i];
      const { rows, cols } = this.fullLines(p.m, r, c);
      let cells = 0;
      p.m.forEach((row, y) => row.forEach((v, x) => { if (v) { this.board[r + y][c + x] = p.c; cells++; } }));
      this.tray[i] = null;
      let gain = cells;
      const lines = rows.length + cols.length;
      if (lines) {
        // The combo keeps going as long as you clear something at least once every 3 pieces.
        this.combo++; this.miss = 0;
        const hit = new Set();
        rows.forEach((y) => { for (let x = 0; x < N; x++) hit.add(y * N + x); });
        cols.forEach((x) => { for (let y = 0; y < N; y++) hit.add(y * N + x); });
        hit.forEach((k) => { const y = Math.floor(k / N), x = k % N; this.flash.push({ y, x, c: this.board[y][x], t: 0.3 }); this.board[y][x] = null; });
        const bonus = 10 * lines * lines * this.combo;
        gain += bonus;
        let text = '+' + bonus;
        if (this.board.every((row) => row.every((v) => !v))) { gain += 300; text = 'CLEAR! +' + (bonus + 300); }
        this.pops.push({ text, sub: this.combo > 1 ? 'COMBO x' + this.combo : '', x: Math.max(80, Math.min(this.W - 80, OX + (c + p.m[0].length / 2) * CS)), y: OY + (r + p.m.length / 2) * CS, t: 0.8 });
        [523, 659, 784, 1047].slice(0, Math.min(4, lines + 1)).forEach((f, k) => setTimeout(() => sfx.tone(f, 0.1), k * 70));
      } else {
        sfx.tone(330, 0.06, 'triangle', 0.06);
        if (++this.miss >= 3) this.combo = 0;
      }
      this.score += gain; setScore(this.score);
      if (this.tray.every((t) => !t)) this.deal();
      if (!this.tray.some((t) => t && this.fitsAnywhere(t.m))) this.end = 0.8; // Short pause so you can see the last move.
    },
    // Top left corner of a dragged piece: held above the finger so the finger doesn't hide it.
    lifted(p, m) { return { x: p.x - m[0].length * CS / 2, y: p.y - m.length * CS - 28 }; },
    snap(m, at) { return { r: Math.round((at.y - OY) / CS), c: Math.round((at.x - OX) / CS) }; },
    target() {
      // Where the piece being dragged (or picked with the keyboard) would land, or null if it doesn't fit there.
      if (this.drag && this.pos) {
        const m = this.tray[this.drag.i].m, s = this.snap(m, this.lifted(this.pos, m));
        return this.fits(m, s.r, s.c) ? { i: this.drag.i, ...s } : null;
      }
      if (this.sel) return this.fits(this.tray[this.sel.i].m, this.sel.r, this.sel.c) ? this.sel : null;
      return null;
    },
    slotAt(p) {
      if (p.y < TRAY_Y - 10) return -1;
      const i = Math.floor((p.x - (this.W - 3 * SLOT_W) / 2) / SLOT_W);
      return i >= 0 && i < 3 && this.tray[i] ? i : -1;
    },
    press(down) {
      if (this.end) return;
      this.down = down;
      if (down) { this.drag = null; return; }
      if (this.drag) { const t = this.target(); if (t) this.place(t.i, t.r, t.c); }
      this.drag = null;
    },
    point(p) {
      this.pos = p;
      if (this.down && !this.drag && !this.end) {
        const i = this.slotAt(p);
        if (i >= 0) { this.drag = { i }; this.sel = null; }
      }
    },
    key(e, down) {
      if (!down || this.end) return;
      const n = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[e.code];
      if (n !== undefined && this.tray[n]) {
        const m = this.tray[n].m;
        this.sel = { i: n, r: Math.floor((N - m.length) / 2), c: Math.floor((N - m[0].length) / 2) };
        return;
      }
      if (!this.sel) return;
      const m = this.tray[this.sel.i].m, mv = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.code];
      if (mv) {
        this.sel.r = Math.max(0, Math.min(N - m.length, this.sel.r + mv[0]));
        this.sel.c = Math.max(0, Math.min(N - m[0].length, this.sel.c + mv[1]));
      } else if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
        const t = this.target(); if (t) { this.sel = null; this.place(t.i, t.r, t.c); }
      }
    },
    update(dt) {
      this.flash.forEach((f) => { f.t -= dt; }); this.flash = this.flash.filter((f) => f.t > 0);
      this.pops.forEach((f) => { f.t -= dt; }); this.pops = this.pops.filter((f) => f.t > 0);
      if (this.end && (this.end -= dt) <= 0) {
        this.end = 0;
        over(this.score, 'No more room for your pieces. Score ' + this.score + '.');
      }
    },
    cell(x, y, col, s = CS) {
      ctx.fillStyle = col; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      const e = Math.max(2, Math.round(s / 8));
      ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(x + 1, y + 1, s - 2, e);
      ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x + 1, y + s - 1 - e, s - 2, e);
    },
    piece(m, col, x, y, s) { m.forEach((row, r) => row.forEach((v, c) => { if (v) this.cell(x + c * s, y + r * s, col, s); })); },
    draw() {
      ctx.drawImage(cached('snapgrid-board', this.W, this.H, (g) => {
        g.fillStyle = C.bg; g.fillRect(0, 0, this.W, this.H);
        g.fillStyle = '#151024'; g.fillRect(OX, OY, N * CS, N * CS);
        g.strokeStyle = '#241c38'; g.lineWidth = 1; g.beginPath();
        for (let i = 1; i < N; i++) {
          g.moveTo(OX + i * CS + 0.5, OY); g.lineTo(OX + i * CS + 0.5, OY + N * CS);
          g.moveTo(OX, OY + i * CS + 0.5); g.lineTo(OX + N * CS, OY + i * CS + 0.5);
        }
        g.stroke();
        g.fillStyle = '#151024'; g.fillRect(OX, TRAY_Y, N * CS, TRAY_H);
      }), 0, 0, this.W, this.H);

      const t = this.target();
      const lines = t ? this.fullLines(this.tray[t.i].m, t.r, t.c) : { rows: [], cols: [] };
      this.board.forEach((row, r) => row.forEach((v, c) => {
        if (!v) return;
        // Blocks that the piece you're holding would clear light up white.
        this.cell(OX + c * CS, OY + r * CS, lines.rows.includes(r) || lines.cols.includes(c) ? C.ink : v);
      }));
      if (t) {
        const p = this.tray[t.i];
        ctx.globalAlpha = 0.4; this.piece(p.m, p.c, OX + t.c * CS, OY + t.r * CS, CS); ctx.globalAlpha = 1;
      }
      this.flash.forEach((f) => {
        const k = f.t / 0.3, s = CS * (0.4 + 0.6 * k);
        ctx.globalAlpha = k; this.cell(OX + f.x * CS + (CS - s) / 2, OY + f.y * CS + (CS - s) / 2, f.c, s); ctx.globalAlpha = 1;
      });

      this.tray.forEach((p, i) => {
        if (!p || (this.drag && this.drag.i === i)) return;
        const s = Math.min(22, Math.floor(100 / Math.max(p.m.length, p.m[0].length)));
        const w = p.m[0].length * s, h = p.m.length * s;
        const cx = (this.W - 3 * SLOT_W) / 2 + i * SLOT_W + SLOT_W / 2, cy = TRAY_Y + TRAY_H / 2;
        const stuck = !this.fitsAnywhere(p.m);
        if (stuck) ctx.globalAlpha = 0.3;
        this.piece(p.m, p.c, cx - w / 2, cy - h / 2, s);
        ctx.globalAlpha = 1;
        if (this.sel && this.sel.i === i) { ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(cx - SLOT_W / 2 + 6, TRAY_Y + 4, SLOT_W - 12, TRAY_H - 8); }
      });
      if (this.drag && this.pos) {
        const p = this.tray[this.drag.i], at = this.lifted(this.pos, p.m);
        this.piece(p.m, p.c, at.x, at.y, CS);
      }

      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      this.pops.forEach((f) => {
        ctx.globalAlpha = Math.min(1, f.t * 2);
        const y = f.y - (0.8 - f.t) * 30;
        ctx.font = font(14); ctx.fillStyle = '#15111f'; ctx.fillText(f.text, f.x + 2, y + 2);
        ctx.fillStyle = C.amber; ctx.fillText(f.text, f.x, y);
        if (f.sub) { ctx.font = font(9); ctx.fillStyle = C.pink; ctx.fillText(f.sub, f.x, y + 20); }
        ctx.globalAlpha = 1;
      });
    },
  };

  Arcade.register('snapgrid', snapgrid);
})();
