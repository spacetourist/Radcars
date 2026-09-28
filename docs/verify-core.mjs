/**
 * Radcars core verification (v46 long-aligned).
 *   node docs/verify-core.mjs [url] [outDir]
 * 1. Track geometry check (docs/check-geometry.mjs) + lap lengths before (commit 6731818) / after.
 * 2. Real race through the menus on all 4 tracks, 3 laps, player bot holding throttle and steering.
 * 3. Drawn-orientation checks on every sampled frame:
 *    a) render-transform check: the screen image of each car's local LENGTH axis (the axis the body
 *       is drawn long along, nose at +X) is compared with the car's velocity direction;
 *    b) pixel check: principal axis of the car's body-colour pixels read back from the canvas
 *       (long side) and headlight-pixel centroid (nose) compared with velocity.
 * 4. Screenshots: 74-{track}-overview.png, 74-{track}-car-straight.png, 74-{track}-car-corner.png.
 */
import puppeteer from '../node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import fs from 'fs';
import { execSync } from 'child_process';
import { checkTrack, formatResult, LIMITS } from './check-geometry.mjs';
import { TRACKS } from '../js/tracks.js';

const url = process.argv[2] || 'http://localhost:4173/';
const outDir = process.argv[3] || new URL('./shots', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const names = ['neon', 'gridlock', 'razor', 'cargo'];
const report = [];

// ---------- 1. geometry + lap lengths ----------
const repo = new URL('..', import.meta.url).pathname;
const oldSrc = execSync('git show 6731818:js/tracks.js', { cwd: repo }).toString();
fs.writeFileSync('/tmp/radcars-tracks-6731818.mjs', oldSrc);
const OLD = (await import('/tmp/radcars-tracks-6731818.mjs')).TRACKS;
const geo = TRACKS.map(checkTrack);
report.push('LAP LENGTHS (world units; before = commit 6731818 / v45-core, after = this build)');
TRACKS.forEach((t, i) => {
  const o = OLD.find((x) => x.id === t.id);
  report.push(`  ${names[i].padEnd(9)} before=${o.length.toFixed(0).padStart(6)}  after=${t.length.toFixed(0).padStart(6)}  ratio=${(t.length / o.length).toFixed(2)}×  halfW=${t.halfW}  bounds=${(t.bounds.maxX - t.bounds.minX).toFixed(0)}×${(t.bounds.maxY - t.bounds.minY).toFixed(0)} (was ${(o.bounds.maxX - o.bounds.minX).toFixed(0)}×${(o.bounds.maxY - o.bounds.minY).toFixed(0)})`);
});
report.push('', `GEOMETRY CHECK limits ${JSON.stringify(LIMITS)}`);
geo.forEach((r) => report.push('  ' + formatResult(r)));
const geoPass = geo.every((r) => r.pass) && TRACKS.every((t, i) => t.length >= 2 * OLD.find((x) => x.id === t.id).length);
report.push(`  geometry+doubling overall: ${geoPass ? 'PASS' : 'FAIL'}`, '');

// ---------- 2. races ----------
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push('CONSOLE.' + m.type() + ' ' + m.text()); });
page.on('requestfailed', (r) => errs.push('REQFAIL ' + r.url()));
await page.goto(url, { waitUntil: 'networkidle2' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle2' });

/** Sample one rendered frame: transform + pixel orientation per car (runs right after the game draws). */
async function sampleFrame() {
  return page.evaluate(() => new Promise((resolve) => {
    window.__RAD_DEBUG__ = {};
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const f = window.__RAD_DEBUG__.frame; window.__RAD_DEBUG__ = null;
      const g = window.__RAD_GAME__; const w = g.world; const tr = w.track;
      const cv = document.getElementById('game'); const ctx = cv.getContext('2d');
      const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
      const wall = hex(tr.wall);
      const dAng = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
      const out = [];
      for (const dc of f.cars) {
        if (dc.spinning) continue; // v48: a missile-hit car is deliberately drawn rotating for ~1 s
        const car = w.cars.find((c) => c.id === dc.id);
        const spd = Math.hypot(dc.vx, dc.vy);
        const va = Math.atan2(dc.vy, dc.vx);
        const lenAng = Math.atan2(dc.lenAxis.y, dc.lenAxis.x);
        const lenPx = Math.hypot(dc.lenAxis.x, dc.lenAxis.y) * 2, widPx = Math.hypot(dc.widAxis.x, dc.widAxis.y) * 2;
        const rec = { id: dc.id, isPlayer: dc.isPlayer, spd, xformErr: Math.abs(dAng(lenAng, va)) * 180 / Math.PI, lenPx, widPx, radius: tr.pts[car.seg]?.radius ?? 0, lat: car.lat, px: null };
        // pixel check, only where the car is clear of walls/kerbs and other cars and its colour differs from the wall
        const col = hex(car.color);
        const reg = lenPx * 0.62;
        const zoomPx = Math.hypot(f.cam.zoom * f.DPR, 0);
        const clearWall = (Math.abs(car.lat) * zoomPx + reg) < (tr.halfW - 18) * zoomPx;
        const clearCars = w.cars.every((o) => o === car || Math.hypot(o.x - car.x, o.y - car.y) * zoomPx > lenPx * 1.6);
        const colDist = Math.hypot(col[0] - wall[0], col[1] - wall[1], col[2] - wall[2]);
        // v48: amber boost pads and boost flames (yellow core ≈ headlight colour) would pollute the colour sampling
        const clearFx = !(car.boostLevel > 0.01) && !(w.track.pads || []).some((pd) => Math.hypot(pd.x - car.x, pd.y - car.y) < pd.len + 90);
        const ox = dc.origin.x, oy = dc.origin.y;
        if (spd > 150 && clearWall && clearCars && clearFx && colDist > 90 && ox > reg && oy > reg && ox < cv.width - reg && oy < cv.height - reg && !(ox > cv.width - 230 && oy < 230)) {
          const x0 = Math.floor(ox - reg), y0 = Math.floor(oy - reg), sz = Math.ceil(reg * 2);
          const img = ctx.getImageData(x0, y0, sz, sz).data;
          let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, hn = 0, hx = 0, hy = 0;
          for (let yy = 0; yy < sz; yy++) for (let xx = 0; xx < sz; xx++) {
            const dx = x0 + xx - ox, dy = y0 + yy - oy; if (dx * dx + dy * dy > reg * reg) continue;
            const k = (yy * sz + xx) * 4, r = img[k], gg = img[k + 1], b = img[k + 2];
            if (Math.hypot(r - col[0], gg - col[1], b - col[2]) < 40) { n++; sx += dx; sy += dy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
            if (Math.hypot(r - 255, gg - 246, b - 192) < 28) { hn++; hx += dx; hy += dy; }
          }
          if (n > 30 && hn > 2) {
            const mx = sx / n, my = sy / n, cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
            const axis = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
            const tr2 = cxx + cyy, det = cxx * cyy - cxy * cxy, disc = Math.sqrt(Math.max(0, tr2 * tr2 / 4 - det));
            const elong = Math.sqrt((tr2 / 2 + disc) / Math.max(1e-6, tr2 / 2 - disc));
            let axErr = Math.abs(dAng(axis, va)); if (axErr > Math.PI / 2) axErr = Math.PI - axErr; // axis is ±180° ambiguous
            const noseAng = Math.atan2(hy / hn - my, hx / hn - mx);
            rec.px = { n, elong, axisErr: axErr * 180 / Math.PI, noseErr: Math.abs(dAng(noseAng, va)) * 180 / Math.PI };
          }
        }
        out.push(rec);
      }
      resolve({ cars: out, cam: f.cam });
    }));
  }));
}

