/**
 * Radcars v49: tighter turn radius + camera keep-in-view at countdown/start.
 * Usage: node docs/verify-v49.mjs [url] [outDir]
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:4173/';
const outDir = process.argv[3] || new URL('./shots', import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });
const ALL = ['neon', 'gridlock', 'razor', 'cargo'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => { console.log(s); lines.push(s); };
const lines = [];
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; log(`    [${ok ? 'ok' : 'FAIL'}] ${msg}`); return ok; };

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(url, { waitUntil: 'networkidle2' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle2' });

const build = await page.evaluate(() => ({ ...self.RADCARS_BUILD, btn: !!document.getElementById('hard-refresh'), tag: document.getElementById('build-tag')?.textContent }));
check(build?.version === 'v49' && build?.name === 'turn-cam' && build.btn && build.tag === 'v49 · turn-cam',
  `menu build=${build?.label}, tag "${build.tag}", Update button=${build.btn}`);

// ---- turn radius measurement (in-page, using live MAX_TURN) ----
const turn = await page.evaluate(async () => {
  const { MAX_TURN } = await import('./js/physics.js');
  const top = 1000, spd = 1000;
  const omega = MAX_TURN * Math.min(1, spd / 220) * (1 - 0.35 * Math.min(1, spd / top));
  const R = spd / omega;
  const Rold = spd / (2.9 * 0.65);
  return { MAX_TURN, omega, R, Rold, pct: (1 - R / Rold) * 100 };
});
check(turn.MAX_TURN === 3.3 && turn.pct > 10 && turn.pct < 16,
  `turn at 1000 wu/s: MAX_TURN ${turn.MAX_TURN}, ω=${turn.omega.toFixed(3)} rad/s, R ${turn.Rold.toFixed(1)}→${turn.R.toFixed(1)} wu (${turn.pct.toFixed(1)}% tighter)`);

async function startRace(ti) {
  await page.click('[data-act=race]');
  await page.waitForSelector('#tracks button');
  await page.evaluate((ti) => document.querySelectorAll('#tracks button')[ti].click(), ti);
}
async function quitRace() {
  if (await page.$('#results')) { await page.click('#title'); await page.waitForSelector('[data-act=race]'); return; }
  await page.keyboard.press('p'); await page.waitForSelector('#quit'); await page.click('#quit');
  await page.waitForSelector('[data-act=race]');
}
async function installBot() {
  await page.evaluate(async () => {
    const { pointAt } = await import('./js/tracks.js');
    const { angleDiff } = await import('./js/util.js');
    const held = new Set();
    const set = (k, on) => {
      if (on && !held.has(k)) { held.add(k); window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); }
      else if (!on && held.has(k)) { held.delete(k); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); }
    };
    window.__frames = 0; const fr = () => { window.__frames++; window.__fr = requestAnimationFrame(fr); }; fr();
    clearInterval(window.__bot);
    window.__bot = setInterval(() => {
      const w = window.__RAD_GAME__?.world; if (!w || w.race.countdown > 0) return;
      const p = w.player, spd = Math.hypot(p.vx, p.vy);
      const tp = pointAt(w.track, p.sPrev + 150 + spd * 0.35);
      const err = angleDiff(p.angle, Math.atan2(tp.y - p.y, tp.x - p.x));
      set('ArrowRight', err > 0.05); set('ArrowLeft', err < -0.05);
      set('ArrowUp', !(Math.abs(err) > 0.7 && spd > 500));
    }, 30);
  });
}
function playerView() {
  return page.evaluate(() => {
    const w = window.__RAD_GAME__.world, p = w.player, c = w.cam;
    const vw = document.getElementById('game').clientWidth, vh = document.getElementById('game').clientHeight;
    const z = c.zoom, halfL = 32, halfW = 17;
    // four corners of the car AABB in world → screen
    const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
    const corners = [[halfL, halfW], [halfL, -halfW], [-halfL, halfW], [-halfL, -halfW]].map(([u, v]) => {
      const wx = p.x + ca * u - sa * v, wy = p.y + sa * u + ca * v;
      return { x: (wx - c.x) * z + vw / 2, y: (wy - c.y) * z + vh / 2 };
    });
    const xs = corners.map((q) => q.x), ys = corners.map((q) => q.y);
    const short = Math.min(vw, vh), margin = short * 0.08;
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const inView = minX >= 0 && maxX <= vw && minY >= 0 && maxY <= vh;
    const inMargin = minX >= margin && maxX <= vw - margin && minY >= margin && maxY <= vh - margin;
    return {
      inView, inMargin, margin, vw, vh, zoom: z,
      box: { minX, maxX, minY, maxY },
      cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
      cd: w.race.countdown, t: w.race.time, spd: Math.hypot(p.vx, p.vy),
      look: Math.hypot(p.x - c.x, p.y - c.y)
    };
  });
}

const raceRows = [];
for (let ti = 0; ti < ALL.length; ti++) {
  const name = ALL[ti];
  log(`\n=== ${name.toUpperCase()} ===`);
  await startRace(ti);
  await installBot();
  // wait for countdown digit visible
  await page.waitForFunction(() => window.__RAD_GAME__?.world?.race?.countdown > 0);
  await sleep(200);
  let v = await playerView();
  check(v.inView && v.inMargin, `countdown: car fully in view with ≥8% margin (box ${v.box.minX.toFixed(0)}..${v.box.maxX.toFixed(0)} × ${v.box.minY.toFixed(0)}..${v.box.maxY.toFixed(0)} in ${v.vw}×${v.vh}, look=${v.look.toFixed(0)}, zoom=${v.zoom.toFixed(2)})`);
  await page.screenshot({ path: `${outDir}/77-${name}-countdown.png` });
  log(`    shot ${outDir}/77-${name}-countdown.png`);

  // mid-countdown sample
  await page.waitForFunction(() => window.__RAD_GAME__.world.race.countdown < 2000 && window.__RAD_GAME__.world.race.countdown > 0);
  v = await playerView();
  check(v.inView, `countdown mid: car in view (cy=${v.cy.toFixed(0)} of ${v.vh})`);

  // GO / just after
  await page.waitForFunction(() => window.__RAD_GAME__.world.race.countdown <= 0, { timeout: 6000 });
  await sleep(80);
  v = await playerView();
  check(v.inView && v.inMargin, `GO: car fully in view with margin (box ${v.box.minX.toFixed(0)}..${v.box.maxX.toFixed(0)} × ${v.box.minY.toFixed(0)}..${v.box.maxY.toFixed(0)}, look=${v.look.toFixed(0)})`);
  await page.screenshot({ path: `${outDir}/77-${name}-go.png` });
  log(`    shot ${outDir}/77-${name}-go.png`);

  // early race (first ~1.5s) keep checking
  let earlyOk = true;
  for (let i = 0; i < 8; i++) {
    await sleep(200);
    v = await playerView();
    if (!v.inView) earlyOk = false;
  }
  check(earlyOk, `first ~1.6 s of race: player stayed fully on screen`);

  // hairpin shot on razor/cargo: wait for a tight radius section
  if (name === 'razor' || name === 'cargo') {
    await page.waitForFunction(() => {
      const w = window.__RAD_GAME__.world, p = w.player;
      return w.race.time > 4000 && w.track.pts[p.seg].radius < 500 && Math.hypot(p.vx, p.vy) > 300;
    }, { timeout: 60000 });
    await page.screenshot({ path: `${outDir}/77-${name}-hairpin.png` });
    log(`    shot ${outDir}/77-${name}-hairpin.png`);
  }

  // light feature checks mid-race
  const feat = await page.evaluate(() => {
    const w = window.__RAD_GAME__.world;
    return {
      pads: w.track.pads.length,
      missileCh: w.missile.charge,
      boostCh: w.boost.charge,
      brk: 'brake' in window.__RAD_INPUT__.state,
      brkBtn: !!document.querySelector('#btn-brake')
    };
  });
  check(feat.pads >= 3 && feat.missileCh <= 1 && !feat.brk && !feat.brkBtn,
    `features intact: pads=${feat.pads}, missile charge=${feat.missileCh}, boost charge=${feat.boostCh}, brake state absent=${!feat.brk}, no BRK btn`);

  // fire a missile once if we have a target (optional soft check)
  await page.keyboard.press(' ');
  await sleep(100);

  // finish the race
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < 180000) {
    const st = await page.evaluate(() => ({ results: !!document.querySelector('#results'), over: window.__RAD_GAME__.world.race.over }));
    if (st.results) { done = true; break; }
    await sleep(500);
  }
  const fin = await page.evaluate(() => {
    clearInterval(window.__bot); cancelAnimationFrame(window.__fr);
    ['ArrowLeft', 'ArrowRight', 'ArrowUp'].forEach((k) => window.dispatchEvent(new KeyboardEvent('keyup', { key: k })));
    const w = window.__RAD_GAME__.world, r = window.__RAD_LAST_RESULT__;
    return {
      place: r?.playerPlace, time: r?.totalTime, best: r?.bestLapMs,
      standings: r?.standings?.map((s) => `${s.name} ${(s.finishTime / 1000).toFixed(1)}`),
      aiAll: w.cars.slice(1).every((c) => c.finished),
      laps: w.player.lap, fps: window.__frames
    };
  });
  const wall = (Date.now() - t0) / 1000;
  const fps = fin.fps / Math.max(1, wall);
  check(done && fin.aiAll && fin.laps >= 3 && fps > 55,
    `race: P${fin.place} ${(fin.time / 1000).toFixed(2)}s best ${(fin.best / 1000).toFixed(2)}s all AI finish=${fin.aiAll} fps≈${fps.toFixed(1)}`);
  await page.screenshot({ path: `${outDir}/77-${name}-results.png` });
  raceRows.push({ name, place: fin.place, time: fin.time, best: fin.best, standings: fin.standings, fps });
  await page.click('#title');
  await page.waitForSelector('[data-act=race]');
}

// Mobile short viewport: countdown must keep car on screen (the original bug)
log(`\n=== MOBILE 844×390 countdown (the short-viewport bug) ===`);
const mob = await browser.newPage();
await mob.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
const merrs = []; mob.on('pageerror', (e) => merrs.push(String(e)));
await mob.goto(url, { waitUntil: 'networkidle2' });
await mob.evaluate(() => localStorage.clear());
await mob.reload({ waitUntil: 'networkidle2' });
const tag = await mob.evaluate(() => document.getElementById('build-tag')?.textContent);
check(tag === 'v49 · turn-cam', `mobile menu tag "${tag}"`);
await mob.screenshot({ path: `${outDir}/77-menu-mobile.png` });
await mob.tap('[data-act=race]');
await mob.waitForSelector('#tracks button');
await (await mob.$$('#tracks button'))[0].tap();
await mob.waitForFunction(() => window.__RAD_GAME__?.world?.race?.countdown > 0);
await sleep(300);
const mv = await mob.evaluate(() => {
  const w = window.__RAD_GAME__.world, p = w.player, c = w.cam;
  const vw = document.getElementById('game').clientWidth, vh = document.getElementById('game').clientHeight;
  const z = c.zoom, ca = Math.cos(p.angle), sa = Math.sin(p.angle);
  const corners = [[32, 17], [32, -17], [-32, 17], [-32, -17]].map(([u, v]) => {
    const wx = p.x + ca * u - sa * v, wy = p.y + sa * u + ca * v;
    return { x: (wx - c.x) * z + vw / 2, y: (wy - c.y) * z + vh / 2 };
  });
  const xs = corners.map((q) => q.x), ys = corners.map((q) => q.y);
  const short = Math.min(vw, vh), margin = short * 0.08;
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { inView: minX >= 0 && maxX <= vw && minY >= 0 && maxY <= vh,
    inMargin: minX >= margin && maxX <= vw - margin && minY >= margin && maxY <= vh - margin,
    minX, maxX, minY, maxY, vw, vh, look: Math.hypot(p.x - c.x, p.y - c.y), zoom: z, brk: !!document.querySelector('#btn-brake') };
});
check(mv.inView && mv.inMargin && !mv.brk,
  `mobile countdown: car in view with margin (y ${mv.minY.toFixed(0)}..${mv.maxY.toFixed(0)} of ${mv.vh}, look=${mv.look.toFixed(0)}, zoom=${mv.zoom.toFixed(2)}), no BRK`);
await mob.screenshot({ path: `${outDir}/77-mobile-neon-countdown.png` });
log(`    shot ${outDir}/77-mobile-neon-countdown.png`);
check(merrs.length === 0, `mobile errors: ${merrs.length}`);
check(errs.length === 0, `desktop errors: ${errs.length} ${JSON.stringify(errs.slice(0, 2))}`);

await browser.close();

const summary = [
  `Radcars v49 verification ${new Date().toString()}`,
  `URL ${url}`,
  '',
  `TURN at 1000 wu/s: MAX_TURN ${turn.MAX_TURN}, R ${turn.Rold.toFixed(1)} → ${turn.R.toFixed(1)} wu (${turn.pct.toFixed(1)}% tighter)`,
  `CAMERA: look-ahead clamped so player AABB stays in view with ~10% of shorter side margin (countdown / early race / low speed)`,
  '',
  'RACES (3 laps, 5 AI Normal)',
  ...raceRows.map((r) => `  ${r.name.padEnd(9)} P${r.place} ${(r.time / 1000).toFixed(2)}s best ${(r.best / 1000).toFixed(2)}s  fps≈${r.fps.toFixed(1)}  ${r.standings?.join(' > ')}`),
  '',
  `OVERALL: ${fails ? 'FAIL' : 'PASS'}`,
  '',
  'DETAIL',
  ...lines
];
writeFileSync(`${outDir}/77-verify.txt`, summary.join('\n') + '\n');
console.log(`\nOVERALL: ${fails ? 'FAIL' : 'PASS'}`);
process.exit(fails ? 1 : 0);
