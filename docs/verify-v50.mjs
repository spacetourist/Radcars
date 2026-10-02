/**
 * Radcars v50 'bonus' verification: bonus '?' boxes + power-ups (ROCKET, LAP BOOST, AUTOPILOT).
 *   node docs/verify-v50.mjs [url] [outDir] [tracks=neon,gridlock,razor,cargo]
 *
 * A. DESKTOP RACE per track (1280×720, menus, 3 laps, 5 AI, Normal, steering bot, keyboard):
 *    lap 1: bot idles 2.5 s at GO so the field is ahead → debug.give('rocket') + E → 3 launches ~250 ms apart
 *           at 3 distinct cars ahead (hits + 360° spins counted); Space lap missile still works; the bot
 *           steers through a box (forceNext = lapboost) → HUD holds LAP BOOST → E → green flames until the line.
 *    lap 2: boxes respawned at the line; Shift boost burns orange; box → AUTOPILOT → E → 10 s on the rail
 *           (wall contacts, centreline deviation, speed vs normal top) → 1.5 s handback (walls, decel).
 *    lap 3: boxes respawned; box collected with a pure random roll → E activates whatever it is.
 *    Pads counted (player + AI). Race must finish, all AI finish, ~60 fps, 0 console errors.
 * B. ROLL ODDS: 30k in-page rolls (P3: equal thirds; P1: autopilot halved).
 * C. MOBILE 844×390 touch (neon): POWER button layout (no overlap with STEER / GAS / canvas panels),
 *    touch tap activates (source 'tap'), tap while another power runs is blocked, holding a power-up →
 *    box stays uncollected, E with nothing held does nothing.
 * Shots: docs/shots/78-*.png   Report: docs/shots/78-verify.txt
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:4173/';
const outDir = process.argv[3] || new URL('./shots', import.meta.url).pathname;
const ALL = ['neon', 'gridlock', 'razor', 'cargo'];
const tracks = (process.argv[4] || ALL.join(',')).split(',').filter((t) => ALL.includes(t));
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = [];
const log = (s) => { console.log(s); lines.push(s); };
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; log(`    [${ok ? 'ok' : 'FAIL'}] ${msg}`); return ok; };
const f0 = (x) => (x == null ? '—' : Math.round(x));

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
function watchErrors(page, errs) {
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  page.on('requestfailed', (r) => errs.push('REQFAIL ' + r.url()));
}

/** In-page: rAF counter, 50 ms recorder, bot with box-lane steering (window.__lane: 'box' | 'avoid' | null). */
async function install(page) {
  await page.evaluate(async () => {
    const { pointAt } = await import('./js/tracks.js');
    const { angleDiff } = await import('./js/util.js');
    window.__frames = 0; const fr = () => { window.__frames++; window.__fr = requestAnimationFrame(fr); }; fr();
    window.__rec = [];
    window.__recT = setInterval(() => {
      const g = window.__RAD_GAME__, w = g.world; if (!w || !g.isRunning()) return;
      const p = w.player, pw = w.power;
      window.__rec.push({ t: w.race.time, lap: p.lap, fin: p.finished, act: pw.active, held: pw.held, green: !!p.boostGreen, lvl: +(p.boostLevel || 0).toFixed(2),
        bst: w.boost.activeMs > 0, spd: Math.hypot(p.vx, p.vy), lat: p.lat, wall: p.wallHit || 0, hb: !!pw.handback, ang: p.angle,
        spins: w.cars.map((c) => c.spinMs || 0), rk: w.missiles.filter((m) => !m.dead && m.rocket).length });
    }, 50);
    const held = new Set();
    const set = (k, on) => { if (on && !held.has(k)) { held.add(k); window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); } else if (!on && held.has(k)) { held.delete(k); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); } };
    window.__botMode = 'drive'; window.__lane = 'avoid';
    const wrap = (L, d) => { d = ((d % L) + L) % L; return d > L / 2 ? d - L : d; };
    window.__bot = setInterval(() => {
      const w = window.__RAD_GAME__.world; if (!w || w.race.countdown > 0) return; const p = w.player;
      if (window.__botMode === 'idle') { ['ArrowUp', 'ArrowLeft', 'ArrowRight'].forEach((k) => set(k, false)); return; }
      const spd = Math.hypot(p.vx, p.vy), b = w.track.bonus;
      let lat = 0, near = false;
      if (b && window.__lane) {
        const d = wrap(w.track.length, b.s - p.sPrev);
        const lane = window.__lane === 'box' ? (b.boxes.length === 3 ? 0 : b.boxes[0].lat) : (b.boxes.length === 3 ? (b.boxes[0].lat + b.boxes[1].lat) / 2 : 0);
        if (d > -60 && d < 2600) { lat = lane * Math.min(1, (2600 - d) / 800); near = d < 1000; }
      }
      const look = near ? 120 + spd * 0.2 : 150 + spd * 0.35; // tighter line-holding into the box row
      const tp = pointAt(w.track, p.sPrev + look);
      const err = angleDiff(p.angle, Math.atan2(tp.y + tp.ny * lat - p.y, tp.x + tp.nx * lat - p.x));
      set('ArrowRight', err > 0.05); set('ArrowLeft', err < -0.05);
      set('ArrowUp', !(Math.abs(err) > 0.7 && spd > 500));
    }, 30);
    window.__botStop = () => { clearInterval(window.__bot); clearInterval(window.__recT); cancelAnimationFrame(window.__fr); ['ArrowUp', 'ArrowLeft', 'ArrowRight'].forEach((k) => set(k, false)); };
  });
}
const st = (page) => page.evaluate(() => {
  const g = window.__RAD_GAME__, w = g.world, p = w.player, pw = w.power, b = w.track.bonus;
  let dBox = ((b.s - p.sPrev) % w.track.length + w.track.length) % w.track.length; if (dBox > w.track.length / 2) dBox -= w.track.length;
  return { t: w.race.time, cd: w.race.countdown, lap: p.lap, fin: p.finished, spd: Math.hypot(p.vx, p.vy), lat: p.lat, results: !!document.querySelector('#results'),
    held: pw.held, active: pw.active, activeMs: pw.activeMs, collected: b.boxes.map((x) => !!pw.collected[x.i]), respawns: pw.respawns, collects: pw.collects.length,
    ignored: pw.ignored, blocked: pw.blocked, acts: pw.activations.length, rocketN: pw.rocketLog.length, apN: pw.apLog.length, hb: !!pw.handback, dBox,
    green: !!p.boostGreen, lvl: p.boostLevel || 0, mCharge: w.missile.charge, mLog: w.missile.log.length, boostUses: w.boost.uses + w.boost.freeUses, place: g.getHudInfo().place };
});
async function waitFor(page, pred, timeoutMs = 60000, every = 40) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { const s = await st(page); if (pred(s)) return s; await sleep(every); }
  return null;
}
async function shotAt(page, name, wx, wy, cw = 360, ch = 202, scale = 3) {
  const vp = page.viewport();
  const pos = await page.evaluate((wx, wy) => { const c = window.__RAD_GAME__.world.cam; const el = document.getElementById('game'); return { x: (wx - c.x) * c.zoom + el.clientWidth / 2, y: (wy - c.y) * c.zoom + el.clientHeight / 2 }; }, wx, wy);
  const x = Math.max(0, Math.min(vp.width - cw, pos.x - cw / 2)), y = Math.max(0, Math.min(vp.height - ch, pos.y - ch / 2));
  const file = `${outDir}/78-${name}.png`;
  await page.screenshot({ path: file, clip: { x, y, width: cw, height: ch, scale } });
  log(`    shot ${file}`);
}
async function shotFull(page, name) { const file = `${outDir}/78-${name}.png`; await page.screenshot({ path: file }); log(`    shot ${file}`); }
async function shotPlayer(page, name, cw, ch, scale) { const p = await page.evaluate(() => { const p = window.__RAD_GAME__.world.player; return { x: p.x, y: p.y }; }); await shotAt(page, name, p.x, p.y, cw, ch, scale); }
async function shotHud(page, name) {
  const r = await page.evaluate(() => { const e = document.getElementById('btn-power').getBoundingClientRect(); return { x: e.left, y: e.top, w: e.width, h: e.height }; });
  const vp = page.viewport();
  const x = Math.max(0, r.x - 30), y = Math.max(0, r.y - 60), w = Math.min(vp.width - x, 640), h = Math.min(vp.height - y, 200);
  const file = `${outDir}/78-${name}.png`;
  await page.screenshot({ path: file, clip: { x, y, width: w, height: h, scale: 2 } });
  log(`    shot ${file}`);
}
async function startRace(page, ti) {
  await page.click('[data-act=race]');
  await page.waitForSelector('#tracks button');
  const tag = await page.evaluate(() => document.querySelector('.tagline')?.textContent);
  await page.evaluate((ti) => document.querySelectorAll('#tracks button')[ti].click(), ti);
  return tag;
}
const debug = (page, fn, kind) => page.evaluate((fn, kind) => window.__RAD_GAME__.debug[fn](kind), fn, kind);
const rec = (page) => page.evaluate(() => window.__rec);

