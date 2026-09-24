import { getTrack, buildStartingGrid } from './tracks.js';
import { createCar, CAR_COLORS, AI_NAMES, updateCheckpoints, raceProgress, syncCarFromSave } from './cars.js';
import { getDifficulty, clampDifficultyIndex } from './difficulty.js';
import { stepCar, triggerNitro } from './physics.js';
import { createWeaponsState, tryFire, stepWeapons, cycleWeapon } from './weapons.js';
import { stepAI } from './ai.js';
import { createRenderer } from './render.js';
import { isPixiFlagOn, createPixiRenderer } from './pixiRender.js';
import { sfx } from './audio.js';
import { placePrize, persistSave } from './career.js';
import { clamp } from './util.js';

/** Camera: stay open after GO; speed pulls further out (v43 long-chase).
 *  Near must stay close to grid zoom — a high NEAR made race start zoom *in*
 *  and never feel like it zoomed out again.
 *  ZOOM_FAR ~half of v42 (0.48→0.24) ⇒ ~2× world visible at pace.
 *  Look-ahead raised so the player sits rear-of-travel with road ahead. */
const ZOOM_NEAR = 1.02;   // crawl / just after GO (barely tighter than grid)
const ZOOM_FAR = 0.24;    // pace — ~2× prior pull-out (was 0.48)
const ZOOM_GRID = 0.88;
const ZOOM_LERP_RACE = 0.18;
const ZOOM_LERP_GRID = 0.08;
const LOOKAHEAD_MIN = 70;
const LOOKAHEAD_MAX = 780; // rear-bias chase; ≈2.8× v42 so far-zoom still frames car aft
/** Full zoom-out by modest race pace (|v| often only ~0.8–1.4). */
const SPD_ZOOM_LO = 0.05;
const SPD_ZOOM_HI = 0.65;

