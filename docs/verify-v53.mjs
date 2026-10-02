/**
 * v53 'controls' verification (auto-throttle + BRAKE, data-driven touch layer, portrait-first camera).
 *
 *   node docs/verify-v53.mjs <url> <outDir> races <portrait|landscape|desktop|narrow|tall> <pixi|canvas> [laps=2]
 *     4 tracks, a bot on auto-throttle that steers (keys) and brakes (Down) into hairpins. Checks per race: laps count,
 *     every rival finishes, brake used, finish reveal → results, car orientation (sprite axis = heading), the car stays
 *     inside the view band (between HUD and thumbs) and never under a control, no key hints anywhere, 0 errors.
 *   node docs/verify-v53.mjs <url> <outDir> touch <viewport> <renderer>
 *     real multi-touch via CDP (steer + brake + boost held at once), every button tapped by touch, slide shortcuts,
 *     pause, layout overlap checks (clusters vs HUD vs each other, 48 px hit areas, POWER ≥16 px from the steer ring).
 *   node docs/verify-v53.mjs <url> <outDir> states [dpr=3]
 *     portrait 390×844 shots of every button state (81-state-*.png, 81-gd-*.png for Graphic Designer).
 *   node docs/verify-v53.mjs <url> <outDir> fps <viewport> <renderer>
 *     12 s of racing, frame rate with nothing else captured.
 * Lines go to stdout and <outDir>/81-verify-<mode>-<viewport>-<renderer>.txt; "RESULT: ALL OK" or "RESULT: FAIL".
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [,, base = 'http://localhost:4173/', outDir = 'docs/shots', mode = 'races', vpName = 'portrait', rk = 'pixi', extra] = process.argv;
const VIEWPORTS = {
  portrait: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  narrow: { width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tall: { width: 430, height: 932, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  landscape: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true },
  desktop: { width: 1280, height: 720, deviceScaleFactor: 1 }
};
const TRACKS = ['neon', 'gridlock', 'razor', 'cargo'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(outDir, { recursive: true });
const tag = mode === 'states' ? 'states' : `${mode}-${vpName}-${rk}`;
const lines = [];
let fails = 0;
const log = (s) => { lines.push(s); console.log(s); };
const check = (ok, msg) => { if (!ok) fails++; log(`  [${ok ? 'ok' : 'FAIL'}] ${msg}`); return ok; };
const KEY_HINT = /\b(Shift|Space|Esc|WASD|keyboard)\b|tap · E|slide GAS|\bkey\b|\bE to\b/i;

const vp = mode === 'states' ? { ...VIEWPORTS.portrait, deviceScaleFactor: Number(extra || 3) } : VIEWPORTS[vpName];
const url = base + (mode !== 'states' && rk === 'canvas' ? '?canvas=1' : '');
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage();
await page.setViewport(vp);
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
await page.goto(url, { waitUntil: 'networkidle2' });
const laps = mode === 'races' ? Number(extra || 2) : 3;
await page.evaluate((laps) => { localStorage.clear(); localStorage.setItem('radcars_core_v1', JSON.stringify({ mute: true, options: { aiCount: 5, laps, difficulty: 1 }, bestLaps: {} })); }, laps);
await page.reload({ waitUntil: 'networkidle2' });
const cdp = await page.createCDPSession();
const shot = async (name) => { const f = `${outDir}/${name}.png`; await page.screenshot({ path: f }); log(`    shot ${f}`); };
const raf2 = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function startRace(ti, menuShots = false) {
  await page.waitForSelector('[data-act=race]');
  if (menuShots) await shot(`81-menu-title-${vpName}`);
  await page.click('[data-act=race]');
  await page.waitForSelector('#tracks button');
  if (menuShots) await shot(`81-menu-select-${vpName}`);
  await page.evaluate((ti) => document.querySelectorAll('#tracks button')[ti].click(), ti);
  await page.waitForFunction(() => window.__RAD_GAME__?.world && window.__RAD_GAME__.isRunning(), { timeout: 20000 });
  const kind = await page.evaluate(() => window.__RAD_GAME__.rendererKind);
  check(kind === rk || mode === 'states', `renderer ${kind}`);
}
const waitGo = () => page.waitForFunction(() => window.__RAD_GAME__.world.race.countdown <= 0, { timeout: 20000, polling: 50 });

/** The bot: auto-throttle does the gas; it steers with the arrow keys and brakes (Down) for hairpins. */
async function startBot() {
  await page.evaluate(async () => {
    const { pointAt } = await import('./js/tracks.js');
    const { angleDiff } = await import('./js/util.js');
    const held = new Set();
    const set = (k, on) => { if (on && !held.has(k)) { held.add(k); window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); } else if (!on && held.has(k)) { held.delete(k); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); } };
    window.__botStats = { brakeTicks: 0, ticks: 0 };
    window.__bot = setInterval(() => {
      const w = window.__RAD_GAME__.world; if (!w || w.player.finished) { ['ArrowLeft', 'ArrowRight', 'ArrowDown'].forEach((k) => set(k, false)); return; }
      const p = w.player, spd = Math.hypot(p.vx, p.vy);
      const tp = pointAt(w.track, p.sPrev + 150 + spd * 0.35);
      const err = angleDiff(p.angle, Math.atan2(tp.y - p.y, tp.x - p.x));
      set('ArrowRight', err > 0.05); set('ArrowLeft', err < -0.05);
      // corner ahead: how far the road turns over the next ~0.55 s of travel
      const a1 = pointAt(w.track, p.sPrev + 60), a2 = pointAt(w.track, p.sPrev + 60 + spd * 0.55);
      const turn = Math.abs(angleDiff(Math.atan2(a1.ty, a1.tx), Math.atan2(a2.ty, a2.tx)));
      const brake = (turn > 0.75 && spd > 640) || (Math.abs(err) > 0.8 && spd > 480);
      set('ArrowDown', brake);
      window.__botStats.ticks++; if (brake) window.__botStats.brakeTicks++;
    }, 30);
  });
}
const stopBot = () => page.evaluate(() => { clearInterval(window.__bot); ['ArrowLeft', 'ArrowRight', 'ArrowDown'].forEach((k) => window.dispatchEvent(new KeyboardEvent('keyup', { key: k }))); });

