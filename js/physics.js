import { clamp, angleDiff, normalizeAngle, closestPointOnSeg, dist } from './util.js';
import { trackWallSegments, isOnTrack } from './tracks.js';

const POS_SCALE = 0.57;
const DRAG = 0.9995;
const WALL_BOUNCE = 0.75;
const CAR_TRANSFER = 0.2;

export function carAccel(engineLevel) {
  return 0.0006 * (2 + engineLevel);
}

export function carTopSpeed(engineLevel) {
  // soft cap via drag balance; higher engine = more accel so higher effective speed
  return 4.2 + engineLevel * 0.55;
}

export function stepCar(car, input, dt, track, others) {
  const brake = input.brake ? 1 : 0;
  const accel = input.accel ? 1 : 0;
  const steer = clamp(input.steer || 0, -1, 1);

  let nitroMul = 1;
  if (car.nitroTimer > 0) {
    car.nitroTimer -= dt;
    nitroMul = 1.85;
  }

  const a = carAccel(car.engine) * nitroMul;
  const speed = Math.hypot(car.vx, car.vy);

  // Turn rate falls with speed ≈ *(4-speed)
  const turnFactor = Math.max(0.35, 4 - Math.min(speed, 3.5));
  const turnRate = 0.0028 * 0.75 * turnFactor * (0.65 + Math.min(1, speed / 1.2));
  car.angle = normalizeAngle(car.angle + steer * turnRate * dt);

  // Accel along facing
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  if (accel) {
    car.vx += fx * a * dt;
    car.vy += fy * a * dt;
  }
  if (brake) {
    car.vx -= fx * 0.0005 * dt;
    car.vy -= fy * 0.0005 * dt;
    car.vx *= Math.pow(0.992, dt / 16);
    car.vy *= Math.pow(0.992, dt / 16);
  }

  // Soft velocity-to-heading blend (power slide) 50–250ms
  const blendMs = clamp(180 - speed * 30, 50, 250);
  const blend = 1 - Math.exp(-dt / blendMs);
  const spd = Math.hypot(car.vx, car.vy);
  if (spd > 0.02) {
    const hx = Math.cos(car.angle) * spd;
    const hy = Math.sin(car.angle) * spd;
    car.vx = car.vx * (1 - blend) + hx * blend;
    car.vy = car.vy * (1 - blend) + hy * blend;
  }

  // Ground drag
  const dragPow = Math.pow(DRAG, dt);
  car.vx *= dragPow;
  car.vy *= dragPow;

  // Soft top speed clamp
  const top = carTopSpeed(car.engine) * (car.nitroTimer > 0 ? 1.35 : 1);
  const sp2 = Math.hypot(car.vx, car.vy);
  if (sp2 > top) {
    car.vx *= top / sp2;
    car.vy *= top / sp2;
  }

  // Integrate
  car.x += car.vx * POS_SCALE * dt;
  car.y += car.vy * POS_SCALE * dt;

  // Wall collisions
  resolveWalls(car, track);

  // Car-car
  if (others) resolveCars(car, others);

  // Off-track soft push (safety)
  if (!isOnTrack(track, car.x, car.y)) {
    // find nearest line point and pull
    let best = null, bestD = Infinity;
    for (const p of track.line) {
      const d = dist(car.x, car.y, p.x, p.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) {
      const dx = best.x - car.x, dy = best.y - car.y;
      const len = Math.hypot(dx, dy) || 1;
      car.x += (dx / len) * 2;
      car.y += (dy / len) * 2;
      car.vx *= 0.85;
      car.vy *= 0.85;
      applyDamage(car, 4 * (dt / 16), 'off');
    }
  }
}

function resolveWalls(car, track) {
  if (!car._walls) car._walls = trackWallSegments(track);
  const walls = car._walls;
  const r = car.radius;
  for (const w of walls) {
    const c = closestPointOnSeg(car.x, car.y, w.ax, w.ay, w.bx, w.by);
    const dx = car.x - c.x, dy = car.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d < r && d > 1e-6) {
      const nx = dx / d, ny = dy / d;
      const pen = r - d;
      car.x += nx * pen;
      car.y += ny * pen;
      const vn = car.vx * nx + car.vy * ny;
      if (vn < 0) {
        car.vx -= (1 + WALL_BOUNCE) * vn * nx;
        car.vy -= (1 + WALL_BOUNCE) * vn * ny;
        const impact = Math.abs(vn);
        applyDamage(car, impact * 28 * (1 - car.armour * 0.08), 'wall');
        car._wallHit = impact;
      }
    }
  }
}

function resolveCars(car, others) {
  for (const o of others) {
    if (o === car || o.dead) continue;
    const dx = car.x - o.x, dy = car.y - o.y;
    const d = Math.hypot(dx, dy);
    const min = car.radius + o.radius;
    if (d < min && d > 1e-6) {
      const nx = dx / d, ny = dy / d;
      const pen = (min - d) / 2;
      car.x += nx * pen; car.y += ny * pen;
      o.x -= nx * pen; o.y -= ny * pen;
      const rvx = car.vx - o.vx, rvy = car.vy - o.vy;
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const impulse = vn * CAR_TRANSFER;
        car.vx -= impulse * nx; car.vy -= impulse * ny;
        o.vx += impulse * nx; o.vy += impulse * ny;
        // transfer ~20% speed feel + small damage; ram upgrade boosts
        const ramBonus = 1 + car.ram * 0.25;
        const dmg = Math.abs(vn) * 12 * ramBonus;
        applyDamage(o, dmg * (1 - o.armour * 0.08), 'car');
        applyDamage(car, dmg * 0.55 * (1 - car.armour * 0.08), 'car');
        car._carHit = Math.abs(vn);
      }
    }
  }
}

export function applyDamage(car, amount, kind) {
  if (car.dead || amount <= 0) return;
  car.hp -= amount;
  car.lastDamageKind = kind;
  if (car.hp <= 0) {
    car.hp = 0;
    car.dead = true;
    car.vx *= 0.2;
    car.vy *= 0.2;
  }
}

export function triggerNitro(car) {
  if (car.nitroCharges <= 0 || car.nitroTimer > 0 || car.dead) return false;
  car.nitroCharges -= 1;
  car.nitroTimer = 1200; // ~1.2s
  return true;
}
