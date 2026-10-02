/**
 * Radcars v48 verification: brake removed, seeker missile, boost pads.
 *   node docs/verify-v48.mjs [url] [outDir] [tracks=neon,gridlock,razor,cargo] [mobileTracks=neon,cargo] [trialSecs=75]
 *
 * A. RULE RACE per track (desktop 1280×720, menus, 3 laps, 5 AI, Normal, steering bot with NO brake):
 *    Space in the countdown is ignored; the bot idles 3 s at GO so the field is ahead; lap 1: Space fires
 *    at the car ahead (charge 1→0), a 2nd Space on the same lap does nothing, charge refills at the line;
 *    lap 2: Space while paused is dropped; further shots are fired when a target is in range (or refused
 *    with NO TARGET when P1 — charge kept). Hits: 360° spin, speed cut, no drive during the spin.
 *    Pads: counted for the player and every AI. Stuck check: no car sits < 30 wu/s for > 3 s (outside
 *    spins/finish). Race must finish, laps 0→1→2→3, results, 0 console errors, ~60 fps.
 * B. HIT-RATE TRIAL per track (real race, verification-only tweaks: player top 760 so the pack stays
 *    ahead, charge refilled after each missile): shots at targets 80–1500 wu ahead → hit rate.
 * C. BRAKE GONE + UNSTICK: ↓/S do nothing (coast decel only); a car parked nose-first against a wall
 *    with the gas held auto-reverses after ~1.5 s and drives off.
 * D. MOBILE 844×390 touch: no BRK; GAS hold; left slide = missile; up slide = boost; diagonal slides
 *    fire only the dominant axis.
 * Shots: docs/shots/76-*.png. Report: docs/shots/76-verify.txt
 */
import puppeteer from '../node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import fs from 'fs';

const url = process.argv[2] || 'http://localhost:4173/';
const outDir = process.argv[3] || new URL('./shots', import.meta.url).pathname;
const ALL = ['neon', 'gridlock', 'razor', 'cargo'];
const deskTracks = (process.argv[4] || ALL.join(',')).split(',').filter((t) => ALL.includes(t));
const mobTracks = (process.argv[5] ?? 'neon,cargo').split(',').filter((t) => ALL.includes(t));
const TRIAL_SECS = +(process.argv[6] || 75);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const log = (s) => { out.push(s); console.log(s); };
let allOk = true;
const check = (ok, what) => { if (!ok) allOk = false; log(`    [${ok ? 'ok' : 'FAIL'}] ${what}`); return ok; };
const TAU = Math.PI * 2;

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
function watchErrors(page, errs) {
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push('CONSOLE.' + m.type() + ' ' + m.text()); });
  page.on('requestfailed', (r) => errs.push('REQFAIL ' + r.url()));
}

/** 50 ms recorder of every car + missile state, rAF counter, steering bot (keyboard, no brake). */
async function installRecorder(page, withBot) {
  await page.evaluate(async (withBot) => {
    const { pointAt } = await import('./js/tracks.js');
    const { angleDiff } = await import('./js/util.js');
    window.__W = await import('./js/weapons.js');
    window.__rec = []; window.__frames = 0;
    const fr = () => { window.__frames++; window.__fr = requestAnimationFrame(fr); }; fr();
    window.__recT = setInterval(() => {
      const g = window.__RAD_GAME__, w = g.world; if (!w || !g.isRunning()) return;
      const p = w.player, ms = w.missile;
      window.__rec.push({ t: w.race.time, cd: w.race.countdown, lap: p.lap, fin: p.finished, paused: g.isPaused(),
        ch: ms.charge, shots: ms.shots, hits: ms.hits, fly: ms.inFlight, unstick: w.unstick.count,
        cars: w.cars.map((c) => [Math.round(Math.hypot(c.vx, c.vy)), c.spinMs || 0, +(c.spinVis || 0).toFixed(3), +(c.boostLevel || 0).toFixed(2), c.padMs || 0, c.finished ? 1 : 0, c.drive ? 1 : 0, c.spinCut || null]) });
    }, 50);
    if (!withBot) return;
    const held = new Set();
    const set = (k, on) => { if (on && !held.has(k)) { held.add(k); window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); } else if (!on && held.has(k)) { held.delete(k); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); } };
    window.__botMode = 'drive';
    window.__bot = setInterval(() => {
      const w = window.__RAD_GAME__.world; if (!w) return; const p = w.player;
      const spd = Math.hypot(p.vx, p.vy);
      if (window.__botMode === 'idle') { ['ArrowUp', 'ArrowLeft', 'ArrowRight'].forEach((k) => set(k, false)); return; }
      const tp = pointAt(w.track, p.sPrev + 150 + spd * 0.35);
      const err = angleDiff(p.angle, Math.atan2(tp.y - p.y, tp.x - p.x));
      set('ArrowUp', window.__botMode !== 'coast' && !(Math.abs(err) > 0.7 && spd > 500)); // no brake: lift off when badly off line
      set('ArrowRight', err > 0.05); set('ArrowLeft', err < -0.05);
    }, 30);
    window.__botStop = () => { clearInterval(window.__bot); ['ArrowUp', 'ArrowLeft', 'ArrowRight'].forEach((k) => set(k, false)); };
    window.__order = () => [...window.__RAD_GAME__.world.cars].sort((a, b) => (a.finished && b.finished) ? a.finishPlace - b.finishPlace : a.finished ? -1 : b.finished ? 1 : b.dist - a.dist);
  }, withBot);
}

