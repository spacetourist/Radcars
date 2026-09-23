import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ZOOM_FAR = 0.48;

const TRACKS = [
  {
    index: 0, id: 'neon_loop',
    race: '59-neon-contiguous-race', grid: '59b-neon-contiguous-grid',
    raceFar: '59-neon-contiguous-race-far', gridFar: '59b-neon-contiguous-grid-far'
  },
  {
    index: 1, id: 'gridlock',
    race: '60-gridlock-contiguous-race', grid: '60b-gridlock-contiguous-grid',
    raceFar: '60-gridlock-contiguous-race-far', gridFar: '60b-gridlock-contiguous-grid-far'
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
  await page.evaluate(() => {
    const g = window.__RAD_GAME__;
    const w = g && g.world;
    if (!w) return;
    w.cam.zoom = 1.0;
    w.__shotFreeze = true;
  });
  await sleep(250);
  await shotEl.screenshot({ path: join(OUT, t.grid + '.png') });
  console.log('wrote', t.grid);

  // Grid ZOOM_FAR
  await page.evaluate((zf) => {
    const g = window.__RAD_GAME__;
    const w = g && g.world;
    if (!w) return;
    w.cam.zoom = zf;
    w.__shotFreeze = true;
  }, ZOOM_FAR);
  await sleep(300);
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
    w.race.countdown = 0; w.race.live = true; w.race.goFlash = 0;
    const line = w.track.line;
    const i = (line.length * 0.38) | 0;
    const a = line[i], b = line[(i + 3) % line.length];
    w.player.x = a.x; w.player.y = a.y;
    w.player.angle = Math.atan2(b.y - a.y, b.x - a.x);
    w.player.vx = Math.cos(w.player.angle) * 0.9;
    w.player.vy = Math.sin(w.player.angle) * 0.9;
    w.cam.x = a.x + Math.cos(w.player.angle) * 120;
    w.cam.y = a.y + Math.sin(w.player.angle) * 120;
    w.cam.zoom = 1.0;
    w.__shotFreeze = true;
  });
  await sleep(600);
  shotEl = await page.$('#pixi-game') || await page.$('#game');
  await shotEl.screenshot({ path: join(OUT, t.race + '.png') });
  console.log('wrote', t.race);

  // Race ZOOM_FAR
  await page.evaluate((zf) => {
    const g = window.__RAD_GAME__;
    const w = g && g.world;
    if (!w) return;
    w.cam.zoom = zf;
    w.__shotFreeze = true;
  }, ZOOM_FAR);
  await sleep(350);
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
      ? `Pixi Neon Loop ZOOM_FAR(~${Number(fps.zoom).toFixed(2)}) mid-straight: ~${fps.fps.toFixed(1)} FPS over ${fps.elapsed.toFixed(2)}s (${fps.frames} frames, cam locked / frozen pose). Contiguous city v4.`
      : 'Pixi FPS measure failed.';
    writeFileSync(join(OUT, '59-contiguous-fps.txt'), line + '\n');
    report.push({ fps, fpsLine: line });
  }
}

writeFileSync(join(OUT, '59-contiguous-meta.json'), JSON.stringify(report, null, 2));
await browser.close();
console.log('done');
