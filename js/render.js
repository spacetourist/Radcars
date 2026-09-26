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
    drawStartLine(track);
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
    ctx.rotate(car.angle);
    if (debugCars) {
      const m = ctx.getTransform();
      debugCars.push({ id: car.id, isPlayer: car.isPlayer, x: car.x, y: car.y, vx: car.vx, vy: car.vy, angle: car.angle, L, W: Wd,
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
    for (const c of cars) if (!c.isPlayer) drawCar(c, cam.zoom);
    drawCar(world.player, cam.zoom);
    ctx.restore();
    drawMinimap(world);
    if (debugCars) window.__RAD_DEBUG__.frame = { cars: debugCars, cam: { ...cam }, W, H, DPR };
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

  return { resize, draw, drawCountdown, ctx };
}