const st = (page) => page.evaluate(() => {
  const g = window.__RAD_GAME__, w = g.world, p = w.player, ms = w.missile;
  const tg = window.__W.pickTarget(w, window.__order ? window.__order() : [...w.cars].sort((a, b) => b.dist - a.dist));
  let ahead = null; if (tg) { ahead = ((tg.sPrev - p.sPrev) % w.track.length + w.track.length) % w.track.length; if (ahead > w.track.length / 2) ahead -= w.track.length; }
  return { running: g.isRunning(), paused: g.isPaused(), results: !!document.querySelector('#results'), t: w.race.time, cd: w.race.countdown,
    lap: p.lap, fin: p.finished, spd: Math.hypot(p.vx, p.vy), ch: ms.charge, shots: ms.shots, hits: ms.hits, refused: ms.refused, fly: ms.inFlight,
    flash: ms.flash?.text || null, src: ms.lastSource, place: g.getHudInfo().place, total: w.cars.length, target: tg ? tg.id : null, ahead,
    inLap: p.dist - p.lap * w.track.length, L: w.track.length, logN: ms.log.length, boostUses: w.boost.uses + w.boost.freeUses, boostCh: w.boost.charge };
});
async function waitFor(page, pred, timeoutMs = 60000, every = 40) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { const s = await st(page); if (pred(s)) return s; await sleep(every); }
  return null;
}
const frame2 = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** Screenshot cropped around a world point (at the current race camera), 3× scale. */
async function shotAt(page, name, wx, wy, cw = 320, ch = 180, scale = 3) {
  const vp = page.viewport();
  const pos = await page.evaluate((wx, wy) => { const c = window.__RAD_GAME__.world.cam; return { x: (wx - c.x) * c.zoom + innerWidth / 2, y: (wy - c.y) * c.zoom + innerHeight / 2 }; }, wx, wy);
  const x = Math.max(0, Math.min(vp.width - cw, pos.x - cw / 2)), y = Math.max(0, Math.min(vp.height - ch, pos.y - ch / 2));
  const file = `${outDir}/76-${name}.png`;
  await page.screenshot({ path: file, clip: { x, y, width: cw, height: ch, scale } });
  return file;
}
async function shotFull(page, name) { const file = `${outDir}/76-${name}.png`; await page.screenshot({ path: file }); return file; }
async function startRace(page, ti) {
  await page.click('[data-act=race]');
  await page.waitForSelector('#tracks button');
  const opts = await page.evaluate(() => document.querySelector('.tagline')?.textContent);
  await page.evaluate((ti) => document.querySelectorAll('#tracks button')[ti].click(), ti);
  return opts;
}
async function quitRace(page) {
  await page.evaluate(() => { window.__botStop && window.__botStop(); clearInterval(window.__recT); cancelAnimationFrame(window.__fr); });
  if (await page.$('#results')) { await page.click('#title'); }
  else {
    const s = await st(page);
    if (s.cd > 0) await waitFor(page, (x) => x.cd <= 0, 6000);
    if (!(await page.$('#quit'))) { await page.keyboard.press('p'); await page.waitForSelector('#quit'); }
    await page.click('#quit');
  }
  await page.waitForSelector('[data-act=race]');
}

/** Analyse spins from the recorder: for each car spin, duration, peak spinVis, speed before/after, max speed rise. */
function spinsFrom(rec) {
  const spins = [];
  const n = rec[0]?.cars.length || 0;
  for (let ci = 1; ci < n; ci++) {
    let cur = null;
    for (let i = 1; i < rec.length; i++) {
      const a = rec[i - 1].cars[ci], b = rec[i].cars[ci];
      if (!cur && b[1] > 0 && (a[1] === 0 || b[1] > a[1])) cur = { car: ci, t0: rec[i].t, vBefore: a[0], vAfter: b[0], peakVis: b[2], maxRise: 0, lastV: b[0], samples: 1, driveFrames: 0, cut: b[7], monotone: true, lastVis: b[2] };
      else if (cur && b[1] > 0) {
        cur.samples++; cur.peakVis = Math.max(cur.peakVis, b[2]); if (b[2] + 1e-3 < cur.lastVis) cur.monotone = false; cur.lastVis = b[2];
        cur.maxRise = Math.max(cur.maxRise, b[0] - cur.lastV); cur.lastV = b[0]; if (b[6]) cur.driveFrames++;
      } else if (cur && b[1] === 0) { cur.t1 = rec[i].t; cur.vEnd = b[0]; spins.push(cur); cur = null; }
    }
  }
  return spins;
}
function stuckFrom(rec) {
  const n = rec[0]?.cars.length || 0; const worst = [];
  for (let ci = 0; ci < n; ci++) {
    let run = 0, best = 0, prevT = null;
    for (const r of rec) {
      if (r.cd > 0 || r.paused) { prevT = r.t; continue; }
      const c = r.cars[ci];
      if (c[0] < 30 && c[1] === 0 && !c[5] && r.t > 4500) run += r.t - (prevT ?? r.t); else run = 0;
      best = Math.max(best, run); prevT = r.t;
    }
    worst.push(best);
  }
  return worst;
}

