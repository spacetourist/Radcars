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

export function updateCheckpoints(car, track) {
  if (car.finished || car.dead) return;
  const cps = track.checkpoints;
  const next = car.checkpoint % cps.length;
  const cp = cps[next];
  const dx = car.x - cp.x, dy = car.y - cp.y;
  // crossed when near and mostly along forward
  if (dx * dx + dy * dy < 90 * 90) {
    const along = dx * cp.nx + dy * cp.ny;
    // accept proximity
    car.checkpoint++;
    if (car.checkpoint >= cps.length) {
      car.checkpoint = 0;
      car.lap++;
      car._justLapped = true;
    }
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
