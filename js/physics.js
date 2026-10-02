/** Simple arcade car physics on a centreline track with parallel walls. Units: world units, seconds. */
import { clamp, angleDiff, normalizeAngle } from './util.js';
import { project, wrapS } from './tracks.js';

export const CAR_LEN = 64;
export const CAR_WID = 34;
export const CAR_R = 20;

export const MAX_TURN = 3.3;        // rad/s at moderate speed (v49: ~12% tighter circle at race speed)
export const BRAKE = 1500;          // wu/s² when braking forward motion
const REVERSE_ACCEL = 450;
const REVERSE_TOP = 260;
const ROLL = 140;            // coast deceleration
// v54 'feel': speed-dependent grip — planted at low speed (touch stays controllable), lighter at speed so the car carries
// weight and slides a little instead of snapping to its heading (v53: a flat 7.5)
export const GRIP_LOW = 10.5;       // lateral velocity decay rate (1/s) at ≤ GRIP_LOW_SPD
export const GRIP_HIGH = 4.6;       // … at the car's top speed
const GRIP_LOW_SPD = 220;
const YAW_TAU = 0.07;               // s: yaw-rate smoothing (a touch of inertia; v53 turned instantly)
// v54: the long pull — strong launch, then a soft approach that keeps gaining for ~5–6 s (v53 hit top in ~2.2 s)
export const ACCEL_LAUNCH = 1.42;   // × car.accel at standstill
export const ACCEL_ASYM = 1.04;     // the curve aims slightly past top so the car actually reaches it (~7 s)
export const ACCEL_POW = 1.45;
// v54 walls: glancing hits keep most of the speed and turn the car along the wall; head-on still hurts
const WALL_BOUNCE_GLANCE = 0.12, WALL_BOUNCE_HEAD = 0.3;
const WALL_KEEP_GLANCE = 0.99, WALL_KEEP_HEAD = 0.84;  // tangential speed kept at 0° / 90° impact (eased by sin² so glancing hits barely scrub)
const WALL_TURN = 0.65;             // fraction of the heading error to the wall tangent removed on a glancing hit
const WALL_GLANCE_MAX = 0.75;       // rad (~43°): above this the hit counts as head-on (no heading deflection)
export const WALL_ASSIST_MS = 320;  // steering assist away from the wall after a hit

/** v54 throttle curve, shared by the player, AI and the verify scripts (dv/dt at forward speed vF). */
export function throttleAccel(vF, top, accel) {
  return accel * ACCEL_LAUNCH * Math.pow(Math.max(0, 1 - vF / (top * ACCEL_ASYM)), ACCEL_POW);
}
/** v54 lateral grip at a given speed. */
export function gripAt(spd, top) {
  return GRIP_LOW + (GRIP_HIGH - GRIP_LOW) * clamp((spd - GRIP_LOW_SPD) / Math.max(1, top - GRIP_LOW_SPD), 0, 1);
}
/** Boost (player only, v47): at full boost level the top-speed cap is +40% and thrust +70%. */
export const BOOST_TOP_MUL = 0.40;
export const BOOST_ACCEL_MUL = 0.70;

/** Place a car on the track and initialise its progress tracking. */
export function initCarOnTrack(car, track, s) {
  const pr = project(track, car.x, car.y, -1);
  car.seg = pr.i;
  car.lat = pr.lat;
  car.sPrev = pr.s;
  car.dist = s; // signed distance travelled relative to the start line (grid is negative)
}

