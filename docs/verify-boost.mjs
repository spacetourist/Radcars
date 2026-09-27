/**
 * Radcars v47 boost verification (sibling of verify-core.mjs).
 *   node docs/verify-boost.mjs [url] [outDir] [tracks=neon,gridlock,razor,cargo] [mobileTracks=neon,razor]
 *
 * A. Desktop 1280×720: a real race through the menus on each track (3 laps, 5 AI, Normal) with a
 *    steering bot. Scenario per race:
 *    1. LAST: the bot idles for 4 s at GO so the whole field leaves -> player is last. Shift is then
 *       pressed as soon as each boost ends: every press must fire a free boost while last
 *       (charge stays 1, free counter increments). Chained until the player is no longer last.
 *    2. LAP CHARGE (lap 1, not last): Shift -> boost fires and the charge goes 1 -> 0; Shift again
 *       mid-boost (does not extend) and after it ends (does nothing). Charge refills at the line.
 *    3. Lap 2: charge left unused; paused with Shift pressed during the pause -> no boost on resume;
 *       at the next crossing the charge is still 1 (no stacking).
 *    4. Lap 3: Shift -> boost; paused mid-boost for 1.5 s -> timer frozen, then resumes.
 *    Speed is recorded every 50 ms in-page; peak boosted speed is compared with the unboosted top.
 *    Race must finish, all AI finish, laps 0->1->2->3, results, 0 console errors, ~60 fps.
 * B. Mobile 844×390 touch: GAS held by touch, STEER ring driven by a second touch; small GAS jitter
 *    must not boost, an upward 60 px slide on GAS must boost (free when last, charged when not),
 *    throttle must stay on and steering must keep working through the slide; sliding off sideways
 *    still releases GAS (old behaviour).
 * Screenshots: docs/shots/75-*.png, report: docs/shots/75-verify.txt
 */
import puppeteer from '../node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import fs from 'fs';

const url = process.argv[2] || 'http://localhost:4173/';
const outDir = process.argv[3] || new URL('./shots', import.meta.url).pathname;
const ALL = ['neon', 'gridlock', 'razor', 'cargo'];
const deskTracks = (process.argv[4] || ALL.join(',')).split(',').filter((t) => ALL.includes(t));
const mobTracks = (process.argv[5] ?? 'neon,razor').split(',').filter((t) => ALL.includes(t));
const FULL_SHOTS = new Set(['neon', 'razor']); // READY/USED/LAST states on these, ACTIVE on all
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const log = (s) => { out.push(s); console.log(s); };
let allOk = true;
const check = (ok, what) => { if (!ok) allOk = false; log(`    [${ok ? 'ok' : 'FAIL'}] ${what}`); return ok; };

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });

function watchErrors(page, errs) {
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push('CONSOLE.' + m.type() + ' ' + m.text()); });
  page.on('requestfailed', (r) => errs.push('REQFAIL ' + r.url()));
}

/** In-page 50 ms recorder + rAF counter + optional steering bot (keyboard). */
async function installRecorder(page, withBot) {
  await page.evaluate(async (withBot) => {
    const { pointAt } = await import('./js/tracks.js');
    const { angleDiff } = await import('./js/util.js');
    window.__rec = []; window.__frames = 0;
    const fr = () => { window.__frames++; window.__fr = requestAnimationFrame(fr); }; fr();
    window.__recT = setInterval(() => {
      const g = window.__RAD_GAME__, w = g.world; if (!w || !g.isRunning()) return;
      const p = w.player, b = w.boost;
      window.__rec.push({ t: w.race.time, cd: w.race.countdown, spd: Math.hypot(p.vx, p.vy), lap: p.lap, fin: p.finished,
        act: b.activeMs, lvl: b.level, ch: b.charge, last: !!b.last, free: b.free, uses: b.uses, freeUses: b.freeUses,
        radius: w.track.pts[p.seg]?.radius ?? 0, paused: g.isPaused(), wall: p.wallHit || 0,
        aiBoost: w.cars.slice(1).some((c) => c.boostLevel > 0 || (c.top > 1100)) });
    }, 50);
    if (!withBot) return;
    const held = new Set();
    const set = (k, on) => { if (on && !held.has(k)) { held.add(k); window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); } else if (!on && held.has(k)) { held.delete(k); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); } };
    window.__botMode = 'drive';
    window.__bot = setInterval(() => {
      const w = window.__RAD_GAME__.world; if (!w) return; const p = w.player;
      const spd = Math.hypot(p.vx, p.vy);
      if (window.__botMode === 'idle') { ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].forEach((k) => set(k, false)); return; }
      const tp = pointAt(w.track, p.sPrev + 150 + spd * 0.35);
      const err = angleDiff(p.angle, Math.atan2(tp.y - p.y, tp.x - p.x));
      set('ArrowUp', true);
      set('ArrowRight', err > 0.05); set('ArrowLeft', err < -0.05);
      set('ArrowDown', Math.abs(err) > 0.7 && spd > 500);
    }, 30);
    window.__botStop = () => { clearInterval(window.__bot); ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].forEach((k) => set(k, false)); };
  }, withBot);
}