/** One sample of where the player is on screen vs the layout (CSS px), and the sprite orientation. */
const sample = () => page.evaluate(() => {
  const g = window.__RAD_GAME__, w = g.world, c = w.cam, p = w.player, L = window.__RAD_LAYOUT__;
  const vw = innerWidth, vh = innerHeight;
  const sx = (p.x - c.x) * c.zoom + vw / 2, sy = (p.y - c.y) * c.zoom + vh / 2;
  const fr = window.__RAD_DEBUG__ && window.__RAD_DEBUG__.frame;
  const me = fr && fr.cars.find((q) => q.isPlayer);
  const orientErr = me ? Math.abs(Math.atan2(Math.sin(Math.atan2(me.lenAxis.y, me.lenAxis.x) - (me.angle + me.spinVis)), Math.cos(Math.atan2(me.lenAxis.y, me.lenAxis.x) - (me.angle + me.spinVis)))) : null;
  const under = Object.entries(L.buttons).filter(([, b]) => Math.hypot(sx - b.cx, sy - b.cy) < b.w / 2 + 6).map(([k]) => k);
  if (Math.hypot(sx - L.steer.cx, sy - L.steer.cy) < L.steer.d / 2 + 6) under.push('steer');
  const info = g.getHudInfo();
  return { sx, sy, fy: sy / vh, under, orientErr, finished: p.finished, lap: info.lap, place: info.place, t: w.race.time, spd: Math.hypot(p.vx, p.vy),
    braking: !!p.braking, brakeMs: w.brakeStats.ms, reveal: !!document.querySelector('#finish-reveal'), results: !!document.querySelector('#results'),
    band: L.view, portrait: L.portrait, zoom: c.zoom, text: document.body.innerText };
});

