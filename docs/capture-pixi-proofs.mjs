import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TRACKS = [
  { index: 0, id: 'neon_loop', race: '57-neon-pixi-race', grid: '57b-neon-pixi-grid' },
  { index: 1, id: 'gridlock', race: '58-gridlock-pixi-race', grid: '58b-gridlock-pixi-grid' }
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
    canvas: !!document.getElementById('pixi-game')
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

  // Prefer Pixi canvas for screenshots
  let shotEl = await page.$('#pixi-game');
  if (!shotEl) shotEl = await page.$('#game');

  await shotEl.screenshot({ path: join(OUT, t.grid + '.png') });
  console.log('wrote', t.grid);

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
    return {
      trackId: sc && sc.trackId,
      warehouseBias: sc && sc.profile && sc.profile.warehouseBias,
      cityCircuit: sc && sc.profile && sc.profile.cityCircuit,
      stampCounts: sc && sc.stampCounts,
      kinds,
      srcKeys,
      cloneHits400: cloneHits,
      pixi: window.__RAD_PIXI__ && window.__RAD_PIXI__.version
    };
  });
  console.log('meta', JSON.stringify(meta));
  report.push({ id: t.id, meta });

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
    w.cam.zoom = 0.60;
    w.__shotFreeze = true;
  });
  await sleep(600);
  shotEl = await page.$('#pixi-game') || await page.$('#game');
  await shotEl.screenshot({ path: join(OUT, t.race + '.png') });
  console.log('wrote', t.race);

  if (t.index === 0) {
    const fps = await page.evaluate(async () => {
      const g = window.__RAD_GAME__;
      const w = g && g.world;
      if (!w) return { ok: false };
      w.__shotFreeze = false;
      w.cam.zoom = 0.60;
      // cam locked / frozen pose: kill velocity
      w.player.vx = 0;
      w.player.vy = 0;
      const camX = w.cam.x, camY = w.cam.y;
      const start = performance.now();
      let frames = 0;
      const dur = 2000;
      await new Promise((resolve) => {
        function tick() {
          // re-lock cam each frame
          w.cam.x = camX; w.cam.y = camY; w.cam.zoom = 0.60;
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
    });
    console.log('fps', JSON.stringify(fps));
    const line = fps.ok
      ? `Pixi Neon Loop ZOOM_FAR(~${Number(fps.zoom).toFixed(2)}) mid-straight: ~${fps.fps.toFixed(1)} FPS over ${fps.elapsed.toFixed(2)}s (${fps.frames} frames, cam locked / frozen pose). vs Canvas A.1 ~23.1 FPS.`
      : 'Pixi FPS measure failed.';
    writeFileSync(join(OUT, '55-pixi-fps.txt'), line + '\n');
    report.push({ fps, fpsLine: line });
  }
}

writeFileSync(join(OUT, '57-pixi-meta.json'), JSON.stringify(report, null, 2));
await browser.close();
console.log('done');
