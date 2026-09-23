/**
 * Realistic asset pack loader — load manifest, prefer baked RGBA alpha,
 * optional soft fringe cleanup, chroma fallback, bbox-crop opaque content.
 * Magenta car was keyed from green screen; never re-key it with magenta.
 */

const PACK_BASE = './assets/generated/';

/** Tolerant magenta key thresholds (fallback when no baked alpha). */
const CHROMA_HARD = 110;
const CHROMA_SOFT = 200;
const MAG_MIN_RB = 150;
const MAG_MAX_G_RATIO = 0.48;
const MAG_RB_DELTA = 70;

/** Soft fringe only when image already has meaningful baked alpha. */
const SOFT_FRINGE_RB = 55;
const SOFT_FRINGE_MIN_RB = 130;
const SOFT_FRINGE_G_RATIO = 0.52;
const SOFT_FRINGE_STRENGTH = 0.55;

/** Colour → pack car key (filled from manifest carsByColor). */
export const PACK_CAR_COLOR_MAP = {
  '#00e8ff': 'cyan',
  '#ff2b6a': 'pink',
  '#b8ff00': 'lime',
  '#ffe600': 'yellow',
  '#ff2bd6': 'magenta',
  '#ff8a00': 'orange',
  '#40c0ff': 'sky',
  '#f0f0f0': 'white'
};

/** Hex → relative path; synced from manifest. */
let _carsByColor = { ...Object.fromEntries(
  Object.entries(PACK_CAR_COLOR_MAP).map(([hex, key]) => [hex, `cars/car-${key}.png`])
) };

let _pack = null;
let _promise = null;
const _listeners = new Set();

export function getAssetPack() {
  return _pack;
}

export function isPackReady() {
  return !!( _pack && _pack.ready);
}

export function onPackReady(fn) {
  if (_pack && _pack.ready) {
    try { fn(_pack); } catch (_) {}
    return () => {};
  }
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function notify() {
  for (const fn of _listeners) {
    try { fn(_pack); } catch (_) {}
  }
  _listeners.clear();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load ' + src));
    img.src = src;
  });
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  return { canvas: c, ctx };
}

/** Derive short key from relative path: cars/car-cyan.png → cyan */
function keyFromRel(rel) {
  const base = String(rel).split('/').pop() || '';
  return base
    .replace(/\.(png|jpe?g|webp)$/i, '')
    .replace(/^(car|scenery|bg)-/, '');
}

function parseHexColor(hex, fallback = { r: 255, g: 0, b: 255 }) {
  const s = String(hex || '').replace('#', '').trim();
  if (s.length < 6) return fallback;
  const n = parseInt(s, 16);
  if (Number.isNaN(n)) return fallback;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * True if a meaningful share of pixels already have non-opaque alpha
 * (pre-baked chromakey). Sample stride keeps this cheap on 1280×720.
 */
function hasMeaningfulAlpha(data, w, h) {
  const d = data;
  const stride = Math.max(1, Math.floor((w * h) / 12000));
  let transparentish = 0;
  let sampled = 0;
  for (let i = 3, pix = 0; i < d.length; i += 4 * stride, pix += stride) {
    sampled++;
    if (d[i] < 248) transparentish++;
  }
  if (sampled < 8) return false;
  return transparentish / sampled >= 0.04;
}

function bboxCrop(canvas, pad = 1) {
  const w = canvas.width | 0;
  const h = canvas.height | 0;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
  for (let i = 0, x = 0, y = 0; i < d.length; i += 4, x++) {
    if (x === w) { x = 0; y++; }
    if (d[i + 3] <= 40) continue;
    found = true;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!found) return canvas;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const { canvas: out, ctx: octx } = makeCanvas(cw, ch);
  octx.clearRect(0, 0, cw, ch);
  octx.drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  return out;
}

/**
 * Aggressively zero near-magenta (#FF00FF) and near-green (#00FF00) fringe —
 * including semi-transparent edge rectangles left by bake. Then a soft pass
 * on remaining partial-alpha magenta spill. Does not hard-key paint neon.
 */
function softFringeCleanup(ctx, w, h) {
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 1) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const rb = Math.min(r, b);
    const magBalanced = Math.abs(r - b) <= 60;
    const isMag = magBalanced && rb > 100 && g < rb * 0.55;
    const isPureMag = magBalanced && rb > 200 && g < 60;
    // Rose plate (containers ~195,41,106) — treat as key even when R>>B
    const isRosePlate = r > 150 && g < 95 && b > 50 && r > g * 1.7 && (r - g) > 80;
    const maxRB = Math.max(r, b);
    const isPureGrn = g > 160 && r < 80 && b < 80 && (g - maxRB) > 40;
    const isGrn = g > 100 && r < g * 0.62 && b < g * 0.62 && (g - maxRB) > 28;
    // Mid-green lattice / semi-transparent fringe (not yellow sodium)
    const isMidGrn = a < 250 && g > 55 && g >= r && g >= b && (g - maxRB) > 10
      && (Math.max(r, g, b) - Math.min(r, g, b)) > 24
      && r < g * 0.97 && b < g * 0.9
      && !(r > 145 && g > 125 && b < 115);
    if (isPureMag || isPureGrn || isRosePlate || isMidGrn || ((isMag || isGrn) && a < 250)) {
      d[i + 3] = 0;
      continue;
    }
    if (a < 8 || a > 230) continue;
    if (Math.abs(r - b) <= SOFT_FRINGE_RB && rb > SOFT_FRINGE_MIN_RB && g < rb * SOFT_FRINGE_G_RATIO) {
      const spill = Math.min(1, (rb - g) / 200);
      d[i + 3] = Math.round(a * (1 - spill * Math.max(SOFT_FRINGE_STRENGTH, 0.85)));
    }
  }
  ctx.putImageData(id, 0, 0);
}

/** 1px inward erode of low-alpha fringe after keying (drops coloured edge rectangles). */
function erodeFringe1px(ctx, w, h) {
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const out = new Uint8ClampedArray(d);
  const A = 3;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const a = d[i + A];
      if (a < 1 || a >= 240) continue;
      // If any 4-neighbour is empty, clear this fringe pixel
      if (
        d[((y - 1) * w + x) * 4 + A] < 8 ||
        d[((y + 1) * w + x) * 4 + A] < 8 ||
        d[(y * w + x - 1) * 4 + A] < 8 ||
        d[(y * w + x + 1) * 4 + A] < 8
      ) {
        out[i + A] = 0;
      }
    }
  }
  id.data.set(out);
  ctx.putImageData(id, 0, 0);
}

