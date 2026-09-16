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
    const isGrn = g > 140 && r < g * 0.55 && b < g * 0.55 && (g - Math.max(r, b)) > 40;
    const isPureGrn = g > 200 && r < 50 && b < 50;
    if (isPureMag || isPureGrn || ((isMag || isGrn) && a < 250)) {
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

  if (baked) {
    if (opts.softFringe !== false) {
      softFringeCleanup(ctx, w, h);
      erodeFringe1px(ctx, w, h);
    }
    return bboxCrop(canvas, opts.pad != null ? opts.pad : 1);
  }

  const keyHex = opts.keyColor || '#FF00FF';
  const keyRgb = parseHexColor(keyHex);
  return chromaKeyAndCrop(source, {
    hard: opts.hard,
    soft: opts.soft,
    pad: opts.pad,
    keyRgb,
    skipMagentaFringe: opts.skipMagentaFringe || (keyRgb.g > 200 && keyRgb.r < 40)
  });
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
      asphaltPatternOk: false
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
    const sceneryList = (manifest && Array.isArray(manifest.scenery))
      ? manifest.scenery
      : [
          'scenery/scenery-warehouse.png',
          'scenery/scenery-grandstand.png',
          'scenery/scenery-tower.png',
          'scenery/scenery-crowd.png',
          'scenery/scenery-tyrewall.png',
          'scenery/scenery-props.png',
          'scenery/scenery-palms.png',
          'scenery/scenery-billboard.png'
        ];
    const bgRel = (manifest && manifest.bg && manifest.bg[0]) || 'bg/bg-neon-skyline.png';
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
      const canvas = await tryProcessed(rel, { keyColor: chromaDefault });
      return [key, canvas];
    }));
    for (const [key, canvas] of sceneryResults) {
      if (canvas) pack.scenery[key] = canvas;
    }

    const [skyline, asphalt] = await Promise.all([
      tryPlain(bgRel),
      tryPlain(asphaltRel)
    ]);
    pack.skyline = skyline;
    pack.asphalt = asphalt;

    const warehouse = pack.scenery.warehouse;
    const grandstand = pack.scenery.grandstand;
    const tower = pack.scenery.tower;
    const crowd = pack.scenery.crowd;
    const tyrewall = pack.scenery.tyrewall;
    const props = pack.scenery.props;
    const palms = pack.scenery.palms;
    const billboard = pack.scenery.billboard;

    if (warehouse) {
      pack.scenery.warehouseSm = fitCanvas(warehouse, 96, 110);
      pack.scenery.warehouseMd = fitCanvas(warehouse, 120, 90);
    }
    if (grandstand) {
      pack.scenery.stand = fitCanvas(grandstand, 160, 80);
      pack.scenery.standBlock = fitCanvas(grandstand, 240, 120);
    }
    if (tower) {
      // Pack tower art is often landscape after bbox; allow wider fits so mid/far reads
      pack.scenery.towerSm = fitCanvas(tower, 100, 120);
      pack.scenery.towerMd = fitCanvas(tower, 130, 150);
    }
    if (crowd) {
      pack.scenery.crowdSm = fitCanvas(crowd, 72, 36);
      pack.scenery.crowdMd = fitCanvas(crowd, 110, 48);
      pack.scenery.crowdLg = fitCanvas(crowd, 160, 64);
    }
    if (tyrewall) {
      pack.scenery.tyrewallSm = fitCanvas(tyrewall, 56, 36);
      pack.scenery.tyrewallMd = fitCanvas(tyrewall, 80, 48);
    }
    if (props) {
      pack.scenery.propsSm = fitCanvas(props, 40, 36);
      pack.scenery.propsMd = fitCanvas(props, 56, 48);
      // Also expose as cone/barrel stand-ins for placement code
      pack.scenery.propCone = fitCanvas(props, 28, 32);
      pack.scenery.propBarrel = fitCanvas(props, 32, 36);
    }
    if (palms) {
      // Tall fits — pack sheet is often a palm cluster; contain keeps aspect
      pack.scenery.palmSm = fitCanvas(palms, 40, 72);
      pack.scenery.palmMd = fitCanvas(palms, 56, 96);
    }
    if (billboard) {
      pack.scenery.billboardSm = fitCanvas(billboard, 96, 72);
      pack.scenery.billboardMd = fitCanvas(billboard, 128, 96);
    }

    const anyCar = Object.values(pack.cars).some(Boolean);
    const anyScenery = !!(warehouse || grandstand || tower || crowd || tyrewall || props || palms || billboard);
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
            tower: !!tower,
            crowd: !!crowd,
            tyrewall: !!tyrewall,
            props: !!props,
            palms: !!palms,
            billboard: !!billboard
          },
          skyline: !!skyline,
          asphalt: !!asphalt
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
