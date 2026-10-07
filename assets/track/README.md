# Night-circuit track pack (approved paint-over v1/v2 ground)

**Version 1.1 (2026-10-07).** Same filenames as v1.0, plus a new `edge-strip-tight.png`. See [v1.1 changes](#v11-changes-and-what-to-update-in-jstrackpackjs) for the five constants in `js/trackpack.js` that need to change.

This pack recreates the look Callum approved in `docs/shots/87-gd-portrait-paintover-v1/v2`:
- dark night grass
- a gravel run-off strip next to the kerbs
- a stacked tyre wall, then a steel armco rail with a thin cyan `#00e8ff` trim
- warm floodlight pools
- neutral grey asphalt with a darker racing line

Run `python3 build_track.py` to regenerate everything, including the preview `docs/shots/88b-track-pack-v11-preview.png`. The v1.0 preview `88-track-pack-preview.png` is kept for comparison. The build is seeded (seed 88) and uses numpy, scipy and Pillow.

## Units (matched to `js/pixiRender.js` / `js/render.js`)
- `halfW` is the half-width of the drivable road, including the kerb. It is 270 (Neon Loop), 190 (Gridlock), 175 (Razor) and 160 (Cargo).
- `KERB = 24` wu sits inside `halfW`. `WALL = 12` is the rim outside it.
- The road strip's soft edge ends at `halfW + 16`. The felt or ground starts at `halfW + 12`.
- **All edge offsets below are measured outward from `E0 = halfW + 12`**, i.e. the outer edge of the kerb plus the rim.
- `ROAD_PERIOD = 256` wu. Every along-track texture repeats exactly once per 256 wu, so kerb blocks, dashes and the strip stay in phase.

## Assets
| file | size | KB | blend | tint | use |
|---|---|---|---|---|---|
| `grass-tile.png` | 512×512 RGB | 282 | normal | none (bg colour `#1a2117`) | Ground. Seamless both ways. **512 px = 512 wu**, world-anchored. Unchanged in v1.1. |
| `asphalt-tile.png` | 512×512 8-bit grey | 198 | **multiply** (bake) | none | Neutral grain, mean ≈ 0.86. Multiply it over an asphalt base of `#3c3c3f`. **Draw at 0.5 scale: 512 px = 256 wu = ROAD_PERIOD.** Unchanged. |
| `edge-strip.png` | 512×512 RGBA | 303 | normal | none | Outer-edge stack. **x = along the track: 512 px = 256 wu (2 px/wu), wraps.** **y = outward from E0: 512 px = 320 wu (1.6 px/wu).** **v1.1: opaque from 0 to 262 wu** (grass baked into the gap), soft tail to 282, transparent after. |
| `edge-strip-tight.png` | 512×512 RGBA | 307 | normal | none | **New.** Same as `edge-strip` but with a single row of thinner tyres (25.6 wu). It's for the concave side of bends under ~520 wu radius. Same mapping and offsets. |
| `edge-strip-inner.png` | 512×128 RGBA | 131 | normal | none | Infield edge, gravel only. **v1.1: y = 0–96 wu (128 px, 1.333 px/wu); this mapping changed.** Solid to 80 wu, then a soft edge. Same x mapping. |
| `gravel-tile.png` | 256×256 RGB | 131 | normal | none | **Canvas fallback only.** The same gravel (v1.1: 15% lighter), seamless both ways (256 px = 128 wu). |
| `flood-pool.png` | 256×256 RGBA | 24 | **add** | none (baked: warm-white core `#ffe2be`, warm peach tail `#ffb496`) | Floodlight pool. RGB = colour, A = falloff. **v1.1: the falloff now fills the sprite** (alpha 0 at 92% of the half-size, previously ~70%), with a brighter core. Designed for **alpha 0.55**. |
| `lamp-head.png` | 64×64 RGBA | 4 | normal | none | Top-down lamp fixture: pole cap, arm, housing, lit lens with a bright core and a small glow. Unchanged. |
| `track-atlas.png` / `.json` | 512×256 | 32 | n/a | n/a | Pixi v8 spritesheet with frames `flood-pool` and `lamp-head`, both anchored at the centre. Same frame rects as v1.0; meta version is `1.1`. |

**Why the tiles and the strips are separate files:** they must wrap (`addressMode: 'repeat'`) and be power-of-two. An atlas frame can't wrap, so only the non-repeating sprites are in the atlas.

All offsets below are in wu outward from **E0 = halfW + 12**. Each texture row was measured from the PNG alpha, so these are the real boundaries.

### Outer edge strip `edge-strip.png` (v = wu / 320)
| band | wu | alpha |
|---|---|---|
| gravel, darker compacted wear for the first 18 wu (the road covers 0–4) | 0 → edge | 1 |
| gravel edge: centre wanders 91–101 wu (seamless), each side softens over ±7 | fully gravel to ≥ 84, fully grass from ≤ 108 | 1 |
| loose stones on the grass | to ~111 | 1 |
| **baked grass** (the grass tile's grass at true scale, 256 wu period along x). AO darkens it toward the wall from ~140 | ~96 → 172 | **1** |
| tyre wall: two staggered rows of 32 wu tyres, 8 per 256 wu | **172 → 236** | 1 |
| shadowed gap (dark grass) | 236 → 240 | 1 |
| steel W-beam armco (bolts, posts and joints every 64 wu) | **240 → 262** | 1 (**end of the opaque region: 262**) |
| posts (behind the rail) | 261 → 268, 6 wu wide | 1 |
| AO outside the rail | 262 → ~280 | ≤ 0.5, fading |
| cyan trim: 3 wu core, white-hot centre | **266 → 269 (centre 267.5)** | 1 |
| cyan glow: wide (σ 8.5 wu) over the rail, short (σ 4.5 wu) outside | 251 → 282 | ≤ 0.42 |
| **last non-zero texel** | **282** | |
| transparent (don't draw it: end the mesh at 284) | 284 → 320 | 0 |

Within the drawn 0–284 wu, only **22 wu (7.7%)** is non-opaque. In v1.0, 76 wu of the grass gap plus ~40 wu of the tail were transparent.

### Tight edge strip `edge-strip-tight.png` (v = wu / 320)
It is identical to `edge-strip` from 0 to ~137 wu and from 236 wu outward: same gravel texels, armco, posts, trim and tail. Only these bands change:
| band | wu |
|---|---|
| baked grass, extended, with AO toward the single row from ~176 | ~96 → 210.4 |
| **single tyre row: 25.6 wu tyres, 10 per 256 wu**, against the rail | **210.4 → 236** |

**When to use it:** on the side of the road that faces the bend centre (the concave side; in `edgeStrip()` that's `Math.sign(cross) === sgn`) where the centreline `radius < 520` wu.
- There the strip gets squeezed: `kq` drops to ~0.5 for Gridlock. Two rows of 32 wu tyres turn into a mush of tiny ovals, and one row reads cleanly.
- See the bottom-right panels of `88b`. They show an R = 470 bend with k = 0.51.

**How to switch:** pick the texture per strip chunk (`CHUNK` points).
- Use `edge-strip-tight` if any point in the chunk qualifies. Add one chunk of hysteresis so short wiggles don't flicker between textures.
- Gravel, grass near the road, armco and trim are pixel-identical in both textures, so a switch only changes the tyre band.
- Switch at a whole repeat (`u` integer, s ≡ 0 mod 256 wu) if you can. There, the outer tyre row and the single row both end on a tyre boundary.
- It's one extra 512×512 texture and no extra draw calls beyond the chunk split you already have.

### Inner edge strip `edge-strip-inner.png` (v = wu / **96**)
| band | wu | alpha |
|---|---|---|
| gravel, darker compacted wear for the first 18 wu | 0 → 80 | **1 (solid to 81.0 measured)** |
| soft ragged edge: centre wanders 84–89 wu, softens over ±3 | 81 → 92 | 1 → 0 |
| loose stones | to 94.5 | sparse |
| transparent | 95 → 96 | 0 |

The lighting is symmetric (straight down), so the same textures work on either side of the road and in left and right corners alike. You don't need to flip anything.

### Gravel value (v1.1)
Gravel base colour went from `#373633` to `#3f3e3a` (×1.15). Measured mean luminance:
- `gravel-tile`: 54.7 → **63.0** (+15.1%)
- strip gravel band: 54.8 → **63.1**
- grass: ≈ 31

Gravel now reads as a separate band at ZOOM_FAR 0.24.

## Pixi v8 wiring (per track, built once, behind the flag)
Draw order, bottom to top:
1. ground (grass)
2. inner edge strip, then outer edge strip
3. existing raised-piece shadow strips
4. road strip (asphalt baked in)
5. racing line
6. pads / grid / start line
7. **flood pools (add)**
8. lamp heads
9. cars and FX

Putting the pools above the road is fine: their centre is 170 wu outside E0, and the 276 wu lit radius reaches ~100 wu onto the road edge as a faint spill. That's intended: it lights the kerb.

```js
// 1) grass: reuse feltAround() unchanged; it's already world-anchored at 512 wu, so just swap the texture
const grass = await P.Assets.load('assets/track/grass-tile.png'); grass.source.addressMode = 'repeat';
trackLayer.addChild(feltAround(track, grass));  renderer.background.color = 0x1a2117;

// 2) asphalt: bake into roadTexture() (zero runtime cost) instead of textureTile('asphalt'):
//    g.fillStyle = '#3c3c3f'; g.fillRect(-(hw-KERB), 0, 2*(hw-KERB), ROAD_PERIOD);
//    const pat = g.createPattern(asphaltImg, 'repeat'); pat.setTransform(new DOMMatrix([0.5,0,0,0.5,0,0]));
//    g.globalCompositeOperation = 'multiply'; g.fillStyle = pat; g.fillRect(...same rect...); g.globalCompositeOperation = 'source-over';
//    Also use a neutral asphalt colour for this track (the themes' '#34343c' etc. are purple-tinted).

// 3) edge strips: one mesh per side. Use the existing strip() idea, but texture x runs ALONG the track,
//    and u comes from arc length measured on the strip's own inner edge, so tyres don't stretch in corners.
function edgeStrip(track, sgn, tex, depth /* 320 outer (end mesh at 284), 96 inner */) {
  const pts = track.pts, n = pts.length, E0 = track.halfW + 12;
  const vert = new Float32Array((n + 1) * 4), uv = new Float32Array((n + 1) * 4), idx = new Uint32Array(n * 6);
  let s = 0, px, py;
  for (let i = 0; i <= n; i++) {
    const p = pts[i % n], ax = p.x + p.nx * sgn * E0, ay = p.y + p.ny * sgn * E0;
    if (i) s += Math.hypot(ax - px, ay - py); px = ax; py = ay;
    vert.set([ax, ay, p.x + p.nx * sgn * (E0 + depth), p.y + p.ny * sgn * (E0 + depth)], i * 4);
    uv.set([s / 256, 0, s / 256, 1], i * 4);          // 256 wu per repeat
    if (i < n) { const k = i * 2; idx.set([k, k + 1, k + 2, k + 1, k + 3, k + 2], i * 6); }
  }
  // snap the closing seam: scale u so the loop holds a whole number of repeats
  const cyc = Math.max(1, Math.round(s / 256)); for (let i = 0; i < uv.length; i += 2) uv[i] *= cyc / (s / 256);
  return new P.MeshSimple({ texture: tex, vertices: vert, uvs: uv, indices: idx });
}
// outer side = the side with the larger offset polygon (same area test as feltAround)
// The texture is anisotropic (2 px/wu along, 1.6 px/wu across), so don't use MeshRope's
// aspect-preserving textureScale. A MeshSimple with explicit uvs (above) is the correct and cheapest choice.
```
In tight hairpins (radius < E0 + 320) the outer side never self-intersects, but the inner side can. That's why the inner side uses the 96 wu `edge-strip-inner`. Where the infield is narrower than about 116 wu, skip the inner strip entirely.

**Racing line (not baked):** build a second static MeshSimple strip along an offset path, about 0.45·halfW wide, using a 64×4 gradient texture (transparent → `rgba(0,0,0,0.30)` → transparent) like `shadowTex`.
- Per point: `lat = clamp(-k·curvature·halfW, -0.55·halfW, 0.55·halfW)`, with `k` chosen so a typical corner reaches about 0.5·halfW at the apex.
- Smooth `lat` with a moving average over about 400 wu of arc length so it swings outside → apex → outside.
- Place it after the road strip in draw order. The result is about 30% darker along the line.

**Floodlights:**
- Walk the centreline. Where |curvature| > 1/1500 wu⁻¹, the outer side of the corner is `sgn = -sign(curvature)`.
- Every **~700 wu** of arc length inside such a corner, place:
  - a **lamp-head** at lateral `sgn·(E0 + 302)`, scale 0.75 (48 wu), rotated so the lens faces the road
  - a **flood-pool** at `sgn·(E0 + 170)`, **600 wu across (v1.1; was 768)**, `blendMode = 'add'`, **alpha 0.55**
- The v1.1 sprite lights out to 0.92 × 300 = **276 wu** radius, about the same footprint as v1.0 at 768 wu, whose light died at ~70%. So it uses the same pixels with no wasted texels.
- Trim octagon: **inscribed radius 0.92** (`POOL_TRIM = 0.92`). Its circumradius is 0.996, so it stays inside the frame.
- **The brighter core is baked in now**, so drop the second `POOL_CORE` copy (one fewer additive layer per pool).
- On green grass the tail stays warm (hue ~42°) instead of olive (v1.0 tail: hue ~80°). The core is a warm cream (~`#a69f83` over grass at α 0.55).
- **Max 10 per track.** Keep **≤ 8 pools on screen.** Pixi's `cullable = true` on the pool sprites is enough.

## Performance notes (55+ FPS on phones)
- **No new full-screen layers.**
  - The grass replaces the existing felt texture on the same mesh, so it costs nothing extra.
  - The asphalt is baked into the existing road cross-section texture, so it costs nothing per frame.
  - The racing line is one thin strip.
- **Edge strips:** at most 2 meshes (one per side), static, built once.
  - v1.1: the outer strip is opaque from 0 to 262 wu and fully transparent past 282. End the mesh at **284 wu** instead of 292–320.
  - The ground hole can sit anywhere in 250–258 wu, and the ground never needs to draw under the strip.
  - With the grass baked in, the load-time `underlay()` composite does nothing. It's harmless, but you can delete it.
  - If the GPU path supports it, the outer strip's 0–262 rows could even go in a separate non-blended (opaque) mesh. That's optional.
- **Pools:** additive, at most 8 on screen. Each is a 600 wu octagon (inscribed r 276 wu): at ZOOM_FAR 0.24 that's ~130 px. Dropping the core copy halves the additive layers. They use a separate blend mode, so expect one batch break.
- Use mipmaps on all textures (`autoGenerateMipmaps`), because the zoom goes as far out as 0.24. All files are power-of-two for exactly this reason, and for wrap.
- Texture budget: about 1.1 MB of PNG on disk for the Pixi path (grass, the two strips, atlas), plus 0.3 MB if `edge-strip-tight` is used. In GPU memory that's ~2.8 MB (+1 MB with tight, +⅓ with mips). The asphalt is only used at bake time.

## Canvas fallback (`render.js`)
- **Ground:** `ctx.createPattern(grassImg,'repeat')` in `trackTex()`, with no transform (512 px = 512 wu).
- **Asphalt:** draw the asphalt pattern with `globalCompositeOperation='multiply'` and `setTransform(0.5)` over a `#3c3c3f` stroke. Or skip it and just use `#3c3c3f`.
- **Edge stack:** Canvas can't map a texture along a curve. Pre-bake the stack instead, as wide centre-path strokes drawn **before** the existing road strokes (widest first), at most 5 strokes:
  1. cyan `rgba(0,232,255,0.9)`, width `2·(E0+269)`
  2. armco `#5f646c`, width `2·(E0+266)`
  3. tyre band `#0d0e10`, width `2·(E0+240)`, plus `setLineDash([28,4])` for a hint of tyres
  4. grass `createPattern(grassImg)`, width `2·(E0+172)` (restores the grass gap)
  5. gravel `createPattern(gravelImg)`, width `2·(E0+96)` (it's the same on the infield; the v1.1 inner strip is solid to 80 and fades out by 92)

  The road strokes then cover the inside. This puts the barrier on the infield side too, which is acceptable for the fallback.
  For more speed, bake these strokes once into an offscreen canvas per track at 0.5 resolution and `drawImage` it.
- **Pools:** `globalCompositeOperation='lighter'`, `globalAlpha 0.55`, `drawImage(poolImg)` at 600 wu, ≤ 4 on screen. Then draw the lamp heads normally.

## v1.1 changes and what to update in `js/trackpack.js`
Changes:
1. **flood-pool:** reframed so the falloff fills the sprite (alpha 0 at r = 0.92), with a brighter baked core. The colour runs from a warm-white core to a peach tail, which keeps green grass warm rather than olive. Designed for α 0.55 at 600 wu.
2. **edge-strip:** grass is baked into the gravel→tyre gap, so it's opaque 0–262 wu. The soft tail is cut to 282 wu (was ~300).
3. **edge-strip-inner:** solid gravel to 80 wu (was ~46), with a soft edge from 81 to 92. The texture now spans 96 wu.
4. **New edge-strip-tight:** one 25.6 wu tyre row (210.4–236) for the concave side of bends with R < 520.
5. **Gravel:** +15% value in all strips and `gravel-tile`.

Constants to change (the old values still load, but they'd crop or misplace things):
```js
const OUTER_D = 320, INNER_D = 96, INNER_MIN_GAP = 116;            // INNER_D was 80 (texture now spans 96 wu)
const OUTER_END = 284, OUTER_HOLE = 256, INNER_HOLE = 80;           // were 292 / 250 / 44
const OUTER_V = [0, 35, 70, 108, 148, 172, 204, 210.4, 236, 240, 256, 262, 268, 284].map((w) => w / 320); // iso-v rows on band edges
const INNER_V = [0, 80 / 96, 1];
const POOL_TRIM = 0.92, POOL_WU = 600, POOL_ALPHA = 0.55;           // and remove the POOL_CORE copy (core is baked)
// optional: delete underlay() (grass is baked now); load 'edge-strip-tight.png' and use it per chunk on concave bends with radius < 520
```
