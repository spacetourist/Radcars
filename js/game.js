import { getTrack } from './tracks.js';
import { createCar, CAR_COLORS, AI_NAMES, updateCheckpoints, syncCarFromSave } from './cars.js';
import { stepCar, triggerNitro } from './physics.js';
import { createWeaponsState, tryFire, stepWeapons, cycleWeapon } from './weapons.js';
import { stepAI } from './ai.js';
import { createRenderer } from './render.js';
import { sfx } from './audio.js';
import { placePrize, persistSave } from './career.js';
import { clamp } from './util.js';

export function createGame(canvas, input) {
  const renderer = createRenderer(canvas);
  let running = false;
  let paused = false;
  let raf = 0;
  let last = 0;
  let world = null;
  let onFinish = null;
  let onPause = null;

  function fit() {
    const app = document.getElementById('app');
    const w = app.clientWidth;
    const h = app.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // letterbox 16:9-ish internal view
    let cw = w, ch = h;
    renderer.resize(cw, ch, dpr);
  }

  window.addEventListener('resize', fit);
  fit();

  function startRace({ trackIndex, save, mode, laps, aiCount }) {
    const track = getTrack(trackIndex);
    const totalLaps = laps || track.lapsDefault || 3;
    const nAI = clamp(aiCount ?? 5, 3, 7);
    const synced = syncCarFromSave(save.car);

    const cars = [];
    // player at spawn 0
    const sp0 = track.spawns[0];
    cars.push(createCar({
      id: 0,
      name: 'You',
      color: CAR_COLORS[0],
      isPlayer: true,
      x: sp0.x,
      y: sp0.y,
      angle: sp0.angle,
      ...synced,
      nitro: synced.nitro,
      nitroMax: synced.nitroMax
    }));
    cars[0].nitroCharges = synced.nitro;
    cars[0].nitroMax = synced.nitroMax;

    for (let i = 0; i < nAI; i++) {
      const sp = track.spawns[i + 1] || {
        x: sp0.x + (i + 1) * 20,
        y: sp0.y + ((i % 2) ? 18 : -18),
        angle: sp0.angle
      };
      const difficulty = track.difficulty;
      const ai = createCar({
        id: i + 1,
        name: AI_NAMES[i % AI_NAMES.length],
        color: CAR_COLORS[(i + 1) % CAR_COLORS.length],
        x: sp.x,
        y: sp.y,
        angle: sp.angle,
        hp: 10000,
        maxHp: 10000,
        engine: Math.min(4, Math.floor(difficulty + Math.random() * 2)),
        armour: Math.floor(Math.random() * difficulty),
        ram: Math.floor(Math.random() * 2),
        nitro: 1 + (Math.random() > 0.5 ? 1 : 0),
        nitroMax: 2,
        weapons: {
          front: 6 + difficulty * 2,
          rear: 3 + difficulty,
          homing: 1 + (difficulty > 1 ? 1 : 0),
          mine: 2,
          super: difficulty > 2 ? 1 : 0
        },
        aiAggro: 0.4 + Math.random() * 0.5,
        aiSkill: 0.45 + Math.random() * 0.4 + difficulty * 0.05
      });
      ai.nitroCharges = ai.nitroCharges ?? ai.nitro ?? 1;
      // init waypoint near spawn
      let best = 0, bestD = Infinity;
      for (let w = 0; w < track.line.length; w++) {
        const dx = track.line[w].x - ai.x, dy = track.line[w].y - ai.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = w; }
      }
      ai.aiWp = best;
      cars.push(ai);
    }

    // player waypoint
    {
      let best = 0, bestD = Infinity;
      for (let w = 0; w < track.line.length; w++) {
        const dx = track.line[w].x - cars[0].x, dy = track.line[w].y - cars[0].y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = w; }
      }
      cars[0].aiWp = best;
    }

    // seed progress from start positions
    for (const c of cars) updateCheckpoints(c, track);

    world = {
      track,
      cars,
      weapons: createWeaponsState(),
      cam: { x: cars[0].x, y: cars[0].y, zoom: 0.85 },
      player: cars[0],
      race: {
        mode,
        trackIndex,
        totalLaps,
        time: 0,
        countdown: 3000,
        finishedCount: 0,
        over: false,
        placesAssigned: 0
      },
      dt: 16,
      save
    };

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

    // camera follow player
    const p = world.player;
    world.cam.x += (p.x - world.cam.x) * 0.12;
    world.cam.y += (p.y - world.cam.y) * 0.12;
    const spd = Math.hypot(p.vx, p.vy);
    world.cam.zoom = clamp(0.95 - spd * 0.04, 0.65, 0.95);

    renderer.draw(world);

    // countdown overlay
    if (world.race.countdown > 0) {
      const c = world.race.countdown;
      const text = c > 2000 ? '3' : c > 1000 ? '2' : c > 0 ? '1' : 'GO';
      renderer.drawCountdown(renderer.ctx, text, canvas.clientWidth, canvas.clientHeight);
    }

    raf = requestAnimationFrame(loop);
  }

  function update(dt) {
    const { track, cars, weapons, race, save } = world;
    const flags = input.consumeFlags();

    if (flags.pause && race.countdown <= 0 && !race.over) {
      paused = true;
      return 'pause';
    }

    if (race.countdown > 0) {
      race.countdown -= dt;
      // freeze cars during countdown except tiny settle
      return;
    }

    if (race.over) return;

    race.time += dt;

    // player input
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
        accel: flags.accel || input.state.accel,
        brake: flags.brake || input.state.brake
      }, dt, track, cars);
    } else if (!player.finished && player.dead) {
      // still integrate lightly
      stepCar(player, { steer: 0, accel: false, brake: false }, dt, track, cars);
    }

    // AI
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

    // wall/car sfx
    for (const c of cars) {
      if (c._wallHit > 0.8) { if (c.isPlayer) sfx('wall'); c._wallHit = 0; }
      if (c._carHit > 0.6) { if (c.isPlayer) sfx('hit'); c._carHit = 0; }
    }

    stepWeapons(weapons, cars, track, dt, (kind, x, y) => {
      sfx(kind);
      renderer.addBoom(x, y);
    });

    for (const c of cars) {
      const prevLap = c.lap;
      updateCheckpoints(c, track);
      if (c._justLapped) {
        c._justLapped = false;
        if (c.isPlayer && c.lap < race.totalLaps) sfx('lap');
      }
      // finish
      if (!c.finished && c.lap >= race.totalLaps) {
        c.finished = true;
        race.placesAssigned++;
        c.finishPlace = race.placesAssigned;
        c.finishTime = race.time;
        if (c.isPlayer) sfx('finish');
      }
      // dead cars get last places eventually
      if (c.dead && !c.finished) {
        // allow continue as DNF after all living finish or timeout
      }
    }

    // end conditions
    const playerDone = player.finished || (player.dead && race.time > 8000);
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

    // assign remaining places
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
        prize
      };
    });

    const player = cars.find((c) => c.isPlayer);
    const playerPlace = player.finishPlace;

    // persist car damage + ammo leftover + cash + nitro leftover
    save.car.hp = Math.max(0, Math.round(player.hp));
    save.car.weapons = { ...player.weapons };
    save.car.nitro = player.nitroCharges;
    save.car.selectedWeapon = player.selectedWeapon;
    const prize = placePrize(playerPlace, race.trackIndex);
    save.cash += prize;

    if (race.mode === 'career') {
      if (playerPlace === 1) save.careerWins++;
      if (playerPlace <= 3) {
        // advance
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
      mode: race.mode
    };

    // delay briefly then callback
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
    return {
      lap: Math.min(p.lap, world.race.totalLaps - 1),
      totalLaps: world.race.totalLaps,
      place,
      total: world.cars.length,
      hp: p.hp,
      maxHp: p.maxHp,
      weapon: p.selectedWeapon,
      ammo: p.weapons[p.selectedWeapon] || 0,
      nitro: p.nitroCharges,
      time: `${mm}:${ss}.${cs}`
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
