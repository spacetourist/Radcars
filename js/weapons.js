/**
 * v48 seeker missile (player only), hit spin, and boost pads (all cars).
 * Pure game logic; drawing lives in render.js.
 */
import { project, pointAt, wrapS } from './tracks.js';
import { CAR_LEN } from './physics.js';
import { clamp, angleDiff } from './util.js';

/** Missile tuning (one object so the verification scripts can read the numbers). */
export const MISSILE = {
  speed: 2000,     // wu/s (boosted car top speed is 1400)
  turn: 3.0,       // rad/s max turn rate → min turning radius = speed / turn ≈ 667 wu
  lifeMs: 3500,
  hitR: 34,        // missile-to-car-centre distance that counts as a hit
  graceMs: 200,    // first 0.2 s after launch: wall contact doesn't kill it (fired while scraping a wall)
  wallMargin: 4    // dies (MISS) when its centre gets this close to a wall
};
export const SPIN_MS = 1000;           // one full 360° spin
export const SPIN_SPEED_KEEP = 0.3;    // speed kept on impact
export const PAD_MS = 500;             // free boost from a pad
const TRAIL_EVERY_MS = 28;
const TRAIL_LIFE_MS = 650;

export function newMissileState() {
  return { charge: 1, shots: 0, hits: 0, refused: 0, flash: null, log: [], lastSource: null, inFlight: false };
}

function aheadDist(track, from, to) {
  let d = wrapS(track, to - from);
  if (d > track.length / 2) d -= track.length;
  return d;
}

/**
 * Target = a car ahead of the player in race order (not finished), preferring the one that is
 * physically nearest ahead along the track; if none of those is physically ahead within half a
 * lap, the car directly in front in race order. Returns null when the player is effectively P1.
 */
export function pickTarget(world, order) {
  const p = world.player, track = world.track;
  const idx = order.indexOf(p);
  const ahead = order.slice(0, idx).filter((c) => !c.finished);
  if (!ahead.length) return null;
  let best = null, bd = Infinity;
  for (const c of ahead) {
    const d = aheadDist(track, p.sPrev, c.sPrev);
    if (d > 40 && d < bd) { bd = d; best = c; } // must be at least partly ahead of our nose
  }
  return best || ahead[ahead.length - 1];
}

const LAUNCH_EDGE = 30; // wu inside the wall line

/** v50: `target` may be null (rocket with no car ahead: flies straight down the track); opts.rocket tags power-up missiles. */
export function launchMissile(world, target, opts = {}) {
  const p = world.player, track = world.track;
  const nose = CAR_LEN / 2 + 8;
  let x = p.x + Math.cos(p.angle) * nose, y = p.y + Math.sin(p.angle) * nose;
  let pr = project(track, x, y, p.seg);
  // a car scraping a wall must not waste the shot on the barrier: start the missile inside the road
  const lim0 = track.halfW - LAUNCH_EDGE;
  if (Math.abs(pr.lat) > lim0) { const k = pr.lat - Math.sign(pr.lat) * lim0; x -= pr.nx * k; y -= pr.ny * k; pr = project(track, x, y, pr.i); }
  const m = {
    id: (world.missileSeq = (world.missileSeq || 0) + 1),
    x, y, angle: p.angle, seg: pr.i, life: MISSILE.lifeMs, age: 0, target: target || null, dead: false, result: null,
    trail: [], trailT: 0, rocket: !!opts.rocket,
    rec: { t: world.race.time, lap: p.lap, rocket: !!opts.rocket, targetId: target ? target.id : null, dist0: target ? Math.hypot(target.x - x, target.y - y) : null, ahead0: target ? aheadDist(track, pr.s, target.sPrev) : null }
  };
  world.missiles.push(m);
  return m;
}

/** Start the spin on a hit car. */
export function spinCar(car) {
  car.spinMs = SPIN_MS;
  car.spinCount = (car.spinCount || 0) + 1;
  const v0 = Math.hypot(car.vx, car.vy);
  car.vx *= SPIN_SPEED_KEEP;
  car.vy *= SPIN_SPEED_KEEP;
  car.spinVis = 0;
  car.spinCut = [Math.round(v0), Math.round(Math.hypot(car.vx, car.vy))]; // speed before/after the hit (for the verify scripts)
}

/** Visual spin offset (radians) for drawing: one eased 360° turn over SPIN_MS. */
export function stepSpin(car, dt) {
  if (!(car.spinMs > 0)) { car.spinVis = 0; return false; }
  car.spinMs = Math.max(0, car.spinMs - dt);
  const t = 1 - car.spinMs / SPIN_MS;
  car.spinVis = Math.PI * 2 * (1 - (1 - t) * (1 - t)); // ease-out: fast at impact, settles at exactly 2π
  if (car.spinMs <= 0) car.spinVis = 0;
  return true;
}