async function raceTrack(ti) {
  const name = TRACKS[ti];
  log(`\n=== ${name} · ${vpName} · ${rk} · ${laps} laps ===`);
  await startRace(ti, ti === 0);
  if (ti === 0) await layoutChecks('countdown');
  await page.evaluate(() => { window.__RAD_DEBUG__ = {}; });
  await waitGo();
  await startBot();
  const t0 = Date.now();
  let revealSeen = false, maxLap = 0, laps0 = [], minFy = 1, maxFy = 0, underHits = [], orientMax = 0, hint = '', shotRace = false, prevBrakeMs = 0, brakeOnSeen = false;
  const fr0 = await page.evaluate(() => { window.__frames = 0; if (!window.__frLoop) { window.__frLoop = true; const f = () => { window.__frames++; requestAnimationFrame(f); }; requestAnimationFrame(f); } return performance.now(); });
  let s;
  while (Date.now() - t0 < 240000) {
    await sleep(250);
    try { s = await sample(); } catch (e) { continue; }
    if (s.results) break;
    if (s.reveal) revealSeen = true;
    if (!s.finished) {
      if (s.lap !== laps0[laps0.length - 1]) laps0.push(s.lap);
      minFy = Math.min(minFy, s.fy); maxFy = Math.max(maxFy, s.fy);
      if (s.under.length && s.t > 1500) underHits.push(`${s.under.join('+')}@${(s.t / 1000).toFixed(1)}s`);
      if (s.orientErr != null) orientMax = Math.max(orientMax, s.orientErr);
      if (s.braking) brakeOnSeen = true;
      const m = s.text.match(KEY_HINT); if (m && !hint) hint = m[0];
      if (!shotRace && s.t > 9000 && ti < 4) { shotRace = true; if (vpName !== 'desktop' || ti === 0) await shot(`81-race-${name}-${vpName}-${rk}`); }
    }
  }
  const fps = await page.evaluate((t) => window.__frames / ((performance.now() - t) / 1000), fr0);
  await stopBot();
  const res = await page.evaluate(() => window.__RAD_LAST_RESULT__);
  const st = res && res.standings ? res.standings : [];
  const me = st.find((q) => q.isPlayer || q.name === 'You');
  const dnf = st.filter((q) => q.dnf).map((q) => q.name);
  check(!!s && s.results, `race completed → final results (${((Date.now() - t0) / 1000).toFixed(0)} s wall)`);
  check(revealSeen, `finish reveal shown when crossing the line`);
  check(laps0.join('→') === Array.from({ length: laps }, (_, i) => i + 1).join('→'), `laps counted ${laps0.join('→')} of ${laps}`);
  check(st.length === 6 && dnf.length === 0, `all rivals finished (${st.length} cars, DNF: ${dnf.join(',') || 'none'}); player P${me ? me.place || st.indexOf(me) + 1 : '?'}`);
  const brakeMs = await page.evaluate(() => window.__RAD_GAME__.world ? window.__RAD_GAME__.world.brakeStats.ms : 0).catch(() => 0);
  const bs = await page.evaluate(() => window.__botStats);
  check(brakeOnSeen && brakeMs > 300, `brake used into corners: ${(brakeMs / 1000).toFixed(1)} s held (bot ${bs.brakeTicks}/${bs.ticks} ticks), brake lights seen=${brakeOnSeen}`);
  check(orientMax < 0.05, `car sprite matches its heading (max error ${orientMax.toFixed(3)} rad)`);
  const band = s && s.band;
  check(band && minFy >= band.top - 0.01 && maxFy <= band.bottom + 0.01, `car stayed inside the view band ${band ? band.top + '–' + band.bottom : ''}: screen y ${(minFy * 100).toFixed(0)}%–${(maxFy * 100).toFixed(0)}%`);
  check(!underHits.length, `car never under a control (${underHits.slice(0, 4).join(', ') || 'none'})`);
  check(!hint, `no key hints on screen (${hint || 'none found'})`);
  log(`    race fps ${fps.toFixed(1)} (screenshots inside the window)`);
  if (ti === 0) await shot(`81-results-${vpName}-${rk}`);
  await page.evaluate(() => document.querySelector('#title')?.click());
  await sleep(400);
}

