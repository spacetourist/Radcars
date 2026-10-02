/**
 * v51 'toys': Micro Machines-style car art + tabletop textures, plain Canvas 2D.
 *
 * Cars are painted once per (style, paint, pixel scale) into small offscreen canvases and then
 * drawn rotated with drawImage, so a frame costs two drawImage calls per car (soft drop shadow +
 * body). Local frame as before: +X = nose (direction of travel), +Y = the car's right.
 * Every variant shares the same footprint (CAR_LEN × CAR_WID·0.88), a windscreen near the front,
 * #fff6c0 headlights at the nose and red tail-lights at the back.
 */
import { CAR_LEN, CAR_WID } from './physics.js';

export const HL = CAR_LEN / 2;            // canonical half-length (wu at readability scale 1)
export const HW = CAR_WID * 0.88 / 2;     // canonical half-width of the body
const PAD = 9;                            // sprite margin around the body (tyres, outline, shadow blur)
export const SPRITE_W = CAR_LEN + PAD * 2;
export const SPRITE_H = CAR_WID * 0.88 + PAD * 2;

export const VARIANTS = ['sports', 'hatch', 'pickup', 'f1', 'muscle'];

/**
 * Per-car toy styling (index = car id; 0 = the player). Paint is car.color (minimap + results use it too);
 * these add the body variant, stripe style, stripe / trim colour, roof number and two-tone roof.
 * With the default 5 rivals the field shows all five variants.
 */
export const CAR_STYLES = [
  { variant: 'sports', stripe: 'single', stripeCol: 'rgba(255,255,255,0.6)', num: null },                                   // You (cyan)
  { variant: 'hatch',  stripe: 'twin',   stripeCol: 'rgba(255,255,255,0.62)', num: 23 },                      // Volt (pink-red)
  { variant: 'f1',     stripe: 'none',   stripeCol: null, num: 7, trim: '#16181e', helmet: '#ff2b6a' },       // Razor (lime)
  { variant: 'pickup', stripe: 'checker', stripeCol: null, num: 11, bed: '#2b2a26' },                                       // Echo (yellow)
  { variant: 'muscle', stripe: 'twin',   stripeCol: 'rgba(15,16,22,0.62)', num: 42 },                                       // Blaze (magenta)
  { variant: 'sports', stripe: 'none',   stripeCol: null, num: 88, roof: '#15171c' },                                       // Nyx (orange)
  { variant: 'f1',     stripe: 'none',   stripeCol: null, num: 5, trim: '#f0f0f0', helmet: '#ffe600' },                      // Torque (sky blue)
  { variant: 'muscle', stripe: 'single', stripeCol: 'rgba(220,30,40,0.85)', num: 64 },                                      // Drift (white)
  { variant: 'hatch',  stripe: 'checker', stripeCol: null, num: 99 }
];
export function styleFor(car) { return car.isPlayer ? CAR_STYLES[0] : CAR_STYLES[1 + ((Math.max(1, car.id) - 1) % (CAR_STYLES.length - 1))]; }

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Body outline per variant (tail at -X, nose at +X). F1 returns the monocoque + sidepods. */
function bodyPath(g, v) {
  const hl = HL, hw = HW;
  g.beginPath();
  if (v === 'f1') {
    // nose cone → tub → tapering engine cover (the sidepods are separate trim-coloured pods, see paintCar)
    g.moveTo(hl * 0.95, -3.0);
    g.lineTo(hl * 0.95, 3.0);
    g.lineTo(hl * 0.30, 6.0);
    g.lineTo(hl * 0.05, 7.6);
    g.lineTo(-hl * 0.50, 7.6);
    g.lineTo(-hl * 0.88, 4.2);
    g.lineTo(-hl * 0.88, -4.2);
    g.lineTo(-hl * 0.50, -7.6);
    g.lineTo(hl * 0.05, -7.6);
    g.lineTo(hl * 0.30, -6.0);
    g.closePath();
    return;
  }
  const r = v === 'pickup' ? hw * 0.22 : v === 'muscle' ? hw * 0.3 : hw * 0.45;
  if (v === 'hatch') {
    g.moveTo(-hl + r, -hw); g.lineTo(hl * 0.6, -hw);
    g.quadraticCurveTo(hl, -hw * 0.95, hl, -hw * 0.2); g.lineTo(hl, hw * 0.2);
    g.quadraticCurveTo(hl, hw * 0.95, hl * 0.6, hw);
  } else if (v === 'muscle') {
    g.moveTo(-hl + r, -hw); g.lineTo(hl * 0.56, -hw);
    g.quadraticCurveTo(hl, -hw * 0.9, hl, -hw * 0.3); g.lineTo(hl, hw * 0.3);
    g.quadraticCurveTo(hl, hw * 0.9, hl * 0.56, hw);
  } else if (v === 'pickup') {
    g.moveTo(-hl + r, -hw); g.lineTo(hl * 0.5, -hw);
    g.quadraticCurveTo(hl, -hw * 0.85, hl, -hw * 0.1); g.lineTo(hl, hw * 0.1);
    g.quadraticCurveTo(hl, hw * 0.85, hl * 0.5, hw);
  } else { // sports: the original v40s silhouette
    g.moveTo(-hl + r, -hw); g.lineTo(hl * 0.45, -hw);
    g.quadraticCurveTo(hl, -hw * 0.8, hl, 0);
    g.quadraticCurveTo(hl, hw * 0.8, hl * 0.45, hw);
  }
  g.lineTo(-hl + r, hw);
  g.quadraticCurveTo(-hl, hw, -hl, hw - r);
  g.lineTo(-hl, -hw + r);
  g.quadraticCurveTo(-hl, -hw, -hl + r, -hw);
  g.closePath();
}

