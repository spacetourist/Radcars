/** AI driver: follow the centreline with a lane offset, brake for corners, avoid cars, recover if stuck. */
import { clamp, angleDiff } from './util.js';
import { pointAt, indexAt } from './tracks.js';
import { MAX_TURN, BRAKE } from './physics.js';

/** Highest speed at which the car's turn rate can hold a curve of radius R. */
function cornerSpeed(R, top) {
  const w = MAX_TURN * 0.9; // leave a little steering in reserve
  return Math.min(top, (w * R) / (1 + (w * R * 0.35) / top));
}

export function stepAI(car, cars, track, dtMs) {
  const dt = dtMs / 1000;
  const spd = Math.hypot(car.vx, car.vy);
  const s = car.sPrev;
  const halfW = track.halfW;

  // Lane choice: default racing lane, dodge the car directly ahead
  let laneTarget = car.aiLane;
  for (const o of cars) {
    if (o === car) continue;
    let ds = o.sPrev - s;
    if (ds < -track.length / 2) ds += track.length;
    if (ds > track.length / 2) ds -= track.length;
    if (ds > 0 && ds < 200 && Math.abs(o.lat - car.lat) < 55) {
      laneTarget = o.lat > 0 ? -halfW * 0.45 : halfW * 0.45;
      break;
    }
  }
  car.aiLaneNow += (laneTarget - car.aiLaneNow) * Math.min(1, 2.5 * dt);

  // Steering toward a look-ahead point on the chosen lane
  const look = 150 + spd * 0.35;
  const tp = pointAt(track, s + look);
  const tx = tp.x + tp.nx * car.aiLaneNow, ty = tp.y + tp.ny * car.aiLaneNow;
  const desired = Math.atan2(ty - car.y, tx - car.x);
  const err = angleDiff(car.angle, desired);
  const steer = clamp(err * 2.6, -1, 1);

  // Speed planning: fastest speed from which every upcoming corner can still be braked for
  const decel = BRAKE * 0.55;
  let target = car.top;
  for (let d = 0; d <= 900; d += 60) {
    const R = track.pts[indexAt(track, s + d)].radius;
    const vc = cornerSpeed(R * car.aiMargin, car.top);
    target = Math.min(target, Math.sqrt(vc * vc + 2 * decel * d));
  }
  let accel = spd < target;
  let brake = spd > target + 40;
  if (Math.abs(err) > 1.2 && spd > 300) { accel = false; brake = true; }

  // Stuck recovery: reverse briefly with opposite lock
  if (car.aiReverse > 0) {
    car.aiReverse -= dt;
    return { accel: false, brake: true, steer: -Math.sign(err || 1) };
  }
  if (spd < 60) car.aiStuck += dt; else car.aiStuck = 0;
  if (car.aiStuck > 1.2 || (Math.abs(err) > 2.2 && spd < 150)) {
    car.aiStuck = 0;
    car.aiReverse = 0.8;
  }
  return { accel, brake, steer };
}
