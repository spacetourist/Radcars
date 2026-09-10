/** Geometric tracks: outer/inner wall polygons, racing line waypoints, spawns, checkpoint gates. */

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

function midLine(outer, inner) {
  // Approximate racing line as ellipse mid between extents using sampled angles from outer centroid
  const cx = outer.reduce((s, p) => s + p.x, 0) / outer.length;
  const cy = outer.reduce((s, p) => s + p.y, 0) / outer.length;
  return null; // filled per track
}

export const TRACKS = [
  {
    id: 'neon_loop',
    name: 'Neon Loop',
    difficulty: 1,
    bg: '#080c12',
    asphalt: '#161c24',
    wall: '#00e8ff',
    accent: '#ff2bd6',
    width: 1600,
    height: 1000,
    lapsDefault: 3,
    ...(() => {
      const cx = 800, cy = 500;
      const outer = ovalPoints(cx, cy, 720, 420, 56);
      const inner = ovalPoints(cx, cy, 420, 200, 48);
      const line = ovalPoints(cx, cy, 570, 310, 64);
      // Start on right side going up (counterclockwise-ish: start bottom of right)
      const spawns = [];
      for (let i = 0; i < 8; i++) {
        spawns.push({
          x: cx + 570,
          y: cy + 40 + i * 28,
          angle: -Math.PI / 2
        });
      }
      const checkpoints = [];
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + (i / 8) * Math.PI * 2;
        checkpoints.push({
          x: cx + Math.cos(a) * 570,
          y: cy + Math.sin(a) * 310,
          nx: Math.cos(a),
          ny: Math.sin(a)
        });
      }
      return { outer, inner, line, spawns, checkpoints, startIndex: 0 };
    })()
  },
  {
    id: 'gridlock',
    name: 'Gridlock Circuit',
    difficulty: 2,
    bg: '#0a0a0e',
    asphalt: '#181820',
    wall: '#b8ff00',
    accent: '#ff8a00',
    width: 1700,
    height: 1100,
    lapsDefault: 3,
    ...(() => {
      // Rounded rectangle track via outer/inner polygons
      const outer = [
        { x: 80, y: 80 }, { x: 1620, y: 80 }, { x: 1620, y: 1020 }, { x: 80, y: 1020 }
      ];
      const inner = [
        { x: 320, y: 280 }, { x: 1380, y: 280 }, { x: 1380, y: 820 }, { x: 320, y: 820 }
      ];
      const line = [
        { x: 200, y: 180 }, { x: 850, y: 180 }, { x: 1500, y: 180 },
        { x: 1500, y: 550 }, { x: 1500, y: 920 },
        { x: 850, y: 920 }, { x: 200, y: 920 },
        { x: 200, y: 550 }
      ];
      // densify line
      const dense = [];
      for (let i = 0; i < line.length; i++) {
        const a = line[i], b = line[(i + 1) % line.length];
        const steps = 12;
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          dense.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
      }
      const spawns = [];
      for (let i = 0; i < 8; i++) {
        spawns.push({ x: 200 + i * 22, y: 180 + (i % 2) * 18, angle: 0 });
      }
      const checkpoints = dense.filter((_, i) => i % 8 === 0).map((p, i, arr) => {
        const n = dense[(i * 8 + 4) % dense.length];
        const dx = n.x - p.x, dy = n.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: p.x, y: p.y, nx: dx / len, ny: dy / len };
      });
      return { outer, inner, line: dense, spawns, checkpoints, startIndex: 0 };
    })()
  },
  {
    id: 'razor_hairpin',
    name: 'Razor Hairpin',
    difficulty: 3,
    bg: '#0e0812',
    asphalt: '#1c1420',
    wall: '#ff2bd6',
    accent: '#00e8ff',
    width: 1800,
    height: 1200,
    lapsDefault: 3,
    ...(() => {
      // Figure-8 inspired / twin lobe using two circles merged as walls approx via sampled path
      const outer = [];
      const inner = [];
      const line = [];
      const n = 72;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // peanut / stadium with pinch
        const a = t * Math.PI * 2;
        const pinch = 1 + 0.35 * Math.cos(2 * a);
        const rxo = 780 * pinch, ryo = 480;
        const rxi = 480 * pinch, ryi = 240;
        const rxl = 630 * pinch, ryl = 360;
        const cx = 900, cy = 600;
        outer.push({ x: cx + Math.cos(a) * rxo, y: cy + Math.sin(a) * ryo });
        inner.push({ x: cx + Math.cos(a) * rxi, y: cy + Math.sin(a) * ryi });
        line.push({ x: cx + Math.cos(a) * rxl, y: cy + Math.sin(a) * ryl });
      }
      const spawns = [];
      for (let i = 0; i < 8; i++) {
        const p = line[0];
        spawns.push({ x: p.x - 30 + i * 18, y: p.y + 10 + (i % 2) * 20, angle: Math.atan2(line[1].y - line[0].y, line[1].x - line[0].x) });
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
      return { outer, inner, line, spawns, checkpoints, startIndex: 0 };
    })()
  },
  {
    id: 'cargo_dock',
    name: 'Cargo Dock',
    difficulty: 2,
    bg: '#080c0a',
    asphalt: '#141c16',
    wall: '#ffe600',
    accent: '#00e8ff',
    width: 1650,
    height: 1050,
    lapsDefault: 3,
    ...(() => {
      // L-ish / asymmetric circuit
      const outer = [
        { x: 60, y: 60 }, { x: 1590, y: 60 }, { x: 1590, y: 990 },
        { x: 900, y: 990 }, { x: 900, y: 620 }, { x: 60, y: 620 }
      ];
      const inner = [
        { x: 280, y: 240 }, { x: 1370, y: 240 }, { x: 1370, y: 810 },
        { x: 1120, y: 810 }, { x: 1120, y: 440 }, { x: 280, y: 440 }
      ];
      const corners = [
        { x: 170, y: 150 }, { x: 850, y: 150 }, { x: 1480, y: 150 },
        { x: 1480, y: 520 }, { x: 1480, y: 900 },
        { x: 1010, y: 900 }, { x: 1010, y: 530 },
        { x: 170, y: 530 }
      ];
      const dense = [];
      for (let i = 0; i < corners.length; i++) {
        const a = corners[i], b = corners[(i + 1) % corners.length];
        const steps = 14;
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          dense.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
      }
      const spawns = [];
      for (let i = 0; i < 8; i++) {
        spawns.push({ x: 170 + i * 20, y: 150 + (i % 2) * 16, angle: 0 });
      }
      const checkpoints = dense.filter((_, i) => i % 10 === 0).map((p, i) => {
        const n = dense[(i * 10 + 5) % dense.length];
        const dx = n.x - p.x, dy = n.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: p.x, y: p.y, nx: dx / len, ny: dy / len };
      });
      return { outer, inner, line: dense, spawns, checkpoints, startIndex: 0 };
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
  // inside outer, outside inner
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
