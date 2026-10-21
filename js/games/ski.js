/* Endless Ski. Loaded on demand by js/arcade.js the first time the game is opened.
   A 3D-looking run down an endless mountain, seen from just behind the skier.
   The slope is cut into thin strips that are drawn from near to far, like old racing games,
   so it can bend left and right and roll over bumps. Trees, rocks and clouds are painted once
   into small pictures at the start, then drawn bigger or smaller depending on how far away they are.
   The further you get, the sky goes from day to sunset to a night with northern lights, and back.
   World units are metres: x is left/right, y is up, z is how far down the mountain. */
(() => {
  const { ctx, rand, clamp, font, shuffle, sfx, setScore, over } = Arcade;

  const W = 400, H = 600;
  const SEG = 3;                    // Length of one strip of slope.
  const DRAW = 100;                 // Strips drawn ahead (300 m).
  const FAR = SEG * DRAW;
  const F = 560;                    // Camera lens: how many pixels 1 m is at 1 m away.
  const HOR = 150;                  // Eye level on screen.
  const SLOPE = 0.15;               // The mountain drops 15 cm every metre...
  const VALLEY = HOR + SLOPE * F;   // ...so the valley floor shows up here, below eye level.
  const BACK = 11, UP = 6;          // Camera position behind and above the skier.
  const CYCLE = 1800;               // Metres from one morning to the next.
  const RAMP_EVERY = 280;           // At least this far between snow ramps.

  /* ---------- The mountain ---------- */
  // The piste winds left and right and rolls over bumps. Each run gets new random bends.
  let ph = [0, 0, 0, 0];
  const center = (z) => 40 * Math.sin(z / 180 + ph[0]) + 15 * Math.sin(z / 110 + ph[1]);
  const ground = (z) => -SLOPE * z + 2.5 * Math.sin(z / 60 + ph[2]) + 1.2 * Math.sin(z / 23 + ph[3]);
  const halfWidth = (z) => 8 - 2 * clamp(z / 5000, 0, 1) + 1.5 * Math.sin(z / 140);
  const level = (z) => clamp(z / 5000, 0, 1); // 0 at the top, 1 after 5 km.
  const cruise = (z) => 14 + 26 * (1 - Math.exp(-z / 2600)); // Speed the skier settles at, in m/s.

  /* ---------- Colours ---------- */
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const css = (c, a) => (a === undefined ? 'rgb(' : 'rgba(') + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + (a === undefined ? ')' : ',' + a + ')');
  const PISTE = hex('#f4f8ff'), POWDER = hex('#e1e9f7'), EDGE = hex('#c3cfe6'), TRACK = hex('#b4c2dc');

  // The time of day, as stops along CYCLE. tint picks the picture set for trees and rocks: 0 day, 1 sunset, 2 night.
  const SKY = [
    { at: 0.00, top: '#3a84d6', bot: '#cfe8fb', fog: '#dcebf7', sun: '#fff4cf', far: '#a9bfdc', mid: '#7f9cc8', near: '#4f7198', cap: '#ffffff', light: '#ffffff', sunX: 300, sunY: 60, night: 0, tint: 0 },
    { at: 0.30, top: '#3a84d6', bot: '#d7ecfb', fog: '#e0edf7', sun: '#fff1c4', far: '#a9bfdc', mid: '#7f9cc8', near: '#4f7198', cap: '#ffffff', light: '#ffffff', sunX: 300, sunY: 105, night: 0, tint: 0 },
    { at: 0.42, top: '#4a6db5', bot: '#ffd3a1', fog: '#f6dcc4', sun: '#ffd27a', far: '#d4b0b8', mid: '#a587a8', near: '#6b5a86', cap: '#fff0dc', light: '#fff0dd', sunX: 300, sunY: 170, night: 0, tint: 0.6 },
    { at: 0.52, top: '#2e2f78', bot: '#ff8a5c', fog: '#ee9f8c', sun: '#ff7a45', far: '#9a6a92', mid: '#6f4b7e', near: '#3f3060', cap: '#ffc9b0', light: '#ffc7b3', sunX: 300, sunY: 196, night: 0, tint: 1 },
    { at: 0.62, top: '#040714', bot: '#14224a', fog: '#1a2647', sun: '#14224a', far: '#1f2b52', mid: '#18213f', near: '#0f1530', cap: '#7f90c0', light: '#6a7db8', sunX: 300, sunY: 320, night: 1, tint: 2 },
    { at: 0.86, top: '#040714', bot: '#14224a', fog: '#1a2647', sun: '#14224a', far: '#1f2b52', mid: '#18213f', near: '#0f1530', cap: '#7f90c0', light: '#6a7db8', sunX: 100, sunY: 320, night: 1, tint: 2 },
    { at: 0.94, top: '#3f4d93', bot: '#f7b8b0', fog: '#e8c6c6', sun: '#ffb59a', far: '#b39bbd', mid: '#8a7aa8', near: '#56507e', cap: '#ffe6e0', light: '#ffd9d2', sunX: 100, sunY: 190, night: 0, tint: 1 },
  ].map((k) => { const o = {}; for (const key in k) o[key] = typeof k[key] === 'string' ? hex(k[key]) : k[key]; return o; });
  SKY.push({ ...SKY[0], at: 1 });
  const L = {}; // The current mix of SKY stops, worked out once per frame.
  function daylight(t) {
    let i = 0; while (SKY[i + 1].at <= t) i++;
    const a = SKY[i], b = SKY[i + 1], f = (t - a.at) / (b.at - a.at), e = f * f * (3 - 2 * f);
    for (const key in a) if (key !== 'at') L[key] = typeof a[key] === 'number' ? a[key] + (b[key] - a[key]) * e : mix(a[key], b[key], e);
  }
  const lit = (h, k = 1) => { const c = hexCache[h] || (hexCache[h] = hex(h)); return css([c[0] * L.light[0] / 255 * k, c[1] * L.light[1] / 255 * k, c[2] * L.light[2] / 255 * k]); };
  const hexCache = {};

  /* ---------- Pictures painted once ---------- */
  const bake = (w, h, paint) => { const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h); return c; };
  // Every picture also gets a sunset and a night copy, so the trees match the sky.
  const TINTS = ['#ffc4ae', '#56689f'];
  const tinted = (base) => [base, ...TINTS.map((t) => bake(base.width, base.height, (g) => {
    g.drawImage(base, 0, 0);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = t; g.fillRect(0, 0, base.width, base.height);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(base, 0, 0);
  }))];
  function shadow(g, x, y, rx, ry, a = 0.45) {
    g.save(); g.translate(x, y); g.scale(1, ry / rx);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    gr.addColorStop(0, 'rgba(60,80,140,' + a + ')'); gr.addColorStop(1, 'rgba(60,80,140,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, 7); g.fill(); g.restore();
  }
  function ellipse(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill(); }

  // A snowy pine. The ground is at FOOT of the picture's height.
  const PINE_FOOT = 318 / 340;
  function paintPine(g, w, h, tiers, spread) {
    const cx = w / 2, foot = h - 22, top = 8, fb = foot - 26, hf = fb - top;
    shadow(g, cx + 14, foot, w * 0.46, 16);
    g.fillStyle = '#ffffff'; ellipse(g, cx, foot - 3, w * 0.2, 8);
    const tg = g.createLinearGradient(cx - 8, 0, cx + 8, 0); tg.addColorStop(0, '#80502e'); tg.addColorStop(1, '#3a2213');
    g.fillStyle = tg; g.fillRect(cx - 7, fb - 24, 14, foot - fb + 20);
    for (let i = 0; i < tiers; i++) {
      const p = i / tiers, yb = fb - hf * p * 0.8, yt = i === tiers - 1 ? top : yb - hf * (0.45 - 0.1 * p);
      const hw = w * spread * (1 - 0.75 * p), mid = (t) => yt + (yb - yt) * t;
      // Needles: a cone with a notch on each side and a ragged bottom edge.
      g.beginPath(); g.moveTo(cx, yt);
      g.lineTo(cx + hw * 0.52, mid(0.46)); g.lineTo(cx + hw * 0.38, mid(0.52)); g.lineTo(cx + hw, yb);
      const n = 7;
      for (let j = 1; j <= n; j++) { const x = cx + hw - (2 * hw * j) / n; g.lineTo(x + hw / n, yb - rand(5, 11)); g.lineTo(x, yb + rand(-1, 3)); }
      g.lineTo(cx - hw * 0.38, mid(0.52)); g.lineTo(cx - hw * 0.52, mid(0.46)); g.closePath();
      const ng = g.createLinearGradient(cx - hw, yt, cx + hw, yb);
      ng.addColorStop(0, '#428f63'); ng.addColorStop(0.5, '#245f40'); ng.addColorStop(1, '#10321f');
      g.fillStyle = ng; g.fill();
      // Snow lying on the upper part of the branches, drooping in little drips.
      const lx = cx - hw * 0.66, ly = mid(0.68), rx = cx + hw * 0.46, ry = mid(0.42), m = 6;
      g.beginPath(); g.moveTo(cx, yt - 1); g.lineTo(cx - hw * 0.5, mid(0.44) - 1); g.lineTo(lx, ly);
      for (let j = 1; j <= m; j++) {
        const x = lx + ((rx - lx) * j) / m, y = ly + ((ry - ly) * j) / m;
        g.lineTo(x - (rx - lx) / m / 2, y + rand(3, 9)); g.lineTo(x, y - rand(0, 3));
      }
      g.closePath();
      const sg = g.createLinearGradient(0, yt, 0, ly + 8); sg.addColorStop(0, '#ffffff'); sg.addColorStop(1, '#d6e2f6');
      g.fillStyle = sg; g.fill();
      const shade = g.createLinearGradient(cx - hw * 0.3, 0, rx, 0); shade.addColorStop(0, 'rgba(120,145,205,0)'); shade.addColorStop(1, 'rgba(120,145,205,0.45)');
      g.fillStyle = shade; g.fill();
    }
  }
  const ROCK_FOOT = 104 / 120;
  function paintRock(g, w, h) {
    const cx = w / 2, foot = h - 16, n = 11, pts = [];
    shadow(g, cx + 10, foot, w * 0.48, 13);
    for (let i = 0; i < n; i++) { const a = Math.PI + (i / (n - 1)) * Math.PI, r = rand(0.82, 1.05); pts.push([cx + Math.cos(a) * w * 0.4 * r, foot + Math.sin(a) * (h - 32) * r]); }
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    const rg = g.createLinearGradient(cx - w * 0.3, 12, cx + w * 0.35, foot);
    rg.addColorStop(0, '#9aa2bd'); rg.addColorStop(0.5, '#555c7c'); rg.addColorStop(1, '#2a2e47');
    g.fillStyle = rg; g.fill();
    g.strokeStyle = 'rgba(30,32,55,0.5)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(pts[4][0], pts[4][1] + 6); g.lineTo(cx + 6, foot - 30); g.lineTo(cx + 18, foot - 6); g.stroke();
    // Snow cap.
    g.beginPath(); g.moveTo(pts[2][0], pts[2][1] + 2);
    for (let i = 3; i <= n - 3; i++) g.lineTo(pts[i][0], pts[i][1] - 2);
    for (let i = n - 3; i >= 2; i--) g.lineTo(pts[i][0] + rand(-4, 4), pts[i][1] + rand(9, 20));
    g.closePath();
    const sg = g.createLinearGradient(cx - 30, 0, cx + 40, 0); sg.addColorStop(0, '#ffffff'); sg.addColorStop(1, '#c9d6ee');
    g.fillStyle = sg; g.fill();
    g.fillStyle = '#f4f8ff'; ellipse(g, cx, foot, w * 0.43, 7);
  }
  function paintCloud(g, w, h) {
    for (let i = 0; i < 9; i++) {
      const x = rand(w * 0.2, w * 0.8), y = rand(h * 0.45, h * 0.65), r = rand(h * 0.22, h * 0.42) * (1 - Math.abs(x / w - 0.5));
      const gr = g.createRadialGradient(x, y, 0, x, y, r * 1.6);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
    g.globalCompositeOperation = 'source-atop';
    const sh = g.createLinearGradient(0, h * 0.35, 0, h); sh.addColorStop(0, 'rgba(190,205,235,0)'); sh.addColorStop(1, 'rgba(170,185,225,0.9)');
    g.fillStyle = sh; g.fillRect(0, 0, w, h);
  }
  function paintCoin(g, w) {
    const r = w / 2 - 3, c = w / 2;
    const gr = g.createRadialGradient(c - 8, c - 8, 2, c, c, r);
    gr.addColorStop(0, '#fff7b8'); gr.addColorStop(0.5, '#ffc93c'); gr.addColorStop(1, '#c98410');
    g.fillStyle = gr; g.beginPath(); g.arc(c, c, r, 0, 7); g.fill();
    g.strokeStyle = '#9c6408'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = '#e8a521'; g.lineWidth = 3; g.beginPath(); g.arc(c, c, r * 0.72, 0, 7); g.stroke();
    g.fillStyle = '#fff0a0'; g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.25 : r * 0.55; g.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr); }
    g.fill();
  }
  const dot = (rgb) => bake(32, 32, (g) => {
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(' + rgb + ',1)'); gr.addColorStop(0.4, 'rgba(' + rgb + ',0.8)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  });

  let ART = null; // Painted the first time the game is drawn.
  function paintArt() {
    ART = {
      pines: [[5, 0.44], [6, 0.4], [4, 0.47]].map(([t, s]) => tinted(bake(200, 340, (g, w, h) => paintPine(g, w, h, t, s)))),
      rocks: [0, 1].map(() => tinted(bake(180, 120, paintRock))),
      clouds: [0, 1, 2].map(() => tinted(bake(260, 100, paintCloud))),
      coin: bake(64, 64, paintCoin),
      snow: dot('255,255,255'), gold: dot('255,214,90'),
    };
  }

  /* ---------- Background ---------- */
  // Mountain ridges made of sharp sine peaks. P is how wide a ridge is before it repeats.
  const P = 1200;
  function ridge(parts, jag) {
    const ph2 = parts.map(() => rand(0, 6.3)), out = new Float32Array(P / 4);
    for (let i = 0; i < out.length; i++) {
      const x = i * 4; let h = 0;
      parts.forEach(([m, a], j) => { h += a * (1 - Math.abs(Math.sin((Math.PI * m * x) / P + ph2[j]))); });
      if (jag) h += (i % 2) * jag + Math.random() * jag; // Little spikes look like a forest on the ridge.
      out[i] = h;
    }
    return out;
  }
  const RIDGES = [
    { h: ridge([[2, 58], [3, 34], [5, 18], [9, 8]]), lift: 38, move: 0.3, key: 'far', snow: true },
    { h: ridge([[3, 34], [5, 22], [8, 12], [13, 5]]), lift: 18, move: 0.6, key: 'mid', snow: true },
    { h: ridge([[2, 10], [5, 8], [11, 4]], 3), lift: 6, move: 1.2, key: 'near', snow: false },
  ];
  const STARS = Array.from({ length: 70 }, () => ({ x: rand(0, W), y: rand(0, VALLEY - 50), s: Math.random() < 0.2 ? 2 : 1, p: rand(0, 6.3) }));
  const vignette = (() => {
    const g = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.32, W / 2, H * 0.55, H * 0.85);
    g.addColorStop(0, 'rgba(6,8,30,0)'); g.addColorStop(1, 'rgba(6,8,30,1)');
    return g;
  })();

  /* ---------- Sound ----------
     Short bursts made with Web Audio, scheduled from update(), so they stop by themselves on pause or game over. */
  const snd = {
    noise: null,
    ready() { return sfx.on && sfx.ac && sfx.ac.state === 'running'; },
    out(vol, when, dur) {
      const g = sfx.ac.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(vol, when + Math.min(0.03, dur / 3));
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      g.connect(sfx.ac.destination);
      return g;
    },
    note(f, dur, type, vol, when, to) {
      if (!this.ready()) return;
      try {
        const t = when || sfx.ac.currentTime, o = sfx.ac.createOscillator();
        o.type = type; o.frequency.setValueAtTime(f, t);
        if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
        o.connect(this.out(vol, t, dur)); o.start(t); o.stop(t + dur + 0.02);
      } catch (e) {}
    },
    hiss(dur, vol, kind, f, to) {
      if (!this.ready()) return;
      try {
        const ac = sfx.ac, t = ac.currentTime;
        if (!this.noise) {
          this.noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
          const d = this.noise.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        const src = ac.createBufferSource(), flt = ac.createBiquadFilter();
        src.buffer = this.noise; src.loop = true;
        flt.type = kind; flt.frequency.setValueAtTime(f, t);
        if (to) flt.frequency.exponentialRampToValueAtTime(to, t + dur);
        src.connect(flt); flt.connect(this.out(vol, t, dur));
        src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
      } catch (e) {}
    },
    coin() { if (!this.ready()) return; const t = sfx.ac.currentTime; this.note(988, 0.08, 'square', 0.03, t); this.note(1319, 0.18, 'square', 0.03, t + 0.07); },
    jump() { this.hiss(0.35, 0.07, 'bandpass', 500, 2800); this.note(440, 0.2, 'triangle', 0.04, 0, 880); },
    land() { this.note(140, 0.14, 'sine', 0.12, 0, 55); this.hiss(0.14, 0.06, 'lowpass', 600); },
    crash() { this.hiss(0.5, 0.15, 'lowpass', 1800, 150); this.note(110, 0.35, 'square', 0.05, 0, 40); },
    trick() { if (!this.ready()) return; const t = sfx.ac.currentTime; [784, 988, 1175, 1568].forEach((f, i) => this.note(f, 0.1, 'square', 0.025, t + i * 0.06)); },
  };

  /* ---------- Drawing helpers ---------- */
  // proj() turns a world point into screen x, y and the size of 1 m there (PS).
  let cam = { x: 0, y: 0, z: 0 }, PX = 0, PY = 0, PS = 0;
  function proj(x, y, z) { PS = F / Math.max(z - cam.z, 0.3); PX = W / 2 + (x - cam.x) * PS; PY = HOR + (cam.y - y) * PS; }
  let TA = 0, TM = 0; // Which tinted copies to draw, and how much of the second one.
  function sprite(set, x, z, hm, foot, clipY, alpha) {
    proj(x, ground(z), z);
    const img = set[0], hp = hm * PS;
    if (hp < 1.2) return;
    const wp = (hp * img.width) / img.height, top = PY - hp * foot, left = PX - wp / 2;
    if (left > W || left + wp < 0 || top > H) return;
    let frac = 1;
    if (top + hp > clipY) { frac = (clipY - top) / hp; if (frac <= 0) return; } // Partly hidden behind a nearer bump.
    const sh = img.height * frac;
    if (TM < 0.99) { ctx.globalAlpha = alpha; ctx.drawImage(set[TA], 0, 0, img.width, sh, left, top, wp, hp * frac); }
    if (TM > 0.01) { ctx.globalAlpha = alpha * (TM < 0.99 ? TM : 1); ctx.drawImage(set[TA + 1], 0, 0, img.width, sh, left, top, wp, hp * frac); }
    ctx.globalAlpha = 1;
  }
  const fade = (z) => 1 - clamp((z - cam.z - FAR * 0.7) / (FAR * 0.3), 0, 1); // Far things fade in instead of popping up.

  // A skier seen from behind. o.lean tips the body into the turn, o.yaw points the skis.
  function drawSkier(x, y, s, o) {
    const c = o.col;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    if (o.spin) ctx.scale(Math.cos(o.spin), 1);
    ctx.rotate(o.lean);
    const k = o.crouch, sp = 0.14, hip = -0.7 + k, sh = -1.18 + k * 1.3;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const side of [-1, 1]) {
      const bx = side * sp, tx = bx + o.yaw * 0.4;
      ctx.fillStyle = lit(c.ski, 0.7);
      ctx.beginPath(); ctx.moveTo(bx - 0.05, 0.3); ctx.lineTo(bx + 0.05, 0.3); ctx.lineTo(tx + 0.035, -0.55); ctx.quadraticCurveTo(tx, -0.68, tx - 0.035, -0.55); ctx.closePath(); ctx.fill();
      ctx.fillStyle = lit(c.ski);
      ctx.beginPath(); ctx.moveTo(bx - 0.03, 0.28); ctx.lineTo(bx + 0.02, 0.28); ctx.lineTo(tx + 0.01, -0.55); ctx.lineTo(tx - 0.025, -0.55); ctx.closePath(); ctx.fill();
    }
    // Poles, then legs.
    ctx.strokeStyle = lit('#c7cbe0'); ctx.lineWidth = 0.025;
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(side * 0.3, hip + 0.02); ctx.lineTo(side * 0.47, 0.16); ctx.stroke(); }
    ctx.strokeStyle = lit(c.pants); ctx.lineWidth = 0.15;
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(side * sp, -0.08); ctx.lineTo(side * (sp + 0.035), -0.42 + k * 0.6); ctx.lineTo(side * 0.1, hip); ctx.stroke(); }
    ctx.fillStyle = lit('#2a2d3e');
    for (const side of [-1, 1]) ctx.fillRect(side * sp - 0.065, -0.16, 0.13, 0.15);
    // Jacket, with a stripe and a race bib.
    ctx.beginPath(); ctx.moveTo(-0.17, hip + 0.04); ctx.lineTo(-0.235, sh + 0.06); ctx.quadraticCurveTo(0, sh - 0.08, 0.235, sh + 0.06); ctx.lineTo(0.17, hip + 0.04); ctx.closePath();
    const jg = ctx.createLinearGradient(-0.24, 0, 0.24, 0); jg.addColorStop(0, lit(c.jacket, 1.15)); jg.addColorStop(1, lit(c.jacket, 0.72));
    ctx.fillStyle = jg; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = lit(c.trim); ctx.fillRect(-0.3, sh + 0.12, 0.6, 0.06);
    if (o.bib) { ctx.fillStyle = lit('#ffffff', 0.95); ctx.fillRect(-0.1, sh + 0.21, 0.2, 0.17); ctx.fillStyle = lit(c.jacket, 0.6); ctx.fillRect(-0.02, sh + 0.24, 0.04, 0.11); }
    ctx.restore();
    // Arms and gloves.
    ctx.strokeStyle = lit(c.jacket, 0.82); ctx.lineWidth = 0.1;
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(side * 0.2, sh + 0.06); ctx.lineTo(side * 0.34, sh + 0.3); ctx.lineTo(side * 0.3, hip + 0.02); ctx.stroke(); }
    ctx.fillStyle = lit('#2a2d3e');
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(side * 0.3, hip + 0.02, 0.05, 0, 7); ctx.fill(); }
    // Head in a bobble hat.
    ctx.fillStyle = lit('#f0c9a8', 0.85); ctx.fillRect(-0.05, sh - 0.1, 0.1, 0.08);
    const hy = sh - 0.2;
    const hg = ctx.createLinearGradient(-0.13, 0, 0.13, 0); hg.addColorStop(0, lit(c.hat, 1.1)); hg.addColorStop(1, lit(c.hat, 0.7));
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, hy, 0.13, 0, 7); ctx.fill();
    ctx.fillStyle = lit(c.trim); ctx.fillRect(-0.13, hy + 0.02, 0.26, 0.06);
    ctx.fillStyle = lit('#ffffff', 0.95); ctx.beginPath(); ctx.arc(0, hy - 0.15, 0.065, 0, 7); ctx.fill();
    ctx.restore();
  }
  const ME = { jacket: '#ff6b9a', trim: '#5ce1e6', pants: '#2b2340', hat: '#ffb347', ski: '#5ce1e6' };
  const OTHERS = [
    { jacket: '#b8e65c', trim: '#2b2340', pants: '#3a4a6a', hat: '#ff6b9a', ski: '#ffb347' },
    { jacket: '#a78bfa', trim: '#ffffff', pants: '#1f2335', hat: '#5ce1e6', ski: '#ff6b9a' },
    { jacket: '#ffb347', trim: '#2b2340', pants: '#26304a', hat: '#a78bfa', ski: '#b8e65c' },
    { jacket: '#e84a4a', trim: '#ffffff', pants: '#202020', hat: '#ffffff', ski: '#ffd84a' },
  ];

  /* ---------- The game ---------- */
  const strip = { x: new Float32Array(DRAW + 1), y: new Float32Array(DRAW + 1), w: new Float32Array(DRAW + 1), g: new Float32Array(DRAW + 1), clip: new Float32Array(DRAW + 1) };

  const ski = {
    W, H, color: 'var(--violet)', title: 'Endless Ski', label: 'Score',
    quietScore: true, // The score goes up every metre, so coins get their own chime instead.
    intro: 'Steer down an endless mountain. Dodge the trees, rocks and other skiers, grab the coins and fly off the snow ramps.',
    hint: '<kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> to steer. On a phone, hold the left or right side of the screen. <kbd>P</kbd> to pause',

    reset() {
      ph = ph.map(() => rand(0, 6.3));
      this.pz = 0; this.px = center(0); this.vx = 0; this.v = 10;
      this.h = 0; this.vy = 0; this.air = false; this.airT = 0; this.spin = 0; this.ramp = null;
      cam = { x: this.px, y: ground(0) + UP, z: -BACK };
      this.objs = []; this.riders = []; this.parts = []; this.pops = []; this.trail = []; this.trailZ = -1;
      this.genStrip = Math.floor(-BACK / SEG); this.nextRow = 70; this.lastRamp = 0; this.riderT = 6;
      this.coins = 0; this.bonus = 0; this.score = 0; this.t = 0; this.crash = null; this.shake = 0; this.sndT = 0;
      this.left = this.right = this.touch = false; this.tx = W / 2;
      this.flakes = Array.from({ length: 90 }, () => this.flake({}, rand(1, 45)));
      this.gen(FAR + 20);
    },
    flake(f, z) { f.x = rand(-16, 16); f.y = rand(-6, 12); f.z = z; f.s = rand(0.03, 0.07); return f; },

    key(e, down) {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.left = down;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.right = down;
    },
    press(down) { this.touch = down; },
    point(p) { this.tx = p.x; },

    /* ----- Building the mountain ahead ----- */
    add(kind, x, z) {
      if (kind === 'pine') { const v = (Math.random() * 3) | 0, sc = rand(0.8, 1.3); this.objs.push({ kind, x, z, v, hm: [5.6, 6.4, 4.8][v] * sc, r: 0.75 * sc, tall: 5 }); }
      else if (kind === 'rock') { const sc = rand(0.75, 1.3); this.objs.push({ kind, x, z, v: (Math.random() * 2) | 0, hm: 1.35 * sc, r: 0.8 * sc, tall: 1.05 * sc }); }
    },
    gen(upto) {
      let added = false;
      while (this.genStrip * SEG < upto) {
        const i = this.genStrip++, z = i * SEG, c = center(z), hw = halfWidth(z);
        for (const side of [-1, 1]) {
          if (Math.random() < 0.8) this.add('pine', c + side * (hw + 1.8 + Math.pow(Math.random(), 1.6) * 30), z + rand(0, SEG));
          if (Math.random() < 0.35) this.add('pine', c + side * (hw + 8 + Math.random() * 40), z + rand(0, SEG));
          if (i % 8 === 0) this.objs.push({ kind: 'pole', x: c + side * (hw + 0.5), z, side });
        }
        if (z >= this.nextRow) this.row(z);
        added = true;
      }
      if (added) this.objs.sort((a, b) => a.z - b.z);
    },
    row(z) {
      const d = level(z), c = center(z), hw = halfWidth(z), r = Math.random();
      this.nextRow = z + rand(1, 1.4) * (36 - 20 * d);
      if (z - this.lastRamp > RAMP_EVERY && r < 0.3) {
        // A snow ramp, with a line of coins up in the air where the jump goes.
        const off = rand(-hw + 2.5, hw - 2.5), v = cruise(z), up = 5 + v * 0.12;
        this.objs.push({ kind: 'ramp', x: c + off, z, w: 1.6, len: 4, hgt: 1.1 });
        for (let j = 0; j < 8; j++) {
          const dz = 3 + j * 4.5, t = dz / v, hh = 1.1 + up * t - 11 * t * t;
          if (hh < 0.5) break;
          this.objs.push({ kind: 'coin', x: center(z + 4 + dz) + off, z: z + 4 + dz, y: hh });
        }
        this.lastRamp = z; this.nextRow = z + 50;
        return;
      }
      if (r < 0.32 - d * 0.12) {
        const off = rand(-hw + 1.2, hw - 1.2);
        for (let j = 0; j < 6; j++) { const zz = z + j * 4; this.objs.push({ kind: 'coin', x: center(zz) + off, z: zz, y: 0.7 }); }
        return;
      }
      // A row of trees and rocks across the piste, always with a gap wide enough to get through.
      const n = Math.max(4, Math.floor((hw * 2) / 2.2)), want = 1 + Math.floor(Math.random() * (1 + d * 2.6));
      const taken = shuffle([...Array(n).keys()]).slice(0, Math.min(want, n - 2));
      const free = (s) => !taken.includes(s);
      while (taken.length && ![...Array(n - 1).keys()].some((s) => free(s) && free(s + 1))) taken.pop();
      for (const s of taken) this.add(Math.random() < 0.55 ? 'pine' : 'rock', c - hw + (s + 0.5) * ((2 * hw) / n) + rand(-0.3, 0.3), z + rand(-1, 1));
      if (Math.random() < 0.3) {
        const s = [...Array(n).keys()].find(free);
        if (s !== undefined) this.objs.push({ kind: 'coin', x: c - hw + (s + 0.5) * ((2 * hw) / n), z, y: 0.7 });
      }
    },

    /* ----- Moving ----- */
    spray(n, side, power) {
      for (let i = 0; i < n; i++) {
        this.parts.push({
          x: this.px + rand(-0.15, 0.15), y: 0.05, z: this.pz - 0.4,
          vx: side * rand(1, 4) * power + rand(-0.6, 0.6), vy: rand(1, 3.6) * power, vz: this.v * rand(0.45, 0.8),
          life: rand(0.35, 0.8), max: 0.8, size: rand(0.08, 0.2), img: 'snow',
        });
      }
    },
    burst(x, y, z, n, img, speed) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, 6.3), sp = rand(0.5, 1) * speed;
        this.parts.push({ x, y, z, vx: Math.cos(a) * sp, vy: rand(1, 4), vz: this.v * 0.9 + Math.sin(a) * sp, life: rand(0.4, 0.9), max: 0.9, size: rand(0.08, 0.22), img });
      }
    },
    pop(text, col) { this.pops.push({ text, col, life: 1.2 }); },
    hit(what) {
      this.crash = { t: 0, what, m: Math.floor(this.pz) }; this.shake = 1;
      snd.crash();
      this.burst(this.px, 0.6, this.pz, 40, 'snow', 5);
    },

    update(dt) {
      this.t += dt;
      const prevZ = this.pz;
      if (this.crash) {
        this.crash.t += dt; this.v *= Math.exp(-4 * dt); this.vx *= Math.exp(-4 * dt);
        this.pz += this.v * dt; this.px += this.vx * dt;
        this.follow(dt); this.move(dt);
        if (this.crash.t > 1.1) {
          const msg = 'You hit ' + this.crash.what + ' after ' + this.crash.m + ' m';
          return over(this.score, msg + (this.coins ? ' and grabbed ' + this.coins + (this.coins === 1 ? ' coin.' : ' coins.') : '.'));
        }
        return;
      }
      const c = center(this.pz), hw = halfWidth(this.pz), powder = Math.abs(this.px - c) > hw && !this.air;

      // Speed: it creeps up the further you go. Deep snow off the piste slows you down.
      const want = cruise(this.pz) * (powder ? 0.7 : 1);
      this.v += (want - this.v) * Math.min(1, dt * (want > this.v ? 0.6 : 1.5));

      // Steering.
      let dir = (this.right ? 1 : 0) - (this.left ? 1 : 0);
      if (this.touch) dir = clamp((this.tx - W / 2) / 70, -1, 1);
      const maxSide = 4 + 0.35 * this.v;
      if (!this.air) this.vx += (dir * maxSide - this.vx) * Math.min(1, dt * 7);
      // The piste bends under you. You drift with most of a bend by yourself, but have to steer for the rest.
      const bend = (center(this.pz + 1) - center(this.pz - 1)) / 2;
      this.pz += this.v * dt; this.px += (this.vx + bend * this.v * 0.65) * dt;

      // Ramps and jumps.
      if (this.ramp) {
        const r = this.ramp;
        if (Math.abs(this.px - r.x) > r.w) { this.ramp = null; this.air = true; this.vy = 0; }
        else if (this.pz > r.z + r.len) { this.ramp = null; this.air = true; this.vy = 5 + this.v * 0.12; this.h = r.hgt; this.airT = 0; snd.jump(); }
        else this.h = ((this.pz - r.z) / r.len) * r.hgt;
      }
      if (this.air) {
        this.airT += dt; this.vy -= 22 * dt; this.h += this.vy * dt;
        if (this.airT > 0.15) this.spin = Math.min(this.spin + dt * 11.5, Math.PI * 2); // A helicopter spin.
        if (this.h <= 0) {
          this.h = 0; this.air = false; snd.land(); this.spray(18, 1, 1); this.spray(18, -1, 1); this.shake = Math.max(this.shake, 0.25);
          if (this.airT > 0.5) {
            const pts = this.spin >= Math.PI * 2 ? 100 : 50;
            this.bonus += pts; snd.trick(); this.pop((pts === 100 ? '360! +' : 'BIG AIR +') + pts, '#5ce1e6');
          }
          this.spin = 0; this.airT = 0;
        }
      }

      // What is near the skier this step?
      for (const o of this.objs) {
        if (o.z > this.pz + 1) break;
        if (o.z < prevZ - 1 || o.got) continue;
        const dx = Math.abs(o.x - this.px), near = o.z > prevZ - 0.6 && o.z < this.pz + 0.6;
        if (!near) continue;
        if (o.kind === 'coin') {
          if (dx < 1.1 && Math.abs(o.y - this.h) < 1.3) {
            o.got = true; this.coins++; snd.coin();
            this.burst(o.x, o.y, o.z, 12, 'gold', 3);
          }
        } else if (o.kind === 'ramp') {
          if (!this.air && !this.ramp && dx < o.w && this.pz < o.z + o.len) this.ramp = o;
        } else if (o.kind !== 'pole' && dx < o.r + 0.3 && this.h < o.tall * 0.85) {
          o.got = true;
          return this.hit(o.kind === 'pine' ? 'a tree' : 'a rock');
        }
      }
      for (const r of this.riders) {
        if (Math.abs(r.z - this.pz) < 0.8 && Math.abs(r.x - this.px) < 0.75 && this.h < 1.4) return this.hit('another skier');
      }

      // Other skiers start to show up once you get going.
      this.riderT -= dt;
      if (this.riderT <= 0) {
        this.riderT = rand(5, 10) - level(this.pz) * 3;
        if (this.v > 18 && this.riders.length < 3) {
          const z = this.pz + 220;
          this.riders.push({ z, off: rand(-halfWidth(z) + 1.5, halfWidth(z) - 1.5), v: rand(9, 14), amp: rand(1, 2.5), w: rand(0.6, 1.2), p: rand(0, 6.3), col: OTHERS[(Math.random() * OTHERS.length) | 0], x: 0, lean: 0 });
        }
      }

      // Snow spray when carving hard or ploughing through deep snow.
      const carve = Math.abs(this.vx) / maxSide;
      if (!this.air && Math.random() < dt * (carve * 60 + (powder ? 45 : 0) + 4)) this.spray(1 + (powder ? 1 : 0), -Math.sign(this.vx || 1), 0.6 + carve);

      // Ski hiss and wind, louder the faster you go.
      this.sndT -= dt;
      if (this.sndT <= 0) {
        this.sndT = 0.1;
        if (!this.air) snd.hiss(0.18, 0.006 + carve * 0.02 + (powder ? 0.02 : 0), 'bandpass', 1800 + this.v * 30);
        snd.hiss(0.18, 0.004 + this.v * 0.0005, 'lowpass', 300 + this.v * 12);
      }

      // Tracks in the snow behind you.
      if (this.pz - this.trailZ > 0.6) {
        this.trailZ = this.pz;
        this.trail.push(this.air || this.ramp ? null : { x: this.px, z: this.pz });
        if (this.trail.length > 28) this.trail.shift();
      }

      const s = Math.floor(this.pz) + this.coins * 10 + this.bonus;
      if (s !== this.score) { this.score = s; setScore(s); }
      this.follow(dt); this.move(dt);
    },
    follow(dt) {
      cam.x += (this.px - cam.x) * Math.min(1, dt * 4);
      cam.z = this.pz - BACK;
      cam.y = ground(this.pz) + UP + this.h * 0.3;
      this.shake = Math.max(0, this.shake - dt * 1.6);
    },
    move(dt) {
      // Things that move on their own: other skiers, snow spray, falling snow, score popups.
      for (const r of this.riders) {
        r.z += r.v * dt;
        const wob = Math.sin(this.t * r.w + r.p);
        r.x = center(r.z) + clamp(r.off + wob * r.amp, -halfWidth(r.z) + 0.8, halfWidth(r.z) - 0.8);
        r.lean = Math.cos(this.t * r.w + r.p) * 0.3;
      }
      this.riders = this.riders.filter((r) => r.z > cam.z + 1);
      for (const p of this.parts) {
        p.life -= dt; p.vy -= 9 * dt; p.vx *= 1 - dt * 1.5;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz *= 1 - dt * 2;
        if (p.y < 0) { p.y = 0; p.vy = 0; p.life -= dt * 3; }
      }
      this.parts = this.parts.filter((p) => p.life > 0 && p.z > cam.z + 0.5);
      for (const f of this.flakes) {
        f.z -= (this.v + 1.5) * dt; f.y -= 1.3 * dt; f.x += Math.sin(this.t * 0.8 + f.z) * 0.4 * dt;
        if (f.z < 0.8 || f.y < -7) this.flake(f, rand(38, 45));
      }
      for (const p of this.pops) p.life -= dt;
      this.pops = this.pops.filter((p) => p.life > 0);
      while (this.objs.length && this.objs[0].z < cam.z) this.objs.shift();
      this.gen(this.pz + FAR + 20);
    },

    /* ----- Drawing ----- */
    draw() {
      if (!ART) paintArt();
      daylight((((this.pz + CYCLE * 0.05) % CYCLE) + CYCLE) % CYCLE / CYCLE); // Starts on a sunny morning.
      TA = Math.min(1, Math.floor(L.tint)); TM = L.tint - TA;
      ctx.save();
      if (this.shake > 0) ctx.translate(rand(-1, 1) * this.shake * 9, rand(-1, 1) * this.shake * 7);
      this.drawSky();
      this.drawSlope();
      this.drawThings();
      this.drawSnowfall();
      ctx.restore();
      ctx.fillStyle = vignette; ctx.globalAlpha = 0.2 + 0.35 * L.night; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
      this.drawHud();
    },

    drawSky() {
      const t = this.t, night = L.night;
      const sg = ctx.createLinearGradient(0, 0, 0, VALLEY);
      sg.addColorStop(0, css(L.top)); sg.addColorStop(1, css(L.bot));
      ctx.fillStyle = sg; ctx.fillRect(-20, -20, W + 40, VALLEY + 30);
      if (night > 0.02) {
        // Stars, the moon and the northern lights.
        ctx.fillStyle = '#ffffff';
        for (const s of STARS) { ctx.globalAlpha = night * (0.55 + 0.45 * Math.sin(t * 2 + s.p)); ctx.fillRect(s.x, s.y, s.s, s.s); }
        ctx.globalAlpha = night;
        const mg = ctx.createRadialGradient(84, 70, 4, 84, 70, 70);
        mg.addColorStop(0, 'rgba(220,230,255,0.35)'); mg.addColorStop(1, 'rgba(220,230,255,0)');
        ctx.fillStyle = mg; ctx.fillRect(14, 0, 140, 140);
        ctx.fillStyle = '#eef2ff'; ctx.beginPath(); ctx.arc(84, 70, 15, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(150,160,200,0.45)'; ctx.beginPath(); ctx.arc(79, 66, 4, 0, 7); ctx.arc(90, 75, 3, 0, 7); ctx.arc(88, 63, 2, 0, 7); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        const AUR = [['80,255,170', 0], ['120,170,255', 2.1], ['200,120,255', 4.3]];
        AUR.forEach(([rgb, o], i) => {
          const top = (x) => 30 + i * 14 + 26 * Math.sin(x * 0.009 + t * 0.18 + o) + 12 * Math.sin(x * 0.027 - t * 0.4 + o);
          const ag = ctx.createLinearGradient(0, 0, 0, 200);
          ag.addColorStop(0, 'rgba(' + rgb + ',0)'); ag.addColorStop(0.45, 'rgba(' + rgb + ',' + (0.3 - i * 0.07) * night + ')'); ag.addColorStop(1, 'rgba(' + rgb + ',0)');
          const len = (x) => 70 + 30 * Math.sin(x * 0.02 + t * 0.3 + o);
          ctx.fillStyle = ag; ctx.globalAlpha = night * 0.7;
          ctx.beginPath(); ctx.moveTo(0, top(0));
          for (let x = 10; x <= W; x += 10) ctx.lineTo(x, top(x));
          for (let x = W; x >= 0; x -= 10) ctx.lineTo(x, top(x) + len(x));
          ctx.fill();
          // Soft rays make it look like a curtain.
          for (let x = 0; x < W; x += 3) {
            ctx.globalAlpha = night * 0.5 * Math.max(0, Math.sin(x * 0.045 + t * 0.6 + o * 3)) * (0.6 + 0.4 * Math.sin(x * 0.13 - t));
            ctx.fillRect(x, top(x) - 6, 2, len(x) + 12);
          }
        });
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
      if (L.sunY < VALLEY + 30) {
        const x = L.sunX - cam.x * 0.15, y = L.sunY, a = 1 - night;
        const gg = ctx.createRadialGradient(x, y, 6, x, y, 140);
        gg.addColorStop(0, css(L.sun, 0.75 * a)); gg.addColorStop(0.3, css(L.sun, 0.25 * a)); gg.addColorStop(1, css(L.sun, 0));
        ctx.fillStyle = gg; ctx.fillRect(x - 140, y - 140, 280, 280);
        ctx.fillStyle = css(mix(L.sun, [255, 255, 255], 0.6), a); ctx.beginPath(); ctx.arc(x, y, 17, 0, 7); ctx.fill();
      }
      // Clouds drift slowly across.
      ART.clouds.forEach((set, i) => {
        const span = W + 320, x = ((((i * 190 + t * (4 + i * 2) - cam.x * 0.1) % span) + span) % span) - 260;
        const a = 0.9 * (1 - night * 0.65), y = 34 + i * 30, k = 0.8 + i * 0.15;
        if (TM < 0.99) { ctx.globalAlpha = a; ctx.drawImage(set[TA], x, y, 260 * k, 100 * k); }
        if (TM > 0.01) { ctx.globalAlpha = a * (TM < 0.99 ? TM : 1); ctx.drawImage(set[TA + 1], x, y, 260 * k, 100 * k); }
        ctx.globalAlpha = 1;
      });
      // Mountain ridges, far to near. Tall peaks get snow because the fill fades to white at the top.
      RIDGES.forEach((r, i) => {
        const base = VALLEY + 2, col = mix(L[r.key], L.fog, i === 2 ? 0.25 : 0.1);
        const mg = ctx.createLinearGradient(0, VALLEY - 170, 0, base);
        if (r.snow) { mg.addColorStop(0, css(L.cap)); mg.addColorStop(0.28, css(mix(L.cap, col, 0.4))); mg.addColorStop(0.42, css(col)); }
        else mg.addColorStop(0, css(col));
        mg.addColorStop(1, css(mix(col, L.fog, 0.55)));
        ctx.fillStyle = mg; ctx.beginPath(); ctx.moveTo(-20, base);
        const off = (((-cam.x * r.move * 4 + i * 300) % P) + P) % P;
        for (let x = -20; x <= W + 20; x += 6) {
          const u = ((x + off) % P + P) % P / 4, j = Math.floor(u), f = u - j, n = r.h.length;
          ctx.lineTo(x, base - r.lift - (r.h[j % n] * (1 - f) + r.h[(j + 1) % n] * f));
        }
        ctx.lineTo(W + 20, base); ctx.closePath(); ctx.fill();
        if (i === 1) { // Haze in the valley, between the far peaks and the hills.
          const hz = ctx.createLinearGradient(0, VALLEY - 70, 0, VALLEY);
          hz.addColorStop(0, css(L.fog, 0)); hz.addColorStop(1, css(L.fog, 0.8));
          ctx.fillStyle = hz; ctx.fillRect(-20, VALLEY - 70, W + 40, 70);
        }
      });
      ctx.fillStyle = css(L.fog); ctx.fillRect(-20, VALLEY, W + 40, H - VALLEY + 20);
    },

    drawSlope() {
      const base = Math.floor(cam.z / SEG) + 1, st = strip, lr = L.light, fog = L.fog;
      for (let k = 0; k <= DRAW; k++) {
        const z = (base + k) * SEG;
        proj(center(z), st.g[k] = ground(z), z);
        st.x[k] = PX; st.y[k] = PY; st.w[k] = halfWidth(z) * PS;
      }
      const shade = (c, kf, f) => {
        const r = c[0] * lr[0] / 255 * kf, g = c[1] * lr[1] / 255 * kf, b = c[2] * lr[2] / 255 * kf;
        return 'rgb(' + ((r + (fog[0] - r) * f) | 0) + ',' + ((g + (fog[1] - g) * f) | 0) + ',' + ((b + (fog[2] - b) * f) | 0) + ')';
      };
      const quad = (ax, ay, bx, by, cx, cy, dx, dy) => { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.lineTo(dx, dy); ctx.closePath(); ctx.fill(); };
      let maxy = H + 20;
      for (let k = 0; k < DRAW; k++) {
        st.clip[k] = maxy;
        const y1 = st.y[k], y2 = st.y[k + 1];
        if (y2 >= maxy) continue; // Hidden behind a nearer bump.
        // Only the part of the strip above what is already drawn shows.
        let t = 1, bot = y1;
        if (y1 > maxy) { t = (maxy - y2) / (y1 - y2); bot = maxy; }
        const nx = st.x[k + 1] + (st.x[k] - st.x[k + 1]) * t, nw = st.w[k + 1] + (st.w[k] - st.w[k + 1]) * t;
        const fx = st.x[k + 1], fw = st.w[k + 1];
        // Strips facing up the hill catch more light; every other pair of strips is a touch darker, so you can feel the speed.
        const grade = (st.g[k + 1] - st.g[k]) / SEG + SLOPE, stripe = ((base + k) >> 1) & 1;
        const kf = 1 + clamp(grade * 3, -0.22, 0.12) - stripe * 0.03, f = Math.pow(k / DRAW, 1.5) * 0.95;
        ctx.fillStyle = shade(POWDER, kf, f); ctx.fillRect(-20, y2, W + 40, bot - y2 + 0.7);
        ctx.fillStyle = shade(PISTE, kf, f); quad(nx - nw, bot + 0.7, nx + nw, bot + 0.7, fx + fw, y2, fx - fw, y2);
        if (k < 70) {
          const e = 0.09; // The groomed edge of the piste, a little darker.
          ctx.fillStyle = shade(EDGE, kf, f);
          quad(nx - nw, bot + 0.7, nx - nw * (1 - e), bot + 0.7, fx - fw * (1 - e), y2, fx - fw, y2);
          quad(nx + nw * (1 - e), bot + 0.7, nx + nw, bot + 0.7, fx + fw, y2, fx + fw * (1 - e), y2);
        }
        maxy = y2;
      }
      st.clip[DRAW] = maxy;
      // Your ski tracks.
      ctx.strokeStyle = shade(TRACK, 1, 0); ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        ctx.beginPath(); let pen = false;
        for (const p of this.trail) {
          if (!p || p.z < cam.z + 1) { pen = false; continue; }
          proj(p.x + side * 0.14, ground(p.z), p.z);
          if (pen) ctx.lineTo(PX, PY); else { ctx.moveTo(PX, PY); pen = true; }
        }
        if (pen && !this.air && !this.ramp && !this.crash) { proj(this.px + side * 0.14, ground(this.pz), this.pz); ctx.lineTo(PX, PY); }
        ctx.lineWidth = 2.6; ctx.stroke();
      }
      // At night a head torch lights up the snow ahead.
      if (L.night > 0.02) {
        proj(this.px, ground(this.pz + 7), this.pz + 7);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(PX, PY); ctx.scale(1, 0.42);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 230);
        g.addColorStop(0, 'rgba(255,232,190,' + 0.42 * L.night + ')'); g.addColorStop(1, 'rgba(255,232,190,0)');
        ctx.fillStyle = g; ctx.fillRect(-230, -230, 460, 460); ctx.restore();
      }
    },

    drawThings() {
      const list = [], farZ = cam.z + FAR, base = Math.floor(cam.z / SEG) + 1, night = L.night;
      for (const o of this.objs) { if (o.z > farZ) break; if (!o.got && o.z > cam.z + 1.5) list.push(o); }
      for (const r of this.riders) if (r.z < farZ) list.push(r);
      list.push(this);
      list.sort((a, b) => (b.kind === 'ramp' ? b.z + 2 : b === this ? b.pz : b.z) - (a.kind === 'ramp' ? a.z + 2 : a === this ? a.pz : a.z));
      const clipAt = (z) => { const k = Math.floor(z / SEG) - base; return k < 0 ? H + 20 : strip.clip[Math.min(k, DRAW)]; };
      for (const o of list) {
        if (o === this) { this.drawMe(); continue; }
        const a = fade(o.z);
        if (o.kind === 'pine') sprite(ART.pines[o.v], o.x, o.z, o.hm, PINE_FOOT, clipAt(o.z), a);
        else if (o.kind === 'rock') sprite(ART.rocks[o.v], o.x, o.z, o.hm, ROCK_FOOT, clipAt(o.z), a);
        else if (o.kind === 'pole') {
          proj(o.x, ground(o.z), o.z);
          const hp = 1.5 * PS, wp = Math.max(1, 0.08 * PS), clip = clipAt(o.z);
          if (PY - hp > clip || hp < 2) continue;
          const bot = Math.min(PY, clip);
          ctx.globalAlpha = a;
          ctx.fillStyle = lit('#ff7a2e'); ctx.fillRect(PX - wp / 2, PY - hp, wp, bot - PY + hp);
          ctx.fillStyle = lit('#1d1a2b'); ctx.fillRect(PX - wp / 2, PY - hp * 0.62, wp, hp * 0.16);
          ctx.globalAlpha = 1;
        } else if (o.kind === 'coin') {
          const bob = Math.sin(this.t * 3 + o.z) * 0.08;
          proj(o.x, ground(o.z), o.z); const gy = PY, gs = PS;
          if (PY > clipAt(o.z) + 4) continue;
          ctx.fillStyle = 'rgba(60,70,130,' + 0.25 * a + ')'; ctx.beginPath(); ctx.ellipse(PX, gy, 0.3 * gs, 0.08 * gs, 0, 0, 7); ctx.fill();
          proj(o.x, ground(o.z) + o.y + bob, o.z);
          const size = 0.62 * PS, sx = Math.max(0.15, Math.abs(Math.cos(this.t * 3.5 + o.z * 0.3)));
          ctx.globalAlpha = a;
          if (night > 0.1) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * night * 0.6; ctx.drawImage(ART.gold, PX - size, PY - size, size * 2, size * 2); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a; }
          ctx.drawImage(ART.coin, PX - (size * sx) / 2, PY - size / 2, size * sx, size);
          ctx.globalAlpha = 1;
        } else if (o.kind === 'ramp') this.drawRamp(o, a);
        else if (o.col) { // Another skier.
          const gy = ground(o.z);
          proj(o.x, gy, o.z);
          ctx.fillStyle = 'rgba(40,50,110,' + 0.25 * a + ')'; ctx.beginPath(); ctx.ellipse(PX, PY, 0.5 * PS, 0.13 * PS, 0, 0, 7); ctx.fill();
          ctx.globalAlpha = a;
          drawSkier(PX, PY, PS, { lean: o.lean, yaw: o.lean, crouch: 0.12, col: o.col });
          ctx.globalAlpha = 1;
        }
      }
      // Snow spray and sparkles.
      for (const p of this.parts) {
        proj(p.x, ground(p.z) + p.y, p.z);
        const r = clamp(p.size * PS, 0.8, 26), a = clamp(p.life / p.max, 0, 1);
        ctx.globalAlpha = a * (p.img === 'gold' ? 1 : 0.85 - night * 0.35);
        ctx.drawImage(ART[p.img], PX - r, PY - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    },
    drawRamp(o, a) {
      const y0 = ground(o.z), y1 = ground(o.z + o.len) + o.hgt;
      proj(o.x - o.w, y0, o.z); const ax = PX, ay = PY;
      proj(o.x + o.w, y0, o.z); const bx = PX;
      proj(o.x + o.w, y1, o.z + o.len); const cx = PX, cy = PY, cs = PS;
      proj(o.x - o.w, y1, o.z + o.len); const dx = PX;
      ctx.globalAlpha = a;
      // The sides of the ramp, then the slope you ride up.
      ctx.fillStyle = lit('#9fb0d4');
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(dx, cy); ctx.lineTo(dx, ay - (ay - cy) * 0.25); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(bx, ay); ctx.lineTo(cx, cy); ctx.lineTo(cx, ay - (ay - cy) * 0.25); ctx.closePath(); ctx.fill();
      const g = ctx.createLinearGradient(0, cy, 0, ay); g.addColorStop(0, lit('#ffffff')); g.addColorStop(1, lit('#cfdcf2'));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, ay); ctx.lineTo(cx, cy); ctx.lineTo(dx, cy); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = lit('#ff7a2e'); ctx.lineWidth = Math.max(1, 0.12 * cs); ctx.beginPath(); ctx.moveTo(dx, cy); ctx.lineTo(cx, cy); ctx.stroke();
      for (const x of [dx, cx]) { ctx.fillStyle = lit('#ff7a2e'); ctx.fillRect(x - 0.04 * cs, cy - 1.1 * cs, 0.08 * cs, 1.1 * cs); ctx.fillStyle = lit('#5ce1e6'); ctx.fillRect(x, cy - 1.1 * cs, 0.35 * cs, 0.22 * cs); }
      ctx.globalAlpha = 1;
    },
    drawMe() {
      const gy = ground(this.pz);
      proj(this.px, gy, this.pz);
      const sh = 1 / (1 + this.h * 0.4);
      ctx.fillStyle = 'rgba(40,50,110,' + 0.3 * sh + ')'; ctx.beginPath(); ctx.ellipse(PX, PY, 0.5 * PS * sh, 0.13 * PS * sh, 0, 0, 7); ctx.fill();
      proj(this.px, gy + this.h, this.pz);
      const maxSide = 4 + 0.35 * this.v, lean = clamp(this.vx / maxSide, -1, 1);
      let tumble = 0, y = PY;
      if (this.crash) { tumble = Math.min(this.crash.t * 7, 1.6) * (this.vx >= 0 ? 1 : -1); y += Math.min(this.crash.t, 0.3) * PS * 0.6; }
      ctx.save();
      if (tumble) { ctx.translate(PX, y); ctx.rotate(tumble); ctx.translate(-PX, -y); }
      drawSkier(PX, y, PS, { lean: lean * 0.38, yaw: lean * 0.7, crouch: 0.04 + 0.16 * clamp((this.v - 10) / 28, 0, 1), spin: this.spin, col: ME, bib: true });
      ctx.restore();
    },
    drawSnowfall() {
      const night = L.night;
      for (const f of this.flakes) {
        const s = F / f.z, x = W / 2 + f.x * s, y = HOR - f.y * s, r = clamp(f.s * s, 0.6, 7);
        if (x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;
        ctx.globalAlpha = (0.75 - night * 0.25) * clamp((45 - f.z) / 10, 0, 1);
        ctx.drawImage(ART.snow, x - r, y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    },
    drawHud() {
      ctx.textBaseline = 'top';
      const text = (s, x, y, size, col, align) => {
        ctx.font = font(size); ctx.textAlign = align;
        ctx.fillStyle = 'rgba(10,10,30,0.55)'; ctx.fillText(s, x + 2, y + 2);
        ctx.fillStyle = col; ctx.fillText(s, x, y);
      };
      text(String(Math.round(this.v * 3.6)), 14, 14, 16, '#ffffff', 'left');
      text('KM/H', 14, 36, 8, '#dfe8ff', 'left');
      ctx.drawImage(ART.coin, W - 34, 12, 22, 22);
      text(String(this.coins), W - 40, 16, 14, '#ffd75e', 'right');
      this.pops.forEach((p, i) => {
        ctx.globalAlpha = clamp(p.life * 2, 0, 1);
        text(p.text, W / 2, 120 - (1.2 - p.life) * 40 - i * 24, 14, p.col, 'center');
        ctx.globalAlpha = 1;
      });
      if (this.t < 3.5 && !this.crash) {
        ctx.globalAlpha = clamp(3.5 - this.t, 0, 1);
        text('<  STEER  >', W / 2, H - 46, 12, '#ffffff', 'center');
        ctx.globalAlpha = 1;
      }
      ctx.textBaseline = 'alphabetic';
    },
  };

  Arcade.register('ski', ski);
})();
