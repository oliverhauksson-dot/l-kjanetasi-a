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
  // A terrain park every PARK_EVERY metres: rails, boxes, kickers and side hits, with no trees on the run.
  const PARK_AT = 420, PARK_EVERY = 900, PARK_LEN = 260;
  const inPark = (d) => d >= PARK_AT && (d - PARK_AT) % PARK_EVERY < PARK_LEN;
  function parkMask(d) { // 1 in a park, 0 outside, fading in between. The park's snow is smoothed flat.
    const k = d - PARK_AT, m = ((k % PARK_EVERY) + PARK_EVERY) % PARK_EVERY;
    if (k < -40) return 0;
    if (m < PARK_LEN) return 1;
    return clamp(1 - Math.min(m - PARK_LEN, PARK_EVERY - m) / 40, 0, 1);
  }
  /* Between two parks there is a stretch with something special going on: a slalom, a frozen lake,
     a snowstorm or an avalanche. The order is shuffled every run. */
  const ZONE_GAP = 350, ZONE_LEN = 380, ZONE_TYPES = ['slalom', 'lake', 'storm', 'avalanche'];
  let ZONES = ZONE_TYPES.slice();
  function zoneAt(d) { // { type, s (where it starts), k (which one) }, or null.
    const k = Math.floor((d - PARK_AT) / PARK_EVERY);
    if (k < 0) return null;
    const s = PARK_AT + k * PARK_EVERY + ZONE_GAP;
    return d >= s && d < s + ZONE_LEN ? { type: ZONES[k % ZONES.length], s, k } : null;
  }
  // How much a zone of this type there is at d: 1 inside, 0 outside, fading over `fade` metres at both ends.
  function zoneMask(type, d, fade) {
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
  const HIP_THROW = 7; // How hard a side hit throws you towards the middle.
  // Tricks. A jump (ollie) pops you up; spins count in half turns (180, 360, 540...), flips in full turns.
  const OLLIE = 7.8, SPIN_RATE = 11, FLIP_RATE = 12.5, GRAB_T = 0.75, SWAP_T = 0.35;
  const SPIN_PTS = [0, 100, 200, 350, 500, 700, 900];
  // Clean tricks give a speed boost on top of cruising speed, as a share of it, that fades over a few seconds.
  const BOOST_MAX = 0.6, BOOST_FADE = 0.6;
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
  const rollers = (d) => { const e = Math.max(0, Math.sin(d / 330 + ph[2])); return e * e * 1.7 * Math.sin(d / 5.6 + ph[3]) * (1 - parkMask(d)); };
  function height(x, d) {
    const u = x - center(d), t = Math.max(0, Math.abs(u) - FLOOR);
    const side = t < 40 ? 0.02 * t * t : 32 + 1.6 * (t - 40); // The valley sides get steeper, then rise straight on.
    const flat = 1 - 0.92 * iceAt(x, d); // The lake's ice is smooth: no rollers and no bumps.
    return -SLOPE * d + rollers(d) * flat + 0.0016 * u * u + side
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

  // The skier: simple shapes, posed every frame. Limbs are capsules stretched between two points.
  function makeSkier() {
    const mat = (c, r = 0.55) => new T.MeshStandardMaterial({ color: c, roughness: r });
    const jacket = mat('#ffb020', 0.5), pants = mat('#1f2740', 0.7), dark = mat('#1a1c24', 0.4), white = mat('#f4f6fa', 0.35);
    // root follows your heading, flip tips you head over heels round your middle, turn is the spin, lean leans into turns.
    const root = new T.Group(), flip = new T.Group(), turn = new T.Group(), lean = new T.Group();
    root.add(flip); flip.add(turn); turn.add(lean); flip.position.y = 0.7; turn.position.y = -0.7;
    const capsule = new T.CapsuleGeometry(1, 1, 4, 10);
    const add = (geo, m) => { const o = new T.Mesh(geo, m); o.castShadow = true; lean.add(o); return o; };
    return {
      root, flip, turn, lean,
      skis: [0, 1].map(() => add(new T.BoxGeometry(0.11, 0.035, 1.75), mat('#ff5a36', 0.35))),
      boots: [0, 1].map(() => add(new T.BoxGeometry(0.15, 0.2, 0.3), dark)),
      shins: [0, 1].map(() => add(capsule, pants)),
      thighs: [0, 1].map(() => add(capsule, pants)),
      torso: add(capsule, jacket),
      arms: [0, 1].map(() => add(capsule, jacket)),
      poles: [0, 1].map(() => add(new T.CylinderGeometry(0.012, 0.012, 1, 5), mat('#c9cdd8', 0.3))),
      head: add(new T.SphereGeometry(0.15, 16, 12), white),
      goggles: add(new T.BoxGeometry(0.2, 0.07, 0.08), new T.MeshStandardMaterial({ color: '#ff8a20', roughness: 0.15, metalness: 0.6 })),
      pack: add(new T.BoxGeometry(0.26, 0.3, 0.12), mat('#30343f', 0.8)),
    };
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
      sk.boots[i].position.set(x, 0.13, 0);
      const knee = V(x * 1.05, 0.5 - 0.14 * c, -0.2 - 0.12 * c);
      placeLimb(sk.shins[i], V(x, 0.18, 0), knee, 0.09);
      placeLimb(sk.thighs[i], knee, V(s * 0.1, hip.y, hip.z), 0.11);
    }
    const neck = V(0, hip.y + 0.55 * Math.cos(bend), hip.z - 0.55 * Math.sin(bend));
    placeLimb(sk.torso, hip, neck, 0.2);
    sk.pack.position.set(0, (hip.y + neck.y) / 2 + 0.05 * Math.cos(bend), (hip.z + neck.z) / 2 + 0.2); sk.pack.rotation.x = -bend;
    sk.head.position.set(0, neck.y + 0.16, neck.z - 0.04);
    sk.goggles.position.set(-0.13 * Math.sin(look), neck.y + 0.17, neck.z - 0.04 - 0.13 * Math.cos(look)); sk.goggles.rotation.y = look;
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, sh = V(s * 0.22, neck.y - 0.08, neck.z + 0.02);
      // A grab: one hand reaches down to its ski, the other goes up for balance.
      const reach = grab === s, up = armsUp || (grab && !reach);
      const hand = reach ? V(s * 0.17, 0.12, 0.05) : up ? V(s * 0.55, neck.y + 0.15, neck.z - 0.1) : V(s * 0.26, hip.y + 0.05 + 0.1 * c, hip.z - 0.42 - 0.05 * c);
      placeLimb(sk.arms[i], sh, hand, 0.07);
      const tip = reach ? V(s * 0.3, 0.3, hand.z + 1.1) : up ? V(s * 0.75, hand.y - 0.6, hand.z + 0.9) : V(s * 0.35, 0.05, hand.z + 1.05);
      placeLimb(sk.poles[i], hand, tip, 0, true);
    }
  }

  function initScene() {
    let renderer;
    try { renderer = new T.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' }); }
    catch (e) { failed = true; return; }
    vA = new T.Vector3(); vB = new T.Vector3();
    STORM_DAY = new T.Color('#dde3ea'); STORM_NIGHT = new T.Color('#262d40');
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

    const skier = makeSkier(); scene.add(skier.root);
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

    S = { renderer, scene, camera, hemi, sun, lamp, sky, skyMat, stars, aurora, auroraMat, peaks, tiles, trees, forest, rocks, coins, flags, rampMat, railMat, legMat, bannerMat, bannerSide, feats: [], skier, blob, tracks, spray, sparks, flakes, deer, hares, gateMats, poleGeo, panelGeo, avalanche, built: '' };
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
  const LIPS = { kick: '#ff6a2c', big: '#ff2f55', hip: '#2fb5ff' };
  function wedge(f, lift, top, side, edge) {
    const pos = [], col = [], n = 10;
    const quad = (a, b, c, e, cl) => { for (const p of [a, b, c, a, c, e]) { pos.push(p[0], p[1], p[2]); col.push(cl.r, cl.g, cl.b); } };
    const pt = (s, sd, up) => { const d = f.d + s * f.len, x = (f.type === 'box' ? center(d) + f.u : f.x) + sd * f.w; return [x, height(x, d) + (up ? lift(s) : -0.3), -d]; };
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
      for (let s = 0; s <= f.len + 0.01; s += 1) { const d = f.d + s, x = center(d) + f.u; pts.push(new T.Vector3(x, height(x, d) + f.top - 0.05, -d)); }
      const bar = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), pts.length * 2, 0.07, 8), S.railMat);
      bar.castShadow = true; m.add(bar);
      for (let s = 0.3; s < f.len; s += 3) {
        const d = f.d + Math.min(s, f.len - 0.3), x = center(d) + f.u, y = height(x, d);
        const leg = new T.Mesh(new T.CylinderGeometry(0.05, 0.07, f.top + 0.3, 6), S.legMat);
        leg.position.set(x, y + (f.top - 0.3) / 2, -d); leg.castShadow = true; m.add(leg);
      }
    } else if (f.type === 'arch') {
      // The park's entrance: two posts and a banner right across the run.
      m = new T.Group();
      const xl = center(f.d) - FLOOR + 1, xr = center(f.d) + FLOOR - 1, top = Math.max(height(xl, f.d), height(xr, f.d)) + 8;
      for (const x of [xl, xr]) {
        const y0 = height(x, f.d) - 0.5, post = new T.Mesh(new T.CylinderGeometry(0.35, 0.4, top - y0 + 1.6, 10), S.legMat);
        post.position.set(x, (top + 1.6 + y0) / 2, -f.d); post.castShadow = true; m.add(post);
      }
      const banner = new T.Mesh(new T.BoxGeometry(xr - xl, 3, 0.3), [S.bannerSide, S.bannerSide, S.bannerSide, S.bannerSide, S.bannerMat, S.bannerSide]);
      banner.position.set((xl + xr) / 2, top, -f.d); banner.castShadow = true; m.add(banner);
    } else if (f.type === 'gate') {
      m = new T.Group();
      const mat = S.gateMats[f.c];
      for (const s of [-1, 1]) {
        const x = f.x + s * GATE_W, y = height(x, f.d);
        const pole = new T.Mesh(S.poleGeo, mat); pole.position.set(x, y + 0.95, -f.d); pole.castShadow = true; m.add(pole);
        const flag = new T.Mesh(S.panelGeo, mat); flag.scale.set(0.9, 1, 1); flag.position.set(x - s * 0.5, y + 1.55, -f.d); m.add(flag);
      }
    } else m = wedge(f, (s) => f.h * s * s, new T.Color('#f7f9ff'), new T.Color('#9fb5dc'), new T.Color(LIPS[f.type]));
    m.feat = f;
    return m;
  }
  function bannerTexture() {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#1b2350'; g.fillRect(0, 0, 1024, 64);
    g.fillStyle = '#ffd23f'; g.fillRect(0, 0, 1024, 5); g.fillRect(0, 59, 1024, 5);
    g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) { g.fillStyle = i === 1 ? '#ffffff' : '#7fe3ff'; g.fillText(i === 1 ? 'TERRAIN PARK' : '★  ★  ★', 170 + i * 342, 34); }
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }

  let STORM_DAY = null, STORM_NIGHT = null;
  function dropMesh(m) { S.scene.remove(m); m.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }

  /* ---------- The game ---------- */
  const ski = {
    get W() { if (!locked) { const wide = window.innerWidth > window.innerHeight; W = wide ? 640 : 450; H = wide ? 360 : 600; } return W; },
    get H() { return H; },
    color: 'var(--violet)', title: 'Endless Ski', label: 'Score',
    quietScore: true, // The score goes up every metre, so coins and jumps get their own sounds instead.
    intro: 'Ski down an endless 3D valley. Dodge the trees, rocks and reindeer, grab coins, fly off kickers, and survive slaloms, frozen lakes, snowstorms and avalanches.',
    hint: '<kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> to steer, <kbd>Space</kbd> to jump. In the air, hold <kbd>←</kbd> <kbd>→</kbd> to spin, <kbd>W</kbd> to front flip and <kbd>S</kbd> to back flip. <kbd>S</kbd> on a rail spins you round. On a phone, hold a side to steer, swipe up to jump, and swipe up or down in the air to flip. <kbd>P</kbd> to pause',

    reset() {
      locked = true; // Keep the screen shape until the game is closed.
      ph = ph.map(() => rand(0, 6.3)); SEED = (Math.random() * 1e9) | 0;
      ZONES = ZONE_TYPES.slice().sort(() => Math.random() - 0.5);
      this.d = 0; this.x = center(0); this.vx = 0; this.v = 12;
      this.y = height(this.x, 0); this.vy = 0; this.air = false; this.airT = 0; this.spin = 0;
      this.flip = 0; this.sw = false; this.airSw = false; this.ollie = false; this.fromRail = false; this.jumpCd = 0; this.jumpQ = 0; this.boost = 0; this.boostT = 0;
      this.swapT = 0; this.look = 0; this.up = this.down = false; this.flipTouch = 0;
      this.chunks = []; this.nextChunk = -CL; this.nextRamp = 150; this.grind = null; this.grindT = 0; this.wasPark = false; this.bump = 0;
      this.lastG = this.y;
      this.parts = []; this.sparks = []; this.pops = []; this.trail = []; this.trailD = -1;
      this.coins = 0; this.bonus = 0; this.score = 0; this.t = 0; this.crash = null; this.shake = 0; this.sndT = 0;
      this.left = this.right = this.touch = false; this.tx = W / 2;
      this.cam = null; this.lean = 0; this.crouch = 0.3; this.mult = 1; this.multT = 0; this.grab = '';
      this.zoneK = -1; this.gateHit = 0; this.gateStreak = 0; this.gateN = 0; this.gateI = 0; this.ava = null;
      this.storm = 0; this.wind = 0; this.windX = 0; this.fallT = 0; this.ice = 0;
      this.gen();
      if (S) { S.tiles.forEach((t) => { t.chunk = null; t.visible = false; }); S.feats.forEach(dropMesh); S.feats = []; S.built = ''; }
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
      const ch = { d0, trees: [], forest: [], rocks: [], coins: [], feats: [], flags: [], gates: [], animals: [] }, lv = level(d0);
      const put = (list, x, d, s) => list.push({ x, d, s, y: height(x, d), r: rand(0, 6.3), h: rand(0.9, 1.15) });
      // No kickers on the ice or in the middle of a slalom.
      const calm = (d) => { const z = zoneAt(d); return !z || (z.type !== 'lake' && z.type !== 'slalom'); };
      // A kicker now and then between the parks.
      if (d0 >= this.nextRamp && !inPark(d0 - 60) && !inPark(d0 + CL + 60)) {
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
        if (normalAt(x, d)[1] > 0.45 && noise(x * 0.03, d * 0.03) > -0.45) put(ch.forest, x, d, rand(0.9, 2));
      }
      // Trees and rocks to dodge on the valley floor, more and more of them the further you go.
      if (d0 > 50) {
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
      const v = cruise(d), lip = (2 * h) / len, side = type === 'hip' ? -Math.sign(u) * HIP_THROW : 0;
      for (let s = 4; s < 60; s += 4) {
        const up = h + (lip + SLOPE) * s - ((G / 2) * s * s) / (v * v); // Height above the snow where the jump goes.
        if (up < 0.8) break;
        const dd = d + len + s, x = center(dd) + u + (side * s) / v;
        ch.coins.push({ x, d: dd, y: height(x, dd) + up });
      }
    },
    // A rail (with a small kicker to pop onto it) or a box you can ride straight onto.
    rail(ch, d, u, len, box) {
      const f = { type: box ? 'box' : 'rail', x: center(d) + u, u, d, len, top: box ? 0.55 : 0.95, w: box ? 0.6 : 0.12 };
      if (!box) this.kicker(ch, d - 4.4, u, 4, 1.3, 1.05, 'kick', true);
      ch.feats.push(f);
      for (let s = 3; s < len; s += 3) { const dd = d + s, x = center(dd) + u; ch.coins.push({ x, d: dd, y: height(x, dd) + f.top + 0.9 }); }
    },
    // Fill the part of a terrain park that lies in this chunk: an entrance arch, flags along the edges,
    // rows of rails, boxes and kickers across the run, and side hits on both edges.
    park(ch, d0) {
      const here = (d) => d >= d0 && d < d0 + CL;
      for (let k = Math.max(0, Math.floor((d0 - PARK_AT) / PARK_EVERY)); PARK_AT + k * PARK_EVERY < d0 + CL; k++) {
        const p0 = PARK_AT + k * PARK_EVERY;
        if (p0 + PARK_LEN < d0) continue;
        if (here(p0)) ch.feats.push({ type: 'arch', x: center(p0), u: 0, d: p0, len: 1 });
        for (let d = p0; d <= p0 + PARK_LEN; d += 10) if (here(d)) for (const s of [-1, 1]) { const x = center(d) + s * (FLOOR - 1.5); ch.flags.push({ x, d, y: height(x, d), c: (d / 10 + (s > 0 ? 1 : 0)) % 2 }); }
        for (let i = 0; i < 7; i++) {
          const d = p0 + 24 + i * 33;
          if (!here(d)) continue;
          const lanes = [-9, 0, 9].sort(() => Math.random() - 0.5), n = i === 0 ? 3 : Math.random() < 0.5 ? 2 : 3;
          for (let j = 0; j < n; j++) {
            const u = lanes[j] + rand(-1.5, 1.5), r = Math.random();
            if (r < 0.38) this.rail(ch, d, u, rand(13, 18), false);
            else if (r < 0.62) this.rail(ch, d, u, rand(10, 14), true);
            else if (r < 0.82 || lanes[j] !== 0) this.kicker(ch, d, u, 7, 1.9, 2, 'kick');
            else this.kicker(ch, d, u, 10, 2.6, 3.2, 'big');
          }
        }
        for (let i = 0; i < 5; i++) { const d = p0 + 40 + i * 46; if (here(d)) this.kicker(ch, d, (i % 2 ? 1 : -1) * (FLOOR - 5.5), 6, 2.4, 1.7, 'hip'); }
      }
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
      if (d0 < 250 || Math.random() > 0.28 + 0.2 * lv) return;
      const d = d0 + rand(8, 50), z = zoneAt(d);
      if (parkMask(d) > 0 || (z && z.type === 'slalom')) return;
      const deer = Math.random() < 0.55, dir = Math.random() < 0.5 ? 1 : -1, n = deer ? 1 + ((Math.random() * 3) | 0) : 1 + ((Math.random() * 2) | 0);
      for (let q = 0; q < n; q++) {
        const dd = d + q * rand(1.5, 3.5), x = center(dd) - dir * (FLOOR - 1 + q * 2);
        ch.animals.push({ deer, d: dd, x, y: height(x, dd), dir, speed: deer ? rand(6.5, 8.5) : rand(8, 11), run: false, ph: rand(0, 6.3), done: false });
      }
    },
    // The snow height under a point, kickers included.
    ground(x, d) {
      let y = height(x, d);
      for (const ch of this.chunks) {
        if (d < ch.d0 - 20 || d > ch.d0 + CL + 20) continue;
        for (const f of ch.feats) if (f.h && d >= f.d && d <= f.d + f.len && Math.abs(x - f.x) < f.w) { const s = (d - f.d) / f.len; y += f.h * s * s; }
      }
      return y;
    },
    kickerAt(x, d) {
      for (const ch of this.chunks) for (const f of ch.feats) if (f.h && d >= f.d - 0.5 && d <= f.d + f.len + 0.5 && Math.abs(x - f.x) < f.w + 0.3) return f;
      return null;
    },
    railAt(x, d) {
      for (const ch of this.chunks) for (const f of ch.feats) if (f.top && d >= f.d && d <= f.d + f.len && Math.abs(x - center(d) - f.u) < f.w + 0.5) return f;
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
      if (inPark(this.d) && !this.wasPark) this.pop('TERRAIN PARK', 'RAILS, BOXES AND JUMPS', '#7fe3ff');
      this.wasPark = inPark(this.d);
      this.zones(dt);
      if (this.crash) return;
      this.bump = Math.max(0, (this.bump || 0) - dt);
      this.jumpCd = Math.max(0, this.jumpCd - dt); this.jumpQ = Math.max(0, this.jumpQ - dt);
      this.boost *= Math.exp(-BOOST_FADE * dt); this.boostT = Math.max(0, this.boostT - dt);
      this.swapT = Math.max(0, this.swapT - dt);
      const pitch = (this.up ? 1 : 0) - (this.down ? 1 : 0) || this.flipTouch;

      if (this.grind) {
        // Sliding along a rail or box. Hold left or right to hop off early.
        const f = this.grind;
        // A rail keeps your speed.
        this.d += this.v * dt;
        const rx = center(this.d) + f.u, top = height(rx, this.d) + f.top;
        this.x += (rx - this.x) * Math.min(1, dt * 15); this.vx = 0;
        this.vy = (top - this.y) / dt; this.y = top; this.grindT += dt;
        if (this.sw) this.grindSwT += dt;
        this.lastG = this.ground(this.x, this.d);
        if (Math.random() < dt * 50) this.parts.push({ x: this.x + rand(-0.3, 0.3), y: this.y, d: this.d, vx: rand(-2, 2), vy: rand(1, 3), vd: this.v * rand(0.6, 0.9), life: rand(0.2, 0.5), max: 0.5 });
        if (f.type === 'rail' && Math.random() < dt * 40) this.puff(1, this.x, this.y, this.d, 2, 2, this.sparks);
        if (this.d > f.d + f.len) this.endGrind(0);
        else if (Math.abs(dir) > 0.5 && this.grindT > 0.45) this.endGrind(Math.sign(dir) * 6);
      } else {
        // Speed creeps up the further you go. Climbing the valley side slows you and pushes you back down.
        if (!this.air) {
          // On ice you go a bit faster, and turning hardly bites, so you slide on sideways.
          const want = cruise(this.d) * (wall > 0 ? 0.75 : 1) * (1 + 0.12 * this.ice) + this.boost;
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

        // Stay on the snow, or fly when it drops away faster than gravity can pull you down.
        const g = this.ground(this.x, this.d), gv = (g - this.lastG) / dt; this.lastG = g;
        if (!this.air) {
          if (gv < this.vy - G * dt * 1.2) {
            this.takeoff(false); if (this.vy > 2) snd.jump();
            const k = this.kickerAt(this.x, this.d - this.v * dt);
            if (k && k.type === 'hip') this.vx = -Math.sign(k.u) * HIP_THROW;
          }
          else { this.y = g; if (gv < this.v * 0.5) this.vy = gv; } // Stepping up the side of a kicker is not a launch.
        }
        if (this.air) { this.airT += dt; this.vy -= G * dt; this.y += this.vy * dt; }
        // Come down on a rail, or ride onto a box, and you start sliding. Ride into a rail and it knocks you aside.
        const f = this.railAt(this.x, this.d);
        if (f) {
          const top = height(center(this.d) + f.u, this.d) + f.top, fromAbove = y0 >= top - (f.type === 'box' ? 0.75 : 0.3);
          if (fromAbove && this.y <= top + 0.6) { this.startGrind(f, top); if (this.crash) return; } // Close enough: you pop onto it.
          else if (!fromAbove && f.type === 'rail' && Math.abs(this.x - center(this.d) - f.u) < 0.3 && this.y < top - 0.3 && !this.bump) {
            const side = this.x >= center(this.d) + f.u ? 1 : -1;
            this.x = center(this.d) + f.u + side * 0.45; this.vx = side * 6; this.v *= 0.7; this.bump = 0.5;
            this.mult = 1; this.multT = 0; this.shake = 0.6; snd.clank(); this.pop('OUCH!', 'SPEED LOST', '#ff6b9a');
          }
        }
        if (this.air && this.y <= g) { this.land(g, gv); if (this.crash) return; }
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
      }
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
        this.trail.unshift(this.air || this.grind ? null : { x: this.x, d: this.d, h: Math.atan2(this.vx + bend * this.v * 0.5, this.v) });
        if (this.trail.length > TRACK) this.trail.pop();
      }

      if (this.multT > 0 && !this.air && !this.grind && (this.multT -= dt) <= 0) this.mult = 1;
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
      const names = f.type === 'rail' ? RAILS : BOXES, base = names[(Math.random() * names.length) | 0];
      this.grind = f; this.grindT = 0; this.grindSwT = 0; this.grindSwaps = 0; this.air = false; this.y = top; this.vy = 0;
      this.grindSide = SIDEWAYS.includes(base);
      this.grindName = [this.sw ? 'SWITCH' : '', flipName(nf), n ? Math.abs(n) * 180 : '', base].filter(Boolean).join(' ');
      this.grindBonus = Math.round(spinPts(Math.abs(n)) * 0.75) + 300 * Math.abs(nf) + (this.airT > 0.55 ? Math.round(this.airT * 100) : 0);
      this.spin = this.flip = 0; this.airT = 0; this.fromRail = false; this.flipTouch = 0; snd.clank();
    },
    // A speed boost: share is how much faster than cruising, the trick multiplier makes it bigger.
    speedUp(share) {
      const c = cruise(this.d), add = Math.min(share * (1 + 0.15 * (this.mult - 1)), BOOST_MAX - this.boost / c) * c;
      if (add <= 0.2) return;
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
      snd.trick(); this.mult = Math.min(this.mult + 1, 5); this.multT = 7;
      this.grind = null; this.swapT = 0; this.takeoff(false); this.fromRail = true; this.vy += 3; this.vx = push;
      this.lastG = this.ground(this.x, this.d);
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
      if ((Math.abs(halves) > 0.3 && off > 0.28) || offF > 0.1) { this.v *= 0.85; this.boost = 0; this.mult = 1; this.multT = 0; this.pop('SKETCHY LANDING', 'SPEED LOST', '#ff6b9a'); snd.sketchy(); }
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
      const tx = this.x - Math.sin(head) * 10, td = this.d - Math.cos(head) * 10, ty = Math.max(this.y, height(tx, td)) + 5;
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
          const cx = q.x + Math.cos(q.h) * off, cd = q.d - Math.sin(q.h) * off, y = height(cx, cd) + 0.03;
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
      cam.lookAt(lookX, this.y - (W > H ? 5.7 : 3.9), -lookD);
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
      text(String(Math.round(this.v * 3.6)), W / 2, H - 50, 24, this.boost > cruise(this.d) * 0.08 && !this.crash ? '#7fe3ff' : '#ffd23f', 'center');
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
      if (this.t < 4 && !this.crash) {
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
