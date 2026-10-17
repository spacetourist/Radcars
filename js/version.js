// Single source of truth for the build name. Loaded as a classic script by index.html (sets self.RADCARS_BUILD for the
// menu label) and by sw.js via importScripts (cache name). Bump here on every release.
self.RADCARS_BUILD = { version: 'v54.8', name: 'drift' };
self.RADCARS_BUILD.label = `${self.RADCARS_BUILD.version} · ${self.RADCARS_BUILD.name}`;
self.RADCARS_BUILD.cache = `radcars-${self.RADCARS_BUILD.version}-${self.RADCARS_BUILD.name}`;
// Files the service worker pre-caches and the menu's hard refresh re-downloads (relative to the site root).
self.RADCARS_BUILD.assets = [
  './',
  './index.html',
  './css/style.css',
  './assets/ui/controls/controls-polish.css',            // v53.1: Graphic Designer's control chrome (CSS only)
  './assets/drift/drift-button.css',                     // v54.8: GD DRIFT button heat / tilt
  './assets/ui/controls/svg/infinity-badge.svg',
  './assets/ui/controls/fonts/BarlowCondensed-ExtraBold-ui.woff2',
  './assets/fx/fx-atlas.png',                            // v54: FX atlas (sparks, glow, ring, smoke, streak, flame)
  './assets/fx/fx-atlas.json',
  './assets/drift/drift-atlas.png',                      // v54.8: GD drift smoke puffs (Canvas + Pixi)
  './assets/drift/drift-atlas.json',
  './assets/drift/drift-skid.png',                       // v54.8: drift skid stamp brush
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
  './js/audio-engine.mjs',                               // v54.7: Audio Engineer's mixer / voices (sound files load at runtime)
  './js/render.js',
  './js/ui.js',
  './js/util.js',
  './js/weapons.js',
  './js/powerups.js',
  './js/celebrate.js',
  './js/controls.js',
  './js/icons.js',
  './js/toyart.js',
  './js/pixiRender.js',
  './js/fx.js',
  './js/trackpack.js',                                   // v54.6: track-edge pack code (its images load only on Gridlock)
  './vendor/pixi-lean.mjs',
  './js/version.js'
];
// Menu photo backdrop (v51): not precached. The page lazily loads only the pair its orientation / DPR needs and the
// service worker's runtime cache keeps whatever was actually shown, so phones never download the other variants.
self.RADCARS_BUILD.optional = [];

// Page bootstrap (index.html head, parser-blocking): every file URL carries ?b=<build>, module imports included via an
// import map, so a new build can never pick up a stale module from the HTTP or memory cache.
if (typeof document !== 'undefined' && document.readyState === 'loading') {
  const B = self.RADCARS_BUILD, q = `?b=${encodeURIComponent(`${B.version}-${B.name}`)}`;
  const imports = {};
  B.assets.filter((a) => (a.startsWith('./js/') || a.startsWith('./vendor/')) && a !== './js/version.js').forEach((a) => { imports[a] = a + q; });
  document.write(
    `<link rel="stylesheet" href="css/style.css${q}" />` +
    `<link rel="stylesheet" href="assets/ui/controls/controls-polish.css${q}" />` + // v53.1 polish layer, after style.css
    `<link rel="stylesheet" href="assets/drift/drift-button.css${q}" />` + // v54.8 GD DRIFT button (after the polish layer)
    `<script type="importmap">${JSON.stringify({ imports })}<\/script>` +
    `<script type="module" src="js/main.js${q}"><\/script>`
  );
}
