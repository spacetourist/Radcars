import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setZoomShot(page, zoom, freeze = true) {
  const got = await page.evaluate((z, fr) => {
    const g = window.__RAD_GAME__;
    const w = g && g.world;
    if (!w || !w.cam) return { ok: false, reason: 'no-world' };
    w.__shotFreeze = true;
    if (w.player) { w.player.vx = 0; w.player.vy = 0; }
    w.cam.zoom = z;
    try { if (window.__RAD_PIXI_DIRTY__) window.__RAD_PIXI_DIRTY__(); } catch (_) {}
    let drew = false;
    try {
      if (window.__RAD_PIXI__ && typeof window.__RAD_PIXI__.draw === 'function') {
        window.__RAD_PIXI__.draw(w);
        drew = true;
      }
    } catch (e) {
      return { ok: false, reason: String(e && e.message || e), zoom: w.cam.zoom };
    }
    w.__shotFreeze = !!fr;
    return { ok: true, zoom: w.cam.zoom, drew, freeze: !!w.__shotFreeze };
  }, zoom, freeze);
  console.log('setZoomShot', JSON.stringify(got));
  await sleep(50);
  await page.evaluate((z) => {
    const w = window.__RAD_GAME__ && window.__RAD_GAME__.world;
    if (!w) return;
    w.__shotFreeze = true;
    w.cam.zoom = z;
    if (window.__RAD_PIXI__ && window.__RAD_PIXI__.draw) window.__RAD_PIXI__.draw(w);
  }, zoom);
  await sleep(80);
}

const ZOOM_FAR = 0.48;

const TRACKS = [
  {
    index: 0, id: 'neon_loop',
    raceFar: '63-neon-carpet-race-far',
    gridFar: '63b-neon-carpet-grid-far'
  },
  {
    index: 1, id: 'gridlock',
    raceFar: '64-gridlock-carpet-race-far',
    gridFar: '64b-gridlock-carpet-grid-far'
  }
];

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1280,720', '--use-gl=angle', '--enable-webgl']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 300)));
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') console.log('CONSOLE', t, m.text().slice(0, 200));
});

async function fresh() {
  // Pixi opt-in for rooftop TilingSprite proofs only — not default-on
  const url = 'http://127.0.0.1:4173/index.html?pixi=1&nocache=' + Date.now();
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }).catch(() => {});
  await page.goto(url + '&r=1', { waitUntil: 'networkidle0', timeout: 90000 });
  await page.waitForFunction(() => window.__RAD_PACK_READY__ === true, { timeout: 60000 });
  await page.waitForFunction(() => window.__RAD_PIXI_READY__ === true, { timeout: 60000 });
  await page.waitForSelector('.menu-btns [data-act="single"]', { timeout: 15000 });
  const boot = await page.evaluate(() => ({
    ready: !!window.__RAD_PIXI_READY__,
    pixiDefault: new URLSearchParams(location.search).has('pixi') ? 'opt-in' : 'would-be-off',
    groundMode: window.__RAD_GROUND_MODE__ || null,
    farLock: window.__RAD_FAR_LOCK__ || null
  }));
  console.log('boot', JSON.stringify(boot));
}

const report = [];

