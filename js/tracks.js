/** Geometric tracks: outer/inner wall polygons, racing line waypoints, spawns, checkpoint gates, landmarks. */

function rectRing(cx, cy, ow, oh, iw, ih) {
  const outer = [
    { x: cx - ow / 2, y: cy - oh / 2 },
    { x: cx + ow / 2, y: cy - oh / 2 },
    { x: cx + ow / 2, y: cy + oh / 2 },
    { x: cx - ow / 2, y: cy + oh / 2 }
  ];
  const inner = [
    { x: cx - iw / 2, y: cy - ih / 2 },
    { x: cx + iw / 2, y: cy - ih / 2 },
    { x: cx + iw / 2, y: cy + ih / 2 },
    { x: cx - iw / 2, y: cy + ih / 2 }
  ];
  return { outer, inner };
}

function ovalPoints(cx, cy, rx, ry, n = 48) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return pts;
}

/** Smooth bump in [0,1] peaking at center of [lo, hi] on a circular angle domain. */
function angleBump(a, lo, hi) {
  let aa = a;
  while (aa < lo) aa += Math.PI * 2;
  while (aa > lo + Math.PI * 2) aa -= Math.PI * 2;
  if (aa < lo || aa > hi) return 0;
  const t = (aa - lo) / (hi - lo);
  return Math.sin(t * Math.PI);
}

/**
 * Vintage racecourse oval: variable width, pit recess, kink, chicane, landmarks.
 * Keeps oval DNA; start on top straight facing +X (clockwise on canvas).
 */