async function fpsRun() {
  log(`\n=== fps · ${vpName} · ${rk} ===`);
  await startRace(0);
  await waitGo();
  await startBot();
  await sleep(1500);
  const r = await page.evaluate(() => new Promise((res) => { const ts = []; const t0 = performance.now(); const f = (t) => { ts.push(t); if (t - t0 < 12000) requestAnimationFrame(f); else res(ts); }; requestAnimationFrame(f); }));
  const d = r.slice(1).map((t, i) => t - r[i]);
  const fps = (d.length / ((r[r.length - 1] - r[0]) / 1000));
  const worst = Math.max(...d);
  const brakeMs = await page.evaluate(() => window.__RAD_GAME__.world.brakeStats.ms);
  check(fps >= 57, `frame rate ${fps.toFixed(1)} fps over ${d.length} frames, worst ${worst.toFixed(1)} ms (bot braking ${(brakeMs / 1000).toFixed(1)} s)`);
  await stopBot();
}

/** Touch helpers (CDP, real multi-touch). */
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
const L = () => page.evaluate(() => window.__RAD_LAYOUT__);
const W = () => page.evaluate(() => { const w = window.__RAD_GAME__.world, i = window.__RAD_INPUT__.state; const st = (k) => document.getElementById('btn-' + k).dataset.state;
  return { aim: i.aimActive, aimAngle: i.aimAngle, brake: i.brake, braking: w.player.braking, spd: Math.hypot(w.player.vx, w.player.vy), boostMs: w.boost.activeMs, boostUses: w.boost.uses + w.boost.freeUses, shots: w.missile.shots, refused: w.missile.refused,
    pwAct: w.power.activations.length, pwActive: w.power.active, taps: { ...i.taps }, states: { brake: st('brake'), boost: st('boost'), missile: st('missile'), power: st('power') },
    ringMoved: document.getElementById('aim-pad').style.translate, ringActive: document.getElementById('aim-pad').classList.contains('active'), paused: window.__RAD_GAME__.isPaused() }; });