// ======================= A. rule races =======================
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = []; watchErrors(page, errs);
await page.goto(url, { waitUntil: 'networkidle2' });
const rendererKind = await page.evaluate(() => window.__RAD_RENDERER__); // v51: 'pixi' (default) or 'canvas' (?canvas=1 / fallback)
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle2' });
const hasBrk = await page.evaluate(() => !!document.getElementById('btn-brake') || !!document.querySelector('[data-action=brake], .tc-brake'));
check(!hasBrk, `no BRK control in the DOM (btn-brake / data-action=brake / .tc-brake): ${hasBrk ? 'present' : 'absent'}`);
const raceRows = [], padRows = [], spinRows = [], trialRows = [];
const shotLog = [];
let gotInFlight = false, gotSpin = 0, gotExplosion = false, gotHud = false, aiPadShots = 0, playerPadShots = 0;

async function tryFire(page, why) {
  const before = await st(page);
  await page.keyboard.press(' ');
  await sleep(90);
  const after = await st(page);
  return { before, after, why };
}
/** After a fired shot: capture in-flight / explosion / spin shots, wait for the result. */
async function followShot(page, name, before) {
  if (!gotInFlight || name.startsWith('neon') || name.startsWith('razor')) {
    await sleep(120);
    const m = await page.evaluate(() => { const m = window.__RAD_GAME__.world.missiles.find((x) => !x.dead); return m ? { x: m.x, y: m.y, tx: m.target.x, ty: m.target.y } : null; });
    if (m) { log(`    shot ${await shotAt(page, `${name}-missile-flight`, (m.x * 2 + m.tx) / 3, (m.y * 2 + m.ty) / 3, 400, 225, 3)}`); gotInFlight = true; }
  }
  const end = await waitFor(page, (x) => x.logN > before.logN, 5000, 20);
  const rec = await page.evaluate(() => window.__RAD_GAME__.world.missile.log.at(-1));
  if (rec?.result === 'hit') {
    const pos = await page.evaluate((id) => { const c = window.__RAD_GAME__.world.cars.find((x) => x.id === id); return { x: c.x, y: c.y }; }, rec.hitId);
    if (!gotExplosion || name.startsWith('razor')) { log(`    shot ${await shotAt(page, `${name}-hit-explosion`, pos.x, pos.y)}`); gotExplosion = true; }
    await sleep(140);
    const pos2 = await page.evaluate((id) => { const c = window.__RAD_GAME__.world.cars.find((x) => x.id === id); return { x: c.x, y: c.y, spin: c.spinMs, vis: c.spinVis }; }, rec.hitId);
    if (pos2.spin > 0 && gotSpin < 3) { log(`    shot ${await shotAt(page, `${name}-target-spin${gotSpin ? `-${gotSpin + 1}` : ""}`, pos2.x, pos2.y)}  (spinMs left ${pos2.spin.toFixed(0)}, drawn rotation ${(pos2.vis * 180 / Math.PI).toFixed(0)}°)`); gotSpin++; }
  }
  return { end, rec };
}

