/* Memory. Loaded on demand by js/arcade.js the first time the game is opened. */
(() => {
  const { $, shuffle, setScore, over } = Arcade;

  const SYMBOLS = [['★', '#ffb347'], ['♥', '#ff6b9a'], ['◆', '#5ce1e6'], ['●', '#b8e65c'], ['▲', '#a78bfa'], ['■', '#f4ecdc'], ['♣', '#7ee0a1'], ['☾', '#ffd56b']];
  const memory = {
    dom: true, color: 'var(--violet)', title: 'Memory', label: 'Moves', lowerWins: true,
    intro: 'Flip two cards per move. Matching pairs stay up. Clear all 8 pairs in as few moves as you can.',
    hint: 'Click or tap a card, or use <kbd>Tab</kbd> and <kbd>Enter</kbd>',
    reset() {
      clearTimeout(this.timer);
      const deck = shuffle([...SYMBOLS, ...SYMBOLS]);
      this.moves = 0; this.found = 0; this.first = null; this.lock = false;
      const grid = $('#mem'); grid.className = 'mem'; grid.onclick = null; grid.innerHTML = '';
      deck.forEach(([sym, col], i) => {
        const b = document.createElement('button');
        b.className = 'mc'; b.id = 'card' + i; b.dataset.sym = sym;
        b.setAttribute('aria-label', 'Hidden card');
        b.innerHTML = '<i class="back-face"></i><i class="front-face" style="color:' + col + '">' + sym + '</i>';
        b.addEventListener('click', () => this.flip(b));
        grid.appendChild(b);
      });
    },
    flip(b) {
      if (!Arcade.playing() || this.lock || b.classList.contains('up')) return;
      b.classList.add('up'); b.setAttribute('aria-label', b.dataset.sym);
      if (!this.first) { this.first = b; return; }
      const a = this.first; this.first = null;
      this.moves++; setScore(this.moves);
      if (a.dataset.sym === b.dataset.sym) {
        a.classList.add('done'); b.classList.add('done');
        if (++this.found === SYMBOLS.length) this.timer = setTimeout(() => over(this.moves, 'All 8 pairs in ' + this.moves + ' moves.', 'Cleared!'), 450);
      } else {
        this.lock = true;
        this.timer = setTimeout(() => {
          [a, b].forEach((c) => { c.classList.remove('up'); c.setAttribute('aria-label', 'Hidden card'); });
          this.lock = false;
        }, 800);
      }
    },
    stop() { clearTimeout(this.timer); },
  };

  Arcade.register('memory', memory);
})();