for (const t of TRACKS) {
  await fresh();
  await page.click('.menu-btns [data-act="single"]');
  await page.waitForSelector('#tracks button.btn.primary', { timeout: 10000 });
  const buttons = await page.$$('#tracks button.btn.primary');
  console.log('track buttons', buttons.length, 'picking', t.id);
  await buttons[t.index].click();
  await sleep(2800);

  await page.waitForFunction(
    () => !!(window.__RAD_SCENERY__ && window.__RAD_SCENERY__.stampCounts),
    { timeout: 15000 }
  ).catch(() => {});

  let shotEl = await page.$('#pixi-game');
  if (!shotEl) shotEl = await page.$('#game');

  // Grid ZOOM_FAR
  await setZoomShot(page, ZOOM_FAR, true);
  await shotEl.screenshot({ path: join(OUT, t.gridFar + '.png') });
  console.log('wrote', t.gridFar);

  const meta = await page.evaluate(() => {
    const sc = window.__RAD_SCENERY__;
    const kinds = {};
    const srcKeys = {};
    let cloneHits = 0;
    const placed = [];
    if (sc) {
      for (const layer of ['far', 'mid', 'near']) {
        for (const it of (sc[layer] || [])) {
          const k = (it && it.kind) || 'other';
          kinds[k] = (kinds[k] || 0) + 1;
          const sk = it.img && (it.img._srcKey || it.img.__srcKey);
          if (sk) {
            srcKeys[sk] = (srcKeys[sk] || 0) + 1;
            for (const p of placed) {
              if (p.sk === sk && p.kind === k) {
                const d = Math.hypot(p.x - it.x, p.y - it.y);
                if (d < 400) cloneHits++;
              }
            }
            placed.push({ x: it.x, y: it.y, sk, kind: k });
          }
        }
      }
    }
    const pack = window.__RAD_PACK_INFO__ || {};
    const farLock = window.__RAD_FAR_LOCK__ || null;
    return {
      trackId: sc && sc.trackId,
      warehouseBias: sc && sc.profile && sc.profile.warehouseBias,
      cityfabricBias: sc && sc.profile && sc.profile.cityfabricBias,
      cityCircuit: sc && sc.profile && sc.profile.cityCircuit,
      stampCounts: sc && sc.stampCounts,
      warehouseAfterScrub: sc && sc.stampCounts && sc.stampCounts.warehouseAfterScrub,
      kinds,
      srcKeys,
      cloneHits400: cloneHits,
      pixi: window.__RAD_PIXI__ && window.__RAD_PIXI__.version,
      packName: pack.pack || null,
      urbanRooftop: !!(pack.scenery && pack.scenery.urbanRooftop),
      groundMode: window.__RAD_GROUND_MODE__ || (farLock && farLock.groundMode) || null,
      farLock
    };
  });
  console.log('meta', JSON.stringify(meta));
  report.push({ id: t.id, meta });

  // Race mid-straight ZOOM_FAR
  await page.evaluate(() => {
    const g = window.__RAD_GAME__;
    const w = g && g.world;
    if (!w) return;
    w.__shotFreeze = false;
    w.race.countdown = 0; w.race.live = true; w.race.goFlash = 0;
    const line = w.track.line;
    const i = (line.length * 0.38) | 0;
    const a = line[i], b = line[(i + 3) % line.length];
    if (!a || !b) return;
    w.player.x = a.x; w.player.y = a.y;
    w.player.angle = Math.atan2(b.y - a.y, b.x - a.x);
    w.player.vx = 0;
    w.player.vy = 0;
    if (Array.isArray(w.cars)) {
      for (const c of w.cars) {
        if (!c || c === w.player) continue;
        if (c.x == null) { c.x = a.x; c.y = a.y; }
      }
    }
    w.cam.x = a.x + Math.cos(w.player.angle) * 120;
    w.cam.y = a.y + Math.sin(w.player.angle) * 120;
    w.cam.zoom = 0.48;
  });
  await sleep(400);
  await setZoomShot(page, ZOOM_FAR, true);
  shotEl = await page.$('#pixi-game') || await page.$('#game');
  await shotEl.screenshot({ path: join(OUT, t.raceFar + '.png') });
  console.log('wrote', t.raceFar);

  if (t.index === 0) {
    const fps = await page.evaluate(async (zf) => {
      const g = window.__RAD_GAME__;
      const w = g && g.world;
      if (!w) return { ok: false };
      w.__shotFreeze = false;
      w.cam.zoom = zf;
      w.player.vx = 0;
      w.player.vy = 0;
      const camX = w.cam.x, camY = w.cam.y;
      const start = performance.now();
      let frames = 0;
      const dur = 2000;
      await new Promise((resolve) => {
        function tick() {
          w.cam.x = camX; w.cam.y = camY; w.cam.zoom = zf;
          frames++;
          if (performance.now() - start < dur) requestAnimationFrame(tick);
          else resolve();
        }
        requestAnimationFrame(tick);
      });
      const elapsed = (performance.now() - start) / 1000;
      w.__shotFreeze = true;
      return {
        ok: true,
        frames,
        elapsed,
        fps: frames / elapsed,
        zoom: w.cam.zoom,
        pixiReady: !!window.__RAD_PIXI_READY__,
        farLock: window.__RAD_FAR_LOCK__ || null,
        canvas: 'pixi'
      };
    }, ZOOM_FAR);
    console.log('fps', JSON.stringify(fps));
    const fl = fps.farLock || {};
    const line = fps.ok
      ? `Pixi Neon Loop ZOOM_FAR(~${Number(fps.zoom).toFixed(2)}) mid-straight: ~${fps.fps.toFixed(1)} FPS over ${fps.elapsed.toFixed(2)}s (${fps.frames} frames). FAR lock v40 padWu=${fl.padWu} tileScale ${fl.tileScaleBefore}->${fl.tileScaleAfter}.`
      : 'Pixi FPS measure failed.';
    writeFileSync(join(OUT, '63-far-lock-fps.txt'), line + '\n');
    report.push({ fps, fpsLine: line });
  }
}

writeFileSync(join(OUT, '63-far-lock-meta.json'), JSON.stringify(report, null, 2));
await browser.close();
console.log('done');
