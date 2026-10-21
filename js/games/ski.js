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
  const CL = 60, CHUNKS = 9;       // Chunk length, and how many are kept (about 500 m ahead).
  const NU = 49, ND = 31;          // Terrain grid points across and along a chunk.
  const SLOPE = 0.22;              // The mountain drops 22 cm every metre.
  const FLOOR = 27;                // Half the width of the valley floor.
  const G = 24;                    // Gravity, a bit stronger than real so jumps feel snappy.
  const CYCLE = 1800;              // Metres from one morning to the next.
  const RAMP_EVERY = 230;
  const GRABS = ['INDY', 'TWEAKED INDY', 'METHOD', 'MUTE GRAB', 'STALEFISH', 'TAIL GRAB', 'JAPAN', 'MELON'];
  const RAMP = { w: 1.9, len: 7, h: 2 };
  const rampLift = (s) => RAMP.h * s * s; // Kickers rise in a curve, so they throw you up.
  const LIP = (2 * RAMP.h) / RAMP.len; // How steep a kicker is at the top.

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
  const rollers = (d) => { const e = Math.max(0, Math.sin(d / 330 + ph[2])); return e * e * 1.7 * Math.sin(d / 5.6 + ph[3]); };
  function height(x, d) {
    const u = x - center(d), t = Math.max(0, Math.abs(u) - FLOOR);
    const side = t < 40 ? 0.02 * t * t : 32 + 1.6 * (t - 40); // The valley sides get steeper, then rise straight on.
    return -SLOPE * d + rollers(d) + 0.0016 * u * u + side
      + noise(x * 0.04, d * 0.04) * 1.4 + noise(x * 0.17, d * 0.17) * 0.3 + noise(x * 0.5, d * 0.35) * 0.06 + t * 0.12 * noise(x * 0.02 + 40, d * 0.02);
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
  };

  /* ---------- 3D scene ---------- */
  let S = null; // Everything three.js, made once when the library has loaded.
  const glCanvas = document.createElement('canvas');
  const SHADER_END = '#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';

  // Several shapes, each with its own colour, glued into one shape so a whole tree is drawn in one go.
  function merged(parts) {
    const pos = [], nor = [], col = [];
    for (const p of parts) {
      const g = p.geo.toNonIndexed(); g.applyMatrix4(p.m);
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
    const ng = g.toNonIndexed(); ng.computeVertexNormals();
    const n = ng.attributes.normal, col = [], snow = new T.Color('#eef3fb'), rock = new T.Color('#4f5566');
    for (let i = 0; i < n.count; i++) { const c = n.getY(i) > 0.55 ? snow : rock; col.push(c.r, c.g, c.b); }
    ng.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    return ng;
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
    const root = new T.Group(), lean = new T.Group(); root.add(lean);
    const capsule = new T.CapsuleGeometry(1, 1, 4, 10);
    const add = (geo, m) => { const o = new T.Mesh(geo, m); o.castShadow = true; lean.add(o); return o; };
    return {
      root, lean,
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
  function poseSkier(sk, c, armsUp, grab) {
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
    sk.goggles.position.set(0, neck.y + 0.17, neck.z - 0.17);
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

    S = { renderer, scene, camera, hemi, sun, lamp, sky, skyMat, stars, aurora, auroraMat, peaks, tiles, trees, forest, rocks, coins, rampMat, ramps: [], skier, blob, tracks, spray, sparks, flakes, built: '' };
  }
  const TRACK = 90;

  /* ---------- Turning chunks into 3D ---------- */
  function fillTile(tile, ch) {
    const g = tile.geometry, P = g.attributes.position.array, N = g.attributes.normal.array, C = g.attributes.color.array;
    const snow = new T.Color('#f5f8fd'), blue = new T.Color('#d3def2'), rock = new T.Color('#545a6a'), rock2 = new T.Color('#7a8192'), c = new T.Color(), r = new T.Color();
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
        C[k] = c.r; C[k + 1] = c.g; C[k + 2] = c.b;
      }
    }
    g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = g.attributes.color.needsUpdate = true;
    tile.chunk = ch; tile.visible = true;
  }
  function rampMesh(rp) {
    // A curved wedge of snow lying on the slope, with blue sides and an orange lip.
    const pos = [], col = [], top = new T.Color('#f7f9ff'), side = new T.Color('#9fb5dc'), edge = new T.Color('#ff6a2c'), n = 10;
    const quad = (a, b, c, e, cl) => { for (const p of [a, b, c, a, c, e]) { pos.push(p[0], p[1], p[2]); col.push(cl.r, cl.g, cl.b); } };
    const pt = (s, sd, up) => { const d = rp.d + s * RAMP.len, x = rp.x + sd * RAMP.w; return [x, height(x, d) + (up ? rampLift(s) : -0.3), -d]; };
    for (let i = 0; i < n; i++) {
      const s0 = i / n, s1 = (i + 1) / n;
      quad(pt(s0, -1, 1), pt(s0, 1, 1), pt(s1, 1, 1), pt(s1, -1, 1), i === n - 1 ? edge : top);
      quad(pt(s0, -1, 0), pt(s0, -1, 1), pt(s1, -1, 1), pt(s1, -1, 0), side);
      quad(pt(s0, 1, 1), pt(s0, 1, 0), pt(s1, 1, 0), pt(s1, 1, 1), side);
    }
    quad(pt(1, -1, 1), pt(1, 1, 1), pt(1, 1, 0), pt(1, -1, 0), side);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new T.Mesh(g, S.rampMat); m.castShadow = m.receiveShadow = true; m.ramp = rp;
    return m;
  }

  /* ---------- The game ---------- */
  const ski = {
    get W() { if (!locked) { const wide = window.innerWidth > window.innerHeight; W = wide ? 640 : 450; H = wide ? 360 : 600; } return W; },
    get H() { return H; },
    color: 'var(--violet)', title: 'Endless Ski', label: 'Score',
    quietScore: true, // The score goes up every metre, so coins and jumps get their own sounds instead.
    intro: 'Ski down an endless 3D valley. Dodge the trees and rocks, grab coins and fly off kickers and rollers.',
    hint: '<kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd> to steer, and hold one in the air to spin. On a phone, hold the left or right side of the screen. <kbd>P</kbd> to pause',

    reset() {
      locked = true; // Keep the screen shape until the game is closed.
      ph = ph.map(() => rand(0, 6.3)); SEED = (Math.random() * 1e9) | 0;
      this.d = 0; this.x = center(0); this.vx = 0; this.v = 12;
      this.y = height(this.x, 0); this.vy = 0; this.air = false; this.airT = 0; this.spin = 0;
      this.chunks = []; this.nextChunk = -CL; this.nextRamp = 150;
      this.lastG = this.y;
      this.parts = []; this.sparks = []; this.pops = []; this.trail = []; this.trailD = -1;
      this.coins = 0; this.bonus = 0; this.score = 0; this.t = 0; this.crash = null; this.shake = 0; this.sndT = 0;
      this.left = this.right = this.touch = false; this.tx = W / 2;
      this.cam = null; this.lean = 0; this.crouch = 0.3; this.mult = 1; this.multT = 0; this.grab = '';
      this.gen();
      if (S) { S.tiles.forEach((t) => { t.chunk = null; t.visible = false; }); S.ramps.forEach((m) => { S.scene.remove(m); m.geometry.dispose(); }); S.ramps = []; S.built = ''; }
    },

    stop() { locked = false; },

    key(e, down) {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.left = down;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.right = down;
    },
    press(down) { this.touch = down; },
    point(p) { this.tx = p.x; },

    /* ----- The mountain ahead ----- */
    gen() {
      while (this.nextChunk < this.d + CL * (CHUNKS - 1)) { this.chunks.push(this.makeChunk(this.nextChunk)); this.nextChunk += CL; }
      while (this.chunks.length && this.chunks[0].d0 + CL < this.d - 25) this.chunks.shift();
    },
    makeChunk(d0) {
      const ch = { d0, trees: [], forest: [], rocks: [], coins: [], ramps: [] }, lv = level(d0);
      const put = (list, x, d, s) => list.push({ x, d, s, y: height(x, d), r: rand(0, 6.3), h: rand(0.9, 1.15) });
      // A kicker, with coins up in the air where the jump goes.
      if (d0 >= this.nextRamp) {
        const rd = d0 + rand(5, 40), ru = rand(-12, 12), rp = { x: center(rd) + ru, d: rd };
        ch.ramps.push(rp); this.nextRamp = rd + RAMP_EVERY * rand(0.8, 1.3);
        const v = cruise(rd);
        for (let s = 4; s < 44; s += 4) {
          const up = RAMP.h + (LIP + SLOPE) * s - ((G / 2) * s * s) / (v * v); // Height above the snow where the jump goes.
          if (up < 0.8) break;
          const dd = rd + RAMP.len + s, x = center(dd) + ru;
          ch.coins.push({ x, d: dd, y: height(x, dd) + up });
        }
      }
      const inLane = (x, d) => ch.ramps.some((rp) => Math.abs(x - rp.x) < 7 && d > rp.d - 8 && d < rp.d + 55);
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
          if (Math.random() < 0.7) { const m = 1 + ((Math.random() * 2.4) | 0); for (let q = 0; q < m; q++) put(ch.trees, x + rand(-2.2, 2.2), d + rand(-2.2, 2.2), rand(0.7, 1.25)); }
          else put(ch.rocks, x, d, rand(0.8, 1.8));
        }
        if (Math.random() < 0.55) {
          const ru = rand(-FLOOR + 4, FLOOR - 4), d = d0 + rand(0, CL - 30);
          for (let q = 0; q < 7; q++) { const dd = d + q * 4, x = center(dd) + ru; if (!inLane(x, dd)) ch.coins.push({ x, d: dd, y: height(x, dd) + 0.9 }); }
        }
      }
      return ch;
    },
    // The snow height under a point, kickers included.
    ground(x, d) {
      let y = height(x, d);
      for (const ch of this.chunks) {
        if (d < ch.d0 - RAMP.len || d > ch.d0 + CL + RAMP.len) continue;
        for (const rp of ch.ramps) if (d >= rp.d && d <= rp.d + RAMP.len && Math.abs(x - rp.x) < RAMP.w) y += rampLift((d - rp.d) / RAMP.len);
      }
      return y;
    },

    /* ----- Moving ----- */
    pop(text, sub, col) { this.pops.push({ text, sub, col, life: 1.8 }); },
    puff(n, x, y, d, speed, up, list = this.parts) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, 6.3), sp = rand(0.3, 1) * speed;
        list.push({ x, y, d, vx: Math.cos(a) * sp, vy: rand(0.5, 1) * up, vd: this.v * rand(0.4, 0.85) + Math.sin(a) * sp, life: rand(0.4, 1), max: 1 });
      }
    },
    hit(what) {
      this.crash = { t: 0, what, m: Math.floor(this.d), vx: this.vx };
      this.shake = 1; snd.crash();
      this.puff(60, this.x, this.y + 0.5, this.d, 5, 5);
    },

    update(dt) {
      this.t += dt;
      if (this.crash) {
        this.crash.t += dt; this.v *= Math.exp(-3 * dt); this.vx *= Math.exp(-3 * dt);
        this.d += this.v * dt; this.x += this.vx * dt;
        this.vy -= G * dt; this.y = Math.max(this.y + this.vy * dt, this.ground(this.x, this.d));
        this.moveBits(dt);
        if (this.crash.t > 1.4) {
          const msg = 'You hit ' + this.crash.what + ' after ' + this.crash.m + ' m';
          return over(this.score, msg + (this.coins ? ' and grabbed ' + this.coins + (this.coins === 1 ? ' coin.' : ' coins.') : '.'));
        }
        return;
      }
      let dir = (this.right ? 1 : 0) - (this.left ? 1 : 0);
      if (this.touch) dir = clamp((this.tx - W / 2) / 70, -1, 1);
      const u = this.x - center(this.d), wall = Math.max(0, Math.abs(u) - FLOOR), maxSide = 5 + 0.3 * this.v;

      // Speed creeps up the further you go. Climbing the valley side slows you and pushes you back down.
      if (!this.air) {
        const want = cruise(this.d) * (wall > 0 ? 0.75 : 1);
        this.v += (want - this.v) * Math.min(1, dt * (want > this.v ? 0.5 : 1.2));
        this.vx += (dir * maxSide - this.vx) * Math.min(1, dt * 5);
        this.vx -= Math.sign(u) * wall * 1.6 * dt;
      } else if (dir && this.airT > 0.2) this.spin += dir * 11 * dt; // Hold a direction in the air to spin.

      // The valley bends under you. You follow half of a bend by yourself and steer for the rest.
      const bend = (center(this.d + 1) - center(this.d - 1)) / 2;
      this.d += this.v * dt; this.x += (this.vx + bend * this.v * 0.5) * dt;

      // Stay on the snow, or fly when it drops away faster than gravity can pull you down.
      const g = this.ground(this.x, this.d), gv = (g - this.lastG) / dt; this.lastG = g;
      if (!this.air) {
        if (gv < this.vy - G * dt * 1.2) { this.air = true; this.airT = 0; this.grab = GRABS[(Math.random() * GRABS.length) | 0]; if (this.vy > 2) snd.jump(); }
        else { this.y = g; if (gv - this.vy < 40) this.vy = gv; } // A sudden step up (the side of a kicker) is not a launch.
      }
      if (this.air) {
        this.airT += dt; this.vy -= G * dt; this.y += this.vy * dt;
        if (this.y <= g) this.land(g, gv);
      }

      // Coins, trees and rocks near you.
      for (const ch of this.chunks) {
        if (ch.d0 > this.d + 3 || ch.d0 + CL < this.d - 3) continue;
        for (const c of ch.coins) {
          if (!c.got && Math.abs(c.d - this.d) < 1.2 && Math.abs(c.x - this.x) < 1.2 && Math.abs(c.y - this.y - 0.8) < 1.5) {
            c.got = true; this.coins++; snd.coin(); this.puff(14, c.x, c.y, c.d, 3, 3, this.sparks);
          }
        }
        for (const o of ch.forest) if (Math.abs(o.x - this.x) < 1.6 && Math.abs(o.d - this.d) < 0.6 * o.s + 0.3 && Math.abs(o.x - this.x) < 0.6 * o.s + 0.3) return this.hit('a tree');
        for (const o of ch.trees) if (Math.abs(o.d - this.d) < 0.7 * o.s + 0.3 && Math.abs(o.x - this.x) < 0.75 * o.s + 0.3 && this.y - o.y < 4.5 * o.s) return this.hit('a tree');
        for (const o of ch.rocks) if (Math.abs(o.d - this.d) < 0.6 * o.s + 0.3 && Math.abs(o.x - this.x) < 0.6 * o.s + 0.3 && this.y - o.y < 0.8 * o.s) return this.hit('a rock');
      }

      // Snow spray when carving hard or ploughing up the side.
      const carve = Math.abs(this.vx) / maxSide;
      if (!this.air && Math.random() < dt * (carve * 90 + wall * 6 + 6)) {
        const s = -Math.sign(this.vx || 1);
        this.parts.push({ x: this.x + rand(-0.2, 0.2), y: this.y + 0.05, d: this.d - 0.5, vx: s * rand(1, 5) * (0.5 + carve), vy: rand(1, 4) * (0.5 + carve), vd: this.v * rand(0.5, 0.85), life: rand(0.4, 0.9), max: 0.9 });
      }
      // Ski hiss and wind, louder the faster you go.
      this.sndT -= dt;
      if (this.sndT <= 0) {
        this.sndT = 0.1;
        if (!this.air) snd.hiss(0.18, 0.006 + carve * 0.02, 'bandpass', 1800 + this.v * 30);
        snd.hiss(0.18, 0.004 + this.v * 0.0005 + (this.air ? 0.01 : 0), 'lowpass', 300 + this.v * 12);
      }
      // Tracks in the snow.
      if (this.d - this.trailD > 0.5) {
        this.trailD = this.d;
        this.trail.unshift(this.air ? null : { x: this.x, d: this.d, h: Math.atan2(this.vx + bend * this.v * 0.5, this.v) });
        if (this.trail.length > TRACK) this.trail.pop();
      }

      if (this.multT > 0 && !this.air && (this.multT -= dt) <= 0) this.mult = 1;
      const sc = Math.floor(this.d) + this.coins * 10 + this.bonus;
      if (sc !== this.score) { this.score = sc; setScore(sc); }
      this.moveBits(dt);
      this.gen();
    },
    land(g, gv) {
      this.y = g; this.vy = gv; this.air = false;
      const t = this.airT;
      if (t > 0.25) { snd.land(); this.puff(26, this.x, g + 0.1, this.d, 3, 2.5); this.shake = Math.max(this.shake, Math.min(0.5, t * 0.3)); }
      // A spin only counts if you land facing down the hill again.
      const turns = this.spin / (Math.PI * 2), n = Math.round(turns), off = Math.abs(turns - n);
      if (Math.abs(this.spin) > 0.3 && off > 0.14) { this.v *= 0.6; this.mult = 1; this.multT = 0; this.pop('SKETCHY LANDING', 'SPEED LOST', '#ff6b9a'); snd.sketchy(); }
      else if (t > 0.55 || n !== 0) {
        // A trick: a grab for big air, plus the spin. Tricks in a row raise the multiplier.
        const pts = (Math.round(t * 100) + 200 * Math.abs(n)) * this.mult;
        const name = ((n ? Math.abs(n) * 360 + ' ' : '') + (t > 0.55 ? this.grab : '')).trim() || 'SPIN';
        this.bonus += pts; this.pop(name, '+' + pts + (this.mult > 1 ? '  (x' + this.mult + ')' : ''), '#ffd75e');
        snd.trick(); this.mult = Math.min(this.mult + 1, 5); this.multT = 7;
      }
      this.spin = 0; this.airT = 0;
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
        s.trees.count = n; s.rocks.count = r; s.forest.count = f; s.trees.instanceMatrix.needsUpdate = s.rocks.instanceMatrix.needsUpdate = s.forest.instanceMatrix.needsUpdate = true;
        const all = this.chunks.flatMap((c) => c.ramps);
        s.ramps = s.ramps.filter((mesh) => { if (all.includes(mesh.ramp)) return true; scene.remove(mesh); mesh.geometry.dispose(); return false; });
        for (const rp of all) if (!s.ramps.some((mesh) => mesh.ramp === rp)) { const mesh = rampMesh(rp); scene.add(mesh); s.ramps.push(mesh); }
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

      // The skier.
      const sk = s.skier, heading = Math.atan2(this.vx, this.v);
      sk.root.position.set(this.x, this.y, -this.d);
      sk.root.rotation.set(0, -heading - this.spin, 0);
      sk.lean.rotation.set(0, 0, -this.lean * 0.45);
      if (this.crash) {
        const t = Math.min(this.crash.t * 1.5, 1);
        sk.lean.rotation.set(-t * 1.4, 0, (this.crash.vx >= 0 ? -1 : 1) * t * 1.2);
        sk.root.position.y += Math.sin(t * Math.PI) * 0.8;
      }
      const big = this.air && this.airT > 0.3;
      poseSkier(sk, this.crouch, big && !!this.spin, big && !this.spin ? (GRABS.indexOf(this.grab) % 2 ? 1 : -1) : 0);
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
          const fall = (this.t * (1.2 + hash(j, 4)) + hash(j, 5) * 30) % 30;
          const ahead = (((hash(j, 3) * 70 - this.d - this.t * 2) % 70) + 70) % 70;
          P[j * 3] = c.x + hash(j, 1) * 60 - 30 + Math.sin(this.t * 0.7 + j) * 0.6;
          P[j * 3 + 1] = c.y + hash(j, 2) * 30 + 7 - fall - ahead * SLOPE;
          P[j * 3 + 2] = -(c.d + ahead - 4);
        }
        s.flakes.geometry.attributes.position.needsUpdate = true;
        s.flakes.material.opacity = 0.8 - night * 0.3;
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
      // Score and coins top left, the trick multiplier top right, speed big at the bottom.
      text('SCORE', 14, 12, 7, '#f4f6fb', 'left');
      text(this.score.toLocaleString('en-US'), 14, 24, 16, '#ffffff', 'left');
      const g = ctx.createRadialGradient(19, 52, 1, 22, 55, 7);
      g.addColorStop(0, '#fff3a8'); g.addColorStop(0.6, '#ffc531'); g.addColorStop(1, '#b97a0c');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(21, 55, 7, 0, 7); ctx.fill();
      text(String(this.coins), 33, 51, 9, '#ffd75e', 'left');
      text('x' + this.mult, W - 14, 14, 16, this.mult > 1 ? '#ffd75e' : '#ffffff', 'right');
      if (this.mult > 1) { ctx.fillStyle = 'rgba(255,215,94,0.9)'; ctx.fillRect(W - 14 - 46 * (this.multT / 7), 36, 46 * (this.multT / 7), 3); }
      text(String(Math.round(this.v * 3.6)), W / 2, H - 50, 24, '#ffd23f', 'center');
      text('KM/H', W / 2, H - 20, 7, '#f4f6fb', 'center');
      if (this.air && this.airT > 0.35 && !this.crash) text('AIR ' + this.airT.toFixed(1) + 's', W / 2, H * 0.3, 10, '#ffffff', 'center');
      this.pops.forEach((p, i) => {
        ctx.globalAlpha = clamp(p.life * 2, 0, 1);
        const y = H * 0.12 + i * 40 - (1.8 - p.life) * 10;
        text(p.text, W / 2, y, 14, '#ffffff', 'center');
        text(p.sub, W / 2, y + 20, 9, p.col, 'center');
        ctx.globalAlpha = 1;
      });
      if (this.t < 4 && !this.crash) {
        ctx.globalAlpha = clamp(4 - this.t, 0, 1);
        text('<  STEER  >', W / 2, H - 82, 11, '#ffffff', 'center');
        ctx.globalAlpha = 1;
      }
      ctx.textBaseline = 'alphabetic';
    },
  };

  import(THREE_URL).then((m) => { T = m; }).catch(() => { failed = true; });
  Arcade.register('ski', ski);
})();
