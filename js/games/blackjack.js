/* Blackjack. Loaded on demand by js/arcade.js the first time the game is opened.
   Coins are play money for one game only: every new game starts at 100 and nothing is saved except your best. */
(() => {
  const { $, shuffle, sfx, store, setScore, over } = Arcade;

  const SUITS = [['♠', '#f4ecdc'], ['♥', '#ff6b9a'], ['♦', '#ff6b9a'], ['♣', '#f4ecdc']];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const BETS = [10, 25, 50];
  const STREAK_EVERY = 3, STREAK_BONUS = 25;
  const value = (c) => (c.r === 'A' ? 11 : ['J', 'Q', 'K'].includes(c.r) ? 10 : +c.r);

  const blackjack = {
    dom: true, color: 'var(--amber)', title: 'Blackjack', label: 'Coins',
    intro: 'Get closer to 21 than the dealer without going over. You start with 100 play coins (not real money). Win 3 hands in a row for 25 bonus coins. Blackjack pays 3 to 2. The dealer stands on 17.',
    hint: 'Click the buttons, or press <kbd>H</kbd> hit, <kbd>S</kbd> stand, <kbd>X</kbd> split, <kbd>Enter</kbd> deal the same bet again',
    reset() {
      clearTimeout(this.timer);
      this.coins = 100; this.peak = 100; this.base = 10; this.shoe = []; this.phase = 'bet'; this.msg = 'Tap a bet to deal.'; this.tone = '';
      this.hands = []; this.cur = 0; this.dealer = [];
      this.streak = 0; this.stats = { hands: 0, won: 0, lost: 0, biggest: 0 };
      this.seen = { d: 0, h: [] }; this.holeShown = false;
      const el = $('#mem'); el.className = 'bj'; el.innerHTML = '';
      el.onclick = (e) => { const b = e.target.closest('button[data-a]'); if (b) this.act(b.dataset.a); };
      this.render();
    },
    draw1() {
      if (this.shoe.length < 15) {
        this.shoe = [];
        for (let d = 0; d < 4; d++) for (const s of SUITS) for (const r of RANKS) this.shoe.push({ r, s });
        shuffle(this.shoe);
      }
      return this.shoe.pop();
    },
    total(cards) {
      let t = 0, aces = 0;
      for (const c of cards) { t += value(c); if (c.r === 'A') aces++; }
      while (t > 21 && aces) { t -= 10; aces--; }
      return t;
    },
    hand() { return this.hands[this.cur]; },
    canSplit() {
      const h = this.hand();
      return this.phase === 'turn' && this.hands.length === 1 && h.cards.length === 2
        && value(h.cards[0]) === value(h.cards[1]) && this.coins >= h.bet;
    },
    key(e, down) {
      if (!down || e.repeat) return;
      const a = { KeyH: 'hit', KeyS: 'stand', KeyX: 'split', Enter: 'deal', NumpadEnter: 'deal' }[e.code];
      if (a) { e.preventDefault(); this.act(a); }
    },
    act(a) {
      if (!Arcade.playing()) return;
      if (this.phase === 'bet') {
        if (a.startsWith('bet')) { this.base = a === 'betall' ? 'all' : +a.slice(3); this.deal(); }
        else if (a === 'deal') this.deal();
        else if (a === 'cashout') over(this.peak, 'You cashed out with ' + this.coins + ' coins. Most coins: ' + this.peak + '.', 'Cashed out!');
      } else if (this.phase === 'turn') {
        const h = this.hand();
        if (a === 'hit') {
          h.cards.push(this.draw1()); sfx.hit();
          if (this.total(h.cards) >= 21) this.nextHand(); else this.render();
        } else if (a === 'stand') this.nextHand();
        else if (a === 'split' && this.canSplit()) this.split();
      }
    },
    deal() {
      const bet = this.base === 'all' ? this.coins : Math.min(this.base, this.coins);
      if (bet <= 0) return;
      this.coins -= bet; setScore(this.coins);
      this.hands = [{ cards: [this.draw1(), this.draw1()], bet }]; this.cur = 0;
      this.dealer = [this.draw1(), this.draw1()];
      this.seen = { d: 0, h: [0] }; this.holeShown = false;
      this.phase = 'turn'; this.msg = 'Hit or stand?'; this.tone = ''; sfx.hit();
      const pj = this.total(this.hands[0].cards) === 21, dj = this.total(this.dealer) === 21;
      if (pj || dj) this.finish(); else this.render();
    },
    split() {
      const h = this.hand();
      this.coins -= h.bet; setScore(this.coins);
      const aces = h.cards[0].r === 'A';
      this.hands = [{ cards: [h.cards[0], this.draw1()], bet: h.bet }, { cards: [h.cards[1], this.draw1()], bet: h.bet }];
      this.seen.h = [1, 1]; sfx.hit();
      // Split aces get one card each and no more, like at a real table.
      if (aces) { this.cur = 1; this.nextHand(); return; }
      this.msg = 'Hand 1: hit or stand?';
      if (this.total(this.hand().cards) === 21) this.nextHand(); else this.render();
    },
    nextHand() {
      while (this.cur < this.hands.length - 1) {
        this.cur++;
        if (this.total(this.hand().cards) < 21) { this.msg = 'Hand ' + (this.cur + 1) + ': hit or stand?'; this.render(); return; }
      }
      if (this.hands.every((h) => this.total(h.cards) > 21)) this.finish(); else this.dealerPlay();
    },
    dealerPlay() {
      this.phase = 'dealer'; this.msg = 'Dealer plays…'; this.render();
      const stepDealer = () => {
        if (this.total(this.dealer) < 17) { this.dealer.push(this.draw1()); sfx.hit(); this.render(); this.timer = setTimeout(stepDealer, 550); }
        else this.finish();
      };
      this.timer = setTimeout(stepDealer, 550);
    },
    // How many coins a hand pays back (its bet included), and the words for it.
    settle(h, natural) {
      const p = this.total(h.cards), d = this.total(this.dealer);
      const pj = natural && p === 21, dj = d === 21 && this.dealer.length === 2;
      if (p > 21) return [0, 'Bust, lose ' + h.bet];
      if (pj && !dj) return [h.bet + Math.floor(h.bet * 1.5), 'Blackjack! Win ' + Math.floor(h.bet * 1.5)];
      if (dj && !pj) return [0, 'Dealer blackjack, lose ' + h.bet];
      if (d > 21) return [h.bet * 2, 'Dealer busts, win ' + h.bet];
      if (p > d) return [h.bet * 2, 'Win ' + h.bet];
      if (p === d) return [h.bet, 'Push'];
      return [0, 'Lose ' + h.bet];
    },
    finish() {
      const natural = this.hands.length === 1 && this.hands[0].cards.length === 2;
      let back = 0, staked = 0;
      const lines = this.hands.map((h, i) => {
        const [pay, text] = this.settle(h, natural);
        back += pay; staked += h.bet;
        this.stats.hands++;
        if (pay > h.bet) this.stats.won++; else if (pay < h.bet) this.stats.lost++;
        return (this.hands.length > 1 ? 'Hand ' + (i + 1) + ': ' : '') + text;
      });
      const net = back - staked;
      let msg = lines.join('. ') + '.';
      if (net > 0) {
        this.streak++;
        this.stats.biggest = Math.max(this.stats.biggest, net);
        if (this.streak % STREAK_EVERY === 0) { back += STREAK_BONUS; msg += ' ' + this.streak + ' wins in a row! +' + STREAK_BONUS + ' bonus coins.'; }
      } else if (net < 0) this.streak = 0;
      this.msg = msg; this.tone = net > 0 ? 'win' : net < 0 ? 'lose' : '';
      this.coins += back; this.peak = Math.max(this.peak, this.coins);
      if (net > 0) sfx.win(); else if (net < 0) sfx.tone(200, 0.25, 'triangle', 0.06, 120);
      setScore(this.coins);
      if (this.peak > (store.get('blackjack') || 0)) { store.set('blackjack', this.peak); $('#best').textContent = this.peak; }
      this.phase = 'bet'; this.render();
      if (this.coins <= 0) {
        const s = this.stats;
        this.timer = setTimeout(() => over(this.peak, 'Out of coins! Most coins you had: ' + this.peak + '. You won ' + s.won + ' of ' + s.hands + ' hands.'), 1400);
      }
    },
    card(c, hidden, cls, delay) {
      const anim = cls ? ' ' + cls + '" style="animation-delay:' + delay + 'ms;' : '" style="';
      if (hidden) return '<div class="pc down' + anim + '" aria-label="Hidden card"></div>';
      return '<div class="pc' + anim + 'color:' + c.s[1] + '" aria-label="' + c.r + ' ' + c.s[0] + '"><b>' + c.r + '</b><span>' + c.s[0] + '</span></div>';
    },
    render() {
      const hide = this.phase === 'turn';
      // Only cards that weren't on the table last time slide in, one after another.
      // The opening deal goes you, dealer, you, dealer, like at a real table.
      const opening = this.seen.d === 0;
      let order = 0;
      const deal = (isNew, slot) => (isNew ? ['deal', (opening ? slot : order++) * 140] : ['', 0]);
      const flip = !hide && !this.holeShown && this.dealer.length > 0;
      if (flip) this.holeShown = true;
      const dealerCards = this.dealer.map((c, i) => {
        const [cls, delay] = deal(i >= this.seen.d, i * 2 + 1);
        return this.card(c, hide && i === 0, flip && i === 0 && !cls ? 'flip' : cls, delay);
      }).join('');
      const handsHtml = this.hands.map((h, hi) => {
        const seen = this.seen.h[hi] || 0;
        const cards = h.cards.map((c, i) => { const [cls, delay] = deal(i >= seen, i * 2); return this.card(c, false, cls, delay); }).join('');
        const name = this.hands.length > 1 ? 'HAND ' + (hi + 1) : 'YOU';
        const active = this.phase === 'turn' && this.hands.length > 1 && hi === this.cur;
        return '<div class="hand' + (active ? ' on' : '') + '"><span class="lbl">' + name + ' · ' + this.total(h.cards) + ' · BET ' + h.bet + '</span><div class="cards">' + cards + '</div></div>';
      }).join('');
      this.seen = { d: this.dealer.length, h: this.hands.map((h) => h.cards.length) };

      const btn = (a, label, on = true, sel = false) => '<button data-a="' + a + '"' + (on ? '' : ' disabled') + (sel ? ' class="sel"' : '') + '>' + label + '</button>';
      let controls;
      if (this.phase === 'bet') {
        controls = '<div class="row">' + BETS.map((v) => btn('bet' + v, 'BET ' + v, this.coins >= v || v === BETS[0], this.base === v && this.hands.length > 0)).join('')
          + btn('betall', 'ALL IN', this.coins > 0, this.base === 'all' && this.hands.length > 0) + '</div>'
          + '<div class="row">' + btn('cashout', 'CASH OUT') + '</div>';
      } else if (this.phase === 'turn') {
        controls = '<div class="row">' + btn('hit', 'HIT') + btn('stand', 'STAND') + (this.canSplit() ? btn('split', 'SPLIT') : '') + '</div>';
      } else controls = '<div class="row"><span class="muted">Dealer plays…</span></div>';

      const s = this.stats;
      const pips = Array.from({ length: STREAK_EVERY }, (_, i) => '<i' + (i < this.streak % STREAK_EVERY || (this.streak && this.streak % STREAK_EVERY === 0) ? ' class="lit"' : '') + '></i>').join('');
      $('#mem').innerHTML =
        '<div class="top"><span class="coins">● ' + this.coins + ' COINS</span><span class="streak" title="Win ' + STREAK_EVERY + ' in a row for ' + STREAK_BONUS + ' bonus coins">STREAK ' + this.streak + ' ' + pips + '</span></div>'
        + '<div class="hand"><span class="lbl">DEALER' + (this.dealer.length ? ' · ' + (hide ? this.total([this.dealer[1]]) : this.total(this.dealer)) : '') + '</span><div class="cards">' + dealerCards + '</div></div>'
        + '<p class="msg' + (this.phase === 'bet' && this.tone ? ' ' + this.tone : '') + '" aria-live="polite">' + this.msg + '</p>'
        + '<div class="hands' + (this.hands.length > 1 ? ' split' : '') + '">' + (handsHtml || '<div class="hand"><span class="lbl">YOU</span><div class="cards"></div></div>') + '</div>'
        + controls
        + '<p class="stats">Hands ' + s.hands + ' · Won ' + s.won + ' · Lost ' + s.lost + ' · Biggest win ' + s.biggest + '</p>';
    },
    stop() { clearTimeout(this.timer); },
  };

  Arcade.register('blackjack', blackjack);
})();
