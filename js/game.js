import { getTrack, buildStartingGrid } from './tracks.js';
import { createCar, CAR_COLORS, AI_NAMES } from './cars.js';
import { stepCar, initCarOnTrack, resolveCarCollisions, BOOST_TOP_MUL, CAR_LEN, CAR_WID, slip01, CHAIN_RUSH_LVL } from './physics.js';
import { stepAI } from './ai.js';
import { createRenderer } from './render.js';
import { newFx, stepFx, zoomPunch, SKID_ON, SKID_OFF } from './fx.js';
import { sfx, setAudioPaused, engineFrame, wallStrength, WALL } from './audio.js';
import { clamp, angleDiff } from './util.js';
import { pointAt } from './tracks.js';
import { newMissileState, pickTarget, launchMissile, stepMissiles, stepSpin, stepPads } from './weapons.js';
import { updateControls, resetControls, getLayout } from './controls.js';
import { createCelebration, stepCelebration, FINISH_TIMING, ordinal } from './celebrate.js';
import { newPowerState, stepBonus, rocketTargets, autopilotControl, cruiseControl, trackAutopilot, POWER_INFO, POWERS, ROCKET_COUNT, ROCKET_GAP_MS, LAPBOOST_MIN_MS, AUTOPILOT_MS, AUTOPILOT_TOP_MUL, AUTOPILOT_HANDBACK_MS, handbackAssist } from './powerups.js';

/** Chase camera: tight at the grid, pulls out and looks ahead with speed. */
const ZOOM_GRID = 0.85;
const ZOOM_NEAR = 0.95;
const ZOOM_FAR = 0.24;   // v43 long-chase pull-out kept
const LOOKAHEAD_MAX = 700;
const COUNTDOWN_MS = 3800;

export const DIFFICULTIES = [
  { label: 'Easy', top: [860, 930], margin: 0.8 },
  { label: 'Normal', top: [930, 1000], margin: 0.9 },
  { label: 'Hard', top: [990, 1050], margin: 0.97 }
];
const PLAYER_TOP = 1000;
const PLAYER_ACCEL = 640;

/**
 * Boost (v47, player only). One charge per lap: the first charge is available from the start
 * (GO) and it refills to 1 (never more) every time the player crosses the start/finish line.
 * While the player is in last place a boost costs nothing and can be re-triggered as soon as
 * the current one ends. The level ramps in/out so the push is smooth (physics.js applies it).
 */
export const BOOST_MS = 2000;
const BOOST_RAMP_IN_MS = 220;
const BOOST_RAMP_OUT_MS = 450;
/**
 * v54.6 DOUBLE BOOST (player only). A second boost landing (pad entered, drift boost paid, BOOST pressed, LAP BOOST
 * power) while a boost is already active chains: max 2 stacks. The chain holds the boost on for the time left PLUS the
 * new boost's time (the timer extends, never resets), capped at CHAIN_CAP_MS from the moment it lands, and adds a brief
 * rush: boostLevel CHAIN_RUSH_LVL (physics: top +54 % instead of +40 %) for CHAIN_RUSH_MS, easing back to 1 over the
 * last CHAIN_EASE_MS. A third landing while chained only extends the timer (up to the cap): no new rush, no sound.
 */
export const CHAIN_MAX = 2;
export const CHAIN_RUSH_MS = 1200;
export const CHAIN_EASE_MS = 400;
export const CHAIN_CAP_MS = 3000;
export { CHAIN_RUSH_LVL };

/** Player auto-unstick (no brake since v48): gas held, near-zero speed for UNSTICK_AFTER_MS → reverse. */
const UNSTICK_AFTER_MS = 1500;
/** v53 BRAKE: v47's 1500 wu/s² at speed (eases to 45% near the floor), never below a 170 wu/s crawl (still turns). */
/**
 * v54.4 drift boost: a drift is continuous slip01 ≥ SKID_ON (0.22, the skid / squeal gate) until it drops below
 * SKID_OFF (0.15). It pays out if it lasted ≥ DB_MIN_MS, turned the car ≥ DB_MIN_ANG and touched no wall. Quality 0..1 =
 * DB_W_DUR·duration + DB_W_ANG·angle + DB_W_SMOOTH·(no over-slide at the slip cap); the boost runs DB_MS0 + DB_MS1·q ms at
 * boostLevel DB_LVL0 + DB_LVL1·q through the normal boost path (flame, whoosh edge, shockwave scaled by q).
 */
export const DB_MIN_MS = 600, DB_MIN_ANG = Math.PI / 4, DB_FULL_MS = 1500, DB_FULL_ANG = Math.PI * 0.75;
export const DB_W_DUR = 0.35, DB_W_ANG = 0.4, DB_W_SMOOTH = 0.25, DB_MS0 = 400, DB_MS1 = 700, DB_LVL0 = 0.6, DB_LVL1 = 0.35, DB_PERFECT = 0.8, DB_NEED_HB = true;
export const PLAYER_BRAKE = 1500;
export const PLAYER_BRAKE_FLOOR = 170;
const UNSTICK_REVERSE_MS = 900;
const MISSILE_FLASH_MS = 1400;

function newBoost() {
  return { charge: 1, activeMs: 0, level: 0, free: false, uses: 0, freeUses: 0, lastTriggerMs: -1, source: null };
}

/** v54.6 DOUBLE BOOST state (player only): stacks 0–2, the chain's hold/rush timers and the landing counters seen. */
function newChain() {
  return { stacks: 0, holdMs: 0, rushMs: 0, wasOn: false, count: 0, extends: 0, landT: -1, sfxT: -1, log: [], seen: { trig: 0, pad: 0, drift: 0, lap: false } };
}