/** Chunky toy tyre seen from above: dark rounded block, rubber sheen, tread ticks, chrome hub cap. */
function tyre(g, cx, cy, wl, ww) {
  g.fillStyle = '#0d0e11';
  rr(g, cx - wl / 2, cy - ww / 2, wl, ww, ww * 0.38); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.13)';
  rr(g, cx - wl / 2 + 1, cy - ww / 2 + 0.7, wl - 2, ww * 0.28, ww * 0.14); g.fill();
  g.fillStyle = 'rgba(0,0,0,0.55)';
  for (let i = 1; i < 5; i++) g.fillRect(cx - wl / 2 + (wl * i) / 5 - 0.35, cy - ww / 2 + 0.6, 0.7, ww - 1.2);
}
function wheels(g, v) {
  const hl = HL, hw = HW;
  if (v === 'f1') {
    tyre(g, hl * 0.55, -hw * 0.98, 12.5, 7.4); tyre(g, hl * 0.55, hw * 0.98, 12.5, 7.4);
    tyre(g, -hl * 0.6, -hw * 0.96, 14, 8.6); tyre(g, -hl * 0.6, hw * 0.96, 14, 8.6);
    return;
  }
  const wl = v === 'muscle' ? 15 : 14, ww = v === 'muscle' ? 8.6 : 8, poke = 4.6;
  const rear = v === 'muscle' ? 1.08 : 1;
  for (const [fx, k] of [[hl * 0.56, 1], [-hl * 0.6, rear]]) {
    const cy = hw + poke * k - (ww * k) / 2;
    tyre(g, fx, -cy, wl * k, ww * k);
    tyre(g, fx, cy, wl * k, ww * k);
  }
}

/** Glossy plastic shading inside the body: lit left flank, shaded right flank, specular streak, inner bevel. */
function gloss(g, v) {
  const hl = HL, hw = HW;
  g.save();
  bodyPath(g, v); g.clip();
  const lg = g.createLinearGradient(0, -hw, 0, hw);
  lg.addColorStop(0, 'rgba(255,255,255,0.32)');
  lg.addColorStop(0.13, 'rgba(255,255,255,0)');
  lg.addColorStop(0.8, 'rgba(0,0,0,0)');
  lg.addColorStop(1, 'rgba(0,0,0,0.4)');
  g.fillStyle = lg;
  g.fillRect(-hl - 2, -hw - 2, hl * 2 + 4, hw * 2 + 4);
  // nose-to-tail light falloff (toy lit from the front-left)
  const xg = g.createLinearGradient(-hl, 0, hl, 0);
  xg.addColorStop(0, 'rgba(0,0,0,0.16)'); xg.addColorStop(0.08, 'rgba(0,0,0,0)'); xg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = xg;
  g.fillRect(-hl - 2, -hw - 2, hl * 2 + 4, hw * 2 + 4);
  // specular highlight streak along the lit flank (kept ≤ 0.42 alpha: never reads as a headlight)
  const sg = g.createLinearGradient(-hl * 0.8, 0, hl * 0.75, 0);
  sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.35, 'rgba(255,255,255,0.42)');
  sg.addColorStop(0.75, 'rgba(255,255,255,0.3)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sg;
  rr(g, -hl * 0.8, v === 'f1' ? -5.6 : -hw * 0.8, hl * 1.55, v === 'f1' ? 1.6 : hw * 0.13, hw * 0.06); g.fill();
  // inner bevel: dark rim all round
  g.lineWidth = 2.0; g.strokeStyle = 'rgba(0,0,0,0.22)';
  bodyPath(g, v); g.stroke();
  g.restore();
}

