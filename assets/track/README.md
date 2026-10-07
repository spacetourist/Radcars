# Night-circuit track pack (approved paint-over v1/v2 ground)

This pack recreates the look Callum approved in `docs/shots/87-gd-portrait-paintover-v1/v2`:
- dark night grass
- a gravel run-off strip next to the kerbs
- a stacked tyre wall, then a steel armco rail with a thin cyan `#00e8ff` trim
- warm floodlight pools
- neutral grey asphalt with a darker racing line

Run `python3 build_track.py` to regenerate everything, including the preview `docs/shots/88-track-pack-preview.png`. The build is seeded (seed 88) and uses numpy, scipy and Pillow.

## Units (matched to `js/pixiRender.js` / `js/render.js`)
- `halfW` is the half-width of the drivable road, including the kerb. It is 270 (Neon Loop), 190 (Gridlock), 175 (Razor) and 160 (Cargo).
- `KERB = 24` wu sits inside `halfW`. `WALL = 12` is the rim outside it.
- The road strip's soft edge ends at `halfW + 16`. The felt or ground starts at `halfW + 12`.
- **All edge offsets below are measured outward from `E0 = halfW + 12`**, i.e. the outer edge of the kerb plus the rim.
- `ROAD_PERIOD = 256` wu. Every along-track texture repeats exactly once per 256 wu, so kerb blocks, dashes and the strip stay in phase.

## Assets
| file | size | KB | blend | tint | use |
|---|---|---|---|---|---|
| `grass-tile.png` | 512×512 RGB | 282 | normal | none (bg colour `#1a2117`) | Ground. Seamless both ways. **512 px = 512 wu**, world-anchored. |
| `asphalt-tile.png` | 512×512 8-bit grey | 199 | **multiply** (bake) | none | Neutral grain, mean ≈ 0.86. Multiply it over an asphalt base of `#3c3c3f`. **Draw at 0.5 scale: 512 px = 256 wu = ROAD_PERIOD.** |
| `edge-strip.png` | 512×512 RGBA | 253 | normal | none | Outer-edge stack. **x = along the track: 512 px = 256 wu (2 px/wu), wraps.** **y = outward from E0: 512 px = 320 wu (1.6 px/wu).** Transparent beyond the stack. |
| `edge-strip-inner.png` | 512×128 RGBA | 109 | normal | none | Infield edge, gravel only (y 0–80 wu at 1.6 px/wu). Same x mapping. |
| `gravel-tile.png` | 256×256 RGB | 125 | normal | none | **Canvas fallback only.** The same gravel, seamless both ways (256 px = 128 wu). |
| `flood-pool.png` | 256×256 RGBA | 52 | **add** | none (warm-neutral baked, about `#ffd09a`) | Floodlight pool. RGB = colour, A = falloff. |
| `lamp-head.png` | 64×64 RGBA | 5 | normal | none | Top-down lamp fixture: pole cap, arm, housing, lit lens with a bright core and a small glow. |
| `track-atlas.png` / `.json` | 512×256 | 63 | n/a | n/a | Pixi v8 spritesheet with frames `flood-pool` and `lamp-head`, both anchored at the centre. |

**Why the tiles and the strip are separate files:** they must wrap (`addressMode: 'repeat'`) and be power-of-two. An atlas frame can't wrap, so only the non-repeating sprites are in the atlas.

### Edge-strip layout (wu outward from E0)
| band | wu |
|---|---|
| fade-in over the road's soft edge | 0–4 |
| gravel (ragged, seamless edge, ±4 wu) | 4–~96 |
| loose stones | to ~106 |
| transparent: the grass tile shows through, with soft AO building toward the wall | 96–172 |
| tyre wall: two staggered rows of 32 wu tyres, 8 per 256 wu | 172–236 |
| dark gap | 236–240 |
| steel W-beam armco (bolts and posts every 64 wu, beam joints every 64 wu) | 240–262 |
| post caps | 261–268 |
| cyan trim (3 wu core, white-hot centre; normal-blend glow to about ±22 wu) | centred at 267.5 |
| outer AO / glow tail | to about 300 |
| transparent | 300–320 |

The lighting is symmetric (straight down), so the same texture works on either side of the road, for left and right corners alike. You don't need to flip it. Just build the strip with lateral offsets of `sgn * (E0 … E0 + 320)` for the side you want.

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