async function layoutChecks(tagName) {
  const l = await L();
  const rects = await page.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    const q = (s) => document.querySelector(s);
    return { hud: r(q('#hud')), pause: r(q('#btn-pause')), pills: [...document.querySelectorAll('#hud .pill:not(.hidden)')].map(r),
      acts: Object.fromEntries(['brake', 'boost', 'missile', 'power'].map((k) => [k, r(document.getElementById('btn-' + k))])) };
  });
  const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const circ = (b) => ({ x: b.cx - b.w / 2, y: b.cy - b.h / 2, w: b.w, h: b.h });
  const vis = Object.fromEntries(Object.entries(l.buttons).map(([k, b]) => [k, circ(b)]));
  const steerR = { x: l.steer.cx - l.steer.d / 2, y: l.steer.cy - l.steer.d / 2, w: l.steer.d, h: l.steer.d };
  const mm = l.minimap, hudBottom = Math.max(...rects.pills.map((p) => p.y + p.h), rects.pause.y + rects.pause.h, mm.y + mm.h);
  const pairs = [];
  const ks = Object.keys(vis);
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const a = l.buttons[ks[i]], b = l.buttons[ks[j]];
    if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.w / 2 + b.w / 2) pairs.push(ks[i] + '/' + ks[j]);
  }
  check(!pairs.length, `${tagName}: action buttons don't overlap each other (${pairs.join(', ') || 'clear'})`);
  const hitPairs = [];
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const a = l.buttons[ks[i]], b = l.buttons[ks[j]];
    if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.hit / 2 + b.hit / 2 - 0.01) hitPairs.push(ks[i] + '/' + ks[j]);
  }
  check(!hitPairs.length, `${tagName}: round hit areas don't overlap each other (${hitPairs.join(', ') || 'clear'})`);
  const steerGap = Math.min(...ks.map((k) => Math.hypot(l.buttons[k].cx - l.steer.cx, l.buttons[k].cy - l.steer.cy) - l.buttons[k].w / 2 - l.steer.d / 2));
  check(steerGap >= 16 * Math.min(1, l.s) - 0.5, `${tagName}: nearest action button is ${steerGap.toFixed(1)} px clear of the steer ring (≥ 16)`);
  const topControl = Math.min(...ks.map((k) => vis[k].y), steerR.y);
  check(topControl > hudBottom + 8, `${tagName}: clusters (top ${topControl.toFixed(0)} px) clear of the HUD (bottom ${hudBottom.toFixed(0)} px)`);
  const pillOv = rects.pills.some((p) => ov(p, rects.pause) || ov(p, { x: mm.x, y: mm.y, w: mm.w, h: mm.h }));
  check(!pillOv, `${tagName}: HUD pills clear of pause + minimap`);
  const minHit = Math.min(...Object.values(rects.acts).map((r) => Math.min(r.w, r.h)), rects.pause.w + 12);
  check(minHit >= 48, `${tagName}: smallest touch target ${minHit.toFixed(0)} px (≥ 48)`);
  const inside = Object.values(rects.acts).every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= l.vw + 0.5 && r.y + r.h <= l.vh + 0.5) && steerR.x >= 0 && steerR.y + steerR.h <= l.vh;
  check(inside, `${tagName}: every control fully on screen`);
  log(`    layout s=${l.s.toFixed(3)} steer ${l.steer.d.toFixed(0)}px @(${l.steer.cx.toFixed(0)},${l.steer.cy.toFixed(0)}) · ` + ks.map((k) => `${k} ${l.buttons[k].w.toFixed(0)}px @(${l.buttons[k].cx.toFixed(0)},${l.buttons[k].cy.toFixed(0)})`).join(' · '));
}