async function carShot(file, zoom = 1.25) {
  await page.evaluate((zoom) => { const p = window.__RAD_GAME__.world.player; window.__RAD_CAM__ = { x: p.x + p.vx * 0.05, y: p.y + p.vy * 0.05, zoom }; }, zoom);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.screenshot({ path: file, clip: { x: 320, y: 180, width: 640, height: 360 } });
  await page.evaluate(() => { window.__RAD_CAM__ = null; });
}
async function raceZoomShot(file, sample) {
  const p = sample.cars.find((c) => c.isPlayer);
  const pos = await page.evaluate(() => { const w = window.__RAD_GAME__.world, c = w.cam, p = w.player; return { x: (p.x - c.x) * c.zoom + innerWidth / 2, y: (p.y - c.y) * c.zoom + innerHeight / 2 }; });
  const cw = 320, ch = 180;
  const x = Math.max(0, Math.min(1280 - cw, pos.x - cw / 2)), y = Math.max(0, Math.min(720 - ch, pos.y - ch / 2));
  await page.screenshot({ path: file, clip: { x, y, width: cw, height: ch, scale: 3 } });
}

const summary = [];
const orientLines = [];
const logLines = [];
let allOk = geoPass;
for (let ti = 0; ti < 4; ti++) {
  const errStart = errs.length;
  await page.click('[data-act=race]');
  await page.waitForSelector('#tracks button');
  await page.evaluate((ti) => document.querySelectorAll('#tracks button')[ti].click(), ti);
  await page.evaluate(async () => {
    const { pointAt } = await import('./js/tracks.js');
    const { angleDiff } = await import('./js/util.js');
    const held = new Set();
    const set = (k, on) => { if (on && !held.has(k)) { held.add(k); window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); } else if (!on && held.has(k)) { held.delete(k); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); } };
    window.__frames = 0; const fr = () => { window.__frames++; window.__fr = requestAnimationFrame(fr); }; fr();
    window.__bot = setInterval(() => {
      const w = window.__RAD_GAME__.world; if (!w) return; const p = w.player;
      const spd = Math.hypot(p.vx, p.vy);
      const tp = pointAt(w.track, p.sPrev + 150 + spd * 0.35);
      const err = angleDiff(p.angle, Math.atan2(tp.y - p.y, tp.x - p.x));
      set('ArrowRight', err > 0.05); set('ArrowLeft', err < -0.05);
      set('ArrowUp', !(Math.abs(err) > 0.7 && spd > 500)); // v48: no brake — lift off instead
    }, 30);
  });
  const t0 = Date.now();
  let done = false, shots = { overview: false, straight: false, corner: false };
  const samples = []; const lapSeen = [0]; const frames0 = await page.evaluate(() => window.__frames);
  let raceMs0 = null, wall0 = null;
  logLines.push(`=== ${names[ti]} ===`, 't_race_s  lap  dist    speed  xformErr(player)  aiLaps');
  while (Date.now() - t0 < 300000) {
    await new Promise((r) => setTimeout(r, 400));
    const st = await page.evaluate(() => {
      const g = window.__RAD_GAME__, w = g.world, p = w.player;
      return { running: g.isRunning(), results: !!document.querySelector('#results'), t: w.race.time, cd: w.race.countdown, lap: p.lap, dist: p.dist, spd: Math.hypot(p.vx, p.vy), ai: w.cars.slice(1).map((c) => c.lap), radius: w.track.pts[p.seg].radius, over: w.race.over, hud: document.querySelector('[data-h=lap]')?.textContent };
    });
    if (st.results) { done = true; break; }
    if (st.cd > 0 || !st.running || st.over) continue;
    if (raceMs0 === null) { raceMs0 = st.t; wall0 = Date.now(); }
    if (st.lap > lapSeen.at(-1)) lapSeen.push(st.lap);
    const smp = await sampleFrame();
    samples.push(smp);
    const pl = smp.cars.find((c) => c.isPlayer);
    logLines.push(`${(st.t / 1000).toFixed(1).padStart(7)}  ${st.lap}  ${Math.round(st.dist).toString().padStart(6)}  ${st.spd.toFixed(0).padStart(5)}  ${pl.xformErr.toFixed(1).padStart(6)}°  ${st.ai.join(',')}  HUD ${st.hud}`);
    if (!shots.overview && st.t > 9000) {
      await page.evaluate(() => { const w = window.__RAD_GAME__.world, b = w.track.bounds; window.__RAD_CAM__ = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, zoom: Math.min(innerWidth / (b.maxX - b.minX), innerHeight / (b.maxY - b.minY)) * 0.9 }; });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: `${outDir}/74-${names[ti]}-overview.png` });
      await page.evaluate(() => { window.__RAD_CAM__ = null; });
      shots.overview = true;
    } else if (!shots.straight && st.t > 4000 && st.radius > 3000 && st.spd > 450) {
      await raceZoomShot(`${outDir}/74-${names[ti]}-car-straight-racezoom.png`, smp);
      await carShot(`${outDir}/74-${names[ti]}-car-straight.png`);
      shots.straight = true;
    } else if (!shots.corner && st.t > 4000 && st.radius < 800 && st.spd > 250) {
      await raceZoomShot(`${outDir}/74-${names[ti]}-car-corner-racezoom.png`, smp);
      await carShot(`${outDir}/74-${names[ti]}-car-corner.png`);
      shots.corner = true;
    }
  }
  const fin = await page.evaluate(() => {
    clearInterval(window.__bot); cancelAnimationFrame(window.__fr);
    ['ArrowLeft', 'ArrowRight', 'ArrowUp'].forEach((k) => window.dispatchEvent(new KeyboardEvent('keyup', { key: k })));
    const w = window.__RAD_GAME__.world;
    return { res: window.__RAD_LAST_RESULT__, frames: window.__frames, raceMs: w.race.time, cars: w.cars.map((c) => ({ name: c.name, lap: c.lap, finished: c.finished, dnf: !!c.dnf, best: c.bestLapMs, dist: c.dist })), L: w.track.length };
  });
  if (done) await page.screenshot({ path: `${outDir}/74-${names[ti]}-results.png` });
  // orientation stats
  const moving = samples.flatMap((s) => s.cars.filter((c) => c.spd > 150));
  const xf = moving.map((c) => c.xformErr);
  const px = moving.filter((c) => c.px);
  const xfMax = Math.max(...xf), xfMean = xf.reduce((a, b) => a + b, 0) / xf.length;
  const xfP95 = [...xf].sort((a, b) => a - b)[Math.floor(xf.length * 0.95)];
  const lenRatio = Math.min(...moving.map((c) => c.lenPx / c.widPx));
  const axErr = px.map((c) => c.px.axisErr), noseErr = px.map((c) => c.px.noseErr), elong = px.map((c) => c.px.elong);
  const pxAxisMean = axErr.reduce((a, b) => a + b, 0) / Math.max(1, axErr.length);
  const pxAxisP95 = [...axErr].sort((a, b) => a - b)[Math.floor(axErr.length * 0.95)] ?? NaN;
  const pxNoseMax = Math.max(...noseErr), pxElongMin = Math.min(...elong);
  const pxNoseBad = noseErr.filter((e) => e > 60).length;
  const orientOk = xfP95 < 12 && lenRatio > 1.8 && px.length >= 20 && pxAxisP95 < 15 && pxNoseBad === 0 && pxElongMin > 1.3;
  orientLines.push(`  ${names[ti].padEnd(9)} ${orientOk ? 'PASS' : 'FAIL'}  render-transform: carSamples=${moving.length} lengthAxis-vs-velocity mean=${xfMean.toFixed(1)}° p95=${xfP95.toFixed(1)}° max=${xfMax.toFixed(1)}°  drawn length/width≥${lenRatio.toFixed(2)}  |  pixels: carSamples=${px.length} bodyPrincipalAxis-vs-velocity mean=${pxAxisMean.toFixed(1)}° p95=${pxAxisP95.toFixed(1)}°  nose(headlights)-vs-velocity max=${pxNoseMax.toFixed(1)}° (>60°: ${pxNoseBad})  body elongation≥${pxElongMin.toFixed(2)}`);
  // race stats
  const wallS = (Date.now() - (wall0 || Date.now())) / 1000;
  const fps = (fin.frames - frames0) / Math.max(1, (Date.now() - t0) / 1000);
  const aiAll = fin.cars.slice(1).every((c) => c.finished && !c.dnf && c.lap === 3);
  const lapsOk = lapSeen.join(',') === '0,1,2,3' || (fin.cars[0].lap === 3 && lapSeen.every((v, i) => i === 0 || v === lapSeen[i - 1] + 1));
  const e = errs.length - errStart;
  const raceOk = done && aiAll && fin.cars[0].lap === 3 && !fin.res.standings.some((s) => s.dnf) && e === 0;
  allOk = allOk && raceOk && orientOk;
  summary.push(`  ${names[ti].padEnd(9)} ${raceOk ? 'PASS' : 'FAIL'}  results=${done} playerPlace=P${fin.res?.playerPlace} playerTime=${(fin.res?.totalTime / 1000).toFixed(2)}s bestLap=${(fin.res?.bestLapMs / 1000).toFixed(2)}s  playerLapsSeen=${lapSeen.join('→')}  laps=${fin.cars.map((c) => c.lap).join(',')}  allAIfinished=${aiAll}  standings=${fin.res?.standings.map((s) => `${s.name}${s.dnf ? '(DNF)' : ' ' + (s.finishTime / 1000).toFixed(1) + 's'}`).join(' > ')}  AI best laps=${fin.cars.slice(1).map((c) => (c.best / 1000).toFixed(1)).join('/')}s  rAF≈${fps.toFixed(1)}fps  errors=${e}  shots=${Object.entries(shots).filter(([, v]) => v).map(([k]) => k).join(',')}`);
  await page.evaluate(() => document.querySelector('#title')?.click());
  await page.waitForSelector('[data-act=race]');
}
// FPS probe on a fresh race at speed
await page.click('[data-act=race]'); await page.waitForSelector('#tracks button');
await page.evaluate(() => document.querySelectorAll('#tracks button')[0].click());
await page.keyboard.down('ArrowUp');
await new Promise((r) => setTimeout(r, 6000));
const f0 = await page.evaluate(() => new Promise((res) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 3000) requestAnimationFrame(f); else res(n / ((performance.now() - t) / 1000)); }; requestAnimationFrame(f); }));
await page.keyboard.up('ArrowUp');
const sw = await page.evaluate(() => fetch('./sw.js').then((r) => r.text()).then((t) => t.match(/radcars-v[\w-]+/)?.[0]));
await browser.close();

const out = [
  `Radcars ${sw} verification ${new Date().toString()}`, `URL ${url}`, '',
  ...report,
  'DRAWN-ORIENTATION CHECK (all cars, sampled every ~0.4s while racing; speed > 150 wu/s)', ...orientLines, '',
  'RACES (through the menus, 3 laps, 5 AI Normal, player bot holds throttle + steers)', ...summary,
  `  fps probe (headless, 1280x720, Neon at speed): ${f0.toFixed(1)}`,
  `  console errors/warnings total: ${errs.length} ${JSON.stringify(errs.slice(0, 5))}`, '',
  `OVERALL: ${allOk && errs.length === 0 && f0 > 55 ? 'PASS' : 'FAIL'}`, '',
  'PLAYER LOG', ...logLines
];
fs.writeFileSync(`${outDir}/74-verify.txt`, out.join('\n'));
console.log(out.slice(0, out.indexOf('PLAYER LOG')).join('\n'));
