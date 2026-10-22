/* Pocket Arcade offline copy: lets the site open from the home screen and play without internet.
   It always asks the network first, so updates show up right away. The saved copy is only used when offline.
   three.js (for the 3D games) is big, so it is only saved once one of those games has been played.
   Change CACHE (v1 -> v2) only if you want every phone to throw away its saved copy. */
const CACHE = 'arcade-v1';
const GAMES = ['snake', 'runner', 'breakout', 'memory', 'pong', 'snapgrid', 'invaders', 'flappy', 'muncher', 'blackjack', 'cube', 'chase', 'ski'];
const CORE = ['./', 'css/arcade.css', 'js/arcade.js', 'js/consent.js', 'js/stats.js', 'fonts/fonts.css',
  'fonts/press-start-2p.woff2', 'fonts/ibm-plex-mono-400.woff2', 'fonts/ibm-plex-mono-600.woff2',
  'manifest.webmanifest', 'icons/icon-192.png',
  ...GAMES.map((g) => 'js/games/' + g + '.js')];
const HOME = new URL('./', self.location).href;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  // One missing file must not stop the rest from being saved.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {})))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  // Only the site's own files. Ads, stats and the leaderboard (/api/) always go straight to the internet.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const key = url.origin + url.pathname; // Saved without ?v=..., so one copy per file.
  e.respondWith(fetch(req).then((res) => {
    if (res.status === 200 && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key).then((hit) => hit || (req.mode === 'navigate' ? caches.match(HOME) : Response.error()))));
});