for (const name of deskTracks) {
  const ti = ALL.indexOf(name);
  const errStart = errs.length;
  log(`\n=== ${name.toUpperCase()} — rule race (desktop, Space) ===`);
  const opts = await startRace(page, ti);
  await installRecorder(page, true);
  await page.evaluate(() => { window.__botMode = 'idle'; });
  const frames0 = await page.evaluate(() => window.__frames); const wall0 = Date.now();
  log(`  menu: ${opts}`);
  await waitFor(page, (x) => x.cd > 0 && x.cd < 2500);
  await page.keyboard.press(' ');
  let s = await waitFor(page, (x) => x.cd <= 0);
  check(s.shots === 0 && s.ch === 1 && !s.fly, `Space in the countdown ignored; missile charge available at GO (charge=${s.ch}, shots=${s.shots})`);
  // pad overview shot (fixed camera over pad #1) + HUD with both panels
  const pads = await page.evaluate(() => window.__RAD_GAME__.world.track.pads.map((p) => ({ s: p.s, x: p.x, y: p.y, lat: p.lat, w: p.halfW * 2 })));
  log(`  pads: ${pads.length} at s=${pads.map((p) => p.s).join(', ')} (width ${pads[0].w.toFixed(0)} wu of ${(await page.evaluate(() => window.__RAD_GAME__.world.track.halfW * 2))} wu road)`);
  await waitFor(page, (x) => x.t > 1800);
  await page.evaluate(() => { window.__botMode = 'drive'; });
  // ---- lap 1: first shot at a target 80–1500 ahead ----
  s = await waitFor(page, (x) => x.lap === 0 && x.target != null && x.ahead > 80 && x.ahead < 1500 && x.inLap < x.L - 4000, 40000, 30);
  if (check(!!s, `lap 1: target in range (car #${s?.target}, ${s?.ahead?.toFixed(0)} wu ahead, P${s?.place})`)) {
    if (!gotHud || name === 'razor') { log(`    shot ${await shotFull(page, `${name}-hud-ready`)}`); gotHud = true; }
    const f = await tryFire(page);
    check(f.after.shots === f.before.shots + 1 && f.after.ch === 0, `Space fired the missile: charge ${f.before.ch}→${f.after.ch}, in flight=${f.after.fly} (false = already landed), source=${f.after.src}`);
    if (name === 'neon' || name === 'cargo') log(`    shot ${await shotFull(page, `${name}-hud-inflight`)}`);
    const r = await followShot(page, name, f.before);
    log(`    result: ${r.rec?.result} (target #${r.rec?.targetId}, hit #${r.rec?.hitId}, ${r.rec?.ahead0?.toFixed(0)} wu ahead at launch, flight ${r.rec?.flightMs?.toFixed(0)} ms)`);
    shotLog.push({ track: name, mode: 'rule', ...r.rec });
    await sleep(250);
    if (name === 'neon' || name === 'razor') log(`    shot ${await shotFull(page, `${name}-hud-flash`)}`);
    const g0 = await st(page);
    await page.keyboard.press(' '); await sleep(120);
    const g1 = await st(page);
    check(g1.lap === g0.lap && g1.shots === g0.shots && g1.ch === 0 && !g1.fly, `2nd Space on the same lap does nothing (shots ${g0.shots}→${g1.shots}, charge ${g1.ch})`);
    // pad overview shot: fixed camera over pad #2 for two frames (the race keeps running; the bot drives from world state)
    const pp = pads[1] || pads[0];
    await page.evaluate((p) => { window.__RAD_CAM__ = { x: p.x, y: p.y, zoom: 0.9 }; }, pp);
    await frame2(page);
    log(`    shot ${await shotAt(page, `${name}-pad`, pp.x, pp.y, 640, 360, 1.5)}`);
    await page.evaluate(() => { window.__RAD_CAM__ = null; });
  }
  s = await waitFor(page, (x) => x.lap >= 1 || x.results, 120000, 30);
  check(s && s.ch === 1, `missile charge refilled at the line (lap ${s?.lap}, charge ${s?.ch})`);
  // ---- lap 2: pause drop, then shoot (or refused when P1) ----
  if (s && !s.fin) {
    await waitFor(page, (x) => x.inLap > 1000, 20000);
    await page.keyboard.press('p'); await waitFor(page, (x) => x.paused, 3000);
    await page.keyboard.press(' '); await sleep(500);
    await page.click('#resume'); await sleep(300);
    const q = await st(page);
    check(!q.paused && q.shots === s.shots && q.ch === 1, `Space pressed while paused is dropped on resume (shots ${q.shots}, charge ${q.ch})`);
  }
  // remaining laps: fire whenever a target is 80–1500 ahead; when P1, one refusal check
  let refusedChecked = false;
  while (true) {
    s = await st(page);
    if (s.results || s.fin) break;
    if (s.ch === 1 && !s.fly && s.target != null && s.ahead > 80 && s.ahead < 1500 && s.inLap < s.L - 4000) {
      const f = await tryFire(page);
      if (f.after.shots === f.before.shots + 1) {
        const r = await followShot(page, name, f.before);
        log(`    lap ${f.before.lap + 1} shot: ${r.rec?.result} (${r.rec?.ahead0?.toFixed(0)} wu ahead)`);
        shotLog.push({ track: name, mode: 'rule', ...r.rec });
      }
    } else if (s.ch === 1 && s.place === 1 && !refusedChecked && s.target == null) {
      const f = await tryFire(page); await sleep(60);
      const f2 = await st(page);
      check(f2.shots === f.before.shots && f2.ch === 1 && f2.flash === 'NO TARGET', `P1 (no car ahead): Space is refused with a NO TARGET flash and the charge is kept (charge ${f2.ch}, flash ${f2.flash})`);
      if (name === 'gridlock') log(`    shot ${await shotFull(page, `${name}-hud-notarget`)}`);
      refusedChecked = true;
    }
    // player on a pad with flames
    if (playerPadShots < 2 && (name === 'gridlock' || name === 'cargo')) {
      const pp = await page.evaluate(() => { const p = window.__RAD_GAME__.world.player; return { pad: p.padMs, lvl: p.boostLevel, x: p.x, y: p.y }; });
      if (pp.pad > 350 && pp.lvl > 0.3) { log(`    shot ${await shotAt(page, `${name}-player-pad-flames`, pp.x, pp.y)}`); playerPadShots++; }
    }
    await sleep(40);
  }
  // AI on a pad with flames (fixed camera on the pad nearest to an AI that is about to cross it)
  // (done after the player finishes: AI are still racing during the grace period)
  if (name === 'neon' || name === 'razor') {
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      const hitP = await page.evaluate(() => { const w = window.__RAD_GAME__.world; const c = w.cars.find((c) => !c.isPlayer && c.padMs > 300 && c.boostLevel > 0.4 && !c.finished); return c ? { x: c.x + c.vx * 0.05, y: c.y + c.vy * 0.05 } : null; });
      if (hitP) {
        await page.evaluate((p) => { window.__RAD_CAM__ = { x: p.x, y: p.y, zoom: 1.1 }; }, hitP);
        await frame2(page);
        log(`    shot ${await shotAt(page, `${name}-ai-pad-flames`, hitP.x, hitP.y, 480, 270, 2)}`);
        await page.evaluate(() => { window.__RAD_CAM__ = null; });
        aiPadShots++; break;
      }
      if (await page.$('#results')) break;
      await sleep(30);
    }
  }
  s = await waitFor(page, (x) => x.results, 300000, 200);
  const fin = await page.evaluate(() => {
    window.__botStop(); clearInterval(window.__recT); cancelAnimationFrame(window.__fr);
    const w = window.__RAD_GAME__.world;
    return { res: window.__RAD_LAST_RESULT__, frames: window.__frames, rec: window.__rec,
      cars: w.cars.map((c) => ({ name: c.name, lap: c.lap, finished: c.finished, dnf: !!c.dnf, pads: c.padHits || 0, spins: c.spinCount || 0 })), unstick: w.unstick.count };
  });
  const fps = (fin.frames - frames0) / ((Date.now() - wall0) / 1000);
  if (s) await page.screenshot({ path: `${outDir}/76-${name}-results.png` });
  const rec = fin.rec.filter((r) => r.cd <= 0);
  const lapSeq = [0]; for (const r of rec) if (r.lap > lapSeq.at(-1)) lapSeq.push(r.lap);
  const maxCh = Math.max(...rec.map((r) => r.ch));
  check(maxCh <= 1, `missile charge never above 1 (max ${maxCh})`);
  // spins
  const spins = spinsFrom(rec);
  for (const sp of spins) {
    const dur = sp.t1 - sp.t0;
    const ok = sp.peakVis > TAU * 0.93 && sp.monotone && dur > 850 && dur < 1150 && sp.driveFrames === 0 && sp.cut && Math.abs(sp.cut[1] - 0.3 * sp.cut[0]) < 3;
    check(ok, `spin car #${sp.car}: drawn rotation rose monotonically to ${(sp.peakVis * 180 / Math.PI).toFixed(0)}° over ${dur.toFixed(0)} ms; hit cut speed ${sp.cut?.[0]}→${sp.cut?.[1]} (${sp.cut ? (100 * sp.cut[1] / Math.max(1, sp.cut[0])).toFixed(0) : '?'}%), next frame ${sp.vAfter}, ${sp.vEnd} at recovery; throttle/steer input frames during spin ${sp.driveFrames}${sp.maxRise > 150 ? ` (speed jump of ${sp.maxRise} wu/s during the spin = rammed by another car)` : ''}`);
    spinRows.push(`  ${name.padEnd(9)} car #${sp.car} ${dur.toFixed(0)} ms, ${(sp.peakVis * 180 / Math.PI).toFixed(0)}°, speed ${sp.cut?.[0]}→${sp.cut?.[1]} at hit, ${sp.vEnd} at recovery, drive frames ${sp.driveFrames}`);
  }
  // pads
  const aiPads = fin.cars.slice(1).map((c) => c.pads);
  check(fin.cars[0].pads > 0 && aiPads.filter((x) => x > 0).length >= 3, `boost pads triggered: player ${fin.cars[0].pads}×, AI ${aiPads.join('/')}×`);
  padRows.push(`  ${name.padEnd(9)} ${pads.length} pads; triggers player ${fin.cars[0].pads}, AI ${aiPads.join('/')}`);
  // stuck
  const stuck = stuckFrom(rec);
  check(Math.max(...stuck) < 3000, `no stuck cars: longest time below 30 wu/s (excl. countdown/spin/finish, after 4.5 s) per car ${stuck.map((x) => (x / 1000).toFixed(1)).join('/')} s; player auto-unstick used ${fin.unstick}×`);
  const aiAll = fin.cars.slice(1).every((c) => c.finished && !c.dnf && c.lap === 3);
  const e = errs.length - errStart;
  const ok = !!s && fin.cars[0].lap === 3 && lapSeq.join(',') === '0,1,2,3' && e === 0 && fps > 55;
  check(ok, `race: results=${!!s} laps ${lapSeq.join('→')} all AI finished=${aiAll}${aiAll ? '' : ' (DNF: ' + fin.cars.filter((c) => c.dnf).map((c) => c.name).join(',') + ')'} errors=${e} rAF≈${fps.toFixed(1)}fps`);
  raceRows.push(`  ${name.padEnd(9)} ${ok ? 'PASS' : 'FAIL'}  P${fin.res?.playerPlace} ${(fin.res?.totalTime / 1000).toFixed(2)}s best lap ${(fin.res?.bestLapMs / 1000).toFixed(2)}s  laps ${lapSeq.join('→')}  ${fin.res?.standings.map((x) => `${x.name}${x.dnf ? '(DNF)' : ' ' + (x.finishTime / 1000).toFixed(1)}`).join(' > ')}  shots ${shotLog.filter((x) => x.track === name).map((x) => x.result).join(',')}  spins ${spins.length}  fps ${fps.toFixed(1)}  errors ${e}`);
  await quitRace(page);
}

