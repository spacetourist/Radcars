/**
 * v50 bonus boxes + power-ups (player only).
 * - One row of 2–3 '?' boxes per track (track.bonus). Driving through a box collects it (if the
 *   player isn't already holding a power-up); it stays gone until the player next crosses the line.
 * - ROCKET: 3 missiles 0.25 s apart at 3 different cars ahead (reuses the v48 missile).
 * - LAP BOOST: v47-strength boost until the player next crosses the line (min 2 s), green flames.
 * - AUTOPILOT: 10 s locked to the centreline, throttle on, +25 % top speed, then control is handed back.
 */
import { pointAt, wrapS } from './tracks.js';
import { angleDiff, clamp } from './util.js';
import { CAR_LEN, CAR_WID } from './physics.js';

export const POWERS = ['rocket', 'lapboost', 'autopilot'];
export const POWER_INFO = {
  rocket: { name: 'ROCKET', color: '#ff4d5e', blurb: '3 missiles' },
  lapboost: { name: 'LAP BOOST', color: '#39ff14', blurb: 'boost to the line' },
  autopilot: { name: 'AUTOPILOT', color: '#00e8ff', blurb: '10 s, extra fast' }
};
export const ROCKET_COUNT = 3;
export const ROCKET_GAP_MS = 250;
export const LAPBOOST_MIN_MS = 2000;
export const AUTOPILOT_HANDBACK_MS = 1500;
export const AUTOPILOT_MS = 10000;
export const AUTOPILOT_TOP_MUL = 1.25;   // 1000 → 1250 wu/s
export const AUTOPILOT_YAW = 8;          // rad/s yaw limit while on the rail (min radius ≈ 156 wu at 1250)
const AUTOPILOT_ENTRY_MS = 800;          // lateral offset eases to the centreline over this time
const AUTOPILOT_P1_WEIGHT = 0.5;         // autopilot is half as likely when you're already leading

export function newPowerState() {
  return {
    held: null, active: null, activeMs: 0, startMs: 0, untilLap: null,
    collected: [], respawns: 0, collects: [], activations: [], ignored: 0, blocked: 0,
    rocketQueue: [], rocketLog: [], rocketTargets: [], flash: null, forceNext: null,
    ap: null, handback: null, apLog: [], lapBoostLog: []
  };
}

function aheadDist(track, from, to) {
  let d = wrapS(track, to - from);
  if (d > track.length / 2) d -= track.length;
  return d;
}

/** Random power-up (equal odds; autopilot halved when in P1). `forceNext` (debug) wins. */
export function rollPower(pw, place) {
  if (pw.forceNext) { const f = pw.forceNext; pw.forceNext = null; return f; }
  const w = [1, 1, place === 1 ? AUTOPILOT_P1_WEIGHT : 1];
  let r = Math.random() * (w[0] + w[1] + w[2]);
  for (let i = 0; i < 3; i++) { if ((r -= w[i]) < 0) return POWERS[i]; }
  return POWERS[2];
}

/** Player drives through a box → collect it (only when not already holding one). */
export function stepBonus(world, place, onCollect) {
  const { track, player: p, power: pw } = world;
  const b = track.bonus;
  if (!b || p.finished) return;
  const d = aheadDist(track, b.s, p.sPrev);
  if (Math.abs(d) > b.half + CAR_LEN * 0.45) { pw.touching = false; return; }
  for (const box of b.boxes) {
    if (pw.collected[box.i]) continue;
    if (Math.abs(p.lat - box.lat) > b.half + CAR_WID / 2) continue;
    if (pw.held) { if (!pw.touching) pw.ignored++; pw.touching = true; return; } // one at a time: box stays
    pw.collected[box.i] = true;
    pw.held = rollPower(pw, place);
    pw.collects.push({ t: world.race.time, lap: p.lap, box: box.i, power: pw.held });
    (world.fx = world.fx || []).push({ x: box.x, y: box.y, ms: 0, max: 600, kind: 'bonus' });
    onCollect && onCollect(pw.held);
    return;
  }
}

