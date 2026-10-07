/**
 * v54 'feel': renderer-agnostic race FX state. game.js calls stepFx() once per frame (after physics, before draw);
 * pixiRender.js and render.js only DRAW what is here, so both renderers show the same sparks / smoke / streaks /
 * rings / skid marks / boost ghosts and the same camera shake. Triggers come from world.fxEvents (game.js
 * emitFeelEvents): `wall` {car, strength, heavy, x, y, nx, ny} and `boost` {car} — the same moments the audio uses.
 *
 * Budget (assets/fx/README.md): ONE shared particle list capped at 64; skid marks are stamped into a few
 * 512×512 canvas tiles (1 px per world unit, created lazily, faded ~2 %/s one tile at a time) — never live sprites.
 * When the frame rate sags, smoke is dropped first, then streaks (quality 2 → 1 → 0). `?fx=0|1|2` pins the level.
 */
import { slip01, CHAIN_RUSH_LVL } from './physics.js';
import { CAR_LEN, CAR_WID } from './physics.js';

export const FX_CAP = 64;
export const SHAKE_PX = 4, SHAKE_MS = 150;
export const SKID_LEN = 10, SKID_STEP = SKID_LEN / 4; // stamp length (wu) and the max spacing along a tyre path
export const SKID_ON = 0.22, SKID_OFF = 0.15; // v54.3 slip01 hysteresis, shared with the squeal gate
export const SKID_TILE = 256, SKID_MAX_TILES = 64; // 256² tiles keep each re-upload small; least-recently-stamped tile is recycled past 64
const SPARK_HOT = 0xffe600, SPARK_AMBER = 0xffb347, SODIUM = 0xffb347, CYAN = 0x00e8ff;
/** v54.6 DOUBLE BOOST (GD): pink #ff2b6a second shockwave at 1.3× the cyan one, 120 ms white edge flash, 1.5× streaks. */
export const CHAIN_PINK = 0xff2b6a, CHAIN_RING_MUL = 1.3, CHAIN_FLASH_MS = 120, CHAIN_STREAK_MUL = 1.5, CHAIN_FLAME_MUL = 1.4;
/** 0..1: how far into the DOUBLE BOOST rush this car is (boostLevel above 1; eases back with the rush). */
export const chainK = (c) => Math.max(0, Math.min(1, (((c && c.boostLevel) || 0) - 1) / (CHAIN_RUSH_LVL - 1)));
/** 0..1 alpha of the white edge flash (CHAIN_FLASH_MS after a DOUBLE BOOST lands; linear fade). */
export const chainFlash = (fx, now) => { const el = now - (fx.flashAt ?? -1e9); return el >= 0 && el < CHAIN_FLASH_MS ? 1 - el / CHAIN_FLASH_MS : 0; };
const rnd = (a, b) => a + Math.random() * (b - a);

export function newFx() {
  const q = (typeof location !== 'undefined' && /[?&]fx=([012])/.exec(location.search));
  return {
    parts: [], // {k, x, y, vx, vy, rot, ms, life, s0, s1, a0, tint, frame, scr}
    skid: { tiles: new Map(), dirty: new Set(), removed: [], fadeAt: 0, fadeIdx: 0 },
    shake: { ms: 0, amp: 0, x: 0, y: 0 },
    ghosts: new Map(), // car -> [{x, y, a}] newest first (boost trail)
    pinned: q ? +q[1] : -1, quality: q ? +q[1] : 2, fpsAvg: 60, lowMs: 0, highMs: 0,
    lastStamp: new Map(), smokeAt: new Map(), skidOn: new Set(), streakAt: 0, punchAt: -1e9,
    stats: { sparks: 0, rings: 0, smoke: 0, streaks: 0, stamps: 0, heavy: 0, light: 0, boosts: 0, dropped: 0, vibrate: 0 }
  };
}

function add(fx, p) {
  if (fx.parts.length >= FX_CAP) {
    // make room: oldest smoke first, then refuse
    const i = fx.parts.findIndex((o) => o.k === 'smoke');
    if (i < 0 || p.k === 'smoke') { fx.stats.dropped++; return null; }
    fx.parts.splice(i, 1);
  }
  p.ms = 0; fx.parts.push(p); return p;
}

