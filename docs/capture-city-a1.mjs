import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TRACKS = [
  { index: 0, id: 'neon_loop', race: '55-neon-a1-race', grid: '55b-neon-a1-grid' },
  { index: 1, id: 'gridlock', race: '56-gridlock-a1-race', grid: '56b-gridlock-a1-grid' }
];

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,720']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 200)));

async function fresh() {
  const url = 'http://127.0.0.1:4173/index.html?nocache=' + Date.now();
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }).catch(() => {});
  await page.goto(url + '&r=1', { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => window.__RAD_PACK_READY__ === true, { timeout: 40000 });
  await page.waitForSelector('.menu-btns [data-act="single"]', { timeout: 15000 });
}

const report = [];

for (const t of TRACKS) {
  await fresh();
  const info = await page.evaluate(() => window.__RAD_PACK_INFO__ || null);
  console.log('pack', t.id, info && info.pack, JSON.stringify(info && info.scenery));
  console.log('stampSizes', JSON.stringify(info && info.stampSizes));

  await page.click('.menu-btns [data-act="single"]');
  await page.waitForSelector('#tracks button.btn.primary', { timeout: 10000 });
  const buttons = await page.$$('#tracks button.btn.primary');
  console.log('track buttons', buttons.length);
  await buttons[t.index].click();
  await sleep(2200);

  // Wait scenery built
  await page.waitForFunction(() => !!(window.__RAD_SCENERY__ && window.__RAD_SCENERY__.stampCounts), { timeout: 10000 }).catch(() => {});

  const canvas = await page.$('#game');
  await canvas.screenshot({ path: join(OUT, t.grid + '.png') });
  console.log('wrote', t.grid);

  const meta = await page.evaluate(() => {
    const sc = window.__RAD_SCENERY__;
    const kinds = {};
    const byLayer = { far: {}, mid: {}, near: {} };
    if (sc) {
      for (const layer of ['far', 'mid', 'near']) {
        for (const it of (sc[layer] || [])) {
          const k = (it && it.kind) || 'other';
          kinds[k] = (kinds[k] || 0) + 1;
          byLayer[layer][k] = (byLayer[layer][k] || 0) + 1;
        }
      }
    }
    return {
      trackId: sc && sc.trackId,
      warehouseBias: sc && sc.profile && sc.profile.warehouseBias,
      cityCircuit: sc && sc.profile && sc.profile.cityCircuit,
      stampCounts: sc && sc.stampCounts,
      kinds,
      byLayer,
      pools: {
        cityblockMd: sc && sc.sprites && sc.sprites.buildings && (sc.sprites.buildings.cityblockMd || []).length,
        citystreetMd: sc && sc.sprites && sc.sprites.buildings && (sc.sprites.buildings.citystreetMd || []).length
      }
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
  await sleep(500);
  await canvas.screenshot({ path: join(OUT, t.race + '.png') });
  console.log('wrote', t.race);

  if (t.index === 0) {
    const fps = await page.evaluate(async () => {
      const g = window.__RAD_GAME__;
      const w = g && g.world;
      if (!w) return { ok: false };
      w.__shotFreeze = false;
      w.cam.zoom = 0.60;
      w.player.vx *= 0.1;
      w.player.vy *= 0.1;
      const start = performance.now();
      let frames = 0;
      const dur = 2000;
      await new Promise((resolve) => {
        function tick(ts) {
          frames++;
          if (performance.now() - start < dur) requestAnimationFrame(tick);
          else resolve();
        }
        requestAnimationFrame(tick);
      });
      const elapsed = (performance.now() - start) / 1000;
      w.__shotFreeze = true;
      return { ok: true, frames, elapsed, fps: frames / elapsed, zoom: w.cam.zoom };
    });
    console.log('fps', JSON.stringify(fps));
    const line = fps.ok
      ? `Neon Loop ZOOM_FAR(~${Number(fps.zoom).toFixed(2)}) mid-straight: ~${fps.fps.toFixed(1)} FPS over ${fps.elapsed.toFixed(2)}s (${fps.frames} frames, cam locked / low velocity).`
      : 'FPS measure failed.';
    writeFileSync(join(OUT, '55-fps.txt'), line + '\n');
    report.push({ fps, fpsLine: line });
  }
}

writeFileSync(join(OUT, '55-a1-meta.json'), JSON.stringify(report, null, 2));
await browser.close();
console.log('done');
