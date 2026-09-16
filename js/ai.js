import { angleDiff, dist, clamp, normalizeAngle } from './util.js';
import { tryFire, cycleWeapon } from './weapons.js';
import { triggerNitro } from './physics.js';

export function stepAI(car, cars, track, weapons, dt, sfx) {
  if (car.dead || car.finished || car.isPlayer) return { steer: 0, accel: false, brake: false };

  // Follow racing line waypoints
  const line = track.line;
  let wp = car.aiWp % line.length;
  let target = line[wp];
  let d = dist(car.x, car.y, target.x, target.y);
  // look ahead based on speed (easier tiers look less far ahead)
  const spd = Math.hypot(car.vx, car.vy);
  const lookMul = car.aiDiff?.lookAheadMul ?? 1;
  const look = Math.max(1, Math.floor((2 + Math.floor(spd * 2.5)) * lookMul));
  while (d < 40 + look * 8) {
    car.aiWp = (car.aiWp + 1) % line.length;
    wp = car.aiWp;
    target = line[wp];
    d = dist(car.x, car.y, target.x, target.y);
    if (look <= 2) break;
  }
  const lookIdx = (car.aiWp + look) % line.length;
  const lookPt = line[lookIdx];

  const desired = Math.atan2(lookPt.y - car.y, lookPt.x - car.x);
  const err = angleDiff(car.angle, desired);
  let steer = clamp(err * 1.8, -1, 1);

  // Overtaking: if blocked ahead by slower car, offset target laterally
  const ahead = findAhead(car, cars);
  let accel = true;
  let brake = false;
  if (ahead && ahead.dist < 70) {
    const rel = Math.hypot(ahead.car.vx, ahead.car.vy) - spd;
    if (rel < -0.1 && ahead.dist < 50) {
      brake = true;
      accel = spd > 1.2;
    }
    // side offset
    const side = Math.sign(err || 1) || 1;
    const nx = -Math.sin(car.angle) * side * 36;
    const ny = Math.cos(car.angle) * side * 36;
    const od = Math.atan2(lookPt.y + ny - car.y, lookPt.x + nx - car.x);
    steer = clamp(angleDiff(car.angle, od) * 1.6, -1, 1);
  }

  // corner brake: large heading error
  if (Math.abs(err) > 0.55 && spd > 1.8) {
    brake = true;
    accel = false;
  }

  // Weapons
  car.fireCooldown = Math.max(0, car.fireCooldown - dt);
  const fireMul = car.aiDiff?.fireMul ?? 1;
  if (Math.random() < 0.012 * car.aiAggro * fireMul * (dt / 16)) {
    chooseWeapon(car, cars);
    const res = tryFire(car, weapons, cars, track);
    if (res && sfx) sfx(res.sfx);
  }

  // Nitro when behind or finishing
  const nitroMul = car.aiDiff?.nitroMul ?? 1;
  if (car.nitroCharges > 0 && Math.random() < 0.002 * nitroMul * (dt / 16)) {
    const place = estimatePlace(car, cars);
    if (place > 2 || spd < 1.5) {
      if (triggerNitro(car) && sfx) sfx('nitro');
    }
  }

  // skill jitter (more on easier tiers)
  const jitterMul = car.aiDiff?.jitterMul ?? 1;
  steer += (Math.random() - 0.5) * (1 - car.aiSkill) * 0.35 * jitterMul;

  return { steer: clamp(steer, -1, 1), accel, brake };
}

function findAhead(car, cars) {
  let best = null;
  for (const o of cars) {
    if (o === car || o.dead) continue;
    const dx = o.x - car.x, dy = o.y - car.y;
    const forward = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
    const lateral = Math.abs(-dx * Math.sin(car.angle) + dy * Math.cos(car.angle));
    if (forward > 0 && forward < 100 && lateral < 28) {
      if (!best || forward < best.dist) best = { car: o, dist: forward };
    }
  }
  return best;
}

function chooseWeapon(car, cars) {
  // Prefer rear if someone close behind, else front/homing
  let behind = false, aheadEnemy = false;
  for (const o of cars) {
    if (o === car || o.dead) continue;
    const dx = o.x - car.x, dy = o.y - car.y;
    const forward = dx * Math.cos(car.angle) + dy * Math.sin(car.angle);
    const lat = Math.abs(-dx * Math.sin(car.angle) + dy * Math.cos(car.angle));
    if (forward < -20 && forward > -90 && lat < 30) behind = true;
    if (forward > 40 && forward < 220 && lat < 40) aheadEnemy = true;
  }
  if (behind && (car.weapons.rear || 0) > 0) car.selectedWeapon = 'rear';
  else if (aheadEnemy && (car.weapons.homing || 0) > 0 && Math.random() < 0.4) car.selectedWeapon = 'homing';
  else if ((car.weapons.front || 0) > 0) car.selectedWeapon = 'front';
  else if ((car.weapons.mine || 0) > 0) car.selectedWeapon = 'mine';
}

function estimatePlace(car, cars) {
  const sorted = [...cars].sort((a, b) => b.progress - a.progress);
  return sorted.findIndex((c) => c.id === car.id) + 1;
}
