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
  // Slightly softer than raw twitchy 1.0, firm enough to make corners at speed
  // Cap yaw hard — full steer must stay controllable at speed
  const turnRate = 0.0017 * turnFactor * (0.65 + Math.min(1, speed / 1.35));
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

  // Integrate in substeps so high speed cannot tunnel through thin walls
  // (max move ~speed*POS_SCALE*dt can exceed 2*radius in one frame).
  const moveBudget = Math.hypot(car.vx, car.vy) * POS_SCALE * dt;
  const steps = Math.max(1, Math.min(12, Math.ceil(moveBudget / Math.max(4, car.radius * 0.45))));
  const sdt = dt / steps;
  for (let s = 0; s < steps; s++) {
    car.x += car.vx * POS_SCALE * sdt;
    car.y += car.vy * POS_SCALE * sdt;
    resolveWalls(car, track);
  }

  // Car-car
  if (others) resolveCars(car, others);

  // Containment: if still off asphalt, pull back onto the racing ribbon
  recoverOntoTrack(car, track, dt);
}

function resolveWalls(car, track) {
  if (!car._walls) car._walls = trackWallSegments(track);
  const walls = car._walls;
  // Slightly fat radius so visual chassis doesn't clip the painted barrier
  const r = car.radius * 1.15;
  // Multiple passes: after a corner push another wall may still penetrate
  for (let pass = 0; pass < 3; pass++) {
    let hit = false;
    for (const w of walls) {
      const c = closestPointOnSeg(car.x, car.y, w.ax, w.ay, w.bx, w.by);
      let dx = car.x - c.x, dy = car.y - c.y;
      let d = Math.hypot(dx, dy);
      if (d < 1e-6) {
        // Sitting on the segment — push along segment normal toward track
        const sx = w.bx - w.ax, sy = w.by - w.ay;
        const sl = Math.hypot(sx, sy) || 1;
        dx = -sy / sl;
        dy = sx / sl;
        // Flip if this normal points off-track
        if (!isOnTrack(track, c.x + dx * 4, c.y + dy * 4)) {
          dx = -dx;
          dy = -dy;
        }
        d = 1e-6;
      }
      if (d < r) {
        hit = true;
        let nx = dx / d, ny = dy / d;
        // Prefer the direction that lands on asphalt
        if (!isOnTrack(track, car.x + nx * 2, car.y + ny * 2) &&
            isOnTrack(track, car.x - nx * 2, car.y - ny * 2)) {
          nx = -nx;
          ny = -ny;
        }
        const pen = r - d;
        car.x += nx * pen;
        car.y += ny * pen;
        const vn = car.vx * nx + car.vy * ny;
        if (vn < 0) {
          car.vx -= (1 + WALL_BOUNCE) * vn * nx;
          car.vy -= (1 + WALL_BOUNCE) * vn * ny;
          if (pass === 0) {
            const impact = Math.abs(vn);
            applyDamage(car, impact * 28 * (1 - car.armour * 0.08), 'wall');
            car._wallHit = impact;
          }
        }
      }
    }
    if (!hit) break;
  }
}

/** Pull car back onto asphalt if walls were tunneled or corners trapped it. */
function recoverOntoTrack(car, track, dt) {
  if (isOnTrack(track, car.x, car.y)) return;

  let best = null, bestD = Infinity;
  for (const p of track.line) {
    const d = dist(car.x, car.y, p.x, p.y);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best) return;

  for (let i = 0; i < 10 && !isOnTrack(track, car.x, car.y); i++) {
    const dx = best.x - car.x, dy = best.y - car.y;
    const len = Math.hypot(dx, dy) || 1;
    car.x += (dx / len) * 6;
    car.y += (dy / len) * 6;
    resolveWalls(car, track);
  }

  // Kill velocity away from the ribbon so we don't immediately re-exit
  const dx = best.x - car.x, dy = best.y - car.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len, ny = dy / len;
  const vn = car.vx * nx + car.vy * ny;
  if (vn < 0) {
    car.vx -= vn * nx;
    car.vy -= vn * ny;
  }
  car.vx *= 0.7;
  car.vy *= 0.7;
  applyDamage(car, 6 * (dt / 16), 'off');
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
