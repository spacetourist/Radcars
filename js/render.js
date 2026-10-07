/**
 * Plain Canvas 2D renderer (v51 'toys'): felt play-mat ground, a raised plastic track piece with grainy asphalt and
 * chunky shaded kerbs, start line, and Micro Machines-style toy cars cached as offscreen sprites (js/toyart.js).
 */
import { getLayout } from './controls.js';
import { CAR_LEN, CAR_WID } from './physics.js';
import { partLook, chainK, chainFlash, streakBand, CHAIN_FLAME_MUL } from './fx.js';
import { pointAt, buildStartingGrid } from './tracks.js';
import { TROPHY, trophyScale, ringState, partAlpha, trophyAnchor, outFade, PLACE_TEXT_Y } from './celebrate.js';
import { styleFor, carSprite, shadowSprite, scaleBucket, textureTile, SPRITE_W, SPRITE_H, TOY_FONT } from './toyart.js';

const KERB = 24; // v51: chunkier kerbs (visual only; the drivable width and walls are unchanged)
const WALL = 12;

/**
 * v53 minimap box: the glass panel from js/controls.js's layout (portrait 96×96 under the pause button, landscape
 * top-right); the track is fitted inside with an 8 px inset. Shared by the Pixi renderer.
 */
export function minimapBox(track, W, H) {
  const lay = getLayout();
  const box = lay && lay.minimap && lay.vw === W && lay.vh === H ? lay.minimap : { x: W - 110, y: 60, w: 96, h: 96 };
  const b = track.bounds, inset = 9;
  const sc = Math.min((box.w - inset * 2) / (b.maxX - b.minX), (box.h - inset * 2) / (b.maxY - b.minY));
  const mw = (b.maxX - b.minX) * sc, mh = (b.maxY - b.minY) * sc;
  const x0 = box.x + (box.w - mw) / 2, y0 = box.y + (box.h - mh) / 2;
  return { bx: box.x, by: box.y, bw: box.w, bh: box.h, sc, ox: x0 - b.minX * sc, oy: y0 - b.minY * sc, key: [box.x, box.y, box.w, box.h].map(Math.round).join(',') };
}

// v54.1 FX atlas for the Canvas boost flame (same frames as Pixi); loaded once, best effort
let fxAtlasImg = null, fxAtlasMeta = null;
if (typeof Image !== 'undefined' && typeof fetch !== 'undefined') {
  try {
    fetch('assets/fx/fx-atlas.json').then((r) => r.json()).then((m) => { fxAtlasMeta = m; }).catch(() => {});
    const im = new Image(); im.onload = () => { fxAtlasImg = im; }; im.src = 'assets/fx/fx-atlas.png';
  } catch (_) {}
}

