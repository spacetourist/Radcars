importScripts('./js/version.js');
const CACHE = self.RADCARS_BUILD.cache; // e.g. 'radcars-v48-missile' (js/version.js is the single source of truth)
const ASSETS = self.RADCARS_BUILD.assets;

// Updates: the new worker activates at once (skipWaiting + clients.claim) and the page reloads itself when it isn't mid-race
// (js/main.js). Same-origin requests go network-first with cache:'no-store' so the browser's HTTP cache can never serve an
// old build; the Cache Storage copy is only the offline fallback.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  const net = req.mode === 'navigate' ? fetch(url.href, { cache: 'no-store', credentials: 'same-origin' })
    : same ? fetch(req, req.cache === 'reload' ? undefined : { cache: 'no-store' }) // 'reload' = hard refresh re-priming the HTTP cache
    : fetch(req);
  e.respondWith(
    net.then((res) => {
      if (same && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