// ---------------------------------------------------------------------------
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
const errs = []; watchErrors(page, errs);
await page.goto(url, { waitUntil: 'networkidle2' });
const rendererKind = await page.evaluate(() => window.__RAD_RENDERER__); // v51: 'pixi' (default) or 'canvas' (?canvas=1 / fallback)
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle2' });
const build = await page.evaluate(() => ({ ...self.RADCARS_BUILD, btn: !!document.getElementById('hard-refresh'), tag: document.getElementById('build-tag')?.textContent }));
check(/^v\d+$/.test(build.version) && parseInt(build.version.slice(1)) >= 50 && build.btn && build.tag === `${build.version} · ${build.name}`, /* v51+: accept the current build */ `menu build ${build.label}, tag "${build.tag}", Update button ${build.btn}`);

// B. roll odds
const odds = await page.evaluate(async () => {
  const P = await import('./js/powerups.js');
  const run = (place) => { const n = { rocket: 0, lapboost: 0, autopilot: 0 }; const pw = P.newPowerState(); for (let i = 0; i < 30000; i++) n[P.rollPower(pw, place)]++; return n; };
  return { p3: run(3), p1: run(1), consts: { ROCKET_COUNT: P.ROCKET_COUNT, ROCKET_GAP_MS: P.ROCKET_GAP_MS, LAPBOOST_MIN_MS: P.LAPBOOST_MIN_MS, AUTOPILOT_MS: P.AUTOPILOT_MS, AUTOPILOT_TOP_MUL: P.AUTOPILOT_TOP_MUL, AUTOPILOT_HANDBACK_MS: P.AUTOPILOT_HANDBACK_MS } };
});
log(`\n=== ROLL ODDS (30k each) ===`);
const pct = (n, k) => (100 * n[k] / 30000).toFixed(1);
check(['rocket', 'lapboost', 'autopilot'].every((k) => Math.abs(odds.p3[k] / 30000 - 1 / 3) < 0.015), `P3: rocket ${pct(odds.p3, 'rocket')}% lapboost ${pct(odds.p3, 'lapboost')}% autopilot ${pct(odds.p3, 'autopilot')}% (equal thirds)`);
check(Math.abs(odds.p1.autopilot / 30000 - 0.2) < 0.015, `P1: rocket ${pct(odds.p1, 'rocket')}% lapboost ${pct(odds.p1, 'lapboost')}% autopilot ${pct(odds.p1, 'autopilot')}% (autopilot halved → 20%)`);
log(`    constants ${JSON.stringify(odds.consts)}`);

