# Radcars v54.8 DRIFT art (HANDBRAKE → DRIFT, power slide)

Regenerate with `python3 build_drift.py`. It is deterministic (seed 548, no timestamps), so re-runs give byte-identical files. It needs numpy, scipy, Pillow and cairosvg.
Preview: `python3 preview_drift.py` writes `docs/shots/93-drift-art-preview.png`. Section A of the preview is a Chrome screenshot of the real control markup with `css/style.css`, `controls-polish.css` and `drift-button.css`, taken via `_shoot.mjs` (puppeteer-core plus `/usr/bin/google-chrome`). The track sections are composited in Python with the curves below and an 8-bit emulation of the skid RenderTexture.

| File | Size | KB | Use |
|---|---|---|---|
| `drift-icon.svg` | viewBox 64 | 3.7 | DRIFT icon source. It follows the same rules as `js/icons.js`: ink `#1a1030`, 2.6 outline, flat fills with a soft white highlight, round joins, and **no ids** (no gradients or clipPaths), so any number of copies can share a page. |
| `drift-icon.png` / `@2x` / `@3x` | 56 / 112 / 168 px | 4 / 10 / 16 | Raster bakes, transparent, with no shadow baked in (the CSS adds it). |
| `drift-button.css` | n/a | 1.6 | Pressed state: the ring heats red→`#ff8a1f`, and the icon tilts by `--drift-tilt`. Load it after `controls-polish.css`. |
| `drift-smoke-0..5.png` | 256×256 | 27–39 each | Tyre-smoke puffs, also packed in the atlas. |
| `drift-skid.png` | 128×64 | 7.6 | Skid stamp brush. x runs along the direction of travel. |
| `drift-atlas.png` / `.json` | 1024×512 | 214 / 2.6 | Pixi v8 spritesheet. Frames `drift_smoke_0..5` (256², anchor 0.5) and `drift_skid` (128×64, anchor 0.5), plus the animation list `drift_smoke`. The names don't clash with the v54 `fx-atlas` frames (`smoke_*`, `skid`). |
| `build_drift.py`, `icon_svg.py` | | | Generator. The icon is authored in `icon_svg.py`. |
| `preview_drift.py`, `_shoot.mjs` | | | Preview only. |

## 1. DRIFT button icon

**Why these sizes.** The HANDBRAKE icon has no PNG. It is inline SVG (`ICONS.brake`, viewBox 64) drawn in `.act-brake .act-icon { width: 56% }` of the 100 CSS px disc. That makes it 56 CSS px at the 390×844 base, which is **56 / 112 / 168 px at DPR 1 / 2 / 3**. Like every other icon, the layout scale `s` multiplies it at runtime, so on the DOM path keep using the SVG and treat the PNGs as the Canvas/Pixi fallback.

**Content.** A yellow toy car seen from above with a cyan windscreen, white stripe, headlights and tail-lights. The car is turned 30° clockwise, and a curl of light grey smoke (a merged cloud with a spiral curl and two wisps) trails from the rear tyres. Yellow sits on the dark-red disc the way the light-grey brake disc did, and it still reads on the heated orange.

**Integration (Developer):** keep the kind key `brake`, so the ids, classes, input and layout stay the same.
- `js/icons.js`: `brake: svg(\`…\`)` gets the inner markup of `drift-icon.svg`, i.e. everything between `<svg …>` and `</svg>`. You can also generate it: `python3 -c "import icon_svg; print(icon_svg.body())"`.
- `js/controls.js`: `NAMES.brake = 'DRIFT'`, and in `paint('brake', …)` use `label: 'DRIFT'`.

### Pressed state (`drift-button.css`)
- **Heat:** on `data-state="active"`, the registered colour `--heat` transitions from `#e02020` to `#ff8a1f` over 280 ms. The rim and glow go fully orange. The disc only warms (`--fill` = 45% heat into the red) so the red button identity stays. Release snaps back to READY.
- **Tilt:** `.act-brake .act-icon` gets `transform: translateY(calc(var(--d) * -0.085)) rotate(var(--drift-tilt, 0deg))`, which is the existing lift plus the tilt, with a 160 ms ease that overshoots slightly.
- `prefers-reduced-motion` turns both transitions off.
- Browsers without `@property` (Safari < 16.4) still get the orange state. It just doesn't animate.