export function createGame(canvas, input) {
  const renderer = createRenderer(canvas);
  const pixiEnabled = isPixiFlagOn();
  let pixi = null;
  let pixiReady = false;
  if (pixiEnabled) {
    createPixiRenderer({ canvas, host: document.getElementById('app') })
      .then((p) => { pixi = p; pixiReady = true; try { window.__RAD_PIXI_READY__ = true; } catch (_) {} })
      .catch((err) => { console.warn('[radcars] Pixi init failed — Canvas fallback', err); });
  }

  let running = false;
  let paused = false;
  let raf = 0;
  let last = 0;
  let world = null;
  let onFinish = null;
  let onPause = null;
  let lastCountdownDigit = null;

  let _fitW = 0, _fitH = 0, _fitDpr = 0;
  function fit() {
    const app = document.getElementById('app');
    const w = app.clientWidth;
    const h = app.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (w === _fitW && h === _fitH && dpr === _fitDpr) return;
    _fitW = w; _fitH = h; _fitDpr = dpr;
    renderer.resize(w, h, dpr);
    if (pixiReady && pixi) pixi.resize(w, h, dpr);
  }

  window.addEventListener('resize', fit);
  fit();

  function startRace({ trackIndex, save, mode, laps, aiCount }) {
    const track = getTrack(trackIndex);
    const totalLaps = laps || track.lapsDefault || 3;
    const nAI = clamp(aiCount ?? 5, 3, 7);
    const synced = syncCarFromSave(save.car);

    const grid = buildStartingGrid(track, nAI + 1);
    // Ensure every slot shares the same heading (track start direction)
    const startHeading = grid[0].angle;
    for (const g of grid) g.angle = startHeading;

    const cars = [];
    const sp0 = grid[0];
    cars.push(createCar({
      id: 0,
      name: 'You',
      color: CAR_COLORS[0],
      isPlayer: true,
      x: sp0.x,
      y: sp0.y,
      angle: startHeading,
      ...synced,
      nitro: synced.nitro,
      nitroMax: synced.nitroMax
    }));
    // Re-assert after spread in case anything odd lands on the object
    cars[0].angle = startHeading;
    cars[0].x = sp0.x;
    cars[0].y = sp0.y;
    cars[0].nitroCharges = synced.nitro;
    cars[0].nitroMax = synced.nitroMax;

    for (let i = 0; i < nAI; i++) {
      const sp = grid[i + 1] || {
        x: sp0.x - (i + 1) * 44,
        y: sp0.y + ((i % 2) ? 28 : -28),
        angle: startHeading
      };
      const trackDiff = track.difficulty;
      const diff = getDifficulty(clampDifficultyIndex(save?.options?.difficulty));
      const engine = Math.min(4, Math.max(0, Math.floor((trackDiff + Math.random() * 2) * diff.engineMul)));
      const armour = Math.max(0, Math.floor(Math.random() * trackDiff * diff.armourMul));
      const ai = createCar({
        id: i + 1,
        name: AI_NAMES[i % AI_NAMES.length],
        color: CAR_COLORS[(i + 1) % CAR_COLORS.length],
        x: sp.x,
        y: sp.y,
        angle: startHeading,
        hp: 10000,
        maxHp: 10000,
        engine,
        armour,
        ram: Math.floor(Math.random() * 2 * diff.aggroMul),
        nitro: Math.random() < (0.5 * diff.nitroMul) ? 2 : 1,
        nitroMax: 2,
        weapons: {
          front: Math.max(2, Math.round((6 + trackDiff * 2) * diff.weaponMul)),
          rear: Math.max(1, Math.round((3 + trackDiff) * diff.weaponMul)),
          homing: Math.max(0, Math.round((trackDiff > 1 ? 2 : 1) * diff.weaponMul)),
          mine: Math.max(0, Math.round(2 * diff.weaponMul)),
          super: (trackDiff > 2 && diff.weaponMul > 0.85) ? 1 : 0
        },
        aiAggro: (0.4 + Math.random() * 0.5) * diff.aggroMul,
        aiSkill: Math.min(0.98, (0.45 + Math.random() * 0.4 + trackDiff * 0.05) * diff.skillMul),
        aiDiff: diff
      });
      ai.angle = startHeading;
      ai.nitroCharges = ai.nitroCharges ?? ai.nitro ?? 1;
      let best = 0, bestD = Infinity;
      for (let w = 0; w < track.line.length; w++) {
        const dx = track.line[w].x - ai.x, dy = track.line[w].y - ai.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = w; }
      }
      ai.aiWp = best;
      cars.push(ai);
    }

    // Force every car to the shared grid heading (player + AI)
    for (let i = 0; i < cars.length; i++) {
      const g = grid[i];
      if (g) {
        cars[i].angle = g.angle;
        cars[i].x = g.x;
        cars[i].y = g.y;
      } else {
        cars[i].angle = startHeading;
      }
    }

    {
      let best = 0, bestD = Infinity;
      for (let w = 0; w < track.line.length; w++) {
        const dx = track.line[w].x - cars[0].x, dy = track.line[w].y - cars[0].y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = w; }
      }
      cars[0].aiWp = best;
    }

    // Past S/F gate already — next CP is ahead; lap completes when returning to CP0
    for (const c of cars) {
      c.checkpoint = 1;
      c._lapStartMs = 0;
      c.lastLapMs = 0;
      c.bestLapMs = 0;
      c.progress = raceProgress(c, track);
    }

    // Grid camera centre
    let gx = 0, gy = 0;
    for (const c of cars) { gx += c.x; gy += c.y; }
    gx /= cars.length;
    gy /= cars.length;

    world = {
      track,
      cars,
      weapons: createWeaponsState(),
      cam: { x: gx, y: gy, zoom: ZOOM_GRID },
      gridCam: { x: gx, y: gy },
      player: cars[0],
      race: {
        mode,
        trackIndex,
        totalLaps,
        time: 0,
        countdown: 3800, // 3-2-1 then GO flash
        goFlash: 0,
        finishedCount: 0,
        over: false,
        placesAssigned: 0,
        live: false,
        lapFlashMs: 0,
        lapFlashLast: 0,
        lapFlashBest: 0
      },
      dt: 16,
      save
    };

    lastCountdownDigit = null;
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
    let dt = now - last;
    last = now;
    if (dt > 50) dt = 50;
    world.dt = dt;

    if (!paused) {
      const pauseHit = update(dt);
      if (pauseHit === 'pause') {
        paused = true;
        if (onPause) onPause();
      }
    }

    updateCamera(dt);

    const usePixi = pixiEnabled && pixiReady && pixi;
    if (usePixi) {
      pixi.draw(world);
    } else {
      renderer.draw(world);
    }

    const race = world.race;
    if (race.countdown > 0 || race.goFlash > 0) {
      let text = '';
      if (race.countdown > 0) {
        const c = race.countdown;
        text = c > 2800 ? '3' : c > 1800 ? '2' : c > 800 ? '1' : 'GO';
      } else if (race.goFlash > 0) {
        text = 'GO';
      }
      if (text) {
        if (usePixi) {
          pixi.drawCountdown(text, {
            flash: text === 'GO',
            t: race.goFlash || race.countdown
          });
        } else {
          renderer.drawCountdown(renderer.ctx, text, canvas.clientWidth, canvas.clientHeight, {
            flash: text === 'GO',
            t: race.goFlash || race.countdown
          });
        }
      }
    } else if (usePixi) {
      pixi.drawCountdown(null);
    }

    raf = requestAnimationFrame(loop);
  }

  function updateCamera(dt) {
    const p = world.player;
    const race = world.race;
    // Capture / review freeze — keep cam where identity shot placed it
    if (world.__shotFreeze) return;
    // Fixed wider grid view during 3-2-1; after GO hand off to player + speed zoom
    if (race.countdown > 0) {
      const g = world.gridCam;
      world.cam.x += (g.x - world.cam.x) * 0.12;
      world.cam.y += (g.y - world.cam.y) * 0.12;
      world.cam.zoom += (ZOOM_GRID - world.cam.zoom) * ZOOM_LERP_GRID;
      return;
    }

    // Speed → zoom OUT + look ahead. Low HI so any real pace opens the frame.
    const spd = Math.hypot(p.vx, p.vy);
    const tSpd = clamp((spd - SPD_ZOOM_LO) / (SPD_ZOOM_HI - SPD_ZOOM_LO), 0, 1);
    // Ease-out: early speed already pulls back hard
    const eased = 1 - (1 - tSpd) * (1 - tSpd);
    let targetZoom = ZOOM_NEAR + (ZOOM_FAR - ZOOM_NEAR) * eased;
    if (p.nitroTimer > 0) {
      targetZoom = Math.max(ZOOM_FAR * 0.9, targetZoom - 0.06);
    }
    targetZoom = clamp(targetZoom, ZOOM_FAR * 0.9, ZOOM_NEAR);

    const look = LOOKAHEAD_MIN + (LOOKAHEAD_MAX - LOOKAHEAD_MIN) * eased;
    const tx = p.x + Math.cos(p.angle) * look;
    const ty = p.y + Math.sin(p.angle) * look;
    world.cam.x += (tx - world.cam.x) * 0.18;
    world.cam.y += (ty - world.cam.y) * 0.18;
    world.cam.zoom += (targetZoom - world.cam.zoom) * ZOOM_LERP_RACE;
  }

  function update(dt) {
    const { track, cars, weapons, race, save } = world;
    const flags = input.consumeFlags();

    if (flags.pause && race.live && !race.over) {
      paused = true;
      return 'pause';
    }

    // Countdown: cars frozen
    if (race.countdown > 0) {
      race.countdown -= dt;
      const c = race.countdown;
      const digit = c > 2800 ? '3' : c > 1800 ? '2' : c > 800 ? '1' : (c > 0 ? 'GO' : 'GO');
      if (digit !== lastCountdownDigit) {
        lastCountdownDigit = digit;
        if (digit === 'GO') sfx('countdownGo');
        else sfx('countdown');
      }
      if (race.countdown <= 0) {
        race.countdown = 0;
        race.goFlash = 700;
        race.live = true;
      }
      // Keep velocities zero
      for (const car of cars) {
        car.vx = 0;
        car.vy = 0;
      }
      return;
    }

    if (race.goFlash > 0) {
      race.goFlash -= dt;
    }

    if (race.over) return;

    race.time += dt;

    const player = world.player;
    if (!player.dead && !player.finished) {
      if (flags.weaponCycle) cycleWeapon(player, flags.weaponCycle);
      if (flags.nitro) {
        if (triggerNitro(player)) sfx('nitro');
      }
      if (flags.fire) {
        const res = tryFire(player, weapons, cars, track);
        if (res) sfx(res.sfx);
      }
      player.fireCooldown = Math.max(0, player.fireCooldown - dt);
      stepCar(player, {
        steer: flags.steer,
        aimAngle: flags.aimAngle,
        accel: flags.accel || input.state.accel,
        brake: flags.brake || input.state.brake
      }, dt, track, cars);
    } else if (!player.finished && player.dead) {
      stepCar(player, { steer: 0, accel: false, brake: false }, dt, track, cars);
    }

    for (const c of cars) {
      if (c.isPlayer) continue;
      if (c.finished || c.dead) {
        stepCar(c, { steer: 0, accel: false, brake: true }, dt, track, cars);
        continue;
      }
      c.fireCooldown = Math.max(0, c.fireCooldown - dt);
      const aiIn = stepAI(c, cars, track, weapons, dt, sfx);
      stepCar(c, aiIn, dt, track, cars);
    }

    for (const c of cars) {
      if (c._wallHit > 0.8) { if (c.isPlayer) sfx('wall'); c._wallHit = 0; }
      if (c._carHit > 0.6) { if (c.isPlayer) sfx('hit'); c._carHit = 0; }
    }

    stepWeapons(weapons, cars, track, dt, (kind, x, y) => {
      sfx(kind);
      renderer.addBoom(x, y);
    });

    for (const c of cars) {
      updateCheckpoints(c, track);
      if (c._justLapped) {
        c._justLapped = false;
        const lapMs = Math.max(1, race.time - (c._lapStartMs || 0));
        c.lastLapMs = lapMs;
        if (!c.bestLapMs || lapMs < c.bestLapMs) c.bestLapMs = lapMs;
        c._lapStartMs = race.time;
        if (c.isPlayer) {
          race.lapFlashMs = 2800;
          race.lapFlashLast = lapMs;
          race.lapFlashBest = c.bestLapMs;
          if (c.lap < race.totalLaps) sfx('lap');
        }
      }
      if (!c.finished && c.lap >= race.totalLaps) {
        c.finished = true;
        race.placesAssigned++;
        c.finishPlace = race.placesAssigned;
        c.finishTime = race.time;
        if (c.isPlayer) sfx('finish');
      }
    }
    if (race.lapFlashMs > 0) race.lapFlashMs = Math.max(0, race.lapFlashMs - dt);

    const allDone = cars.every((c) => c.finished || c.dead);
    const timeout = race.time > race.totalLaps * 120000;
    if ((player.finished && (race.placesAssigned >= Math.ceil(cars.length / 2) || race.time - player.finishTime > 5000))
      || allDone || timeout || (player.dead && race.time > 15000)) {
      finishRace();
    }
  }

  function finishRace() {
    if (world.race.over) return;
    world.race.over = true;
    const { cars, race, save, track } = world;

    const remaining = cars.filter((c) => !c.finishPlace).sort((a, b) => b.progress - a.progress);
    for (const c of remaining) {
      race.placesAssigned++;
      c.finishPlace = race.placesAssigned;
      c.finishTime = race.time;
      c.finished = true;
    }

    const standings = [...cars].sort((a, b) => a.finishPlace - b.finishPlace).map((c) => {
      const prize = c.isPlayer ? placePrize(c.finishPlace, race.trackIndex) : 0;
      return {
        place: c.finishPlace,
        name: c.name,
        isPlayer: c.isPlayer,
        dead: c.dead,
        prize,
        finishTime: c.finishTime,
        bestLapMs: c.bestLapMs || 0
      };
    });

    const player = cars.find((c) => c.isPlayer);
    const playerPlace = player.finishPlace;

    save.car.hp = Math.max(0, Math.round(player.hp));
    save.car.weapons = { ...player.weapons };
    save.car.nitro = player.nitroCharges;
    save.car.selectedWeapon = player.selectedWeapon;
    const prize = placePrize(playerPlace, race.trackIndex);
    save.cash += prize;

    if (race.mode === 'career') {
      if (playerPlace === 1) save.careerWins++;
      if (playerPlace <= 3) {
        if (race.trackIndex >= save.careerTrack) {
          save.careerTrack = Math.min(TRACKS_LEN(), race.trackIndex + 1);
          save.unlockedTracks = Math.max(save.unlockedTracks, save.careerTrack + 1);
        }
      }
      save.unlockedTracks = Math.max(save.unlockedTracks, race.trackIndex + 1);
      if (playerPlace <= 3) {
        save.unlockedTracks = Math.max(save.unlockedTracks, race.trackIndex + 2);
      }
    }

    persistSave(save);

    const result = {
      standings,
      playerPlace,
      trackName: track.name,
      prize,
      mode: race.mode,
      totalTime: player.finishTime || race.time,
      bestLapMs: player.bestLapMs || 0
    };

    setTimeout(() => {
      stopRace();
      if (onFinish) onFinish(result);
    }, 800);
  }

  function TRACKS_LEN() {
    return 4;
  }

  function getHudInfo() {
    if (!world) return null;
    const p = world.player;
    const sorted = [...world.cars].sort((a, b) => {
      if (a.finished && b.finished) return a.finishPlace - b.finishPlace;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    const place = sorted.findIndex((c) => c.id === p.id) + 1;
    const t = world.race.time / 1000;
    const mm = Math.floor(t / 60);
    const ss = Math.floor(t % 60).toString().padStart(2, '0');
    const cs = Math.floor((t % 1) * 100).toString().padStart(2, '0');
    const displayLap = p.finished
      ? world.race.totalLaps
      : Math.min(p.lap + 1, world.race.totalLaps);
    return {
      lap: displayLap,
      totalLaps: world.race.totalLaps,
      place,
      total: world.cars.length,
      hp: p.hp,
      maxHp: p.maxHp,
      weapon: p.selectedWeapon,
      ammo: p.weapons[p.selectedWeapon] || 0,
      nitro: p.nitroCharges,
      time: `${mm}:${ss}.${cs}`,
      lastLapMs: p.lastLapMs || 0,
      bestLapMs: p.bestLapMs || 0,
      lapFlashMs: world.race.lapFlashMs || 0,
      lapFlashLast: world.race.lapFlashLast || 0,
      lapFlashBest: world.race.lapFlashBest || 0
    };
  }

  function setPaused(v) { paused = v; if (!v) last = performance.now(); }
  function isPaused() { return paused; }
  function setOnFinish(fn) { onFinish = fn; }
  function isRunning() { return running; }
  function setPauseHandler(fn) { onPause = fn; }

  return {
    startRace,
    stopRace,
    fit,
    getHudInfo,
    setPaused,
    isPaused,
    setOnFinish,
    isRunning,
    setPauseHandler,
    get world() { return world; }
  };
}
