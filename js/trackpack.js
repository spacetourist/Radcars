/**
 * Track-edge pack PROTOTYPE (GD night-circuit pack, assets/track/). Pixi only, behind ?trackpack=1, Gridlock only.
 * Loaded with a dynamic import from pixiRender.js only when the flag is set, so default play never touches it.
 *  - ground: GD grass on a ground mesh like feltAround(), but its holes follow the OPAQUE parts of the edge strips
 *    (outer: up to the armco at 250 wu, inner: the solid gravel at 44 wu), so ground + strips fill each pixel ~once
 *    (the outer strip's transparent grass gap gets the grass composited into the strip texture at load time)
 *  - asphalt-tile: multiplied into the baked road cross-section texture (zero per-frame cost)
 *  - edge-strip (outer, 320 wu) + edge-strip-inner (infield, 80 wu): static MeshSimple strips under the road, u from arc
 *    length on the strip's inner edge (256 wu per repeat, snapped to whole repeats), v outward, several rows across so
 *    iso-v lines (cyan trim) stay straight. Per vertex the depth is squeezed on concave bends (no folding) and clamped
 *    so a strip never reaches another section's road / the half-way line to it; the inner strip is dropped where the
 *    infield is narrower than INNER_MIN_GAP
 *  - flood pools (add) + lamp heads on the outside of corners, ~every POOL_EVERY wu, ≤ POOL_MAX per track, ≤ POOLS_ON_SCREEN
 *    drawn (nearest first); static meshes (mesh shader), only visibility changes per frame
 */
export const TRACKPACK_TRACKS = ['gridlock'];
// profiling: ?tpcut=pools,lamps,inner,outer,overlap drops layers / the hole trick (prototype only)
const CUT = new Set(((typeof location !== 'undefined' && /[?&]tpcut=([a-z,]+)/.exec(location.search)) || [, ''])[1].split(',').filter(Boolean));
const BASE = 'assets/track/', OUTER_D = 320, INNER_D = 80, INNER_MIN_GAP = 100, PERIOD = 256;
// outer strip v columns (v = wu / 320): gravel 0–108, [skip 108–148 wu when not composited], AO 148–172, tyres 172–236,
// armco 240–262, trim 267.5, glow to OUTER_END (alpha 0.02 there). Ground hole at OUTER_HOLE (armco, alpha 1).
const OUTER_END = 292, OUTER_HOLE = 250, INNER_HOLE = 44;
const OUTER_V = [0, 0.11, 0.22, 0.3375, 0.4625, 0.5375, 0.6375, 0.7375, OUTER_HOLE / 320, 0.82, 0.86, OUTER_END / 320];
const INNER_V = [0, INNER_HOLE / 80, 1];
const CHUNK = 24, POOL_TRIM = 0.7, FOLD_K = 0.78, SQUEEZE_MIN = 0.35, SQUEEZE_WIN = 250;
// POOLS_ON_SCREEN: most flood pools drawn at once (nearest to the camera win); drop to 4 if a phone dips.
// Prototype override for quick tests: &pools=N
export const POOLS_ON_SCREEN = +(((typeof location !== 'undefined' && /[?&]pools=(\d+)/.exec(location.search)) || [, 8])[1]);
const POOL_EVERY = 700, POOL_MAX = 10, POOL_CURV = 1 / 1500, POOL_ALPHA = 0.4, POOL_WU = 768, LAMP_WU = 48;
export const ASPHALT_BASE = '#3c3c3f', GROUND_BG = 0x1a2117;

function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('trackpack: ' + src)); im.src = src; }); }
function toCanvas(im) { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); return c; }
/** grass under the strip rows v 0..vStop (grass at 2× density so its 512 px tile repeats with the strip's 256 wu) */
/** static mesh: Pixi's MeshSimple re-uploads its vertex buffer every frame unless autoUpdate is off */
function still(m) { m.autoUpdate = false; return m; }
function underlay(im, grass, vStop) {
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const g = c.getContext('2d');
  const pat = g.createPattern(grass, 'repeat'); pat.setTransform(new DOMMatrix([1, 0, 0, 0.8, 0, 0]));
  g.fillStyle = pat; g.fillRect(0, 0, c.width, Math.round(c.height * vStop)); g.drawImage(im, 0, 0);
  return c;
}

