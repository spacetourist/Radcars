/**
 * Realistic asset pack loader — chroma-key magenta, crop to content bbox,
 * expose keyed canvases for cars / scenery / skyline / asphalt.
 * Files may be named .png; decode via Image regardless of encoding.
 */

const PACK_BASE = './assets/generated/';

/** Tolerant magenta key thresholds (belt-and-braces for bleed / soft edges). */
const CHROMA_HARD = 110;   // manhattan RGB distance → fully transparent
const CHROMA_SOFT = 200;   // fade between HARD and SOFT
/** Magenta fringe: R≈B, both high, G low — avoids eating pink/lime car paint. */
const MAG_MIN_RB = 150;
const MAG_MAX_G_RATIO = 0.48;
const MAG_RB_DELTA = 70;

const FILES = {
  cars: {
    cyan: 'cars/car-cyan.png',
    pink: 'cars/car-pink.png',
    lime: 'cars/car-lime.png'
  },
  scenery: {
    warehouse: 'scenery/scenery-warehouse.png',
    grandstand: 'scenery/scenery-grandstand.png'
  },
  bg: 'bg/bg-neon-skyline.png',
  asphalt: 'tex-asphalt.png'
};

/** Colour → pack car key. Player prefers cyan when pack ready. */
export const PACK_CAR_COLOR_MAP = {
  '#00e8ff': 'cyan',
  '#ff2b6a': 'pink',
  '#b8ff00': 'lime'
};

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

/**
 * Chroma-key #FF00FF → alpha with tolerant threshold + soft edge.
 * Returns a cropped canvas of opaque content only (pad 2px).
 */
export function chromaKeyAndCrop(source, opts = {}) {
  const hard = opts.hard != null ? opts.hard : CHROMA_HARD;
  const soft = opts.soft != null ? opts.soft : CHROMA_SOFT;
  const pad = opts.pad != null ? opts.pad : 1;

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

    // Manhattan distance to #FF00FF
    const dist = Math.abs(r - 255) + Math.abs(g - 0) + Math.abs(b - 255);
    // Magenta fringe signature (R≈B >> G) — separate from pink paint (R>>B)
    const rb = Math.min(r, b);
    const magBalanced = Math.abs(r - b) <= MAG_RB_DELTA;
    const isMagFringe = magBalanced && rb >= MAG_MIN_RB && g <= rb * MAG_MAX_G_RATIO;
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

    // BBox only from clearly non-magenta opaque pixels
    if (na > 40 && !isMagFringe && dist > hard) {
      found = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  ctx.putImageData(id, 0, 0);

  // Second pass: despill leftover magenta fringe into transparency (soft edge)
  {
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
  }

  // Recompute bbox from post-despill alphas (ignore residual fringe)
  {
    const id3 = ctx.getImageData(0, 0, w, h);
    const d3 = id3.data;
    minX = w; minY = h; maxX = 0; maxY = 0; found = false;
    for (let i = 0, x = 0, y = 0; i < d3.length; i += 4, x++) {
      if (x === w) { x = 0; y++; }
      if (d3[i + 3] <= 48) continue;
      const r = d3[i], g = d3[i + 1], b = d3[i + 2];
      const rb = Math.min(r, b);
      if (Math.abs(r - b) <= 55 && rb > 140 && g < rb * 0.5) continue; // skip fringe
      found = true;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
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

/** Scale source into a new canvas fitting inside maxW×maxH (contain). */
export function fitCanvas(source, maxW, maxH) {
  const sw = source.width || 1;
  const sh = source.height || 1;
  const s = Math.min(maxW / sw, maxH / sh);
  const dw = Math.max(1, Math.round(sw * s));
  const dh = Math.max(1, Math.round(sh * s));
  const { canvas, ctx } = makeCanvas(dw, dh);
  ctx.clearRect(0, 0, dw, dh);
  ctx.drawImage(source, 0, 0, dw, dh);
  return canvas;
}

/** Resolve pack car key for a colour / player flag. */
export function resolvePackCarKey(color, isPlayer) {
  if (!_pack || !_pack.ready) return null;
  if (isPlayer && _pack.cars.cyan) return 'cyan';
  const c = String(color || '').toLowerCase();
  const key = PACK_CAR_COLOR_MAP[c];
  if (key && _pack.cars[key]) return key;
  return null;
}

export function getPackCarSprite(color, isPlayer) {
  const key = resolvePackCarKey(color, isPlayer);
  if (!key) return null;
  return _pack.cars[key] || null;
}

/**
 * Load pack once. Missing files → partial pack with procedural fallbacks elsewhere.
 * Progressive: callers keep procedural until ready, then swap.
 */
export function loadAssetPack() {
  if (_promise) return _promise;
  _promise = (async () => {
    const pack = {
      ready: false,
      cars: { cyan: null, pink: null, lime: null },
      scenery: { warehouse: null, grandstand: null },
      skyline: null,
      asphalt: null,
      asphaltPatternOk: false
    };

    async function tryKeyed(rel) {
      try {
        const img = await loadImage(PACK_BASE + rel);
        return chromaKeyAndCrop(img);
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

    const [cyan, pink, lime, warehouse, grandstand, skyline, asphalt] = await Promise.all([
      tryKeyed(FILES.cars.cyan),
      tryKeyed(FILES.cars.pink),
      tryKeyed(FILES.cars.lime),
      tryKeyed(FILES.scenery.warehouse),
      tryKeyed(FILES.scenery.grandstand),
      tryPlain(FILES.bg),
      tryPlain(FILES.asphalt)
    ]);

    pack.cars.cyan = cyan;
    pack.cars.pink = pink;
    pack.cars.lime = lime;
    pack.scenery.warehouse = warehouse;
    pack.scenery.grandstand = grandstand;
    pack.skyline = skyline;
    pack.asphalt = asphalt;

    // Pre-fit scenery to placement-friendly sizes (procedural banks were ~72–220 px)
    if (warehouse) {
      pack.scenery.warehouseSm = fitCanvas(warehouse, 96, 110);
      pack.scenery.warehouseMd = fitCanvas(warehouse, 120, 90);
    }
    if (grandstand) {
      pack.scenery.stand = fitCanvas(grandstand, 160, 80);
      pack.scenery.standBlock = fitCanvas(grandstand, 240, 120);
    }

    pack.ready = !!(cyan || pink || lime || warehouse || grandstand || skyline);
    _pack = pack;
    try {
      if (typeof window !== 'undefined') {
        window.__RAD_PACK_READY__ = !!pack.ready;
        window.__RAD_PACK_INFO__ = {
          ready: pack.ready,
          cyan: !!(pack.cars && pack.cars.cyan),
          cyanW: pack.cars && pack.cars.cyan && pack.cars.cyan.width,
          skyline: !!pack.skyline,
          warehouse: !!(pack.scenery && pack.scenery.warehouse)
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
