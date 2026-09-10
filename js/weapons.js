import { dist, dist2, angleDiff, normalizeAngle, clamp } from './util.js';
import { applyDamage } from './physics.js';

const MAX_LIVE = 3;

export function createWeaponsState() {
  return { projectiles: [], mines: [] };
}

export function liveCount(state) {
  return state.projectiles.filter((p) => p.alive).length + state.mines.filter((m) => m.alive && m.armed).length;
}

export function tryFire(car, state, cars, track) {
  if (car.dead || car.fireCooldown > 0) return null;
  if (liveCount(state) >= MAX_LIVE) return null;
  const type = car.selectedWeapon || 'front';
  const ammo = car.weapons[type] || 0;
  if (ammo <= 0) {
    // auto-switch
    const order = ['front', 'rear', 'homing', 'mine', 'super'];
    const next = order.find((k) => (car.weapons[k] || 0) > 0);
    if (!next) return null;
    car.selectedWeapon = next;
    return tryFire(car, state, cars, track);
  }
  car.weapons[type] -= 1;
  car.fireCooldown = type === 'super' ? 500 : 280;

  const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
  if (type === 'mine') {
    const m = {
      alive: true,
      armed: false,
      armT: 400,
      x: car.x - fx * 28,
      y: car.y - fy * 28,
      owner: car.id,
      r: 12,
      type: 'mine'
    };
    state.mines.push(m);
    return { sfx: 'mine' };
  }

  let speed = 0.55;
  let life = 1800;
  let dmg = 1800;
  let homing = false;
  let angle = car.angle;
  let ox = fx * 22, oy = fy * 22;

  if (type === 'rear') {
    angle = car.angle + Math.PI;
    ox = -fx * 22; oy = -fy * 22;
    speed = 0.48;
    dmg = 1600;
  } else if (type === 'homing') {
    homing = true;
    speed = 0.42;
    life = 2400;
    dmg = 2000;
  } else if (type === 'super') {
    speed = 0.7;
    life = 2200;
    dmg = 3500;
  }

  const p = {
    alive: true,
    type,
    x: car.x + ox,
    y: car.y + oy,
    vx: Math.cos(angle) * speed + car.vx * 0.15,
    vy: Math.sin(angle) * speed + car.vy * 0.15,
    angle,
    owner: car.id,
    life,
    dmg,
    homing,
    r: type === 'super' ? 8 : 5,
    target: null
  };
  if (homing) p.target = pickTarget(car, cars);
  state.projectiles.push(p);
  return { sfx: 'fire' };
}

function pickTarget(owner, cars) {
  let best = null, bestD = Infinity;
  for (const c of cars) {
    if (c.id === owner.id || c.dead || c.finished) continue;
    const d = dist2(owner.x, owner.y, c.x, c.y);
    // prefer ahead
    const ang = Math.atan2(c.y - owner.y, c.x - owner.x);
    const ahead = Math.cos(angleDiff(owner.angle, ang));
    const score = d / (0.5 + Math.max(0, ahead));
    if (score < bestD) { bestD = score; best = c; }
  }
  return best ? best.id : null;
}

export function stepWeapons(state, cars, track, dt, onHit) {
  // arm mines
  for (const m of state.mines) {
    if (!m.alive) continue;
    if (!m.armed) {
      m.armT -= dt;
      if (m.armT <= 0) m.armed = true;
    } else {
      for (const c of cars) {
        if (c.dead) continue;
        if (c.id === m.owner && m.armT > -800) continue;
        if (dist(m.x, m.y, c.x, c.y) < m.r + c.radius) {
          m.alive = false;
          applyDamage(c, 2200 * (1 - c.armour * 0.08), 'missile');
          onHit && onHit('explode', m.x, m.y);
        }
      }
    }
  }

  for (const p of state.projectiles) {
    if (!p.alive) continue;
    p.life -= dt;
    if (p.life <= 0) { p.alive = false; continue; }

    if (p.homing && p.target != null) {
      const t = cars.find((c) => c.id === p.target && !c.dead);
      if (t) {
        const desired = Math.atan2(t.y - p.y, t.x - p.x);
        const diff = angleDiff(p.angle, desired);
        p.angle += clamp(diff, -0.004 * dt, 0.004 * dt);
        const spd = Math.hypot(p.vx, p.vy) || 0.42;
        p.vx = Math.cos(p.angle) * spd;
        p.vy = Math.sin(p.angle) * spd;
      }
    }

    p.x += p.vx * 0.57 * dt;
    p.y += p.vy * 0.57 * dt;

    // wall kill (simple: off track)
    // use outer bbox soft check — if outside outer poly roughly
    if (p.x < 0 || p.y < 0 || p.x > track.width || p.y > track.height) {
      p.alive = false;
      continue;
    }

    for (const c of cars) {
      if (c.dead || c.id === p.owner) continue;
      if (dist(p.x, p.y, c.x, c.y) < p.r + c.radius) {
        p.alive = false;
        applyDamage(c, p.dmg * (1 - c.armour * 0.08), 'missile');
        // splash tiny to nearby
        for (const o of cars) {
          if (o === c || o.dead || o.id === p.owner) continue;
          const d = dist(p.x, p.y, o.x, o.y);
          if (d < 50) applyDamage(o, p.dmg * 0.25 * (1 - d / 50), 'missile');
        }
        onHit && onHit('explode', p.x, p.y);
        break;
      }
    }
  }

  // prune occasionally
  if (state.projectiles.length > 40) state.projectiles = state.projectiles.filter((p) => p.alive);
  if (state.mines.length > 30) state.mines = state.mines.filter((m) => m.alive);
}

export function cycleWeapon(car, dir = 1) {
  const order = ['front', 'rear', 'homing', 'mine', 'super'];
  let i = order.indexOf(car.selectedWeapon);
  for (let n = 0; n < order.length; n++) {
    i = (i + dir + order.length) % order.length;
    if ((car.weapons[order[i]] || 0) > 0 || order[i] === car.selectedWeapon) {
      car.selectedWeapon = order[i];
      return;
    }
  }
}

export const WEAPON_LABELS = {
  front: 'Front Missile',
  rear: 'Rear Missile',
  homing: 'Homing',
  mine: 'Mine',
  super: 'Super Missile'
};