function buildNeonLoopGeometry() {
  const cx = 800, cy = 500;
  const n = 96;
  const baseOuterRx = 720, baseOuterRy = 420;
  const baseInnerRx = 420, baseInnerRy = 200;
  const baseLineRx = 570, baseLineRy = 310;

  const outer = [];
  const inner = [];
  const line = [];

  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // ±15% lane width: wider straights (top/bottom), tighter left/right apexes
    const widthMul = 1 - 0.18 * Math.cos(2 * a);
    // Outer expands on straights; inner contracts → wider asphalt
    const oMul = 1 + (widthMul - 1) * 0.55;
    const iMul = 1 - (widthMul - 1) * 0.85;
    let orx = baseOuterRx * oMul;
    let ory = baseOuterRy * oMul;
    let irx = baseInnerRx * iMul;
    let iry = baseInnerRy * iMul;
    let lrx = (orx + irx) * 0.5;
    let lry = (ory + iry) * 0.5;

    // --- Pit recess (outer wall notch) on start/finish straight (top, a≈3π/2) ---
    // Racing clockwise: outside of top stretch is further "up" (away from center).
    const pit = angleBump(a, Math.PI * 1.38, Math.PI * 1.62);
    if (pit > 0) {
      orx += 72 * pit;
      ory += 96 * pit;
      // Slight outer bias on racing line through pit entry
      lrx += 14 * pit;
      lry += 20 * pit;
    }

    // --- Slight kink before main (top) straight — NW approach ---
    const kink = angleBump(a, Math.PI * 1.12, Math.PI * 1.36);
    if (kink > 0) {
      // Lateral shove (toward outside then settle) — vintage "kink onto the straight"
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      const tx = -ny, ty = nx; // tangent-ish / lateral in param space
      const shove = 42 * kink;
      const ox = tx * shove * 0.9;
      const oy = ty * shove * 0.9;
      // Apply as cartesian offset after radius (handled below via extra)
      orx += 6 * kink;
      irx += 4 * kink;
      lrx += 8 * kink;
      // Store lateral in point via deferred offset fields
      outer.push({ _a: a, _orx: orx, _ory: ory, _lx: ox, _ly: oy });
      inner.push({ _a: a, _irx: irx, _iry: iry, _lx: ox * 0.55, _ly: oy * 0.55 });
      line.push({ _a: a, _lrx: lrx, _lry: lry, _lx: ox * 0.75, _ly: oy * 0.75 });
      continue;
    }

    // --- Chicane opposite start (bottom, a≈π/2): inner/outer pinch + S-offset ---
    const chi1 = angleBump(a, Math.PI * 0.32, Math.PI * 0.52);
    const chi2 = angleBump(a, Math.PI * 0.52, Math.PI * 0.72);
    if (chi1 > 0 || chi2 > 0) {
      const pinch = Math.max(chi1, chi2);
      // Narrow the lane hard so chicane reads from grid zoom
      orx -= 88 * pinch;
      ory -= 105 * pinch;
      irx += 62 * pinch;
      iry += 78 * pinch;
      lrx = (orx + irx) * 0.5;
      lry = (ory + iry) * 0.5;
      // S-bend: first lobe outside, second inside
      const side = (chi1 - chi2) * 70;
      const tx = -Math.sin(a), ty = Math.cos(a);
      outer.push({ _a: a, _orx: orx, _ory: ory, _lx: tx * side * 0.7, _ly: ty * side * 0.7 });
      inner.push({ _a: a, _irx: irx, _iry: iry, _lx: tx * side * 0.9, _ly: ty * side * 0.9 });
      line.push({ _a: a, _lrx: lrx, _lry: lry, _lx: tx * side, _ly: ty * side });
      continue;
    }

    outer.push({ _a: a, _orx: orx, _ory: ory, _lx: 0, _ly: 0 });
    inner.push({ _a: a, _irx: irx, _iry: iry, _lx: 0, _ly: 0 });
    line.push({ _a: a, _lrx: lrx, _lry: lry, _lx: 0, _ly: 0 });
  }

  const outerPts = outer.map((p) => ({
    x: cx + Math.cos(p._a) * p._orx + (p._lx || 0),
    y: cy + Math.sin(p._a) * p._ory + (p._ly || 0)
  }));
  const innerPts = inner.map((p) => ({
    x: cx + Math.cos(p._a) * p._irx + (p._lx || 0),
    y: cy + Math.sin(p._a) * p._iry + (p._ly || 0)
  }));
  const linePts = line.map((p) => ({
    x: cx + Math.cos(p._a) * p._lrx + (p._lx || 0),
    y: cy + Math.sin(p._a) * p._lry + (p._ly || 0)
  }));

  // Start on TOP of ellipse — longest flat stretch — facing +X (right).
  const startIndex = Math.round((3 / 4) * linePts.length) % linePts.length;
  const p0 = linePts[startIndex];
  const p1 = linePts[(startIndex + 1) % linePts.length];
  const startHeading = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  const fx = Math.cos(startHeading), fy = Math.sin(startHeading);
  const lx = -fy, ly = fx;
  const spawns = [];
  for (let i = 0; i < 8; i++) {
    const row = Math.floor(i / 2);
    const col = (i % 2 === 0) ? -1 : 1;
    const back = row * 44 + (i % 2) * 18;
    const lat = col * 26;
    spawns.push({
      x: p0.x - fx * back + lx * lat,
      y: p0.y - fy * back + ly * lat,
      angle: startHeading
    });
  }

  const checkpoints = [];
  for (let i = 0; i < 8; i++) {
    const idx = Math.round((startIndex + (i / 8) * linePts.length) % linePts.length);
    const p = linePts[idx];
    const n2 = linePts[(idx + 2) % linePts.length];
    const dx = n2.x - p.x, dy = n2.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    checkpoints.push({ x: p.x, y: p.y, nx: dx / len, ny: dy / len });
  }

  // Landmark anchors for scenery clustering (on/near racing line)
  const atAngle = (ang) => {
    const idx = Math.round(((ang / (Math.PI * 2)) * n + n) % n) % n;
    const p = linePts[idx];
    return { x: p.x, y: p.y, index: idx, angle: ang };
  };
  const pitA = Math.PI * 1.5;
  const kinkA = Math.PI * 1.24;
  const chicaneA = Math.PI * 0.52;
  const landmarks = [
    { id: 'start_finish', ...atAngle(Math.PI * 1.5), kind: 'start' },
    { id: 'pit', ...atAngle(pitA), kind: 'pit',
      // slightly outside toward pit bay
      x: cx + Math.cos(pitA) * (baseOuterRx + 20),
      y: cy + Math.sin(pitA) * (baseOuterRy + 36) },
    { id: 'kink', ...atAngle(kinkA), kind: 'kink' },
    { id: 'chicane', ...atAngle(chicaneA), kind: 'chicane' },
    { id: 'corner_east', ...atAngle(0), kind: 'corner' },
    { id: 'corner_south_east', ...atAngle(Math.PI * 0.25), kind: 'corner' },
    { id: 'corner_south_west', ...atAngle(Math.PI * 0.75), kind: 'corner' },
    { id: 'corner_west', ...atAngle(Math.PI), kind: 'corner' },
    { id: 'corner_north_west', ...atAngle(Math.PI * 1.2), kind: 'corner' },
    { id: 'corner_north_east', ...atAngle(Math.PI * 1.8), kind: 'corner' }
  ];

  return {
    outer: outerPts,
    inner: innerPts,
    line: linePts,
    spawns,
    checkpoints,
    startIndex,
    landmarks
  };
}

