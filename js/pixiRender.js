/**
 * PixiJS v8 race-render spike (Phase B).
 * Off by default. Enable: ?pixi=1 or localStorage.radcarsPixi = "1".
 * Keeps tracks.js / physics / input / Canvas renderer intact when flag is off.
 */
import {
  Application,
  Container,
  Sprite,
  Texture,
  Graphics,
  Text
} from '../vendor/pixi.min.mjs';
import { createSceneryCache } from './scenery.js';
import { createSpriteBank } from './sprites.js';
import { getAssetPack, onPackReady } from './assetPack.js';
import { CAR_COLORS } from './cars.js';

export function isPixiFlagOn() {
  try {
    const q = new URLSearchParams(location.search);
    const v = q.get('pixi');
    if (v === '0' || v === 'false') return false;
    if (v === '1' || v === 'true') return true;
    return localStorage.getItem('radcarsPixi') === '1';
  } catch (_) {
    return false;
  }
}

const texCache = new WeakMap();

function textureFrom(source) {
  if (!source) return null;
  let t = texCache.get(source);
  if (!t || t.destroyed) {
    t = Texture.from(source);
    texCache.set(source, t);
  }
  return t;
}

function pathPoly(ctx, pts) {
  if (!pts || !pts.length) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function strokeLoop(ctx, pts) {
  if (!pts || !pts.length) return;
  ctx.beginPath();
  pathPoly(ctx, pts);
  ctx.stroke();
}

function shadeHex(hex, amt) {
  const c = String(hex || '#888').replace('#', '');
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

/** Half-res track bake - never leaves raw 1280 scenery plates unbound. */
function bakeTrackCanvas(track, scale = 0.5) {
  const W = Math.max(64, Math.ceil(track.width * scale));
  const H = Math.max(64, Math.ceil(track.height * scale));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.strokeStyle = 'rgba(22, 18, 14, 0.96)';
  ctx.lineWidth = 62;
  strokeLoop(ctx, track.outer);
  ctx.strokeStyle = 'rgba(38, 32, 24, 0.72)';
  ctx.lineWidth = 44;
  strokeLoop(ctx, track.outer);

  ctx.beginPath();
  pathPoly(ctx, track.outer);
  const ag = ctx.createLinearGradient(0, 0, track.width, track.height);
  ag.addColorStop(0, track.asphalt || '#1a222c');
  ag.addColorStop(0.5, shadeHex(track.asphalt || '#1a222c', -8));
  ag.addColorStop(1, shadeHex(track.asphalt || '#1a222c', 4));
  ctx.fillStyle = ag;
  ctx.fill();

  ctx.strokeStyle = 'rgba(4, 3, 2, 0.55)';
  ctx.lineWidth = 48;
  strokeLoop(ctx, track.line);
  ctx.strokeStyle = 'rgba(250, 235, 200, 0.35)';
  ctx.lineWidth = 18;
  strokeLoop(ctx, track.line);

  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  pathPoly(ctx, track.inner);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  ctx.strokeStyle = 'rgba(18, 16, 14, 0.95)';
  ctx.lineWidth = 10;
  strokeLoop(ctx, track.outer);
  strokeLoop(ctx, track.inner);
  ctx.strokeStyle = 'rgba(255, 220, 160, 0.55)';
  ctx.lineWidth = 3;
  strokeLoop(ctx, track.outer);
  strokeLoop(ctx, track.inner);

  if (track.spawns && track.spawns[0]) {
    const s0 = track.spawns[0];
    const a = s0.angle || 0;
    const lx = -Math.sin(a);
    const ly = Math.cos(a);
    for (let i = -4; i <= 4; i++) {
      for (let j = 0; j < 2; j++) {
        const px = s0.x + lx * i * 10 + Math.cos(a) * (j * 10 - 5);
        const py = s0.y + ly * i * 10 + Math.sin(a) * (j * 10 - 5);
        ctx.fillStyle = ((i + j) & 1) ? '#f2f2f0' : '#121210';
        ctx.fillRect(px - 5, py - 5, 10, 10);
      }
    }
  }
  return c;
}

function clearContainer(c) {
  while (c.children.length) {
    const ch = c.removeChildAt(0);
    ch.destroy({ children: true });
  }
}

/**
 * @param {{ canvas: HTMLCanvasElement, host?: HTMLElement }} opts
 */
export async function createPixiRenderer(opts) {
  const gameCanvas = opts.canvas;
  const host = opts.host || gameCanvas.parentElement || document.getElementById('app');

  const app = new Application();
  let cssWidth = host.clientWidth || gameCanvas.clientWidth || 1280;
  let cssHeight = host.clientHeight || gameCanvas.clientHeight || 720;
  const dpr0 = Math.min(window.devicePixelRatio || 1, 2.5);

  await app.init({
    width: cssWidth,
    height: cssHeight,
    background: '#07080c',
    antialias: false,
    resolution: dpr0,
    autoDensity: true,
    preference: 'webgl',
    powerPreference: 'high-performance'
  });

  const view = app.canvas;
  view.id = 'pixi-game';
  view.setAttribute('aria-label', 'Radcars Pixi race view');
  view.style.cssText = 'display:block;position:relative;z-index:2;max-width:100%;max-height:100%;background:#050608';

  gameCanvas.classList.add('rad-pixi-hidden');
  gameCanvas.style.position = 'absolute';
  gameCanvas.style.opacity = '0';
  gameCanvas.style.pointerEvents = 'none';
  gameCanvas.style.zIndex = '1';

  if (gameCanvas.parentElement === host) host.insertBefore(view, gameCanvas);
  else host.appendChild(view);

  const skyLayer = new Container();
  const worldRoot = new Container();
  const groundLayer = new Container();
  const farLayer = new Container();
  const midLayer = new Container();
  const trackLayer = new Container();
  const nearLayer = new Container();
  const carsLayer = new Container();
  const fxLayer = new Container();
  const hudLayer = new Container();

  worldRoot.addChild(groundLayer, farLayer, midLayer, trackLayer, nearLayer, carsLayer, fxLayer);
  app.stage.addChild(skyLayer, worldRoot, hudLayer);

  const sceneryCache = createSceneryCache();
  const sprites = createSpriteBank();
  try { sprites.warm(CAR_COLORS); } catch (_) {}

  let dirtyTrack = true;
  let dirtyScenery = true;
  let bakedTrackId = null;
  let trackSprite = null;
  let lastSceneryKey = '';
  const carSprites = new Map();
  let countdownText = null;

  onPackReady(() => {
    try {
      sprites.invalidatePackCars();
      sprites.warm(CAR_COLORS);
    } catch (_) {}
    sceneryCache.clear();
    dirtyTrack = true;
    dirtyScenery = true;
  });

  function resize(cssW, cssH, dpr) {
    cssWidth = cssW;
    cssHeight = cssH;
    const res = dpr || Math.min(window.devicePixelRatio || 1, 2.5);
    app.renderer.resolution = res;
    app.renderer.resize(cssW, cssH);
  }

  function ensureTrack(track) {
    if (!track) return;
    if (!dirtyTrack && bakedTrackId === track.id && trackSprite) return;
    dirtyTrack = false;
    bakedTrackId = track.id;
    if (trackSprite) {
      trackLayer.removeChild(trackSprite);
      trackSprite.destroy();
      trackSprite = null;
    }
    const canvas = bakeTrackCanvas(track, 0.5);
    const tex = Texture.from(canvas);
    trackSprite = new Sprite(tex);
    trackSprite.width = track.width;
    trackSprite.height = track.height;
    trackLayer.addChild(trackSprite);
  }

  function fillLayer(container, items, cam, zoom, pad, visCap) {
    clearContainer(container);
    if (!items || !items.length) return;
    const zoomPad = zoom < 0.85 ? 220 : 0;
    const hw = (cssWidth * 0.5) / zoom + pad + zoomPad;
    const hh = (cssHeight * 0.5) / zoom + pad + zoomPad;
    const minX = cam.x - hw;
    const maxX = cam.x + hw;
    const minY = cam.y - hh;
    const maxY = cam.y + hh;
    const farZoom = zoom < 0.75;
    const cap = visCap > 0 ? visCap : 999;
    let drawn = 0;
    for (const it of items) {
      if (drawn >= cap) break;
      if (farZoom && it.kind === 'crowd') continue;
      const left = it.x - it.w * 0.5;
      const top = it.y - it.h;
      if (left + it.w < minX || left > maxX || top + it.h < minY || top > maxY) continue;
      if (it.kind === 'crowd') {
        const aspect = (it.img.width || 1) / Math.max(1, it.img.height || 1);
        if (aspect > 2.4 && it.h < 52) continue;
        if (it.h < 36) continue;
      }
      const tex = textureFrom(it.img);
      if (!tex) continue;
      const spr = new Sprite(tex);
      spr.anchor.set(0.5, 1);
      spr.x = it.x;
      spr.y = it.y;
      spr.width = it.w;
      spr.height = it.h;
      container.addChild(spr);
      drawn++;
    }
  }

  function syncScenery(track, cam, zoom) {
    const scenery = sceneryCache.get(track);
    if (!scenery) return null;
    const band = zoom < 0.7 ? 0 : zoom < 0.85 ? 1 : 2;
    const key = `${scenery.trackId}|${Math.round(cam.x / 80)}|${Math.round(cam.y / 80)}|${band}`;
    if (!dirtyScenery && key === lastSceneryKey && groundLayer.children.length) {
      return scenery;
    }
    dirtyScenery = false;
    lastSceneryKey = key;

    clearContainer(groundLayer);
    if (scenery.ground) {
      const g = scenery.ground;
      const margin = g._margin || 200;
      const scale = g._scale || 2;
      const tex = textureFrom(g);
      if (tex) {
        const spr = new Sprite(tex);
        spr.x = -margin;
        spr.y = -margin;
        spr.width = g.width * scale;
        spr.height = g.height * scale;
        let fade = 0.7;
        if (zoom < 0.7) fade = 0.55 + zoom * 0.4;
        else if (zoom < 1.05) fade = 0.70 + (zoom - 0.7) * 0.18;
        else if (zoom < 1.35) fade = 0.50;
        else fade = 0.46;
        spr.alpha = Math.max(0.48, Math.min(0.86, fade));
        groundLayer.addChild(spr);
      }
    } else {
      const gfx = new Graphics();
      gfx.rect(-400, -400, (track.width || 2900) + 800, (track.height || 2100) + 800);
      gfx.fill({ color: parseInt(String(track.bg || '#161410').replace('#', ''), 16) || 0x161410 });
      groundLayer.addChild(gfx);
    }

    fillLayer(farLayer, scenery.far, cam, zoom, 160, 10);
    fillLayer(midLayer, scenery.mid, cam, zoom, 120, 18);
    let nearItems = scenery.near;
    let nearCap = 12;
    if (zoom < 0.7) {
      nearItems = scenery.nearThin || scenery.near;
      nearCap = 5;
    } else if (zoom < 0.85) nearCap = 8;
    fillLayer(nearLayer, nearItems, cam, zoom, 80, nearCap);
    return scenery;
  }

  function drawSky(scenery, cam, track) {
    clearContainer(skyLayer);
    const W = cssWidth;
    const H = cssHeight;
    const theme = (scenery && scenery.theme) || {};
    const pack = getAssetPack();
    const packSky = pack && pack.ready && pack.skyline ? pack.skyline : null;
    const z = (cam && cam.zoom) || 1;
    const raceZoom = z >= 1.15;

    const top = parseInt(String(theme.skyTop || '#061018').replace('#', ''), 16) || 0x061018;
    const mid = parseInt(String(theme.skyMid || '#0c1a2c').replace('#', ''), 16) || 0x0c1a2c;
    const botCol = raceZoom ? 0x141210 : (parseInt(String(theme.ground || track.bg || '#161410').replace('#', ''), 16) || 0x161410);

    const gfx = new Graphics();
    gfx.rect(0, 0, W, H * 0.45).fill({ color: top });
    gfx.rect(0, H * 0.35, W, H * 0.35).fill({ color: mid });
    gfx.rect(0, H * 0.6, W, H * 0.4).fill({ color: botCol });
    skyLayer.addChild(gfx);

    if (packSky) {
      const tex = textureFrom(packSky);
      if (tex) {
        const parallax = 0.14;
        const scale = (W / packSky.width) * (raceZoom ? 1.12 : 1.18);
        const dw = packSky.width * scale;
        const dh = packSky.height * scale;
        const ox = (W - dw) * 0.5 - ((cam.x * parallax) % Math.max(1, dw * 0.12));
        const horizonY = H * (raceZoom ? 0.36 : 0.44);
        const buildingBase = raceZoom ? 0.72 : 0.80;
        let oy = horizonY - dh * buildingBase - (cam.y * parallax * 0.035);
        if (oy > -2) oy = -Math.max(4, H * 0.02);
        const spr = new Sprite(tex);
        spr.x = ox;
        spr.y = oy;
        spr.width = dw;
        spr.height = dh;
        skyLayer.addChild(spr);
      }
    } else if (scenery && scenery.skyline) {
      const img = scenery.skyline;
      const tex = textureFrom(img);
      if (tex) {
        const parallax = 0.15;
        const ox = -((cam.x * parallax) % img.width);
        const oy = H * 0.28 - (cam.y * parallax * 0.05);
        for (let i = -1; i <= 2; i++) {
          const s = new Sprite(tex);
          s.x = ox + i * img.width;
          s.y = oy;
          s.width = img.width;
          s.height = img.height * 0.85;
          s.alpha = 0.95;
          skyLayer.addChild(s);
        }
      }
    }
  }

  function syncCars(cars, zoom) {
    const live = new Set();
    for (const c of cars) {
      live.add(c);
      let spr = carSprites.get(c);
      if (!spr) {
        spr = new Sprite(Texture.EMPTY);
        spr.anchor.set(0.5, 0.5);
        carSprites.set(c, spr);
        carsLayer.addChild(spr);
      }
      const tier = Math.min(4, (c.engine | 0) + (c.ram | 0));
      const frames = sprites.getCarFrames(c.color, tier, !!c.isPlayer);
      const fi = sprites.carFrameIndex(c.angle);
      const img = frames && frames[fi];
      if (img) {
        const tex = textureFrom(img);
        if (tex && spr.texture !== tex) spr.texture = tex;
      }
      let drawW = 112;
      let drawH = 112;
      if (zoom != null && zoom < 1.1) {
        const bump = Math.min(1.22, 1.05 + (1.1 - zoom) * 0.4);
        drawW *= bump;
        drawH *= bump;
      }
      spr.x = c.x;
      spr.y = c.y;
      spr.width = drawW;
      spr.height = drawH;
      spr.alpha = c.dead ? 0.4 : 1;
      spr.visible = true;
    }
    for (const [c, spr] of [...carSprites.entries()]) {
      if (!live.has(c)) {
        carsLayer.removeChild(spr);
        spr.destroy();
        carSprites.delete(c);
      }
    }
  }

  function applyCamera(cam) {
    const zoom = cam.zoom || 1;
    const ox = Math.round(cam.x * zoom) / zoom;
    const oy = Math.round(cam.y * zoom) / zoom;
    worldRoot.position.set(cssWidth * 0.5, cssHeight * 0.5);
    worldRoot.scale.set(zoom);
    worldRoot.pivot.set(ox, oy);
  }

  function drawCountdown(text, opts = {}) {
    if (!text) {
      if (countdownText) countdownText.visible = false;
      return;
    }
    if (!countdownText) {
      countdownText = new Text({
        text: '',
        style: {
          fontFamily: 'Black Ops One, Impact, sans-serif',
          fontSize: 96,
          fill: 0x00e8ff,
          stroke: { color: 0xff2bd6, width: 4 },
          align: 'center'
        }
      });
      countdownText.anchor.set(0.5);
      hudLayer.addChild(countdownText);
    }
    countdownText.visible = true;
    countdownText.text = text;
    countdownText.x = cssWidth * 0.5;
    countdownText.y = cssHeight * 0.5;
    countdownText.style.fill = opts.flash ? 0xb8ff00 : 0x00e8ff;
  }

  function draw(world) {
    if (!world || !world.track) return;
    const { track, cars, cam } = world;
    const zoom = cam.zoom || 1;
    ensureTrack(track);
    const scenery = syncScenery(track, cam, zoom);
    drawSky(scenery, cam, track);
    applyCamera(cam);
    syncCars(cars || [], zoom);
    // fxLayer reserved (boom / nitro stub)
  }

  function destroy() {
    try {
      gameCanvas.classList.remove('rad-pixi-hidden');
      gameCanvas.style.opacity = '';
      gameCanvas.style.pointerEvents = '';
      gameCanvas.style.position = '';
      gameCanvas.style.zIndex = '';
    } catch (_) {}
    try { app.destroy(true, { children: true }); } catch (_) {}
  }

  try {
    window.__RAD_PIXI__ = { app, draw, resize, version: 'pixi-spike-v1' };
  } catch (_) {}

  return { draw, resize, drawCountdown, destroy, app, canvas: view };
}
