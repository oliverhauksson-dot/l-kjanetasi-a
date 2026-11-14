/* Game search on the front page: typing in the box hides every game card whose name
   (or short description) doesn't match. It reads the cards straight from the page,
   so a new game card added to index.html is searchable without changing this file. */
(() => {
  const box = document.getElementById('gsearch');
  const menu = document.getElementById('menu');
  const none = document.getElementById('gnone');
  if (!box || !menu) return;

  // Lower case, no accents, and only letters and digits, so "snap-grid", "Snap Grid" and "snapgrid" all match.
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  const filter = () => {
    const words = norm(box.value).split(' ').filter(Boolean);
    let shown = 0;
    menu.querySelectorAll('[data-game]').forEach((card) => {
      const h = card.querySelector('h2'), p = card.querySelector('p');
      const name = norm(h ? h.textContent : card.dataset.game);
      const text = name + ' ' + name.replace(/ /g, '') + ' ' + norm(p ? p.textContent : '') + ' ' + card.dataset.game;
      const hit = words.every((w) => text.includes(w));
      card.hidden = !hit;
      if (hit) shown++;
    });
    document.getElementById('home').classList.toggle('searching', words.length > 0);
    none.hidden = shown > 0;
    if (shown === 0) none.querySelector('b').textContent = box.value.trim();
  };

  box.addEventListener('input', filter);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && box.value) { box.value = ''; filter(); }
    // Enter opens the first game that is still shown.
    if (e.key === 'Enter') {
      const first = menu.querySelector('[data-game]:not([hidden])');
      if (first && box.value.trim()) { e.preventDefault(); first.click(); }
    }
  });
  // Press "/" anywhere on the front page to jump to the search box.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = document.activeElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (box.offsetParent === null) return; // The front page isn't showing.
    e.preventDefault(); box.focus();
  });
  // The browser can refill the box when you come back to the page, so filter once at the start.
  filter();
})();
