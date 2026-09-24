import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ZOOM_FAR = 0.24;
const ZOOM_MID = 0.55; // mid-speed feel between near and far

async function setCamShot(page, { zoom, look = 0, freeze = true }) {
  const got = await page.evaluate((z, lookAhead, fr) => {
    const g = window.__RAD_GAME__;
    const w = g && g.world;
    if (!w || !w.cam || !w.player) return { ok: false, reason: 'no-world' };
    w.__shotFreeze = true;
    w.player.vx = 0; w.player.vy = 0;
    const ang = w.player.angle;
    w.cam.x = w.player.x + Math.cos(ang) * lookAhead;
    w.cam.y = w.player.y + Math.sin(ang) * lookAhead;
    w.cam.zoom = z;
    try { if (window.__RAD_PIXI_DIRTY__) window.__RAD_PIXI_DIRTY__(); } catch (_) {}
    let drew = false;
    try {
      if (window.__RAD_PIXI__ && typeof window.__RAD_PIXI__.draw === 'function') {
        window.__RAD_PIXI__.draw(w);
        drew = true;
      }
    } catch (e) {
      return { ok: false, reason: String(e && e.message || e) };
    }
    w.__shotFreeze = !!fr;
    return {
      ok: true, zoom: w.cam.zoom, look: lookAhead, drew,
      px: w.player.x, py: w.player.y, cx: w.cam.x, cy: w.cam.y, ang
    };
  }, zoom, look, freeze);
  console.log('setCamShot', JSON.stringify(got));
  await sleep(120);
}

const TRACKS = [
  {
    index: 0, id: 'neon_loop',
    mid: '69-neon-long-chase-mid',
    far: '69b-neon-long-chase-far',
    grid: '69c-neon-long-chase-grid'
  },
  {
    index: 1, id: 'gridlock',
    mid: '70-gridlock-long-chase-mid',
    far: '70b-gridlock-long-chase-far',
    grid: '70c-gridlock-long-chase-grid'
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
  const boot = await page.evaluate(() => ({
    ready: !!window.__RAD_PIXI_READY__,
    groundMode: window.__RAD_GROUND_MODE__ || null,
    farLock: window.__RAD_FAR_LOCK__ || null,
    sw: (navigator.serviceWorker && navigator.serviceWorker.controller) ? 'ctrl' : 'none'
  }));
  console.log('boot', JSON.stringify(boot));
}

const report = { pass: 'long-chase-v43', sw: 'radcars-v43-long-chase', tracks: [], fps: null };

for (const t of TRACKS) {
  await fresh();
  await page.click('.menu-btns [data-act="single"]');
  await page.waitForSelector('#tracks button.btn.primary', { timeout: 10000 });
  const buttons = await page.$$('#tracks button.btn.primary');
  console.log('track buttons', buttons.length, 'picking', t.id);
  await buttons[t.index].click();
  await sleep(3200);

  await page.waitForFunction(
    () => !!(window.__RAD_SCENERY__ && window.__RAD_SCENERY__.stampCounts),
    { timeout: 20000 }
  ).catch(() => {});

  let shotEl = await page.$('#pixi-game');
  if (!shotEl) shotEl = await page.$('#game');

  // Grid overview at ZOOM_FAR (shows longer layout)
  await setCamShot(page, { zoom: ZOOM_FAR, look: 0, freeze: true });
  await shotEl.screenshot({ path: join(OUT, t.grid + '.png') });
  console.log('wrote', t.grid);

  const meta = await page.evaluate(() => {
    const sc = window.__RAD_SCENERY__;
    const w = window.__RAD_GAME__ && window.__RAD_GAME__.world;
    const track = w && w.track;
    let lap = 0;
    if (track && track.line) {
      for (let i = 0; i < track.line.length; i++) {
        const a = track.line[i], b = track.line[(i + 1) % track.line.length];
        lap += Math.hypot(b.x - a.x, b.y - a.y);
      }
    }
    return {
      trackId: track && track.id,
      world: track ? [track.width, track.height] : null,
      lineN: track && track.line && track.line.length,
      cps: track && track.checkpoints && track.checkpoints.length,
      cpR: track && track.cpHitRadius,
      lap: Math.round(lap),
      stampCounts: sc && sc.stampCounts,
      warehouseAfterScrub: sc && sc.stampCounts && sc.stampCounts.warehouseAfterScrub,
      farLock: window.__RAD_FAR_LOCK__ || null,
      groundMode: window.__RAD_GROUND_MODE__ || null
    };
  });
  console.log('meta', JSON.stringify(meta));
  report.tracks.push({ id: t.id, meta });

  // Place player mid-straight facing travel, race live
  await page.evaluate(() => {
    const g = window.__RAD_GAME__;
    const w = g && g.world;
    if (!w) return;
    w.__shotFreeze = false;
    w.race.countdown = 0; w.race.live = true; w.race.goFlash = 0;
    const line = w.track.line;
    const i = (line.length * 0.38) | 0;
    const a = line[i], b = line[(i + 5) % line.length];
    w.player.x = a.x; w.player.y = a.y;
    w.player.angle = Math.atan2(b.y - a.y, b.x - a.x);
    w.player.vx = 0; w.player.vy = 0;
    if (Array.isArray(w.cars)) {
      for (const c of w.cars) {
        if (!c || c === w.player) continue;
        c.x = a.x - Math.cos(w.player.angle) * (80 + Math.random() * 40);
        c.y = a.y - Math.sin(w.player.angle) * (80 + Math.random() * 40);
        c.angle = w.player.angle;
      }
    }
  });
  await sleep(200);

  shotEl = await page.$('#pixi-game') || await page.$('#game');

  // Mid-speed: moderate zoom + look-ahead rear bias
  await setCamShot(page, { zoom: ZOOM_MID, look: 420, freeze: true });
  await shotEl.screenshot({ path: join(OUT, t.mid + '.png') });
  console.log('wrote', t.mid);

  // High-speed FAR: full zoom-out + max look-ahead rear bias
  await setCamShot(page, { zoom: ZOOM_FAR, look: 780, freeze: true });
  await shotEl.screenshot({ path: join(OUT, t.far + '.png') });
  console.log('wrote', t.far);

  if (t.index === 0) {
    const fps = await page.evaluate(async (zf) => {
      const g = window.__RAD_GAME__;
      const w = g && g.world;
      if (!w) return { ok: false };
      w.__shotFreeze = false;
      w.cam.zoom = zf;
      w.player.vx = 0; w.player.vy = 0;
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
      ? `Pixi Neon Loop ZOOM_FAR(~${Number(fps.zoom).toFixed(2)}) mid-straight: ~${fps.fps.toFixed(1)} FPS over ${fps.elapsed.toFixed(2)}s (${fps.frames} frames). Long-chase v43 padWu=${fl.padWu} tileScale=${fl.tileScaleAfter} dualLayer=${fl.dualLayer}.`
      : 'Pixi FPS measure failed.';
    writeFileSync(join(OUT, '69-long-chase-fps.txt'), line + '\n');
    report.fps = { ...fps, fpsLine: line };
  }
}

writeFileSync(join(OUT, '69-long-chase-meta.json'), JSON.stringify(report, null, 2));
await browser.close();
console.log('done');
