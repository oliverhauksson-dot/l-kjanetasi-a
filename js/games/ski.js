/* Endless Ski. Loaded on demand by js/arcade.js the first time the game is opened.
   Real 3D, made with three.js (js/vendor/three.module.min.js), which is only downloaded for this game.
   The 3D picture is drawn on its own hidden canvas and copied into the game screen every frame,
   with the score and speed drawn on top, so it works with the shared game screen like every other game.

   The mountain is an endless valley: a wide snowy floor between steep rocky sides, with forest on the
   lower slopes, and rollers and kickers that throw you into the air. It is built in 60 m long pieces
   (chunks) that are made just ahead of you and thrown away behind you.
   Units are metres. d is how far down the mountain, x is left/right. In three.js, z = -d. */
(() => {
  const { ctx, rand, clamp, font, sfx, setScore, over } = Arcade;
  const THREE_URL = new URL('../vendor/three.module.min.js', document.currentScript.src).href;
  let T = null, failed = false;

  // Wide on a computer or a sideways phone, tall on an upright phone. Picked when the game opens.
  let W = 450, H = 600, locked = false;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches; // A phone or tablet: show touch hints.
  const CL = 60, CHUNKS = 9;       // Chunk length, and how many are kept (about 500 m ahead).
  const NU = 49, ND = 31;          // Terrain grid points across and along a chunk.
  const SLOPE = 0.22;              // The mountain drops 22 cm every metre.
  const FLOOR = 27;                // Half the width of the valley floor.
  const G = 24;                    // Gravity, a bit stronger than real so jumps feel snappy.
  const CYCLE = 1800;              // Metres from one morning to the next.
  const RAMP_EVERY = 230;
  const GRABS = ['INDY', 'TWEAKED INDY', 'METHOD', 'MUTE GRAB', 'STALEFISH', 'TAIL GRAB', 'JAPAN', 'MELON'];
  const RAILS = ['50-50', 'BOARDSLIDE', 'LIPSLIDE', 'NOSE PRESS', 'TAIL PRESS'], BOXES = ['BOX SLIDE', 'BOARDSLIDE', '50-50', 'NOSE PRESS'];
  const SIDEWAYS = ['BOARDSLIDE', 'LIPSLIDE', 'BOX SLIDE']; // Slides done with the skis across the rail.
  /* PARK_ONLY: the whole run is one endless terrain park, built from sections one after another.
     Set it to false to bring back the forest run, with a park every PARK_EVERY metres and the special
     stretches (slalom, frozen lake, snowstorm, avalanche) in between. */
  const PARK_ONLY = true;
  const PARK_AT = PARK_ONLY ? 330 : 420, PARK_EVERY = 1150, PARK_LEN = 520; // In the park-only run, the ski jump comes first.
  const inPark = (d) => d >= PARK_AT && (PARK_ONLY || (d - PARK_AT) % PARK_EVERY < PARK_LEN);
  function parkMask(d) { // 1 in a park, 0 outside, fading in between. The park's snow is smoothed flat.
    const k = d - PARK_AT, m = ((k % PARK_EVERY) + PARK_EVERY) % PARK_EVERY;
    if (k < -40) return 0;
    if (PARK_ONLY) return clamp(1 + k / 40, 0, 1);
    if (m < PARK_LEN) return 1;
    return clamp(1 - Math.min(m - PARK_LEN, PARK_EVERY - m) / 40, 0, 1);
  }
  /* Between two parks there is a stretch with something special going on: a slalom, a frozen lake,
     a snowstorm or an avalanche. The order is shuffled every run. */
  const ZONE_GAP = PARK_LEN + 90, ZONE_LEN = 380, ZONE_TYPES = ['slalom', 'lake', 'storm', 'avalanche'];
  let ZONES = ZONE_TYPES.slice();
  function zoneAt(d) { // { type, s (where it starts), k (which one) }, or null.
    if (!ZONES.length) return null;
    const k = Math.floor((d - PARK_AT) / PARK_EVERY);
    if (k < 0) return null;
    const s = PARK_AT + k * PARK_EVERY + ZONE_GAP;
    return d >= s && d < s + ZONE_LEN ? { type: ZONES[k % ZONES.length], s, k } : null;
  }
  // How much a zone of this type there is at d: 1 inside, 0 outside, fading over `fade` metres at both ends.
  function zoneMask(type, d, fade) {
    if (!ZONES.length) return 0;
    const k = Math.floor((d + fade - PARK_AT) / PARK_EVERY);
    if (k < 0 || ZONES[k % ZONES.length] !== type) return 0;
    const s = PARK_AT + k * PARK_EVERY + ZONE_GAP;
    return clamp(Math.min(d - s + fade, s + ZONE_LEN + fade - d) / fade, 0, 1);
  }
  // The frozen lake: smooth ice across the valley floor, with a snowy shore.
  const LAKE_W = FLOOR - 3;
  function iceAt(x, d) {
    const m = zoneMask('lake', d, 20);
    if (!m) return 0;
    return m * clamp((LAKE_W - Math.abs(x - center(d))) / 3, 0, 1);
  }
  const GATE_W = 2.6; // Half the width of a slalom gate.
  const FENCE = FLOOR - 0.9;
  const LIFT_SPAN = 48;
  const MAX_FANS = 700; // Metres between chairlift towers. // The safety fence along both sides of the park.
  const HIP_THROW = 7; // How hard a side hit throws you towards the middle.
  // Tricks. A jump (ollie) pops you up; spins count in half turns (180, 360, 540...), flips in full turns.
  const OLLIE = 7.8, SPIN_RATE = 11, FLIP_RATE = 12.5, GRAB_T = 0.75, SWAP_T = 0.35;
  const SPIN_PTS = [0, 100, 200, 350, 500, 700, 900];
  // Clean tricks give a speed boost on top of cruising speed, as a share of it, that fades over a few seconds.
  const BOOST_MAX = 0.6, BOOST_FADE = 0.6;
  // The speed limit: 200 km/h. Nothing takes you faster, and tricks give no more boost once you are there.
  const VMAX = 200 / 3.6;
  const spinPts = (k) => (k < SPIN_PTS.length ? SPIN_PTS[k] : 900 + (k - 6) * 200);
  const flipName = (n) => { const a = Math.abs(n); return a ? (a === 1 ? '' : ['', '', 'DOUBLE ', 'TRIPLE '][a] || a + 'X ') + (n > 0 ? 'FRONTFLIP' : 'BACKFLIP') : ''; };

  /* ---------- The mountain ---------- */
  let ph = [0, 0, 0, 0], SEED = 1;
  const hash = (i, j) => {
    let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + SEED) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  function noise(x, y) {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), e = hash(i + 1, j + 1);
    return (a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy) * 2 - 1;
  }
  const center = (d) => 30 * Math.sin(d / 260 + ph[0]) + 14 * Math.sin(d / 120 + ph[1]);
  // Rollers: bumpy stretches that come and go. Hit a crest fast and you take off.
  /* ---------- The ski jump ----------
     Every run starts on a ski jump, and only there. You start at the top of a tall in-run on stilts, speed down it
     in the tracks, and fly off the lip (press Space right at the edge to fly further). Ski jumpers glide, so in the
     air you fall slower than usual. The landing hill below is steeper than the rest of the mountain, then the
     outrun flattens out into the terrain park. */
  const JUMP_LIP = 76, JUMP_HILL = 200, JUMP_K = 95, JUMP_HS = 110, JUMP_V = 27, JUMP_GLIDE = 0.46, JUMP_TOP = -16;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  // How steep the landing hill is (as a drop per metre), s metres past the lip.
  function hillSlope(s) {
    if (s < 3) return -1.2; // The knoll: the snow falls away right under the lip.
    if (s < 50) return -0.45 - 0.3 * smooth((s - 3) / 47);
    if (s < 125) return -0.75;
    return -0.75 + (0.75 - SLOPE) * smooth((s - 125) / (JUMP_HILL - 125));
  }
  // How steep the in-run is at d.
  function inrunSlope(d) {
    if (d < 2) return -0.05;
    if (d < 10) return -0.05 - 0.57 * smooth((d - 2) / 8);
    if (d < 54) return -0.62;
    if (d < 68) return -0.62 + 0.5 * smooth((d - 54) / 14);
    return -0.12;
  }
  // Both as tables, every 25 cm: how much lower the landing hill is than the normal mountain, and how much higher
  // the in-run is than its lip.
  const HILL = [0], INRUN = [0];
  for (let i = 1; i <= JUMP_HILL * 4; i++) HILL.push(HILL[i - 1] + 0.25 * (hillSlope((i - 0.5) / 4) + SLOPE));
  for (let i = 1; i <= (JUMP_LIP - JUMP_TOP) * 4; i++) INRUN.push(INRUN[i - 1] - 0.25 * inrunSlope(JUMP_LIP - (i - 0.5) / 4));
  const table = (T, k) => { k = clamp(k, 0, T.length - 1); const i = Math.floor(k), f = k - i; return i + 1 < T.length ? T[i] + (T[i + 1] - T[i]) * f : T[i]; };
  const hillDrop = (d) => (d <= JUMP_LIP ? 0 : table(HILL, (d - JUMP_LIP) * 4));
  // 1 on the landing hill, where the snow is groomed smooth, 0 away from it.
  const hillMask = (d) => clamp(Math.min(d - (JUMP_LIP - 20), JUMP_LIP + JUMP_HILL + 30 - d) / 15, 0, 1);
  const rollers = (d) => { if (PARK_ONLY) return 0; const e = Math.max(0, Math.sin(d / 330 + ph[2])); return e * e * 1.7 * Math.sin(d / 5.6 + ph[3]) * (1 - parkMask(d)); };
  function height(x, d) {
    const u = x - center(d), t = Math.max(0, Math.abs(u) - FLOOR);
    const side = t < 40 ? 0.02 * t * t : 32 + 1.6 * (t - 40); // The valley sides get steeper, then rise straight on.
    const flat = (1 - 0.92 * iceAt(x, d)) * (1 - 0.85 * hillMask(d)); // The lake's ice is smooth: no rollers and no bumps. So is the landing hill.
    return -SLOPE * d + hillDrop(d) + rollers(d) * flat + 0.0016 * u * u + side
      + (noise(x * 0.04, d * 0.04) * 1.4 + noise(x * 0.17, d * 0.17) * 0.3 + noise(x * 0.5, d * 0.35) * 0.06) * flat + t * 0.12 * noise(x * 0.02 + 40, d * 0.02);
  }
  function normalAt(x, d) {
    const e = 0.6, hx = (height(x + e, d) - height(x - e, d)) / (2 * e), hd = (height(x, d + e) - height(x, d - e)) / (2 * e);
    const l = Math.hypot(hx, 1, hd); // In three.js z = -d, so the slope along z is -hd.
    return [-hx / l, 1 / l, hd / l];
  }
  const level = (d) => clamp(d / 5000, 0, 1);
  const cruise = (d) => 16 + 22 * (1 - Math.exp(-d / 2500));

  /* ---------- Time of day ----------
     Stops along CYCLE. elev and az place the sun (or the moon at night). exp is the camera exposure. */
  const SKY = [
    { at: 0.00, top: '#aebccd', hor: '#eef1f5', fog: '#e4e9ef', sun: '#fffaf0', sunI: 1.6, hs: '#ffffff', hg: '#9ea7b8', hI: 2.1, elev: 0.5, az: 0.95, night: 0, exp: 1.0 },
    { at: 0.30, top: '#9fb2c9', hor: '#edf0f4', fog: '#e2e7ee', sun: '#fff4e2', sunI: 1.9, hs: '#f4f7ff', hg: '#9ea7b8', hI: 1.9, elev: 0.36, az: 0.9, night: 0, exp: 1.0 },
    { at: 0.42, top: '#5a6fae', hor: '#ffd2a6', fog: '#efd3bf', sun: '#ffc285', sunI: 2.7, hs: '#ffdcc4', hg: '#7a6a80', hI: 1.0, elev: 0.18, az: 0.6, night: 0, exp: 1.0 },
    { at: 0.52, top: '#2c3070', hor: '#ff8a58', fog: '#c78b88', sun: '#ff7840', sunI: 2.0, hs: '#c48aa6', hg: '#4a3a5a', hI: 0.85, elev: 0.04, az: 0.4, night: 0, exp: 1.05 },
    { at: 0.62, top: '#03050f', hor: '#13204a', fog: '#111a38', sun: '#a9bcff', sunI: 0.7, hs: '#3c4d7e', hg: '#12141f', hI: 0.55, elev: 0.6, az: -0.5, night: 1, exp: 1.2 },
    { at: 0.86, top: '#03050f', hor: '#13204a', fog: '#111a38', sun: '#a9bcff', sunI: 0.7, hs: '#3c4d7e', hg: '#12141f', hI: 0.55, elev: 0.6, az: -0.5, night: 1, exp: 1.2 },
    { at: 0.94, top: '#3f4d93', hor: '#f6b8b0', fog: '#d9c1c6', sun: '#ffb59a', sunI: 1.8, hs: '#e5c2d0', hg: '#5a5070', hI: 0.9, elev: 0.08, az: -0.6, night: 0, exp: 1.05 },
  ];
  SKY.push({ ...SKY[0], at: 1 });

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
    jump() { this.hiss(0.35, 0.06, 'bandpass', 500, 2800); },
    land() { this.note(130, 0.16, 'sine', 0.13, 0, 50); this.hiss(0.18, 0.07, 'lowpass', 700); },
    crash() { this.hiss(0.6, 0.16, 'lowpass', 1800, 150); this.note(110, 0.35, 'square', 0.05, 0, 40); },
    trick() { if (!this.ready()) return; const t = sfx.ac.currentTime; [784, 988, 1175, 1568].forEach((f, i) => this.note(f, 0.1, 'square', 0.025, t + i * 0.06)); },
    sketchy() { this.note(200, 0.25, 'sawtooth', 0.04, 0, 90); },
    clank() { this.note(1500, 0.09, 'square', 0.03, 0, 900); this.note(2300, 0.12, 'triangle', 0.03); },
    gate() { if (!this.ready()) return; const t = sfx.ac.currentTime; this.note(1047, 0.07, 'triangle', 0.05, t); this.note(1568, 0.14, 'triangle', 0.05, t + 0.06); },
    miss() { this.note(330, 0.2, 'square', 0.03, 0, 220); },
    rumble(vol) { this.note(45 + Math.random() * 10, 0.3, 'sawtooth', vol * 0.08); this.hiss(0.3, vol * 0.12, 'lowpass', 260); },
    warn() { if (!this.ready()) return; const t = sfx.ac.currentTime; [0, 0.22, 0.44].forEach((k) => this.note(880, 0.14, 'square', 0.035, t + k)); },
  };

  /* ---------- 3D scene ---------- */
  let S = null; // Everything three.js, made once when the library has loaded.
  const glCanvas = document.createElement('canvas');
  const SHADER_END = '#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';

  // Several shapes, each with its own colour, glued into one shape so a whole tree is drawn in one go.
  function merged(parts) {
    const pos = [], nor = [], col = [];
    for (const p of parts) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone(); g.applyMatrix4(p.m);
      const c = new T.Color(p.color), P = g.attributes.position.array, N = g.attributes.normal.array;
      for (let i = 0; i < P.length; i += 3) {
        pos.push(P[i], P[i + 1], P[i + 2]); nor.push(N[i], N[i + 1], N[i + 2]);
        const k = p.vary ? 1 + (Math.random() - 0.5) * p.vary : 1;
        col.push(c.r * k, c.g * k, c.b * k);
      }
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    return out;
  }
  const at = (x, y, z, ry = 0) => new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromEuler(new T.Euler(0, ry, 0)), new T.Vector3(1, 1, 1));

  // A snowy pine: tiers of needles, each with snow lying on top. sides is how round it is.
  function pineGeo(tiers, sides) {
    const parts = [{ geo: new T.CylinderGeometry(0.11, 0.17, 1.4, 6), m: at(0, 0.7, 0), color: '#4a2f1d' }];
    for (let i = 0; i < tiers; i++) {
      const p = i / tiers, r = 1.5 * (1 - p * 0.8), h = 2.2 - p * 0.9, y = 1.1 + p * 4.3;
      parts.push({ geo: new T.ConeGeometry(r, h, sides, 1, true), m: at(0, y + h / 2, 0, i), color: '#1a3d2c', vary: 0.3 });
      parts.push({ geo: new T.ConeGeometry(r * 0.88, h * 0.62, sides, 1, true), m: at(0, y + h * 0.58, 0, i + 0.4), color: '#eef3fa', vary: 0.06 });
    }
    return merged(parts);
  }
  function rockGeo() {
    const g = new T.IcosahedronGeometry(1, 1), p = g.attributes.position, v = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      v.multiplyScalar((0.75 + 0.35 * Math.abs(Math.sin(v.x * 3.1 + v.z * 2.3) + Math.cos(v.y * 4.2))) * 0.55);
      p.setXYZ(i, v.x, Math.max(v.y * 0.75, -0.2) + 0.25, v.z);
    }
    const ng = g.index ? g.toNonIndexed() : g; ng.computeVertexNormals();
    const n = ng.attributes.normal, col = [], snow = new T.Color('#eef3fb'), rock = new T.Color('#4f5566');
    for (let i = 0; i < n.count; i++) { const c = n.getY(i) > 0.55 ? snow : rock; col.push(c.r, c.g, c.b); }
    ng.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    return ng;
  }
  // Like at(), but turned round all three axes and stretched.
  const atR = (x, y, z, rx, ry, rz, sx = 1, sy = 1, sz = 1) => new T.Matrix4().compose(new T.Vector3(x, y, z),
    new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)), new T.Vector3(sx, sy, sz));
  // A reindeer, facing +x: brown body, pale neck, long legs and a big pair of antlers.
  function reindeerGeo() {
    const box = (w, h, d) => new T.BoxGeometry(w, h, d), leg = new T.CylinderGeometry(0.05, 0.04, 0.85, 5), parts = [
      { geo: box(1.25, 0.55, 0.5), m: at(0, 1.1, 0), color: '#6b4a32', vary: 0.1 },
      { geo: box(0.5, 0.3, 0.42), m: at(-0.1, 0.9, 0), color: '#d9d0bf' },
      { geo: box(0.32, 0.6, 0.32), m: atR(0.62, 1.45, 0, 0, 0, -0.5), color: '#e8e0d0' },
      { geo: box(0.48, 0.24, 0.24), m: at(0.95, 1.72, 0), color: '#5c3f2b' },
      { geo: box(0.1, 0.1, 0.1), m: at(1.2, 1.72, 0), color: '#1a1414' },
      { geo: box(0.14, 0.16, 0.36), m: at(-0.66, 1.25, 0), color: '#efe9de' },
    ];
    for (const [lx, lz] of [[0.48, 0.17], [0.48, -0.17], [-0.48, 0.17], [-0.48, -0.17]]) parts.push({ geo: leg, m: at(lx, 0.43, lz), color: '#4a3324' });
    const horn = new T.CylinderGeometry(0.03, 0.04, 1, 4);
    for (const s of [-1, 1]) {
      parts.push({ geo: horn, m: atR(0.82, 2.15, s * 0.22, s * 0.45, 0, 0.35), color: '#cbb894' });
      parts.push({ geo: horn, m: atR(0.68, 2.45, s * 0.36, s * 0.2, 0, -0.9, 1, 0.55, 1), color: '#cbb894' });
      parts.push({ geo: horn, m: atR(0.98, 2.4, s * 0.32, s * 0.6, 0, 0.9, 1, 0.45, 1), color: '#cbb894' });
    }
    return merged(parts);
  }
  // A white mountain hare, facing +x, with long ears.
  function hareGeo() {
    const ball = new T.SphereGeometry(1, 10, 8), parts = [
      { geo: ball, m: atR(0, 0.3, 0, 0, 0, 0.2, 0.36, 0.26, 0.22), color: '#f4f6fb' },
      { geo: ball, m: atR(0.32, 0.5, 0, 0, 0, 0, 0.15, 0.14, 0.13), color: '#f4f6fb' },
      { geo: ball, m: atR(0.45, 0.5, 0, 0, 0, 0, 0.03, 0.03, 0.03), color: '#222' },
      { geo: ball, m: atR(-0.36, 0.33, 0, 0, 0, 0, 0.08, 0.08, 0.08), color: '#ffffff' },
    ];
    for (const s of [-1, 1]) parts.push({ geo: ball, m: atR(0.25, 0.76, s * 0.06, s * 0.2, 0, -0.35, 0.05, 0.2, 0.04), color: '#e9ecf2' });
    for (const s of [-1, 1]) parts.push({ geo: ball, m: atR(0.3, 0.86, s * 0.06, s * 0.2, 0, -0.35, 0.025, 0.06, 0.02), color: '#222' });
    return merged(parts);
  }
  function dotTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  }

  const CROWD = ['#e8333a', '#2a63e8', '#ffb020', '#2fd6a0', '#ff7ab8', '#7a4dff', '#f4f6fa']; // Fans' jackets.
  // The skier's outfit colours.
  const SKIN = { jacket: '#ffb020', accent: '#1f2740', pants: '#1f2740', helmet: '#f4f6fa', lens: '#ff8a20', skis: '#ff5a36', gloves: '#1a1c24' };

  // The skier: simple shapes, posed every frame. Limbs are capsules stretched between two points.
  function makeSkier() {
    const mat = (c, r = 0.55) => new T.MeshStandardMaterial({ color: c, roughness: r });
    const M = {
      jacket: mat('#ffb020', 0.5), accent: mat('#1f2740', 0.5), pants: mat('#1f2740', 0.7), helmet: mat('#f4f6fa', 0.3),
      lens: new T.MeshStandardMaterial({ color: '#ff8a20', roughness: 0.1, metalness: 0.8, emissive: '#ff8a20', emissiveIntensity: 0.25 }),
      skis: mat('#ff5a36', 0.35), gloves: mat('#1a1c24', 0.6),
    };
    const dark = mat('#1a1c24', 0.4), face = mat('#f1c7a5', 0.6), strap = mat('#15161c', 0.7), metal = mat('#c9cdd8', 0.3);
    // root follows your heading, flip tips you head over heels round your middle, turn is the spin, lean leans into turns.
    const root = new T.Group(), flip = new T.Group(), turn = new T.Group(), lean = new T.Group();
    root.add(flip); flip.add(turn); turn.add(lean); flip.position.y = 0.7; turn.position.y = -0.7;
    const capsule = new T.CapsuleGeometry(1, 1, 4, 10), ball = new T.SphereGeometry(1, 12, 10);
    const add = (geo, m, to = lean) => { const o = new T.Mesh(geo, m); o.castShadow = true; to.add(o); return o; };
    // The head turns as one piece: face, helmet with a stripe, goggles with a strap round the back.
    const head = new T.Group(); lean.add(head);
    add(new T.SphereGeometry(0.135, 16, 12), face, head);
    const shell = add(new T.SphereGeometry(0.158, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), M.helmet, head); shell.position.y = 0.025;
    const stripe = add(new T.SphereGeometry(0.161, 18, 12, -0.12, 0.24, 0, Math.PI * 0.5), M.accent, head); stripe.position.y = 0.025; stripe.rotation.y = Math.PI;
    const ring = add(new T.TorusGeometry(0.15, 0.018, 6, 24), strap, head); ring.rotation.x = Math.PI / 2; ring.position.y = 0.0;
    const frame = add(new T.BoxGeometry(0.22, 0.085, 0.05), strap, head); frame.position.set(0, 0.0, -0.135);
    const lens = add(new T.BoxGeometry(0.2, 0.068, 0.02), M.lens, head); lens.position.set(0, 0.0, -0.162);
    const chin = add(new T.BoxGeometry(0.06, 0.03, 0.03), strap, head); chin.position.set(0, -0.12, -0.08);
    return {
      root, flip, turn, lean, M, head,
      skis: [0, 1].map(() => add(new T.BoxGeometry(0.11, 0.035, 1.75), M.skis)),
      tips: [0, 1].map(() => add(new T.BoxGeometry(0.11, 0.035, 0.22), M.skis)),
      boots: [0, 1].map(() => add(new T.BoxGeometry(0.16, 0.24, 0.32), dark)),
      bindings: [0, 1].map(() => add(new T.BoxGeometry(0.13, 0.05, 0.42), metal)),
      shins: [0, 1].map(() => add(capsule, M.pants)),
      thighs: [0, 1].map(() => add(capsule, M.pants)),
      knees: [0, 1].map(() => add(ball, M.accent)),
      torso: add(capsule, M.jacket),
      zip: add(capsule, M.accent),
      collar: add(new T.CylinderGeometry(0.11, 0.13, 0.12, 12), M.jacket),
      hem: add(new T.CylinderGeometry(0.225, 0.215, 0.08, 14), M.accent),
      arms: [0, 1].map(() => add(capsule, M.jacket)),
      cuffs: [0, 1].map(() => add(ball, M.accent)),
      gloves: [0, 1].map(() => add(ball, M.gloves)),
      poles: [0, 1].map(() => add(new T.CylinderGeometry(0.012, 0.012, 1, 5), metal)),
      baskets: [0, 1].map(() => add(new T.CylinderGeometry(0.05, 0.05, 0.01, 10), dark)),
      pack: add(new T.BoxGeometry(0.26, 0.3, 0.12), M.accent),
    };
  }
  function applySkin(sk) {
    for (const key of ['jacket', 'accent', 'pants', 'helmet', 'lens', 'skis', 'gloves']) sk.M[key].color.set(SKIN[key]);
    sk.M.lens.emissive.set(SKIN.lens);
  }
  const UP = { x: 0, y: 1, z: 0 };
  let vA = null, vB = null;
  function placeLimb(o, a, b, r, stretch) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
    o.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    vA.set(UP.x, UP.y, UP.z); vB.set(dx / len, dy / len, dz / len);
    o.quaternion.setFromUnitVectors(vA, vB);
    if (stretch) o.scale.set(1, len, 1); else o.scale.set(r, len / 3, r); // A capsule of radius 1 and length 1 is 3 long.
  }
  // Pose the skier. c is how low the tuck is (0 to 1), forward is -z.
  function poseSkier(sk, c, armsUp, grab, look = 0) { // look turns the head (radians), to see downhill when riding backwards.
    const V = (x, y, z) => ({ x, y, z });
    const hip = V(0, 0.92 - 0.3 * c, 0.08 + 0.12 * c), bend = 0.3 + 0.75 * c;
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, x = s * 0.13;
      sk.skis[i].position.set(x, 0.02, -0.15);
      sk.tips[i].position.set(x, 0.06, -1.07); sk.tips[i].rotation.x = 0.45; // Turned-up tips.
      sk.bindings[i].position.set(x, 0.05, 0);
      sk.boots[i].position.set(x, 0.15, 0);
      const knee = V(x * 1.05, 0.5 - 0.14 * c, -0.2 - 0.12 * c);
      placeLimb(sk.shins[i], V(x, 0.2, 0), knee, 0.095);
      placeLimb(sk.thighs[i], knee, V(s * 0.1, hip.y, hip.z), 0.115);
      sk.knees[i].position.set(knee.x, knee.y, knee.z - 0.05); sk.knees[i].scale.set(0.085, 0.07, 0.06);
    }
    const neck = V(0, hip.y + 0.55 * Math.cos(bend), hip.z - 0.55 * Math.sin(bend));
    placeLimb(sk.torso, hip, neck, 0.2);
    // Zip down the front of the jacket, a collar and a coloured hem.
    const fy = -Math.sin(bend), fz = -Math.cos(bend);
    placeLimb(sk.zip, V(0, hip.y + 0.06 * Math.cos(bend) + fy * 0.17, hip.z - 0.06 * Math.sin(bend) + fz * 0.17), V(0, neck.y + fy * 0.17, neck.z + fz * 0.17), 0.035);
    sk.collar.position.set(0, neck.y + 0.02, neck.z); sk.collar.rotation.x = -bend * 0.6;
    sk.hem.position.set(0, hip.y + 0.05 * Math.cos(bend), hip.z - 0.05 * Math.sin(bend)); sk.hem.rotation.x = -bend;
    sk.pack.position.set(0, (hip.y + neck.y) / 2 + 0.05 * Math.cos(bend), (hip.z + neck.z) / 2 + 0.2); sk.pack.rotation.x = -bend;
    sk.head.position.set(0, neck.y + 0.17, neck.z - 0.04); sk.head.rotation.set(-bend * 0.25 + 0.15, look, 0);
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, sh = V(s * 0.22, neck.y - 0.08, neck.z + 0.02);
      // A grab: one hand reaches down to its ski, the other goes up for balance.
      const reach = grab === s, up = armsUp || (grab && !reach);
      const hand = reach ? V(s * 0.17, 0.12, 0.05) : up ? V(s * 0.55, neck.y + 0.15, neck.z - 0.1) : V(s * 0.26, hip.y + 0.05 + 0.1 * c, hip.z - 0.42 - 0.05 * c);
      placeLimb(sk.arms[i], sh, hand, 0.075);
      const tip = reach ? V(s * 0.3, 0.3, hand.z + 1.1) : up ? V(s * 0.75, hand.y - 0.6, hand.z + 0.9) : V(s * 0.35, 0.05, hand.z + 1.05);
      placeLimb(sk.poles[i], hand, tip, 0, true);
      sk.gloves[i].position.set(hand.x, hand.y, hand.z); sk.gloves[i].scale.setScalar(0.065);
      const k = 0.82; sk.cuffs[i].position.set(sh.x + (hand.x - sh.x) * k, sh.y + (hand.y - sh.y) * k, sh.z + (hand.z - sh.z) * k); sk.cuffs[i].scale.setScalar(0.08);
      const b = 0.9; sk.baskets[i].position.set(hand.x + (tip.x - hand.x) * b, hand.y + (tip.y - hand.y) * b, hand.z + (tip.z - hand.z) * b); sk.baskets[i].quaternion.copy(sk.poles[i].quaternion);
    }
  }

  function initScene() {
    let renderer;
    try { renderer = new T.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' }); }
    catch (e) { failed = true; return; }
    vA = new T.Vector3(); vB = new T.Vector3();
    STORM_DAY = new T.Color('#dde3ea'); STORM_NIGHT = new T.Color('#262d40'); LAMP_ON = new T.Color('#fff2c4');
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.NeutralToneMapping;
    const scene = new T.Scene();
    scene.fog = new T.FogExp2('#d9e4ef', 0.0027);
    const camera = new T.PerspectiveCamera(66, W / H, 0.2, 1600);

    const hemi = new T.HemisphereLight('#d2e2ff', '#8d93a6', 1.2); scene.add(hemi);
    const sun = new T.DirectionalLight('#fff1dc', 3);
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 300 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    const lamp = new T.SpotLight('#ffe7c0', 0, 90, 0.6, 0.9, 1); // Head torch at night.
    scene.add(lamp, lamp.target);

    // Sky: a big ball around the camera, coloured from the horizon up, with the sun (or moon) painted in.
    const skyMat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, toneMapped: false,
      uniforms: { top: { value: new T.Color() }, hor: { value: new T.Color() }, sunDir: { value: new T.Vector3() }, sunCol: { value: new T.Color() }, size: { value: 1 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
      fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float size; varying vec3 vDir;
        void main(){ vec3 c = mix(hor, top, pow(max(vDir.y, 0.0), 0.55));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          c += sunCol * (smoothstep(1.0 - 0.0009 * size, 1.0 - 0.0006 * size, s) * 4.0 + pow(s, 14.0) * 0.4 * size);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const sky = new T.Mesh(new T.SphereGeometry(1000, 32, 16), skyMat); sky.renderOrder = -2; sky.frustumCulled = false; scene.add(sky);
    const starPos = [];
    for (let i = 0; i < 1400; i++) { const a = rand(0, Math.PI * 2), y = rand(0.05, 1), r = Math.sqrt(1 - y * y); starPos.push(Math.cos(a) * r * 900, y * 900, Math.sin(a) * r * 900); }
    const starGeo = new T.BufferGeometry(); starGeo.setAttribute('position', new T.Float32BufferAttribute(starPos, 3));
    const stars = new T.Points(starGeo, new T.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    stars.renderOrder = -1; stars.frustumCulled = false; scene.add(stars);
    // Northern lights: wavy curtains far ahead, glowing on top of the sky.
    const auroraMat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending,
      uniforms: { time: { value: 0 }, night: { value: 0 } },
      vertexShader: `uniform float time; varying vec2 vUv; void main(){ vUv = uv; vec3 p = position;
          p.z += sin(p.x * 0.004 + time * 0.12) * 160.0 + sin(p.x * 0.011 - time * 0.2) * 50.0; p.y += sin(p.x * 0.006 + time * 0.15) * 30.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `uniform float time; uniform float night; varying vec2 vUv;
        void main(){ float v = vUv.y; vec3 c = mix(vec3(0.15, 1.0, 0.55), vec3(0.6, 0.35, 1.0), smoothstep(0.35, 1.0, v));
          float rays = 0.55 + 0.45 * sin(vUv.x * 160.0 + sin(vUv.x * 23.0 + time * 0.7) * 3.0 + time * 0.5);
          float a = smoothstep(0.0, 0.18, v) * pow(1.0 - v, 1.4) * rays * night * 0.75;
          gl_FragColor = vec4(c * a, a);
          ${SHADER_END} }`,
    });
    const aurora = new T.Group();
    [[0, 0], [180, 120]].forEach(([dz, dy]) => { const m = new T.Mesh(new T.PlaneGeometry(2200, 260, 120, 1), auroraMat); m.position.set(0, 150 + dy * 0.6, -620 + dz); m.frustumCulled = false; aurora.add(m); });
    scene.add(aurora);

    // Big peaks at the far end of the valley, faded by the haze.
    const peaks = (() => {
      const g = new T.PlaneGeometry(3200, 700, 360, 30), p = g.attributes.position, col = [];
      const snow = new T.Color('#f2f6fc'), rock = new T.Color('#6f7a92'), c = new T.Color();
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i) + 350;
        let h = 40; [[0.0019, 120], [0.0043, 95], [0.0097, 45], [0.021, 18], [0.047, 6]].forEach(([f, a], j) => { h += a * Math.pow(1 - Math.abs(Math.sin(x * f + j * 1.7)), 1.6) * (0.6 + 0.9 * Math.abs(x) / 1600); });
        const yy = (y / 700) * h;
        p.setXYZ(i, x, yy, -Math.abs(x) * 0.25);
        c.copy(rock).lerp(snow, clamp((yy / h - 0.4) * 3 + noise(x * 0.02, yy * 0.02) * 0.6, 0, 1));
        col.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
      const m = new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true })); m.frustumCulled = false;
      scene.add(m); return m;
    })();

    // Terrain tiles, one per chunk, all sharing one list of triangles.
    const idx = [];
    for (let j = 0; j < ND - 1; j++) for (let i = 0; i < NU - 1; i++) { const a = j * NU + i; idx.push(a, a + 1, a + NU, a + 1, a + NU + 1, a + NU); }
    const index = new T.Uint32BufferAttribute(idx, 1);
    const groundMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    const tiles = [];
    for (let k = 0; k < CHUNKS + 3; k++) {
      const g = new T.BufferGeometry();
      g.setIndex(index);
      for (const a of ['position', 'normal', 'color']) g.setAttribute(a, new T.BufferAttribute(new Float32Array(NU * ND * 3), 3));
      const m = new T.Mesh(g, groundMat); m.receiveShadow = true; m.frustumCulled = false; m.visible = false; m.chunk = null;
      scene.add(m); tiles.push(m);
    }

    const treeMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const trees = new T.InstancedMesh(pineGeo(6, 10), treeMat, 1200);
    // The forest on the valley sides: lots of lighter trees that don't cast shadows, so phones keep up.
    const forest = new T.InstancedMesh(pineGeo(5, 6), treeMat, 7000);
    forest.count = 0; forest.frustumCulled = false; scene.add(forest);
    const rocks = new T.InstancedMesh(rockGeo(), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), 400);
    const coins = new T.InstancedMesh(new T.CylinderGeometry(0.42, 0.42, 0.08, 20).rotateX(Math.PI / 2),
      new T.MeshStandardMaterial({ color: '#ffc531', metalness: 0.35, roughness: 0.3, emissive: '#ff9d00', emissiveIntensity: 0.45 }), 400);
    for (const m of [trees, rocks, coins]) { m.count = 0; m.frustumCulled = false; m.castShadow = m !== coins; m.receiveShadow = true; scene.add(m); }

    const skier = makeSkier(); scene.add(skier.root); applySkin(skier);
    const blob = new T.Mesh(new T.CircleGeometry(0.7, 20).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: '#1b2140', transparent: true, opacity: 0.25, depthWrite: false }));
    scene.add(blob);

    // Ski tracks: two ribbons lying on the snow behind you.
    const tracks = [0, 1].map(() => {
      const g = new T.BufferGeometry(), id = [];
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(TRACK * 2 * 3), 3));
      g.setAttribute('normal', new T.BufferAttribute(new Float32Array(TRACK * 2 * 3).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
      for (let i = 0; i < TRACK - 1; i++) { const a = i * 2; id.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      g.setIndex(id);
      const m = new T.Mesh(g, new T.MeshStandardMaterial({ color: '#b9c7e2', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.frustumCulled = false; m.receiveShadow = true; scene.add(m); return m;
    });

    const dot = dotTexture();
    const points = (n, size, color, opacity) => {
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3));
      const m = new T.Points(g, new T.PointsMaterial({ map: dot, size, color, transparent: true, opacity, depthWrite: false }));
      m.frustumCulled = false; scene.add(m); return m;
    };
    const spray = points(500, 0.32, '#ffffff', 0.9), sparks = points(120, 0.35, '#ffd65a', 1), flakes = points(900, 0.12, '#ffffff', 0.85);
    const rampMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: T.DoubleSide });
    const railMat = new T.MeshStandardMaterial({ color: '#e8433a', metalness: 0.6, roughness: 0.3 });
    const legMat = new T.MeshStandardMaterial({ color: '#4a5266', metalness: 0.4, roughness: 0.5 });
    const bannerMat = new T.MeshStandardMaterial({ map: bannerTexture(), roughness: 0.7, emissive: '#ffffff', emissiveIntensity: 0.15 });
    const bannerSide = new T.MeshStandardMaterial({ color: '#1b2350', roughness: 0.7 });
    // One banner for each park section, each in its own colour.
    const banners = {};
    for (const [text, col] of [['RAIL GARDEN', '#14405a'], ['JUMP LINE', '#5a2a10'], ['GAP JUMP', '#0f4a3a'], ['WALL RIDE', '#4a2a5a'], ['MEGA JUMP', '#5a1030'], ['SKI VILLAGE', '#6a1f1f']])
      banners[text] = new T.MeshStandardMaterial({ map: bannerTexture(text, col), roughness: 0.7, emissive: '#ffffff', emissiveIntensity: 0.15 });
    const railMat2 = new T.MeshStandardMaterial({ color: '#2fd6a0', metalness: 0.6, roughness: 0.3 });
    const wallMat = new T.MeshStandardMaterial({ color: '#b98a55', roughness: 0.8 });
    // Fans along the park, cheering, and big speakers.
    const crowdBody = new T.InstancedMesh(new T.CapsuleGeometry(0.28, 0.75, 3, 8), new T.MeshStandardMaterial({ roughness: 0.7 }), MAX_FANS);
    const crowdHead = new T.InstancedMesh(new T.SphereGeometry(0.17, 10, 8), new T.MeshStandardMaterial({ color: '#f1c7a5', roughness: 0.6 }), MAX_FANS);
    crowdBody.setColorAt(0, new T.Color('#ffffff'));
    const speakers = new T.InstancedMesh(merged([
      { geo: new T.BoxGeometry(1.1, 1.8, 0.9), m: at(0, 0.9, 0), color: '#1a1c24' },
      { geo: new T.CylinderGeometry(0.34, 0.34, 0.05, 16).rotateX(Math.PI / 2), m: at(0, 1.25, -0.46), color: '#565a66' },
      { geo: new T.CylinderGeometry(0.2, 0.2, 0.05, 16).rotateX(Math.PI / 2), m: at(0, 0.55, -0.46), color: '#565a66' },
    ]), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), 40);
    // The safety fence: posts and orange netting along both edges.
    const fencePosts = new T.InstancedMesh(new T.CylinderGeometry(0.05, 0.05, 1.3, 5).translate(0, 0.65, 0), new T.MeshStandardMaterial({ color: '#d9dde6', roughness: 0.5 }), 500);
    const fenceNet = new T.InstancedMesh(new T.PlaneGeometry(1, 1.05).rotateY(Math.PI / 2).translate(0, 0.62, 0),
      new T.MeshStandardMaterial({ color: '#ff6a1a', roughness: 0.8, side: T.DoubleSide, transparent: true, opacity: 0.88 }), 500);
    // Light towers: a tall pole with a bank of lamps that glow at night.
    const lightPoles = new T.InstancedMesh(merged([
      { geo: new T.CylinderGeometry(0.14, 0.2, 10, 8), m: at(0, 5, 0), color: '#59606f' },
      { geo: new T.BoxGeometry(0.15, 0.15, 2.2), m: at(0, 10, 0), color: '#59606f' },
    ]), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }), 40);
    const lampMat = new T.MeshBasicMaterial({ color: '#fff2c4' });
    const lamps = new T.InstancedMesh(new T.BoxGeometry(0.5, 0.45, 2.2), lampMat, 40);
    const glow = points(40, 9, '#ffe4a0', 0); glow.material.blending = T.AdditiveBlending;
    // The chairlift: towers, two cables, and chairs that go round.
    const towers = new T.InstancedMesh(merged([
      { geo: new T.CylinderGeometry(0.3, 0.45, 12, 8), m: at(0, 6, 0), color: '#6d7484' },
      { geo: new T.BoxGeometry(4.2, 0.3, 0.4), m: at(0, 12, 0), color: '#6d7484' },
      { geo: new T.CylinderGeometry(0.35, 0.35, 0.2, 12).rotateZ(Math.PI / 2), m: at(-1.8, 11.8, 0), color: '#2a2d36' },
      { geo: new T.CylinderGeometry(0.35, 0.35, 0.2, 12).rotateZ(Math.PI / 2), m: at(1.8, 11.8, 0), color: '#2a2d36' },
    ]), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }), 20);
    const cables = new T.InstancedMesh(new T.CylinderGeometry(0.035, 0.035, 1, 4).rotateX(Math.PI / 2), new T.MeshStandardMaterial({ color: '#22252d', roughness: 0.6 }), 40);
    const chairs = new T.InstancedMesh(merged([
      { geo: new T.CylinderGeometry(0.03, 0.03, 2.2, 4), m: at(0, -1.1, 0), color: '#2a2d36' },
      { geo: new T.BoxGeometry(1.5, 0.1, 0.55), m: at(0, -2.2, 0.05), color: '#3a6fd8' },
      { geo: new T.BoxGeometry(1.5, 0.6, 0.08), m: at(0, -1.9, 0.33), color: '#3a6fd8' },
      { geo: new T.BoxGeometry(1.5, 0.04, 0.04), m: at(0, -1.75, -0.3), color: '#2a2d36' },
    ]), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), 120);
    // DJ booth lights pulse to the beat.
    const boothGlow = new T.MeshStandardMaterial({ color: '#ff2fd0', emissive: '#ff2fd0', emissiveIntensity: 1, roughness: 0.4 });
    const boothGlow2 = new T.MeshStandardMaterial({ color: '#3bf0ff', emissive: '#3bf0ff', emissiveIntensity: 1, roughness: 0.4 });
    for (const m of [crowdBody, crowdHead, speakers, fencePosts, fenceNet, lightPoles, lamps, towers, cables, chairs]) { m.count = 0; m.frustumCulled = false; m.castShadow = m !== lamps; scene.add(m); }
    // Little flags along both edges of a park.
    const flags = new T.InstancedMesh(merged([
      { geo: new T.CylinderGeometry(0.03, 0.03, 1.6, 5), m: at(0, 0.8, 0), color: '#ffffff' },
      { geo: new T.ShapeGeometry(new T.Shape([new T.Vector2(0, 1.15), new T.Vector2(0.6, 1.38), new T.Vector2(0, 1.6)])), m: at(0, 0, 0), color: '#ffffff' },
    ]), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: T.DoubleSide }), 200);
    flags.setColorAt(0, new T.Color('#ffffff')); flags.count = 0; flags.frustumCulled = false; flags.castShadow = true; scene.add(flags);

    // Animals that run across the run.
    const animalMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const deer = new T.InstancedMesh(reindeerGeo(), animalMat, 40), hares = new T.InstancedMesh(hareGeo(), animalMat, 40);
    for (const m of [deer, hares]) { m.count = 0; m.frustumCulled = false; m.castShadow = true; scene.add(m); }
    // Slalom gates: two poles with a flag between them, red and blue in turn.
    const gateMats = ['#e8333a', '#2a63e8'].map((c) => new T.MeshStandardMaterial({ color: c, roughness: 0.5, side: T.DoubleSide }));
    const poleGeo = new T.CylinderGeometry(0.035, 0.035, 1.9, 6), panelGeo = new T.PlaneGeometry(1, 0.55);
    // The avalanche: a wall of rolling snow clouds right across the valley.
    const avalanche = new T.InstancedMesh(new T.IcosahedronGeometry(1, 1),
      new T.MeshStandardMaterial({ color: '#f3f6fb', roughness: 1, flatShading: true, transparent: true, opacity: 0.95 }), 90);
    avalanche.count = 0; avalanche.frustumCulled = false; scene.add(avalanche);
    // The village: houses, glowing windows, coloured lights along the eaves, chimney smoke and snowmen.
    const box1 = new T.BoxGeometry(1, 1, 1), icicle = new T.ConeGeometry(0.06, 0.5, 4);
    const clock = new T.CylinderGeometry(0.75, 0.75, 0.08, 20).rotateX(Math.PI / 2), spire = new T.ConeGeometry(2.4, 5.2, 4);
    const houseMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const winMat = new T.MeshStandardMaterial({ color: '#2a3550', emissive: '#ffc96a', emissiveIntensity: 0.1, roughness: 0.2, metalness: 0.3 });
    const bulbMat = new T.PointsMaterial({ map: dot, size: 0.5, vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false });
    const smoke = points(400, 1.9, '#d4d9e2', 0.35);
    const snowmen = new T.InstancedMesh(snowmanGeo(), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), 40);
    snowmen.count = 0; snowmen.frustumCulled = false; snowmen.castShadow = true; scene.add(snowmen);
    const cableMat = new T.MeshStandardMaterial({ color: '#2a2d36', roughness: 0.5, metalness: 0.6 });
    const iceMat = new T.MeshStandardMaterial({ color: '#cdeefc', roughness: 0.08, metalness: 0.1 });
    const starMat = new T.MeshStandardMaterial({ color: '#ffd23f', emissive: '#ffb000', emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.5 });
    // The ski jump's scoreboard and distance boards.
    const sjBoard = textCanvas(512, 256, (g, dist) => {
      g.fillStyle = '#10131c'; g.fillRect(0, 0, 512, 256); g.strokeStyle = '#ffd23f'; g.lineWidth = 8; g.strokeRect(6, 6, 500, 244);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#7fe3ff'; g.font = 'bold 44px sans-serif'; g.fillText('SKI JUMP', 256, 62);
      g.fillStyle = '#ffd23f'; g.font = 'bold 96px sans-serif'; g.fillText(dist == null ? '---.- M' : dist.toFixed(1) + ' M', 256, 168);
    });
    sjBoard.draw(null);
    const boards = {};
    const distBoard = (txt, c) => boards[txt] || (boards[txt] = textCanvas(256, 128, (g) => {
      g.fillStyle = c; g.fillRect(0, 0, 256, 128); g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 72px sans-serif'; g.fillText(txt, 128, 68);
    })).mat;
    for (const k of Object.keys(boards)) boards[k].draw();

    S = { renderer, scene, camera, hemi, sun, lamp, sky, skyMat, stars, aurora, auroraMat, peaks, tiles, trees, forest, rocks, coins, flags, rampMat, railMat, legMat, bannerMat, bannerSide, banners, railMat2, fencePosts, fenceNet, lightPoles, lampMat, lamps, glow, towers, cables, chairs, boothGlow, boothGlow2, wallMat, crowdBody, crowdHead, speakers, feats: [], skier, blob, tracks, spray, sparks, flakes, deer, hares, gateMats, poleGeo, panelGeo, avalanche, box1, icicle, clock, spire, houseMat, winMat, bulbMat, smoke, snowmen, cableMat, iceMat, starMat, treeMat, sjBoard, distBoard: (t, c) => { const m = distBoard(t, c); boards[t].draw(); return m; }, sjMesh: null, built: '' };
  }
  const TRACK = 90;

  /* ---------- Turning chunks into 3D ---------- */
  function fillTile(tile, ch) {
    const g = tile.geometry, P = g.attributes.position.array, N = g.attributes.normal.array, C = g.attributes.color.array;
    const snow = new T.Color('#f5f8fd'), blue = new T.Color('#d3def2'), rock = new T.Color('#545a6a'), rock2 = new T.Color('#7a8192'), c = new T.Color(), r = new T.Color();
    const ice1 = new T.Color('#4f9fd4'), ice2 = new T.Color('#93cdeb');
    for (let j = 0; j < ND; j++) {
      const d = ch.d0 + (j * CL) / (ND - 1), cx = center(d);
      for (let i = 0; i < NU; i++) {
        // Points are packed close together on the valley floor and spread out up the sides.
        const s = (i / (NU - 1)) * 2 - 1, x = cx + 170 * Math.sign(s) * Math.pow(Math.abs(s), 1.7), k = (j * NU + i) * 3;
        const n = normalAt(x, d);
        P[k] = x; P[k + 1] = height(x, d); P[k + 2] = -d;
        N[k] = n[0]; N[k + 1] = n[1]; N[k + 2] = n[2];
        // Snow everywhere, with bare rock where it is too steep for snow to stay.
        const steep = clamp((0.42 - n[1]) / 0.15 + noise(x * 0.08, d * 0.08) * 0.35, 0, 1);
        c.copy(snow).lerp(blue, clamp(0.45 + noise(x * 0.03, d * 0.03) * 0.7 + noise(x * 0.3, d * 0.12) * 0.35, 0, 1) * 0.8);
        if (steep > 0) c.lerp(r.copy(rock2).lerp(rock, clamp(0.5 + noise(x * 0.2, d * 0.2), 0, 1)), steep);
        // The frozen lake: blue ice with pale cracks and streaks.
        const ice = iceAt(x, d);
        if (ice > 0) {
          const crack = Math.pow(1 - Math.abs(noise(x * 0.35, d * 0.35)), 12) + Math.pow(1 - Math.abs(noise(x * 0.11 + 9, d * 0.11)), 20);
          c.lerp(r.copy(ice1).lerp(ice2, clamp(0.5 + noise(x * 0.06, d * 0.05) * 0.8, 0, 1)).lerp(snow, clamp(crack, 0, 0.7)), ice);
        }
        C[k] = c.r; C[k + 1] = c.g; C[k + 2] = c.b;
      }
    }
    g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = g.attributes.color.needsUpdate = true;
    tile.chunk = ch; tile.visible = true;
  }
  // Park features. Kickers are curved wedges of snow with a coloured lip, boxes are flat-topped slides,
  // and rails are metal bars on legs. All of them follow the slope.
  const LIPS = { kick: '#ff6a2c', big: '#ff2f55', hip: '#2fb5ff', mega: '#ffd23f', deck: '#ff2f55', ramp: '#2fd6a0' };
  // Where a kicker is across the run at d. Most stand still, a ramp that follows the valley bends with it.
  const fxAt = (f, d) => (f.follow ? center(d) + f.u : f.x);
  // How high a kicker (or the landing deck of a gap jump) lifts the snow, s from 0 to 1 along it.
  function lift(f, s) {
    if (f.type === 'deck') return f.h * (s < 0.08 ? s / 0.08 : s > 0.75 ? (1 - s) / 0.25 : 1);
    return f.h * s * s;
  }
  // The top of a rail or box at d. Rainbow rails arch up and down, kinked rails step down in the middle.
  function bendAt(f, s) {
    if (f.shape === 'rainbow') return 1.5 * Math.sin(Math.PI * s);
    if (f.shape === 'kink') return s < 0.38 ? 0 : s < 0.55 ? -0.75 * (s - 0.38) / 0.17 : -0.75;
    return 0;
  }
  // A rail on a roof sits on the roof (f.base), not on the snow.
  const railTop = (f, d) => (f.yAt ? f.yAt(d) : (f.base != null ? f.base : height(center(d) + f.u, d)) + f.top + bendAt(f, clamp((d - f.d) / f.len, 0, 1)));
  // Where a rail is across the run. Most follow the valley; a rail from roof to roof has its own line.
  const railX = (f, d) => (f.xAt ? f.xAt(d) : center(d) + f.u);

  /* ---------- The ski village ----------
     Wooden houses in three rows: one down the middle of the run, with a kicker up onto its first roof,
     and one along each side. Roofs are level, so on the slope every house is a step lower than the one
     before: ski off the end of a roof and you drop onto the next one. A house is turned to follow the valley.
     In a house, c is across it (from the middle) and a is along it (from the middle, downhill). */
  const SN = 0.35; // Snow lying on a roof.
  const EDGE = 0.25; // How far past the walls a roof holds you. The eaves stick out further, but only to look at.
  const WALLS = ['#9a6a43', '#b5462f', '#e6cf9c', '#5f86b0', '#7d9a55', '#e9e4d8', '#c27a3a', '#8a3b52'];
  const SHUTTERS = ['#2f5d3a', '#8a2a22', '#2d4a7a', '#f2efe6'];
  const BULBS = ['#ff4d4d', '#ffd23f', '#4dd2ff', '#6dff8a', '#ff7ae0'];
  const TRIM = '#3b2a1e', FRAME = '#f4efe4', SNOWC = '#f4f7fc', ROOFWOOD = '#5a3a26', STONE = '#7b7f8a', ICE = '#dff3ff';
  function houseLocal(f, x, d) { const X = x - f.xm, D = d - f.dm; return [(X - f.k * D) / f.n, (D + f.k * X) / f.n]; }
  function toWorld(f, c, a) { return { x: f.xm + (c + f.k * a) / f.n, d: f.dm + (a - f.k * c) / f.n }; }
  // The top of the snow on a roof, or the church tower.
  function roofLocal(f, c, a) {
    if (f.tower && a < -f.L / 2 + 3.4 && Math.abs(c) < 1.7) return f.towerTop;
    let y = f.roof + f.pitch * (f.hw - Math.abs(c));
    if (f.lip) { const q = (a - (f.L / 2 + EDGE - f.lip.len)) / f.lip.len; if (q > 0) y += f.lip.h * q * q; }
    return y;
  }
  // The roof height over a point, or null if the point is not over the house. Below it is the house itself.
  function roofY(f, x, d) {
    const [c, a] = houseLocal(f, x, d);
    if (Math.abs(a) > f.L / 2 + EDGE || Math.abs(c) > f.hw + EDGE) return null;
    return roofLocal(f, c, a);
  }
  function wedge(f, lift, top, side, edge) {
    const pos = [], col = [], n = 10;
    const quad = (a, b, c, e, cl) => { for (const p of [a, b, c, a, c, e]) { pos.push(p[0], p[1], p[2]); col.push(cl.r, cl.g, cl.b); } };
    const pt = (s, sd, up) => { const d = f.d + s * f.len, x = (f.type === 'box' ? center(d) + f.u : fxAt(f, d)) + sd * f.w; return [x, height(x, d) + (up ? lift(s) : -0.3), -d]; };
    for (let i = 0; i < n; i++) {
      const s0 = i / n, s1 = (i + 1) / n;
      quad(pt(s0, -1, 1), pt(s0, 1, 1), pt(s1, 1, 1), pt(s1, -1, 1), edge && i === n - 1 ? edge : top);
      quad(pt(s0, -1, 0), pt(s0, -1, 1), pt(s1, -1, 1), pt(s1, -1, 0), side);
      quad(pt(s0, 1, 1), pt(s0, 1, 0), pt(s1, 1, 0), pt(s1, 1, 1), side);
    }
    quad(pt(1, -1, 1), pt(1, 1, 1), pt(1, 1, 0), pt(1, -1, 0), side);
    quad(pt(0, 1, 1), pt(0, -1, 1), pt(0, -1, 0), pt(0, 1, 0), side);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new T.Mesh(g, S.rampMat); m.castShadow = m.receiveShadow = true;
    return m;
  }
  function featMesh(f) {
    let m;
    if (f.type === 'box') m = wedge(f, () => f.top, new T.Color('#e8eef8'), new T.Color('#2f6fe0'));
    else if (f.type === 'rail') {
      m = new T.Group();
      const pts = [];
      for (let s = 0; s <= f.len + 0.01; s += 0.5) { const d = f.d + s, x = railX(f, d); pts.push(new T.Vector3(x, railTop(f, d) - 0.05, -d)); }
      const bar = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), pts.length * 2, 0.07, 8), f.shape ? S.railMat2 : S.railMat);
      bar.castShadow = true; m.add(bar);
      for (let s = 0.3; s < f.len; s += f.posts ? f.len - 0.6 : 3) {
        const d = f.d + Math.min(s, f.len - 0.3), x = railX(f, d), y = f.posts ? f.posts(d) : f.base != null ? f.base : height(x, d), h = railTop(f, d) - y;
        const leg = new T.Mesh(new T.CylinderGeometry(0.05, 0.07, h + 0.3, 6), S.legMat);
        leg.position.set(x, y + (h - 0.3) / 2, -d); leg.castShadow = true; m.add(leg);
      }
    } else if (f.type === 'arch') {
      // The park's entrance: two posts and a banner right across the run.
      m = new T.Group();
      const half = f.half || FLOOR - 1, xl = center(f.d) + f.u - half, xr = center(f.d) + f.u + half, top = Math.max(height(xl, f.d), height(xr, f.d)) + (f.tall || 8);
      for (const x of [xl, xr]) {
        const y0 = height(x, f.d) - 0.5, post = new T.Mesh(new T.CylinderGeometry(0.35, 0.4, top - y0 + 1.6, 10), S.legMat);
        post.position.set(x, (top + 1.6 + y0) / 2, -f.d); post.castShadow = true; m.add(post);
      }
      const bm = S.banners[f.text] || S.bannerMat;
      const banner = new T.Mesh(new T.BoxGeometry(xr - xl, 3, 0.3), [S.bannerSide, S.bannerSide, S.bannerSide, S.bannerSide, bm, S.bannerSide]);
      banner.position.set((xl + xr) / 2, top, -f.d); banner.castShadow = true; m.add(banner);
    } else if (f.type === 'gate') {
      m = new T.Group();
      const mat = S.gateMats[f.c];
      for (const s of [-1, 1]) {
        const x = f.x + s * GATE_W, y = height(x, f.d);
        const pole = new T.Mesh(S.poleGeo, mat); pole.position.set(x, y + 0.95, -f.d); pole.castShadow = true; m.add(pole);
        const flag = new T.Mesh(S.panelGeo, mat); flag.scale.set(0.9, 1, 1); flag.position.set(x - s * 0.5, y + 1.55, -f.d); m.add(flag);
      }
    } else if (f.type === 'booth') {
      // The DJ booth: a stage with a deck, the DJ, speaker stacks and glowing light bars.
      m = new T.Group();
      const g = new T.Group(); g.position.set(f.x, f.y, -f.d); g.rotation.y = f.side > 0 ? Math.PI / 2 : -Math.PI / 2; m.add(g);
      const box = (w, h, dp, mat, x, y, z) => { const o = new T.Mesh(new T.BoxGeometry(w, h, dp), mat); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
      const dark = S.legMat;
      box(6, 1.2, 4, S.bannerSide, 0, 0.6, 0);
      box(3, 1, 0.8, dark, 0, 1.7, -0.6);
      box(3, 0.12, 0.85, S.boothGlow, 0, 2.25, -0.6);
      for (const x of [-2.6, 2.6]) { box(1.1, 2.6, 1, dark, x, 2.5, -0.4); box(0.2, 4, 0.2, dark, x, 3.2, 1.6); }
      box(5.4, 0.25, 0.25, S.boothGlow2, 0, 5.2, 1.6);
      const dj = new T.Mesh(new T.CapsuleGeometry(0.3, 0.8, 3, 8), S.boothGlow2); dj.position.set(0, 2.25, 0.3); g.add(dj);
      const head = new T.Mesh(new T.SphereGeometry(0.2, 10, 8), S.legMat); head.position.set(0, 3.0, 0.3); g.add(head);
    } else if (f.type === 'house') m = houseMesh(f);
    else if (VILLAGE_MESH[f.type]) m = VILLAGE_MESH[f.type](f);
    else if (f.type === 'wall') {
      // A wooden wall at the side of the run, leaning out a little, on two posts.
      m = new T.Group();
      const dm = f.d + f.len / 2, x = center(dm) + f.u, y = height(x, dm);
      const wall = new T.Mesh(new T.BoxGeometry(0.18, 3.2, f.len), S.wallMat);
      wall.position.set(x, y + 1.5, -dm); wall.rotation.z = -Math.sign(f.u) * 0.3; wall.rotation.x = Math.atan(SLOPE); wall.castShadow = wall.receiveShadow = true; m.add(wall);
      const trim = new T.Mesh(new T.BoxGeometry(0.22, 0.25, f.len), S.railMat);
      trim.position.set(x + Math.sign(f.u) * 0.45, y + 3.0, -dm); trim.rotation.x = Math.atan(SLOPE); m.add(trim);
    } else m = wedge(f, (s) => lift(f, s), new T.Color('#f7f9ff'), new T.Color(f.type === 'deck' ? '#c4d3ee' : '#9fb5dc'), new T.Color(LIPS[f.type]));
    m.feat = f;
    return m;
  }
  // A house: walls with windows, doors, lanterns and wooden trim, a snowy roof with icicles and
  // a string of coloured lights, a chimney, and for the church a tower with a clock and a spire.
  function houseMesh(f) {
    const g = new T.Group(); g.position.set(f.xm, 0, -f.dm); g.rotation.y = -Math.atan(f.k);
    const P = [], panes = [], lamps = [], bulbs = [], bulbCol = [];
    const box = (list, x, y, z, sx, sy, sz, color, rz = 0) => list.push({ geo: S.box1, m: atR(x, y, z, 0, 0, rz, sx, sy, sz), color });
    const L = f.L, hw = f.hw, E = f.eave, ov = f.ov, p = f.pitch;
    const gnd = (c, a) => { const w = toWorld(f, c, a); return height(w.x, w.d); };
    let yb = Infinity;
    for (const c of [-hw, 0, hw]) for (const a of [-L / 2, 0, L / 2]) yb = Math.min(yb, gnd(c, a));
    yb -= 1.2;
    // Walls, corner posts and bands of trim between the floors.
    box(P, 0, (E + yb) / 2, 0, 2 * hw, E - yb, L, f.col);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(P, sx * hw, (E + yb) / 2, sz * L / 2, 0.32, E - yb, 0.32, TRIM);
    box(P, 0, E - 0.12, 0, 2 * hw + 0.12, 0.24, L + 0.12, TRIM);
    for (let y = E - 2.8; y > yb + 1.4; y -= 2.8) box(P, 0, y, 0, 2 * hw + 0.06, 0.14, L + 0.06, TRIM);
    const win = (x, y, z, across) => { // A window with a frame, a cross and shutters. across: the window faces sideways.
      const W2 = across ? [0.08, 1.35, 1.1] : [1.1, 1.35, 0.08], o = across ? [Math.sign(x), 0] : [0, Math.sign(z)];
      box(P, x, y, z, ...W2, FRAME);
      box(panes, x + o[0] * 0.05, y, z + o[1] * 0.05, across ? 0.04 : 0.85, 1.1, across ? 0.85 : 0.04, '#ffffff');
      box(P, x + o[0] * 0.07, y, z + o[1] * 0.07, across ? 0.03 : 0.07, 1.1, across ? 0.07 : 0.03, FRAME);
      box(P, x + o[0] * 0.07, y, z + o[1] * 0.07, across ? 0.03 : 0.85, 0.07, across ? 0.85 : 0.03, FRAME);
      if (f.shut) for (const k of [-1, 1]) box(P, x + o[0] * 0.02 + (across ? 0 : k * 0.8), y, z + o[1] * 0.02 + (across ? k * 0.8 : 0), across ? 0.05 : 0.42, 1.3, across ? 0.42 : 0.05, f.shut);
    };
    // The long sides that face a street get a door, a lantern and rows of windows.
    const sides = f.u === 0 ? [-1, 1] : [-Math.sign(f.u)];
    for (const s of sides) {
      const ad = -L / 2 + rand(2.2, Math.max(2.4, L * 0.35)), gd = gnd(s * hw, ad), x = s * (hw + 0.04);
      box(P, x, gd + 1.12, -ad, 0.08, 2.3, 1.45, FRAME);
      box(P, x + s * 0.03, gd + 1.05, -ad, 0.08, 2.1, 1.2, '#4a2c1a');
      box(P, s * (hw + 0.5), gd + 2.42, -ad, 1.0, 0.12, 1.8, TRIM);
      box(P, s * (hw + 0.5), gd + 2.52, -ad, 1.0, 0.1, 1.8, SNOWC);
      box(lamps, s * (hw + 0.16), gd + 2.0, -(ad + 1.05), 0.22, 0.32, 0.22, '#ffffff');
      for (let a = -L / 2 + 1.6; a <= L / 2 - 1.3; a += 2.8) {
        for (let y = E - 1.35; ; y -= 2.8) {
          if (y - 0.7 < gnd(s * hw, a) + 0.5) break;
          if (Math.abs(a - ad) < 1.5 && y < gd + 3.2) continue;
          win(x, y, -a, true);
        }
      }
    }
    // Windows on both ends. The downhill end stands tall on the slope, so it has more floors.
    for (const e of [-1, 1]) {
      const a = e * L / 2;
      for (const c of hw > 3 ? [-hw * 0.5, hw * 0.5] : [0])
        for (let y = E - 1.35; y - 0.7 > gnd(c, a) + 0.5; y -= 2.8) win(c, y, -(a + e * 0.04), false);
      if (p * hw > 1.4) win(0, E + p * hw * 0.38, -(a + e * 0.04), false);
    }
    // A balcony on the downhill end of the chalets.
    if (p && !f.tower && E - 2.75 - gnd(0, L / 2) > 1.4) {
      const y = E - 2.75, z = -(L / 2 + 0.6), w = hw * 1.3;
      box(P, 0, y, z, w, 0.14, 1.2, TRIM); box(P, 0, y + 0.1, z, w, 0.08, 1.2, SNOWC);
      box(P, 0, y + 0.95, z - 0.55, w, 0.08, 0.08, TRIM);
      for (let x = -w / 2; x <= w / 2 + 0.01; x += 0.3) box(P, x, y + 0.5, z - 0.55, 0.05, 0.9, 0.05, TRIM);
    }
    // The roof: snow on top of dark wood, with icicles and lights along the eaves.
    let eaveY;
    if (p) {
      const phi = Math.atan(p), cs = Math.cos(phi), sn = Math.sin(phi), Rt = f.roof + p * hw, w = (hw + ov) / cs, len = L + 2 * ov;
      for (const s of [-1, 1]) {
        const tcx = s * (hw + ov) / 2, tcy = Rt - p * (hw + ov) / 2, nx = s * sn, ny = cs;
        box(P, tcx - nx * 0.11, tcy - ny * 0.11, 0, w, 0.22, len, SNOWC, -s * phi);
        box(P, tcx - nx * 0.31 + s * cs * 0.06, tcy - ny * 0.31 - sn * 0.06, 0, w + 0.12, 0.18, len + 0.1, ROOFWOOD, -s * phi);
      }
      box(P, 0, Rt + 0.02, 0, 0.4, 0.16, len, SNOWC);
      const tri = new T.ExtrudeGeometry(new T.Shape([new T.Vector2(-hw, 0), new T.Vector2(hw, 0), new T.Vector2(0, p * hw)]), { depth: 0.2, bevelEnabled: false });
      P.push({ geo: tri, m: at(0, E, L / 2 - 0.2), color: f.col }, { geo: tri, m: at(0, E, -L / 2), color: f.col });
      eaveY = f.roof - p * ov - 0.42;
    } else {
      box(P, 0, E + 0.15, 0, 2 * (hw + ov), 0.3, L + 2 * ov, TRIM);
      box(P, 0, f.roof - 0.06, 0, 2 * (hw + ov) - 0.04, 0.14, L + 2 * ov - 0.04, SNOWC);
      if (f.lip) P.push({ geo: lipGeo(hw + ov - 0.05, L / 2 + EDGE - f.lip.len, L / 2 + EDGE, f.roof, f.lip.h), m: new T.Matrix4(), color: SNOWC });
      eaveY = E - 0.02;
    }
    for (const s of [-1, 1]) for (let a = -L / 2 - ov + 0.3; a < L / 2 + ov; a += 0.7) {
      if (Math.random() < 0.65) { const sy = rand(0.5, 1.5); P.push({ geo: S.icicle, m: atR(s * (hw + ov - 0.08), eaveY - 0.25 * sy, -a, Math.PI, 0, 0, 1, sy, 1), color: ICE }); }
      const bc = new T.Color(BULBS[(Math.round(a / 0.7) + (s > 0 ? 2 : 0)) % BULBS.length] || BULBS[0]);
      bulbs.push(s * (hw + ov + 0.03), eaveY - 0.08 - 0.1 * Math.abs(Math.sin(a * 1.6)), -a); bulbCol.push(bc.r, bc.g, bc.b);
    }
    // Chimneys.
    for (const c of f.chims) {
      const base = roofLocal(f, c.c, c.a) - 0.6;
      box(P, c.c, (base + c.top) / 2, -c.a, 0.75, c.top - base, 0.75, STONE);
      box(P, c.c, c.top + 0.06, -c.a, 0.95, 0.14, 0.95, TRIM);
      box(P, c.c, c.top + 0.17, -c.a, 0.95, 0.1, 0.95, SNOWC);
    }
    // The church tower, with a clock, bell openings, a spire and a gold cross.
    if (f.tower) {
      const T0 = f.towerY, z = L / 2 - 1.7;
      box(P, 0, (yb + T0) / 2, z, 3.2, T0 - yb, 3.2, f.col);
      box(P, 0, T0, z, 3.5, 0.3, 3.5, TRIM);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(P, sx * 1.6, (yb + T0) / 2, z + sz * 1.6, 0.3, T0 - yb, 0.3, TRIM);
      for (const [dx, dz, sx, sz] of [[0, 1.62, 1, 0.06], [0, -1.62, 1, 0.06], [1.62, 0, 0.06, 1], [-1.62, 0, 0.06, 1]]) box(P, dx, T0 - 1.0, z + dz, sx, 1.3, sz, '#1d2130');
      P.push({ geo: S.clock, m: at(0, T0 - 3.0, z + 1.62), color: '#f6f1e2' });
      box(P, 0, T0 - 2.78, z + 1.68, 0.08, 0.5, 0.03, TRIM); box(P, 0.17, T0 - 3.0, z + 1.68, 0.36, 0.07, 0.03, TRIM);
      P.push({ geo: S.spire, m: at(0, T0 + 2.6, z, Math.PI / 4), color: '#3d4a5c' });
      box(P, 0, T0 + 5.6, z, 0.12, 0.9, 0.12, '#ffd23f'); box(P, 0, T0 + 5.75, z, 0.5, 0.12, 0.12, '#ffd23f');
    }
    const body = new T.Mesh(merged(P), S.houseMat); body.castShadow = body.receiveShadow = true; g.add(body);
    if (panes.length) g.add(new T.Mesh(merged(panes), S.winMat));
    if (lamps.length) g.add(new T.Mesh(merged(lamps), S.lampMat));
    const bg = new T.BufferGeometry();
    bg.setAttribute('position', new T.Float32BufferAttribute(bulbs, 3)); bg.setAttribute('color', new T.Float32BufferAttribute(bulbCol, 3));
    g.add(new T.Points(bg, S.bulbMat));
    for (const part of P) if (part.geo !== S.box1 && part.geo !== S.icicle && part.geo !== S.clock && part.geo !== S.spire) part.geo.dispose();
    return g;
  }

  // Parts lists into one group: solid parts, glass, lamps, shiny ice and coloured bulbs. Geometries in `own` are thrown away after.
  function partsGroup(o) {
    const g = new T.Group();
    const add = (list, mat, shadow) => { if (!list || !list.length) return; const m = new T.Mesh(merged(list), mat); if (shadow) m.castShadow = m.receiveShadow = true; g.add(m); };
    add(o.P, S.houseMat, true); add(o.panes, S.winMat); add(o.lamps, S.lampMat); add(o.ice, S.iceMat, true); add(o.star, S.starMat);
    if (o.bulbs && o.bulbs.length) {
      const bg = new T.BufferGeometry();
      bg.setAttribute('position', new T.Float32BufferAttribute(o.bulbs, 3)); bg.setAttribute('color', new T.Float32BufferAttribute(o.bulbCol, 3));
      g.add(new T.Points(bg, S.bulbMat));
    }
    for (const geo of o.own || []) geo.dispose();
    return g;
  }
  // Helpers for building: a box (centre, size, colour, turns), and a coloured bulb.
  function kit() {
    const o = { P: [], panes: [], lamps: [], ice: [], star: [], bulbs: [], bulbCol: [], own: [] };
    o.box = (list, x, y, z, sx, sy, sz, color, rx = 0, ry = 0, rz = 0) => list.push({ geo: S.box1, m: atR(x, y, z, rx, ry, rz, sx, sy, sz), color });
    o.geo = (g) => { o.own.push(g); return g; };
    o.bulb = (x, y, z, i) => { const c = new T.Color(BULBS[((i % BULBS.length) + BULBS.length) % BULBS.length]); o.bulbs.push(x, y, z); o.bulbCol.push(c.r, c.g, c.b); };
    return o;
  }
  const VILLAGE_MESH = {
    // Strings of coloured lights across a street, between two lamp posts, with little flags.
    garland(f) {
      const K = kit(), d = f.d, cx = center(d), xs = [cx + f.side * 5.5, cx + f.side * 13.6], ends = [];
      for (const x of xs) {
        const y = height(x, d);
        K.box(K.P, x, y + 3, -d, 0.16, 6, 0.16, '#2a2d36'); K.box(K.P, x, y + 0.3, -d, 0.4, 0.6, 0.4, '#2a2d36');
        K.box(K.P, x, y + 6.08, -d, 0.55, 0.12, 0.55, '#2a2d36'); K.box(K.lamps, x, y + 5.8, -d, 0.38, 0.42, 0.38, '#ffffff');
        K.box(K.P, x + f.side * 0.3, y + 4.2, -d, 0.5, 0.06, 0.06, '#2a2d36');
        ends.push([x, y + 5.5]);
      }
      const flag = K.geo(new T.ConeGeometry(0.2, 0.42, 3)), FL = ['#e8333a', '#ffd23f', '#2fd6a0', '#2a63e8'];
      const pt = (t) => [ends[0][0] + (ends[1][0] - ends[0][0]) * t, ends[0][1] + (ends[1][1] - ends[0][1]) * t - 1.1 * 4 * t * (1 - t)];
      const wire = [];
      for (let i = 0; i <= 24; i++) { const [x, y] = pt(i / 24); wire.push(new T.Vector3(x, y, -d)); if (i % 2 === 0) K.bulb(x, y - 0.12, -d, i / 2); else K.P.push({ geo: flag, m: atR(x, y - 0.25, -d, Math.PI, 0, 0), color: FL[(i >> 1) % 4] }); }
      const g = partsGroup(K), w = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(wire), 24, 0.02, 4), S.cableMat); g.add(w);
      return g;
    },
    // The giant Christmas tree: a huge snowy pine with lights spiralling round it, a gold star and presents.
    xtree(f) {
      const K = kit(), x = f.x, y = f.y, d = f.d, S2 = 2.55;
      for (let i = 0; i < 150; i++) {
        const h = i / 150, a = i * 0.62, r = (3.6 - h * 3.0) * S2 / 2.55 + 0.15, yy = y + 2.8 + h * 12.5;
        K.bulb(x + Math.cos(a) * r, yy, -(d + Math.sin(a) * r), i);
      }
      K.star.push({ geo: K.geo(new T.OctahedronGeometry(0.9)), m: atR(x, y + 17.2, -d, 0, 0, 0, 1, 1.3, 0.45), color: '#ffffff' });
      K.box(K.P, x, y + 16.4, -d, 0.15, 0.8, 0.15, '#ffd23f');
      const PR = ['#e8333a', '#2a63e8', '#ffd23f', '#2fd6a0', '#ff7ab8', '#7a4dff'];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * 6.28 + 0.3, r = rand(3.2, 4.2), px = x + Math.cos(a) * r, pd = d + Math.sin(a) * r, py = height(px, pd), sz = rand(0.6, 1.1);
        K.box(K.P, px, py + sz / 2, -pd, sz, sz, sz, PR[i % 6], 0, a, 0);
        K.box(K.P, px, py + sz / 2, -pd, sz + 0.04, sz + 0.02, 0.14, '#f4f4f4', 0, a, 0);
        K.box(K.P, px, py + sz / 2, -pd, 0.14, sz + 0.03, sz + 0.04, '#f4f4f4', 0, a, 0);
      }
      // A low fence round it.
      for (let i = 0; i < 20; i++) { const a = (i / 20) * 6.28, px = x + Math.cos(a) * 4.8, pd = d + Math.sin(a) * 4.8; K.box(K.P, px, height(px, pd) + 0.4, -pd, 0.12, 0.8, 0.12, '#c8302b'); }
      const g = partsGroup(K), tree = new T.Mesh(pineGeo(9, 16), S.treeMat);
      tree.position.set(x, y - 0.3, -d); tree.scale.set(S2, S2 * 1.05, S2); tree.castShadow = true; g.add(tree);
      return g;
    },
    // The ice rink: a level sheet of ice on a snow terrace, with boards round it, lights and a little hut.
    rink(f) {
      const K = kit(), x = f.x, d = f.d, yl = f.yl, RX = 6, RZ = 7;
      K.P.push({ geo: K.geo(new T.CylinderGeometry(1, 1, 1, 40)), m: atR(x, yl - 2.2, -d, 0, 0, 0, RX + 0.7, 4.4, RZ + 0.7), color: SNOWC });
      K.ice.push({ geo: K.geo(new T.CylinderGeometry(1, 1, 0.1, 40)), m: atR(x, yl - 0.02, -d, 0, 0, 0, RX, 1, RZ), color: '#ffffff' });
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * 6.28, a2 = ((i + 1) / 40) * 6.28, x1 = x + Math.cos(a) * RX, z1 = d + Math.sin(a) * RZ, x2 = x + Math.cos(a2) * RX, z2 = d + Math.sin(a2) * RZ;
        const len = Math.hypot(x2 - x1, z2 - z1), yaw = Math.atan2(x2 - x1, -(z2 - z1));
        K.box(K.P, (x1 + x2) / 2, yl + 0.4, -(z1 + z2) / 2, 0.12, 0.8, len + 0.05, i % 2 ? '#f4f4f4' : '#2a63e8', 0, yaw, 0);
        if (i % 4 === 0) K.bulb(x1, yl + 2.6 - 0.4 * Math.abs(Math.sin(a * 2)), -z1, i / 4);
      }
      for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.28 + 0.78, px = x + Math.cos(a) * (RX + 0.3), pd = d + Math.sin(a) * (RZ + 0.3); K.box(K.P, px, yl + 1.5, -pd, 0.14, 3, 0.14, '#2a2d36'); K.box(K.lamps, px, yl + 3.1, -pd, 0.4, 0.3, 0.4, '#ffffff'); }
      // The skate hut on the far side.
      const hx = x + Math.sign(f.u) * (RX + 2.5), hy = height(hx, d);
      K.box(K.P, hx, hy + 1.3, -d, 2.6, 2.6 + (yl - hy), 3.6, '#8a5a3a'); K.box(K.P, hx, hy + 2.8 + (yl - hy) / 2, -d, 3.2, 0.25, 4.2, SNOWC);
      K.box(K.panes, hx - Math.sign(f.u) * 1.32, yl + 1, -d, 0.05, 1, 1.6, '#ffffff');
      return partsGroup(K);
    },
    // A Christmas market stall: wooden walls, a counter with things to sell, a striped awning and lights.
    stall(f) {
      const K = kit(), y = height(f.x, f.d), P = K.P, box = K.box;
      box(P, 0, -0.3, 0, 4.3, 1.4, 3.8, '#6b4a30');
      box(P, 0, 1.3, -1.6, 4.2, 2.8, 0.15, '#8a5a3a');
      for (const sx of [-1, 1]) { box(P, sx * 2.05, 1.3, -0.1, 0.15, 2.8, 3.1, '#8a5a3a'); box(P, sx * 2.05, 1.4, 1.55, 0.14, 2.8, 0.14, '#5a3a22'); }
      box(P, 0, 0.55, 1.35, 4.2, 1.1, 0.7, '#a0683e'); box(P, 0, 1.13, 1.35, 4.3, 0.08, 0.8, '#5a3a22');
      const GOODS = ['#e8333a', '#ffd23f', '#2fd6a0', '#ff7ab8', '#f4f4f4', '#d98a1a'];
      for (let i = 0; i < 7; i++) box(P, -1.7 + i * 0.57, 1.3, 1.35 + rand(-0.15, 0.15), 0.32, rand(0.18, 0.4), 0.3, GOODS[(Math.random() * 6) | 0]);
      for (let i = 0; i < 7; i++) box(P, -1.8 + i * 0.6, 2.95, 0.15, 0.6, 0.12, 3.9, i % 2 ? '#f4f4f4' : f.col, 0.18, 0, 0);
      box(P, 0, 3.15, 0.0, 4.4, 0.14, 3.8, SNOWC, 0.18, 0, 0);
      box(P, 0, 3.8, -1.0, 2.6, 0.6, 0.1, f.col);
      for (let i = 0; i < 12; i++) K.bulb(-2.1 + i * 0.38, 2.55 - 0.1 * Math.abs(Math.sin(i * 1.7)), 2.0, i);
      box(K.lamps, 0, 2.4, 1.4, 0.3, 0.3, 0.3, '#ffffff');
      const g = partsGroup(K); g.position.set(f.x, y, -f.d); g.rotation.y = -f.side * Math.PI / 2;
      return g;
    },
    // A frozen fountain: a stone basin full of ice, a column, a bowl hung with icicles and a frozen jet on top.
    fountain(f) {
      const K = kit(), x = f.x, d = f.d, y = Math.max(height(x, d - 2), height(x, d + 2)) + 0.75, P = K.P;
      const cyl = K.geo(new T.CylinderGeometry(1, 1, 1, 8));
      P.push({ geo: cyl, m: atR(x, y - 1.2, -d, 0, 0.39, 0, 2.1, 2.4, 2.1), color: '#8e8a82' });
      P.push({ geo: cyl, m: atR(x, y + 0.02, -d, 0, 0.39, 0, 2.2, 0.16, 2.2), color: '#a9a49a' });
      K.ice.push({ geo: cyl, m: atR(x, y + 0.04, -d, 0, 0.39, 0, 1.9, 0.12, 1.9), color: '#ffffff' });
      P.push({ geo: cyl, m: atR(x, y + 1.1, -d, 0, 0, 0, 0.3, 2.2, 0.3), color: '#a9a49a' });
      P.push({ geo: K.geo(new T.CylinderGeometry(1.1, 0.4, 0.4, 12)), m: at(x, y + 2.35, -d), color: '#a9a49a' });
      K.ice.push({ geo: K.geo(new T.ConeGeometry(0.35, 1.3, 8)), m: at(x, y + 3.15, -d), color: '#ffffff' });
      for (let i = 0; i < 14; i++) { const a = (i / 14) * 6.28, sy = rand(1, 2.4); K.ice.push({ geo: S.icicle, m: atR(x + Math.cos(a) * 1.0, y + 2.1 - 0.25 * sy, -(d + Math.sin(a) * 1.0), Math.PI, 0, 0, 1.6, sy, 1.6), color: '#ffffff' }); }
      for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.28; K.ice.push({ geo: S.icicle, m: atR(x + Math.cos(a) * 0.5, y + 0.9, -(d + Math.sin(a) * 0.5), Math.PI + Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35, 2.2, 3.2, 2.2), color: '#ffffff' }); }
      return partsGroup(K);
    },
    /* The clock tower gate right across the run: two towers either side of a tall arch, a clock tower on top with a
       clock on both faces and a spire, castle walls out to the fences, flags and lights. */
    clocktower(f) {
      const K = kit(), P = K.P, box = K.box, d = f.d, cx = center(d), y = f.y, ST = '#b9b0a0', ST2 = '#9a9183', z = -d;
      for (const s2 of [-1, 1]) {
        const tx = cx + s2 * 9;
        box(P, tx, y + 7, z, 6, 18, 6, ST); box(P, tx, y + 16.2, z, 6.6, 0.5, 6.6, ST2);
        for (const a of [-1, 1]) for (const b of [-1, 0, 1]) { box(P, tx + a * 2.8, y + 17, z + b * 2.8, 1, 1.2, 1, ST); box(P, tx + b * 2.8, y + 17, z + a * 2.8, 1, 1.2, 1, ST); }
        box(P, tx, y + 17.6, z, 6, 0.12, 6, SNOWC);
        for (const fz of [-3.03, 3.03]) for (const wy of [4, 9, 13]) box(K.panes, tx, y + wy, z + fz, 1.2, 1.8, 0.05, '#ffffff');
        box(P, tx, y + 19.6, z, 0.12, 4, 0.12, '#59606f'); box(P, tx + 0.8, y + 21, z, 1.6, 1, 0.05, s2 < 0 ? '#e8333a' : '#2a63e8');
        // Castle walls out to the edge of the run.
        const wx = cx + s2 * 20;
        box(P, wx, y + 2.5, z, 16, 9, 4, ST2); box(P, wx, y + 7.1, z, 16.4, 0.3, 4.4, SNOWC);
        for (let k = -7; k <= 7; k += 2) box(P, wx + k, y + 7.7, z + 1.6, 1, 1, 0.8, ST2);
        for (const fz of [-1, 1]) { box(K.lamps, cx + s2 * 6.3, y + 4, z + fz * 3.2, 0.35, 0.5, 0.3, '#ffffff'); }
        // The arch: stepped stones in the top corners.
        box(P, cx + s2 * 5.4, y + 11.4, z, 1.2, 1.2, 6, ST); box(P, cx + s2 * 5.0, y + 11.8, z, 0.6, 0.4, 6, ST);
      }
      box(P, cx, y + 14, z, 12, 4, 6, ST); // Over the arch.
      for (let i = 0; i <= 16; i++) { const t = i / 16; K.bulb(cx - 6 + 12 * t, y + 11.6 + 0.5 * Math.sin(t * Math.PI), z + 3.1, i); K.bulb(cx - 6 + 12 * t, y + 11.6 + 0.5 * Math.sin(t * Math.PI), z - 3.1, i + 2); }
      // The clock tower.
      box(P, cx, y + 21, z, 8, 10, 5.6, '#ece6d8'); box(P, cx, y + 26.1, z, 8.8, 0.4, 6.4, TRIM); box(P, cx, y + 16.2, z, 8.6, 0.4, 6.2, TRIM);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(P, cx + sx * 4, y + 21, z + sz * 2.8, 0.4, 10, 0.4, TRIM);
      for (const fz of [-1, 1]) {
        const zz = z + fz * 2.85;
        P.push({ geo: S.clock, m: atR(cx, y + 22, zz, 0, 0, 0, 3.4, 3.4, 1), color: '#c89a2a' });
        P.push({ geo: S.clock, m: atR(cx, y + 22, zz + fz * 0.05, 0, 0, 0, 3, 3, 1), color: '#f6f1e2' });
        for (let h = 0; h < 12; h++) { const a = (h / 12) * 6.28; box(P, cx + Math.sin(a) * 1.9, y + 22 + Math.cos(a) * 1.9, zz + fz * 0.1, 0.14, h % 3 ? 0.25 : 0.45, 0.04, TRIM, 0, 0, -a); }
        const hr = rand(0, 6.28), mn = rand(0, 6.28);
        box(P, cx + Math.sin(hr) * 0.55, y + 22 + Math.cos(hr) * 0.55, zz + fz * 0.13, 0.16, 1.1, 0.04, TRIM, 0, 0, -hr);
        box(P, cx + Math.sin(mn) * 0.8, y + 22 + Math.cos(mn) * 0.8, zz + fz * 0.15, 0.1, 1.6, 0.04, TRIM, 0, 0, -mn);
        box(K.panes, cx, y + 18, zz, 2.4, 1.8, 0.05, '#ffffff');
        box(K.lamps, cx, y + 25.2, zz, 4, 0.12, 0.08, '#ffffff');
      }
      P.push({ geo: S.spire, m: atR(cx, y + 30, z, 0, Math.PI / 4, 0, 2.0, 1.6, 1.5), color: '#3d4a5c' });
      K.star.push({ geo: K.geo(new T.SphereGeometry(0.45, 12, 8)), m: at(cx, y + 34.6, z), color: '#ffffff' });
      box(P, cx, y + 35.5, z, 0.12, 1.6, 0.12, '#ffd23f');
      return partsGroup(K);
    },
  };
  // A snowy kicker on the end of a flat roof: y0 is the roof, it rises by h along the last part (a0 to a1).
  function lipGeo(hw, a0, a1, y0, h) {
    const pos = [], n = 8;
    const pt = (q, c, up) => [c, y0 + (up ? h * q * q : -0.05), -(a0 + (a1 - a0) * q)];
    const quad = (a, b, c, e) => { for (const v of [a, b, c, a, c, e]) pos.push(v[0], v[1], v[2]); };
    for (let i = 0; i < n; i++) {
      const q0 = i / n, q1 = (i + 1) / n;
      quad(pt(q0, -hw, 1), pt(q0, hw, 1), pt(q1, hw, 1), pt(q1, -hw, 1));
      quad(pt(q0, -hw, 0), pt(q0, -hw, 1), pt(q1, -hw, 1), pt(q1, -hw, 0));
      quad(pt(q0, hw, 1), pt(q0, hw, 0), pt(q1, hw, 0), pt(q1, hw, 1));
    }
    quad(pt(1, -hw, 1), pt(1, hw, 1), pt(1, hw, 0), pt(1, -hw, 0));
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    return g;
  }
  // A snowman with a carrot nose, a hat, a scarf and stick arms, looking up the hill.
  function snowmanGeo() {
    const ball = new T.SphereGeometry(1, 14, 10), parts = [
      { geo: ball, m: atR(0, 0.55, 0, 0, 0, 0, 0.6, 0.58, 0.6), color: '#f4f7fc' },
      { geo: ball, m: atR(0, 1.35, 0, 0, 0, 0, 0.44, 0.44, 0.44), color: '#f4f7fc' },
      { geo: ball, m: atR(0, 1.95, 0, 0, 0, 0, 0.3, 0.3, 0.3), color: '#f4f7fc' },
      { geo: new T.ConeGeometry(0.06, 0.35, 6).rotateX(Math.PI / 2), m: at(0, 1.95, 0.42), color: '#ff7a1a' },
      { geo: new T.CylinderGeometry(0.24, 0.24, 0.34, 12), m: at(0, 2.36, 0), color: '#1a1c24' },
      { geo: new T.CylinderGeometry(0.38, 0.38, 0.04, 14), m: at(0, 2.2, 0), color: '#1a1c24' },
      { geo: new T.CylinderGeometry(0.31, 0.34, 0.12, 12), m: at(0, 1.72, 0), color: '#e8333a' },
    ];
    for (const s of [-1, 1]) {
      parts.push({ geo: ball, m: atR(s * 0.1, 2.03, 0.26, 0, 0, 0, 0.045, 0.045, 0.045), color: '#1a1c24' });
      parts.push({ geo: new T.CylinderGeometry(0.025, 0.03, 0.9, 4), m: atR(s * 0.7, 1.55, 0, 0, 0, s * 1.05), color: '#5a3a22' });
    }
    for (const y of [1.2, 1.4, 1.6]) parts.push({ geo: ball, m: atR(0, y, Math.sqrt(Math.max(0, 0.44 * 0.44 - (y - 1.35) ** 2)) - 0.01, 0, 0, 0, 0.045, 0.045, 0.045), color: '#1a1c24' });
    return merged(parts);
  }
  /* The ski jump, built once per run: the in-run on steel stilts with its tracks and red side walls, the start
     hut and lift tower at the top, the lip, and down the landing hill the K and HS lines, green lines along the
     edges, distance boards, the judges' tower and a scoreboard that shows how far you flew. */
  function skiJumpMesh(g) {
    const grp = new T.Group(), P = [], panes = [], lamps = [];
    const box = (list, x, y, z, sx, sy, sz, color, rx = 0, ry = 0, rz = 0) => list.push({ geo: S.box1, m: atR(x, y, z, rx, ry, rz, sx, sy, sz), color });
    const pos = [], col = [], c1 = new T.Color();
    const quad = (a, b, c, e, cl) => { c1.set(cl); for (const v of [a, b, c, a, c, e]) { pos.push(v[0], v[1], v[2]); col.push(c1.r, c1.g, c1.b); } };
    const W2 = 1.9, step = 1;
    for (let d = JUMP_TOP; d < JUMP_LIP - 0.01; d += step) {
      const d2 = Math.min(d + step, JUMP_LIP), x1 = center(d), x2 = center(d2), y1 = g.inrunY(d), y2 = g.inrunY(d2);
      const P1 = (x, dx, y, dd) => [x + dx, y, -dd];
      quad(P1(x1, -W2, y1, d), P1(x1, W2, y1, d), P1(x2, W2, y2, d2), P1(x2, -W2, y2, d2), '#f1f5fb'); // Snow.
      for (const t of [-0.45, -0.2, 0.2, 0.45]) quad(P1(x1, t - 0.06, y1 + 0.02, d), P1(x1, t + 0.06, y1 + 0.02, d), P1(x2, t + 0.06, y2 + 0.02, d2), P1(x2, t - 0.06, y2 + 0.02, d2), '#7d8aa3'); // Icy tracks.
      for (const s2 of [-1, 1]) {
        quad(P1(x1, s2 * W2, y1 - 1.3, d), P1(x1, s2 * W2, y1 + 0.8, d), P1(x2, s2 * W2, y2 + 0.8, d2), P1(x2, s2 * W2, y2 - 1.3, d2), '#c8302b'); // Side walls.
        quad(P1(x1, s2 * (W2 + 0.15), y1 + 0.8, d), P1(x1, s2 * W2, y1 + 0.8, d), P1(x2, s2 * W2, y2 + 0.8, d2), P1(x2, s2 * (W2 + 0.15), y2 + 0.8, d2), '#f4f4f4');
      }
      quad(P1(x1, -W2, y1 - 1.3, d), P1(x2, -W2, y2 - 1.3, d2), P1(x2, W2, y2 - 1.3, d2), P1(x1, W2, y1 - 1.3, d), '#4d5566'); // Underneath.
    }
    // The lip: a red and white edge right across.
    { const x = center(JUMP_LIP), y = g.sj.lipY; box(P, x, y - 0.65, -JUMP_LIP - 0.05, W2 * 2 + 0.3, 1.4, 0.12, '#c8302b'); box(P, x, y + 0.02, -JUMP_LIP + 0.3, W2 * 2, 0.04, 0.6, '#ff4040'); }
    const rg = new T.BufferGeometry(); rg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); rg.setAttribute('color', new T.Float32BufferAttribute(col, 3)); rg.computeVertexNormals();
    const ramp = new T.Mesh(rg, S.rampMat); ramp.castShadow = ramp.receiveShadow = true; grp.add(ramp);
    // Steel stilts with cross braces.
    for (let d = JUMP_TOP + 2; d < JUMP_LIP - 1; d += 6) {
      const x = center(d), top = g.inrunY(d) - 1.3;
      for (const s2 of [-1, 1]) { const y0 = height(x + s2 * 1.5, d) - 1, h = top - y0; if (h > 0.3) box(P, x + s2 * 1.5, y0 + h / 2, -d, 0.35, h, 0.35, '#5d6675'); }
      const y0 = Math.max(height(x - 1.5, d), height(x + 1.5, d)), h = top - y0;
      for (let y = y0 + 3; y < top - 1; y += 4) box(P, x, y, -d, 3.0, 0.16, 0.16, '#6d7686');
      if (h > 4) for (let y = y0 + 1; y + 4 < top; y += 4) box(P, x, y + 2, -d, 0.12, 4.6, 0.12, '#6d7686', 0, 0, 0.62);
    }
    // At the top: the start hut on its platform, and the lift tower beside the in-run.
    {
      const d = JUMP_TOP + 3, x = center(d), y = g.inrunY(d), gy = height(x + 5, d);
      box(P, x, y + 1.9, -(d - 2), 5.5, 3.8, 4.2, '#b5462f'); box(P, x, y + 3.95, -(d - 2), 6.2, 0.3, 5, TRIM); box(P, x, y + 4.15, -(d - 2), 6.2, 0.15, 5, SNOWC);
      box(panes, x, y + 2.3, -(d - 2) + 2.12, 3.8, 1.3, 0.05, '#ffffff');
      box(P, x + 5, (gy + y + 6) / 2, -d, 3.2, y + 6 - gy, 3.2, '#9aa3b0');
      for (let yy = gy + 3; yy < y + 5; yy += 3) box(panes, x + 5, yy, -d + 1.62, 1.6, 1.2, 0.05, '#ffffff');
      box(P, x + 5, y + 6.15, -d, 3.5, 0.3, 3.5, TRIM); box(P, x + 2.8, y + 0.4, -d, 1.4, 0.2, 2.2, '#6d7686');
      box(lamps, x - 2.6, y + 3.4, -(d - 2) + 2.2, 0.3, 0.4, 0.3, '#ffffff'); box(lamps, x + 2.6, y + 3.4, -(d - 2) + 2.2, 0.3, 0.4, 0.3, '#ffffff');
      for (const fx of [-3.2, 3.2]) { box(P, x + fx, y + 5.5, -(d - 2), 0.08, 3.2, 0.08, '#dddddd'); box(P, x + fx + 0.6 * Math.sign(fx), y + 6.6, -(d - 2), 1.2, 0.7, 0.04, fx < 0 ? '#2a63e8' : '#ffd23f'); }
    }
    // Down the landing hill.
    const hillPt = (u, d) => { const x = center(d) + u; return [x, height(x, d), d]; };
    const line = (s0, color, w) => { // A coloured line across the hill.
      const d = JUMP_LIP + s0;
      for (let u = -12; u < 12; u += 2) { const a = hillPt(u, d), b = hillPt(u + 2, d); quad([a[0], a[1] + 0.06, -(d - w)], [b[0], b[1] + 0.06, -(d - w)], [b[0], b[1] + 0.06, -(d + w)], [a[0], a[1] + 0.06, -(d + w)], color); }
    };
    pos.length = 0; col.length = 0;
    line(JUMP_K, '#e8333a', 0.35); line(JUMP_HS, '#2a63e8', 0.35);
    for (let sd = 30; sd <= JUMP_HS + 20; sd += 10) if (sd !== JUMP_K && sd !== JUMP_HS) line(sd, '#c9d4e6', 0.08);
    const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); lg.setAttribute('color', new T.Float32BufferAttribute(col, 3)); lg.computeVertexNormals();
    const lines = new T.Mesh(lg, S.rampMat); lines.receiveShadow = true; grp.add(lines);
    // Green spruce lines along both edges, and distance boards.
    for (let sd = 4; sd < JUMP_HILL + 10; sd += 2.5) for (const u of [-12.5, 12.5]) { const [x, y, d] = hillPt(u, JUMP_LIP + sd); box(P, x, y + 0.25, -d, 0.6, 0.5, 1.6, '#24563a'); }
    for (const sd of [60, 80, JUMP_K, JUMP_HS]) for (const u of [-14.5, 14.5]) {
      const [x, y, d] = hillPt(u, JUMP_LIP + sd), b = new T.Mesh(new T.BoxGeometry(1, 1, 1), S.distBoard(sd === JUMP_K ? 'K ' + sd : sd === JUMP_HS ? 'HS ' + sd : String(sd), sd === JUMP_K ? '#e8333a' : sd === JUMP_HS ? '#2a63e8' : '#1b2350'));
      b.position.set(x, y + 1.6, -d); b.scale.set(2.6, 1.3, 0.15); b.rotation.y = -Math.sign(u) * 0.5; b.castShadow = true; grp.add(b);
      box(P, x, y + 0.5, -d, 0.12, 1.0, 0.12, '#59606f');
    }
    // The judges' tower beside the hill.
    {
      const [x, y, d] = hillPt(-21, JUMP_LIP + 70);
      box(P, x, y + 6, -d, 4.5, 12, 4, '#e9e4d8'); box(P, x, y + 12.2, -d, 5.4, 0.4, 5, TRIM); box(P, x, y + 12.5, -d, 5.4, 0.2, 5, SNOWC);
      box(panes, x + 2.27, y + 10.3, -d, 0.05, 2.4, 3.6, '#ffffff');
      for (let yy = y + 2.5; yy < y + 9; yy += 3) box(panes, x + 2.27, yy, -d, 0.05, 1.2, 1.2, '#ffffff');
    }
    // The scoreboard at the bottom of the outrun, facing up the hill.
    {
      const [x, y, d] = hillPt(17, JUMP_LIP + JUMP_HILL - 10);
      for (const s2 of [-1, 1]) box(P, x + s2 * 3.6, y + 3.5, -d, 0.4, 7, 0.4, '#59606f');
      const board = new T.Mesh(new T.BoxGeometry(8, 4, 0.4), [S.legMat, S.legMat, S.legMat, S.legMat, S.sjBoard.mat, S.legMat]);
      board.position.set(x, y + 6, -d); board.rotation.y = 0.35; board.castShadow = true; grp.add(board);
    }
    const body = new T.Mesh(merged(P), S.houseMat); body.castShadow = body.receiveShadow = true; grp.add(body);
    grp.add(new T.Mesh(merged(panes), S.winMat), new T.Mesh(merged(lamps), S.lampMat));
    return grp;
  }
  // A sign with big text on it, for the ski jump's distance boards and scoreboard.
  function textCanvas(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    const api = { mat: new T.MeshStandardMaterial({ map: t, roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.25, emissiveMap: t }), draw(...a) { draw(c.getContext('2d'), ...a); t.needsUpdate = true; } };
    return api;
  }
  function bannerTexture(word = 'TERRAIN PARK', col = '#1b2350') {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = col; g.fillRect(0, 0, 1024, 64);
    g.fillStyle = '#ffd23f'; g.fillRect(0, 0, 1024, 5); g.fillRect(0, 59, 1024, 5);
    g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) { g.fillStyle = i === 1 ? '#ffffff' : '#7fe3ff'; g.fillText(i === 1 ? word : '★  ★  ★', 170 + i * 342, 34); }
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }

  let STORM_DAY = null, STORM_NIGHT = null, LAMP_ON = null;
  function dropMesh(m) { S.scene.remove(m); m.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }

  /* ---------- The game ---------- */
  const ski = {
    get W() { if (!locked) { const wide = window.innerWidth > window.innerHeight; W = wide ? 640 : 450; H = wide ? 360 : 600; } return W; },
    get H() { return H; },
    color: 'var(--violet)', title: 'Endless Ski', label: 'Score',
    quietScore: true, // The score goes up every metre, so coins and jumps get their own sounds instead.
    intro: PARK_ONLY ? 'Start with a ski jump, then ski down an endless 3D terrain park. Grind rails, ride walls, ski over the village rooftops and fly off the mega jump. Land your tricks clean and stay off the fence.'
      : 'Ski down an endless 3D valley. Dodge the trees, rocks and reindeer, grab coins, fly off kickers, and survive slaloms, frozen lakes, snowstorms and avalanches.',
    hint: '<kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> to steer, <kbd>Space</kbd> to jump. In the air, hold <kbd>←</kbd> <kbd>→</kbd> to spin, <kbd>W</kbd> to front flip and <kbd>S</kbd> to back flip. <kbd>S</kbd> on a rail spins you round. On a phone, hold a side to steer, swipe up to jump, and swipe up or down in the air to flip. <kbd>P</kbd> to pause',

    reset() {
      locked = true; // Keep the screen shape until the game is closed.
      ph = ph.map(() => rand(0, 6.3)); SEED = (Math.random() * 1e9) | 0;
      ZONES = PARK_ONLY ? [] : ZONE_TYPES.slice().sort(() => Math.random() - 0.5);
      // The ski jump: its lip stands 4 m over the snow, and the in-run rises behind it.
      this.sj = { lipY: height(center(JUMP_LIP), JUMP_LIP) + 4, done: false, dist: null, mesh: null };
      this.jumpFlight = false;
      this.d = 0.5; this.x = center(this.d); this.vx = 0; this.v = 4;
      this.y = this.inrunY(this.d); this.vy = 0; this.air = false; this.airT = 0; this.spin = 0;
      this.flip = 0; this.sw = false; this.airSw = false; this.ollie = false; this.fromRail = false; this.jumpCd = 0; this.jumpQ = 0; this.boost = 0; this.boostT = 0;
      this.swapT = 0; this.look = 0; this.up = this.down = false; this.flipTouch = 0;
      this.plan = []; this.planD = PARK_AT; this.order = []; this.sections = 0;
      this.chunks = []; this.nextChunk = -CL; this.nextRamp = 150; this.grind = null; this.grindT = 0; this.wasPark = false; this.bump = 0;
      this.lastG = this.y;
      this.parts = []; this.sparks = []; this.pops = []; this.trail = []; this.trailD = -1;
      this.coins = 0; this.bonus = 0; this.score = 0; this.t = 0; this.crash = null; this.shake = 0; this.sndT = 0;
      this.left = this.right = this.touch = false; this.tx = W / 2;
      this.cam = null; this.lean = 0; this.crouch = 0.3; this.mult = 1; this.multT = 0; this.grab = '';
      this.wallR = null; this.line = 0; this.lineT = 0; this.bestLine = 0; this.parkStart = 0;
      this.zoneK = -1; this.gateHit = 0; this.gateStreak = 0; this.gateN = 0; this.gateI = 0; this.ava = null;
      this.storm = 0; this.wind = 0; this.windX = 0; this.fallT = 0; this.ice = 0;
      this.villages = []; this.marks = []; this.onRoof = null; this.roofFrom = null; this.roofRunV = null;
      this.fans(JUMP_LIP + 150, JUMP_LIP + 215, 3); // A crowd along the ski jump's outrun.
      this.gen();
      if (S) { S.tiles.forEach((t) => { t.chunk = null; t.visible = false; }); S.feats.forEach(dropMesh); S.feats = []; S.built = ''; if (S.sjMesh) { dropMesh(S.sjMesh); S.sjMesh = null; } }
    },

    stop() { locked = false; },

    key(e, down) {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.left = down;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.right = down;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') this.up = down;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { this.down = down; if (down && !e.repeat) this.switchUp(); }
      if (e.code === 'Space' && down && !e.repeat) this.jump();
    },
    press(down) { this.touch = down; if (!down) this.flipTouch = 0; },
    // On a phone: swipe up to jump. In the air, swipe up (front flip) or down (back flip) and keep the finger down to keep flipping.
    swipe(dx, dy) {
      if (Math.abs(dy) < Math.abs(dx)) return;
      if (this.air && !this.grind) this.flipTouch = dy < 0 ? 1 : -1;
      else if (dy < 0) this.jump();
      else this.switchUp();
    },
    point(p) { this.tx = p.x; },

    /* ----- The mountain ahead ----- */
    gen() {
      while (this.nextChunk < this.d + CL * (CHUNKS - 1)) { this.chunks.push(this.makeChunk(this.nextChunk)); this.nextChunk += CL; }
      while (this.chunks.length && this.chunks[0].d0 + CL < this.d - 25) this.chunks.shift();
    },
    makeChunk(d0) {
      const ch = { d0, trees: [], forest: [], rocks: [], coins: [], feats: [], flags: [], gates: [], animals: [], crowd: [], speakers: [], booths: [], fence: [], lights: [], towers: [], snowmen: [], blocks: [] }, lv = level(d0);
      const put = (list, x, d, s) => list.push({ x, d, s, y: height(x, d), r: rand(0, 6.3), h: rand(0.9, 1.15) });
      // No kickers on the ice or in the middle of a slalom.
      const calm = (d) => { const z = zoneAt(d); return !z || (z.type !== 'lake' && z.type !== 'slalom'); };
      // A kicker now and then between the parks.
      if (!PARK_ONLY && d0 >= this.nextRamp && !inPark(d0 - 60) && !inPark(d0 + CL + 60)) {
        const rd = d0 + rand(5, 40);
        if (calm(rd - 20) && calm(rd + 70)) this.kicker(ch, rd, rand(-12, 12), 7, 1.9, 2, 'kick');
        this.nextRamp = rd + RAMP_EVERY * rand(0.8, 1.3);
      }
      this.park(ch, d0);
      this.slalom(ch, d0);
      const inLane = (x, d) => parkMask(d) > 0 || ch.feats.some((f) => Math.abs(x - f.x) < 7 && d > f.d - 8 && d < f.d + 55)
        || (zoneMask('slalom', d, 25) > 0 && Math.abs(x - center(d)) < 16); // A clear run between the gates.
      // Thick forest up the valley sides.
      for (let k = 0; k < 560; k++) {
        const u = (Math.random() < 0.5 ? -1 : 1) * (FLOOR - 3 + Math.pow(Math.random(), 1.15) * 120), d = d0 + rand(0, CL), x = center(d) + u;
        if (inPark(d) && (Math.abs(u) < FLOOR + 7 || Math.abs(u + FLOOR + 15) < 5)) continue; // Room for the fans, the lights and the chairlift.
        if (normalAt(x, d)[1] > 0.45 && noise(x * 0.03, d * 0.03) > -0.45) put(ch.forest, x, d, rand(0.9, 2));
      }
      // Trees and rocks to dodge on the valley floor, more and more of them the further you go.
      if (d0 > 50 && !PARK_ONLY) {
        const n = Math.floor(2 + lv * 9 + rand(0, 2.5));
        for (let k = 0; k < n; k++) {
          const d = d0 + rand(0, CL), x = center(d) + rand(-FLOOR + 2, FLOOR - 2);
          if (inLane(x, d)) continue;
          if (iceAt(x, d) > 0) { if (Math.random() < 0.45) put(ch.rocks, x, d, rand(0.8, 1.5)); continue; } // Only rocks stick out of the ice.
          if (Math.random() < 0.7) { const m = 1 + ((Math.random() * 2.4) | 0); for (let q = 0; q < m; q++) put(ch.trees, x + rand(-2.2, 2.2), d + rand(-2.2, 2.2), rand(0.7, 1.25)); }
          else put(ch.rocks, x, d, rand(0.8, 1.8));
        }
        if (Math.random() < 0.55) {
          const ru = rand(-FLOOR + 4, FLOOR - 4), d = d0 + rand(0, CL - 30);
          for (let q = 0; q < 7; q++) { const dd = d + q * 4, x = center(dd) + ru; if (!inLane(x, dd)) ch.coins.push({ x, d: dd, y: height(x, dd) + 0.9 }); }
        }
        // Coins in a wavy line across the ice: hard to follow when you slide.
        if (zoneMask('lake', d0 + CL / 2, 0.01) > 0) {
          const a = rand(0, 6.3);
          for (let dd = d0 + 2; dd < d0 + CL; dd += 3.5) { const x = center(dd) + Math.sin(dd / 14 + a) * 14; if (iceAt(x, dd) > 0.5) ch.coins.push({ x, d: dd, y: height(x, dd) + 0.9 }); }
        }
      }
      this.animals(ch, d0, lv);
      return ch;
    },
    // A kicker, with coins up in the air where the jump goes. Side hits (hips) throw you towards the middle.
    kicker(ch, d, u, len, w, h, type, noCoins) {
      const f = { type, x: center(d) + u, u, d, len, w, h };
      ch.feats.push(f);
      if (noCoins) return;
      const v = cruise(d), a = Math.min(2 * h / len - SLOPE, 0.5) + SLOPE, side = type === 'hip' ? -Math.sign(u) * HIP_THROW : 0;
      for (let s = 4; s < 90; s += 4) {
        const up = h + a * s - ((G / 2) * s * s) / (v * v); // Height above the snow where the jump goes.
        if (up < 0.8) break;
        const dd = d + len + s, x = center(dd) + u + (side * s) / v;
        ch.coins.push({ x, d: dd, y: height(x, dd) + up });
      }
    },
    // A rail (with a small kicker to pop onto it) or a box you can ride straight onto.
    rail(ch, d, u, len, box, shape) {
      const f = { type: box ? 'box' : 'rail', x: center(d) + u, u, d, len, top: box ? 0.55 : shape === 'rainbow' ? 0.6 : 0.95, w: box ? 0.6 : 0.12, shape };
      if (!box) this.kicker(ch, d - 4.4, u, 4, 1.3, 1.05, 'kick', true);
      ch.feats.push(f);
      for (let s = 3; s < len; s += 3) { const dd = d + s, x = center(dd) + u; ch.coins.push({ x, d: dd, y: railTop(f, dd) + 0.9 }); }
      return f;
    },
    /* ----- The terrain park -----
       The park is planned ahead as a list of things to build, section after section. Each chunk then
       builds the things that lie in it. Sections: a rail garden, a jump line, a gap jump and wall rides,
       in a shuffled order, with the mega jump after every round of them. */
    park(ch, d0) {
      while (this.planD < d0 + CL + 80) {
        if (!inPark(this.planD)) { this.planD = PARK_AT + Math.ceil((this.planD - PARK_AT) / PARK_EVERY) * PARK_EVERY; continue; }
        if (!PARK_ONLY && this.planD > PARK_AT + Math.floor((this.planD - PARK_AT) / PARK_EVERY) * PARK_EVERY + PARK_LEN - 150) { this.planD += 50; continue; }
        if (!this.order.length) this.order = this.sections++ === 0 ? ['rails', 'village', 'jumps', 'gap', 'walls', 'mega'] : ['rails', 'jumps', 'gap', 'walls', 'village'].sort(() => Math.random() - 0.5).concat('mega');
        this.planD += this['sec_' + this.order.shift()](this.planD) + 12;
      }
      const keep = [];
      for (const it of this.plan) { if (it.d >= d0 && it.d < d0 + CL) it.make(ch); else if (it.d >= d0 + CL) keep.push(it); }
      this.plan = keep;
      if (inPark(d0) || inPark(d0 + CL)) this.parkEdges(ch, d0);
    },
    // Queue something to build at d.
    at(d, make) { this.plan.push({ d, make }); },
    // Roughly how far past the lip you come down off a kicker, at this point's cruising speed (a bit more with a boost).
    landDist(len, h, d) {
      const v = cruise(d) * 1.15, a = Math.min(2 * h / len - SLOPE, 0.5) + SLOPE;
      return (a + Math.sqrt(a * a + 2 * G * h / (v * v))) * v * v / G * 0.8;
    },
    sign(d, text, opts) { this.at(d, (ch) => ch.feats.push(Object.assign({ type: 'arch', x: center(d), u: 0, d, len: 1, text }, opts))); },
    fans(a, b, rows = 2) {
      for (let d = a; d < b; d += 1.4) this.at(d, (ch) => {
        for (const side of [-1, 1]) for (let r = 0; r < rows; r++) {
          const x = center(d) + side * (FLOOR + 0.6 + r * 1.3 + rand(0, 0.6));
          ch.crowd.push({ x, d: d + rand(-0.4, 0.4), y: height(x, d), c: (Math.random() * 7) | 0, ph: rand(0, 6.3) });
        }
      });
    },
    speakers(d) { this.at(d, (ch) => { for (const side of [-1, 1]) { const x = center(d) + side * (FLOOR + 1.6); ch.speakers.push({ x, d, y: height(x, d), side }); } }); },
    // One random feature in a lane: rails of all shapes, boxes and kickers.
    any(d, u, inner) {
      const r = Math.random();
      this.at(d, (ch) => {
        if (r < 0.2) this.rail(ch, d, u, rand(13, 18), false);
        else if (r < 0.36) this.rail(ch, d, u, rand(10, 14), true);
        else if (r < 0.5) this.rail(ch, d, u, rand(14, 18), false, 'rainbow');
        else if (r < 0.64) this.rail(ch, d, u, rand(15, 19), false, 'kink');
        else if (r < 0.86 || !inner) this.kicker(ch, d, u, 8, 2.2, 2.6, 'kick');
        else this.kicker(ch, d, u, 11, 2.8, 4.2, 'big');
      });
    },
    hip(d, side) { this.at(d, (ch) => this.kicker(ch, d, side * (FLOOR - 5.5), 6, 2.4, 1.8, 'hip')); },
    wallRide(d, side, len = 18) { this.at(d, (ch) => ch.feats.push({ type: 'wall', x: center(d + len / 2) + side * (FLOOR - 6), u: side * (FLOOR - 6), d, len, w: 0.6 })); },
    // Rows of rails, boxes and kickers across four lanes, with side hits on the edges.
    sec_rails(d) {
      this.sign(d, d < PARK_AT + 60 ? 'TERRAIN PARK' : 'RAIL GARDEN'); this.fans(d - 6, d + 8, 1); this.speakers(d + 4);
      const LANES = [-13.5, -4.5, 4.5, 13.5];
      for (let i = 0; i < 5; i++) {
        const lanes = LANES.slice().sort(() => Math.random() - 0.5), n = i === 0 ? 4 : Math.random() < 0.5 ? 3 : 4;
        for (let j = 0; j < n; j++) this.any(d + 22 + i * 30, lanes[j] + rand(-1.2, 1.2), Math.abs(lanes[j]) < 9);
      }
      this.hip(d + 45, -1); this.hip(d + 105, 1);
      return 175;
    },
    // A line of four kickers down the middle, each bigger than the last, spaced so you land before the next.
    // A box line and rails run beside it.
    sec_jumps(d) {
      this.sign(d, 'JUMP LINE'); this.fans(d - 6, d + 8, 1);
      let k = d + 20;
      for (const [len, w, h, type] of [[8, 2.4, 2.6, 'kick'], [10, 2.8, 3.6, 'big'], [12, 3.2, 4.6, 'big'], [14, 3.6, 5.6, 'big']]) {
        const at = k; this.at(at, (ch) => this.kicker(ch, at, 0, len, w, h, type));
        k += len + this.landDist(len, h, at) + 22;
      }
      for (let b = d + 24; b < k - 30; b += 19) { const bd = b; this.at(bd, (ch) => this.rail(ch, bd, -14, 12, true)); }
      for (let r = d + 30; r < k - 40; r += 42) { const rd = r, shape = ['kink', 'rainbow', ''][(Math.random() * 3) | 0] || undefined; this.at(rd, (ch) => this.rail(ch, rd, 13.5, 17, false, shape)); }
      return k - d;
    },
    // The gap jump: a kicker, a gap, then a landing deck. Come up short and you crash into it.
    sec_gap(d) {
      this.sign(d, 'GAP JUMP', { half: 6, tall: 10 }); this.fans(d - 6, d + 8, 1);
      const kd = d + 25, dd = kd + 9 + 15;
      const deck = { type: 'deck', x: center(dd), u: 0, d: dd, len: 20, w: 3.8, h: 3.2 };
      this.at(kd, (ch) => { this.kicker(ch, kd, 0, 9, 3.4, 3, 'kick', true); ch.feats[ch.feats.length - 1].deck = deck; });
      this.at(dd, (ch) => ch.feats.push(deck));
      this.any(d + 30, -14, false); this.any(d + 30, 13.5, false); this.any(d + 75, -14, false); this.any(d + 75, 13.5, false);
      this.hip(d + 110, -1);
      return dd + 20 + this.landDist(9, 3, kd) * 0.5 + 15 - d;
    },
    // Wall rides on both sides in turn, with big kickers and boxes down the middle.
    sec_walls(d) {
      this.sign(d, 'WALL RIDE'); this.fans(d - 6, d + 8, 1);
      for (let i = 0; i < 4; i++) this.wallRide(d + 20 + i * 38, i % 2 ? 1 : -1);
      for (const m of [40, 115]) { const kd = d + m; this.at(kd, (ch) => this.kicker(ch, kd, 0, 11, 2.8, 4.2, 'big')); }
      for (const m of [30, 80, 130]) { const bd = d + m, u = (m / 10) % 2 ? 7 : -7; this.at(bd, (ch) => this.rail(ch, bd, u, 13, true)); }
      return 175;
    },
    // The mega jump: ten metres high, with a big crowd, speakers and a DJ booth by the landing.
    sec_mega(d) {
      const kd = d + 32, len = 24, h = 10, land = kd + len + this.landDist(len, h, kd);
      this.sign(d + 6, 'MEGA JUMP', { tall: 14 });
      this.at(kd, (ch) => this.kicker(ch, kd, 0, len, 6, h, 'mega'));
      this.fans(d, kd + 20, 2); this.fans(land - 40, land + 25, 3);
      this.speakers(d + 4); this.speakers(kd + 12); this.speakers(land - 30); this.speakers(land + 10);
      const bd = land - 12, side = Math.random() < 0.5 ? -1 : 1;
      this.at(bd, (ch) => { const x = center(bd) + side * (FLOOR + 5); ch.feats.push({ type: 'booth', x, u: side * (FLOOR + 5), d: bd, len: 0, y: height(x, bd), side }); });
      return land + 30 - d;
    },
    /* The ski village. A kicker takes you up onto the first roof of the middle row, then each roof is a step
       lower than the last, so you can ski from roof to roof. Two of the chalets have a rail along the ridge,
       the shop has one on its flat roof, and the hotel at the end has a snow kicker to fly off.
       Houses line both sides, with the church on one of them, and snowmen and boxes stand in the streets. */
    sec_village(d) {
      this.sign(d, 'SKI VILLAGE', { tall: 10 }); this.fans(d - 6, d + 8, 1);
      this.villages.push({ a: d, done: false });
      const rd = d + 22, rl = 14, hd = rd + rl, GAP = 4.5;
      // The kicker ends just where the roof starts, so you take off from the snow, not from the roof.
      this.at(rd, (ch) => ch.feats.push({ type: 'ramp', follow: true, x: center(hd), u: 0, d: rd, len: rl - EDGE, w: 4.6, h: 3 + SN }));
      /* The middle row is different every time: the lodge first, then 3 to 5 houses picked at random, each with
         its own size and its own thing on the roof, then the hotel. One gap has a rail across it, from roof to roof.
         Get across every roof without touching the snow for a ROOFTOP RUN. */
      const row = [['lodge', 20]], picks = ['chalet', 'chalet', 'shop', 'kicker'], n = 3 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++) row.push([picks[(Math.random() * picks.length) | 0], rand(11, 17)]);
      row.push(['hotel', 18]);
      const V = { n: row.length, got: new Set(), done: false }, houses = [], bridge = 1 + ((Math.random() * (row.length - 2)) | 0);
      let k = hd;
      row.forEach(([kind, len], i) => {
        const at = k, extra = Math.random();
        this.at(at, (ch) => {
          const f = this.house(ch, at, 0, len, kind === 'kicker' ? 'shop' : kind);
          f.mid = V; f.midI = i; houses[i] = f;
          if (kind === 'kicker') f.lip = { len: 4, h: 0.55 };
          if (kind === 'lodge') { this.roofRail(ch, f, at + 9, 9); this.roofCoins(ch, f, 1, 8); }
          else if (kind === 'hotel' || kind === 'kicker') this.roofCoins(ch, f, 1, len - 5);
          else if (kind === 'chalet' && extra < 0.6 && i !== bridge) this.roofRail(ch, f, at + 1.5, len - 3, true);
          else if (kind === 'shop' && extra < 0.75 && i !== bridge) this.roofRail(ch, f, at + 2, len - 4);
          else this.roofCoins(ch, f, 1, i === bridge ? len - 4 : len);
          // The gap rail: from the back of this roof, over the gap, down onto the next roof.
          if (i === bridge) {
            const a = at + len - 3, b = at + len + GAP + 3;
            this.at(b, (ch2) => this.gapRail(ch2, houses[i], houses[i + 1], a, b));
          }
        });
        k += len + GAP;
      });
      const end = k - GAP; V.endD = end;
      // Strings of lights across both streets, from the middle row to the side rows.
      for (let gd = hd + 8; gd < end - 5; gd += 22) { const g2 = gd; this.at(g2, (ch) => { for (const side of [-1, 1]) { ch.feats.push({ type: 'garland', d: g2, len: 0, x: center(g2), u: side * 9.5, side }); for (const pu of [5.5, 13.6]) ch.blocks.push({ d: g2, u: side * pu, hw: 0.3, hd: 0.3, y0: -1e9, y1: height(center(g2) + side * pu, g2) + 6, name: 'a lamp post' }); } }); }
      // The side rows. Now and then a big pine or a snowman stands in a gap between two houses.
      const churchSide = Math.random() < 0.5 ? -1 : 1;
      for (const side of [-1, 1]) {
        let s = d + 20 + rand(0, 6), churchAt = side === churchSide ? rand(hd + 15, end - 45) : Infinity;
        while (s < end - 6) {
          const church = s >= churchAt, len = church ? 18 : rand(10, 15), sd = s, u = side * 18.6;
          const kind = church ? 'church' : Math.random() < 0.3 ? 'flat' : 'chalet';
          if (church) churchAt = Infinity;
          this.at(sd, (ch) => this.house(ch, sd, u, len, kind));
          const gap = rand(5, 10), gd = s + len + gap / 2;
          s += len + gap;
          if (s < end - 6 && Math.random() < 0.55) {
            const tree = Math.random() < 0.6;
            this.at(gd, (ch) => {
              const x = center(gd) + u + rand(-1, 1), y = height(x, gd);
              if (tree) ch.trees.push({ x, d: gd, s: rand(1.4, 1.8), y, r: rand(0, 6.3), h: rand(0.95, 1.1) });
              else ch.snowmen.push({ x, d: gd, y, r: rand(-0.4, 0.4) });
            });
          }
        }
      }
      // In the streets: snowmen to dodge, and a box on each side.
      for (const [m, side] of [[22, -1], [56, 1], [96, -1]]) {
        const sd = hd + m, u = side * rand(8, 11);
        this.at(sd, (ch) => { const x = center(sd) + u; ch.snowmen.push({ x, d: sd, y: height(x, sd), r: rand(-0.4, 0.4) }); });
      }
      for (const [m, side] of [[38, 1], [76, -1]]) { const bd = hd + m; this.at(bd, (ch) => this.rail(ch, bd, side * 9.5, 12, true)); }
      // Villagers out in front of the side houses, waving.
      for (let vd = d + 30; vd < end; vd += rand(6, 14)) { const v2 = vd, side = Math.random() < 0.5 ? -1 : 1; this.at(v2, (ch) => { const x = center(v2) + side * 14.3; ch.crowd.push({ x, d: v2, y: height(x, v2), c: (Math.random() * 7) | 0, ph: rand(0, 6.3) }); }); }
      // The town square: a giant Christmas tree, an ice rink with skaters, market stalls and frozen fountains.
      const sq = end + 45, treeSide = Math.random() < 0.5 ? -1 : 1;
      this.at(sq + 25, (ch) => this.place(ch, 'xtree', sq + 25, treeSide * 16, { hw: 2.6, hd: 2.6, h: 16, name: 'the Christmas tree' }));
      this.at(sq + 12, (ch) => {
        const u = -treeSide * 17.5, x = center(sq + 12) + u, yl = Math.max(height(x - 6, sq + 5), height(x + 6, sq + 5), height(x, sq + 5)) + 0.25;
        const f = this.place(ch, 'rink', sq + 12, u, { yl });
        ch.blocks.push({ d: sq + 12, u, hw: 6.5, hd: 7.5, y0: f.y - 3, y1: yl + 1, name: 'the ice rink' });
        const dir = Math.random() < 0.5 ? -1 : 1; // Everyone skates round the same way, a few the wrong way.
        for (let i = 0; i < 11; i++) ch.crowd.push({ x, d: sq + 12, y: yl, c: (Math.random() * 7) | 0, ph: rand(0, 6.3), rink: { x, d: sq + 12, a: rand(0, 6.3), r: rand(1.5, 4.8), sp: rand(0.35, 0.7) * (Math.random() < 0.85 ? dir : -dir) } });
      });
      for (const [m, side] of [[0, treeSide], [48, treeSide], [55, -treeSide], [2, -treeSide]]) {
        const sd = sq + m; this.at(sd, (ch) => {
          const f = this.place(ch, 'stall', sd, side * 23, { hw: 2, hd: 2.3, h: 3.6, name: 'a market stall', side, col: ['#c8302b', '#2a63e8', '#2f8a4a', '#d98a1a'][(Math.random() * 4) | 0] });
          const x = f.x + side * 0.7; ch.crowd.push({ x, d: sd + rand(-0.8, 0.8), y: height(x, sd), c: (Math.random() * 7) | 0, ph: rand(0, 6.3) });
        });
      }
      for (const side of [-1, 1]) { const fd = sq + 38 + side * 3; this.at(fd, (ch) => this.place(ch, 'fountain', fd, side * 9.5, { hw: 2.1, hd: 2.1, h: 3.8, name: 'a frozen fountain' })); }
      // A kicker in front of the clock tower, to fly through its arch.
      const kd = sq + 50; this.at(kd, (ch) => this.kicker(ch, kd, 0, 8, 2.4, 2.4, 'kick'));
      // The clock tower gate: ski (or fly) through the arch in the middle.
      const gd = sq + 75;
      this.at(gd, (ch) => this.place(ch, 'clocktower', gd, 0, {}));
      this.marks.push({ d: gd, fn: () => {
        if (Math.abs(this.x - center(this.d)) > 6) return;
        const pts = (this.air ? 800 : 300) * this.mult; this.bonus += pts;
        this.pop(this.air ? 'FLEW THROUGH THE CLOCK TOWER' : 'THROUGH THE CLOCK TOWER', '+' + pts, '#ffd75e'); snd.trick();
      } });
      return gd + 30 - d;
    },
    // A house, turned to follow the valley, with a level roof. kind: lodge, shop, hotel or flat (flat roofs), chalet or church.
    house(ch, d, u, len, kind) {
      const xf = center(d) + u, xb = center(d + len) + u, k = (xb - xf) / len, n = Math.hypot(1, k);
      const church = kind === 'church', flat = kind !== 'chalet' && !church;
      const hw = kind === 'lodge' || kind === 'hotel' ? 4.5 : church ? 4.6 : u ? 3.8 : 4, e0 = church ? 5.2 : 3;
      const f = { type: 'house', kind, u, x: (xf + xb) / 2, xm: (xf + xb) / 2, d, dm: d + len / 2, len, k, n, L: len * n, hw, ov: 0.5,
        eave: height(xf, d) + e0, pitch: flat ? 0 : church ? 0.8 : 0.42, chims: [],
        col: church ? '#ece6d8' : WALLS[(Math.random() * WALLS.length) | 0], shut: Math.random() < 0.6 ? SHUTTERS[(Math.random() * SHUTTERS.length) | 0] : null };
      f.roof = f.eave + SN;
      if (kind === 'hotel') f.lip = { len: 5, h: 0.6 };
      if (church) { f.tower = true; f.towerY = f.eave + 8; f.towerTop = f.towerY + 4; }
      if (kind === 'chalet' || kind === 'flat') {
        const c = (Math.random() < 0.5 ? -1 : 1) * f.hw * (u ? 0.62 : 0.85), a = rand(-f.L / 2 + 2, f.L / 2 - 2), w = toWorld(f, c, a);
        f.chims.push({ c, a, top: roofLocal(f, c, a) + 1.4, x: w.x, d: w.d });
      }
      ch.feats.push(f);
      return f;
    },
    // A low rail along the middle of a roof, so you ride straight onto it: on a flat roof it stands on short legs,
    // on a chalet it runs along the ridge.
    roofRail(ch, f, d, len, ridge) {
      const r = { type: 'rail', x: center(d) + f.u, u: f.u, d, len, top: ridge ? 0.12 : 0.25, w: 0.12, base: ridge ? f.roof + f.pitch * f.hw : f.roof };
      ch.feats.push(r);
      for (let s = 2; s < len; s += 3) { const dd = d + s; ch.coins.push({ x: center(dd) + f.u, d: dd, y: railTop(r, dd) + 0.9 }); }
    },
    // A rail from the back of one roof, down over the gap, onto the next roof.
    gapRail(ch, f1, f2, a, b) {
      if (!f1 || !f2) return;
      const ya = roofY(f1, center(a), a) + 0.25, yb = roofY(f2, center(b), b) + 0.25;
      const r = { type: 'rail', x: center(a), u: 0, d: a, len: b - a, top: 0, w: 0.12, shape: 'gap',
        yAt: (d) => ya + (yb - ya) * clamp((d - a) / (b - a), 0, 1), posts: (d) => (d < (a + b) / 2 ? ya : yb) - 0.25 };
      ch.feats.push(r);
      for (let s = 1.5; s < b - a; s += 2.5) ch.coins.push({ x: center(a + s), d: a + s, y: r.yAt(a + s) + 0.9 });
    },
    // A thing in the village with a box you crash into: hw across, hd along, h tall.
    place(ch, type, d, u, o) {
      const x = center(d) + u, f = Object.assign({ type, d, len: 0, x, u, y: height(x, d) }, o);
      ch.feats.push(f);
      if (o.hw) ch.blocks.push({ d, u, hw: o.hw, hd: o.hd, y0: f.y - 1, y1: f.y + o.h, name: o.name });
      if (type === 'clocktower') { // The two sides, and the beam over the arch.
        for (const s2 of [-1, 1]) ch.blocks.push({ d, u: s2 * 17, hw: 11, hd: 3, y0: f.y - 5, y1: f.y + 40, name: 'the clock tower' });
        ch.blocks.push({ d, u: 0, hw: 6.2, hd: 3, y0: f.y + 12, y1: f.y + 40, name: 'the clock tower' });
      }
      return f;
    },
    roofCoins(ch, f, a, b) {
      for (let s = a; s < b; s += 3) { const dd = f.d + s, x = center(dd) + f.u, y = roofY(f, x, dd); if (y != null) ch.coins.push({ x, d: dd, y: y + 0.9 }); }
    },
    // Along both edges of the park: the safety fence with flags, light towers, and the chairlift up the left side.
    parkEdges(ch, d0) {
      for (let d = Math.ceil(d0 / 4) * 4; d < d0 + CL; d += 4) if (inPark(d)) for (const s of [-1, 1]) {
        const x = center(d) + s * FENCE; ch.fence.push({ x, d, y: height(x, d), s });
        if (d % 20 === 0) ch.flags.push({ x: x - s * 0.1, d, y: height(x, d) + 0.1, c: (d / 20 + (s > 0 ? 1 : 0)) % 2 });
      }
      for (let d = Math.ceil(d0 / 64) * 64; d < d0 + CL; d += 64) if (inPark(d)) { const s = (d / 64) % 2 ? 1 : -1, x = center(d) + s * (FLOOR + 3.2); ch.lights.push({ x, d, y: height(x, d), s }); }
      for (let d = Math.ceil(d0 / LIFT_SPAN) * LIFT_SPAN; d < d0 + CL; d += LIFT_SPAN) { const x = center(d) - (FLOOR + 15); ch.towers.push({ x, d, y: height(x, d) }); }
    },
    // Slalom gates through the slalom stretch, left and right in turn. Ski between the poles.
    slalom(ch, d0) {
      const z = zoneAt(d0) || zoneAt(d0 + CL - 1);
      if (!z || z.type !== 'slalom') return;
      const n = Math.floor((ZONE_LEN - 40) / 24) + 1;
      for (let i = 0; i < n; i++) {
        const d = z.s + 20 + i * 24;
        if (d < d0 || d >= d0 + CL) continue;
        const g = { type: 'gate', x: center(d) + (i % 2 ? 1 : -1) * rand(3, 9), u: 0, d, len: 0, c: i % 2, i, n };
        ch.feats.push(g); ch.gates.push(g);
      }
    },
    // Now and then reindeer or hares wait at the edge of the forest, and run across when you come close.
    animals(ch, d0, lv) {
      if (d0 < 250 || PARK_ONLY || Math.random() > 0.28 + 0.2 * lv) return;
      const d = d0 + rand(8, 50), z = zoneAt(d);
      if (parkMask(d) > 0 || (z && z.type === 'slalom')) return;
      const deer = Math.random() < 0.55, dir = Math.random() < 0.5 ? 1 : -1, n = deer ? 1 + ((Math.random() * 3) | 0) : 1 + ((Math.random() * 2) | 0);
      for (let q = 0; q < n; q++) {
        const dd = d + q * rand(1.5, 3.5), x = center(dd) - dir * (FLOOR - 1 + q * 2);
        ch.animals.push({ deer, d: dd, x, y: height(x, dd), dir, speed: deer ? rand(6.5, 8.5) : rand(8, 11), run: false, ph: rand(0, 6.3), done: false });
      }
    },
    // The snow height under a point, kickers included.
    // The snow height under a point, kickers and roofs included.
    // The top of the ski jump's in-run.
    inrunY(d) { return this.sj.lipY + table(INRUN, (JUMP_LIP - d) * 4); },
    onInrun(x, d) { return this.sj && d >= JUMP_TOP && d <= JUMP_LIP && Math.abs(x - center(d)) < 1.9; },
    ground(x, d) {
      let y = height(x, d), roof = this.onInrun(x, d) ? this.inrunY(d) : -Infinity;
      for (const ch of this.chunks) {
        if (d < ch.d0 - 30 || d > ch.d0 + CL + 30) continue;
        for (const f of ch.feats) {
          if (f.type === 'house') { if (d > f.d - 2 && d < f.d + f.len + 2) { const r = roofY(f, x, d); if (r != null && r > roof) roof = r; } }
          else if (f.h && d >= f.d && d <= f.d + f.len && Math.abs(x - fxAt(f, d)) < f.w) y += lift(f, (d - f.d) / f.len);
        }
      }
      return Math.max(y, roof);
    },
    kickerAt(x, d) {
      for (const ch of this.chunks) for (const f of ch.feats) if (f.h && d >= f.d - 0.5 && d <= f.d + f.len + 0.5 && Math.abs(x - fxAt(f, d)) < f.w + 0.3) return f;
      return null;
    },
    // The house at a point.
    houseAt(x, d) {
      for (const ch of this.chunks) for (const f of ch.feats) if (f.type === 'house' && d > f.d - 2 && d < f.d + f.len + 2 && roofY(f, x, d) != null) return f;
      return null;
    },
    // The house whose roof you are on (or just above, by up to `above`).
    roofAt(x, d, y, above = 0.25) {
      for (const ch of this.chunks) for (const f of ch.feats) {
        if (f.type !== 'house' || d < f.d - 2 || d > f.d + f.len + 2) continue;
        const r = roofY(f, x, d);
        if (r != null && y >= r - 0.25 && y <= r + above) return f;
      }
      return null;
    },
    wallAt(x, d) {
      for (const ch of this.chunks) for (const f of ch.feats) if (f.type === 'wall' && d >= f.d && d <= f.d + f.len) {
        const u = x - center(d); if (Math.sign(u) === Math.sign(f.u) && Math.abs(u) > Math.abs(f.u) - 0.5) return f;
      }
      return null;
    },
    railAt(x, d) {
      for (const ch of this.chunks) for (const f of ch.feats) if ((f.top || f.yAt) && d >= f.d && d <= f.d + f.len && Math.abs(x - railX(f, d)) < f.w + 0.5) return f;
      return null;
    },

    /* ----- Moving ----- */
    pop(text, sub, col) { this.pops.push({ text, sub, col, life: 1.8 }); },
    puff(n, x, y, d, speed, up, list = this.parts) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, 6.3), sp = rand(0.3, 1) * speed;
        list.push({ x, y, d, vx: Math.cos(a) * sp, vy: rand(0.5, 1) * up, vd: this.v * rand(0.4, 0.85) + Math.sin(a) * sp, life: rand(0.4, 1), max: 1 });
      }
    },
    hit(what, msg) {
      this.jumpFlight = false;
      this.crash = { t: 0, what, msg, m: Math.floor(this.d), vx: this.vx };
      this.shake = 1; snd.crash();
      this.puff(60, this.x, this.y + 0.5, this.d, 5, 5);
    },

    update(dt) {
      this.t += dt;
      if (this.crash) {
        this.crash.t += dt; this.v *= Math.exp(-3 * dt); this.vx *= Math.exp(-3 * dt);
        this.d += this.v * dt; this.x += this.vx * dt;
        this.vy -= G * dt; this.y = Math.max(this.y + this.vy * dt, this.ground(this.x, this.d));
        if (this.ava && !this.ava.out) this.ava.d += cruise(this.d) * dt; // It rolls on over you.
        this.moveBits(dt);
        if (this.crash.t > 1.4) {
          const msg = (this.crash.msg || 'You hit ' + this.crash.what) + ' after ' + this.crash.m + ' m';
          return over(this.score, msg + (this.coins ? ' and grabbed ' + this.coins + (this.coins === 1 ? ' coin.' : ' coins.') : '.'));
        }
        return;
      }
      let dir = (this.right ? 1 : 0) - (this.left ? 1 : 0);
      if (this.touch) dir = clamp((this.tx - W / 2) / 70, -1, 1);
      const u = this.x - center(this.d), wall = Math.max(0, Math.abs(u) - FLOOR), maxSide = 5 + 0.3 * this.v;
      const bend = (center(this.d + 1) - center(this.d - 1)) / 2;
      if (inPark(this.d) && !this.wasPark) { this.pop('TERRAIN PARK', 'RAILS, BOXES AND JUMPS', '#7fe3ff'); this.parkStart = this.bonus; this.bestLine = 0; }
      if (!inPark(this.d) && this.wasPark) {
        this.endLine();
        const pts = this.bonus - this.parkStart;
        this.pop('PARK DONE', pts.toLocaleString('en-US') + ' PARK POINTS' + (this.bestLine >= 3 ? ', BEST LINE x' + this.bestLine : ''), '#ffd75e'); snd.trick();
      }
      this.wasPark = inPark(this.d);
      // A line: features one after another. It ends if you ride on the snow too long between them.
      if (this.line && !this.air && !this.grind && !this.wallR && (this.lineT -= dt) <= 0) this.endLine();
      this.zones(dt);
      if (this.crash) return;
      this.bump = Math.max(0, (this.bump || 0) - dt);
      this.jumpCd = Math.max(0, this.jumpCd - dt); this.jumpQ = Math.max(0, this.jumpQ - dt);
      this.boost *= Math.exp(-BOOST_FADE * dt); this.boostT = Math.max(0, this.boostT - dt);
      this.swapT = Math.max(0, this.swapT - dt);
      const pitch = (this.up ? 1 : 0) - (this.down ? 1 : 0) || this.flipTouch;

      if (this.wallR) {
        // Riding up a wall and back down, then off it into the air.
        const w = this.wallR, f = w.f, side = Math.sign(f.u);
        w.t += dt; this.d += this.v * dt;
        const k = Math.min(w.t / 0.85, 1), x = center(this.d) + f.u - side * 0.4;
        this.x += (x - this.x) * Math.min(1, dt * 12); this.vx = 0;
        this.y = height(this.x, this.d) + 2.4 * Math.sin(Math.PI * k);
        if (Math.random() < dt * 30) this.puff(1, this.x, this.y, this.d, 1.5, 1);
        if (k >= 1 || this.d > f.d + f.len) {
          this.wallR = null; this.takeoff(false); this.fromRail = true; this.vy = 2.5; this.vx = -side * 7;
          const pts = 300 * this.mult; this.bonus += pts;
          this.pop('WALLRIDE', '+' + pts + (this.mult > 1 ? '  (x' + this.mult + ')' : ''), '#7fe3ff');
          this.speedUp(0.15); snd.trick(); this.mult = Math.min(this.mult + 1, 5); this.multT = 7; this.lineHit();
          this.lastG = this.ground(this.x, this.d);
        }
      } else if (this.grind) {
        // Sliding along a rail or box. Hold left or right to hop off early.
        const f = this.grind;
        // A rail keeps your speed.
        this.d += this.v * dt;
        const rx = railX(f, this.d), top = railTop(f, this.d);
        this.x += (rx - this.x) * Math.min(1, dt * 15); this.vx = 0;
        this.vy = (top - this.y) / dt; this.y = top; this.grindT += dt;
        if (this.sw) this.grindSwT += dt;
        this.lastG = this.ground(this.x, this.d);
        this.onRoof = this.roofAt(this.x, this.d, this.y, 1.2);
        if (this.onRoof) this.roofRun();
        if (Math.random() < dt * 50) this.parts.push({ x: this.x + rand(-0.3, 0.3), y: this.y, d: this.d, vx: rand(-2, 2), vy: rand(1, 3), vd: this.v * rand(0.6, 0.9), life: rand(0.2, 0.5), max: 0.5 });
        if (f.type === 'rail' && Math.random() < dt * 40) this.puff(1, this.x, this.y, this.d, 2, 2, this.sparks);
        if (this.d > f.d + f.len) this.endGrind(0);
        else if (Math.abs(dir) > 0.5 && this.grindT > 0.45) this.endGrind(Math.sign(dir) * 6);
      } else {
        // Speed creeps up the further you go. Climbing the valley side slows you and pushes you back down.
        const inrun = !this.air && this.onInrun(this.x, this.d) && this.y > this.inrunY(this.d) - 0.5;
        if (inrun) {
          // In the ski jump's tracks: no steering, and you pick up speed fast.
          this.v += (JUMP_V - this.v) * Math.min(1, dt * 0.9); this.vx = 0;
        } else if (!this.air) {
          // On ice you go a bit faster, and turning hardly bites, so you slide on sideways.
          const want = Math.min(VMAX, cruise(this.d) * (wall > 0 ? 0.75 : 1) * (1 + 0.12 * this.ice) + this.boost);
          this.v += (want - this.v) * Math.min(1, dt * (want > this.v ? 0.5 : 1.2));
          this.vx += (dir * maxSide + this.wind - this.vx) * Math.min(1, dt * (5 - 4.3 * this.ice));
          this.vx -= Math.sign(u) * wall * 1.6 * dt;
        } else {
          // In the air: hold left or right to spin, up (W) to front flip and down (S) to back flip.
          if (dir && this.airT > (this.ollie || this.fromRail ? 0.05 : 0.2)) this.spin += dir * SPIN_RATE * dt;
          if (pitch) this.flip += pitch * FLIP_RATE * dt;
          this.vx += this.wind * 0.8 * dt; // The storm blows you sideways in the air too.
        }

        // The valley bends under you. You follow half of a bend by yourself and steer for the rest.
        const y0 = this.y;
        this.d += this.v * dt; this.x += (this.vx + bend * this.v * 0.5) * dt;
        if (inrun) this.x = center(this.d);

        // Stay on the snow, or fly when it drops away faster than gravity can pull you down.
        const g = this.ground(this.x, this.d), gv = (g - this.lastG) / dt; this.lastG = g;
        // The village: ski into a wall and you crash. Come in high enough and you are on the roof.
        const hs = this.houseAt(this.x, this.d);
        if (hs && y0 < roofY(hs, this.x, this.d) - 1.4) {
          this.hit(hs.tower ? 'the church' : 'a house', hs.tower ? 'You skied into the church' : 'You skied into a house');
          this.v = -1.5; this.vx = 0; return; // Bounce back off the wall.
        }
        if (!this.air) {
          if (gv < this.vy - G * dt * 1.2) {
            this.takeoff(false); if (this.vy > 2) snd.jump();
            const k = this.kickerAt(this.x, this.d - this.v * dt);
            if (k && k.type === 'hip') this.vx = -Math.sign(k.u) * HIP_THROW;
            this.gapDeck = k && k.deck ? k.deck : null; // Off the gap jump's kicker: is the deck cleared?
          }
          else { this.y = g; if (gv < this.v * 0.5) this.vy = gv; } // Stepping up the side of a kicker is not a launch.
        }
        if (this.air) { this.airT += dt; this.vy -= G * (this.jumpFlight ? JUMP_GLIDE : 1) * dt; this.y += this.vy * dt; } // Off the ski jump you glide.
        // Come down on a rail, or ride onto a box, and you start sliding. Ride into a rail and it knocks you aside.
        const f = this.railAt(this.x, this.d);
        if (f) {
          const top = railTop(f, this.d), fromAbove = y0 >= top - (f.type === 'box' ? 0.75 : 0.3);
          if (fromAbove && this.y <= top + 0.6) { this.startGrind(f, top); if (this.crash) return; } // Close enough: you pop onto it.
          else if (!fromAbove && f.type === 'rail' && Math.abs(this.x - railX(f, this.d)) < 0.3 && this.y < top - 0.3 && !this.bump) {
            const side = this.x >= railX(f, this.d) ? 1 : -1;
            this.x = railX(f, this.d) + side * 0.45; this.vx = side * 6; this.v *= 0.7; this.bump = 0.5;
            this.mult = 1; this.multT = 0; this.shake = 0.6; snd.clank(); this.pop('OUCH!', 'SPEED LOST', '#ff6b9a');
          }
        }
        // Ride into a wall and you ride up it.
        const wf = this.wallAt(this.x, this.d);
        if (wf && this.y - height(this.x, this.d) < 1.5) { this.wallR = { f: wf, t: 0 }; this.air = false; this.spin = this.flip = 0; snd.clank(); }
        // The landing deck of a gap jump: come up short into its front and you crash.
        const deck = this.kickerAt(this.x, this.d);
        if (deck && deck.type === 'deck' && !deck.hit && this.d - deck.d < 1.6 && y0 < height(this.x, this.d) + deck.h - 0.6) {
          deck.hit = true; return this.hit('the gap deck', 'You came up short on the gap jump');
        }
        if (this.air && this.y <= g) { this.land(g, gv); if (this.crash) return; }
        this.onRoof = this.air ? null : this.roofAt(this.x, this.d, this.y);
        if (!this.air && !this.grind) this.roofRun();
      }

      // Coins, trees and rocks near you.
      for (const ch of this.chunks) {
        for (const c of ch.coins) {
          if (!c.got && Math.abs(c.d - this.d) < 1.2 && Math.abs(c.x - this.x) < 1.2 && Math.abs(c.y - this.y - 0.8) < 1.5) {
            c.got = true; this.coins++; snd.coin(); this.puff(14, c.x, c.y, c.d, 3, 3, this.sparks);
          }
        }
        if (ch.d0 > this.d + 3 || ch.d0 + CL < this.d - 3) continue;
        for (const o of ch.forest) if (Math.abs(o.x - this.x) < 1.6 && Math.abs(o.d - this.d) < 0.6 * o.s + 0.3 && Math.abs(o.x - this.x) < 0.6 * o.s + 0.3) return this.hit('a tree');
        for (const o of ch.trees) if (Math.abs(o.d - this.d) < 0.7 * o.s + 0.3 && Math.abs(o.x - this.x) < 0.75 * o.s + 0.3 && this.y - o.y < 4.5 * o.s) return this.hit('a tree');
        for (const o of ch.rocks) if (Math.abs(o.d - this.d) < 0.6 * o.s + 0.3 && Math.abs(o.x - this.x) < 0.6 * o.s + 0.3 && this.y - o.y < 0.8 * o.s) return this.hit('a rock');
        for (const o of ch.snowmen) if (Math.abs(o.d - this.d) < 0.65 && Math.abs(o.x - this.x) < 0.65 && this.y - o.y < 2.1) return this.hit('a snowman');
        for (const b of ch.blocks) if (Math.abs(b.d - this.d) < b.hd && Math.abs(this.x - center(this.d) - b.u) < b.hw && this.y < b.y1 && this.y + 1.7 > b.y0) return this.hit(b.name);
      }
      for (const ch of this.chunks) for (const f of ch.feats) if (f.chims) for (const o of f.chims)
        if (Math.abs(o.d - this.d) < 0.55 && Math.abs(o.x - this.x) < 0.55 && this.y < o.top - 0.1 && this.y > o.top - 3) return this.hit('a chimney');
      // Into the village.
      for (const v of this.villages) if (!v.done && this.d >= v.a) { v.done = true; this.pop('SKI VILLAGE', 'SKI ON THE ROOFS!', '#ffd75e'); }
      if (this.villages.length && this.villages[0].done) this.villages.shift();
      for (const m of this.marks) if (!m.done && this.d >= m.d) { m.done = true; m.fn(); }
      this.marks = this.marks.filter((m) => !m.done);
      // The safety fence along the edges of the park.
      if (inPark(this.d) && Math.abs(this.x - center(this.d)) > FENCE - 0.35) return this.hit('the safety fence');
      if (this.critters(dt)) return;
      this.gates();

      // Snow spray when carving hard or ploughing up the side.
      const carve = Math.abs(this.vx) / maxSide;
      if (!this.air && !this.grind && Math.random() < dt * (carve * 90 + wall * 6 + 6) * (1 - 0.8 * this.ice)) {
        const s = -Math.sign(this.vx || 1);
        this.parts.push({ x: this.x + rand(-0.2, 0.2), y: this.y + 0.05, d: this.d - 0.5, vx: s * rand(1, 5) * (0.5 + carve), vy: rand(1, 4) * (0.5 + carve), vd: this.v * rand(0.5, 0.85), life: rand(0.4, 0.9), max: 0.9 });
      }
      // Ski hiss and wind, louder the faster you go.
      this.sndT -= dt;
      if (this.sndT <= 0) {
        this.sndT = 0.1;
        if (this.grind) snd.hiss(0.18, 0.03, this.grind.type === 'rail' ? 'highpass' : 'bandpass', this.grind.type === 'rail' ? 3500 : 900);
        else if (!this.air) snd.hiss(0.18, 0.006 + carve * 0.02, 'bandpass', 1800 + this.v * 30 + this.ice * 3000);
        snd.hiss(0.18, 0.004 + this.v * 0.0005 + (this.air ? 0.01 : 0) + this.storm * 0.03, 'lowpass', 300 + this.v * 12 + this.storm * 500);
        if (this.ava && !this.ava.out) snd.rumble(clamp(1 - (this.d - this.ava.d) / 70, 0.15, 1));
      }
      // Tracks in the snow.
      if (this.d - this.trailD > 0.5) {
        this.trailD = this.d;
        this.trail.unshift(this.air || this.grind ? null : { x: this.x, d: this.d, h: Math.atan2(this.vx + bend * this.v * 0.5, this.v), r: this.onRoof ? this.y : null });
        if (this.trail.length > TRACK) this.trail.pop();
      }

      if (this.multT > 0 && !this.air && !this.grind && (this.multT -= dt) <= 0) this.mult = 1;
      // Never faster than 200 km/h, and the boost can't build up past it either.
      if (this.v > VMAX) this.v = VMAX;
      this.boost = Math.min(this.boost, Math.max(0, VMAX - cruise(this.d)));
      const sc = Math.floor(this.d) + this.coins * 10 + this.bonus;
      if (sc !== this.score) { this.score = sc; setScore(sc); }
      this.moveBits(dt);
      this.gen();
    },
    // The special stretches: say what is coming, and run the storm, the ice and the avalanche.
    zones(dt) {
      const z = zoneAt(this.d);
      if (z && z.k !== this.zoneK) {
        this.zoneK = z.k;
        if (z.type === 'slalom') { this.pop('SLALOM', 'SKI THROUGH THE GATES', '#7fe3ff'); this.gateHit = this.gateStreak = 0; }
        if (z.type === 'lake') this.pop('FROZEN LAKE', 'SLIPPERY ICE!', '#9fe0ff');
        if (z.type === 'storm') this.pop('SNOWSTORM', 'WATCH THE WIND', '#ffffff');
        if (z.type === 'avalanche') { this.pop('AVALANCHE!', 'SKI FOR YOUR LIFE', '#ff6b9a'); snd.warn(); this.ava = { d: this.d - 45, s: z.s, t: 0, out: false }; }
      }
      this.ice = this.air || this.grind ? 0 : iceAt(this.x, this.d);
      // Storm: gusts that swing from side to side. The snow flies with them.
      this.storm = zoneMask('storm', this.d, 40);
      this.wind = this.storm * 6.5 * Math.sin(this.t * 0.45 + this.zoneK * 1.7);
      this.windX += this.wind * dt * 3; this.fallT += dt * (1 + this.storm * 2.5);
      // Avalanche: it chases you down the stretch and speeds up as it goes. Get to the end and it stops.
      const a = this.ava;
      if (a) {
        a.t += dt;
        if (!a.out) {
          a.d += cruise(this.d) * (0.95 + 0.12 * Math.min(1, a.t / 12)) * dt;
          const gap = this.d - a.d;
          this.shake = Math.max(this.shake, 0.3 * clamp(1 - gap / 35, 0, 1));
          if (Math.random() < dt * 30) this.parts.push({ x: this.x + rand(-14, 14), y: height(this.x, a.d) + rand(0, 4), d: a.d, vx: rand(-2, 2), vy: rand(0, 3), vd: this.v * rand(1.05, 1.3), life: rand(0.6, 1.2), max: 1.2 });
          if (gap < 0.8) return this.hit('the avalanche', 'The avalanche caught you');
          if (this.d > a.s + ZONE_LEN) {
            a.out = true; const pts = 500 * this.mult; this.bonus += pts;
            this.pop('ESCAPED!', '+' + pts, '#ffd75e'); snd.trick();
          }
        } else if (this.d - a.d > 200) this.ava = null;
      }
    },
    // Reindeer and hares: they start to run when you come close. Hit a reindeer and you crash, but you can hop
    // over a hare, or a reindeer if you jump high enough, for points. Returns true on a crash.
    critters(dt) {
      for (const ch of this.chunks) for (const a of ch.animals) {
        if (!a.run && a.d - this.d < this.v * (Math.abs(this.x - a.x) / a.speed) * 1.05 + 5) a.run = true;
        if (!a.run) continue;
        if (Math.abs(a.x - center(a.d)) < FLOOR + 40) { a.x += a.dir * a.speed * dt; a.y = height(a.x, a.d); }
        if (a.done || Math.abs(a.d - this.d) > (a.deer ? 0.9 : 0.5) || Math.abs(a.x - this.x) > (a.deer ? 1.0 : 0.55)) continue;
        if (this.y - a.y > (a.deer ? 1.05 : 0.45)) {
          a.done = true; const pts = (a.deer ? 400 : 150) * this.mult; this.bonus += pts;
          this.pop(a.deer ? 'REINDEER LEAP' : 'HARE HOP', '+' + pts, '#ffd75e'); snd.trick();
        } else if (a.deer && !this.grind) { this.hit('a reindeer'); return true; }
        else a.done = true; // A hare ducks under your skis.
      }
      return false;
    },
    // Slalom gates: points for every gate you ski through, more for each one in a row. All of them is a perfect run.
    gates() {
      for (const ch of this.chunks) for (const g of ch.gates) {
        if (g.done || this.d < g.d) continue;
        g.done = true;
        if (g.i === 0) { this.gateHit = 0; this.gateStreak = 0; }
        this.gateN = g.n; this.gateI = g.i + 1;
        if (Math.abs(this.x - g.x) < GATE_W) {
          this.gateHit++; this.gateStreak++;
          const pts = 40 * Math.min(this.gateStreak, 10); this.bonus += pts;
          this.pop('GATE ' + (g.i + 1) + '/' + g.n, '+' + pts, '#7fe3ff'); snd.gate();
        } else { this.gateStreak = 0; this.pop('MISSED GATE', g.i + 1 + '/' + g.n, '#ff6b9a'); snd.miss(); }
        if (g.i === g.n - 1) {
          if (this.gateHit === g.n) { this.bonus += 1000; this.pop('PERFECT SLALOM', '+1000', '#ffd75e'); snd.trick(); }
          else this.pop('SLALOM DONE', this.gateHit + ' OF ' + g.n + ' GATES', '#7fe3ff');
          this.gateN = 0;
        }
      }
    },
    takeoff(ollie) {
      this.air = true; this.airT = 0; this.ollie = ollie; this.airSw = this.sw;
      if (this.sj && !this.sj.done && this.d > JUMP_LIP - 10 && this.d < JUMP_LIP + 3) this.jumpFlight = true; // Off the ski jump.
      // Off a roof? Then the landing can be a roof gap or a roof drop. Off the village kicker counts as off the snow.
      const k = this.kickerAt(this.x, this.d);
      this.roofFrom = this.onRoof && !(k && k.type === 'ramp') ? this.onRoof : null; this.onRoof = null;
      this.grab = GRABS[(Math.random() * GRABS.length) | 0];
    },
    // Space (or swipe up): pop off the snow, or off a rail.
    jump() {
      if (this.crash) return;
      if (this.grind) { if (this.grindT > 0.05) { this.endGrind(0); this.vy += OLLIE - 3; this.crouch = 0; snd.jump(); } return; }
      // You can hop any time you are on the snow, or only just off it (a bump threw you up a little).
      // Pressed a moment too early in the air, the hop happens as soon as you touch down.
      const g = this.ground(this.x, this.d), near = this.air && !this.ollie && !this.fromRail && this.y - g < 0.6 && this.airT < 0.5;
      if ((this.air && !near) || this.jumpCd > 0) { this.jumpQ = 0.25; return; }
      this.jumpQ = 0;
      if (near) this.vy = Math.max(this.vy, (g - this.lastG) / (1 / 60)); // Hop from the snow's own speed, not from the fall.
      this.takeoff(true);
      this.vy = Math.max(this.vy, -this.v) + OLLIE; this.crouch = 0; // Legs snap straight, then tuck up in the air.
      this.puff(10, this.x, this.y + 0.1, this.d, 2, 1.5); snd.jump();
    },
    // S (or swipe down) on a rail: a quick 180 on the rail, between forwards and backwards.
    switchUp() {
      if (!this.grind || this.swapT > 0 || this.grindT < 0.1) return;
      this.sw = !this.sw; this.swapT = SWAP_T; this.grindSwaps++; snd.clank();
      this.pop('SWITCH-UP', '+75', '#7fe3ff');
    },
    startGrind(f, top) {
      const n = Math.round(this.spin / Math.PI), flips = this.flip / (Math.PI * 2), nf = Math.round(flips);
      if (Math.abs(flips - nf) > 0.22) { this.spin = this.flip = 0; return this.hit('the rail upside down'); }
      if (Math.abs(n) % 2) this.sw = !this.sw; // Land a 180 onto it and you slide backwards.
      if (f.yAt) this.roofFrom = null; // Onto the rail between two roofs: not a roof drop.
      else this.roofScore(f.base != null ? this.roofAt(this.x, this.d, top, 1.2) : null, top, this.airT);
      const names = f.type === 'rail' ? RAILS : BOXES, base = names[(Math.random() * names.length) | 0];
      this.grind = f; this.grindT = 0; this.grindSwT = 0; this.grindSwaps = 0; this.air = false; this.y = top; this.vy = 0;
      this.grindSide = SIDEWAYS.includes(base);
      this.grindName = [this.sw ? 'SWITCH' : '', flipName(nf), n ? Math.abs(n) * 180 : '', base].filter(Boolean).join(' ');
      this.grindBonus = Math.round(spinPts(Math.abs(n)) * 0.75) + 300 * Math.abs(nf) + (this.airT > 0.55 ? Math.round(this.airT * 100) : 0);
      this.spin = this.flip = 0; this.airT = 0; this.fromRail = false; this.flipTouch = 0; snd.clank();
    },
    // Another feature in a line, in the park.
    lineHit() { if (!inPark(this.d)) return; this.line++; this.lineT = 3.5; this.bestLine = Math.max(this.bestLine, this.line); },
    endLine() {
      if (this.line >= 3) { const pts = 150 * this.line; this.bonus += pts; this.pop('LINE x' + this.line, '+' + pts, '#ffd75e'); }
      this.line = 0; this.lineT = 0;
    },
    // A speed boost: share is how much faster than cruising, the trick multiplier makes it bigger.
    speedUp(share) {
      const c = cruise(this.d), add = Math.min(Math.min(share * (1 + 0.15 * (this.mult - 1)), BOOST_MAX - this.boost / c) * c, VMAX - this.v);
      if (add <= 0.2) return; // Already at (or right by) 200 km/h: no boost.
      this.boost += add; this.v += add; this.boostT = 1.2;
      snd.hiss(0.6, 0.08, 'bandpass', 400, 3200);
    },
    endGrind(push) {
      // Points for every second on the rail (half as much again riding backwards), switch-ups, and the trick you landed on it with.
      const sw = this.grindSwaps;
      const pts = (60 + Math.round(this.grindT * 160 + this.grindSwT * 80) + this.grindBonus + 75 * sw) * this.mult;
      this.bonus += pts;
      this.pop(this.grindName + (sw ? ' + ' + sw + ' SWITCH-UP' + (sw > 1 ? 'S' : '') : ''), '+' + pts + (this.mult > 1 ? '  (x' + this.mult + ')' : ''), '#7fe3ff');
      this.speedUp(Math.min(0.08 + 0.05 * Math.min(this.grindT, 3) + 0.05 * sw, 0.3));
      snd.trick(); this.mult = Math.min(this.mult + 1, 5); this.multT = 7; this.lineHit();
      this.grind = null; this.swapT = 0; this.takeoff(false); this.fromRail = true; this.vy += 3; this.vx = push;
      this.lastG = this.ground(this.x, this.d);
    },
    // ROOFTOP RUN: every roof of the middle row, one after another, without touching the snow in between.
    // A roof you fly right over counts too: you never touched the snow.
    roofRun() {
      const r = this.onRoof, V = this.roofRunV;
      if (r && r.mid) {
        if (V !== r.mid) { this.roofRunV = r.mid; r.mid.first = r.mid.max = r.midI; }
        else r.mid.max = Math.max(r.mid.max, r.midI);
        return;
      }
      if (!V || r) return;
      if (!V.done && V.first === 0 && (V.max === V.n - 1 || this.d > V.endD)) { // Flying right over the hotel counts too.
        V.done = true; const pts = 2500 * this.mult; this.bonus += pts;
        this.pop('ROOFTOP RUN!', 'ALL ' + V.n + ' ROOFS  +' + pts, '#ffd75e'); snd.trick(); this.puff(40, this.x, this.y + 0.5, this.d, 5, 5, this.sparks);
      }
      this.roofRunV = null;
    },
    // Roofs: up onto a roof from the snow, across to another roof, or off a roof down to the snow (or onto a rail).
    // on is the house you came down on (or null), y how high you came down, t how long you were in the air.
    roofScore(on, y, t) {
      const from = this.roofFrom; this.roofFrom = null;
      if (on && from && on !== from) { const pts = 250 * this.mult; this.bonus += pts; this.pop('ROOF GAP', '+' + pts, '#7fe3ff'); this.lineHit(); }
      else if (on && !from && t > 0.2) { const pts = 150 * this.mult; this.bonus += pts; this.pop('ON THE ROOF', '+' + pts, '#7fe3ff'); this.lineHit(); }
      else if (!on && from && t > 0.4) {
        const drop = Math.max(0, from.roof - y), pts = (150 + Math.round(drop * 25)) * this.mult; this.bonus += pts;
        this.pop('ROOF DROP ' + Math.round(drop) + ' M', '+' + pts, '#ff9d2f'); this.lineHit();
      }
    },
    land(g, gv) {
      this.y = g; this.vy = Math.min(gv, this.v * 0.5); this.air = false;
      const t = this.airT;
      if (t > 0.25) { snd.land(); this.puff(26, this.x, g + 0.1, this.d, 3, 2.5); this.shake = Math.max(this.shake, Math.min(0.5, t * 0.3)); }
      // Spins count in half turns: an odd number (180, 540...) and you ride away backwards. Flips must come round to your feet.
      const halves = this.spin / Math.PI, n = Math.round(halves), off = Math.abs(halves - n);
      const flips = this.flip / (Math.PI * 2), nf = Math.round(flips), offF = Math.abs(flips - nf);
      const wasSw = this.airSw, out = this.fromRail && n !== 0;
      this.spin = this.flip = 0; this.airT = 0; this.fromRail = false; this.ollie = false; this.flipTouch = 0; this.jumpCd = 0.08;
      if (offF > 0.22) return this.hit('the snow head first');
      if (Math.abs(n) % 2) this.sw = !this.sw;
      this.roofScore(this.roofAt(this.x, this.d, g), g, t);
      // Landed on top of a gap jump's deck: the gap is cleared.
      const dk = this.gapDeck && this.d > this.gapDeck.d + 1 ? this.gapDeck : this.kickerAt(this.x, this.d);
      this.gapDeck = null;
      if (dk && dk.type === 'deck' && !dk.hit && !dk.done && t > 0.3) {
        dk.done = true; const pts = 300 * this.mult; this.bonus += pts; this.pop('GAP CLEARED', '+' + pts, '#7fe3ff'); this.lineHit();
      }
      if ((Math.abs(halves) > 0.3 && off > 0.28) || offF > 0.1) { this.endLine(); this.v *= 0.85; this.boost = 0; this.mult = 1; this.multT = 0; this.pop('SKETCHY LANDING', 'SPEED LOST', '#ff6b9a'); snd.sketchy(); }
      else if (t > GRAB_T || n !== 0 || nf !== 0) {
        // A trick: a grab for big air, plus spins and flips. Tricks in a row raise the multiplier. Taking off backwards is worth half as much again.
        const trick = n !== 0 || nf !== 0;
        let pts = Math.round(t * 100) + spinPts(Math.abs(n)) + 300 * Math.abs(nf) + (out ? 100 : 0);
        if (wasSw && trick) pts *= 1.5;
        pts = Math.round(pts) * this.mult;
        const name = [wasSw && trick ? 'SWITCH' : '', flipName(nf), n ? Math.abs(n) * 180 : '', t > GRAB_T ? this.grab : '', out ? 'OUT' : ''].filter(Boolean).join(' ');
        this.bonus += pts; this.pop(name, '+' + pts + (this.mult > 1 ? '  (x' + this.mult + ')' : ''), '#ffd75e');
        this.speedUp(trick ? Math.min(0.1 * Math.abs(n) + 0.2 * Math.abs(nf), 0.4) : 0.05);
        snd.trick(); this.mult = Math.min(this.mult + 1, 5); this.multT = 7;
        if (Math.abs(n) >= 3 || nf) this.puff(30, this.x, g + 0.2, this.d, 5, 4, this.sparks);
        if (t > 0.5) this.lineHit();
        if (t > 1.3) { const big = Math.round(t * 200) * this.mult; this.bonus += big; this.pop('BIG AIR ' + t.toFixed(1) + 's', '+' + big, '#ff9d2f'); }
      }
      // The ski jump: points for every metre, and more past the K point and the hill size.
      if (this.jumpFlight) {
        this.jumpFlight = false; this.sj.done = true;
        const dist = Math.max(0, this.d - JUMP_LIP); this.sj.dist = dist;
        let pts = Math.round(dist * 15);
        const sub = dist >= JUMP_HS ? 'HILL SIZE! ' : dist >= JUMP_K ? 'K POINT! ' : '';
        if (dist >= JUMP_HS) pts += 1500; else if (dist >= JUMP_K) pts += 500;
        this.bonus += pts; this.pop('SKI JUMP ' + dist.toFixed(1) + ' M', sub + '+' + pts, '#ffd75e'); snd.trick();
        if (S && S.sjBoard) S.sjBoard.draw(dist);
      }
      if (this.jumpQ > 0) this.jump(); // Space pressed just before touching down.
    },
    moveBits(dt) {
      for (const list of [this.parts, this.sparks]) {
        for (const p of list) {
          p.life -= dt; p.vy -= 9 * dt; p.vx *= 1 - dt * 1.5; p.vd *= 1 - dt * 1.2;
          p.x += p.vx * dt; p.y += p.vy * dt; p.d += p.vd * dt;
        }
      }
      this.parts = this.parts.filter((p) => p.life > 0).slice(-500);
      this.sparks = this.sparks.filter((p) => p.life > 0).slice(-120);
      for (const p of this.pops) p.life -= dt;
      this.pops = this.pops.filter((p) => p.life > 0);
      this.shake = Math.max(0, this.shake - dt * 1.5);

      // Camera: behind and above, swinging round with your direction.
      const head = Math.atan2(this.vx, this.v) * 0.6, k = Math.min(1, dt * 4);
      const tx = this.x - Math.sin(head) * 10, td = this.d - Math.cos(head) * 10, ty = Math.max(this.y, this.ground(tx, td)) + 5; // ground: stay above the roofs behind you too.
      if (!this.cam) this.cam = { x: tx, y: ty, d: td, h: head };
      const c = this.cam;
      c.x += (tx - c.x) * k; c.d = td; c.y += (ty - c.y) * Math.min(1, dt * 6); c.h += (head - c.h) * k;
      this.lean += (clamp(this.vx / (5 + 0.3 * this.v), -1, 1) - this.lean) * Math.min(1, dt * 8);
      const tuck = this.air ? 0.85 : 0.25 + 0.55 * clamp((this.v - 14) / 24, 0, 1);
      this.crouch += (tuck - this.crouch) * Math.min(1, dt * 4);
      // Riding backwards, the skier looks over a shoulder down the hill.
      this.look += ((this.sw && !this.air && !this.swapT ? 2.1 : 0) - this.look) * Math.min(1, dt * 6);
    },

    /* ----- Drawing ----- */
    draw() {
      if (T && !S && !failed) initScene();
      if (!S) { this.drawLoading(failed ? 'SORRY, YOUR BROWSER' : 'LOADING 3D...', failed ? 'CAN\'T SHOW 3D GAMES' : ''); return; }
      if (!this.cam) this.moveBits(0);
      this.sync();
      ctx.save();
      if (this.shake > 0) ctx.translate(rand(-1, 1) * this.shake * 8, rand(-1, 1) * this.shake * 6);
      ctx.drawImage(glCanvas, -6, -6, W + 12, H + 12);
      ctx.restore();
      this.drawHud();
    },
    drawLoading(a, b) {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#5f92d4'); g.addColorStop(1, '#e2ecf5');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff'; ctx.font = font(12); ctx.textAlign = 'center';
      ctx.fillText(a, W / 2, H / 2); if (b) ctx.fillText(b, W / 2, H / 2 + 24);
      ctx.textAlign = 'left';
    },

    // Copy the game into the 3D scene, then render it.
    sync() {
      const s = S, scene = s.scene, cam = s.camera;
      // Match the game screen's size, but stay under about a million pixels so phones keep up.
      const cw = ctx.canvas.width, chh = ctx.canvas.height, k = Math.min(1, Math.sqrt(1e6 / (cw * chh)));
      const rw = Math.round(cw * k), rh = Math.round(chh * k);
      if (glCanvas.width !== rw || glCanvas.height !== rh) s.renderer.setSize(rw, rh, false);

      // Light and sky for this time of day.
      const tod = ((((this.d + CYCLE * 0.05) % CYCLE) + CYCLE) % CYCLE) / CYCLE;
      let i = 0; while (SKY[i + 1].at <= tod) i++;
      const A = SKY[i], B = SKY[i + 1], f0 = (tod - A.at) / (B.at - A.at), f = f0 * f0 * (3 - 2 * f0);
      const col = (key, out) => out.set(A[key]).lerp(new T.Color(B[key]), f), num = (key) => A[key] + (B[key] - A[key]) * f;
      const night = num('night'), elev = num('elev'), az = num('az'), u = s.skyMat.uniforms;
      col('fog', scene.fog.color); col('top', u.top.value); col('hor', u.hor.value);
      col('sun', u.sunCol.value); u.size.value = night > 0.5 ? 0.45 : 1;
      if (night > 0.5) u.sunCol.value.multiplyScalar(0.5);
      const sd = u.sunDir.value.set(Math.sin(az), Math.sin(elev), -Math.cos(az) * Math.cos(elev)).normalize();
      col('sun', s.sun.color); s.sun.intensity = num('sunI');
      col('hs', s.hemi.color); col('hg', s.hemi.groundColor); s.hemi.intensity = num('hI');
      s.renderer.toneMappingExposure = num('exp');
      s.stars.material.opacity = night; s.auroraMat.uniforms.night.value = night; s.auroraMat.uniforms.time.value = this.t;
      s.lamp.intensity = Math.max(0, night - 0.4) * 25;
      // A snowstorm greys out the sky, hides the sun and the stars, and the fog closes in.
      const st = this.storm;
      scene.fog.density = 0.0027 + st * 0.021;
      if (st > 0) {
        const grey = STORM_DAY.clone().lerp(STORM_NIGHT, night);
        scene.fog.color.lerp(grey, st * 0.85); u.top.value.lerp(grey, st * 0.95); u.hor.value.lerp(grey, st * 0.9);
        u.sunCol.value.multiplyScalar(1 - st * 0.9); s.sun.intensity *= 1 - 0.6 * st;
        s.stars.material.opacity *= 1 - st; s.auroraMat.uniforms.night.value *= 1 - st;
      }

      // The ski jump: built at the start of a run, gone once it is far behind.
      if (this.sj && !s.sjMesh && this.d < JUMP_LIP + JUMP_HILL + 150) { s.sjMesh = skiJumpMesh(this); scene.add(s.sjMesh); s.sjBoard.draw(this.sj.dist); }
      else if (s.sjMesh && this.d > JUMP_LIP + JUMP_HILL + 150) { dropMesh(s.sjMesh); s.sjMesh = null; }
      // Give every new chunk a terrain tile.
      for (const t of s.tiles) if (t.chunk && !this.chunks.includes(t.chunk)) { t.chunk = null; t.visible = false; }
      for (const ch of this.chunks) {
        if (s.tiles.some((t) => t.chunk === ch)) continue;
        const t = s.tiles.find((q) => !q.chunk); if (t) fillTile(t, ch);
      }
      // Trees, rocks and kickers only change when the chunks do.
      const key = this.chunks.map((c) => c.d0).join(',');
      if (key !== s.built) {
        s.built = key;
        const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), sc = new T.Vector3();
        let n = 0, r = 0, f = 0;
        for (const ch of this.chunks) {
          for (const o of ch.forest) { if (f >= 7000) break; q.setFromEuler(e.set(0, o.r, 0)); p.set(o.x, o.y - 0.2, -o.d); sc.set(o.s, o.s * o.h, o.s); s.forest.setMatrixAt(f++, m.compose(p, q, sc)); }
          for (const o of ch.trees) { if (n >= 1200) break; q.setFromEuler(e.set(0, o.r, 0)); p.set(o.x, o.y - 0.15, -o.d); sc.set(o.s, o.s * o.h, o.s); s.trees.setMatrixAt(n++, m.compose(p, q, sc)); }
          for (const o of ch.rocks) { if (r >= 400) break; q.setFromEuler(e.set(0, o.r, 0)); p.set(o.x, o.y - 0.1, -o.d); sc.set(o.s, o.s, o.s); s.rocks.setMatrixAt(r++, m.compose(p, q, sc)); }
        }
        let fl = 0;
        const flagCol = [new T.Color('#ff6a2c'), new T.Color('#2fb5ff')];
        for (const ch of this.chunks) for (const o of ch.flags) { if (fl >= 200) break; p.set(o.x, o.y - 0.1, -o.d); s.flags.setMatrixAt(fl, m.compose(p, q.identity(), sc.set(1, 1, 1))); s.flags.setColorAt(fl++, flagCol[o.c]); }
        s.flags.count = fl; s.flags.instanceMatrix.needsUpdate = true; if (s.flags.instanceColor) s.flags.instanceColor.needsUpdate = true;
        this.buildEdges(s);
        let sm = 0;
        for (const ch of this.chunks) for (const o of ch.snowmen) { if (sm >= 40) break; q.setFromEuler(e.set(0, o.r, 0)); p.set(o.x, o.y - 0.1, -o.d); s.snowmen.setMatrixAt(sm++, m.compose(p, q, sc.set(1, 1, 1))); }
        s.snowmen.count = sm; s.snowmen.instanceMatrix.needsUpdate = true;
        s.trees.count = n; s.rocks.count = r; s.forest.count = f; s.trees.instanceMatrix.needsUpdate = s.rocks.instanceMatrix.needsUpdate = s.forest.instanceMatrix.needsUpdate = true;
        const all = this.chunks.flatMap((c) => c.feats);
        s.feats = s.feats.filter((mesh) => { if (all.includes(mesh.feat)) return true; dropMesh(mesh); return false; });
        for (const f of all) if (!s.feats.some((mesh) => mesh.feat === f)) { const mesh = featMesh(f); scene.add(mesh); s.feats.push(mesh); }
      }
      // Coins spin and bob.
      {
        const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), one = new T.Vector3(1, 1, 1);
        let n = 0;
        for (const ch of this.chunks) for (const c of ch.coins) {
          if (c.got || n >= 400) continue;
          q.setFromEuler(e.set(0, this.t * 3 + c.d * 0.2, 0)); p.set(c.x, c.y + Math.sin(this.t * 3 + c.d) * 0.1, -c.d);
          s.coins.setMatrixAt(n++, m.compose(p, q, one));
        }
        s.coins.count = n; s.coins.instanceMatrix.needsUpdate = true;
      }

      // Reindeer and hares, bouncing as they run.
      {
        const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), one = new T.Vector3(1, 1, 1);
        let nd = 0, nh = 0;
        for (const ch of this.chunks) for (const a of ch.animals) {
          const hop = a.run ? Math.abs(Math.sin(this.t * (a.deer ? 8 : 11) + a.ph)) * (a.deer ? 0.22 : 0.4) : 0;
          p.set(a.x, a.y + hop, -a.d); q.setFromEuler(e.set(0, a.dir > 0 ? 0 : Math.PI, a.run ? Math.sin(this.t * 8 + a.ph) * 0.08 : 0));
          if (a.deer && nd < 40) s.deer.setMatrixAt(nd++, m.compose(p, q, one));
          else if (!a.deer && nh < 40) s.hares.setMatrixAt(nh++, m.compose(p, q, one));
        }
        s.deer.count = nd; s.hares.count = nh; s.deer.instanceMatrix.needsUpdate = s.hares.instanceMatrix.needsUpdate = true;
      }
      // Chairs going round the chairlift, lamps that light up at night, and the DJ booth's lights.
      this.moveLift(s);
      s.lampMat.color.set('#6a6658').lerp(LAMP_ON, clamp(night * 1.3 - 0.2, 0, 1));
      s.glow.material.opacity = clamp(night * 1.3 - 0.3, 0, 0.8);
      const beat = 0.6 + 0.6 * Math.max(0, Math.sin(this.t * 8.4)), beat2 = 0.6 + 0.6 * Math.max(0, Math.sin(this.t * 8.4 + 3.1));
      s.boothGlow.emissiveIntensity = beat; s.boothGlow2.emissiveIntensity = beat2;
      // The village: windows light up in the evening, the lights on the eaves twinkle, and the chimneys smoke.
      s.winMat.emissiveIntensity = 0.1 + clamp(night * 1.3 - 0.1, 0, 1) * 1.6;
      s.bulbMat.opacity = 0.45 + 0.55 * clamp(night * 1.5, 0, 1) * (0.75 + 0.25 * Math.sin(this.t * 3));
      {
        const P = s.smoke.geometry.attributes.position.array;
        let n = 0;
        for (const ch of this.chunks) for (const f of ch.feats) if (f.chims) for (const c of f.chims) for (let i = 0; i < 8 && n < P.length; i++) {
          const q = (((this.t * 0.22 + i / 8 + c.a * 0.13) % 1) + 1) % 1;
          P[n++] = c.x + Math.sin(this.t * 0.8 + i * 1.7 + c.a) * 0.3 * (1 + q * 3) + q * 2.5;
          P[n++] = c.top + 0.3 + q * 6;
          P[n++] = -(c.d + q * 1.5);
        }
        s.smoke.geometry.setDrawRange(0, n / 3); s.smoke.geometry.attributes.position.needsUpdate = true;
      }
      // Fans cheering (jumping higher while you are in the air), and the speakers.
      {
        const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), one = new T.Vector3(1, 1, 1), col = new T.Color();
        let n = 0, sp = 0;
        const hype = this.air && inPark(this.d) ? 1 : 0.35;
        for (const ch of this.chunks) {
          for (const c of ch.crowd || []) {
            if (n >= MAX_FANS) break;
            if (c.rink) { // Skaters going round the rink, leaning into the turn.
              const r = c.rink, a = r.a + this.t * r.sp;
              q.setFromEuler(e.set(0, -a * Math.sign(r.sp), 0.18 * Math.sign(r.sp)));
              p.set(r.x + Math.cos(a) * r.r, c.y + 0.65, -(r.d + Math.sin(a) * r.r * 1.15));
            } else {
              const hop = Math.max(0, Math.sin(this.t * 7 + c.ph)) * 0.35 * hype;
              q.setFromEuler(e.set(0, Math.sign(c.x - center(c.d)) > 0 ? -Math.PI / 2 : Math.PI / 2, 0));
              p.set(c.x, c.y + 0.65 + hop, -c.d);
            } s.crowdBody.setMatrixAt(n, m.compose(p, q, one)); s.crowdBody.setColorAt(n, col.set(CROWD[c.c]));
            p.y += 0.72; s.crowdHead.setMatrixAt(n, m.compose(p, q, one)); n++;
          }
          for (const o of ch.speakers || []) {
            if (sp >= 40) break;
            q.setFromEuler(e.set(0, o.side > 0 ? Math.PI / 2 : -Math.PI / 2, 0));
            p.set(o.x, o.y, -o.d); s.speakers.setMatrixAt(sp++, m.compose(p, q, one));
          }
        }
        s.crowdBody.count = s.crowdHead.count = n; s.speakers.count = sp;
        s.crowdBody.instanceMatrix.needsUpdate = s.crowdHead.instanceMatrix.needsUpdate = s.speakers.instanceMatrix.needsUpdate = true;
        if (s.crowdBody.instanceColor) s.crowdBody.instanceColor.needsUpdate = true;
      }
      // The avalanche: big clouds of snow tumbling over each other right across the valley.
      {
        const a = this.ava;
        let n = a && !a.out ? 90 : 0;
        if (n) {
          const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), sc = new T.Vector3(), cx = center(a.d);
          let k = 0;
          for (let i = 0; i < n; i++) {
            const row = i % 3, x = cx + (hash(i, 7) * 2 - 1) * (FLOOR + 12), roll = this.t * (2 + hash(i, 8)) + i;
            const d = a.d - row * 3.5 - hash(i, 9) * 2 + Math.sin(roll) * 0.8, r = (1.4 + hash(i, 10) * 1.6) * (1 + row * 0.25);
            if (d < this.cam.d + r + 1) continue; // Nothing right in front of the camera, so it never fills the screen.
            p.set(x, height(x, d) + r * 0.5 + row * 2 + Math.abs(Math.sin(roll * 0.7)) * 1.5, -d);
            q.setFromEuler(e.set(roll * 0.3, roll * 0.2, 0));
            s.avalanche.setMatrixAt(k++, m.compose(p, q, sc.set(r, r * 0.85, r)));
          }
          n = k;
          s.avalanche.instanceMatrix.needsUpdate = true;
        }
        s.avalanche.count = n;
      }

      // The skier.
      const sk = s.skier, heading = Math.atan2(this.vx, this.v);
      sk.root.position.set(this.x, this.y, -this.d);
      // Facing: your heading, plus the spin, plus half a turn when riding backwards. A switch-up on a rail turns you round with a hop.
      const swap = this.swapT / SWAP_T;
      sk.root.rotation.set(0, -heading, 0);
      sk.root.position.y += Math.sin(swap * Math.PI) * 0.35;
      sk.flip.rotation.set(-this.flip, 0, 0);
      sk.turn.rotation.set(0, -this.spin - (this.sw ? Math.PI : 0) + swap * Math.PI - (this.grind && this.grindSide ? Math.PI / 2 : 0), 0);
      sk.lean.rotation.set(0, 0, -this.lean * 0.45);
      if (this.wallR) sk.lean.rotation.z = Math.sign(this.wallR.f.u) * 1.1 * Math.sin(Math.PI * Math.min(this.wallR.t / 0.85, 1));
      if (this.crash) {
        const t = Math.min(this.crash.t * 1.5, 1);
        sk.lean.rotation.set(-t * 1.4, 0, (this.crash.vx >= 0 ? -1 : 1) * t * 1.2);
        sk.root.position.y += Math.sin(t * Math.PI) * 0.8;
      }
      const big = this.air && this.airT > 0.3;
      poseSkier(sk, this.crouch, big && !!(this.spin || this.flip), big && !this.spin && !this.flip ? (GRABS.indexOf(this.grab) % 2 ? 1 : -1) : 0, this.look);
      const gy = this.ground(this.x, this.d);
      s.blob.position.set(this.x, gy + 0.04, -this.d);
      s.blob.material.opacity = this.y - gy > 0.4 ? (0.3 / (1 + (this.y - gy) * 0.4)) * (1 - night * 0.4) : 0; // Helps judge a landing.

      // Ski tracks. A gap in the trail (a jump) squeezes the ribbon to nothing.
      s.tracks.forEach((m, side) => {
        const P = m.geometry.attributes.position.array, off = side ? 0.13 : -0.13;
        let last = { x: this.x, d: this.d, h: 0 };
        for (let j = 0; j < TRACK; j++) {
          const p = this.trail[j], q = p || last, hw = p ? 0.045 : 0; last = q;
          const cx = q.x + Math.cos(q.h) * off, cd = q.d - Math.sin(q.h) * off, y = q.r != null ? q.r + 0.1 : height(cx, cd) + 0.03; // On a roof, the tracks are up on it.
          P.set([cx - hw, y, -cd, cx + hw, y, -cd], j * 6);
        }
        m.geometry.attributes.position.needsUpdate = true;
      });

      // Snow spray, coin sparkles and falling snow.
      const fill = (pts, list) => {
        const P = pts.geometry.attributes.position.array; let n = 0;
        for (const p of list) { P[n++] = p.x; P[n++] = p.y; P[n++] = -p.d; }
        pts.geometry.setDrawRange(0, n / 3); pts.geometry.attributes.position.needsUpdate = true;
      };
      fill(s.spray, this.parts); fill(s.sparks, this.sparks);
      {
        // Each flake has a fixed spot in a 70 m box that moves with you; the box scrolls as you ski through it.
        const P = s.flakes.geometry.attributes.position.array, c = this.cam, n = P.length / 3;
        for (let j = 0; j < n; j++) {
          const fall = (this.fallT * (1.2 + hash(j, 4)) + hash(j, 5) * 30) % 30;
          const ahead = (((hash(j, 3) * 70 - this.d - this.t * 2) % 70) + 70) % 70;
          P[j * 3] = c.x + ((((hash(j, 1) * 60 + this.windX * (0.7 + hash(j, 6) * 0.6)) % 60) + 60) % 60) - 30 + Math.sin(this.t * 0.7 + j) * 0.6;
          P[j * 3 + 1] = c.y + hash(j, 2) * 30 + 7 - fall - ahead * SLOPE;
          P[j * 3 + 2] = -(c.d + ahead - 4);
        }
        s.flakes.geometry.attributes.position.needsUpdate = true;
        s.flakes.material.opacity = 0.8 - night * 0.3 + st * 0.2;
        s.flakes.material.size = 0.12 + st * 0.1;
      }

      // Camera, the sun's shadow box, and things that follow the camera.
      const c = this.cam;
      cam.position.set(c.x, c.y, -c.d);
      const lookD = this.d + Math.cos(c.h) * 26, lookX = this.x + Math.sin(c.h) * 26;
      // Look down at the snow ahead when it drops away steeply, like off the ski jump.
      const lookG = this.ground(lookX, lookD) + 2;
      cam.lookAt(lookX, clamp(lookG, this.y - 16, this.y - (W > H ? 5.7 : 3.9)), -lookD);
      cam.rotateZ(-this.lean * 0.05);
      cam.aspect = W / H; cam.fov = (W > H ? 50 : 64) + clamp(this.v - 14, 0, 30) * 0.3; cam.updateProjectionMatrix();
      s.sun.position.set(this.x + sd.x * 150, this.y + sd.y * 150, -this.d + sd.z * 150);
      s.sun.target.position.set(this.x, this.y, -this.d - 15);
      s.lamp.position.set(this.x, this.y + 1.8, -this.d + 0.5);
      s.lamp.target.position.set(this.x + Math.sin(heading) * 20, this.y - 4, -this.d - 20);
      s.sky.position.copy(cam.position); s.stars.position.copy(cam.position); s.aurora.position.copy(cam.position);
      const pd = this.d + 470, pc = center(pd); s.peaks.position.set(pc, height(pc, pd) - 60, -pd);
      s.renderer.render(scene, cam);
    },

    // The fence, light towers and chairlift towers and cables only change when the chunks do.
    buildEdges(s) {
      const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(0, 0, 0, 'YXZ'), p = new T.Vector3(), sc = new T.Vector3(), one = new T.Vector3(1, 1, 1);
      let np = 0, nn = 0, nl = 0, nt = 0, nc = 0;
      const pts = [], towers = [];
      for (const ch of this.chunks) {
        for (const f of ch.fence) {
          if (np >= 500) break;
          p.set(f.x, f.y, -f.d); s.fencePosts.setMatrixAt(np++, m.compose(p, q.identity(), one));
          // A net panel from this post to the next one down the hill.
          const d2 = f.d + 4, x2 = center(d2) + f.s * FENCE, y2 = height(x2, d2);
          if (!inPark(d2)) continue;
          const dx = x2 - f.x, dy = y2 - f.y, len = Math.hypot(dx, dy, 4);
          p.set((f.x + x2) / 2, (f.y + y2) / 2, -(f.d + 2));
          q.setFromEuler(e.set(Math.atan2(dy, Math.hypot(dx, 4)), Math.atan2(-dx, 4), 0));
          s.fenceNet.setMatrixAt(nn++, m.compose(p, q, sc.set(1, 1, len)));
        }
        for (const l of ch.lights) {
          if (nl >= 40) break;
          q.setFromEuler(e.set(0, 0, 0)); p.set(l.x, l.y, -l.d); s.lightPoles.setMatrixAt(nl, m.compose(p, q, one));
          p.set(l.x - l.s * 0.3, l.y + 9.7, -l.d); s.lamps.setMatrixAt(nl, m.compose(p, q, one));
          pts.push(l.x - l.s * 0.6, l.y + 9.6, -l.d); nl++;
        }
        for (const t of ch.towers) towers.push(t);
      }
      for (const t of towers) { if (nt >= 20) break; p.set(t.x, t.y, -t.d); s.towers.setMatrixAt(nt++, m.compose(p, q.identity(), one)); }
      // Cables from tower to tower, on both sides of each tower.
      this.lift = [];
      for (let i = 0; i + 1 < towers.length && nc < 38; i++) {
        const a = towers[i], b = towers[i + 1];
        for (const side of [-1, 1]) {
          const ax = a.x + side * 1.8, bx = b.x + side * 1.8, ay = a.y + 11.8, by = b.y + 11.8;
          const len = Math.hypot(bx - ax, by - ay, b.d - a.d);
          p.set((ax + bx) / 2, (ay + by) / 2, -(a.d + b.d) / 2);
          q.setFromEuler(e.set(Math.atan2(by - ay, Math.hypot(bx - ax, b.d - a.d)), Math.atan2(-(bx - ax), b.d - a.d), 0));
          s.cables.setMatrixAt(nc++, m.compose(p, q, sc.set(1, 1, len)));
          this.lift.push({ ax, ay, ad: a.d, bx, by, bd: b.d, side });
        }
      }
      s.fencePosts.count = np; s.fenceNet.count = nn; s.lightPoles.count = s.lamps.count = nl; s.towers.count = nt; s.cables.count = nc;
      for (const o of [s.fencePosts, s.fenceNet, s.lightPoles, s.lamps, s.towers, s.cables]) o.instanceMatrix.needsUpdate = true;
      const G2 = s.glow.geometry, P = G2.attributes.position.array;
      P.fill(0); P.set(pts.slice(0, P.length)); G2.setDrawRange(0, pts.length / 3); G2.attributes.position.needsUpdate = true;
    },
    // Chairs ride up one cable (towards the top of the mountain) and down the other.
    moveLift(s) {
      const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), one = new T.Vector3(1, 1, 1);
      let n = 0;
      for (const c of this.lift || []) {
        const span = c.bd - c.ad, gap = span / 4;
        for (let k = 0; k < 4 && n < 120; k++) {
          const off = ((((k * gap + c.side * this.t * 3) % span) + span) % span) / span;
          const sag = Math.sin(Math.PI * off) * 0.8;
          p.set(c.ax + (c.bx - c.ax) * off, c.ay + (c.by - c.ay) * off - sag, -(c.ad + span * off));
          q.setFromEuler(e.set(0, c.side > 0 ? Math.PI : 0, Math.sin(this.t * 1.3 + k + c.ad) * 0.04));
          s.chairs.setMatrixAt(n++, m.compose(p, q, one));
        }
      }
      s.chairs.count = n; s.chairs.instanceMatrix.needsUpdate = true;
    },

    drawHud() {
      ctx.textBaseline = 'top';
      const text = (str, x, y, size, color, align) => {
        ctx.font = font(size); ctx.textAlign = align;
        ctx.fillStyle = 'rgba(20,24,40,0.45)'; ctx.fillText(str, x + 2, y + 2);
        ctx.fillStyle = color; ctx.fillText(str, x, y);
      };
      // The avalanche close behind you: powder snow blowing up over the bottom of the screen.
      if (this.ava && !this.ava.out) {
        const k = clamp(1 - (this.d - this.ava.d) / 30, 0, 1);
        if (k > 0) {
          const g = ctx.createLinearGradient(0, H, 0, H * (1 - 0.75 * k));
          g.addColorStop(0, 'rgba(244,247,252,' + (0.95 * k) + ')'); g.addColorStop(1, 'rgba(244,247,252,0)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        }
      }
      // Score and coins top left, the trick multiplier top right, speed big at the bottom.
      text('SCORE', 14, 12, 7, '#f4f6fb', 'left');
      text(this.score.toLocaleString('en-US'), 14, 24, 16, '#ffffff', 'left');
      const g = ctx.createRadialGradient(19, 52, 1, 22, 55, 7);
      g.addColorStop(0, '#fff3a8'); g.addColorStop(0.6, '#ffc531'); g.addColorStop(1, '#b97a0c');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(21, 55, 7, 0, 7); ctx.fill();
      text(String(this.coins), 33, 51, 9, '#ffd75e', 'left');
      text('x' + this.mult, W - 14, 14, 16, this.mult > 1 ? '#ffd75e' : '#ffffff', 'right');
      if (this.mult > 1) { ctx.fillStyle = 'rgba(255,215,94,0.9)'; ctx.fillRect(W - 14 - 46 * (this.multT / 7), 36, 46 * (this.multT / 7), 3); }
      if (this.sw && !this.crash) text('SWITCH', W - 14, 46, 8, '#7fe3ff', 'right');
      if (this.line >= 2 && !this.crash) text('LINE x' + this.line, W - 14, 60, 8, '#ffd75e', 'right');
      // The special stretches: gates so far, the wind, or how close the avalanche is.
      if (!this.crash) {
        if (this.gateN) text('GATES ' + this.gateHit + '/' + this.gateI, 14, 70, 8, '#7fe3ff', 'left');
        if (this.storm > 0.3) {
          const k = Math.round(Math.abs(this.wind) / 2.2);
          if (k) text('WIND ' + (this.wind > 0 ? '>'.repeat(k) : '<'.repeat(k)), 14, 70, 8, '#ffffff', 'left');
        }
        if (this.ava && !this.ava.out) {
          const gap = Math.max(0, this.d - this.ava.d), w = 90 * clamp(gap / 60, 0, 1);
          text('AVALANCHE ' + Math.round(gap) + ' M', 14, 70, 8, gap < 20 ? '#ff6b9a' : '#ffffff', 'left');
          ctx.fillStyle = 'rgba(20,24,40,0.45)'; ctx.fillRect(14, 84, 90, 5);
          ctx.fillStyle = gap < 20 ? '#ff6b9a' : '#ffd75e'; ctx.fillRect(14, 84, w, 5);
        }
      }
      const top = !this.crash && this.v >= VMAX - 0.05;
      text(String(Math.round(this.v * 3.6)), W / 2, H - 50, 24, top ? (Math.sin(this.t * 10) > 0 ? '#ff6b6b' : '#ffffff') : this.boost > cruise(this.d) * 0.08 && !this.crash ? '#7fe3ff' : '#ffd23f', 'center');
      if (top) text('MAX SPEED', W / 2, H - 66, 8, '#ff6b6b', 'center');
      text('KM/H', W / 2, H - 20, 7, '#f4f6fb', 'center');
      // Boosted: speed lines down both sides of the screen, and BOOST by the speed.
      const bst = this.crash ? 0 : clamp(this.boost / (cruise(this.d) * 0.3), 0, 1);
      if (bst > 0.05) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
        for (let i = 0; i < 14; i++) {
          const side = i % 2 ? 1 : -1, k = (i * 0.37 + this.t * 2.6) % 1, y = (i * 53 % H), len = 30 + 60 * k;
          const x = W / 2 + side * (W * 0.32 + k * W * 0.2);
          ctx.globalAlpha = bst * 0.85 * (1 - k);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + side * len * 0.4, y + len * (y > H / 2 ? 1 : -1) * 0.3); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        if (this.boostT > 0) text('BOOST!', W / 2, H - 82, 11, '#7fe3ff', 'center');
      }
      if (this.air && this.airT > 0.35 && !this.crash) text('AIR ' + this.airT.toFixed(1) + 's', W / 2, H - 100, 10, '#ffffff', 'center');
      if (this.grind) text(this.grindName + '  ' + this.grindT.toFixed(1) + 's', W / 2, H - 100, 11, '#7fe3ff', 'center');
      this.pops.slice(-2).forEach((p, i) => {
        ctx.globalAlpha = clamp(p.life * 2, 0, 1);
        const y = H * 0.12 + i * 40 - (1.8 - p.life) * 10;
        text(p.text, W / 2, y, 14, '#ffffff', 'center');
        text(p.sub, W / 2, y + 20, 9, p.col, 'center');
        ctx.globalAlpha = 1;
      });
      if (this.sj && !this.sj.done && !this.crash && this.d < JUMP_LIP) {
        text('SKI JUMP', W / 2, H - 112, 12, '#ffd75e', 'center');
        text(coarse ? 'SWIPE UP RIGHT AT THE EDGE!' : 'PRESS SPACE RIGHT AT THE EDGE!', W / 2, H - 94, 9, '#ffffff', 'center');
      } else if (this.jumpFlight && this.d > JUMP_LIP) text((this.d - JUMP_LIP).toFixed(1) + ' M', W / 2, H - 124, 16, '#ffd75e', 'center');
      else if (this.t < 4 && !this.crash) {
        ctx.globalAlpha = clamp(4 - this.t, 0, 1);
        text('<  STEER  >', W / 2, H - 82, 11, '#ffffff', 'center');
        text(coarse ? 'SWIPE UP TO JUMP' : 'SPACE TO JUMP', W / 2, H - 66, 9, '#ffffff', 'center');
        ctx.globalAlpha = 1;
      }
      ctx.textBaseline = 'alphabetic';
    },
  };

  import(THREE_URL).then((m) => { T = m; }).catch(() => { failed = true; });
  Arcade.register('ski', ski);
})();
