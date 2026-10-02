import { getTrack, buildStartingGrid } from './tracks.js';
import { createCar, CAR_COLORS, AI_NAMES } from './cars.js';
import { stepCar, initCarOnTrack, resolveCarCollisions, BOOST_TOP_MUL, CAR_LEN, CAR_WID } from './physics.js';
import { stepAI } from './ai.js';
import { createRenderer } from './render.js';
import { sfx } from './audio.js';
import { clamp, angleDiff } from './util.js';
import { pointAt } from './tracks.js';
import { newMissileState, pickTarget, launchMissile, stepMissiles, stepSpin, stepPads } from './weapons.js';
import { newPowerState, stepBonus, rocketTargets, autopilotControl, trackAutopilot, POWER_INFO, POWERS, ROCKET_COUNT, ROCKET_GAP_MS, LAPBOOST_MIN_MS, AUTOPILOT_MS, AUTOPILOT_TOP_MUL, AUTOPILOT_HANDBACK_MS, handbackAssist } from './powerups.js';

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
  // v51: main.js installs the PixiJS (WebGL) renderer when it initialises, or the Canvas 2D one (?canvas=1 / no WebGL).
  let renderer = null;
  let running = false, paused = false, raf = 0, last = 0;
  let world = null, onFinish = null, onPause = null, lastDigit = null;

  function fit() {
    if (!renderer) return;
    const app = document.getElementById('app');
    renderer.resize(app.clientWidth, app.clientHeight, Math.min(window.devicePixelRatio || 1, 2));
  }
  window.addEventListener('resize', fit);
  function setRenderer(r) { renderer = r; fit(); }

  function startRace({ trackIndex, laps = 3, aiCount = 5, difficulty = 1 }) {
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
    world.power = newPowerState();
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
    const showHud = !world.race.over && !world.player.finished;
    const hud = showHud ? renderer.drawWeaponHud(world.boost, world.missile, boostAnchor(), world.race.countdown > 0) : null;
    lastHud = hud;
    updatePowerButton(hud);
    const race = world.race;
    if (race.countdown > 0) {
      const c = race.countdown;
      renderer.drawCountdown(c > 2800 ? '3' : c > 1800 ? '2' : c > 800 ? '1' : 'GO');
    } else if (race.goFlash > 0) {
      renderer.drawCountdown('GO');
    }
    raf = requestAnimationFrame(loop);
  }

  /** v50 POWER slot: a tappable DOM panel placed left of the MISSILE panel (touch + mouse; E on keyboard). */
  const ICONS = {
    rocket: '<svg viewBox="0 0 24 24"><path d="M12 2c3 2.2 4.6 6 4.6 10l-1.8 3H9.2l-1.8-3C7.4 8 9 4.2 12 2z"/><path d="M9 14.5 5.5 19l4-1.2zM15 14.5l3.5 4.5-4-1.2z"/><circle cx="12" cy="9" r="1.7" fill="#0a0c12"/></svg>',
    lapboost: '<svg viewBox="0 0 24 24"><path d="M12.5 2c.8 3.6 5 5.8 5 11a5.5 5.5 0 0 1-11 0c0-3 1.8-4.4 2.2-7.2 1 1.9 1.9 2.6 3 3.4.4-2.6-.4-4.9.8-7.2z"/></svg>',
    autopilot: '<svg viewBox="0 0 24 24" style="fill:none;stroke:currentColor;stroke-width:2.6"><circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M3.6 11h6.2M14.2 11h6.2M12 14.3v6.3"/></svg>',
    none: '<svg viewBox="0 0 24 24"><text x="12" y="18" text-anchor="middle" font-size="17" font-weight="700" fill="currentColor">?</text></svg>'
  };
  let powerKey = '';
  let lastHud = null; // last drawn BOOST / MISSILE panel boxes (canvas CSS px), for layout checks
  function updatePowerButton(hud) {
    const el = document.getElementById('btn-power');
    if (!el) return;
    const pw = world.power;
    if (!hud || !hud.missile || !running) { if (powerKey !== 'hidden') { el.style.display = 'none'; powerKey = 'hidden'; } return; }
    const m = hud.missile;
    const w = m.w, x = Math.max(6, m.x - w - 8);
    let kind = pw.active || pw.held || 'none', name, sub, state, frac = null;
    if (pw.active) {
      state = 'active'; name = POWER_INFO[pw.active].name;
      if (pw.active === 'autopilot') { sub = (pw.activeMs / 1000).toFixed(1) + ' s'; frac = pw.activeMs / AUTOPILOT_MS; }
      else if (pw.active === 'lapboost') { sub = 'until the line'; frac = 1; }
      else { sub = 'FIRING ' + Math.min(ROCKET_COUNT, ROCKET_COUNT - pw.rocketQueue.length + 1) + '/' + ROCKET_COUNT; }
    } else if (pw.flash) {
      state = 'flash'; name = pw.flash.text; sub = pw.flash.kind === 'got' ? 'tap · E to use' : '';
      kind = pw.held || (pw.flash.text.startsWith('ROCKET') ? 'rocket' : kind);
    } else if (pw.held) {
      state = 'held'; name = POWER_INFO[pw.held].name; sub = 'tap · E';
    } else { state = 'empty'; name = 'POWER'; sub = 'grab a ? box'; }
    const key = [kind, state, name, sub, pw.active && pw.held ? pw.held : '', frac == null ? '' : frac.toFixed(2), x, m.y, w, m.h].join('|');
    if (key === powerKey) return;
    powerKey = key;
    el.style.display = 'flex';
    el.style.left = x + 'px'; el.style.top = m.y + 'px'; el.style.width = w + 'px'; el.style.height = m.h + 'px';
    el.dataset.state = state; el.dataset.kind = kind;
    el.classList.toggle('has-next', !!(pw.active && pw.held));
    el.style.setProperty('--pw', kind === 'none' ? '#7c8494' : POWER_INFO[kind].color);
    el.innerHTML = `<span class="pw-icon">${ICONS[kind]}</span><span class="pw-text"><span class="pw-name">${name}</span><span class="pw-sub">${sub}</span></span>` +
      (frac != null ? `<span class="pw-bar"><span style="width:${(frac * 100).toFixed(0)}%"></span></span>` : '') +
      (pw.active && pw.held ? `<span class="pw-next" style="color:${POWER_INFO[pw.held].color}" title="next: ${POWER_INFO[pw.held].name}">${ICONS[pw.held]}</span>` : ''); // held one waiting
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
    updatePower(flags, dt);
    const autopilot = world.power.active === 'autopilot';
    player.heavy = autopilot;

    for (const c of cars) {
      let topSave = null;
      let ctl;
      const spinning = stepSpin(c, dt);
      if (c.finished) ctl = { accel: false, brake: true, noReverse: true, steer: 0 };
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
      rampBoost(c, dt);
      ctl.boost = ctl.autopilot ? 0 : (c.boostLevel || 0); // autopilot: its own +25% top, pads/boost don't stack
      c.drive = ctl.accel || !!ctl.steer; // last frame's drive input (read by the verify scripts)
      stepCar(c, ctl, dt, track);
      if (topSave != null) c.top = topSave;
      if (!c.finished) stepPads(world, c);
    }
    resolveCarCollisions(cars, track);
    if (autopilot) trackAutopilot(world);
    stepMissiles(world, dt, onMissileEnd);
    stepBonus(world, standings().indexOf(player) + 1, (pw) => { sfx('bonus'); world.power.flash = { text: POWER_INFO[pw].name + '!', ms: 1100, kind: 'got' }; });
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
          world.power.collected = []; world.power.respawns++; // bonus boxes respawn at the line
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
    // autopilot already runs its own +25 % top: a boost press is ignored (charge kept)
    if (flags.boost && !p.finished && b.activeMs <= 0 && world.power.active !== 'autopilot') {
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
    const lapBoost = c.isPlayer && world.power.active === 'lapboost';
    const onRail = c.isPlayer && world.power.active === 'autopilot'; // autopilot: pads don't stack (no flames either)
    const other = !onRail && ((c.isPlayer && world.boost.activeMs > 0) || c.padMs > 0);
    const on = other || lapBoost;
    const lvl = c.boostLevel || 0;
    // v50: power-up lap boost burns bright green (and its ramp-out stays green unless a normal boost takes over)
    c.boostGreen = lapBoost || (!!c.boostGreen && !other && lvl > 0);
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
    activate() { if (world) input.state.powerPressed = true; }
  };

  /** Space / left slide on GAS: fire the seeker missile at the car ahead (one per lap). */
  function updateMissile(flags, dt) {
    const ms = world.missile, p = world.player;
    if (ms.flash) { ms.flash.ms -= dt; if (ms.flash.ms <= 0) ms.flash = null; }
    ms.inFlight = world.missiles.some((m) => !m.dead && !m.rocket);
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
    const { cars, race, track } = world;
    if (race.over) return;
    race.over = true;
    const rest = cars.filter((c) => !c.finished).sort((a, b) => b.dist - a.dist);
    for (const c of rest) { c.finishPlace = ++race.placesAssigned; c.finished = true; c.dnf = true; }
    const standings = [...cars].sort((a, b) => a.finishPlace - b.finishPlace).map((c) => ({
      place: c.finishPlace, id: c.id, name: c.name, isPlayer: c.isPlayer, color: c.color,
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
    startRace, stopRace, fit, getHudInfo, setRenderer,
    get rendererKind() { return renderer ? renderer.kind : null; },
    readPixels: (x, y, w, h) => renderer.readPixels(x, y, w, h), // verification (device px of the race view)
    // Pausing freezes the boost timer (update() does not run); resuming drops any boost
    // request queued while paused so Shift/GAS taps on the pause screen never fire a boost.
    setPaused(v) { paused = v; if (!v) { last = performance.now(); input.clearBoost && input.clearBoost(); } },
    isPaused: () => paused,
    setOnFinish(fn) { onFinish = fn; },
    isRunning: () => running,
    getLastHud: () => lastHud,
    setPauseHandler(fn) { onPause = fn; },
    get world() { return world; },
    debug
  };
}
