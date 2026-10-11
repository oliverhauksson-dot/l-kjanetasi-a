/* Blackjack. Loaded on demand by js/arcade.js the first time the game is opened. */
(() => {
  const { $, shuffle, sfx, store, setScore, over } = Arcade;

  const SUITS = [['♠', '#f4ecdc'], ['♥', '#ff6b9a'], ['♦', '#ff6b9a'], ['♣', '#f4ecdc']];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const blackjack = {
    dom: true, color: 'var(--amber)', title: 'Blackjack', label: 'Chips',
    intro: 'Get closer to 21 than the dealer without going over. You start with 100 play chips (not real money). Blackjack pays 3 to 2. The dealer stands on 17.',
    hint: 'Click the buttons, or press <kbd>H</kbd> hit, <kbd>S</kbd> stand, <kbd>D</kbd> double, <kbd>Enter</kbd> deal',
    reset() {
      clearTimeout(this.timer);
      this.chips = 100; this.peak = 100; this.base = 10; this.bet = 10; this.shoe = []; this.phase = 'bet'; this.msg = 'Place your bet.';
      this.player = []; this.dealer = [];
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
    total(hand) {
      let t = 0, aces = 0;
      for (const c of hand) { if (c.r === 'A') { aces++; t += 11; } else t += ['J', 'Q', 'K'].includes(c.r) ? 10 : +c.r; }
      while (t > 21 && aces) { t -= 10; aces--; }
      return t;
    },
    key(e, down) {
      if (!down || e.repeat) return;
      const a = { KeyH: 'hit', KeyS: 'stand', KeyD: 'double', Enter: 'deal', NumpadEnter: 'deal' }[e.code];
      if (a) { e.preventDefault(); this.act(a); }
    },
    act(a) {
      if (!Arcade.playing()) return;
      if (this.phase === 'bet') {
        if (a.startsWith('bet')) { this.base = this.bet = +a.slice(3); sfx.hit(); this.render(); }
        else if (a === 'deal') this.deal();
        else if (a === 'cashout') over(this.peak, 'You cashed out with ' + this.chips + ' chips. Most chips: ' + this.peak + '.', 'Cashed out!');
      } else if (this.phase === 'turn') {
        if (a === 'hit') { this.player.push(this.draw1()); sfx.hit(); if (this.total(this.player) > 21) this.finish(); else if (this.total(this.player) === 21) this.dealerPlay(); else this.render(); }
        else if (a === 'stand') this.dealerPlay();
        else if (a === 'double' && this.player.length === 2 && this.chips >= this.bet) {
          this.chips -= this.bet; this.bet *= 2; setScore(this.chips); this.player.push(this.draw1()); sfx.hit();
          if (this.total(this.player) > 21) this.finish(); else this.dealerPlay();
        }
      }
    },
    deal() {
      const bet = Math.min(this.base, this.chips);
      if (bet <= 0) return;
      this.bet = bet; this.chips -= bet; setScore(this.chips);
      this.player = [this.draw1(), this.draw1()]; this.dealer = [this.draw1(), this.draw1()];
      this.phase = 'turn'; this.msg = 'Hit or stand?'; sfx.hit();
      const pj = this.total(this.player) === 21, dj = this.total(this.dealer) === 21;
      if (pj || dj) this.finish(); else this.render();
    },
    dealerPlay() {
      this.phase = 'dealer'; this.render();
      const stepDealer = () => {
        if (this.total(this.dealer) < 17) { this.dealer.push(this.draw1()); sfx.hit(); this.render(); this.timer = setTimeout(stepDealer, 550); }
        else this.finish();
      };
      this.timer = setTimeout(stepDealer, 550);
    },
    finish() {
      const p = this.total(this.player), d = this.total(this.dealer);
      const pj = p === 21 && this.player.length === 2, dj = d === 21 && this.dealer.length === 2;
      let win = 0;
      if (p > 21) this.msg = 'Bust! You lose ' + this.bet + '.';
      else if (pj && !dj) { win = this.bet + Math.floor(this.bet * 1.5); this.msg = 'Blackjack! You win ' + Math.floor(this.bet * 1.5) + '.'; }
      else if (dj && !pj) this.msg = 'Dealer has blackjack. You lose ' + this.bet + '.';
      else if (d > 21) { win = this.bet * 2; this.msg = 'Dealer busts! You win ' + this.bet + '.'; }
      else if (p > d) { win = this.bet * 2; this.msg = 'You win ' + this.bet + '!'; }
      else if (p === d) { win = this.bet; this.msg = 'Push. Your bet comes back.'; }
      else this.msg = 'Dealer wins. You lose ' + this.bet + '.';
      this.chips += win; this.peak = Math.max(this.peak, this.chips);
      if (win > this.bet) sfx.win(); else if (!win) sfx.tone(200, 0.25, 'triangle', 0.06, 120);
      setScore(this.chips);
      if (this.peak > (store.get('blackjack') || 0)) { store.set('blackjack', this.peak); $('#best').textContent = this.peak; }
      this.bet = this.base;
      this.phase = 'bet'; this.render(true);
      if (this.chips <= 0) this.timer = setTimeout(() => over(this.peak, 'Out of chips! Most chips you had: ' + this.peak + '.'), 1200);
    },
    card(c, hidden) {
      if (hidden) return '<div class="pc down" aria-label="Hidden card"></div>';
      return '<div class="pc" style="color:' + c.s[1] + '" aria-label="' + c.r + ' ' + c.s[0] + '"><b>' + c.r + '</b><span>' + c.s[0] + '</span></div>';
    },
    render(showAll) {
      const hide = this.phase === 'turn';
      const dTot = hide ? this.total([this.dealer[1]]) : this.total(this.dealer);
      const btn = (a, label, on = true, sel = false) => '<button data-a="' + a + '"' + (on ? '' : ' disabled') + (sel ? ' class="sel"' : '') + '>' + label + '</button>';
      let controls;
      if (this.phase === 'bet') {
        controls = '<div class="row">' + [10, 25, 50].map((v) => btn('bet' + v, 'BET ' + v, this.chips >= v || v === 10, this.base === v)).join('') + '</div>'
          + '<div class="row">' + btn('deal', 'DEAL', this.chips > 0) + btn('cashout', 'CASH OUT') + '</div>';
      } else if (this.phase === 'turn') {
        controls = '<div class="row">' + btn('hit', 'HIT') + btn('stand', 'STAND') + btn('double', 'DOUBLE', this.player.length === 2 && this.chips >= this.bet) + '</div>';
      } else controls = '<div class="row"><span class="muted">Dealer plays…</span></div>';
      $('#mem').innerHTML =
        '<div class="hand"><span class="lbl">DEALER' + (this.dealer.length ? ' · ' + dTot : '') + '</span><div class="cards">'
        + this.dealer.map((c, i) => this.card(c, hide && i === 0)).join('') + '</div></div>'
        + '<p class="msg" aria-live="polite">' + this.msg + '</p>'
        + '<div class="hand"><span class="lbl">YOU' + (this.player.length ? ' · ' + this.total(this.player) : '') + ' · BET ' + this.bet + '</span><div class="cards">'
        + this.player.map((c) => this.card(c)).join('') + '</div></div>'
        + controls;
    },
    stop() { clearTimeout(this.timer); },
  };

  Arcade.register('blackjack', blackjack);
})();