function stripes(g, st, v) {
  if (!st.stripe || st.stripe === 'none') return;
  const hl = HL, hw = HW;
  g.save();
  bodyPath(g, v); g.clip();
  const x0 = -hl + 3, len = hl * 2 - 6;
  if (st.stripe === 'single') {
    g.fillStyle = st.stripeCol || 'rgba(255,255,255,0.55)';
    g.fillRect(x0, -hw * 0.14, len, hw * 0.28);
  } else if (st.stripe === 'twin') {
    g.fillStyle = st.stripeCol || 'rgba(255,255,255,0.55)';
    g.fillRect(x0, -hw * 0.36, len, hw * 0.17);
    g.fillRect(x0, hw * 0.19, len, hw * 0.17);
  } else if (st.stripe === 'checker') {
    const q = hw * 0.2;
    for (let i = 0, x = x0; x < x0 + len; i++, x += q) {
      for (let j = 0; j < 2; j++) {
        g.fillStyle = (i + j) % 2 ? '#15171c' : '#d0d4da';
        g.fillRect(x, -q + j * q, Math.min(q, x0 + len - x), q);
      }
    }
  }
  g.restore();
}

function windscreen(g, x0, x1, w0, w1) {
  g.fillStyle = '#0d1a26';
  g.beginPath(); g.moveTo(x0, -w0); g.lineTo(x1, -w1); g.lineTo(x1, w1); g.lineTo(x0, w0); g.closePath(); g.fill();
  g.fillStyle = 'rgba(160,200,235,0.32)'; // glass glint
  g.beginPath(); g.moveTo(x0 + (x1 - x0) * 0.25, -w0 * 0.82); g.lineTo(x0 + (x1 - x0) * 0.6, -w0 * 0.82); g.lineTo(x0 + (x1 - x0) * 0.35, -w0 * 0.15); g.lineTo(x0 + (x1 - x0) * 0.15, -w0 * 0.15); g.closePath(); g.fill();
}
function roofNumber(g, x, n, k = 1) {
  if (n == null) return;
  const r = HW * 0.42 * k;
  g.fillStyle = '#eef1f5';
  g.beginPath(); g.arc(x, 0, r, 0, Math.PI * 2); g.fill();
  g.lineWidth = 1; g.strokeStyle = '#15171c'; g.stroke();
  g.save();
  g.translate(x, 0); // upright when the car points right (+X)
  g.fillStyle = '#15171c';
  g.font = `900 ${(String(n).length > 1 ? 6.4 : 7.6) * k}px "Arial Black", "Segoe UI Black", Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 0, 0.5);
  g.restore();
}
function lights(g, v) {
  const hl = HL, hw = HW;
  g.fillStyle = '#fff6c0';
  if (v === 'f1') { // painted nose lamps either side of the nose cone
    g.fillRect(hl * 0.52, -7.4, 7, 4.4); g.fillRect(hl * 0.52, 3.0, 7, 4.4);
  } else {
    const k = v === 'muscle' || v === 'hatch' ? 0.7 : 0.66;
    g.fillRect(hl - 8, -hw * k, 6.5, hw * 0.48);
    g.fillRect(hl - 8, hw * (k - 0.48), 6.5, hw * 0.48);
  }
  g.fillStyle = '#ff2020';
  if (v === 'f1') { g.fillRect(-hl * 0.99, -hw * 0.9, 3, hw * 0.38); g.fillRect(-hl * 0.99, hw * 0.52, 3, hw * 0.38); g.fillRect(-hl * 0.99, -1.2, 3, 2.4); }
  else { g.fillRect(-hl + 1, -hw * 0.8, 3, hw * 0.45); g.fillRect(-hl + 1, hw * 0.35, 3, hw * 0.45); }
}
function chromeBar(g, x, y, w, h) {
  g.fillStyle = '#15171c'; g.fillRect(x - 0.6, y - 0.6, w + 1.2, h + 1.2);
  g.fillStyle = '#9aa2ae'; g.fillRect(x, y, w, h);
  g.fillStyle = '#d4d9e0'; g.fillRect(x, y, w, h * 0.4);
}

/** Paint one car in canonical units (origin = car centre). */
export function paintCar(g, st, color, isPlayer) {
  const v = st.variant, hl = HL, hw = HW, L = CAR_LEN;
  wheels(g, v);
  if (v === 'f1') {
    // front + rear wings (trim colour) sit under the body edges
    g.fillStyle = st.trim || '#16181e';
    rr(g, hl * 0.78, -hw * 1.06, 6, hw * 2.12, 1.5); g.fill();
    rr(g, -hl * 1.0, -hw * 0.98, 6.5, hw * 1.96, 1.5); g.fill();
    g.fillStyle = color; // wing endplates in paint
    g.fillRect(hl * 0.78, -hw * 1.06, 6, 1.6); g.fillRect(hl * 0.78, hw * 1.06 - 1.6, 6, 1.6);
    g.lineWidth = 1.1; g.strokeStyle = 'rgba(0,0,0,0.7)';
    rr(g, hl * 0.78, -hw * 1.06, 6, hw * 2.12, 1.5); g.stroke();
    rr(g, -hl * 1.0, -hw * 0.98, 6.5, hw * 1.96, 1.5); g.stroke();
  }
  if (v === 'f1') { // sidepods in trim colour, under the monocoque
    g.fillStyle = st.trim || '#16181e';
    rr(g, -hl * 0.46, -hw * 0.86, hl * 0.5, hw * 1.72, 4); g.fill();
    g.lineWidth = 1.1; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(-hl * 0.42, -hw * 0.8, hl * 0.42, 1.4);
  }
  g.fillStyle = color;
  bodyPath(g, v); g.fill();
  gloss(g, v);
  stripes(g, st, v);
  g.lineWidth = isPlayer ? 3.2 : 1.6;
  g.strokeStyle = isPlayer ? '#ffffff' : 'rgba(0,0,0,0.72)';
  bodyPath(g, v); g.stroke();
  if (isPlayer) { g.lineWidth = 0.9; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.save(); bodyPath(g, v); g.clip(); g.lineWidth = 4.4; g.stroke(); g.restore(); }

  if (v === 'sports') {
    windscreen(g, L * 0.02, L * 0.2, hw * 0.78, hw * 0.58);
    g.fillStyle = st.roof || 'rgba(0,0,0,0.18)'; rr(g, -L * 0.24, -hw * 0.74, L * 0.26, hw * 1.48, 2); g.fill();
    g.fillStyle = 'rgba(13,26,38,0.85)'; g.fillRect(-L * 0.33, -hw * 0.62, L * 0.08, hw * 1.24);
    roofNumber(g, -L * 0.11, st.num);
    chromeBar(g, -hl + 0.6, -hw * 0.3, 1.6, hw * 0.6);
  } else if (v === 'hatch') {
    windscreen(g, -L * 0.01, L * 0.17, hw * 0.8, hw * 0.62);
    g.fillStyle = st.roof || 'rgba(0,0,0,0.18)'; rr(g, -L * 0.33, -hw * 0.66, L * 0.32, hw * 1.32, 2.5); g.fill();
    g.fillStyle = 'rgba(13,26,38,0.85)'; g.fillRect(-L * 0.42, -hw * 0.56, L * 0.06, hw * 1.12);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(-L * 0.345, -hw * 0.68, 1.4, hw * 1.36); // roof spoiler lip
    roofNumber(g, -L * 0.17, st.num);
  } else if (v === 'pickup') {
    windscreen(g, L * 0.1, L * 0.25, hw * 0.78, hw * 0.6);
    g.fillStyle = st.roof || 'rgba(0,0,0,0.18)'; rr(g, -L * 0.07, -hw * 0.74, L * 0.17, hw * 1.48, 2); g.fill();
    g.fillStyle = 'rgba(13,26,38,0.85)'; g.fillRect(-L * 0.11, -hw * 0.6, L * 0.04, hw * 1.2);
    // load bed with ribs and a tailgate
    g.fillStyle = st.bed || '#2b2a26'; rr(g, -L * 0.45, -hw * 0.5, L * 0.29, hw * 1.0, 1.5); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 3; i++) g.fillRect(-L * 0.43, -hw * 0.3 + i * hw * 0.3, L * 0.25, 1);
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(-L * 0.165, -hw * 0.5, 1.2, hw * 1.0);
    roofNumber(g, L * 0.015, st.num);
  } else if (v === 'muscle') {
    windscreen(g, L * 0.0, L * 0.16, hw * 0.8, hw * 0.6);
    g.fillStyle = st.roof || 'rgba(0,0,0,0.2)'; rr(g, -L * 0.24, -hw * 0.74, L * 0.24, hw * 1.48, 2); g.fill();
    g.fillStyle = 'rgba(13,26,38,0.85)'; g.fillRect(-L * 0.32, -hw * 0.62, L * 0.07, hw * 1.24);
    // bonnet scoop
    g.fillStyle = '#15171c'; rr(g, L * 0.22, -hw * 0.26, L * 0.15, hw * 0.52, 1.5); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(L * 0.235, -hw * 0.22, L * 0.12, 1.1);
    g.fillStyle = '#05060a'; g.fillRect(L * 0.335, -hw * 0.18, 1.6, hw * 0.36);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(-hl + 4.5, -hw * 0.8, 1.3, hw * 1.6); // ducktail
    roofNumber(g, -L * 0.12, st.num);
    chromeBar(g, -hl - 1.6, -hw * 0.62, 2.2, 2.4); chromeBar(g, -hl - 1.6, hw * 0.62 - 2.4, 2.2, 2.4); // exhaust tips
  } else if (v === 'f1') {
    windscreen(g, L * 0.1, L * 0.16, 3.6, 2.6);
    g.fillStyle = '#0a0b0f'; rr(g, -L * 0.07, -4.2, L * 0.18, 8.4, 3.5); g.fill(); // cockpit
    g.fillStyle = st.helmet || '#ff2b6a'; g.beginPath(); g.arc(-L * 0.005, 0, 3.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0.6, -2.4, 1.6, 4.8); // visor
    g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.arc(-L * 0.02, -1.3, 1.1, 0, Math.PI * 2); g.fill();
    roofNumber(g, -L * 0.33, st.num, 0.7);
  }
  lights(g, v);
}

/** Car silhouette for the drop shadow. */
function silhouette(g, v) {
  g.fillStyle = '#000';
  bodyPath(g, v); g.fill();
  const tw = v === 'f1' ? HW * 1.4 : HW * 1.18;
  rr(g, -HL * 0.86, -tw, HL * 1.7, tw * 2, 4); g.fill();
}

const spriteCache = new Map();
/** Pixel-scale bucket: 2^(1/6) steps, rounded up so sprites are only ever drawn slightly downscaled. */
export function scaleBucket(pxPerUnit) { return Math.min(6, Math.max(0.25, Math.pow(2, Math.ceil(Math.log2(pxPerUnit) * 6 - 1e-6) / 6))); }

export function carSprite(st, color, isPlayer, R) {
  const key = `${st.variant}|${st.stripe}|${st.num}|${color}|${isPlayer ? 1 : 0}|${R.toFixed(4)}|${st.roof || ''}|${st.trim || ''}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = mk(SPRITE_W * R, SPRITE_H * R);
  const g = c.getContext('2d');
  g.scale(R, R);
  g.translate(SPRITE_W / 2, SPRITE_H / 2);
  g.lineJoin = 'round';
  paintCar(g, st, color, isPlayer);
  spriteCache.set(key, c);
  return c;
}
export function shadowSprite(variant, R) {
  const key = `shadow|${variant}|${R.toFixed(4)}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = mk(SPRITE_W * R, SPRITE_H * R);
  const g = c.getContext('2d');
  // classic offscreen-shadow trick: draw far away, keep only the blurred shadow (works without ctx.filter)
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 3.2 * R;
  g.shadowOffsetX = 10000;
  g.scale(R, R);
  g.translate(SPRITE_W / 2 - 10000 / R, SPRITE_H / 2);
  g.scale(0.94, 0.86);
  silhouette(g, variant);
  spriteCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------------------- textures
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
/** Tileable value noise (grid cells wrap), smoothstep-interpolated. */
function valueNoise(size, cells, rand) {
  const g = new Float32Array(cells * cells).map(() => rand());
  const out = new Float32Array(size * size);
  const k = cells / size;
  for (let y = 0; y < size; y++) {
    const fy = y * k, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty), y1 = (y0 + 1) % cells;
    for (let x = 0; x < size; x++) {
      const fx = x * k, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % cells;
      const a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1];
      out[y * size + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    }
  }
  return out;
}
/**
 * Felt / play-mat tile (ground): soft blotches + fine fibre grain + faint woven cross-hatch.
 * Asphalt tile (road): fine grain + light aggregate speckles + gentle patches.
 */
export function textureTile(kind, baseHex, size = 256, seed = 7) {
  const rand = rng(seed + (kind === 'felt' ? 101 : 0) + parseInt(baseHex.slice(1), 16) % 997);
  const c = mk(size, size), g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data;
  const [R, G, B] = hexRgb(baseHex);
  const lo = valueNoise(size, 4, rand), mid = valueNoise(size, 16, rand);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0;
    let f;
    if (kind === 'felt') {
      const weave = ((x + y) % 4 === 0 ? 0.012 : 0) - ((x - y + size) % 4 === 0 ? 0.01 : 0);
      f = 1 + (lo[i] - 0.5) * 0.12 + (mid[i] - 0.5) * 0.08 + (rand() - 0.5) * 0.09 + weave;
    } else {
      const r = rand();
      f = 1 + (lo[i] - 0.5) * 0.07 + (mid[i] - 0.5) * 0.05 + (r - 0.5) * 0.16 + (r > 0.985 ? 0.22 : 0) - (r < 0.012 ? 0.16 : 0);
    }
    d[i * 4] = Math.max(0, Math.min(255, R * f)); d[i * 4 + 1] = Math.max(0, Math.min(255, G * f)); d[i * 4 + 2] = Math.max(0, Math.min(255, B * f)); d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  if (kind === 'felt') { // faint printed play-mat dot grid (speed parallax off-track), 4 × 4 per tile
    g.fillStyle = 'rgba(255,255,255,0.07)';
    const st = size / 4;
    for (let y = st / 2; y < size; y += st) for (let x = st / 2; x < size; x += st) { g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill(); }
  }
  if (kind === 'felt') { // stray fibres (wrapped so the tile stays seamless)
    g.lineWidth = 0.8; g.lineCap = 'round';
    for (let i = 0; i < 260; i++) {
      const x = rand() * size, y = rand() * size, a = rand() * Math.PI, l = 3 + rand() * 7;
      g.strokeStyle = rand() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
        g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke();
      }
    }
  }
  return c;
}

/**
 * Draw a toy car onto any 2D context (menus, previews, podium). (x, y) and s are in the context's units;
 * pxScale = device pixels per unit of that context, so the cached sprite matches the output resolution.
 */
export function drawToy(g, st, color, isPlayer, x, y, ang, s, pxScale) {
  const R = scaleBucket(s * pxScale);
  const sh = shadowSprite(st.variant, R);
  g.save(); g.translate(x + 3.5 * s, y + 5 * s); g.rotate(ang);
  g.drawImage(sh, -SPRITE_W / 2 * s, -SPRITE_H / 2 * s, sh.width / R * s, sh.height / R * s);
  g.restore();
  const spr = carSprite(st, color, isPlayer, R);
  g.save(); g.translate(x, y); g.rotate(ang);
  g.drawImage(spr, -SPRITE_W / 2 * s, -SPRITE_H / 2 * s, spr.width / R * s, spr.height / R * s);
  g.restore();
}

/** Shared toy font stack (no web fonts): rounded/black system faces, Roboto on Android. */
export const TOY_FONT = '"Arial Rounded MT Bold", "Arial Black", "Segoe UI Black", Roboto, "Helvetica Neue", system-ui, sans-serif';