Putting the pools above the road is fine: they sit at least 100 wu outside it, and only their tails reach the kerb.

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
function edgeStrip(track, sgn, tex, depth /* 320 outer, 80 inner */) {
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
In tight hairpins (radius < E0 + 320) the outer side never self-intersects, but the inner side can. That's why the inner side uses the 80 wu `edge-strip-inner`. Where the infield is narrower than about 100 wu, skip the inner strip entirely.

**Racing line (not baked):** build a second static MeshSimple strip along an offset path, about 0.45·halfW wide, using a 64×4 gradient texture (transparent → `rgba(0,0,0,0.30)` → transparent) like `shadowTex`.
- Per point: `lat = clamp(-k·curvature·halfW, -0.55·halfW, 0.55·halfW)`, with `k` chosen so a typical corner reaches about 0.5·halfW at the apex.
- Smooth `lat` with a moving average over about 400 wu of arc length so it swings outside → apex → outside.
- Place it after the road strip in draw order. The result is about 30% darker along the line.

**Floodlights:**
- Walk the centreline. Where |curvature| > 1/1500 wu⁻¹, the outer side of the corner is `sgn = -sign(curvature)`.
- Every **~700 wu** of arc length inside such a corner, place:
  - a **lamp-head** at lateral `sgn·(E0 + 302)`, scale 0.75 (48 wu), rotated so the lens faces the road
  - a **flood-pool** at `sgn·(E0 + 170)`, scale **3.0** (768 wu across), `blendMode = 'add'`, **alpha 0.30** (0.25–0.40 is fine)
- **Max 10 per track.** Keep **≤ 8 pools on screen.** Pixi's `cullable = true` on the pool sprites is enough.

## Performance notes (55+ FPS on phones)
- **No new full-screen layers.**
  - The grass replaces the existing felt texture on the same mesh, so it costs nothing extra.
  - The asphalt is baked into the existing road cross-section texture, so it costs nothing per frame.
  - The racing line is one thin strip.
- **Edge strips:** at most 2 meshes (one per side), static, built once. They overdraw about 320 wu on the outside only, and half of that (the grass gap) is transparent.
  - If fill rate is tight, split the outer strip in two: v 0–106 wu (gravel) and v 150–300 wu (wall). That skips the transparent gap.
- **Pools:** additive, at most 8 on screen. Each is roughly a 768 wu quad. At ZOOM_FAR 0.24 they cover ~180 px each, which is cheap. They use a separate blend mode, so expect one batch break.
- Use mipmaps on all textures (`autoGenerateMipmaps`), because the zoom goes as far out as 0.24. All files are power-of-two for exactly this reason, and for wrap.
- Texture budget: about 1.1 MB of PNG on disk for the Pixi path (grass, strips, atlas), ~2.8 MB in GPU memory (+⅓ with mips). The asphalt is only used at bake time.

## Canvas fallback (`render.js`)
- **Ground:** `ctx.createPattern(grassImg,'repeat')` in `trackTex()`, with no transform (512 px = 512 wu).
- **Asphalt:** draw the asphalt pattern with `globalCompositeOperation='multiply'` and `setTransform(0.5)` over a `#3c3c3f` stroke. Or skip it and just use `#3c3c3f`.
- **Edge stack:** Canvas can't map a texture along a curve. Pre-bake the stack instead, as wide centre-path strokes drawn **before** the existing road strokes (widest first), at most 5 strokes:
  1. cyan `rgba(0,232,255,0.9)`, width `2·(E0+269)`
  2. armco `#5f646c`, width `2·(E0+266)`
  3. tyre band `#0d0e10`, width `2·(E0+240)`, plus `setLineDash([28,4])` for a hint of tyres
  4. grass `createPattern(grassImg)`, width `2·(E0+172)` (restores the grass gap)
  5. gravel `createPattern(gravelImg)`, width `2·(E0+96)`

  The road strokes then cover the inside. This puts the barrier on the infield side too, which is acceptable for the fallback.
  For more speed, bake these strokes once into an offscreen canvas per track at 0.5 resolution and `drawImage` it.
- **Pools:** `globalCompositeOperation='lighter'`, `globalAlpha 0.3`, `drawImage(poolImg)` at 768 wu, ≤ 4 on screen. Then draw the lamp heads normally.
