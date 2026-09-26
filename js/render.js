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

  function drawCar(car, zoom) {
    // keep cars readable when the chase cam pulls far out (min ~30px long on screen)
    const s = Math.max(1, 30 / (CAR_LEN * zoom));
    const L = CAR_LEN * s, Wd = CAR_WID * s;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(-L / 2 + 3 * s, -Wd / 2 + 4 * s, L, Wd, 8 * s);
    ctx.fill();
    // body (nose points +X = heading)
    ctx.fillStyle = car.color;
    roundRect(-L / 2, -Wd / 2, L, Wd, 8 * s);
    ctx.fill();
    ctx.lineWidth = (car.isPlayer ? 4 : 2) * s;
    ctx.strokeStyle = car.isPlayer ? '#ffffff' : 'rgba(0,0,0,0.6)';
    ctx.stroke();
    // windscreen (towards the nose) and rear window
    ctx.fillStyle = '#0d1a26';
    roundRect(L * 0.06, -Wd * 0.36, L * 0.2, Wd * 0.72, 4 * s);
    ctx.fill();
    ctx.fillStyle = 'rgba(13,26,38,0.75)';
    roundRect(-L * 0.36, -Wd * 0.3, L * 0.12, Wd * 0.6, 3 * s);
    ctx.fill();
    // headlights
    ctx.fillStyle = '#fff6c0';
    ctx.fillRect(L / 2 - 5 * s, -Wd / 2 + 3 * s, 4 * s, 6 * s);
    ctx.fillRect(L / 2 - 5 * s, Wd / 2 - 9 * s, 4 * s, 6 * s);
    ctx.restore();
    if (car.isPlayer) {
      // marker above the player's car
      ctx.save();
      ctx.translate(car.x, car.y - (Wd / 2 + 26 * s));
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-9 * s, -12 * s); ctx.lineTo(9 * s, -12 * s); ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();
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

  function draw(world) {
    const { track, cars, cam } = world;
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
  }

  function drawMinimap(world) {
    const { track, cars } = world;
    const b = track.bounds;
    const mw = Math.min(180, W * 0.22);
    const sc = mw / (b.maxX - b.minX);
    const mh = (b.maxY - b.minY) * sc;
    const x0 = W - mw - 14, y0 = 66; // top-right, under the timer (clear of touch buttons)
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x0 - 6, y0 - 6, mw + 12, mh + 12);
    ctx.translate(x0 - b.minX * sc, y0 - b.minY * sc);
    ctx.scale(sc, sc);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = track.halfW * 1.2;
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