/** Skid stamp into the lazily created 512² tiles (1 px = 1 wu). */
function stamp(fx, x, y, a, alpha) {
  const S = SKID_TILE, r = 7;
  const i0 = Math.floor((x - r) / S), i1 = Math.floor((x + r) / S), j0 = Math.floor((y - r) / S), j1 = Math.floor((y + r) / S);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const key = i + ',' + j; let t = fx.skid.tiles.get(key);
    if (!t) {
      if (typeof document === 'undefined') continue;
      if (fx.skid.tiles.size >= SKID_MAX_TILES) { // recycle the least recently stamped tile
        let old = null; for (const o of fx.skid.tiles.values()) if (!old || o.used < old.used) old = o;
        fx.skid.tiles.delete(old.key); fx.skid.dirty.delete(old); fx.skid.removed.push(old);
      }
      const cv = document.createElement('canvas'); cv.width = cv.height = S;
      const ctx = cv.getContext && cv.getContext('2d'); if (!ctx) continue; // (node sims have no 2D canvas)
      t = { key, cv, ctx, x0: i * S, y0: j * S, used: 0 }; fx.skid.tiles.set(key, t);
    }
    t.used = fx.stats.stamps;
    const g = t.ctx; g.save(); g.translate(x - t.x0, y - t.y0); g.rotate(a);
    g.globalAlpha = alpha; g.fillStyle = '#16161c'; g.fillRect(-SKID_LEN / 2, -2.6, SKID_LEN, 5.2); g.restore();
    fx.skid.dirty.add(t);
  }
  fx.stats.stamps++;
}

function fadeSkids(fx, now) {
  const tiles = [...fx.skid.tiles.values()];
  if (!tiles.length || now < fx.skid.fadeAt) return;
  // ~2 %/s overall: each tile is faded by 2 % once a second, spread across frames (one upload at a time)
  fx.skid.fadeAt = now + 1000 / tiles.length;
  const t = tiles[fx.skid.fadeIdx++ % tiles.length];
  t.ctx.globalCompositeOperation = 'destination-out'; t.ctx.fillStyle = 'rgba(0,0,0,0.02)'; t.ctx.fillRect(0, 0, SKID_TILE, SKID_TILE);
  t.ctx.globalCompositeOperation = 'source-over'; fx.skid.dirty.add(t);
}

function wallBurst(fx, e, onScreen) {
  const c = e.car, spd = Math.max(200, e.spd || Math.hypot(c.vx, c.vy));
  // sparks fly along the car's velocity reflected off the wall (its post-impact velocity), fanned out
  const base = Math.atan2(c.vy - e.ny * spd * 0.45, c.vx - e.nx * spd * 0.45); // wallN points INTO the wall
  // v54.1 (GD): heavy = 8–10 sparks, 36–48 CSS px long (lenPx; renderers divide by zoom), fanned at varied angles
  // around the bounce direction; light scrapes unchanged (2–3 short sparks)
  const n = e.heavy ? 8 + Math.round(2 * (e.strength - 0.6) / 0.4) : 2 + (e.strength > 0.3 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const fan = e.heavy ? ((i + 0.5) / n - 0.5) * 1.9 + rnd(-0.16, 0.16) : rnd(-0.7, 0.7);
    const a = base + fan, v = rnd(260, 640) * (0.6 + 0.6 * e.strength);
    if (add(fx, { k: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: a, life: rnd(180, 320), s0: e.heavy ? 1 : rnd(0.38, 0.55), s1: e.heavy ? 0.55 : 0.12, a0: 1, lenPx: e.heavy ? rnd(36, 48) : 0, tint: i % 2 ? SPARK_AMBER : SPARK_HOT })) fx.stats.sparks++;
    if (e.heavy && i % 3 === 0) add(fx, { k: 'dot', x: e.x, y: e.y, vx: Math.cos(a) * v * 0.25, vy: Math.sin(a) * v * 0.25, rot: 0, life: 250, s0: 0.35, s1: 0.1, a0: 1, tint: SPARK_AMBER });
  }
  if (e.heavy) {
    add(fx, { k: 'glow', x: e.x, y: e.y, vx: 0, vy: 0, rot: 0, life: 120, s0: 1.6 + e.strength, s1: 2.2 + e.strength, a0: 1, tint: SODIUM });
    if (add(fx, { k: 'ring', x: e.x, y: e.y, vx: 0, vy: 0, rot: 0, life: 260, s0: 0.25, s1: 0.9, a0: 0.8, tint: SODIUM })) fx.stats.rings++;
    fx.stats.heavy++;
  } else fx.stats.light++;
  if (fx.quality >= 2) add(fx, { k: 'smoke', x: e.x, y: e.y, vx: c.vx * 0.2, vy: c.vy * 0.2, rot: rnd(0, 6.28), life: rnd(600, 800), s0: 0.3, s1: 0.8, a0: 0.4, frame: (Math.random() * 4) | 0 });
  if (c.isPlayer && e.heavy) {
    fx.shake.ms = SHAKE_MS; fx.shake.amp = SHAKE_PX * Math.min(1, 0.55 + 0.45 * e.strength);
    try { if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && !(typeof self !== 'undefined' && self.__RAD_NO_VIBRATE__)) { navigator.vibrate(18); fx.stats.vibrate++; } } catch (_) {}
  }
}