export function createGame(canvas, input) {
  // v51: main.js installs the PixiJS (WebGL) renderer when it initialises, or the Canvas 2D one (?canvas=1 / no WebGL).
  let renderer = null;
  let running = false, paused = false, raf = 0, last = 0;
  let world = null, onFinish = null, onPause = null, onReveal = null, lastDigit = null;
  // v52 finish flow: timers and the reveal handle belong to one race (token), so a quick "Race again" can't fire them
  let token = 0, timers = [], revealView = null;
  const later = (fn, ms) => { const t = token; timers.push(setTimeout(() => { if (t === token) fn(); }, ms)); };
  function clearFinishFlow() {
    token++; timers.forEach(clearTimeout); timers = [];
    if (revealView) { revealView.remove(); revealView = null; }
    window.removeEventListener('keydown', onSkipKey, true);
  }

  function fit() {
    if (!renderer) return;
    const app = document.getElementById('app');
    renderer.resize(app.clientWidth, app.clientHeight, Math.min(window.devicePixelRatio || 1, 2));
  }
  window.addEventListener('resize', fit);
  function setRenderer(r) { renderer = r; fit(); }

  function startRace({ trackIndex, laps = 3, aiCount = 5, difficulty = 1, drift = false }) {
    if (!renderer) setRenderer(createRenderer(canvas)); // safety net: never race without a renderer
    const track = getTrack(trackIndex);
    const nAI = clamp(aiCount, 1, 7);
    const diff = DIFFICULTIES[clamp(difficulty, 0, DIFFICULTIES.length - 1)];
    const grid = buildStartingGrid(track, nAI + 1);
    // Player starts at the back of the grid so there is someone to race
    const order = [...grid.keys()];
    const playerSlot = grid.length - 1;
    const cars = [];
    const p = createCar({ id: 0, name: 'You', color: CAR_COLORS[0], isPlayer: true, x: grid[playerSlot].x, y: grid[playerSlot].y, angle: grid[playerSlot].angle, top: PLAYER_TOP, accel: PLAYER_ACCEL });
    initCarOnTrack(p, track, grid[playerSlot].s);
    p.driftOn = !!drift; // v54.2: drift handling applies only while the player is actually driving (see stepCars)
    cars.push(p);
    let k = 0;
    for (const slot of order) {
      if (slot === playerSlot) continue;
      const g = grid[slot];
      const t = (nAI - 1 - k) / Math.max(1, nAI - 1); // back of grid = faster
      const c = createCar({
        id: k + 1, name: AI_NAMES[k % AI_NAMES.length], color: CAR_COLORS[(k + 1) % CAR_COLORS.length],
        x: g.x, y: g.y, angle: g.angle,
        top: diff.top[0] + (diff.top[1] - diff.top[0]) * (1 - t) + Math.random() * 20,
        accel: 600,
        aiLane: ((k % 3) - 1) * track.halfW * 0.3,
        aiMargin: diff.margin
      });
      initCarOnTrack(c, track, g.s);
      cars.push(c);
      k++;
    }
    const cam = { x: p.x, y: p.y, zoom: ZOOM_GRID };
    world = {
      track, cars, player: p, cam,
      race: { trackIndex, totalLaps: laps, time: 0, countdown: COUNTDOWN_MS, countdownMs: COUNTDOWN_MS, goFlash: 0, over: false, placesAssigned: 0, lapFlashMs: 0, lapFlashLast: 0, lapFlashBest: 0 }
    };
    world.boost = newBoost(); world.chain = newChain(); world.chainFlash = null;
    world.fxEvents = []; world.wallLog = []; world.fxState = newFx(); // v54 feel events (consumed by the renderer's FX) + impact log
    world.missile = newMissileState();
    world.power = newPowerState();
    world.missiles = [];
    world.fx = [];
    world.unstick = { stuckMs: 0, reverseMs: 0, count: 0 };
    world.brakeStats = { ms: 0 }; world.hbStats = { presses: 0 }; world.driftLog = []; world.driftFlash = null;
    p.braking = false;
    world.finish = null; // v52: set when the player crosses the line on the final lap (reveal → results)
    clearFinishFlow();
    input.clearBoost && input.clearBoost();
    lastDigit = null;
    running = true;
    paused = false;
    last = performance.now();
    input.showTouch(true);
    resetControls();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function stopRace() {
    clearFinishFlow();
    running = false;
    input.showTouch(false);
    cancelAnimationFrame(raf);
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min(50, now - last);
    last = now;
    if (!paused && update(dt) === 'pause') {
      paused = true; setAudioPaused(true);
      if (onPause) onPause();
    }
    if (world.finish) tickFinish(dt);
    updateCamera(dt);
    drawWithFeel(paused ? 0 : dt);
    if (!running) return; // the finish flow may have stopped the race this frame
    const showHud = !world.race.over && !world.player.finished;
    // v53: the action buttons (DOM, js/controls.js) replace the canvas BOOST / MISSILE panels and the POWER slot
    lastHud = showHud ? updateControls(world, { boostMs: BOOST_MS, autopilotMs: AUTOPILOT_MS, rocketCount: ROCKET_COUNT, braking: !!world.player.braking }) : null;
    const race = world.race;
    if (race.countdown > 0) {
      const c = race.countdown;
      renderer.drawCountdown(c > 2800 ? '3' : c > 1800 ? '2' : c > 800 ? '1' : 'GO');
    } else if (race.goFlash > 0) {
      renderer.drawCountdown('GO');
    }
    raf = requestAnimationFrame(loop);
  }

  let lastHud = null; // v53: last painted action-button boxes (canvas CSS px), for layout checks

  /**
   * Chase camera with a keep-in-view clamp (v49).
   * Bug we fixed: the countdown used a fixed 200 wu look-ahead at ZOOM_GRID (0.85). On a short
   * viewport (e.g. mobile landscape height ~390 → half-height ≈ 229 wu) that put the car near or
   * past the edge until it had driven a bit. We now pick look-ahead / zoom as before for the
   * high-speed chase, then clamp look so the player's AABB stays inside the view with ~10% of
   * the shorter screen side as margin, and hard-correct after smoothing if anything slips.
   */
  /**
   * v54.3 (GD): the clear area speed streaks may use, from the real DOM: below the HUD pills / pause button (+12 px) and
   * clear of the control cluster (action buttons + steer ring). Portrait: the full-width band above the cluster;
   * landscape / desktop (clusters in the bottom corners): whichever is larger of that band and the column between the
   * two clusters. Re-measured on resize and every 500 ms (the layout only changes on resize / orientation).
   */
  let clearAt = -1e9, obsAt = -1e9;
  let toastWas = false;
  function measureClear(fx, vw, vh) {
    const t = performance.now(), c = fx.clear;
    const te = document.getElementById ? document.getElementById('tc-toast') : null, toastNow = !!(te && !te.classList.contains('hidden'));
    const toastLive = toastNow || toastWas; toastWas = toastNow; // v54.4.1: every frame while a toast shows (+1 frame after)
    if (c && c.W === vw && c.H === vh && t - clearAt < 500) { if (t - obsAt >= 100 || toastLive) { obsAt = t; c.obs = clearObstacles(vw, vh); } return; }
    clearAt = t; obsAt = t;
    const cr = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 }, rel = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 ? { l: b.left - cr.left, t: b.top - cr.top, r: b.right - cr.left, b: b.bottom - cr.top } : null; };
    const pick = (sel) => (document.querySelectorAll ? [...document.querySelectorAll(sel)] : []).map(rel).filter(Boolean);
    const hud = pick('#hud > .pill:not(.pill-laptime), #btn-pause'), ctl = pick('#touch-controls .act, #aim-pad');
    const top = (hud.length ? Math.max(...hud.map((b) => b.b)) : 0) + 12;
    if (!ctl.length) { fx.clear = { W: vw, H: vh, x0: 12, y0: top, x1: vw - 12, y1: vh - 12 }; return; }
    const band = { x0: 12, y0: top, x1: vw - 12, y1: Math.min(...ctl.map((b) => b.t)) - 8 };
    const L = ctl.filter((b) => (b.l + b.r) / 2 < vw / 2), R = ctl.filter((b) => (b.l + b.r) / 2 >= vw / 2);
    const col = { x0: (L.length ? Math.max(...L.map((b) => b.r)) : 0) + 12, y0: top, x1: (R.length ? Math.min(...R.map((b) => b.l)) : vw) - 12, y1: vh - 12 };
    const area = (q) => Math.max(0, q.x1 - q.x0) * Math.max(0, q.y1 - q.y0);
    fx.clear = { W: vw, H: vh, ...(area(col) > area(band) ? col : band), obs: clearObstacles(vw, vh) };
  }
  /** v54.4: rects inside the clear area streaks must also avoid: the canvas-drawn minimap and any visible toast pill. */
  function clearObstacles(vw, vh) {
    const out = [], lay = getLayout();
    if (lay && lay.minimap && lay.vw === vw && lay.vh === vh) { const m = lay.minimap; out.push({ l: m.x, t: m.y, r: m.x + m.w, b: m.y + m.h }); }
    if (document.querySelectorAll) {
      const cr = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
      for (const e of document.querySelectorAll('#tc-toast:not(.hidden), #hud > .pill-laptime:not(.hidden)')) { const b = e.getBoundingClientRect(); if (b.width > 0 && b.height > 0) out.push({ l: b.left - cr.left, t: b.top - cr.top, r: b.right - cr.left, b: b.bottom - cr.top }); }
    }
    return out;
  }

  /** v54: advance the shared FX state, then draw with the camera shake + boost zoom punch applied for this frame only. */
  function drawWithFeel(dt) {
    const cam = world.cam, fx = world.fxState;
    if (!fx) { renderer.draw(world); return; }
    const vw = canvas.clientWidth || innerWidth, vh = canvas.clientHeight || innerHeight;
    measureClear(fx, vw, vh);
    if (dt > 0) stepFx(fx, world, dt, { x: cam.x, y: cam.y, hw: vw / 2 / cam.zoom, hh: vh / 2 / cam.zoom }, vw, vh);
    const x = cam.x, y = cam.y, z = cam.zoom, punch = zoomPunch(fx, world.race.time, world.player.boostLevel || 0);
    cam.zoom = z * punch; cam.x = x - fx.shake.x / cam.zoom; cam.y = y - fx.shake.y / cam.zoom;
    try { renderer.draw(world); } finally { cam.x = x; cam.y = y; cam.zoom = z; }
  }

  function updateCamera(dt) {
    const { player: p, cam, race } = world;
    const ov = window.__RAD_CAM__; // verification hook: fixed camera {x, y, zoom}
    if (ov) { cam.x = ov.x; cam.y = ov.y; cam.zoom = ov.zoom; return; }

    const vw = canvas.clientWidth || innerWidth;
    const vh = canvas.clientHeight || innerHeight;
    const short = Math.min(vw, vh);
    const margin = short * 0.10; // ~8–12% of the shorter side
    const carPad = Math.hypot(CAR_LEN / 2, CAR_WID / 2) + 8; // AABB half-diagonal + pad

    const spd = Math.hypot(p.vx, p.vy);
    const counting = race.countdown > 0;
    let zoom, look, dir;
    const fin = world.finish;
    if (fin) {
      // v52 finish: ease in gently on the player's car (closer for a podium, closest for a win)
      // (a bit less on short phone screens so the car and the big text both fit)
      zoom = fin.cele.tier.zoom * clamp(short / 600, 0.7, 1);
      look = 40;
      dir = spd > 80 ? Math.atan2(p.vy, p.vx) : p.angle;
    } else if (counting) {
      // grid framing: slight look-ahead so the car sits lower-middle, then clamp below
      zoom = ZOOM_GRID;
      look = 120;
      dir = p.angle;
    } else {
      const t = clamp(spd / PLAYER_TOP, 0, 1);
      const eased = 1 - (1 - t) * (1 - t);
      zoom = ZOOM_NEAR + (ZOOM_FAR - ZOOM_NEAR) * eased;
      look = 60 + (LOOKAHEAD_MAX - 60) * eased;
      dir = spd > 80 ? Math.atan2(p.vy, p.vx) : p.angle;
      // first moments of the race: don't let look race ahead of the zoom pull-out
      if (race.time < 2500) look = Math.min(look, 140);
    }

    // v53: frame by the layout (js/controls.js): portrait rests the car at ~42% of the height with the look-ahead
    // along its heading; the car must stay inside the view band (below the HUD, above the thumbs) with margins.
    // Landscape rests it at 50%. During the finish the controls are gone, so the whole screen is the band.
    const lay = getLayout();
    const band = !fin && lay && lay.vw === vw && lay.vh === vh ? lay.view : { top: 0, bottom: 1 };
    const ay = fin ? 0.5 : (lay && lay.vw === vw ? lay.carY : 0.5);
    const rect = { l: margin, r: vw - margin, t: Math.max(margin, band.top * vh), b: Math.min(vh - margin, band.bottom * vh) };
    // max look so that car + pad stays in rect when the camera centre sits look·dir ahead of the car's rest point
    const z0 = Math.max(0.05, zoom), dx = Math.cos(dir), dy = Math.sin(dir);
    const restX = vw / 2, restY = ay * vh;
    const room = (d, lo, hi, c) => (d > 1e-3 ? (c - lo) / d : d < -1e-3 ? (hi - c) / -d : Infinity);
    const padPx = carPad * z0;
    const maxLook = Math.max(0, Math.min(room(dx, rect.l + padPx, rect.r - padPx, restX), room(dy, rect.t + padPx, rect.b - padPx, restY)) / z0);
    look = Math.min(look, maxLook);

    const k = 1 - Math.exp(-dt / 180);
    const zk = counting ? k : (1 - Math.exp(-dt / (fin ? 1100 : 400)));
    if (cam.shakeX) { cam.x -= cam.shakeX; cam.y -= cam.shakeY; cam.shakeX = cam.shakeY = 0; } // undo last frame's kick
    // finish: frame the car in the lower part of the screen, under the place text; otherwise rest at ay
    const offY = fin ? (vh * FINISH_TIMING.carScreenY) / Math.max(0.05, cam.zoom) : (0.5 - ay) * vh / Math.max(0.05, cam.zoom);
    cam.x += (p.x + dx * look - cam.x) * k;
    cam.y += (p.y + dy * look + offY - (fin ? 2 * offY : 0) - cam.y) * k;
    cam.zoom += (zoom - cam.zoom) * zk;
    keepPlayerInView(cam, p, vw, vh, rect, carPad);
    if (fin && fin.ms >= FINISH_TIMING.slamMs && fin.ms < FINISH_TIMING.slamMs + FINISH_TIMING.shakeMs) {
      // the place text "lands": a short decaying camera kick
      const e = 1 - (fin.ms - FINISH_TIMING.slamMs) / FINISH_TIMING.shakeMs, a = FINISH_TIMING.shakePx * e * e / Math.max(0.05, cam.zoom);
      cam.shakeX = Math.sin(fin.ms * 0.11) * a; cam.shakeY = Math.cos(fin.ms * 0.093) * a;
      cam.x += cam.shakeX; cam.y += cam.shakeY;
    }
  }

  /** Hard safety: if the smoothed cam still puts any part of the car outside the safe rect, shift it. */
  function keepPlayerInView(cam, p, vw, vh, rect, carPad) {
    const z = Math.max(0.05, cam.zoom);
    const pad = carPad * z;
    const sx = (p.x - cam.x) * z + vw / 2;
    const sy = (p.y - cam.y) * z + vh / 2;
    let dx = 0, dy = 0;
    if (sx - pad < rect.l) dx = (sx - pad - rect.l) / z;
    else if (sx + pad > rect.r) dx = (sx + pad - rect.r) / z;
    if (sy - pad < rect.t) dy = (sy - pad - rect.t) / z;
    else if (sy + pad > rect.b) dy = (sy + pad - rect.b) / z;
    cam.x += dx; cam.y += dy;
  }

  function update(dt) {
    const { track, cars, race, player } = world;
    const flags = input.consumeFlags();
    // no pause once you're home: P / Esc skip the reveal instead (handled by onSkipKey)
    if (flags.pause && race.countdown <= 0 && !race.over && !player.finished) return 'pause';

    if (race.countdown > 0) {
      race.countdown -= dt;
      const c = race.countdown;
      const digit = c > 2800 ? '3' : c > 1800 ? '2' : c > 800 ? '1' : 'GO';
      if (digit !== lastDigit) { lastDigit = digit; sfx(digit === 'GO' ? 'countdownGo' : 'countdown'); }
      if (race.countdown <= 0) { race.countdown = 0; race.goFlash = 700; }
      return;
    }
    if (race.goFlash > 0) race.goFlash -= dt;
    // v52: the world keeps rolling after the race is decided (everyone cruises) until the results take over
    if (race.over) { stepCars(flags, dt, false); stepMissiles(world, dt, onMissileEnd); return; }
    race.time += dt;
    updateBoost(flags, dt);
    updateMissile(flags, dt);
    updatePower(flags, dt);
    const autopilot = world.power.active === 'autopilot';
    player.heavy = autopilot;
    stepCars(flags, dt, autopilot);
    if (autopilot) trackAutopilot(world);
    stepMissiles(world, dt, onMissileEnd);
    if (!player.finished) stepBonus(world, standings().indexOf(player) + 1, (pw) => { sfx('bonus'); world.power.flash = { text: POWER_INFO[pw].name + '!', ms: 1100, kind: 'got' }; });
    emitFeelEvents();
    checkLaps();
    if (race.lapFlashMs > 0) race.lapFlashMs = Math.max(0, race.lapFlashMs - dt);

    const allDone = cars.every((c) => c.finished);
    const timeout = race.time > race.totalLaps * 120000;
    // once the player is home, give the field about one more lap (min 15s) to finish on the longer circuits
    const grace = Math.max(15000, (player.bestLapMs || 0) * 1.1);
    if ((player.finished && race.time - player.finishTime > grace) || allDone || timeout) finishRace();
  }

  /**
   * v54 feel events, once per frame after physics: ONE `wall` event per hit per car (wallHit > 200, 150 ms cooldown,
   * strength = clamp((wallHit − 200)/700, 0, 1)) and ONE `boost` event when a car's boostLevel rises past 0.15 (re-arms
   * below 0.05). The renderer's FX and the audio read the same events. Wall impacts are logged for the verify scripts.
   */
  function emitFeelEvents() {
    const race = world.race, ev = world.fxEvents;
    for (const c of world.cars) {
      if (c.wallHit > WALL.threshold && race.time - (c.lastWallEv ?? -1e9) >= WALL.cooldownMs) {
        c.lastWallEv = race.time;
        const strength = wallStrength(c.wallHit);
        const e = { type: 'wall', car: c, strength, heavy: strength >= WALL.heavy, x: c.x + (c.wallNx || 0) * 20, y: c.y + (c.wallNy || 0) * 20,
          nx: c.wallNx || 0, ny: c.wallNy || 0, vn: c.wallHit, spd: c.wallSpd || 0, ang: c.wallAng || 0, t: race.time };
        ev.push(e);
        if (world.wallLog.length < 2000) world.wallLog.push({ id: c.id, p: c.isPlayer, vn: Math.round(c.wallHit), spd: Math.round(c.wallSpd || 0), angDeg: +((c.wallAng || 0) * 180 / Math.PI).toFixed(1), after: Math.round(Math.hypot(c.vx, c.vy)), t: Math.round(race.time) });
        if (c.isPlayer && !c.finished) sfx('wall', { wallHit: c.wallHit });
      }
      const lvl = c.boostLevel || 0;
      if (!c.boostArmedOff && lvl > 0.15) {
        c.boostArmedOff = true;
        // v54.6: the boost whoosh hook ('boost' is a silent placeholder until the recording lands); never on the frame
        // a DOUBLE BOOST lands (that frame plays 'boostChain' instead)
        if (c.isPlayer && !(world.chain && world.chain.sfxT === race.time)) sfx('boost');
        ev.push({ type: 'boost', car: c, x: c.x, y: c.y, t: race.time, q: c.driftBoostMs > 0 && !(c.isPlayer && world.boost.activeMs > 0) && !(c.padMs > 0) ? c.driftBoostQ : null }); }
      else if (c.boostArmedOff && lvl < 0.05) c.boostArmedOff = false;
    }
    if (ev.length > 64) ev.splice(0, ev.length - 64);
    // engine hook (silent for now): speed vs base 1100, slip, and the 3 nearest rivals
    const p = world.player, lay = getLayout();
    const others = world.cars.filter((c) => c !== p).map((c) => ({ c, d: Math.hypot(c.x - p.x, c.y - p.y) })).sort((a, b) => a.d - b.d).slice(0, 3)
      .map(({ c, d }) => ({ id: c.id, speed01: Math.hypot(c.vx, c.vy) / 1100, boostLevel: c.boostLevel || 0, dist: d,
        screenX: lay ? clamp(0.5 + ((c.x - world.cam.x) * (world.cam.zoom || 1)) / Math.max(1, lay.vw), 0, 1) : 0.5 }));
    engineFrame({ speed01: Math.hypot(p.vx, p.vy) / 1100, boostLevel: p.boostLevel || 0, slip01: slip01(p) }, others);
  }

  /** One physics step for every car. Finished cars (v52) cruise on instead of braking to a stop. */
  function stepCars(flags, dt, autopilot) {
    const { track, cars } = world;
    for (const c of cars) {
      if (c.isPlayer) c.braking = false; // set again by playerControl while BRAKE is held (brake lights)
      let topSave = null;
      let ctl;
      const spinning = stepSpin(c, dt);
      if (c.finished && !spinning) {
        // gentle cruise: top speed eases down to FINISH_TIMING.cruiseMul × top; the player rides the autopilot rail,
        // finished rivals keep their own racing line (and still dodge the cars still racing)
        const el = world.race.time - c.finishTime + (world.race.over ? (c.overMs = (c.overMs || 0) + dt) : 0);
        const cruise = c.top * FINISH_TIMING.cruiseMul;
        if (c.cruiseTop == null) { c.cruiseTop = Math.max(cruise, Math.hypot(c.vx, c.vy)); c.cruiseLat0 = c.lat; }
        c.cruiseTop += (cruise - c.cruiseTop) * (1 - Math.exp(-dt / (FINISH_TIMING.cruiseEaseMs / 2.5)));
        topSave = c.top; c.top = c.cruiseTop;
        ctl = c.isPlayer ? cruiseControl(c, track, dt, el) : stepAI(c, cars, track, dt);
      }
      else if (spinning) ctl = { accel: false, brake: false, steer: 0 }; // hit by a missile: no drive, no steering
      else if (c.isPlayer && autopilot) { ctl = autopilotControl(world, dt); topSave = c.top; c.top = topSave * AUTOPILOT_TOP_MUL; }
      else if (c.isPlayer && world.power.handback) {
        // smooth handback: the +25% top eases away and the steering assist fades out (player input overrides)
        const hb = world.power.handback, w = hb.ms / AUTOPILOT_HANDBACK_MS, e = w * w * (3 - 2 * w);
        ctl = handbackAssist(world, dt, playerControl(flags, dt), e);
        topSave = c.top; c.top = topSave * (1 + (AUTOPILOT_TOP_MUL - 1) * e);
      }
      else if (c.isPlayer) ctl = playerControl(flags, dt);
      else {
        // pad boost: let the AI plan with its boosted top speed while it lasts
        const top = c.top;
        if (c.boostLevel > 0) c.top = top * (1 + BOOST_TOP_MUL * c.boostLevel);
        ctl = stepAI(c, cars, track, dt);
        c.top = top;
      }
      // v54.2: drift handling only under the player's own control (never on autopilot / handback / finish cruise / spin)
      c.drift = !!(c.driftOn && c.isPlayer && !autopilot && !world.power.handback && !c.finished && !spinning);
      rampBoost(c, dt);
      // autopilot rail: its own +25% top; pads don't stack, but v54.3 lets the player's BOOST stack on it (finish cruise: none)
      ctl.boost = ctl.autopilot && !(c.isPlayer && autopilot && !c.finished) ? 0 : (c.boostLevel || 0);
      c.drive = ctl.accel || !!ctl.steer; // last frame's drive input (read by the verify scripts)
      stepCar(c, ctl, dt, track);
      if (topSave != null) c.top = topSave;
      if (c.isPlayer) trackDrift(c, dt, ctl.autopilot || spinning);
      if (!c.finished) stepPads(world, c);
    }
    resolveCarCollisions(cars, track);
  }

  function checkLaps() {
    const { track, cars, race } = world;
    const L = track.length;
    for (const c of cars) {
      if (c.finished) continue;
      const lap = Math.floor(c.dist / L); // completed laps
      if (lap > c.lap) {
        c.lap = lap;
        const lapMs = race.time - c.lapStartMs;
        c.lastLapMs = lapMs;
        if (!c.bestLapMs || lapMs < c.bestLapMs) c.bestLapMs = lapMs;
        c.lapStartMs = race.time;
        if (c.isPlayer) {
          world.boost.charge = 1; // lap crossing refills the boost charge (max 1)
          world.missile.charge = 1; // …and the missile charge (max 1)
          world.power.collected = []; world.power.respawns++; // bonus boxes respawn at the line
          race.lapFlashMs = 2800; race.lapFlashLast = lapMs; race.lapFlashBest = c.bestLapMs;
          if (c.lap < race.totalLaps) sfx('lap');
        }
        if (c.lap >= race.totalLaps) {
          c.finished = true;
          c.finishPlace = ++race.placesAssigned;
          c.finishTime = race.time;
          if (c.isPlayer) startFinish(c.finishPlace);
          else if (world.finish && world.finish.phase === 'results') liveResults(); // a rival home behind the results
        }
      }
    }
  }

  // ------------------------------------------------------------------ v52 finish flow
  // Before v52 the player's car was braked to a halt on the line (finished cars got brake + noReverse), the HUD
  // vanished and nothing was shown until the field finished or the ~1-lap grace ran out (15–20 s of a parked car),
  // and then the whole sim froze (update() returned early once race.over) for 0.8 s before the results.
  // Now: the place reveal slams in at once, the car cruises on the autopilot rail, the rivals race on; after
  // FINISH_TIMING.revealMs (or a tap / key) the results screen comes up and fills in live as the rivals finish.
  function startFinish(place) {
    const p = world.player;
    const aspect = (canvas.clientWidth || innerWidth) / Math.max(1, canvas.clientHeight || innerHeight);
    world.finish = { place, ms: 0, phase: 'reveal', cele: createCelebration(place, aspect), slammed: false, skip: false, final: null, liveKey: '', skippedAtMs: null };
    world.boost.activeMs = 0;
    input.showTouch('fade'); // the car drives itself now; the controls fade out (0.2 s) and the whole screen is the skip target
    const o = ordinal(place);
    if (onReveal) revealView = onReveal({ place, ...o, tier: world.finish.cele.tierName, word: world.finish.cele.tier.word, timeMs: p.finishTime, total: world.cars.length, onSkip: skipReveal });
    window.addEventListener('keydown', onSkipKey, true);
  }
  // keys that drive the car don't skip (you may still be holding them on the line); anything else does
  const DRIVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D', 'Shift']);
  function onSkipKey(e) { if (e.repeat || DRIVE_KEYS.has(e.key)) return; skipReveal('key'); }
  function skipReveal(src = 'tap') {
    const f = world && world.finish;
    if (!f || f.phase !== 'reveal' || f.ms < FINISH_TIMING.skipAfterMs) return false;
    f.skip = true; f.skippedAtMs = f.ms; f.skipSrc = src;
    return true;
  }
  function tickFinish(dt) {
    const f = world.finish;
    f.ms += dt;
    stepCelebration(f.cele, dt, (canvas.clientWidth || innerWidth) / Math.max(1, canvas.clientHeight || innerHeight));
    if (!f.slammed && f.ms >= FINISH_TIMING.slamMs) { f.slammed = true; sfx(f.cele.tier.sound); }
    if (f.phase === 'reveal' && (f.ms >= FINISH_TIMING.revealMs || f.skip)) {
      f.phase = 'out';
      window.removeEventListener('keydown', onSkipKey, true);
      if (revealView) revealView.hide(FINISH_TIMING.outMs);
      f.cele.outAt = f.ms; // the renderers fade the trophy / light out with the text
      later(() => {
        f.phase = 'results';
        if (revealView) { revealView.remove(); revealView = null; }
        if (f.final) deliverFinal(); else liveResults();
      }, FINISH_TIMING.outMs);
    }
  }
  function resultOf(final) {
    const { cars, race, track } = world, p = world.player;
    const order = standings();
    const rows = order.map((c, i) => ({
      place: c.finished ? c.finishPlace : i + 1, id: c.id, name: c.name, isPlayer: c.isPlayer, color: c.color,
      finishTime: c.finished && !c.dnf ? c.finishTime : 0, bestLapMs: c.bestLapMs || 0, dnf: !!c.dnf,
      racing: !c.finished, lap: Math.min(race.totalLaps, Math.max(0, c.lap) + 1)
    }));
    return {
      standings: rows, playerPlace: p.finishPlace, trackName: track.name, trackIndex: race.trackIndex, totalLaps: race.totalLaps,
      totalTime: p.dnf ? 0 : p.finishTime, bestLapMs: p.bestLapMs || 0, final, live: !final, finishedCount: cars.filter((c) => c.finished && !c.dnf).length
    };
  }
  function liveResults() {
    const f = world.finish;
    if (!f || f.phase !== 'results' || f.final) return;
    const r = resultOf(false);
    const key = r.standings.map((s) => s.id + ':' + s.place + ':' + (s.racing ? 'r' : 'f')).join(',');
    if (key === f.liveKey) return;
    f.liveKey = key;
    if (onFinish) onFinish(r);
  }
  function deliverFinal() {
    const f = world.finish;
    if (onFinish) onFinish(f.final);
    later(() => stopRace(), FINISH_TIMING.finalStopMs);
  }

  /** v54.4: follow the player's slide and award the drift boost on a clean exit. */
  function trackDrift(c, dt, off) {
    const s01 = slip01(c);
    let d = c.driftRun;
    if (off || c.finished) { c.driftRun = null; return; }
    if (!d) { if (s01 >= SKID_ON) d = c.driftRun = { ms: 0, ang: 0, lastA: c.angle, capMs: 0, wall: false, peak: 0, hb: false }; else return; }
    d.ms += dt; d.ang += angleDiff(d.lastA, c.angle); d.lastA = c.angle; d.peak = Math.max(d.peak, s01);
    if (c.wallHit > 0 || c.driftHoldMs > 0) d.wall = true;
    if (c.slideCapped) d.capMs += dt;
    if (c.hbHeld) d.hb = true;
    if (s01 >= SKID_OFF) return;
    c.driftRun = null;
    const ang = Math.abs(d.ang), rec = { t: Math.round(world.race.time), ms: Math.round(d.ms), angDeg: Math.round(ang * 180 / Math.PI), wall: d.wall, capMs: Math.round(d.capMs), peak: +d.peak.toFixed(2), hb: d.hb, q: 0, awarded: false };
    if (world.driftLog.length < 500) world.driftLog.push(rec);
    // only a HANDBRAKE drift pays (the Drift handling option's ordinary corner slides would otherwise earn ~10–28 boosts
    // a race and make that option ~0.1–0.9 s/lap faster): DB_NEED_HB
    if (d.wall || d.ms < DB_MIN_MS || ang < DB_MIN_ANG || (DB_NEED_HB && !d.hb)) return;
    const q = clamp(DB_W_DUR * clamp((d.ms - DB_MIN_MS) / (DB_FULL_MS - DB_MIN_MS), 0, 1) + DB_W_ANG * clamp((ang - DB_MIN_ANG) / (DB_FULL_ANG - DB_MIN_ANG), 0, 1)
      + DB_W_SMOOTH * (1 - clamp(3 * d.capMs / d.ms, 0, 1)), 0, 1);
    rec.q = +q.toFixed(2); rec.awarded = true;
    c.driftBoostMs = DB_MS0 + DB_MS1 * q; c.driftBoostLvl = DB_LVL0 + DB_LVL1 * q; c.driftBoostQ = q; c.driftLand = (c.driftLand || 0) + 1;
    world.driftFlash = { text: q >= DB_PERFECT ? 'PERFECT DRIFT' : 'DRIFT BOOST', q, t: world.race.time };
    sfx('driftBoost', { quality: q });
  }

  /** Race order (finished cars first by place, then by distance). */
  function standings() {
    return [...world.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishPlace - b.finishPlace;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.dist - a.dist;
    });
  }

  function playerIsLast() {
    const p = world.player;
    if (p.finished) return false;
    const s = standings();
    return s.indexOf(p) === s.length - 1;
  }

  function updateBoost(flags, dt) {
    const b = world.boost, p = world.player;
    b.last = playerIsLast();
    // v54.3: BOOST works on autopilot too (it used to be ignored there, charge kept — Callum's bug); it stacks on the
    // autopilot's +25 % top exactly like a normal boost stacks on the car's top speed
    if (flags.boost && !p.finished && b.activeMs <= 0) {
      if (b.last) { b.activeMs = BOOST_MS; b.free = true; b.freeUses++; }
      else if (b.charge > 0) { b.charge = 0; b.activeMs = BOOST_MS; b.free = false; b.uses++; }
      if (b.activeMs > 0) { b.lastTriggerMs = world.race.time; b.source = flags.boostSource; b.trig = (b.trig || 0) + 1; } // v54: no press sound — the boostLevel 0.15 edge drives boost FX (+ the whoosh later)
    }
    if (b.activeMs > 0) b.activeMs = Math.max(0, b.activeMs - dt);
    if (p.finished) b.activeMs = 0;
  }

  /** Smoothed boost level per car: lap boost (player) or a boost pad (anyone). */
  function rampBoost(c, dt) {
    if (c.padMs > 0) c.padMs = Math.max(0, c.padMs - dt);
    const lapBoost = c.isPlayer && world.power.active === 'lapboost';
    const onRail = c.isPlayer && world.power.active === 'autopilot'; // autopilot: pads don't stack (no flames either)
    // v54.3: the player's own BOOST does apply on autopilot (pads still don't)
    const other = (c.isPlayer && world.boost.activeMs > 0) || (!onRail && c.padMs > 0);
    const on = other || lapBoost;
    const lvl = c.boostLevel || 0;
    // v50: power-up lap boost burns bright green (and its ramp-out stays green unless a normal boost takes over)
    c.boostGreen = lapBoost || (!!c.boostGreen && !other && lvl > 0);
    let target = on && !c.finished ? 1 : 0;
    if (c.driftBoostMs > 0) { c.driftBoostMs = Math.max(0, c.driftBoostMs - dt); if (!c.finished) target = Math.max(target, c.driftBoostLvl); } // v54.4 drift boost
    // v53 fix: at full level (lvl === target === 1) this used to fall into the ramp-out branch every other frame, so a
    // held boost flickered 1 ↔ 0.96 (0.93 at 30 fps); now it holds steady at the target
    if (c.isPlayer) target = chainBoost(c, dt, target, lapBoost, onRail);
    c.boostLevel = target > lvl ? Math.min(target, lvl + dt / BOOST_RAMP_IN_MS) : target < lvl ? Math.max(target, lvl - dt / BOOST_RAMP_OUT_MS) : lvl;
    if (c.isPlayer) world.boost.level = c.boostLevel;
  }

  /**
   * v54.6 DOUBLE BOOST: detect boost landings this frame (counters, so a pad held for several frames or a timer refresh
   * is not a new landing), chain on the second, extend on the third, and return the player's boost target.
   */
  function chainBoost(c, dt, target, lapBoost, onRail) {
    const b = world.boost, ch = world.chain || (world.chain = newChain());
    const seen = ch.seen;
    const land = [];
    const btnMs = b.activeMs || 0, padMs = onRail ? 0 : c.padMs || 0, driftMs = c.driftBoostMs || 0;
    if ((b.trig || 0) !== seen.trig) land.push(['button', btnMs]);
    if ((c.padLand || 0) !== seen.pad && !onRail) land.push(['pad', padMs]);
    if ((c.driftLand || 0) !== seen.drift) land.push(['drift', driftMs]);
    if (lapBoost && !seen.lap) land.push(['lapboost', 0]);
    seen.trig = b.trig || 0; seen.pad = c.padLand || 0; seen.drift = c.driftLand || 0; seen.lap = lapBoost;
    if (ch.holdMs > 0) ch.holdMs = Math.max(0, ch.holdMs - dt);
    if (ch.rushMs > 0) ch.rushMs = Math.max(0, ch.rushMs - dt);
    if (c.finished) { ch.stacks = 0; ch.holdMs = 0; ch.rushMs = 0; ch.wasOn = false; return target; }
    if (land.length && ch.wasOn) {
      const kinds = land.map((l) => l[0]);
      // time the boost had left before this landing, and the new boost's own time
      const rem = Math.max(ch.holdMs, kinds.includes('button') ? 0 : btnMs, kinds.includes('pad') ? 0 : padMs, kinds.includes('drift') ? 0 : driftMs);
      const add = Math.max(...land.map((l) => l[1]));
      ch.holdMs = Math.min(CHAIN_CAP_MS, Math.max(ch.holdMs, rem + add));
      if (ch.stacks < CHAIN_MAX) {
        ch.stacks = CHAIN_MAX; ch.rushMs = CHAIN_RUSH_MS; ch.count++; ch.landT = world.race.time;
        world.chainFlash = { text: 'DOUBLE BOOST', t: world.race.time };
        world.fxEvents.push({ type: 'boostChain', car: c, x: c.x, y: c.y, t: world.race.time });
        sfx('boostChain'); ch.sfxT = world.race.time; // INSTEAD of 'boost' (emitFeelEvents skips it this frame)
      } else ch.extends++;
      if (ch.log.length < 200) ch.log.push({ t: Math.round(world.race.time), src: kinds.join('+'), stacks: ch.stacks, holdMs: Math.round(ch.holdMs), rushMs: Math.round(ch.rushMs), rem: Math.round(rem), add: Math.round(add) });
    }
    const on = target > 0 || ch.holdMs > 0;
    if (on && ch.stacks === 0) ch.stacks = 1;
    if (!on) { ch.stacks = 0; ch.rushMs = 0; }
    ch.wasOn = on;
    if (ch.holdMs > 0) target = Math.max(target, 1);
    if (ch.rushMs > 0) target = Math.max(target, 1 + (CHAIN_RUSH_LVL - 1) * Math.min(1, ch.rushMs / CHAIN_EASE_MS));
    return target;
  }

  /** Player controls (v53): auto-throttle + BRAKE + steer, with the automatic unstick reverse. */
  function playerControl(flags, dt) {
    const p = world.player, u = world.unstick;
    const spd = Math.hypot(p.vx, p.vy);
    if (u.reverseMs > 0) {
      u.reverseMs -= dt;
      // back away from the wall, turning the nose towards the direction of the road
      const tp = pointAt(world.track, p.sPrev + 200);
      const err = angleDiff(p.angle, Math.atan2(tp.y - p.y, tp.x - p.x));
      return { accel: false, brake: true, steer: -Math.sign(err || 1) };
    }
    // v53 auto-throttle: full gas unless BRAKE is held (the brake fades into a crawl; it never reverses)
    const braking = !!flags.brake;
    p.braking = braking;
    if (!braking && spd < 60) u.stuckMs += dt; else u.stuckMs = 0;
    if (u.stuckMs > UNSTICK_AFTER_MS) { u.stuckMs = 0; u.reverseMs = UNSTICK_REVERSE_MS; u.count++; }
    if (braking) world.brakeStats.ms += dt;
    // v54.4: the BRAKE input is now the HANDBRAKE (rear grip cut, throttle off, modest scrub — js/physics.js HB_*)
    if (braking && !p.hbHeld) { sfx('handbrake'); world.hbStats.presses++; }
    p.hbHeld = braking;
    return { accel: true, brake: false, handbrake: braking, noReverse: true, steer: flags.steer, aimAngle: flags.aimAngle };
  }

  /** v50 power-ups: E / POWER tap activates the held one; runs rocket salvos, lap boost and autopilot timers. */
  function updatePower(flags, dt) {
    const pw = world.power, p = world.player, race = world.race;
    if (pw.flash) { pw.flash.ms -= dt; if (pw.flash.ms <= 0) pw.flash = null; }
    if (flags.power && !p.finished) {
      if (!pw.held) pw.ignored++;
      else if (pw.active) pw.blocked++; // one power-up running at a time: keep holding it
      else activatePower(pw.held, flags.powerSource || 'debug');
    }
    // rocket salvo
    while (pw.rocketQueue.length && pw.rocketQueue[0].at <= race.time) {
      const r = pw.rocketQueue.shift();
      const m = launchMissile(world, r.target && !r.target.finished ? r.target : null, { rocket: true });
      m.rec.salvo = r.salvo; m.rec.idx = r.idx;
      sfx('missile');
    }
    if (pw.active === 'rocket' && !pw.rocketQueue.length) endPower();
    if (pw.active === 'lapboost') {
      pw.activeMs = race.time - pw.startMs;
      if ((p.lap >= pw.untilLap && pw.activeMs >= LAPBOOST_MIN_MS) || p.finished) endPower();
    }
    if (pw.handback) {
      const hb = pw.handback, sp = Math.hypot(p.vx, p.vy);
      if (p.wallHit > 0) { if (!hb.inWall) hb.wall++; hb.inWall = true; } else hb.inWall = false;
      if (dt > 0) { hb.maxDecel = Math.max(hb.maxDecel, (hb.lastSpd - sp) / (dt / 1000)); hb.lastSpd = sp; }
      hb.ms -= dt;
      if (hb.ms <= 0 || p.finished) { const log = pw.apLog[pw.apLog.length - 1]; if (log) Object.assign(log, { hbWall: hb.wall, hbMaxDecel: Math.round(hb.maxDecel), hbEndSpd: Math.round(sp) }); pw.handback = null; }
    }
    if (pw.active === 'autopilot') {
      pw.activeMs = Math.max(0, pw.activeMs - dt);
      if (pw.activeMs <= 0 || p.finished) endPower();
    }
  }

  function activatePower(kind, source) {
    const pw = world.power, p = world.player, race = world.race;
    pw.held = null; pw.active = kind; pw.startMs = race.time;
    const rec = { kind, t: race.time, lap: p.lap, source, spd0: Math.round(Math.hypot(p.vx, p.vy)) };
    pw.activations.push(rec);
    sfx('power');
    if (kind === 'rocket') {
      const tg = rocketTargets(world, standings());
      const salvo = pw.activations.length;
      pw.rocketTargets = tg.map((c) => c.id);
      rec.targets = tg.map((c) => c.id);
      for (let i = 0; i < ROCKET_COUNT; i++) {
        pw.rocketQueue.push({ at: race.time + i * ROCKET_GAP_MS, target: tg.length ? tg[i % tg.length] : null, salvo, idx: i });
      }
      pw.activeMs = ROCKET_COUNT * ROCKET_GAP_MS;
    } else if (kind === 'lapboost') {
      pw.untilLap = p.lap + 1; pw.activeMs = 0;
      const L = world.track.length; rec.untilLap = pw.untilLap; rec.distToLine = Math.round(L - (((p.dist % L) + L) % L));
    } else if (kind === 'autopilot') {
      pw.activeMs = AUTOPILOT_MS; pw.handback = null;
      pw.ap = { entryLat: p.lat, wall: 0, inWall: (p.wallHit || 0) > 0, preWall: (p.wallHit || 0) > 0, devSum: 0, devN: 0, devMax: 0, spdSum: 0, spdMax: 0, rec };
      sfx('autopilot');
    }
  }

  function endPower() {
    const pw = world.power, p = world.player, race = world.race;
    const kind = pw.active;
    const rec = pw.activations[pw.activations.length - 1];
    if (rec) { rec.endT = race.time; rec.durMs = race.time - rec.t; rec.spd1 = Math.round(Math.hypot(p.vx, p.vy)); }
    if (kind === 'autopilot' && pw.ap) {
      const ap = pw.ap;
      pw.apLog.push({ durMs: rec.durMs, wall: ap.wall, devMean: ap.devN ? ap.devSum / ap.devN : 0, devMax: ap.devMax, spdMean: ap.devN ? ap.spdSum / ap.devN : 0, spdMax: ap.spdMax, endT: race.time, endSpd: rec.spd1, wallAt: ap.wallAt || [] });
      pw.ap = null;
      if (!p.finished) { const sp = Math.hypot(p.vx, p.vy); pw.handback = { ms: AUTOPILOT_HANDBACK_MS, wall: 0, inWall: false, maxDecel: 0, lastSpd: sp }; }
      sfx('powerEnd');
    }
    if (kind === 'lapboost') { pw.lapBoostLog.push({ durMs: rec.durMs, endLap: p.lap }); sfx('powerEnd'); }
    pw.active = null; pw.activeMs = 0; pw.untilLap = null;
  }

  /** Debug / verification hooks. */
  const debug = {
    give(kind) { if (POWERS.includes(kind) && world) { world.power.held = kind; return true; } return false; },
    forceNext(kind) { if (world) world.power.forceNext = kind; },
    activate() { if (world) input.state.powerPressed = true; },
    /**
     * v52 verification: line the race up so the player crosses the line ~`ahead` wu from now in `place`.
     * The best (place-1) rivals are marked finished in front; the rest drop to the final lap (or one before it if
     * they'd otherwise beat the player to the line), keeping their positions on track.
     */
    finishAt(place = 1, ahead = 260) {
      if (!world || world.player.finished) return false;
      const { track, cars, race, player: p } = world, L = track.length, N = race.totalLaps;
      if (race.countdown > 0) { race.countdown = 0; race.goFlash = 0; }
      const ai = cars.filter((c) => !c.isPlayer).sort((a, b) => b.dist - a.dist);
      place = clamp(place | 0, 1, cars.length);
      const mod = (d) => ((d % L) + L) % L;
      ai.forEach((c, i) => {
        if (c.finished) return;
        if (i < place - 1) {
          c.finished = true; c.lap = N; c.finishPlace = ++race.placesAssigned; c.finishTime = Math.max(0, race.time - (place - 1 - i) * 900);
          c.dist = N * L + mod(c.dist);
        } else {
          const frac = mod(c.dist), lap = frac > L - ahead - 400 ? N - 2 : N - 1;
          c.lap = Math.max(0, lap); c.dist = c.lap * L + frac;
        }
      });
      const sp = pointAt(track, L - ahead), a = Math.atan2(sp.ty, sp.tx), v = Math.max(500, Math.hypot(p.vx, p.vy));
      p.x = sp.x; p.y = sp.y; p.angle = a; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v; p.spinMs = 0; p.spinVis = 0;
      initCarOnTrack(p, track, N * L - ahead);
      p.lap = N - 1; p.lapStartMs = Math.min(p.lapStartMs, race.time - 1);
      return true;
    },
    skip: () => skipReveal('debug')
  };

  /** Space / left slide on GAS: fire the seeker missile at the car ahead (one per lap). */
  function updateMissile(flags, dt) {
    const ms = world.missile, p = world.player;
    if (ms.flash) { ms.flash.ms -= dt; if (ms.flash.ms <= 0) ms.flash = null; }
    ms.inFlight = world.missiles.some((m) => !m.dead && !m.rocket);
    ms.hasTarget = !p.finished && !!pickTarget(world, standings()); // v54.4: MISSILE shows NO TARGET (dimmed, still tappable) without one
    if (!flags.missile || p.finished || ms.charge < 1) return;
    const target = pickTarget(world, standings());
    if (!target) { ms.refused++; ms.flash = { text: 'NO TARGET', ms: MISSILE_FLASH_MS, kind: 'none' }; sfx('denied'); return; }
    ms.charge = 0; ms.shots++; ms.lastSource = flags.missileSource;
    launchMissile(world, target);
    ms.inFlight = true;
    sfx('missile');
  }

  function onMissileEnd(m) {
    const ms = world.missile;
    if (m.rocket) { // v50 power-up missile: its own tally, doesn't touch the lap-missile HUD
      const pw = world.power;
      pw.rocketLog.push(m.rec);
      const salvo = pw.rocketLog.filter((r) => r.salvo === m.rec.salvo);
      if (m.result === 'hit') sfx('hit'); else sfx('miss');
      if (salvo.length === ROCKET_COUNT) {
        const h = salvo.filter((r) => r.result === 'hit').length;
        pw.flash = { text: `ROCKET ${h}/${ROCKET_COUNT} HIT`, ms: 1600, kind: h ? 'hit' : 'miss' };
      }
      return;
    }
    ms.log.push(m.rec);
    if (m.result === 'hit') { ms.hits++; ms.flash = { text: 'HIT!', ms: MISSILE_FLASH_MS, kind: 'hit' }; sfx('hit'); }
    else { ms.flash = { text: 'MISS', ms: MISSILE_FLASH_MS, kind: 'miss' }; sfx('miss'); }
  }

  function finishRace() {
    const { cars, race } = world;
    if (race.over) return;
    race.over = true;
    const rest = cars.filter((c) => !c.finished).sort((a, b) => b.dist - a.dist);
    for (const c of rest) { c.finishPlace = ++race.placesAssigned; c.finished = true; c.dnf = true; c.finishTime = race.time; }
    const result = resultOf(true);
    try { window.__RAD_LAST_RESULT__ = result; } catch (_) {}
    const f = world.finish;
    if (f) { // the player is home: the results either update in place now or come up when the reveal ends
      f.final = result;
      if (f.phase === 'results') deliverFinal();
    } else later(() => { stopRace(); if (onFinish) onFinish(result); }, 800); // timeout before the player finished
  }

  function getHudInfo() {
    if (!world) return null;
    const { player: p, race, cars } = world;
    const sorted = standings();
    return {
      finished: !!p.finished,
      lap: p.finished ? race.totalLaps : Math.min(Math.max(0, p.lap) + 1, race.totalLaps),
      totalLaps: race.totalLaps,
      place: sorted.indexOf(p) + 1,
      total: cars.length,
      timeMs: race.time,
      lapFlashMs: race.lapFlashMs,
      lapFlashLast: race.lapFlashLast,
      lapFlashBest: race.lapFlashBest
    };
  }

  return {
    startRace, stopRace, fit, getHudInfo, setRenderer,
    get rendererKind() { return renderer ? renderer.kind : null; },
    readPixels: (x, y, w, h) => renderer.readPixels(x, y, w, h), // verification (device px of the race view)
    // Pausing freezes the boost timer (update() does not run); resuming drops any boost
    // request queued while paused so Shift/GAS taps on the pause screen never fire a boost.
    setPaused(v) { paused = v; setAudioPaused(v); if (!v) { last = performance.now(); input.clearBoost && input.clearBoost(); } },
    isPaused: () => paused,
    setOnFinish(fn) { onFinish = fn; },            // fn(result): result.live = provisional (rivals still finishing), result.final = done
    setOnReveal(fn) { onReveal = fn; },            // fn(info) → { hide(ms), remove() }: the big place text (ui.js)
    skipReveal,
    isRunning: () => running,
    getLastHud: () => lastHud,
    setPauseHandler(fn) { onPause = fn; },
    get world() { return world; },
    debug
  };
}