/**
 * Strip high-saturation neon edge frames left on pack stamps after crop.
 * Clears neon on (1) canvas AABB border and (2) alpha-silhouette fringe —
 * magenta/cyan plates often follow the sprite outline, not just the crop box.
 */
/**
 * Strip high-saturation neon edge frames left on pack stamps after crop.
 * Clears neon on (1) canvas AABB border and (2) alpha-silhouette fringe —
 * magenta/cyan plates often follow the sprite outline, not just the crop box.
 */
function isHighSatNeon(r, g, b, opts = {}) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 120) return false;
  const sat = max - min;
  if (sat < 55) return false;
  // cyan / aqua
  if (g > 130 && b > 130 && r < Math.min(g, b) * 0.6) return true;
  // yellow — preserve on crane (v2.6 yellow sodium lights)
  if (!opts.preserveYellow && r > 150 && g > 140 && b < 100) return true;
  // lime / chartreuse (skip when preserving yellow — avoid eating warm sodium)
  if (!opts.preserveYellow && g > 150 && r < g * 0.8 && b < g * 0.6) return true;
  // magenta / hot pink / fuchsia silhouette strokes
  if (r > 130 && b > 80 && g < Math.min(r, b) * 0.75) return true;
  // pink (high R, mid B, low G)
  if (r > 170 && g < 140 && b > 60 && b < r * 0.95) return true;
  return false;
}

function alphaAt(d, w, h, x, y) {
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  return d[(y * w + x) * 4 + 3];
}

export function stripNeonEdgeFrames(canvas, borderPx = 3, reBbox = true, stripOpts = {}) {
  if (!canvas || !canvas.width || !canvas.height) return canvas;
  let cur = canvas;
  const bp = Math.max(1, borderPx | 0);

  // Two passes: silhouette neon often sits 1px inside after the first clear+bbox
  for (let pass = 0; pass < 2; pass++) {
    const w = cur.width | 0;
    const h = cur.height | 0;
    const ctx = cur.getContext('2d', { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;
    const clearIdx = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] < 8) continue;
        if (!isHighSatNeon(d[i], d[i + 1], d[i + 2], stripOpts)) continue;

        const onCanvasEdge = x < bp || y < bp || x >= w - bp || y >= h - bp;
        let nearEmpty = onCanvasEdge;
        if (!nearEmpty) {
          outer:
          for (let dy = -bp; dy <= bp; dy++) {
            for (let dx = -bp; dx <= bp; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (Math.abs(dx) + Math.abs(dy) > bp + 1) continue; // diamond-ish
              if (alphaAt(d, w, h, x + dx, y + dy) < 12) {
                nearEmpty = true;
                break outer;
              }
            }
          }
        }
        if (nearEmpty) clearIdx.push(i + 3);
      }
    }
    if (!clearIdx.length) break;
    for (const ai of clearIdx) d[ai] = 0;
    ctx.putImageData(id, 0, 0);
    if (reBbox) cur = bboxCrop(cur, 1);
  }
  return cur;
}

/**
 * Recolor cyan/aqua neon accents on pack stamps to warm sodium (amber/orange)
 * without waiting on new PNGs — sparse warm glow, not cyan grids.
 */
export function warmCyanToSodium(canvas) {
  if (!canvas || !canvas.width || !canvas.height) return canvas;
  const w = canvas.width | 0;
  const h = canvas.height | 0;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 10) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max < 55) continue;
    const sat = max - min;
    // Broad cyan/aqua/teal/cool-blue neon (including mid-sat window grids)
    const isCyan = b > 70 && g > 60 && b + g > r * 1.55 && sat > 28 && r < 170;
    const isCoolBlue = b > 90 && b > r * 1.15 && b >= g * 0.95 && sat > 25 && max > 80;
    const isTealEdge = g > 100 && b > 90 && r < 120 && sat > 35;
    if (!isCyan && !isCoolBlue && !isTealEdge) continue;
    const lum = (r * 0.2 + g * 0.45 + b * 0.35) / 255;
    // Strong remap toward warm sodium — leave only sparse amber accents
    const t = Math.min(1, 0.55 + sat / 200);
    const nr = 200 + lum * 55;
    const ng = 110 + lum * 75;
    const nb = 28 + lum * 36;
    d[i] = Math.min(255, Math.round(r * (1 - t) + nr * t));
    d[i + 1] = Math.min(255, Math.round(g * (1 - t) + ng * t));
    d[i + 2] = Math.min(255, Math.round(b * (1 - t) + nb * t));
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}

/**
 * Chroma-key keyRgb → alpha with tolerant threshold + soft edge, then bbox crop.
 * opts.keyRgb: {r,g,b} — default magenta; use green for magenta-car fallback.
 * opts.skipMagentaFringe: when keying green, don't also run magenta-fringe heuristics.
 */