const rows = [];
const natural = { rocket: 0, lapboost: 0, autopilot: 0 };
for (const name of tracks) {
  const ti = ALL.indexOf(name);
  const errStart = errs.length;
  const row = { name };
  log(`\n=== ${name.toUpperCase()} — desktop race ===`);
  const tag = await startRace(page, ti);
  await install(page);
  await page.evaluate(() => { window.__botMode = 'idle'; });
  log(`  menu: ${tag}`);
  const bon = await page.evaluate(() => { const w = window.__RAD_GAME__.world, b = w.track.bonus; return { s: b.s, L: w.track.length, n: b.boxes.length, lats: b.boxes.map((x) => Math.round(x.lat)), half: w.track.halfW, pads: w.track.pads.map((p) => Math.round(p.s ?? p[0])), R: Math.round(Math.min(...[-600, -300, 0, 300, 600].map((o) => w.track.pts[Math.floor((((b.s + o) % w.track.length) / w.track.length) * w.track.pts.length)].radius))) }; });
  row.box = bon;
  check(bon.n >= 2 && bon.n <= 3 && bon.s > 400 && bon.s < bon.L - 400, `one row of ${bon.n} boxes at s=${bon.s} of ${Math.round(bon.L)} (lat ${bon.lats.join('/')} of half-width ${bon.half}; min radius ±600 wu ${bon.R}; pads at ${bon.pads.join(',')})`);
  const frames0 = await page.evaluate(() => window.__frames); const wall0 = Date.now();

  // ---- lap 1: forced ROCKET at the start ----
  await waitFor(page, (s) => s.cd <= 0, 8000);
  await sleep(2500);
  let s = await st(page);
  const expect = await page.evaluate(async () => { const P = await import('./js/powerups.js'); const w = window.__RAD_GAME__.world; const o = [...w.cars].sort((a, b) => b.dist - a.dist); return P.rocketTargets(w, o).map((c) => c.id); });
  check(await debug(page, 'give', 'rocket'), `debug.give('rocket') → held ${JSON.stringify((await st(page)).held)} (place P${s.place})`);
  if (name === 'neon') await shotHud(page, 'hud-held-rocket');
  await debug(page, 'forceNext', 'lapboost');
  await page.keyboard.press('e');
  await page.evaluate(() => { window.__botMode = 'drive'; window.__lane = 'box'; });
  await waitFor(page, (x) => x.acts >= 1, 2000, 10);
  if (name === 'neon' || name === 'razor') {
    await sleep(560);
    // frame the player, the live rocket missiles and their targets
    const pts = await page.evaluate(() => { const w = window.__RAD_GAME__.world; const r = w.missiles.filter((m) => !m.dead && m.rocket); return [w.player, ...r, ...r.map((m) => m.target).filter(Boolean)].map((o) => ({ x: o.x, y: o.y })); });
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const z = await page.evaluate(() => window.__RAD_GAME__.world.cam.zoom);
    const need = Math.max((Math.max(...xs) - Math.min(...xs)) * z + 160, ((Math.max(...ys) - Math.min(...ys)) * z + 120) * 16 / 9, 480);
    const cw = Math.min(1280, need), ch = Math.round(cw * 9 / 16);
    await shotAt(page, `${name}-rocket-triple`, cx, cy, cw, ch, Math.max(1, Math.min(2.5, 1200 / cw)));
    log(`    (player + rockets + targets: ${pts.length} points framed)`);
  }
  // natural LAP BOOST from the box (roll pinned with forceNext) — the bot steers into a box lane
  s = await waitFor(page, (x) => (x.dBox < 430 && x.dBox > 0) || x.held, 40000, 20);
  if (s.dBox > 150 && !s.held) {
    const bp = await page.evaluate(() => { const b = window.__RAD_GAME__.world.track.bonus; const n = b.boxes.length; return { x: b.boxes.reduce((a, q) => a + q.x, 0) / n, y: b.boxes.reduce((a, q) => a + q.y, 0) / n }; });
    await shotAt(page, `${name}-box-row`, bp.x, bp.y, 420, 236, 2.5);
  } else log(`    (box row shot skipped: dBox ${Math.round(s.dBox)})`);
  s = await waitFor(page, (x) => x.held || x.lap >= 1, 20000, 20);
  check(s && s.lap === 0 && s.held === 'lapboost' && s.collected.filter(Boolean).length === 1, `lap 1 box collected by driving through: held ${s?.held}, collected ${JSON.stringify(s?.collected)} (lap ${s?.lap})`);
  if (s?.held) natural[s.held]++;
  await page.evaluate(() => { window.__lane = 'avoid'; });
  if (name === 'neon') { await sleep(250); await shotHud(page, 'hud-held-lapboost'); }

  // rocket results (the salvo resolved while driving to the box)
  s = await waitFor(page, (x) => x.rocketN >= 3, 8000);
  const rk = await page.evaluate(() => { const pw = window.__RAD_GAME__.world.power; return { act: pw.activations[0], log: pw.rocketLog.slice(0, 3), ms: window.__RAD_GAME__.world.missile }; });
  await sleep(200);
  const rrec = await rec(page);
  const tgs = rk.log.map((r) => r.targetId);
  const hits = rk.log.filter((r) => r.result === 'hit');
  const spun = hits.filter((h) => rrec.some((r) => r.t >= h.t && r.spins[h.hitId] > 0)).length;
  const gaps = rk.log.map((r) => r.t).sort((a, b) => a - b).map((t, i, a) => (i ? Math.round(t - a[i - 1]) : null)).slice(1);
  row.rocket = { targets: tgs, hits: hits.length, spun, gaps, results: rk.log.map((r) => r.result) };
  check(rk.act?.kind === 'rocket' && rk.act.source === 'key' && rk.log.length === 3 && new Set(tgs).size === 3 && tgs.every((t) => t != null), `ROCKET via E: 3 launches at 3 distinct targets [${tgs.join(',')}] (pre-computed nearest-ahead [${expect.join(',')}]), gaps ${gaps.join('/')} ms`);
  check(gaps.every((g) => g >= 200 && g <= 300), `salvo spacing ≈250 ms: ${gaps.join(', ')}`);
  check(hits.length >= 1 && spun === hits.length, `rocket results ${rk.log.map((r) => r.result).join('/')} → hits ${hits.length}/3, spins ${spun}/${hits.length}`);
  check(rk.ms.charge === 1 && rk.ms.log.length === 0, `lap missile charge untouched by the rocket (charge ${rk.ms.charge}, lap-missile log ${rk.ms.log.length})`);

  // Space lap missile still works (v48)
  await page.keyboard.press(' ');
  await waitFor(page, (x) => x.mLog >= 1, 5000);
  const ml = await page.evaluate(() => { const ms = window.__RAD_GAME__.world.missile; return { log: ms.log.map((r) => r.result), charge: ms.charge, refused: ms.refused }; });
  row.missile = ml;
  check(ml.log.length >= 1 || ml.refused > 0, `Space lap missile: ${ml.log.length ? 'fired → ' + ml.log.join('/') : 'refused (NO TARGET)'} charge ${ml.charge}`);
  s = await st(page);
  check(s.held === 'lapboost' && s.lap === 0, `still holding LAP BOOST on lap 1 (${s.held})`);

  // re-driving through the same row does nothing now (collected stays, AI never collects)
  const aiNoCollect = await page.evaluate(() => window.__RAD_GAME__.world.power.collects.length);
  await page.keyboard.press('e');
  s = await waitFor(page, (x) => x.active === 'lapboost', 2000);
  const lbT0 = s?.t;
  if (name === 'neon' || name === 'gridlock') { await sleep(700); await shotPlayer(page, `${name}-lapboost-green`, 400, 225, 3); }
  s = await waitFor(page, (x) => x.lap >= 1, 60000);
  await sleep(200);
  // v53: auto-throttle reaches the line sooner; if E landed < LAPBOOST_MIN_MS (2 s) before the line, the min-duration
  // rule keeps it burning just past the line — wait that out (it must still end on lap 1, i.e. before lap 2)
  await waitFor(page, (x) => x.active !== 'lapboost', 2500);
  const lbEnd = await st(page);
  const rr = await rec(page);
  const lbWin = rr.filter((r) => r.act === 'lapboost');
  const lbLog = await page.evaluate(() => window.__RAD_GAME__.world.power.lapBoostLog.at(-1));
  row.lapboost = { ms: lbLog?.durMs, samples: lbWin.length, greenAll: lbWin.every((r) => r.green), lvlMin: Math.min(...lbWin.filter((r) => r.t - lbT0 > 500).map((r) => r.lvl)) };
  check(lbWin.length > 10 && row.lapboost.greenAll && row.lapboost.lvlMin >= 0.95, `LAP BOOST: ${lbWin.length} samples, green flames on every one, boost level ≥${row.lapboost.lvlMin} after ramp-in (low samples ${JSON.stringify(lbWin.filter((r) => r.t - lbT0 > 500 && r.lvl < 0.95).map((r) => [Math.round(r.t - lbT0), r.lvl]).slice(0, 5))}), ran ${f0(lbLog?.durMs)} ms`);
  check(lbEnd.active === null && lbLog?.endLap === 1, `…ended at the line (lap ${lbEnd.lap}, active=${lbEnd.active}, logged end lap ${lbLog?.endLap})`);

  // ---- lap 2: respawn, Shift boost stays orange, natural AUTOPILOT ----
  check(lbEnd.collected.every((c) => !c) && lbEnd.respawns === 1, `boxes respawned at the line: collected ${JSON.stringify(lbEnd.collected)}, respawns ${lbEnd.respawns}`);
  await debug(page, 'forceNext', 'autopilot');
  await page.evaluate(() => { window.__lane = 'box'; });
  await sleep(300);
  const bu0 = (await st(page)).boostUses;
  await page.keyboard.down('Shift'); await sleep(60); await page.keyboard.up('Shift');
  await sleep(700);
  const bs = await st(page);
  if (name === 'neon') await shotPlayer(page, `${name}-normal-boost-orange`, 400, 225, 3);
  check(bs.boostUses === bu0 + 1 && bs.lvl > 0.5 && !bs.green, `Shift boost: used (uses ${bu0}→${bs.boostUses}), level ${bs.lvl.toFixed(2)}, flames orange (green=${bs.green})`);
  s = await waitFor(page, (x) => x.held || x.lap >= 2, 60000, 20);
  check(s && s.held === 'autopilot', `lap 2 box collected: held ${s?.held}, collected ${JSON.stringify(s?.collected)}`);
  if (s?.held) natural[s.held]++;
  await page.evaluate(() => { window.__lane = 'avoid'; });
  if (name === 'neon') { await sleep(250); await shotHud(page, 'hud-held-autopilot'); }
  await sleep(300);
  await page.keyboard.press('e');
  s = await waitFor(page, (x) => x.active === 'autopilot', 2000);
  const apT0 = s?.t;
  if (name === 'neon' || name === 'razor') { await sleep(3000); await shotPlayer(page, `${name}-autopilot-glow`, 400, 225, 3); await shotFull(page, `${name}-autopilot-hud`); }
  s = await waitFor(page, (x) => x.apN >= 1 && !x.hb, 16000);
  await sleep(1500);
  const ap = await page.evaluate(() => { const a = window.__RAD_GAME__.world.power.apLog[0]; return a && { ...a, hbRaw: String(a.hbMaxDecel) }; });
  log(`    apLog[0] raw decel ${ap?.hbRaw}`);
  if (!ap) { check(false, 'AUTOPILOT never ran'); throw new Error('no autopilot'); }
  const r2 = await rec(page);
  const after = r2.filter((r) => r.t > ap.endT && r.t < ap.endT + 1500 + 1500);
  let afterWall = 0, inW = false; for (const r of after) { if (r.wall > 0) { if (!inW) afterWall++; inW = true; } else inW = false; }
  let maxYaw = 0; for (let i = 1; i < after.length; i++) { const d = Math.atan2(Math.sin(after[i].ang - after[i - 1].ang), Math.cos(after[i].ang - after[i - 1].ang)); maxYaw = Math.max(maxYaw, Math.abs(d) / ((after[i].t - after[i - 1].t) / 1000)); }
  const spdAt = (t) => { let b = after[0]; for (const r of after) if (r.t <= t) b = r; return b?.spd; };
  row.autopilot = { dur: ap.durMs, wall: ap.wall, dev: ap.devMean, devMax: ap.devMax, spd: ap.spdMean, spdMax: ap.spdMax, hbWall: ap.hbWall, hbDec: ap.hbMaxDecel, hbEnd: ap.hbEndSpd, afterWall, maxYaw, s0: spdAt(ap.endT + 100), s1: spdAt(ap.endT + 1500), s3: spdAt(ap.endT + 2900) };
  check(Math.abs(ap.durMs - 10000) < 60, `AUTOPILOT duration ${f0(ap.durMs)} ms`);
  check(ap.wall === 0, `AUTOPILOT wall contacts ${ap.wall}`);
  check(ap.devMean < 25 && ap.devMax < 60, `centreline deviation mean ${ap.devMean.toFixed(1)} wu, max ${ap.devMax.toFixed(1)} wu (half-width ${bon.half})`);
  check(ap.spdMean > 1150 && ap.spdMax > 1200, `speed mean ${f0(ap.spdMean)} / max ${f0(ap.spdMax)} wu/s vs normal top 1000 (+${((ap.spdMean / 1000 - 1) * 100).toFixed(0)}%)`);
  check(ap.hbWall === 0 && ap.hbMaxDecel < 1000, `handback: 1.5 s ease, speed ${f0(row.autopilot.s0)}→${f0(row.autopilot.s1)}→${f0(row.autopilot.s3)} wu/s (+0.1/+1.5/+2.9 s), max decel ${f0(ap.hbMaxDecel)} wu/s², wall contacts ${ap.hbWall} in handback (bot-driven: ${afterWall} in the 3 s from the end), max yaw ${maxYaw.toFixed(2)} rad/s`);

  // ---- lap 3: pure random roll from the box ----
  s = await waitFor(page, (x) => x.lap >= 2, 60000);
  await sleep(150);
  s = await st(page);
  check(s.collected.every((c) => !c) && s.respawns === 2, `lap 3: boxes respawned again (collected ${JSON.stringify(s.collected)}, respawns ${s.respawns})`);
  await page.evaluate(() => { window.__lane = 'box'; });
  s = await waitFor(page, (x) => x.held || x.fin || (x.lap === 2 && x.dBox < -150), 60000, 20);
  await page.evaluate(() => { window.__lane = 'avoid'; });
  row.randomRoll = s?.held;
  if (!s?.held) log(`    lap 3 miss: ${JSON.stringify(s && { lap: s.lap, dBox: Math.round(s.dBox), lat: Math.round(s.lat), fin: s.fin, collected: s.collected, held: s.held, act: s.active })}`);
  check(!!s?.held, `lap 3 box, random roll → ${s?.held} (place P${s?.place})`);
  if (s?.held) natural[s.held]++;
  const beforeActs = s.acts;
  await sleep(400);
  await page.keyboard.press('e');
  s = await waitFor(page, (x) => x.acts > beforeActs, 2000);
  check(!!s, `…activated with E (${s?.active ?? 'done'})`);
  if (row.randomRoll === 'rocket') { await waitFor(page, (x) => x.rocketN >= 6, 8000); const l = await page.evaluate(() => window.__RAD_GAME__.world.power.rocketLog.slice(3).map((r) => [r.targetId, r.result])); log(`    random rocket: ${JSON.stringify(l)}`); }

  // ---- finish ----
  const done = await waitFor(page, (x) => x.results, 200000, 250);
  const fin = await page.evaluate(() => {
    const w = window.__RAD_GAME__.world, r = window.__RAD_LAST_RESULT__, pw = w.power;
    const res = { place: r?.playerPlace, time: r?.totalTime, best: r?.bestLapMs, aiAll: w.cars.slice(1).every((c) => c.finished), laps: w.player.lap, frames: window.__frames,
      padP: w.player.padHits || 0, padAI: w.cars.slice(1).reduce((a, c) => a + (c.padHits || 0), 0), collects: pw.collects.map((c) => `${c.lap}:${c.box}:${c.power}`),
      acts: pw.activations.map((a) => `${a.kind}/${a.source}`), ignored: pw.ignored, blocked: pw.blocked, aiSpins: w.cars.slice(1).map((c) => c.spins || 0) };
    window.__botStop(); return res;
  });
  const fps = (fin.frames - frames0) / ((Date.now() - wall0) / 1000);
  row.fin = fin; row.fps = fps; row.errs = errs.length - errStart;
  const perLap = [0, 1, 2].map((l) => fin.collects.filter((c) => c.startsWith(l + ':')).length);
  check(perLap.every((n) => n === 1), `one box collected per lap: ${perLap.join('/')} — ${fin.collects.join(', ')}`);
  check(fin.padP > 0 && fin.padAI > 0, `pads still work: player ${fin.padP}, AI ${fin.padAI}`);
  check(!!done && fin.aiAll && fin.laps >= 3 && fps > 55, `race: P${fin.place} ${(fin.time / 1000).toFixed(2)} s best ${(fin.best / 1000).toFixed(2)} s, all AI finished ${fin.aiAll}, fps ≈${fps.toFixed(1)}`);
  check(row.errs === 0, `console errors this race: ${row.errs} ${JSON.stringify(errs.slice(errStart, errStart + 2))}`);
  log(`    activations ${fin.acts.join(', ')}`);
  rows.push(row);
  await page.click('#title');
  await page.waitForSelector('[data-act=race]');
}

