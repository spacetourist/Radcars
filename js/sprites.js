/**
 * Pre-rendered sprite bank for Radcars.
 * Cars / mines / projectiles / boom frames generated once at init to offscreen canvases,
 * then drawn with drawImage for solid mobile perf.
 * Prefer realistic pack sprites (chroma-keyed) when assetPack is ready; procedural fallback.
 */

import { getPackCarSprite, isPackReady } from './assetPack.js';

function shade(hex, amt) {
  const c = hex.replace('#', '');
  if (c.length < 6) return hex;
  const n = parseInt(c, 16);
  let r = (n >> 16) + amt;
  let g = ((n >> 8) & 0xff) + amt;
  let b = (n & 0xff) + amt;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function hexAlpha(hex, a) {
  const c = hex.replace('#', '');
  if (c.length < 6) return hex;
  const n = parseInt(c, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  return { canvas: c, ctx };
}

/** Angular combat-chassis silhouette (local +x = nose). */
function angularBody(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.moveTo(x + w * 0.92, y + h * 0.2);
  ctx.lineTo(x + w, y + h * 0.5);
  ctx.lineTo(x + w * 0.92, y + h * 0.8);
  ctx.lineTo(x + w * 0.55, y + h);
  ctx.lineTo(x + w * 0.1, y + h * 0.92);
  ctx.lineTo(x, y + h * 0.72);
  ctx.lineTo(x, y + h * 0.28);
  ctx.lineTo(x + w * 0.1, y + h * 0.08);
  ctx.lineTo(x + w * 0.55, y);
  ctx.closePath();
}

/**
 * Paint a crisp top-down car into ctx at origin, facing +x.
 * scale is pixel scale (e.g. 2 for retina sheet).
 */
function paintCarBody(ctx, color, opts = {}) {
  const tier = opts.tier | 0;
  const isPlayer = !!opts.isPlayer;
  const accent = isPlayer ? '#00e8ff' : (opts.accent || '#b8ff00');
  const neon = isPlayer ? '#ff2bd6' : accent;

  // Soft contact shadow baked under chassis
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(1, 3, 20, 11, 0, 0, Math.PI * 2);
  ctx.fill();

  // Outer glow silhouette
  ctx.strokeStyle = isPlayer ? 'rgba(0,232,255,0.4)' : hexAlpha(color, 0.32);
  ctx.lineWidth = isPlayer ? 5 : 3.5;
  angularBody(ctx, -18, -12, 36, 24);
  ctx.stroke();

  // Main body layers
  ctx.fillStyle = shade(color, -18);
  angularBody(ctx, -18, -12, 36, 24);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-14, -9);
  ctx.lineTo(14, -7);
  ctx.lineTo(16, 0);
  ctx.lineTo(14, 7);
  ctx.lineTo(-14, 9);
  ctx.lineTo(-16, 0);
  ctx.closePath();
  ctx.fill();

  // Highlight ridge
  ctx.fillStyle = shade(color, 42);
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(-8, -6);
  ctx.lineTo(10, -4.5);
  ctx.lineTo(8, -1);
  ctx.lineTo(-10, -2.5);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Skirts
  ctx.fillStyle = shade(color, -50);
  ctx.beginPath();
  ctx.moveTo(-14, -13.5);
  ctx.lineTo(8, -13.5);
  ctx.lineTo(6, -11);
  ctx.lineTo(-12, -11);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-14, 13.5);
  ctx.lineTo(8, 13.5);
  ctx.lineTo(6, 11);
  ctx.lineTo(-12, 11);
  ctx.closePath();
  ctx.fill();

  // Cabin
  ctx.fillStyle = 'rgba(8, 12, 20, 0.95)';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(12, -5.5);
  ctx.lineTo(12, 5.5);
  ctx.lineTo(0, 7);
  ctx.lineTo(-4, 5);
  ctx.lineTo(-4, -5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0, 232, 255, 0.28)';
  ctx.beginPath();
  ctx.moveTo(2, -4.5);
  ctx.lineTo(10, -3.5);
  ctx.lineTo(10, 3.5);
  ctx.lineTo(2, 4.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(12, -5.5);
  ctx.lineTo(12, 5.5);
  ctx.lineTo(0, 7);
  ctx.stroke();

  // Nose
  ctx.fillStyle = shade(color, 38);
  ctx.beginPath();
  ctx.moveTo(14, -5);
  ctx.lineTo(19, 0);
  ctx.lineTo(14, 5);
  ctx.lineTo(11, 4);
  ctx.lineTo(11, -4);
  ctx.closePath();
  ctx.fill();

  // Headlights
  ctx.fillStyle = 'rgba(0,232,255,0.4)';
  ctx.fillRect(14, -4.2, 5, 3.2);
  ctx.fillRect(14, 1.0, 5, 3.2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(15.5, -3.4, 2.8, 2);
  ctx.fillRect(15.5, 1.4, 2.8, 2);

  // Rear wing — bigger with tier
  const wingW = 5 + Math.min(3, tier);
  const wingH = 20 + Math.min(4, tier);
  ctx.fillStyle = shade(color, -58);
  ctx.fillRect(-19 - (tier > 1 ? 1 : 0), -wingH / 2, wingW, wingH);
  ctx.fillRect(-21 - (tier > 1 ? 1 : 0), -wingH / 2 - 1, 9 + Math.min(2, tier), 3);
  ctx.fillRect(-21 - (tier > 1 ? 1 : 0), wingH / 2 - 2, 9 + Math.min(2, tier), 3);
  ctx.fillStyle = neon;
  ctx.globalAlpha = 0.92;
  ctx.fillRect(-18.5, -wingH / 2 + 1, 2, wingH - 2);
  ctx.globalAlpha = 1;

  // Side neon rails
  ctx.strokeStyle = isPlayer ? 'rgba(0,232,255,0.8)' : hexAlpha(color, 0.65);
  ctx.lineWidth = 1.6 + (tier > 0 ? 0.4 : 0);
  ctx.beginPath();
  ctx.moveTo(-10, -10.5);
  ctx.lineTo(10, -10.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-10, 10.5);
  ctx.lineTo(10, 10.5);
  ctx.stroke();

  // Tier stripes / 90s swagger decals
  if (tier >= 1) {
    ctx.strokeStyle = hexAlpha(accent, 0.7);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-6, -3);
    ctx.lineTo(8, -2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-6, 3);
    ctx.lineTo(8, 2);
    ctx.stroke();
  }
  if (tier >= 2) {
    ctx.fillStyle = hexAlpha(neon, 0.55);
    ctx.fillRect(-2, -11.5, 6, 1.4);
    ctx.fillRect(-2, 10.1, 6, 1.4);
  }
  if (tier >= 3) {
    // Extra canards
    ctx.fillStyle = shade(color, -30);
    ctx.beginPath();
    ctx.moveTo(8, -12);
    ctx.lineTo(14, -10);
    ctx.lineTo(8, -9);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(8, 12);
    ctx.lineTo(14, 10);
    ctx.lineTo(8, 9);
    ctx.fill();
  }

  // Outline
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1.4;
  angularBody(ctx, -18, -12, 36, 24);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 0.9;
  angularBody(ctx, -17.2, -11.2, 34.4, 22.4);
  ctx.stroke();
}

const ROT_FRAMES = 36;
const CAR_SIZE = 96; // offscreen sheet cell (2x crisp)
const CAR_HALF = CAR_SIZE / 2;
/** Max draw size of pack car inside the 96 cell (match procedural ~36×24 @2x). */
const PACK_FIT = 84;

function carKey(color, tier, isPlayer, packTag) {
  return `${color}|${tier}|${isPlayer ? 1 : 0}|${packTag || 'proc'}`;
}

function buildCarFrames(color, tier, isPlayer) {
  const frames = new Array(ROT_FRAMES);
  for (let i = 0; i < ROT_FRAMES; i++) {
    const { canvas, ctx } = makeCanvas(CAR_SIZE, CAR_SIZE);
    const angle = (i / ROT_FRAMES) * Math.PI * 2;
    ctx.translate(CAR_HALF, CAR_HALF);
    ctx.scale(2, 2); // paint at 2x for HD
    ctx.rotate(angle);
    paintCarBody(ctx, color, { tier, isPlayer });
    frames[i] = canvas;
  }
  return frames;
}

/**
 * Build 36 rotation frames from a facing-+X pack base (already chroma-keyed + cropped).
 */
function buildCarFramesFromPack(base) {
  const frames = new Array(ROT_FRAMES);
  const sw = base.width || 1;
  const sh = base.height || 1;
  const scale = Math.min(PACK_FIT / sw, PACK_FIT / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  for (let i = 0; i < ROT_FRAMES; i++) {
    const { canvas, ctx } = makeCanvas(CAR_SIZE, CAR_SIZE);
    const angle = (i / ROT_FRAMES) * Math.PI * 2;
    ctx.translate(CAR_HALF, CAR_HALF);
    ctx.rotate(angle);
    ctx.imageSmoothingEnabled = true;
    // Soft contact shadow under art
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(1, dh * 0.12, dw * 0.42, dh * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(base, -dw / 2, -dh / 2, dw, dh);
    frames[i] = canvas;
  }
  return frames;
}

function buildMineFrames() {
  const frames = [];
  for (let f = 0; f < 8; f++) {
    const { canvas, ctx } = makeCanvas(48, 48);
    ctx.translate(24, 24);
    ctx.scale(2, 2);
    const pulse = 0.55 + 0.45 * Math.sin(f * 0.9);
    ctx.strokeStyle = `rgba(255,34,68,${0.3 * pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 8 + pulse * 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 === 0 ? 7 : 4.5;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#ff2244';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = '#ffe600';
    ctx.beginPath();
    ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
    ctx.fill();
    frames.push(canvas);
  }
  // unarmed variant
  {
    const { canvas, ctx } = makeCanvas(48, 48);
    ctx.translate(24, 24);
    ctx.scale(2, 2);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 === 0 ? 7 : 4.5;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#5a4828';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    frames.unarmed = canvas;
  }
  return frames;
}

function buildProjectileFrames() {
  const types = {
    front: '#ff8a00',
    homing: '#ff2bd6',
    super: '#ffe600',
    rear: '#ff8a00'
  };
  const out = {};
  for (const [type, col] of Object.entries(types)) {
    const frames = [];
    for (let i = 0; i < ROT_FRAMES; i++) {
      const { canvas, ctx } = makeCanvas(64, 64);
      const angle = (i / ROT_FRAMES) * Math.PI * 2;
      ctx.translate(32, 32);
      ctx.scale(2, 2);
      ctx.rotate(angle);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, 0, 10, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(2, -3);
      ctx.lineTo(-7, -2.4);
      ctx.lineTo(-7, 2.4);
      ctx.lineTo(2, 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(3, -2);
      ctx.lineTo(3, 2);
      ctx.fill();
      frames.push(canvas);
    }
    out[type] = frames;
  }
  return out;
}

function buildBoomFrames() {
  const frames = [];
  for (let f = 0; f < 10; f++) {
    const { canvas, ctx } = makeCanvas(96, 96);
    ctx.translate(48, 48);
    const t = f / 9;
    const r = 6 + t * 28;
    ctx.globalAlpha = 1 - t * 0.85;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3 - t * 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ff8a00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ff2bd6';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + t;
      const d = r * (0.4 + t * 0.6);
      ctx.fillStyle = i % 2 ? '#ffe600' : '#ff8a00';
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 3 * (1 - t), 0, Math.PI * 2);
      ctx.fill();
    }
    frames.push(canvas);
  }
  return frames;
}

/**
 * Create and cache the full sprite bank. Call once at renderer init.
 * Progressive: procedural until pack ready; call invalidatePackCars() after load.
 */
export function createSpriteBank() {
  const carCache = new Map();
  const mines = buildMineFrames();
  const projectiles = buildProjectileFrames();
  const booms = buildBoomFrames();

  function packTagFor(color, isPlayer) {
    if (!isPackReady()) return 'proc';
    const spr = getPackCarSprite(color, isPlayer);
    return spr ? 'pack' : 'proc';
  }

  function getCarFrames(color, tier = 0, isPlayer = false) {
    const tag = packTagFor(color, isPlayer);
    const key = carKey(color, tier, isPlayer, tag);
    let frames = carCache.get(key);
    if (!frames) {
      const base = tag === 'pack' ? getPackCarSprite(color, isPlayer) : null;
      if (base) {
        // Pack art already carries colour; tier ignored for sheet (same silhouette)
        frames = buildCarFramesFromPack(base);
      } else {
        frames = buildCarFrames(color, tier, isPlayer);
      }
      carCache.set(key, frames);
    }
    return frames;
  }

  function carFrameIndex(angle) {
    let a = angle % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return Math.round((a / (Math.PI * 2)) * ROT_FRAMES) % ROT_FRAMES;
  }

  return {
    ROT_FRAMES,
    CAR_SIZE,
    getCarFrames,
    carFrameIndex,
    mines,
    projectiles,
    booms,
    /** Drop pack/proc car sheets so next draw rebuilds with current pack state. */
    invalidatePackCars() {
      carCache.clear();
    },
    /** Warm common colours so first race doesn't hitch */
    warm(colors = []) {
      for (const col of colors) {
        getCarFrames(col, 0, false);
        getCarFrames(col, 2, false);
      }
      getCarFrames('#00e8ff', 0, true);
      getCarFrames('#00e8ff', 2, true);
      getCarFrames('#00e8ff', 4, true);
    }
  };
}
