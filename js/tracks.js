/**
 * Radcars core tracks.
 * Every track is a closed centreline + constant half-width, so both walls are
 * parallel to the racing line. The centreline is resampled to uniform spacing
 * and rotated so index 0 is the start/finish line; travel direction = +index.
 */

const SAMPLE = 30; // world units between resampled centreline points

function angleBump(a, lo, hi) {
  let aa = a;
  while (aa < lo) aa += Math.PI * 2;
  while (aa > lo + Math.PI * 2) aa -= Math.PI * 2;
  if (aa < lo || aa > hi) return 0;
  return Math.sin(((aa - lo) / (hi - lo)) * Math.PI);
}

/** Replace each polygon corner with a circular fillet of radius r (clamped to fit). */
function filletLoop(corners, r, arcStep = 0.12) {
  const n = corners.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = corners[(i - 1 + n) % n], p1 = corners[i], p2 = corners[(i + 1) % n];
    const ax = p0.x - p1.x, ay = p0.y - p1.y, bx = p2.x - p1.x, by = p2.y - p1.y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    const ux = ax / la, uy = ay / la, vx = bx / lb, vy = by / lb;
    const cos = Math.max(-1, Math.min(1, ux * vx + uy * vy));
    const theta = Math.acos(cos); // interior angle between the two legs
    if (theta > Math.PI - 0.01) { out.push({ x: p1.x, y: p1.y }); continue; }
    let d = r / Math.tan(theta / 2); // tangent distance from corner
    const dMax = Math.min(la, lb) * 0.48;
    let rr = r;
    if (d > dMax) { d = dMax; rr = d * Math.tan(theta / 2); }
    const t1 = { x: p1.x + ux * d, y: p1.y + uy * d };
    const t2 = { x: p1.x + vx * d, y: p1.y + vy * d };
    const bisx = ux + vx, bisy = uy + vy;
    const bl = Math.hypot(bisx, bisy) || 1;
    const cd = rr / Math.sin(theta / 2);
    const c = { x: p1.x + (bisx / bl) * cd, y: p1.y + (bisy / bl) * cd };
    let a1 = Math.atan2(t1.y - c.y, t1.x - c.x);
    let a2 = Math.atan2(t2.y - c.y, t2.x - c.x);
    let da = a2 - a1;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const steps = Math.max(2, Math.ceil(Math.abs(da) / arcStep));
    for (let k = 0; k <= steps; k++) {
      const a = a1 + da * (k / steps);
      out.push({ x: c.x + Math.cos(a) * rr, y: c.y + Math.sin(a) * rr });
    }
  }
  return out;
}

/** Uniformly resample a closed polyline. */
function resampleLoop(pts, step) {
  const n = pts.length;
  let total = 0;
  const segLen = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    segLen.push(l);
    total += l;
  }
  const count = Math.max(16, Math.round(total / step));
  const ds = total / count;
  const out = [];
  let seg = 0, segStart = 0;
  for (let k = 0; k < count; k++) {
    const s = k * ds;
    while (seg < n - 1 && segStart + segLen[seg] < s) { segStart += segLen[seg]; seg++; }
    const a = pts[seg], b = pts[(seg + 1) % n];
    const t = segLen[seg] > 0 ? (s - segStart) / segLen[seg] : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** Laplacian smoothing on a closed loop (removes kinks so walls stay parallel). */
function smoothLoop(pts, iterations = 0) {
  let cur = pts;
  const n = pts.length;
  for (let it = 0; it < iterations; it++) {
    cur = cur.map((p, i) => {
      const a = cur[(i - 1 + n) % n], b = cur[(i + 1) % n];
      return { x: p.x * 0.5 + (a.x + b.x) * 0.25, y: p.y * 0.5 + (a.y + b.y) * 0.25 };
    });
  }
  return cur;
}

function nearestIndex(pts, x, y) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = (pts[i].x - x) ** 2 + (pts[i].y - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * Finalise a track: resample, rotate so index 0 = start, derive tangents,
 * normals, arc length and both wall polylines.
 * `startNear` = world point closest to the desired start/finish line.
 */
function buildTrack(def, rawLine, halfW, startNear, smooth = 12) {
  let line = resampleLoop(smoothLoop(resampleLoop(rawLine, SAMPLE), smooth), SAMPLE);
  const si = nearestIndex(line, startNear.x, startNear.y);
  line = line.slice(si).concat(line.slice(0, si));
  const n = line.length;
  const pts = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = line[i], b = line[(i + 1) % n], p = line[(i - 1 + n) % n];
    let tx = b.x - p.x, ty = b.y - p.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    pts.push({ x: a.x, y: a.y, tx, ty, nx: -ty, ny: tx, s, len: segLen });
    s += segLen;
  }
  const length = s;
  const left = pts.map((p) => ({ x: p.x + p.nx * halfW, y: p.y + p.ny * halfW }));
  const right = pts.map((p) => ({ x: p.x - p.nx * halfW, y: p.y - p.ny * halfW }));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of left.concat(right)) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  // Local turn radius per point (circumradius over ±90wu), used by the AI for corner speeds
  const radius = pts.map((b, i) => {
    const a = pts[(i - 3 + n) % n], c = pts[(i + 3) % n];
    const A = Math.hypot(b.x - a.x, b.y - a.y), B = Math.hypot(c.x - b.x, c.y - b.y), C = Math.hypot(c.x - a.x, c.y - a.y);
    const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
    return area2 < 1e-6 ? 1e6 : (A * B * C) / (2 * area2);
  });
  for (let i = 0; i < n; i++) {
    let m = radius[i];
    for (let k = -2; k <= 2; k++) m = Math.min(m, radius[(i + k + n) % n]);
    pts[i].radius = m;
  }
  const startHeading = Math.atan2(pts[0].ty, pts[0].tx);
  return {
    ...def,
    halfW,
    pts,
    length,
    left,
    right,
    bounds: { minX, minY, maxX, maxY },
    startHeading
  };
}