export function chromaKeyAndCrop(source, opts = {}) {
  const hard = opts.hard != null ? opts.hard : CHROMA_HARD;
  const soft = opts.soft != null ? opts.soft : CHROMA_SOFT;
  const pad = opts.pad != null ? opts.pad : 1;
  const key = opts.keyRgb || { r: 255, g: 0, b: 255 };
  const useMagFringe = opts.skipMagentaFringe !== true && key.r > 200 && key.b > 200 && key.g < 40;

  const w = source.width | 0;
  const h = source.height | 0;
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.drawImage(source, 0, 0);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;

  let minX = w, minY = h, maxX = 0, maxY = 0;
  let found = false;

  for (let i = 0, x = 0, y = 0; i < d.length; i += 4, x++) {
    if (x === w) { x = 0; y++; }
    const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
    if (a === 0) continue;
    // Rose/hot-pink solid plates (containers/crane) — not only classic #FF00FF
    if (r > 145 && g < 100 && b > 50 && r > g * 1.65 && (r - g) > 70) {
      d[i + 3] = 0;
      continue;
    }
    // Green-screen plate (#00FF00) + mid-green lattice spill — crane v2.6.1
    if (opts.alsoKeyGreen || (key.g > 200 && key.r < 80)) {
      const maxRB = Math.max(r, b);
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const isYellowNa = r > 145 && g > 125 && b < 115 && (r + g) > b * 3.0 && Math.abs(r - g) < 100;
      if (!isYellowNa && sat >= 22) {
        const pureG = g > 160 && r < 80 && b < 80 && (g - maxRB) > 40;
        const nearG = g > 100 && r < g * 0.62 && b < g * 0.62 && (g - maxRB) > 28;
        const midG = g > 65 && g >= r && g > b && (g - maxRB) > 14 && sat > 30 && r < 150 && b < 135 && r < g * 0.95;
        const fringeG = a < 250 && g > 50 && g >= r && g >= b && (g - maxRB) > 10 && sat > 24 && r < g * 0.97 && b < g * 0.9;
        if (pureG || nearG || midG || fringeG) {
          d[i + 3] = 0;
          continue;
        }
      }
    }

    const dist = Math.abs(r - key.r) + Math.abs(g - key.g) + Math.abs(b - key.b);
    const rb = Math.min(r, b);
    const magBalanced = Math.abs(r - b) <= MAG_RB_DELTA;
    const isMagFringe = useMagFringe && magBalanced && rb >= MAG_MIN_RB && g <= rb * MAG_MAX_G_RATIO;
    const magSig = rb - g;

    let na = a;
    if (dist <= hard || (isMagFringe && magSig >= 80)) {
      na = 0;
    } else if (dist < soft || isMagFringe) {
      let fade = 1;
      if (dist < soft) fade = Math.min(fade, (dist - hard) / Math.max(1, soft - hard));
      if (isMagFringe) fade = Math.min(fade, 1 - Math.min(1, (magSig - 40) / 120));
      na = Math.round(a * Math.max(0, fade));
    }
    d[i + 3] = na;

    if (na > 40 && !isMagFringe && dist > hard) {
      found = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  ctx.putImageData(id, 0, 0);

  if (useMagFringe) {
    const id2 = ctx.getImageData(0, 0, w, h);
    const d2 = id2.data;
    for (let i = 0; i < d2.length; i += 4) {
      const a = d2[i + 3];
      if (a < 8) continue;
      const r = d2[i], g = d2[i + 1], b = d2[i + 2];
      const rb = Math.min(r, b);
      if (Math.abs(r - b) <= 55 && rb > 120 && g < rb * 0.55) {
        const spill = Math.min(1, (rb - g) / 180);
        d2[i + 3] = Math.round(a * (1 - spill * 0.92));
      }
    }
    ctx.putImageData(id2, 0, 0);

    const id3 = ctx.getImageData(0, 0, w, h);
    const d3 = id3.data;
    minX = w; minY = h; maxX = 0; maxY = 0; found = false;
    for (let i = 0, x = 0, y = 0; i < d3.length; i += 4, x++) {
      if (x === w) { x = 0; y++; }
      if (d3[i + 3] <= 48) continue;
      const r = d3[i], g = d3[i + 1], b = d3[i + 2];
      const rb = Math.min(r, b);
      if (Math.abs(r - b) <= 55 && rb > 140 && g < rb * 0.5) continue;
      found = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (!found) return bboxCrop(canvas, pad);

  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const { canvas: out, ctx: octx } = makeCanvas(cw, ch);
  octx.clearRect(0, 0, cw, ch);
  octx.drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  return out;
}

/**
 * Zero solid hot-pink / magenta KEY PLATES (not just #FF00FF).
 * Quay assets (containers/crane) often bake as rose/magenta ~#(C0,28,6A)
 * which softFringe misses when R/B unbalanced. Always run before bbox.
 */
export function keyHotPinkPlate(canvas) {
  if (!canvas || !canvas.width) return canvas;
  const w = canvas.width | 0;
  const h = canvas.height | 0;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 1) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max - min;
    // Classic magenta key
    const classic = Math.abs(r - b) <= 55 && r > 160 && g < 90;
    // Rose / hot-pink plate (containers/crane bg ~195,41,106) — slightly broader for v2.6 leftovers
    const rose = r > 125 && g < 110 && b > 40 && r > g * 1.45 && sat > 55 && (r + b) > g * 2.6;
    // Deep fuchsia plate
    const fuchsia = r > 120 && b > 90 && g < 70 && r > 100 && sat > 80;
    if (classic || rose || fuchsia) {
      d[i + 3] = 0;
    }
  }
  ctx.putImageData(id, 0, 0);
  return bboxCrop(canvas, 1);
}

/**
 * Zero solid green-screen plates (#00FF00, near-green, mid-green lattice spill)
 * left on quay art. Preserves yellow sodium (high R+G, low B) and low-sat steel.
 */
export function keyGreenPlate(canvas) {
  if (!canvas || !canvas.width) return canvas;
  const w = canvas.width | 0;
  const h = canvas.height | 0;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 1) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const maxRB = Math.max(r, b);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max - min;
    // Yellow sodium lights — never key
    if (r > 145 && g > 125 && b < 115 && (r + g) > b * 3.0 && Math.abs(r - g) < 100) continue;
    // Steel / low-sat neutrals
    if (sat < 22) continue;
    // Pure / bright green screen
    const pure = g > 160 && r < 80 && b < 80 && (g - maxRB) > 40;
    // Near-green spill (lower G threshold than classic #00FF00)
    const near = g > 100 && r < g * 0.62 && b < g * 0.62 && (g - maxRB) > 28;
    // Mid-green lattice spill — G dominant, high sat, not yellow
    const mid = g > 65 && g >= r && g > b && (g - maxRB) > 14 && sat > 30
      && r < 150 && b < 135 && r < g * 0.95;
    // Semi-transparent green fringe
    const fringe = a < 250 && g > 50 && g >= r && g >= b && (g - maxRB) > 10
      && sat > 24 && r < g * 0.97 && b < g * 0.9;
    // Opaque high-sat G-dominant (lattice mid-green even when fully opaque)
    const satDom = sat > 45 && g > 75 && g > r && g > b && (g - maxRB) > 12
      && r < 160 && b < 140 && !(r > 150 && g > 140 && b < 100);
    if (pure || near || mid || fringe || satDom) d[i + 3] = 0;
  }
  ctx.putImageData(id, 0, 0);
  return bboxCrop(canvas, 1);
}

/** Fit scenery but keep yellow sodium lights (crane v2.6). */
function fitSceneryPreserveYellow(source, maxW, maxH) {
  return fitCanvas(source, maxW, maxH, { stripNeonEdge: true, preserveYellow: true });
}

/**
 * Remap high-sat magenta/pink neon outlines → yellow sodium (Cargo quay).
 * Keeps stamped art readable without pink sky wash at grid zoom.
 */
