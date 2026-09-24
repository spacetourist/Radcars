const CACHE = 'radcars-v44-vintage-fast';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/main.js',
  './js/game.js',
  './js/physics.js',
  './js/tracks.js',
  './js/cars.js',
  './js/ai.js',
  './js/weapons.js',
  './js/input.js',
  './js/shop.js',
  './js/career.js',
  './js/difficulty.js',
  './js/audio.js',
  './js/render.js',
  './js/ui.js',
  './js/util.js',
  './js/sprites.js',
  './js/scenery.js',
  './js/assetPack.js',
  './js/pixiRender.js',
  './vendor/pixi.min.mjs',
  './assets/generated/manifest.json',
  './assets/generated/vintage/car-cyan.png',
  './assets/generated/vintage/car-pink.png',
  './assets/generated/vintage/car-lime.png',
  './assets/generated/vintage/barrier-tyre.png',
  './assets/generated/vintage/cone.png',
  './assets/generated/vintage/lamp.png',
  './assets/generated/vintage/tree.png',
  './assets/generated/vintage/billboard.png',
  './assets/generated/vintage/chequer-gantry.png',
  './assets/generated/vintage/kerb-stripe.png',
  './assets/generated/bg/bg-skyline-horizon.png',
  './assets/generated/cars/car-cyan.png',
  './assets/generated/cars/car-pink.png',
  './assets/generated/cars/car-lime.png',
  './assets/generated/cars/car-yellow.png',
  './assets/generated/cars/car-magenta.png',
  './assets/generated/cars/car-orange.png',
  './assets/generated/cars/car-sky.png',
  './assets/generated/cars/car-white.png',
  './assets/generated/scenery/scenery-warehouse.png',
  './assets/generated/scenery/scenery-grandstand.png',
  './assets/generated/scenery/scenery-tower.png',
  './assets/generated/scenery/scenery-crowd.png',
  './assets/generated/scenery/scenery-grandstand-large.png',
  './assets/generated/scenery/scenery-crowd-dense.png',
  './assets/generated/scenery/scenery-tyrewall.png',
  './assets/generated/scenery/scenery-props.png',
  './assets/generated/scenery/scenery-palms.png',
  './assets/generated/scenery/scenery-billboard.png',
  './assets/generated/scenery/scenery-crane.png',
  './assets/generated/scenery/scenery-containers.png',
  './assets/generated/scenery/scenery-cityblock.png',
  './assets/generated/scenery/scenery-citystreet.png',
  './assets/generated/scenery/scenery-cityblock-b.png',
  './assets/generated/scenery/scenery-citystreet-b.png',
  './assets/generated/scenery/scenery-cityblock-c.png',
  './assets/generated/scenery/scenery-citystreet-c.png',
  './assets/generated/scenery/scenery-cityfabric-row.png',
  './assets/generated/scenery/scenery-cityfabric-row-b.png',
  './assets/generated/scenery/scenery-cityfabric-row-c.png',
  './assets/generated/tex-asphalt.png',
  './assets/generated/tex-urban-lot-tile.png',
  './assets/generated/tex-urban-rooftop-fill.png',
  './assets/generated/tex-urban-rooftop-fill-v51.png',
  './assets/generated/tex-urban-rooftop-fill-v51b.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => cached)
    )
  );
});
