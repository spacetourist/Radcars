/**
 * Track-edge pack (GD night-circuit pack, assets/track/), v54.6. Pixi only, Gridlock only (pixiRender.js PACK_TRACKS),
 * on by default (?trackpack=0 = off). Loaded with a dynamic import from pixiRender.js the first time a pack track is
 * built, so other tracks never download the module or its images.
 *  - ground: GD grass on a ground mesh like feltAround(), but its holes follow the OPAQUE parts of the edge strips
 *    (outer: up to the armco at 256 wu, inner: the solid gravel at 80 wu), so ground + strips fill each pixel ~once
 *    (pack v1.1 bakes the grass into the outer strip)
 *  - asphalt-tile: multiplied into the baked road cross-section texture (zero per-frame cost)
 *  - edge-strip (outer, 320 wu) + edge-strip-inner (infield, 80 wu): static MeshSimple strips under the road, u from arc
 *    length on the strip's inner edge (256 wu per repeat, snapped to whole repeats), v outward, several rows across so
 *    iso-v lines (cyan trim) stay straight. Per vertex the depth is squeezed on concave bends (no folding) and clamped
 *    so a strip never reaches another section's road / the half-way line to it; the inner strip is dropped where the
 *    infield is narrower than INNER_MIN_GAP
 *  - flood pools (add) + lamp heads on the outside of corners, ~every POOL_EVERY wu, ≤ POOL_MAX per track, ≤ POOLS_ON_SCREEN
 *    drawn (nearest first); static meshes (mesh shader), only visibility changes per frame
 */
const BASE = 'assets/track/', OUTER_D = 320, INNER_D = 96, INNER_MIN_GAP = 116, PERIOD = 256;
// pack v1.1: outer strip opaque 0–262 wu (grass baked in), tyres 172–236 (tight: one row 210.4–236), armco 240–262,
// trim 267.5, tail to 282 (mesh ends at OUTER_END). Ground hole at OUTER_HOLE (armco, alpha 1). Rows sit on band edges.
const OUTER_END = 284, OUTER_HOLE = 256, INNER_HOLE = 80;
const OUTER_V = [0, 35, 70, 108, 148, 172, 204, 210.4, 236, 240, 256, 262, 268, 284].map((w) => w / 320);
const INNER_V = [0, 80 / 96, 1];
const TIGHT_R = 520; // concave side of bends tighter than this uses edge-strip-tight (single tyre row)
const CHUNK = 24, POOL_TRIM = 0.92, FOLD_K = 0.78, SQUEEZE_MIN = 0.35, SQUEEZE_WIN = 250;
// POOLS_ON_SCREEN: most flood pools drawn at once (nearest to the camera win); drop to 4 if a phone dips.
// Quick on-device override: &pools=N
export const POOLS_ON_SCREEN = +(((typeof location !== 'undefined' && /[?&]pools=(\d+)/.exec(location.search)) || [, 8])[1]);
const POOL_EVERY = 700, POOL_MAX = 24, POOL_CURV = 1 / 1500, POOL_ALPHA = 0.55, POOL_WU = 600, LAMP_WU = 48;
export const ASPHALT_BASE = '#3c3c3f', GROUND_BG = 0x1a2117;

function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('trackpack: ' + src)); im.src = src; }); }
function toCanvas(im) { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); return c; }
/** static mesh: Pixi's MeshSimple re-uploads its vertex buffer every frame unless autoUpdate is off */
function still(m) { m.autoUpdate = false; return m; }