/** Up to `n` distinct cars ahead in race order, nearest-physically-ahead first. */
export function rocketTargets(world, order, n = ROCKET_COUNT) {
  const p = world.player, track = world.track;
  const idx = order.indexOf(p);
  const ahead = order.slice(0, idx).filter((c) => !c.finished);
  const withD = ahead.map((c) => ({ c, d: aheadDist(track, p.sPrev, c.sPrev) }));
  const front = withD.filter((x) => x.d > 40).sort((a, b) => a.d - b.d).map((x) => x.c);
  const rest = ahead.filter((c) => !front.includes(c)).reverse(); // nearest in race order first
  return front.concat(rest).slice(0, n);
}

/** Autopilot: steer to the centreline with a short pure-pursuit look-ahead, throttle pinned. */
export function autopilotControl(world, dtMs) {
  const { player: p, track, power: pw } = world;
  const ap = pw.ap;
  const dt = dtMs / 1000;
  const spd = Math.hypot(p.vx, p.vy);
  const el = world.race.time - pw.startMs;
  const k = clamp(1 - el / AUTOPILOT_ENTRY_MS, 0, 1);
  const latTarget = ap.entryLat * k * k; // ease in towards the centre
  railSteer(p, track, spd, latTarget, dt, 1);
  return { accel: true, brake: false, steer: 0, autopilot: true };
}

/**
 * v52 finish cruise: after the line the player's car rolls on along the autopilot rail (centreline) at a gentle speed
 * while the reveal plays and the rivals finish. The lateral offset eases to the centre over ~1.2 s.
 */
export function cruiseControl(car, track, dtMs, el) {
  const spd = Math.hypot(car.vx, car.vy);
  const k = clamp(1 - el / 1200, 0, 1);
  railSteer(car, track, spd, (car.cruiseLat0 || 0) * k * k, dtMs / 1000, 1);
  return { accel: true, brake: false, steer: 0, autopilot: true };
}

/** Pure-pursuit heading correction toward the centreline (+latTarget); weight w scales yaw rate and slip removal. */
function railSteer(p, track, spd, latTarget, dt, w) {
  const look = 90 + spd * 0.06;         // ~165 wu at 1250 wu/s: corner cut ≈ look²/2R ≤ 45 wu on the tightest bends
  const tp = pointAt(track, p.sPrev + look);
  const tx = tp.x + tp.nx * latTarget, ty = tp.y + tp.ny * latTarget;
  const err = angleDiff(p.angle, Math.atan2(ty - p.y, tx - p.x));
  p.angle += clamp(err, -AUTOPILOT_YAW * w * dt, AUTOPILOT_YAW * w * dt);
  // on the rail: no sideways slip (partial while handing back)
  const fx = Math.cos(p.angle), fy = Math.sin(p.angle);
  const vF = Math.max(0, p.vx * fx + p.vy * fy);
  p.vx += (fx * vF - p.vx) * w; p.vy += (fy * vF - p.vy) * w;
}

/**
 * Handback (after the 10 s): for AUTOPILOT_HANDBACK_MS the assist fades out (weight w 1→0). While the
 * player isn't steering it keeps nudging the car along the road; any steering input takes over at once.
 */
export function handbackAssist(world, dtMs, ctl, w) {
  const p = world.player;
  if (Math.abs(ctl.steer || 0) > 0.05) return ctl;
  const lat = clamp(p.lat, -world.track.halfW * 0.5, world.track.halfW * 0.5);
  railSteer(p, world.track, Math.hypot(p.vx, p.vy), lat, dtMs / 1000, w);
  return ctl;
}

/** Per-frame autopilot stats (after physics + collisions). */
export function trackAutopilot(world) {
  const { player: p, power: pw } = world;
  const ap = pw.ap; if (!ap) return;
  const spd = Math.hypot(p.vx, p.vy);
  if (p.wallHit > 0) { if (!ap.inWall) { ap.wall++; (ap.wallAt = ap.wallAt || []).push({ el: Math.round(world.race.time - pw.startMs), lat: Math.round(p.lat), wh: Math.round(p.wallHit), entryLat: Math.round(ap.entryLat) }); } ap.inWall = true; } else ap.inWall = false;
  if (world.race.time - pw.startMs > AUTOPILOT_ENTRY_MS) {
    const dev = Math.abs(p.lat);
    ap.devSum += dev; ap.devN++; ap.devMax = Math.max(ap.devMax, dev);
    ap.spdSum += spd; ap.spdMax = Math.max(ap.spdMax, spd);
  }
}
