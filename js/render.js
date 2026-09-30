/** Plain Canvas 2D renderer: flat ground, asphalt ribbon with kerbs + walls, start line, procedural cars. */
import { CAR_LEN, CAR_WID } from './physics.js';
import { pointAt } from './tracks.js';

const KERB = 16;
const WALL = 12;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let W = 0, H = 0, DPR = 1;
  const cache = new WeakMap();

  function resize(w, h, dpr) {
    W = w; H = h; DPR = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }

  function trackPaths(track) {
    let c = cache.get(track);
    if (c) return c;
    const centre = new Path2D();
    track.pts.forEach((p, i) => (i ? centre.lineTo(p.x, p.y) : centre.moveTo(p.x, p.y)));
    centre.closePath();
    const wallL = new Path2D(), wallR = new Path2D();
    track.left.forEach((p, i) => (i ? wallL.lineTo(p.x, p.y) : wallL.moveTo(p.x, p.y)));
    track.right.forEach((p, i) => (i ? wallR.lineTo(p.x, p.y) : wallR.moveTo(p.x, p.y)));
    wallL.closePath(); wallR.closePath();
    c = { centre, wallL, wallR };
    cache.set(track, c);
    return c;
  }

  function drawTrack(track) {
    const { centre, wallL, wallR } = trackPaths(track);
    const w = track.halfW * 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // wall band (outside the asphalt edge)
    ctx.strokeStyle = '#111217';
    ctx.lineWidth = w + WALL * 2;
    ctx.stroke(centre);
    // kerbs: red base + white dashes, then asphalt over the middle
    ctx.strokeStyle = '#d42a2a';
    ctx.lineWidth = w;
    ctx.stroke(centre);
    ctx.setLineDash([60, 60]);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#f2f2f2';
    ctx.stroke(centre);
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    ctx.strokeStyle = track.asphalt;
    ctx.lineWidth = w - KERB * 2;
    ctx.stroke(centre);
    // walls
    ctx.strokeStyle = track.wall;
    ctx.lineWidth = 6;
    ctx.stroke(wallL);
    ctx.stroke(wallR);
    // faint centre dashes
    ctx.setLineDash([50, 90]);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 6;
    ctx.stroke(centre);
    ctx.setLineDash([]);
    drawPads(track);
    drawStartLine(track);
  }

  /** Boost pads: amber chevrons on the asphalt pointing in the direction of travel. */
  function drawPads(track) {
    for (const pad of track.pads || []) {
      const hw = pad.halfW, L = pad.len;
      ctx.save();
      ctx.translate(pad.x, pad.y);
      ctx.rotate(pad.angle);
      ctx.fillStyle = 'rgba(255,176,0,0.16)';
      ctx.fillRect(0, -hw, L, hw * 2);
      ctx.strokeStyle = 'rgba(255,176,0,0.55)';
      ctx.lineWidth = 3;
      ctx.strokeRect(0, -hw, L, hw * 2);
      ctx.fillStyle = 'rgba(255,176,0,0.8)';
      const cw = Math.min(26, L / 5), tip = Math.min(42, hw * 0.5);
      for (const x0 of [L * 0.12, L * 0.42, L * 0.72]) {
        ctx.beginPath();
        ctx.moveTo(x0, -hw * 0.82);
        ctx.lineTo(x0 + tip, 0);
        ctx.lineTo(x0, hw * 0.82);
        ctx.lineTo(x0 - cw, hw * 0.82);
        ctx.lineTo(x0 + tip - cw, 0);
        ctx.lineTo(x0 - cw, -hw * 0.82);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawStartLine(track) {
    const p = pointAt(track, 0);
    const ang = Math.atan2(p.ty, p.tx);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang);
    const half = track.halfW - KERB;
    const sq = 16;
    const rows = Math.ceil((half * 2) / sq);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#111' : '#fff';
        ctx.fillRect(-sq * 1.5 + c * sq, -half + r * sq, sq, Math.min(sq, half * 2 - r * sq));
      }
    }
    ctx.restore();
  }

  /**
   * Procedural top-down car. Local frame: +X = nose = car.angle (the physics
   * heading, which equals atan2(vy, vx) when gripping), +Y = the car's right.
   * The body is LONG along X and narrow along Y, the nose tapers, wheels are
   * elongated along X, a racing stripe runs nose-to-tail, the windscreen sits
   * ahead of the roof and the red tail-lights mark the back, so the direction
   * of travel reads unambiguously even at the far chase-cam zoom.
   */
  function drawCar(car, zoom) {
    // keep cars readable when the chase cam pulls far out (min ~34px long on screen)
    const s = Math.max(1, 34 / (CAR_LEN * zoom));
    const L = CAR_LEN * s, Wd = CAR_WID * 0.88 * s;
    const hl = L / 2, hw = Wd / 2;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle + (car.spinVis || 0)); // spinVis: v48 missile-hit 360° spin (0 otherwise)
    if (debugCars) {
      const m = ctx.getTransform();
      debugCars.push({ id: car.id, isPlayer: car.isPlayer, x: car.x, y: car.y, vx: car.vx, vy: car.vy, angle: car.angle, L, W: Wd,
        spinning: car.spinMs > 0, spinVis: car.spinVis || 0,
        // screen-space images of the local length axis (+X, nose) and width axis (+Y)
        lenAxis: { x: m.a * hl, y: m.b * hl }, widAxis: { x: m.c * hw, y: m.d * hw }, origin: { x: m.e, y: m.f } });
    }
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    bodyPath(hl, hw, 3 * s, 4 * s);
    ctx.fill();
    // wheels: dark blocks elongated along the direction of travel, poking out of the body sides
    ctx.fillStyle = '#0b0b0e';
    const wl = L * 0.2, ww = Wd * 0.2;
    for (const fx of [hl * 0.56, -hl * 0.6]) {
      ctx.fillRect(fx - wl / 2, -hw - ww * 0.35, wl, ww);
      ctx.fillRect(fx - wl / 2, hw - ww * 0.65, wl, ww);
    }
    // body (tapered towards the nose at +X)
    ctx.fillStyle = car.color;
    bodyPath(hl, hw, 0, 0);
    ctx.fill();
    ctx.lineWidth = (car.isPlayer ? 3.5 : 1.8) * s;
    ctx.strokeStyle = car.isPlayer ? '#ffffff' : 'rgba(0,0,0,0.65)';
    ctx.stroke();
    // racing stripe nose-to-tail
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(-hl + 3 * s, -Wd * 0.07, L - 6 * s, Wd * 0.14);
    // cabin: windscreen (front, wide trapezoid), roof, rear window
    ctx.fillStyle = '#0d1a26';
    ctx.beginPath();
    ctx.moveTo(L * 0.02, -hw * 0.78);
    ctx.lineTo(L * 0.2, -hw * 0.58);
    ctx.lineTo(L * 0.2, hw * 0.58);
    ctx.lineTo(L * 0.02, hw * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(-L * 0.24, -hw * 0.74, L * 0.26, hw * 1.48);
    ctx.fillStyle = 'rgba(13,26,38,0.8)';
    ctx.fillRect(-L * 0.33, -hw * 0.62, L * 0.08, hw * 1.24);
    // headlights at the nose, tail-lights at the back
    ctx.fillStyle = '#fff6c0';
    ctx.fillRect(hl - 6 * s, -hw * 0.62, 4 * s, hw * 0.4);
    ctx.fillRect(hl - 6 * s, hw * 0.22, 4 * s, hw * 0.4);
    ctx.fillStyle = '#ff2020';
    ctx.fillRect(-hl + 1 * s, -hw * 0.8, 3 * s, hw * 0.45);
    ctx.fillRect(-hl + 1 * s, hw * 0.35, 3 * s, hw * 0.45);
    ctx.restore();
    if (car.isPlayer) {
      // marker above the player's car
      ctx.save();
      ctx.translate(car.x, car.y - (L / 2 + 22 * s));
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-9 * s, -12 * s); ctx.lineTo(9 * s, -12 * s); ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /** Car body outline: square-ish tail at -X, tapered rounded nose at +X. */
  function bodyPath(hl, hw, ox, oy) {
    const r = hw * 0.45;
    ctx.beginPath();
    ctx.moveTo(-hl + r + ox, -hw + oy);
    ctx.lineTo(hl * 0.45 + ox, -hw + oy);
    ctx.quadraticCurveTo(hl + ox, -hw * 0.8 + oy, hl + ox, oy);
    ctx.quadraticCurveTo(hl + ox, hw * 0.8 + oy, hl * 0.45 + ox, hw + oy);
    ctx.lineTo(-hl + r + ox, hw + oy);
    ctx.quadraticCurveTo(-hl + ox, hw + oy, -hl + ox, hw - r + oy);
    ctx.lineTo(-hl + ox, -hw + r + oy);
    ctx.quadraticCurveTo(-hl + ox, -hw + oy, -hl + r + ox, -hw + oy);
    ctx.closePath();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  let debugCars = null;

  function draw(world) {
    const { track, cars, cam } = world;
    debugCars = (typeof window !== 'undefined' && window.__RAD_DEBUG__) ? [] : null;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = track.ground;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    drawTrack(track);
    drawBonus(world, cam.zoom);
    for (const m of world.missiles || []) drawTrail(m, cam.zoom);
    for (const c of cars) {
      if (c.isPlayer) continue;
      if (c.boostLevel > 0.02) drawBoostFlame(c, cam.zoom, world.race.time + c.id * 97);
      drawCar(c, cam.zoom);
    }
    const autopilot = world.power && world.power.active === 'autopilot';
    if (autopilot) drawAutopilotGlow(world.player, cam.zoom, world.race.time, world.power.activeMs, false);
    if (world.player.boostLevel > 0.02) drawBoostFlame(world.player, cam.zoom, world.race.time);
    drawCar(world.player, cam.zoom);
    if (autopilot) drawAutopilotGlow(world.player, cam.zoom, world.race.time, world.power.activeMs, true);
    for (const m of world.missiles || []) if (!m.dead) drawMissile(m, cam.zoom);
    for (const f of world.fx || []) drawFx(f, cam.zoom);
    ctx.restore();
    drawMinimap(world);
    if (debugCars) window.__RAD_DEBUG__.frame = { cars: debugCars, cam: { ...cam }, W, H, DPR };
  }

  /**
   * Boost cue behind the player's car (drawn before the car so it sits underneath):
   * a flickering orange/yellow exhaust flame from the tail plus a few speed streaks.
   * Sized with the same readability scale as drawCar; the car itself is not changed.
   */
  function drawBoostFlame(car, zoom, tMs) {
    const lvl = car.boostLevel;
    if (car.spinMs > 0) return;
    const s = Math.max(1, 34 / (CAR_LEN * zoom));
    const hl = CAR_LEN * s / 2, hw = CAR_WID * 0.88 * s / 2;
    const fl = 0.85 + 0.15 * Math.sin(tMs * 0.047) + 0.08 * Math.sin(tMs * 0.113);
    const len = (26 + 34 * lvl) * s * fl;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    ctx.globalAlpha = Math.min(1, lvl * 1.4);
    // speed streaks (behind and beside the body)
    const green = !!car.boostGreen; // v50 LAP BOOST power-up: bright green burner
    ctx.strokeStyle = green ? 'rgba(120,255,110,0.6)' : 'rgba(255,190,90,0.55)';
    ctx.lineWidth = 2.2 * s;
    ctx.lineCap = 'round';
    for (const [dy, k] of [[-hw * 1.35, 1], [hw * 1.35, 0.8], [-hw * 0.7, 0.55], [hw * 0.7, 0.65]]) {
      const ph = ((tMs * 0.004 + k * 3.1) % 1);
      const x0 = -hl - 10 * s - ph * 30 * s;
      ctx.beginPath(); ctx.moveTo(x0, dy); ctx.lineTo(x0 - (30 + 40 * k) * s * lvl, dy); ctx.stroke();
    }
    // two exhaust flames at the tail: outer orange, inner hot yellow
    for (const side of [-1, 1]) {
      const y = side * hw * 0.42;
      ctx.fillStyle = green ? 'rgba(57,255,20,0.92)' : 'rgba(255,90,20,0.9)';
      ctx.beginPath();
      ctx.moveTo(-hl + 2 * s, y - 6.5 * s);
      ctx.quadraticCurveTo(-hl - len * 0.55, y - 5 * s, -hl - len, y);
      ctx.quadraticCurveTo(-hl - len * 0.55, y + 5 * s, -hl + 2 * s, y + 6.5 * s);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = green ? 'rgba(215,255,190,0.97)' : 'rgba(255,205,40,0.95)';
      ctx.beginPath();
      ctx.moveTo(-hl + 2 * s, y - 3.5 * s);
      ctx.quadraticCurveTo(-hl - len * 0.35, y - 2.5 * s, -hl - len * 0.6, y);
      ctx.quadraticCurveTo(-hl - len * 0.35, y + 2.5 * s, -hl + 2 * s, y + 3.5 * s);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  /**
   * v50 bonus boxes: a row of glowing, gently rocking '?' boxes across the road. Collected boxes
   * are hidden until the player next crosses the line. The '?' stays upright on screen.
   */
  function drawBonus(world, zoom) {
    const b = world.track.bonus;
    if (!b) return;
    const taken = (world.power && world.power.collected) || [];
    const tm = (world.race.time || 0) + (world.race.countdown > 0 ? (3800 - world.race.countdown) : 0);
    const s = Math.max(1, 20 / (b.half * 2 * zoom)); // keep ≥ ~20 px on screen at the far chase zoom
    for (const box of b.boxes) {
      if (taken[box.i]) continue;
      const h = b.half * s;
      const pulse = 0.5 + 0.5 * Math.sin(tm * 0.006 + box.i * 1.7);
      ctx.save();
      ctx.translate(box.x, box.y);
      // glow
      ctx.fillStyle = `rgba(255,214,60,${(0.16 + 0.14 * pulse).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(0, 0, h * 1.75, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.rotate(b.angle + 0.35 * Math.sin(tm * 0.0032 + box.i)); // rocking spin
      ctx.fillStyle = '#6a2cff';
      roundRect(-h, -h, h * 2, h * 2, h * 0.28); ctx.fill();
      ctx.lineWidth = Math.max(2, h * 0.16);
      ctx.strokeStyle = `rgb(255,${Math.round(200 + 40 * pulse)},60)`;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(1, h * 0.06);
      roundRect(-h * 0.72, -h * 0.72, h * 1.44, h * 1.44, h * 0.18); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#fff6c0';
      ctx.font = `bold ${Math.round(h * 1.45)}px "Russo One", Impact, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, h * 0.06);
      ctx.restore();
    }
  }

  /** v50 AUTOPILOT cue: cyan halo under the car and a cyan outline ring over it (the car itself is unchanged). */
  function drawAutopilotGlow(car, zoom, tMs, leftMs, over) {
    const s = Math.max(1, 34 / (CAR_LEN * zoom));
    const hl = CAR_LEN * s / 2, hw = CAR_WID * 0.88 * s / 2;
    const pulse = 0.5 + 0.5 * Math.sin(tMs * 0.012);
    const fade = leftMs < 1500 ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(tMs * 0.03)) : 1; // blink as it runs out
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    if (!over) {
      ctx.fillStyle = `rgba(0,232,255,${(0.22 * fade).toFixed(3)})`;
      roundRect(-hl - 12 * s, -hw - 12 * s, (hl + 12 * s) * 2, (hw + 12 * s) * 2, 16 * s); ctx.fill();
    } else {
      ctx.strokeStyle = `rgba(0,232,255,${((0.65 + 0.35 * pulse) * fade).toFixed(3)})`;
      ctx.lineWidth = 3 * s;
      roundRect(-hl - 6 * s, -hw - 6 * s, (hl + 6 * s) * 2, (hw + 6 * s) * 2, 11 * s); ctx.stroke();
    }
    ctx.restore();
  }

  /** Seeker missile: white body, red nose, fins, small exhaust flame (+X = direction of flight). */
  function drawMissile(m, zoom) {
    const s = Math.max(1, 18 / (26 * zoom));
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.angle);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(255,150,40,0.9)';
    ctx.beginPath(); ctx.moveTo(-12, -3); ctx.lineTo(-22 - Math.random() * 6, 0); ctx.lineTo(-12, 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c9ccd6';
    ctx.beginPath(); ctx.moveTo(-9, -3.5); ctx.lineTo(-14, -8); ctx.lineTo(-14, 8); ctx.lineTo(-9, 3.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f4f4f8';
    ctx.fillRect(-12, -3.5, 20, 7);
    ctx.fillStyle = '#ff2a2a';
    ctx.beginPath(); ctx.moveTo(8, -3.5); ctx.quadraticCurveTo(15, -2, 16, 0); ctx.quadraticCurveTo(15, 2, 8, 3.5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
    ctx.strokeRect(-12, -3.5, 20, 7);
    ctx.restore();
  }

  /** Smoke trail: grey puffs that grow and fade. */
  function drawTrail(m, zoom) {
    const s = Math.max(1, 18 / (26 * zoom));
    for (const t of m.trail) {
      const k = t.ms / 650;
      ctx.fillStyle = `rgba(210,212,220,${(0.55 * (1 - k)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, (4 + 14 * k) * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Explosion (hit) or small puff (wall / expired). */
  function drawFx(f, zoom) {
    const s = Math.max(1, 34 / (64 * zoom));
    const k = f.ms / f.max;
    ctx.save();
    if (f.kind === 'bonus') { // v50: collect sparkle
      ctx.strokeStyle = `rgba(255,230,90,${(1 - k).toFixed(3)})`;
      ctx.lineWidth = 3 * s;
      ctx.beginPath(); ctx.arc(f.x, f.y, (18 + 50 * k) * s, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0, 0.9 - k * 1.4).toFixed(3)})`;
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 + k * 2, r = (14 + 60 * k) * s;
        ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, 4 * s * (1 - k), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      return;
    }
    if (f.big) {
      ctx.fillStyle = `rgba(120,120,128,${(0.5 * (1 - k)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, (26 + 60 * k) * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,120,20,${(0.95 * (1 - k)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, (16 + 40 * Math.sqrt(k)) * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,236,120,${Math.max(0, 1 - k * 1.6).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, (10 + 22 * Math.sqrt(k)) * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${Math.max(0, 0.8 - k).toFixed(3)})`;
      ctx.lineWidth = 3 * s;
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 + 0.3, r0 = (20 + 30 * k) * s, r1 = (34 + 60 * k) * s;
        ctx.beginPath(); ctx.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0); ctx.lineTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1); ctx.stroke();
      }
    } else {
      ctx.fillStyle = `rgba(200,200,208,${(0.7 * (1 - k)).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, (8 + 26 * k) * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,150,40,${Math.max(0, 0.8 - k * 1.5).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, (5 + 10 * k) * s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /** BOOST + MISSILE panels side by side above the GAS button. */
  function drawWeaponHud(b, ms, anchor, countdown) {
    const bw = anchor ? Math.max(118, anchor.w + 14) : 130;
    const box = drawBoostHud(b, anchor, countdown);
    if (!box) return null;
    const mx = Math.max(6, box.x - bw - 8);
    if (ms) drawMissileHud(ms, mx, box.y, bw, box.h, countdown);
    return { boost: box, missile: { x: mx, y: box.y, w: bw, h: box.h } };
  }

  function drawMissileHud(ms, x, y, bw, bh, countdown) {
    x = Math.max(6, x);
    let label, sub, col;
    if (ms.flash) {
      label = ms.flash.text;
      col = ms.flash.kind === 'hit' ? '#b8ff00' : ms.flash.kind === 'miss' ? '#ff6a6a' : '#ffb000';
      sub = ms.flash.kind === 'none' ? 'no car ahead' : ms.flash.kind === 'hit' ? 'spun out!' : 'missile lost';
    } else if (ms.inFlight) {
      label = 'MISSILE'; sub = 'IN FLIGHT'; col = '#ff9a1f';
    } else if (ms.charge > 0) {
      label = 'MISSILE READY'; sub = '◀ slide GAS · Space'; col = '#ff4d5e';
    } else {
      label = 'MISSILE USED'; sub = 'refills at the line'; col = '#7c8494';
    }
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalAlpha = countdown ? 0.6 : 1;
    ctx.fillStyle = 'rgba(8,10,16,0.78)';
    roundRect(x, y, bw, bh, 7); ctx.fill();
    ctx.lineWidth = ms.flash || ms.inFlight ? 2.5 : 1.5;
    ctx.strokeStyle = col; ctx.stroke();
    ctx.fillStyle = col;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${ms.flash ? 15 : 13}px "Russo One", Impact, sans-serif`;
    ctx.fillText(label, x + bw / 2, y + 14);
    ctx.font = '10px "Russo One", Impact, sans-serif';
    ctx.fillStyle = ms.charge > 0 || ms.flash || ms.inFlight ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.5)';
    ctx.fillText(sub, x + bw / 2, y + 29);
    ctx.restore();
  }

  /**
   * Boost indicator above the GAS button: READY / ACTIVE (+ countdown bar) / USED,
   * and a distinct magenta "∞ LAST: UNLIMITED" state while the player is last.
   */
  function drawBoostHud(b, anchor, countdown) {
    if (!b) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const bw = anchor ? Math.max(118, anchor.w + 14) : 130, bh = 40;
    const cx = anchor ? anchor.x + anchor.w / 2 : W - 80;
    let x = Math.round(cx - bw / 2), y = Math.round((anchor ? anchor.y : H - 150) - bh - 10);
    x = Math.max(6, Math.min(W - bw - 6, x));
    const active = b.activeMs > 0;
    let label, sub, col, frac = 0;
    if (active) {
      label = b.free ? '∞ BOOST' : 'BOOST'; col = b.free ? '#ff4fd8' : '#ff9a1f';
      frac = b.activeMs / 2000; sub = null;
    } else if (b.last && !countdown) {
      label = '∞ LAST'; sub = 'UNLIMITED'; col = '#ff4fd8';
    } else if (b.charge > 0) {
      label = 'BOOST READY'; sub = '▲ slide GAS · Shift'; col = '#b8ff00';
    } else {
      label = 'BOOST USED'; sub = 'refills at the line'; col = '#7c8494';
    }
    ctx.save();
    ctx.globalAlpha = countdown ? 0.6 : 1;
    ctx.fillStyle = 'rgba(8,10,16,0.78)';
    roundRect(x, y, bw, bh, 7); ctx.fill();
    ctx.lineWidth = active ? 2.5 : 1.5;
    ctx.strokeStyle = col;
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px "Russo One", Impact, sans-serif';
    ctx.fillText(label, x + bw / 2, y + 14);
    if (active) {
      const px = x + 9, pw = bw - 18, py = y + 25, ph = 8;
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = col;
      ctx.fillRect(px, py, pw * frac, ph);
    } else if (sub) {
      ctx.font = '10px "Russo One", Impact, sans-serif';
      ctx.fillStyle = b.charge > 0 || b.last ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.5)';
      ctx.fillText(sub, x + bw / 2, y + 29);
    }
    ctx.restore();
    return { x, y, h: bh };
  }

  function drawMinimap(world) {
    const { track, cars } = world;
    const b = track.bounds;
    // fit the whole layout inside a box of at most 190 × 130 px (bigger tracks shrink to fit)
    const boxW = Math.min(190, W * 0.24), boxH = Math.min(130, H * 0.24);
    const sc = Math.min(boxW / (b.maxX - b.minX), boxH / (b.maxY - b.minY));
    const mw = (b.maxX - b.minX) * sc;
    const mh = (b.maxY - b.minY) * sc;
    const x0 = W - mw - 14, y0 = 66; // top-right, under the timer (clear of touch buttons)
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x0 - 6, y0 - 6, mw + 12, mh + 12);
    ctx.translate(x0 - b.minX * sc, y0 - b.minY * sc);
    ctx.scale(sc, sc);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(track.halfW * 1.2, 3 / sc);
    ctx.stroke(trackPaths(track).centre);
    for (const c of cars) {
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, (c.isPlayer ? 7 : 5) / sc, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCountdown(text) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.save();
    ctx.font = `bold ${Math.round(Math.min(W, H) * 0.22)}px "Russo One", Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(text, W / 2, H * 0.4);
    ctx.fillStyle = text === 'GO' ? '#b8ff00' : '#ffffff';
    ctx.fillText(text, W / 2, H * 0.4);
    ctx.restore();
  }

  return { resize, draw, drawCountdown, drawBoostHud, drawWeaponHud, ctx };
}