export async function loadTrackPack(P, canvasTexture) {
  const [grass, asphalt, edge, edgeTight, edgeIn, atlasImg, atlas] = await Promise.all([
    loadImg(BASE + 'grass-tile.png'), loadImg(BASE + 'asphalt-tile.png'), loadImg(BASE + 'edge-strip.png'), loadImg(BASE + 'edge-strip-tight.png'),
    loadImg(BASE + 'edge-strip-inner.png'), loadImg(BASE + 'track-atlas.png'), fetch(BASE + 'track-atlas.json').then((r) => r.json())]);
  // mipmapped + repeat (all power-of-two); the strips wrap along u only (v stays in 0..1)
  const tex = { grass: canvasTexture(toCanvas(grass), true, true), edge: canvasTexture(toCanvas(edge), true, true), edgeTight: canvasTexture(toCanvas(edgeTight), true, true), edgeIn: canvasTexture(toCanvas(edgeIn), true, true), asphaltImg: asphalt };
  const atl = canvasTexture(toCanvas(atlasImg), true, false), AW = atlasImg.naturalWidth, AH = atlasImg.naturalHeight;
  const frameUV = (k) => { const f = atlas.frames[k].frame; return [f.x / AW, f.y / AH, (f.x + f.w) / AW, (f.y + f.h) / AH]; };
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
  function edgeStrip(track, sgn, texture, D, inner, tightTex) {
    const pts = track.pts, n = pts.length, E0 = track.halfW + 12, cl = clearance(track, sgn, E0, inner ? INNER_MIN_GAP : D);
    const V = inner ? INNER_V : OUTER_V, C = V.length, vHole = inner ? INNER_HOLE / D : OUTER_HOLE / D;
    const R = C - 1; // rows (the grass is composited into the outer strip, so no band is skipped)
    const vert = new Float32Array((n + 1) * C * 2), uv = new Float32Array((n + 1) * C * 2), ring = new Float32Array(n * 2);
    // concave bends (the road turns TOWARDS this side, e.g. the far side of an S): a full-depth strip would fold
    // through the bend centre, so the stack is squeezed across (v still 0..1) to keep its outer edge at a radius of at
    // least (1 - FOLD_K)·R, eased in/out over ±SQUEEZE_WIN wu so the barrier bends smoothly instead of kinking
    const kq = new Float32Array(n), tight = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n], cross = p.tx * q.ty - p.ty * q.tx, cc = Math.sign(cross) === sgn && p.radius;
      kq[i] = cc ? Math.max(SQUEEZE_MIN, Math.min(1, (p.radius * FOLD_K - E0) / D)) : 1; tight[i] = cc && p.radius < TIGHT_R ? 1 : 0; }
    const step = track.length / n, wn = Math.max(1, Math.round(SQUEEZE_WIN / step)), kmin = new Float32Array(n), ks = new Float32Array(n);
    for (let i = 0; i < n; i++) { let m = 1; for (let j = -wn; j <= wn; j++) m = Math.min(m, kq[(i + j + n) % n]); kmin[i] = m; }
    for (let i = 0; i < n; i++) { let a = 0; for (let j = -wn; j <= wn; j++) a += kmin[(i + j + n) % n]; ks[i] = a / (2 * wn + 1); }
    let s = 0, px = 0, py = 0;
    for (let i = 0; i <= n; i++) {
      const k0 = i % n, p = pts[k0], full = D * ks[k0];
      let d = Math.min(full, cl[k0]), vEnd = d / full; // squeeze: geometry only (v still reaches 1); clamp: the stack is cut
      if (inner && cl[k0] < INNER_MIN_GAP) { d = 0; vEnd = 0; }
      const ax = p.x + p.nx * sgn * E0, ay = p.y + p.ny * sgn * E0;
      if (i) s += Math.hypot(ax - px, ay - py); px = ax; py = ay;
      for (let r = 0; r < C; r++) { const o = (i * C + r) * 2, v = Math.min(V[r], vEnd), dd = E0 + v * full;
        vert[o] = p.x + p.nx * sgn * dd; vert[o + 1] = p.y + p.ny * sgn * dd; uv[o] = s / PERIOD; uv[o + 1] = v; }
      if (i < n) { const dh = E0 + Math.min(vHole, vEnd) * full; ring[k0 * 2] = p.x + p.nx * sgn * dh; ring[k0 * 2 + 1] = p.y + p.ny * sgn * dh; }
    }
    const cyc = Math.max(1, Math.round(s / PERIOD)), f = cyc / (s / PERIOD); // whole repeats → no seam at the loop close
    for (let i = 0; i < uv.length; i += 2) uv[i] *= f;
    // tight texture per 256 wu repeat (pack v1.1 review): a repeat is tight if a tight point touches it or a
    // neighbouring repeat (hysteresis), and the swap happens exactly on a repeat edge (a cross-section is inserted there)
    const rep = new Uint8Array(cyc), tRep = new Uint8Array(cyc), U = (i) => uv[i * C * 2];
    if (tightTex) { for (let i = 0; i < n; i++) if (tight[i]) { rep[Math.floor(U(i)) % cyc] = 1; rep[Math.floor(U(i + 1) - 1e-6) % cyc] = 1; }
      for (let k = 0; k < cyc; k++) tRep[k] = rep[k] | rep[(k + 1) % cyc] | rep[(k + cyc - 1) % cyc]; }
    const secV = [], secU = [], segT = []; // cross-sections, and the tight flag of the segment that ends at each one
    for (let i = 0; i <= n; i++) {
      if (i) { const ua = U(i - 1), ub = U(i);
        for (let m = Math.floor(ua) + 1; tightTex && m < ub - 1e-4; m++) { if (m - ua < 1e-4) continue; const t = (m - ua) / (ub - ua), o0 = (i - 1) * C * 2, o1 = i * C * 2, sv = new Float32Array(C * 2), su = new Float32Array(C * 2);
          for (let k = 0; k < C * 2; k++) { sv[k] = vert[o0 + k] + (vert[o1 + k] - vert[o0 + k]) * t; su[k] = uv[o0 + k] + (uv[o1 + k] - uv[o0 + k]) * t; }
          segT.push(tRep[(m - 1) % cyc]); secV.push(sv); secU.push(su); }
        segT.push(tRep[Math.floor((secU.at(-1)[0] + ub) / 2) % cyc]); }
      else segT.push(0);
      secV.push(vert.subarray(i * C * 2, (i + 1) * C * 2)); secU.push(uv.subarray(i * C * 2, (i + 1) * C * 2));
    }
    // split into chunks of ≤ CHUNK segments (and at every tight/normal change), each culled against the view per
    // frame (software GL and weak GPUs pay for every submitted triangle, even off screen)
    const cont = new P.Container(), NS = secV.length; let nTight = 0;
    for (let a0 = 0; a0 < NS - 1;) {
      const tq = !!segT[a0 + 1]; let a1 = a0 + 1; while (a1 < NS - 1 && a1 - a0 < CHUNK && !!segT[a1 + 1] === tq) a1++;
      const m = a1 - a0, cv = new Float32Array((m + 1) * C * 2), cu = new Float32Array((m + 1) * C * 2), ci = new Uint32Array(m * R * 6);
      for (let k = 0; k <= m; k++) { cv.set(secV[a0 + k], k * C * 2); cu.set(secU[a0 + k], k * C * 2); }
      for (let i = 0; i < m; i++) for (let r = 0; r < R; r++) { const q0 = i * C + r, b0 = q0 + C; ci.set([q0, q0 + 1, b0, q0 + 1, b0 + 1, b0], (i * R + r) * 6); }
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let k = 0; k < cv.length; k += 2) { x0 = Math.min(x0, cv[k]); x1 = Math.max(x1, cv[k]); y0 = Math.min(y0, cv[k + 1]); y1 = Math.max(y1, cv[k + 1]); }
      if (tq) nTight++;
      const mesh = still(new P.MeshSimple({ texture: tq ? tightTex : texture, vertices: cv, uvs: cu, indices: ci })); cont.addChild(mesh); chunks.push({ mesh, x0, y0, x1, y1 });
      a0 = a1;
    }
    return { mesh: cont, ring, nTight };
  }
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
    poolPos = pools;
    const out = [];
    // per pool a tiny static mesh so view() can cap how many are drawn (POOLS_ON_SCREEN); the core is baked (pack v1.1)
    if (pools.length) {
      const pc = new P.Container();
      for (const q of pools) {
        const pm = octs([q], 'flood-pool'); pm.blendMode = 'add'; pm.alpha = POOL_ALPHA; q.mesh = pm; pc.addChild(pm);
      }
      out.push(pc);
    }
    if (lamps.length) out.push(quads(lamps, 'lamp-head'));
    return out;
  }
  return {
    tex,
    /** bottom layers (replace feltAround; under the shadow strips / road): ground, inner strip, outer strip */
    under(track) {
      const so = outerSign(track), out = []; chunks = [];
      const inS = edgeStrip(track, -so, tex.edgeIn, INNER_D, true), outS = edgeStrip(track, so, tex.edge, OUTER_D, false, tex.edgeTight);
      out.push(ground(track, Array.from(outS.ring), Array.from(inS.ring)), inS.mesh, outS.mesh);
      return out;
    },
    lights,
    /** per frame: cull strip chunks to the view; draw the POOLS_ON_SCREEN nearest pools in view */
    view(cx, cy, hx, hy) {
      for (const c of chunks) c.mesh.visible = c.x1 > cx - hx && c.x0 < cx + hx && c.y1 > cy - hy && c.y0 < cy + hy;
      const r = POOL_WU / 2 * POOL_TRIM / Math.cos(Math.PI / 8), inView = [];
      for (const q of poolPos) { const v = Math.abs(q.x - cx) < hx + r && Math.abs(q.y - cy) < hy + r; if (v) inView.push(q); else if (q.mesh) q.mesh.visible = false; }
      if (inView.length > POOLS_ON_SCREEN) inView.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
      inView.forEach((q, k) => { if (q.mesh) q.mesh.visible = k < POOLS_ON_SCREEN; });
    },
    /** bake the asphalt grain into the road cross-section (g is in world units; 512 px tile = 256 wu) */
    bakeAsphalt(g, a0, a1) {
      g.fillStyle = ASPHALT_BASE; g.fillRect(a0, 0, a1 - a0, PERIOD);
      const pat = g.createPattern(tex.asphaltImg, 'repeat'); pat.setTransform(new DOMMatrix([0.5, 0, 0, 0.5, 0, 0]));
      g.globalCompositeOperation = 'multiply'; g.fillStyle = pat; g.fillRect(a0, 0, a1 - a0, PERIOD); g.globalCompositeOperation = 'source-over';
    },
  };
}