/**
 * ctl: { accel:bool, brake:bool, steer:-1..1, aimAngle?:radians, noReverse?:bool, boost?:0..1 }
 * boost is a smoothed level (0 = none); it only raises the top-speed cap and thrust.
 * Steering, grip and braking are untouched (turn rate still scales with the base car.top).
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
  // wall assist (v54): for a moment after a hit, nudge the nose away from the wall (player input still wins)
  if (car.wallAssistMs > 0) {
    car.wallAssistMs -= dt * 1000;
    const k = clamp(car.wallAssistMs / WALL_ASSIST_MS, 0, 1);
    steer = clamp(steer + car.wallAssistDir * 0.55 * k * (Math.sign(steer) === car.wallAssistDir || !steer ? 1 : 0.4), -1, 1);
  }
  const yawTarget = steer * turn * Math.sign(vF || 1);
  car.yawRate = (car.yawRate || 0) + (yawTarget - (car.yawRate || 0)) * (1 - Math.exp(-dt / YAW_TAU));
  car.angle = normalizeAngle(car.angle + car.yawRate * dt);

  // Throttle / brake along the (new) heading
  const b = clamp(ctl.boost || 0, 0, 1);
  const top = car.top * (1 + BOOST_TOP_MUL * b);
  const accel = car.accel * (1 + BOOST_ACCEL_MUL * b);
  if (ctl.accel && !ctl.brake) {
    if (vF < 0) vF += BRAKE * dt;
    else if (vF < top) vF = Math.min(top, vF + throttleAccel(vF, top, accel) * dt);
  } else if (ctl.brake) {
    // v53: the player's BRAKE (ctl.brakeFloor > 0) bites hard at speed and fades out into a steerable crawl, never a
    // dead stop or a reverse; brakeRate overrides the deceleration (AI / unstick keep the old full brake)
    const floor = ctl.brakeFloor || 0, rate = ctl.brakeRate || BRAKE;
    if (vF > floor) vF = Math.max(floor, vF - rate * dt * (floor ? clamp(0.45 + vF / 900, 0.45, 1) : 1));
    else if (floor && vF > 0) { /* crawl: hold the speed so the nose still turns */ }
    else if (!ctl.noReverse) vF = Math.max(-REVERSE_TOP, vF - REVERSE_ACCEL * dt);
  } else {
    const r = ROLL * dt;
    vF = Math.abs(vF) <= r ? 0 : vF - Math.sign(vF) * r;
  }
  // over the cap (e.g. boost winding down): ease back towards it rather than snapping
  if (vF > top) vF += (top - vF) * Math.min(1, 3 * dt);
  car.vLat = vL; // v54: lateral slip before grip (skid marks / smoke / squeal read slip01 from this)
  vL *= Math.exp(-gripAt(Math.hypot(vF, vL), car.top) * dt);

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
      // v54: impact angle vs the wall tangent decides everything — glancing keeps speed and turns the car along the
      // wall (no grinding), head-on bounces and scrubs hard
      const spd = Math.hypot(car.vx, car.vy) || 1;
      const sinA = clamp(Math.abs(vn) / spd, 0, 1), ang = Math.asin(sinA);
      const tx = car.vx - vn * pr.nx, ty = car.vy - vn * pr.ny; // tangential part
      const keep = WALL_KEEP_GLANCE + (WALL_KEEP_HEAD - WALL_KEEP_GLANCE) * sinA * sinA;
      const bounce = WALL_BOUNCE_GLANCE + (WALL_BOUNCE_HEAD - WALL_BOUNCE_GLANCE) * sinA;
      car.vx = tx * keep - bounce * vn * pr.nx;
      car.vy = ty * keep - bounce * vn * pr.ny;
      if (ang < WALL_GLANCE_MAX && Math.hypot(tx, ty) > 60) {
        const tang = Math.atan2(ty, tx);
        let err = angleDiff(car.angle, tang);
        if (Math.abs(err) < Math.PI / 2) car.angle = normalizeAngle(car.angle + err * WALL_TURN);
        car.yawRate = 0;
      }
      car.wallAssistMs = WALL_ASSIST_MS; car.wallAssistDir = 0; // direction set below from the wall side
      // steer away from the wall: wall on the left of travel → steer right (+1), else left
      const fwdX = Math.cos(car.angle), fwdY = Math.sin(car.angle);
      const cross = fwdX * (side * pr.ny) - fwdY * (side * pr.nx); // sign of the wall normal relative to the heading
      car.wallAssistDir = cross > 0 ? -1 : 1;
      if (Math.abs(vn) > (car.wallHit || 0)) { car.wallHit = Math.abs(vn); car.wallAng = ang; car.wallSpd = spd; car.wallNx = pr.nx * side; car.wallNy = pr.ny * side; }
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
  for (const c of cars) c.carHit = 0; // v54: cleared every frame so barges can be edge-detected (v55)
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = CAR_R * 2;
      if (d >= min || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d;
      const pen = (min - d) / 2;
      // v50: a `heavy` car (player on autopilot) isn't moved by contact; the other car takes it all
      const ka = a.heavy && !b.heavy ? 0 : b.heavy && !a.heavy ? 2 : 1, kb = 2 - ka;
      a.x -= nx * pen * ka; a.y -= ny * pen * ka;
      b.x += nx * pen * kb; b.y += ny * pen * kb;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        const j2 = -(1 + 0.3) * rv / 2;
        a.vx -= j2 * ka * nx; a.vy -= j2 * ka * ny;
        b.vx += j2 * kb * nx; b.vy += j2 * kb * ny;
        a.carHit = b.carHit = Math.abs(rv);
      }
      constrain(a, track);
      constrain(b, track);
    }
  }
}

/** v54 slide amount 0…1 from the pre-grip lateral speed (skid marks, smoke, squeal). Retuned for the v54 grip. */
export const SLIP_LO = 30, SLIP_RANGE = 60; // measured 390x844 Neon key-bot: |vLat| p50 0, p90 10, p99 39, max 52 (v53 vL scale 80/240 never fired)
export function slip01(car) { return clamp((Math.abs(car.vLat || 0) - SLIP_LO) / SLIP_RANGE, 0, 1); }
