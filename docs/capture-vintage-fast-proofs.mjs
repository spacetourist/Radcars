import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ZOOM_FAR = 0.24;

async function setCam(page, { zoom, look = 420 }) {
  return page.evaluate((z, lookAhead) => {
    const g = window.__RAD_GAME__;
    const w = g && g.world;
    if (!w || !w.cam || !w.player) return { ok: false };
    w.__shotFreeze = true;
    w.player.vx = 0; w.player.vy = 0;
    const ang = w.player.angle;
    w.cam.x = w.player.x + Math.cos(ang) * lookAhead;
    w.cam.y = w.player.y + Math.sin(ang) * lookAhead;
    w.cam.zoom = z;
    try { if (window.__RAD_PIXI_DIRTY__) window.__RAD_PIXI_DIRTY__(); } catch (_) {}
    return { ok: true, zoom: w.cam.zoom, cx: w.cam.x, cy: w.cam.y };
  }, zoom, look);
}

async function measureFps(page, seconds = 2.5) {
  return page.evaluate(async (secs) => {
    const g = window.__RAD_GAME__;
    const w = g && g.world;
    if (w) {
      w.__shotFreeze = false;
      w.race.countdown = 0;
      w.race.live = true;
      // gentle forward motion so chase cam stays FAR
      const ang = w.player.angle;
      w.player.vx = Math.cos(ang) * 1.1;
      w.player.vy = Math.sin(ang) * 1.1;
      w.cam.zoom = 0.24;
    }
    const t0 = performance.now();
    let frames = 0;
    await new Promise((resolve) => {
      function tick(now) {
        frames++;
        if (now - t0 >= secs * 1000) return resolve();
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    const dt = (performance.now() - t0) / 1000;
    const fps = frames / dt;
    if (w) w.__shotFreeze = true;
    return {
      fps: Math.round(fps * 10) / 10,
      frames,
      dt: Math.round(dt * 100) / 100,
      zoom: w && w.cam && w.cam.zoom,
      ground: window.__RAD_GROUND_MODE__ || null,
      vintage: window.__RAD_VINTAGE_FAST__ || null,
      scenery: window.__RAD_SCENERY__ && window.__RAD_SCENERY__.stampCounts
        ? window.__RAD_SCENERY__.stampCounts
        : null,
      pack: window.__RAD_PACK_INFO__ ? {
        pack: window.__RAD_PACK_INFO__.pack,
        vintageReady: window.__RAD_PACK_INFO__.vintageReady,
        vintageProps: window.__RAD_PACK_INFO__.vintageProps
      } : null
    };
  }, seconds);
}

const TRACKS = [
  { index: 0, id: 'neon_loop', race: '71-neon-vintage-fast-race-far', grid: '71b-neon-vintage-fast-grid-far' },
  { index: 1, id: 'gridlock', race: '72-gridlock-vintage-fast-race-far', grid: '72b-gridlock-vintage-fast-grid-far' }
];

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1280,720', '--use-gl=angle', '--enable-webgl']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 400)));

async function fresh(pixi) {
  const flag = pixi ? 'pixi=1' : 'pixi=0';
  const url = `http://127.0.0.1:4173/index.html?${flag}&nocache=` + Date.now();
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }).catch(() => {});
  await page.goto(url + '&r=1', { waitUntil: 'networkidle0', timeout: 90000 });
  await page.waitForFunction(() => window.__RAD_PACK_READY__ === true, { timeout: 60000 });
  if (pixi) {
    await page.waitForFunction(() => window.__RAD_PIXI_READY__ === true, { timeout: 60000 }).catch(() => {});
  }
  await page.waitForSelector('.menu-btns [data-act="single"]', { timeout: 15000 });
}

const report = { pass: 'vintage-fast-v44', sw: 'radcars-v44-vintage-fast', paths: [], fps: {} };

for (const mode of [{ pixi: false, tag: 'canvas' }, { pixi: true, tag: 'pixi' }]) {
  for (const t of TRACKS) {
    await fresh(mode.pixi);
    await page.click('.menu-btns [data-act="single"]');
    await page.waitForSelector('#tracks button.btn.primary', { timeout: 10000 });
    const buttons = await page.$$('#tracks button.btn.primary');
    await buttons[t.index].click();
    await sleep(900);

    // Grid FAR shot
    await page.evaluate(() => {
      const w = window.__RAD_GAME__ && window.__RAD_GAME__.world;
      if (w) { w.race.countdown = 3; w.race.live = false; }
    });
    await setCam(page, { zoom: ZOOM_FAR, look: 200 });
    await sleep(150);
    const gridName = `${t.grid}-${mode.tag}`;
    await page.screenshot({ path: join(OUT, gridName + '.png') });
    report.paths.push(gridName + '.png');

    // Race mid-straight FAR + FPS
    await page.evaluate(() => {
      const w = window.__RAD_GAME__ && window.__RAD_GAME__.world;
      if (!w) return;
      w.race.countdown = 0; w.race.live = true; w.race.goFlash = 0;
      // teleport toward a mid-straight bead if any
      const line = w.track && w.track.line;
      if (line && line.length > 20) {
        const p = line[(line.length * 0.35) | 0];
        w.player.x = p.x; w.player.y = p.y;
        const n = line[(((line.length * 0.35) | 0) + 1) % line.length];
        w.player.angle = Math.atan2(n.y - p.y, n.x - p.x);
      }
    });
    await setCam(page, { zoom: ZOOM_FAR, look: 520 });
    await sleep(120);
    const raceName = `${t.race}-${mode.tag}`;
    await page.screenshot({ path: join(OUT, raceName + '.png') });
    report.paths.push(raceName + '.png');

    const fps = await measureFps(page, 2.5);
    const key = `${t.id}-${mode.tag}`;
    report.fps[key] = fps;
    const txt = [
      `track=${t.id} renderer=${mode.tag}`,
      `fps=${fps.fps} frames=${fps.frames} dt=${fps.dt}s zoom=${fps.zoom}`,
      `ground=${JSON.stringify(fps.ground)}`,
      `vintage=${JSON.stringify(fps.vintage)}`,
      `stamps=${JSON.stringify(fps.scenery)}`,
      `pack=${JSON.stringify(fps.pack)}`
    ].join('\n') + '\n';
    writeFileSync(join(OUT, `${t.race}-${mode.tag}-fps.txt`), txt);
    console.log('FPS', key, fps.fps, 'stamps', fps.scenery && fps.scenery.roadsideTotal, 'ground', fps.ground);
  }
}

writeFileSync(join(OUT, '71-vintage-fast-report.json'), JSON.stringify(report, null, 2));
console.log('REPORT', JSON.stringify(report, null, 2));
await browser.close();