/* ---------------- track definitions ---------------- */

function neonLoop() {
  const cx = 2300, cy = 1650, n = 192, baseRx = 1750, baseRy = 980;
  const line = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const breath = 1 + 0.03 * Math.cos(2 * a);
    let x = cx + Math.cos(a) * baseRx * breath;
    let y = cy + Math.sin(a) * baseRy * breath;
    const tx = -Math.sin(a), ty = Math.cos(a);
    const kink = angleBump(a, Math.PI * 1.12, Math.PI * 1.36);
    x += tx * 70 * kink; y += ty * 70 * kink;
    const side = (angleBump(a, Math.PI * 0.32, Math.PI * 0.52) - angleBump(a, Math.PI * 0.52, Math.PI * 0.72)) * 95;
    x += tx * side; y += ty * side;
    const pit = angleBump(a, Math.PI * 1.38, Math.PI * 1.62);
    x += Math.cos(a) * 55 * pit; y += Math.sin(a) * 70 * pit;
    line.push({ x, y });
  }
  // Clockwise on screen (angle increasing, +Y down); start mid top straight heading +X.
  return buildTrack({
    id: 'neon_loop', name: 'Neon Loop', difficulty: 1,
    ground: '#16301f', asphalt: '#34343c', wall: '#00e8ff', accent: '#ff2bd6'
  }, line, 270, { x: cx, y: cy - baseRy * 1.03 - 70 });
}

function gridlock() {
  const cx = 2000, cy = 1400, rw = 1560, rh = 950, rr = 350;
  const corners = [
    { x: cx - rw, y: cy - rh }, { x: cx + rw, y: cy - rh },
    { x: cx + rw, y: cy + rh }, { x: cx - rw, y: cy + rh }
  ];
  let line = resampleLoop(filletLoop(corners, rr), 20);
  // Pit bay bulge on the north straight and a tightened SE corner (both walls move together)
  line = line.map((p) => {
    let { x, y } = p;
    if (y < cy - rh + 40 && x > cx - 360 && x < cx + 360) y -= 72 * (1 - Math.abs(x - cx) / 360);
    const dx = x - (cx + rw * 0.67), dy = y - (cy + rh * 0.68), d = Math.hypot(dx, dy);
    if (d < 420) { const u = 1 - d / 420; x -= dx * 0.12 * u; y -= dy * 0.12 * u; }
    return { x, y };
  });
  return buildTrack({
    id: 'gridlock', name: 'Gridlock Circuit', difficulty: 2,
    ground: '#26282e', asphalt: '#3a3a42', wall: '#b8ff00', accent: '#ff8a00'
  }, line, 190, { x: cx - 700, y: cy - rh });
}