async function touchRun() {
  log(`\n=== touch · ${vpName} · ${rk} ===`);
  await startRace(0);
  await layoutChecks('countdown');
  await waitGo();
  await sleep(2600); // past the first-seconds camera clamp, not last any more (BOOST ready, not unlimited)
  const l = await L();
  const b = l.buttons;
  const zx = l.steer.cx + l.steer.d * 0.2, zy = l.steer.cy - l.steer.d * 0.2; // in the steer half of the zone, off the ring's centre
  // 1) floating steer: a touch in the zone re-centres the ring under the thumb
  await touch('touchStart', [[zx + 20, zy - 10, 1]]); await raf2();
  let w = await W();
  check(w.ringActive && /px/.test(w.ringMoved || ''), `steer: touch in the control zone re-centres the ring (translate ${w.ringMoved || 'none'})`);
  await touch('touchMove', [[zx + 80, zy - 60, 1]]); await raf2();
  w = await W();
  check(w.aim && Math.abs(w.aimAngle - Math.atan2(-50, 60)) < 0.4, `steer: drag sets the heading (aim ${w.aimAngle?.toFixed(2)} rad, expected ≈ ${Math.atan2(-50, 60).toFixed(2)})`);
  // 2) + BRAKE held (2 fingers)
  const spd0 = w.spd;
  await touch('touchStart', [[zx + 80, zy - 60, 1], [b.brake.cx, b.brake.cy, 2]]);
  await sleep(450);
  w = await W();
  check(w.brake && w.braking && w.states.brake === 'active' && w.spd < spd0 - 150 && w.aim, `steer + BRAKE held: brake on, lights on, button active, ${spd0.toFixed(0)} → ${w.spd.toFixed(0)} wu/s, steer still held`);
  // 3) + BOOST tapped (3 fingers at once)
  await touch('touchStart', [[zx + 80, zy - 60, 1], [b.brake.cx, b.brake.cy, 2], [b.boost.cx, b.boost.cy, 3]]);
  await sleep(250);
  w = await W();
  check(w.aim && w.brake && w.boostMs > 0 && w.taps.boost === 1 && w.states.boost === 'active', `steer + brake + BOOST at once: boost active (${w.boostMs.toFixed(0)} ms left), state ${w.states.boost}, steer=${w.aim}, brake=${w.brake}`);
  if (vpName === 'portrait' && rk === 'pixi') await shot('81-touch-multitouch-portrait');
  await touch('touchMove', [[zx + 80, zy - 60, 1], [b.brake.cx, b.brake.cy, 2]]);
  await touch('touchEnd', []); await raf2();
  w = await W();
  check(!w.aim && !w.brake && !w.ringActive && !w.ringMoved, `release: steer ring snaps back, brake off`);
  // 4) MISSILE tap
  await touch('touchStart', [[b.missile.cx, b.missile.cy, 4]]); await touch('touchEnd', []);
  await sleep(150);
  w = await W();
  check(w.taps.missile === 1 && (w.shots === 1 || w.refused === 1) && ['active', 'used'].includes(w.states.missile), `MISSILE tap: fired=${w.shots} (refused ${w.refused}), button ${w.states.missile}`);
  // 5) POWER tap (holding a rocket)
  await page.evaluate(() => window.__RAD_GAME__.debug.give('rocket')); await raf2(); await raf2();
  w = await W();
  check(w.states.power === 'held', `POWER shows the held rocket (state ${w.states.power})`);
  await touch('touchStart', [[b.power.cx, b.power.cy, 5]]); await touch('touchEnd', []);
  await sleep(120);
  w = await W();
  check(w.taps.power === 1 && w.pwAct === 1 && w.states.power === 'active', `POWER tap: activated (${w.pwActive}), button ${w.states.power}`);
  // 6) slide shortcuts on BRAKE (up = boost, towards the arc = missile)
  const lefty = await page.evaluate(() => document.getElementById('touch-controls').classList.contains('lefty'));
  await touch('touchStart', [[b.brake.cx, b.brake.cy, 6]]); await touch('touchMove', [[b.brake.cx, b.brake.cy - 30, 6]]); await touch('touchMove', [[b.brake.cx, b.brake.cy - 60, 6]]); await touch('touchEnd', []);
  await touch('touchStart', [[b.brake.cx, b.brake.cy, 7]]); await touch('touchMove', [[b.brake.cx + (lefty ? 30 : -30), b.brake.cy, 7]]); await touch('touchMove', [[b.brake.cx + (lefty ? 60 : -60), b.brake.cy, 7]]); await touch('touchEnd', []);
  w = await W();
  check(w.taps.slideBoost === 1 && w.taps.slideMissile === 1, `BRAKE slide shortcuts: up → boost request (${w.taps.slideBoost}), sideways → missile request (${w.taps.slideMissile})`);
  // 7) PAUSE tap
  await touch('touchStart', [[l.pause.x + l.pause.w / 2, l.pause.y + l.pause.h / 2, 8]]); await touch('touchEnd', []);
  await sleep(200);
  w = await W();
  const ov = await page.$('#pause-ov');
  check(w.paused && !!ov, `PAUSE tap opens the pause screen`);
  if (ov) { await page.click('#resume'); await sleep(200); }
  await layoutChecks('race');
  const text = await page.evaluate(() => document.body.innerText);
  const m = text.match(KEY_HINT);
  check(!m, `no key hints in the race UI (${m ? m[0] : 'none'})`);
  await page.evaluate(() => { window.__RAD_GAME__.stopRace(); });
}

