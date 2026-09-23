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

/**
 * Build outer/inner walls as a constant-width ribbon around a centreline.
 * Normals point "left" of travel; +halfW = outer, -halfW = inner for CCW centreline.
 */

/** Closed rounded-rect centreline (straight samples + corner arcs). */
function roundedRectCenterline(cx, cy, rw, rh, radius, edgeN = 18, arcN = 10) {
  const r = Math.min(radius, rw * 0.45, rh * 0.45);
  const left = cx - rw, right = cx + rw, top = cy - rh, bot = cy + rh;
  const pts = [];
  // Top edge L→R
  for (let i = 0; i < edgeN; i++) {
    const t = i / edgeN;
    pts.push({ x: left + r + (right - left - 2 * r) * t, y: top });
  }
  // Top-right arc
  for (let i = 0; i < arcN; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / arcN);
    pts.push({ x: right - r + Math.cos(a) * r, y: top + r + Math.sin(a) * r });
  }
  // Right edge T→B
  for (let i = 0; i < edgeN; i++) {
    const t = i / edgeN;
    pts.push({ x: right, y: top + r + (bot - top - 2 * r) * t });
  }
  // Bottom-right arc
  for (let i = 0; i < arcN; i++) {
    const a = 0 + (Math.PI / 2) * (i / arcN);
    pts.push({ x: right - r + Math.cos(a) * r, y: bot - r + Math.sin(a) * r });
  }
  // Bottom edge R→L
  for (let i = 0; i < edgeN; i++) {
    const t = i / edgeN;
    pts.push({ x: right - r - (right - left - 2 * r) * t, y: bot });
  }
  // Bottom-left arc
  for (let i = 0; i < arcN; i++) {
    const a = Math.PI / 2 + (Math.PI / 2) * (i / arcN);
    pts.push({ x: left + r + Math.cos(a) * r, y: bot - r + Math.sin(a) * r });
  }
  // Left edge B→T
  for (let i = 0; i < edgeN; i++) {
    const t = i / edgeN;
    pts.push({ x: left, y: bot - r - (bot - top - 2 * r) * t });
  }
  // Top-left arc
  for (let i = 0; i < arcN; i++) {
    const a = Math.PI + (Math.PI / 2) * (i / arcN);
    pts.push({ x: left + r + Math.cos(a) * r, y: top + r + Math.sin(a) * r });
  }
  return pts;
}

