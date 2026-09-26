/**
 * Radcars track geometry check (node docs/check-geometry.mjs).
 * Fails (exit 1) on: centreline or wall self-intersection, left/right wall
 * crossing, inner-offset folding, radius too tight for the half-width,
 * segment-to-segment heading jumps, curvature jumps, or two non-adjacent
 * sections of track coming too close (wall-to-wall gap).
 */
import { TRACKS } from '../js/tracks.js';

export const LIMITS = {
  minRadiusOverHalfW: 1.8,   // tightest corner radius must be >= 1.8 × half-width
  maxHeadingStepDeg: 6.0,    // max heading change between consecutive 30-wu segments
  maxCurvatureStepDeg: 0.6,  // max change of that heading step between neighbours (curvature continuity)
  minWallGap: 150            // min gap between walls of non-adjacent sections (wu)
};

const deg = (r) => (r * 180) / Math.PI;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

function segsIntersect(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

function selfIntersections(poly, skip = 2) {
  const n = poly.length; let count = 0; let first = null;
  for (let i = 0; i < n; i++) {
    for (let j = i + skip; j < n; j++) {
      if ((j + skip) % n <= i && i - (j + skip - n) < skip) continue; // adjacent across the wrap
      if (Math.min(Math.abs(i - j), n - Math.abs(i - j)) < skip) continue;
      if (segsIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) { count++; first ??= [i, j]; }
    }
  }
  return { count, first };
}

function crossIntersections(A, B) {
  const n = A.length, m = B.length; let count = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    if (segsIntersect(A[i], A[(i + 1) % n], B[j], B[(j + 1) % m])) count++;
  }
  return count;
}

export function checkTrack(t) {
  const { pts, left, right, halfW, length } = t;
  const n = pts.length;
  // heading per segment
  const hd = pts.map((p, i) => { const q = pts[(i + 1) % n]; return Math.atan2(q.y - p.y, q.x - p.x); });
  const step = hd.map((h, i) => wrap(hd[(i + 1) % n] - h));           // heading change per segment
  const curvStep = step.map((s, i) => Math.abs(step[(i + 1) % n] - s)); // change of heading change
  const maxHeadingStep = Math.max(...step.map(Math.abs));
  const maxCurvStep = Math.max(...curvStep);
  const curvAt = pts[curvStep.indexOf(maxCurvStep)].s;
  // radius from heading change over ±2 segments (curvature = dθ/ds)
  let minR = Infinity, minRAt = 0;
  for (let i = 0; i < n; i++) {
    let dth = 0, ds = 0;
    for (let k = -2; k < 2; k++) { dth += step[(i + k + n) % n]; ds += pts[(i + k + n) % n].len; }
    const R = Math.abs(dth) > 1e-9 ? ds / Math.abs(dth) : Infinity;
    if (R < minR) { minR = R; minRAt = i; }
  }
  // inner-offset folding: every wall segment must run the same way as the centreline
  let folds = 0;
  for (const wall of [left, right]) {
    for (let i = 0; i < n; i++) {
      const a = wall[i], b = wall[(i + 1) % n];
      const dot = (b.x - a.x) * pts[i].tx + (b.y - a.y) * pts[i].ty;
      if (dot <= pts[i].len * 0.2) folds++;
    }
  }
  const selfC = selfIntersections(pts);
  const selfL = selfIntersections(left);
  const selfR = selfIntersections(right);
  const crossLR = crossIntersections(left, right);
  // clearance between non-adjacent sections
  const clearance = 2 * halfW + LIMITS.minWallGap;
  const localArc = clearance * Math.PI / 2 + 2 * halfW;
  let minGap = Infinity, gapAt = null;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let arc = Math.abs(pts[j].s - pts[i].s); arc = Math.min(arc, length - arc);
    if (arc < localArc) continue;
    const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
    const gap = d - 2 * halfW;
    if (gap < minGap) { minGap = gap; gapAt = [i, j]; }
  }
  const fails = [];
  if (selfC.count) fails.push(`centreline self-intersections=${selfC.count}`);
  if (selfL.count || selfR.count) fails.push(`wall self-intersections L=${selfL.count} R=${selfR.count}`);
  if (crossLR) fails.push(`left/right wall crossings=${crossLR}`);
  if (folds) fails.push(`inner-offset folds=${folds}`);
  if (minR < LIMITS.minRadiusOverHalfW * halfW) fails.push(`min radius ${minR.toFixed(0)} < ${LIMITS.minRadiusOverHalfW}×halfW (at s=${pts[minRAt].s.toFixed(0)})`);
  if (deg(maxHeadingStep) > LIMITS.maxHeadingStepDeg) fails.push(`heading step ${deg(maxHeadingStep).toFixed(2)}° > ${LIMITS.maxHeadingStepDeg}°`);
  if (deg(maxCurvStep) > LIMITS.maxCurvatureStepDeg) fails.push(`curvature step ${deg(maxCurvStep).toFixed(3)}° > ${LIMITS.maxCurvatureStepDeg}° (at s=${curvAt.toFixed(0)})`);
  if (minGap < LIMITS.minWallGap) fails.push(`wall-to-wall gap ${minGap.toFixed(0)} < ${LIMITS.minWallGap} (s=${pts[gapAt[0]].s.toFixed(0)} vs s=${pts[gapAt[1]].s.toFixed(0)})`);
  return {
    id: t.id, length, halfW, points: n, minR, minROverHalfW: minR / halfW,
    maxHeadingStepDeg: deg(maxHeadingStep), maxCurvatureStepDeg: deg(maxCurvStep),
    selfIntersections: selfC.count, wallSelfIntersections: selfL.count + selfR.count, wallCrossings: crossLR,
    folds, minWallGap: minGap, gapAt: gapAt && [pts[gapAt[0]].s, pts[gapAt[1]].s], minRAt: pts[minRAt].s,
    pass: fails.length === 0, fails
  };
}

export function formatResult(r) {
  return `${r.id.padEnd(14)} ${r.pass ? 'PASS' : 'FAIL'}  length=${r.length.toFixed(0)}wu halfW=${r.halfW} minRadius=${r.minR.toFixed(0)}wu (${r.minROverHalfW.toFixed(2)}×halfW) ` +
    `maxHeadingStep=${r.maxHeadingStepDeg.toFixed(2)}°/30wu maxCurvatureStep=${r.maxCurvatureStepDeg.toFixed(3)}° ` +
    `selfX=${r.selfIntersections} wallSelfX=${r.wallSelfIntersections} wallCross=${r.wallCrossings} folds=${r.folds} minWallGap=${r.minWallGap.toFixed(0)}wu` +
    (r.fails.length ? `\n    FAILS: ${r.fails.join('; ')}` : '');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = TRACKS.map(checkTrack);
  console.log(`limits ${JSON.stringify(LIMITS)}`);
  for (const r of results) console.log(formatResult(r));
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}
