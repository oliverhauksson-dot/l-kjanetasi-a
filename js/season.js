/* Christmas on Pocket Arcade: northern lights, falling snow, fairy lights, Santa's sleigh, a little tree with a gold star,
   snow on the game cards, a live countdown to Christmas Eve and snowy hills.
   It shows by itself from 14 November to 6 January. The rest of the year this file does nothing.
   To look at it on any other day, add ?xmas to the address (pocketarcade.net/?xmas). ?xmas=off hides it.
   The styles are in css/xmas.css, which is only downloaded while the decorations are on. */
(() => {
  const script = document.currentScript;
  const now = new Date(), month = now.getMonth(), day = now.getDate();
  const ask = new URLSearchParams(location.search).get('xmas');
  const inSeason = (month === 10 && day >= 14) || month === 11 || (month === 0 && day <= 6);
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

  /* The big countdown under the title. It ticks every second to 18:00 on 24 December, when Christmas starts in Iceland.
     After that it says Merry Christmas, then counts down to New Year, then wishes a happy new year until 6 January. */
  function countdown() {
    const box = document.createElement('section');
    box.className = 'xmas-count';
    box.setAttribute('aria-label', 'Countdown to Christmas Eve');
    box.innerHTML = '<i class="xmas-bauble" aria-hidden="true"></i><p class="xc-tag"></p><div class="xc-time" role="timer" aria-live="off"></div><p class="xc-sub"></p>';
    const tag = box.querySelector('.xc-tag'), time = box.querySelector('.xc-time'), sub = box.querySelector('.xc-sub');
    const UNITS = ['days', 'hours', 'min', 'sec'];
    time.innerHTML = UNITS.map((u) => '<span><b>00</b><small>' + u + '</small></span>').join('');
    const cells = time.querySelectorAll('b');
    const pad = (n) => String(n).padStart(2, '0');
    let shown = '';
    function tick() {
      const t = new Date(), y = t.getMonth() === 0 ? t.getFullYear() - 1 : t.getFullYear();
      const eve = new Date(y, 11, 24, 18), newYear = new Date(y + 1, 0, 1);
      let target = null, label, note;
      if (t < eve) { target = eve; label = 'CHRISTMAS EVE'; note = 'Christmas starts at 6 pm on 24 December'; }
      else if (t < new Date(y, 11, 27)) { label = 'MERRY CHRISTMAS'; note = 'Gleðileg jól from Pocket Arcade ★'; }
      else if (t < newYear) { target = newYear; label = 'NEW YEAR'; note = 'Counting down to midnight on 31 December'; }
      else { label = 'HAPPY NEW YEAR'; note = 'Gleðilegt nýtt ár from Pocket Arcade ★'; }
      if (label + note !== shown) { tag.textContent = label; sub.textContent = note; time.hidden = !target; box.classList.toggle('xc-done', !target); shown = label + note; }
      if (!target) return;
      const left = Math.max(0, Math.floor((target - t) / 1000));
      const parts = [Math.floor(left / 86400), Math.floor(left / 3600) % 24, Math.floor(left / 60) % 60, left % 60];
      parts.forEach((v, i) => { const txt = i === 0 ? String(v) : pad(v); if (cells[i].textContent !== txt) cells[i].textContent = txt; });
      time.setAttribute('aria-label', parts[0] + ' days, ' + parts[1] + ' hours and ' + parts[2] + ' minutes to go');
    }
    tick();
    setInterval(() => { if (!document.hidden) tick(); }, 1000);
    return box;
  }

  /* Northern lights: soft green and cyan ribbons that drift slowly across the top of the sky. */
  const aurora = () => el('div', 'xmas-aurora', '<i></i><i></i><i></i>');

  /* Santa's sleigh with two reindeer, in pixels. It flies across the sky now and then. */
  function sleigh() {
    const R = (x) => '<g fill="#c99a6a"><rect x="' + x + '" y="4" width="6" height="3"/><rect x="' + (x + 5) + '" y="2" width="2" height="2"/><rect x="' + (x + 6) + '" y="1" width="2" height="1" fill="#8a5a33"/><rect x="' + (x + 4) + '" y="0" width="1" height="2" fill="#8a5a33"/><rect x="' + x + '" y="7" width="1" height="2"/><rect x="' + (x + 4) + '" y="7" width="1" height="2"/></g><rect x="' + (x + 7) + '" y="2" width="1" height="1" fill="' + (x > 20 ? '#ff4a4a' : '#2b1a10') + '"/>';
    const svg = '<svg viewBox="0 0 44 14" shape-rendering="crispEdges">' +
      '<path d="M8 8.5H17M17 8.5H26" stroke="#f3cf7c" stroke-width=".5"/>' +
      '<rect x="1" y="6" width="9" height="4" fill="#c8323c"/><rect x="0" y="10" width="11" height="1" fill="#f3cf7c"/><rect x="0" y="9" width="1" height="1" fill="#f3cf7c"/>' +
      '<rect x="3" y="3" width="4" height="3" fill="#c8323c"/><rect x="4" y="2" width="2" height="1" fill="#ffd9c0"/><rect x="3" y="1" width="4" height="1" fill="#c8323c"/><rect x="7" y="1" width="1" height="1" fill="#fff"/><rect x="3" y="5" width="4" height="1" fill="#fff"/>' +
      '<rect x="1" y="4" width="2" height="2" fill="#5a3a8a"/>' + R(17) + R(29) + '</svg>';
    return el('div', 'xmas-sleigh', '<div>' + svg + '</div>');
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
    document.body.prepend(aurora());
    document.body.append(sleigh());
    const title = document.querySelector('.marquee h1');
    if (title) { title.parentNode.append(tree()); title.closest('.marquee').after(countdown()); }
    snow();
  }

  /* Wait for the styles, so the decorations never flash up unstyled. */
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = new URL('../css/xmas.css', script.src).href;
  css.onload = decorate;
  document.head.append(css);
})();