/**
 * Advance FX by dt ms. `view` = {x, y, hw, hh} world-space half extents of the screen (cull spawns), W/H = CSS px.
 */
export function stepFx(fx, world, dt, view, W, H) {
  const now = world.race.time;
  // ---- quality step-down / step-up from the real frame interval
  if (dt > 0) fx.fpsAvg += (1000 / Math.max(4, dt) - fx.fpsAvg) * 0.05;
  if (fx.pinned < 0) {
    if (fx.fpsAvg < 48) { fx.lowMs += dt; fx.highMs = 0; } else if (fx.fpsAvg > 57) { fx.highMs += dt; fx.lowMs = 0; } else { fx.lowMs = 0; fx.highMs = 0; }
    if (fx.lowMs > 2000 && fx.quality > 0) { fx.quality--; fx.lowMs = 0; }
    if (fx.highMs > 8000 && fx.quality < 2) { fx.quality++; fx.highMs = 0; }
  }
  const inView = (x, y, pad = 120) => !view || (Math.abs(x - view.x) < view.hw + pad && Math.abs(y - view.y) < view.hh + pad);
  // ---- events
  const ev = world.fxEvents || [];
  for (const e of ev) {
    if (e.type === 'wall' && inView(e.x, e.y)) wallBurst(fx, e);
    else if (e.type === 'boost' && inView(e.x, e.y)) {
      // v54.1: ONE shockwave per 0.15 crossing, left where it fired (drifts at half the car's speed), 0.3× → 1.4× and
      // gone after 260 ms — never a shield riding on the car
      const m = e.q == null ? 1 : 0.5 + 0.5 * e.q; // v54.4: a drift boost's shockwave scales with its quality
      add(fx, { k: 'ring', x: e.car.x, y: e.car.y, vx: e.car.vx * 0.5, vy: e.car.vy * 0.5, rot: 0, life: 260, s0: 0.3, s1: 1.4 * m, a0: 0.8 * m, tint: CYAN, boost: true, carId: e.car.id, q: e.q });
      add(fx, { k: 'glow', x: e.car.x, y: e.car.y, vx: e.car.vx * 0.5, vy: e.car.vy * 0.5, rot: 0, life: 140, s0: 2 * m, s1: 3 * m, a0: 0.7 * m, tint: CYAN });
      fx.stats.boosts++;
      if (e.car === world.player) fx.punchAt = now;
    }
    else if (e.type === 'boostChain') {
      // v54.6 DOUBLE BOOST (GD): a second shockwave in pink at 1.3× the cyan one + the 120 ms white edge flash
      add(fx, { k: 'ring', x: e.car.x, y: e.car.y, vx: e.car.vx * 0.5, vy: e.car.vy * 0.5, rot: 0, life: 300, s0: 0.3 * CHAIN_RING_MUL, s1: 1.4 * CHAIN_RING_MUL, a0: 0.9, tint: CHAIN_PINK, boost: true, chain: true, carId: e.car.id });
      add(fx, { k: 'glow', x: e.car.x, y: e.car.y, vx: e.car.vx * 0.5, vy: e.car.vy * 0.5, rot: 0, life: 160, s0: 2.4, s1: 3.6, a0: 0.75, tint: CHAIN_PINK });
      fx.flashAt = now; fx.stats.chains = (fx.stats.chains || 0) + 1;
    }
  }
  ev.length = 0;
  // ---- per-car: skid marks, tyre smoke, boost ghosts
  for (const c of world.cars) {
    const sl = slip01(c), near = inView(c.x, c.y, 200);
    const ca = Math.cos(c.angle), sa = Math.sin(c.angle);
    // v54.3: the squeal gate (docs/ENGINE_NOTE_SPEC.md §7 rev 3.2): on above slip01 0.22 (speed01 > 0.25), off below
    // 0.15 (or speed01 < 0.18), so skid marks, smoke and the squeal start and stop together
    const sp01 = Math.hypot(c.vx, c.vy) / 1100, wasOn = fx.skidOn.has(c);
    const on = wasOn ? !(sl < SKID_OFF || sp01 < 0.18) : sl > SKID_ON && sp01 > 0.25;
    if (on) fx.skidOn.add(c); else fx.skidOn.delete(c);
    if (on && near && !c.finished) {
      // v54.1: each rear tyre stamps along its path from last frame's position to this one, spaced ≤ ¼ stamp length,
      // so a slide at speed leaves ONE continuous mark per tyre (no dashes); per-stamp alpha is low because ~4 overlap
      const last = fx.lastStamp.get(c), wheels = [];
      for (const side of [-1, 1]) wheels.push({ x: c.x - ca * CAR_LEN * 0.32 - sa * side * CAR_WID * 0.36, y: c.y - sa * CAR_LEN * 0.32 + ca * side * CAR_WID * 0.36 });
      const a1 = 0.1 + 0.08 * sl;
      for (let k = 0; k < 2; k++) {
        const w1 = wheels[k], w0 = last ? last[k] : null;
        const dx = w0 ? w1.x - w0.x : 0, dy = w0 ? w1.y - w0.y : 0, d = Math.hypot(dx, dy);
        if (!w0 || d > 120) { stamp(fx, w1.x, w1.y, c.angle, a1); continue; } // first contact / teleport
        const ang = d > 0.5 ? Math.atan2(dy, dx) : c.angle, nSt = Math.max(1, Math.ceil(d / SKID_STEP));
        for (let i = 1; i <= nSt; i++) stamp(fx, w0.x + dx * i / nSt, w0.y + dy * i / nSt, ang, a1);
      }
      fx.lastStamp.set(c, wheels);
      if (fx.quality >= 2 && now >= (fx.smokeAt.get(c) || 0)) {
        fx.smokeAt.set(c, now + 140 - 80 * sl);
        const side = Math.random() < 0.5 ? -1 : 1;
        if (add(fx, { k: 'smoke', x: c.x - ca * CAR_LEN * 0.4 - sa * side * CAR_WID * 0.3, y: c.y - sa * CAR_LEN * 0.4 + ca * side * CAR_WID * 0.3, vx: c.vx * 0.15, vy: c.vy * 0.15, rot: rnd(0, 6.28), life: rnd(600, 900), s0: 0.22, s1: 0.7, a0: 0.3 + 0.2 * sl, frame: (Math.random() * 4) | 0 })) fx.stats.smoke++;
      }
    } else fx.lastStamp.delete(c);
    // boost ghosts: 4 past poses, sampled every 45 ms, while boostLevel > 0.15
    const lvl = c.boostLevel || 0;
    if (lvl > 0.15 && near) {
      let g = fx.ghosts.get(c); if (!g) { g = { at: 0, pts: [] }; fx.ghosts.set(c, g); }
      if (now >= g.at) { g.at = now + 45; g.pts.unshift({ x: c.x, y: c.y, a: c.angle }); if (g.pts.length > 4) g.pts.length = 4; }
      g.level = lvl;
    } else fx.ghosts.delete(c);
  }
  // ---- speed streaks (screen space) above 80 % of top speed
  const p = world.player, frac = Math.hypot(p.vx, p.vy) / (p.top || 1000);
  const ck = chainK(p), sMul = 1 + (CHAIN_STREAK_MUL - 1) * ck; // v54.6: ~1.5× the streaks during the DOUBLE BOOST rush
  if (fx.quality >= 1 && frac > 0.8 && !p.finished && now >= fx.streakAt && fx.parts.filter((o) => o.k === 'streak').length < Math.round(6 * sMul)) {
    const k = Math.min(1, (frac - 0.8) / 0.2);
    fx.streakAt = now + (70 - 30 * k) / sMul;
    // v54.2 (GD): streaks follow the car's on-screen direction of travel (the camera never rotates, so that is the
    // velocity direction): each line lies along it, flows backwards past the car, and spawns near the screen edges on
    // either side of that direction (and from ahead, so it sweeps across the side band)
    // v54.3 (GD): ...and only inside the clear area between the HUD pills and the control cluster (fx.clear, measured
    // from the DOM by game.js; whole screen minus 12 px when unknown), the whole line inside it at spawn
    const sp = Math.hypot(p.vx, p.vy) || 1, dx = p.vx / sp, dy = p.vy / sp, nx = -dy, ny = dx;
    const C = streakBand(fx, W, H), cx = (C.x0 + C.x1) / 2, cy = (C.y0 + C.y1) / 2, bw = C.x1 - C.x0, bh = C.y1 - C.y0;
    const edge = (ux, uy) => Math.min(Math.abs(ux) > 1e-3 ? bw / 2 / Math.abs(ux) : 1e9, Math.abs(uy) > 1e-3 ? bh / 2 / Math.abs(uy) : 1e9);
    const side = Math.random() < 0.5 ? -1 : 1, off = edge(nx, ny) * rnd(0.74, 0.96), along = edge(dx, dy) * rnd(-0.2, 1.0);
    let sc = rnd(0.35, 0.6);
    // keep both tips ≥ STREAK_FADE_PX inside the band (shorter lines when the band is small)
    const room = (span, u) => (Math.abs(u) > 1e-3 ? (span / 2 - STREAK_FADE_PX - 2) / (STREAK_HALF * Math.abs(u)) : 9);
    sc = Math.min(sc, room(bw, dx), room(bh, dy));
    if (sc >= 0.12) {
      const hx = STREAK_HALF * sc * Math.abs(dx) + STREAK_FADE_PX + 1, hy = STREAK_HALF * sc * Math.abs(dy) + STREAK_FADE_PX + 1;
      let x = 0, y = 0, okSpawn = false;
      for (let tries = 0; tries < 4 && !okSpawn; tries++) { // v54.4: keep clear of the minimap / toast pills too
        const sd = tries ? (Math.random() < 0.5 ? -1 : 1) : side, of = tries ? edge(nx, ny) * rnd(0.3, 0.96) : off, al = tries ? edge(dx, dy) * rnd(-0.6, 1.0) : along;
        x = clampN(cx + nx * sd * of + dx * al, C.x0 + hx, C.x1 - hx); y = clampN(cy + ny * sd * of + dy * al, C.y0 + hy, C.y1 - hy);
        okSpawn = obsClear(C.obs, x, y, dx, dy, STREAK_HALF * sc) > STREAK_FADE_PX + 2;
      }
      const v = rnd(1500, 2400);
      if (okSpawn && add(fx, { k: 'streak', scr: true, x, y, vx: -dx * v, vy: -dy * v, dx, dy, rot: Math.atan2(dy, dx) - Math.PI / 2, life: rnd(200, 350), s0: sc, s1: sc, a0: 0.15 + 0.2 * k, tint: 0xffffff, band: C, fade: 1 })) fx.stats.streaks++;
    }
  }
  // ---- integrate + expire
  const s = dt / 1000;
  for (let i = fx.parts.length - 1; i >= 0; i--) {
    const o = fx.parts[i]; o.ms += dt;
    if (o.ms >= o.life) { fx.parts.splice(i, 1); continue; }
    if (o.follow) { o.x = o.follow.x; o.y = o.follow.y; }
    o.x += o.vx * s; o.y += o.vy * s;
    if (o.band) { // v54.3: fade over the last STREAK_FADE_PX before the HUD / controls / screen side, gone once the tip is out
      const B = o.band, h = STREAK_HALF * o.s0, tx = o.x - o.dx * h, ty = o.y - o.dy * h; // leading tip (moves along −d)
      const m = Math.min(tx - B.x0, B.x1 - tx, ty - B.y0, B.y1 - ty, obsClear(fx.clear && fx.clear.obs, o.x, o.y, o.dx, o.dy, h));
      o.fade = Math.max(0, Math.min(1, m / STREAK_FADE_PX));
      if (m <= 0) { fx.parts.splice(i, 1); continue; }
    }
    if (o.k === 'spark') { o.vx *= Math.exp(-4 * s); o.vy *= Math.exp(-4 * s); }
    if (o.k === 'smoke') { o.vx *= Math.exp(-2 * s); o.vy *= Math.exp(-2 * s); o.rot += 0.6 * s; }
  }
  // ---- camera shake (screen px, decays over SHAKE_MS)
  const sh = fx.shake;
  if (sh.ms > 0) { sh.ms = Math.max(0, sh.ms - dt); const k = sh.ms / SHAKE_MS, a = sh.amp * k * k, t = Math.random() * 6.283; sh.x = Math.cos(t) * a; sh.y = Math.sin(t) * a; } else { sh.x = sh.y = 0; }
  fadeSkids(fx, now);
}