// ---------------------------------------------------------------------------
log(`\n=== MOBILE 844×390 touch (neon) ===`);
const mob = await browser.newPage();
await mob.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
const merrs = []; watchErrors(mob, merrs);
await mob.goto(url, { waitUntil: 'networkidle2' });
await mob.evaluate(() => localStorage.clear());
await mob.reload({ waitUntil: 'networkidle2' });
await mob.tap('[data-act=race]');
await mob.waitForSelector('#tracks button');
await (await mob.$$('#tracks button'))[0].tap();
await install(mob);
await waitFor(mob, (x) => x.cd <= 0, 8000);
await sleep(400);
// E with nothing held: ignored
let m = await st(mob);
await mob.keyboard.press('e'); await sleep(120);
let m2 = await st(mob);
check(m2.acts === 0 && m2.ignored === m.ignored + 1, `E with nothing held: no activation (ignored ${m.ignored}→${m2.ignored})`);
await debug(mob, 'give', 'lapboost');
await sleep(200);
const lay = await mob.evaluate(() => {
  const r = (id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, vis: getComputedStyle(e).display !== 'none' }; };
  return { power: r('btn-power'), gas: r('btn-brake'), // v53: BRAKE replaced GAS
    aim: r('aim-pad'), pause: r('btn-pause'), hud: window.__RAD_GAME__.getLastHud() || null, text: document.getElementById('btn-power').textContent };
});
const ov = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const panels = lay.hud ? [lay.hud.missile, lay.hud.boost].filter(Boolean) : [];
check(lay.power?.vis && lay.power.w >= 60 && lay.power.h >= 30, `POWER button visible ${Math.round(lay.power?.w)}×${Math.round(lay.power?.h)} at (${Math.round(lay.power?.x)},${Math.round(lay.power?.y)}) "${lay.text.trim()}"`);
check(!ov(lay.power, lay.gas) && !ov(lay.power, lay.aim) && !ov(lay.power, lay.pause) && !panels.some((p) => ov(lay.power, p)), `no overlap with BRAKE (${Math.round(lay.gas.x)},${Math.round(lay.gas.y)} ${Math.round(lay.gas.w)}×${Math.round(lay.gas.h)}), STEER, pause${panels.length ? ', MISSILE/BOOST panels' : ''}`);
await mob.screenshot({ path: `${outDir}/78-mobile-power-held.png` }); log(`    shot ${outDir}/78-mobile-power-held.png`);
const pc = { x: lay.power.x + lay.power.w / 2, y: lay.power.y + lay.power.h / 2 };
const inp0 = await mob.evaluate(() => ({ aim: window.__RAD_INPUT__.state.aimActive, boost: window.__RAD_GAME__.world.boost.uses, miss: window.__RAD_GAME__.world.missile.log.length }));
await mob.touchscreen.tap(pc.x, pc.y);
m = await waitFor(mob, (x) => x.active === 'lapboost', 1500);
const a0 = await mob.evaluate(() => ({ act: window.__RAD_GAME__.world.power.activations.at(-1), aim: window.__RAD_INPUT__.state.aimActive, boost: window.__RAD_GAME__.world.boost.uses, miss: window.__RAD_GAME__.world.missile.log.length }));
check(!!m && a0.act.source === 'tap', `touch tap on POWER → LAP BOOST active (source '${a0.act.source}')`);
check(!a0.aim && a0.boost === inp0.boost && a0.miss === inp0.miss, `tap didn't steer / slide-boost / fire (aimActive ${a0.aim}, boost uses ${inp0.boost}→${a0.boost}, missiles ${inp0.miss}→${a0.miss})`);
await sleep(700);
await mob.screenshot({ path: `${outDir}/78-mobile-lapboost-active.png` }); log(`    shot ${outDir}/78-mobile-lapboost-active.png`);
// natural collection during the lap boost (roll pinned to ROCKET), then a tap while the lap boost runs → blocked
await debug(mob, 'forceNext', 'rocket');
await mob.evaluate(() => { window.__lane = 'box'; });
m = await waitFor(mob, (x) => x.held || x.lap >= 1, 40000, 20);
await mob.evaluate(() => { window.__lane = 'avoid'; });
check(!!m?.held && m.active === 'lapboost', `lap 1 box collected while LAP BOOST runs → held ${m?.held}`);
const heldKind = m?.held;
if (heldKind) natural[heldKind]++;
await sleep(300);
await mob.screenshot({ path: `${outDir}/78-mobile-held-while-active.png` }); log(`    shot ${outDir}/78-mobile-held-while-active.png`);
m = await st(mob);
await mob.touchscreen.tap(pc.x, pc.y); await sleep(150);
m2 = await st(mob);
check(m2.blocked === m.blocked + 1 && m2.held === heldKind && m2.active === 'lapboost', `tap while LAP BOOST runs: blocked (${m.blocked}→${m2.blocked}), still holding ${m2.held}`);
// hold through the lap-2 box: box stays
m = await waitFor(mob, (x) => x.lap >= 1, 60000);
await sleep(300);
await mob.evaluate(() => { window.__lane = 'box'; });
const ig0 = (await st(mob)).ignored;
m = await waitFor(mob, (x) => x.dBox < -80, 60000, 20);
await mob.evaluate(() => { window.__lane = 'avoid'; });
check(m.collected.every((c) => !c) && m.held === heldKind && m.ignored > ig0 && m.collects === 1, `holding ${heldKind} through the lap 2 row: box stays (collected ${JSON.stringify(m.collected)}), still holding ${m.held}, ignored touches ${ig0}→${m.ignored}`);
// tap to use it
const nActs = m.acts;
await mob.touchscreen.tap(pc.x, pc.y);
m = await waitFor(mob, (x) => x.acts > nActs, 1500);
check(!!m, `tap → ${heldKind} activated`);
if (heldKind === 'autopilot' || heldKind === 'lapboost') { await sleep(1500); }
await sleep(600);
await mob.screenshot({ path: `${outDir}/78-mobile-${heldKind}-active.png` }); log(`    shot ${outDir}/78-mobile-${heldKind}-active.png`);
// forced autopilot by tap on lap 3 (if not already used)
m = await waitFor(mob, (x) => x.lap >= 2 && !x.active, 90000);
await debug(mob, 'give', heldKind === 'autopilot' ? 'rocket' : 'autopilot');
await sleep(150);
const k3 = (await st(mob)).held;
await mob.touchscreen.tap(pc.x, pc.y);
m = await waitFor(mob, (x) => x.active === k3 || x.acts > nActs + 1, 1500);
await sleep(1500);
await mob.screenshot({ path: `${outDir}/78-mobile-${k3}-tap.png` }); log(`    shot ${outDir}/78-mobile-${k3}-tap.png`);
check(!!m, `lap 3: debug.give('${k3}') + tap → active`);
const mdone = await waitFor(mob, (x) => x.results, 200000, 300);
const mfin = await mob.evaluate(() => { const w = window.__RAD_GAME__.world; const r = { aiAll: w.cars.slice(1).every((c) => c.finished), apLog: w.power.apLog, acts: w.power.activations.map((a) => `${a.kind}/${a.source}`) }; window.__botStop(); return r; });
check(!!mdone && mfin.aiAll, `mobile race finished, all AI finished; activations ${mfin.acts.join(', ')}`);
if (mfin.apLog.length) log(`    mobile autopilot: ${JSON.stringify(mfin.apLog.map((a) => ({ dur: Math.round(a.durMs), wall: a.wall, dev: +a.devMean.toFixed(1), spd: Math.round(a.spdMean), hbWall: a.hbWall })))}`);
check(merrs.length === 0, `mobile console errors: ${merrs.length} ${JSON.stringify(merrs.slice(0, 2))}`);
check(errs.length === 0, `desktop console errors: ${errs.length}`);
check(natural.rocket > 0 && natural.lapboost > 0 && natural.autopilot > 0, `natural box pickups by kind: rocket ${natural.rocket}, lapboost ${natural.lapboost}, autopilot ${natural.autopilot}`);
await browser.close();

