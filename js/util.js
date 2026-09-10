export const TAU = Math.PI * 2;

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function angleDiff(a, b) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return d;
}

export function normalizeAngle(a) {
  return ((a % TAU) + TAU) % TAU;
}

export function dist(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return Math.hypot(dx, dy);
}

export function dist2(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
}

export function pointInPoly(px, py, poly) {
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

export function segIntersect(a, b, c, d) {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), t, u };
}

export function closestPointOnSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  return { x: ax + t * dx, y: ay + t * dy, t };
}

export function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function randRange(a, b) {
  return a + Math.random() * (b - a);
}

export function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

export function formatMoney(n) {
  return '$' + Math.floor(n).toLocaleString();
}

export function hpColor(hp, max) {
  const r = hp / max;
  if (r > 0.55) return '#7dff9a';
  if (r > 0.28) return '#ffd060';
  return '#ff6b6b';
}