```js
// controls.js, paint(): set only when it changes (avoids a style recalc every frame)
const tilt = info.drifting ? 8 * Math.sign(info.driftDir || 0) : 0;   // +1 = sliding clockwise (right-hand corner) → +8deg
if (tilt !== lastTilt) { els.brake.style.setProperty('--drift-tilt', tilt + 'deg'); lastTilt = tilt; }
```

```js
// Pixi / Canvas fallback (if the button is ever drawn in-engine): ring sprite + icon sprite (drift-icon@3x.png)
const lerpRGB = (a, b, t) => (((a >> 16) + (((b >> 16) - (a >> 16)) * t)) << 16) | (((a >> 8 & 255) + (((b >> 8 & 255) - (a >> 8 & 255)) * t)) << 8) | ((a & 255) + (((b & 255) - (a & 255)) * t));
heat = held ? Math.min(1, heat + dtMs / 280) : 0;
ring.tint = lerpRGB(0xe02020, 0xff8a1f, heat * heat * (3 - 2 * heat));
const target = held ? Math.sign(driftDir) * 8 * Math.PI / 180 : 0;
icon.rotation += (target - icon.rotation) * Math.min(1, dtMs / 60);
```

## 2. Smoke puffs (`drift_smoke_0..5`)

Six heavy, irregular puffs. Each is 40–90 shaded sphere splats arranged in 3–5 sub-clusters, softened and lit from the top-left, so they read as billowing volumes rather than discs. The colour is a warm light grey: lit `#ebe6de`, crease `#8f8c8a`. The peak alpha is 0.92 and the outer 6 px are always fully clear.

**Premultiplied-friendly:** the PNGs are straight alpha, but their RGB is defined everywhere. Transparent texels carry the blurred smoke colour, and the atlas gutters carry `#ebe6de`. That means Pixi v8's default `premultiply-alpha-on-upload`, bilinear filtering and mips never pull in a dark fringe. Draw them with **normal** blend and no tint (or with the pool tint below).

**Size calibration:** the build measures the visible diameter (alpha > 15% of max). The v54 `smoke_*` is 78.9 px of 128, and the drift puffs are 160.9 px of 256. So 1.6× the v54 on-screen size works out to `scale = v54_scale × 0.785`.

| Curve (t = age / life) | v54 smoke (today) | DRIFT puff (suggested) |
|---|---|---|
| life | 600–900 ms | **1100–1500 ms** |
| scale of the frame | 0.22 → 0.70, linear | **s(t) = 0.173 + 0.377·(1 − (1 − t)²)**, an ease-out. Visible size ≈ 28 → 88 wu (v54: 17 → 55). |
| alpha | a0·(1 − t), a0 0.3–0.5 | **a(t) = a0 · min(1, t / 0.08) · (1 − t)^1.4**, a0 = 0.35 + 0.2·slip01. Short fade-in, long soft tail. |
| motion | v = car·0.15, damp e^(−2t) | Same as v54, plus a 25–55 wu/s kick outward from the wheel's side. Spin ±0.6 rad/s, random start rotation, random frame 0–5. |
| emission | every 140 − 80·slip ms | **One puff per 60 ms per drifting car**, alternating rear wheels (rear axle −0.32·CAR_LEN, ±0.36·CAR_WID, the same points the skids use). |

**Budget:** a drift is capped at **24 live puffs** out of the shared 64 (`FX_CAP`). At 60 ms and a mean life of 1.3 s that is about 22 live, so the cap only clips the long tail. When 24 are live, skip the spawn instead of evicting sparks or streaks. When FPS sags, follow the README rule: at quality 1, emit every 120 ms; at quality 0, emit none. The preview drift runs at 620 wu/s and settles at 20 live.

```js
// fx.js sketch: own kind so partLook() can use the drift curves
add(fx, { k: 'drift', x, y, vx, vy, rot: rnd(0, 6.28), spin: rnd(-0.6, 0.6), life: rnd(1100, 1500), a0: 0.35 + 0.2 * sl, frame: (Math.random() * 6) | 0 });
// partLook(o) for k === 'drift':
const t = o.ms / o.life, scale = 0.173 + 0.377 * (1 - (1 - t) ** 2), alpha = o.a0 * Math.min(1, t / 0.08) * (1 - t) ** 1.4;
// pixiRender: name = 'drift_smoke_' + o.frame, blendMode 'normal'
```