function offsetRibbon(centerline, halfW) {
  const n = centerline.length;
  const outer = [];
  const inner = [];
  for (let i = 0; i < n; i++) {
    const prev = centerline[(i - 1 + n) % n];
    const cur = centerline[i];
    const next = centerline[(i + 1) % n];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const tlen = Math.hypot(tx, ty) || 1;
    tx /= tlen; ty /= tlen;
    // Left normal (CCW centreline → outward for typical oval)
    const nx = -ty, ny = tx;
    outer.push({ x: cur.x + nx * halfW, y: cur.y + ny * halfW });
    inner.push({ x: cur.x - nx * halfW, y: cur.y - ny * halfW });
  }
  return { outer, inner };
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
 * Neon Loop — oval DNA with parallel walls (constant track width).
 * Features are centreline offsets so outer/inner stay roughly parallel.
 * Start on top straight facing +X (clockwise on canvas).
 */
function buildNeonLoopGeometry() {
  const cx = 1400, cy = 1100;
  const n = 144;
  const halfW = 270; // constant ribbon half-width → ~540wu lane
  const baseRx = 1030, baseRy = 575;

  const centerline = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let rx = baseRx;
    let ry = baseRy;
    // Mild radial breathing on the centreline only (walls stay parallel)
    const breath = 1 + 0.03 * Math.cos(2 * a);
    rx *= breath;
    ry *= breath;

    let x = cx + Math.cos(a) * rx;
    let y = cy + Math.sin(a) * ry;

    // Tangential frame for lateral shove (features move BOTH walls together)
    const tx = -Math.sin(a), ty = Math.cos(a);
    const nx = Math.cos(a), ny = Math.sin(a);

    // Soft kink before main (top) straight — NW approach
    const kink = angleBump(a, Math.PI * 1.12, Math.PI * 1.36);
    if (kink > 0) {
      const shove = 70 * kink;
      x += tx * shove;
      y += ty * shove;
    }

    // Soft S-chicane opposite start (bottom) — lateral weave, NOT a pinch
    const chi1 = angleBump(a, Math.PI * 0.32, Math.PI * 0.52);
    const chi2 = angleBump(a, Math.PI * 0.52, Math.PI * 0.72);
    if (chi1 > 0 || chi2 > 0) {
      const side = (chi1 - chi2) * 95;
      x += tx * side;
      y += ty * side;
    }

    // Pit recess: shove centreline outward on S/F straight so bay reads without flaring width
    const pit = angleBump(a, Math.PI * 1.38, Math.PI * 1.62);
    if (pit > 0) {
      x += nx * 55 * pit;
      y += ny * 70 * pit;
    }

    centerline.push({ x, y, _a: a });
  }

  const { outer: outerPts, inner: innerPts } = offsetRibbon(centerline, halfW);
  const linePts = centerline.map((p) => ({ x: p.x, y: p.y }));

  // Start on TOP of ellipse — long flat stretch — facing +X (right).
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
    const back = row * 56 + (i % 2) * 22;
    const lat = col * 32;
    spawns.push({
      x: p0.x - fx * back + lx * lat,
      y: p0.y - fy * back + ly * lat,
      angle: startHeading
    });
  }

  const cpCount = 18;
  const checkpoints = [];
  for (let i = 0; i < cpCount; i++) {
    const idx = Math.round((startIndex + (i / cpCount) * linePts.length) % linePts.length);
    const p = linePts[idx];
    const n2 = linePts[(idx + 3) % linePts.length];
    const dx = n2.x - p.x, dy = n2.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    checkpoints.push({ x: p.x, y: p.y, nx: dx / len, ny: dy / len });
  }

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
      x: cx + Math.cos(pitA) * (baseRx + halfW + 36),
      y: cy + Math.sin(pitA) * (baseRy + halfW + 64) },
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
    landmarks,
    cpHitRadius: 280
  };
}


