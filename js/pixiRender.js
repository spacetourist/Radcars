/**
 * v51 'toys-pixi': PixiJS v8 (WebGL) race renderer — the default since v51; the Canvas 2D renderer in render.js is
 * the fallback (?canvas=1, or automatically when WebGL / Pixi init fails).
 *
 * Lean by design (no scenery): the static road is built ONCE per track as a single textured strip mesh (a baked
 * cross-section texture: rim, kerbs, asphalt, worn band, neon glow + wall lines, centre dashes), so each road pixel
 * is filled once per frame; pads, grid boxes and the chequered line are small static Graphics. Fill rate, not JS,
 * is what limits weak / software GPUs (layered ribbons cost ~3× the frame time), and batches are capped to 4
 * textures for the same reason. The felt mat is static Graphics covering everything except the road (the infield
 * polygon + a big rect with the outer edge cut out), so mat + road fill each pixel about once. Each toy
 * car is a pre-rendered HD texture (js/toyart.js, mipmapped) drawn as a rotated Sprite with a soft shadow sprite.
 * Flames, glows, missiles, smoke and explosions use pre-baked textures on pooled sprites — no per-frame shadowBlur
 * and no per-frame tessellation. The minimap, BOOST / MISSILE panels and countdown stay on a transparent 2D overlay
 * (the existing render.js HUD code), so game.js and the HUD logic are unchanged.
 * Same API as createRenderer(): resize, draw, drawCountdown, drawBoostHud, drawWeaponHud, readPixels.
 */
import * as P from '../vendor/pixi-lean.mjs';
import { createRenderer, minimapBox } from './render.js';
import { CAR_LEN, CAR_WID } from './physics.js';
import { pointAt, buildStartingGrid } from './tracks.js';
import { TROPHY, trophyScale, ringState, partAlpha, trophyAnchor, outFade, PLACE_TEXT_Y } from './celebrate.js';
import { styleFor, carSprite, shadowSprite, textureTile, scaleBucket, SPRITE_W, SPRITE_H, TOY_FONT } from './toyart.js';

const KERB = 24, WALL = 12;
const hexNum = (h) => parseInt(h.slice(1), 16);

// bilinear within the nearest mip level: half the texture taps of trilinear, visually the same here (fill-bound GPUs)
const MIP_FILTER = typeof location !== 'undefined' && /[?&]mipl=1/.test(location.search) ? 'linear' : 'nearest';
function canvasTexture(cv, mip = true, repeat = false, mipFilter = MIP_FILTER) {
  const source = new P.CanvasSource({ resource: cv, autoGenerateMipmaps: mip, scaleMode: 'linear', mipmapFilter: mipFilter, addressMode: repeat ? 'repeat' : 'clamp-to-edge' });
  return new P.Texture({ source });
}
function bake(w, h, fn) {
  const cv = document.createElement('canvas'); cv.width = Math.ceil(w); cv.height = Math.ceil(h);
  fn(cv.getContext('2d'), cv.width, cv.height);
  return cv;
}

