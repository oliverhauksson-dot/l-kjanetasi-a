/* Minigolf 3D. Loaded on demand by js/arcade.js the first time the game is opened.
   Nine adventure holes in real 3D, played against three bots with made-up gamer names. Everyone putts at the
   same time. The bots' balls are see-through and yours rolls straight through them. Your own total shots are your
   score (fewer is better), and a hole stops at 7 shots. Water or falling off the course costs one shot.
   From 1 December to 6 January (or with ?xmas on the address) every hole gets a Christmas look.

   The 3D picture is drawn with three.js (js/vendor, only downloaded for the 3D games) and copied onto the arcade's
   canvas every frame. The ball physics are worked out here, not by three.js. A hole is made of:
   - surfaces: flat pieces, ramps, a spiral and a bowl, each with a height at every point (water is a surface too),
   - walls: straight pieces with a bottom and a top height, so a ball on a higher level can roll over a low one,
   - round posts and bumpers, spinning bars, sliding pucks, a windmill door, a drawbridge and a loop.
   Every moving part is worked out from the hole's clock, so a bot can try putts in its head and pick a good one. */
(() => {
  const { ctx, C, clamp, font, sfx, setScore, over, pop, shake, calm } = Arcade;

  let T = null, failed = false;
  const here = document.currentScript ? document.currentScript.src : location.href;
  import(new URL('../vendor/three.module.min.js', here).href).then((m) => { T = m; }, () => { failed = true; });

  const W = 400, H = 640;
  const R = 0.5, CUP = 1.15, GRAV = 30, MAX_SHOTS = 7, MAX_SPEED = 78, STEP_UP = 0.35;
  // How fast a rolling ball slows down on each surface: a fixed part and a part that grows with speed.
  const FRICTION = { grass: [6, 0.6], wood: [6, 0.6], stone: [6, 0.6], basalt: [6, 0.6], sand: [40, 1.8], ice: [2.2, 0.11], water: [6, 0.6] };
  const TAU = Math.PI * 2;
  const lerp = (a, b, k) => a + (b - a) * k;
  const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const ease = (k) => k * k * (3 - 2 * k);
  // Christmas look: 1 December to 6 January, or ?xmas on the address (?xmas=off hides it).
  const XMAS = (() => {
    const q = new URLSearchParams(location.search).get('xmas');
    if (q === 'off') return false;
    if (q !== null) return true;
    const d = new Date(), m = d.getMonth();
    return m === 11 || (m === 0 && d.getDate() <= 6);
  })();

  /* ---------- Building a hole ---------- */
  function Hole(name, par, tee, cup) {
    Object.assign(this, { name, par, tee, cup, wind: null, surfaces: [], walls: [], posts: [], bumpers: [], spinners: [], pucks: [], boxes: [], mills: [], bridges: [], loops: [], route: [], deco: [] });
  }
  Object.assign(Hole.prototype, {
    add(s) {
      if (s.pts) { const xs = s.pts.map((p) => p[0]), zs = s.pts.map((p) => p[1]); s.bb = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; }
      else s.bb = [s.cx - s.r1, s.cz - s.r1, s.cx + s.r1, s.cz + s.r1];
      this.surfaces.push(s); return s;
    },
    rect(x0, z0, x1, z1, y, mat = 'grass', extra) { return this.add(Object.assign({ kind: 'flat', pts: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], y, mat }, extra)); },
    // Heights go from y0 at the low end of the axis (z0 or x0) to y1 at the other end.
    ramp(x0, z0, x1, z1, y0, y1, axis = 'z', mat = 'grass') { return this.add({ kind: 'ramp', pts: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], x0, z0, x1, z1, y0, y1, axis, mat }); },
    // A kicker: a short ramp with hidden side walls, so a ball beside it can't roll through its sides.
    kicker(x0, z0, x1, z1, top) {
      this.ramp(x0, z0, x1, z1, 0, top, 'z', 'wood');
      this.wall(x0, z0, x0, z1, -1, 0.02, -1, top - 0.02, 'none'); this.wall(x1, z0, x1, z1, -1, 0.02, -1, top - 0.02, 'none');
      this.wall(x0, z1, x1, z1, -1, top * 0.5, -1, top * 0.5, 'none'); // Low enough that a ball going up the kicker passes over it.
    },
    spiral(cx, cz, r0, r1, a0, a1, y0, y1, bank) { return this.add({ kind: 'spiral', cx, cz, r0, r1, a0, a1, y0, y1, bank, mat: 'basalt' }); },
    bowl(cx, cz, r, y, slope) { return this.add({ kind: 'bowl', cx, cz, r0: 0, r1: r, r, y, slope, mat: 'grass' }); },
    wall(ax, az, bx, bz, b0, t0, b1 = b0, t1 = t0, look = 'rail', e = 0.7) { this.walls.push({ ax, az, bx, bz, b0, b1, t0, t1, look, e }); },
    rail(ax, az, bx, bz, ya = 0, yb = ya, e) { this.wall(ax, az, bx, bz, ya - 1.5, ya + 1.1, yb - 1.5, yb + 1.1, 'rail', e); },
    ring(pts, y = 0, open = []) { pts.forEach((p, i) => { if (!open.includes(i)) { const q = pts[(i + 1) % pts.length]; this.rail(p[0], p[1], q[0], q[1], y); } }); },
    box(x0, z0, x1, z1, y0, y1, look) {
      this.boxes.push({ x0, z0, x1, z1, y0, y1, look });
      [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]].forEach(([a, b, c, d]) => this.wall(a, b, c, d, y0 - 1, y1, y0 - 1, y1, 'none', 0.55));
    },
    // Walls round part of a circle. top(angle) gives the height of the top.
    arc(cx, cz, r, a0, a1, n, bottom, top, look = 'rail') {
      for (let i = 0; i < n; i++) {
        const p = a0 + (a1 - a0) * i / n, q = a0 + (a1 - a0) * (i + 1) / n;
        this.wall(cx + Math.cos(p) * r, cz + Math.sin(p) * r, cx + Math.cos(q) * r, cz + Math.sin(q) * r, bottom, top(p), bottom, top(q), look);
      }
    },
  });

  function makeHoles() {
    const holes = [];
    // (Seen from the tee, +x is on the left of the screen.)
    // 1. A gentle start: three snowmen stand in the way, so go round the middle one or bank off a side.
    let h = new Hole('Snowy Start', 2, [0, 0, 4], [0, 0, 41]);
    h.rect(-6, 0, 6, 46, 0); h.ring([[-6, 0], [6, 0], [6, 46], [-6, 46]]);
    h.posts.push(...[[-3, 22], [0, 26], [3, 22]].map(([x, z]) => ({ x, z, r: 1.15, y0: 0, y1: 3.4, look: 'snowman' })));
    h.route = [[0, 0, 4], [1.6, 0, 23.5], [0, 0, 41]];
    holes.push(h);

    // 2. A ramp up to a raised green. Too soft and the ball rolls back. Shortcut: the kicker on the left jumps onto the top.
    h = new Hole('Up the Ramp', 2, [0, 0, 5], [0, 4, 49]);
    h.rect(-6, 0, 6, 20, 0); h.ramp(-4, 20, 4, 34, 0, 4); h.rect(-7, 34, 7, 54, 4);
    h.kicker(2.4, 11, 5.2, 16.5, 1.5);
    h.rail(-6, 0, 6, 0); h.rail(-6, 0, -6, 20); h.rail(6, 0, 6, 20); h.rail(-6, 20, -4, 20); h.rail(4, 20, 6, 20);
    h.rail(-4, 20, -4, 34, 0, 4); h.rail(4, 20, 4, 34, 0, 4);
    h.rail(-7, 34, -4, 34, 4); h.wall(4, 34, 7, 34, 2, 4.4, 2, 4.4, 'lip');
    h.rail(-7, 34, -7, 54, 4); h.rail(7, 34, 7, 54, 4); h.rail(-7, 54, 7, 54, 4);
    h.route = [[0, 0, 5], [0, 0, 19], [0, 4, 35], [0, 4, 49]];
    holes.push(h);

    // 3. A windmill with turning sails. Through the door is quickest; the side lanes are safe but sandy.
    h = new Hole('Windmill', 3, [0, 0, 4], [0, 0, 45]);
    h.rect(-7, 0, 7, 50, 0); h.ring([[-7, 0], [7, 0], [7, 50], [-7, 50]]);
    h.rect(-7, 21, -4.6, 33, 0, 'sand'); h.rect(4.6, 21, 7, 33, 0, 'sand');
    h.box(-4.6, 24, -1.4, 30, 0, 6, 'mill'); h.box(1.4, 24, 4.6, 30, 0, 6, 'mill');
    h.box(-7, 37, -2.6, 38.2, 0, 1.4, 'hedge'); h.box(2.6, 37, 7, 38.2, 0, 1.4, 'hedge');
    h.mills.push({ x: 0, z: 23.4, y: 7.6, speed: 1.25, len: 6.6, gate: { ax: -1.4, az: 23.8, bx: 1.4, bz: 23.8, b0: -1, b1: -1, t0: 3, t1: 3 } });
    h.route = [[0, 0, 4], [0, 0, 22.5], [0, 0, 31.5], [0, 0, 45]];
    holes.push(h);

    // 4. Jump the pond from the ramp onto the island. Shortcut: the narrow plank on the left. A breeze blows to the left.
    h = new Hole('Lily Pond', 3, [0, 0, 4], [0, 0.3, 50]);
    h.wind = [2.2, 0];
    h.rect(-6, 0, 6, 18, 0); h.rect(-12, 18, 12, 38, -0.5, 'water'); h.rect(-7, 38, 7, 58, 0.3); h.rect(4.6, 18, 6, 38, 0.12, 'wood');
    h.ramp(-2.5, 11, 2.5, 18, 0, 1.6, 'z', 'wood');
    h.wall(-2.5, 11, -2.5, 18, -1, 0.02, -1, 1.58, 'none'); h.wall(2.5, 11, 2.5, 18, -1, 0.02, -1, 1.58, 'none');
    h.rail(-6, 0, 6, 0); h.rail(-6, 0, -6, 18); h.rail(6, 0, 6, 18); h.rail(-6, 18, -2.5, 18); h.rail(2.5, 18, 4.6, 18);
    h.rail(-7, 38, -7, 58, 0.3); h.rail(7, 38, 7, 58, 0.3); h.rail(-7, 58, 7, 58, 0.3);
    h.wall(-7, 38, 4.6, 38, -2, 0.75, -2, 0.75, 'lip'); h.wall(6, 38, 7, 38, -2, 0.75, -2, 0.75, 'lip');
    h.deco.push({ look: 'pads' });
    h.route = [[0, 0, 4], [0, 0, 11], [0, 1.6, 18], [0, 0.3, 40], [0, 0.3, 50]];
    holes.push(h);

    // 5. Pinball: glowing bumpers kick the ball, two bars spin. Shortcut: the narrow lane down the right side.
    h = new Hole('Pinball', 4, [0, 0, 4], [0, 0, 52]);
    h.rect(-9, 0, 9, 58, 0); h.ring([[-9, 0], [9, 0], [9, 58], [-9, 58]]);
    h.rail(-7.4, 9, -7.4, 49);
    h.rail(5.6, 9, 8.6, 15, 0, 0, 1.15);
    h.bumpers.push(...[[0, 26, 1.4], [-3.2, 31, 1.2], [3.2, 31, 1.2], [-5, 41, 1], [5, 41, 1], [2.5, 47.5, 0.9], [-2.5, 47.5, 0.9]].map(([x, z, r]) => ({ x, z, r, flash: 0 })));
    h.spinners.push({ x: 0, z: 14, y: 0, len: 3.4, speed: 1.9, phase: 0 }, { x: 5.2, z: 22, y: 0, len: 2.2, speed: -2.5, phase: 1 });
    h.route = [[0, 0, 4], [0, 0, 18], [-5.6, 0, 28], [-1.5, 0, 40], [0, 0, 52]];
    holes.push(h);

    // 6. A castle: cross the drawbridge while it is down, then roll down to the lower green.
    //    Shortcut: the narrow stone ledge on the left and the gap in the castle wall.
    h = new Hole('Castle', 2, [0, 0, 4], [-3.8, -3, 63]);
    const br = { x0: -2.4, x1: 2.4, z0: 20, z1: 27, y: 0.05, period: 6.5 };
    h.bridges.push(br);
    h.rect(-7, 0, 7, 20, 0); h.rect(-12, 20, 12, 27, -0.6, 'water'); h.rect(-2.4, 20, 2.4, 27, 0.05, 'wood', { bridge: br });
    h.rect(5.6, 20, 6.9, 27, 0.05, 'stone'); h.rect(-7, 27, 7, 40, 0); h.ramp(-3, 40, 3, 52, 0, -3); h.rect(-7, 52, 7, 68, -3);
    h.rail(-7, 0, 7, 0); h.rail(-7, 0, -7, 20); h.rail(7, 0, 7, 20); h.rail(-7, 20, -2.4, 20); h.rail(2.4, 20, 5.6, 20); h.rail(6.9, 20, 7, 20);
    h.box(-7, 27.4, -2.4, 30.6, 0, 5, 'castle'); h.box(2.4, 27.4, 5.4, 30.6, 0, 5, 'castle');
    h.rail(-7, 27, -2.4, 27); h.rail(2.4, 27, 5.6, 27);
    h.rail(-7, 27, -7, 40); h.rail(7, 27, 7, 40); h.rail(-7, 40, -3, 40); h.rail(3, 40, 7, 40);
    h.rail(-3, 40, -3, 52, 0, -3); h.rail(3, 40, 3, 52, 0, -3);
    h.rail(-7, 52, -3, 52, -3); h.rail(3, 52, 7, 52, -3); h.box(-7, 57, -1.2, 58.2, -3, -1.8, 'hedge'); h.rail(-7, 52, -7, 68, -3); h.rail(7, 52, 7, 68, -3); h.rail(-7, 68, 7, 68, -3);
    h.route = [[0, 0, 4], [0, 0, 19], [0, 0.05, 23.5], [0, 0, 29], [0, 0, 39], [0, -3, 53], [2.6, -3, 57.6], [-3.8, -3, 63]];
    holes.push(h);

    // 7. Hit it hard enough to go all the way round the loop.
    h = new Hole('Loop-the-loop', 3, [0, 0, 4], [-2, 0, 57]);
    h.rect(-2.4, 0, 2.4, 30, 0); h.rect(-1.6, 30, 1.6, 36, 0); h.rect(1.6, 30, 5.6, 46, 0); h.rect(-6, 46, 6, 62, 0);
    h.rail(-2.4, 0, 2.4, 0); h.rail(-2.4, 0, -2.4, 30); h.rail(2.4, 0, 2.4, 30); h.rail(-2.4, 30, -1.6, 30); h.rail(1.6, 30, 2.4, 30);
    h.rail(-1.6, 30, -1.6, 36); h.rail(-1.6, 36, 1.6, 36); h.rail(1.6, 30, 1.6, 46); h.rail(1.6, 29.95, 5.6, 29.95); h.rail(5.6, 30, 5.6, 46);
    h.rail(-6, 46, -6, 62); h.rail(6, 46, 6, 62); h.rail(-6, 62, 6, 62); h.rail(-6, 46, 1.6, 46); h.rail(5.6, 46, 6, 46);
    h.box(-6, 52, -4.4, 53.2, 0, 1.2, 'hedge'); h.box(-0.4, 52, 6, 53.2, 0, 1.2, 'hedge');
    h.loops.push({ x: 0, z: 30, y: 0, R: 4.6, off: 3.8, mouth: 1.6 });
    h.route = [[0, 0, 4], [0, 0, 29.5], [3.8, 0, 30.5], [3.8, 0, 45], [2, 0, 49], [-2.4, 0, 52.6], [-2, 0, 57]];
    holes.push(h);

    // 8. Slippery ice with sliding pucks. Shortcut: the gap in the middle of the boards.
    h = new Hole('Ice Rink', 3, [0, 0, 3.4], [0, 0, 56]);
    h.rect(-3.5, 0, 3.5, 5.5, 0); h.rect(-9, 5.5, 9, 50, 0, 'ice'); h.rect(-4, 50, 4, 61, 0);
    h.rail(-3.5, 0, 3.5, 0); h.rail(-3.5, 0, -3.5, 5.5); h.rail(3.5, 0, 3.5, 5.5);
    for (const [a, b, c, d] of [[-9, 5.5, -3.5, 5.5], [3.5, 5.5, 9, 5.5], [-9, 5.5, -9, 50], [9, 5.5, 9, 50], [-9, 50, -4, 50], [4, 50, 9, 50], [-5.5, 27, -0.9, 27], [0.9, 27, 5.5, 27]]) h.rail(a, b, c, d, 0, 0, 0.85);
    h.rail(-4, 50, -4, 61); h.rail(4, 50, 4, 61); h.rail(-4, 61, 4, 61);
    h.pucks.push({ ax: -6.5, az: 20, bx: 6.5, bz: 20, r: 0.9, period: 3.4, phase: 0 }, { ax: 6.5, az: 35, bx: -6.5, bz: 35, r: 0.9, period: 2.8, phase: 1.3 });
    h.route = [[0, 0, 3.4], [0, 0, 27], [0, 0, 50], [0, 0, 56]];
    holes.push(h);

    // 9. Roll up the spiral round the volcano and drop into the crater, where everything runs down to the cup.
    //    Shortcut: the steep kicker in front of the tee jumps straight into the crater. A breeze blows to the right.
    h = new Hole('Volcano', 4, [0, 0, 4], [0, 2.2, 30]);
    h.wind = [-1.6, 0];
    const V = { cx: 0, cz: 30, r0: 4, r1: 8.5, a0: -Math.PI / 2, a1: -Math.PI / 2 + 4.4, y0: 0, y1: 4.4, bank: 0.6, rim: 4.6 };
    h.volcano = V; h.look = [0, 0, 30];
    h.rect(-15, 0, 15, 46, 0); h.ring([[-15, 0], [15, 0], [15, 46], [-15, 46]]);
    const sp = h.spiral(V.cx, V.cz, V.r0, V.r1, V.a0, V.a1, V.y0, V.y1, V.bank);
    h.bowl(V.cx, V.cz, V.r0, 2.2, 0.26);
    h.arc(V.cx, V.cz, V.r1, V.a0, V.a1, 30, -1, (a) => heightOf(sp, V.cx + Math.cos(a) * V.r1, V.cz + Math.sin(a) * V.r1) + 1.1);
    h.arc(V.cx, V.cz, V.r0, V.a0, V.a1 - 0.6, 26, -1, () => V.rim, 'none');
    h.arc(V.cx, V.cz, V.r0, V.a1, V.a0 + TAU, 6, -1, () => V.rim, 'none');
    h.wall(V.cx + Math.cos(V.a1) * V.r0, V.cz + Math.sin(V.a1) * V.r0, V.cx + Math.cos(V.a1) * V.r1, V.cz + Math.sin(V.a1) * V.r1, -1, 6.2, -1, 6.2, 'cone');
    h.kicker(-1.4, 14, 1.4, 17.5, 2.4);
    h.route = [[0, 0, 4], [-6, 0, 9], [-10.5, 0, 16], [-9, 0, 23], [-1.5, 0, 23.8]];
    for (let k = 1; k <= 7; k++) { const a = V.a0 + (V.a1 - V.a0) * k / 7 - (k === 7 ? 0.3 : 0), r = 6.2; h.route.push([V.cx + Math.cos(a) * r, heightOf(sp, V.cx + Math.cos(a) * r, V.cz + Math.sin(a) * r), V.cz + Math.sin(a) * r]); }
    h.route.push([0, 2.2, 30]);
    holes.push(h);

    for (const o of holes) {
      o.floor = Math.min(...o.surfaces.map((s) => (s.kind === 'bowl' ? s.y : s.kind === 'ramp' || s.kind === 'spiral' ? Math.min(s.y0, s.y1) - (s.bank || 0) : s.y))) - 2;
      for (const w of o.walls) w.bb = [Math.min(w.ax, w.bx) - R - 0.3, Math.min(w.az, w.bz) - R - 0.3, Math.max(w.ax, w.bx) + R + 0.3, Math.max(w.az, w.bz) + R + 0.3];
      let len = 0; o.routeLeft = [];
      for (let i = o.route.length - 1; i >= 0; i--) { o.routeLeft[i] = len; if (i) len += dist3(o.route[i], o.route[i - 1]); }
    }
    return holes;
  }
  const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  /* ---------- Surfaces ---------- */
  function inPoly(pts, x, z) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
    }
    return c;
  }
  const spiralU = (s, x, z) => (((Math.atan2(z - s.cz, x - s.cx) - s.a0) % TAU) + TAU) % TAU / (s.a1 - s.a0);
  function inside(s, x, z) {
    if (s.kind === 'spiral') { const r = Math.hypot(x - s.cx, z - s.cz); return r >= s.r0 && r <= s.r1 && spiralU(s, x, z) <= 1; }
    if (s.kind === 'bowl') return Math.hypot(x - s.cx, z - s.cz) <= s.r;
    return inPoly(s.pts, x, z);
  }
  function heightOf(s, x, z) {
    if (s.kind === 'ramp') { const k = s.axis === 'z' ? (z - s.z0) / (s.z1 - s.z0) : (x - s.x0) / (s.x1 - s.x0); return s.y0 + (s.y1 - s.y0) * clamp(k, 0, 1); }
    if (s.kind === 'spiral') { const r = Math.hypot(x - s.cx, z - s.cz); return s.y0 + (s.y1 - s.y0) * clamp(spiralU(s, x, z), 0, 1) - s.bank * clamp((s.r1 - r) / (s.r1 - s.r0), 0, 1); }
    if (s.kind === 'bowl') return s.y + s.slope * Math.hypot(x - s.cx, z - s.cz);
    return s.y;
  }
  // The slope of a surface (how much it rises per unit in x and in z), put into GX and GZ.
  let GX = 0, GZ = 0, GY = 0;
  function grad(s, x, z) {
    GX = 0; GZ = 0;
    if (s.kind === 'ramp') { if (s.axis === 'z') GZ = (s.y1 - s.y0) / (s.z1 - s.z0); else GX = (s.y1 - s.y0) / (s.x1 - s.x0); }
    else if (s.kind === 'spiral' || s.kind === 'bowl') {
      const dx = x - s.cx, dz = z - s.cz, r = Math.max(0.01, Math.hypot(dx, dz)), cx = dx / r, cz = dz / r;
      if (s.kind === 'bowl') { GX = cx * s.slope; GZ = cz * s.slope; }
      else { const along = (s.y1 - s.y0) / (s.a1 - s.a0) / r, out = s.bank / (s.r1 - s.r0); GX = -cz * along + cx * out; GZ = cx * along + cz * out; }
    }
  }
  // The drawbridge: down most of the time, then it goes up, stays up a moment and comes down again. 0 = down, 1 = up.
  function lift(b, t) {
    const k = (t % b.period) / b.period;
    if (k < 0.55) return 0; if (k < 0.68) return (k - 0.55) / 0.13; if (k < 0.84) return 1; return 1 - (k - 0.84) / 0.16;
  }
  // The highest surface under a point that a ball whose bottom is at foot can stand on. Its height goes in GY.
  function ground(Hl, x, z, foot, t) {
    let best = null, by = -Infinity;
    for (const s of Hl.surfaces) {
      const bb = s.bb;
      if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue;
      if (s.bridge && lift(s.bridge, t) > 0.04) continue;
      if (!inside(s, x, z)) continue;
      const y = heightOf(s, x, z);
      if (y <= foot + STEP_UP && y >= by) { best = s; by = y; }
    }
    GY = by;
    return best;
  }

  /* ---------- Moving parts (all worked out from the hole's clock t) ---------- */
  const gateShut = (m, t) => { for (let k = 0; k < 4; k++) if (Math.abs(wrapA(m.speed * t + k * Math.PI / 2 + Math.PI / 2)) < 0.42) return true; return false; };
  const puckAt = (p, t) => { const w = TAU / p.period, k = (1 - Math.cos(w * t + p.phase)) / 2, dk = Math.sin(w * t + p.phase) * w / 2; return [p.ax + (p.bx - p.ax) * k, p.az + (p.bz - p.az) * k, (p.bx - p.ax) * dk, (p.bz - p.az) * dk]; };
  const SEG = { ax: 0, az: 0, bx: 0, bz: 0, b0: 0, b1: 0, t0: 0, t1: 0, pad: 0.15 };

  /* ---------- Ball physics ---------- */
  function hitWall(b, w, e, ev, rot) {
    const dx = w.bx - w.ax, dz = w.bz - w.az, L2 = dx * dx + dz * dz;
    const u = L2 ? clamp(((b.x - w.ax) * dx + (b.z - w.az) * dz) / L2, 0, 1) : 0;
    const top = w.t0 + (w.t1 - w.t0) * u, bot = w.b0 + (w.b1 - w.b0) * u;
    if (b.y - R >= top - 0.01 || b.y + R <= bot) return false;
    const qx = w.ax + dx * u, qz = w.az + dz * u, reach = R + (w.pad || 0);
    let nx = b.x - qx, nz = b.z - qz;
    const d = Math.hypot(nx, nz);
    if (d >= reach) return false;
    if (d < 1e-6) { const l = Math.sqrt(L2) || 1; nx = -dz / l; nz = dx / l; } else { nx /= d; nz /= d; }
    b.x = qx + nx * reach; b.z = qz + nz * reach;
    const vx0 = rot ? -(qz - rot.z) * rot.speed : 0, vz0 = rot ? (qx - rot.x) * rot.speed : 0;
    const vn = (b.vx - vx0) * nx + (b.vz - vz0) * nz;
    if (vn < 0) { b.vx -= (1 + e) * vn * nx; b.vz -= (1 + e) * vn * nz; if (ev && -vn > 3) ev('wall', -vn, b); }
    return true;
  }
  function hitCircle(b, x, z, r, bot, top, e, kick, ev, vx0 = 0, vz0 = 0, who) {
    if (b.y - R >= top || b.y + R <= bot) return false;
    let nx = b.x - x, nz = b.z - z;
    const d = Math.hypot(nx, nz), m = r + R;
    if (d >= m) return false;
    if (d < 1e-6) { nx = 1; nz = 0; } else { nx /= d; nz /= d; }
    b.x = x + nx * m; b.z = z + nz * m;
    const vn = (b.vx - vx0) * nx + (b.vz - vz0) * nz;
    if (vn < 0) {
      b.vx -= (1 + e) * vn * nx; b.vz -= (1 + e) * vn * nz;
      if (kick) { b.vx += nx * kick; b.vz += nz * kick; if (who) who.flash = 1; }
      if (ev) ev(kick ? 'bumper' : 'wall', -vn, b);
    }
    return true;
  }
  // Everything that can push a ball, moving or not.
  function collide(b, Hl, t, ev, movingOnly) {
    let hit = false;
    if (!movingOnly) {
      for (const w of Hl.walls) { const bb = w.bb; if (b.x > bb[0] && b.x < bb[2] && b.z > bb[1] && b.z < bb[3]) hitWall(b, w, w.e, ev); }
      for (const p of Hl.posts) hitCircle(b, p.x, p.z, p.r, p.y0 - 1, p.y1, 0.5, 0, ev);
      for (const p of Hl.bumpers) hitCircle(b, p.x, p.z, p.r, -1, 1.2, 0.75, 4, ev, 0, 0, p);
      for (const m of Hl.mills) if (gateShut(m, t)) hit = hitWall(b, m.gate, 0.5, ev) || hit;
      for (const br of Hl.bridges) if (lift(br, t) > 0.3) { SEG.ax = br.x0; SEG.bx = br.x1; SEG.az = SEG.bz = br.z1 - 0.2; SEG.b0 = SEG.b1 = -2; SEG.t0 = SEG.t1 = 6; SEG.pad = 0; hitWall(b, SEG, 0.4, ev); }
    }
    for (const s of Hl.spinners) {
      const a = s.phase + s.speed * t, c = Math.cos(a) * s.len, n = Math.sin(a) * s.len;
      SEG.ax = s.x - c; SEG.az = s.z - n; SEG.bx = s.x + c; SEG.bz = s.z + n; SEG.b0 = SEG.b1 = s.y - 0.5; SEG.t0 = SEG.t1 = s.y + 0.9; SEG.pad = 0.15;
      hit = hitWall(b, SEG, 0.6, ev, s) || hit;
    }
    for (const p of Hl.pucks) { const q = puckAt(p, t); hit = hitCircle(b, q[0], q[1], p.r, -1, 0.7, 0.8, 0, ev, q[2], q[3]) || hit; }
    return hit;
  }
  // One small step. Sets b.hazard ('water' or 'out') or b.sunk when that happens.
  function sub(b, Hl, t, dt, ev) {
    const pz = b.z;
    if (!b.air) {
      const s = ground(Hl, b.x, b.z, b.y - R, t);
      if (!s) b.air = true;
      else if (s.mat === 'water') { b.hazard = 'water'; return; }
      else {
        const gy = GY;
        grad(s, b.x, b.z);
        const gx = GX, gz = GZ, k = GRAV / (1 + gx * gx + gz * gz);
        b.vx -= k * gx * dt; b.vz -= k * gz * dt;
        const f = FRICTION[s.mat] || FRICTION.grass, v = Math.hypot(b.vx, b.vz);
        if (v > 0) { const nv = Math.max(0, v - (f[0] + f[1] * v) * dt); b.vx *= nv / v; b.vz *= nv / v; }
        b.vy = gx * b.vx + gz * b.vz;
        b.x += b.vx * dt; b.z += b.vz * dt;
        const s2 = ground(Hl, b.x, b.z, gy, t);
        if (s2 && GY > gy - 0.12 - Math.max(0, -b.vy) * dt * 1.5) {
          if (s2.mat === 'water') { b.hazard = 'water'; return; }
          b.y = GY + R; b.mat = s2.mat;
        } else { b.air = true; b.y = gy + R; }
        b.slope = Math.abs(gx) + Math.abs(gz);
      }
    }
    if (b.air) {
      b.vy -= GRAV * dt;
      if (Hl.wind) { b.vx += Hl.wind[0] * dt; b.vz += Hl.wind[1] * dt; }
      const foot0 = b.y - R;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      const s = ground(Hl, b.x, b.z, foot0, t);
      if (s && b.y - R <= GY) {
        if (s.mat === 'water') { b.hazard = 'water'; return; }
        b.y = GY + R; b.mat = s.mat;
        if (b.vy < -6) { if (ev) ev('land', -b.vy, b); b.vy = -b.vy * 0.3; b.vx *= 0.92; b.vz *= 0.92; }
        else { b.air = false; b.vy = 0; }
      } else if (b.y < Hl.floor) { b.hazard = 'out'; return; }
    }
    collide(b, Hl, t, ev, false);
    if (b.air) return;
    for (const L of Hl.loops) {
      if (pz < L.z && b.z >= L.z && Math.abs(b.x - L.x) < L.mouth && b.vz > 0 && Math.abs(b.y - R - L.y) < 0.4) {
        b.loop = L; b.ls = 0; b.lv = Math.hypot(b.vx, b.vz); b.x = L.x; b.z = L.z; return;
      }
    }
    // The cup: a slow enough ball drops in; a fast one hops over the hole. Slow balls at the edge get pulled in.
    const c = Hl.cup, dx = c[0] - b.x, dz = c[2] - b.z, d = Math.hypot(dx, dz), v = Math.hypot(b.vx, b.vz);
    if (d < CUP + 0.5 && Math.abs(b.y - R - c[1]) < 0.4) {
      if (d < CUP - 0.3) { if (v < 11) { b.sunk = true; return; } b.vy = Math.min(4, v * 0.08); b.air = true; }
      else if (v < 6) { b.vx += dx / d * 20 * dt; b.vz += dz / d * 20 * dt; return; }
    }
    // A ball stops when it is slow on flat ground, or when it has been crawling for a moment (say, held against a wall on a slope).
    if (v < 0.6) b.slow += dt; else b.slow = 0;
    if ((v < 0.45 && b.slope < 0.04) || b.slow > 0.4) { b.vx = 0; b.vz = 0; b.rest = true; b.slow = 0; }
  }
  // The loop: the ball follows the track. Too slow near the top and it falls off.
  const loopX = (L, p) => L.x + L.off * ease(clamp((p - 1.5 * Math.PI) / (0.5 * Math.PI), 0, 1));
  function stepLoop(b, dt) {
    const L = b.loop, rho = L.R - R;
    let p = b.ls / rho;
    b.lv += (-GRAV * Math.sin(p) - Math.sign(b.lv) * (2 + 0.25 * Math.abs(b.lv))) * dt;
    b.ls += b.lv * dt; p = b.ls / rho;
    b.x = loopX(L, p); b.y = L.y + L.R - rho * Math.cos(p); b.z = L.z + rho * Math.sin(p);
    if (p >= TAU) { b.loop = null; b.x = L.x + L.off; b.z = L.z + 0.05; b.y = L.y + R; b.vx = 0; b.vz = b.lv; b.vy = 0; b.air = false; return; }
    if (p <= 0) { b.loop = null; b.x = L.x; b.z = L.z - 0.05; b.y = L.y + R; b.vx = 0; b.vz = b.lv; b.vy = 0; b.air = false; return; }
    if (p > Math.PI / 2 && p < 1.5 * Math.PI && b.lv * b.lv / rho < -GRAV * Math.cos(p)) {
      b.loop = null; b.air = true; b.vz = b.lv * Math.cos(p); b.vy = b.lv * Math.sin(p); b.vx = 0;
    }
  }
  function stepBall(b, Hl, t, dt, ev) {
    if (b.rest) { if (collide(b, Hl, t, ev, true)) b.rest = false; return; }
    const sp = b.loop ? Math.abs(b.lv) : Math.hypot(b.vx, b.vy, b.vz);
    const n = Math.min(14, Math.max(1, Math.ceil(sp * dt / 0.3))), h = dt / n;
    for (let i = 0; i < n; i++) {
      if (b.loop) stepLoop(b, h); else sub(b, Hl, t + i * h, h, ev);
      if (b.hazard || b.sunk || b.rest) return;
    }
  }
  const newBall = (x, y, z) => ({ x, y: y + R, z, vx: 0, vy: 0, vz: 0, air: false, rest: true, loop: null, ls: 0, lv: 0, hazard: null, sunk: false, slope: 0, slow: 0, mat: 'grass' });
  function putt(b, ang, pow) {
    const sp = clamp(pow, 0, 1) * MAX_SPEED;
    b.vx = Math.sin(ang) * sp; b.vz = Math.cos(ang) * sp; b.vy = 0; b.rest = false; b.air = false; b.slow = 0;
  }

  /* ---------- Bots ---------- */
  const NAMES = ['noysi', 'zapkid', 'frosty', 'pixel', 'glimmer', 'snekko', 'bloop', 'vexo', 'turbo', 'kiko', 'dusky', 'yeti', 'mochi', 'blitz',
    'ziggy', 'nova', 'pogo', 'fizz', 'wobble', 'sparky', 'loopy', 'dino', 'rocket', 'mango', 'tofu', 'bonk', 'echo', 'puffin', 'waffle', 'comet'];
  const SKILL = [{ a: 0.045, p: 0.08 }, { a: 0.065, p: 0.12 }, { a: 0.1, p: 0.16 }]; // good, okay, sloppy
  const BOT_COLORS = ['#ff6b9a', '#5ce1e6', '#b8e65c'];
  const WOBBLE = [[0.035, 1], [-0.035, 1], [0, 1.07], [0, 0.93]]; // A bot checks its putt a little left, right, harder and softer.
  // A gaussian-ish random number around 0.
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
  // How far a ball still is from the cup, along the hole's route. Lower is better.
  function routeCost(Hl, b) {
    if (b.sunk) return -100;
    const r = Hl.route;
    let best = Infinity;
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i], c = r[i + 1], dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2], L2 = dx * dx + dy * dy + dz * dz;
      const u = clamp(((b.x - a[0]) * dx + (b.y - R - a[1]) * dy + (b.z - a[2]) * dz) / (L2 || 1), 0, 1);
      const px = a[0] + dx * u, py = a[1] + dy * u, pz = a[2] + dz * u;
      const off = Math.hypot(b.x - px, b.z - pz) + Math.abs(b.y - R - py) * 4;
      const cost = off * 1.4 + Hl.routeLeft[i + 1] + Math.sqrt(L2) * (1 - u);
      if (cost < best) best = cost;
    }
    const c = Hl.cup, d = Math.hypot(b.x - c[0], b.z - c[2]);
    if (Math.abs(b.y - R - c[1]) < 0.6) best = Math.min(best, d);
    return best;
  }
  function simulate(Hl, from, t0, ang, pow) {
    const b = newBall(from.x, from.y - R, from.z);
    putt(b, ang, pow);
    let t = t0;
    for (let i = 0; i < 480; i++) {
      stepBall(b, Hl, t, 1 / 60, null); t += 1 / 60;
      if (b.hazard || b.sunk || b.rest) break;
    }
    return b;
  }
  // The shots a bot thinks about first: toward the next points of the route and the cup, a little left and right, soft to hard.
  // Then it looks closer around the best one.
  // Which point of the route a ball is nearest to.
  function nearest(Hl, b) {
    const r = Hl.route;
    let k = 0, kd = Infinity;
    for (let i = 0; i < r.length; i++) { const d = Math.hypot(b.x - r[i][0], b.z - r[i][2]) + Math.abs(b.y - R - r[i][1]) * 3; if (d < kd) { kd = d; k = i; } }
    return k;
  }
  function candidates(Hl, b) {
    const r = Hl.route, k = nearest(Hl, b);
    const targets = [r[Math.min(k + 1, r.length - 1)], r[Math.min(k + 2, r.length - 1)], Hl.cup];
    const out = [];
    for (const tg of targets) {
      const a = Math.atan2(tg[0] - b.x, tg[2] - b.z);
      for (const o of [-0.1, 0, 0.1]) for (const p of [0.16, 0.24, 0.34, 0.46, 0.6, 0.78, 1]) out.push([a + o, p]);
    }
    return out;
  }
  const closer = (a, p) => [-0.05, -0.025, 0, 0.025, 0.05].flatMap((o) => [0.88, 1, 1.12].map((k) => [a + o, clamp(p * k, 0.05, 1)])).filter((c, i) => i !== 7);

  /* ---------- The game ---------- */
  const golf = {
    W, H, color: 'var(--lime)', title: 'Minigolf', label: 'Shots', lowerWins: true, quietScore: true,
    intro: 'Pull back and let go to putt. Play 9 holes against 3 bots in as few shots as you can.',
    hint: 'Pull back anywhere and let go to putt; slide sideways to aim. Or <kbd>←</kbd><kbd>→</kbd> aim, <kbd>↑</kbd><kbd>↓</kbd> power, <kbd>Space</kbd> putt, <kbd>C</kbd> view the hole. <kbd>P</kbd> to pause',
    reset() {
      this.holes = makeHoles();
      const names = NAMES.slice().sort(() => Math.random() - 0.5).slice(0, 3);
      const skills = SKILL.slice().sort(() => Math.random() - 0.5);
      this.players = [{ name: 'YOU', you: true, color: '#ffffff', card: [] }].concat(names.map((n, i) => ({ name: n + Math.floor(1 + Math.random() * 998), skill: skills[i], color: BOT_COLORS[i], card: [] })));
      this.n = -1; this.total = 0; this.keys = {}; this.fx = []; this.trail = []; this.seen = false;
      this.start(0);
    },
    start(n) {
      this.n = n; const Hl = this.Hl = this.holes[n];
      this.t = 0; this.phase = 'intro'; this.introT = 0; this.fast = false; this.overview = false; this.drag = null; this.cardT = 0;
      // Everyone starts side by side on the tee. The last ball goes wherever there is room.
      const pad = ground(Hl, Hl.tee[0], Hl.tee[2], Hl.tee[1], 0).bb;
      const fits = (s) => Hl.tee[0] + s[0] > pad[0] + 0.7 && Hl.tee[0] + s[0] < pad[2] - 0.7 && Hl.tee[2] + s[1] > pad[1] + 0.7;
      const spots = [[0, 0], [-1.3, -0.3], [1.3, -0.3], [[-2.6, -0.8], [2.6, -0.8], [0, -2.6]].find(fits)];
      this.players.forEach((p, i) => {
        p.ball = newBall(Hl.tee[0] + spots[i][0], Hl.tee[1], Hl.tee[2] + spots[i][1]);
        p.shots = 0; p.done = false; p.wait = 0; p.plan = null; p.safe = { x: p.ball.x, y: p.ball.y, z: p.ball.z }; p.sinkT = 0;
      });
      // The aim starts toward the first turn of the hole (or toward the volcano on the last hole).
      const to = Hl.look || Hl.route[1], me = this.players[0].ball;
      this.aim = { a: Math.atan2(to[0] - me.x, to[2] - me.z), p: 0.4 };
      this.camA = this.aim.a; this.cam = null;
    },
    me() { return this.players[0]; },
    canPutt() { const p = this.me(); return this.phase === 'play' && !p.done && !p.wait && p.ball.rest; },
    shoot(p, ang, pow) {
      if (pow < 0.04) return;
      p.safe = { x: p.ball.x, y: p.ball.y, z: p.ball.z };
      putt(p.ball, ang, pow); p.shots++;
      if (p.you) {
        this.total++; setScore(this.total); this.seen = true;
        sfx.tone(150 + pow * 240, 0.07, 'triangle', 0.09); sfx.tone(1200, 0.02, 'square', 0.02);
      }
    },
    key(e, down) {
      this.keys[e.code] = down;
      if (!down || e.repeat) return;
      if (e.code === 'KeyC') this.overview = !this.overview;
      if (e.code === 'Space' || e.code === 'Enter') {
        if (this.phase === 'card') this.cardT = 0;
        else if (this.phase === 'intro') this.introT = Math.max(this.introT, 2.2);
        else if (this.me().done) this.fast = true;
        else if (this.canPutt()) this.shoot(this.me(), this.aim.a, this.aim.p);
      }
    },
    // Mouse and touch: press, pull back toward you and let go. Sliding sideways turns the aim.
    press(down) {
      if (down) { this.drag = { from: null }; return; }
      const d = this.drag; this.drag = null;
      if (!d || !d.from || d.button) return;
      if (d.aiming && this.canPutt() && this.aim.p >= 0.04) this.shoot(this.me(), this.aim.a, this.aim.p);
    },
    point(p) {
      const d = this.drag;
      if (!d) return;
      if (!d.from) {
        d.from = p;
        if (Math.hypot(p.x - (W - 32), p.y - (H - 32)) < 26) { d.button = true; this.overview = !this.overview; return; }
        if (this.phase === 'card') { this.cardT = 0; d.button = true; return; }
        if (this.phase === 'intro') { this.introT = Math.max(this.introT, 2.2); d.button = true; return; }
        if (this.me().done) { this.fast = true; d.button = true; return; }
        d.a0 = this.aim.a;
        return;
      }
      if (d.button || !this.canPutt()) return;
      const dx = p.x - d.from.x, dy = p.y - d.from.y;
      if (!d.aiming && Math.hypot(dx, dy) < 6) return;
      d.aiming = true;
      this.aim.a = d.a0 - dx * 0.006; // Seen from behind the ball, +x is on the left.
      this.aim.p = clamp(dy / 170, 0, 1);
    },
    tap() {},
    // Sounds, sparks and the like for the balls you can see.
    ev(type, v, b) {
      if (type === 'wall') { if (b === this.me().ball) sfx.tone(260 + Math.min(v, 40) * 6, 0.04, 'triangle', Math.min(0.08, v / 300)); }
      else if (type === 'bumper') { sfx.tone(880, 0.06, 'square', 0.05); sfx.tone(1320, 0.05, 'square', 0.03); this.burst(b.x, b.y, b.z, ['#fff3a0', '#ff6b9a', '#5ce1e6'], 10, 6); }
      else if (type === 'land' && b === this.me().ball) { sfx.tone(120, 0.08, 'triangle', 0.08); if (b.mat === 'sand') this.burst(b.x, b.y - R, b.z, ['#e3cf94', '#c9b276'], 12, 4); }
    },
    burst(x, y, z, cols, n, sp, up = 4, life = 0.7) {
      for (let i = 0; i < n && this.fx.length < 260; i++) {
        const a = Math.random() * TAU, s = sp * (0.4 + Math.random() * 0.6);
        this.fx.push({ x, y, z, vx: Math.cos(a) * s, vy: up * (0.5 + Math.random()), vz: Math.sin(a) * s, life: life * (0.6 + Math.random() * 0.6), col: cols[i % cols.length], g: 14 });
      }
    },
    // What happens to a ball after a physics step: water, out of bounds, in the cup, or stopped for good.
    settle(p) {
      const b = p.ball, me = p.you, Hl = this.Hl;
      if (b.hazard) {
        if (me) {
          if (b.hazard === 'water') { sfx.tone(140, 0.35, 'sawtooth', 0.05, 60); this.burst(b.x, b.y - R, b.z, ['#bfe8ff', '#7cc4ff', '#ffffff'], 18, 5, 7); }
          else sfx.tone(300, 0.3, 'sawtooth', 0.04, 90);
          shake(4, 260);
          this.say(b.hazard === 'water' ? 'SPLASH +1' : 'OUT +1', C.cyan, b);
        }
        if (p.shots < MAX_SHOTS) { p.shots++; if (me) { this.total++; setScore(this.total); } }
        b.hazard = null; p.wait = 0.8; b.hidden = true; b.vx = b.vy = b.vz = 0; b.loop = null;
        return;
      }
      if (b.sunk) {
        p.done = true; p.sinkT = 1; b.rest = true;
        const diff = p.shots - Hl.par, word = p.shots === 1 ? 'HOLE IN ONE!' : ({ '-3': 'ALBATROSS!', '-2': 'EAGLE!', '-1': 'BIRDIE!', 0: 'PAR' })[diff] || (diff === 1 ? 'BOGEY' : '+' + diff);
        if (me) {
          if (p.shots === 1) { sfx.win(); this.fireworks(); } else if (diff < 0) { sfx.win(); this.confetti(); } else { sfx.tone(523, 0.1, 'triangle', 0.07); setTimeout(() => sfx.tone(784, 0.16, 'triangle', 0.07), 90); }
          this.say(word, p.shots === 1 ? '#ffd56b' : diff < 0 ? C.lime : C.ink, b, 13);
        } else this.say(p.name + ': ' + word, p.color, b, 8);
        return;
      }
      if (b.rest && p.shots >= MAX_SHOTS) { p.done = true; if (me) { this.say('MAX ' + MAX_SHOTS, C.pink, b); sfx.lose(); } }
    },
    say(text, col, b, size = 11) { this.pops = this.pops || []; this.pops.push({ text, col, size, x: b.x, y: b.y + 1.6, z: b.z, life: 1.6 }); },
    confetti() { const c = this.Hl.cup; this.burst(c[0], c[1] + 0.5, c[2], ['#ff6b9a', '#5ce1e6', '#b8e65c', '#ffd56b', '#a78bfa'], 60, 7, 12, 1.6); },
    fireworks() {
      const c = this.Hl.cup;
      for (let k = 0; k < 4; k++) setTimeout(() => { if (Arcade.playing()) { this.burst(c[0] + (Math.random() - 0.5) * 12, c[1] + 9 + Math.random() * 5, c[2] + (Math.random() - 0.5) * 8, [['#ffd56b', '#fff3a0'], ['#ff6b9a', '#ffd0de'], ['#5ce1e6', '#d5f8ff'], ['#b8e65c', '#f0ffd0']][k], 40, 9, 2, 1.4); sfx.tone(600 + k * 150, 0.2, 'sine', 0.04, 1600); } }, k * 260);
      this.confetti();
    },
    update(dt) {
      if (!G) return; // Wait for the 3D engine.
      const runs = this.fast && this.phase === 'play' ? 4 : 1;
      for (let i = 0; i < runs; i++) this.tick(dt);
    },
    tick(dt) {
      const Hl = this.Hl;
      for (const f of this.fx) { f.life -= dt; f.vy -= f.g * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt; }
      this.fx = this.fx.filter((f) => f.life > 0);
      if (this.pops) { for (const p of this.pops) { p.life -= dt; p.y += dt * 1.2; } this.pops = this.pops.filter((p) => p.life > 0); }
      for (const b of Hl.bumpers) b.flash = Math.max(0, b.flash - dt * 3);
      if (this.phase === 'intro') {
        this.introT += dt;
        if (this.introT > 2.4) this.phase = 'play';
        this.camera(dt);
        return;
      }
      if (this.phase === 'card') {
        this.cardT -= dt; this.camera(dt);
        if (this.cardT <= 0) { if (this.n + 1 < this.holes.length) this.start(this.n + 1); else this.finish(); }
        return;
      }
      this.t += dt;
      const me = this.me();
      if (this.canPutt() && !this.drag) {
        if (this.keys.ArrowLeft || this.keys.KeyA) this.aim.a += 1.6 * dt;
        if (this.keys.ArrowRight || this.keys.KeyD) this.aim.a -= 1.6 * dt;
        if (this.keys.ArrowUp || this.keys.KeyW) this.aim.p = Math.min(1, this.aim.p + 0.7 * dt);
        if (this.keys.ArrowDown || this.keys.KeyS) this.aim.p = Math.max(0.05, this.aim.p - 0.7 * dt);
      }
      this.budget = 2; // The bots try at most two putts in their heads each step, so a slow phone doesn't stutter.
      for (const p of this.players) {
        const b = p.ball;
        if (p.sinkT > 0) p.sinkT = Math.max(0, p.sinkT - dt * 3);
        if (p.done) continue;
        if (p.wait) {
          p.wait = Math.max(0, p.wait - dt);
          if (!p.wait) {
            Object.assign(b, { x: p.safe.x, y: p.safe.y, z: p.safe.z, rest: true, air: false, hidden: false });
            if (p.shots >= MAX_SHOTS) { p.done = true; if (p.you) this.say('MAX ' + MAX_SHOTS, C.pink, b); }
          }
          continue;
        }
        if (!b.rest || b.loop) {
          const pre = Math.hypot(b.vx, b.vz);
          p.plan = null;
          stepBall(b, Hl, this.t, dt, p.you ? (ty, v, bb) => this.ev(ty, v, bb) : (ty, v, bb) => { if (ty === 'bumper') this.ev(ty, v, bb); });
          if (p.you && pre > 30 && !calm()) this.trail.push({ x: b.x, y: b.y, z: b.z, life: 0.3 });
          this.settle(p);
          // When your ball stops, the aim turns toward the next turn of the hole, to help a little.
          if (p.you && b.rest && !p.done) { const to = Hl.route[Math.min(nearest(Hl, b) + 1, Hl.route.length - 1)]; this.aim.a = Math.atan2(to[0] - b.x, to[2] - b.z); }
        } else if (p.shots >= MAX_SHOTS) this.settle(p);
        else if (collide(b, Hl, this.t, null, true)) b.rest = false; // A spinning bar or a puck knocked a resting ball.
        else if (!p.you || this.auto) this.think(p);
      }
      for (const tr of this.trail) tr.life -= dt;
      this.trail = this.trail.filter((tr) => tr.life > 0);
      if (this.players.every((p) => p.done && p.sinkT === 0)) {
        this.players.forEach((p) => { p.card[this.n] = p.shots; });
        this.phase = 'card'; this.cardT = 3.4; this.fast = false;
      }
      this.camera(dt);
    },
    // A bot looks at its ball, tries putts in its head for a moment, then putts the best one (not quite perfectly).
    // The bots share two tries per step of the game clock, so thinking takes the same game time on a slow phone as on a fast computer.
    think(p) {
      const b = p.ball, Hl = this.Hl;
      if (!p.plan) {
        const list = candidates(Hl, b);
        p.plan = { list, i: 0, res: [], refined: false, order: null, k: 0, v: 0, at: this.t + Math.max(0.8 + Math.random() * 1.1, 1.45) };
      }
      const pl = p.plan;
      if (pl.i < pl.list.length || !pl.order || pl.k < pl.order.length) { if (this.budget <= 0) return; this.budget--; }
      if (pl.i < pl.list.length) {
        const [a, pw] = pl.list[pl.i++], end = simulate(Hl, b, pl.at, a, pw);
        // Lower is better. When two putts are as good, the softer one is safer.
        pl.res.push({ a, pw, cost: (end.hazard ? 200 + routeCost(Hl, b) : routeCost(Hl, end)) + pw * 0.5 });
        if (pl.i === pl.list.length && !pl.refined) {
          pl.refined = true;
          const best = pl.res.reduce((x, y) => (y.cost < x.cost ? y : x));
          pl.list.push(...closer(best.a, best.pw));
        }
        return;
      }
      // Then it tries its six best putts again a little left, right, harder and softer, and takes the one that does best
      // on average. So it doesn't pick a lucky putt that only works when it is hit perfectly.
      if (!pl.order) { pl.order = pl.res.sort((x, y) => x.cost - y.cost).slice(0, 6); pl.order.forEach((o) => { o.sum = o.cost; }); }
      if (pl.k < pl.order.length) {
        const o = pl.order[pl.k], [da, dp] = WOBBLE[pl.v], end = simulate(Hl, b, pl.at, o.a + da, clamp(o.pw * dp, 0.05, 1));
        o.sum += (end.hazard ? 200 + routeCost(Hl, b) : routeCost(Hl, end)) + o.pw * 0.5;
        if (++pl.v === WOBBLE.length) { pl.v = 0; pl.k++; }
        return;
      }
      if (this.t >= pl.at) {
        const o = pl.order.reduce((x, y) => (y.sum < x.sum ? y : x)), sk = p.skill || SKILL[0];
        this.shoot(p, o.a + gauss() * sk.a, clamp(o.pw * (1 + gauss() * sk.p), 0.05, 1));
        p.plan = null;
      }
    },
    // For testing: the parts the bots use, so a test can play the player's ball too (golf.auto = true).
    _t: { simulate: (...a) => simulate(...a), candidates: (...a) => candidates(...a), routeCost: (...a) => routeCost(...a) },
    finish() {
      const me = this.me(), tot = (p) => p.card.reduce((s, v) => s + v, 0);
      const mine = tot(me), place = 1 + this.players.filter((p) => !p.you && tot(p) < mine).length;
      const par = this.holes.reduce((s, h) => s + h.par, 0), diff = mine - par;
      const best = this.players.filter((p) => !p.you).sort((a, b) => tot(a) - tot(b))[0];
      const nth = ['1st', '2nd', '3rd', '4th'][place - 1];
      const msg = 'You came ' + nth + ' of 4 with ' + mine + ' shots (' + (diff === 0 ? 'even par' : diff > 0 ? diff + ' over par' : -diff + ' under par') + ').' +
        (place === 1 ? '' : ' Best bot: ' + best.name + ' with ' + tot(best) + '.');
      this.phase = 'end';
      over(mine, msg, place === 1 ? 'You won!' : 'Round done!');
    },

    /* ---------- Camera ---------- */
    pose(kind) {
      const Hl = this.Hl, b = this.me().ball;
      if (kind === 'over') {
        const xs = Hl.route.map((r) => r[0]).concat(Hl.tee[0]), zs = Hl.route.map((r) => r[2]), ys = Hl.route.map((r) => r[1]);
        const x0 = Math.min(...xs) - 6, x1 = Math.max(...xs) + 6, z0 = Math.min(...zs) - 4, z1 = Math.max(...zs) + 4, top = Math.max(...ys);
        const s = Math.max((x1 - x0) * 1.5, z1 - z0);
        return { p: [(x0 + x1) / 2, top + s * 0.95 + 6, z0 - s * 0.32], l: [(x0 + x1) / 2, top * 0.5, (z0 + z1) / 2 + s * 0.06] };
      }
      const a = this.camA, sx = Math.sin(a), sz = Math.cos(a);
      return { p: [b.x - sx * 12, b.y + 6.6, b.z - sz * 12], l: [b.x + sx * 7, b.y + 0.2, b.z + sz * 7] };
    },
    camera(dt) {
      const me = this.me(), b = me.ball;
      if (!b.rest && !b.loop && !me.done) {
        const v = Math.hypot(b.vx, b.vz);
        if (v > 5) { const want = Math.atan2(b.vx, b.vz); this.camA += wrapA(want - this.camA) * clamp(dt * 1.6, 0, 1); }
      } else if (me.ball.rest && !me.done) this.camA += wrapA(this.aim.a - this.camA) * clamp(dt * 8, 0, 1);
      let want;
      if (this.phase === 'intro') {
        const k = ease(clamp(this.introT / 2.2, 0, 1)), o = this.pose('over'), bh = this.pose('behind');
        want = { p: o.p.map((v, i) => lerp(v, bh.p[i], k)), l: o.l.map((v, i) => lerp(v, bh.l[i], k)) };
        this.cam = want; return;
      }
      want = this.overview || me.done || this.phase === 'card' ? this.pose('over') : this.pose('behind');
      if (!this.cam) { this.cam = want; return; }
      const k = clamp(dt * (this.overview || me.done ? 3 : 5), 0, 1);
      for (let i = 0; i < 3; i++) { this.cam.p[i] = lerp(this.cam.p[i], want.p[i], k); this.cam.l[i] = lerp(this.cam.l[i], want.l[i], k); }
    },

    /* ---------- Drawing ---------- */
    draw() {
      if (!G && T && !failed) setup();
      if (!G) {
        ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = C.ink; ctx.font = font(12); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(failed ? "3D DIDN'T LOAD" : 'LOADING COURSE...', W / 2, H / 2);
        if (failed) { ctx.font = font(8); ctx.fillStyle = C.muted; ctx.fillText('Check your connection and try again', W / 2, H / 2 + 24); }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        return;
      }
      if (G.built !== this.Hl) buildHole(this.Hl);
      if (!this.cam) this.camera(0);
      animateHole(this.Hl, this.t);
      this.players.forEach((p, i) => {
        const m = G.balls[i], b = p.ball;
        m.visible = !b.hidden && !(p.done && p.sinkT === 0);
        if (p.done && b.sunk) { const c = this.Hl.cup; m.position.set(c[0], c[1] + R - (1 - p.sinkT) * 1.2, c[2]); }
        else m.position.set(b.x, b.y, b.z);
        if (!b.rest) { const v = Math.hypot(b.vx, b.vz); if (v > 0.1) m.rotateOnWorldAxis(G.axis.set(b.vz / v, 0, -b.vx / v), v / 60 / R); }
      });
      const cam = G.cam;
      cam.position.set(...this.cam.p); cam.lookAt(...this.cam.l);
      const l = this.cam.l;
      G.sun.position.set(l[0] + 30, l[1] + 60, l[2] - 20); G.sun.target.position.set(l[0], l[1], l[2]); G.sun.target.updateMatrixWorld();
      const cw = Math.min(ctx.canvas.width, 900), ch = Math.round(cw * H / W);
      if (G.cw !== cw) { G.cw = cw; G.r.setSize(cw, ch, false); }
      G.r.render(G.scene, cam);
      ctx.drawImage(G.r.domElement, 0, 0, W, H);
      this.hud();
    },
    // Where a 3D point lands on the screen, or null if it is behind the camera.
    screen(x, y, z) {
      const v = G.v.set(x, y, z).project(G.cam);
      if (v.z > 1) return null;
      return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H };
    },
    hud() {
      const Hl = this.Hl, me = this.me(), b = me.ball;
      ctx.save();
      ctx.textBaseline = 'middle';
      // Sparks, splashes and confetti.
      for (const f of this.fx) { const s = this.screen(f.x, f.y, f.z); if (!s) continue; ctx.globalAlpha = clamp(f.life * 2, 0, 1); ctx.fillStyle = f.col; ctx.fillRect(s.x - 2, s.y - 2, 4, 4); }
      for (const tr of this.trail) { const s = this.screen(tr.x, tr.y, tr.z); if (!s) continue; ctx.globalAlpha = tr.life * 2; ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
      if (XMAS) this.snow();
      // Aim dots and the power ring.
      if (this.canPutt() && this.phase === 'play') {
        const { a, p } = this.aim, col = p < 0.45 ? '#b8e65c' : p < 0.78 ? '#ffd56b' : '#ff6b9a', n = 3 + Math.round(p * 13);
        ctx.fillStyle = col;
        ctx.strokeStyle = 'rgba(8,10,20,.55)'; ctx.lineWidth = 1.5;
        for (let i = 1; i <= n; i++) { const s = this.screen(b.x + Math.sin(a) * (0.6 + i * 0.75), b.y - R + 0.08, b.z + Math.cos(a) * (0.6 + i * 0.75)); if (s) { ctx.globalAlpha = 1 - i / (n + 5); ctx.beginPath(); ctx.arc(s.x, s.y, 4 - i * 0.12, 0, TAU); ctx.fill(); ctx.stroke(); } }
        ctx.globalAlpha = 1;
        const s = this.screen(b.x, b.y, b.z);
        if (s && (this.drag && this.drag.aiming || this.keys.ArrowUp || this.keys.ArrowDown)) {
          ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(s.x, s.y, 24, 0, TAU); ctx.stroke();
          ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(s.x, s.y, 24, -Math.PI / 2, -Math.PI / 2 + TAU * p); ctx.stroke();
        }
      }
      // Name tags over the balls.
      ctx.textAlign = 'center'; ctx.font = font(7);
      this.players.forEach((p) => {
        if (p.ball.hidden || (p.done && p.sinkT === 0)) return;
        const s = this.screen(p.ball.x, p.ball.y + 1.1, p.ball.z);
        if (!s) return;
        const w = ctx.measureText(p.name).width + 8;
        ctx.fillStyle = 'rgba(8,10,20,.6)'; ctx.fillRect(s.x - w / 2, s.y - 7, w, 13);
        ctx.fillStyle = p.color; ctx.fillText(p.name, s.x, s.y);
      });
      for (const pp of this.pops || []) {
        const s = this.screen(pp.x, pp.y, pp.z); if (!s) continue;
        ctx.globalAlpha = clamp(pp.life * 1.5, 0, 1); ctx.font = font(pp.size); ctx.lineWidth = 4; ctx.strokeStyle = '#0d0a15';
        ctx.strokeText(pp.text, s.x, s.y); ctx.fillStyle = pp.col; ctx.fillText(pp.text, s.x, s.y);
      }
      ctx.globalAlpha = 1;
      // The bar at the top.
      ctx.fillStyle = 'rgba(6,10,24,.72)'; ctx.fillRect(0, 0, W, 34);
      ctx.font = font(9); ctx.fillStyle = C.ink; ctx.textAlign = 'left';
      ctx.fillText((this.n + 1) + '/9 ' + Hl.name.toUpperCase(), 10, 17);
      ctx.textAlign = 'right'; ctx.fillStyle = me.shots >= MAX_SHOTS - 1 ? C.pink : C.ink;
      ctx.fillText('PAR ' + Hl.par + '  SHOTS ' + me.shots, W - 10, 17);
      // Everyone's shots on this hole.
      ctx.font = font(7);
      this.players.forEach((p, i) => {
        const y = 48 + i * 15, done = p.done ? (p.ball.sunk ? ' ✓' : '') : '';
        ctx.fillStyle = 'rgba(6,10,24,.55)'; ctx.fillRect(W - 128, y - 7, 120, 14);
        ctx.textAlign = 'left'; ctx.fillStyle = p.color; ctx.fillText(p.name, W - 124, y);
        ctx.textAlign = 'right'; ctx.fillStyle = C.ink; ctx.fillText(p.shots + done, W - 12, y);
      });
      if (Hl.wind) this.windSign();
      this.eye();
      ctx.textAlign = 'center';
      if (this.phase === 'intro') {
        const a = clamp(Math.min(this.introT * 2, (2.4 - this.introT) * 2), 0, 1);
        ctx.globalAlpha = a; ctx.fillStyle = 'rgba(6,10,24,.6)'; ctx.fillRect(0, H / 2 - 46, W, 92);
        ctx.font = font(16); ctx.fillStyle = '#ffd56b'; ctx.fillText('HOLE ' + (this.n + 1), W / 2, H / 2 - 18);
        ctx.font = font(10); ctx.fillStyle = C.ink; ctx.fillText(Hl.name.toUpperCase() + ' · PAR ' + Hl.par, W / 2, H / 2 + 10);
        if (Hl.wind) { ctx.font = font(8); ctx.fillStyle = C.cyan; ctx.fillText('WINDY', W / 2, H / 2 + 30); }
        ctx.globalAlpha = 1;
      } else if (this.phase === 'play') {
        ctx.font = font(8); ctx.fillStyle = 'rgba(244,236,220,.9)';
        if (!this.seen && this.n === 0 && this.canPutt()) ctx.fillText('PULL BACK AND LET GO', W / 2, H - 70);
        if (me.done && !this.players.every((p) => p.done)) ctx.fillText(this.fast ? 'FAST FORWARD...' : 'WAITING FOR THE BOTS · TAP TO SPEED UP', W / 2, H - 70);
      } else if (this.phase === 'card') this.scorecard();
      ctx.restore();
    },
    windSign() {
      const w = this.Hl.wind, rel = Math.atan2(w[0], w[1]) - this.camA, x = 34, y = 62, s = Math.hypot(w[0], w[1]);
      ctx.fillStyle = 'rgba(6,10,24,.55)'; ctx.beginPath(); ctx.arc(x, y, 22, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(x, y); ctx.rotate(-rel + Math.PI);
      // Up on the screen is the way you're looking; the arrow points where the wind blows.
      ctx.fillStyle = C.cyan; ctx.beginPath(); ctx.moveTo(0, 13); ctx.lineTo(-7, 1); ctx.lineTo(-2.5, 1); ctx.lineTo(-2.5, -12); ctx.lineTo(2.5, -12); ctx.lineTo(2.5, 1); ctx.lineTo(7, 1); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.font = font(6); ctx.textAlign = 'center'; ctx.fillStyle = C.ink; ctx.fillText('WIND ' + s.toFixed(1), x, y + 30);
    },
    eye() {
      const x = W - 32, y = H - 32;
      ctx.fillStyle = this.overview ? 'rgba(255,213,107,.9)' : 'rgba(6,10,24,.6)'; ctx.beginPath(); ctx.arc(x, y, 20, 0, TAU); ctx.fill();
      ctx.strokeStyle = this.overview ? '#0d0a15' : C.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 11, y); ctx.quadraticCurveTo(x, y - 10, x + 11, y); ctx.quadraticCurveTo(x, y + 10, x - 11, y); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, TAU); ctx.fill();
    },
    scorecard() {
      const Hl = this.Hl, a = clamp(Math.min((3.4 - this.cardT) * 3, 1), 0, 1), x0 = 34, w = W - 68, y0 = 150;
      const tot = (p) => p.card.reduce((s, v) => s + (v || 0), 0), par = this.holes.slice(0, this.n + 1).reduce((s, h) => s + h.par, 0);
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(6,10,24,.86)'; ctx.fillRect(x0, y0, w, 210);
      ctx.strokeStyle = '#ffd56b'; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, w, 210);
      ctx.textAlign = 'center'; ctx.font = font(11); ctx.fillStyle = '#ffd56b';
      ctx.fillText('HOLE ' + (this.n + 1) + ' DONE', W / 2, y0 + 26);
      ctx.font = font(7); ctx.fillStyle = C.muted;
      ctx.textAlign = 'left'; ctx.fillText('PLAYER', x0 + 16, y0 + 56);
      ctx.textAlign = 'right'; ctx.fillText('HOLE', x0 + w - 96, y0 + 56); ctx.fillText('TOTAL', x0 + w - 16, y0 + 56);
      this.players.slice().sort((p, q) => tot(p) - tot(q)).forEach((p, i) => {
        const y = y0 + 84 + i * 28, s = p.card[this.n], d = s - Hl.par, td = tot(p) - par;
        if (p.you) { ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(x0 + 8, y - 12, w - 16, 24); }
        ctx.font = font(8); ctx.textAlign = 'left'; ctx.fillStyle = p.color; ctx.fillText((i + 1) + '. ' + p.name, x0 + 16, y);
        ctx.textAlign = 'right'; ctx.fillStyle = d < 0 ? C.lime : d > 0 ? C.pink : C.ink; ctx.fillText(String(s), x0 + w - 96, y);
        ctx.fillStyle = C.ink; ctx.fillText(tot(p) + ' (' + (td === 0 ? 'E' : td > 0 ? '+' + td : td) + ')', x0 + w - 16, y);
      });
      ctx.textAlign = 'center'; ctx.font = font(7); ctx.fillStyle = C.muted;
      ctx.fillText(this.n + 1 < this.holes.length ? 'TAP FOR THE NEXT HOLE' : 'TAP FOR THE RESULTS', W / 2, y0 + 196);
      ctx.globalAlpha = 1;
    },
    snow() {
      this.flakes = this.flakes || Array.from({ length: 60 }, (_, i) => ({ x: (i * 97) % W, y: (i * 53) % H, s: 18 + (i % 7) * 6, r: 1 + (i % 3) }));
      const now = performance.now() / 1000, dt = Math.min(0.05, now - (this.lastSnow || now)); this.lastSnow = now;
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      for (const f of this.flakes) { f.y += f.s * dt; f.x += Math.sin(f.y / 30) * 8 * dt; if (f.y > H) { f.y = -4; } ctx.fillRect(f.x, f.y, f.r, f.r); }
    },
  };

  /* ---------- 3D ---------- */
  let G = null;
  const LOOK = XMAS
    ? { sky: '#1f3167', fog: '#30437c', land: '#eef4ff', turf: ['#3f9a4c', '#4aab58'], side: '#8a6a4a', rail: 'candy', railTop: '#ffffff', hemi: ['#d8e6ff', '#7d8db0', 1.8], sun: ['#ffe4c0', 1.9], tree: '#2f7a4a', leaf: '#3f8f57' }
    : { sky: '#8fd0ff', fog: '#cdeeff', land: '#6dbb55', turf: ['#3f9a4c', '#4aab58'], side: '#7a5a3c', rail: '#a8763f', railTop: '#d29a5a', hemi: ['#ffffff', '#5d7a4a', 2.1], sun: ['#fff1d6', 2.5], tree: '#2f7a4a', leaf: '#3f8f57' };
  function canvasTex(w, h, paint, rep = 1) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 4;
    return t;
  }
  function setup() {
    try { G = { r: new T.WebGLRenderer({ antialias: true }) }; } catch (e) { failed = true; G = null; return; }
    const r = G.r;
    r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap; r.setPixelRatio(1);
    G.scene = new T.Scene(); G.scene.background = new T.Color(LOOK.sky); G.scene.fog = new T.Fog(LOOK.fog, 70, 230);
    G.cam = new T.PerspectiveCamera(55, W / H, 0.3, 700);
    G.scene.add(new T.HemisphereLight(LOOK.hemi[0], LOOK.hemi[1], LOOK.hemi[2]));
    const sun = G.sun = new T.DirectionalLight(LOOK.sun[0], LOOK.sun[1]);
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0008;
    Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 200 });
    G.scene.add(sun, sun.target);
    G.v = new T.Vector3(); G.axis = new T.Vector3(); G.built = null;
    const turf = canvasTex(64, 64, (g, w, h) => { g.fillStyle = LOOK.turf[0]; g.fillRect(0, 0, w, h); g.fillStyle = LOOK.turf[1]; g.fillRect(0, 0, w, h / 2); g.fillStyle = 'rgba(255,255,255,.05)'; for (let i = 0; i < 90; i++) g.fillRect((i * 37) % w, (i * 23) % h, 1, 1); }, 1 / 6);
    const sand = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#e8d49a'; g.fillRect(0, 0, w, h); g.fillStyle = '#cdb67a'; for (let i = 0; i < 120; i++) g.fillRect((i * 29) % w, (i * 41) % h, 2, 2); }, 1 / 4);
    const ice = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#d9f1ff'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1; for (let i = 0; i < 14; i++) { g.beginPath(); g.moveTo((i * 53) % w, (i * 31) % h); g.lineTo((i * 53 + 40) % w, (i * 31 + 17) % h); g.stroke(); } }, 1 / 10);
    const wood = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#b07a46'; g.fillRect(0, 0, w, h); g.fillStyle = '#8f5f33'; for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 2); }, 1 / 2);
    // The volcano path: dark rock (snowy at Christmas), and the cone with glowing cracks.
    const basalt = canvasTex(64, 64, (g, w, h) => { g.fillStyle = XMAS ? '#e4ecf8' : '#6a5a55'; g.fillRect(0, 0, w, h); g.fillStyle = XMAS ? '#c9d6ea' : '#574945'; for (let i = 0; i < 70; i++) g.fillRect((i * 37) % w, (i * 19) % h, 3, 2); g.fillStyle = XMAS ? '#ffffff' : '#7c6b64'; for (let i = 0; i < 40; i++) g.fillRect((i * 23) % w, (i * 41) % h, 2, 2); }, 1 / 4);
    const crack = (glow) => canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = glow ? '#000000' : XMAS ? '#dfe8f5' : '#4a3c3a'; g.fillRect(0, 0, w, h);
      if (!glow) { g.fillStyle = XMAS ? '#c4d2e6' : '#3a2f2e'; for (let i = 0; i < 90; i++) g.fillRect((i * 29) % w, (i * 13) % h, 4, 3); }
      g.strokeStyle = glow ? (XMAS ? '#ffd56b' : '#ff7a2a') : XMAS ? '#e9c25a' : '#c2461c'; g.lineWidth = 2;
      const r = seeded(5);
      for (let i = 0; i < 9; i++) { let x = r() * w, y = 0; g.beginPath(); g.moveTo(x, y); while (y < h) { x += (r() - 0.5) * 14; y += 6 + r() * 8; g.lineTo(x, y); } g.stroke(); }
    }, 1);
    const stone = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#a7a3b0'; g.fillRect(0, 0, w, h); g.fillStyle = '#8b8796'; for (let y = 0; y < h; y += 16) { g.fillRect(0, y, w, 2); for (let x = (y / 16) % 2 ? 0 : 16; x < w; x += 32) g.fillRect(x, y, 2, 16); } }, 1 / 2);
    G.water = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#2f86d6'; g.fillRect(0, 0, w, h); g.fillStyle = '#5fb0f0'; for (let i = 0; i < 10; i++) g.fillRect((i * 23) % w, (i * 17) % h, 12, 2); }, 1 / 6);
    const candy = canvasTex(32, 32, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#e2384d'; for (let i = -2; i < 4; i++) { g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16 + 8, 0); g.lineTo(i * 16 + 8 + 32, h); g.lineTo(i * 16 + 32, h); g.fill(); } }, 1);
    const lam = (o) => new T.MeshLambertMaterial(o);
    G.m = {
      grass: lam({ map: turf }), basalt: lam({ map: basalt }), sand: lam({ map: sand }), ice: lam({ map: ice }), wood: lam({ map: wood }), stone: lam({ map: stone }),
      water: new T.MeshLambertMaterial({ map: G.water, transparent: true, opacity: 0.88 }),
      side: lam({ color: LOOK.side }), land: lam({ color: LOOK.land }),
      rail: LOOK.rail === 'candy' ? lam({ map: candy }) : lam({ color: LOOK.rail }), railTop: lam({ color: LOOK.railTop }),
      mill: lam({ color: XMAS ? '#c9875a' : '#f2e6cf' }), roof: lam({ color: XMAS ? '#ffffff' : '#b24a3a' }), sail: lam({ color: '#f4ecdc', side: T.DoubleSide }),
      hedge: lam({ color: '#2f7a3f' }), castle: lam({ map: stone }), rock: lam({ color: '#6b5a52' }), lip: lam({ color: LOOK.rail === 'candy' ? '#e2384d' : LOOK.rail }),
      trunk: lam({ color: '#6b4a2b' }), leaf: lam({ color: LOOK.leaf }), snow: lam({ color: '#ffffff' }), coal: lam({ color: '#1b1b24' }), carrot: lam({ color: '#ff8a2a' }),
      bumper: new T.MeshStandardMaterial({ color: '#ff6b9a', emissive: '#ff2a6a', emissiveIntensity: 0.25, roughness: 0.4 }),
      cap: new T.MeshStandardMaterial({ color: '#fff3a0', emissive: '#ffd56b', emissiveIntensity: 0.4 }),
      bar: lam({ color: '#f4ecdc' }), puck: lam({ color: '#1b1b24' }), track: new T.MeshLambertMaterial({ color: XMAS ? '#e2384d' : '#5ce1e6', side: T.DoubleSide }),
      lava: new T.MeshBasicMaterial({ color: XMAS ? '#ffd56b' : '#ff6a2a' }), cone: lam({ map: basalt }),
      crater: new T.MeshStandardMaterial({ map: crack(false), emissive: '#ffffff', emissiveMap: crack(true), emissiveIntensity: 0.9, roughness: 0.9 }),
      cup: new T.MeshBasicMaterial({ color: '#05070a' }), cupRim: lam({ color: '#ffffff' }), pole: lam({ color: '#f4ecdc' }),
      flag: new T.MeshLambertMaterial({ color: XMAS ? '#e2384d' : '#ff6b9a', side: T.DoubleSide }),
      bulbs: ['#ff5a5a', '#ffd56b', '#5ce1e6', '#b8e65c', '#ff9ae0'].map((c) => new T.MeshBasicMaterial({ color: c })),
      gift: ['#e2384d', '#3f9a5c', '#4f7dff', '#ffd56b'].map((c) => lam({ color: c })),
    };
    const ballGeo = new T.SphereGeometry(R, 24, 16);
    const dimples = canvasTex(64, 32, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#e4e8ef'; for (let i = 0; i < 70; i++) g.fillRect((i * 13) % w, (i * 7) % h, 2, 2); g.fillStyle = '#ff6b9a'; g.fillRect(0, h / 2 - 1, w, 2); });
    G.balls = [new T.MeshStandardMaterial({ map: dimples, roughness: 0.35 })].concat(BOT_COLORS.map((c) => new T.MeshStandardMaterial({ color: c, roughness: 0.3, transparent: true, opacity: 0.62 })))
      .map((m, i) => { const b = new T.Mesh(ballGeo, m); b.castShadow = i === 0; b.renderOrder = i ? 2 : 1; G.scene.add(b); return b; });
  }

  // A mesh from a grid of points: f(u, v) gives [x, y, z] for u and v from 0 to 1. Texture coordinates are world units.
  function grid(nu, nv, f) {
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const p = f(i / nu, j / nv); pos.push(p[0], p[1], p[2]); uv.push(p[0] + p[1] * 0.3, p[2]); }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  // A straight wall piece with a sloped top: four side faces and a top.
  function prism(w, bot, top, th) {
    const dx = w.bx - w.ax, dz = w.bz - w.az, l = Math.hypot(dx, dz) || 1, nx = -dz / l * th / 2, nz = dx / l * th / 2;
    const P = (x, y, z) => [x, y, z];
    const a1b = P(w.ax + nx, bot[0], w.az + nz), a2b = P(w.ax - nx, bot[0], w.az - nz), b1b = P(w.bx + nx, bot[1], w.bz + nz), b2b = P(w.bx - nx, bot[1], w.bz - nz);
    const a1t = P(w.ax + nx, top[0], w.az + nz), a2t = P(w.ax - nx, top[0], w.az - nz), b1t = P(w.bx + nx, top[1], w.bz + nz), b2t = P(w.bx - nx, top[1], w.bz - nz);
    const quads = [[a1b, b1b, b1t, a1t], [b2b, a2b, a2t, b2t], [a1t, b1t, b2t, a2t], [a2b, a1b, a1t, a2t], [b1b, b2b, b2t, b1t]];
    const pos = [], uv = [];
    for (const [a, b, c, d] of quads) {
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      const L = Math.hypot(b[0] - a[0], b[2] - a[2]) / 1.4;
      uv.push(0, 0, L, 0, L, 1, 0, 0, L, 1, 0, 1);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }
  // A pseudo-random number from a seed, for scenery that looks the same every time.
  const seeded = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647);

  function buildHole(Hl) {
    if (G.group) { G.scene.remove(G.group); G.group.traverse((o) => { if (o.geometry && !o.geometry.keep) o.geometry.dispose(); }); }
    const grp = G.group = new T.Group(), M = G.m, add = (m, shadow = true, recv = true) => { m.castShadow = shadow; m.receiveShadow = recv; grp.add(m); return m; };
    G.built = Hl; G.dyn = { spinners: [], pucks: [], sails: [], bridges: [], bumpers: [], smoke: [], flags: [] };
    const base = Hl.floor + 0.8;
    const land = add(new T.Mesh(new T.PlaneGeometry(700, 700), M.land), false, true); land.rotation.x = -Math.PI / 2; land.position.set(0, base, 30);
    // Surfaces.
    for (const s of Hl.surfaces) {
      const top = s.mat === 'water' ? M.water : (M[s.mat] || M.grass);
      if (s.kind === 'flat') {
        if (s.mat === 'water') {
          const m = add(new T.Mesh(new T.PlaneGeometry(s.bb[2] - s.bb[0], s.bb[3] - s.bb[1]), M.water), false, true);
          m.rotation.x = -Math.PI / 2; m.position.set((s.bb[0] + s.bb[2]) / 2, s.y + 0.25, (s.bb[1] + s.bb[3]) / 2);
          const bed = add(new T.Mesh(new T.PlaneGeometry(s.bb[2] - s.bb[0], s.bb[3] - s.bb[1]), M.rock), false, true);
          bed.rotation.x = -Math.PI / 2; bed.position.set(m.position.x, base + 0.02, m.position.z);
          continue;
        }
        const shape = new T.Shape(s.pts.map(([x, z]) => new T.Vector2(x, -z)));
        const depth = s.bridge ? 0.5 : Math.max(0.4, s.y - base + 0.05);
        const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
        const m = new T.Mesh(g, [top, M.side]); m.rotation.x = -Math.PI / 2; m.position.y = s.y - depth;
        if (s.bridge) {
          const piv = new T.Group(); piv.position.set(0, 0, s.bridge.z1); m.position.z = -s.bridge.z1; piv.add(m); grp.add(piv);
          m.receiveShadow = true; m.castShadow = true; G.dyn.bridges.push({ piv, b: s.bridge });
        } else add(m, false, true);
      } else if (s.kind === 'ramp') {
        const fx = (u) => lerp(s.x0, s.x1, u), fz = (v) => lerp(s.z0, s.z1, v);
        add(new T.Mesh(grid(1, 1, (u, v) => [fx(u), heightOf(s, fx(u), fz(v)), fz(v)]), top), false, true);
        for (const [x0, z0, x1, z1] of [[s.x0, s.z0, s.x0, s.z1], [s.x1, s.z0, s.x1, s.z1], [s.x0, s.z1, s.x1, s.z1], [s.x0, s.z0, s.x1, s.z0]]) {
          add(new T.Mesh(grid(1, 1, (u, v) => { const x = lerp(x0, x1, u), z = lerp(z0, z1, u); return [x, lerp(base, heightOf(s, x, z), v), z]; }), M.side), false, true).material = M.side;
        }
      } else if (s.kind === 'spiral') {
        const P = (u, r) => { const a = s.a0 + (s.a1 - s.a0) * u, x = s.cx + Math.cos(a) * r, z = s.cz + Math.sin(a) * r; return [x, heightOf(s, x, z), z]; };
        add(new T.Mesh(grid(64, 3, (u, v) => P(u, lerp(s.r0, s.r1, v))), top), false, true);
        add(new T.Mesh(grid(64, 1, (u, v) => { const p = P(u, s.r1 + 0.02); return [p[0], lerp(base, p[1], v), p[2]]; }), M.cone), false, true);
      } else if (s.kind === 'bowl') {
        add(new T.Mesh(grid(40, 6, (u, v) => { const a = u * TAU, r = v * s.r; return [s.cx + Math.cos(a) * r, s.y + s.slope * r, s.cz + Math.sin(a) * r]; }), top), false, true);
      }
    }
    // Walls.
    for (const w of Hl.walls) {
      if (w.look === 'none') continue;
      const lo = (k) => (w.look === 'rail' ? Math.max(k ? w.b1 : w.b0, (k ? w.t1 : w.t0) - 1.65) : k ? w.b1 : w.b0);
      const th = w.look === 'lip' ? 0.3 : w.look === 'cone' ? 1 : 0.42;
      add(new T.Mesh(prism(w, [lo(0), lo(1)], [w.t0, w.t1], th), w.look === 'rail' ? M.rail : M[w.look] || M.rail));
      if (w.look === 'rail') add(new T.Mesh(prism(w, [w.t0 - 0.05, w.t1 - 0.05], [w.t0 + 0.12, w.t1 + 0.12], 0.56), M.railTop), false, true);
    }
    for (const b of Hl.boxes) {
      const m = add(new T.Mesh(new T.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0), M[b.look] || M.wood));
      m.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
      // Castle walls get battlements on top.
      if (b.look === 'castle') for (let x = b.x0 + 0.35; x < b.x1 - 0.3; x += 1.1) for (const z of [b.z0 + 0.35, b.z1 - 0.35]) { const c = add(new T.Mesh(G.merlon || (G.merlon = new T.BoxGeometry(0.7, 0.8, 0.7)), M.castle)); c.geometry.keep = true; c.position.set(x + 0.2, b.y1 + 0.4, z); }
      if (XMAS && b.look === 'hedge') for (let x = b.x0 + 0.5; x < b.x1; x += 1.1) { const l = add(new T.Mesh(G.bulb || (G.bulb = new T.SphereGeometry(0.12, 6, 4)), M.bulbs[Math.floor(x * 7) % 5]), false, false); l.geometry.keep = true; l.position.set(x, b.y1 + 0.05, b.z0 - 0.02); }
    }
    // Snowmen.
    for (const p of Hl.posts) {
      const s1 = add(new T.Mesh(new T.SphereGeometry(p.r, 16, 12), M.snow)); s1.position.set(p.x, p.y0 + p.r * 0.85, p.z);
      const s2 = add(new T.Mesh(new T.SphereGeometry(p.r * 0.72, 16, 12), M.snow)); s2.position.set(p.x, p.y0 + p.r * 2.1, p.z);
      const s3 = add(new T.Mesh(new T.SphereGeometry(p.r * 0.5, 14, 10), M.snow)); s3.position.set(p.x, p.y0 + p.r * 3, p.z);
      const nose = add(new T.Mesh(new T.ConeGeometry(0.12, 0.6, 8), M.carrot)); nose.rotation.x = -Math.PI / 2; nose.position.set(p.x, p.y0 + p.r * 3, p.z - p.r * 0.5 - 0.2);
      for (const dx of [-0.18, 0.18]) { const e = add(new T.Mesh(new T.SphereGeometry(0.08, 6, 4), M.coal), false); e.position.set(p.x + dx, p.y0 + p.r * 3.15, p.z - p.r * 0.45); }
      const hat = add(new T.Mesh(new T.CylinderGeometry(0.4, 0.4, 0.6, 12), XMAS ? M.gift[0] : M.coal)); hat.position.set(p.x, p.y0 + p.r * 3.55, p.z);
    }
    for (const p of Hl.bumpers) {
      const m = add(new T.Mesh(new T.CylinderGeometry(p.r, p.r, 1.2, 24), M.bumper.clone())); m.position.set(p.x, 0.6, p.z);
      const c = add(new T.Mesh(new T.CylinderGeometry(p.r * 0.7, p.r * 0.7, 0.14, 24), M.cap)); c.position.set(p.x, 1.25, p.z);
      G.dyn.bumpers.push({ m, p });
    }
    for (const s of Hl.spinners) {
      const g = new T.Group(); g.position.set(s.x, s.y, s.z);
      const bar = new T.Mesh(new T.BoxGeometry(s.len * 2, 0.7, 0.32), M.bar); bar.position.y = 0.4; bar.castShadow = true; g.add(bar);
      const stripe = new T.Mesh(new T.BoxGeometry(s.len * 2 + 0.02, 0.2, 0.34), M.bumper); stripe.position.y = 0.45; g.add(stripe);
      const post = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 1.1, 12), M.cap); post.position.y = 0.4; g.add(post);
      grp.add(g); G.dyn.spinners.push({ g, s });
    }
    for (const p of Hl.pucks) { const m = add(new T.Mesh(new T.CylinderGeometry(p.r, p.r, 0.6, 20), M.puck)); m.position.y = 0.3; G.dyn.pucks.push({ m, p }); }
    for (const ml of Hl.mills) {
      const roof = add(new T.Mesh(new T.ConeGeometry(6.4, 4, 4), M.roof)); roof.rotation.y = Math.PI / 4; roof.position.set(ml.x, 8, 27);
      const top = add(new T.Mesh(new T.BoxGeometry(9.2, 0.6, 6), M.mill)); top.position.set(ml.x, 5.9, 27);
      const over = add(new T.Mesh(new T.BoxGeometry(2.8, 3, 6), M.mill)); over.position.set(ml.x, 4.5, 27);
      const g = new T.Group(); g.position.set(ml.x, ml.y, ml.z);
      for (let k = 0; k < 4; k++) {
        const arm = new T.Group(); arm.rotation.z = k * Math.PI / 2;
        const blade = new T.Mesh(new T.BoxGeometry(ml.len - 1, 1.5, 0.08), M.sail); blade.position.x = (ml.len - 1) / 2 + 0.8; blade.castShadow = true; arm.add(blade);
        const spar = new T.Mesh(new T.BoxGeometry(ml.len, 0.18, 0.18), M.trunk); spar.position.x = ml.len / 2; arm.add(spar);
        if (XMAS) for (let x = 1.5; x < ml.len; x += 1.2) { const l = new T.Mesh(G.bulb || (G.bulb = new T.SphereGeometry(0.12, 6, 4)), M.bulbs[k + Math.floor(x) % 5 % 5]); l.geometry.keep = true; l.position.set(x, 0.85, 0.1); arm.add(l); }
        g.add(arm);
      }
      const hub = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 0.6, 12), M.trunk); hub.rotation.x = Math.PI / 2; g.add(hub);
      grp.add(g); G.dyn.sails.push({ g, ml });
    }
    for (const L of Hl.loops) {
      const rr = L.R + 0.05;
      add(new T.Mesh(grid(80, 2, (u, v) => { const p = u * TAU; return [loopX(L, p) + (v - 0.5) * 3, L.y + L.R - rr * Math.cos(p), L.z + rr * Math.sin(p)]; }), M.track), false, true);
      for (const e of [-1.5, 1.5]) add(new T.Mesh(grid(80, 1, (u, v) => { const p = u * TAU, r2 = rr - v * 0.6; return [loopX(L, p) + e, L.y + L.R - r2 * Math.cos(p), L.z + r2 * Math.sin(p)]; }), M.rail), false, false);
    }
    if (Hl.volcano) {
      const V = Hl.volcano;
      const core = add(new T.Mesh(new T.CylinderGeometry(V.r0 + 0.1, V.r0 + 0.4, V.rim - base + 0.2, 32, 1, true), M.crater)); core.position.set(V.cx, (V.rim + base) / 2, V.cz);
      const ring = add(new T.Mesh(new T.TorusGeometry(V.r0 + 0.12, 0.16, 8, 48), M.lava), false, false); ring.rotation.x = Math.PI / 2; ring.position.set(V.cx, V.rim, V.cz);
      G.dyn.smoke = Array.from({ length: 8 }, (_, i) => { const m = add(new T.Mesh(new T.SphereGeometry(1, 10, 8), new T.MeshLambertMaterial({ color: XMAS ? '#ffffff' : '#b4b0b8', transparent: true, opacity: 0.4, depthWrite: false })), false, false); m.k = i / 8; return m; });
      G.dyn.smokeAt = [V.cx, V.rim, V.cz + V.r0 * 0.85];
    }
    // The cup and its flag.
    const c = Hl.cup, cupY = c[1] + 0.02;
    const hole = add(new T.Mesh(new T.CircleGeometry(CUP, 28), M.cup), false, false); hole.rotation.x = -Math.PI / 2; hole.position.set(c[0], cupY, c[2]);
    const rim = add(new T.Mesh(new T.RingGeometry(CUP, CUP + 0.14, 28), M.cupRim), false, false); rim.rotation.x = -Math.PI / 2; rim.position.set(c[0], cupY + 0.005, c[2]);
    const pole = add(new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 3.6, 8), M.pole)); pole.position.set(c[0] + 0.3, c[1] + 1.8, c[2] + 0.3);
    const flag = add(new T.Mesh(new T.PlaneGeometry(1.5, 0.95, 6, 1), M.flag)); flag.position.set(c[0] + 1.05, c[1] + 3.1, c[2] + 0.3);
    G.dyn.flags.push(flag);
    // Water lily pads.
    if (Hl.deco.some((d) => d.look === 'pads')) {
      const rnd = seeded(7);
      for (let i = 0; i < 14; i++) { const m = add(new T.Mesh(new T.CircleGeometry(0.6 + rnd() * 0.5, 12, 0.3, TAU - 0.6), M.hedge), false, false); m.rotation.x = -Math.PI / 2; m.position.set(-11 + rnd() * 15, -0.2, 19 + rnd() * 18); }
    }
    // Scenery round the hole: trees (with lights and snow at Christmas) and a few presents.
    const xs = Hl.surfaces.flatMap((s) => [s.bb[0], s.bb[2]]), zs = Hl.surfaces.flatMap((s) => [s.bb[1], s.bb[3]]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), rnd = seeded(11 + Hl.par * 7 + Hl.name.length);
    G.treeGeo = G.treeGeo || { cone: new T.ConeGeometry(1.6, 4.2, 8), trunk: new T.CylinderGeometry(0.3, 0.35, 1.2, 6), cap: new T.ConeGeometry(0.75, 1.4, 8), gift: new T.BoxGeometry(1, 1, 1) };
    Object.values(G.treeGeo).forEach((g) => { g.keep = true; });
    for (let i = 0; i < 46; i++) {
      const side = rnd() < 0.5 ? -1 : 1, x = side < 0 ? x0 - 3 - rnd() * 16 : x1 + 3 + rnd() * 16, z = z0 - 8 + rnd() * (z1 - z0 + 30), s = 0.7 + rnd() * 0.8;
      const tr = add(new T.Mesh(G.treeGeo.trunk, M.trunk)); tr.position.set(x, base + 0.6 * s, z); tr.scale.setScalar(s);
      const cn = add(new T.Mesh(G.treeGeo.cone, M.leaf)); cn.position.set(x, base + (1.2 + 2.1) * s, z); cn.scale.setScalar(s);
      if (XMAS) {
        const cap = add(new T.Mesh(G.treeGeo.cap, M.snow), false); cap.position.set(x, base + 4.7 * s, z); cap.scale.setScalar(s);
        for (let k = 0; k < 5; k++) { const a = k * 1.3 + i, hh = 1.6 + k * 0.6, rr = 1.6 * (1 - (hh - 1.2) / 4.2) + 0.05; const l = add(new T.Mesh(G.bulb || (G.bulb = new T.SphereGeometry(0.12, 6, 4)), M.bulbs[(i + k) % 5]), false, false); l.geometry.keep = true; l.position.set(x + Math.cos(a) * rr * s, base + hh * s, z + Math.sin(a) * rr * s); }
        if (rnd() < 0.3) { const gm = add(new T.Mesh(G.treeGeo.gift, M.gift[i % 4])); const gs = 0.6 + rnd() * 0.5; gm.scale.setScalar(gs); gm.position.set(x + 2, base + gs / 2, z + 1); }
      }
    }
    G.scene.add(grp);
  }
  function animateHole(Hl, t) {
    const d = G.dyn;
    for (const { g, s } of d.spinners) g.rotation.y = -(s.phase + s.speed * t);
    for (const { m, p } of d.pucks) { const q = puckAt(p, t); m.position.x = q[0]; m.position.z = q[1]; }
    for (const { g, ml } of d.sails) g.rotation.z = ml.speed * t;
    for (const { piv, b } of d.bridges) piv.rotation.x = lift(b, t) * 1.25;
    for (const { m, p } of d.bumpers) m.material.emissiveIntensity = 0.25 + p.flash * 1.6;
    for (const f of d.flags) f.rotation.y = Math.sin(t * 2.2) * 0.2;
    if (d.smoke.length) d.smoke.forEach((m) => { const k = (t * 0.25 + m.k) % 1; m.position.set(d.smokeAt[0] + Math.sin(k * 6 + m.k * 9) * 1.2, d.smokeAt[1] + 1 + k * 8, d.smokeAt[2]); m.scale.setScalar(0.4 + k * 1.2); m.material.opacity = 0.4 * (1 - k); });
    G.water.offset.set(t * 0.02, t * 0.035);
  }

  Arcade.register('minigolf', golf);
})();