const st = (page) => page.evaluate(() => {
  const g = window.__RAD_GAME__, w = g.world, p = w.player, b = w.boost;
  return { running: g.isRunning(), paused: g.isPaused(), results: !!document.querySelector('#results'), t: w.race.time, cd: w.race.countdown,
    lap: p.lap, fin: p.finished, spd: Math.hypot(p.vx, p.vy), act: b.activeMs, lvl: b.level, ch: b.charge, last: !!b.last, free: b.free,
    uses: b.uses, freeUses: b.freeUses, src: b.source, dist: p.dist, L: w.track.length,
    place: g.getHudInfo().place, total: w.cars.length, inLap: p.dist - p.lap * w.track.length,
    minRAhead: (() => { let m = 1e9; const n = w.track.pts.length; for (let k = 0; k < 90; k++) m = Math.min(m, w.track.pts[(p.seg + k) % n].radius); return m; })() };
});
async function waitFor(page, pred, timeoutMs = 60000, every = 50) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { const s = await st(page); if (pred(s)) return s; await sleep(every); }
  return null;
}
const frame2 = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Render-transform orientation of every car on the current frame (length axis vs velocity). */
async function orient(page) {
  return page.evaluate(() => new Promise((resolve) => {
    window.__RAD_DEBUG__ = {};
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const f = window.__RAD_DEBUG__.frame; window.__RAD_DEBUG__ = null;
      const dAng = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
      resolve(f.cars.filter((c) => Math.hypot(c.vx, c.vy) > 150).map((c) => Math.abs(dAng(Math.atan2(c.lenAxis.y, c.lenAxis.x), Math.atan2(c.vy, c.vx))) * 180 / Math.PI));
    }));
  }));
}
async function shot(page, name, cropScale = 0) {
  const file = `${outDir}/75-${name}.png`;
  if (!cropScale) { await page.screenshot({ path: file }); return file; }
  const vp = page.viewport();
  const pos = await page.evaluate(() => { const w = window.__RAD_GAME__.world, c = w.cam, p = w.player; return { x: (p.x - c.x) * c.zoom + innerWidth / 2, y: (p.y - c.y) * c.zoom + innerHeight / 2 }; });
  const cw = 320, ch = 180;
  const x = Math.max(0, Math.min(vp.width - cw, pos.x - cw / 2)), y = Math.max(0, Math.min(vp.height - ch, pos.y - ch / 2));
  await page.screenshot({ path: file, clip: { x, y, width: cw, height: ch, scale: cropScale } });
  return file;
}