/** Densify a polyline loop. */
function densifyLoop(corners, stepsPer = 12) {
  const dense = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    for (let s = 0; s < stepsPer; s++) {
      const t = s / stepsPer;
      dense.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return dense;
}

function landmarksFromLine(line, startIndex, extras = []) {
  const n = line.length;
  const pick = (id, frac, kind) => {
    const idx = Math.round((startIndex + frac * n) % n);
    const p = line[idx];
    return { id, x: p.x, y: p.y, index: idx, kind };
  };
  return [
    pick('start_finish', 0, 'start'),
    pick('corner_1', 0.2, 'corner'),
    pick('corner_2', 0.45, 'corner'),
    pick('corner_3', 0.7, 'corner'),
    pick('corner_4', 0.9, 'corner'),
    ...extras
  ];
}

export const TRACKS = [
  {
    id: 'neon_loop',
    name: 'Neon Loop',
    difficulty: 1,
    // Warm asphalt + deep blue-grey industrial night (less pure black)
    bg: '#0c1420',
    asphalt: '#1a222c',
    wall: '#00e8ff',
    accent: '#ff2bd6',
    width: 1600,
    height: 1000,
    lapsDefault: 3,
    ...buildNeonLoopGeometry()
  },
  {
    id: 'gridlock',
    name: 'Gridlock Circuit',
    difficulty: 2,
    bg: '#0c1018',
    asphalt: '#1a1e28',
    wall: '#b8ff00',
    accent: '#ff8a00',
    width: 1700,
    height: 1100,
    lapsDefault: 3,
    ...(() => {
      // Rounded-rect ring with slight mid-straight bulges + hairpin pinch at SE
      const outer = [
        { x: 100, y: 90 }, { x: 400, y: 70 }, { x: 850, y: 70 }, { x: 1300, y: 70 },
        { x: 1580, y: 100 }, { x: 1610, y: 280 }, { x: 1620, y: 550 },
        { x: 1600, y: 820 }, { x: 1560, y: 1000 }, { x: 1300, y: 1030 },
        { x: 850, y: 1035 }, { x: 400, y: 1025 }, { x: 110, y: 1000 },
        { x: 70, y: 780 }, { x: 70, y: 550 }, { x: 80, y: 280 }
      ];
      const inner = [
        { x: 340, y: 290 }, { x: 850, y: 275 }, { x: 1320, y: 290 },
        { x: 1360, y: 400 }, { x: 1370, y: 550 }, { x: 1355, y: 720 },
        { x: 1300, y: 810 }, { x: 850, y: 825 }, { x: 380, y: 815 },
        { x: 330, y: 700 }, { x: 320, y: 550 }, { x: 330, y: 400 }
      ];
      // Racing line with a soft kink on the top straight and wider mid-straights
      const corners = [
        { x: 210, y: 175 }, { x: 500, y: 160 }, { x: 900, y: 155 },
        { x: 1280, y: 165 }, { x: 1485, y: 200 },
        { x: 1505, y: 400 }, { x: 1510, y: 550 }, { x: 1495, y: 750 },
        { x: 1460, y: 920 }, { x: 1200, y: 935 }, { x: 850, y: 940 },
        { x: 450, y: 930 }, { x: 210, y: 900 },
        { x: 185, y: 700 }, { x: 185, y: 550 }, { x: 195, y: 350 }
      ];
      const dense = densifyLoop(corners, 10);
      const startIndex = 8;
      const spawns = [];
      const p0 = dense[startIndex];
      const p1 = dense[(startIndex + 1) % dense.length];
      const startHeading = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const fx = Math.cos(startHeading), fy = Math.sin(startHeading);
      const lx = -fy, ly = fx;
      for (let i = 0; i < 8; i++) {
        const row = Math.floor(i / 2);
        const col = (i % 2 === 0) ? -1 : 1;
        spawns.push({
          x: p0.x - fx * (row * 44 + (i % 2) * 18) + lx * col * 26,
          y: p0.y - fy * (row * 44 + (i % 2) * 18) + ly * col * 26,
          angle: startHeading
        });
      }
      const checkpoints = dense.filter((_, i) => i % 10 === 0).map((p, i) => {
        const n = dense[(i * 10 + 5) % dense.length];
        const dx = n.x - p.x, dy = n.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: p.x, y: p.y, nx: dx / len, ny: dy / len };
      });
      const landmarks = landmarksFromLine(dense, startIndex, [
        { id: 'pit', x: 900, y: 55, kind: 'pit', index: startIndex }
      ]);
      return { outer, inner, line: dense, spawns, checkpoints, startIndex, landmarks };
    })()
  },
  {
    id: 'razor_hairpin',
    name: 'Razor Hairpin',
    difficulty: 3,
    bg: '#120a18',
    asphalt: '#221828',
    wall: '#ff2bd6',
    accent: '#00e8ff',
    width: 1800,
    height: 1200,
    lapsDefault: 3,
    ...(() => {
      const outer = [];
      const inner = [];
      const line = [];
      const n = 80;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const a = t * Math.PI * 2;
        // Stronger peanut pinch + asymmetric lobe for a readable hairpin
        const pinch = 1 + 0.42 * Math.cos(2 * a);
        const widthMul = 1 - 0.14 * Math.cos(2 * a);
        const rxo = 780 * pinch * (1 + (widthMul - 1) * 0.4);
        const ryo = 480 * (1 + (widthMul - 1) * 0.35);
        const rxi = 460 * pinch * (1 - (widthMul - 1) * 0.7);
        const ryi = 230 * (1 - (widthMul - 1) * 0.7);
        const rxl = (rxo + rxi) * 0.5;
        const ryl = (ryo + ryi) * 0.5;
        const cx = 900, cy = 600;
        // Soft kink on the eastern lobe
        const kink = Math.max(0, Math.sin(a) * Math.cos(a - 0.2));
        const kx = -Math.sin(a) * 18 * kink;
        const ky = Math.cos(a) * 12 * kink;
        outer.push({ x: cx + Math.cos(a) * rxo + kx * 0.5, y: cy + Math.sin(a) * ryo + ky * 0.5 });
        inner.push({ x: cx + Math.cos(a) * rxi + kx * 0.3, y: cy + Math.sin(a) * ryi + ky * 0.3 });
        line.push({ x: cx + Math.cos(a) * rxl + kx, y: cy + Math.sin(a) * ryl + ky });
      }
      const startIndex = 0;
      const spawns = [];
      const heading = Math.atan2(line[1].y - line[0].y, line[1].x - line[0].x);
      const fx = Math.cos(heading), fy = Math.sin(heading);
      const lx = -fy, ly = fx;
      for (let i = 0; i < 8; i++) {
        const row = Math.floor(i / 2);
        const col = (i % 2 === 0) ? -1 : 1;
        spawns.push({
          x: line[0].x - fx * (row * 44 + (i % 2) * 18) + lx * col * 24,
          y: line[0].y - fy * (row * 44 + (i % 2) * 18) + ly * col * 24,
          angle: heading
        });
      }
      const checkpoints = [];
      for (let i = 0; i < 10; i++) {
        const idx = ((i / 10) * line.length) | 0;
        const p = line[idx];
        const n2 = line[(idx + 3) % line.length];
        const dx = n2.x - p.x, dy = n2.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        checkpoints.push({ x: p.x, y: p.y, nx: dx / len, ny: dy / len });
      }
      const landmarks = landmarksFromLine(line, startIndex, [
        { id: 'hairpin', x: line[(n * 0.5) | 0].x, y: line[(n * 0.5) | 0].y, kind: 'chicane', index: (n * 0.5) | 0 }
      ]);
      return { outer, inner, line, spawns, checkpoints, startIndex, landmarks };
    })()
  },
  {
    id: 'cargo_dock',
    name: 'Cargo Dock',
    difficulty: 2,
    bg: '#0a120e',
    asphalt: '#18241c',
    wall: '#ffe600',
    accent: '#00e8ff',
    width: 1650,
    height: 1050,
    lapsDefault: 3,
    ...(() => {
      // Asymmetric dock circuit with a short pit notch on the north outer wall
      const outer = [
        { x: 60, y: 70 }, { x: 700, y: 55 }, { x: 1100, y: 50 },
        { x: 1400, y: 55 }, { x: 1585, y: 80 }, { x: 1595, y: 400 },
        { x: 1590, y: 700 }, { x: 1575, y: 970 }, { x: 1200, y: 995 },
        { x: 920, y: 990 }, { x: 900, y: 720 }, { x: 880, y: 640 },
        { x: 400, y: 630 }, { x: 80, y: 620 }, { x: 55, y: 350 }
      ];
      // Pit recess notch (push north wall out mid-straight)
      outer.splice(2, 0, { x: 980, y: 28 }, { x: 1080, y: 28 });
      const inner = [
        { x: 290, y: 250 }, { x: 850, y: 235 }, { x: 1250, y: 240 },
        { x: 1360, y: 260 }, { x: 1375, y: 500 }, { x: 1365, y: 780 },
        { x: 1200, y: 815 }, { x: 1125, y: 810 }, { x: 1120, y: 460 },
        { x: 900, y: 450 }, { x: 300, y: 450 }, { x: 285, y: 350 }
      ];
      const corners = [
        { x: 170, y: 155 }, { x: 550, y: 140 }, { x: 1000, y: 135 },
        { x: 1400, y: 150 }, { x: 1485, y: 280 },
        { x: 1485, y: 520 }, { x: 1475, y: 820 }, { x: 1300, y: 900 },
        { x: 1020, y: 905 }, { x: 1010, y: 540 },
        { x: 700, y: 530 }, { x: 180, y: 530 }, { x: 165, y: 340 }
      ];
      const dense = densifyLoop(corners, 12);
      const startIndex = 10;
      const spawns = [];
      const p0 = dense[startIndex];
      const p1 = dense[(startIndex + 1) % dense.length];
      const startHeading = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const fx = Math.cos(startHeading), fy = Math.sin(startHeading);
      const lx = -fy, ly = fx;
      for (let i = 0; i < 8; i++) {
        const row = Math.floor(i / 2);
        const col = (i % 2 === 0) ? -1 : 1;
        spawns.push({
          x: p0.x - fx * (row * 44 + (i % 2) * 18) + lx * col * 26,
          y: p0.y - fy * (row * 44 + (i % 2) * 18) + ly * col * 26,
          angle: startHeading
        });
      }
      const checkpoints = dense.filter((_, i) => i % 10 === 0).map((p, i) => {
        const n = dense[(i * 10 + 5) % dense.length];
        const dx = n.x - p.x, dy = n.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: p.x, y: p.y, nx: dx / len, ny: dy / len };
      });
      const landmarks = landmarksFromLine(dense, startIndex, [
        { id: 'pit', x: 1030, y: 40, kind: 'pit', index: startIndex + 5 },
        { id: 'dock_cut', x: 1010, y: 700, kind: 'kink', index: (dense.length * 0.55) | 0 }
      ]);
      return { outer, inner, line: dense, spawns, checkpoints, startIndex, landmarks };
    })()
  }
];