/** Scale a list of {x,y} points about an optional origin (default centroid-ish 0). */
function scalePts(pts, s, ox = 0, oy = 0) {
  return pts.map((p) => ({ x: ox + (p.x - ox) * s, y: oy + (p.y - oy) * s }));
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
    width: 2900,
    height: 2100,
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
    width: 2380,
    height: 1540,
    lapsDefault: 3,
    ...(() => {
      // City ring with PARALLEL walls: rounded-rect centreline + constant half-width
      const cx = 1190, cy = 770;
      const halfW = 175;
      const dense = roundedRectCenterline(cx, cy, 920, 560, 210, 22, 14);
      // Mild pit bay: shove N straight centreline outward (parallel walls preserved)
      for (const p of dense) {
        if (p.y < cy - 520 && p.x > cx - 220 && p.x < cx + 220) {
          const u = 1 - Math.abs(p.x - cx) / 220;
          p.y -= 48 * Math.max(0, u);
        }
      }
      // Mild SE hairpin: pull centreline inward at SE (still parallel ribbon)
      for (const p of dense) {
        const dx = p.x - (cx + 620), dy = p.y - (cy + 380);
        const d = Math.hypot(dx, dy);
        if (d < 280) {
          const u = 1 - d / 280;
          p.x -= dx * 0.12 * u;
          p.y -= dy * 0.12 * u;
        }
      }
      const { outer, inner } = offsetRibbon(dense, halfW);
      // Start on north straight facing +X
      let startIndex = 0;
      let best = Infinity;
      for (let i = 0; i < dense.length; i++) {
        const p = dense[i];
        const score = Math.abs(p.y - (cy - 560)) + Math.abs(p.x - cx);
        if (score < best) { best = score; startIndex = i; }
      }
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
          x: p0.x - fx * (row * 52 + (i % 2) * 20) + lx * col * 30,
          y: p0.y - fy * (row * 52 + (i % 2) * 20) + ly * col * 30,
          angle: startHeading
        });
      }
      const checkpoints = [];
      const cpN = 16;
      for (let i = 0; i < cpN; i++) {
        const idx = Math.round((startIndex + (i / cpN) * dense.length) % dense.length);
        const p = dense[idx];
        const n = dense[(idx + 4) % dense.length];
        const dx = n.x - p.x, dy = n.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        checkpoints.push({ x: p.x, y: p.y, nx: dx / len, ny: dy / len });
      }
      const hairIdx = Math.round(dense.length * 0.55) % dense.length;
      const landmarks = [
        { id: 'start_finish', x: p0.x, y: p0.y, index: startIndex, kind: 'start' },
        { id: 'pit', x: cx, y: cy - 560 - halfW - 30, kind: 'pit', index: startIndex },
        { id: 'hairpin', x: dense[hairIdx].x, y: dense[hairIdx].y, kind: 'chicane', index: hairIdx },
        { id: 'corner_ne', x: cx + 920, y: cy - 400, kind: 'corner', index: Math.round(dense.length * 0.2) },
        { id: 'corner_sw', x: cx - 900, y: cy + 500, kind: 'corner', index: Math.round(dense.length * 0.75) },
        { id: 'corner_nw', x: cx - 900, y: cy - 400, kind: 'corner', index: Math.round(dense.length * 0.9) }
      ];
      return { outer, inner, line: dense, spawns, checkpoints, startIndex, landmarks, cpHitRadius: 260 };
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
    width: 2520,
    height: 1680,
    lapsDefault: 3,
    ...(() => {
      // Twin-apex peanut (~1.4×)
      const outer = [];
      const inner = [];
      const line = [];
      const n = 128;
      const S = 1.4;
      const cx = 900 * S, cy = 600 * S;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const lobe = 1 + 0.48 * Math.cos(2 * a);
        const waist = 1 - 0.18 * Math.max(0, Math.cos(4 * a));
        const widthMul = 1 - 0.16 * Math.cos(2 * a);
        let rxo = 760 * S * lobe * waist * (1 + (widthMul - 1) * 0.35);
        let ryo = 470 * S * waist * (1 + (widthMul - 1) * 0.3);
        let rxi = 430 * S * lobe * waist * (1 - (widthMul - 1) * 0.75);
        let ryi = 210 * S * waist * (1 - (widthMul - 1) * 0.75);
        const apexE = angleBump(a, -0.35, 0.35);
        const apexW = angleBump(a, Math.PI - 0.35, Math.PI + 0.35);
        const apex = Math.max(apexE, apexW);
        if (apex > 0) {
          rxo -= 56 * apex;
          ryo -= 77 * apex;
          rxi += 49 * apex;
          ryi += 67 * apex;
        }
        const rxl = (rxo + rxi) * 0.5;
        const ryl = (ryo + ryi) * 0.5;
        const kink = Math.sin(2 * a) * 0.35;
        const kx = -Math.sin(a) * 31 * kink;
        const ky = Math.cos(a) * 20 * kink;
        outer.push({ x: cx + Math.cos(a) * rxo + kx * 0.4, y: cy + Math.sin(a) * ryo + ky * 0.4 });
        inner.push({ x: cx + Math.cos(a) * rxi + kx * 0.25, y: cy + Math.sin(a) * ryi + ky * 0.25 });
        line.push({ x: cx + Math.cos(a) * rxl + kx, y: cy + Math.sin(a) * ryl + ky });
      }
      const startIndex = Math.round(n * 0.25) % n;
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
          x: p0.x - fx * (row * 52 + (i % 2) * 20) + lx * col * 28,
          y: p0.y - fy * (row * 52 + (i % 2) * 20) + ly * col * 28,
          angle: heading
        });
      }
      const checkpoints = [];
      for (let i = 0; i < 14; i++) {
        const idx = Math.round((startIndex + (i / 14) * line.length) % line.length);
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
      return { outer, inner, line, spawns, checkpoints, startIndex, landmarks, cpHitRadius: 260 };
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
    width: 2310,
    height: 1470,
    lapsDefault: 3,
    ...(() => {
      // Quay / warehouse / pinch (~1.4×)
      const S = 1.4;
      const outerCorners = scalePts([
        { x: 55, y: 80 }, { x: 400, y: 55 }, { x: 750, y: 48 },
        { x: 980, y: 22 }, { x: 1100, y: 22 },
        { x: 1350, y: 50 }, { x: 1580, y: 85 },
        { x: 1605, y: 320 }, { x: 1605, y: 620 }, { x: 1595, y: 880 },
        { x: 1580, y: 1000 }, { x: 1280, y: 1020 }, { x: 980, y: 1010 },
        { x: 920, y: 780 }, { x: 900, y: 620 }, { x: 860, y: 560 },
        { x: 420, y: 550 }, { x: 70, y: 540 }, { x: 45, y: 300 }
      ], S);
      const innerCorners = scalePts([
        { x: 280, y: 250 }, { x: 700, y: 230 }, { x: 1100, y: 225 },
        { x: 1320, y: 250 }, { x: 1365, y: 380 }, { x: 1370, y: 650 },
        { x: 1355, y: 820 }, { x: 1220, y: 860 }, { x: 1120, y: 850 },
        { x: 1105, y: 520 }, { x: 980, y: 480 }, { x: 420, y: 470 },
        { x: 290, y: 460 }, { x: 275, y: 340 }
      ], S);
      const outer = densifyLoop(outerCorners, 10);
      const inner = densifyLoop(innerCorners, 10);
      const lineCorners = scalePts([
        { x: 160, y: 160 }, { x: 500, y: 135 }, { x: 900, y: 120 },
        { x: 1040, y: 110 }, { x: 1400, y: 145 }, { x: 1495, y: 280 },
        { x: 1500, y: 520 }, { x: 1490, y: 820 }, { x: 1350, y: 930 },
        { x: 1100, y: 940 }, { x: 1020, y: 700 }, { x: 1000, y: 530 },
        { x: 700, y: 515 }, { x: 180, y: 510 }, { x: 155, y: 320 }
      ], S);
      const dense = densifyLoop(lineCorners, 14);
      const startIndex = 22;
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
          x: p0.x - fx * (row * 52 + (i % 2) * 20) + lx * col * 30,
          y: p0.y - fy * (row * 52 + (i % 2) * 20) + ly * col * 30,
          angle: startHeading
        });
      }
      const checkpoints = [];
      const cpN = 16;
      for (let i = 0; i < cpN; i++) {
        const idx = Math.round((startIndex + (i / cpN) * dense.length) % dense.length);
        const p = dense[idx];
        const n = dense[(idx + 4) % dense.length];
        const dx = n.x - p.x, dy = n.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        checkpoints.push({ x: p.x, y: p.y, nx: dx / len, ny: dy / len });
      }
      const pinchIdx = Math.round(dense.length * 0.62) % dense.length;
      const whIdx = Math.round(dense.length * 0.35) % dense.length;
      const landmarks = [
        { id: 'start_finish', x: p0.x, y: p0.y, index: startIndex, kind: 'start' },
        { id: 'pit', x: 1040 * S, y: 18 * S, kind: 'pit', index: startIndex + 4 },
        { id: 'warehouse_corner', x: dense[whIdx].x, y: dense[whIdx].y, kind: 'corner', index: whIdx },
        { id: 'dock_pinch', x: dense[pinchIdx].x, y: dense[pinchIdx].y, kind: 'kink', index: pinchIdx },
        { id: 'quay_east', x: 1495 * S, y: 280 * S, kind: 'corner', index: Math.round(dense.length * 0.22) }
      ];
      return { outer, inner, line: dense, spawns, checkpoints, startIndex, landmarks, cpHitRadius: 260 };
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