export function neutralizePinkNeon(canvas) {
  if (!canvas || !canvas.width) return canvas;
  const w = canvas.width | 0;
  const h = canvas.height | 0;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 12) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max - min;
    if (sat < 45 || max < 90) continue;
    // Magenta / fuchsia / hot-pink neon (including unbalanced rose / lattice spill)
    const isPink =
      (r > 110 && b > 70 && g < Math.min(r, b) * 0.9 && r + b > g * 2.0) ||
      (Math.abs(r - b) <= 55 && r > 130 && g < 110) ||
      (r > 100 && b > 60 && g < 90 && r > g * 1.35 && b > g * 0.9 && sat > 40);
    if (!isPink) continue;
    const lum = (r * 0.3 + g * 0.4 + b * 0.3) / 255;
    // Yellow sodium
    d[i] = Math.min(255, Math.round(220 + lum * 35));
    d[i + 1] = Math.min(255, Math.round(150 + lum * 60));
    d[i + 2] = Math.min(255, Math.round(30 + lum * 40));
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}

/**
 * Prefer baked alpha → soft fringe only + bbox crop.
 * Else chroma with opts.keyColor (hex). Magenta paint cars must pass green key.
 */
export function processPackSprite(source, opts = {}) {
  const w = source.width | 0;
  const h = source.height | 0;
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.drawImage(source, 0, 0);
  const id = ctx.getImageData(0, 0, w, h);
  const baked = hasMeaningfulAlpha(id.data, w, h);

  let out;
  if (baked && !opts.forceChroma && !opts.forcePlateKey) {
    if (opts.softFringe !== false) {
      softFringeCleanup(ctx, w, h);
      erodeFringe1px(ctx, w, h);
    }
    out = bboxCrop(canvas, opts.pad != null ? opts.pad : 1);
  } else {
    const keyHex = opts.keyColor || '#FF00FF';
    const keyRgb = parseHexColor(keyHex);
    out = chromaKeyAndCrop(source, {
      hard: opts.hard,
      soft: opts.soft,
      pad: opts.pad,
      keyRgb,
      skipMagentaFringe: opts.skipMagentaFringe || (keyRgb.g > 200 && keyRgb.r < 40),
      alsoKeyGreen: keyRgb.g > 200 && keyRgb.r < 80
    });
  }
  // Neon plate strip is opt-in — scenery stamps enable it; cars keep edge paint
  if (opts.stripNeonEdge) {
    out = stripNeonEdgeFrames(out, opts.neonEdgePx != null ? opts.neonEdgePx : 3, true, {
      preserveYellow: !!opts.preserveYellow
    });
  }
  // Quay sprites: force hot-pink plate key even when baked alpha fooled the loader
  if (opts.forcePlateKey) {
    out = keyHotPinkPlate(out);
  }
  return out;
}

/** Scale source into a new canvas fitting inside maxW×maxH (contain). */
export function fitCanvas(source, maxW, maxH, opts = {}) {
  const sw = source.width || 1;
  const sh = source.height || 1;
  const s = Math.min(maxW / sw, maxH / sh);
  const dw = Math.max(1, Math.round(sw * s));
  const dh = Math.max(1, Math.round(sh * s));
  const { canvas, ctx } = makeCanvas(dw, dh);
  ctx.clearRect(0, 0, dw, dh);
  ctx.drawImage(source, 0, 0, dw, dh);
  if (opts.stripNeonEdge) {
    return stripNeonEdgeFrames(canvas, opts.neonEdgePx != null ? opts.neonEdgePx : 3, true, {
      preserveYellow: !!opts.preserveYellow
    });
  }
  return canvas;
}

/** Fit scenery stamp and strip any neon edge plate that survives scale. */
function fitScenery(source, maxW, maxH) {
  return fitCanvas(source, maxW, maxH, { stripNeonEdge: true });
}

/**
 * Phase A bake-down: scale so long edge ≤ maxLong (never leave raw 1280×720 in race path).
 * Returns source unchanged (same canvas ref ok) when already within budget.
 */
function bakeLongEdge(source, maxLong, opts = {}) {
  if (!source || !source.width) return source;
  const sw = source.width | 0;
  const sh = source.height | 0;
  const long = Math.max(sw, sh);
  if (long <= maxLong) {
    if (opts.stripNeonEdge) {
      return stripNeonEdgeFrames(source, opts.neonEdgePx != null ? opts.neonEdgePx : 3, true, {
        preserveYellow: !!opts.preserveYellow
      });
    }
    return source;
  }
  const s = maxLong / long;
  const dw = Math.max(1, Math.round(sw * s));
  const dh = Math.max(1, Math.round(sh * s));
  return fitCanvas(source, dw, dh, opts);
}

/** Md = full bake; Sm ≈ 50% of bake long-edge. */

/** Fill interior alpha holes under billboard scaffolds with opaque night-dark.
 *  Keeps outer fringe transparent; only seals fully-enclosed gaps inside opaque bbox.
 */
function sealBillboardScaffoldHoles(canvas) {
  if (!canvas || !canvas.width) return canvas;
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  // Opaque bbox
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return canvas;
  // Mark exterior transparent via flood from edges (inside bbox pad)
  const seen = new Uint8Array(w * h);
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);
  let qh = 0, qt = 0;
  function push(x, y) {
    const i = y * w + x;
    if (seen[i]) return;
    if (d[i * 4 + 3] > 24) return; // opaque wall
    seen[i] = 1;
    qx[qt] = x; qy[qt] = y; qt++;
  }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (qh < qt) {
    const x = qx[qh], y = qy[qh]; qh++;
    if (x > 0) push(x - 1, y);
    if (x + 1 < w) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < h) push(x, y + 1);
  }
  // Transparent + not exterior → interior hole → seal dark
  let sealed = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const i = y * w + x;
      const a = d[i * 4 + 3];
      if (a > 24) continue;
      if (seen[i]) continue;
      d[i * 4] = 14;
      d[i * 4 + 1] = 12;
      d[i * 4 + 2] = 18;
      d[i * 4 + 3] = 255;
      sealed++;
    }
  }
  if (sealed) ctx.putImageData(img, 0, 0);
  return canvas;
}