// ======================= A. desktop races =======================
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = []; watchErrors(page, errs);
await page.goto(url, { waitUntil: 'networkidle2' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle2' });
const raceRows = [];
const boostRows = [];

for (const name of deskTracks) {
  const ti = ALL.indexOf(name);
  const errStart = errs.length;
  log(`\n=== ${name.toUpperCase()} (desktop, Shift key) ===`);
  await page.click('[data-act=race]');
  await page.waitForSelector('#tracks button');
  const opts = await page.evaluate(() => document.querySelector('.tagline')?.textContent);
  await page.evaluate((ti) => document.querySelectorAll('#tracks button')[ti].click(), ti);
  await installRecorder(page, true);
  await page.evaluate(() => { window.__botMode = 'idle'; });
  const frames0 = await page.evaluate(() => window.__frames); const wall0 = Date.now();
  log(`  menu: ${opts}`);
  // countdown press must be ignored
  await waitFor(page, (s) => s.cd > 0 && s.cd < 2500);
  await page.keyboard.press('Shift');
  let s = await waitFor(page, (s) => s.cd <= 0);
  check(s.act === 0 && s.ch === 1 && s.uses === 0 && s.freeUses === 0, `Shift during countdown ignored; charge given at race start: charge=${s.ch} active=${s.act}`);

  // ---- 1. LAST: idle 4 s, then chained free boosts ----
  s = await waitFor(page, (s) => s.t > 4000);
  await sleep(150);
  s = await st(page);
  check(s.last, `idled 4 s at GO -> player last: last=${s.last} speed=${s.spd.toFixed(0)}`);
  if (FULL_SHOTS.has(name)) log(`    shot ${await shot(page, `${name}-last-unlimited`)}`);
  await page.evaluate(() => { window.__botMode = 'drive'; });
  const freeLog = [];
  for (let k = 0; k < 12; k++) {
    const before = await st(page);
    if (!before.last || before.lap > 0) break;
    await page.keyboard.press('Shift');
    await sleep(120);
    const after = await st(page);
    freeLog.push({ k, lastAtPress: before.last, fired: after.act > 0 && after.freeUses === before.freeUses + 1, free: after.free, ch: after.ch, spd: before.spd });
    if (k === 1 && FULL_SHOTS.has(name)) log(`    shot ${await shot(page, `${name}-last-active`)}`);
    const end = await waitFor(page, (x) => x.act <= 0, 4000, 25); // re-press as soon as it ends
    if (!end) break;
  }
  s = await st(page);
  check(freeLog.length >= 2 && freeLog.every((f) => f.fired && f.free && f.ch === 1),
    `LAST: ${freeLog.length} back-to-back Shift presses while last each fired a free boost (charge stayed 1): ${freeLog.map((f) => `${f.fired ? 'fired' : 'NO'}@${f.spd.toFixed(0)}`).join(', ')}`);
  // ---- 2. LAP CHARGE while clearly not last (≥1 car behind with some margin: place ≤ total-2) ----
  s = await waitFor(page, (x) => x.place <= x.total - 2 && x.act <= 0 && x.lvl === 0 && x.inLap > 1500 && x.inLap < x.L - 6000, 90000);
  check(!!s, `player clear of last place (P${s?.place}/${s?.total}) at t=${(s?.t / 1000).toFixed(1)}s lap=${s?.lap}`);
  // prefer a straight-ish stretch for a clean speed read (max 8 s wait, then press anyway)
  const margin = (x) => x.place <= x.total - 2 && x.lvl === 0 && x.act <= 0 && x.inLap > 800 && x.inLap < x.L - 6000;
  s = (await waitFor(page, (x) => margin(x) && x.spd > 850 && x.minRAhead > 1400, 8000)) || await waitFor(page, margin, 90000);
  if (FULL_SHOTS.has(name)) log(`    shot ${await shot(page, `${name}-ready`)}`);
  const b0 = await st(page);
  await page.keyboard.press('Shift');
  await sleep(100);
  const b1 = await st(page);
  const lapN = b0.lap;
  check(b1.act > 0 && !b1.free && b1.ch === 0 && b0.ch === 1 && b1.uses === b0.uses + 1, `lap ${lapN + 1} (P${b0.place}): Shift -> boost ACTIVE, charge ${b0.ch} -> ${b1.ch}, source=${b1.src}`);
  const trig = b1.t - 100;
  await waitFor(page, (x) => x.t - trig > 950, 3000, 20);
  log(`    shot ${await shot(page, `${name}-active`)}`);
  log(`    shot ${await shot(page, `${name}-active-car`, 3)}`);
  const m1 = await st(page);
  await page.keyboard.press('Shift'); await sleep(80);
  const m2 = await st(page);
  check(m2.act < m1.act && m2.uses === b1.uses && m2.freeUses === b1.freeUses, `second Shift mid-boost does not extend/restart it (remaining ${m1.act.toFixed(0)} -> ${m2.act.toFixed(0)} ms)`);
  await waitFor(page, (x) => x.act <= 0, 3000, 20);
  await sleep(400);
  const u0 = await st(page);
  await page.keyboard.press('Shift'); await sleep(150);
  const u1 = await st(page);
  if (u0.lap === lapN && u1.lap === lapN && !u0.last) {
    check(u1.act === 0 && u1.ch === 0 && u1.uses === u0.uses && u1.freeUses === u0.freeUses, `same lap, not last (P${u0.place}): Shift after the boost ended does nothing (active=${u1.act}, charge=${u1.ch})`);
  } else check(false, `could not test same-lap re-press (lap ${u0.lap}/${u1.lap}, last=${u0.last})`);
  if (FULL_SHOTS.has(name)) log(`    shot ${await shot(page, `${name}-used`)}`);
  const pre = await st(page);
  s = await waitFor(page, (x) => x.lap > lapN || x.results, 120000, 20);
  check(s && s.lap === lapN + 1 && s.ch === 1 && pre.ch === 0, `charge refilled on the lap crossing: lap ${lapN}->${s?.lap} charge ${pre.ch}->${s?.ch}`);
  // ---- 3. next lap: Shift during pause is dropped; boost; pause mid-boost freezes timer ----
  if (!s.fin && s.lap < 3) {
    const lapF = s.lap;
    await waitFor(page, (x) => x.inLap > 1200, 10000);
    await page.keyboard.press('p');
    await waitFor(page, (x) => x.paused, 3000);
    await page.keyboard.press('Shift');
    await sleep(700);
    await page.click('#resume');
    await sleep(400);
    const q = await st(page);
    check(!q.paused && q.act === 0 && q.ch === 1, `Shift pressed while paused is dropped on resume (active=${q.act}, charge=${q.ch})`);
    s = (await waitFor(page, (x) => x.lap === lapF && !x.last && x.spd > 700 && x.inLap > 2500 && x.inLap < x.L - 5000, 20000)) || await st(page);
    await page.keyboard.press('Shift'); await sleep(100);
    const f1 = await st(page);
    check(f1.act > 0 && !f1.free && f1.ch === 0, `lap ${lapF + 1}: refilled charge fires again (charge ${f1.ch}, active ${f1.act.toFixed(0)} ms)`);
    await waitFor(page, (x) => x.act < 1200, 3000, 20);
    await page.keyboard.press('p');
    const p0 = await waitFor(page, (x) => x.paused, 3000, 10);
    await sleep(1500);
    const p1 = await st(page);
    check(p1.paused && Math.abs(p1.act - p0.act) < 1 && p1.act > 0, `pause freezes the boost timer: ${p0.act.toFixed(0)} ms left at pause, ${p1.act.toFixed(0)} ms after 1.5 s paused`);
    await page.click('#resume');
    const r1 = await waitFor(page, (x) => !x.paused && x.act <= 0, 4000, 20);
    check(!!r1, `boost continues after resume and runs out (${r1 ? (r1.t - p1.t).toFixed(0) : '?'} ms of race time later)`);
  }
  // ---- finish ----
  s = await waitFor(page, (x) => x.results, 300000, 200);
  const fin = await page.evaluate(() => {
    window.__botStop(); clearInterval(window.__recT); cancelAnimationFrame(window.__fr);
    const w = window.__RAD_GAME__.world;
    return { res: window.__RAD_LAST_RESULT__, frames: window.__frames, cars: w.cars.map((c) => ({ name: c.name, lap: c.lap, finished: c.finished, dnf: !!c.dnf })), rec: window.__rec };
  });
  const fps = (fin.frames - frames0) / ((Date.now() - wall0) / 1000);
  if (s) await page.screenshot({ path: `${outDir}/75-${name}-results.png` });
  // lap sequence + speed analysis from the 50 ms recorder
  const rec = fin.rec.filter((r) => r.cd <= 0);
  const lapSeq = [0]; for (const r of rec) if (r.lap > lapSeq.at(-1)) lapSeq.push(r.lap);
  // charge never exceeds 1; crossings with an unused charge leave it at exactly 1
  const maxCh = Math.max(...rec.map((r) => r.ch));
  const crossings = []; for (let i = 1; i < rec.length; i++) if (rec[i].lap > rec[i - 1].lap) crossings.push({ lap: rec[i].lap, before: rec[i - 1].ch, after: rec[i].ch });
  check(maxCh === 1 && crossings.every((c) => c.after === 1) && crossings.some((c) => c.before === 1), `no stacking: max charge ${maxCh}; crossings (charge before->after) ${crossings.map((c) => `L${c.lap}:${c.before}->${c.after}`).join(' ')}`);
  const bw = rec.filter((r) => r.lvl > 0.5 && !r.paused), nw = rec.filter((r) => r.lvl === 0 && !r.fin && !r.paused);
  const wallRate = (arr) => arr.filter((r) => r.wall > 250).length / Math.max(1, arr.length * 0.05);
  log(`    hard wall hits per second: boosting ${wallRate(bw).toFixed(2)} (${(bw.length * 0.05).toFixed(1)} s sampled) vs not boosting ${wallRate(nw).toFixed(2)}`);
  const trigs = []; for (let i = 1; i < rec.length; i++) if (rec[i].act > 0 && (rec[i - 1].act <= 0 || rec[i].act > rec[i - 1].act + 100)) trigs.push(i);
  // unboosted reference top speed: max speed with no boost for ≥3 s
  let lastBoostT = -1e9; const clean = [];
  for (const r of rec) { if (r.lvl > 0) lastBoostT = r.t; else if (r.t - lastBoostT > 3000 && !r.fin) clean.push(r.spd); }
  const baseTop = Math.max(...clean);
  const charged = trigs.filter((i) => !rec[i].free);
  const detail = charged.map((i) => {
    const t0 = rec[i].t; const win = rec.filter((r) => r.t >= t0 - 100 && r.t <= t0 + 2600);
    const peak = Math.max(...win.map((r) => r.spd));
    const at = (dt) => rec.reduce((a, r) => (Math.abs(r.t - t0 - dt) < Math.abs(a.t - t0 - dt) ? r : a), rec[i]);
    let maxJerk = 0; for (let k = i; k < rec.length && rec[k].t < t0 + 5000; k++) { if (!rec[k].paused && !rec[k - 1].paused && rec[k].t > rec[k - 1].t) maxJerk = Math.max(maxJerk, Math.abs(rec[k].spd - rec[k - 1].spd) / ((rec[k].t - rec[k - 1].t) / 1000)); }
    return { lap: rec[i].lap, v0: rec[i].spd, peak, v1: at(1000).spd, v2: at(2000).spd, v35: at(3500).spd, v5: at(5000).spd, lvlEnd: at(2400).lvl, maxDv: maxJerk };
  });
  log(`  speed trace per lap-charge boost (wu/s; unboosted reference top ${baseTop.toFixed(0)}):`);
  detail.forEach((d) => log(`    lap ${d.lap + 1}: at press ${d.v0.toFixed(0)} -> +1s ${d.v1.toFixed(0)} -> +2s ${d.v2.toFixed(0)} (peak ${d.peak.toFixed(0)} = ${((d.peak / baseTop - 1) * 100).toFixed(0)}% over ref top) -> +3.5s ${d.v35.toFixed(0)} -> +5s ${d.v5.toFixed(0)}; max |dv/dt| ${d.maxDv.toFixed(0)} wu/s²`));
  const bestGain = Math.max(...detail.map((d) => d.peak / baseTop - 1));
  check(detail.length >= 2 && bestGain > 0.25, `speed clearly rises during boost (best peak +${(bestGain * 100).toFixed(0)}% over unboosted top ${baseTop.toFixed(0)})`);
  check(detail.every((d) => d.v5 < d.peak - 80 || d.v5 < baseTop * 1.05), `speed returns to normal after the boost (+5 s speeds ${detail.map((d) => d.v5.toFixed(0)).join(', ')})`);
  check(!rec.some((r) => r.aiBoost), 'AI never boosted (no AI boost level / raised top)');
  const orientErr = await Promise.resolve([]);
  const aiAll = fin.cars.slice(1).every((c) => c.finished && !c.dnf && c.lap === 3);
  const e = errs.length - errStart;
  const ok = !!s && aiAll && fin.cars[0].lap === 3 && lapSeq.join(',') === '0,1,2,3' && e === 0 && fps > 55;
  check(ok, `race: results=${!!s} laps ${lapSeq.join('→')} allAIfinished=${aiAll} errors=${e} rAF≈${fps.toFixed(1)}fps`);
  raceRows.push(`  ${name.padEnd(9)} ${ok ? 'PASS' : 'FAIL'}  P${fin.res?.playerPlace} ${(fin.res?.totalTime / 1000).toFixed(2)}s best lap ${(fin.res?.bestLapMs / 1000).toFixed(2)}s  laps ${lapSeq.join('→')}  standings ${fin.res?.standings.map((x) => `${x.name}${x.dnf ? '(DNF)' : ' ' + (x.finishTime / 1000).toFixed(1)}`).join(' > ')}  free boosts ${freeLog.length}  charged ${detail.length}  fps ${fps.toFixed(1)}  errors ${e}`);
  boostRows.push(`  ${name.padEnd(9)} unboosted top ${baseTop.toFixed(0)}  boosted peaks ${detail.map((d) => d.peak.toFixed(0)).join('/')}  best +${(bestGain * 100).toFixed(0)}%`);
  // restart resets boost state (Race again), then quit to the menu
  if (s && name === deskTracks.at(-1)) {
    await page.click('#again');
    await sleep(600);
    const r = await st(page);
    check(r.cd > 0 && r.ch === 1 && r.act === 0 && r.uses === 0 && r.freeUses === 0 && r.lvl === 0, `Race again -> fresh boost state (charge ${r.ch}, uses ${r.uses}, free ${r.freeUses}, active ${r.act})`);
    await waitFor(page, (x) => x.cd <= 0, 6000);
    await page.keyboard.press('p'); await waitFor(page, (x) => x.paused, 3000);
    await page.click('#quit');
  } else if (s) {
    await page.click('#title');
  }
  await page.waitForSelector('[data-act=race]');
}

// ======================= B. mobile touch =======================
const mob = await browser.newPage();
await mob.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
const merrs = []; watchErrors(mob, merrs);
const cdp = await mob.createCDPSession();
await mob.goto(url, { waitUntil: 'networkidle2' });
await mob.evaluate(() => localStorage.clear());
await mob.reload({ waitUntil: 'networkidle2' });
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 6, radiusY: 6, force: 1 })) });
const mobRows = [];
for (const name of mobTracks) {
  const ti = ALL.indexOf(name);
  log(`\n=== ${name.toUpperCase()} (mobile 844×390, touch) ===`);
  await mob.tap('[data-act=race]');
  await mob.waitForSelector('#tracks button');
  await mob.evaluate((ti) => document.querySelectorAll('#tracks button')[ti].scrollIntoView(), ti);
  await (await mob.$$('#tracks button'))[ti].tap();
  await installRecorder(mob, false);
  await waitFor(mob, (x) => x.running && x.cd > 0, 5000);
  const rects = await mob.evaluate(() => { const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; }; return { gas: r('btn-accel'), pad: r('aim-pad') }; });
  log(`  GAS centre (${rects.gas.x.toFixed(0)},${rects.gas.y.toFixed(0)}) ${rects.gas.w.toFixed(0)}px; STEER pad centre (${rects.pad.x.toFixed(0)},${rects.pad.y.toFixed(0)}) ${rects.pad.w.toFixed(0)}px`);
  let gas = { id: 0, x: rects.gas.x, y: rects.gas.y + 12 };
  let steer = { id: 1, x: rects.pad.x, y: rects.pad.y - rects.pad.w * 0.35 };
  await touch('touchStart', [gas]);
  await touch('touchStart', [gas, steer]);
  let steerOn = true;
  const aimErrs = [];
  // steering loop: point the STEER touch at the road ahead (like a player's thumb)
  const steerStep = async () => {
    const a = await mob.evaluate(async () => {
      const { pointAt } = await import('./js/tracks.js');
      const w = window.__RAD_GAME__.world, p = w.player, spd = Math.hypot(p.vx, p.vy);
      const tp = pointAt(w.track, p.sPrev + 150 + spd * 0.35);
      const i = window.__RAD_INPUT__.state;
      return { target: Math.atan2(tp.y - p.y, tp.x - p.x), heading: p.angle, aimActive: i.aimActive, aim: i.aimAngle, accel: i.accel };
    });
    const r = rects.pad.w * 0.36;
    steer = { id: 1, x: rects.pad.x + Math.cos(a.target) * r, y: rects.pad.y + Math.sin(a.target) * r };
    if (steerOn) await touch('touchMove', [gas, steer]);
    return a;
  };
  const drive = async (ms, onTick) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const a = await steerStep(); if (onTick) await onTick(a); await sleep(40); } };
  await waitFor(mob, (x) => x.cd <= 0, 6000);
  // 1. plain GAS hold with small jitter: throttle on, no boost
  const angErr = (a) => { let d = a.heading - a.aim; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d) * 180 / Math.PI; };
  const median = (arr) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  const hErr0 = [];
  await drive(1500, async (a) => { if (a.aimActive) hErr0.push(angErr(a)); gas = { id: 0, x: rects.gas.x + (Math.random() - 0.5) * 16, y: rects.gas.y + 12 + (Math.random() - 0.5) * 16 }; });
  let s = await st(mob);
  let inp = await mob.evaluate(() => ({ ...window.__RAD_INPUT__.state }));
  check(inp.accel && s.act === 0 && s.uses === 0 && s.freeUses === 0 && s.spd > 400, `GAS touch-hold (with ±8px jitter) = throttle as before, no boost (accel=${inp.accel}, speed ${s.spd.toFixed(0)})`);
  // 2. upward slide while last (the player starts at the back) -> free boost; steering keeps tracking
  const slide = async () => {
    const y0 = gas.y; const trace = [];
    for (let k = 1; k <= 6; k++) { gas = { id: 0, x: gas.x, y: y0 - k * 10 }; const a = await steerStep(); trace.push(a); await sleep(20); }
    return trace;
  };
  const slideBack = async () => { const y0 = gas.y; for (let k = 1; k <= 6; k++) { gas = { id: 0, x: gas.x, y: y0 + k * 10 }; await steerStep(); await sleep(20); } };
  let pre = await st(mob);
  let tr = await slide();
  await sleep(60);
  s = await st(mob);
  inp = await mob.evaluate(() => ({ ...window.__RAD_INPUT__.state }));
  const firedSlide1 = s.act > 0 && s.src === 'slide';
  check(firedSlide1 && inp.accel, `60 px upward slide on GAS fired a boost (${s.free ? 'free, player last' : 'lap charge'}; source=${s.src}); GAS still held (accel=${inp.accel})`);
  if (name === mobTracks[0]) { await sleep(500); log(`    shot ${await shot(mob, `mobile-${name}-slide-active`)}`); }
  // steering through the slide: heading error vs STEER aim during the next 2 s
  const hErr = [];
  await drive(2000, async (a) => { if (a.aimActive) { let d = a.heading - a.aim; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; hErr.push(Math.abs(d) * 180 / Math.PI); } aimErrs.push(a.aimActive); });
  const inpS = await mob.evaluate(() => ({ ...window.__RAD_INPUT__.state }));
  check(tr.every((a) => a.aimActive) && aimErrs.every(Boolean) && inpS.accel, `steering stayed active through and after the slide (aimActive every tick, accel=${inpS.accel}); car heading vs STEER aim median ${median(hErr)?.toFixed(1)}° in the 2 s after the slide vs ${median(hErr0)?.toFixed(1)}° during the plain GAS hold before it`);
  await slideBack();
  // 3. drive until not last, then a slide uses the lap charge
  const nl = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 60000) { await drive(300); const x = await st(mob); if (x.place <= x.total - 2 && x.act <= 0 && x.lvl === 0 && x.inLap > 800 && x.inLap < x.L - 6000) return x; } return null; })();
  if (check(!!nl, `touch-driven car clear of last place (P${nl?.place}/${nl?.total}) at t=${(nl?.t / 1000).toFixed(1)}s lap ${nl?.lap}`)) {
    // lift both thumbs (CDP touchEnd releases all points) and press STEER + GAS again
    await touch('touchEnd', []); gas = { id: 0, x: rects.gas.x, y: rects.gas.y + 12 };
    await touch('touchStart', [steer]); await touch('touchStart', [steer, gas]);
    await drive(300);
    pre = await st(mob);
    tr = await slide(); await sleep(60);
    s = await st(mob);
    const inpC = await mob.evaluate(() => ({ ...window.__RAD_INPUT__.state }));
    check(s.act > 0 && !s.free && s.ch === 0 && pre.ch === 1 && s.src === 'slide', `slide while not last (P${pre.place} at press) used the lap charge (charge ${pre.ch} -> ${s.ch}; active=${s.act.toFixed(0)} free=${s.free} last=${s.last} P${s.place} accel=${inpC.accel})`);
    if (name !== mobTracks[0]) { await sleep(500); log(`    shot ${await shot(mob, `mobile-${name}-slide-active`)}`); }
    await drive(2400);
    await slideBack();
    // second slide on the same lap (thumb slid back down = re-armed, still holding GAS) does nothing
    await drive(200); const b = await st(mob);
    const acc0 = await mob.evaluate(() => window.__RAD_INPUT__.state.accel);
    check(acc0, `thumb back on GAS after the slide: throttle still held (accel=${acc0})`);
    tr = await slide(); await sleep(80); s = await st(mob);
    if (b.lap === s.lap && !b.last) check(s.act === 0 && s.uses === b.uses && s.freeUses === b.freeUses, `second slide on the same lap, not last (P${b.place}), does nothing (active=${s.act}, uses ${b.uses}->${s.uses})`);
    else log(`    [info] second-slide check skipped (lap changed or last again)`);
    await slideBack();
  }
  // 4. sliding off GAS sideways still releases the throttle (unchanged behaviour)
  const tgt = { id: 0, x: rects.gas.x - rects.gas.w, y: rects.gas.y };
  gas = tgt; await touch('touchMove', [steer, gas]); await sleep(120);
  inp = await mob.evaluate(() => ({ ...window.__RAD_INPUT__.state }));
  check(!inp.accel, `sliding off GAS sideways releases the throttle as before (accel=${inp.accel})`);
  await touch('touchEnd', []);
  await sleep(200);
  inp = await mob.evaluate(() => ({ ...window.__RAD_INPUT__.state }));
  check(!inp.accel && !inp.aimActive, `all touches lifted -> no throttle, no aim`);
  const orientNow = await orient(mob);
  check(orientNow.every((e) => e < 20), `cars drawn along their velocity (render transform) max err ${Math.max(0, ...orientNow).toFixed(1)}°`);
  await mob.evaluate(() => { clearInterval(window.__recT); cancelAnimationFrame(window.__fr); });
  // quit back to menu
  await mob.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' })));
  await mob.waitForSelector('#quit'); await mob.tap('#quit');
  await mob.waitForSelector('[data-act=race]');
  mobRows.push(`  ${name.padEnd(9)} touch slide boost verified; errors ${merrs.length}`);
}
check(merrs.length === 0, `mobile console errors: ${merrs.length} ${JSON.stringify(merrs.slice(0, 3))}`);