/** Advance every missile; `onEnd(m)` fires once when a missile hits or dies. */
export function stepMissiles(world, dtMs, onEnd) {
  const { track, cars } = world;
  const dt = dtMs / 1000;
  for (const m of world.missiles) {
    for (const t of m.trail) t.ms += dtMs;
    m.trail = m.trail.filter((t) => t.ms < TRAIL_LIFE_MS);
    if (m.dead) continue;
    m.age += dtMs;
    m.life -= dtMs;
    // guidance: along the track until close, then straight at the target (with lead)
    const pr = project(track, m.x, m.y, m.seg);
    m.seg = pr.i;
    const tg = m.target;
    const dist = tg ? Math.hypot(tg.x - m.x, tg.y - m.y) : Infinity;
    const ahead = tg ? aheadDist(track, pr.s, tg.sPrev) : Infinity;
    let ax, ay;
    if (!tg) { // untargeted (v50 rocket with nobody ahead): straight down the track
      const look = pointAt(track, pr.s + 300);
      const lat = clamp(pr.lat * 0.5, -(track.halfW - 60), track.halfW - 60);
      ax = look.x + look.nx * lat; ay = look.y + look.ny * lat;
    } else if (dist < 520 || (ahead > -150 && ahead < 560)) {
      const lead = (dist / MISSILE.speed) * 0.85;
      ax = tg.x + tg.vx * lead; ay = tg.y + tg.vy * lead;
    } else {
      const look = pointAt(track, pr.s + 300);
      const lat = clamp(tg.lat * 0.5 + pr.lat * 0.3, -(track.halfW - 60), track.halfW - 60);
      ax = look.x + look.nx * lat; ay = look.y + look.ny * lat;
    }
    // keep the aim point inside the road so the pursuit doesn't cut through a wall
    const ap = project(track, ax, ay, -1);
    const lim = track.halfW - 45;
    if (Math.abs(ap.lat) > lim) { const k = ap.lat - Math.sign(ap.lat) * lim; ax -= ap.nx * k; ay -= ap.ny * k; }
    const err = angleDiff(m.angle, Math.atan2(ay - m.y, ax - m.x));
    m.angle += clamp(err, -MISSILE.turn * dt, MISSILE.turn * dt);
    // integrate in small steps, checking every car (the first one touched is hit)
    const steps = Math.max(1, Math.ceil((MISSILE.speed * dt) / 10));
    const sd = (MISSILE.speed * dt) / steps;
    const cx = Math.cos(m.angle), cy = Math.sin(m.angle);
    for (let k = 0; k < steps && !m.dead; k++) {
      m.x += cx * sd; m.y += cy * sd;
      for (const c of cars) {
        if (c.isPlayer || c.spinMs > 0) continue;
        if (Math.hypot(c.x - m.x, c.y - m.y) < MISSILE.hitR) {
          m.dead = true; m.result = 'hit'; m.hitCar = c;
          spinCar(c);
          break;
        }
      }
    }
    if (!m.dead) {
      const p2 = project(track, m.x, m.y, m.seg);
      m.seg = p2.i;
      const edge = track.halfW - MISSILE.wallMargin;
      if (Math.abs(p2.lat) > edge && m.age <= MISSILE.graceMs) { // launch grace: slide along the wall instead of dying
        const k = p2.lat - Math.sign(p2.lat) * (edge - 1); m.x -= p2.nx * k; m.y -= p2.ny * k;
      } else if (Math.abs(p2.lat) > edge) { m.dead = true; m.result = 'wall'; }
      else if (m.life <= 0) { m.dead = true; m.result = 'expired'; }
      else if (tg && aheadDist(track, p2.s, tg.sPrev) < -300) { m.dead = true; m.result = 'overshot'; } // flew past its target
    }
    m.trailT += dtMs;
    if (m.trailT >= TRAIL_EVERY_MS || m.dead) { m.trailT = 0; m.trail.push({ x: m.x - cx * 12, y: m.y - cy * 12, ms: 0 }); }
    if (m.dead) {
      m.rec.result = m.result; m.rec.flightMs = m.age; m.rec.hitId = m.hitCar ? m.hitCar.id : null;
      m.rec.hitTarget = m.hitCar === m.target;
      const pe = project(track, m.x, m.y, m.seg);
      m.rec.endLat = Math.round(pe.lat); m.rec.endR = Math.round(track.pts[pe.i].radius);
      if (tg) { m.rec.endDist = Math.round(Math.hypot(tg.x - m.x, tg.y - m.y)); m.rec.endAhead = Math.round(aheadDist(track, pe.s, tg.sPrev)); }
      (world.fx = world.fx || []).push({ x: m.x, y: m.y, ms: 0, max: m.result === 'hit' ? 700 : 450, big: m.result === 'hit' });
      onEnd(m);
    }
  }
  world.missiles = world.missiles.filter((m) => !m.dead || m.trail.length);
  if (world.fx) { for (const f of world.fx) f.ms += dtMs; world.fx = world.fx.filter((f) => f.ms < f.max); }
}

/** Boost pads: any car over a pad gets (at least) PAD_MS of boost left. */
export function stepPads(world, car) {
  const { track } = world;
  for (let i = 0; i < track.pads.length; i++) {
    const pad = track.pads[i];
    const d = wrapS(track, car.sPrev - pad.s);
    if (d < pad.len && Math.abs(car.lat - pad.lat) < pad.halfW + 10) {
      if (!(car.padMs > 0)) { car.padHits = (car.padHits || 0) + 1; car.lastPadIdx = i; }
      car.padMs = Math.max(car.padMs || 0, PAD_MS);
    }
  }
}
