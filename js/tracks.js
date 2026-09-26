/**
 * Radcars core tracks.
 * Every track is a closed C2 cubic B-spline centreline + constant half-width, so
 * both walls are parallel to the racing line. The centreline is resampled to
 * uniform spacing and rotated so index 0 is the start/finish line; travel
 * direction = +index (clockwise on screen).
 */

const SAMPLE = 30; // world units between resampled centreline points

/**
 * Closed uniform cubic B-spline through a control polygon (C2: position,
 * tangent and curvature are continuous, so there are no kinks or cusps).
 * Returns a finely sampled polyline.
 */
function bsplineLoop(ctrl, fine = 2) {
  const n = ctrl.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const P0 = ctrl[(i - 1 + n) % n], P1 = ctrl[i], P2 = ctrl[(i + 1) % n], P3 = ctrl[(i + 2) % n];
    const per = Math.max(16, Math.ceil(Math.hypot(P2.x - P1.x, P2.y - P1.y) / fine)); // ~2 wu apart
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const b0 = (1 - t) ** 3 / 6, b1 = (3 * t3 - 6 * t2 + 4) / 6, b2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, b3 = t3 / 6;
      out.push({ x: b0 * P0.x + b1 * P1.x + b2 * P2.x + b3 * P3.x, y: b0 * P0.y + b1 * P1.y + b2 * P2.y + b3 * P3.y });
    }
  }
  return out;
}

/** Insert evenly spaced points on long control-polygon edges so straights stay straight. */
function densify(poly, step) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const k = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let j = 0; j < k; j++) out.push({ x: a.x + (b.x - a.x) * (j / k), y: a.y + (b.y - a.y) * (j / k) });
  }
  return out;
}

/** Control points are authored in 100-wu units: [x, y] pairs, or '|' strings mark nothing. */
function ctrlPts(list, unit = 100, step = 0) {
  const pts = list.map(([x, y]) => ({ x: x * unit, y: y * unit }));
  return step > 0 ? densify(pts, step * unit) : pts;
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

function nearestIndex(pts, x, y) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = (pts[i].x - x) ** 2 + (pts[i].y - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Signed area (screen coords, +Y down): > 0 means clockwise on screen. */
function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * Finalise a track: B-spline the control polygon, resample uniformly, rotate
 * so index 0 = start, derive tangents, normals, arc length and both walls.
 * `startNear` = world point closest to the desired start/finish line.
 * Travel direction is always clockwise on screen (+index).
 */
function buildTrack(def, ctrl, halfW, startNear) {
  let line = resampleLoop(bsplineLoop(ctrl), SAMPLE);
  if (signedArea(line) < 0) line.reverse();
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
    ctrl,
    pts,
    length,
    left,
    right,
    bounds: { minX, minY, maxX, maxY },
    startHeading
  };
}

/* ---------------- track definitions (control polygons in 100-wu units) ---------------- */

/* DEFS-BEGIN */
function neonLoop() {
  // Wide flowing loop: long top straight, fast east sweeper, a hairpin "bite"
  // tucked into the south side, rolling S-bends along the bottom, west sweeper.
  const ctrl = ctrlPts([
    [12, 5], [26, 4], [40, 4], [54, 5], [66, 7], [74, 13], [76, 22], [72, 30],
    [64, 34], [56, 32], [50, 26], [45, 19], [39, 17], [34, 21], [32, 29], [26, 35],
    [18, 37], [10, 35], [4, 28], [4, 17], [7, 9]
  ]);
  return buildTrack({
    id: 'neon_loop', name: 'Neon Loop', difficulty: 1,
    ground: '#16301f', asphalt: '#34343c', wall: '#00e8ff', accent: '#ff2bd6'
  }, ctrl, 270, { x: 3300, y: 400 });
}

function gridlock() {
  // City blocks: right-angle street corners, a U-shaped inlet, a chicane on the back street.
  const ctrl = ctrlPts([
    [3, 4], [54, 4], [54, 16], [66, 16], [66, 44], [51, 44], [51, 31], [37, 31], [37, 44],
    [26, 44], [21.5, 40.5], [17.5, 40.5], [13, 44], [3, 44], [3, 34], [8, 30], [8, 19], [3, 15]
  ], 100, 11);
  return buildTrack({
    id: 'gridlock', name: 'Gridlock Circuit', difficulty: 2,
    ground: '#26282e', asphalt: '#3a3a42', wall: '#b8ff00', accent: '#ff8a00'
  }, ctrl, 190, { x: 2000, y: 400 });
}

function razorHairpin() {
  // Paperclip: stacked straights joined by razor hairpins, big east sweeper.
  const ctrl = ctrlPts([
    [34, 30], [24, 30], [16, 30], [10, 30], [4, 29.5], [1, 25], [4, 20.5], [10, 20], [18, 20],
    [24, 19.5], [27, 15], [24, 10.5], [18, 10], [10, 10], [4, 9.5], [1, 5], [4, 0.5], [10, 0],
    [16, 0], [24, 0], [34, 0], [41, 2], [46, 8], [44, 15], [46, 22], [41, 28.5]
  ]);
  return buildTrack({
    id: 'razor_hairpin', name: 'Razor Hairpin', difficulty: 3,
    ground: '#2a1f30', asphalt: '#3a3040', wall: '#ff2bd6', accent: '#00e8ff'
  }, ctrl, 175, { x: 2400, y: 3000 });
}

function cargoDock() {
  // Container port: long quay straights, a dock notch, a container chicane.
  const ctrl = ctrlPts([
    [2, 2], [40, 2], [50, 4], [52, 15], [32, 15], [32, 25], [52, 25], [52, 36], [34, 36],
    [29, 32.5], [23, 32.5], [18, 36], [2, 36], [2, 24], [7, 18], [2, 12]
  ], 100, 9);
  return buildTrack({
    id: 'cargo_dock', name: 'Cargo Dock', difficulty: 2,
    ground: '#1d2a33', asphalt: '#383c40', wall: '#ffe600', accent: '#00e8ff'
  }, ctrl, 160, { x: 1500, y: 150 });
}
/* DEFS-END */

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
