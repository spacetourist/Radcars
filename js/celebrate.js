/**
 * v52 'finish': the finishing-position reveal and the celebration, as data + a tiny particle sim.
 *
 * Everything that is a design choice lives in the tables below (timings, per-tier colours / words / confetti /
 * trophy / camera zoom / sound), so Graphic Designer's ideas can be swapped in without touching the game loop or the
 * renderers. game.js owns the flow (reveal → results), ui.js draws the big place text as a crisp DOM overlay, and both
 * renderers (pixiRender.js, render.js) draw the confetti, the light burst and the trophy from the same state.
 *
 * Coordinates: celebration particles live in "h units" — fractions of the screen height, origin at the screen centre
 * (x right, y down) — so shapes and speeds look the same on a 844×390 phone and a 1920×1080 desktop.
 */
import { CAR_COLORS } from './cars.js';

export const FINISH_TIMING = {
  revealMs: 3600,      // how long the place reveal holds before the results screen (unless skipped)
  skipAfterMs: 450,    // ignore taps / keys this soon after the line (fingers are still on GAS)
  slamMs: 260,         // when the scale-in "lands" (camera kick + thump)
  shakeMs: 320,        // camera kick duration
  shakePx: 7,          // camera kick amplitude (CSS px)
  outMs: 320,          // reveal fade-out before the results screen drops in
  cruiseMul: 0.42,     // finished cars cruise at this fraction of their top speed…
  cruiseEaseMs: 1100,  // …easing down to it over about this long
  finalStopMs: 1400,   // after the final results are up, keep the world alive this long, then stop the loop
  carScreenY: 0.32     // camera frames the player's car this far below the screen centre (fraction of the height)
};

const GOLD = '#ffd34d', SILVER = '#e3e9f2', BRONZE = '#e8a062';

/** Per-tier look. `confetti` = particle count per burst; `bursts` = [ms, kind] schedule. */
export const TIERS = {
  gold: {
    word: 'YOU WIN!', color: GOLD, colors: [GOLD, '#fff3b0', '#d79a12'], glow: 'rgba(255,211,77,0.85)',
    sound: 'win', zoom: 1.0, trophy: true, rays: true, ring: true,
    confetti: 70, bursts: [[200, 'cannons'], [900, 'shower'], [1700, 'cannons']],
    palette: [...CAR_COLORS.slice(0, 7), GOLD, GOLD, '#ffffff']
  },
  silver: {
    word: 'PODIUM!', color: SILVER, colors: ['#ffffff', SILVER, '#9ea7b5'], glow: 'rgba(220,230,245,0.7)',
    sound: 'podium', zoom: 0.82, trophy: false, rays: false, ring: true,
    confetti: 34, bursts: [[220, 'puff']], palette: ['#ffffff', SILVER, '#b9c3d3', '#00e8ff']
  },
  bronze: {
    word: 'PODIUM!', color: BRONZE, colors: ['#ffd9b5', BRONZE, '#a8602c'], glow: 'rgba(232,160,98,0.7)',
    sound: 'podium', zoom: 0.82, trophy: false, rays: false, ring: true,
    confetti: 30, bursts: [[220, 'puff']], palette: ['#ffd9b5', BRONZE, '#c47a3c', '#ffffff']
  },
  plain: {
    word: 'FINISHED', color: '#ffffff', colors: ['#ffffff', '#dff8ff', '#7fe9ff'], glow: 'rgba(0,232,255,0.7)',
    sound: 'slam', zoom: 0.72, trophy: false, rays: false, ring: false, confetti: 0, bursts: [], palette: []
  }
};

export function tierFor(place) { return place === 1 ? 'gold' : place === 2 ? 'silver' : place === 3 ? 'bronze' : 'plain'; }

/** 1 → {num:'1', suffix:'ST'} … 11/12/13 → TH. */
export function ordinal(n) {
  const m = n % 100;
  const suffix = m >= 11 && m <= 13 ? 'TH' : ({ 1: 'ST', 2: 'ND', 3: 'RD' }[n % 10] || 'TH');
  return { num: String(n), suffix, text: n + suffix };
}

/**
 * Trophy (gold tier), in a 100 × 120 box centred on (0, 0): a list of primitives both renderers can draw.
 * poly: flat [x,y,…]; rect: x,y,w,h,r; circle: x,y,r. `fill` colours, optional `alpha`, optional `stroke`.
 */