const STREAK_HALF = 160;    // CSS px half-length of a streak at scale 1 (Pixi frame 320 px, Canvas 300 px)
const STREAK_FADE_PX = 24; // v54.3 (GD): fade-out distance before the HUD / controls
const clampN = (v, a, b) => (b < a ? (a + b) / 2 : Math.max(a, Math.min(b, v)));
/** v54.4: smallest distance (CSS px, negative inside) from a streak (centre x,y, direction d, half-length h) to the obstacles. */
function obsClear(obs, x, y, dx, dy, h) {
  if (!obs || !obs.length) return 1e9;
  let m = 1e9;
  for (const r of obs) for (const k of [-1, -0.5, 0, 0.5, 1]) {
    const px = x + dx * h * k, py = y + dy * h * k;
    const ox = Math.max(r.l - px, 0, px - r.r), oy = Math.max(r.t - py, 0, py - r.b);
    const d = ox || oy ? Math.hypot(ox, oy) : -Math.min(px - r.l, r.r - px, py - r.t, r.b - py);
    if (d < m) m = d;
  }
  return m;
}
/** v54.3: the clear rectangle streaks live in (screen CSS px): fx.clear from game.js, else the screen minus 12 px. */
export function streakBand(fx, W, H) {
  const c = fx.clear, m = 12;
  if (!c || c.W !== W || c.H !== H) return { x0: m, y0: m, x1: W - m, y1: H - m };
  return { x0: Math.max(m, c.x0), y0: Math.max(m, c.y0), x1: Math.min(W - m, c.x1), y1: Math.min(H - m, c.y1), obs: c.obs };
}

