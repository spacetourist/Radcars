# Radcars v54 FX atlas

`fx-atlas.png` (1024×512, about 70 KB) and `fx-atlas.json` (a Pixi v8 spritesheet with per-frame anchors, plus `flame` and `smoke` animations).
Load it with `await Assets.load('assets/fx/fx-atlas.json')`. Preview: `docs/shots/83-fx-atlas-preview.png`. Regenerate with `python3 build_fx.py`.

Most frames are white, so tint them at runtime. Smoke is light grey and skid is dark rubber; leave both untinted. Frames are authored at about 2× their on-screen size at the default zoom, so they stay sharp at DPR 3.

| Frame | Use | Blend | Tint | Life | Pool share |
|---|---|---|---|---|---|
| `spark` (anchor at the hot head) | Wall-hit sparks: 6–10 per hit, rotated along the velocity reflected off the wall | add | `#ffe600` / `#ffb347` alternating | 180–320 ms, shrink in length | 24 |
| `spark_dot` | Embers left behind by sparks, grinding along the wall | add | `#ffb347` | 250 ms | (shared with spark) |
| `glow` | Flash at the impact point, missile hits, behind the boost flame | add | sodium for hits, `#00e8ff` for boost | 120 ms | 4 |
| `ring` | Boost-start shockwave (scale 0.3→1.4, alpha 0.8→0) and heavy wall hits | add | `#00e8ff` boost, `#ffb347` hit | 260 ms | 2 |
| `smoke_0..3` | Tyre smoke while sliding (when slip angle passes your threshold) and wall scrapes; pick a random variant and rotation | normal | none | 600–900 ms, scale 0.4→1.3, alpha 0.5→0 | 24 |
| `skid` | Tyre marks, stamped once per wheel per few px into **one** RenderTexture under the cars (never as live sprites) | normal, alpha 0.35–0.6 by slip | none | permanent; fade the texture about 2%/s | 0 |
| `streak` | Speed lines at the left/right screen edges above about 80% of top speed; 4–6 at once, screen space | add, alpha 0.15–0.35 | white | 200–350 ms, moving down-screen | 6 |
| `flame_0..2` (anchor at the exhaust) | Boost flame behind the car: cycle frames at about 24 fps with a ±8% random scale flicker | add | none (already coloured) | while boosting | 2 per car |

Rules: one shared `ParticleContainer`, or a sprite pool capped at 64 live sprites. When FPS drops, smoke goes first, then streaks. No Pixi filters during a race. Shake the camera on wall hits by up to 4 px, decaying over about 150 ms, and pair it with `navigator.vibrate(18)` (wrap the call in a feature check).

## v55 incoming-missile warning arrow

`warn-arrow.svg` is the source, and `warn-arrow.png` is the 256×256 HD bake with the glow included. The arrow points **up**: rotate it toward the missile and pivot on its centre. Preview: `docs/shots/84-warn-arrow-preview.png` (lit, pulse peak, off phase).

- **Placement:** pin it to the screen edge along the line from the player toward the missile, 28 px in from the edge, at about 72 px on a 390-wide screen. If the missile is on screen, put the arrow 90 px from the player instead.
- **Driven by `warnPulse({ttc, solid})`:** on each pulse, set alpha to 1 and scale 1.0→1.15→1.0 over 80 ms. After 45% of the pulse gap, drop alpha to 0.35 until the next pulse. When `solid` is true, hold alpha at 1 and scale at 1.1.
- **Colour:** keep it pink-red. Don't tint it, because red must always mean danger.

## Shared trigger values (agreed with Audio Engineer)

- **Wall hits:** `strength = clamp((car.wallHit − 200) / 700, 0, 1)`, with a 150 ms cooldown.
  - **Below 0.6:** 2–3 `spark`s and no shake or vibrate. This is the same moment as `wall_light`.
  - **0.6 and above:** a full spark burst (6–10), `glow` and `ring`, a camera shake of up to 4 px, and `navigator.vibrate(18)`, all on the same frame as `wall_heavy`.
- **Boost:** flame scale, glow alpha and the zoom punch all follow `car.boostLevel` (0–1). The `ring` shockwave fires when it rises past 0.15, the same moment as the boost whoosh.
