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
    wall: '#b8ff00', // lime identity
    accent: '#ff8a00',
    width: 1700,
    height: 1100,
    lapsDefault: 3,
    ...(() => {
      // Rounded-rect city ring: pit bay on north, hairpin pinch SE, soft corner radii
      const outerCorners = [
        { x: 110, y: 100 }, { x: 420, y: 72 }, { x: 820, y: 58 }, { x: 980, y: 28 }, // pit recess
        { x: 1120, y: 28 }, { x: 1280, y: 68 }, { x: 1520, y: 95 },
        { x: 1605, y: 260 }, { x: 1625, y: 520 }, { x: 1605, y: 780 },
        // SE hairpin — outer swings wide then snaps
        { x: 1540, y: 980 }, { x: 1380, y: 1045 }, { x: 1180, y: 1060 },
        { x: 850, y: 1045 }, { x: 420, y: 1025 }, { x: 120, y: 990 },
        { x: 65, y: 760 }, { x: 60, y: 520 }, { x: 75, y: 280 }
      ];
      const innerCorners = [
        { x: 350, y: 300 }, { x: 820, y: 280 }, { x: 1280, y: 295 },
        { x: 1355, y: 390 }, { x: 1375, y: 540 }, { x: 1350, y: 700 },
        // SE hairpin pinch — inner pushes out toward outer
        { x: 1280, y: 820 }, { x: 1180, y: 860 }, { x: 980, y: 855 },
        { x: 850, y: 835 }, { x: 400, y: 820 }, { x: 335, y: 690 },
        { x: 320, y: 540 }, { x: 335, y: 400 }
      ];
      const outer = densifyLoop(outerCorners, 8);
      const inner = densifyLoop(innerCorners, 8);
      const lineCorners = [
        { x: 220, y: 185 }, { x: 520, y: 155 }, { x: 900, y: 140 },
        { x: 1050, y: 125 }, { x: 1300, y: 160 }, { x: 1480, y: 200 },
        { x: 1515, y: 400 }, { x: 1520, y: 560 }, { x: 1490, y: 760 },
        // hairpin racing line (tight apex)
        { x: 1420, y: 930 }, { x: 1280, y: 970 }, { x: 1100, y: 955 },
        { x: 850, y: 940 }, { x: 450, y: 925 }, { x: 210, y: 890 },
        { x: 180, y: 680 }, { x: 175, y: 520 }, { x: 190, y: 340 }
      ];
      const dense = densifyLoop(lineCorners, 10);
      const startIndex = 12; // north straight near pit
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
      const hairIdx = Math.round(dense.length * 0.55) % dense.length;
      const landmarks = [
        { id: 'start_finish', x: p0.x, y: p0.y, index: startIndex, kind: 'start' },
        { id: 'pit', x: 1050, y: 20, kind: 'pit', index: startIndex },
        { id: 'hairpin', x: dense[hairIdx].x, y: dense[hairIdx].y, kind: 'chicane', index: hairIdx },
        { id: 'corner_ne', x: 1480, y: 200, kind: 'corner', index: Math.round(dense.length * 0.2) },
        { id: 'corner_sw', x: 210, y: 890, kind: 'corner', index: Math.round(dense.length * 0.75) },
        { id: 'corner_nw', x: 190, y: 340, kind: 'corner', index: Math.round(dense.length * 0.9) }
      ];
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
      // Twin-apex peanut: two tight lobes linked by a pinched waist
      const outer = [];
      const inner = [];
      const line = [];
      const n = 96;
      const cx = 900, cy = 600;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        // Peanut: stretch on cos(2a), waist pinch mid-lobes
        const lobe = 1 + 0.48 * Math.cos(2 * a);
        const waist = 1 - 0.18 * Math.max(0, Math.cos(4 * a));
        const widthMul = 1 - 0.16 * Math.cos(2 * a); // tighter at apexes
        let rxo = 760 * lobe * waist * (1 + (widthMul - 1) * 0.35);
        let ryo = 470 * waist * (1 + (widthMul - 1) * 0.3);
        let rxi = 430 * lobe * waist * (1 - (widthMul - 1) * 0.75);
        let ryi = 210 * waist * (1 - (widthMul - 1) * 0.75);
        // Twin apex sharpening near a≈0 and a≈π (east/west lobes)
        const apexE = angleBump(a, -0.35, 0.35);
        const apexW = angleBump(a, Math.PI - 0.35, Math.PI + 0.35);
        const apex = Math.max(apexE, apexW);
        if (apex > 0) {
          rxo -= 40 * apex;
          ryo -= 55 * apex;
          rxi += 35 * apex;
          ryi += 48 * apex;
        }
        const rxl = (rxo + rxi) * 0.5;
        const ryl = (ryo + ryi) * 0.5;
        // Soft S between apexes
        const kink = Math.sin(2 * a) * 0.35;
        const kx = -Math.sin(a) * 22 * kink;
        const ky = Math.cos(a) * 14 * kink;
        outer.push({ x: cx + Math.cos(a) * rxo + kx * 0.4, y: cy + Math.sin(a) * ryo + ky * 0.4 });
        inner.push({ x: cx + Math.cos(a) * rxi + kx * 0.25, y: cy + Math.sin(a) * ryi + ky * 0.25 });
        line.push({ x: cx + Math.cos(a) * rxl + kx, y: cy + Math.sin(a) * ryl + ky });
      }
      const startIndex = Math.round(n * 0.25) % n; // northish between apexes
      const spawns = [];
      const p0 = line[startIndex];
      const p1 = line[(startIndex + 1) % n];
      const heading = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const fx = Math.cos(heading), fy = Math.sin(heading);
      const lx = -fy, ly = fx;
      for (let i = 0; i < 8; i++) {
        const row = Math.floor(i / 2);
        const col = (i % 2 === 0) ? -1 : 1;
        spawns.push({
          x: p0.x - fx * (row * 44 + (i % 2) * 18) + lx * col * 24,
          y: p0.y - fy * (row * 44 + (i % 2) * 18) + ly * col * 24,
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
      const iE = 0, iW = (n * 0.5) | 0;
      const landmarks = [
        { id: 'start_finish', x: p0.x, y: p0.y, index: startIndex, kind: 'start' },
        { id: 'apex_east', x: line[iE].x, y: line[iE].y, kind: 'corner', index: iE },
        { id: 'apex_west', x: line[iW].x, y: line[iW].y, kind: 'corner', index: iW },
        { id: 'waist_south', x: line[(n * 0.25) | 0].x, y: line[(n * 0.25) | 0].y, kind: 'kink', index: (n * 0.25) | 0 },
        { id: 'waist_north', x: line[(n * 0.75) | 0].x, y: line[(n * 0.75) | 0].y, kind: 'kink', index: (n * 0.75) | 0 }
      ];
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
      // Quay straight (long N), warehouse 90° SE block, narrow pinch mid-west cut
      const outerCorners = [
        { x: 55, y: 80 }, { x: 400, y: 55 }, { x: 750, y: 48 },
        { x: 980, y: 22 }, { x: 1100, y: 22 }, // pit notch on quay
        { x: 1350, y: 50 }, { x: 1580, y: 85 },
        // warehouse 90° — hard SE industrial corner
        { x: 1605, y: 320 }, { x: 1605, y: 620 }, { x: 1595, y: 880 },
        { x: 1580, y: 1000 }, { x: 1280, y: 1020 }, { x: 980, y: 1010 },
        // narrow pinch / dock cut
        { x: 920, y: 780 }, { x: 900, y: 620 }, { x: 860, y: 560 },
        { x: 420, y: 550 }, { x: 70, y: 540 }, { x: 45, y: 300 }
      ];
      const innerCorners = [
        { x: 280, y: 250 }, { x: 700, y: 230 }, { x: 1100, y: 225 },
        { x: 1320, y: 250 }, { x: 1365, y: 380 }, { x: 1370, y: 650 },
        { x: 1355, y: 820 }, { x: 1220, y: 860 }, { x: 1120, y: 850 },
        // pinch — inner pushes toward outer on west cut
        { x: 1105, y: 520 }, { x: 980, y: 480 }, { x: 420, y: 470 },
        { x: 290, y: 460 }, { x: 275, y: 340 }
      ];
      const outer = densifyLoop(outerCorners, 8);
      const inner = densifyLoop(innerCorners, 8);
      const lineCorners = [
        { x: 160, y: 160 }, { x: 500, y: 135 }, { x: 900, y: 120 },
        { x: 1040, y: 110 }, { x: 1400, y: 145 }, { x: 1495, y: 280 },
        { x: 1500, y: 520 }, { x: 1490, y: 820 }, { x: 1350, y: 930 },
        { x: 1100, y: 940 }, { x: 1020, y: 700 }, { x: 1000, y: 530 },
        { x: 700, y: 515 }, { x: 180, y: 510 }, { x: 155, y: 320 }
      ];
      const dense = densifyLoop(lineCorners, 12);
      const startIndex = 18; // quay straight
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
      const pinchIdx = Math.round(dense.length * 0.62) % dense.length;
      const whIdx = Math.round(dense.length * 0.35) % dense.length;
      const landmarks = [
        { id: 'start_finish', x: p0.x, y: p0.y, index: startIndex, kind: 'start' },
        { id: 'pit', x: 1040, y: 18, kind: 'pit', index: startIndex + 4 },
        { id: 'warehouse_corner', x: dense[whIdx].x, y: dense[whIdx].y, kind: 'corner', index: whIdx },
        { id: 'dock_pinch', x: dense[pinchIdx].x, y: dense[pinchIdx].y, kind: 'kink', index: pinchIdx },
        { id: 'quay_east', x: 1495, y: 280, kind: 'corner', index: Math.round(dense.length * 0.22) }
      ];
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
