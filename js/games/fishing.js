/* Fishing. Loaded on demand by js/arcade.js the first time the game is opened.
   A side view of a lake. The fisher stands on a dock on the left.
   Hold to swing the rod back, let go to cast (longer hold = further). The hook sinks
   until you tap again, so you choose how deep to fish. Deeper water has bigger and rarer fish.
   Fish come and nibble; when the float is pulled under, press fast to hook the fish.
   Then reel: holding pulls the fish in but tightens the line. Keep the tension in the green.
   Too tight for too long and the line snaps; too slack and the fish shakes the hook.
   A round lasts 60 seconds, from morning to sunset. A fish already on the line can still be landed. */
(() => {
  const { ctx, C, rand, clamp, font, sfx, setScore, over } = Arcade;

  const W = 400, H = 560;
  const SURF = 182;          // Water surface.
  const BOTTOM = 516;        // Lake bottom (top of the sand).
  const DOCK = 96;           // Right edge of the dock.
  const DECK = 160;          // Top of the dock planks.
  const ROUND = 60;          // Seconds in a round.
  const LAND = { x: DOCK + 14, y: SURF + 12 }; // Where a reeled-in fish is lifted out.
  const HANDS = { x: 70, y: 128 };             // Where the fisher holds the rod.

  /* ---------- The fish ----------
     pts: points for an average one. len, ht: size in pixels. depth: the band they swim in.
     speed: swimming speed. see: how far away they notice the hook. pull: how hard they fight.
     zone: how wide the green part of the tension bar is. bite: seconds you have to hook them.
     runs: how often they make a run for it. reel: how fast they come in. cm: real size range.
     weight: how often they turn up. */
  const KINDS = {
    minnow: { name: 'Minnow', pts: 10, len: 16, ht: 6, depth: [196, 300], speed: 55, see: 90, pull: 0.3, zone: 0.46, bite: 0.8, runs: 0.25, reel: 220, cm: [5, 9], weight: 24,
      body: '#c3cfdc', back: '#7c90aa', belly: '#f2f6fa', fin: '#9fb0c8' },
    perch: { name: 'Perch', pts: 25, len: 24, ht: 11, depth: [200, 350], speed: 45, see: 95, pull: 0.45, zone: 0.42, bite: 0.7, runs: 0.35, reel: 195, cm: [15, 28], weight: 22,
      body: '#c9c24c', back: '#6c7a2a', belly: '#f2ebb4', fin: '#ff7a4a', stripes: '#4e5a22' },
    trout: { name: 'Trout', pts: 50, len: 32, ht: 11, depth: [260, 420], speed: 50, see: 100, pull: 0.6, zone: 0.38, bite: 0.6, runs: 0.45, reel: 170, cm: [25, 45], weight: 18,
      body: '#b2bfa6', back: '#5a7858', belly: '#f6ebe0', fin: '#8aa086', band: '#ff9db0', spots: '#2f3f2e' },
    salmon: { name: 'Salmon', pts: 80, len: 40, ht: 13, depth: [300, 460], speed: 60, see: 110, pull: 0.75, zone: 0.34, bite: 0.55, runs: 0.55, reel: 160, cm: [50, 80], weight: 12,
      body: '#d9dfe8', back: '#4c6a8a', belly: '#fcf4f0', fin: '#e58a8a', spots: '#33465c' },
    pike: { name: 'Pike', pts: 120, len: 54, ht: 11, depth: [240, 440], speed: 72, see: 130, pull: 0.95, zone: 0.3, bite: 0.5, runs: 0.65, reel: 135, cm: [60, 110], weight: 9,
      body: '#86a85c', back: '#3e5c2c', belly: '#ecebbc', fin: '#c07a32', blotch: '#d8e39a' },
    catfish: { name: 'Catfish', pts: 150, len: 50, ht: 15, depth: [450, 504], speed: 28, see: 95, pull: 1.0, zone: 0.32, bite: 0.7, runs: 0.5, reel: 115, cm: [60, 120], weight: 8,
      body: '#6e5c4b', back: '#3b3128', belly: '#cdbb9c', fin: '#544538', whiskers: true },
    gold: { name: 'Golden Fish', pts: 400, len: 26, ht: 12, depth: [230, 440], speed: 88, see: 120, pull: 0.9, zone: 0.26, bite: 0.42, runs: 0.75, reel: 145, cm: [20, 30], weight: 2.6,
      body: '#ffd23f', back: '#ffa62e', belly: '#fff3b8', fin: '#ff7a2a', shiny: true },
    shark: { name: 'Lake Shark', pts: 1000, len: 96, ht: 26, depth: [430, 488], speed: 50, see: 150, pull: 1.25, zone: 0.24, bite: 0.45, runs: 0.8, reel: 95, cm: [180, 260], weight: 1.3,
      body: '#8a99ab', back: '#566476', belly: '#eaeff3', fin: '#566476', shark: true },
    boot: { name: 'Old Boot', pts: 0, len: 26, ht: 22, pull: 0.15, zone: 0.5, bite: 1.4, runs: 0, reel: 200, cm: [27, 31] },
  };
  const SPECIES = ['minnow', 'perch', 'trout', 'salmon', 'pike', 'catfish', 'gold', 'shark'];
  const LO = 0.3; // Below this on the tension bar the line is slack.

  /* ---------- Fish book: which fish this player has ever caught ---------- */
  const book = {
    load() { try { return JSON.parse(localStorage.getItem('arcade:fishbook') || '[]'); } catch (e) { return []; } },
    add(kind) {
      const seen = this.load(); if (seen.includes(kind)) return false;
      seen.push(kind); try { localStorage.setItem('arcade:fishbook', JSON.stringify(seen)); } catch (e) {}
      return true;
    },
  };

  /* ---------- Colors ---------- */
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, f) => { const x = hex(a), y = hex(b); return 'rgb(' + x.map((v, i) => Math.round(v + (y[i] - v) * f)).join(',') + ')'; };
  // Morning -> sunset. The round's clock moves the whole scene from one to the other.
  const SKY = { top: ['#4fa9ea', '#2e2f78'], low: ['#cdeeff', '#ff8a5c'], sun: ['#fff4b0', '#ffb347'],
    hill: ['#7fb38a', '#7a5a8e'], hill2: ['#4f8f5a', '#4a3a6a'], tree: ['#2f6b45', '#2f2550'],
    water: ['#3497c9', '#56508e'], deep: ['#0e3450', '#120f2e'], cloud: ['#ffffff', '#ffc9b0'] };
  const sky = (k, f) => mix(SKY[k][0], SKY[k][1], f);

  /* ---------- Sound ---------- */
  const snd = {
    noise: null,
    ready() { return sfx.on && sfx.ac && sfx.ac.state === 'running'; },
    out(vol, when, dur) {
      const g = sfx.ac.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(vol, when + Math.min(0.02, dur / 3));
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      g.connect(sfx.ac.destination);
      return g;
    },
    note(f, dur, type, vol, delay, to) {
      if (!this.ready()) return;
      try {
        const t = sfx.ac.currentTime + (delay || 0), o = sfx.ac.createOscillator();
        o.type = type; o.frequency.setValueAtTime(f, t);
        if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
        o.connect(this.out(vol, t, dur)); o.start(t); o.stop(t + dur + 0.02);
      } catch (e) {}
    },
    hiss(dur, vol, kind, f, to, delay) {
      if (!this.ready()) return;
      try {
        const ac = sfx.ac, t = ac.currentTime + (delay || 0);
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
    cast() { this.hiss(0.32, 0.06, 'bandpass', 500, 2600); },
    plop() { this.hiss(0.2, 0.09, 'lowpass', 1100, 180); this.note(340, 0.12, 'sine', 0.08, 0, 110); },
    nibble() { this.note(1300, 0.04, 'triangle', 0.04); },
    bite() { this.note(880, 0.07, 'square', 0.045); this.note(1320, 0.12, 'square', 0.045, 0.07); this.hiss(0.15, 0.05, 'lowpass', 900, 200); },
    hook() { this.note(200, 0.16, 'square', 0.06, 0, 70); this.hiss(0.2, 0.07, 'bandpass', 900, 300); },
    click() { this.note(2600, 0.012, 'square', 0.012); },
    splash() { this.hiss(0.25, 0.06, 'bandpass', 1400, 400); },
    snap() { this.note(700, 0.35, 'sawtooth', 0.05, 0, 60); this.hiss(0.12, 0.08, 'highpass', 3000); },
    lost() { this.note(392, 0.16, 'triangle', 0.06); this.note(311, 0.3, 'triangle', 0.06, 0.16); },
    tick() { this.note(1000, 0.05, 'square', 0.03); },
    tooSoon() { this.note(260, 0.12, 'square', 0.04, 0, 180); },
    catchJingle(kind) {
      this.hiss(0.3, 0.08, 'bandpass', 1600, 300);
      const notes = kind === 'boot' ? [392, 330, 262] : kind === 'shark' ? [523, 659, 784, 1047, 1319, 1568] : kind === 'gold' ? [1047, 1319, 1568, 2093, 1568, 2093] : [659, 784, 1047];
      const type = kind === 'boot' ? 'triangle' : 'square';
      notes.forEach((f, i) => this.note(f, 0.13, type, 0.04, 0.1 + i * 0.09));
    },
  };

  /* ---------- Drawing helpers ---------- */
  function ellipse(x, y, rx, ry, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); }
  function poly(color, pts) { ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath(); ctx.fill(); }
  function text(str, x, y, px, color, align = 'center', shadow = true) {
    ctx.font = font(px); ctx.textAlign = align; ctx.textBaseline = 'middle';
    if (shadow) { ctx.fillStyle = 'rgba(13,10,21,.75)'; ctx.fillText(str, x + 2, y + 2); }
    ctx.fillStyle = color; ctx.fillText(str, x, y);
  }

  // A fish facing right at (0, 0), drawn in the current transform. t wags the tail.
  function paintFish(kind, t) {
    const k = KINDS[kind];
    if (kind === 'boot') return paintBoot();
    const L = k.len, h = k.ht, wag = Math.sin(t * 12) * h * 0.18;
    // Tail.
    if (k.shark) poly(k.fin, [-L / 2 + 4, 0, -L / 2 - L * 0.22, -h * 0.95 + wag, -L / 2 - L * 0.12, wag * 0.5, -L / 2 - L * 0.18, h * 0.55 + wag]);
    else poly(k.fin, [-L / 2 + 3, 0, -L / 2 - L * 0.26, -h * 0.62 + wag, -L / 2 - L * 0.18, wag * 0.4, -L / 2 - L * 0.26, h * 0.62 + wag]);
    // Fins on top and bottom.
    if (k.shark) {
      poly(k.fin, [-L * 0.08, -h * 0.4, L * 0.04, -h * 1.15, L * 0.14, -h * 0.4]);
      poly(k.fin, [L * 0.06, h * 0.3, -L * 0.04, h * 0.85, L * 0.16, h * 0.35]);
    } else if (kind === 'pike') {
      poly(k.fin, [-L * 0.36, -h * 0.35, -L * 0.3, -h * 0.85, -L * 0.18, -h * 0.4]);
      poly(k.fin, [-L * 0.36, h * 0.35, -L * 0.3, h * 0.8, -L * 0.2, h * 0.4]);
    } else {
      poly(k.fin, [-L * 0.2, -h * 0.38, -L * 0.02, -h * 0.95, L * 0.14, -h * 0.4]);
      poly(k.fin, [-L * 0.16, h * 0.38, -L * 0.06, h * 0.75, L * 0.04, h * 0.4]);
    }
    // Body, with a darker back and a light belly.
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, 0, L / 2, h / 2, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = k.body; ctx.fillRect(-L / 2, -h / 2, L, h);
    ctx.fillStyle = k.back; ctx.fillRect(-L / 2, -h / 2, L, h * 0.32);
    ctx.fillStyle = k.belly; ctx.fillRect(-L / 2, h * 0.16, L, h * 0.4);
    if (k.stripes) { ctx.fillStyle = k.stripes; for (let i = -2; i <= 2; i++) ctx.fillRect(i * L * 0.16 - 1.5, -h / 2, 3, h * 0.62); }
    if (k.band) { ctx.fillStyle = k.band; ctx.fillRect(-L / 2, -h * 0.06, L, h * 0.16); }
    if (k.spots) { ctx.fillStyle = k.spots; for (let i = 0; i < 9; i++) ctx.fillRect(-L * 0.4 + ((i * 37) % 10) / 10 * L * 0.75, -h * 0.42 + ((i * 53) % 7) / 7 * h * 0.5, 2, 2); }
    if (k.blotch) { ctx.fillStyle = k.blotch; for (let i = 0; i < 10; i++) ctx.fillRect(-L * 0.42 + (i % 5) * L * 0.17 + (i > 4 ? L * 0.08 : 0), -h * 0.28 + (i > 4 ? h * 0.3 : 0), 4, 2); }
    if (k.shiny) { ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(-L * 0.1 + Math.sin(t * 3) * L * 0.25, -h * 0.35, 4, h * 0.4); }
    if (k.shark) { ctx.fillStyle = k.back; for (let i = 0; i < 3; i++) ctx.fillRect(L * 0.22 + i * 4, -h * 0.15, 1.5, h * 0.35); }
    ctx.restore();
    // Side fin, eye and mouth.
    poly(k.fin, [L * 0.14, h * 0.08, L * 0.02, h * 0.3, L * 0.18, h * 0.24]);
    const er = Math.max(1.6, h * 0.13), ex = L / 2 - Math.max(4, h * 0.42), ey = -h * 0.1;
    ellipse(ex, ey, er + 0.8, er + 0.8, '#ffffff');
    ellipse(ex + er * 0.3, ey, er * 0.6, er * 0.6, '#0d0a15');
    ctx.fillStyle = 'rgba(13,10,21,.6)'; ctx.fillRect(L / 2 - 4, h * 0.08, 4, 1);
    if (k.whiskers) {
      ctx.strokeStyle = k.back; ctx.lineWidth = 1.2; ctx.beginPath();
      ctx.moveTo(L / 2 - 2, h * 0.05); ctx.quadraticCurveTo(L / 2 + 8, h * 0.1, L / 2 + 10, h * 0.55 + Math.sin(t * 4) * 2);
      ctx.moveTo(L / 2 - 3, h * 0.12); ctx.quadraticCurveTo(L / 2 + 4, h * 0.3, L / 2 + 4, h * 0.8 + Math.sin(t * 4 + 1) * 2);
      ctx.stroke();
    }
  }
  function paintBoot() {
    // Toe points right. Brown leather, worn sole, a lace and a bit of weed.
    poly('#6b4a2f', [-10, -11, 2, -11, 2, 2, 13, 3, 14, 10, -10, 10]);
    ctx.fillStyle = '#3b2a1c'; ctx.fillRect(-11, 8, 26, 3);
    ctx.fillStyle = '#8a6440'; ctx.fillRect(-10, -11, 12, 3);
    ctx.fillStyle = '#e8dcc0'; ctx.fillRect(-6, -6, 6, 1); ctx.fillRect(-6, -2, 6, 1);
    ctx.fillStyle = '#4f8f5a'; ctx.fillRect(-12, -9, 3, 7); ctx.fillRect(-14, -5, 3, 2);
  }

  /* ---------- The game ---------- */
  const fishing = {
    W, H, color: 'var(--cyan)', title: 'Fishing', label: 'Points', quietScore: true,
    intro: 'Cast your line, wait for a bite and reel in rare fish before the sun sets. Don\'t snap the line!',
    hint: 'Hold <kbd>Space</kbd> (or touch) to cast, tap to hook, hold to reel. <kbd>P</kbd> to pause',

    reset() {
      this.t = 0;              // Seconds since the round started (also drives animations).
      this.left = ROUND;       // Seconds left.
      this.score = 0; this.count = 0;
      this.caught = {};        // How many of each kind this round.
      this.best = null;        // Biggest catch by points.
      this.state = 'aim';      // aim, charge, fly, sink, wait, fight, lift, show, lost, done.
      this.held = false;
      this.charge = 0; this.chargeT = 0;
      this.lure = null;        // { bx, by: float; hx, hy: hook; tx: landing x; ft: flight time }.
      this.eng = null;         // The fish that is interested in, nibbling or hooked on the line.
      this.fish = [];
      this.bootPos = { x: rand(170, 360), y: BOTTOM - 6 }; this.bootT = 0;
      this.parts = []; this.ripples = []; this.bubbles = [];
      this.msg = null;         // Big message in the middle: { a, b, color, life }.
      this.shake = 0; this.flash = 0;
      this.ticked = 0; this.clicks = 0;
      this.firstCast = true;
      this.clouds = [0, 1, 2, 3].map((i) => ({ x: rand(0, W), y: 26 + i * 22 + rand(-6, 6), s: rand(0.7, 1.3), v: rand(4, 9) }));
      for (let i = 0; i < 9; i++) this.spawn(rand(DOCK + 40, W - 20));
      setScore(0);
    },

    /* ---------- Fish coming and going ---------- */
    spawn(x) {
      let total = 0; for (const s of SPECIES) total += KINDS[s].weight;
      let r = rand(0, total), kind = SPECIES[0];
      for (const s of SPECIES) { r -= KINDS[s].weight; if (r <= 0) { kind = s; break; } }
      // Only one shark at a time, and it is a big lake but not that big.
      if (kind === 'shark' && this.fish.some((f) => f.kind === 'shark')) kind = 'catfish';
      const k = KINDS[kind], size = rand(0.85, 1.2);
      const f = {
        kind, size,
        x: x ?? W + 30 + k.len, y: rand(k.depth[0], k.depth[1]),
        dir: x === undefined ? -1 : (Math.random() < 0.5 ? -1 : 1),
        spd: k.speed * rand(0.8, 1.15), ty: 0, retarget: 0, wob: rand(0, 6),
        state: 'swim', cool: 0, nib: 0, nibT: 0, biteT: 0,
      };
      f.ty = f.y;
      this.fish.push(f);
    },
    mouth(f) { const k = KINDS[f.kind]; return { x: f.x + f.dir * k.len * f.size / 2, y: f.y + k.ht * f.size * 0.08 }; },

    /* ---------- Input ---------- */
    key(e, down) {
      if (!['Space', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.code)) return;
      if (down && e.repeat) return;
      this.input(down);
    },
    press(down) { this.input(down); },
    input(down) {
      if (down === this.held) return;
      this.held = down;
      if (down) this.onPress(); else this.onRelease();
    },
    onPress() {
      const s = this.state;
      if (s === 'aim') { this.state = 'charge'; this.charge = 0; this.chargeT = 0; }
      else if (s === 'sink') { this.state = 'wait'; this.lure.stopped = true; snd.nibble(); }
      else if (s === 'wait') {
        const f = this.eng;
        if (f && f.state === 'bite') this.hook(f);
        else if (f && f.state === 'nibble') {
          this.say('Too soon!', 'Wait for the float to go under', C.amber, 1.1);
          snd.tooSoon(); this.scare(f);
        }
      } else if (s === 'show' && this.showT > 0.5) this.next();
    },
    onRelease() {
      if (this.state === 'charge') this.cast();
    },

    /* ---------- Casting ---------- */
    cast() {
      const p = this.charge;
      this.state = 'fly';
      const tip = this.tip();
      this.lure = { x: tip.x, y: tip.y, sx: tip.x, sy: tip.y, tx: DOCK + 44 + p * (W - DOCK - 70), ft: 0, dur: 0.45 + p * 0.3, hx: 0, hy: 0, stopped: false };
      this.firstCast = false;
      snd.cast();
    },
    splashAt(x, y, n, big) {
      for (let i = 0; i < n; i++) this.parts.push({ x, y, vx: rand(-60, 60) * (big ? 1.6 : 1), vy: rand(-160, -60) * (big ? 1.4 : 1), life: rand(0.4, 0.8), c: Math.random() < 0.5 ? '#ffffff' : '#bfe8ff', s: 2 });
      this.ripples.push({ x, r: 2, life: 1 });
    },

    /* ---------- Bites, hooking and fighting ---------- */
    scare(f) {
      f.state = 'flee'; f.dir = f.x < this.lure.hx ? -1 : 1; if (f.x < DOCK + 60) f.dir = 1;
      f.fleeT = 1.2; f.cool = 5;
      if (this.eng === f) this.eng = null;
    },
    hook(f) {
      const k = KINDS[f.kind];
      this.perfect = f.biteT > k.bite * 0.55; // Pressed in the first part of the bite.
      this.eng = f; f.state = 'hooked';
      this.state = 'fight';
      this.tension = 0.45; this.redT = 0; this.slackT = 0;
      this.stam = 1; this.run = 0; this.runT = 0; this.fightT = 0;
      this.splashAt(this.lure.bx, SURF, 10, false);
      this.shake = 0.15;
      snd.hook();
      if (this.perfect) this.say('PERFECT HOOK!', '', C.lime, 0.9);
    },
    // Zones of the tension bar for this fish: slack below LO, green up to hi, red above.
    hi() { return LO + KINDS[this.eng.kind].zone; },
    fight(dt) {
      const f = this.eng, k = KINDS[f.kind];
      this.fightT += dt;
      // The fish makes runs for it, less often as it tires.
      if (this.run > 0) {
        this.run -= dt;
        if (this.run <= 0) { this.stam = Math.max(0.3, this.stam - 0.12); }
      } else if (k.runs && this.fightT > 0.6 && Math.random() < k.runs * (0.35 + 0.65 * this.stam) * dt) {
        this.run = rand(0.5, 1.2) * (0.6 + this.stam * 0.4);
        snd.splash();
        if (f.y < SURF + 60) this.splashAt(f.x, SURF, 6, false);
      }
      this.stam = Math.max(0.3, this.stam - dt * 0.03);
      const running = this.run > 0 ? 1 : 0, pull = k.pull * (0.55 + 0.45 * this.stam);
      // Holding winds the reel: the line gets tighter. Letting go gives the fish line.
      const wob = Math.sin(this.t * 7.3 + f.wob) * 0.12 * k.pull;
      this.tension += ((this.held ? 0.75 + running * pull * 1.2 : -0.8 + running * pull * 0.5) + wob) * dt;
      this.tension = clamp(this.tension, 0, 1);
      const hi = this.hi();
      if (this.tension > hi) {
        this.redT += dt * (1 + (this.tension - hi) * 4) * (this.tension >= 1 ? 2 : 1);
        this.slackT = Math.max(0, this.slackT - dt);
      } else if (this.tension < LO) {
        this.slackT += dt;
        this.redT = Math.max(0, this.redT - dt);
      } else {
        this.redT = Math.max(0, this.redT - dt * 0.7);
        this.slackT = Math.max(0, this.slackT - dt * 0.7);
      }
      if (this.redT > 0.9) return this.lose('snap');
      if (this.slackT > 2.2) return this.lose('slack');

      // Where the fish goes: towards the dock while you reel, away while it runs.
      const dx = LAND.x - f.x, dy = LAND.y - f.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      let move = 0;
      if (this.held && this.tension >= LO) move += k.reel * (this.tension > hi ? 0.8 : 1);
      if (running) move -= k.speed * 1.1 * (0.5 + 0.5 * this.stam) * (this.held ? 0.35 : 1);
      else if (!this.held) move -= 6;
      f.x += ux * move * dt + Math.sin(this.t * 3 + f.wob) * 18 * dt * (running ? 2 : 1);
      f.y += uy * move * dt + Math.cos(this.t * 2.3 + f.wob) * 10 * dt + (running ? 20 * dt : 0);
      f.x = clamp(f.x, LAND.x, W - 14); f.y = clamp(f.y, SURF + 10, BOTTOM - 8);
      f.dir = running ? 1 : -1;
      if (this.held && this.tension >= LO) {
        this.clicks += dt * 16;
        if (this.clicks >= 1) { this.clicks -= 1; snd.click(); }
      }
      if (Math.random() < dt * (2 + running * 8)) this.bubbles.push({ x: f.x, y: f.y, r: rand(1, 2.5), life: 2 });
      if (Math.hypot(f.x - LAND.x, f.y - LAND.y) < 16) this.land();
    },
    lose(why) {
      const f = this.eng;
      if (why === 'snap') { this.say('SNAP!', 'The line was too tight', C.pink, 1.4); snd.snap(); this.shake = 0.3; }
      else { this.say('It got away!', 'Don\'t let the line go slack', C.amber, 1.4); snd.lost(); }
      if (f.kind === 'boot') this.bootPos = null;
      else { f.state = 'flee'; f.dir = 1; f.fleeT = 2; f.cool = 8; }
      this.eng = null; this.lure = null;
      this.state = 'lost'; this.lostT = 1.4;
    },
    land() {
      const f = this.eng, k = KINDS[f.kind];
      this.fish = this.fish.filter((o) => o !== f);
      if (f.kind === 'boot') { this.bootPos = null; this.bootT = 0; }
      const cm = Math.round(k.cm[0] + (k.cm[1] - k.cm[0]) * (f.size - 0.85) / 0.35);
      const pts = Math.round(k.pts * f.size * (this.perfect ? 1.25 : 1));
      this.landed = { kind: f.kind, cm, pts, perfect: this.perfect && pts > 0, fresh: f.kind !== 'boot' && book.add(f.kind), x: f.x, y: f.y, size: f.size };
      this.score += pts; setScore(this.score);
      if (f.kind !== 'boot') {
        this.count++; this.caught[f.kind] = (this.caught[f.kind] || 0) + 1;
        if (!this.best || pts > this.best.pts) this.best = this.landed;
      }
      this.splashAt(f.x, SURF, 16, true);
      if (f.kind === 'gold' || f.kind === 'shark') this.flash = 0.35;
      snd.catchJingle(f.kind);
      this.eng = null; this.lure = null;
      this.state = 'lift'; this.liftT = 0;
    },
    next() {
      if (this.left <= 0) return this.finish();
      this.state = 'aim'; this.landed = null;
    },
    finish() {
      if (this.state === 'done') return;
      this.state = 'done';
      const names = SPECIES.filter((s) => this.caught[s]).map((s) => this.caught[s] + ' ' + KINDS[s].name.toLowerCase());
      const found = book.load().length;
      let msg;
      if (!this.count) msg = 'No fish this time. Wait for the float to go under, then press!';
      else msg = 'You caught ' + this.count + ' fish (' + names.join(', ') + ') for ' + this.score + ' points. Biggest: ' + KINDS[this.best.kind].name + ', ' + this.best.cm + ' cm.';
      msg += ' Fish book: ' + found + ' of 8 found.';
      over(this.score, msg, 'Sunset!');
    },
    say(a, b, color, life) { this.msg = { a, b, color, life, max: life }; },

    /* ---------- Update ---------- */
    update(dt) {
      this.t += dt;
      const busy = ['fight', 'lift', 'show', 'lost'].includes(this.state);
      if (this.left > 0) {
        this.left = Math.max(0, this.left - dt);
        if (this.left <= 10 && Math.ceil(this.left) !== this.ticked) { this.ticked = Math.ceil(this.left); if (this.left > 0) snd.tick(); }
        if (this.left === 0 && busy) this.say('Last fish!', 'Land it before dark', C.amber, 1.5);
      }
      if (this.left <= 0 && !busy) return this.finish();

      // Clouds, splashes, ripples and bubbles.
      for (const c of this.clouds) { c.x += c.v * dt; if (c.x > W + 60) { c.x = -70; c.y = rand(20, 100); } }
      for (const p of this.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 420 * dt; p.life -= dt; }
      this.parts = this.parts.filter((p) => p.life > 0 && !(p.y > SURF + 4 && p.vy > 0 && p.c !== '#fff4b0'));
      for (const r of this.ripples) { r.r += 26 * dt; r.life -= dt * 0.9; }
      this.ripples = this.ripples.filter((r) => r.life > 0);
      if (Math.random() < dt * 1.2) this.bubbles.push({ x: rand(DOCK + 10, W), y: BOTTOM - 4, r: rand(1, 2), life: 4 });
      for (const b of this.bubbles) { b.y -= 34 * dt; b.x += Math.sin(this.t * 4 + b.r * 9) * 8 * dt; b.life -= dt; }
      this.bubbles = this.bubbles.filter((b) => b.life > 0 && b.y > SURF + 2);
      if (this.msg) { this.msg.life -= dt; if (this.msg.life <= 0) this.msg = null; }
      this.shake = Math.max(0, this.shake - dt); this.flash = Math.max(0, this.flash - dt);
      for (const f of this.fish) if (f.kind === 'gold' && Math.random() < dt * 4) this.parts.push({ x: f.x + rand(-10, 10), y: f.y + rand(-6, 6), vx: 0, vy: -10, life: 0.6, c: '#fff4b0', s: 2, star: true });

      const s = this.state, L = this.lure;
      if (s === 'charge') {
        // The power swings up and down while you hold, so you have to let go at the right time.
        this.chargeT += dt; this.charge = 1 - Math.abs(1 - (this.chargeT * 0.9) % 2);
      } else if (s === 'fly') {
        L.ft += dt; const p = Math.min(1, L.ft / L.dur);
        L.x = L.sx + (L.tx - L.sx) * p; L.y = L.sy + (SURF - L.sy) * p - Math.sin(p * Math.PI) * (50 + (L.tx - L.sx) * 0.25);
        if (p >= 1) {
          this.state = 'sink'; this.waitT = 0; L.bx = L.tx; L.by = SURF; L.hx = L.tx; L.hy = SURF + 4; L.dip = 0;
          this.splashAt(L.tx, SURF, 8, false); snd.plop();
        }
      } else if (s === 'sink') {
        L.hy += 115 * dt;
        if (L.hy >= BOTTOM - 8) { L.hy = BOTTOM - 8; this.state = 'wait'; }
      } else if (s === 'wait') {
        // Holding winds the line in and drags the hook back towards the dock.
        if (this.held && !(this.eng && this.eng.state === 'bite')) {
          L.bx -= 70 * dt; L.hx += (L.bx - L.hx) * Math.min(1, dt * 3); L.hy = Math.max(SURF + 8, L.hy - 26 * dt);
          this.clicks += dt * 14; if (this.clicks >= 1) { this.clicks -= 1; snd.click(); }
          if (L.bx < DOCK + 12) { this.lure = null; this.eng = null; this.state = 'aim'; if (this.held) { this.state = 'charge'; this.charge = 0; this.chargeT = 0; } }
        }
        this.waitT += dt;
        this.boot(dt);
      } else if (s === 'fight') this.fight(dt);
      else if (s === 'lift') { this.liftT += dt; if (this.liftT > 0.5) { this.state = 'show'; this.showT = 0; } }
      else if (s === 'show') { this.showT += dt; if (this.showT > 1.9) this.next(); }
      else if (s === 'lost') { this.lostT -= dt; if (this.lostT <= 0) this.next(); }
      if (this.lure && this.lure.dip !== undefined) this.lure.dip = Math.max(0, this.lure.dip - dt * 30);

      this.swim(dt);
    },
    // The old boot lies on the bottom. Leave the hook next to it and you snag it.
    boot(dt) {
      const L = this.lure, b = this.bootPos;
      if (!L || !b || this.eng || this.held) { this.bootT = 0; return; }
      if (Math.abs(L.hx - b.x) < 20 && L.hy > BOTTOM - 26) {
        this.bootT += dt;
        if (this.bootT > 1.4) {
          const f = { kind: 'boot', size: 1, x: b.x, y: b.y, dir: -1, spd: 0, wob: 0, state: 'bite', biteT: KINDS.boot.bite, boot: true };
          this.eng = f; L.dip = 9; snd.bite(); this.bootT = 0;
        }
      } else this.bootT = 0;
    },
    swim(dt) {
      const L = this.lure, fishable = this.state === 'wait' && L;
      for (const f of this.fish) {
        const k = KINDS[f.kind];
        f.cool = Math.max(0, f.cool - dt);
        if (f.state === 'swim') {
          f.x += f.dir * f.spd * dt;
          f.retarget -= dt;
          if (f.retarget <= 0) { f.ty = rand(k.depth[0], k.depth[1]); f.retarget = rand(2, 5); }
          f.y += (f.ty - f.y) * dt * 0.5 + Math.sin(this.t * 2 + f.wob) * 6 * dt;
          if (f.x < DOCK + 30 && f.dir < 0) f.dir = 1;
          if (Math.random() < dt * 0.08) f.dir = -f.dir;
          // Notice the hook?
          if (fishable && !this.eng && !f.cool && !this.held) {
            const m = this.mouth(f), d = Math.hypot(L.hx - m.x, L.hy - m.y);
            // Close enough: it either comes for the worm, or isn't hungry and looks again in a moment.
            // The longer the worm hangs there, the further away fish notice it.
            if (d < k.see * (1 + this.waitT / 3)) { if (Math.random() < 0.45) { f.state = 'come'; this.eng = f; } else f.cool = rand(0.6, 1.4); }
          }
        } else if (f.state === 'come' || f.state === 'nibble' || f.state === 'bite') {
          if (!fishable) { f.state = 'swim'; if (this.eng === f) this.eng = null; continue; }
          f.dir = L.hx >= f.x ? 1 : -1;
          const m = this.mouth(f), dx = L.hx - m.x, dy = L.hy - m.y, d = Math.hypot(dx, dy);
          if (f.state === 'come') {
            const v = Math.max(45, f.spd) * dt;
            if (d > 3) { f.x += dx / d * Math.min(v, d); f.y += dy / d * Math.min(v, d); }
            else if (!this.held) { f.state = 'nibble'; f.nib = Math.floor(rand(0, 2.6)); f.nibT = rand(0.3, 0.7); }
          } else {
            f.x += dx * Math.min(1, dt * 10); f.y += dy * Math.min(1, dt * 10);
            if (this.held && f.state === 'nibble') { f.state = 'come'; continue; }
            if (f.state === 'nibble') {
              f.nibT -= dt;
              if (f.nibT <= 0) {
                if (f.nib > 0) { f.nib--; f.nibT = rand(0.4, 0.9); L.dip = 3.5; snd.nibble(); this.ripples.push({ x: L.bx, r: 2, life: 0.5 }); }
                else { f.state = 'bite'; f.biteT = k.bite; L.dip = 10; snd.bite(); this.splashAt(L.bx, SURF, 4, false); }
              }
            } else {
              f.biteT -= dt; L.dip = Math.max(L.dip, 8);
              if (f.biteT <= 0) { this.say('Missed it!', 'Press when the float goes under', C.amber, 1.2); snd.lost(); this.scare(f); }
            }
          }
        } else if (f.state === 'flee') {
          f.x += f.dir * f.spd * 2.2 * dt; f.fleeT -= dt;
          if (f.fleeT <= 0) f.state = 'swim';
        }
      }
      // The boot "bites" on its own (see boot()), and it doesn't need to swim.
      if (this.eng && this.eng.boot && this.eng.state === 'bite') {
        const f = this.eng;
        if (!fishable) this.eng = null;
        else { f.biteT -= dt; L.dip = Math.max(L.dip, 8); if (f.biteT <= 0) { this.eng = null; this.say('Snagged...', 'Something on the bottom', C.muted, 1); } }
      }
      // Fish that swim off the right side are replaced by new ones.
      const before = this.fish.length;
      this.fish = this.fish.filter((f) => f === this.eng || !(f.x > W + 40 + KINDS[f.kind].len && f.dir > 0) && !(f.x < -60));
      for (let i = this.fish.length; i < 9; i++) if (Math.random() < (before > this.fish.length ? 1 : dt * 0.6)) this.spawn();
      if (!this.bootPos && this.state !== 'fight' && Math.random() < dt * 0.05) this.bootPos = { x: rand(170, 360), y: BOTTOM - 6 };
    },

    /* ---------- Drawing ---------- */
    tip() {
      // The rod tip moves with what the fisher is doing.
      const s = this.state;
      if (s === 'charge') { const a = -0.35 - this.charge * 1.5; return { x: HANDS.x + Math.cos(a) * 62, y: HANDS.y + Math.sin(a) * 62 }; }
      if (s === 'fight' && this.eng) {
        const f = this.eng, bend = this.tension * 26;
        const dx = f.x - HANDS.x, dy = f.y - HANDS.y, d = Math.hypot(dx, dy);
        return { x: HANDS.x + 46 + dx / d * bend, y: HANDS.y - 40 + dy / d * bend + bend * 0.6 };
      }
      if (s === 'lift' || s === 'show') return { x: HANDS.x + 30, y: HANDS.y - 58 };
      if (s === 'fly') return { x: HANDS.x + 56, y: HANDS.y - 22 };
      return { x: HANDS.x + 48, y: HANDS.y - 44 + Math.sin(this.t * 1.5) * 1.5 };
    },
    draw() {
      const f = clamp((ROUND - this.left) / ROUND, 0, 1);
      ctx.save();
      if (this.shake) ctx.translate(rand(-3, 3) * this.shake * 6, rand(-3, 3) * this.shake * 6);
      this.drawSky(f);
      this.drawWater(f);
      this.drawDock();
      this.drawFisher();
      this.drawLine();
      for (const p of this.parts) {
        ctx.globalAlpha = clamp(p.life * 2, 0, 1); ctx.fillStyle = p.c;
        if (p.star) { ctx.fillRect(p.x - 1, p.y - 3, 2, 6); ctx.fillRect(p.x - 3, p.y - 1, 6, 2); } else ctx.fillRect(p.x, p.y, p.s, p.s);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      if (this.flash) { ctx.fillStyle = 'rgba(255,244,176,' + (this.flash * 1.5).toFixed(2) + ')'; ctx.fillRect(0, 0, W, H); }
      this.drawHud(f);
    },
    drawSky(f) {
      const g = ctx.createLinearGradient(0, 0, 0, SURF);
      g.addColorStop(0, sky('top', f)); g.addColorStop(1, sky('low', f));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, SURF);
      // The sun sinks towards the hills as the round goes on.
      const sx = 300 + f * 30, sy = 46 + f * (SURF - 60);
      ellipse(sx, sy, 26, 26, 'rgba(255,240,180,.18)');
      ellipse(sx, sy, 17, 17, sky('sun', f));
      for (const c of this.clouds) {
        ctx.fillStyle = sky('cloud', f); ctx.globalAlpha = 0.85;
        const w = 46 * c.s;
        ctx.fillRect(c.x, c.y, w, 8); ctx.fillRect(c.x + w * 0.2, c.y - 6, w * 0.45, 7); ctx.fillRect(c.x + w * 0.5, c.y - 3, w * 0.3, 4);
      }
      ctx.globalAlpha = 1;
      // Hills and a pine forest on the far shore.
      poly(sky('hill', f), [0, SURF, 0, 128, 60, 110, 130, 132, 210, 100, 290, 126, 350, 112, 400, 124, 400, SURF]);
      poly(sky('hill2', f), [0, SURF, 0, 150, 90, 142, 180, 154, 260, 140, 340, 152, 400, 146, 400, SURF]);
      ctx.fillStyle = sky('tree', f);
      for (let i = 0; i < 26; i++) {
        const x = 104 + i * 12 + ((i * 7) % 5), h = 10 + ((i * 13) % 9);
        poly(ctx.fillStyle, [x, SURF - 2, x + 5, SURF - 2 - h - 6, x + 10, SURF - 2]);
      }
      ctx.fillRect(100, SURF - 4, W - 100, 4);
    },
    drawWater(f) {
      const g = ctx.createLinearGradient(0, SURF, 0, BOTTOM);
      g.addColorStop(0, sky('water', f)); g.addColorStop(1, sky('deep', f));
      ctx.fillStyle = g; ctx.fillRect(0, SURF, W, H - SURF);
      // Sun rays under water.
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      for (let i = 0; i < 4; i++) {
        const x = 120 + i * 80 + Math.sin(this.t * 0.5 + i) * 14;
        poly(ctx.fillStyle, [x, SURF, x + 26, SURF, x - 30, BOTTOM - 80, x - 70, BOTTOM - 80]);
      }
      // Lake bottom: sand, stones and swaying weed.
      ctx.fillStyle = '#3a3152';
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 10) ctx.lineTo(x, BOTTOM + Math.sin(x * 0.045) * 4 + Math.sin(x * 0.13) * 2);
      ctx.lineTo(W, H); ctx.fill();
      ctx.fillStyle = mix('#c9a96e', '#6f5a7a', f);
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 10) ctx.lineTo(x, BOTTOM + 6 + Math.sin(x * 0.045) * 4 + Math.sin(x * 0.13) * 2);
      ctx.lineTo(W, H); ctx.fill();
      ellipse(150, BOTTOM + 6, 14, 8, '#4a4060'); ellipse(312, BOTTOM + 4, 20, 10, '#4a4060'); ellipse(318, BOTTOM + 1, 9, 4, '#5d5180');
      ctx.strokeStyle = '#2f6b45'; ctx.lineWidth = 3;
      for (const [x, h] of [[118, 70], [128, 46], [236, 58], [246, 84], [372, 66], [384, 40]]) {
        ctx.beginPath(); ctx.moveTo(x, BOTTOM + 6);
        ctx.quadraticCurveTo(x + Math.sin(this.t * 1.4 + x) * 12, BOTTOM - h / 2, x + Math.sin(this.t * 1.4 + x + 1) * 8, BOTTOM - h);
        ctx.stroke();
      }
      // The boot, then the fish. Deep fish fade into the murk.
      if (this.bootPos && !(this.eng && this.eng.boot && this.state === 'fight')) {
        ctx.save(); ctx.translate(this.bootPos.x, this.bootPos.y - 4); ctx.rotate(-0.15); ctx.globalAlpha = 0.7; paintBoot(); ctx.restore();
      }
      for (const fi of this.fish) {
        if (fi.boot) continue;
        ctx.save();
        ctx.globalAlpha = 1 - clamp((fi.y - SURF) / (BOTTOM - SURF), 0, 1) * 0.35;
        ctx.translate(fi.x, fi.y);
        const thrash = fi.state === 'hooked' ? Math.sin(this.t * (this.run > 0 ? 30 : 12)) * (this.run > 0 ? 0.3 : 0.12) : 0;
        ctx.rotate(thrash);
        ctx.scale(fi.dir * fi.size, fi.size);
        paintFish(fi.kind, this.t * (fi.state === 'hooked' ? 2 : 1) + fi.wob);
        ctx.restore();
      }
      if (this.eng && this.eng.boot && this.state === 'fight') {
        const b = this.eng; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.sin(this.t * 5) * 0.2); paintBoot(); ctx.restore();
      }
      ctx.fillStyle = 'rgba(220,240,255,.55)';
      for (const b of this.bubbles) { ctx.fillRect(b.x, b.y, b.r, b.r); }
      // The surface: a bright wavy edge, sun glints and ripples.
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      for (let x = 0; x < W; x += 4) ctx.fillRect(x, SURF + Math.sin(x * 0.06 + this.t * 2) * 1.2 - 1, 4, 2);
      ctx.fillStyle = 'rgba(255,244,190,.5)';
      const sx = 300 + f * 30;
      for (let i = 0; i < 6; i++) { const w = 26 - i * 3; ctx.fillRect(sx - w / 2 + Math.sin(this.t * 2 + i) * 4, SURF + 5 + i * 5, w, 2); }
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.5;
      for (const r of this.ripples) {
        ctx.globalAlpha = clamp(r.life, 0, 1);
        ctx.beginPath(); ctx.ellipse(r.x, SURF + 1, r.r, r.r * 0.22, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
    drawDock() {
      // Posts go down into the water, then the planks on top.
      ctx.fillStyle = '#4a3020'; ctx.fillRect(22, DECK, 8, 120); ctx.fillRect(78, DECK, 8, 140);
      ctx.fillStyle = 'rgba(14,52,80,.45)'; ctx.fillRect(22, SURF, 8, 98); ctx.fillRect(78, SURF, 8, 118);
      ctx.fillStyle = '#8a5a34'; ctx.fillRect(0, DECK, DOCK, 9);
      ctx.fillStyle = '#a8703f'; ctx.fillRect(0, DECK, DOCK, 3);
      ctx.fillStyle = '#5a3a22'; for (let x = 14; x < DOCK; x += 16) ctx.fillRect(x, DECK, 2, 9);
      // A bucket with the round's catch.
      ctx.fillStyle = '#5ce1e6'; ctx.fillRect(10, DECK - 16, 16, 16);
      ctx.fillStyle = '#2b8a90'; ctx.fillRect(10, DECK - 16, 16, 3); ctx.fillRect(12, DECK - 3, 12, 3);
      if (this.count) { ctx.fillStyle = '#c3cfdc'; ctx.fillRect(13, DECK - 20, 4, 5); ctx.fillRect(18, DECK - 22, 4, 7); }
    },
    drawFisher() {
      const x = 52, y = DECK, lean = this.state === 'fight' ? (this.held ? -2 : 1) : 0;
      // Boots, legs, raincoat, head, hat.
      ctx.fillStyle = '#2b2340'; ctx.fillRect(x - 8, y - 5, 7, 5); ctx.fillRect(x + 2, y - 5, 7, 5);
      ctx.fillStyle = '#2c3e91'; ctx.fillRect(x - 7, y - 20, 6, 15); ctx.fillRect(x + 2, y - 20, 6, 15);
      ctx.fillStyle = '#ffb347'; ctx.fillRect(x - 9 + lean, y - 42, 19, 24);
      ctx.fillStyle = '#e8922a'; ctx.fillRect(x - 9 + lean, y - 24, 19, 3); ctx.fillRect(x + lean, y - 42, 1, 18);
      ctx.fillStyle = '#ffc9a0'; ctx.fillRect(x - 6 + lean, y - 56, 13, 13);
      ctx.fillStyle = '#0d0a15'; ctx.fillRect(x + 3 + lean, y - 52, 2, 2);
      ctx.fillStyle = '#ff6b9a'; ctx.fillRect(x + 4 + lean, y - 47, 2, 1);
      ctx.fillStyle = '#5c7a5a'; ctx.fillRect(x - 9 + lean, y - 58, 19, 4); ctx.fillRect(x - 6 + lean, y - 64, 13, 7);
      // Arm reaching to the rod.
      ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(x + 4 + lean, y - 36); ctx.lineTo(HANDS.x, HANDS.y); ctx.stroke();
      ellipse(HANDS.x, HANDS.y, 3, 3, '#ffc9a0');
      // The caught fish, held up for everyone to see.
      if ((this.state === 'show') && this.landed) {
        ctx.save(); ctx.translate(x + 2, y - 76); ctx.rotate(-1.3);
        const k = KINDS[this.landed.kind], sc = Math.min(1, 34 / k.len);
        ctx.scale(sc, sc); paintFish(this.landed.kind, this.t); ctx.restore();
      }
    },
    drawLine() {
      const tip = this.tip(), s = this.state;
      // Rod: from behind the hands to the tip, bending when a fish pulls.
      const bx = HANDS.x - (tip.x - HANDS.x) * 0.25, by = HANDS.y - (tip.y - HANDS.y) * 0.25;
      const bend = s === 'fight' ? this.tension * 18 : 0;
      ctx.strokeStyle = '#3b2a1c'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(HANDS.x, HANDS.y); ctx.stroke();
      ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(HANDS.x, HANDS.y);
      ctx.quadraticCurveTo((HANDS.x + tip.x) / 2 + bend * 0.3, (HANDS.y + tip.y) / 2 - 4 + bend * 0.2, tip.x, tip.y); ctx.stroke();
      ctx.lineCap = 'butt';
      // Reel, spinning while you wind.
      ellipse(HANDS.x - 4, HANDS.y + 5, 4, 4, '#c7cbe0');
      const spin = this.held && (s === 'fight' || s === 'wait') ? this.t * 20 : 0;
      ctx.fillStyle = '#2b2340'; ctx.fillRect(HANDS.x - 4 + Math.cos(spin) * 3 - 1, HANDS.y + 5 + Math.sin(spin) * 3 - 1, 2, 2);

      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
      const L = this.lure;
      if (s === 'fly' && L) {
        ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(L.x, L.y); ctx.stroke();
        this.drawFloat(L.x, L.y);
      } else if ((s === 'sink' || s === 'wait') && L) {
        const by2 = SURF - 2 + (L.dip || 0) + Math.sin(this.t * 3) * 1;
        ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.quadraticCurveTo((tip.x + L.bx) / 2, Math.max(tip.y, SURF) + 6, L.bx, by2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.45)';
        ctx.beginPath(); ctx.moveTo(L.bx, by2 + 4); ctx.lineTo(L.hx, L.hy); ctx.stroke();
        // Hook with a worm.
        ctx.strokeStyle = '#c7cbe0'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(L.hx - 2, L.hy + 2, 3, 0, Math.PI); ctx.stroke();
        ctx.fillStyle = '#ff6b9a'; ctx.fillRect(L.hx - 1, L.hy + 1, 3, 3); ctx.fillRect(L.hx + 1 + Math.sin(this.t * 6) * 1.5, L.hy + 3, 2, 3);
        this.drawFloat(L.bx, by2);
        // Bite! A big "!" over the float.
        if (this.eng && this.eng.state === 'bite') {
          const pop = 1 + Math.sin(this.t * 30) * 0.08;
          text('!', L.bx, SURF - 28, Math.round(22 * pop), C.pink);
        }
      } else if (s === 'fight' && this.eng) {
        // Tight line: straight. Slack line: it sags.
        const m = this.eng, mx = m.x + (m.dir < 0 ? -KINDS[m.kind].len * m.size * 0.45 : 0), my = m.y;
        const sag = (1 - this.tension) * 50;
        ctx.strokeStyle = this.tension > this.hi() ? 'rgba(255,107,154,.95)' : 'rgba(255,255,255,.85)';
        ctx.lineWidth = this.tension > this.hi() ? 1.5 : 1;
        ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.quadraticCurveTo((tip.x + mx) / 2, (tip.y + my) / 2 + sag, mx, my); ctx.stroke();
      } else if (s === 'lift' && this.landed) {
        // The fish flies out of the water to the fisher.
        const p = Math.min(1, this.liftT / 0.5), lx = this.landed.x + (54 - this.landed.x) * p, ly = this.landed.y + (DECK - 76 - this.landed.y) * p - Math.sin(p * Math.PI) * 70;
        ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(lx, ly); ctx.stroke();
        ctx.save(); ctx.translate(lx, ly); ctx.rotate(-p * 1.3); ctx.scale(-1 * (1 - p * 0.4), 1 - p * 0.4);
        paintFish(this.landed.kind, this.t * 3); ctx.restore();
      } else if (s === 'aim' || s === 'charge' || s === 'lost') {
        // Float hanging from the rod tip.
        ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x, tip.y + 14); ctx.stroke();
        if (s !== 'lost') this.drawFloat(tip.x, tip.y + 16);
      }
    },
    drawFloat(x, y) {
      ellipse(x, y, 4, 5, '#ffffff');
      ctx.fillStyle = '#ff3b5c'; ctx.beginPath(); ctx.ellipse(x, y - 1, 4, 4, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#0d0a15'; ctx.fillRect(x - 0.5, y - 9, 1, 5);
    },
    drawHud(f) {
      // Clock and catch count.
      const secs = Math.ceil(this.left), low = this.left <= 10 && this.left > 0;
      text('0:' + String(secs).padStart(2, '0'), W - 12, 18, 14, low ? (Math.floor(this.t * 4) % 2 ? C.pink : C.ink) : C.ink, 'right');
      ctx.save(); ctx.translate(20, 18); ctx.scale(0.7, 0.7); paintFish('perch', 0); ctx.restore();
      text('x' + this.count, 36, 19, 10, C.ink, 'left');
      // Cast power.
      if (this.state === 'charge') {
        ctx.fillStyle = 'rgba(13,10,21,.7)'; ctx.fillRect(10, 36, 108, 14);
        ctx.fillStyle = mix('#b8e65c', '#ff6b9a', this.charge); ctx.fillRect(12, 38, 104 * this.charge, 10);
        text('POWER', 64, 58, 8, C.ink);
        // Where the float will land.
        const tx = DOCK + 44 + this.charge * (W - DOCK - 70);
        poly('rgba(255,255,255,.9)', [tx - 5, SURF - 16, tx + 5, SURF - 16, tx, SURF - 8]);
      }
      // Depth while sinking and waiting.
      if ((this.state === 'sink' || this.state === 'wait') && this.lure) {
        const m = ((this.lure.hy - SURF) / 50).toFixed(1);
        text(m + ' m', this.lure.hx + 10, this.lure.hy, 8, 'rgba(244,236,220,.85)', 'left');
      }
      // The tension bar while fighting a fish.
      if (this.state === 'fight' && this.eng) {
        const x = 40, y = H - 34, w = W - 80, hi = this.hi(), warn = this.redT > 0.35 || this.slackT > 1.2;
        ctx.fillStyle = 'rgba(13,10,21,.8)'; ctx.fillRect(x - 6, y - 26, w + 12, 44);
        ctx.fillStyle = '#4a4268'; ctx.fillRect(x, y, w * LO, 12);
        ctx.fillStyle = C.lime; ctx.fillRect(x + w * LO, y, w * (hi - LO), 12);
        ctx.fillStyle = C.pink; ctx.fillRect(x + w * hi, y, w * (1 - hi), 12);
        if (warn && Math.floor(this.t * 8) % 2) { ctx.strokeStyle = this.redT > 0.35 ? C.pink : C.amber; ctx.lineWidth = 2; ctx.strokeRect(x - 2, y - 2, w + 4, 16); }
        const mx = x + w * this.tension;
        ctx.fillStyle = C.ink; ctx.fillRect(mx - 2, y - 4, 4, 20);
        const k = KINDS[this.eng.kind];
        const what = this.eng.boot ? 'Something odd...' : k.shiny ? 'Something shiny!' : k.len * this.eng.size > 70 ? 'Something HUGE!!' : k.len * this.eng.size > 40 ? 'Something big!' : k.len * this.eng.size > 22 ? 'A good one!' : 'A little one';
        text(what, x, y - 13, 8, C.ink, 'left');
        text(this.run > 0 ? 'IT PULLS! LET GO' : this.tension > hi ? 'TOO TIGHT' : this.tension < LO ? 'REEL IN' : 'HOLD TO REEL', x + w, y - 13, 8, this.run > 0 || this.tension > hi ? C.pink : this.tension < LO ? C.amber : C.lime, 'right');
      }
      // A short tip at the bottom.
      const tips = {
        aim: this.firstCast ? 'HOLD TO CAST' : 'HOLD TO CAST AGAIN',
        charge: 'LET GO TO CAST',
        sink: 'TAP TO STOP SINKING',
        wait: this.eng && this.eng.state === 'bite' ? 'PRESS NOW!' : 'WAIT FOR A BITE... HOLD TO REEL BACK',
      };
      const tip = tips[this.state];
      if (tip) text(tip, W / 2, H - 16, 8, this.eng && this.eng.state === 'bite' ? C.pink : C.ink);
      // Big message in the middle of the screen.
      if (this.msg) {
        const m = this.msg, a = clamp(m.life * 3, 0, 1), rise = (1 - m.life / m.max) * 8;
        ctx.globalAlpha = a;
        text(m.a, W / 2, 238 - rise, 16, m.color);
        if (m.b) text(m.b, W / 2, 262 - rise, 8, C.ink);
        ctx.globalAlpha = 1;
      }
      if (this.state === 'show' && this.landed) this.drawCard();
    },
    drawCard() {
      const c = this.landed, k = KINDS[c.kind], p = clamp(this.showT * 5, 0, 1);
      const x = 40, y = 214, w = W - 80, h = 150;
      ctx.save(); ctx.translate(W / 2, y + h / 2); ctx.scale(0.8 + p * 0.2, 0.8 + p * 0.2); ctx.translate(-W / 2, -(y + h / 2));
      ctx.globalAlpha = p;
      ctx.fillStyle = 'rgba(13,10,21,.88)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = c.kind === 'gold' ? C.amber : c.kind === 'shark' ? C.pink : c.kind === 'boot' ? C.muted : C.cyan; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
      text(c.kind === 'boot' ? 'OH NO...' : c.kind === 'shark' ? 'WHAT A MONSTER!' : c.kind === 'gold' ? 'SO RARE!' : 'NICE CATCH!', W / 2, y + 18, 10, C.ink);
      ctx.save(); ctx.translate(W / 2, y + 62); const sc = Math.min(2.4, 130 / (k.len * 1.3)); ctx.scale(sc, sc); paintFish(c.kind, this.t); ctx.restore();
      text(k.name.toUpperCase(), W / 2, y + 104, 12, c.kind === 'gold' ? C.amber : C.ink);
      text(c.cm + ' cm', x + 14, y + 130, 8, C.muted, 'left');
      text('+' + c.pts, x + w - 14, y + 130, 14, c.pts ? C.lime : C.muted, 'right');
      if (c.perfect) text('PERFECT x1.25', W / 2, y + 130, 8, C.lime);
      if (c.fresh) {
        ctx.save(); ctx.translate(x + w - 30, y + 6); ctx.rotate(0.25);
        ctx.fillStyle = C.pink; ctx.fillRect(-34, -10, 68, 20); text('NEW!', 0, 1, 10, C.ink, 'center', false); ctx.restore();
      }
      ctx.restore();
    },
  };

  Arcade.register('fishing', fishing);
})();
