/**
 * Radcars v51 'toys-pixi' verification: toy (Micro Machines) car art + tabletop track look.
 *   node docs/verify-v51.mjs [url] [outDir] [mode=all|fps|shots] [tracks=neon,gridlock,razor,cargo]
 *
 * FPS: Pixi (default) vs the Canvas fallback (?canvas=1) on Neon + Gridlock, bot-driven, desktop 1280×720
 *      (DPR 1) and phone 844×390 (DPR 2, touch), at the close race zoom (0.85) and the far chase zoom (≈0.24), each 6 s at normal CPU
 *      and with 4× CPU throttling (a weak-phone proxy). Reports rAF fps plus the JS cost of each frame.
 * SHOTS (docs/shots/79-*): grid close-up of the pack per track, player close-up, mid-race corner,
 *      phone layout, spin / boost-flame / green-flame / autopilot overlays on the new cars, plus a
 *      nose-vs-road check (every car's drawn heading vs the track tangent) on each grid and corner frame.
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:4173/';
const outDir = process.argv[3] || new URL('./shots', import.meta.url).pathname;
const mode = process.argv[4] || 'all';
const ALL = ['neon', 'gridlock', 'razor', 'cargo'];
const tracks = (process.argv[5] || ALL.join(',')).split(',').filter((t) => ALL.includes(t));
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = [];
const log = (s) => { console.log(s); lines.push(s); };
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; log(`    [${ok ? 'ok' : 'FAIL'}] ${msg}`); return ok; };

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
function watchErrors(page, errs) {
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  page.on('requestfailed', (r) => errs.push('REQFAIL ' + r.url()));
}

/** Times every rAF callback (the game loop draws inside one) so the per-frame JS + canvas command cost is visible. */
const RAF_HOOK = () => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__ft = []; window.__frames = 0;
  window.requestAnimationFrame = (cb) => raf((t) => { const t0 = performance.now(); cb(t); const d = performance.now() - t0; if (window.__ftOn) { window.__ft.push(d); } });
  const fr = () => { window.__frames++; raf(fr); }; raf(fr);
};

async function install(page) {
  await page.evaluate(async () => {
    const { pointAt } = await import('./js/tracks.js');
    const { angleDiff } = await import('./js/util.js');
    const held = new Set();
    const set = (k, on) => { if (on && !held.has(k)) { held.add(k); window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); } else if (!on && held.has(k)) { held.delete(k); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); } };
    window.__botOn = true;
    window.__bot = setInterval(() => {
      const w = window.__RAD_GAME__.world; if (!w || w.race.countdown > 0) return; const p = w.player;
      if (!window.__botOn) { ['ArrowUp', 'ArrowLeft', 'ArrowRight'].forEach((k) => set(k, false)); return; }
      const spd = Math.hypot(p.vx, p.vy);
      const tp = pointAt(w.track, p.sPrev + 150 + spd * 0.35);
      const err = angleDiff(p.angle, Math.atan2(tp.y - p.y, tp.x - p.x));
      set('ArrowRight', err > 0.05); set('ArrowLeft', err < -0.05);
      set('ArrowUp', !(Math.abs(err) > 0.7 && spd > 500));
    }, 30);
    window.__botStop = () => { clearInterval(window.__bot); ['ArrowUp', 'ArrowLeft', 'ArrowRight'].forEach((k) => set(k, false)); };
  });
}
async function startRace(page, ti) {
  await page.click('[data-act=race]');
  await page.waitForSelector('#tracks button');
  await page.evaluate((ti) => document.querySelectorAll('#tracks button')[ti].click(), ti);
  await page.waitForFunction(() => window.__RAD_GAME__.world && window.__RAD_GAME__.isRunning(), { timeout: 10000 });
}
async function quitRace(page) {
  await page.evaluate(() => { window.__botStop && window.__botStop(); window.__RAD_GAME__.stopRace(); });
  await page.goto(page.url().split('#')[0], { waitUntil: 'networkidle2' });
}
const stats = (a) => { const s = [...a].sort((x, y) => x - y); const avg = s.reduce((x, y) => x + y, 0) / Math.max(1, s.length); return { avg, p95: s[Math.floor(s.length * 0.95)] || 0, max: s[s.length - 1] || 0 }; };

async function newPage(kind) {
  const page = await browser.newPage();
  if (kind === 'phone') await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
  else await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(RAF_HOOK);
  return page;
}

