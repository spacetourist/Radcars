import { normalizeAngle } from './util.js';

export const CAR_COLORS = [
  '#00e8ff', '#ff2b6a', '#b8ff00', '#ffe600',
  '#ff2bd6', '#ff8a00', '#40c0ff', '#f0f0f0'
];

export const AI_NAMES = [
  'Volt', 'Razor', 'Echo', 'Blaze', 'Nyx', 'Torque', 'Drift', 'Pulse'
];

export function createCar(opts) {
  return {
    id: opts.id,
    name: opts.name,
    color: opts.color,
    isPlayer: !!opts.isPlayer,
    x: opts.x,
    y: opts.y,
    angle: opts.angle ?? 0,
    vx: 0,
    vy: 0,
    radius: 16,
    hp: opts.hp ?? 10000,
    maxHp: opts.maxHp ?? 10000,
    engine: opts.engine ?? 0,
    armour: opts.armour ?? 0,
    ram: opts.ram ?? 0,
    nitroCharges: opts.nitro ?? 1,
    nitroMax: opts.nitroMax ?? 1,
    nitroTimer: 0,
    weapons: { ...(opts.weapons || { front: 6, rear: 3, homing: 1, mine: 2, super: 0 }) },
    selectedWeapon: opts.selectedWeapon || 'front',
    dead: false,
    lap: 0,
    checkpoint: 0,
    progress: 0,
    finished: false,
    finishPlace: 0,
    finishTime: 0,
    lastLapMs: 0,
    bestLapMs: 0,
    _lapStartMs: 0,
    // AI
    aiWp: 0,
    aiAggro: opts.aiAggro ?? 0.5,
    aiSkill: opts.aiSkill ?? 0.6,
    fireCooldown: 0,
    lastDamageKind: null,
    _walls: null,
    _wallHit: 0,
    _carHit: 0
  };
}

export function raceProgress(car, track) {
  const cps = track.checkpoints.length;
  return car.lap * cps + car.checkpoint + localCpFrac(car, track);
}

function localCpFrac(car, track) {
  const cps = track.checkpoints;
  const i = car.checkpoint % cps.length;
  const a = cps[i];
  const b = cps[(i + 1) % cps.length];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = ((car.x - a.x) * dx + (car.y - a.y) * dy) / len2;
  return Math.max(0, Math.min(0.999, t));
}

export function checkpointHitRadius(track) {
  if (track && track.cpHitRadius) return track.cpHitRadius;
  const w = (track && track.width) || 1600;
  const h = (track && track.height) || 1000;
  return Math.max(160, Math.min(300, Math.min(w, h) * 0.09));
}

/** Nearest racing-line index to a world point. */
function nearestLineIndex(track, x, y) {
  const line = track.line;
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < line.length; i++) {
    const dx = x - line[i].x, dy = y - line[i].y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; bestI = i; }
  }
  return bestI;
}

/**
 * Lap gates follow racing-line progress so a missed centre CP cannot freeze
 * the counter. Also accepts a large radius / gate-plane cross for catch-up.
 */
export function updateCheckpoints(car, track) {
  if (car.finished || car.dead) return;
  const cps = track.checkpoints;
  const line = track.line;
  if (!cps || !cps.length || !line || !line.length) return;

  const nLine = line.length;
  const start = ((track.startIndex % nLine) + nLine) % nLine;
  const li = nearestLineIndex(track, car.x, car.y);
  const along = (li - start + nLine) % nLine;
  const cpCount = cps.length;
  const pos = (along / nLine) * cpCount; // 0 .. cpCount around from S/F

  if (car._cpPosPrev == null) car._cpPosPrev = pos;

  const hitR = Math.max(checkpointHitRadius(track), 260);
  const hitR2 = hitR * hitR;
  const lx = line[li].x - car.x, ly = line[li].y - car.y;
  const onRibbon = (lx * lx + ly * ly) < hitR2 * 5; // ~2.2× hitR

  let guard = 0;
  while (guard++ < cpCount + 1) {
    const next = car.checkpoint % cpCount;
    const cp = cps[next];
    const dx = car.x - cp.x, dy = car.y - cp.y;
    const near = (dx * dx + dy * dy) < hitR2;
    const ahead = dx * cp.nx + dy * cp.ny;
    const lat = Math.abs(-dx * cp.ny + dy * cp.nx);
    const crossed = ahead > -40 && ahead < hitR && lat < hitR;

    let progressHit = false;
    if (onRibbon && !car._lapLock) {
      if (next === 0) {
        // S/F only after arming on the final sector — prevents double-lap when
        // catch-up wraps while pos is still high, then snaps low next frame.
        progressHit = !car._lapLock && !!car._sfArmed && car._cpPosPrev > cpCount - 0.85 && pos < 1.1;
      } else {
        progressHit = pos >= next + 0.05;
        if (next >= cpCount - 2) car._sfArmed = true;
      }
    }

    if (near || crossed || progressHit) {
      car.checkpoint++;
      if (car.checkpoint >= cpCount) {
        car.checkpoint = 0;
        car.lap++;
        car._justLapped = true;
        car._sfArmed = false;
        car._cpPosPrev = Math.min(pos, 0.35);
        car._lapLock = 12; // frames to ignore S/F / progress wrap after a lap
        break;
      }
      // Progress catch-up is one gate/frame so a high stale pos cannot cascade a full lap
      if (progressHit && !near && !crossed) break;
      continue;
    }
    break;
  }

  if (car._lapLock > 0) car._lapLock--;
  // Do not overwrite a post-lap snap with a still-high pre-wrap pos
  if (!(car._justLapped || (car._lapLock > 0 && pos > cpCount * 0.5))) {
    car._cpPosPrev = pos;
  }
  car.progress = raceProgress(car, track);
}

export function syncCarFromSave(saveCar) {
  return {
    hp: saveCar.hp,
    maxHp: saveCar.maxHp,
    engine: saveCar.engine,
    armour: saveCar.armour,
    ram: saveCar.ram,
    nitro: saveCar.nitro,
    nitroMax: saveCar.nitroMax,
    weapons: { ...saveCar.weapons },
    selectedWeapon: saveCar.selectedWeapon
  };
}