// ======================= B. hit-rate trial =======================
for (const name of deskTracks) {
  const ti = ALL.indexOf(name);
  log(`\n=== ${name.toUpperCase()} — hit-rate trial (${TRIAL_SECS}s; player top 760, charge refilled after each missile) ===`);
  await startRace(page, ti);
  await installRecorder(page, true);
  await page.evaluate(() => {
    window.__trial = setInterval(() => {
      const w = window.__RAD_GAME__.world; if (!w || w.race.countdown > 0) return;
      w.player.top = 760;
      if (!w.missiles.some((m) => !m.dead)) w.missile.charge = 1;
    }, 50);
  });
  await waitFor(page, (x) => x.cd <= 0, 6000);
  const t0 = Date.now(); let want = 80 + Math.random() * 1420, waitT = Date.now();
  while (Date.now() - t0 < TRIAL_SECS * 1000) {
    const s = await st(page);
    if (s.results || s.fin) break;
    if (!s.fly && s.ch === 1 && s.target != null && s.ahead > 80 && s.ahead < 1500 && (Math.abs(s.ahead - want) < 140 || Date.now() - waitT > 6000)) {
      await page.keyboard.press(' ');
      want = 80 + Math.random() * 1420; waitT = Date.now();
      await sleep(200);
    }
    await sleep(30);
  }
  await sleep(3800);
  const lg = await page.evaluate(() => { clearInterval(window.__trial); return window.__RAD_GAME__.world.missile.log; });
  lg.forEach((l) => shotLog.push({ track: name, mode: 'trial', ...l }));
  const inR = lg.filter((l) => l.ahead0 > 80 && l.ahead0 <= 1500);
  const hits = inR.filter((l) => l.result === 'hit').length, ht = inR.filter((l) => l.hitTarget).length;
  const by = {}; inR.forEach((l) => { by[l.result] = (by[l.result] || 0) + 1; });
  const bins = [[80, 500], [500, 1000], [1000, 1500]].map(([a, b]) => { const x = inR.filter((l) => l.ahead0 > a && l.ahead0 <= b); return `${a}-${b}: ${x.filter((l) => l.result === 'hit').length}/${x.length}`; });
  log(`  shots ${inR.length}: hits ${hits} (${(100 * hits / Math.max(1, inR.length)).toFixed(0)}%, the intended target ${ht}) ${JSON.stringify(by)}  by distance ${bins.join('  ')}`);
  trialRows.push({ name, n: inR.length, hits, ht, by, bins });
  await quitRace(page);
}
const totN = trialRows.reduce((a, r) => a + r.n, 0), totH = trialRows.reduce((a, r) => a + r.hits, 0), totT = trialRows.reduce((a, r) => a + r.ht, 0);
const rate = totH / Math.max(1, totN);
check(totN >= 40 && rate >= 0.55 && rate <= 0.85, `overall hit rate at 80–1500 wu: ${totH}/${totN} = ${(100 * rate).toFixed(0)}% (intended target ${totT}, ${(100 * totT / Math.max(1, totN)).toFixed(0)}%)`);

