/* Christmas on Pocket Arcade: falling snow, fairy lights, a little tree with a gold star, a countdown and snowy hills.
   It shows by itself from 1 December to 6 January. The rest of the year this file does nothing.
   To look at it on any other day, add ?xmas to the address (pocketarcade.net/?xmas). ?xmas=off hides it.
   The styles are in css/xmas.css, which is only downloaded while the decorations are on. */
(() => {
  const script = document.currentScript;
  const now = new Date(), month = now.getMonth(), day = now.getDate();
  const ask = new URLSearchParams(location.search).get('xmas');
  const inSeason = month === 11 || (month === 0 && day <= 6);
  if (ask === 'off' || (ask === null && !inSeason)) return;

  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    e.className = cls; e.setAttribute('aria-hidden', 'true');
    if (html) e.innerHTML = html;
    return e;
  };

  /* The tree is drawn in big pixels, like the game pictures. Each row is [row, first column, last column]. */
  const ROWS = [[3, 7, 7], [4, 6, 8], [5, 5, 9], [6, 6, 8], [7, 5, 9], [8, 4, 10], [9, 3, 11], [10, 5, 9], [11, 4, 10], [12, 3, 11], [13, 2, 12], [14, 1, 13]];
  const SNOW = [[5, 5], [5, 9], [9, 3], [9, 4], [9, 11], [14, 1], [14, 2], [14, 3], [14, 12], [14, 13]];
  const BALLS = [[6, 7, '#f3cf7c'], [8, 8, '#7fefff'], [7, 11, '#f3cf7c'], [5, 12, '#ffffff'], [9, 13, '#7fefff'], [10, 12, '#f3cf7c']];
  const px = (x, y, w, fill) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="1.02" fill="' + fill + '"/>';
  function tree() {
    let s = '<svg viewBox="0 0 15 19.5" shape-rendering="crispEdges">';
    for (const [y, a, b] of ROWS) {
      s += px(a, y, b - a + 1, '#1a8f99') + (b > a ? px(b, y, 1, '#127284') : '');
    }
    for (const [y, x] of SNOW) s += px(x, y, 1, x < 7 ? '#ffffff' : '#d5e6ff');
    for (const [x, y, c] of BALLS) s += px(x, y, 1, c);
    s += '<rect x="6" y="15" width="3" height="2" fill="#6b4a2f"/>' + px(3, 17, 9, '#ffffff') + '<rect x="1" y="18" width="13" height="1.5" fill="#d5e6ff"/></svg>';
    return el('div', 'xmas-tree', '<i class="xmas-star"></i>' + s);
  }

  function countdown() {
    /* Counts down to Christmas Eve (24 December), when Christmas starts in Iceland. */
    const afterDay = (month === 11 && day > 25) || (month === 0 && day <= 6);
    const days = Math.round((new Date(now.getFullYear(), 11, 24) - new Date(now.getFullYear(), month, day)) / 864e5);
    const text = afterDay ? 'Merry Christmas and a happy new year'
      : days <= 0 ? 'Merry Christmas!'
      : days === 1 ? 'Merry Christmas · it\'s tomorrow'
      : 'Merry Christmas · ' + days + ' days to go';
    const p = document.createElement('p');
    p.className = 'note xmas-note';
    const star = document.createElement('b');
    star.textContent = '★'; star.setAttribute('aria-hidden', 'true');
    p.append(star, text);
    return p;
  }

  /* Snow: small flakes fall slowly and faintly, bigger ones a little faster, so it looks like it has depth. */
  function snow() {
    const cv = el('canvas', 'xmas-snow'), g = cv.getContext('2d');
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    const game = document.getElementById('game');
    let W = 0, H = 0, flakes = [], raf = 0, last = 0;
    const make = (anywhere) => {
      const r = 0.7 + Math.random() ** 2 * 2.5;
      return { x: Math.random() * W, y: anywhere ? Math.random() * H : -6, r, fall: 12 + r * 13 + Math.random() * 8, a: 0.22 + r * 0.2, sway: Math.random() * 6.28, speed: 0.4 + Math.random() * 0.8 };
    };
    function paint() {
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#eaf4ff';
      for (const f of flakes) { g.globalAlpha = f.a; g.beginPath(); g.arc(f.x, f.y, f.r, 0, 6.2832); g.fill(); }
    }
    function frame(t) {
      const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
      for (let i = 0; i < flakes.length; i++) {
        const f = flakes[i];
        f.sway += f.speed * dt; f.y += f.fall * dt; f.x += Math.sin(f.sway) * f.r * 5 * dt;
        if (f.y > H + 6) flakes[i] = make(false);
      }
      paint();
      raf = requestAnimationFrame(frame);
    }
    function size() {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      cv.width = W * scale; cv.height = H * scale; g.setTransform(scale, 0, 0, scale, 0, 0);
      const want = Math.round(Math.min(120, Math.max(30, W * H / 11000)));
      while (flakes.length < want) flakes.push(make(true));
      flakes.length = want;
      paint();
    }
    /* No snow while a game is open, and no movement for people who asked their device for less motion. */
    function go() {
      const playing = !!game && !game.hidden;
      document.documentElement.classList.toggle('playing', playing);
      cancelAnimationFrame(raf); raf = 0; last = 0;
      if (playing) return;
      if (still.matches) paint(); else raf = requestAnimationFrame(frame);
    }
    document.body.prepend(cv);
    size();
    window.addEventListener('resize', size);
    still.addEventListener('change', go);
    if (game) new MutationObserver(go).observe(game, { attributes: true, attributeFilter: ['hidden'] });
    go();
  }

  function decorate() {
    document.documentElement.classList.add('xmas');
    document.body.prepend(el('div', 'xmas-lights', '<i></i><i></i>'));
    document.body.append(el('div', 'xmas-hills'));
    const title = document.querySelector('.marquee h1');
    const notes = document.getElementById('notes');
    if (notes) notes.prepend(countdown()); else if (title) title.after(countdown());
    if (title) title.parentNode.append(tree());
    snow();
  }

  /* Wait for the styles, so the decorations never flash up unstyled. */
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = new URL('../css/xmas.css', script.src).href;
  css.onload = decorate;
  document.head.append(css);
})();
