import { getTrack, buildStartingGrid } from './tracks.js';
import { createCar, CAR_COLORS, AI_NAMES } from './cars.js';
import { stepCar, initCarOnTrack, resolveCarCollisions, BOOST_TOP_MUL, CAR_LEN, CAR_WID } from './physics.js';
import { stepAI } from './ai.js';
import { createRenderer } from './render.js';
import { sfx } from './audio.js';
import { clamp, angleDiff } from './util.js';
import { pointAt } from './tracks.js';
import { newMissileState, pickTarget, launchMissile, stepMissiles, stepSpin, stepPads } from './weapons.js';

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

/** Player auto-unstick (no brake since v48): gas held, near-zero speed for UNSTICK_AFTER_MS → reverse. */
const UNSTICK_AFTER_MS = 1500;
const UNSTICK_REVERSE_MS = 900;
const MISSILE_FLASH_MS = 1400;

function newBoost() {
  return { charge: 1, activeMs: 0, level: 0, free: false, uses: 0, freeUses: 0, lastTriggerMs: -1, source: null };
}

export function createGame(canvas, input) {
  const renderer = createRenderer(canvas);
  let running = false, paused = false, raf = 0, last = 0;
  let world = null, onFinish = null, onPause = null, lastDigit = null;

  function fit() {
    const app = document.getElementById('app');
    renderer.resize(app.clientWidth, app.clientHeight, Math.min(window.devicePixelRatio || 1, 2));
  }
  window.addEventListener('resize', fit);
  fit();

  function startRace({ trackIndex, laps = 3, aiCount = 5, difficulty = 1 }) {
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
      race: { trackIndex, totalLaps: laps, time: 0, countdown: COUNTDOWN_MS, goFlash: 0, over: false, placesAssigned: 0, lapFlashMs: 0, lapFlashLast: 0, lapFlashBest: 0 }
    };
    world.boost = newBoost();
    world.missile = newMissileState();
    world.missiles = [];
    world.fx = [];
    world.unstick = { stuckMs: 0, reverseMs: 0, count: 0 };
    input.clearBoost && input.clearBoost();
    lastDigit = null;
    running = true;
    paused = false;
    last = performance.now();
    input.showTouch(true);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function stopRace() {
    running = false;
    input.showTouch(false);
    cancelAnimationFrame(raf);
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min(50, now - last);
    last = now;
    if (!paused && update(dt) === 'pause') {
      paused = true;
      if (onPause) onPause();
    }
    updateCamera(dt);
    renderer.draw(world);
    if (!world.race.over && !world.player.finished) renderer.drawWeaponHud(world.boost, world.missile, boostAnchor(), world.race.countdown > 0);
    const race = world.race;
    if (race.countdown > 0) {
      const c = race.countdown;
      renderer.drawCountdown(c > 2800 ? '3' : c > 1800 ? '2' : c > 800 ? '1' : 'GO');
    } else if (race.goFlash > 0) {
      renderer.drawCountdown('GO');
    }
    raf = requestAnimationFrame(loop);
  }

  /** Where to draw the boost indicator: just above the GAS button (canvas CSS px). */
  function boostAnchor() {
    const gas = document.getElementById('btn-accel');
    const r = gas && gas.getBoundingClientRect();
    if (!r || !r.width) return null;
    const c = canvas.getBoundingClientRect();
    return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
  }

  /**
   * Chase camera with a keep-in-view clamp (v49).
   * Bug we fixed: the countdown used a fixed 200 wu look-ahead at ZOOM_GRID (0.85). On a short
   * viewport (e.g. mobile landscape height ~390 → half-height ≈ 229 wu) that put the car near or
   * past the edge until it had driven a bit. We now pick look-ahead / zoom as before for the
   * high-speed chase, then clamp look so the player's AABB stays inside the view with ~10% of
   * the shorter screen side as margin, and hard-correct after smoothing if anything slips.
   */
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
    if (counting) {
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

    // Max look that keeps the whole car inside the short viewport axis with the margin.
    // At high speed zoom is small → maxLook is huge → chase cam is unchanged.
    const half = short / 2 - margin;
    const maxLook = Math.max(0, half / Math.max(0.05, zoom) - carPad);
    look = Math.min(look, maxLook);

    const k = 1 - Math.exp(-dt / 180);
    const zk = counting ? k : (1 - Math.exp(-dt / 400));
    cam.x += (p.x + Math.cos(dir) * look - cam.x) * k;
    cam.y += (p.y + Math.sin(dir) * look - cam.y) * k;
    cam.zoom += (zoom - cam.zoom) * zk;
    keepPlayerInView(cam, p, vw, vh, margin, carPad);
  }

  /** Hard safety: if the smoothed cam still puts any part of the car outside the safe rect, shift it. */
  function keepPlayerInView(cam, p, vw, vh, margin, carPad) {
    const z = Math.max(0.05, cam.zoom);
    const pad = carPad * z;
    const sx = (p.x - cam.x) * z + vw / 2;
    const sy = (p.y - cam.y) * z + vh / 2;
    let dx = 0, dy = 0;
    if (sx - pad < margin) dx = (sx - pad - margin) / z;
    else if (sx + pad > vw - margin) dx = (sx + pad - (vw - margin)) / z;
    if (sy - pad < margin) dy = (sy - pad - margin) / z;
    else if (sy + pad > vh - margin) dy = (sy + pad - (vh - margin)) / z;
    cam.x += dx; cam.y += dy;
  }

  function update(dt) {
    const { track, cars, race, player } = world;
    const flags = input.consumeFlags();
    if (flags.pause && race.countdown <= 0 && !race.over) return 'pause';

    if (race.countdown > 0) {
      race.countdown -= dt;
      const c = race.countdown;
      const digit = c > 2800 ? '3' : c > 1800 ? '2' : c > 800 ? '1' : 'GO';
      if (digit !== lastDigit) { lastDigit = digit; sfx(digit === 'GO' ? 'countdownGo' : 'countdown'); }
      if (race.countdown <= 0) { race.countdown = 0; race.goFlash = 700; }
      return;
    }
    if (race.goFlash > 0) race.goFlash -= dt;
    if (race.over) return;
    race.time += dt;
    updateBoost(flags, dt);
    updateMissile(flags, dt);

    for (const c of cars) {
      let ctl;
      const spinning = stepSpin(c, dt);
      if (c.finished) ctl = { accel: false, brake: true, noReverse: true, steer: 0 };
      else if (spinning) ctl = { accel: false, brake: false, steer: 0 }; // hit by a missile: no drive, no steering
      else if (c.isPlayer) ctl = playerControl(flags, dt);
      else {
        // pad boost: let the AI plan with its boosted top speed while it lasts
        const top = c.top;
        if (c.boostLevel > 0) c.top = top * (1 + BOOST_TOP_MUL * c.boostLevel);
        ctl = stepAI(c, cars, track, dt);
        c.top = top;
      }
      rampBoost(c, dt);
      ctl.boost = c.boostLevel || 0;
      c.drive = ctl.accel || !!ctl.steer; // last frame's drive input (read by the verify scripts)
      stepCar(c, ctl, dt, track);
      if (!c.finished) stepPads(world, c);
    }
    resolveCarCollisions(cars, track);
    stepMissiles(world, dt, onMissileEnd);
    if (player.wallHit > 250 && race.time - (race.lastWallSfx || 0) > 300) { race.lastWallSfx = race.time; sfx('wall'); }

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
          race.lapFlashMs = 2800; race.lapFlashLast = lapMs; race.lapFlashBest = c.bestLapMs;
          if (c.lap < race.totalLaps) sfx('lap');
        }
        if (c.lap >= race.totalLaps) {
          c.finished = true;
          c.finishPlace = ++race.placesAssigned;
          c.finishTime = race.time;
          if (c.isPlayer) sfx('finish');
        }
      }
    }
    if (race.lapFlashMs > 0) race.lapFlashMs = Math.max(0, race.lapFlashMs - dt);

    const allDone = cars.every((c) => c.finished);
    const timeout = race.time > race.totalLaps * 120000;
    // once the player is home, give the field about one more lap (min 15s) to finish on the longer circuits
    const grace = Math.max(15000, (player.bestLapMs || 0) * 1.1);
    if ((player.finished && race.time - player.finishTime > grace) || allDone || timeout) finishRace();
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
    if (flags.boost && !p.finished && b.activeMs <= 0) {
      if (b.last) { b.activeMs = BOOST_MS; b.free = true; b.freeUses++; }
      else if (b.charge > 0) { b.charge = 0; b.activeMs = BOOST_MS; b.free = false; b.uses++; }
      if (b.activeMs > 0) { b.lastTriggerMs = world.race.time; b.source = flags.boostSource; sfx('boost'); }
    }
    if (b.activeMs > 0) b.activeMs = Math.max(0, b.activeMs - dt);
    if (p.finished) b.activeMs = 0;
  }

  /** Smoothed boost level per car: lap boost (player) or a boost pad (anyone). */
  function rampBoost(c, dt) {
    if (c.padMs > 0) c.padMs = Math.max(0, c.padMs - dt);
    const on = (c.isPlayer && world.boost.activeMs > 0) || c.padMs > 0;
    const lvl = c.boostLevel || 0;
    const target = on && !c.finished ? 1 : 0;
    c.boostLevel = target > lvl ? Math.min(1, lvl + dt / BOOST_RAMP_IN_MS) : Math.max(0, lvl - dt / BOOST_RAMP_OUT_MS);
    if (c.isPlayer) world.boost.level = c.boostLevel;
  }

  /** Player controls: gas + steer only (no brake since v48), with an automatic unstick reverse. */
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
    if (flags.accel && spd < 60) u.stuckMs += dt; else u.stuckMs = 0;
    if (u.stuckMs > UNSTICK_AFTER_MS) { u.stuckMs = 0; u.reverseMs = UNSTICK_REVERSE_MS; u.count++; }
    return { accel: flags.accel, brake: false, steer: flags.steer, aimAngle: flags.aimAngle };
  }

  /** Space / left slide on GAS: fire the seeker missile at the car ahead (one per lap). */
  function updateMissile(flags, dt) {
    const ms = world.missile, p = world.player;
    if (ms.flash) { ms.flash.ms -= dt; if (ms.flash.ms <= 0) ms.flash = null; }
    ms.inFlight = world.missiles.some((m) => !m.dead);
    if (!flags.missile || p.finished || ms.charge < 1) return;
    const target = pickTarget(world, standings());
    if (!target) { ms.refused++; ms.flash = { text: 'NO TARGET', ms: MISSILE_FLASH_MS, kind: 'none' }; return; }
    ms.charge = 0; ms.shots++; ms.lastSource = flags.missileSource;
    launchMissile(world, target);
    ms.inFlight = true;
    sfx('missile');
  }

  function onMissileEnd(m) {
    const ms = world.missile;
    ms.log.push(m.rec);
    if (m.result === 'hit') { ms.hits++; ms.flash = { text: 'HIT!', ms: MISSILE_FLASH_MS, kind: 'hit' }; sfx('hit'); }
    else { ms.flash = { text: 'MISS', ms: MISSILE_FLASH_MS, kind: 'miss' }; sfx('miss'); }
  }

  function finishRace() {
    const { cars, race, track } = world;
    if (race.over) return;
    race.over = true;
    const rest = cars.filter((c) => !c.finished).sort((a, b) => b.dist - a.dist);
    for (const c of rest) { c.finishPlace = ++race.placesAssigned; c.finished = true; c.dnf = true; }
    const standings = [...cars].sort((a, b) => a.finishPlace - b.finishPlace).map((c) => ({
      place: c.finishPlace, name: c.name, isPlayer: c.isPlayer, color: c.color,
      finishTime: c.dnf ? 0 : c.finishTime, bestLapMs: c.bestLapMs || 0, dnf: !!c.dnf
    }));
    const p = world.player;
    const result = {
      standings, playerPlace: p.finishPlace, trackName: track.name, trackIndex: race.trackIndex,
      totalTime: p.dnf ? 0 : p.finishTime, bestLapMs: p.bestLapMs || 0
    };
    try { window.__RAD_LAST_RESULT__ = result; } catch (_) {}
    setTimeout(() => { stopRace(); if (onFinish) onFinish(result); }, 800);
  }

  function getHudInfo() {
    if (!world) return null;
    const { player: p, race, cars } = world;
    const sorted = standings();
    return {
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
    startRace, stopRace, fit, getHudInfo,
    // Pausing freezes the boost timer (update() does not run); resuming drops any boost
    // request queued while paused so Shift/GAS taps on the pause screen never fire a boost.
    setPaused(v) { paused = v; if (!v) { last = performance.now(); input.clearBoost && input.clearBoost(); } },
    isPaused: () => paused,
    setOnFinish(fn) { onFinish = fn; },
    isRunning: () => running,
    setPauseHandler(fn) { onPause = fn; },
    get world() { return world; }
  };
}