export async function loadTrackPack(P, canvasTexture) {
  const [grass, asphalt, edge, edgeIn, atlasImg, atlas] = await Promise.all([
    loadImg(BASE + 'grass-tile.png'), loadImg(BASE + 'asphalt-tile.png'), loadImg(BASE + 'edge-strip.png'),
    loadImg(BASE + 'edge-strip-inner.png'), loadImg(BASE + 'track-atlas.png'), fetch(BASE + 'track-atlas.json').then((r) => r.json())]);
  const overlap = !CUT.has('overlap');
  // mipmapped + repeat (all power-of-two); the strips wrap along u only (v stays in 0..1)
  const tex = { grass: canvasTexture(toCanvas(grass), true, true), edge: canvasTexture(overlap ? underlay(edge, grass, (OUTER_HOLE + 8) / 320) : toCanvas(edge), true, true), edgeIn: canvasTexture(toCanvas(edgeIn), true, true), asphaltImg: asphalt };
  const atl = canvasTexture(toCanvas(atlasImg), true, false), AW = atlasImg.naturalWidth, AH = atlasImg.naturalHeight;
  const frameUV = (k) => { const f = atlas.frames[k].frame; return [f.x / AW, f.y / AH, (f.x + f.w) / AW, (f.y + f.h) / AH]; };
  const stats = { strips: 0, innerSkipped: 0, clampedPts: 0, squeezedPts: 0, pools: 0, poolsInView: 0, poolsInViewMax: 0 };
  let poolPos = [], chunks = [];

  /** Per-point clearance on side sgn: largest depth d ≤ D such that the strip edge stays ≥ d away from any other
   *  (non-local) section's road edge — i.e. it stops at the half-way line between two sections, never on a road. */
  function clearance(track, sgn, E0, D) {
    const pts = track.pts, n = pts.length, L = track.length, out = new Float32Array(n), win = E0 + D + 64;
    const sub = []; for (let j = 0; j < n; j += 2) sub.push(pts[j]);
    for (let i = 0; i < n; i++) {
      const p = pts[i]; let a = D;
      for (let d = 0; d <= D; d += 8) {
        const qx = p.x + p.nx * sgn * (E0 + d), qy = p.y + p.ny * sgn * (E0 + d); let mn = 1e9;
        for (const q of sub) { let ds = Math.abs(q.s - p.s); ds = Math.min(ds, L - ds); if (ds < win) continue; const m = Math.hypot(qx - q.x, qy - q.y); if (m < mn) mn = m; }
        if (mn - E0 < d) { a = Math.max(0, d - 8); break; }
      }
      out[i] = a;
    }
    return out;
  }
  /** Edge strip on side sgn → { mesh, ring } (ring: flat x,y per track point at v = vHole, for the ground hole). */
  function edgeStrip(track, sgn, texture, D, inner) {
    const pts = track.pts, n = pts.length, E0 = track.halfW + 12, cl = clearance(track, sgn, E0, inner ? INNER_MIN_GAP : D);
    const V = inner ? INNER_V : OUTER_V, C = V.length, vHole = inner ? INNER_HOLE / D : OUTER_HOLE / D;
    // transparent band skipped only when the grass is NOT composited into the strip (then the ground shows there)
    const SK = !inner && !overlap ? [3] : [], R = C - 1 - SK.length;
    const vert = new Float32Array((n + 1) * C * 2), uv = new Float32Array((n + 1) * C * 2), ring = new Float32Array(n * 2);
    // concave bends (the road turns TOWARDS this side, e.g. the far side of an S): a full-depth strip would fold
    // through the bend centre, so the stack is squeezed across (v still 0..1) to keep its outer edge at a radius of at
    // least (1 - FOLD_K)·R, eased in/out over ±SQUEEZE_WIN wu so the barrier bends smoothly instead of kinking
    const kq = new Float32Array(n);
    for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n], cross = p.tx * q.ty - p.ty * q.tx;
      kq[i] = Math.sign(cross) === sgn && p.radius ? Math.max(SQUEEZE_MIN, Math.min(1, (p.radius * FOLD_K - E0) / D)) : 1; }
    const step = track.length / n, wn = Math.max(1, Math.round(SQUEEZE_WIN / step)), kmin = new Float32Array(n), ks = new Float32Array(n);
    for (let i = 0; i < n; i++) { let m = 1; for (let j = -wn; j <= wn; j++) m = Math.min(m, kq[(i + j + n) % n]); kmin[i] = m; }
    for (let i = 0; i < n; i++) { let a = 0; for (let j = -wn; j <= wn; j++) a += kmin[(i + j + n) % n]; ks[i] = a / (2 * wn + 1); }
    let s = 0, px = 0, py = 0;
    for (let i = 0; i <= n; i++) {
      const k0 = i % n, p = pts[k0], full = D * ks[k0];
      let d = Math.min(full, cl[k0]), vEnd = d / full; // squeeze: geometry only (v still reaches 1); clamp: the stack is cut
      if (i < n) { if (ks[k0] < 1) stats.squeezedPts++; if (cl[k0] < full) stats.clampedPts++; }
      if (inner && cl[k0] < INNER_MIN_GAP) { d = 0; vEnd = 0; if (i < n) stats.innerSkipped++; }
      const ax = p.x + p.nx * sgn * E0, ay = p.y + p.ny * sgn * E0;
      if (i) s += Math.hypot(ax - px, ay - py); px = ax; py = ay;
      for (let r = 0; r < C; r++) { const o = (i * C + r) * 2, v = Math.min(V[r], vEnd), dd = E0 + v * full;
        vert[o] = p.x + p.nx * sgn * dd; vert[o + 1] = p.y + p.ny * sgn * dd; uv[o] = s / PERIOD; uv[o + 1] = v; }
      if (i < n) { const dh = E0 + Math.min(vHole, vEnd) * full; ring[k0 * 2] = p.x + p.nx * sgn * dh; ring[k0 * 2 + 1] = p.y + p.ny * sgn * dh; }
    }
    const cyc = Math.max(1, Math.round(s / PERIOD)), f = cyc / (s / PERIOD); // whole repeats → no seam at the loop close
    for (let i = 0; i < uv.length; i += 2) uv[i] *= f;
    stats.strips++;
    // split into chunks of CHUNK track points, each culled against the view per frame (software GL and weak GPUs
    // pay for every submitted triangle, even off screen)
    const cont = new P.Container();
    for (let i0 = 0; i0 < n; i0 += CHUNK) {
      const i1 = Math.min(n, i0 + CHUNK), m = i1 - i0, cv = vert.slice(i0 * C * 2, (i1 + 1) * C * 2), cu = uv.slice(i0 * C * 2, (i1 + 1) * C * 2), ci = new Uint32Array(m * R * 6);
      for (let i = 0; i < m; i++) for (let r = 0, k = 0; r < C - 1; r++) { if (SK.includes(r)) continue; const a0 = i * C + r, b0 = a0 + C; ci.set([a0, a0 + 1, b0, a0 + 1, b0 + 1, b0], (i * R + k++) * 6); }
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let k = 0; k < cv.length; k += 2) { x0 = Math.min(x0, cv[k]); x1 = Math.max(x1, cv[k]); y0 = Math.min(y0, cv[k + 1]); y1 = Math.max(y1, cv[k + 1]); }
      const mesh = still(new P.MeshSimple({ texture, vertices: cv, uvs: cu, indices: ci })); cont.addChild(mesh); chunks.push({ mesh, x0, y0, x1, y1 });
    }
    return { mesh: cont, ring };
  }
  function offsetRing(track, sgn, off) { const r = []; for (const p of track.pts) r.push(p.x + p.nx * sgn * off, p.y + p.ny * sgn * off); return r; }
  /** Outer side: the side whose offset polygon is larger (same test as feltAround). */
  function outerSign(track) {
    const pts = track.pts, n = pts.length, area = (sg) => { let a = 0; for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; const ax = p.x + p.nx * sg * 300, ay = p.y + p.ny * sg * 300, bx = q.x + q.nx * sg * 300, by = q.y + q.ny * sg * 300; a += ax * by - bx * ay; } return Math.abs(a / 2); };
    return area(1) > area(-1) ? 1 : -1;
  }
  /** feltAround() with custom rings: big rect minus the outer ring, plus the infield polygon (one non-batched mesh). */
  function ground(track, outer, inner) {
    const bd = track.bounds, m = 6000, x0 = bd.minX - m, y0 = bd.minY - m, x1 = bd.maxX + m, y1 = bd.maxY + m;
    const ringA = [x0, y0, x1, y0, x1, y1, x0, y1, ...outer], t1 = P.earcut(ringA, [4]), t2 = P.earcut(inner);
    const vert = new Float32Array(ringA.length + inner.length); vert.set(ringA); vert.set(inner, ringA.length);
    const idx = new Uint32Array(t1.length + t2.length); idx.set(t1); const base = ringA.length / 2; for (let i = 0; i < t2.length; i++) idx[t1.length + i] = t2[i] + base;
    const uv = new Float32Array(vert.length); for (let i = 0; i < vert.length; i++) uv[i] = vert[i] / 512; // 512 wu tile, world-anchored
    return still(new P.MeshSimple({ texture: tex.grass, vertices: vert, uvs: uv, indices: idx }));
  }
  /** Static quads (centre x,y, size, rotation) from one atlas frame → one MeshSimple. */
  /** Flood pools as octagons trimmed to the visible falloff (alpha·0.4 < 1/128 past POOL_TRIM of the radius): ~40 % of
   *  the square quad's pixels, all pools in one static additive mesh. */
  function octs(list, frame) {
    const [u0, v0, u1, v1] = frameUV(frame), N = 8, rr = POOL_TRIM / Math.cos(Math.PI / N); // circumradius so the inscribed circle = POOL_TRIM
    const vert = new Float32Array(list.length * (N + 1) * 2), uv = new Float32Array(list.length * (N + 1) * 2), idx = new Uint32Array(list.length * N * 3);
    list.forEach((q, k) => { const b = k * (N + 1); vert.set([q.x, q.y], b * 2); uv.set([(u0 + u1) / 2, (v0 + v1) / 2], b * 2);
      for (let j = 0; j < N; j++) { const a = (j + 0.5) * 2 * Math.PI / N, cx = Math.cos(a) * rr, cy = Math.sin(a) * rr;
        vert.set([q.x + cx * q.size / 2, q.y + cy * q.size / 2], (b + 1 + j) * 2); uv.set([(u0 + u1) / 2 + cx * (u1 - u0) / 2, (v0 + v1) / 2 + cy * (v1 - v0) / 2], (b + 1 + j) * 2);
        idx.set([b, b + 1 + j, b + 1 + ((j + 1) % N)], (k * N + j) * 3); } });
    return still(new P.MeshSimple({ texture: atl, vertices: vert, uvs: uv, indices: idx }));
  }
  function quads(list, frame) {
    const [u0, v0, u1, v1] = frameUV(frame), vert = new Float32Array(list.length * 8), uv = new Float32Array(list.length * 8), idx = new Uint32Array(list.length * 6);
    list.forEach((q, k) => { const c = Math.cos(q.rot || 0) * q.size / 2, sn = Math.sin(q.rot || 0) * q.size / 2;
      vert.set([q.x - c + sn, q.y - sn - c, q.x + c + sn, q.y + sn - c, q.x + c - sn, q.y + sn + c, q.x - c - sn, q.y - sn + c], k * 8);
      uv.set([u0, v0, u1, v0, u1, v1, u0, v1], k * 8); const b = k * 4; idx.set([b, b + 1, b + 2, b, b + 2, b + 3], k * 6); });
    return still(new P.MeshSimple({ texture: atl, vertices: vert, uvs: uv, indices: idx }));
  }
  function lights(track) {
    const pts = track.pts, n = pts.length, E0 = track.halfW + 12, sel = [];
    let run = POOL_EVERY / 2; // first pool half-way into a corner run
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], cross = p.tx * q.ty - p.ty * q.tx, seg = Math.max(1e-6, p.len || Math.hypot(q.x - p.x, q.y - p.y)), curv = cross / seg;
      if (Math.abs(curv) > POOL_CURV) { run += seg; if (run >= POOL_EVERY) { run = 0; sel.push({ i, sgn: -Math.sign(curv) }); } } else run = POOL_EVERY / 2;
    }
    const pick = sel.length <= POOL_MAX ? sel : Array.from({ length: POOL_MAX }, (_, k) => sel[Math.floor((k + 0.5) * sel.length / POOL_MAX)]); // even spread
    const pools = [], lamps = [];
    for (const { i, sgn } of pick) {
      const p = pts[i];
      pools.push({ x: p.x + p.nx * sgn * (E0 + 170), y: p.y + p.ny * sgn * (E0 + 170), size: POOL_WU });
      lamps.push({ x: p.x + p.nx * sgn * (E0 + 302), y: p.y + p.ny * sgn * (E0 + 302), size: LAMP_WU, rot: Math.atan2(-p.ny * sgn, -p.nx * sgn) }); // lens (+x) faces the road
    }
    stats.pools = pools.length; poolPos = pools;
    const out = [];
    // one tiny static mesh per pool so view() can cap how many are drawn (POOLS_ON_SCREEN)
    if (pools.length && !CUT.has('pools')) { const pc = new P.Container(); for (const q of pools) { const pm = octs([q], 'flood-pool'); pm.blendMode = 'add'; pm.alpha = POOL_ALPHA; q.mesh = pm; pc.addChild(pm); } out.push(pc); }
    if (lamps.length && !CUT.has('lamps')) out.push(quads(lamps, 'lamp-head'));
    return out;
  }
  return {
    tex, stats, cut: CUT,
    applies: (track) => TRACKPACK_TRACKS.includes(track.id),
    /** bottom layers (replace feltAround; under the shadow strips / road): ground, inner strip, outer strip */
    under(track) {
      const so = outerSign(track), E0 = track.halfW + 12, out = []; chunks = [];
      const inS = CUT.has('inner') ? null : edgeStrip(track, -so, tex.edgeIn, INNER_D, true);
      const outS = CUT.has('outer') ? null : edgeStrip(track, so, tex.edge, OUTER_D, false);
      out.push(ground(track, overlap && outS ? Array.from(outS.ring) : offsetRing(track, so, E0), overlap && inS ? Array.from(inS.ring) : offsetRing(track, -so, E0)));
      if (inS) out.push(inS.mesh); if (outS) out.push(outS.mesh);
      return out;
    },
    lights,
    /** per frame: cull strip chunks to the view; pool stats for verification */
    view(cx, cy, hx, hy) {
      let on = 0; for (const c of chunks) { const v = c.x1 > cx - hx && c.x0 < cx + hx && c.y1 > cy - hy && c.y0 < cy + hy; c.mesh.visible = v; if (v) on++; } stats.chunksOn = on; stats.chunks = chunks.length;
      const r = POOL_WU / 2 * POOL_TRIM / Math.cos(Math.PI / 8), inView = [];
      for (const q of poolPos) { const v = Math.abs(q.x - cx) < hx + r && Math.abs(q.y - cy) < hy + r; if (v) inView.push(q); else if (q.mesh) q.mesh.visible = false; }
      if (inView.length > POOLS_ON_SCREEN) inView.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
      inView.forEach((q, k) => { if (q.mesh) q.mesh.visible = k < POOLS_ON_SCREEN; });
      stats.poolsInView = inView.length; stats.poolsDrawn = Math.min(inView.length, POOLS_ON_SCREEN); stats.poolsCap = POOLS_ON_SCREEN;
      if (inView.length > stats.poolsInViewMax) stats.poolsInViewMax = inView.length; },
    /** bake the asphalt grain into the road cross-section (g is in world units; 512 px tile = 256 wu) */
    bakeAsphalt(g, a0, a1) {
      g.fillStyle = ASPHALT_BASE; g.fillRect(a0, 0, a1 - a0, PERIOD);
      const pat = g.createPattern(tex.asphaltImg, 'repeat'); pat.setTransform(new DOMMatrix([0.5, 0, 0, 0.5, 0, 0]));
      g.globalCompositeOperation = 'multiply'; g.fillStyle = pat; g.fillRect(a0, 0, a1 - a0, PERIOD); g.globalCompositeOperation = 'source-over';
    },
  };
}