/** Every button state, portrait 390×844 (Graphic Designer review shots). */
async function statesRun() {
  log(`\n=== states · portrait 390×844 · DPR ${vp.deviceScaleFactor} · ${await page.evaluate(() => window.__RAD_RENDERER__)} ===`);
  await startRace(0);
  await sleep(1300);
  await shot('81-gd-countdown');
  const st = () => page.evaluate(() => Object.fromEntries(['brake', 'boost', 'missile', 'power'].map((k) => [k, document.getElementById('btn-' + k).dataset.state])));
  check(await page.evaluate(() => document.getElementById('touch-controls').classList.contains('counting')), 'countdown: buttons dimmed (35%)');
  await waitGo();
  await sleep(150);
  let s = await st();
  check(s.boost === 'unlimited', `at GO the player is last → BOOST unlimited (${s.boost})`);
  await shot('81-gd-unlimited');
  // drive a little so we're not last
  await startBot();
  await page.waitForFunction(() => window.__RAD_GAME__.getHudInfo().place < 6 && document.getElementById('btn-boost').dataset.state === 'ready', { timeout: 15000, polling: 100 }).catch(() => {});
  await sleep(300);
  s = await st();
  check(s.boost === 'ready' && s.missile === 'ready' && ['empty', 'held'].includes(s.power), `ready: boost ${s.boost}, missile ${s.missile}, power ${s.power}`);
  await shot('81-gd-boost-ready');
  // brake pressed + steer active (touch)
  await stopBot();
  const l = await L(), b = l.buttons;
  await touch('touchStart', [[l.steer.cx + 30, l.steer.cy - 20, 1], [b.brake.cx, b.brake.cy, 2]]);
  await touch('touchMove', [[l.steer.cx + 70, l.steer.cy - 50, 1], [b.brake.cx, b.brake.cy, 2]]);
  await sleep(250);
  s = await st();
  check(s.brake === 'active', `brake pressed (${s.brake})`);
  await shot('81-gd-brake-pressed');
  await shot('81-gd-steer-active');
  await touch('touchEnd', []);
  await startBot();
  // boost active
  await page.keyboard.press('Shift'); await sleep(500);
  s = await st();
  check(s.boost === 'active', `boost active with countdown sweep (${s.boost})`);
  await shot('81-state-boost-active');
  // missile in flight, then used (+ recharge arc)
  await page.keyboard.press(' '); await sleep(250);
  s = await st();
  log(`    missile after fire: ${s.missile}`);
  if (s.missile === 'active') await shot('81-state-missile-active');
  await page.waitForFunction(() => document.getElementById('btn-missile').dataset.state === 'used', { timeout: 6000, polling: 100 }).catch(() => {});
  await sleep(1200);
  s = await st();
  check(s.missile === 'used' && s.boost !== 'ready', `missile used, NEXT LAP arc (${s.missile}); boost ${s.boost}`);
  await shot('81-gd-missile-used');
  // power held (rocket3) → active
  await page.evaluate(() => window.__RAD_GAME__.debug.give('rocket')); await sleep(400);
  s = await st();
  check(s.power === 'held', `power holding the rocket (${s.power})`);
  await shot('81-gd-power-rocket3');
  for (const k of ['lapboost', 'autopilot']) {
    await page.evaluate((k) => { const w = window.__RAD_GAME__.world; w.power.held = k; }, k); await sleep(400);
    await shot(`81-state-power-${k}`);
  }
  await page.evaluate(() => { window.__RAD_GAME__.world.power.held = 'autopilot'; });
  await page.keyboard.press('e'); await sleep(600);
  s = await st();
  check(s.power === 'active', `power active with sweep (${s.power})`);
  await shot('81-state-power-active');
  const toasts = await page.evaluate(() => (self.__RAD_TOASTS__ || []).map((t) => t.text));
  check(toasts.length >= 2, `toasts shown: ${toasts.join(' | ')}`);
  await stopBot();
}

try {
  if (mode === 'races') { for (let ti = 0; ti < 4; ti++) await raceTrack(ti); }
  else if (mode === 'fps') await fpsRun();
  else if (mode === 'touch') await touchRun();
  else if (mode === 'states') await statesRun();
} catch (e) { check(false, 'exception: ' + (e && e.stack || e)); }
check(errs.length === 0, `console errors/warnings: ${errs.length} ${JSON.stringify(errs.slice(0, 3))}`);
log(`\nRESULT: ${fails ? 'FAIL' : 'ALL OK'} (${tag})`);
fs.writeFileSync(`${outDir}/81-verify-${tag}.txt`, lines.join('\n') + '\n');
await browser.close();
process.exit(fails ? 1 : 0);
