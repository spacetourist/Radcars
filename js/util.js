export const TAU = Math.PI * 2;

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

/** Signed shortest angle from a to b in (-π, π]. */
export function angleDiff(a, b) {
  return ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

export function normalizeAngle(a) {
  return ((a % TAU) + TAU) % TAU;
}

export function fmtTime(ms) {
  if (!ms || ms <= 0) return '—';
  const t = ms / 1000;
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t % 60).toString().padStart(2, '0');
  const cs = Math.floor((t % 1) * 100).toString().padStart(2, '0');
  return `${mm}:${ss}.${cs}`;
}