export const TROPHY = [
  { k: 'poly', pts: [-36, -50, 36, -50, 30, -12, 14, 8, -14, 8, -30, -12], fill: '#f2b51d', stroke: '#7a4f00' },      // cup
  { k: 'poly', pts: [-36, -46, -52, -40, -50, -18, -30, -10, -31, -18, -43, -23, -43, -36, -35, -38], fill: '#e0a10e', stroke: '#7a4f00' }, // left handle
  { k: 'poly', pts: [36, -46, 52, -40, 50, -18, 30, -10, 31, -18, 43, -23, 43, -36, 35, -38], fill: '#e0a10e', stroke: '#7a4f00' },     // right handle
  { k: 'poly', pts: [-24, -46, -4, -46, -12, -2, -20, -10], fill: '#fff3b0', alpha: 0.75 },                             // shine
  { k: 'rect', x: -6, y: 8, w: 12, h: 18, r: 2, fill: '#d99a10', stroke: '#7a4f00' },                                     // stem
  { k: 'rect', x: -22, y: 24, w: 44, h: 10, r: 4, fill: '#f2b51d', stroke: '#7a4f00' },                                   // collar
  { k: 'rect', x: -30, y: 34, w: 60, h: 22, r: 5, fill: '#2a2a32', stroke: '#000000' },                                   // plinth
  { k: 'rect', x: -18, y: 40, w: 36, h: 10, r: 2, fill: '#ffd34d' },                                                      // plaque
  { k: 'circle', x: 0, y: -28, r: 11, fill: '#fff3b0', stroke: '#b07a00' }                                               // "1" medallion
];

const rnd = (a, b) => a + Math.random() * (b - a);

/** New celebration state for a finishing place. aspect = W / H of the race view. */
export function createCelebration(place, aspect = 16 / 9) {
  const tierName = tierFor(place), tier = TIERS[tierName];
  return { place, tierName, tier, t: 0, aspect, parts: [], next: 0, slam: 0 };
}

function burst(c, kind) {
  const n = c.tier.confetti, pal = c.tier.palette, half = c.aspect / 2;
  const add = (x, y, vx, vy) => c.parts.push({
    x, y, vx, vy, rot: rnd(0, 6.3), vr: rnd(-9, 9), w: rnd(0.011, 0.02), h: rnd(0.006, 0.011),
    flip: rnd(0, 6.3), vf: rnd(6, 13), col: pal[(Math.random() * pal.length) | 0], life: rnd(2.6, 3.6), age: 0
  });
  if (kind === 'cannons') {
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1, a = rnd(0.95, 1.35), v = rnd(1.0, 1.75); // up and inward from the bottom corners
      add(side * (half - 0.02), 0.52, -side * Math.cos(a) * v, -Math.sin(a) * v);
    }
  } else if (kind === 'shower') {
    for (let i = 0; i < n; i++) add(rnd(-half, half), rnd(-0.62, -0.52), rnd(-0.1, 0.1), rnd(0.0, 0.25));
  } else if (kind === 'puff') { // light podium treatment: a short fountain behind the place text
    for (let i = 0; i < n; i++) { const a = rnd(-2.6, -0.55), v = rnd(0.45, 0.95); add(rnd(-0.05, 0.05), -0.05, Math.cos(a) * v, Math.sin(a) * v); }
  }
}

/** Advance the celebration by dtMs (real time). */
export function stepCelebration(c, dtMs, aspect) {
  if (!c) return;
  const dt = Math.min(0.05, dtMs / 1000);
  c.t += dtMs;
  if (aspect) c.aspect = aspect;
  const bursts = c.tier.bursts;
  // no new bursts once the reveal is on its way out (confetti already in the air keeps falling)
  while (c.next < bursts.length && c.t >= bursts[c.next][0] && c.outAt == null) burst(c, bursts[c.next++][1]);
  const keep = [];
  for (const p of c.parts) {
    p.age += dt;
    p.vy += 0.95 * dt;                         // gravity
    const drag = Math.exp(-1.6 * dt);          // paper flutters down slowly
    p.vx *= drag; p.vy *= p.vy > 0 ? Math.exp(-3.2 * dt) : drag;
    p.vx += Math.sin(p.flip * 0.7) * 0.05 * dt; // sideways wobble
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.rot += p.vr * dt; p.flip += p.vf * dt;
    if (p.age < p.life && p.y < 0.62) keep.push(p);
  }
  c.parts = keep;
}

/** 1 → 0 as the reveal fades out (trophy, light burst, ring). */
export function outFade(c) { return c.outAt == null ? 1 : Math.max(0, 1 - (c.t - c.outAt) / 300); }

/** Light / trophy envelope helpers shared by the renderers (0..1). */
export function trophyScale(tMs) {
  const t = (tMs - 300) / 520;
  if (t <= 0) return 0;
  if (t >= 1) return 1 + 0.03 * Math.sin((tMs - 820) / 260);
  return 1 - Math.pow(1 - t, 3) * Math.cos(t * 9.5); // elastic pop
}
export function ringState(tMs) { const k = Math.min(1, Math.max(0, (tMs - 240) / 700)); return { k, alpha: k <= 0 || k >= 1 ? 0 : (1 - k) * 0.9 }; }
/** Particle alpha: fade in fast, fade out over the last 0.6 s of life. */
export function partAlpha(p) { return Math.min(1, p.age / 0.08, (p.life - p.age) / 0.6); }

/** Where the trophy sits (h units from the centre) given the place text block the UI draws. */
export function trophyAnchor(aspect) { return { x: 0, y: -0.355, size: 0.17 * (aspect < 1 ? 0.8 : 1) }; }
/** Centre of the big place text (h units), for the podium ring — matches .finish-reveal in style.css. */
export const PLACE_TEXT_Y = -0.11;
