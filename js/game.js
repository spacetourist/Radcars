import { getTrack, buildStartingGrid } from './tracks.js';
import { createCar, CAR_COLORS, AI_NAMES } from './cars.js';
import { stepCar, initCarOnTrack, resolveCarCollisions } from './physics.js';
import { stepAI } from './ai.js';
import { createRenderer } from './render.js';
import { sfx } from './audio.js';
import { clamp } from './util.js';

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
    const race = world.race;
    if (race.countdown > 0) {
      const c = race.countdown;
      renderer.drawCountdown(c > 2800 ? '3' : c > 1800 ? '2' : c > 800 ? '1' : 'GO');
    } else if (race.goFlash > 0) {
      renderer.drawCountdown('GO');
    }
    raf = requestAnimationFrame(loop);
  }

  function updateCamera(dt) {
    const { player: p, cam, race } = world;
    const ov = window.__RAD_CAM__; // verification hook: fixed camera {x, y, zoom}
    if (ov) { cam.x = ov.x; cam.y = ov.y; cam.zoom = ov.zoom; return; }
    const k = 1 - Math.exp(-dt / 180);
    if (race.countdown > 0) {
      cam.zoom += (ZOOM_GRID - cam.zoom) * k;
      cam.x += (p.x + Math.cos(p.angle) * 200 - cam.x) * k;
      cam.y += (p.y + Math.sin(p.angle) * 200 - cam.y) * k;
      return;
    }
    const spd = Math.hypot(p.vx, p.vy);
    const t = clamp(spd / PLAYER_TOP, 0, 1);
    const eased = 1 - (1 - t) * (1 - t);
    const zoom = ZOOM_NEAR + (ZOOM_FAR - ZOOM_NEAR) * eased;
    const look = 60 + (LOOKAHEAD_MAX - 60) * eased;
    // look ahead along the direction of travel (falls back to heading when slow)
    const dir = spd > 80 ? Math.atan2(p.vy, p.vx) : p.angle;
    cam.x += (p.x + Math.cos(dir) * look - cam.x) * k;
    cam.y += (p.y + Math.sin(dir) * look - cam.y) * k;
    cam.zoom += (zoom - cam.zoom) * (1 - Math.exp(-dt / 400));
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

    for (const c of cars) {
      let ctl;
      if (c.finished) ctl = { accel: false, brake: true, noReverse: true, steer: 0 };
      else if (c.isPlayer) ctl = { accel: flags.accel, brake: flags.brake, steer: flags.steer, aimAngle: flags.aimAngle };
      else ctl = stepAI(c, cars, track, dt);
      stepCar(c, ctl, dt, track);
    }
    resolveCarCollisions(cars, track);
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
    const sorted = [...cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishPlace - b.finishPlace;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.dist - a.dist;
    });
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
    setPaused(v) { paused = v; if (!v) last = performance.now(); },
    isPaused: () => paused,
    setOnFinish(fn) { onFinish = fn; },
    isRunning: () => running,
    setPauseHandler(fn) { onPause = fn; },
    get world() { return world; }
  };
}