**Warm floodlight pick-up (optional, cheap):** pools are additive on the track layer, so normal-blended smoke covers their light. To keep smoke inside a pool reading as lit, compute the tint once at spawn: `k` is the pool falloff at the spawn point from the nearest visible pool (`1 − smoothstep(0.15, 0.92, d / 300)`, with a 600 wu pool), and `tint = lerp(0xffffff, 0xffd6ae, 0.6·k)`. This needs `poolPos` exported from `js/trackpack.js`. Preview section C shows the result: untinted puffs at pool 0.00, warm ones at 0.50 and 0.97.

## 3. Skid stamp (`drift_skid`, ONE shared RenderTexture)

The brush is 128×64 with x along travel. It has soft shoulders across the width, long soft ends (so overlapping stamps merge into one stripe), four longitudinal tread grooves (unlike cross-ribs, these survive any stamp spacing) and rubber grain. The rubber is `#0e0e10`-ish at alpha ≤ 0.9. Use normal blend, untinted.

- **Stamp size:** 12 × 6 wu, with `scale.x = 12·res/128` and `scale.y = 6·res/64`, where `res` = RT px per wu. That gives about 5 wu of visible rubber, the same as the v54 5.2 wu rect. Rotate to the path angle (the `ang` in `fx.js`). Spacing ≤ 3 wu (¼ length). Per-stamp alpha is **0.14–0.24 by slip** while drifting (v54 is 0.10–0.18).
- **One RT, no per-mark sprites:** each frame, put that frame's stamps (about 8 at 620 wu/s, from a small reusable sprite pool) in one container and draw it once: `renderer.render({ container: stamps, target: skidRT, clear: false })`. The world shows the RT through one sprite, or one TilingSprite (see below).
- **RT size:** the tracks are up to about 7800×3900 wu, so a whole-track RT is either too big or too blurry. Suggested: **2048² RGBA8 at 1 px/wu (16 MB), used as a toroidal buffer.**
  - Stamp at `(x mod 2048, y mod 2048)`. Draw a stamp twice if it crosses the wrap edge.
  - Show the RT with a TilingSprite over the view rect, with `tilePosition = −viewOrigin`.
  - Before stamping, erase the band of RT that newly enters the view each frame (a 'erase' rect, split at the wrap), so marks from 2048 wu away never ghost in.
  - Marks therefore live while within about 1 km of the camera, and they fade long before that anyway.
  - Caveat: at `ZOOM_FAR` 0.24 the view (about 1600×3500 wu) is bigger than 2048. Hide or fade the skid sprite above about 1900 wu of view, or use 0.5 px/wu (4096 wu coverage, softer marks).

### Fade: do NOT fade a little every frame
An RGBA8 RT can't fade by tiny steps. `erase` (dst-out) with alpha f leaves a texel alone whenever `round(v·(1−f)) == v`:

| erase alpha per pass | texels that never fade |
|---|---|
| 0.003 (≈ 17%/s at 60 fps) | alpha ≤ **0.65**, so marks never fade |
| 0.02 (v54 tile fade) | alpha ≤ **0.094** |
| **1/16** | alpha ≤ **0.031** (invisible on the asphalt) |

So use a fixed **erase alpha of 1/16** and set the rate with the **interval between passes**. Each pass is one full-RT quad (`Sprite(Texture.WHITE)` sized to the RT, `blendMode 'erase'`, `alpha 0.0625`, rendered with `clear: false`), so it costs one draw call.
- **DRIFT preset (suggested for v54.8):** one pass every **0.4 s** (24 frames at 60 fps). That is about 15%/s, with a half-life of about 4.3 s. Drifting lays far more rubber, so marks clear in about 10–15 s. This is what the preview emulates, with quantisation. The faint outer arcs in the preview are a drift from 7 s earlier.
- **v54-match preset:** one pass every **3.2 s**, about 2%/s.
- Clear the RT on race start or restart.

Note for the v54 tile fade: `fx.js` `fadeSkids()` fades by 0.02 per op. Per the table above, texels at or below about 9% alpha should stall there, so faded v54 marks probably leave a permanent faint residue until their tile is recycled. I haven't checked this in a browser.