export function getTrack(idOrIndex) {
  if (typeof idOrIndex === 'number') return TRACKS[idOrIndex % TRACKS.length];
  return TRACKS.find((t) => t.id === idOrIndex) || TRACKS[0];
}

/** Walls as edge segments from outer + reverse inner */
export function trackWallSegments(track) {
  const segs = [];
  const addLoop = (poly, reverse = false) => {
    const pts = reverse ? [...poly].reverse() : poly;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
  };
  addLoop(track.outer, false);
  addLoop(track.inner, true);
  return segs;
}

export function isOnTrack(track, x, y) {
  const inOuter = pointInPolySimple(x, y, track.outer);
  const inInner = pointInPolySimple(x, y, track.inner);
  return inOuter && !inInner;
}

function pointInPolySimple(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Forward racing-line heading at a line index. */
function lineHeadingAt(line, idx) {
  const a = line[idx % line.length];
  const b = line[(idx + 1) % line.length];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * Find the flattest racing-line stretch (lowest cumulative curvature over a window).
 * Used when track.startIndex is not set.
 */
function findFlattestStartIndex(line, window = 8) {
  const n = line.length;
  let bestIdx = 0;
  let bestScore = Infinity;
  for (let i = 0; i < n; i++) {
    let score = 0;
    let prev = null;
    for (let k = 0; k < window; k++) {
      const a = line[(i + k) % n];
      const b = line[(i + k + 1) % n];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (prev != null) {
        let d = ang - prev;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        score += Math.abs(d);
      }
      prev = ang;
    }
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Build a readable F1-style staggered starting grid on the start straight.
 * Cars all share one heading (forward tangent). Rows go backward along -heading;
 * columns offset laterally. Positions stay on asphalt when possible.
 */
export function buildStartingGrid(track, count = 8) {
  const line = track.line;
  if (!line || line.length < 2) {
    const sp = track.spawns?.[0] || { x: track.width / 2, y: track.height / 2, angle: 0 };
    const ang = sp.angle ?? 0;
    return Array.from({ length: count }, (_, i) => ({
      x: sp.x - i * 36,
      y: sp.y + ((i % 2) ? 22 : -22),
      angle: ang
    }));
  }

  const n = line.length;
  let startIdx;
  if (typeof track.startIndex === 'number') {
    startIdx = ((track.startIndex % n) + n) % n;
  } else {
    startIdx = findFlattestStartIndex(line, 8);
  }

  const pole = line[startIdx];
  const sx = pole.x;
  const sy = pole.y;
  const heading = lineHeadingAt(line, startIdx);

  const fx = Math.cos(heading);
  const fy = Math.sin(heading);
  const lx = -fy;
  const ly = fx;

  const rowGap = 44;
  const colGap = 26;
  const stagger = 18;

  const out = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / 2);
    const col = (i % 2 === 0) ? -1 : 1;
    const back = row * rowGap + (i % 2) * stagger;
    let lat = col * colGap;
    let x = sx - fx * back + lx * lat;
    let y = sy - fy * back + ly * lat;
    if (!isOnTrack(track, x, y)) {
      let placed = false;
      for (let t = 0.85; t >= 0.1 && !placed; t -= 0.15) {
        const tx = sx - fx * back + lx * (lat * t);
        const ty = sy - fy * back + ly * (lat * t);
        if (isOnTrack(track, tx, ty)) {
          x = tx; y = ty; placed = true;
        }
      }
      for (let b = back; b >= 0 && !placed; b -= 12) {
        for (const t of [0.5, 0.25, 0]) {
          const tx = sx - fx * b + lx * (lat * t);
          const ty = sy - fy * b + ly * (lat * t);
          if (isOnTrack(track, tx, ty)) {
            x = tx; y = ty; placed = true;
            break;
          }
        }
      }
      if (!placed) {
        x = sx - fx * Math.min(back, 20) + lx * (col * 10);
        y = sy - fy * Math.min(back, 20) + ly * (col * 10);
      }
    }
    out.push({ x, y, angle: heading });
  }

  if (track.spawns && track.spawns.length) {
    for (let i = 0; i < track.spawns.length; i++) {
      const g = out[i] || out[out.length - 1];
      track.spawns[i].x = g.x;
      track.spawns[i].y = g.y;
      track.spawns[i].angle = heading;
    }
  }

  return out;
}