// ---------------------------------------------------------------------------
const fpsRows = [];
const withCanvas = (u) => u + (u.includes('?') ? '&' : '?') + 'canvas=1';
if (mode === 'all' || mode === 'fps') {
  // Pixi (default renderer) vs the Canvas fallback (?canvas=1), desktop + 844×390 phone, at the close race zoom
  // (0.85, pinned to the player via __RAD_CAM__) and the far chase zoom (the game camera at speed → 0.24).
  const fpsTracks = process.argv[5] ? tracks : ['neon', 'gridlock'];
  for (const kind of ['desktop', 'phone']) {
    for (const rk of ['pixi', 'canvas']) {
      const page = await newPage(kind);
      const errs = []; watchErrors(page, errs);
      const u = rk === 'pixi' ? url : withCanvas(url);
      await page.goto(u, { waitUntil: 'networkidle2' });
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'networkidle2' });
      const build = await page.evaluate(() => self.RADCARS_BUILD.label || (self.RADCARS_BUILD.version + ' ' + self.RADCARS_BUILD.name));
      log(`\n=== FPS ${kind} ${rk} (${build}) ===`);
      const cdp = await page.createCDPSession();
      for (const name of fpsTracks) {
        await startRace(page, ALL.indexOf(name));
        await install(page);
        await page.waitForFunction(() => window.__RAD_GAME__.world.race.countdown <= 0, { timeout: 10000 });
        const got = await page.evaluate(() => window.__RAD_GAME__.rendererKind);
        check(got === rk, `${kind} ${name}: active renderer is ${got} (expected ${rk})`);
        await sleep(2500); // warm-up (shader compile, texture uploads, pack spreading out)
        for (const zm of ['race', 'far']) {
          await page.evaluate((zm) => {
            const w = window.__RAD_GAME__.world;
            // race = the close race view (0.85, the grid / launch zoom, cars biggest), camera pinned on the player;
            // far = the game's own chase camera at speed, which pulls out to ZOOM_FAR 0.24
            window.__RAD_CAM__ = zm === 'race' ? { get x() { return w.player.x; }, get y() { return w.player.y; }, zoom: 0.85 } : null;
          }, zm);
          for (const thr of [1, 4]) {
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: thr });
            await sleep(500);
            await page.evaluate(() => { window.__ft = []; window.__ftOn = true; window.__f0 = window.__frames; window.__t0 = performance.now(); });
            await sleep(6000);
            const r = await page.evaluate(() => { window.__ftOn = false; return { fps: (window.__frames - window.__f0) / ((performance.now() - window.__t0) / 1000), ft: window.__ft, zoom: window.__RAD_GAME__.world.cam.zoom }; });
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
            const s = stats(r.ft);
            const row = { kind, rk, name, zm, zoom: +r.zoom.toFixed(2), thr, fps: +r.fps.toFixed(1), avg: +s.avg.toFixed(2), p95: +s.p95.toFixed(2) };
            fpsRows.push(row);
            log(`  ${name.padEnd(9)} ${zm.padEnd(4)} z${row.zoom} cpu×${thr}: ${row.fps} fps, frame JS avg ${row.avg} ms, p95 ${row.p95} ms`);
          }
        }
        await page.evaluate(() => { window.__RAD_CAM__ = null; });
        await quitRace(page);
      }
      check(errs.length === 0, `${kind} ${rk}: console/page errors: ${errs.length ? errs.slice(0, 5).join(' | ') : 'none'}`);
      await page.close();
    }
  }
  // comparison table + gate: Pixi at least as fast as Canvas (within 1 fps noise) and ~60 fps at normal CPU
  log('\nFPS TABLE (fps pixi / canvas; JS ms avg pixi / canvas)');
  for (const kind of ['desktop', 'phone']) for (const name of fpsTracks) for (const zm of ['race', 'far']) for (const thr of [1, 4]) {
    const a = fpsRows.find((r) => r.kind === kind && r.rk === 'pixi' && r.name === name && r.zm === zm && r.thr === thr);
    const b = fpsRows.find((r) => r.kind === kind && r.rk === 'canvas' && r.name === name && r.zm === zm && r.thr === thr);
    if (!a || !b) continue;
    log(`  ${kind.padEnd(7)} ${name.padEnd(9)} ${zm.padEnd(4)} z${String(a.zoom).padEnd(4)} cpu×${thr}: ${String(a.fps).padStart(5)} / ${String(b.fps).padStart(5)} fps   ${a.avg} / ${b.avg} ms`);
    if (thr === 1) check(a.fps >= 57, `${kind} ${name} ${zm}: Pixi ≈60 fps at normal CPU (${a.fps})`);
    check(a.fps >= b.fps - 1.5, `${kind} ${name} ${zm} cpu×${thr}: Pixi (${a.fps}) at least as fast as Canvas (${b.fps})`);
  }
}

if (mode === 'all' || mode === 'shots') {
  const { runShots } = await import('./verify-v51-shots.mjs');
  await runShots({ browser, url, outDir, tracks, log, check, newPage, startRace, install, quitRace, sleep, watchErrors });
}

log(`\nFPS JSON ${JSON.stringify(fpsRows)}`);
log(`\nRESULT: ${fails ? fails + ' FAIL(S)' : 'ALL OK'}`);
writeFileSync(`${outDir}/79-verify${mode === 'all' ? '' : '-' + mode}.txt`, lines.join('\n') + '\n');
await browser.close();
process.exit(fails ? 1 : 0);