function makeLodPair(source, maxLong, opts = {}) {
  if (!source || !source.width) return { md: null, sm: null, hero: null };
  const md = bakeLongEdge(source, maxLong, { stripNeonEdge: true, ...opts });
  if (!md) return { md: null, sm: null, hero: null };
  const smLong = Math.max(48, Math.round(Math.max(md.width, md.height) * 0.5));
  const sm = bakeLongEdge(md, smLong, { stripNeonEdge: true, ...opts });
  return { md, sm, hero: md };
}

const HERO_STAMP_KEYS = new Set([
  'crane', 'grandstand-large', 'grandstandLarge', 'cityblock', 'cityblock-b', 'standLarge'
]);


/** Resolve pack car key for a colour / player flag. */
export function resolvePackCarKey(color, isPlayer) {
  if (!_pack || !_pack.ready) return null;
  if (isPlayer && _pack.cars.cyan) return 'cyan';
  const c = String(color || '').toLowerCase();
  const key = PACK_CAR_COLOR_MAP[c];
  if (key && _pack.cars[key]) return key;
  // Direct hex path lookup if map lagging
  const rel = _carsByColor[c];
  if (rel) {
    const k = keyFromRel(rel);
    if (_pack.cars[k]) return k;
  }
  return null;
}

export function getPackCarSprite(color, isPlayer) {
  const key = resolvePackCarKey(color, isPlayer);
  if (!key) return null;
  return _pack.cars[key] || null;
}

function syncColorMap(carsByColor) {
  if (!carsByColor || typeof carsByColor !== 'object') return;
  _carsByColor = {};
  for (const hex of Object.keys(PACK_CAR_COLOR_MAP)) delete PACK_CAR_COLOR_MAP[hex];
  for (const [hex, rel] of Object.entries(carsByColor)) {
    const h = String(hex).toLowerCase();
    const key = keyFromRel(rel);
    PACK_CAR_COLOR_MAP[h] = key;
    _carsByColor[h] = rel;
  }
}

/**
 * Load pack once from manifest.json. Missing files → partial pack.
 * Progressive: callers keep procedural until ready, then swap.
 */