// ======================= C. brake gone + unstick =======================
{
  log(`\n=== BRAKE REMOVED + AUTO-UNSTICK (Cargo) ===`);
  await startRace(page, 3);
  await installRecorder(page, true);
  await waitFor(page, (x) => x.cd <= 0, 6000);
  for (const key of ['ArrowDown', 's']) {
    await page.evaluate(() => { window.__botMode = 'drive'; });
    await waitFor(page, (x) => x.spd > 800 && x.inLap > 1500, 20000);
    await page.evaluate(() => { window.__botMode = 'coast'; });
    await sleep(150);
    const a = await st(page);
    await page.keyboard.down(key); await sleep(600);
    const b = await st(page); const brakeState = await page.evaluate(() => 'brake' in window.__RAD_INPUT__.state ? window.__RAD_INPUT__.state.brake : 'absent');
    await page.keyboard.up(key);
    const decel = (a.spd - b.spd) / ((b.t - a.t) / 1000);
    check(decel < 400 && b.spd > 300, `holding ${key} (gas off, still steering) does not brake or reverse: ${a.spd.toFixed(0)}→${b.spd.toFixed(0)} wu/s in ${((b.t - a.t) / 1000).toFixed(2)} s = ${decel.toFixed(0)} wu/s² (coasting; the old brake was 1500), input.state.brake=${brakeState}`);
  }
  await page.evaluate(() => { window.__botMode = 'idle'; });
  await sleep(300);
  // park nose-first against the outside wall on a straight, hold gas
  await page.evaluate(async () => {
    const { pointAt, project } = await import('./js/tracks.js');
    const w = window.__RAD_GAME__.world, p = w.player, t = w.track;
    const q = pointAt(t, 1000); const lat = t.halfW - 22;
    p.x = q.x + q.nx * lat; p.y = q.y + q.ny * lat; p.vx = 0; p.vy = 0; p.angle = Math.atan2(q.ny, q.nx);
    const pr = project(t, p.x, p.y, -1); p.seg = pr.i; p.sPrev = pr.s; p.lat = pr.lat;
  });
  await page.evaluate(() => { const p = window.__RAD_GAME__.world.player; window.__RAD_CAM__ = { x: p.x, y: p.y, zoom: 1.1 }; });
  await frame2(page);
  log(`    shot ${await shotAt(page, 'cargo-stuck-wall', ...(await page.evaluate(() => [window.__RAD_GAME__.world.player.x, window.__RAD_GAME__.world.player.y])), 480, 270, 2)}`);
  await page.evaluate(() => { window.__RAD_CAM__ = null; });
  const u0 = await page.evaluate(() => window.__RAD_GAME__.world.unstick.count);
  await page.evaluate(() => { window.__botMode = 'drive'; }); // a "player" holding gas and steering towards the road
  const t0 = Date.now(); let firstRev = null;
  while (Date.now() - t0 < 6000) { const u = await page.evaluate(() => window.__RAD_GAME__.world.unstick); if (u.count > u0 && firstRev == null) firstRev = Date.now() - t0; await sleep(50); }
  const end = await page.evaluate(async () => { const { pointAt } = await import('./js/tracks.js'); const { angleDiff } = await import('./js/util.js'); const w = window.__RAD_GAME__.world, p = w.player; const q = pointAt(w.track, p.sPrev); return { spd: Math.hypot(p.vx, p.vy), head: Math.abs(angleDiff(p.angle, Math.atan2(q.ty, q.tx))) * 180 / Math.PI, n: w.unstick.count }; });
  check(firstRev != null && firstRev < 2400 && end.spd > 250 && end.head < 60, `nose-first against a wall with gas held: auto-reverse after ${firstRev} ms (${end.n - u0}×), then driving off at ${end.spd.toFixed(0)} wu/s, heading ${end.head.toFixed(0)}° off the road direction`);
  await quitRace(page);
}
check(errs.length === 0, `desktop console errors/warnings: ${errs.length} ${JSON.stringify(errs.slice(0, 3))}`);