export function createRenderer(canvas, opts = {}) {
  // opts.hud (v51 Pixi mode): this canvas is a transparent overlay above the WebGL race view and only draws the
  // minimap, BOOST / MISSILE panels and the countdown; the world itself is drawn by js/pixiRender.js.
  const hudOnly = !!opts.hud;
  const ctx = canvas.getContext('2d', { alpha: hudOnly });
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

  /** Cached felt + asphalt patterns per track theme (256 px tiles built once). */
  const tex = new WeakMap();
  function trackTex(track) {
    let t = tex.get(track);
    if (t) return t;
    const felt = ctx.createPattern(textureTile('felt', track.ground, 256), 'repeat');
    try { felt.setTransform(new DOMMatrix([2, 0, 0, 2, 0, 0])); } catch (_) {} // 512 wu felt tile
    const asphalt = ctx.createPattern(textureTile('asphalt', track.asphalt, 256), 'repeat');
    t = { felt, asphalt };
    tex.set(track, t);
    return t;
  }

  function drawTrack(track, nCars) {
    const { centre, wallL, wallR } = trackPaths(track);
    const t = trackTex(track);
    const w = track.halfW * 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // raised plastic track piece: soft offset shadow on the mat (light from the top-left)
    ctx.save();
    ctx.translate(9, 13);
    ctx.strokeStyle = 'rgba(0,0,0,0.32)';
    ctx.lineWidth = w + WALL * 2 + 10;
    ctx.stroke(centre);
    ctx.restore();
    // piece edge: dark outer rim + slightly lighter top face
    ctx.strokeStyle = '#0b0c10';
    ctx.lineWidth = w + WALL * 2;
    ctx.stroke(centre);
    ctx.strokeStyle = '#23262e';
    ctx.lineWidth = w + WALL * 2 - 6;
    ctx.stroke(centre);
    // kerbs: red base + white blocks, a lit top face, then a dark inner side face so they read as raised
    ctx.strokeStyle = '#e02020';
    ctx.lineWidth = w;
    ctx.stroke(centre);
    ctx.setLineDash([64, 64]);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#e8e8e8';
    ctx.stroke(centre);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = w - 6;
    ctx.stroke(centre);
    ctx.strokeStyle = 'rgba(0,0,0,0.42)';
    ctx.lineWidth = w - KERB * 2 + 10;
    ctx.stroke(centre);
    ctx.lineCap = 'round';
    // grainy asphalt
    ctx.strokeStyle = t.asphalt;
    ctx.lineWidth = w - KERB * 2;
    ctx.stroke(centre);
    // worn racing line: a faint lighter band down the middle (two soft steps, no per-frame gradient)
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = w * 0.5;
    ctx.stroke(centre);
    ctx.lineWidth = w * 0.28;
    ctx.stroke(centre);
    // neon edge lines with a cheap glow: a wider ~18% alpha stroke underneath (no shadowBlur). v52: widened to 34 wu
    // (≈10 px on screen at the usual race-speed zoom) per Graphic Designer.
    ctx.strokeStyle = track.wall;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 34;
    ctx.stroke(wallL);
    ctx.stroke(wallR);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 6;
    ctx.stroke(wallL);
    ctx.stroke(wallR);
    // faint centre dashes
    ctx.setLineDash([50, 78]); // 128 wu period, same as the Pixi road texture
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 6;
    ctx.stroke(centre);
    ctx.setLineDash([]);
    drawPads(track);
    drawGridBoxes(track, nCars);
    drawStartLine(track);
  }

  /** Painted starting-grid boxes, one per car slot (same slots as buildStartingGrid). */
  const gridCache = new WeakMap();
  function drawGridBoxes(track, n) {
    if (!n) return;
    let g = gridCache.get(track);
    if (!g || g.n !== n) {
      const path = new Path2D();
      for (const slot of buildStartingGrid(track, n)) {
        const c = Math.cos(slot.angle), sn = Math.sin(slot.angle);
        const P = (lx, ly) => [slot.x + c * lx - sn * ly, slot.y + sn * lx + c * ly];
        const a = P(CAR_LEN * 0.62, -CAR_WID * 0.95), b = P(CAR_LEN * 0.62, CAR_WID * 0.95);
        const a2 = P(-CAR_LEN * 0.35, -CAR_WID * 0.95), b2 = P(-CAR_LEN * 0.35, CAR_WID * 0.95);
        path.moveTo(a2[0], a2[1]); path.lineTo(a[0], a[1]); path.lineTo(b[0], b[1]); path.lineTo(b2[0], b2[1]);
      }
      g = { n, path };
      gridCache.set(track, g);
    }
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 4;
    ctx.stroke(g.path);
    ctx.lineJoin = 'round';
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
    const st = car._toy || (car._toy = styleFor(car)); // cosmetic only: variant / stripe / number by car id
    const R = scaleBucket(s * zoom * DPR);              // sprite pixels per canonical unit
    const ang = car.angle + (car.spinVis || 0);          // spinVis: v48 missile-hit 360° spin (0 otherwise)
    // soft drop shadow, offset down-right in world space so it stays put while the toy turns
    const sh = shadowSprite(st.variant, R);
    ctx.save();
    ctx.translate(car.x + 3.5 * s, car.y + 5 * s);
    ctx.rotate(ang);
    ctx.drawImage(sh, -SPRITE_W / 2 * s, -SPRITE_H / 2 * s, sh.width / R * s, sh.height / R * s);
    ctx.restore();
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(ang);
    if (debugCars) {
      const m = ctx.getTransform();
      debugCars.push({ id: car.id, isPlayer: car.isPlayer, x: car.x, y: car.y, vx: car.vx, vy: car.vy, angle: car.angle, L, W: Wd,
        spinning: car.spinMs > 0, spinVis: car.spinVis || 0, variant: st.variant,
        // screen-space images of the local length axis (+X, nose) and width axis (+Y)
        lenAxis: { x: m.a * hl, y: m.b * hl }, widAxis: { x: m.c * hw, y: m.d * hw }, origin: { x: m.e, y: m.f } });
    }
    const spr = carSprite(st, car.color, car.isPlayer, R);
    ctx.drawImage(spr, -SPRITE_W / 2 * s, -SPRITE_H / 2 * s, spr.width / R * s, spr.height / R * s);
    if (car.braking) { // v53 brake lights while BRAKE is held
      for (const side of [-1, 1]) {
        ctx.fillStyle = 'rgba(255,32,32,0.55)'; ctx.beginPath(); ctx.arc(-hl + 3 * s, side * hw * 0.62, 9 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffd0d0'; ctx.beginPath(); ctx.arc(-hl + 3 * s, side * hw * 0.62, 3.2 * s, 0, Math.PI * 2); ctx.fill();
      }
    }
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
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5 * s; ctx.stroke();
      ctx.restore();
    }
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

  function drawHudOnly(world) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawMinimap(world);
  }

  function draw(world) {
    if (hudOnly) return drawHudOnly(world);
    const { track, cars, cam } = world;
    debugCars = (typeof window !== 'undefined' && window.__RAD_DEBUG__) ? [] : null;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    // felt play-mat ground in world space (moves with the table)
    const hx = W / 2 / cam.zoom + 4, hy = H / 2 / cam.zoom + 4;
    ctx.fillStyle = trackTex(track).felt;
    ctx.fillRect(cam.x - hx, cam.y - hy, hx * 2, hy * 2);
    drawTrack(track, cars.length);
    const fx = world.fxState;
    if (fx) { // v54 skid tiles (cull to the view)
      for (const t of fx.skid.tiles.values()) if (t.x0 < cam.x + hx && t.x0 + 256 > cam.x - hx && t.y0 < cam.y + hy && t.y0 + 256 > cam.y - hy) ctx.drawImage(t.cv, t.x0, t.y0);
      fx.skid.dirty.clear(); fx.skid.removed.length = 0;
    }
    drawBonus(world, cam.zoom);
    for (const m of world.missiles || []) drawTrail(m, cam.zoom);
    for (const c of cars) {
      if (c.isPlayer) continue;
      if (c.boostLevel > 0.02) drawBoostFlame(c, cam.zoom, world.race.time + c.id * 97);
      drawCar(c, cam.zoom);
    }
    const autopilot = world.power && world.power.active === 'autopilot';
    if (autopilot) drawAutopilotGlow(world.player, cam.zoom, world.race.time, world.power.activeMs, false);
    if (fx) { const g = fx.ghosts.get(world.player); if (g) { // v54 boost ghosts (player only on Canvas)
      ctx.save(); for (let i = g.pts.length - 1; i >= 1; i--) { ctx.globalAlpha = 0.3 * Math.min(1, g.level) * (1 - i / 4.2); drawCar({ ...world.player, x: g.pts[i].x, y: g.pts[i].y, angle: g.pts[i].a, isPlayer: false }, cam.zoom); } ctx.restore(); } }
    if (world.player.boostLevel > 0.02) drawBoostFlame(world.player, cam.zoom, world.race.time);
    drawCar(world.player, cam.zoom);
    if (autopilot) drawAutopilotGlow(world.player, cam.zoom, world.race.time, world.power.activeMs, true);
    for (const m of world.missiles || []) if (!m.dead) drawMissile(m, cam.zoom);
    for (const f of world.fx || []) drawFx(f, cam.zoom);
    if (fx) drawFeelParts(fx, false, cam.zoom);
    ctx.restore();
    if (fx) drawFeelParts(fx, true);
    // v54.6 DOUBLE BOOST: 120 ms white edge flash just inside the clear play area (same rect as the streaks)
    const fa = fx ? chainFlash(fx, world.race.time) : 0;
    if (fa > 0) {
      const C = streakBand(fx, W, H), th = 10;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55 * fa; ctx.fillStyle = '#fff';
      ctx.fillRect(C.x0, C.y0, C.x1 - C.x0, th); ctx.fillRect(C.x0, C.y1 - th, C.x1 - C.x0, th);
      ctx.fillRect(C.x0, C.y0 + th, th, C.y1 - C.y0 - 2 * th); ctx.fillRect(C.x1 - th, C.y0 + th, th, C.y1 - C.y0 - 2 * th);
      ctx.restore();
    }
    if (!world.finish) drawMinimap(world);
    else drawCelebration(world.finish.cele);
    if (debugCars) window.__RAD_DEBUG__.frame = { cars: debugCars, cam: { ...cam }, W, H, DPR };
  }

  /**
   * Boost cue behind the player's car (drawn before the car so it sits underneath):
   * a flickering orange/yellow exhaust flame from the tail plus a few speed streaks.
   * Sized with the same readability scale as drawCar; the car itself is not changed.
   */
  /** v54 feel particles, Canvas fallback: plain strokes / arcs (no atlas), same state + timing as the Pixi version. */
  const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');
  function drawFeelParts(fx, screen, zoom = 1) {
    ctx.save();
    for (const o of fx.parts) {
      if (!!o.scr !== screen) continue;
      const lk = partLook(o); if (lk.alpha <= 0) continue;
      ctx.globalAlpha = lk.alpha;
      if (o.k === 'smoke') { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#e6e6ec'; ctx.beginPath(); ctx.arc(o.x, o.y, 40 * lk.scale, 0, 6.2832); ctx.fill(); continue; }
      ctx.globalCompositeOperation = 'lighter';
      const col = hex(o.tint ?? 0xffffff);
      if (o.k === 'spark') { const L = o.lenPx ? o.lenPx * lk.scale / zoom : 80 * lk.scale; ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x - Math.cos(o.rot) * L, o.y - Math.sin(o.rot) * L); ctx.stroke(); }
      else if (o.k === 'dot' || o.k === 'glow') { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(o.x, o.y, (o.k === 'glow' ? 18 : 8) * lk.scale, 0, 6.2832); ctx.fill(); }
      else if (o.k === 'ring') { ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(o.x, o.y, 56 * lk.scale, 0, 6.2832); ctx.stroke(); }
      else if (o.k === 'streak') { const L = 300 * lk.scale, ux = o.dx ?? 0, uy = o.dy ?? -1; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(o.x + ux * L / 2, o.y + uy * L / 2); ctx.lineTo(o.x - ux * L / 2, o.y - uy * L / 2); ctx.stroke(); } // v54.2: along the direction of travel
    }
    ctx.restore();
  }

  /** v52 finish celebration (screen space): podium ring, gold trophy with a light burst, confetti — see celebrate.js. */
  let trophyPath = null;
  function drawCelebration(c) {
    if (!c) return;
    const t = c.t, cx = W / 2, cy = H / 2, u = H, fade = outFade(c);
    if (c.tier.ring) {
      const r = ringState(t);
      if (r.alpha * fade > 0) {
        ctx.globalAlpha = r.alpha * fade; ctx.strokeStyle = c.tier.color; ctx.lineWidth = Math.max(2, 0.012 * u);
        ctx.beginPath(); ctx.arc(cx, cy + PLACE_TEXT_Y * u, (0.1 + 0.45 * r.k) * u, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    if (c.tier.trophy) {
      const k = trophyScale(t), an = trophyAnchor(c.aspect);
      if (k > 0 && fade > 0) {
        const px = an.size * u / 120;
        ctx.globalAlpha = fade;
        if (!trophyPath) trophyPath = TROPHY.map((sh) => {
          const p = new Path2D();
          if (sh.k === 'poly') { sh.pts.forEach((v, i) => { if (i % 2) (i === 1 ? p.moveTo : p.lineTo).call(p, sh.pts[i - 1], v); }); p.closePath(); }
          else if (sh.k === 'rect') { if (p.roundRect) p.roundRect(sh.x, sh.y, sh.w, sh.h, sh.r || 0); else p.rect(sh.x, sh.y, sh.w, sh.h); }
          else p.arc(sh.x, sh.y, sh.r, 0, Math.PI * 2);
          return { p, sh };
        });
        ctx.save(); ctx.translate(cx + an.x * u, cy + an.y * u);
        const gk = Math.min(1, k), gr = 95 * px * gk;
        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, gr);
        glow.addColorStop(0, `rgba(255,211,77,${(0.55 + 0.2 * Math.sin(t / 300)) * fade})`); glow.addColorStop(1, 'rgba(255,211,77,0)');
        ctx.fillStyle = glow; ctx.fillRect(-gr, -gr, gr * 2, gr * 2);
        if (c.tier.rays) {
          ctx.save(); ctx.rotate(t / 2600); ctx.fillStyle = `rgba(255,240,160,${0.32 * fade})`; const R = 125 * px * gk;
          ctx.beginPath();
          for (let i = 0; i < 14; i++) { const a0 = (i / 14) * Math.PI * 2, a1 = a0 + Math.PI / 14; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a0) * R, Math.sin(a0) * R); ctx.lineTo(Math.cos(a1) * R, Math.sin(a1) * R); ctx.closePath(); }
          ctx.fill(); ctx.restore();
        }
        ctx.rotate(0.06 * Math.sin(t / 420)); ctx.scale(px * k, px * k);
        ctx.lineJoin = 'round'; ctx.lineWidth = 2.5;
        for (const { p, sh } of trophyPath) {
          ctx.globalAlpha = (sh.alpha ?? 1) * fade; ctx.fillStyle = sh.fill; ctx.fill(p);
          if (sh.stroke) { ctx.globalAlpha = 0.9 * fade; ctx.strokeStyle = sh.stroke; ctx.stroke(p); }
        }
        ctx.globalAlpha = 1; ctx.restore();
      }
    }
    for (const p of c.parts) {
      const w = p.w * u, h = Math.max(0.6, Math.abs(Math.cos(p.flip)) * p.h * u);
      ctx.save(); ctx.globalAlpha = partAlpha(p); ctx.translate(cx + p.x * u, cy + p.y * u); ctx.rotate(p.rot);
      ctx.fillStyle = p.col; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawBoostFlame(car, zoom, tMs) {
    const lvl = Math.min(1, car.boostLevel), ck = chainK(car); // v54.6: boostLevel above 1 = DOUBLE BOOST rush
    if (car.spinMs > 0) return;
    const s = Math.max(1, 34 / (CAR_LEN * zoom));
    const hl = CAR_LEN * s / 2, hw = CAR_WID * 0.88 * s / 2;
    const fl = 0.85 + 0.15 * Math.sin(tMs * 0.047) + 0.08 * Math.sin(tMs * 0.113);
    const len = (26 + 34 * lvl) * s * fl * (1 + (CHAIN_FLAME_MUL - 1) * ck);
    // v54.6: pink core inside each flame while the chain rush is on (drawn after the flames, additive, eases out)
    const pinkCore = () => {
      if (ck <= 0.01) return;
      ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = ck * 0.85; ctx.fillStyle = '#ff2b6a'; // normal blend: reads pink over the cyan flame
      for (const side of [-1, 1]) {
        const y = side * hw * 0.42, l = len * 0.8;
        ctx.beginPath(); ctx.moveTo(-hl + 3 * s, y - 3.2 * s);
        ctx.quadraticCurveTo(-hl - l * 0.55, y - 2.4 * s, -hl - l, y); ctx.quadraticCurveTo(-hl - l * 0.55, y + 2.4 * s, -hl + 3 * s, y + 3.2 * s);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    };
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
    // v54.1: GD's atlas flame_0..2 (cyan → pink, additive, 24 fps cycle, ±8 % flicker); the drawn flames stay as the
    // fallback until the atlas has loaded
    if (fxAtlasImg && fxAtlasMeta) {
      ctx.globalCompositeOperation = 'lighter';
      for (const side of [-1, 1]) {
        const f = fxAtlasMeta.frames['flame_' + (Math.floor(tMs / 41.7 + (side > 0 ? 1 : 0)) % 3)].frame, fk = 1 + 0.08 * Math.sin(tMs * 0.09 + side * 1.7);
        const h = len * 1.3 * fk / 0.9, w = 12 * s * 1.6 * fk;
        ctx.save(); ctx.translate(-hl + 4 * s, side * hw * 0.42); ctx.rotate(Math.PI / 2);
        if (green) ctx.filter = 'hue-rotate(-110deg) saturate(1.4)'; // LAP BOOST keeps its green burner
        ctx.drawImage(fxAtlasImg, f.x, f.y, f.w, f.h, -w / 2, -h * 0.1, w, h);
        ctx.restore();
      }
      pinkCore();
      ctx.restore();
      return;
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
    pinkCore();
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
      ctx.font = `900 ${Math.round(h * 1.3)}px ${TOY_FONT}`;
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
    plasticPanel(x, y, bw, bh, col, ms.flash || ms.inFlight);
    ctx.fillStyle = col;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${ms.flash ? 14 : 12}px ${TOY_FONT}`;
    ctx.fillText(label, x + bw / 2, y + 14);
    ctx.font = `700 10px ${TOY_FONT}`;
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
    plasticPanel(x, y, bw, bh, col, active);
    ctx.fillStyle = col;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 12px ${TOY_FONT}`;
    ctx.fillText(label, x + bw / 2, y + 14);
    if (active) {
      const px = x + 9, pw = bw - 18, py = y + 25, ph = 8;
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = col;
      ctx.fillRect(px, py, pw * frac, ph);
    } else if (sub) {
      ctx.font = `700 10px ${TOY_FONT}`;
      ctx.fillStyle = b.charge > 0 || b.last ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.5)';
      ctx.fillText(sub, x + bw / 2, y + 29);
    }
    ctx.restore();
    return { x, y, w: bw, h: bh };
  }

  function drawMinimap(world) {
    const { track, cars } = world;
    const m = minimapBox(track, W, H);
    ctx.save();
    roundRect(m.bx, m.by, m.bw, m.bh, 12);
    ctx.fillStyle = 'rgba(10,16,34,0.62)'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,232,255,0.85)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.translate(m.ox, m.oy);
    ctx.scale(m.sc, m.sc);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(track.halfW * 1.2, 3 / m.sc);
    ctx.lineJoin = 'round';
    ctx.stroke(trackPaths(track).centre);
    for (const c of cars) {
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, (c.isPlayer ? 6 : 4) / m.sc, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** v51: HUD panel as a glossy plastic tray (same size and position as before) with a coloured rim. */
  function plasticPanel(x, y, bw, bh, col, strong) {
    ctx.fillStyle = 'rgba(4,6,16,0.55)';
    roundRect(x + 1, y + 3, bw, bh, 11); ctx.fill();                 // thickness / drop
    const g = ctx.createLinearGradient(0, y, 0, y + bh);
    g.addColorStop(0, 'rgba(48,60,112,0.92)'); g.addColorStop(0.5, 'rgba(24,32,66,0.9)'); g.addColorStop(1, 'rgba(12,17,40,0.92)');
    ctx.fillStyle = g;
    roundRect(x, y, bw, bh, 11); ctx.fill();
    ctx.lineWidth = strong ? 3 : 2;
    ctx.strokeStyle = col; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    roundRect(x + 4, y + 3, bw - 8, bh * 0.36, 7); ctx.fill();      // gloss
  }

  /** v51: countdown as a glossy toy traffic-light disc (3 red, 2 / 1 amber, GO green) with a chunky number. */
  function drawCountdown(text) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.save();
    const r = Math.min(W, H) * 0.12, cx = W / 2, cy = H * 0.27;
    const col = text === 'GO' ? ['#9bff5a', '#3fb80f', '#1d5c00'] : text === '3' ? ['#ff7a6a', '#e3261c', '#6a0a04'] : ['#ffe27a', '#f0a400', '#6b4500'];
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath(); ctx.arc(cx + r * 0.08, cy + r * 0.14, r * 1.04, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#10142a';
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.06, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, col[0]); g.addColorStop(0.7, col[1]); g.addColorStop(1, col[2]);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.beginPath(); ctx.ellipse(cx - r * 0.12, cy - r * 0.5, r * 0.55, r * 0.26, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.font = `900 ${Math.round(r * (text === 'GO' ? 0.82 : 1.15))}px ${TOY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, r * 0.1);
    ctx.strokeStyle = 'rgba(10,12,26,0.9)';
    ctx.fillStyle = 'rgba(10,12,26,0.6)';
    ctx.fillText(text, cx, cy + r * 0.1);
    ctx.strokeText(text, cx, cy + r * 0.04);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, cx, cy + r * 0.04);
    ctx.restore();
  }

  const readPixels = (x, y, w, h) => ctx.getImageData(x, y, w, h).data; // verification: device-px RGBA of the race view
  return { kind: hudOnly ? 'hud' : 'canvas', resize, draw, drawCountdown, drawBoostHud, drawWeaponHud, readPixels, ctx };
}
