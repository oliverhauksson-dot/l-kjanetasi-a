/* Police Chase ("Don't let the police catch you"). Loaded on demand by js/arcade.js the first time the game is opened.
   A 3D city seen from a camera above and behind you. You drive the orange getaway car and the police chase you
   through the streets, past traffic, apartment buildings and skyscrapers.
   The game logic works in 2D on the ground (x, y). The 3D scene is drawn with three.js (js/vendor), which is
   only downloaded when this game is opened, and the picture is copied onto the arcade's canvas every frame.
   In 3D, the game's y becomes three.js's z, and height is three.js's y.
   The police find their way round the buildings with a distance map of the roads that is worked out from your
   position a few times a second. Police that crash into each other, a wall or a car stop for a while. */
(() => {
  const { ctx, C, rand, clamp, sfx, setScore, over, font } = Arcade;

  let T = null, failed = false;
  const here = document.currentScript ? document.currentScript.src : location.href;
  import(new URL('../vendor/three.module.min.js', here).href).then((m) => { T = m; }, () => { failed = true; });

  // The city is a 7 x 7 grid of blocks with roads between them and round the outside.
  const ROAD = 80, BLOCK = 200, PITCH = ROAD + BLOCK, NB = 7, WORLD = ROAD + NB * PITCH;
  // For finding the way, the city is also split into small cells. 7 cells make one PITCH (2 road + 5 block).
  const CELL = 40, GN = WORLD / CELL;
  const LANE = 18;                  // Traffic drives this far from the middle of the road, on the right.
  const R = 13;                     // Every car is a circle this big when it bumps into things.
  const LIVES = 3, SAFE = 3;        // Seconds you can't be caught after the police catch you.
  const TRAFFIC = 16;
  const PLAYER = { acc: 420, max: 240, turn: 4.2, grip: 5.5 };
  const BOOSTED = { acc: 650, max: 350, turn: 4.4, grip: 5 };

  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const open = (cx, cy) => cx >= 0 && cy >= 0 && cx < GN && cy < GN && (cx % 7 < 2 || cy % 7 < 2);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  /* ---------- The city plan ----------
     A dozen block designs, each placed many times over the map. */
  const WALLS = ['#c0533f', '#e3cfa4', '#9aa4b1', '#d98e5c', '#f0ede4', '#7f9bb5', '#b8735a'];
  function house(x, y, w, h, kind) {
    const b = { x, y, w, h, kind };
    if (kind === 'sky') { b.z = Math.round(rand(6, 9)) * 28; b.wall = pick(['#5fa8d3', '#6fb7c9', '#7d93c9']); b.roof = '#8d939c'; b.antenna = Math.random() < 0.6; }
    else if (kind === 'apt') { b.z = Math.round(rand(4, 8)) * 20; b.wall = pick(WALLS); b.roof = pick(['#5b6270', '#7a808a', '#6b5d58']); b.tank = Math.random() < 0.6; }
    else { b.z = 36; b.wall = pick(WALLS); b.roof = '#7a808a'; b.awning = pick(['#e2483d', '#2f8fd8', '#2fa866', '#f2b33d']); }
    return b;
  }
  const DESIGNS = [
    { ground: 'plaza', houses: () => [house(35, 35, 130, 130, 'sky')] },
    { ground: 'plaza', houses: () => [house(45, 45, 110, 110, 'sky')] },
    { ground: 'plaza', houses: () => [house(22, 22, 70, 156, 'sky'), house(108, 22, 70, 156, 'sky')] },
    { ground: 'lawn', houses: () => [house(14, 14, 80, 172, 'apt'), house(106, 14, 80, 172, 'apt')] },
    { ground: 'lawn', houses: () => [house(14, 14, 172, 80, 'apt'), house(14, 106, 172, 80, 'apt')] },
    { ground: 'lawn', houses: () => [house(14, 14, 78, 78, 'apt'), house(108, 14, 78, 78, 'apt'), house(14, 108, 78, 78, 'shop'), house(108, 108, 78, 78, 'apt')] },
    { ground: 'lawn', houses: () => [house(14, 14, 172, 92, 'apt'), house(14, 122, 80, 64, 'shop'), house(106, 122, 80, 64, 'shop')] },
    { ground: 'lawn', houses: () => [house(14, 14, 104, 104, 'apt'), house(130, 14, 56, 104, 'shop'), house(14, 130, 172, 56, 'apt')] },
    { ground: 'plaza', houses: () => [house(18, 18, 86, 86, 'sky'), house(118, 18, 68, 168, 'apt'), house(18, 118, 86, 68, 'shop')] },
    { ground: 'park', pond: false }, { ground: 'park', pond: true }, { ground: 'park', pond: false },
  ].map((d) => {
    d.houses = d.houses ? d.houses() : [];
    d.trees = [];
    if (d.ground === 'park') {
      while (d.trees.length < 10) {
        const x = rand(24, 176), y = rand(24, 176);
        if (Math.abs(x - 100) > 30 && Math.abs(y - 100) > 30) d.trees.push({ x, y, r: rand(9, 13) });
      }
    } else if (d.ground === 'plaza') {
      for (const [x, y] of [[12, 12], [188, 12], [12, 188], [188, 188]]) d.trees.push({ x, y, r: 8 });
    }
    return d;
  });
  const city = [];
  for (let j = 0; j < NB; j++) for (let i = 0; i < NB; i++) city.push(Math.random() < 0.14 ? 9 + Math.floor(Math.random() * 3) : Math.floor(Math.random() * 9));

  /* ---------- Cars (the 2D logic) ---------- */
  function drive(car, aim, throttle, brake, dt, s) {
    if (aim !== null) { const d = wrap(aim - car.a); car.a += clamp(d, -s.turn * dt, s.turn * dt); }
    const c = Math.cos(car.a), n = Math.sin(car.a);
    let f = car.vx * c + car.vy * n, l = -car.vx * n + car.vy * c;
    if (throttle > 0) { if (f < s.max) f = Math.min(s.max, f + s.acc * throttle * dt); }
    else if (throttle < 0) f = Math.max(-90, f + s.acc * throttle * 0.6 * dt);
    else f -= f * 1.6 * dt;
    if (brake) f -= f * 3.5 * dt;
    if (f > s.max) f -= (f - s.max) * 4 * dt;
    l -= l * Math.min(1, s.grip * dt);   // Low grip lets the car slide sideways a little (a drift).
    car.vx = f * c - l * n; car.vy = f * n + l * c;
    car.slide = Math.abs(l); car.speed = Math.hypot(car.vx, car.vy);
    car.x += car.vx * dt; car.y += car.vy * dt;
  }
  // Push a car out of the blocks and the edge of the map. Returns how hard it hit.
  function bump(car) {
    let hit = 0;
    const lo = (v) => Math.floor((v - R - ROAD) / PITCH), hi = (v) => Math.floor((v + R - ROAD) / PITCH);
    for (let j = Math.max(0, lo(car.y)); j <= Math.min(NB - 1, hi(car.y)); j++) {
      for (let i = Math.max(0, lo(car.x)); i <= Math.min(NB - 1, hi(car.x)); i++) {
        const bx = ROAD + i * PITCH, by = ROAD + j * PITCH;
        const px = clamp(car.x, bx, bx + BLOCK), py = clamp(car.y, by, by + BLOCK);
        const dx = car.x - px, dy = car.y - py, d = Math.hypot(dx, dy);
        if (d >= R || d === 0) continue;
        const nx = dx / d, ny = dy / d;
        car.x += nx * (R - d); car.y += ny * (R - d);
        const vn = car.vx * nx + car.vy * ny;
        if (vn < 0) { car.vx -= 1.4 * vn * nx; car.vy -= 1.4 * vn * ny; car.vx *= 0.9; car.vy *= 0.9; hit = Math.max(hit, -vn); }
      }
    }
    if (car.x < R) { hit = Math.max(hit, -car.vx); car.x = R; car.vx = Math.abs(car.vx) * 0.4; }
    if (car.x > WORLD - R) { hit = Math.max(hit, car.vx); car.x = WORLD - R; car.vx = -Math.abs(car.vx) * 0.4; }
    if (car.y < R) { hit = Math.max(hit, -car.vy); car.y = R; car.vy = Math.abs(car.vy) * 0.4; }
    if (car.y > WORLD - R) { hit = Math.max(hit, car.vy); car.y = WORLD - R; car.vy = -Math.abs(car.vy) * 0.4; }
    return hit;
  }

  /* ---------- Traffic ----------
     Traffic drives along one lane (axis 0 = along x, 1 = along y; d = +1 or -1), and at each crossing goes
     straight on or turns. s is how far along the road it is, lane is the fixed other coordinate. */
  const centre = (k) => k * PITCH + ROAD / 2;
  const laneOf = (axis, road, d) => (axis === 0 ? road + LANE * d : road - LANE * d);
  function decide(t) {
    let k = t.d > 0 ? Math.ceil((t.s + 20 - ROAD / 2) / PITCH) : Math.floor((t.s - 20 - ROAD / 2) / PITCH);
    k = clamp(k, 0, NB);
    const road = Math.round((t.lane - ROAD / 2) / PITCH), opts = [];
    if (k + t.d >= 0 && k + t.d <= NB) opts.push(null, null);
    if (road + 1 <= NB) opts.push(1);
    if (road - 1 >= 0) opts.push(-1);
    const nd = pick(opts), c = centre(k);
    t.dec = { c, nd, tp: nd === null ? null : (t.axis === 0 ? c - LANE * nd : c + LANE * nd) };
  }
  function newTraffic(avoid) {
    for (let tries = 0; tries < 50; tries++) {
      const axis = Math.random() < 0.5 ? 0 : 1, d = Math.random() < 0.5 ? 1 : -1, road = centre(Math.floor(rand(0, NB + 1)));
      const t = { axis, d, lane: laneOf(axis, road, d), s: rand(60, WORLD - 60), speed: 80, want: rand(70, 100), stop: 0, col: pick(['#4a90d9', '#e8e8e8', '#3fb27f', '#d94a4a', '#f2c94c', '#8a5cd6', '#33363d']) };
      t.x = axis === 0 ? t.s : t.lane; t.y = axis === 0 ? t.lane : t.s;
      t.a = axis === 0 ? (d > 0 ? 0 : Math.PI) : (d > 0 ? Math.PI / 2 : -Math.PI / 2);
      if (Math.hypot(t.x - avoid.x, t.y - avoid.y) < 300) continue;
      decide(t);
      return t;
    }
    return null;
  }

  /* ---------- The 3D scene ----------
     Built once, the first time the game is drawn after three.js has loaded, and reused for every game. */
  let G = null;
  function canvas(w, h, paint) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    paint(c.getContext('2d'));
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    return tex;
  }
  // The flat city: roads, markings, pavements, lawns, plazas and parks, all in one big picture.
  function paintCity(g) {
    g.scale(2048 / WORLD, 2048 / WORLD);
    g.fillStyle = '#5c6370'; g.fillRect(0, 0, WORLD, WORLD);
    for (let k = 0; k <= NB; k++) {
      const c = centre(k);
      g.fillStyle = '#f2c94c'; g.fillRect(c - 2.5, 0, 1.6, WORLD); g.fillRect(c + 0.9, 0, 1.6, WORLD); g.fillRect(0, c - 2.5, WORLD, 1.6); g.fillRect(0, c + 0.9, WORLD, 1.6);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      for (const o of [-34, 33]) { g.fillRect(c + o, 0, 1.4, WORLD); g.fillRect(0, c + o, WORLD, 1.4); }
    }
    for (let j = 0; j <= NB; j++) for (let i = 0; i <= NB; i++) {
      const x = i * PITCH, y = j * PITCH;
      g.fillStyle = '#5c6370'; g.fillRect(x, y, ROAD, ROAD);
      g.fillStyle = '#f4f4f0';
      for (let s = 6; s < ROAD - 4; s += 10) {
        if (j > 0) g.fillRect(x + s, y - 16, 6, 13);
        if (j < NB) g.fillRect(x + s, y + ROAD + 3, 6, 13);
        if (i > 0) g.fillRect(x - 16, y + s, 13, 6);
        if (i < NB) g.fillRect(x + ROAD + 3, y + s, 13, 6);
      }
    }
    for (let j = 0; j < NB; j++) for (let i = 0; i < NB; i++) {
      const d = DESIGNS[city[j * NB + i]], bx = ROAD + i * PITCH, by = ROAD + j * PITCH;
      g.fillStyle = '#c8cbd1'; g.fillRect(bx, by, BLOCK, BLOCK);
      g.fillStyle = '#e8eaee'; g.fillRect(bx, by, BLOCK, 2); g.fillRect(bx, by + BLOCK - 2, BLOCK, 2); g.fillRect(bx, by, 2, BLOCK); g.fillRect(bx + BLOCK - 2, by, 2, BLOCK);
      if (d.ground === 'lawn' || d.ground === 'park') { g.fillStyle = '#7cc35a'; g.fillRect(bx + 8, by + 8, 184, 184); }
      if (d.ground === 'plaza') {
        g.fillStyle = '#ddd3bb'; g.fillRect(bx + 6, by + 6, 188, 188);
        g.fillStyle = 'rgba(120,100,70,0.15)';
        for (let k = 6; k < 194; k += 14) { g.fillRect(bx + k, by + 6, 1, 188); g.fillRect(bx + 6, by + k, 188, 1); }
      }
      if (d.ground === 'park') {
        g.fillStyle = '#e9dfc4'; g.fillRect(bx + 92, by + 8, 16, 184); g.fillRect(bx + 8, by + 92, 184, 16);
        g.fillStyle = '#d8dce2'; g.beginPath(); g.arc(bx + 100, by + 100, 26, 0, Math.PI * 2); g.fill();
        if (d.pond) { g.fillStyle = '#5bb6e0'; g.beginPath(); g.arc(bx + 100, by + 100, 21, 0, Math.PI * 2); g.fill(); }
      }
      if (d.ground === 'lawn') { g.fillStyle = '#d8dce2'; for (const b of d.houses) g.fillRect(bx + b.x - 4, by + b.y - 4, b.w + 8, b.h + 8); }
    }
  }
  // Wall pictures. Each one is a small tile that repeats over the whole wall.
  function facade(kind, wall) {
    const key = kind + wall;
    if (G.facades[key]) return G.facades[key];
    let tex;
    if (kind === 'apt') {
      tex = canvas(128, 64, (g) => {
        g.fillStyle = wall; g.fillRect(0, 0, 128, 64);
        if (wall === '#c0533f' || wall === '#b8735a') { // Brick
          g.fillStyle = 'rgba(0,0,0,0.12)';
          for (let y = 0; y < 64; y += 6) { g.fillRect(0, y, 128, 1); for (let x = (y / 6) % 2 ? 0 : 6; x < 128; x += 12) g.fillRect(x, y, 1, 6); }
        }
        for (const x of [0, 64]) {
          g.fillStyle = '#f2efe8'; g.fillRect(x + 14, 12, 36, 34);
          g.fillStyle = '#34465e'; g.fillRect(x + 17, 15, 30, 28);
          g.fillStyle = '#6d8db0'; g.beginPath(); g.moveTo(x + 17, 15); g.lineTo(x + 34, 15); g.lineTo(x + 17, 32); g.fill();
          g.fillStyle = '#f2efe8'; g.fillRect(x + 31, 15, 2, 28);
        }
        // A balcony on the left window of each tile.
        g.fillStyle = '#d9dde3'; g.fillRect(8, 44, 48, 4);
        g.fillStyle = 'rgba(60,66,78,0.8)'; g.fillRect(8, 48, 48, 2); for (let x = 9; x < 56; x += 5) g.fillRect(x, 48, 1.5, 12); g.fillRect(8, 58, 48, 2);
      });
    } else if (kind === 'sky') {
      tex = canvas(128, 128, (g) => {
        g.fillStyle = '#d6dde6'; g.fillRect(0, 0, 128, 128);
        for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) {
          const grad = g.createLinearGradient(x * 32, y * 64, x * 32 + 32, y * 64 + 64);
          grad.addColorStop(0, wall); grad.addColorStop(1, '#bfe6f5');
          g.fillStyle = grad; g.fillRect(x * 32 + 2, y * 64 + 3, 28, 58);
        }
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 60, 128, 4); g.fillRect(0, 124, 128, 4);
      });
    } else {
      tex = canvas(128, 128, (g) => {
        g.fillStyle = wall; g.fillRect(0, 0, 128, 128);
        g.fillStyle = '#f2efe8'; g.fillRect(10, 18, 108, 22);
        g.fillStyle = '#34465e'; g.fillRect(14, 22, 100, 14);
        for (let x = 0; x < 128; x += 16) { g.fillStyle = x % 32 ? '#f4f4f0' : wall === '#f0ede4' ? '#e2483d' : '#e2483d'; g.fillRect(x, 52, 16, 12); }
        g.fillStyle = '#8fd0ec'; g.fillRect(6, 66, 116, 60);
        g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(6, 66, 116, 8);
        g.fillStyle = '#4a4f5a'; g.fillRect(56, 76, 16, 50);
      });
    }
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    return (G.facades[key] = tex);
  }
  function build() {
    const W = chase.W, H = chase.H;
    G = { facades: {}, mats: {} };
    try {
      G.r = new T.WebGLRenderer({ antialias: true });
    } catch (e) { failed = true; G = null; return; }
    G.r.shadowMap.enabled = true; G.r.shadowMap.type = T.PCFSoftShadowMap;
    G.r.setPixelRatio(1);
    const scene = G.scene = new T.Scene();
    scene.background = new T.Color('#9ccfe6');
    G.cam = new T.PerspectiveCamera(45, W / H, 20, 4000);
    scene.add(new T.HemisphereLight('#ffffff', '#7d8794', 2.2));
    const sun = G.sun = new T.DirectionalLight('#fff4e0', 2.4);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -700, right: 700, top: 700, bottom: -700, near: 10, far: 2000 });
    sun.shadow.bias = -0.0008;
    scene.add(sun); scene.add(sun.target);
    const mat = (col, opts) => G.mats[col] || (G.mats[col] = new T.MeshLambertMaterial(Object.assign({ color: col }, opts)));

    // Ground: the painted city, and grass round the outside.
    const groundTex = canvas(2048, 2048, paintCity); groundTex.anisotropy = G.r.capabilities.getMaxAnisotropy();
    const ground = new T.Mesh(new T.PlaneGeometry(WORLD, WORLD), new T.MeshLambertMaterial({ map: groundTex }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(WORLD / 2, 0, WORLD / 2); ground.receiveShadow = true;
    scene.add(ground);
    const grass = new T.Mesh(new T.PlaneGeometry(9000, 9000), mat('#78b65a'));
    grass.rotation.x = -Math.PI / 2; grass.position.set(WORLD / 2, -0.5, WORLD / 2); scene.add(grass);
    for (const [x, z, w, d] of [[WORLD / 2, -4, WORLD + 16, 8], [WORLD / 2, WORLD + 4, WORLD + 16, 8], [-4, WORLD / 2, 8, WORLD], [WORLD + 4, WORLD / 2, 8, WORLD]]) {
      const wall = new T.Mesh(new T.BoxGeometry(w, 10, d), mat('#d9dce1')); wall.position.set(x, 5, z); wall.castShadow = true; scene.add(wall);
    }

    // Buildings: boxes with repeating wall pictures. Roof bits, trees and lamp posts are drawn many at once (instanced).
    const unit = new T.BoxGeometry(1, 1, 1), extras = [], trees = [], lamps = [];
    const at = (x, y, z, sx, sy, sz, ry) => { const o = new T.Object3D(); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.y = ry || 0; o.updateMatrix(); return o.matrix.clone(); };
    for (let j = 0; j < NB; j++) for (let i = 0; i < NB; i++) {
      const d = DESIGNS[city[j * NB + i]], bx = ROAD + i * PITCH, by = ROAD + j * PITCH;
      for (const b of d.houses) {
        const geo = new T.BoxGeometry(b.w, b.z, b.h), uv = geo.attributes.uv;
        const tw = b.kind === 'apt' ? 34 : b.kind === 'sky' ? 48 : 64, th = b.kind === 'apt' ? 20 : b.kind === 'sky' ? 28 : b.z;
        for (let f = 0; f < 6; f++) {
          if (f === 2 || f === 3) continue;
          const width = f < 2 ? b.h : b.w;
          for (let v = f * 4; v < f * 4 + 4; v++) uv.setXY(v, uv.getX(v) * width / tw, uv.getY(v) * b.z / th);
        }
        const side = new T.MeshLambertMaterial({ map: facade(b.kind, b.wall) }), roof = mat(b.roof);
        const m = new T.Mesh(geo, [side, side, roof, roof, side, side]);
        m.position.set(bx + b.x + b.w / 2, b.z / 2, by + b.y + b.h / 2);
        m.castShadow = true; m.receiveShadow = true;
        scene.add(m);
        const cx = bx + b.x + b.w / 2, cz = by + b.y + b.h / 2;
        if (b.kind === 'sky') {
          extras.push([at(cx, b.z + 7, cz, b.w * 0.45, 14, b.h * 0.45), '#b9bfc8']);
          if (b.antenna) extras.push([at(cx, b.z + 14 + 30, cz, 2, 60, 2), '#d0d4da']);
        } else {
          const n = b.kind === 'shop' ? 1 : 2;
          for (let k = 0; k < n; k++) extras.push([at(bx + b.x + 14 + k * 22, b.z + 3, by + b.y + 14, 14, 6, 10), '#d5d9de']);
          if (b.tank) extras.push([at(bx + b.x + b.w - 16, b.z + 9, by + b.y + b.h - 16, 14, 18, 14), '#8d5a3a']);
          if (b.kind === 'shop') extras.push([at(cx, 22, by + b.y + b.h + 3, b.w - 6, 2, 8), b.awning]);
        }
      }
      for (const t of d.trees) trees.push([bx + t.x, by + t.y, t.r]);
      for (const [x, y] of [[6, 6], [194, 6], [6, 194], [194, 194]]) lamps.push([bx + x, by + y]);
    }
    const inst = (geo, material, list, shadow) => {
      const m = new T.InstancedMesh(geo, material, list.length);
      list.forEach(([mx, col], k) => { m.setMatrixAt(k, mx); if (col) m.setColorAt(k, new T.Color(col)); });
      m.castShadow = shadow; m.receiveShadow = true; scene.add(m); return m;
    };
    inst(unit, new T.MeshLambertMaterial({ color: '#ffffff' }), extras, true);
    const ico = new T.IcosahedronGeometry(1, 0);
    inst(new T.CylinderGeometry(1.4, 2, 1, 6), mat('#7a5233'), trees.map(([x, z, r]) => [at(x, r * 0.6, z, 1, r * 1.2, 1)]), true);
    inst(ico, new T.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), trees.map(([x, z, r]) => [at(x, r * 1.9, z, r, r * 1.15, r, rand(0, 6)), pick(['#3f9b4a', '#4daa52', '#358a42', '#5cb85c'])]), true);
    inst(new T.CylinderGeometry(0.9, 0.9, 1, 5), mat('#5f6670'), lamps.map(([x, z]) => [at(x, 17, z, 1, 34, 1)]), true);
    inst(unit, mat('#fff3c4'), lamps.map(([x, z]) => [at(x, 34, z, 5, 2, 5)]), false);

    // Cars
    G.box = unit;
    G.parts = {
      glass: mat('#2b3a4f'), wheel: mat('#1d1f24'), head: new T.MeshBasicMaterial({ color: '#fff6c9' }), tail: new T.MeshBasicMaterial({ color: '#ff3b3b' }),
      white: mat('#f4f6f8'), navy: mat('#1f2d6e'), stripe: mat('#ffffff'),
    };
    G.player = car('#ff8a2e', false);
    G.cops = []; G.traffic = [];
    const glowTex = canvas(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });
    G.glowGeo = new T.PlaneGeometry(90, 90); G.glowGeo.rotateX(-Math.PI / 2); G.glowTex = glowTex;

    // Coins, the boost, skid marks and smoke
    G.coins = [];
    const coinGeo = new T.CylinderGeometry(10, 10, 2.5, 18); coinGeo.rotateX(Math.PI / 2);
    for (let k = 0; k < 8; k++) { const c = new T.Mesh(coinGeo, new T.MeshLambertMaterial({ color: '#ffc83d', emissive: '#6b4a00' })); c.castShadow = true; scene.add(c); G.coins.push(c); }
    G.power = new T.Mesh(new T.OctahedronGeometry(12), new T.MeshLambertMaterial({ color: '#5ce1e6', emissive: '#1f7f86' })); G.power.castShadow = true; scene.add(G.power);
    const markGeo = new T.PlaneGeometry(1, 1); markGeo.rotateX(-Math.PI / 2);
    G.marks = new T.InstancedMesh(markGeo, new T.MeshBasicMaterial({ color: '#1c1d22', transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 800);
    G.marks.count = 0; G.marks.frustumCulled = false; G.markN = 0; scene.add(G.marks);
    G.puffs = [];
    for (let k = 0; k < 70; k++) { const p = new T.Mesh(ico, new T.MeshLambertMaterial({ color: '#ffffff', transparent: true, flatShading: true, depthWrite: false })); p.visible = false; scene.add(p); G.puffs.push(p); }
    G.v = new T.Vector3();
  }
  // A low-poly car, pointing along +x.
  function car(color, police) {
    const g = new T.Group(), P = G.parts, add = (m, x, y, z, w, h, d, shadow) => {
      const part = new T.Mesh(G.box, m); part.position.set(x, y, z); part.scale.set(w, h, d); part.castShadow = !!shadow; g.add(part); return part;
    };
    const body = police ? P.white : new T.MeshLambertMaterial({ color });
    add(body, 0, 6, 0, 30, 7, 16, true);
    add(P.glass, -2, 12.5, 0, 16, 6, 14, true);
    add(body, -2, 16, 0, 12, 1.4, 13);
    for (const [x, z] of [[9.5, 7.6], [9.5, -7.6], [-9.5, 7.6], [-9.5, -7.6]]) add(P.wheel, x, 3.5, z, 7, 7, 2.5);
    add(P.head, 15.1, 6.5, 5, 0.6, 2, 3.5); add(P.head, 15.1, 6.5, -5, 0.6, 2, 3.5);
    add(P.tail, -15.1, 6.5, 5, 0.6, 2, 3.5); add(P.tail, -15.1, 6.5, -5, 0.6, 2, 3.5);
    const out = { g };
    if (police) {
      add(P.navy, 11.5, 6, 0, 7, 7.2, 16.2); add(P.navy, -1, 6.5, 0, 9, 4, 16.3);
      out.red = new T.MeshBasicMaterial({ color: '#ff2a4a' }); out.blue = new T.MeshBasicMaterial({ color: '#2a5aff' });
      add(out.red, -2, 18, 3.5, 3, 2.2, 6); add(out.blue, -2, 18, -3.5, 3, 2.2, 6);
      out.glow = new T.Mesh(G.glowGeo, new T.MeshBasicMaterial({ map: G.glowTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0.6 }));
      out.glow.position.y = 0.6; G.scene.add(out.glow);
    } else if (color === '#ff8a2e') {
      add(P.stripe, 0, 9.6, 2, 30.2, 0.3, 1.6); add(P.stripe, 0, 9.6, -2, 30.2, 0.3, 1.6);
    }
    G.scene.add(g);
    return out;
  }

  const chase = {
    W: 400, H: 560, color: 'var(--pink)', title: 'Police Chase', label: 'Score',
    quietScore: true, // The score ticks up every moment you survive, so coins get their own sound instead of a beep.
    intro: "Don't let the police catch you! Drive round the city, grab coins and speed boosts, and make the police crash into each other. They catch you 3 times and it's over.",
    hint: '<kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd> or <kbd>WASD</kbd> to drive, drag anywhere on a phone, <kbd>P</kbd> to pause',

    reset() {
      this.t = 0; this.clock = 0; this.bonus = 0; this.score = 0; this.lives = LIVES;
      const sx = ROAD + 3 * PITCH - ROAD / 2, sy = ROAD + 3 * PITCH - ROAD / 2; // The middle crossing of the city.
      this.pl = { x: sx, y: sy, a: -Math.PI / 2, vx: 0, vy: 0, speed: 0, slide: 0, safe: 0, boost: 0 };
      this.cam = { x: sx, y: sy }; this.shake = 0;
      this.cops = []; this.coins = []; this.power = null; this.powerAt = 8;
      this.puffs = []; this.pops = [];
      this.keys = {}; this.stick = { down: false, base: null, x: 0, y: 0 };
      this.freeze = 0; this.siren = 0; this.sirenHi = false;
      this.field = new Int16Array(GN * GN); this.fieldAt = 0; this.map();
      while (this.coins.length < 7) this.addCoin();
      this.traffic = [];
      while (this.traffic.length < TRAFFIC) { const t = newTraffic(this.pl); if (t) this.traffic.push(t); }
      if (G) { G.marks.count = 0; G.markN = 0; }
    },

    /* ---------- Input ---------- */
    key(e, down) {
      const k = { ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r' }[e.code];
      if (k) this.keys[k] = down;
    },
    press(down) { this.stick.down = down; if (!down) this.stick.base = null; },
    point(p) {
      const s = this.stick;
      if (!s.down) return;
      if (!s.base) s.base = { x: p.x, y: p.y };
      let dx = (p.x - s.base.x) / 40, dy = (p.y - s.base.y) / 40;
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      s.x = dx; s.y = dy;
    },
    // Where the player wants to go: a direction and how much (0 to 1).
    wish() {
      const k = this.keys, kx = (k.r ? 1 : 0) - (k.l ? 1 : 0), ky = (k.d ? 1 : 0) - (k.u ? 1 : 0);
      if (kx || ky) return { a: Math.atan2(ky, kx), m: 1 };
      const s = this.stick, m = s.base ? Math.hypot(s.x, s.y) : 0;
      return m > 0.2 ? { a: Math.atan2(s.y, s.x), m: Math.min(1, m * 1.2) } : null;
    },

    /* ---------- Finding the way ---------- */
    // How many road cells every cell is from the player. The police drive "downhill" on this map.
    map() {
      const f = this.field, q = new Int32Array(GN * GN);
      f.fill(32767);
      const cx = clamp(Math.floor(this.pl.x / CELL), 0, GN - 1), cy = clamp(Math.floor(this.pl.y / CELL), 0, GN - 1);
      let head = 0, tail = 0;
      f[cy * GN + cx] = 0; q[tail++] = cy * GN + cx;
      while (head < tail) {
        const c = q[head++], x = c % GN, y = (c - x) / GN, d = f[c] + 1;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (!open(nx, ny) || f[ny * GN + nx] <= d) continue;
          f[ny * GN + nx] = d; q[tail++] = ny * GN + nx;
        }
      }
    },
    far(c) { const x = Math.floor(c.x / CELL), y = Math.floor(c.y / CELL); return open(x, y) ? this.field[y * GN + x] : 999; },
    // A random road spot at least `min` cells from the player, and out of sight if asked.
    spot(min, hidden) {
      for (let tries = 0; tries < 80; tries++) {
        const cx = Math.floor(rand(0, GN)), cy = Math.floor(rand(0, GN));
        if (!open(cx, cy)) continue;
        const d = this.field[cy * GN + cx], x = cx * CELL + CELL / 2, y = cy * CELL + CELL / 2;
        if (d < min || d > 900) continue;
        if (hidden && Math.hypot(x - this.cam.x, y - this.cam.y) < 480) continue;
        if (this.coins.some((c) => Math.hypot(c.x - x, c.y - y) < 60)) continue;
        return { x, y };
      }
      return null;
    },
    addCoin() { const s = this.spot(4, false); if (s) this.coins.push({ x: s.x, y: s.y, t: rand(0, 6) }); },
    addCop() {
      const s = this.spot(12, true);
      if (!s) return;
      this.cops.push({ x: s.x, y: s.y, a: Math.atan2(this.pl.y - s.y, this.pl.x - s.x), vx: 0, vy: 0, speed: 0, slide: 0, wreck: 0, spin: 0, stuck: 0, back: 0, flash: rand(0, 1) });
    },

    /* ---------- Game logic ---------- */
    update(dt) {
      if (!G) return; // Still downloading the 3D engine.
      this.clock += dt;
      this.shake = Math.max(0, this.shake - dt);
      this.tickBits(dt);
      if (this.freeze > 0) {
        this.freeze -= dt;
        if (this.freeze <= 0) {
          if (this.lives <= 0) return over(this.score, 'The police caught you after ' + Math.floor(this.t) + ' seconds. Score ' + this.score + '.');
          // Clear the police away from you and give you a head start.
          this.cops = this.cops.filter((c) => Math.hypot(c.x - this.pl.x, c.y - this.pl.y) > 320);
          this.pl.safe = SAFE;
        }
        return;
      }
      this.t += dt;
      const pl = this.pl;

      // You
      const w = this.wish(), spec = pl.boost > 0 ? BOOSTED : PLAYER;
      let throttle = 0;
      if (w) { throttle = w.m * (Math.abs(wrap(w.a - pl.a)) > 1.8 && pl.speed > 120 ? 0.2 : 1); }
      drive(pl, w ? w.a : null, throttle, false, dt, spec);
      if (bump(pl) > 120) { sfx.hit(); this.shake = 0.15; this.sparks(pl.x, pl.y); }
      pl.safe = Math.max(0, pl.safe - dt); pl.boost = Math.max(0, pl.boost - dt);
      this.skid(pl, dt);
      if (pl.boost > 0 && Math.random() < dt * 40) this.puff(pl.x - Math.cos(pl.a) * 16, pl.y - Math.sin(pl.a) * 16, Math.random() < 0.5 ? '#ffb347' : '#ff6b3a', 3, 0.3);

      // Camera: follows you and looks a little ahead.
      const k = 1 - Math.exp(-5 * dt);
      this.cam.x += (clamp(pl.x + pl.vx * 0.3, 160, WORLD - 160) - this.cam.x) * k;
      this.cam.y += (clamp(pl.y + pl.vy * 0.3, 160, WORLD - 160) - this.cam.y) * k;

      // Traffic
      for (const t of this.traffic) this.cruise(t, dt);

      // Police
      this.fieldAt -= dt;
      if (this.fieldAt <= 0) { this.map(); this.fieldAt = 0.2; }
      const want = Math.min(8, 1 + Math.floor(this.t / 15));
      if (this.t > 1 && this.cops.length < want && Math.random() < dt * 2) this.addCop();
      const cop = { acc: 270, max: Math.min(228, 165 + this.t * 0.5), turn: 3, grip: 4 };
      for (const c of this.cops) this.think(c, cop, dt);
      this.crashes();
      this.dodge(pl, true);
      for (const c of this.cops) this.dodge(c, false);

      // Caught?
      if (pl.safe <= 0 && this.cops.some((c) => !c.wreck && Math.hypot(c.x - pl.x, c.y - pl.y) < R * 2 - 2)) return this.busted();

      // Coins and the speed boost
      for (const c of this.coins) c.t += dt;
      this.coins = this.coins.filter((c) => {
        if (Math.hypot(c.x - pl.x, c.y - pl.y) > 24) return true;
        this.bonus += 50; this.pop(c.x, c.y, '+50', C.amber);
        sfx.tone(1320, 0.07, 'square', 0.04, 1760);
        return false;
      });
      while (this.coins.length < 7) this.addCoin();
      if (this.power) {
        this.power.t += dt;
        if (Math.hypot(this.power.x - pl.x, this.power.y - pl.y) < 26) {
          pl.boost = 3; this.power = null; this.powerAt = 14;
          this.pop(pl.x, pl.y, 'BOOST!', C.cyan); sfx.tone(300, 0.4, 'sawtooth', 0.04, 1200);
        }
      } else if ((this.powerAt -= dt) <= 0) {
        const s = this.spot(6, false);
        if (s) this.power = { x: s.x, y: s.y, t: 0 };
      }

      // Siren: a wail that gets louder as the nearest police car gets closer.
      const near = Math.min(...this.cops.filter((c) => !c.wreck).map((c) => Math.hypot(c.x - pl.x, c.y - pl.y)), 9999);
      if ((this.siren -= dt) <= 0 && near < 400) {
        this.siren = 0.5; this.sirenHi = !this.sirenHi;
        sfx.tone(this.sirenHi ? 940 : 700, 0.48, 'triangle', 0.012 + 0.03 * (1 - near / 400), this.sirenHi ? 700 : 940);
      }

      const score = Math.floor(this.t * 10) + this.bonus;
      if (score !== this.score) { this.score = score; setScore(score); }
    },
    // One traffic car: keep to its lane, wait behind the car in front, and turn at crossings.
    cruise(t, dt) {
      const ahead = t.axis === 0 ? [t.d, 0] : [0, t.d];
      let blocked = t.stop > 0;
      t.stop = Math.max(0, t.stop - dt);
      // Two cars waiting for each other at a crossing would wait forever, so after a while one just goes.
      if (t.go > 0) t.go -= dt;
      else for (const o of [...this.traffic, this.pl, ...this.cops]) {
        if (o === t) continue;
        const dx = o.x - t.x, dy = o.y - t.y, along = dx * ahead[0] + dy * ahead[1];
        if (along > 0 && along < 46 && Math.abs(dx * ahead[1] - dy * ahead[0]) < 16) { blocked = true; break; }
      }
      t.wait = blocked && !t.stop ? (t.wait || 0) + dt : 0;
      if (t.wait > 2.5) { t.go = 1; t.wait = 0; }
      t.speed += ((blocked ? 0 : t.want) - t.speed) * Math.min(1, dt * (blocked ? 8 : 1.5));
      t.s += t.d * t.speed * dt;
      const dec = t.dec;
      if (dec.tp === null) { if ((t.s - (dec.c + 30 * t.d)) * t.d >= 0) decide(t); }
      else if ((t.s - dec.tp) * t.d >= 0) {
        const s = t.lane;
        t.lane = dec.tp; t.s = s; t.axis = 1 - t.axis; t.d = dec.nd;
        decide(t);
      }
      t.x = t.axis === 0 ? t.s : t.lane; t.y = t.axis === 0 ? t.lane : t.s;
      const face = t.axis === 0 ? (t.d > 0 ? 0 : Math.PI) : (t.d > 0 ? Math.PI / 2 : -Math.PI / 2);
      t.a += wrap(face - t.a) * Math.min(1, dt * 10);
    },
    // Bump a car off the traffic. Police that hit traffic hard spin out.
    dodge(c, mine) {
      for (const t of this.traffic) {
        const dx = c.x - t.x, dy = c.y - t.y, d = Math.hypot(dx, dy);
        if (d >= R * 2 || d === 0) continue;
        const nx = dx / d, ny = dy / d;
        c.x += nx * (R * 2 - d); c.y += ny * (R * 2 - d);
        const vn = c.vx * nx + c.vy * ny;
        if (vn < 0) { c.vx -= 1.5 * vn * nx; c.vy -= 1.5 * vn * ny; }
        t.stop = 1.2;
        if (-vn > 110) {
          if (mine) { sfx.hit(); this.shake = 0.15; this.sparks(c.x - nx * R, c.y - ny * R); }
          else if (!c.wreck) { this.wreck(c, 2.5); this.bonus += 50; this.pop(c.x, c.y, 'CRASH +50', C.lime); }
        }
      }
    },
    // One police car: drive down the distance map towards you, or straight at you when close.
    think(c, spec, dt) {
      if (c.wreck > 0) {
        c.wreck -= dt; c.a += c.spin * dt; c.spin *= 1 - Math.min(1, 2 * dt);
        drive(c, null, 0, true, dt, spec); bump(c);
        if (Math.random() < dt * 12) this.puff(c.x, c.y, '#5a5e66', 5, 1.2);
        return;
      }
      const pl = this.pl;
      let aim;
      const gap = Math.hypot(pl.x - c.x, pl.y - c.y);
      if (gap < 150 && this.far(c) <= 4) aim = Math.atan2(pl.y + pl.vy * 0.25 - c.y, pl.x + pl.vx * 0.25 - c.x);
      else {
        let cx = Math.floor(c.x / CELL), cy = Math.floor(c.y / CELL);
        for (let s = 0; s < 2; s++) {
          let best = open(cx, cy) ? this.field[cy * GN + cx] : 32767, bx = cx, by = cy;
          for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
            if (open(nx, ny) && this.field[ny * GN + nx] < best) { best = this.field[ny * GN + nx]; bx = nx; by = ny; }
          }
          cx = bx; cy = by;
        }
        aim = Math.atan2(cy * CELL + CELL / 2 - c.y, cx * CELL + CELL / 2 - c.x);
      }
      // Stuck against a wall? Back up for a moment.
      if (c.back > 0) { c.back -= dt; drive(c, null, -1, false, dt, spec); }
      else {
        const turn = Math.abs(wrap(aim - c.a));
        drive(c, aim, turn > 1.1 ? 0.25 : 1, turn > 1.1 && c.speed > 110, dt, spec);
        c.stuck = c.speed < 25 ? c.stuck + dt : 0;
        if (c.stuck > 1) { c.back = 0.6; c.stuck = 0; }
      }
      const hit = bump(c);
      if (hit > 175) this.wreck(c, 2.5);
      this.skid(c, dt);
    },
    // Police cars that run into each other both spin out.
    crashes() {
      const cs = this.cops;
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i], b = cs[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= R * 2 || d === 0) continue;
        const nx = dx / d, ny = dy / d, push = (R * 2 - d) / 2;
        a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel > 0) { a.vx -= rel * nx; a.vy -= rel * ny; b.vx += rel * nx; b.vy += rel * ny; }
        if (rel > 120 && !a.wreck && !b.wreck) {
          this.wreck(a, 3); this.wreck(b, 3);
          this.bonus += 100; this.pop((a.x + b.x) / 2, (a.y + b.y) / 2, 'CRASH +100', C.lime);
        }
      }
    },
    wreck(c, secs) {
      c.wreck = secs; c.spin = rand(5, 9) * (Math.random() < 0.5 ? -1 : 1);
      this.sparks(c.x, c.y); sfx.tone(160, 0.3, 'sawtooth', 0.06, 50);
      if (Math.hypot(c.x - this.cam.x, c.y - this.cam.y) < 400) this.shake = Math.max(this.shake, 0.2);
    },
    busted() {
      const pl = this.pl;
      this.lives--; this.freeze = 1.3; this.shake = 0.5;
      pl.vx = 0; pl.vy = 0; pl.speed = 0;
      sfx.tone(600, 0.6, 'square', 0.05, 150);
    },

    /* ---------- Effects ---------- */
    skid(car, dt) {
      if (car.slide > 60 && car.speed > 90) {
        const c = Math.cos(car.a), n = Math.sin(car.a);
        for (const side of [-7, 7]) {
          const x = car.x - c * 10 - n * side, y = car.y - n * 10 + c * side;
          const last = side < 0 ? car.lastL : car.lastR;
          if (last) this.mark(last.x, last.y, x, y);
          if (side < 0) car.lastL = { x, y }; else car.lastR = { x, y };
        }
        if (Math.random() < dt * 20) this.puff(car.x - c * 12, car.y - n * 12, '#e4e6ea', 3, 0.6);
      } else { car.lastL = null; car.lastR = null; }
    },
    // A piece of skid mark on the road. The oldest pieces are reused once there are 800.
    mark(x1, y1, x2, y2) {
      const o = new T.Object3D(), len = Math.hypot(x2 - x1, y2 - y1);
      o.position.set((x1 + x2) / 2, 0.3, (y1 + y2) / 2); o.rotation.y = -Math.atan2(y2 - y1, x2 - x1); o.scale.set(len + 0.6, 1, 2.6);
      o.updateMatrix();
      G.marks.setMatrixAt(G.markN % 800, o.matrix); G.markN++;
      G.marks.count = Math.min(800, G.markN); G.marks.instanceMatrix.needsUpdate = true;
    },
    puff(x, y, col, r, life) { if (this.puffs.length < 70) this.puffs.push({ x, y, z: 6, vx: rand(-20, 20), vy: rand(-20, 20), r, col, life, max: life }); },
    sparks(x, y) { for (let k = 0; k < 10; k++) this.puff(x + rand(-8, 8), y + rand(-8, 8), Math.random() < 0.5 ? '#ffb347' : '#fff3c4', 1.5, 0.35); },
    pop(x, y, text, col) { this.pops.push({ x, y, h: 30, text, col, life: 1.1 }); },
    tickBits(dt) {
      for (const p of this.puffs) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += dt * 14; p.r += dt * 6; }
      this.puffs = this.puffs.filter((p) => p.life > 0);
      for (const p of this.pops) { p.life -= dt; p.h += dt * 40; }
      this.pops = this.pops.filter((p) => p.life > 0);
      for (const c of this.cops) c.flash += dt;
    },

    /* ---------- Drawing ---------- */
    draw() {
      const W = this.W, H = this.H;
      if (!G && T) build();
      if (!G) {
        ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = C.ink; ctx.font = font(12); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(failed ? "3D DIDN'T LOAD" : 'LOADING CITY...', W / 2, H / 2);
        if (failed) { ctx.font = font(8); ctx.fillStyle = C.muted; ctx.fillText('Check your connection and try again', W / 2, H / 2 + 24); }
        return;
      }
      // Put every 3D thing where the game logic says it is.
      const place = (o, c, lift) => { o.g.position.set(c.x, lift || 0, c.y); o.g.rotation.set(0, -c.a, 0); };
      const pl = this.pl;
      place(G.player, pl);
      G.player.g.visible = !(pl.safe > 0 && Math.floor(pl.safe * 10) % 2);
      while (G.cops.length < this.cops.length) G.cops.push(car(null, true));
      G.cops.forEach((o, i) => {
        const c = this.cops[i];
        o.g.visible = o.glow.visible = !!c;
        if (!c) return;
        place(o, c);
        if (c.wreck) o.g.rotation.z = Math.sin(this.clock * 30) * 0.05;
        const red = Math.floor(c.flash * 6) % 2 === 0, on = !c.wreck;
        o.red.color.set(on && red ? '#ff2a4a' : '#5a1520'); o.blue.color.set(on && !red ? '#2a5aff' : '#152048');
        o.glow.visible = on; o.glow.position.x = c.x; o.glow.position.z = c.y; o.glow.material.color.set(red ? '#ff2a4a' : '#2a5aff');
      });
      while (G.traffic.length < this.traffic.length) G.traffic.push(car(this.traffic[G.traffic.length].col, false));
      G.traffic.forEach((o, i) => { const t = this.traffic[i]; o.g.visible = !!t; if (t) place(o, t); });
      G.coins.forEach((m, i) => {
        const c = this.coins[i];
        m.visible = !!c;
        if (c) { m.position.set(c.x, 10 + Math.sin(c.t * 3) * 2, c.y); m.rotation.y = c.t * 3; }
      });
      G.power.visible = !!this.power;
      if (this.power) { G.power.position.set(this.power.x, 13 + Math.sin(this.power.t * 4) * 3, this.power.y); G.power.rotation.y = this.power.t * 2; }
      G.puffs.forEach((m, i) => {
        const p = this.puffs[i];
        m.visible = !!p;
        if (p) { m.position.set(p.x, p.z, p.y); m.scale.setScalar(p.r); m.material.color.set(p.col); m.material.opacity = Math.max(0, p.life / p.max) * 0.85; }
      });

      // Camera: high up and behind, tilted down at the street you're on.
      const sh = this.shake > 0 ? this.shake * 10 : 0, cx = this.cam.x + rand(-sh, sh), cz = this.cam.y + rand(-sh, sh);
      G.cam.position.set(cx, 680, cz + 380); G.cam.lookAt(cx, 0, cz - 20);
      G.sun.position.set(cx - 260, 620, cz - 300); G.sun.target.position.set(cx, 0, cz); G.sun.target.updateMatrixWorld();

      // Render, then copy the picture onto the arcade's canvas and draw the flat bits on top.
      const cw = Math.min(ctx.canvas.width, 900), ch = Math.round(cw * H / W);
      if (G.cw !== cw) { G.cw = cw; G.r.setSize(cw, ch, false); }
      G.r.render(G.scene, G.cam);
      ctx.drawImage(G.r.domElement, 0, 0, W, H);

      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = font(10);
      for (const p of this.pops) {
        const s = this.screen(p.x, p.h, p.y);
        ctx.globalAlpha = Math.min(1, p.life * 2);
        ctx.fillStyle = '#15111f'; ctx.fillText(p.text, s.x + 2, s.y + 2);
        ctx.fillStyle = p.col; ctx.fillText(p.text, s.x, s.y);
      }
      ctx.globalAlpha = 1;
      const s = this.stick;
      if (s.base) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(s.base.x, s.base.y, 42, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath(); ctx.arc(s.base.x + s.x * 40, s.base.y + s.y * 40, 18, 0, Math.PI * 2); ctx.fill();
      }
      this.arrows();
      this.hud();
    },
    // Where a 3D point (game x, height, game y) lands on the screen.
    screen(x, h, y) {
      const v = G.v.set(x, h, y).project(G.cam);
      return { x: (v.x + 1) / 2 * this.W, y: (1 - v.y) / 2 * this.H, behind: v.z > 1 };
    },
    // Little arrows at the edge of the screen pointing at police cars you can't see.
    arrows() {
      const W = this.W, H = this.H;
      for (const c of this.cops) {
        if (c.wreck) continue;
        const p = this.screen(c.x, 10, c.y);
        if (!p.behind && p.x > 0 && p.x < W && p.y > 0 && p.y < H) continue;
        let sx = p.x - W / 2, sy = p.y - H / 2;
        if (p.behind) { sx = -sx; sy = -sy; }
        const k = Math.min((W / 2 - 16) / Math.abs(sx || 1e-6), (H / 2 - 16) / Math.abs(sy || 1e-6));
        ctx.save(); ctx.translate(W / 2 + sx * k, H / 2 + sy * k); ctx.rotate(Math.atan2(sy, sx));
        ctx.fillStyle = '#15111f'; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-9, -10); ctx.lineTo(-4, 0); ctx.lineTo(-9, 10); ctx.closePath(); ctx.fill();
        ctx.fillStyle = Math.floor(c.flash * 6) % 2 ? '#4f7dff' : '#ff3b5c';
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-7, -7); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    },
    hud() {
      const W = this.W, H = this.H;
      ctx.fillStyle = 'rgba(21,17,31,0.55)'; ctx.fillRect(6, 6, 82, 30); ctx.fillRect(W - 110, 6, 104, 30);
      // Lives as hearts, top left.
      for (let k = 0; k < LIVES; k++) {
        const x = 22 + k * 24, y = 20;
        ctx.fillStyle = k < this.lives ? C.pink : 'rgba(255,255,255,0.25)';
        ctx.beginPath(); ctx.arc(x - 4, y - 2, 5, 0, Math.PI * 2); ctx.arc(x + 4, y - 2, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.lineTo(x, y + 9); ctx.closePath(); ctx.fill();
      }
      // Wanted level: stars for how many police cars are hunting you.
      const stars = Math.min(5, Math.ceil(this.cops.length * 5 / 8));
      for (let k = 0; k < 5; k++) {
        const x = W - 20 - k * 20, y = 21;
        ctx.fillStyle = 4 - k < stars ? C.amber : 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        for (let p = 0; p < 10; p++) { const r = p % 2 ? 3.5 : 8.5, a = -Math.PI / 2 + p * Math.PI / 5; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
        ctx.closePath(); ctx.fill();
      }
      if (this.pl.boost > 0) {
        ctx.fillStyle = 'rgba(21,17,31,0.55)'; ctx.fillRect(6, 40, 82, 10);
        ctx.fillStyle = C.cyan; ctx.fillRect(8, 42, 78 * this.pl.boost / 3, 6);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const big = (text, col) => { ctx.font = font(22); ctx.fillStyle = '#15111f'; ctx.fillText(text, W / 2 + 3, H / 2 - 117); ctx.fillStyle = col; ctx.fillText(text, W / 2, H / 2 - 120); };
      if (this.freeze > 0) big('BUSTED!', C.pink);
      else if (this.t < 1.6) big('GET AWAY!', C.amber);
    },
  };

  Arcade.register('chase', chase);
})();
