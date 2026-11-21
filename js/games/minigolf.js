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
  const { ctx, C, clamp, font, sfx, setScore, over, shake, calm } = Arcade;

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
      // Things the camera must not sit inside or look through: buildings, snowmen, the volcano, the loop, tall rock walls.
      // `look` says which materials fade out when one of them is between the camera and your ball anyway.
      o.blockers = o.boxes.map((b) => ({ look: b.look, box: [b.x0 - 0.3, b.y0, b.z0 - 0.3, b.x1 + 0.3, b.y1 + (b.look === 'castle' ? 1.2 : 0.3), b.z1 + 0.3] }));
      for (const m of o.mills) o.blockers.push({ look: 'mill', box: [m.x - 4.9, 2.5, 23.7, m.x + 4.9, 10.5, 30.3] });
      for (const q of o.posts) o.blockers.push({ look: 'snow', cyl: [q.x, q.z, q.r + 0.3, q.y0, q.y0 + q.r * 3.9] });
      for (const w of o.walls) if (w.look === 'cone') o.blockers.push({ look: 'cone', box: [Math.min(w.ax, w.bx) - 0.8, -2, Math.min(w.az, w.bz) - 0.8, Math.max(w.ax, w.bx) + 0.8, w.t0 + 0.3, Math.max(w.az, w.bz) + 0.8] });
      if (o.volcano) { const V = o.volcano; o.blockers.push({ look: 'crater', cyl: [V.cx, V.cz, V.r0 + 0.6, -2, V.rim + 0.4] }); }
      for (const L of o.loops) o.blockers.push({ look: 'loop', loop: L });
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
    // Close to the cup it also tries gentle putts, so it doesn't knock a tap-in over the hole.
    const c = Hl.cup, near = Math.hypot(c[0] - b.x, c[2] - b.z);
    if (near < 10 && Math.abs(b.y - R - c[1]) < 1) {
      const a = Math.atan2(c[0] - b.x, c[2] - b.z);
      for (const o of [-0.05, 0, 0.05]) for (const p of [0.04, 0.06, 0.08, 0.11, 0.13]) out.push([a + o, p]);
    }
    return out;
  }
  const closer = (a, p) => [-0.05, -0.025, 0, 0.025, 0.05].flatMap((o) => [0.88, 1, 1.12].map((k) => [a + o, clamp(p * k, 0.05, 1)])).filter((c, i) => i !== 7);

  /* ---------- Camera ---------- */
  // Is this point inside something the camera shouldn't be in?
  function within(k, x, y, z) {
    if (k.box) { const q = k.box; return x > q[0] && x < q[3] && y > q[1] && y < q[4] && z > q[2] && z < q[5]; }
    if (k.cyl) { const q = k.cyl; return y > q[3] && y < q[4] && Math.hypot(x - q[0], z - q[1]) < q[2]; }
    const L = k.loop; return x > L.x - 2.4 && x < L.x + L.off + 2.4 && Math.hypot(z - L.z, y - L.y - L.R) < L.R + 1;
  }
  // Does this thing stand between the camera at c and the point t? Checks points along the line, leaving out the bit right next to the ball.
  function blocks(k, t, c) {
    const d = dist3(t, c), n = Math.ceil(d / 0.6);
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      if (f * d >= 1.2 && within(k, t[0] + (c[0] - t[0]) * f, t[1] + (c[1] - t[1]) * f, t[2] + (c[2] - t[2]) * f)) return true;
    }
    return false;
  }
  const clear = (Hl, t, c) => !Hl.blockers.some((k) => blocks(k, t, c));
  // Camera spots behind the ball, from best to last resort: further back and lower is nicer, higher and closer sees over things.
  const BEHIND = [[12, 6.6], [12, 9.5], [10, 12.5], [9.5, 10], [7, 10.5], [5, 9.5]];

  /* ---------- Animation helpers ---------- */
  const easeBack = (k) => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2); // Overshoots a little, then settles.
  const easeIn = (k) => k * k;
  // Where a putt goes until its first bounce (at most 13 units ahead), as dots 0.7 apart, for the dotted aim line.
  function previewPath(Hl, from, t0, ang, pow) {
    const b = newBall(from.x, from.y - R, from.z);
    putt(b, ang, pow);
    let hit = null, t = t0, len = 0, px = b.x, py = b.y, pz = b.z, next = 0.7;
    const pts = [], ev = (ty, v, bb) => { if (!hit && (ty === 'wall' || ty === 'bumper')) hit = [bb.x, bb.y, bb.z, bb.vx, bb.vz]; };
    for (let i = 0; i < 120 && !hit; i++) {
      stepBall(b, Hl, t, 1 / 60, ev); t += 1 / 60;
      const d = Math.hypot(b.x - px, b.y - py, b.z - pz);
      while (d > 0 && len + d >= next && next <= 13) { const f = (next - len) / d; pts.push([lerp(px, b.x, f), lerp(py, b.y, f), lerp(pz, b.z, f)]); next += 0.7; }
      len += d; px = b.x; py = b.y; pz = b.z;
      if (b.hazard || b.sunk || b.rest || b.loop || len > 13) break;
    }
    return { pts, hit };
  }
  // A smooth line through the route of a hole, measured along its length, for the fly-over at the start.
  function pathOf(r) {
    const pts = [], q = (i) => r[clamp(i, 0, r.length - 1)];
    for (let i = 0; i < r.length - 1; i++) for (let k = 0; k < 12; k++) {
      const u = k / 12, a = q(i - 1), b = q(i), c = q(i + 1), d = q(i + 2);
      pts.push([0, 1, 2].map((j) => 0.5 * (2 * b[j] + (c[j] - a[j]) * u + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * u * u + (3 * b[j] - a[j] - 3 * c[j] + d[j]) * u * u * u)));
    }
    pts.push(r[r.length - 1].slice());
    const at = [0];
    for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + dist3(pts[i], pts[i - 1]));
    return { pts, at, len: at[at.length - 1] };
  }
  // The point s along the path. Before the start and past the end it carries on in a straight line.
  function pathAt(P, s) {
    const { pts, at } = P, n = pts.length;
    const out = (i, j, k) => { const dx = pts[j][0] - pts[i][0], dz = pts[j][2] - pts[i][2], l = Math.hypot(dx, dz) || 1; return [pts[i][0] + dx / l * k, pts[i][1], pts[i][2] + dz / l * k]; };
    if (s <= 0) return out(0, Math.min(3, n - 1), s);
    if (s >= P.len) { const e = pts[n - 1], q = pts[Math.max(0, n - 4)], dx = e[0] - q[0], dz = e[2] - q[2], l = Math.hypot(dx, dz) || 1; return [e[0] + dx / l * (s - P.len), e[1], e[2] + dz / l * (s - P.len)]; }
    let i = 1;
    while (at[i] < s) i++;
    const f = (s - at[i - 1]) / (at[i] - at[i - 1] || 1);
    return pts[i - 1].map((v, j) => lerp(v, pts[i][j], f));
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // The putter hangs from a point above the ball. Turned back by PUTT_REST it sits just behind the ball; the more power,
  // the further back it swings. It swings through to PUTT_THRU in SWING seconds, speeding up as it goes.
  const PUTT_REST = 0.214, PUTT_THRU = -0.5, SWING = 0.12;
  const swingBack = (pw) => PUTT_REST + pw * 0.85;
  // How long after the swing starts the putter reaches the ball.
  const hitDelay = (pw) => SWING * Math.sqrt((swingBack(pw) - PUTT_REST) / (swingBack(pw) - PUTT_THRU));
  const INTRO = 3.2; // The fly-over at the start of a hole, in seconds.
  // Bits of grass, sand, ice or wood that fly up when a ball is hit or lands.
  const FLECK = { grass: ['#3f9a4c', '#6cc35a', '#2f7a3f'], sand: ['#e3cf94', '#c9b276'], ice: ['#ffffff', '#cfeeff'], wood: ['#b07a46', '#8f5f33'], stone: ['#b9b5c4', '#8b8796'], basalt: XMAS ? ['#ffffff', '#dfe8f5'] : ['#6a5a55', '#8c7a72'] };
  // What the bots say.
  const CHAT = {
    ace: ['EZ ACE', 'no way!!', 'did u see that'], under: ['ez', 'lets gooo', 'too easy', 'clean'], par: ['gg', 'nice', 'ok ok', 'par is par'],
    over: ['finally', 'ugh', 'gg i guess', 'whew'], water: ['nooo', 'splash lol', 'rip', 'i can swim'], out: ['bruh', 'byeee', 'oops', 'where did it go'],
    max: ['rage quit', 'this hole hates me'], wow: ['WHAT', 'no way!!', 'hacker!', 'wow'], lol: ['lol', 'rip', 'oof'],
  };
  const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
  // The podium stands on its own little island far away from the holes. Steps: [x, height] for 1st to 3rd; 4th stands on the grass.
  const POD = { o: [0, 0, 2400], steps: [[0, 2.4, 0], [3.4, 1.6, 0], [-3.4, 1, 0], [-4.3, 0, -2.6]], at: [1.5, 1.05, 0.65, 0.3] };
  // How high a ball dropped from 7 units is, k seconds after it was let go, bouncing a few times.
  function dropH(k) {
    if (k < 0) return 7;
    const g = 30, t1 = Math.sqrt(14 / g);
    if (k < t1) return 7 - 0.5 * g * k * k;
    let t = k - t1, up = g * t1 * 0.42;
    while (up > 1) { const d = 2 * up / g; if (t < d) return up * t - 0.5 * g * t * t; t -= d; up *= 0.42; }
    return 0;
  }

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
      this.n = -1; this.total = 0; this.keys = {}; this.fx = []; this.rings = []; this.bubbles = []; this.banner = null; this.seen = false; this.final = null;
      this.start(0);
    },
    start(n) {
      this.n = n; const Hl = this.Hl = this.holes[n];
      this.t = 0; this.phase = 'intro'; this.introT = 0; this.fast = false; this.overview = false; this.drag = null; this.cardT = 0;
      this.slow = 1; this.slowT = 0; this.doneT = 0; this.celT = 0; this.pops = []; this.preview = null; this.flagPop = 0; this.rings = []; this.bubbles = [];
      // Everyone starts side by side on the tee. The last ball goes wherever there is room.
      const pad = ground(Hl, Hl.tee[0], Hl.tee[2], Hl.tee[1], 0).bb;
      const fits = (s) => Hl.tee[0] + s[0] > pad[0] + 0.7 && Hl.tee[0] + s[0] < pad[2] - 0.7 && Hl.tee[2] + s[1] > pad[1] + 0.7;
      const spots = [[0, 0], [-1.3, -0.3], [1.3, -0.3], [[-2.6, -0.8], [2.6, -0.8], [0, -2.6]].find(fits)];
      this.players.forEach((p, i) => {
        p.ball = newBall(Hl.tee[0] + spots[i][0], Hl.tee[1], Hl.tee[2] + spots[i][1]);
        p.shots = 0; p.done = false; p.wait = 0; p.plan = null; p.club = null; p.trail = []; p.safe = { x: p.ball.x, y: p.ball.y, z: p.ball.z }; p.sinkT = 0;
      });
      // The aim starts toward the first turn of the hole (or toward the volcano on the last hole).
      const to = Hl.look || Hl.route[1], me = this.players[0].ball;
      this.aim = { a: Math.atan2(to[0] - me.x, to[2] - me.z), p: 0.4 };
      this.camA = this.aim.a; this.cam = null;
    },
    me() { return this.players[0]; },
    canPutt() { const p = this.me(); return this.phase === 'play' && !p.done && !p.wait && p.ball.rest && !p.club; },
    // Is a point close enough to the camera to bother with sparks and sounds?
    near(b, d) { const c = this.cam && this.cam.p; return !c || Math.hypot(b.x - c[0], b.y - c[1], b.z - c[2]) < d; },
    shoot(p, ang, pow) {
      if (pow < 0.04) return;
      const b = p.ball;
      p.safe = { x: b.x, y: b.y, z: b.z };
      putt(b, ang, pow); p.shots++;
      if (p.you) this.slowT = 0;
      p.col = p.you ? (pow < 0.45 ? '#b8e65c' : pow < 0.78 ? '#ffd56b' : '#ff6b9a') : p.color;
      // A puff of grass (or sand, ice or wood) where the putter hit.
      if (this.near(b, 35)) this.burst(b.x, b.y - R + 0.1, b.z, FLECK[b.mat] || FLECK.grass, 4 + Math.round(pow * 8), 1.5 + pow * 3, 2.5, 0.45);
      if (p.you) {
        this.total++; setScore(this.total); this.seen = true;
        sfx.tone(150 + pow * 240, 0.07, 'triangle', 0.09); sfx.tone(1200, 0.02, 'square', 0.02);
      }
    },
    // Letting go starts the swing; the putter hits the ball a moment later.
    swingStart() {
      const me = this.me(), b = me.ball;
      if (!this.canPutt() || this.aim.p < 0.04) return;
      me.club = { a: this.aim.a, pw: this.aim.p, t0: this.t - 1, swingAt: this.t, hitAt: this.t + hitDelay(this.aim.p), x: b.x, y: b.y, z: b.z };
    },
    skip() {
      if (this.phase === 'card') this.cardT = 0;
      else if (this.phase === 'intro') this.introT = Math.max(this.introT, INTRO - 0.5);
      else if (this.phase === 'podium') this.podT = 99;
      else return false;
      return true;
    },
    key(e, down) {
      this.keys[e.code] = down;
      if (!down || e.repeat) return;
      if (e.code === 'KeyC') this.overview = !this.overview;
      if (e.code === 'Space' || e.code === 'Enter') {
        if (this.skip()) return;
        if (this.me().done) this.fast = true;
        else if (this.canPutt()) this.swingStart();
      }
    },
    // Mouse and touch: press, pull back toward you and let go. Sliding sideways turns the aim.
    press(down) {
      if (down) { this.drag = { from: null }; return; }
      const d = this.drag; this.drag = null;
      if (!d || !d.from || d.button) return;
      if (d.aiming && this.canPutt() && this.aim.p >= 0.04) this.swingStart();
    },
    point(p) {
      const d = this.drag;
      if (!d) return;
      if (!d.from) {
        d.from = p;
        if (this.phase !== 'podium' && Math.hypot(p.x - (W - 32), p.y - (H - 32)) < 26) { d.button = true; this.overview = !this.overview; return; }
        if (this.skip()) { d.button = true; return; }
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
      d.up = dy < -20;
    },
    tap() {},
    // Sounds, sparks and the like for the balls you can see.
    ev(type, v, b) {
      if (type === 'wall') { if (b === this.me().ball) sfx.tone(260 + Math.min(v, 40) * 6, 0.04, 'triangle', Math.min(0.08, v / 300)); }
      else if (type === 'bumper') { sfx.tone(880, 0.06, 'square', 0.05); sfx.tone(1320, 0.05, 'square', 0.03); this.burst(b.x, b.y, b.z, ['#fff3a0', '#ff6b9a', '#5ce1e6'], 12, 6); }
      else if (type === 'land' && b === this.me().ball) {
        sfx.tone(120, 0.08, 'triangle', 0.08);
        if (G) { G.balls[0].sqA = clamp(v / 22, 0.25, 1); G.balls[0].sqT = 0; }
        this.burst(b.x, b.y - R, b.z, FLECK[b.mat] || FLECK.grass, b.mat === 'sand' ? 14 : 6, b.mat === 'sand' ? 4 : 2.5, 2.5, 0.45);
      }
    },
    burst(x, y, z, cols, n, sp, up = 4, life = 0.7, star = false) {
      for (let i = 0; i < n && this.fx.length < (G && G.q < 2 ? 120 : 260); i++) {
        const a = Math.random() * TAU, s = sp * (0.4 + Math.random() * 0.6);
        this.fx.push({ x, y, z, vx: Math.cos(a) * s, vy: up * (0.5 + Math.random()), vz: Math.sin(a) * s, life: life * (0.6 + Math.random() * 0.6), col: cols[i % cols.length], g: star ? 2 : 14, star });
      }
    },
    // An expanding ring on the ground (a splash, or a wave round the cup).
    ring(x, y, z, col, r, delay = 0) { this.rings.push({ x, y, z, col, r, t: -delay }); },
    // A bot says something in a speech bubble over its ball.
    chat(p, kind, word) {
      if (!p || p.you) return;
      const b = p.ball, c = this.Hl.cup, at = b.sunk ? [c[0], c[1] + R, c[2]] : [b.x, b.y, b.z];
      this.bubbles = this.bubbles.filter((q) => q.p !== p);
      this.bubbles.push({ p, text: pickOne(CHAT[kind]), word, t: 0, x: at[0], y: at[1], z: at[2] });
    },
    someBot() { return this.players[1 + Math.floor(Math.random() * 3)]; },
    // What happens to a ball after a physics step: water, out of bounds, in the cup, or stopped for good.
    settle(p) {
      const b = p.ball, me = p.you, Hl = this.Hl;
      if (b.hazard) {
        const seen = me || this.near(b, 45);
        if (b.hazard === 'water') {
          if (seen) {
            const s = ground(Hl, b.x, b.z, b.y, this.t), wy = s ? GY + 0.28 : b.y - R;
            this.ring(b.x, wy, b.z, '#ffffff', 2.4); this.ring(b.x, wy, b.z, '#bfe8ff', 1.6, 0.22);
            this.burst(b.x, wy, b.z, ['#bfe8ff', '#7cc4ff', '#ffffff'], me ? 18 : 10, 5, 7);
          }
        } else if (Hl.isle && inPoly(Hl.isle, b.x, b.z)) { if (seen) this.burst(b.x, Hl.isleY + 0.3, b.z, ['#ffffff', '#e6e6f0', '#cfd3e0'], 14, 3, 3, 0.8); }
        else b.fall = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz }; // Off the edge of the island: it drops into the clouds.
        if (me) {
          if (b.hazard === 'water') sfx.tone(140, 0.35, 'sawtooth', 0.05, 60); else sfx.tone(300, 0.3, 'sawtooth', 0.04, 90);
          shake(4, 260);
          this.say(b.hazard === 'water' ? 'SPLASH +1' : 'OUT +1', C.cyan, b);
          if (Math.random() < 0.35) this.chat(this.someBot(), 'lol');
        } else this.chat(p, b.hazard === 'water' ? 'water' : 'out');
        if (p.shots < MAX_SHOTS) { p.shots++; if (me) { this.total++; setScore(this.total); } }
        b.hazard = null; p.wait = 0.8; b.hidden = true; b.vx = b.vy = b.vz = 0; b.loop = null;
        return;
      }
      if (b.sunk) {
        p.done = true; p.sinkT = 1; b.rest = true;
        const diff = p.shots - Hl.par, word = p.shots === 1 ? 'HOLE IN ONE!' : ({ '-3': 'ALBATROSS!', '-2': 'EAGLE!', '-1': 'BIRDIE!', 0: 'PAR' })[diff] || (diff === 1 ? 'BOGEY' : '+' + diff);
        // "Plink", and a wave round the cup.
        const c = Hl.cup;
        if (me || this.near(b, 45)) {
          this.ring(c[0], c[1] + 0.06, c[2], me ? '#ffffff' : p.color, 2.2);
          sfx.tone(1568, 0.08, 'sine', me ? 0.07 : 0.03); setTimeout(() => sfx.tone(2093, 0.14, 'sine', me ? 0.06 : 0.025), 70);
        }
        if (me) {
          this.flagPop = performance.now(); this.celT = 1.8; // The camera stays on the cup for the celebration.
          if (p.shots === 1) { sfx.win(); this.fireworks(); this.banner = { text: word, t: performance.now() }; this.chat(this.someBot(), 'wow'); }
          else if (diff <= -2) { sfx.win(); this.fireworks(); this.banner = { text: word, t: performance.now() }; }
          else if (diff < 0) { sfx.win(); this.confetti(); }
          else { this.confetti(16); setTimeout(() => sfx.tone(784, 0.16, 'triangle', 0.07), 160); }
          if (!this.banner || this.banner.text !== word) this.say(word, diff < 0 ? C.lime : C.ink, b, 13);
        } else this.chat(p, p.shots === 1 ? 'ace' : diff < 0 ? 'under' : diff === 0 ? 'par' : 'over', word);
        return;
      }
      if (b.rest && p.shots >= MAX_SHOTS) { p.done = true; if (me) { this.say('MAX ' + MAX_SHOTS, C.pink, b); sfx.lose(); } else this.chat(p, 'max'); }
    },
    say(text, col, b, size = 11) { this.pops = this.pops || []; this.pops.push({ text, col, size, x: b.x, y: b.y + 1.6, z: b.z, life: 1.6 }); },
    confetti(n = 60) { const c = this.Hl.cup; this.burst(c[0], c[1] + 0.5, c[2], ['#ff6b9a', '#5ce1e6', '#b8e65c', '#ffd56b', '#a78bfa'], n, 7, 12, 1.6); },
    fireworks(at) {
      const c = at || this.Hl.cup;
      for (let k = 0; k < 4; k++) setTimeout(() => { if (Arcade.playing()) { this.burst(c[0] + (Math.random() - 0.5) * 12, c[1] + 9 + Math.random() * 5, c[2] + (Math.random() - 0.5) * 8, [['#ffd56b', '#fff3a0'], ['#ff6b9a', '#ffd0de'], ['#5ce1e6', '#d5f8ff'], ['#b8e65c', '#f0ffd0']][k], 40, 9, 2, 1.4); sfx.tone(600 + k * 150, 0.2, 'sine', 0.04, 1600); } }, k * 260);
      if (!at) this.confetti();
    },
    update(dt) {
      if (!G) return; // Wait for the 3D engine.
      // Slow motion while your ball rolls up to the edge of the cup, and while it drops in.
      const me = this.me(), b = me.ball, c = this.Hl.cup;
      let want = 1;
      if (!calm() && this.phase === 'play' && !this.fast && this.slowT < 1.1) {
        const d = Math.hypot(b.x - c[0], b.z - c[2]), v = Math.hypot(b.vx, b.vz);
        if (!b.rest && !b.air && !b.loop && d < CUP + 1.5 && v > 2.5 && v < 12 && Math.abs(b.y - R - c[1]) < 0.4 && b.vx * (c[0] - b.x) + b.vz * (c[2] - b.z) > 0) want = 0.35;
        if (me.done && b.sunk && me.sinkT > 0.15) want = 0.35;
      }
      this.slow += (want - this.slow) * (want < this.slow ? 0.3 : 0.04);
      if (this.slow < 0.9) this.slowT += dt; // Real time spent in slow motion this putt: never more than about a second.
      const runs = this.fast && this.phase === 'play' ? 4 : 1;
      for (let i = 0; i < runs; i++) this.tick(this.phase === 'play' ? dt * this.slow : dt);
    },
    tick(dt) {
      const Hl = this.Hl;
      for (const f of this.fx) { f.life -= dt; f.vy -= f.g * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt; }
      this.fx = this.fx.filter((f) => f.life > 0);
      for (const r of this.rings) r.t += dt;
      this.rings = this.rings.filter((r) => r.t < 0.8);
      for (const q of this.bubbles) q.t += dt;
      this.bubbles = this.bubbles.filter((q) => q.t < 2.4);
      for (const p of this.pops) { p.life -= dt; p.y += dt * 1.2; }
      this.pops = this.pops.filter((p) => p.life > 0);
      for (const b of Hl.bumpers) b.flash = Math.max(0, b.flash - dt * 3);
      if (this.phase === 'intro') {
        this.introT += dt;
        if (this.introT > (calm() ? 1.6 : INTRO)) this.phase = 'play';
        this.camera(dt);
        return;
      }
      if (this.phase === 'card') {
        this.cardT -= dt; this.camera(dt);
        if (this.cardT <= 0) { if (this.n + 1 < this.holes.length) this.start(this.n + 1); else this.finish(); }
        return;
      }
      if (this.phase === 'podium') { this.podium(dt); return; }
      this.t += dt; this.celT = Math.max(0, this.celT - dt);
      this.sounds(Hl);
      if (this.canPutt() && !this.drag) {
        if (this.keys.ArrowLeft || this.keys.KeyA) this.aim.a += 1.6 * dt;
        if (this.keys.ArrowRight || this.keys.KeyD) this.aim.a -= 1.6 * dt;
        if (this.keys.ArrowUp || this.keys.KeyW) this.aim.p = Math.min(1, this.aim.p + 0.7 * dt);
        if (this.keys.ArrowDown || this.keys.KeyS) this.aim.p = Math.max(0.05, this.aim.p - 0.7 * dt);
      }
      // A soft tick that rises in pitch as you pull back harder.
      const step = Math.floor(this.aim.p * 12);
      if (step !== this.pstep) { if (this.canPutt() && this.pstep !== undefined) sfx.tone(260 + this.aim.p * 700, 0.03, 'sine', 0.03); this.pstep = step; }
      this.budget = 2; // The bots try at most two putts in their heads each step, so a slow phone doesn't stutter.
      for (const p of this.players) {
        const b = p.ball;
        if (p.sinkT > 0) p.sinkT = Math.max(0, p.sinkT - dt * 3);
        // The putter: when it reaches the ball, the putt happens. If the ball got knocked meanwhile, the swing is called off.
        const k = p.club;
        if (k) {
          if (!k.hit && (!b.rest || p.wait || p.done)) p.club = null;
          else if (!k.hit && this.t >= k.hitAt) { k.hit = true; this.shoot(p, k.a, k.pw); p.plan = null; }
          if (p.club && this.t > k.swingAt + 0.6) p.club = null;
        }
        if (p.done) continue;
        if (p.wait) {
          p.wait = Math.max(0, p.wait - dt);
          if (b.fall) { const f = b.fall; f.vy -= GRAV * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt; }
          if (!p.wait) {
            Object.assign(b, { x: p.safe.x, y: p.safe.y, z: p.safe.z, rest: true, air: false, hidden: false, fall: null });
            if (p.shots >= MAX_SHOTS) { p.done = true; if (p.you) this.say('MAX ' + MAX_SHOTS, C.pink, b); else this.chat(p, 'max'); }
          }
          continue;
        }
        if (!b.rest || b.loop) {
          const pre = Math.hypot(b.vx, b.vz);
          p.plan = null;
          stepBall(b, Hl, this.t, dt, p.you ? (ty, v, bb) => this.ev(ty, v, bb) : (ty, v, bb) => { if (ty === 'bumper') this.ev(ty, v, bb); });
          if (pre > 20 && this.near(b, 70)) p.trail.push({ x: b.x, y: b.y, z: b.z, life: 0.24 });
          // Sparkles on the ice, and sand spraying up.
          if (p.you && !b.air) {
            if (b.mat === 'ice' && pre > 4 && Math.random() < dt * 24) this.burst(b.x, b.y - R + 0.1, b.z, ['#ffffff', '#d5f6ff', '#a8e8ff'], 1, 1.2, 1.2, 0.6, true);
            else if (b.mat === 'sand' && pre > 5 && Math.random() < dt * 30) this.burst(b.x, b.y - R, b.z, FLECK.sand, 2, 2, 2.5, 0.4);
          }
          this.settle(p);
          // When your ball stops, the aim turns toward the next turn of the hole, to help a little.
          if (p.you && b.rest && !p.done) { const to = Hl.route[Math.min(nearest(Hl, b) + 1, Hl.route.length - 1)]; this.aim.a = Math.atan2(to[0] - b.x, to[2] - b.z); }
        } else if (p.shots >= MAX_SHOTS) this.settle(p);
        else if (collide(b, Hl, this.t, null, true)) b.rest = false; // A spinning bar or a puck knocked a resting ball.
        else if (!p.you || this.auto) this.think(p);
      }
      for (const p of this.players) { for (const tr of p.trail) tr.life -= dt; if (p.trail.length) p.trail = p.trail.filter((tr) => tr.life > 0); }
      // Everyone is in: a moment to enjoy the flag and the confetti, then the scorecard.
      if (this.players.every((p) => p.done && p.sinkT === 0)) {
        this.doneT += dt;
        if (this.doneT > (calm() ? 0.4 : 1.3)) {
          this.players.forEach((p) => { p.card[this.n] = p.shots; });
          this.phase = 'card'; this.cardT = 3.6; this.fast = false;
        }
      }
      this.camera(dt);
    },
    // The moving parts make sounds when the camera is close enough to hear them.
    sounds(Hl) {
      const c = this.cam && this.cam.p;
      if (!c || this.fast) return;
      const vol = (x, z) => clamp(1 - Math.hypot(x - c[0], z - c[2]) / 45, 0, 1);
      for (const m of Hl.mills) {
        const k = Math.floor(m.speed * this.t / Math.PI);
        if (m.ck !== undefined && k !== m.ck) { const v = vol(m.x, m.z); if (v > 0) { sfx.tone(95, 0.5, 'sawtooth', 0.022 * v, 70); setTimeout(() => sfx.tone(125, 0.3, 'sawtooth', 0.014 * v, 85), 180); } }
        m.ck = k;
      }
      for (const br of Hl.bridges) {
        const up = lift(br, this.t) > 0, v = vol(0, (br.z0 + br.z1) / 2);
        if (br.was !== undefined && up !== br.was && v > 0) {
          if (up) for (let i = 0; i < 6; i++) setTimeout(() => sfx.tone(170 + (i % 2) * 45, 0.04, 'square', 0.018 * v), i * 70);
          else { sfx.tone(70, 0.25, 'triangle', 0.08 * v); this.burst((br.x0 + br.x1) / 2, br.y + 0.2, br.z0 + 0.3, ['#cdb79a', '#a68f72', '#e8dcc8'], 14, 3, 2, 0.6); }
        }
        br.was = up;
      }
      if (Hl.volcano) {
        const k = Math.floor(this.t / 4.5), V = Hl.volcano;
        if (Hl.puff !== undefined && k !== Hl.puff) {
          const v = vol(V.cx, V.cz);
          if (v > 0) sfx.tone(52, 0.7, 'sawtooth', 0.04 * v, 38);
          this.burst(V.cx, V.rim + 0.6, V.cz + V.r0 * 0.85, XMAS ? ['#ffffff', '#e8eef8'] : ['#9a969e', '#b4b0b8', '#ff8a3a'], 16, 2.5, 7, 1.2);
        }
        Hl.puff = k;
      }
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
      if (!pl.shot) { const o = pl.order.reduce((x, y) => (y.sum < x.sum ? y : x)), sk = p.skill || SKILL[0]; pl.shot = { a: o.a + gauss() * sk.a, pw: clamp(o.pw * (1 + gauss() * sk.p), 0.05, 1) }; }
      // The putter comes out, swings back and hits the ball right on time (the moving parts were worked out for that moment).
      if (!p.club && this.t >= pl.at - 0.45) {
        const hit = Math.max(pl.at, this.t);
        p.club = { a: pl.shot.a, pw: pl.shot.pw, t0: this.t, swingAt: hit - hitDelay(pl.shot.pw), hitAt: hit, x: b.x, y: b.y, z: b.z };
      }
    },
    // For testing: the parts the bots use, so a test can play the player's ball too (golf.auto = true).
    _t: { simulate: (...a) => simulate(...a), candidates: (...a) => candidates(...a), routeCost: (...a) => routeCost(...a) },
    // The end of the round: the podium, then the score.
    finish() {
      const tot = (p) => p.card.reduce((s, v) => s + v, 0);
      this.final = this.players.map((p) => ({ p, tot: tot(p) })).sort((a, b) => a.tot - b.tot || (a.p.you ? -1 : b.p.you ? 1 : 0));
      this.phase = 'podium'; this.podT = 0; this.fx = []; this.pops = []; this.bubbles = []; this.rings = []; this.banner = null; this.overview = false; this.landed = [];
    },
    podium(dt) {
      this.podT += dt;
      const O = POD.o, won = this.final[0].p.you;
      this.final.forEach((f, r) => {
        if (!this.landed[r] && this.podT > POD.at[r] + 0.68) { this.landed[r] = true; sfx.tone(140 + (3 - r) * 40, 0.08, 'triangle', 0.07); this.burst(O[0] + POD.steps[r][0], O[1] + POD.steps[r][1] + 0.1, O[2] + POD.steps[r][2], FLECK.grass, 6, 2, 2, 0.4); }
      });
      if (this.podT > 2.3 && !this.cheered) { this.cheered = true; this.burst(O[0], O[1] + 7, O[2], ['#ff6b9a', '#5ce1e6', '#b8e65c', '#ffd56b', '#a78bfa'], 70, 7, 8, 1.8); if (won) sfx.win(); }
      if (won) for (let k = 0; k < 4; k++) if (this.podT > 2.4 + k * 0.55 && !(this.fwk > k)) {
        this.fwk = k + 1;
        this.burst(O[0] + (Math.random() - 0.5) * 12, O[1] + 10 + Math.random() * 4, O[2] + 2 + Math.random() * 4, [['#ffd56b', '#fff3a0'], ['#ff6b9a', '#ffd0de'], ['#5ce1e6', '#d5f8ff'], ['#b8e65c', '#f0ffd0']][k], 44, 9, 2, 1.4);
        sfx.tone(600 + k * 150, 0.2, 'sine', 0.04, 1600);
      }
      if (this.podT > 5.6) this.endRound();
    },
    endRound() {
      const me = this.me(), tot = (p) => p.card.reduce((s, v) => s + v, 0);
      const mine = tot(me), place = 1 + this.players.filter((p) => !p.you && tot(p) < mine).length;
      const par = this.holes.reduce((s, h) => s + h.par, 0), diff = mine - par;
      const best = this.players.filter((p) => !p.you).sort((a, b) => tot(a) - tot(b))[0];
      const nth = ['1st', '2nd', '3rd', '4th'][place - 1];
      const msg = 'You came ' + nth + ' of 4 with ' + mine + ' shots (' + (diff === 0 ? 'even par' : diff > 0 ? diff + ' over par' : -diff + ' under par') + ').' +
        (place === 1 ? '' : ' Best bot: ' + best.name + ' with ' + tot(best) + '.');
      this.phase = 'end'; this.cheered = false; this.fwk = 0;
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
      if (kind === 'cup') { // Close on the cup and the flag, for the celebration.
        const c = Hl.cup, sx = Math.sin(this.camA), sz = Math.cos(this.camA), t = [c[0], c[1] + 1, c[2]];
        const at = ([d, h]) => [c[0] - sx * d * 0.85, c[1] + R + h, c[2] - sz * d * 0.85];
        return { p: at(BEHIND.find((q) => clear(Hl, t, at(q))) || BEHIND[0]), l: [c[0], c[1] + 1, c[2]] };
      }
      const a = this.camA, sx = Math.sin(a), sz = Math.cos(a), t = [b.x, b.y + 0.6, b.z];
      const at = ([d, h]) => [b.x - sx * d, b.y + h, b.z - sz * d];
      // When no spot is clear (say, the ball is inside the windmill), stay at the usual spot: whatever is in the way fades out.
      const spot = BEHIND.find((c) => clear(Hl, t, at(c))) || BEHIND[0];
      return { p: at(spot), l: [b.x + sx * 7, b.y + 0.2, b.z + sz * 7] };
    },
    // The fly-over: k = 1 is above the cup, k = 0 above the tee. The camera flies high along the hole, looking ahead.
    flyPose(k) {
      const Hl = this.Hl, P = Hl.path || (Hl.path = pathOf(Hl.route)), d = k * P.len, p = pathAt(P, d - 14), l = pathAt(P, d + 4);
      const up = Hl.flyH || (Hl.flyH = Math.max(16, ...Hl.mills.map((m) => m.y + m.len + 8))); // Well clear of the windmill's sails.
      return { p: [p[0], p[1] + up, p[2]], l: [l[0], l[1] + 0.5, l[2]] };
    },
    camera(dt) {
      const me = this.me(), b = me.ball;
      // A ball that is falling off the course, or waiting to be put back, isn't followed: the camera holds still.
      const gone = me.wait > 0 || (b.air && (b.y - R < this.Hl.floor + 1.6 || !ground(this.Hl, b.x, b.z, 1e9, this.t)));
      if (!b.rest && !b.loop && !me.done && !gone) {
        // Turn slowly with a ball rolling away from the camera. A ball bouncing back toward it doesn't spin the camera round.
        const v = Math.hypot(b.vx, b.vz), d = wrapA(Math.atan2(b.vx, b.vz) - this.camA);
        if (v > 5 && Math.abs(d) < 1.4) this.camA += d * clamp(dt * 1.2, 0, 1);
      } else if (b.rest && !me.done) this.camA += wrapA(this.aim.a - this.camA) * clamp(dt * 6, 0, 1);
      if (gone && this.cam && this.phase === 'play' && !this.overview) return;
      let want;
      if (this.phase === 'intro') {
        const bh = this.pose('behind');
        if (calm()) { this.cam = bh; return; }
        const F = INTRO - 0.5, k = ease(clamp(this.introT / F, 0, 1)), fl = this.flyPose(1 - k), m = ease(clamp((this.introT - (F - 0.9)) / 1.2, 0, 1));
        this.cam = { p: fl.p.map((v, i) => lerp(v, bh.p[i], m)), l: fl.l.map((v, i) => lerp(v, bh.l[i], m)) };
        return;
      }
      const watch = me.done && !(this.celT > 0 && b.sunk);
      want = this.overview || watch || this.phase === 'card' ? this.pose('over') : this.pose(me.done ? 'cup' : 'behind');
      if (!this.cam) { this.cam = want; return; }
      const k = clamp(dt * (this.overview || watch ? 3 : 5), 0, 1);
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
      const Hl = this.Hl, pod = this.phase === 'podium' || (this.phase === 'end' && this.final);
      animateHole(Hl, this.t);
      const now = performance.now(), fdt = Math.min(0.1, (now - (G.last || now)) / 1000); G.last = now;
      // A phone that can't keep up gets fewer extras (see quality()). It is judged on 3 seconds of play, not a number of frames,
      // so a very slow phone gets the lighter picture after seconds instead of half a minute.
      if (fdt > 0) { G.watch += fdt; G.lag = G.lag * 0.97 + fdt * 0.03; if (G.watch > 3 && G.lag > 1 / 38 && G.q > 0) { quality(G.q - 1); G.watch = 0; G.lag = 1 / 60; } }
      if (pod) this.drawPodium(); else { G.group.visible = true; if (G.pod) G.pod.visible = false; this.drawBalls(fdt, now); }
      const cam = G.cam;
      cam.position.set(...this.cam.p); cam.lookAt(...this.cam.l);
      G.sky.position.copy(cam.position);
      const l = this.cam.l;
      G.sun.position.set(l[0] + 30, l[1] + 60, l[2] - 20); G.sun.target.position.set(l[0], l[1], l[2]); G.sun.target.updateMatrixWorld();
      const cw = Math.min(ctx.canvas.width, G.q ? 900 : 640), ch = Math.round(cw * H / W);
      if (G.cw !== cw) { G.cw = cw; G.r.setSize(cw, ch, false); }
      // Anything between the camera and your ball fades out.
      const want = new Map(), me = this.me().ball, tgt = [me.x, me.y + 0.6, me.z];
      for (const k of Hl.blockers) for (const m of k.mats || []) want.set(m, Math.min(want.has(m) ? want.get(m) : 1, !pod && !this.overview && !this.me().done && blocks(k, tgt, this.cam.p) ? 0.25 : 1));
      for (const [m, o] of want) {
        m.opacity += (o - m.opacity) * 0.25;
        const tr = m.opacity < 0.98;
        if (tr !== m.transparent) { m.transparent = tr; m.depthWrite = !tr; m.needsUpdate = true; if (!tr) m.opacity = 1; }
      }
      G.r.render(G.scene, cam);
      ctx.drawImage(G.r.domElement, 0, 0, W, H);
      this.hud();
    },
    // The balls, their shadows, the aim ring, the putters and the flag.
    drawBalls(fdt, now) {
      const cp = this.cam.p, Hl = this.Hl;
      // Where a soft shadow (or the aim ring) goes under a ball: on the ground and tilted with the slope.
      // Returns how high the ball is above the ground, or false if there is no ground under it.
      const under = (m, b) => {
        const s = ground(Hl, b.x, b.z, b.y - R + 0.02, this.t);
        if (!s) return false;
        const gy = GY; grad(s, b.x, b.z);
        m.position.set(b.x, gy + (s.mat === 'water' ? 0.28 : 0.03), b.z); m.quaternion.setFromUnitVectors(G.up, G.nrm.set(-GX, 1, -GZ).normalize());
        return Math.max(0, b.y - R - gy);
      };
      this.players.forEach((p, i) => {
        const B = G.balls[i], b = p.ball, g = B.g, f = b.fall;
        const vis = (!b.hidden || !!f) && !(p.done && p.sinkT === 0);
        g.visible = vis;
        if (f) g.position.set(f.x, f.y, f.z);
        else if (p.done && b.sunk) { const c = Hl.cup; g.position.set(c[0], c[1] + R - (1 - p.sinkT) * 1.2, c[2]); }
        else g.position.set(b.x, b.y, b.z);
        // A ball squashes a little when it lands, then springs back.
        B.sqT = (B.sqT || 0) + fdt;
        const k = calm() || !B.sqA ? 0 : B.sqA * Math.exp(-B.sqT * 7) * Math.cos(B.sqT * 24);
        g.scale.set(1 + 0.14 * k, 1 - 0.28 * k, 1 + 0.14 * k); g.position.y -= R * 0.28 * k;
        // The ball rolls as far as it moved this frame.
        if (!b.rest) { const v = Math.hypot(b.vx, b.vz); if (v > 0.1) B.m.rotateOnWorldAxis(G.axis.set(b.vz / v, 0, -b.vx / v), v * fdt * this.slow / R); }
        // A bot's ball right in front of the camera fades almost away, so it doesn't hide yours.
        if (i) B.m.material.opacity = 0.62 * clamp((Math.hypot(b.x - cp[0], b.y - cp[1], b.z - cp[2]) - 3) / 5, 0.12, 1);
        // The soft shadow fades and spreads the higher the ball is.
        const h = vis && !f && !b.loop && !(p.done && b.sunk) ? under(B.blob, b) : false;
        B.blob.visible = h !== false;
        if (h !== false) { B.blob.scale.setScalar(0.8 + h * 0.12); B.blob.material.opacity = (i ? 0.45 : 0.8) / (1 + h * 0.5); }
        // The putter: yours follows your aim and power; when anyone putts it swings through and fades away.
        const P = G.putters[i], c = p.club;
        let th = null, a = this.aim.a, op = 1, at = b;
        if (c) {
          a = c.a; at = c;
          const back = swingBack(c.pw), sw = this.t - c.swingAt;
          if (sw < 0) th = PUTT_REST + (back - PUTT_REST) * ease(clamp(1 + sw / 0.35, 0, 1));
          else { const u = clamp(sw / SWING, 0, 1); th = back + (PUTT_THRU - back) * u * u; op = clamp(1 - (sw - SWING - 0.12) / 0.3, 0, 1); }
          op = Math.min(op, clamp((this.t - c.t0) / 0.15, 0, 1));
        } else if (p.you && this.canPutt() && !this.overview) { P.th += (swingBack(this.aim.p) - P.th) * 0.35; th = P.th; }
        P.g.visible = th !== null && op > 0.01 && this.phase === 'play';
        if (!P.g.visible) return;
        if (c) P.th = th;
        P.g.position.set(at.x, at.y - R, at.z); P.g.rotation.y = a; P.piv.rotation.x = th;
        for (const m of P.mats) m.opacity = op * (i ? 0.55 : 1);
      });
      // The glowing ring under your ball while you aim, in the colour of the power.
      const ring = G.ring, mb = this.me().ball;
      ring.visible = this.canPutt() && !this.overview && under(ring, mb) !== false;
      if (ring.visible) {
        const p = this.aim.p; ring.material.color.set(p < 0.45 ? '#b8e65c' : p < 0.78 ? '#ffd56b' : '#ff6b9a');
        ring.scale.setScalar(calm() ? 1 : 1 + Math.sin(now / 170) * 0.07);
      }
      // The flag jumps and spins when your ball drops in.
      const fl = G.dyn.flag, fp = this.flagPop ? (now - this.flagPop) / 1000 : 9;
      if (fl) { const k = fp < 0.8 && !calm() ? fp / 0.8 : 0; fl.fg.position.y = Hl.cup[1] + Math.sin(k * Math.PI) * 1.6; fl.fg.rotation.y = k * TAU; }
    },
    // The podium: the balls drop onto their steps one by one, and the camera slowly swings round.
    drawPodium() {
      if (!G.pod) buildPodium();
      G.pod.visible = true; G.group.visible = false; G.ring.visible = false;
      const O = POD.o;
      G.putters.forEach((P) => { P.g.visible = false; });
      this.final.forEach((f, r) => {
        const i = this.players.indexOf(f.p), B = G.balls[i], k = calm() ? 9 : this.podT - POD.at[r];
        B.g.visible = k > 0; B.blob.visible = k > 0;
        B.g.scale.set(1, 1, 1);
        B.g.position.set(O[0] + POD.steps[r][0], O[1] + POD.steps[r][1] + R + dropH(k), O[2] + POD.steps[r][2]);
        B.blob.position.set(O[0] + POD.steps[r][0], O[1] + POD.steps[r][1] + 0.03, O[2] + POD.steps[r][2]); B.blob.quaternion.identity(); B.blob.scale.setScalar(1); B.blob.material.opacity = 0.7 / (1 + dropH(k) * 0.4);
        if (i) B.m.material.opacity = 0.75;
      });
      const o = calm() ? 0 : Math.sin(this.podT * 0.4) * 0.3;
      this.cam = { p: [O[0] + Math.sin(o) * 20, O[1] + 6.5, O[2] - Math.cos(o) * 20], l: [O[0], O[1] + 1.8, O[2] - 0.8] };
    },
    // Where a 3D point lands on the screen, or null if it is behind the camera.
    screen(x, y, z) {
      const v = G.v.set(x, y, z).project(G.cam);
      if (v.z > 1) return null;
      return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H };
    },
    hud() {
      const Hl = this.Hl, me = this.me(), b = me.ball, cp = this.cam.p;
      ctx.save();
      ctx.textBaseline = 'middle';
      // Sparks, splashes and confetti: bigger when close. Ice sparkles twinkle as little stars.
      for (const f of this.fx) {
        const s = this.screen(f.x, f.y, f.z); if (!s) continue;
        const z = clamp(34 / Math.max(1, Math.hypot(f.x - cp[0], f.y - cp[1], f.z - cp[2])), 1.5, 6);
        ctx.globalAlpha = clamp(f.life * 2, 0, 1); ctx.fillStyle = f.col;
        if (f.star) { const k = z * (0.6 + 0.4 * Math.sin(f.life * 20)); ctx.fillRect(s.x - k, s.y - 0.6, k * 2, 1.2); ctx.fillRect(s.x - 0.6, s.y - k, 1.2, k * 2); }
        else ctx.fillRect(s.x - z / 2, s.y - z / 2, z, z);
      }
      // Rings on the water and round the cup.
      ctx.lineCap = 'round';
      for (const r of this.rings) {
        if (r.t < 0) continue;
        const k = r.t / 0.8, rad = r.r * (0.25 + k);
        ctx.strokeStyle = r.col; ctx.globalAlpha = (1 - k) * 0.9; ctx.lineWidth = 3.5 * (1 - k) + 1;
        ctx.beginPath(); let ok = true;
        for (let i = 0; i <= 24 && ok; i++) { const a = i / 24 * TAU, s = this.screen(r.x + Math.cos(a) * rad, r.y, r.z + Math.sin(a) * rad); if (!s) ok = false; else if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }
        if (ok) ctx.stroke();
      }
      // Trails behind fast balls, in the colour of the putt.
      for (const p of this.players) {
        const tr = p.trail; if (tr.length < 2) continue;
        let prev = null;
        ctx.strokeStyle = p.col || p.color;
        for (let i = 0; i < tr.length; i++) {
          const s = this.screen(tr[i].x, tr[i].y, tr[i].z);
          if (s && prev) { ctx.globalAlpha = clamp(tr[i].life * 3, 0, 1) * (p.you ? 0.85 : 0.45); ctx.lineWidth = (p.you ? 6 : 3.5) * (i / tr.length); ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(s.x, s.y); ctx.stroke(); }
          prev = s;
        }
      }
      ctx.globalAlpha = 1;
      if (XMAS) this.snow();
      if ((this.phase === 'podium' || this.phase === 'end') && this.final) { this.podiumHud(); ctx.restore(); return; }
      // The aim line: dots to the first bounce, then a short line the way it bounces off.
      if (this.canPutt() && !this.overview) {
        const { a, p } = this.aim, col = p < 0.45 ? '#b8e65c' : p < 0.78 ? '#ffd56b' : '#ff6b9a';
        const key = [a.toFixed(3), p.toFixed(3), b.x.toFixed(2), b.z.toFixed(2), Math.floor(this.t * 5)].join();
        if (!this.preview || this.preview.key !== key) this.preview = Object.assign(previewPath(Hl, b, this.t, a, p), { key });
        const pv = this.preview, n = pv.pts.length;
        ctx.fillStyle = col; ctx.strokeStyle = 'rgba(8,10,20,.55)'; ctx.lineWidth = 1.5;
        pv.pts.forEach((q, i) => {
          const s = this.screen(q[0], q[1] - R + 0.1, q[2]); if (!s) return;
          const z = clamp(40 / Math.max(1, Math.hypot(q[0] - cp[0], q[1] - cp[1], q[2] - cp[2])), 1.5, 4.5);
          ctx.globalAlpha = pv.hit ? 0.95 : 1 - i / (n + 4); ctx.beginPath(); ctx.arc(s.x, s.y, z, 0, TAU); ctx.fill(); ctx.stroke();
        });
        if (pv.hit) {
          const [hx, hy, hz, vx, vz] = pv.hit, v = Math.hypot(vx, vz) || 1, s = this.screen(hx, hy - R + 0.1, hz), e = this.screen(hx + vx / v * 2.6, hy - R + 0.1, hz + vz / v * 2.6);
          if (s) { ctx.globalAlpha = 0.9; ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, TAU); ctx.stroke(); }
          if (s && e) { ctx.globalAlpha = 0.55; ctx.setLineDash([3, 5]); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke(); ctx.setLineDash([]); }
        }
        ctx.globalAlpha = 1;
        // The power ring round the ball. It shakes at full power.
        const s = this.screen(b.x, b.y, b.z);
        if (s && (this.drag && this.drag.aiming || this.keys.ArrowUp || this.keys.ArrowDown || this.keys.KeyW || this.keys.KeyS)) {
          const j = p > 0.97 && !calm() ? 1.6 : 0, x = s.x + (Math.random() - 0.5) * j * 2, y = s.y + (Math.random() - 0.5) * j * 2;
          ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(x, y, 24, 0, TAU); ctx.stroke();
          ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(x, y, 24, -Math.PI / 2, -Math.PI / 2 + TAU * p); ctx.stroke();
          if (p > 0.97) { ctx.globalAlpha = 0.5 + 0.5 * Math.sin(performance.now() / 60); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 30, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
        }
        // Dragging up toward the hole does nothing, so say which way to pull.
        if (s && this.drag && this.drag.up) {
          ctx.textAlign = 'center'; ctx.font = font(9); ctx.lineWidth = 4; ctx.strokeStyle = '#0d0a15'; ctx.fillStyle = '#ffd56b';
          ctx.strokeText('PULL BACK', s.x, s.y + 46); ctx.fillText('PULL BACK', s.x, s.y + 46);
          ctx.beginPath(); ctx.moveTo(s.x - 9, s.y + 58); ctx.lineTo(s.x + 9, s.y + 58); ctx.lineTo(s.x, s.y + 70); ctx.closePath(); ctx.fill();
        }
      }
      // Name tags over the balls. Tags that would cover each other move up, and a bot's tag hides when its ball is at the camera.
      ctx.textAlign = 'center'; ctx.font = font(7);
      const tags = [];
      this.players.forEach((p) => {
        const b2 = p.ball;
        if (b2.hidden || (p.done && p.sinkT === 0)) return;
        if (!p.you && Math.hypot(b2.x - cp[0], b2.y - cp[1], b2.z - cp[2]) < 6) return;
        const s = this.screen(b2.x, b2.y + 1.1, b2.z);
        if (!s) return;
        const w = ctx.measureText(p.name).width + 8;
        let y = s.y;
        for (let k = 0; k < 4; k++) { const hit = tags.find((t) => Math.abs(t.x - s.x) < (t.w + w) / 2 && Math.abs(t.y - y) < 14); if (!hit) break; y = hit.y - 14; }
        tags.push({ x: s.x, y, w });
        ctx.fillStyle = 'rgba(8,10,20,.6)'; ctx.fillRect(s.x - w / 2, y - 7, w, 13);
        ctx.fillStyle = p.color; ctx.fillText(p.name, s.x, y);
      });
      for (const pp of this.pops) {
        const s = this.screen(pp.x, pp.y, pp.z); if (!s) continue;
        ctx.globalAlpha = clamp(pp.life * 1.5, 0, 1); ctx.font = font(pp.size); ctx.lineWidth = 4; ctx.strokeStyle = '#0d0a15';
        ctx.strokeText(pp.text, s.x, s.y); ctx.fillStyle = pp.col; ctx.fillText(pp.text, s.x, s.y);
      }
      ctx.globalAlpha = 1;
      this.chatHud();
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
      if (this.phase === 'intro') this.introHud();
      else if (this.phase === 'play') {
        ctx.font = font(8); ctx.fillStyle = 'rgba(244,236,220,.9)';
        if (!this.seen && this.n === 0 && this.canPutt()) ctx.fillText('PULL BACK AND LET GO', W / 2, H - 70);
        if (me.done && !this.players.every((p) => p.done)) ctx.fillText(this.fast ? 'FAST FORWARD...' : 'WAITING FOR THE BOTS · TAP TO SPEED UP', W / 2, H - 70);
      } else if (this.phase === 'card') this.scorecard();
      this.bannerHud();
      ctx.restore();
    },
    // The hole's name slides in from the left during the fly-over, then out to the right.
    introHud() {
      const Hl = this.Hl, end = calm() ? 1.6 : INTRO, t = this.introT;
      const dx = calm() ? 0 : (1 - easeBack(clamp(t / 0.5, 0, 1))) * -W + easeIn(clamp((t - (end - 0.45)) / 0.45, 0, 1)) * W;
      ctx.globalAlpha = calm() ? clamp(Math.min(t * 3, (end - t) * 3), 0, 1) : 1;
      ctx.save(); ctx.translate(dx, 0);
      const y = 150;
      ctx.fillStyle = 'rgba(6,10,24,.66)'; ctx.fillRect(0, y - 40, W, 80);
      ctx.fillStyle = '#ffd56b'; ctx.fillRect(0, y - 40, W, 3); ctx.fillRect(0, y + 37, W, 3);
      ctx.font = font(16); ctx.fillStyle = '#ffd56b'; ctx.fillText('HOLE ' + (this.n + 1), W / 2, y - 14);
      ctx.font = font(9); ctx.fillStyle = C.ink; ctx.fillText(Hl.name.toUpperCase() + ' · PAR ' + Hl.par + (Hl.wind ? ' · WINDY' : ''), W / 2, y + 14);
      ctx.restore();
      ctx.globalAlpha = 0.7; ctx.font = font(7); ctx.fillStyle = C.ink; ctx.fillText('TAP TO SKIP', W / 2, H - 70);
      ctx.globalAlpha = 1;
    },
    // Speech bubbles over the bots.
    chatHud() {
      ctx.font = font(7); ctx.textAlign = 'center';
      for (const q of this.bubbles) {
        const b = q.p.ball, live = !b.hidden && !b.sunk, s = this.screen(live ? b.x : q.x, (live ? b.y : q.y) + 1.1, live ? b.z : q.z);
        if (!s) continue;
        const k = calm() ? 1 : easeBack(clamp(q.t / 0.25, 0, 1)), w = Math.max(ctx.measureText(q.text).width, q.word ? ctx.measureText(q.word).width : 0) + 14, h = q.word ? 30 : 19;
        ctx.save(); ctx.globalAlpha = clamp((2.4 - q.t) / 0.3, 0, 1); ctx.translate(s.x, s.y - 12); ctx.scale(k, k);
        roundRect(-w / 2, -h - 6, w, h, 6); ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill(); ctx.strokeStyle = q.p.color; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-5, -7); ctx.lineTo(0, 0); ctx.lineTo(5, -7); ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill();
        if (q.word) { ctx.fillStyle = '#7a5a10'; ctx.fillText(q.word, 0, -h + 5); }
        ctx.fillStyle = '#1b1b24'; ctx.fillText(q.text, 0, -12);
        ctx.restore();
      }
    },
    // A big golden banner for a hole in one (and an eagle or better).
    bannerHud() {
      const bn = this.banner;
      if (!bn) return;
      const t = (performance.now() - bn.t) / 1000;
      if (t > 2.6) { this.banner = null; return; }
      const k = calm() ? 1 : easeBack(clamp(t / 0.4, 0, 1));
      ctx.save(); ctx.globalAlpha = clamp((2.6 - t) / 0.4, 0, 1); ctx.translate(W / 2, H * 0.36);
      if (!calm()) { ctx.save(); ctx.rotate(t * 0.8); ctx.fillStyle = 'rgba(255,213,107,.16)'; for (let i = 0; i < 12; i++) { ctx.rotate(TAU / 12); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-20, -240); ctx.lineTo(20, -240); ctx.fill(); } ctx.restore(); }
      ctx.scale(k, k);
      roundRect(-160, -34, 320, 68, 12); ctx.fillStyle = 'rgba(40,22,0,.82)'; ctx.fill(); ctx.strokeStyle = '#ffd56b'; ctx.lineWidth = 3; ctx.stroke();
      const gr = ctx.createLinearGradient(0, -14, 0, 14); gr.addColorStop(0, '#fff6c8'); gr.addColorStop(0.5, '#ffd56b'); gr.addColorStop(1, '#e0962a');
      ctx.font = font(18); ctx.textAlign = 'center'; ctx.lineWidth = 6; ctx.strokeStyle = '#3a1f00'; ctx.strokeText(bn.text, 0, 2); ctx.fillStyle = gr; ctx.fillText(bn.text, 0, 2);
      // A shine sweeps across.
      const sx = -220 + ((t * 300) % 520);
      ctx.save(); roundRect(-160, -34, 320, 68, 12); ctx.clip(); ctx.globalAlpha *= 0.35; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(sx, -34); ctx.lineTo(sx + 26, -34); ctx.lineTo(sx + 6, 34); ctx.lineTo(sx - 20, 34); ctx.fill(); ctx.restore();
      ctx.restore();
    },
    podiumHud() {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(6,10,24,.72)'; ctx.fillRect(0, 0, W, 34);
      ctx.font = font(10); ctx.fillStyle = '#ffd56b'; ctx.fillText('FINAL STANDINGS', W / 2, 17);
      const O = POD.o;
      this.final.forEach((f, r) => {
        if (this.podT < POD.at[r] + 0.7 && !calm()) return;
        const s = this.screen(O[0] + POD.steps[r][0], O[1] + POD.steps[r][1] + (r === 3 ? -1.1 : 1.6), O[2] + POD.steps[r][2]); // 4th place's tag sits under the ball. if (!s) return;
        ctx.font = font(8); const w = Math.max(ctx.measureText(f.p.name).width, 60) + 12;
        ctx.fillStyle = 'rgba(8,10,20,.7)'; ctx.fillRect(s.x - w / 2, s.y - 30, w, 32);
        ctx.fillStyle = ['#ffd56b', '#dfe6ee', '#e0a060', '#9aa0b4'][r]; ctx.fillText(['1ST', '2ND', '3RD', '4TH'][r] + '  ' + f.tot, s.x, s.y - 20);
        ctx.fillStyle = f.p.color; ctx.fillText(f.p.name, s.x, s.y - 6);
      });
      if (this.podT > 1.9 || calm()) {
        const won = this.final[0].p.you, k = calm() ? 1 : easeBack(clamp((this.podT - 1.9) / 0.4, 0, 1));
        ctx.save(); ctx.translate(W / 2, H * 0.2); ctx.scale(k, k);
        ctx.font = font(18); ctx.lineWidth = 6; ctx.strokeStyle = '#0d0a15'; const txt = won ? 'YOU WON!' : ['', '2ND PLACE', '3RD PLACE', '4TH PLACE'][this.final.findIndex((f) => f.p.you)];
        ctx.strokeText(txt, 0, 0); ctx.fillStyle = won ? '#ffd56b' : C.ink; ctx.fillText(txt, 0, 0);
        ctx.restore();
      }
      if (this.phase === 'podium' && this.podT > 2.2) { ctx.font = font(7); ctx.globalAlpha = 0.8; ctx.fillStyle = C.ink; ctx.fillText('TAP TO SEE YOUR SCORE', W / 2, H - 70); ctx.globalAlpha = 1; }
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
    // The scorecard after each hole: the box drops in, the rows slide in one by one, the totals count up and birdies glow.
    scorecard() {
      const Hl = this.Hl, el = 3.6 - this.cardT, x0 = 34, w = W - 68, still = calm();
      const tot = (p) => p.card.reduce((s, v) => s + (v || 0), 0), par = this.holes.slice(0, this.n + 1).reduce((s, h) => s + h.par, 0);
      const y0 = 150 + (still ? 0 : (1 - easeBack(clamp(el / 0.4, 0, 1))) * -60);
      ctx.globalAlpha = clamp(el * 4, 0, 1);
      ctx.fillStyle = 'rgba(6,10,24,.86)'; ctx.fillRect(x0, y0, w, 210);
      ctx.strokeStyle = '#ffd56b'; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, w, 210);
      ctx.textAlign = 'center'; ctx.font = font(11); ctx.fillStyle = '#ffd56b';
      ctx.fillText('HOLE ' + (this.n + 1) + ' DONE', W / 2, y0 + 26);
      ctx.font = font(7); ctx.fillStyle = C.muted;
      ctx.textAlign = 'left'; ctx.fillText('PLAYER', x0 + 16, y0 + 56);
      ctx.textAlign = 'right'; ctx.fillText('HOLE', x0 + w - 96, y0 + 56); ctx.fillText('TOTAL', x0 + w - 16, y0 + 56);
      const count = still ? 1 : ease(clamp((el - 0.7) / 0.7, 0, 1));
      this.players.slice().sort((p, q) => tot(p) - tot(q)).forEach((p, i) => {
        const k = still ? 1 : clamp((el - 0.25 - i * 0.12) / 0.3, 0, 1);
        if (k <= 0) return;
        const y = y0 + 84 + i * 28, s = p.card[this.n], d = s - Hl.par, now = tot(p), shown = Math.round(now - s + s * count), td = now - s - (par - Hl.par) + d * count;
        ctx.save(); ctx.globalAlpha *= k; ctx.translate((1 - ease(k)) * 60, 0);
        if (p.you) { ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(x0 + 8, y - 12, w - 16, 24); }
        ctx.font = font(8); ctx.textAlign = 'left'; ctx.fillStyle = p.color; ctx.fillText((i + 1) + '. ' + p.name, x0 + 16, y);
        ctx.textAlign = 'right'; ctx.fillStyle = d < 0 ? C.lime : d > 0 ? C.pink : C.ink;
        if (d < 0 && !still) { ctx.shadowColor = C.lime; ctx.shadowBlur = 8 + Math.sin(el * 8) * 5; }
        ctx.fillText(String(s), x0 + w - 96, y); ctx.shadowBlur = 0;
        const tdr = Math.round(td);
        ctx.fillStyle = C.ink; ctx.fillText(shown + ' (' + (tdr === 0 ? 'E' : tdr > 0 ? '+' + tdr : tdr) + ')', x0 + w - 16, y);
        ctx.restore();
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
  // The colours of the sky islands: by day, and for Christmas at dusk with snow.
  const LOOK = XMAS
    ? { zenith: '#0a1034', horizon: '#7d5b98', below: '#262d5c', fog: '#3d3a72', glow: ['#ff9c86', 0.08, 0.55, 300],
      land: '#eef3fc', lip: '#d5dff0', soil: '#6a5c6c', rock: ['#7a7690', '#3c3850'], stones: '#e9eef8', turf: ['#46a453', '#3d964a'],
      side: '#8a6446', rail: 'candy', railTop: '#ffffff', hemi: ['#cdd8ff', '#6a6595', 1.75], sun: ['#ffd8b8', 1.9], leaf: ['#2c7546', '#3b8a53'], lamp: '#ffc56a' }
    : { zenith: '#2c7ce0', horizon: '#c3e6ff', below: '#8fc4ef', fog: '#c8e7ff', glow: ['#fff0c0', 0.2, 0.9, 170],
      land: '#6cbd59', lip: '#529e47', soil: '#8b5d39', rock: ['#9c8b7d', '#5f4f45'], stones: '#a39488', turf: ['#48a654', '#3f994b'],
      side: '#9a6a40', rail: 'wood', railTop: '#ebc189', hemi: ['#e4f3ff', '#6e8b55', 1.75], sun: ['#ffe2b8', 2.6], leaf: ['#2e7849', '#3e8e56'], lamp: '#ffd98a' };
  function canvasTex(w, h, paint, rep = 1) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 4;
    return t;
  }
  // A soft round spot (for glows, shadows and the like), from a list of [distance from the middle, colour].
  function soft(stops) {
    const t = canvasTex(64, 64, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); for (const [k, c] of stops) r.addColorStop(k, c); g.fillStyle = r; g.fillRect(0, 0, w, w); });
    t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
    return t;
  }
  // A pseudo-random number from a seed, for scenery that looks the same every time.
  const seeded = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647);

  // The sky: a big ball round the camera, deep blue above, pale at the horizon and a sea of cloud below.
  function skyBall(rad) {
    const g = new T.SphereGeometry(rad, 32, 24), p = g.attributes.position, cols = [];
    const top = new T.Color(LOOK.zenith), mid = new T.Color(LOOK.horizon), low = new T.Color(LOOK.below), c = new T.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / rad;
      if (y >= 0) c.copy(mid).lerp(top, Math.pow(y, 0.55)); else c.copy(mid).lerp(low, Math.min(1, Math.pow(-y, 0.45) * 1.3));
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    const m = new T.Mesh(g, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false }));
    m.renderOrder = -5; m.frustumCulled = false;
    return m;
  }
  // Everything far away in the sky moves with the camera: the sky, the sun glow, and at Christmas the moon, stars and northern lights.
  function makeSky() {
    const sky = new T.Group(), keep = (o) => { o.renderOrder = -4; o.frustumCulled = false; sky.add(o); return o; };
    const dir = (az, el, d) => new T.Vector3(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    const sprite = (tex, col, op) => new T.Sprite(new T.SpriteMaterial({ map: tex, color: col, transparent: true, opacity: op, blending: T.AdditiveBlending, depthWrite: false, fog: false }));
    sky.add(skyBall(480));
    const glow = keep(sprite(soft([[0, 'rgba(255,255,255,1)'], [0.1, 'rgba(255,255,255,.8)'], [0.35, 'rgba(255,255,255,.2)'], [1, 'rgba(255,255,255,0)']]), LOOK.glow[0], LOOK.glow[2]));
    glow.position.copy(dir(-0.55, LOOK.glow[1], 440)); glow.scale.setScalar(LOOK.glow[3]);
    G.aurora = [];
    if (!XMAS) return sky;
    const moon = keep(sprite(soft([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,1)'], [0.24, 'rgba(255,255,255,.35)'], [0.5, 'rgba(255,255,255,.08)'], [1, 'rgba(255,255,255,0)']]), '#fff4dc', 1));
    moon.position.copy(dir(0.55, 0.42, 440)); moon.scale.setScalar(70);
    const rnd = seeded(21);
    for (const [n, size, op] of [[520, 1.4, 0.75], [160, 2.4, 0.95]]) {
      const pos = [];
      for (let i = 0; i < n; i++) pos.push(...dir(rnd() * TAU, 0.05 + Math.pow(rnd(), 0.8) * 1.45, 450).toArray());
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      keep(new T.Points(g, new T.PointsMaterial({ color: '#ffffff', size, sizeAttenuation: false, transparent: true, opacity: op, depthWrite: false, fog: false })));
    }
    // Northern lights: bands of light that hang low over the horizon and slowly wave.
    const tex = canvasTex(256, 64, (g, w, h) => {
      const r = seeded(4);
      for (let x = 0; x < w; x++) {
        const k = (0.3 + 0.7 * Math.abs(Math.sin(x * 0.07 + Math.sin(x * 0.023) * 3))) * (0.7 + r() * 0.3), gr = g.createLinearGradient(0, h, 0, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.08, 'rgba(255,255,255,' + k + ')'); gr.addColorStop(0.45, 'rgba(255,255,255,' + k * 0.4 + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(x, 0, 1, h);
      }
    });
    [['#4dffa8', -0.35, 0.16], ['#38d9ff', 0.3, 0.2], ['#c77dff', 0.95, 0.13]].forEach(([col, az, el], k) => {
      const n = 48, g = new T.BufferGeometry(), uv = [], idx = [];
      for (let i = 0; i <= n; i++) { uv.push(i / n, 0, i / n, 1); if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3); }
      g.setAttribute('position', new T.Float32BufferAttribute(new Float32Array((n + 1) * 6), 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      const m = keep(new T.Mesh(g, new T.MeshBasicMaterial({ map: tex, color: col, transparent: true, opacity: 0.6, blending: T.AdditiveBlending, side: T.DoubleSide, depthWrite: false, fog: false })));
      G.aurora.push({ m, n, az, el, k });
    });
    return sky;
  }
  function waveAurora(t) {
    for (const A of G.aurora) {
      const p = A.m.geometry.attributes.position, span = 1.1;
      for (let i = 0; i <= A.n; i++) {
        const u = i / A.n, az = A.az - span / 2 + span * u + Math.sin(u * 5 + t * 0.12 + A.k) * 0.05, d = 430 + Math.sin(u * 7 + t * 0.4 + A.k) * 28;
        const lo = A.el + Math.sin(u * 4 + t * 0.25 + A.k * 2) * 0.035, hi = lo + 0.24 * (0.75 + 0.25 * Math.sin(u * 9 + t * 0.5));
        const sx = Math.sin(az) * d, sz = Math.cos(az) * d;
        p.setXYZ(i * 2, sx * Math.cos(lo), Math.sin(lo) * d, sz * Math.cos(lo)); p.setXYZ(i * 2 + 1, sx * Math.cos(hi), Math.sin(hi) * d, sz * Math.cos(hi));
      }
      p.needsUpdate = true;
    }
  }

  function setup() {
    try { G = { r: new T.WebGLRenderer({ antialias: true }) }; } catch (e) { failed = true; G = null; return; }
    const r = G.r;
    r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap; r.setPixelRatio(1);
    G.q = 2; G.lag = 0; G.watch = 0; // Quality: 2 = everything, 1 = no far islands or clouds, 0 = no shadows either.
    G.scene = new T.Scene(); G.scene.fog = new T.Fog(LOOK.fog, 80, 300);
    G.cam = new T.PerspectiveCamera(55, W / H, 0.3, 900);
    G.scene.add(new T.HemisphereLight(LOOK.hemi[0], LOOK.hemi[1], LOOK.hemi[2]));
    const sun = G.sun = new T.DirectionalLight(LOOK.sun[0], LOOK.sun[1]);
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -44, right: 44, top: 44, bottom: -44, near: 1, far: 220 });
    G.scene.add(sun, sun.target);
    G.v = new T.Vector3(); G.axis = new T.Vector3(); G.up = new T.Vector3(0, 1, 0); G.nrm = new T.Vector3(); G.built = null;
    G.sky = makeSky(); G.scene.add(G.sky);
    // Shiny things (the balls, bumpers, chrome) reflect a soft copy of the sky with a bright sun in it.
    try {
      const pm = new T.PMREMGenerator(r), env = new T.Scene(), spot = new T.Mesh(new T.SphereGeometry(5, 12, 8), new T.MeshBasicMaterial({ color: new T.Color(6, 5.6, 5) }));
      spot.position.set(18, 36, -12); env.add(skyBall(60), spot);
      G.scene.environment = pm.fromScene(env, 0.03).texture; pm.dispose();
    } catch (e) {}
    const turf = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = LOOK.turf[0]; g.fillRect(0, 0, w, h); g.fillStyle = LOOK.turf[1]; g.fillRect(0, h / 2, w, h / 2);
      const r = seeded(9); for (let i = 0; i < 1400; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,160,.07)' : 'rgba(0,50,10,.09)'; g.fillRect(r() * w, r() * h, 1, 2 + r() * 2); }
    }, 1 / 6);
    const isle = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = LOOK.land; g.fillRect(0, 0, w, h);
      const r = seeded(13); for (let i = 0; i < 1800; i++) { g.fillStyle = XMAS ? (r() < 0.5 ? 'rgba(255,255,255,.6)' : 'rgba(140,160,215,.14)') : (r() < 0.5 ? 'rgba(255,255,150,.08)' : 'rgba(0,40,0,.12)'); g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
    }, 1 / 8);
    const sand = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#e8d49a'; g.fillRect(0, 0, w, h); const r = seeded(14); for (let i = 0; i < 900; i++) { g.fillStyle = r() < 0.5 ? '#d6bf82' : '#f6e6b8'; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); } }, 1 / 5);
    const ice = canvasTex(256, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#dcf3ff'); gr.addColorStop(0.5, '#eefaff'); gr.addColorStop(1, '#cdebff'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      const r = seeded(15); g.lineWidth = 1;
      for (let i = 0; i < 30; i++) { g.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,.95)' : 'rgba(150,200,235,.5)'; g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 60; y += (r() - 0.5) * 60; g.lineTo(x, y); } g.stroke(); }
    }, 1 / 12);
    const wood = canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = '#b57c46'; g.fillRect(0, 0, w, h); const r = seeded(16);
      for (let i = 0; i < 40; i++) { g.fillStyle = r() < 0.5 ? 'rgba(110,60,25,.25)' : 'rgba(255,220,170,.14)'; g.fillRect(0, r() * h, w, 1); }
      g.fillStyle = '#7f5129'; for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 2);
    }, 1 / 2);
    const plank = canvasTex(128, 32, (g, w, h) => {
      g.fillStyle = '#b4773f'; g.fillRect(0, 0, w, h); const r = seeded(17);
      for (let i = 0; i < 22; i++) { g.strokeStyle = r() < 0.5 ? 'rgba(95,50,20,.35)' : 'rgba(255,220,170,.2)'; g.beginPath(); const y = r() * h; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 6, w * 0.7, y + (r() - 0.5) * 6, w, y); g.stroke(); }
      g.fillStyle = 'rgba(70,35,12,.45)'; g.fillRect(0, h - 4, w, 4); g.fillRect(63, 0, 2, h); g.fillStyle = 'rgba(255,230,190,.3)'; g.fillRect(0, 0, w, 2);
    });
    const sideTex = canvasTex(64, 64, (g, w, h) => { g.fillStyle = LOOK.side; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(60,30,10,.35)'; for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 2); const r = seeded(18); for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(255,220,180,.1)'; g.fillRect(0, r() * h, w, 1); } }, 1 / 2);
    // The volcano path: dark rock (snowy at Christmas), and the cone with glowing cracks.
    const basalt = canvasTex(64, 64, (g, w, h) => { g.fillStyle = XMAS ? '#e4ecf8' : '#6a5a55'; g.fillRect(0, 0, w, h); g.fillStyle = XMAS ? '#c9d6ea' : '#574945'; for (let i = 0; i < 70; i++) g.fillRect((i * 37) % w, (i * 19) % h, 3, 2); g.fillStyle = XMAS ? '#ffffff' : '#7c6b64'; for (let i = 0; i < 40; i++) g.fillRect((i * 23) % w, (i * 41) % h, 2, 2); }, 1 / 4);
    const crack = (glow) => canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = glow ? '#000000' : XMAS ? '#dfe8f5' : '#4a3c3a'; g.fillRect(0, 0, w, h);
      if (!glow) { g.fillStyle = XMAS ? '#c4d2e6' : '#3a2f2e'; for (let i = 0; i < 90; i++) g.fillRect((i * 29) % w, (i * 13) % h, 4, 3); }
      g.strokeStyle = glow ? (XMAS ? '#ffd56b' : '#ff7a2a') : XMAS ? '#e9c25a' : '#c2461c'; g.lineWidth = 2;
      const r = seeded(5);
      for (let i = 0; i < 9; i++) { let x = r() * w, y = 0; g.beginPath(); g.moveTo(x, y); while (y < h) { x += (r() - 0.5) * 14; y += 6 + r() * 8; g.lineTo(x, y); } g.stroke(); }
    }, 1);
    // Bricks in a few shades, with light top edges.
    const brick = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#77727f'; g.fillRect(0, 0, w, h); const r = seeded(3);
      for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? -16 : 0; x < w; x += 32) {
        const k = 0.85 + r() * 0.3; g.fillStyle = 'rgb(' + (170 * k | 0) + ',' + (166 * k | 0) + ',' + (180 * k | 0) + ')'; g.fillRect(x + 1.5, y + 1.5, 29, 13);
        g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(x + 1.5, y + 1.5, 29, 2); g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x + 1.5, y + 12.5, 29, 2);
      }
    }, 1 / 3);
    G.water = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#2b83d3'; g.fillRect(0, 0, w, h); const r = seeded(6);
      for (let i = 0; i < 40; i++) { const x = r() * w, y = r() * h, rr = 6 + r() * 16, gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(110,200,255,.35)'); gr.addColorStop(1, 'rgba(110,200,255,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
    }, 1 / 8);
    G.glint = canvasTex(128, 128, (g, w, h) => { const r = seeded(8); g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.5; g.lineCap = 'round'; for (let i = 0; i < 26; i++) { const x = r() * w, y = r() * h, l = 6 + r() * 14; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - 2, x + l, y); g.stroke(); } }, 1 / 6);
    G.fall = canvasTex(32, 128, (g, w, h) => { g.fillStyle = 'rgba(190,230,255,.55)'; g.fillRect(0, 0, w, h); const r = seeded(12); for (let i = 0; i < 40; i++) { g.fillStyle = r() < 0.6 ? 'rgba(255,255,255,.8)' : 'rgba(120,190,240,.5)'; g.fillRect(r() * w, r() * h, 1 + r() * 2, 10 + r() * 30); } });
    G.fall.repeat.set(1, 1.5);
    const fade = canvasTex(4, 64, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#999999'); gr.addColorStop(1, '#000000'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    fade.wrapS = fade.wrapT = T.ClampToEdgeWrapping; fade.colorSpace = T.NoColorSpace;
    // A soft dark band along the bottom of the rails, so the course has darker edges.
    const ao = canvasTex(4, 32, (g, w, h) => { const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, 'rgba(0,0,0,.38)'); gr.addColorStop(0.5, 'rgba(0,0,0,.1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    ao.wrapS = ao.wrapT = T.ClampToEdgeWrapping;
    G.cloud = canvasTex(128, 64, (g, w, h) => { const r = seeded(31); for (let i = 0; i < 16; i++) { const x = 22 + r() * 84, y = 24 + r() * 18, rr = 10 + r() * 15, gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); } });
    G.cloud.wrapS = G.cloud.wrapT = T.ClampToEdgeWrapping;
    G.glowTex = soft([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.5)'], [1, 'rgba(255,255,255,0)']]);
    const candy = canvasTex(32, 32, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#e2384d'; for (let i = -2; i < 4; i++) { g.beginPath(); g.moveTo(i * 16, 0); g.lineTo(i * 16 + 8, 0); g.lineTo(i * 16 + 8 + 32, h); g.lineTo(i * 16 + 32, h); g.fill(); } }, 1);
    const stick = candy.clone(); stick.repeat.set(1, 7); stick.needsUpdate = true;
    const lam = (o) => new T.MeshLambertMaterial(o), std = (o) => new T.MeshStandardMaterial(o), basic = (o) => new T.MeshBasicMaterial(o);
    G.m = {
      grass: lam({ map: turf }), isle: lam({ map: isle }), basalt: lam({ map: basalt }), sand: lam({ map: sand }), wood: lam({ map: wood }), stone: lam({ map: brick }),
      ice: new T.MeshPhongMaterial({ map: ice, shininess: 80, specular: '#cfeaff' }),
      water: new T.MeshPhongMaterial({ map: G.water, transparent: true, opacity: 0.86, shininess: 90, specular: '#ffffff' }),
      glint: basic({ map: G.glint, transparent: true, opacity: 0.4, blending: T.AdditiveBlending, depthWrite: false }),
      fall: basic({ map: G.fall, alphaMap: fade, transparent: true, depthWrite: false, side: T.DoubleSide }),
      under: lam({ vertexColors: true, flatShading: true, side: T.DoubleSide }),
      side: lam({ map: sideTex }), ao: basic({ map: ao, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
      rail: LOOK.rail === 'candy' ? lam({ map: candy }) : lam({ map: plank }), railTop: lam({ color: LOOK.railTop }),
      mill: lam({ color: XMAS ? '#c9875a' : '#f2e6cf' }), roof: lam({ color: XMAS ? '#ffffff' : '#b24a3a' }), sail: lam({ color: '#f4ecdc', side: T.DoubleSide }),
      hedge: lam({ color: '#2f7a3f' }), castle: lam({ map: brick }), rock: lam({ color: '#6b5a52' }), lip: lam({ color: LOOK.rail === 'candy' ? '#e2384d' : '#a8763f' }),
      trunk: lam({ color: '#6b4a2b' }), leaf: lam({ color: LOOK.leaf[0], flatShading: true }), leaf2: lam({ color: LOOK.leaf[1], flatShading: true }),
      snow: lam({ color: '#ffffff' }), coal: lam({ color: '#1b1b24' }), carrot: lam({ color: '#ff8a2a' }), scarf: lam({ color: XMAS ? '#e2384d' : '#4fb8e8' }),
      bumper: std({ color: '#ff5b93', emissive: '#ff2a6a', emissiveIntensity: 0.3, roughness: 0.16, metalness: 0.05 }),
      chrome: std({ color: '#e9eef5', metalness: 1, roughness: 0.22 }),
      cap: std({ color: '#fff3a0', emissive: '#ffd56b', emissiveIntensity: 0.45, roughness: 0.3 }),
      bar: lam({ color: '#f4ecdc' }), stripe: std({ color: '#ff6b9a', emissive: '#ff2a6a', emissiveIntensity: 0.5, roughness: 0.3 }),
      puck: std({ color: '#1b1b24', roughness: 0.25, metalness: 0.3 }),
      loopRail: LOOK.rail === 'candy' ? lam({ map: candy }) : lam({ map: plank }), track: new T.MeshLambertMaterial({ color: XMAS ? '#e2384d' : '#5ce1e6', side: T.DoubleSide }),
      lava: basic({ color: XMAS ? '#ffd56b' : '#ff6a2a' }), cone: lam({ map: basalt }),
      crater: std({ map: crack(false), emissive: '#ffffff', emissiveMap: crack(true), emissiveIntensity: 0.9, roughness: 0.9 }),
      cup: basic({ color: '#05070a' }), cupRim: lam({ color: '#ffffff' }), pole: XMAS ? lam({ map: stick }) : lam({ color: '#f4ecdc' }), gold: std({ color: '#ffd56b', metalness: 0.8, roughness: 0.3 }),
      flag: new T.MeshLambertMaterial({ color: XMAS ? '#e2384d' : '#ff6b9a', side: T.DoubleSide }),
      bulbs: ['#ff5a5a', '#ffd56b', '#5ce1e6', '#b8e65c', '#ff9ae0'].map((c) => basic({ color: c })),
      white: lam({ color: '#ffffff' }), glowW: basic({ color: '#ffffff' }), lamp: basic({ color: LOOK.lamp }), iron: lam({ color: '#3b3542' }),
      stones: lam({ color: LOOK.stones, flatShading: true }), icicle: lam({ color: '#dff4ff' }), tuft: lam({ color: '#3f9a4c' }),
      lily: lam({ color: '#4f9c43', side: T.DoubleSide }), bloom: lam({ color: '#ff9ad5' }),
      cloud: new T.SpriteMaterial({ map: G.cloud, color: XMAS ? '#8c83c0' : '#ffffff', transparent: true, opacity: XMAS ? 0.55 : 0.92, depthWrite: false }),
    };
    G.geo = {
      bulb: new T.SphereGeometry(0.12, 6, 4), trunk: new T.CylinderGeometry(0.3, 0.35, 1.2, 6), cone: new T.ConeGeometry(1.7, 3.2, 8), top: new T.ConeGeometry(1.2, 2.6, 8),
      cap: new T.ConeGeometry(0.75, 1.3, 8), gift: new T.BoxGeometry(1, 1, 1), flower: new T.IcosahedronGeometry(0.15, 0), tuft: new T.ConeGeometry(0.1, 0.5, 3),
      stone: new T.DodecahedronGeometry(0.6, 0), merlon: new T.BoxGeometry(0.7, 0.8, 0.7), pool: new T.CircleGeometry(1.3, 16).rotateX(-Math.PI / 2),
      blob: new T.PlaneGeometry(1.9, 1.9).rotateX(-Math.PI / 2),
    };
    Object.values(G.geo).forEach((g) => { g.keep = true; });
    // The balls: yours is a dimpled golf ball, the bots' are glassy marbles in their colours. Each has a soft shadow under it.
    const ballGeo = new T.SphereGeometry(R, 32, 20);
    const skin = canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#ff5a8a'; g.fillRect(0, h / 2 - 4, w, 8); });
    const dimp = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      for (let y = 4, row = 0; y < h; y += 8, row++) for (let x = (row % 2) * 4; x < w + 4; x += 8) { const gr = g.createRadialGradient(x, y, 0, x, y, 3.6); gr.addColorStop(0, '#7a7a7a'); gr.addColorStop(1, '#ffffff'); g.fillStyle = gr; g.fillRect(x - 4, y - 4, 8, 8); }
    });
    dimp.colorSpace = T.NoColorSpace;
    const shade = soft([[0, 'rgba(0,0,0,.6)'], [0.5, 'rgba(0,0,0,.28)'], [1, 'rgba(0,0,0,0)']]);
    G.balls = [std({ map: skin, bumpMap: dimp, bumpScale: 1.5, roughness: 0.32 })].concat(BOT_COLORS.map((c) => std({ color: c, roughness: 0.1, transparent: true, opacity: 0.62 })))
      .map((m, i) => {
        const g = new T.Group(), mesh = new T.Mesh(ballGeo, m); mesh.castShadow = i === 0; mesh.renderOrder = i ? 2 : 1; g.add(mesh);
        const blob = new T.Mesh(G.geo.blob, basic({ map: shade, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
        G.scene.add(g, blob);
        return { g, m: mesh, blob, sq: 0 };
      });
    // A glowing ring under your ball while you aim.
    G.ring = new T.Mesh(new T.RingGeometry(0.78, 0.98, 40).rotateX(-Math.PI / 2), basic({ color: '#b8e65c', transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    G.scene.add(G.ring);
    // The putters hang from a point 3 above the ground. Yours is chrome with a black grip; the bots' are see-through in their colours.
    const L = Math.hypot(2.84, 0.62);
    G.putters = [0, 1, 2, 3].map((i) => {
      const mat = i ? std({ color: BOT_COLORS[i - 1], roughness: 0.3, transparent: true, opacity: 0.55, depthWrite: false }) : std({ color: '#dfe5ec', metalness: 0.7, roughness: 0.3, transparent: true });
      const grip = i ? mat : std({ color: '#26232e', roughness: 0.7, transparent: true }), blade = i ? mat : std({ color: '#3a3f4c', metalness: 0.6, roughness: 0.35, transparent: true });
      const g = new T.Group(), piv = new T.Group(); piv.position.y = 3; g.add(piv);
      const shaft = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, L, 6), mat); shaft.position.y = -L / 2;
      const handle = new T.Mesh(new T.CylinderGeometry(0.09, 0.075, 0.8, 8), grip); handle.position.y = -0.35;
      const head = new T.Mesh(new T.BoxGeometry(0.95, 0.3, 0.28), blade); head.position.y = -L;
      for (const m of [shaft, handle, head]) { m.castShadow = !i; piv.add(m); }
      g.visible = false; G.scene.add(g);
      return { g, piv, mats: i ? [mat] : [mat, grip, blade], th: PUTT_REST };
    });
  }
  // The podium at the end of the round: three steps on a little island of its own, far away from the holes.
  function buildPodium() {
    const g = G.pod = new T.Group(), M = G.m, rnd = seeded(77), O = POD.o, add = (m, s = true, r = true) => { m.castShadow = s; m.receiveShadow = r; g.add(m); return m; };
    g.position.set(O[0], O[1], O[2]);
    const out = outline(0, 2, 13, 9, 40, rnd, 0.1), [top, rock] = island(out, 0, 11, rnd);
    add(top, false, true); add(rock, false, false);
    const side = new T.MeshLambertMaterial({ color: '#f4f1ea' });
    POD.steps.slice(0, 3).forEach(([x, h], i) => {
      const col = ['#e0a92a', '#a7b0c0', '#c27a3c'][i];
      const num = canvasTex(64, 64, (c, w) => { c.fillStyle = '#f4f1ea'; c.fillRect(0, 0, w, w); c.fillStyle = col; c.font = 'bold 40px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), w / 2, w / 2 + 2); });
      const box = add(new T.Mesh(new T.BoxGeometry(3.2, h - 0.12, 3.2), [side, side, side, side, side, new T.MeshLambertMaterial({ map: num })])); box.position.set(x, (h - 0.12) / 2, 0);
      const plate = add(new T.Mesh(new T.BoxGeometry(3.3, 0.12, 3.3), new T.MeshStandardMaterial({ color: col, metalness: 0.7, roughness: 0.3 }))); plate.position.set(x, h - 0.06, 0);
    });
    // A red carpet up to the top step.
    const carpet = add(new T.Mesh(new T.BoxGeometry(2.2, 0.05, 5.6), new T.MeshLambertMaterial({ color: XMAS ? '#c8283c' : '#d33a4a' })), false, true); carpet.position.set(0, 0.025, -4.4);
    const trees = [];
    for (let i = 0; i < 10; i++) { const x = -11 + i * 2.4 + (rnd() - 0.5), z = 4.5 + rnd() * 4; if (inPoly(out, x, z)) trees.push([x, z, 0.7 + rnd() * 0.5, rnd() * TAU]); }
    many(g, G.geo.trunk, M.trunk, trees, ([x, z, k, r]) => [x, 0.6 * k, z, k, r]);
    many(g, G.geo.cone, M.leaf, trees, ([x, z, k, r]) => [x, 2.3 * k, z, k, r]);
    many(g, G.geo.top, M.leaf2, trees, ([x, z, k, r]) => [x, 3.9 * k, z, k, r]);
    if (XMAS) many(g, G.geo.cap, M.snow, trees, ([x, z, k, r]) => [x, 4.75 * k, z, k, r], null, false);
    for (let i = 0; i < 8; i++) { const s = new T.Sprite(M.cloud), a = rnd() * TAU, d = 20 + rnd() * 60, k = 30 + rnd() * 30; s.position.set(Math.sin(a) * d, -14 - rnd() * 20, Math.cos(a) * d); s.scale.set(k, k / 2, 1); g.add(s); }
    G.scene.add(g);
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
  // Many small pieces in one mesh, so a phone draws them in one go. Each item is [geometry, matrix or null].
  function merge(items) {
    const pos = [], nor = [], uv = [];
    for (const [g0, mx] of items) {
      const g = g0.index ? g0.toNonIndexed() : g0.clone();
      if (mx) g.applyMatrix4(mx);
      if (!g.attributes.normal) g.computeVertexNormals();
      const P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv ? g.attributes.uv.array : null;
      for (let i = 0; i < P.length; i++) { pos.push(P[i]); nor.push(N[i]); }
      for (let i = 0; i < P.length / 3; i++) { uv.push(U ? U[i * 2] : 0, U ? U[i * 2 + 1] : 0); }
      g.dispose();
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); out.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    return out;
  }
  const MX = () => new T.Matrix4();
  // A rough rounded outline round a middle point, as [x, z] points going round.
  function outline(cx, cz, hx, hz, n, rnd, bump) {
    const p = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, c = Math.cos(a), s = Math.sin(a);
      const r = Math.pow(Math.pow(Math.abs(c) / hx, 4) + Math.pow(Math.abs(s) / hz, 4), -0.25) * (1 + (rnd() - 0.5) * bump);
      p.push([cx + c * r, cz + s * r]);
    }
    return p.map((q, i) => { const a = p[(i + n - 1) % n], b = p[(i + 1) % n]; return [(a[0] + q[0] * 2 + b[0]) / 4, (a[1] + q[1] * 2 + b[1]) / 4]; });
  }
  // A floating island: grass on top and rock underneath that narrows to a point. Returns [top, rock].
  function island(out, y, deep, rnd) {
    const n = out.length, rings = [[1, 0, LOOK.land], [1.01, -0.5, LOOK.lip], [0.97, -1.4, LOOK.soil]];
    for (let k = 1; k <= 6; k++) { const f = k / 6; rings.push([0.93 * Math.pow(1 - f, 1.2) + 0.05, -1.4 - deep * Math.pow(f, 0.85), f < 0.5 ? LOOK.rock[0] : LOOK.rock[1]]); }
    let cx = 0, cz = 0; for (const [x, z] of out) { cx += x / n; cz += z / n; }
    const pos = [], col = [], idx = [], c = new T.Color();
    rings.forEach(([s, dy, hex], j) => {
      c.set(hex);
      for (let i = 0; i < n; i++) {
        const [x, z] = out[i], wob = j > 2 ? 1 + (rnd() - 0.5) * 0.22 : 1, k = j > 2 ? 0.82 + rnd() * 0.36 : 1;
        pos.push(cx + (x - cx) * s * wob, y + dy + (j > 2 ? (rnd() - 0.5) * deep * 0.08 : 0), cz + (z - cz) * s * wob);
        col.push(c.r * k, c.g * k, c.b * k);
      }
    });
    for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < n; i++) { const a = j * n + i, b = j * n + (i + 1) % n; idx.push(a, a + n, b, b, a + n, b + n); }
    const tip = pos.length / 3, last = (rings.length - 1) * n; pos.push(cx, y - 1.4 - deep * 1.1, cz); c.set(LOOK.rock[1]); col.push(c.r, c.g, c.b);
    for (let i = 0; i < n; i++) idx.push(last + i, tip, last + (i + 1) % n);
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const top = new T.Mesh(new T.ShapeGeometry(new T.Shape(out.map(([x, z]) => new T.Vector2(x, -z)))), G.m.isle);
    top.rotation.x = -Math.PI / 2; top.position.y = y;
    return [top, new T.Mesh(g, G.m.under)];
  }
  // Things that stand on the ground many times over (trees, flowers), drawn in one go. at(i) gives [x, y, z, scale, turn].
  function many(grp, geo, mat, list, at, cols, shadow = true) {
    if (!list.length) return null;
    const im = new T.InstancedMesh(geo, mat, list.length), mx = MX(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(), c = new T.Color();
    list.forEach((it, i) => { const [x, y, z, k, r, sy = k] = at(it, i); im.setMatrixAt(i, mx.compose(p.set(x, y, z), q.setFromAxisAngle(G.up, r), s.set(k, sy, k))); if (cols) im.setColorAt(i, c.set(cols(it, i))); });
    im.castShadow = shadow; im.receiveShadow = false; grp.add(im);
    return im;
  }

  function buildHole(Hl) {
    if (G.group) { G.scene.remove(G.group); G.group.traverse((o) => { if (o.isSprite) return; if (o.isInstancedMesh) o.dispose(); if (o.geometry && !o.geometry.keep) o.geometry.dispose(); }); }
    const grp = G.group = new T.Group(), M = G.m, add = (m, shadow = true, recv = true) => { m.castShadow = shadow; m.receiveShadow = recv; grp.add(m); return m; };
    const glow = (x, y, z, size, col, op) => { const s = new T.Sprite(new T.SpriteMaterial({ map: G.glowTex, color: col, transparent: true, opacity: op, blending: T.AdditiveBlending, depthWrite: false })); s.position.set(x, y, z); s.scale.setScalar(size); grp.add(s); return s; };
    G.built = Hl; G.watch = 0; G.dyn = { spinners: [], pucks: [], sails: [], bridges: [], bumpers: [], smoke: [], bubbles: [], clouds: [], far: [], lamps: [], pads: [], falls: [] };
    const base = Hl.floor + 0.8;
    // Surfaces.
    for (const s of Hl.surfaces) {
      const top = s.mat === 'water' ? M.water : (M[s.mat] || M.grass);
      if (s.kind === 'flat') {
        if (s.mat === 'water') {
          const w = s.bb[2] - s.bb[0], d = s.bb[3] - s.bb[1], mx = (s.bb[0] + s.bb[2]) / 2, mz = (s.bb[1] + s.bb[3]) / 2;
          const m = add(new T.Mesh(new T.PlaneGeometry(w, d), M.water), false, true); m.rotation.x = -Math.PI / 2; m.position.set(mx, s.y + 0.25, mz);
          const gl = add(new T.Mesh(new T.PlaneGeometry(w, d), M.glint), false, false); gl.rotation.x = -Math.PI / 2; gl.position.set(mx, s.y + 0.27, mz);
          const bed = add(new T.Mesh(new T.PlaneGeometry(w, d), M.rock), false, true); bed.rotation.x = -Math.PI / 2; bed.position.set(mx, base + 0.02, mz);
          continue;
        }
        const shape = new T.Shape(s.pts.map(([x, z]) => new T.Vector2(x, -z)));
        const depth = s.bridge ? 0.5 : Math.max(0.4, s.y - base + 0.05);
        const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
        const m = new T.Mesh(g, [top, M.side]); m.rotation.x = -Math.PI / 2; m.position.y = s.y - depth;
        if (s.bridge) {
          const piv = new T.Group(); piv.position.set(0, 0, s.bridge.z1); m.position.z = -s.bridge.z1; piv.add(m); grp.add(piv);
          m.receiveShadow = true; m.castShadow = true; G.dyn.bridges.push({ piv, b: s.bridge, was: 0 });
        } else add(m, false, true);
      } else if (s.kind === 'ramp') {
        const fx = (u) => lerp(s.x0, s.x1, u), fz = (v) => lerp(s.z0, s.z1, v);
        add(new T.Mesh(grid(1, 1, (u, v) => [fx(u), heightOf(s, fx(u), fz(v)), fz(v)]), top), false, true);
        for (const [x0, z0, x1, z1] of [[s.x0, s.z0, s.x0, s.z1], [s.x1, s.z0, s.x1, s.z1], [s.x0, s.z1, s.x1, s.z1], [s.x0, s.z0, s.x1, s.z0]]) {
          add(new T.Mesh(grid(1, 1, (u, v) => { const x = lerp(x0, x1, u), z = lerp(z0, z1, u); return [x, lerp(base, heightOf(s, x, z), v), z]; }), M.side), false, true);
        }
      } else if (s.kind === 'spiral') {
        const P = (u, r) => { const a = s.a0 + (s.a1 - s.a0) * u, x = s.cx + Math.cos(a) * r, z = s.cz + Math.sin(a) * r; return [x, heightOf(s, x, z), z]; };
        add(new T.Mesh(grid(64, 3, (u, v) => P(u, lerp(s.r0, s.r1, v))), top), false, true);
        add(new T.Mesh(grid(64, 1, (u, v) => { const p = P(u, s.r1 + 0.02); return [p[0], lerp(base, p[1], v), p[2]]; }), M.cone), false, true);
      } else if (s.kind === 'bowl') {
        add(new T.Mesh(grid(40, 6, (u, v) => { const a = u * TAU, r = v * s.r; return [s.cx + Math.cos(a) * r, s.y + s.slope * r, s.cz + Math.sin(a) * r]; }), top), false, true);
      }
    }
    // Walls: all the pieces that look the same go into one mesh. Rails get a rounded top and a soft dark band along their foot.
    const parts = new Map(), tops = [], aos = [], ends = new Set(), Y = new T.Vector3(0, 1, 0), dv = new T.Vector3(), q = new T.Quaternion();
    const put = (mat, g) => { if (!parts.has(mat)) parts.set(mat, []); parts.get(mat).push([g, null]); };
    const rod = new T.CylinderGeometry(0.3, 0.3, 1, 10, 1, true), knob = new T.SphereGeometry(0.3, 10, 6);
    for (const w of Hl.walls) {
      if (w.look === 'none') continue;
      const lo = (k) => (w.look === 'rail' ? Math.max(k ? w.b1 : w.b0, (k ? w.t1 : w.t0) - 1.65) : k ? w.b1 : w.b0);
      const th = w.look === 'lip' ? 0.3 : w.look === 'cone' ? 1 : 0.42;
      put(w.look === 'rail' ? M.rail : M[w.look] || M.rail, prism(w, [lo(0), lo(1)], [w.t0, w.t1], th));
      if (w.look !== 'rail') continue;
      const a = new T.Vector3(w.ax, w.t0 + 0.02, w.az), b = new T.Vector3(w.bx, w.t1 + 0.02, w.bz), L = a.distanceTo(b);
      if (L < 0.01) continue;
      tops.push([rod, MX().compose(a.clone().add(b).multiplyScalar(0.5), q.setFromUnitVectors(Y, dv.subVectors(b, a).normalize()), new T.Vector3(1, L, 1))]);
      for (const e of [a, b]) { const key = e.toArray().map((v) => v.toFixed(1)).join(); if (!ends.has(key)) { ends.add(key); tops.push([knob, MX().makeTranslation(e.x, e.y, e.z)]); } }
      // The dark band, on each side that has ground right next to the rail.
      const dx = w.bx - w.ax, dz = w.bz - w.az, l = Math.hypot(dx, dz), nx = -dz / l, nz = dx / l;
      for (const sd of [1, -1]) {
        const ya = w.t0 - 1.1 + 0.03, yb = w.t1 - 1.1 + 0.03, mx = (w.ax + w.bx) / 2 + nx * sd * 0.7, mz = (w.az + w.bz) / 2 + nz * sd * 0.7;
        if (!ground(Hl, mx, mz, (ya + yb) / 2, 0) || Math.abs(GY - (ya + yb) / 2) > 0.2) continue;
        const i0 = 0.21 * sd, i1 = 1.1 * sd, g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute([w.ax + nx * i0, ya, w.az + nz * i0, w.bx + nx * i0, yb, w.bz + nz * i0, w.bx + nx * i1, yb, w.bz + nz * i1, w.ax + nx * i1, ya, w.az + nz * i1], 3));
        g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex(sd > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
        aos.push([g, null]);
      }
    }
    for (const [mat, list] of parts) add(new T.Mesh(merge(list), mat));
    if (tops.length) add(new T.Mesh(merge(tops), M.railTop));
    if (aos.length) add(new T.Mesh(merge(aos), M.ao), false, false);
    for (const b of Hl.boxes) {
      const m = add(new T.Mesh(new T.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0), M[b.look] || M.wood));
      m.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
      // Castle walls get battlements on top (with snow at Christmas).
      if (b.look === 'castle') for (let x = b.x0 + 0.35; x < b.x1 - 0.3; x += 1.1) for (const z of [b.z0 + 0.35, b.z1 - 0.35]) {
        const c = add(new T.Mesh(G.geo.merlon, M.castle)); c.position.set(x + 0.2, b.y1 + 0.4, z);
        if (XMAS) { const s = add(new T.Mesh(G.geo.merlon, M.snow), false); s.position.set(x + 0.2, b.y1 + 0.86, z); s.scale.set(1.05, 0.18, 1.05); }
      }
      if (XMAS && b.look === 'hedge') for (let x = b.x0 + 0.5; x < b.x1; x += 1.1) { const l = add(new T.Mesh(G.geo.bulb, M.bulbs[Math.floor(x * 7 + 70) % 5]), false, false); l.position.set(x, b.y1 + 0.05, b.z0 - 0.02); }
    }
    // Snowmen, with a scarf.
    for (const p of Hl.posts) {
      const s1 = add(new T.Mesh(new T.SphereGeometry(p.r, 16, 12), M.snow)); s1.position.set(p.x, p.y0 + p.r * 0.85, p.z);
      const s2 = add(new T.Mesh(new T.SphereGeometry(p.r * 0.72, 16, 12), M.snow)); s2.position.set(p.x, p.y0 + p.r * 2.1, p.z);
      const s3 = add(new T.Mesh(new T.SphereGeometry(p.r * 0.5, 14, 10), M.snow)); s3.position.set(p.x, p.y0 + p.r * 3, p.z);
      const sc = add(new T.Mesh(new T.TorusGeometry(p.r * 0.5, 0.13, 6, 18), M.scarf)); sc.rotation.x = Math.PI / 2; sc.position.set(p.x, p.y0 + p.r * 2.6, p.z);
      const nose = add(new T.Mesh(new T.ConeGeometry(0.12, 0.6, 8), M.carrot)); nose.rotation.x = -Math.PI / 2; nose.position.set(p.x, p.y0 + p.r * 3, p.z - p.r * 0.5 - 0.2);
      for (const dx of [-0.18, 0.18]) { const e = add(new T.Mesh(new T.SphereGeometry(0.08, 6, 4), M.coal), false); e.position.set(p.x + dx, p.y0 + p.r * 3.15, p.z - p.r * 0.45); }
      const hat = add(new T.Mesh(new T.CylinderGeometry(0.4, 0.4, 0.6, 12), XMAS ? M.bulbs[0] : M.coal)); hat.position.set(p.x, p.y0 + p.r * 3.55, p.z);
    }
    // Pinball bumpers: glossy, with a chrome ring and a glow that flares when hit.
    for (const p of Hl.bumpers) {
      const m = add(new T.Mesh(new T.CylinderGeometry(p.r, p.r, 1.2, 28), M.bumper.clone())); m.position.set(p.x, 0.6, p.z);
      const ring = add(new T.Mesh(new T.TorusGeometry(p.r + 0.02, 0.12, 8, 28), M.chrome)); ring.rotation.x = Math.PI / 2; ring.position.set(p.x, 0.25, p.z);
      const c = add(new T.Mesh(new T.CylinderGeometry(p.r * 0.7, p.r * 0.7, 0.14, 24), M.cap)); c.position.set(p.x, 1.25, p.z);
      G.dyn.bumpers.push({ m, p, g: glow(p.x, 1.3, p.z, p.r * 4, '#ff5b93', 0.2) });
    }
    for (const s of Hl.spinners) {
      const g = new T.Group(); g.position.set(s.x, s.y, s.z);
      const bar = new T.Mesh(new T.BoxGeometry(s.len * 2, 0.7, 0.32), M.bar); bar.position.y = 0.4; bar.castShadow = true; g.add(bar);
      const stripe = new T.Mesh(new T.BoxGeometry(s.len * 2 + 0.02, 0.2, 0.34), M.stripe); stripe.position.y = 0.45; g.add(stripe);
      const post = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 1.1, 12), M.cap); post.position.y = 0.4; g.add(post);
      grp.add(g); G.dyn.spinners.push({ g, s });
    }
    for (const p of Hl.pucks) { const m = add(new T.Mesh(new T.CylinderGeometry(p.r, p.r, 0.6, 24), M.puck)); m.position.y = 0.3; G.dyn.pucks.push({ m, p }); }
    for (const ml of Hl.mills) {
      const roof = add(new T.Mesh(new T.ConeGeometry(6.4, 4, 4), M.roof)); roof.rotation.y = Math.PI / 4; roof.position.set(ml.x, 8, 27);
      const top = add(new T.Mesh(new T.BoxGeometry(9.2, 0.6, 6), M.mill)); top.position.set(ml.x, 5.9, 27);
      const over = add(new T.Mesh(new T.BoxGeometry(2.8, 3, 6), M.mill)); over.position.set(ml.x, 4.5, 27);
      const g = new T.Group(); g.position.set(ml.x, ml.y, ml.z);
      for (let k = 0; k < 4; k++) {
        const arm = new T.Group(); arm.rotation.z = k * Math.PI / 2;
        const blade = new T.Mesh(new T.BoxGeometry(ml.len - 1, 1.5, 0.08), M.sail); blade.position.x = (ml.len - 1) / 2 + 0.8; blade.castShadow = true; arm.add(blade);
        const spar = new T.Mesh(new T.BoxGeometry(ml.len, 0.18, 0.18), M.trunk); spar.position.x = ml.len / 2; arm.add(spar);
        if (XMAS) for (let x = 1.5; x < ml.len; x += 1.2) { const l = new T.Mesh(G.geo.bulb, M.bulbs[(k + Math.floor(x)) % 5]); l.position.set(x, 0.85, 0.1); arm.add(l); }
        g.add(arm);
      }
      const hub = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 0.6, 12), M.trunk); hub.rotation.x = Math.PI / 2; g.add(hub);
      grp.add(g); G.dyn.sails.push({ g, ml, turn: 0 });
    }
    for (const L of Hl.loops) {
      const rr = L.R + 0.05;
      add(new T.Mesh(grid(80, 2, (u, v) => { const p = u * TAU; return [loopX(L, p) + (v - 0.5) * 3, L.y + L.R - rr * Math.cos(p), L.z + rr * Math.sin(p)]; }), M.track), false, true);
      for (const e of [-1.5, 1.5]) add(new T.Mesh(grid(80, 1, (u, v) => { const p = u * TAU, r2 = rr - v * 0.6; return [loopX(L, p) + e, L.y + L.R - r2 * Math.cos(p), L.z + r2 * Math.sin(p)]; }), M.loopRail), false, false);
    }
    if (Hl.volcano) {
      const V = Hl.volcano;
      const core = add(new T.Mesh(new T.CylinderGeometry(V.r0 + 0.1, V.r0 + 0.4, V.rim - base + 0.2, 32, 1, true), M.crater)); core.position.set(V.cx, (V.rim + base) / 2, V.cz);
      const ring = add(new T.Mesh(new T.TorusGeometry(V.r0 + 0.12, 0.16, 8, 48), M.lava), false, false); ring.rotation.x = Math.PI / 2; ring.position.set(V.cx, V.rim, V.cz);
      for (let k = 0; k < 4; k++) { const a = k * TAU / 4 + 0.4; glow(V.cx + Math.cos(a) * (V.r0 + 0.2), V.rim + 0.3, V.cz + Math.sin(a) * (V.r0 + 0.2), 3.2, XMAS ? '#ffd56b' : '#ff7a2a', 0.35); }
      G.dyn.smoke = Array.from({ length: 8 }, (_, i) => { const m = add(new T.Mesh(new T.SphereGeometry(1, 10, 8), new T.MeshLambertMaterial({ color: XMAS ? '#ffffff' : '#b4b0b8', transparent: true, opacity: 0.4, depthWrite: false })), false, false); m.k = i / 8; return m; });
      G.dyn.smokeAt = [V.cx, V.rim, V.cz + V.r0 * 0.85];
      // Lava bubbles that rise out of the glowing ring and pop.
      G.dyn.bubbles = Array.from({ length: 7 }, (_, i) => { const m = add(new T.Mesh(G.geo.bulb, M.lava), false, false); m.k = i * 0.37; return m; });
      G.dyn.lava = V;
    }
    // The cup, and its flag on a pole with a gold knob (a candy cane at Christmas). The flag waves and pops up when a ball drops in.
    const c = Hl.cup, cupY = c[1] + 0.02;
    const hole = add(new T.Mesh(new T.CircleGeometry(CUP, 28), M.cup), false, false); hole.rotation.x = -Math.PI / 2; hole.position.set(c[0], cupY, c[2]);
    const rim = add(new T.Mesh(new T.RingGeometry(CUP, CUP + 0.14, 28), M.cupRim), false, false); rim.rotation.x = -Math.PI / 2; rim.position.set(c[0], cupY + 0.005, c[2]);
    const fg = new T.Group(); fg.position.set(c[0] + 0.3, c[1], c[2] + 0.3); grp.add(fg);
    const pole = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 3.6, 8), M.pole); pole.position.y = 1.8; pole.castShadow = true; fg.add(pole);
    const knobM = new T.Mesh(new T.SphereGeometry(0.14, 10, 8), M.gold); knobM.position.y = 3.66; fg.add(knobM);
    const flag = new T.Mesh(new T.PlaneGeometry(1.5, 0.95, 8, 1), M.flag); flag.position.set(0.75, 3.1, 0); flag.castShadow = true; fg.add(flag);
    G.dyn.flag = { fg, flag, rest: flag.geometry.attributes.position.array.slice() };
    // Water lily pads, some with a flower, bobbing a little.
    if (Hl.deco.some((d) => d.look === 'pads')) {
      const rnd = seeded(7);
      for (let i = 0; i < 14; i++) {
        const m = add(new T.Mesh(new T.CircleGeometry(0.6 + rnd() * 0.5, 14, 0.3, TAU - 0.6), M.lily), false, false); m.rotation.x = -Math.PI / 2; m.rotation.z = rnd() * TAU; m.position.set(-11 + rnd() * 15, -0.22, 19 + rnd() * 18);
        if (i % 4 === 0) { const f = new T.Mesh(new T.ConeGeometry(0.22, 0.3, 6), M.bloom); f.rotation.x = Math.PI / 2; f.position.set(0.1, 0.1, 0.15); m.add(f); }
        G.dyn.pads.push({ m, y: m.position.y, k: rnd() * TAU });
      }
    }

    // The island the hole floats on, and what grows on it.
    const xs = Hl.surfaces.flatMap((s) => [s.bb[0], s.bb[2]]), zs = Hl.surfaces.flatMap((s) => [s.bb[1], s.bb[3]]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), rnd = seeded(11 + Hl.par * 7 + Hl.name.length * 13);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2 + 8.5, hz = (z1 - z0) / 2 + 9, deep = 12 + Math.min(hx, hz) * 0.5;
    const out = Hl.isle = outline(cx, cz, hx, hz, 64, rnd, 0.1);
    Hl.isleY = base;
    const [isleTop, isleRock] = island(out, base, deep, rnd);
    add(isleTop, false, true); add(isleRock, false, false);
    const offCourse = (x, z, m) => !Hl.surfaces.some((s) => x > s.bb[0] - m && x < s.bb[2] + m && z > s.bb[1] - m && z < s.bb[3] + m &&
      (s.kind !== 'flat' || [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m], [m * 0.7, m * 0.7], [-m * 0.7, m * 0.7], [m * 0.7, -m * 0.7], [-m * 0.7, -m * 0.7]].some(([dx, dz]) => inside(s, x + dx, z + dz))));
    const onIsle = (x, z, m) => [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]].every(([dx, dz]) => inPoly(out, x + dx, z + dz));
    const pick = (count, tries, ok) => { const pts = []; for (let i = 0; i < tries && pts.length < count; i++) { const x = cx - hx + rnd() * hx * 2, z = cz - hz + rnd() * hz * 2; if (ok(x, z, pts)) pts.push([x, z, 0.7 + rnd() * 0.7, rnd() * TAU]); } return pts; };
    const tee = Hl.tee, apart = (pts, x, z, d) => pts.every((p) => Math.hypot(p[0] - x, p[1] - z) > d);
    // No trees right behind the tee, where the camera starts.
    const trees = pick(30, 700, (x, z, pts) => onIsle(x, z, 2) && offCourse(x, z, 3.2) && !(z < tee[2] + 3 && Math.abs(x - tee[0]) < 10) && apart(pts, x, z, 2.8));
    many(grp, G.geo.trunk, M.trunk, trees, ([x, z, k, r]) => [x, base + 0.6 * k, z, k, r]);
    many(grp, G.geo.cone, M.leaf, trees, ([x, z, k, r]) => [x, base + 2.3 * k, z, k, r]);
    many(grp, G.geo.top, M.leaf2, trees, ([x, z, k, r]) => [x, base + 3.9 * k, z, k, r]);
    if (XMAS) {
      many(grp, G.geo.cap, M.snow, trees, ([x, z, k, r]) => [x, base + 4.75 * k, z, k, r], null, false);
      const lights = trees.flatMap((t, i) => Array.from({ length: 6 }, (_, j) => [t, i, j]));
      many(grp, G.geo.bulb, M.glowW, lights, ([[x, z, k], i, j]) => { const a = j * 1.3 + i, h = 1.2 + j * 0.62, rr = (h < 3.6 ? 1.7 * (3.9 - h) / 3.2 : 1.2 * (5.2 - h) / 2.6) + 0.06; return [x + Math.cos(a) * rr * k, base + h * k, z + Math.sin(a) * rr * k, 1, 0]; },
        ([, i, j]) => ['#ff5a5a', '#ffd56b', '#5ce1e6', '#b8e65c', '#ff9ae0'][(i + j) % 5], false);
      const gifts = trees.filter((t, i) => i % 3 === 0);
      many(grp, G.geo.gift, M.white, gifts, ([x, z, k, r]) => [x + 1.9, base + 0.35 * k, z + 0.8, 0.7 * k, r], (t, i) => ['#e2384d', '#3f9a5c', '#4f7dff', '#ffd56b'][i % 4]);
    } else {
      const fl = pick(80, 900, (x, z) => onIsle(x, z, 0.6) && offCourse(x, z, 0.9));
      many(grp, G.geo.flower, M.white, fl, ([x, z, k, r]) => [x, base + 0.16, z, k, r], (t, i) => ['#ff8fc8', '#ffe066', '#ffffff', '#b99cff', '#ff9a5c'][i % 5], false);
      const tu = pick(110, 900, (x, z) => onIsle(x, z, 0.4) && offCourse(x, z, 0.6));
      many(grp, G.geo.tuft, M.tuft, tu, ([x, z, k, r]) => [x, base + 0.2 * k, z, k, r], null, false);
    }
    // Rocks round the edge.
    const rocks = Array.from({ length: 14 }, () => { const p = out[Math.floor(rnd() * out.length)], f = 0.9 + rnd() * 0.06; return [cx + (p[0] - cx) * f, cz + (p[1] - cz) * f, 0.6 + rnd() * 0.9, rnd() * TAU]; });
    many(grp, G.geo.stone, M.stones, rocks, ([x, z, k, r]) => [x, base + 0.15 * k, z, k, r, k * 0.6]);
    // Lanterns along the sides of the course.
    const posts = [], lamps = [];
    for (let k = 2; k < 8; k++) {
      const sd = k % 2 ? 1 : -1, z = z0 + (z1 - z0) * ((k >> 1) + 0.5) / 4;
      let x = cx;
      while (Math.abs(x - cx) < hx && !offCourse(x, z, 1.1)) x += sd * 0.5;
      if (!onIsle(x, z, 1) || (z < tee[2] + 3 && Math.abs(x - tee[0]) < 9)) continue;
      posts.push([new T.CylinderGeometry(0.07, 0.09, 2, 6), MX().makeTranslation(x, base + 1, z)], [new T.ConeGeometry(0.34, 0.32, 4), MX().makeTranslation(x, base + 2.38, z)]);
      lamps.push([new T.BoxGeometry(0.34, 0.4, 0.34), MX().makeTranslation(x, base + 2.02, z)]);
      G.dyn.lamps.push({ s: glow(x, base + 2.02, z, 2.6, LOOK.lamp, 0.6), k: k * 1.7 });
    }
    if (posts.length) { add(new T.Mesh(merge(posts), M.iron)); add(new T.Mesh(merge(lamps), M.lamp), false, false); }
    // Roots under the rim, and waterfalls off the edge (icicles at Christmas).
    const roots = [], ice = [];
    for (let i = 0; i < 9; i++) { const p = out[Math.floor(rnd() * out.length)], l = 2 + rnd() * 3; roots.push([new T.ConeGeometry(0.16, l, 4).rotateX(Math.PI), MX().makeTranslation(cx + (p[0] - cx) * 0.95, base - 1.2 - l / 2, cz + (p[1] - cz) * 0.95)]); }
    add(new T.Mesh(merge(roots), M.trunk), false, false);
    if (XMAS) {
      for (let i = 0; i < 40; i++) { const p = out[Math.floor(rnd() * out.length)], l = 0.6 + rnd() * 1.2; ice.push([new T.ConeGeometry(0.15, l, 5).rotateX(Math.PI), MX().makeTranslation(cx + (p[0] - cx) * 1.005, base - 0.5 - l / 2, cz + (p[1] - cz) * 1.005)]); }
      add(new T.Mesh(merge(ice), M.icicle), false, false);
    } else for (const f of [0.07, 0.57]) {
      const p = out[Math.round(out.length * f)], dx = p[0] - cx, dz = p[1] - cz, l = Math.hypot(dx, dz), nx = dx / l, nz = dz / l, h = deep * 0.8;
      const fall = add(new T.Mesh(new T.PlaneGeometry(2.4, h), M.fall), false, false); fall.position.set(p[0] + nx * 0.3, base - h / 2 + 0.1, p[1] + nz * 0.3); fall.rotation.y = Math.atan2(nx, nz);
      const pool = add(new T.Mesh(G.geo.pool, M.water), false, false); pool.position.set(p[0] - nx * 1.1, base + 0.03, p[1] - nz * 1.1);
    }
    // Other islands far away, and clouds drifting below and round about.
    const far = seeded(40 + Hl.name.length * 3 + Hl.par);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + far() * 0.6, d = 95 + far() * 75, fx = cx + Math.sin(a) * d, fz = cz + Math.cos(a) * d, fy = base - 14 + far() * 34;
      const sx = 5 + far() * 9, sz = 5 + far() * 9, o = outline(fx, fz, sx, sz, 20, far, 0.25), [t2, r2] = island(o, fy, 5 + far() * 8, far);
      const cones = [];
      for (let k = 0, n = 1 + Math.floor(far() * 4); k < n; k++) { const s = 0.8 + far() * 0.8, tx = fx + (far() - 0.5) * sx, tz = fz + (far() - 0.5) * sz; cones.push([G.geo.cone, MX().compose(new T.Vector3(tx, fy + 2.3 * s, tz), new T.Quaternion(), new T.Vector3(s, s, s))], [G.geo.top, MX().compose(new T.Vector3(tx, fy + 3.9 * s, tz), new T.Quaternion(), new T.Vector3(s, s, s))]); }
      const tm = new T.Mesh(merge(cones), XMAS ? M.snow : M.leaf);
      for (const m of [t2, r2, tm]) { grp.add(m); G.dyn.far.push(m); }
    }
    for (let i = 0; i < 18; i++) {
      const low = i < 12, a = far() * TAU, d = low ? 25 + far() * 170 : 140 + far() * 70, k = low ? 40 + far() * 50 : 55 + far() * 50;
      const s = new T.Sprite(M.cloud); s.position.set(cx + Math.sin(a) * d, low ? base - 16 - far() * 40 : base - 6 + far() * 28, cz + Math.cos(a) * d); s.scale.set(k, k * 0.5, 1);
      grp.add(s); G.dyn.clouds.push({ s, x: s.position.x - cx, cx, v: 0.8 + far() * 1.4 });
    }
    quality(G.q);
    const fadeMats = { mill: [M.mill, M.roof, M.sail], castle: [M.castle], hedge: [M.hedge], snow: [M.snow], cone: [M.cone], crater: [M.crater], loop: [M.track, M.loopRail] };
    for (const k of Hl.blockers) k.mats = fadeMats[k.look] || [];
    G.scene.add(grp);
  }
  // Slow phones get fewer extras: 1 hides the far islands and clouds, 0 also turns off shadows.
  function quality(q) {
    G.q = q;
    for (const m of G.dyn.far) m.visible = q >= 2;
    for (const c of G.dyn.clouds) c.s.visible = q >= 2;
    G.sun.castShadow = q >= 1;
  }
  function animateHole(Hl, t) {
    const d = G.dyn;
    for (const { g, s } of d.spinners) g.rotation.y = -(s.phase + s.speed * t);
    for (const { m, p } of d.pucks) { const q = puckAt(p, t); m.position.x = q[0]; m.position.z = q[1]; }
    for (const { g, ml } of d.sails) g.rotation.z = ml.speed * t;
    for (const { piv, b } of d.bridges) piv.rotation.x = lift(b, t) * 1.25;
    // A bumper that was just hit glows and wobbles.
    for (const { m, p, g } of d.bumpers) {
      m.material.emissiveIntensity = 0.3 + p.flash * 1.8;
      const s = 1 + Math.sin(p.flash * 20) * p.flash * 0.14; m.scale.set(s, 1, s);
      g.material.opacity = 0.2 + p.flash * 0.8; g.scale.setScalar(p.r * (4 + p.flash * 3));
    }
    G.m.stripe.emissiveIntensity = 0.45 + Math.sin(t * 5) * 0.35;
    if (d.flag) {
      const pa = d.flag.flag.geometry.attributes.position, r0 = d.flag.rest;
      for (let i = 0; i < pa.count; i++) { const k = (r0[i * 3] + 0.75) / 1.5; pa.setZ(i, Math.sin(k * 4 - t * 5) * 0.16 * k); }
      pa.needsUpdate = true; d.flag.flag.geometry.computeVertexNormals();
    }
    if (d.smoke.length) d.smoke.forEach((m) => { const k = (t * 0.25 + m.k) % 1; m.position.set(d.smokeAt[0] + Math.sin(k * 6 + m.k * 9) * 1.2, d.smokeAt[1] + 1 + k * 8, d.smokeAt[2]); m.scale.setScalar(0.4 + k * 1.2); m.material.opacity = 0.4 * (1 - k); });
    if (d.lava) for (const m of d.bubbles) {
      const k = (t * 0.6 + m.k) % 1, a = Math.floor(t * 0.6 + m.k) * 2.4 + m.k * 5, V = d.lava;
      m.position.set(V.cx + Math.cos(a) * (V.r0 + 0.12), V.rim + 0.1 + k * 0.5, V.cz + Math.sin(a) * (V.r0 + 0.12)); m.scale.setScalar(k < 0.85 ? 0.6 + k * 1.6 : 0.01);
    }
    G.water.offset.set(t * 0.02, t * 0.035); G.glint.offset.set(-t * 0.03, t * 0.012); G.fall.offset.y = t * 1.1;
    for (const p of d.pads) { p.m.position.y = p.y + Math.sin(t * 1.4 + p.k) * 0.04; p.m.rotation.z += 0.0008; }
    for (const l of d.lamps) l.s.material.opacity = 0.5 + Math.sin(t * 7 + l.k) * 0.06 + Math.sin(t * 13 + l.k * 2) * 0.04;
    for (const c of d.clouds) c.s.position.x = c.cx + ((c.x + c.v * t + 220) % 440 + 440) % 440 - 220;
    if (G.aurora.length) waveAurora(t);
  }

  Arcade.register('minigolf', golf);
})();
