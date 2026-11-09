/* Countdown badges under the "Pocket Arcade" title on the front page.
   Each one counts the days to a date, says so on the day itself, and goes away by itself a few days later.
   To add one, add a line to COUNTDOWNS. If a date moves (a game gets delayed), only the date needs changing.
   The Christmas countdown is in js/season.js, because it comes with the rest of the decorations. */
(() => {
  const COUNTDOWNS = [
    // name, release day (year, month, day), and how many days after it the badge stays up.
    { id: 'gta', icon: '🌴', name: 'GTA 6', date: [2026, 11, 19], keep: 3 },
  ];

  const row = document.getElementById('notes');
  if (!row) return;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (const c of COUNTDOWNS) {
    const day = new Date(c.date[0], c.date[1] - 1, c.date[2]);
    const days = Math.round((day - today) / 864e5);
    if (days < -c.keep) continue;
    const text = days > 1 ? days + ' days to go'
      : days === 1 ? 'out tomorrow'
      : days === 0 ? 'out today!'
      : 'out now';
    const p = document.createElement('p');
    p.className = 'note ' + c.id;
    const icon = document.createElement('b');
    icon.textContent = c.icon; icon.setAttribute('aria-hidden', 'true');
    const name = document.createElement('strong');
    name.textContent = c.name;
    p.append(icon, name, ' · ' + text);
    row.append(p);
  }
})();