// ======================= D. mobile =======================
const mob = await browser.newPage();
await mob.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
const merrs = []; watchErrors(mob, merrs);
const cdp = await mob.createCDPSession();
await mob.goto(url, { waitUntil: 'networkidle2' });
await mob.evaluate(() => localStorage.clear());
await mob.reload({ waitUntil: 'networkidle2' });
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 6, radiusY: 6, force: 1 })) });
for (const name of mobTracks) {
  const ti = ALL.indexOf(name);
  log(`\n=== ${name.toUpperCase()} — mobile 844×390 touch ===`);
  await mob.tap('[data-act=race]');
  await mob.waitForSelector('#tracks button');
  await mob.evaluate((ti) => document.querySelectorAll('#tracks button')[ti].scrollIntoView(), ti);
  await (await mob.$$('#tracks button'))[ti].tap();
  await installRecorder(mob, false);
  await mob.evaluate(() => { window.__order = () => [...window.__RAD_GAME__.world.cars].sort((a, b) => (a.finished && b.finished) ? a.finishPlace - b.finishPlace : a.finished ? -1 : b.finished ? 1 : b.dist - a.dist); });
  await waitFor(mob, (x) => x.running && x.cd > 0, 5000);
  const lay = await mob.evaluate(() => { const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; }; return { gas: r(document.getElementById('btn-accel')), pad: r(document.getElementById('aim-pad')), brk: !!document.querySelector('#btn-brake, [data-action=brake]'), btns: [...document.querySelectorAll('#touch-controls button')].map((b) => b.id) }; });
  check(!lay.brk, `touch controls: ${lay.btns.join(', ')} — no BRK button`);
  let gas = { id: 0, x: lay.gas.x, y: lay.gas.y + 10 };
  let steer = { id: 1, x: lay.pad.x, y: lay.pad.y - lay.pad.w * 0.35 };
  await touch('touchStart', [gas]); await touch('touchStart', [gas, steer]);
  const steerStep = async () => {
    const a = await mob.evaluate(async () => { const { pointAt } = await import('./js/tracks.js'); const w = window.__RAD_GAME__.world, p = w.player, spd = Math.hypot(p.vx, p.vy); const tp = pointAt(w.track, p.sPrev + 150 + spd * 0.35); return Math.atan2(tp.y - p.y, tp.x - p.x); });
    const r = lay.pad.w * 0.36; steer = { id: 1, x: lay.pad.x + Math.cos(a) * r, y: lay.pad.y + Math.sin(a) * r };
    await touch('touchMove', [gas, steer]);
  };
  const drive = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { await steerStep(); await sleep(40); } };
  const slideTo = async (dx, dy) => { const x0 = gas.x, y0 = gas.y; for (let k = 1; k <= 6; k++) { gas = { id: 0, x: x0 + dx * k / 6, y: y0 + dy * k / 6 }; await steerStep(); await sleep(20); } };
  const back = async () => { gas = { id: 0, x: lay.gas.x, y: lay.gas.y + 10 }; await steerStep(); await sleep(40); };
  await waitFor(mob, (x) => x.cd <= 0, 6000);
  await drive(1200);
  let s = await st(mob); let inp = await mob.evaluate(() => ({ ...window.__RAD_INPUT__.state }));
  check(inp.accel && s.shots === 0 && s.boostUses === 0 && s.spd > 350, `GAS hold drives as before (accel=${inp.accel}, speed ${s.spd.toFixed(0)}), no boost/missile`);
  // wait for a target in range and both charges ready
  s = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 20000) { await drive(120); const x = await st(mob); if (x.target != null && x.ahead > 80 && x.ahead < 1500 && x.ch === 1 && x.boostCh === 1) return x; } return null; })();
  if (check(!!s, `target in range for the touch test (car #${s?.target}, ${s?.ahead?.toFixed(0)} wu ahead)`)) {
    // diagonal, up-dominant: boost only
    let b0 = await st(mob);
    await slideTo(-38, -58); await sleep(80);
    let b1 = await st(mob);
    check(b1.boostUses === b0.boostUses + 1 && b1.shots === b0.shots, `diagonal slide (dx −38, dy −58, up dominant) fired the BOOST only (boost uses ${b0.boostUses}→${b1.boostUses}, missiles ${b0.shots}→${b1.shots})`);
    await back(); await drive(2600);
    // diagonal, left-dominant: missile only
    b0 = await waitFor(mob, (x) => x.target != null && x.ahead > 80 && x.ahead < 1500, 8000) || await st(mob);
    await slideTo(-58, -38); await sleep(80);
    b1 = await st(mob);
    inp = await mob.evaluate(() => ({ ...window.__RAD_INPUT__.state }));
    check(b1.shots === b0.shots + 1 && b1.boostUses === b0.boostUses && b1.src === 'slide' && inp.accel, `diagonal slide (dx −58, dy −38, left dominant) fired the MISSILE only (missiles ${b0.shots}→${b1.shots}, boost uses ${b0.boostUses}→${b1.boostUses}, source ${b1.src}); GAS still held=${inp.accel}`);
    if (name === mobTracks[0]) { await sleep(40); const q = await st(mob); log(`    shot ${await shotFull(mob, `mobile-${name}-missile`)}  (speed ${q.spd.toFixed(0)}, missile in flight ${q.fly})`); }
    await back();
    const e = await waitFor(mob, (x) => x.logN > b0.logN, 5000);
    const r = await mob.evaluate(() => window.__RAD_GAME__.world.missile.log.at(-1));
    log(`    touch missile result: ${r?.result} (${r?.ahead0?.toFixed(0)} wu ahead)`);
    shotLog.push({ track: name, mode: 'touch', ...r });
    // straight left slide on the same lap: nothing
    await drive(400);
    const c0 = await st(mob);
    await slideTo(-60, 0); await sleep(80);
    const c1 = await st(mob);
    if (c0.lap === c1.lap) check(c1.shots === c0.shots, `2nd left slide on the same lap does nothing (missiles ${c0.shots}→${c1.shots})`);
    await back();
  }
  // the layout shot (no BRK)
  if (name !== mobTracks[0]) { await waitFor(mob, (x) => x.spd > 500, 8000); log(`    shot ${await shotFull(mob, `mobile-${name}-layout`)}`); }
  log(`    auto-unstick used ${await mob.evaluate(() => window.__RAD_GAME__.world.unstick.count)}× during the touch test`);
  await touch('touchEnd', []);
  await mob.evaluate(() => { clearInterval(window.__recT); cancelAnimationFrame(window.__fr); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' })); });
  await mob.waitForSelector('#quit'); await mob.tap('#quit');
  await mob.waitForSelector('[data-act=race]');
}
check(merrs.length === 0, `mobile console errors: ${merrs.length} ${JSON.stringify(merrs.slice(0, 3))}`);
await browser.close();

const numbers = await import('../js/weapons.js');
const head = [
  `Radcars v48 verification ${new Date().toString()}`, `URL ${url}  renderer=${rendererKind}`, '',
  `MISSILE speed ${numbers.MISSILE.speed} wu/s, turn ${numbers.MISSILE.turn} rad/s (min radius ${(numbers.MISSILE.speed / numbers.MISSILE.turn).toFixed(0)} wu), life ${numbers.MISSILE.lifeMs} ms, hit radius ${numbers.MISSILE.hitR} wu, dies on wall contact; spin ${numbers.SPIN_MS} ms, speed kept ${numbers.SPIN_SPEED_KEEP * 100}%; pad boost ${numbers.PAD_MS} ms`, '',
  'RULE RACES (menus, 3 laps, 5 AI Normal, no brake)', ...raceRows, '',
  'HIT-RATE TRIAL (targets 80–1500 wu ahead)', ...trialRows.map((r) => `  ${r.name.padEnd(9)} ${r.hits}/${r.n} = ${(100 * r.hits / Math.max(1, r.n)).toFixed(0)}% (intended target ${r.ht})  ${JSON.stringify(r.by)}  ${r.bins.join('  ')}`),
  `  overall  ${totH}/${totN} = ${(100 * rate).toFixed(0)}%`, '',
  'SPINS', ...spinRows, '', 'PADS', ...padRows, '',
  `OVERALL: ${allOk ? 'PASS' : 'FAIL'}`, '', 'DETAIL'];
fs.writeFileSync(`${outDir}/76-verify.txt`, [...head, ...out].join('\n'));
console.log('\n' + head.join('\n'));