// fps probe during a boost
await page.bringToFront();
await page.click('[data-act=race]'); await page.waitForSelector('#tracks button');
await page.evaluate(() => document.querySelectorAll('#tracks button')[0].click());
await page.keyboard.down('ArrowUp');
await sleep(6500);
await page.keyboard.press('Shift');
const f0 = await page.evaluate(() => new Promise((res) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t) / 1000)); }; requestAnimationFrame(f); }));
await page.keyboard.up('ArrowUp');
check(f0 > 55, `fps during a boost (1280×720 headless): ${f0.toFixed(1)}`);
check(errs.length === 0, `desktop console errors/warnings: ${errs.length} ${JSON.stringify(errs.slice(0, 3))}`);
const sw = await page.evaluate(() => fetch('./sw.js').then((r) => r.text()).then((t) => t.match(/radcars-v[\w-]+/)?.[0]));
await browser.close();

const head = [`Radcars ${sw} boost verification ${new Date().toString()}`, `URL ${url}`, '', 'RACES (menus, 3 laps, 5 AI Normal, bot steering; boost via Shift)', ...raceRows, '', 'BOOST SPEED', ...boostRows, '', 'MOBILE TOUCH', ...mobRows, '', `OVERALL: ${allOk ? 'PASS' : 'FAIL'}`, '', 'DETAIL'];
fs.writeFileSync(`${outDir}/75-verify.txt`, [...head, ...out].join('\n'));
console.log('\n' + head.join('\n'));