function razorHairpin() {
  const S = 1.7, cx = 900 * S, cy = 600 * S, n = 160;
  const line = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const lobe = 1 + 0.4 * Math.cos(2 * a);
    const waist = 1 - 0.07 * (1 + Math.cos(4 * a));
    line.push({ x: cx + Math.cos(a) * 595 * S * lobe * waist, y: cy + Math.sin(a) * 340 * S * waist });
  }
  return buildTrack({
    id: 'razor_hairpin', name: 'Razor Hairpin', difficulty: 3,
    ground: '#2a1f30', asphalt: '#3a3040', wall: '#ff2bd6', accent: '#00e8ff'
  }, line, 175, { x: cx, y: cy + 340 * S * 0.82 });
}

function cargoDock() {
  const S = 1.7;
  const corners = [
    { x: 160, y: 160 }, { x: 1040, y: 110 }, { x: 1495, y: 150 },
    { x: 1495, y: 935 }, { x: 1100, y: 940 }, { x: 1020, y: 700 },
    { x: 1000, y: 530 }, { x: 180, y: 510 }
  ].map((p) => ({ x: p.x * S, y: p.y * S }));
  return buildTrack({
    id: 'cargo_dock', name: 'Cargo Dock', difficulty: 2,
    ground: '#1d2a33', asphalt: '#383c40', wall: '#ffe600', accent: '#00e8ff'
  }, filletLoop(corners, 260), 160, { x: 600 * S, y: 140 * S });
}

export const TRACKS = [neonLoop(), gridlock(), razorHairpin(), cargoDock()];

export function getTrack(i) {
  return TRACKS[((i % TRACKS.length) + TRACKS.length) % TRACKS.length];
}

/** Nearest sample index for an arc length. */
export function indexAt(track, s) {
  const n = track.pts.length;
  return Math.floor((wrapS(track, s) / track.length) * n) % n;
}

/** Wrap an arc-length value into [0, length). */
export function wrapS(track, s) {
  const L = track.length;
  return ((s % L) + L) % L;
}

/** Point + tangent at arc length s (interpolated). */
export function pointAt(track, s) {
  const pts = track.pts;
  const n = pts.length;
  const ss = wrapS(track, s);
  // uniform-ish sampling → direct index guess then walk
  let i = Math.min(n - 1, Math.floor((ss / track.length) * n));
  while (i > 0 && pts[i].s > ss) i--;
  while (i < n - 1 && pts[i + 1].s <= ss) i++;
  const a = pts[i], b = pts[(i + 1) % n];
  const t = a.len > 0 ? (ss - a.s) / a.len : 0;
  const tx = a.tx + (b.tx - a.tx) * t, ty = a.ty + (b.ty - a.ty) * t;
  const tl = Math.hypot(tx, ty) || 1;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, tx: tx / tl, ty: ty / tl, nx: -ty / tl, ny: tx / tl };
}

/**
 * Project a world point onto the centreline.
 * `hint` = previous segment index (local search) or -1 for a full search.
 * Returns segment index, arc length s, signed lateral offset (+ = left normal)
 * and the unit normal at the projection.
 */
export function project(track, x, y, hint = -1) {
  const pts = track.pts;
  const n = pts.length;
  let lo = 0, hi = n - 1;
  if (hint >= 0) { lo = hint - 12; hi = hint + 12; }
  let best = null, bd = Infinity;
  for (let k = lo; k <= hi; k++) {
    const i = ((k % n) + n) % n;
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1e-9;
    let t = ((x - a.x) * dx + (y - a.y) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a.x + dx * t, py = a.y + dy * t;
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d < bd) { bd = d; best = { i, t, px, py }; }
  }
  const a = pts[best.i], b = pts[(best.i + 1) % n];
  const nx = a.nx + (b.nx - a.nx) * best.t, ny = a.ny + (b.ny - a.ny) * best.t;
  const nl = Math.hypot(nx, ny) || 1;
  const unx = nx / nl, uny = ny / nl;
  const lat = (x - best.px) * unx + (y - best.py) * uny;
  return { i: best.i, s: a.s + a.len * best.t, lat, nx: unx, ny: uny, px: best.px, py: best.py };
}

/** Staggered 2-wide grid behind the start line, all facing the start tangent. */
export function buildStartingGrid(track, count) {
  const out = [];
  const lane = Math.min(track.halfW * 0.45, 80);
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 2);
    const back = 90 + row * 120 + (i % 2) * 50;
    const p = pointAt(track, -back);
    const side = (i % 2 === 0) ? 1 : -1;
    out.push({
      x: p.x + p.nx * lane * side,
      y: p.y + p.ny * lane * side,
      angle: Math.atan2(p.ty, p.tx),
      s: -back
    });
  }
  return out;
}
