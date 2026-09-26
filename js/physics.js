/** Simple arcade car physics on a centreline track with parallel walls. Units: world units, seconds. */
import { clamp, angleDiff, normalizeAngle } from './util.js';
import { project, wrapS } from './tracks.js';

export const CAR_LEN = 64;
export const CAR_WID = 34;
export const CAR_R = 20;

export const MAX_TURN = 2.9;        // rad/s at moderate speed
export const BRAKE = 1500;          // wu/s² when braking forward motion
const REVERSE_ACCEL = 450;
const REVERSE_TOP = 260;
const ROLL = 140;            // coast deceleration
const GRIP = 7.5;            // lateral velocity decay rate (1/s) — lower = more slide
const WALL_BOUNCE = 0.25;
const WALL_SCRUB = 0.94;

/** Place a car on the track and initialise its progress tracking. */
export function initCarOnTrack(car, track, s) {
  const pr = project(track, car.x, car.y, -1);
  car.seg = pr.i;
  car.lat = pr.lat;
  car.sPrev = pr.s;
  car.dist = s; // signed distance travelled relative to the start line (grid is negative)
}

/**
 * ctl: { accel:bool, brake:bool, steer:-1..1, aimAngle?:radians, noReverse?:bool }
 */
export function stepCar(car, ctl, dtMs, track) {
  const dt = Math.min(0.05, dtMs / 1000);
  let fx = Math.cos(car.angle), fy = Math.sin(car.angle);
  let vF = car.vx * fx + car.vy * fy;
  let vL = -car.vx * fy + car.vy * fx;

  // Steering
  let steer = clamp(ctl.steer || 0, -1, 1);
  if (ctl.aimAngle != null && Number.isFinite(ctl.aimAngle)) {
    const err = angleDiff(car.angle, ctl.aimAngle);
    steer = Math.abs(err) < 0.03 ? 0 : clamp(err / 0.6, -1, 1);
    if (vF < -20) steer = -steer; // reversing: rotate the nose the intuitive way
  }
  const aSpd = Math.abs(vF);
  const turn = MAX_TURN * clamp(aSpd / 220, 0, 1) * (1 - 0.35 * clamp(aSpd / car.top, 0, 1));
  car.angle = normalizeAngle(car.angle + steer * turn * Math.sign(vF || 1) * dt);

  // Throttle / brake along the (new) heading
  if (ctl.accel && !ctl.brake) {
    if (vF < 0) vF += BRAKE * dt;
    else if (vF < car.top) vF = Math.min(car.top, vF + car.accel * dt * (1 - 0.55 * vF / car.top));
  } else if (ctl.brake) {
    if (vF > 0) vF = Math.max(0, vF - BRAKE * dt);
    else if (!ctl.noReverse) vF = Math.max(-REVERSE_TOP, vF - REVERSE_ACCEL * dt);
  } else {
    const r = ROLL * dt;
    vF = Math.abs(vF) <= r ? 0 : vF - Math.sign(vF) * r;
  }
  if (vF > car.top) vF += (car.top - vF) * Math.min(1, 3 * dt);
  vL *= Math.exp(-GRIP * dt);

  fx = Math.cos(car.angle); fy = Math.sin(car.angle);
  car.vx = fx * vF - fy * vL;
  car.vy = fy * vF + fx * vL;

  // Integrate in small substeps with wall constraint against the centreline offset
  const spd = Math.hypot(car.vx, car.vy);
  const steps = Math.max(1, Math.ceil((spd * dt) / 14));
  const sdt = dt / steps;
  car.wallHit = 0;
  for (let k = 0; k < steps; k++) {
    car.x += car.vx * sdt;
    car.y += car.vy * sdt;
    constrain(car, track);
  }
}

/** Keep the car between the two parallel walls and update progress. */
export function constrain(car, track) {
  const pr = project(track, car.x, car.y, car.seg ?? -1);
  const limit = track.halfW - CAR_R;
  let lat = pr.lat;
  if (Math.abs(lat) > limit) {
    const side = Math.sign(lat);
    const push = lat - side * limit;
    car.x -= pr.nx * push;
    car.y -= pr.ny * push;
    lat = side * limit;
    const vn = car.vx * pr.nx + car.vy * pr.ny;
    if (vn * side > 0) {
      car.vx -= (1 + WALL_BOUNCE) * vn * pr.nx;
      car.vy -= (1 + WALL_BOUNCE) * vn * pr.ny;
      car.vx *= WALL_SCRUB;
      car.vy *= WALL_SCRUB;
      car.wallHit = Math.max(car.wallHit || 0, Math.abs(vn));
    }
  }
  // progress (unwrapped distance along the centreline)
  let ds = pr.s - car.sPrev;
  const L = track.length;
  if (ds > L / 2) ds -= L;
  else if (ds < -L / 2) ds += L;
  car.dist += ds;
  car.sPrev = wrapS(track, pr.s);
  car.seg = pr.i;
  car.lat = lat;
}

/** Pairwise circle collisions between cars (call once per frame). */
export function resolveCarCollisions(cars, track) {
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = CAR_R * 2;
      if (d >= min || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d;
      const pen = (min - d) / 2;
      a.x -= nx * pen; a.y -= ny * pen;
      b.x += nx * pen; b.y += ny * pen;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        const j2 = -(1 + 0.3) * rv / 2;
        a.vx -= j2 * nx; a.vy -= j2 * ny;
        b.vx += j2 * nx; b.vy += j2 * ny;
        a.carHit = b.carHit = Math.abs(rv);
      }
      constrain(a, track);
      constrain(b, track);
    }
  }
}