/** Particle look at time t: {scale, alpha}. */
export function partLook(o) {
  const t = o.ms / o.life;
  let a = o.a0 * (1 - t);
  if (o.k === 'spark' || o.k === 'streak') a = o.a0 * (t < 0.7 ? 1 : (1 - t) / 0.3);
  if (o.fade != null) a *= o.fade;
  return { scale: o.s0 + (o.s1 - o.s0) * t, alpha: Math.max(0, a), t };
}

/**
 * v54.1 boost zoom punch → camera zoom multiplier. On the player's 0.15 crossing the view kicks out 8 % in 80 ms
 * (ease-out), then eases back over 600 ms to a mild 3 % hold scaled by boostLevel (0 when the boost is over).
 */
export const PUNCH = { kick: 0.08, kickMs: 80, settleMs: 600, hold: 0.03 };
export function zoomPunch(fx, now, lvl) {
  const hold = PUNCH.hold * lvl, el = now - fx.punchAt;
  let k = hold;
  if (el >= 0 && el < PUNCH.kickMs) { const t = el / PUNCH.kickMs; k = Math.max(hold, PUNCH.kick * (1 - (1 - t) * (1 - t))); }
  else if (el >= PUNCH.kickMs && el < PUNCH.kickMs + PUNCH.settleMs) { const t = (el - PUNCH.kickMs) / PUNCH.settleMs, e = t * t * (3 - 2 * t); k = PUNCH.kick + (hold - PUNCH.kick) * e; }
  return 1 - k;
}
