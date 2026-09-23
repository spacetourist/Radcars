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
  await new Promise((r) => setTimeout(r, 50));
  // One more forced draw after rAF in case texture upload lags
  await page.evaluate((z) => {
    const w = window.__RAD_GAME__ && window.__RAD_GAME__.world;
    if (!w) return;
    w.__shotFreeze = true;
    w.cam.zoom = z;
    if (window.__RAD_PIXI__ && window.__RAD_PIXI__.draw) window.__RAD_PIXI__.draw(w);
  }, zoom);
  await new Promise((r) => setTimeout(r, 80));
}

const ZOOM_FAR = 0.48;

const TRACKS = [
  {
    index: 0, id: 'neon_loop',
    race: '61-neon-carpet-race', grid: '61b-neon-carpet-grid',
    raceFar: '61-neon-carpet-race-far', gridFar: '61b-neon-carpet-grid-far'
  },
  {
    index: 1, id: 'gridlock',
    race: '62-gridlock-carpet-race', grid: '62b-gridlock-carpet-grid',
    raceFar: '62-gridlock-carpet-race-far', gridFar: '62b-gridlock-carpet-grid-far'
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
  const pixi = await page.evaluate(() => ({
    ready: !!window.__RAD_PIXI_READY__,
    ver: window.__RAD_PIXI__ && window.__RAD_PIXI__.version,
    canvas: !!document.getElementById('pixi-game'),
    pack: window.__RAD_PACK_INFO__ && {
      urbanLot: window.__RAD_PACK_INFO__.scenery && window.__RAD_PACK_INFO__.scenery.urbanLot,
      cityfabricRow: window.__RAD_PACK_INFO__.scenery && window.__RAD_PACK_INFO__.scenery.cityfabricRow,
      stampSizes: window.__RAD_PACK_INFO__.stampSizes
    }
  }));
  console.log('pixi boot', JSON.stringify(pixi));
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

  await page.waitForFunction(() => !!(window.__RAD_SCENERY__ && window.__RAD_SCENERY__.stampCounts), { timeout: 15000 }).catch(() => {});

  let shotEl = await page.$('#pixi-game');
  if (!shotEl) shotEl = await page.$('#game');

  // Grid near (~1.0)
  await setZoomShot(page, 1.0, true);
  await shotEl.screenshot({ path: join(OUT, t.grid + '.png') });
  console.log('wrote', t.grid);

  // Grid ZOOM_FAR
  await setZoomShot(page, ZOOM_FAR, true);
  await shotEl.screenshot({ path: join(OUT, t.gridFar + '.png') });
  console.log('wrote', t.gridFar);

  const meta = await page.evaluate(() => {
    const sc = window.__RAD_SCENERY__;
    const g = window.__RAD_GAME__;
    const w = g && g.world;
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
    let trackWidth = null;
    if (w && w.track && w.track.line && w.track.outer && w.track.inner) {
      const track = w.track;
      function distSeg(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy || 1;
        let t = ((px - ax) * dx + (py - ay) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      function distPoly(px, py, poly) {
        let b = Infinity;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], c = poly[(i + 1) % poly.length];
          const d = distSeg(px, py, a.x, a.y, c.x, c.y);
          if (d < b) b = d;
        }
        return b;
      }
      const widths = track.line.map((p) => distPoly(p.x, p.y, track.outer) + distPoly(p.x, p.y, track.inner));
      const min = Math.min(...widths), max = Math.max(...widths);
      const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
      trackWidth = { min, max, avg, ratio: max / min, note: 'outer/inner roughly parallel (constant-ish width)' };
    }
    const pack = window.__RAD_PACK_INFO__ || {};
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
      stampSizes: pack.stampSizes || null,
      packName: pack.pack || null,
      urbanRooftop: !!(pack.scenery && pack.scenery.urbanRooftop),
      groundMode: window.__RAD_GROUND_MODE__ || null,
      trackWidth
    };
  });
  console.log('meta', JSON.stringify(meta));
  report.push({ id: t.id, meta });

  // Race mid-straight near
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
    // Null-safe AI cars (PAGEERR guard)
    if (Array.isArray(w.cars)) {
      for (const c of w.cars) {
        if (!c) continue;
        if (c === w.player) continue;
        if (c.x == null) { c.x = a.x; c.y = a.y; }
      }
    }
    w.cam.x = a.x + Math.cos(w.player.angle) * 120;
    w.cam.y = a.y + Math.sin(w.player.angle) * 120;
    w.cam.zoom = 1.0;
  });
  await sleep(400);
  await setZoomShot(page, 1.0, true);
  shotEl = await page.$('#pixi-game') || await page.$('#game');
  await shotEl.screenshot({ path: join(OUT, t.race + '.png') });
  console.log('wrote', t.race);

  // Race ZOOM_FAR
  await setZoomShot(page, ZOOM_FAR, true);
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
        canvas: 'pixi'
      };
    }, ZOOM_FAR);
    console.log('fps', JSON.stringify(fps));
    const line = fps.ok
      ? `Pixi Neon Loop ZOOM_FAR(~${Number(fps.zoom).toFixed(2)}) mid-straight: ~${fps.fps.toFixed(1)} FPS over ${fps.elapsed.toFixed(2)}s (${fps.frames} frames, cam locked / frozen pose). City carpet v39 (fabric uncapped + rooftop).`
      : 'Pixi FPS measure failed.';
    writeFileSync(join(OUT, '61-carpet-fps.txt'), line + '\n');
    report.push({ fps, fpsLine: line });
  }
}

writeFileSync(join(OUT, '61-carpet-meta.json'), JSON.stringify(report, null, 2));
await browser.close();
console.log('done');
