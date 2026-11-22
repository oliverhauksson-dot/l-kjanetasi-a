/* Higher or Lower. Loaded on demand by js/arcade.js the first time the game is opened.
   Two cards from the same topic: the left one shows its number, the right one hides it.
   Guess if the right card's number is HIGHER or LOWER. Right: +1 and the right card slides over to the left.
   Wrong: game over. The score is how many you got right in a row. If two numbers are the same, both answers are right.
   The cards are not in this file: they are in higher-or-lower-questions.txt at the top of the site, so they are easy
   to change (see the notes at the top of that file). A card is not used twice in one run until every card has been used. */
(() => {
  const { $, shuffle, setScore, over, sfx, calm } = Arcade;

  const FILE = 'higher-or-lower-questions.txt';
  const PER_TOPIC = 5; // After this many guesses in a row from one topic, the next pair comes from another topic.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  /* ---------- Reading the questions file ---------- */
  // Digits, with spaces, commas or apostrophes between thousands. A dot is for decimals (4.5), but 1.450.000 also works.
  function toNumber(s) {
    let t = s.replace(/[\s,'’]/g, '');
    if ((t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
  }
  const EMOJI = /^(\p{Extended_Pictographic}|\p{Regional_Indicator})[\p{Extended_Pictographic}\p{Regional_Indicator}‍️\p{Emoji_Modifier}]*\s*/u;
  const splitEmoji = (s) => { const m = s.match(EMOJI); return m ? [m[0].trim(), s.slice(m[0].length).trim()] : ['', s.trim()]; };
  function parse(text) {
    const topics = [], skipped = [];
    let title = '', topic = null;
    text.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim(), n = i + 1;
      if (!line || line.startsWith('#')) return;
      const head = line.match(/^(TITLE|TOPIC|UNIT|GAP)\s*:\s*(.*)$/i);
      if (head) {
        const kind = head[1].toUpperCase(), value = head[2].trim();
        if (kind === 'TITLE') title = value;
        else if (kind === 'TOPIC') { const [emoji, name] = splitEmoji(value); topic = { emoji: emoji || '❓', name: name || 'Quiz', unit: '', gap: 0, cards: [] }; topics.push(topic); }
        else if (!topic) skipped.push([n, raw, kind + ' must come after a TOPIC line']);
        else if (kind === 'UNIT') topic.unit = value;
        else if (toNumber(value) > 0) topic.gap = toNumber(value);
        else skipped.push([n, raw, 'GAP needs a number, like GAP: 8']);
        return;
      }
      // After the number, optional parts split by | : a photo and the photo's credit.
      // The photo is a Wikimedia Commons file name (File:Lionel Messi 20180626.jpg) or a link that starts with https://
      const [body, photoPart = '', credit = ''] = line.split('|').map((x) => x.trim());
      const photo = /^file:/i.test(photoPart) ? photoPart.replace(/^file:\s*/i, 'File:') : /^https:\/\/\S+$/.test(photoPart) ? photoPart : '';
      if (photoPart && !photo) skipped.push([n, raw, 'the photo must be File:name.jpg from Wikimedia Commons, or a link that starts with https:// (the card is still used, without the photo)']);
      const eq = body.lastIndexOf('=');
      if (eq < 0) { skipped.push([n, raw, 'no = sign']); return; }
      if (!topic) { skipped.push([n, raw, 'this card comes before the first TOPIC line']); return; }
      const value = toNumber(body.slice(eq + 1)), [emoji, name] = splitEmoji(body.slice(0, eq));
      if (!name) { skipped.push([n, raw, 'no name before the = sign']); return; }
      if (!Number.isFinite(value)) { skipped.push([n, raw, 'the number after = is not a number']); return; }
      // Words in brackets at the end, like "L. Messi (FC Barcelona)", show as a small line under the name.
      const m = name.match(/^(.+?)\s*\(([^()]*)\)$/);
      topic.cards.push({ name, short: m ? m[1] : name, note: m ? m[2] : '', value, emoji: emoji || topic.emoji, photo, credit, topic });
    });
    const usable = topics.filter((t) => t.cards.length >= 2);
    topics.filter((t) => t.cards.length < 2).forEach((t) => skipped.push([0, 'TOPIC: ' + t.name, 'a topic needs at least 2 cards']));
    return { title, topics: usable, skipped };
  }

  let quiz = null, quizError = '';
  // Asks the server every time if the file changed (no-cache), so a new week's questions show up right away.
  const ready = fetch(FILE, { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then((text) => {
      quiz = parse(text);
      if (quiz.skipped.length) console.warn('Higher or Lower skipped these lines in ' + FILE + ':', quiz.skipped);
      if (!quiz.topics.length) quizError = 'There are no questions yet. Every TOPIC in ' + FILE + ' needs at least 2 cards.';
    })
    .catch(() => { quizError = 'The questions could not load. Check your connection and try again.'; });

  // A Commons file name becomes a 250 pixel wide picture, and its credit links to the file's page on Commons.
  const commons = (photo) => encodeURIComponent(photo.slice(5).trim().replace(/ /g, '_'));
  const photoUrl = (photo) => (photo.startsWith('File:') ? 'https://commons.wikimedia.org/wiki/Special:FilePath/' + commons(photo) + '?width=250' : photo);
  // A Wikimedia Commons photo link (upload.wikimedia.org/.../File.jpg/250px-File.jpg) also points its credit at the photo's page there.
  function sourcePage(url) {
    if (url.startsWith('File:')) return 'https://commons.wikimedia.org/wiki/File:' + commons(url);
    const m = url.match(/^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?]+)/);
    return m ? 'https://commons.wikimedia.org/wiki/File:' + m[1] : url;
  }
  const fmt = (v) => (Math.abs(v) >= 10000 ? v.toLocaleString('en', { maximumFractionDigits: 2 }) : String(Math.round(v * 100) / 100));
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  const game = {
    dom: true, color: 'var(--cyan)', title: 'Higher or Lower', label: 'In a row',
    hint: 'Tap <b>HIGHER</b> or <b>LOWER</b>, or press <kbd>↑</kbd> / <kbd>↓</kbd>',
    reset() {
      this.stop();
      this.score = 0; this.lock = true; this.topic = null; this.inTopic = 0;
      const box = $('#mem'); box.className = 'hl'; box.onclick = null; box.innerHTML = '';
      this.box = box;
      const run = this.run = {}; // A new run (Play again) makes the old one's waiting steps do nothing.
      if (quiz || quizError) this.begin();
      else {
        box.append(el('p', 'hlmsg', 'Loading the questions...'));
        ready.then(() => { if (this.run === run) this.begin(); });
      }
    },
    begin() {
      const box = this.box; box.innerHTML = '';
      if (quizError) { box.append(el('p', 'hlmsg', quizError)); return; }
      this.decks = new Map();
      this.titleEl = el('p', 'hltitle', quiz.title); this.titleEl.hidden = !quiz.title;
      this.tagEl = el('p', 'hltag');
      this.view = el('div', 'hlview'); this.row = el('div', 'hlrow'); this.view.append(this.row);
      this.askEl = el('p', 'hlask');
      const btns = el('div', 'hlbtns');
      this.hiBtn = el('button', 'hlb hi'); this.hiBtn.innerHTML = '<span aria-hidden="true">▲</span> HIGHER';
      this.loBtn = el('button', 'hlb lo'); this.loBtn.innerHTML = '<span aria-hidden="true">▼</span> LOWER';
      this.hiBtn.addEventListener('click', () => this.guess(1));
      this.loBtn.addEventListener('click', () => this.guess(-1));
      btns.append(this.hiBtn, this.loBtn);
      box.append(this.titleEl, this.tagEl, this.view, this.askEl, btns);
      if (local && quiz.skipped.length) {
        // Only on your own computer (python3 serve.py): which lines of the questions file were skipped, and why.
        const warn = el('div', 'hlwarn');
        warn.append(el('b', '', 'Skipped lines in ' + FILE + ' (only you see this, on localhost):'));
        quiz.skipped.forEach(([n, raw, why]) => warn.append(el('span', '', (n ? 'Line ' + n + ': ' : '') + raw.trim() + '  (' + why + ')')));
        box.append(warn);
      }
      this.newPair(false);
    },
    // The cards of a topic that haven't been used yet in this run. When every card is used, they all come back.
    deck(t) {
      if (!this.decks.has(t)) this.decks.set(t, shuffle([...t.cards]));
      return this.decks.get(t);
    },
    // Takes a card from the topic to go next to not. Null if there is none left.
    // It prefers a card with a different number, and if the topic has a GAP, the number is at most GAP away from not's.
    draw(t, not) {
      const d = this.deck(t);
      if (!not) return d.pop() || null;
      const fits = (c) => c !== not && c.name !== not.name && (!t.gap || Math.abs(c.value - not.value) <= t.gap);
      let i = d.findIndex((c) => fits(c) && c.value !== not.value);
      if (i < 0) i = d.findIndex(fits);
      return i < 0 ? null : d.splice(i, 1)[0];
    },
    pickTopic() {
      const ok = (t) => this.deck(t).length >= 2;
      let pool = quiz.topics.filter((t) => ok(t) && t !== this.topic);
      if (!pool.length) pool = quiz.topics.filter(ok); // Only this topic has cards left: stay in it.
      if (!pool.length) {
        // Every card has been used: all of them come back.
        this.decks.clear();
        pool = quiz.topics.filter((t) => t !== this.topic);
        if (!pool.length) pool = quiz.topics;
      }
      // Topics with more cards left come up more often.
      let r = Math.random() * pool.reduce((s, t) => s + this.deck(t).length, 0);
      for (const t of pool) { r -= this.deck(t).length; if (r < 0) return t; }
      return pool[pool.length - 1];
    },
    card(c, shown) {
      const b = el('div', 'hlc');
      b.style.setProperty('--len', Math.max(fmt(c.value).length, 4)); // Long numbers get a smaller font, so they fit the card.
      const name = el('b', 'hln', c.short);
      if (c.note) name.append(el('small', '', c.note));
      b.append(c.photo ? this.photo(c) : el('span', 'hle', c.emoji), name);
      const num = el('span', 'hlv', shown ? fmt(c.value) : '?');
      b.append(num, el('span', 'hlu', c.topic.unit || ' '));
      b.num = num;
      if (c.photo && c.credit) {
        // The photographer and licence, as free photos (like Wikimedia Commons) ask. It links to the photo's own page.
        const a = el('a', 'hlcred', c.credit); a.href = sourcePage(c.photo); a.target = '_blank'; a.rel = 'noopener';
        b.append(a);
      }
      return b;
    },
    // The card's photo. If it can't load, the card shows the topic's emoji instead (and drops the photo credit).
    photo(c) {
      const img = el('img', 'hlimg'); img.alt = ''; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      img.onerror = () => { img.closest('.hlc')?.querySelector('.hlcred')?.remove(); img.replaceWith(el('span', 'hle', c.emoji)); };
      img.src = photoUrl(c.photo);
      return img;
    },
    // A new topic: both cards change.
    newPair(animated) {
      this.topic = this.pickTopic(); this.inTopic = 0;
      this.left = this.draw(this.topic, null);
      this.right = this.draw(this.topic, this.left);
      if (!this.right) {
        // Only cards with the same name are left (two lines with one name): shuffle the rest of the topic back in.
        this.deck(this.topic).push(...shuffle(this.topic.cards.filter((c) => c.name !== this.left.name)));
        this.right = this.draw(this.topic, this.left) || this.left;
      }
      const paint = () => {
        this.row.style.transition = 'none'; this.row.style.transform = '';
        this.row.innerHTML = '';
        this.leftEl = this.card(this.left, true); this.rightEl = this.card(this.right, false);
        this.row.append(this.leftEl, this.rightEl);
        this.tagEl.textContent = this.topic.emoji + ' ' + this.topic.name.toUpperCase();
        this.paintAsk();
        if (animated && !calm()) { this.view.classList.remove('swap'); void this.view.offsetWidth; this.view.classList.add('swap'); }
        this.lock = false;
      };
      if (animated && !calm()) { this.view.classList.add('out'); this.later(() => { this.view.classList.remove('out'); paint(); }, 260); }
      else paint();
    },
    paintAsk() {
      this.askEl.textContent = '';
      this.askEl.append('Is ', el('b', '', this.right.short), ' higher or lower than ', el('b', '', this.left.short), '?');
    },
    later(fn, ms) { const run = this.run; this.timers.push(setTimeout(() => { if (this.run === run) fn(); }, ms)); },
    timers: [],
    guess(dir) {
      if (!Arcade.playing() || this.lock || !this.right) return;
      this.lock = true;
      const a = this.left.value, b = this.right.value;
      const right = b === a || (dir > 0 ? b > a : b < a);
      (dir > 0 ? this.hiBtn : this.loBtn).classList.add('picked');
      this.countUp(this.rightEl.num, b, () => {
        this.hiBtn.classList.remove('picked'); this.loBtn.classList.remove('picked');
        this.rightEl.classList.add(right ? 'ok' : 'bad');
        if (!right) {
          sfx.hit(); // The game over screen shakes and plays the lose sound.
          const unit = this.right.topic.unit ? ' ' + this.right.topic.unit : '';
          this.later(() => over(this.score, this.left.short + ': ' + fmt(a) + unit + '. ' + this.right.short + ': ' + fmt(b) + unit + '. ' +
            this.score + ' right in a row.'), 900);
          return;
        }
        this.score++; setScore(this.score);
        if (this.score === 10) Arcade.stat('quiz10'); // For the Know-it-all badge.
        this.inTopic++;
        this.later(() => this.next(), 450);
      });
    },
    // The hidden number counts up from 0, with a tick sound.
    countUp(node, value, done) {
      const ms = calm() ? 0 : 600, t0 = performance.now();
      let lastTick = 0;
      const step = (t) => {
        const k = ms ? Math.min(1, (t - t0) / ms) : 1, e = 1 - Math.pow(1 - k, 3);
        const v = value * e, shown = Number.isInteger(value) ? Math.round(v) : v;
        node.textContent = fmt(k >= 1 ? value : shown);
        if (t - lastTick > 70 && k < 1) { lastTick = t; sfx.tone(500 + 500 * e, 0.03, 'square', 0.025); }
        if (k < 1) this.raf = requestAnimationFrame(step); else done();
      };
      this.raf = requestAnimationFrame(step);
    },
    // Right guess: the right card slides over to the left and a new card comes in.
    // After PER_TOPIC guesses a new topic, if there is more than one.
    next() {
      const c = this.inTopic < PER_TOPIC || quiz.topics.length < 2 ? this.draw(this.topic, this.right) : null;
      if (!c) { this.newPair(true); return; }
      this.left = this.right; this.right = c;
      const incoming = this.card(c, false);
      this.row.append(incoming);
      const settle = () => {
        this.leftEl.remove();
        this.row.style.transition = 'none'; this.row.style.transform = '';
        this.leftEl = this.rightEl; this.rightEl = incoming;
        this.leftEl.classList.remove('ok');
        this.paintAsk();
        this.lock = false;
      };
      if (calm()) { settle(); return; }
      void this.row.offsetWidth;
      this.row.style.transition = 'transform .42s cubic-bezier(.3, .7, .2, 1)';
      this.row.style.transform = 'translateX(calc(-50% - var(--hlgap) / 2))';
      this.later(settle, 440);
    },
    key(e, down) {
      if (!down || e.repeat) return;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); this.guess(1); }
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); this.guess(-1); }
    },
    stop() {
      this.run = null;
      this.timers.forEach(clearTimeout); this.timers = [];
      cancelAnimationFrame(this.raf);
    },
  };
  Arcade.register('higherlower', game);
})();