const summary = [
  `Radcars v50 'bonus' verification ${new Date().toString()}`,
  `URL ${url}  renderer=${rendererKind}`,
  '',
  `ODDS P3 rocket/lapboost/autopilot ${pct(odds.p3, 'rocket')}/${pct(odds.p3, 'lapboost')}/${pct(odds.p3, 'autopilot')}%  P1 ${pct(odds.p1, 'rocket')}/${pct(odds.p1, 'lapboost')}/${pct(odds.p1, 'autopilot')}%`,
  '',
  'PER TRACK (3 laps, 5 AI Normal)',
  ...rows.map((r) => [
    `  ${r.name.toUpperCase()}: row of ${r.box.n} at s=${r.box.s} (lat ${r.box.lats.join('/')}) · P${r.fin.place} ${(r.fin.time / 1000).toFixed(2)} s · fps ${r.fps.toFixed(1)} · all AI ${r.fin.aiAll} · errors ${r.errs}`,
    `    rocket targets [${r.rocket.targets.join(',')}] ${r.rocket.results.join('/')} hits ${r.rocket.hits} spins ${r.rocket.spun} gaps ${r.rocket.gaps.join('/')} ms · lap missile ${r.missile.log.join('/') || 'refused'}`,
    `    lap boost ${f0(r.lapboost.ms)} ms, green ${r.lapboost.greenAll} · autopilot ${f0(r.autopilot.dur)} ms wall ${r.autopilot.wall} dev ${r.autopilot.dev.toFixed(1)}/${r.autopilot.devMax.toFixed(1)} wu spd ${f0(r.autopilot.spd)}/${f0(r.autopilot.spdMax)} · handback ${f0(r.autopilot.s0)}→${f0(r.autopilot.s1)}→${f0(r.autopilot.s3)} decel ${f0(r.autopilot.hbDec)} walls ${r.autopilot.hbWall}+${r.autopilot.afterWall}`,
    `    boxes ${r.fin.collects.join(', ')} · random roll ${r.randomRoll} · pads P${r.fin.padP}/AI${r.fin.padAI}`
  ].join('\n')),
  '',
  `OVERALL: ${fails ? `FAIL (${fails})` : 'PASS'}`,
  '',
  'DETAIL',
  ...lines
];
writeFileSync(`${outDir}/78-verify.txt`, summary.join('\n') + '\n');
console.log(`\nOVERALL: ${fails ? `FAIL (${fails})` : 'PASS'}`);
process.exit(fails ? 1 : 0);