export async function createPixiRenderer(hudCanvas, app) {
  const glCanvas = document.createElement('canvas');
  glCanvas.id = 'pixi';
  glCanvas.setAttribute('aria-hidden', 'true');
  app.insertBefore(glCanvas, hudCanvas);
  const renderer = new P.WebGLRenderer();
  try {
    // own context: no depth buffer and no MSAA, so every frame clears / fills less memory (stencil kept: Pixi expects it)
    const q = location.search, attrs = { alpha: false, antialias: /[?&]aa=1/.test(q), depth: false, stencil: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
    const context = /[?&]ctx=0/.test(q) ? undefined : (glCanvas.getContext('webgl2', attrs) || glCanvas.getContext('webgl', attrs));
    if (!context && !/[?&]ctx=0/.test(q)) throw new Error('WebGL context unavailable');
    // v52 HD: resolution = min(devicePixelRatio, 2) with autoDensity (CSS size = logical px, backing store = device px)
    await renderer.init({ canvas: glCanvas, context, width: 2, height: 2, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true, antialias: attrs.antialias, background: 0x0c0c12, powerPreference: 'high-performance', preference: 'webgl' });
  } catch (e) { glCanvas.remove(); throw e; }
  // Pixi's batch shader picks the texture with an if-chain over every bound unit (16 on most GPUs); software GL
  // (SwiftShader) and weak mobile GPUs run that chain per fragment, so batches are capped to a few textures.
  renderer.limits.maxBatchableTextures = Math.min(renderer.limits.maxBatchableTextures, 4);
  // #game stays in the layout (game.js reads its size for the camera / aim) but empty and hidden; the HUD code draws
  // into a detached canvas whose changed rectangles become WebGL sprites (see the HUD section below)
  hudCanvas.classList.add('hud-overlay');
  hudCanvas.width = hudCanvas.height = 1;
  const hudCv = document.createElement('canvas');
  const hud = createRenderer(hudCv, { hud: true });
  let W = 2, H = 2, DPR = 1;

  // ------------------------------------------------------------------ shared baked textures
  const white = canvasTexture(bake(4, 4, (g) => { g.fillStyle = '#fff'; g.fillRect(0, 0, 4, 4); }), false);
  const softDot = canvasTexture(bake(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.6, 'rgba(255,255,255,0.7)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }));
  const disc = canvasTexture(bake(128, 128, (g) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 63, 0, Math.PI * 2); g.fill(); }));
  const ring = canvasTexture(bake(128, 128, (g) => { g.strokeStyle = '#fff'; g.lineWidth = 7; g.beginPath(); g.arc(64, 64, 59, 0, Math.PI * 2); g.stroke(); }));
  // exhaust flame (tail at the right edge, pointing -X), orange + green variants; 120 × 30 px for 60 × 15 units
  const flameTex = (outer, inner) => canvasTexture(bake(120, 30, (g) => {
    g.scale(2, 2); const L = 60, y = 7.5;
    g.fillStyle = outer; g.beginPath(); g.moveTo(L, y - 6.5); g.quadraticCurveTo(L * 0.45, y - 5, 0, y); g.quadraticCurveTo(L * 0.45, y + 5, L, y + 6.5); g.closePath(); g.fill();
    g.fillStyle = inner; g.beginPath(); g.moveTo(L, y - 3.5); g.quadraticCurveTo(L * 0.65, y - 2.5, L * 0.4, y); g.quadraticCurveTo(L * 0.65, y + 2.5, L, y + 3.5); g.closePath(); g.fill();
  }));
  const flameOrange = flameTex('rgba(255,90,20,0.9)', 'rgba(255,205,40,0.95)');
  const flameGreen = flameTex('rgba(57,255,20,0.92)', 'rgba(215,255,190,0.97)');
  const missileTex = canvasTexture(bake(120, 60, (g) => {
    g.translate(66, 30); g.scale(3, 3);
    g.fillStyle = 'rgba(255,150,40,0.9)'; g.beginPath(); g.moveTo(-12, -3); g.lineTo(-21, 0); g.lineTo(-12, 3); g.closePath(); g.fill();
    g.fillStyle = '#c9ccd6'; g.beginPath(); g.moveTo(-9, -3.5); g.lineTo(-14, -8); g.lineTo(-14, 8); g.lineTo(-9, 3.5); g.closePath(); g.fill();
    g.fillStyle = '#f4f4f8'; g.fillRect(-12, -3.5, 20, 7);
    g.fillStyle = '#ff2a2a'; g.beginPath(); g.moveTo(8, -3.5); g.quadraticCurveTo(15, -2, 16, 0); g.quadraticCurveTo(15, 2, 8, 3.5); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.4; g.strokeRect(-12, -3.5, 20, 7);
  }));
  const qTex = canvasTexture(bake(96, 96, (g) => {
    g.fillStyle = '#fff6c0'; g.font = `900 78px ${TOY_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 48, 52);
  }));
  const boxTex = canvasTexture(bake(128, 128, (g) => {
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    const h = 52; g.translate(64, 64);
    g.fillStyle = '#6a2cff'; rr(-h, -h, h * 2, h * 2, h * 0.28); g.fill();
    g.lineWidth = h * 0.16; g.strokeStyle = 'rgb(255,220,60)'; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = h * 0.06; rr(-h * 0.72, -h * 0.72, h * 1.44, h * 1.44, h * 0.18); g.stroke();
  }));
  const haloTex = canvasTexture(bake(200, 120, (g) => { // autopilot halo (fill) — rounded rect, soft edge
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    g.fillStyle = '#00e8ff'; rr(4, 4, 192, 112, 30); g.fill();
  }));
  const haloRingTex = canvasTexture(bake(200, 120, (g) => {
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    g.strokeStyle = '#00e8ff'; g.lineWidth = 6; rr(5, 5, 190, 110, 22); g.stroke();
  }));

  // ------------------------------------------------------------------ scene graph
  const stage = new P.Container();
  const world = new P.Container();
  const trackLayer = new P.Container();
  const bonusLayer = new P.Container();
  const trailLayer = new P.Container();
  const carLayer = new P.Container();
  const missileLayer = new P.Container();
  const fxLayer = new P.Container();
  world.addChild(trackLayer, bonusLayer, trailLayer, carLayer, missileLayer, fxLayer);
  // minimap lives in the WebGL scene (screen space), so the 2D HUD overlay only changes when a panel / countdown does
  const miniLayer = new P.Container();
  stage.addChild(world, miniLayer);
  try { window.__RAD_PIXI__ = { P, canvasTexture, renderer, stage, world, trackLayer, bonusLayer, carLayer, fxLayer }; } catch (_) {} // verification / profiling

  /** Pooled sprites: get() hands out the next one each frame, end() hides the rest. */
  function pool(layer, texture, anchor = 0.5) {
    const items = []; let n = 0;
    return {
      begin() { n = 0; },
      get(tex) { let s = items[n]; if (!s) { s = new P.Sprite(texture); s.anchor.set(anchor); layer.addChild(s); items.push(s); } if (tex && s.texture !== tex) s.texture = tex; s.visible = true; n++; return s; },
      end() { for (let i = n; i < items.length; i++) items[i].visible = false; }
    };
  }
  const trailPool = pool(trailLayer, softDot);
  const missilePool = pool(missileLayer, missileTex);
  const fxDiscPool = pool(fxLayer, disc);
  const fxRingPool = pool(fxLayer, ring);
  const fxRayPool = pool(fxLayer, white, 0);

  // ------------------------------------------------------------------ static track (built once per track + grid size)
  const trackCache = new WeakMap();
  let builtFor = null, builtN = -1;
  function pathPts(pts) { const a = []; for (const p of pts) a.push(p.x, p.y); return a; }
  function strokeLoop(g, flat, style) { g.poly(flat, true); g.stroke({ join: 'round', cap: 'round', ...style }); }
  /** Quads along the road between lateral offsets [a, b] for arc-length dashes (len on, gap off). */
  function dashQuads(g, track, a, b, len, gap, color, alpha = 1, phase = 0) {
    const L = track.length, step = 22;
    for (let s0 = phase; s0 < L; s0 += len + gap) {
      const s1 = Math.min(s0 + len, L), pts = [];
      const left = [], right = [];
      for (let s = s0; ; s += step) {
        const ss = Math.min(s, s1), p = pointAt(track, ss);
        left.push(p.x + p.nx * a, p.y + p.ny * a); right.push(p.x + p.nx * b, p.y + p.ny * b);
        if (ss >= s1) break;
      }
      for (let i = 0; i < left.length; i += 2) pts.push(left[i], left[i + 1]);
      for (let i = right.length - 2; i >= 0; i -= 2) pts.push(right[i], right[i + 1]);
      g.poly(pts, true).fill({ color, alpha });
    }
  }
  const ROAD_PERIOD = 256; // wu of road per texture repeat (kerb blocks 64/64 and centre dashes 50/78 both tile it)
  const roadEdge = (track) => track.halfW + WALL + 4; // half width of the strip (4 wu soft edge outside the rim)
  /** Cross-section texture for one track: x = lateral offset (−E…+E), y = arc length (0…256 wu, repeats). */
  function roadTexture(track) {
    const E = roadEdge(track), TW = 1024, TH = 512, kx = TW / (2 * E), ky = TH / ROAD_PERIOD, hw = track.halfW;
    const cv = bake(TW, TH, (g) => {
      g.setTransform(kx, 0, 0, ky, TW / 2, 0); // world units, lateral 0 at the centre
      const band = (a, style, alpha = 1) => { g.globalAlpha = alpha; g.fillStyle = style; g.fillRect(-a, 0, a * 2, ROAD_PERIOD); g.globalAlpha = 1; };
      const side = (a0, a1, style, alpha = 1) => { g.globalAlpha = alpha; g.fillStyle = style; g.fillRect(a0, 0, a1 - a0, ROAD_PERIOD); g.fillRect(-a1, 0, a1 - a0, ROAD_PERIOD); g.globalAlpha = 1; };
      // soft outer edge (anti-aliased by texture filtering) + piece rim
      const edge = g.createLinearGradient(-E, 0, E, 0), f = 4 / (2 * E);
      edge.addColorStop(0, 'rgba(11,12,16,0)'); edge.addColorStop(f, 'rgba(11,12,16,1)'); edge.addColorStop(1 - f, 'rgba(11,12,16,1)'); edge.addColorStop(1, 'rgba(11,12,16,0)');
      g.fillStyle = edge; g.fillRect(-E, 0, 2 * E, ROAD_PERIOD);
      band(hw + WALL - 3, '#23262e');
      band(hw, '#e02020');
      g.fillStyle = '#e8e8e8'; for (let y = 0; y < ROAD_PERIOD; y += 128) g.fillRect(-hw, y, hw * 2, 64);
      band(hw - 3, '#ffffff', 0.14);
      band(hw - KERB + 5, '#000000', 0.42);
      g.save(); g.beginPath(); g.rect(-(hw - KERB), 0, 2 * (hw - KERB), ROAD_PERIOD); g.clip();
      const pat = g.createPattern(textureTile('asphalt', track.asphalt, 256), 'repeat');
      g.fillStyle = pat; g.fillRect(-hw, 0, hw * 2, ROAD_PERIOD); g.restore();
      band(hw * 0.5, '#ffffff', 0.025); band(hw * 0.28, '#ffffff', 0.025);
      side(hw - 17, hw + 17, track.wall, 0.18); side(hw - 3, hw + 3, track.wall); // v52: wider 18% neon glow under the edge line
      g.globalAlpha = 0.14; g.fillStyle = '#ffffff'; for (let y = 0; y < ROAD_PERIOD; y += 128) g.fillRect(-3, y, 6, 50); g.globalAlpha = 1;
    });
    return canvasTexture(cv, true, true);
  }
  /** Quad strip along the centreline between lateral offsets a..b, v running in whole texture periods. */
  function strip(track, a, b, texture, u0 = 0, u1 = 1) {
    const pts = track.pts, n = pts.length, cycles = Math.max(1, Math.round(track.length / ROAD_PERIOD));
    const vert = new Float32Array((n + 1) * 4), uv = new Float32Array((n + 1) * 4), idx = new Uint32Array(n * 6);
    for (let i = 0; i <= n; i++) {
      const p = pts[i % n], v = i === n ? cycles : (p.s ?? (i * track.length / n)) / track.length * cycles;
      vert[i * 4] = p.x + p.nx * a; vert[i * 4 + 1] = p.y + p.ny * a; vert[i * 4 + 2] = p.x + p.nx * b; vert[i * 4 + 3] = p.y + p.ny * b;
      uv[i * 4] = u0; uv[i * 4 + 1] = v; uv[i * 4 + 2] = u1; uv[i * 4 + 3] = v;
      if (i < n) { const k = i * 2; idx.set([k, k + 1, k + 2, k + 1, k + 3, k + 2], i * 6); }
    }
    return new P.MeshSimple({ texture, vertices: vert, uvs: uv, indices: idx });
  }
  function roadStrip(track, texture) { const E = roadEdge(track); return strip(track, E, -E, texture); }
  // shadow: only the outer bands can show past the piece (offset 9,13), so two thin strips instead of a full ribbon
  const shadowTex = canvasTexture(bake(64, 4, (g) => { const gr = g.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, 'rgba(0,0,0,0.32)'); gr.addColorStop(0.8, 'rgba(0,0,0,0.32)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 4); }), false);
  function shadowStrip(track, sgn) {
    const o = track.halfW + WALL + 5, m = strip(track, sgn * (o - 18), sgn * (o + 4), shadowTex);
    m.position.set(9, 13);
    return m;
  }
  /** Felt play-mat everywhere EXCEPT under the road (the infield polygon + a big rect with the outer edge cut out),
   *  so ground and road together fill each screen pixel about once. World-anchored 512 wu felt tile. */
  function feltAround(track, felt) {
    const off = roadEdge(track) - 4, A = [], B = [];
    for (const p of track.pts) { A.push(p.x + p.nx * off, p.y + p.ny * off); B.push(p.x - p.nx * off, p.y - p.ny * off); }
    const area = (f) => { let a = 0; for (let i = 0, n = f.length; i < n; i += 2) { const j = (i + 2) % n; a += f[i] * f[j + 1] - f[j] * f[i + 1]; } return Math.abs(a / 2); };
    const [inner, outer] = area(A) < area(B) ? [A, B] : [B, A];
    // one non-batched mesh (Pixi's batch shader is several times dearer per pixel than the mesh shader on
    // software / weak GPUs): earcut the big rect with the outer edge as a hole, plus the infield polygon
    const bd = track.bounds, m = 6000, x0 = bd.minX - m, y0 = bd.minY - m, x1 = bd.maxX + m, y1 = bd.maxY + m;
    const ring = [x0, y0, x1, y0, x1, y1, x0, y1, ...outer];
    const t1 = P.earcut(ring, [4]), t2 = P.earcut(inner);
    const vert = new Float32Array(ring.length + inner.length);
    vert.set(ring); vert.set(inner, ring.length);
    const idx = new Uint32Array(t1.length + t2.length);
    idx.set(t1); const base = ring.length / 2; for (let i = 0; i < t2.length; i++) idx[t1.length + i] = t2[i] + base;
    const uv = new Float32Array(vert.length);
    for (let i = 0; i < vert.length; i++) uv[i] = vert[i] / 512; // 512 wu felt tile, world-anchored (as render.js)
    return new P.MeshSimple({ texture: felt, vertices: vert, uvs: uv, indices: idx });
  }
  function buildTrack(track, nCars) {
    trackLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const w = track.halfW * 2, C = pathPts(track.pts), Lw = pathPts(track.left), Rw = pathPts(track.right);
    let tex = trackCache.get(track);
    if (!tex) {
      const felt = canvasTexture(textureTile('felt', track.ground, 256), true, true);
      const asphalt = canvasTexture(textureTile('asphalt', track.asphalt, 256), true, true);
      tex = { felt, asphalt };
      trackCache.set(track, tex);
    }
    // The whole road (rim, kerbs, asphalt, worn band, neon glow + wall lines, centre dashes) is ONE textured strip:
    // a baked cross-section texture (lateral = x, 256 wu of road = y, repeating) on a mesh along the centreline,
    // so every road pixel is filled once per frame instead of once per layer. Raised-piece shadow = two thin strips.
    if (!tex.road) tex.road = roadTexture(track);
    trackLayer.addChild(feltAround(track, tex.felt), shadowStrip(track, -1), shadowStrip(track, 1), roadStrip(track, tex.road));
    renderer.background.color = hexNum(track.ground);
    // boost pads
    for (const pad of track.pads || []) {
      const hw = pad.halfW, L = pad.len, pg = new P.Graphics();
      pg.position.set(pad.x, pad.y); pg.rotation = pad.angle;
      pg.rect(0, -hw, L, hw * 2).fill({ color: 0xffb000, alpha: 0.16 }).stroke({ width: 3, color: 0xffb000, alpha: 0.55 });
      const cw = Math.min(26, L / 5), tip = Math.min(42, hw * 0.5);
      for (const x0 of [L * 0.12, L * 0.42, L * 0.72]) pg.poly([x0, -hw * 0.82, x0 + tip, 0, x0, hw * 0.82, x0 - cw, hw * 0.82, x0 + tip - cw, 0, x0 - cw, -hw * 0.82], true).fill({ color: 0xffb000, alpha: 0.8 });
      trackLayer.addChild(pg);
    }
    // painted grid boxes
    if (nCars) {
      const gg = new P.Graphics();
      for (const slot of buildStartingGrid(track, nCars)) {
        const c = Math.cos(slot.angle), sn = Math.sin(slot.angle);
        const Pt = (lx, ly) => [slot.x + c * lx - sn * ly, slot.y + sn * lx + c * ly];
        const a2 = Pt(-CAR_LEN * 0.35, -CAR_WID * 0.95), a = Pt(CAR_LEN * 0.62, -CAR_WID * 0.95), b = Pt(CAR_LEN * 0.62, CAR_WID * 0.95), b2 = Pt(-CAR_LEN * 0.35, CAR_WID * 0.95);
        gg.moveTo(a2[0], a2[1]).lineTo(a[0], a[1]).lineTo(b[0], b[1]).lineTo(b2[0], b2[1]);
      }
      gg.stroke({ width: 4, color: 0xffffff, alpha: 0.32, join: 'miter', cap: 'butt' });
      trackLayer.addChild(gg);
    }
    // start / finish chequer
    const p0 = pointAt(track, 0), sl = new P.Graphics();
    sl.position.set(p0.x, p0.y); sl.rotation = Math.atan2(p0.ty, p0.tx);
    const half = track.halfW - KERB, sq = 16, rows = Math.ceil((half * 2) / sq);
    for (let r = 0; r < rows; r++) for (let c = 0; c < 3; c++) sl.rect(-sq * 1.5 + c * sq, -half + r * sq, sq, Math.min(sq, half * 2 - r * sq)).fill((r + c) % 2 ? 0x111111 : 0xffffff);
    trackLayer.addChild(sl);
    // bonus boxes
    bonusLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    boxes = [];
    const bon = track.bonus;
    if (bon) for (const box of bon.boxes) {
      const cont = new P.Container(); cont.position.set(box.x, box.y);
      const glow = new P.Sprite(softDot); glow.anchor.set(0.5); glow.tint = 0xffd63c;
      const body = new P.Sprite(boxTex); body.anchor.set(0.5);
      const q = new P.Sprite(qTex); q.anchor.set(0.5);
      cont.addChild(glow, body, q); bonusLayer.addChild(cont);
      boxes.push({ box, cont, glow, body, q });
    }
    builtFor = track; builtN = nCars;
  }
  let boxes = [];

  // ------------------------------------------------------------------ cars
  const carViews = new Map(); // car object → view
  let carsFor = null;
  const carTexCache = new Map();
  function carTextures(car, R) {
    const st = car._toy || (car._toy = styleFor(car));
    const key = `${car.id}|${car.color}|${car.isPlayer}|${R}`;
    let t = carTexCache.get(key);
    if (!t) {
      const body = carSprite(st, car.color, car.isPlayer, R), sh = shadowSprite(st.variant, R);
      // v52 HD: cars are supersampled (see buildCars) and minified through the mip chain with trilinear filtering
      t = { body: canvasTexture(body, true, false, 'linear'), shadow: canvasTexture(sh, true, false, 'linear'), w: body.width, h: body.height, R, variant: st.variant };
      carTexCache.set(key, t);
    }
    return t;
  }
  function makeMarker() {
    const g = new P.Graphics();
    g.poly([-9, -12, 9, -12, 0, 0], true).fill(0xffffff).stroke({ width: 1.5, color: 0x000000, alpha: 0.5 });
    return g;
  }
  function buildCars(cars) {
    carLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    carViews.clear();
    // v52 HD: 2× the on-screen size at the closest race zoom (0.95) at this devicePixelRatio, so even the grid / finish
    // close-ups minify a sharper texture (before: 1×, and the far chase zoom fell to a soft mip level)
    const R = scaleBucket(2 * 0.95 * DPR);
    const order = [...cars.filter((c) => !c.isPlayer), ...cars.filter((c) => c.isPlayer)];
    for (const car of order) {
      const t = carTextures(car, R);
      const v = { t, root: new P.Container() };
      v.flame = new P.Container();
      v.streaks = [0, 1, 2, 3].map(() => { const s = new P.Sprite(white); s.anchor.set(1, 0.5); v.flame.addChild(s); return s; });
      v.flames = [0, 1].map(() => { const s = new P.Sprite(flameOrange); s.anchor.set(1, 0.5); v.flame.addChild(s); return s; });
      v.shadow = new P.Sprite(t.shadow); v.shadow.anchor.set((SPRITE_W * R / 2) / t.w, (SPRITE_H * R / 2) / t.h);
      v.body = new P.Sprite(t.body); v.body.anchor.set((SPRITE_W * R / 2) / t.w, (SPRITE_H * R / 2) / t.h);
      if (car.isPlayer) {
        v.haloUnder = new P.Sprite(haloTex); v.haloUnder.anchor.set(0.5);
        v.haloOver = new P.Sprite(haloRingTex); v.haloOver.anchor.set(0.5);
        v.marker = makeMarker();
        // v53 brake lights: two red glows + hot cores at the tail while BRAKE is held
        v.brakes = [0, 1, 2, 3].map((i) => { const d = new P.Sprite(disc); d.anchor.set(0.5); d.tint = i < 2 ? 0xff2020 : 0xffd0d0; d.visible = false; return d; });
        v.root.addChild(v.haloUnder, v.shadow, v.flame, v.body, ...v.brakes, v.haloOver, v.marker);
      } else v.root.addChild(v.shadow, v.flame, v.body);
      carLayer.addChild(v.root);
      carViews.set(car, v);
    }
    carsFor = cars;
  }

  function updateCar(car, v, zoom, tMs, world, debugCars) {
    const s = Math.max(1, 34 / (CAR_LEN * zoom));
    const L = CAR_LEN * s, Wd = CAR_WID * 0.88 * s, hl = L / 2, hw = Wd / 2;
    const ang = car.angle + (car.spinVis || 0);
    const k = s / v.t.R;
    v.shadow.position.set(car.x + 3.5 * s, car.y + 5 * s); v.shadow.rotation = ang; v.shadow.scale.set(k);
    v.body.position.set(car.x, car.y); v.body.rotation = ang; v.body.scale.set(k);
    // boost flame (same sizes / flicker as the Canvas version; hidden while spinning)
    const lvl = car.boostLevel || 0;
    if (lvl > 0.02 && !(car.spinMs > 0)) {
      const t = tMs + (car.isPlayer ? 0 : car.id * 97);
      const fl = 0.85 + 0.15 * Math.sin(t * 0.047) + 0.08 * Math.sin(t * 0.113);
      const len = (26 + 34 * lvl) * s * fl, green = !!car.boostGreen;
      v.flame.visible = true; v.flame.alpha = Math.min(1, lvl * 1.4);
      v.flame.position.set(car.x, car.y); v.flame.rotation = car.angle;
      v.flames.forEach((f, i) => { f.texture = green ? flameGreen : flameOrange; f.position.set(-hl + 2 * s, (i ? 1 : -1) * hw * 0.42); f.scale.set((len + 2 * s) / 120, s / 2); });
      const lines = [[-hw * 1.35, 1], [hw * 1.35, 0.8], [-hw * 0.7, 0.55], [hw * 0.7, 0.65]];
      v.streaks.forEach((st, i) => {
        const [dy, kk] = lines[i], ph = ((t * 0.004 + kk * 3.1) % 1);
        const x0 = -hl - 10 * s - ph * 30 * s, ln = (30 + 40 * kk) * s * lvl;
        st.position.set(x0, dy); st.width = ln; st.height = 2.2 * s; st.tint = green ? 0x78ff6e : 0xffbe5a; st.alpha = 0.58;
      });
    } else v.flame.visible = false;
    if (v.brakes) {
      const on = !!car.braking, ca = Math.cos(ang), sa = Math.sin(ang);
      v.brakes.forEach((d, i) => {
        d.visible = on; if (!on) return;
        const side = (i % 2 ? 1 : -1) * hw * 0.62, bx = -hl + 3 * s, r = (i < 2 ? 9 : 3.2) * s;
        d.position.set(car.x + ca * bx - sa * side, car.y + sa * bx + ca * side); d.width = d.height = r * 2; d.alpha = i < 2 ? 0.55 : 1;
      });
    }
    if (v.marker) {
      v.marker.position.set(car.x, car.y - (hl + 22 * s)); v.marker.scale.set(s);
      const ap = world.power && world.power.active === 'autopilot';
      v.haloUnder.visible = v.haloOver.visible = !!ap;
      if (ap) {
        const left = world.power.activeMs, pulse = 0.5 + 0.5 * Math.sin(tMs * 0.012);
        const fade = left < 1500 ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(tMs * 0.03)) : 1;
        for (const [h, m, a] of [[v.haloUnder, 12, 0.22 * fade], [v.haloOver, 6, (0.65 + 0.35 * pulse) * fade]]) {
          h.position.set(car.x, car.y); h.rotation = car.angle; h.alpha = a;
          h.width = (hl + m * s) * 2 * (200 / 192); h.height = (hw + m * s) * 2 * (120 / 112);
        }
      }
    }
    if (debugCars) {
      // screen-space (device px) images of the local length axis (+X, nose) and width axis (+Y), as in render.js
      const z = zoom * DPR, ca = Math.cos(ang), sa = Math.sin(ang), cam = world.cam;
      debugCars.push({ id: car.id, isPlayer: car.isPlayer, x: car.x, y: car.y, vx: car.vx, vy: car.vy, angle: car.angle, L, W: Wd,
        spinning: car.spinMs > 0, spinVis: car.spinVis || 0, variant: v.t.variant,
        lenAxis: { x: ca * hl * z, y: sa * hl * z }, widAxis: { x: -sa * hw * z, y: ca * hw * z },
        origin: { x: (W / 2 + (car.x - cam.x) * zoom) * DPR, y: (H / 2 + (car.y - cam.y) * zoom) * DPR } });
    }
  }

  // ------------------------------------------------------------------ per frame
  function drawBonus(world, zoom) {
    const b = world.track.bonus;
    if (!b) return;
    const taken = (world.power && world.power.collected) || [];
    const tm = (world.race.time || 0) + (world.race.countdown > 0 ? (3800 - world.race.countdown) : 0);
    const s = Math.max(1, 20 / (b.half * 2 * zoom));
    for (const v of boxes) {
      const i = v.box.i;
      v.cont.visible = !taken[i];
      if (!v.cont.visible) continue;
      const h = b.half * s, pulse = 0.5 + 0.5 * Math.sin(tm * 0.006 + i * 1.7);
      v.glow.width = v.glow.height = h * 3.9; v.glow.alpha = 0.3 + 0.28 * pulse;
      v.body.rotation = b.angle + 0.35 * Math.sin(tm * 0.0032 + i); v.body.width = v.body.height = h * 2 * (128 / 104);
      v.q.width = v.q.height = h * 1.9;
    }
  }
  function drawTrailsMissilesFx(world, zoom) {
    trailPool.begin(); missilePool.begin(); fxDiscPool.begin(); fxRingPool.begin(); fxRayPool.begin();
    const ms = Math.max(1, 18 / (26 * zoom));
    for (const m of world.missiles || []) {
      for (const t of m.trail) {
        const k = t.ms / 650, sp = trailPool.get();
        sp.position.set(t.x, t.y); sp.tint = 0xd2d4dc; sp.alpha = 0.55 * (1 - k); sp.width = sp.height = (4 + 14 * k) * ms * 2.4;
      }
      if (!m.dead) { const sp = missilePool.get(); sp.position.set(m.x, m.y); sp.rotation = m.angle; sp.scale.set(ms / 3); sp.anchor.set(66 / 120, 0.5); }
    }
    const s = Math.max(1, 34 / (64 * zoom));
    const discAt = (x, y, r, tint, a) => { if (a <= 0) return; const d = fxDiscPool.get(); d.position.set(x, y); d.width = d.height = r * 2; d.tint = tint; d.alpha = a; };
    for (const f of world.fx || []) {
      const k = f.ms / f.max;
      if (f.kind === 'bonus') {
        const rg = fxRingPool.get(); rg.position.set(f.x, f.y); rg.width = rg.height = (18 + 50 * k) * s * 2; rg.tint = 0xffe65a; rg.alpha = 1 - k;
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + k * 2, r = (14 + 60 * k) * s; discAt(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, 4 * s * (1 - k), 0xffffff, Math.max(0, 0.9 - k * 1.4)); }
      } else if (f.big) {
        discAt(f.x, f.y, (26 + 60 * k) * s, 0x787880, 0.5 * (1 - k));
        discAt(f.x, f.y, (16 + 40 * Math.sqrt(k)) * s, 0xff7814, 0.95 * (1 - k));
        discAt(f.x, f.y, (10 + 22 * Math.sqrt(k)) * s, 0xffec78, Math.max(0, 1 - k * 1.6));
        const ra = Math.max(0, 0.8 - k);
        if (ra > 0) for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4 + 0.3, r0 = (20 + 30 * k) * s, r1 = (34 + 60 * k) * s, ray = fxRayPool.get();
          ray.anchor.set(0, 0.5); ray.position.set(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0); ray.rotation = a; ray.width = r1 - r0; ray.height = 3 * s; ray.tint = 0xffffff; ray.alpha = ra;
        }
      } else {
        discAt(f.x, f.y, (8 + 26 * k) * s, 0xc8c8d0, 0.7 * (1 - k));
        discAt(f.x, f.y, (5 + 10 * k) * s, 0xff9628, Math.max(0, 0.8 - k * 1.5));
      }
    }
    trailPool.end(); missilePool.end(); fxDiscPool.end(); fxRingPool.end(); fxRayPool.end();
  }

  // ------------------------------------------------------------------ minimap (same look/position as render.js)
  let miniFor = null, miniKey = '', miniMap = null;
  const miniDots = pool(miniLayer, disc);
  function buildMinimap(track) {
    const m = minimapBox(track, W, H);
    miniLayer.children.filter((c) => c instanceof P.Graphics).forEach((c) => { miniLayer.removeChild(c); c.destroy(); });
    const g = new P.Graphics();
    g.roundRect(m.bx, m.by, m.bw, m.bh, 12).fill({ color: 0x0a1022, alpha: 0.62 }).stroke({ width: 2, color: 0x00e8ff, alpha: 0.85 });
    const flat = [];
    for (const p of track.pts) flat.push(m.ox + p.x * m.sc, m.oy + p.y * m.sc);
    g.poly(flat, true).stroke({ width: Math.max(track.halfW * 1.2 * m.sc, 3), color: 0xffffff, alpha: 0.55, join: 'round' });
    miniLayer.addChildAt(g, 0);
    miniMap = { ox: m.ox, oy: m.oy, sc: m.sc };
    miniFor = track; miniKey = W + 'x' + H + ':' + m.key;
  }
  function drawMinimap(wd) {
    if (miniFor !== wd.track || miniKey !== W + 'x' + H + ':' + minimapBox(wd.track, W, H).key) buildMinimap(wd.track);
    miniDots.begin();
    for (const c of wd.cars) {
      const d = miniDots.get(), r = c.isPlayer ? 6 : 4;
      d.position.set(miniMap.ox + c.x * miniMap.sc, miniMap.oy + c.y * miniMap.sc); d.width = d.height = r * 2; d.tint = hexNum(c.color);
    }
    miniDots.end();
  }

  // ------------------------------------------------------------------ 2D HUD panels / countdown, as WebGL sprites
  // The existing render.js HUD code still draws them (into the #game canvas, which is kept in layout but hidden: a
  // full-screen transparent overlay costs ~15% fps in compositing on software / weak GPUs). game.js calls
  // drawWeaponHud / drawCountdown every frame; each call is skipped when its inputs are unchanged, and when they do
  // change only that rectangle is redrawn, copied to a small canvas and uploaded as the texture of a screen sprite.
  const hctx = hud.ctx;
  const hudLayer = new P.Container();
  stage.addChild(hudLayer);
  const hudSlot = () => ({ key: null, ret: null, rect: null, used: false, cv: null, tex: null, sprite: null });
  const wSlot = hudSlot(), cSlot = hudSlot();
  const clearRect = (r) => { if (!r) return; hctx.setTransform(DPR, 0, 0, DPR, 0, 0); hctx.clearRect(r.x, r.y, r.w, r.h); };
  function blit(sl) {
    if (!sl.rect) { if (sl.sprite) sl.sprite.visible = false; return; }
    const d = DPR, cw = hudCv.width, ch = hudCv.height;
    const sx = Math.max(0, Math.floor(sl.rect.x * d)), sy = Math.max(0, Math.floor(sl.rect.y * d));
    const pw = Math.min(cw, Math.ceil((sl.rect.x + sl.rect.w) * d)) - sx, ph = Math.min(ch, Math.ceil((sl.rect.y + sl.rect.h) * d)) - sy;
    if (pw <= 0 || ph <= 0) { if (sl.sprite) sl.sprite.visible = false; return; }
    if (!sl.cv || sl.cv.width !== pw || sl.cv.height !== ph) {
      if (sl.tex) sl.tex.destroy(true);
      sl.cv = document.createElement('canvas'); sl.cv.width = pw; sl.cv.height = ph;
      sl.tex = canvasTexture(sl.cv, false);
      if (!sl.sprite) { sl.sprite = new P.Sprite(sl.tex); hudLayer.addChild(sl.sprite); } else sl.sprite.texture = sl.tex;
    }
    const g = sl.cv.getContext('2d');
    g.clearRect(0, 0, pw, ph);
    g.drawImage(hudCv, sx, sy, pw, ph, 0, 0, pw, ph);
    sl.tex.source.update();
    sl.sprite.position.set(sx / d, sy / d); sl.sprite.width = pw / d; sl.sprite.height = ph / d; sl.sprite.visible = true;
  }
  function hudFrameStart() {
    for (const sl of [wSlot, cSlot]) { if (!sl.used && sl.rect) { clearRect(sl.rect); sl.rect = null; sl.key = null; blit(sl); } sl.used = false; }
  }
  function drawWeaponHud(b, ms, anchor, countdown) {
    wSlot.used = true;
    const key = JSON.stringify([b, ms, anchor, countdown, W, H, DPR]);
    if (key === wSlot.key) return wSlot.ret;
    clearRect(wSlot.rect);
    wSlot.key = key;
    const ret = hud.drawWeaponHud(b, ms, anchor, countdown);
    wSlot.ret = ret;
    if (ret) {
      const bx = [ret.boost, ret.missile].filter(Boolean);
      const x0 = Math.min(...bx.map((q) => q.x)), y0 = Math.min(...bx.map((q) => q.y)), x1 = Math.max(...bx.map((q) => q.x + q.w)), y1 = Math.max(...bx.map((q) => q.y + q.h));
      wSlot.rect = { x: x0 - 8, y: y0 - 8, w: x1 - x0 + 16, h: y1 - y0 + 18 };
    } else wSlot.rect = null;
    blit(wSlot);
    return ret;
  }
  function drawCountdown(text) {
    cSlot.used = true;
    const key = text + W + 'x' + H;
    if (key === cSlot.key) return;
    clearRect(cSlot.rect);
    cSlot.key = key;
    hud.drawCountdown(text);
    const r = Math.min(W, H) * 0.12 * 1.6;
    cSlot.rect = { x: W / 2 - r, y: H * 0.27 - r, w: r * 2, h: r * 2 + 8 };
    blit(cSlot);
  }

  // ------------------------------------------------------------------ v52 finish celebration (screen space, CSS px)
  // Confetti = pooled tinted quads, the trophy is a Graphics built once from celebrate.js's TROPHY spec, the light
  // burst is a Graphics sunburst + soft glow, the podium ring a tinted ring sprite. The place text itself is DOM (ui.js).
  const celebLayer = new P.Container();
  stage.addChildAt(celebLayer, stage.children.indexOf(miniLayer) + 1);
  const confPool = pool(celebLayer, white);
  const ringSpr = new P.Sprite(ring); ringSpr.anchor.set(0.5); ringSpr.visible = false;
  const trophyRoot = new P.Container(); trophyRoot.visible = false;
  const glowSpr = new P.Sprite(softDot); glowSpr.anchor.set(0.5); glowSpr.tint = 0xffd34d;
  const rays = new P.Graphics();
  for (let i = 0; i < 14; i++) { const a0 = (i / 14) * Math.PI * 2, a1 = a0 + Math.PI / 14; rays.poly([0, 0, Math.cos(a0) * 100, Math.sin(a0) * 100, Math.cos(a1) * 100, Math.sin(a1) * 100], true).fill({ color: 0xfff0a0, alpha: 0.32 }); }
  const trophyG = new P.Graphics();
  for (const sh of TROPHY) {
    if (sh.k === 'poly') trophyG.poly(sh.pts, true);
    else if (sh.k === 'rect') trophyG.roundRect(sh.x, sh.y, sh.w, sh.h, sh.r || 0);
    else trophyG.circle(sh.x, sh.y, sh.r);
    trophyG.fill({ color: hexNum(sh.fill), alpha: sh.alpha ?? 1 });
    if (sh.stroke) trophyG.stroke({ width: 2.5, color: hexNum(sh.stroke), alpha: 0.9, join: 'round' });
  }
  trophyRoot.addChild(glowSpr, rays, trophyG);
  celebLayer.addChild(ringSpr, trophyRoot);
  function drawCelebration(c) {
    confPool.begin();
    ringSpr.visible = trophyRoot.visible = false;
    if (c) {
      const t = c.t, cx = W / 2, cy = H / 2, u = H, fade = outFade(c);
      celebLayer.alpha = 1; ringSpr.alpha = trophyRoot.alpha = fade;
      if (c.tier.ring) {
        const r = ringState(t);
        if (r.alpha > 0) { ringSpr.visible = true; ringSpr.position.set(cx, cy + PLACE_TEXT_Y * u); ringSpr.width = ringSpr.height = (0.2 + 0.9 * r.k) * u; ringSpr.tint = hexNum(c.tier.color); ringSpr.alpha = r.alpha * fade; }
      }
      if (c.tier.trophy) {
        const k = trophyScale(t), an = trophyAnchor(c.aspect);
        if (k > 0 && fade > 0) {
          const px = an.size * u / 120;
          trophyRoot.visible = true; trophyRoot.position.set(cx + an.x * u, cy + an.y * u);
          trophyG.scale.set(px * k); trophyG.rotation = 0.06 * Math.sin(t / 420);
          rays.visible = !!c.tier.rays; rays.rotation = t / 2600; rays.scale.set(px * 1.25 * Math.min(1, k));
          glowSpr.width = glowSpr.height = 190 * px * Math.min(1, k); glowSpr.alpha = 0.55 + 0.2 * Math.sin(t / 300);
        }
      }
      for (const p of c.parts) {
        const sp = confPool.get(), a = partAlpha(p);
        sp.position.set(cx + p.x * u, cy + p.y * u); sp.rotation = p.rot;
        sp.width = p.w * u; sp.height = Math.max(0.6, Math.abs(Math.cos(p.flip)) * p.h * u);
        sp.tint = hexNum(p.col); sp.alpha = a;
      }
    }
    confPool.end();
  }

  function draw(wd) {
    const { track, cars, cam } = wd;
    if (builtFor !== track || builtN !== cars.length) buildTrack(track, cars.length);
    if (carsFor !== cars) buildCars(cars);
    hudFrameStart();
    const debugCars = (typeof window !== 'undefined' && window.__RAD_DEBUG__) ? [] : null;
    const z = cam.zoom;
    world.position.set(W / 2, H / 2); world.scale.set(z); world.pivot.set(cam.x, cam.y);
    drawBonus(wd, z);
    const tMs = wd.race.time;
    for (const car of cars) { const v = carViews.get(car); if (v) updateCar(car, v, z, tMs, wd, debugCars); }
    drawTrailsMissilesFx(wd, z);
    miniLayer.visible = !wd.finish; // v52: a clean frame for the finish reveal
    if (!wd.finish) drawMinimap(wd);
    drawCelebration(wd.finish && wd.finish.cele);
    renderer.render(stage);
    if (debugCars) window.__RAD_DEBUG__.frame = { cars: debugCars, cam: { ...cam }, W, H, DPR, renderer: 'pixi' };
  }

  function resize(w, h, dpr) {
    W = w; H = h; DPR = dpr;
    renderer.resize(w, h, dpr);
    glCanvas.style.width = w + 'px'; glCanvas.style.height = h + 'px';
    hud.resize(w, h, dpr);
    hudCanvas.style.width = w + 'px'; hudCanvas.style.height = h + 'px';
    for (const sl of [wSlot, cSlot]) { sl.key = null; sl.rect = null; if (sl.sprite) sl.sprite.visible = false; } // the HUD canvas was cleared by the resize
    carsFor = null; // rebuild car textures at the new devicePixelRatio
  }

  /** Verification: device-px RGBA of the WebGL race view (re-renders the current stage so the buffer is intact). */
  const readCv = document.createElement('canvas');
  function readPixels(x, y, w, h) {
    renderer.render(stage);
    readCv.width = w; readCv.height = h;
    const g = readCv.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, w, h);
    g.drawImage(glCanvas, x, y, w, h, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  }

  return { kind: 'pixi', resize, draw, drawCountdown, drawBoostHud: hud.drawBoostHud, drawWeaponHud, readPixels, ctx: hud.ctx, pixi: renderer };
}