export function loadAssetPack() {
  if (_promise) return _promise;
  _promise = (async () => {
    const pack = {
      ready: false,
      name: null,
      cars: {},
      scenery: {},
      skyline: null,
      asphalt: null,
      asphaltPatternOk: false,
      urbanLot: null
    };

    let manifest = null;
    try {
      const res = await fetch(PACK_BASE + 'manifest.json?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) manifest = await res.json();
    } catch (e) {
      console.warn('[assetPack] manifest miss', e.message);
    }

    pack.name = (manifest && manifest.pack) || 'realistic-v2';
    const chromaDefault = (manifest && manifest.chromaDefault) || '#FF00FF';
    if (manifest && manifest.carsByColor) syncColorMap(manifest.carsByColor);

    const carsByColor = (manifest && manifest.carsByColor) || _carsByColor;
    // Scenery stamps ONLY — never allow bg/* into this list (v2.4 art direction)
    const rawSceneryList = (manifest && Array.isArray(manifest.scenery))
      ? manifest.scenery
      : [
          'scenery/scenery-warehouse.png',
          'scenery/scenery-grandstand.png',
          'scenery/scenery-tower.png',
          'scenery/scenery-crowd.png',
          'scenery/scenery-tyrewall.png',
          'scenery/scenery-props.png',
          'scenery/scenery-palms.png',
          'scenery/scenery-billboard.png',
          'scenery/scenery-crowd-dense.png',
          'scenery/scenery-grandstand-large.png',
          'scenery/scenery-crane.png',
          'scenery/scenery-containers.png',
          'scenery/scenery-cityblock.png',
          'scenery/scenery-citystreet.png'
        ];
    const sceneryList = rawSceneryList.filter((rel) => {
      const s = String(rel || '');
      if (/^bg\//i.test(s)) return false;
      if (/REF-ONLY|arena-scene|neon-skyline/i.test(s)) return false;
      return true;
    });
    const bgRoles = (manifest && manifest.bgRoles) || {};
    // Race backdrop: prefer horizon; never REF-ONLY / arena-scene
    function pickRaceBackdropRel() {
      const candidates = [];
      if (manifest && Array.isArray(manifest.bg)) candidates.push(...manifest.bg);
      candidates.push('bg/bg-skyline-horizon.png');
      for (const rel of candidates) {
        const role = bgRoles[rel] || '';
        if (/doNotUseAsRaceBackdrop|referenceMoodOnly|doNotStamp/i.test(role)) continue;
        if (/REF-ONLY|arena-scene/i.test(rel)) continue;
        if (/horizon|skyline/i.test(rel) || role === 'screenSpaceBackdropOnly') return rel;
      }
      for (const rel of candidates) {
        if (/REF-ONLY|arena-scene|neon-skyline/i.test(rel)) continue;
        return rel;
      }
      return 'bg/bg-skyline-horizon.png';
    }
    const bgRel = pickRaceBackdropRel();
    const asphaltRel = (manifest && manifest.textures && manifest.textures[0]) || 'tex-asphalt.png';

    async function tryProcessed(rel, processOpts) {
      try {
        const img = await loadImage(PACK_BASE + rel);
        return processPackSprite(img, processOpts || {});
      } catch (e) {
        console.warn('[assetPack] keyed miss', rel, e.message);
        return null;
      }
    }

    async function tryPlain(rel) {
      try {
        const img = await loadImage(PACK_BASE + rel);
        const { canvas, ctx } = makeCanvas(img.width, img.height);
        ctx.drawImage(img, 0, 0);
        return canvas;
      } catch (e) {
        console.warn('[assetPack] plain miss', rel, e.message);
        return null;
      }
    }

    // Cars — map every palette colour; magenta never re-keys with magenta chroma
    const carEntries = Object.entries(carsByColor);
    const carResults = await Promise.all(carEntries.map(async ([hex, rel]) => {
      const key = keyFromRel(rel);
      const isMagentaPaint = key === 'magenta' || String(hex).toLowerCase() === '#ff2bd6';
      const opts = isMagentaPaint
        ? { keyColor: '#00FF00', skipMagentaFringe: true, softFringe: false }
        : { keyColor: chromaDefault };
      const canvas = await tryProcessed(rel, opts);
      return [key, canvas];
    }));
    for (const [key, canvas] of carResults) {
      if (canvas) pack.cars[key] = canvas;
    }

    // Scenery kinds from manifest list
    const sceneryResults = await Promise.all(sceneryList.map(async (rel) => {
      const key = keyFromRel(rel);
      const isCrane = /crane/i.test(key) || /crane/i.test(rel);
      const isContainers = /containers/i.test(key) || /containers/i.test(rel);
      const quay = isCrane || isContainers;
      // v2.6 crane: green #00FF00 screen + residual rose; keep yellow sodium lights
      const canvas = await tryProcessed(rel, {
        keyColor: isCrane ? '#00FF00' : chromaDefault,
        skipMagentaFringe: isCrane,
        stripNeonEdge: true,
        neonEdgePx: quay ? 5 : 3,
        preserveYellow: isCrane,
        forcePlateKey: quay,
        // Quay PNGs may have partial alpha fringe but solid rose/green plate — don't trust baked-only
        softFringe: true,
        forceChroma: quay
      });
      return [key, canvas];
    }));
    for (const [key, canvas] of sceneryResults) {
      if (canvas) pack.scenery[key] = canvas;
    }

    const urbanLotRel = (manifest && manifest.textures && manifest.textures[1]) || 'tex-urban-lot-tile.png';
    const [skyline, asphalt, urbanLot] = await Promise.all([
      tryPlain(bgRel),
      tryPlain(asphaltRel),
      tryPlain(urbanLotRel)
    ]);
    // pack.skyline = full-bleed screen-space backdrop ONLY — never stamped / never in pack.scenery
    pack.skyline = skyline;
    pack.skylineRel = bgRel;
    pack.asphalt = asphalt;
    pack.urbanLot = urbanLot;
    // Explicit: strip any accidental bg keys from scenery (chroma/fitScenery must never touch bg)
    for (const k of Object.keys(pack.scenery)) {
      if (/^(neon-skyline|skyline-horizon|arena-scene|skyline)$/i.test(k) || /REF/i.test(k)) {
        delete pack.scenery[k];
      }
    }

    const perf = (manifest && manifest.perfHints) || {};
    const maxStampPx = (perf.maxStampPx | 0) || 384;
    const heroStampPx = Math.max(maxStampPx, 512);
    pack.perfHints = { maxStampPx, heroStampPx, bakeAtLoad: perf.bakeAtLoad !== false,
      skipNearLayerWhenZoomBelow: perf.skipNearLayerWhenZoomBelow != null ? perf.skipNearLayerWhenZoomBelow : 0.7 };

    // Phase A: bake every scenery key so draw path never holds raw 1280×720 plates
    for (const k of Object.keys(pack.scenery)) {
      const src = pack.scenery[k];
      if (!src || !src.width) continue;
      const maxL = HERO_STAMP_KEYS.has(k) || /cityblock|crane|grandstand-large/i.test(k)
        ? heroStampPx : maxStampPx;
      if (Math.max(src.width, src.height) > maxL) {
        pack.scenery[k] = bakeLongEdge(src, maxL, { stripNeonEdge: true });
      }
    }

    const warehouse = pack.scenery.warehouse;
    const grandstand = pack.scenery.grandstand;
    const grandstandLarge = pack.scenery['grandstand-large'] || pack.scenery.grandstandLarge;
    const tower = pack.scenery.tower;
    const crowd = pack.scenery.crowd;
    const crowdDense = pack.scenery['crowd-dense'] || pack.scenery.crowdDense;
    const tyrewall = pack.scenery.tyrewall;
    const props = pack.scenery.props;
    const palms = pack.scenery.palms;
    const billboard = pack.scenery.billboard;
    const cityblock = pack.scenery.cityblock;
    const citystreet = pack.scenery.citystreet;

    if (warehouse) {
      // v35: bake ≤384; Sm/Md LOD — never leave keyed 1280 in race path
      const wh = warmCyanToSodium(bakeLongEdge(warehouse, maxStampPx, { stripNeonEdge: true }));
      const lod = makeLodPair(wh, maxStampPx);
      pack.scenery.warehouseMd = lod.md || warmCyanToSodium(fitScenery(wh, 168, 130));
      pack.scenery.warehouseSm = lod.sm || warmCyanToSodium(fitScenery(wh, 110, 120));
      pack.scenery.warehouse = pack.scenery.warehouseMd;
    }
    if (grandstand || grandstandLarge) {
      const standSrc = grandstand || grandstandLarge;
      const blockSrc = grandstandLarge || grandstand;
      pack.scenery.stand = warmCyanToSodium(fitScenery(standSrc, 160, 80));
      pack.scenery.standBlock = warmCyanToSodium(fitScenery(blockSrc, Math.min(280, maxStampPx), Math.min(140, maxStampPx)));
      if (grandstandLarge) {
        const gl = bakeLongEdge(grandstandLarge, heroStampPx, { stripNeonEdge: true });
        pack.scenery.standLarge = warmCyanToSodium(fitScenery(gl, Math.min(300, heroStampPx), Math.min(150, heroStampPx)));
        pack.scenery.grandstandLarge = warmCyanToSodium(gl);
      }
    }
    if (tower) {
      const tw = warmCyanToSodium(bakeLongEdge(tower, maxStampPx, { stripNeonEdge: true }));
      const lod = makeLodPair(tw, maxStampPx);
      pack.scenery.towerSm = lod.sm || warmCyanToSodium(fitScenery(tw, 110, 130));
      pack.scenery.towerMd = lod.md || warmCyanToSodium(fitScenery(tw, 150, 170));
      pack.scenery.tower = pack.scenery.towerMd;
    }
    if (crowd || crowdDense) {
      if (crowd) {
        const c0 = bakeLongEdge(crowd, maxStampPx, { stripNeonEdge: true });
        pack.scenery.crowdSm = fitScenery(c0, 72, 36);
        pack.scenery.crowdMd = fitScenery(c0, 110, 48);
        pack.scenery.crowdLg = fitScenery(c0, 160, 64);
        pack.scenery.crowd = pack.scenery.crowdMd;
      }
      if (crowdDense) {
        const cd = bakeLongEdge(crowdDense, maxStampPx, { stripNeonEdge: true });
        pack.scenery.crowdDense = cd;
        pack.scenery.crowdDenseSm = fitScenery(cd, 100, 48);
        pack.scenery.crowdDenseMd = fitScenery(cd, 160, 72);
        pack.scenery.crowdDenseLg = fitScenery(cd, 220, 96);
      }
    }
    if (tyrewall) {
      const tw = bakeLongEdge(tyrewall, maxStampPx, { stripNeonEdge: true });
      pack.scenery.tyrewall = tw;
      pack.scenery.tyrewallSm = fitScenery(tw, 56, 36);
      pack.scenery.tyrewallMd = fitScenery(tw, 80, 48);
    }
    if (props) {
      const pr = bakeLongEdge(props, maxStampPx, { stripNeonEdge: true });
      pack.scenery.props = pr;
      pack.scenery.propsSm = fitScenery(pr, 40, 36);
      pack.scenery.propsMd = fitScenery(pr, 56, 48);
      pack.scenery.propCone = fitScenery(pr, 28, 32);
      pack.scenery.propBarrel = fitScenery(pr, 32, 36);
    }
    if (palms) {
      const pl = bakeLongEdge(palms, maxStampPx, { stripNeonEdge: true });
      pack.scenery.palms = pl;
      pack.scenery.palmSm = fitScenery(pl, 40, 72);
      pack.scenery.palmMd = fitScenery(pl, 56, 96);
    }
    if (billboard) {
      const bb0 = warmCyanToSodium(bakeLongEdge(billboard, maxStampPx, { stripNeonEdge: true }));
      // Seal interior transparent holes (scaffold gaps) with night-dark so street/neon
      // stamps behind cannot show through — ship-blocker for Pixi painter/batch order.
      const bb = sealBillboardScaffoldHoles(bb0);
      const lod = makeLodPair(bb, maxStampPx);
      pack.scenery.billboardSm = lod.sm || warmCyanToSodium(fitScenery(bb, 110, 84));
      pack.scenery.billboardMd = lod.md || warmCyanToSodium(fitScenery(bb, 168, 120));
      pack.scenery.billboard = pack.scenery.billboardMd;
    }

    // Phase A.1 city circuit landmarks — base + -b + -c unique plates; Sm/Md (hero ≤512 / ≤384)
    const cityblockB = pack.scenery['cityblock-b'] || pack.scenery.cityblockB;
    const citystreetB = pack.scenery['citystreet-b'] || pack.scenery.citystreetB;
    const cityblockC = pack.scenery['cityblock-c'] || pack.scenery.cityblockC;
    const citystreetC = pack.scenery['citystreet-c'] || pack.scenery.citystreetC;
    function tagSrcKey(canvas, key) {
      if (canvas) canvas._srcKey = key;
      return canvas;
    }
    function bakeCityFamily(src, maxL, srcKey) {
      if (!src) return null;
      const baked = warmCyanToSodium(bakeLongEdge(src, maxL, { stripNeonEdge: true }));
      const lod = makeLodPair(baked, maxL);
      const md = lod.md || baked;
      const sm = lod.sm || bakeLongEdge(baked, Math.max(48, Math.round(Math.max(baked.width, baked.height) * 0.5)));
      tagSrcKey(md, srcKey);
      tagSrcKey(sm, srcKey);
      tagSrcKey(baked, srcKey);
      return { md, sm };
    }
    const cbA = cityblock ? bakeCityFamily(cityblock, heroStampPx, 'cityblock') : null;
    const cbB = cityblockB ? bakeCityFamily(cityblockB, heroStampPx, 'cityblock-b') : null;
    const cbC = cityblockC ? bakeCityFamily(cityblockC, heroStampPx, 'cityblock-c') : null;
    const csA = citystreet ? bakeCityFamily(citystreet, maxStampPx, 'citystreet') : null;
    const csB = citystreetB ? bakeCityFamily(citystreetB, maxStampPx, 'citystreet-b') : null;
    const csC = citystreetC ? bakeCityFamily(citystreetC, maxStampPx, 'citystreet-c') : null;
    // Flat keys (compat) + variant arrays so pick() gets unique plates across the full trio
    if (cbA || cbB || cbC) {
      const mds = [];
      const sms = [];
      if (cbA) { mds.push(cbA.md); sms.push(cbA.sm); pack.scenery.cityblockMd = cbA.md; pack.scenery.cityblockSm = cbA.sm; }
      if (cbB) {
        mds.push(cbB.md); sms.push(cbB.sm);
        pack.scenery['cityblock-b'] = cbB.md;
        pack.scenery.cityblockB = cbB.md;
        pack.scenery['cityblock-b-md'] = cbB.md;
        pack.scenery['cityblock-b-sm'] = cbB.sm;
        pack.scenery.cityblockBMd = cbB.md;
        pack.scenery.cityblockBSm = cbB.sm;
      }
      if (cbC) {
        mds.push(cbC.md); sms.push(cbC.sm);
        pack.scenery['cityblock-c'] = cbC.md;
        pack.scenery.cityblockC = cbC.md;
        pack.scenery['cityblock-c-md'] = cbC.md;
        pack.scenery['cityblock-c-sm'] = cbC.sm;
        pack.scenery.cityblockCMd = cbC.md;
        pack.scenery.cityblockCSm = cbC.sm;
      }
      pack.scenery.cityblock = mds[0];
      pack.scenery.cityblockMdVariants = mds;
      pack.scenery.cityblockSmVariants = sms;
      pack.scenery.cityblockVariants = mds;
    }
    if (csA || csB || csC) {
      const mds = [];
      const sms = [];
      if (csA) { mds.push(csA.md); sms.push(csA.sm); pack.scenery.citystreetMd = csA.md; pack.scenery.citystreetSm = csA.sm; }
      if (csB) {
        mds.push(csB.md); sms.push(csB.sm);
        pack.scenery['citystreet-b'] = csB.md;
        pack.scenery.citystreetB = csB.md;
        pack.scenery['citystreet-b-md'] = csB.md;
        pack.scenery['citystreet-b-sm'] = csB.sm;
        pack.scenery.citystreetBMd = csB.md;
        pack.scenery.citystreetBSm = csB.sm;
      }
      if (csC) {
        mds.push(csC.md); sms.push(csC.sm);
        pack.scenery['citystreet-c'] = csC.md;
        pack.scenery.citystreetC = csC.md;
        pack.scenery['citystreet-c-md'] = csC.md;
        pack.scenery['citystreet-c-sm'] = csC.sm;
        pack.scenery.citystreetCMd = csC.md;
        pack.scenery.citystreetCSm = csC.sm;
      }
      pack.scenery.citystreet = mds[0];
      pack.scenery.citystreetMdVariants = mds;
      pack.scenery.citystreetSmVariants = sms;
      pack.scenery.citystreetVariants = mds;
    }
    // Contiguous city fabric row — edge-to-edge plates for Neon/Gridlock rings
    const cityfabricRow = pack.scenery['cityfabric-row'] || pack.scenery.cityfabricRow || pack.scenery.cityfabric;
    const cf = cityfabricRow ? bakeCityFamily(cityfabricRow, heroStampPx, 'cityfabric-row') : null;
    if (cf) {
      pack.scenery['cityfabric-row'] = cf.md;
      pack.scenery.cityfabricRow = cf.md;
      pack.scenery.cityfabric = cf.md;
      pack.scenery['cityfabric-row-md'] = cf.md;
      pack.scenery['cityfabric-row-sm'] = cf.sm;
      pack.scenery.cityfabricMd = cf.md;
      pack.scenery.cityfabricSm = cf.sm;
      pack.scenery.cityfabricRowMd = cf.md;
      pack.scenery.cityfabricRowSm = cf.sm;
      pack.scenery.cityfabricMdVariants = [cf.md];
      pack.scenery.cityfabricSmVariants = [cf.sm];
      pack.scenery.cityfabricVariants = [cf.md];
    }


    // v2.6 Cargo quay — green-keyed crane; larger Md; neutralize residual rose → yellow sodium
    const crane = pack.scenery.crane;
    const containers = pack.scenery.containers;
    if (crane) {
      const c0 = keyGreenPlate(neutralizePinkNeon(keyHotPinkPlate(keyGreenPlate(
        bakeLongEdge(crane, heroStampPx, { stripNeonEdge: true, preserveYellow: true })
      ))));
      pack.scenery.crane = c0;
      const lod = makeLodPair(c0, heroStampPx, { preserveYellow: true });
      pack.scenery.craneSm = keyGreenPlate(neutralizePinkNeon(keyHotPinkPlate(keyGreenPlate(
        lod.sm || fitSceneryPreserveYellow(c0, 160, 180)
      ))));
      pack.scenery.craneMd = keyGreenPlate(neutralizePinkNeon(keyHotPinkPlate(keyGreenPlate(
        lod.md || fitSceneryPreserveYellow(c0, 240, 260)
      ))));
      pack.scenery.crane = pack.scenery.craneMd;
    }
    if (containers) {
      const k0 = neutralizePinkNeon(keyHotPinkPlate(bakeLongEdge(containers, maxStampPx, { stripNeonEdge: true })));
      const lod = makeLodPair(k0, maxStampPx);
      pack.scenery.containersSm = neutralizePinkNeon(keyHotPinkPlate(lod.sm || fitScenery(k0, 130, 96)));
      pack.scenery.containersMd = neutralizePinkNeon(keyHotPinkPlate(lod.md || fitScenery(k0, 200, 150)));
      pack.scenery.containers = pack.scenery.containersMd;
    }

    pack.trackHints = (manifest && manifest.trackHints) || {};

    const anyCar = Object.values(pack.cars).some(Boolean);
    const anyScenery = !!(warehouse || grandstand || grandstandLarge || tower || crowd || crowdDense || tyrewall || props || palms || billboard || crane || containers || cityblock || citystreet || cityblockB || citystreetB || cityblockC || citystreetC || cityfabricRow);
    pack.ready = !!(anyCar || anyScenery || skyline);
    _pack = pack;
    try {
      if (typeof window !== 'undefined') {
        window.__RAD_PACK_READY__ = !!pack.ready;
        window.__RAD_PACK_INFO__ = {
          ready: pack.ready,
          pack: pack.name,
          cars: Object.fromEntries(
            Object.entries(pack.cars).map(([k, v]) => [k, !!(v && v.width)])
          ),
          carCount: Object.values(pack.cars).filter(Boolean).length,
          scenery: {
            warehouse: !!warehouse,
            grandstand: !!grandstand,
            grandstandLarge: !!grandstandLarge,
            tower: !!tower,
            crowd: !!crowd,
            crowdDense: !!crowdDense,
            tyrewall: !!tyrewall,
            props: !!props,
            palms: !!palms,
            billboard: !!billboard,
            crane: !!crane,
            containers: !!containers,
            cityblock: !!cityblock,
            citystreet: !!citystreet,
            cityblockB: !!cityblockB,
            citystreetB: !!citystreetB,
            cityblockC: !!cityblockC,
            citystreetC: !!citystreetC,
            cityfabricRow: !!cityfabricRow,
            urbanLot: !!urbanLot,
            cityblockMd: !!(pack.scenery.cityblockMd),
            citystreetMd: !!(pack.scenery.citystreetMd),
            cityblockVariants: (pack.scenery.cityblockMdVariants || []).length,
            citystreetVariants: (pack.scenery.citystreetMdVariants || []).length
          },
          stampSizes: {
            cityblock: pack.scenery.cityblock && [pack.scenery.cityblock.width, pack.scenery.cityblock.height],
            citystreet: pack.scenery.citystreet && [pack.scenery.citystreet.width, pack.scenery.citystreet.height],
            cityblockB: pack.scenery['cityblock-b'] && [pack.scenery['cityblock-b'].width, pack.scenery['cityblock-b'].height],
            citystreetB: pack.scenery['citystreet-b'] && [pack.scenery['citystreet-b'].width, pack.scenery['citystreet-b'].height],
            cityblockC: pack.scenery['cityblock-c'] && [pack.scenery['cityblock-c'].width, pack.scenery['cityblock-c'].height],
            citystreetC: pack.scenery['citystreet-c'] && [pack.scenery['citystreet-c'].width, pack.scenery['citystreet-c'].height],
            cityfabricRow: pack.scenery['cityfabric-row'] && [pack.scenery['cityfabric-row'].width, pack.scenery['cityfabric-row'].height],
            urbanLot: pack.urbanLot && [pack.urbanLot.width, pack.urbanLot.height],
            warehouse: pack.scenery.warehouse && [pack.scenery.warehouse.width, pack.scenery.warehouse.height],
            maxStampPx,
            heroStampPx
          },
          trackHints: pack.trackHints,
          skyline: !!skyline,
          skylineRel: bgRel,
          tower: !!tower,
          asphalt: !!asphalt,
          bgRoles
        };
      }
    } catch (_) {}
    notify();
    return pack;
  })().catch((e) => {
    console.warn('[assetPack] load failed', e);
    _pack = { ready: false, cars: {}, scenery: {}, skyline: null, asphalt: null };
    notify();
    return _pack;
  });
  return _promise;
}
