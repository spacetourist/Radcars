// Single source of truth for the build name. Loaded as a classic script by index.html (sets self.RADCARS_BUILD for the
// menu label) and by sw.js via importScripts (cache name). Bump here on every release.
self.RADCARS_BUILD = { version: 'v48', name: 'missile' };
self.RADCARS_BUILD.label = `${self.RADCARS_BUILD.version} · ${self.RADCARS_BUILD.name}`;
self.RADCARS_BUILD.cache = `radcars-${self.RADCARS_BUILD.version}-${self.RADCARS_BUILD.name}`;
// Files the service worker pre-caches and the menu's hard refresh re-downloads (relative to the site root).
self.RADCARS_BUILD.assets = [
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
  './js/input.js',
  './js/career.js',
  './js/audio.js',
  './js/render.js',
  './js/ui.js',
  './js/util.js',
  './js/weapons.js',
  './js/version.js'
];

// Page bootstrap (index.html head, parser-blocking): every file URL carries ?b=<build>, module imports included via an
// import map, so a new build can never pick up a stale module from the HTTP or memory cache.
if (typeof document !== 'undefined' && document.readyState === 'loading') {
  const B = self.RADCARS_BUILD, q = `?b=${encodeURIComponent(`${B.version}-${B.name}`)}`;
  const imports = {};
  B.assets.filter((a) => a.startsWith('./js/') && a !== './js/version.js').forEach((a) => { imports[a] = a + q; });
  document.write(
    `<link rel="stylesheet" href="css/style.css${q}" />` +
    `<script type="importmap">${JSON.stringify({ imports })}<\/script>` +
    `<script type="module" src="js/main.js${q}"><\/script>`
  );
}
