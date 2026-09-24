# Radcars — Vintage Fast v1 (performance pivot)

**Style name:** `vintage-sprint`  
**Goal:** Playable 60fps on mid hardware at ZOOM_FAR 0.24 with long chase. Speed over polish. City-carpet / dual rooftop / uncapped fabric lane is **paused**.

## Look references
Early arcade top-down (Super Sprint / Championship Sprint), 80s–90s sprite racers, flat OutRun-adjacent palette — not photoreal, not contiguous city rooftops.

## Palette (hard limit ~8–10 colours, neon accent OK)
| Role | Hex | Notes |
|------|-----|-------|
| Asphalt | `#2a2a32` | Flat fill only — no grit tile carpet |
| Asphalt edge / lane | `#1a1a22` | Slight darker stroke optional |
| Infield | `#1e3a28` | Flat grass/dirt, one colour |
| Outfield / void | `#0c0c12` | Solid night void — OK to show |
| Kerb A | `#e8e8e8` | White |
| Kerb B | `#e02020` | Red |
| Accent cyan | `#00e8ff` | Player / neon trim |
| Accent pink | `#ff2b6a` | Rival / neon trim |
| Accent lime | `#b8ff00` | Rival |
| Yellow (start) | `#ffe600` | Chequer / gantry |

No seamless rooftop tiling. No dual-layer FAR city. No soft-alpha fabric ribbons.

## Ship **now** (procedural / canvas — do this first)
1. Kill dual rooftop `TilingSprite`s + uncapped fabric density on Neon/Gridlock.
2. Prefer canvas (or minimal Pixi draw calls): rectangular fills for asphalt ribbon, infield, outfield.
3. Procedural kerbs: alternating red/white segments along track edge (simple polyline strokes or short rects, cap count).
4. Cars: keep existing chroma-keyed sprites **or** temporary flat-rect cars until vintage pack lands — do not block FPS cut on art.
5. Cap roadside stamps hard: ≤12–20 total on screen at FAR; prefer 0 until pack ready.
6. Keep longer course + chase cam; target ≥55–60 FPS mid hardware at FAR mid-straight.
7. Drop production-lock on soft rooftop / cityfabric-row. No more FAR tile-rectangle reviews for that lane.

## Tiny stamp pack (≤10) — Graphic Designer ships next as PNGs (magenta `#FF00FF` chroma)
Paths under `assets/generated/vintage/`:

| # | File | Max px | Use |
|---|------|--------|-----|
| 1 | `car-cyan.png` | ≤96 | Player |
| 2 | `car-pink.png` | ≤96 | Rival |
| 3 | `car-lime.png` | ≤96 | Rival |
| 4 | `kerb-stripe.png` | ≤64 | Optional; prefer procedural kerbs |
| 5 | `barrier-tyre.png` | ≤64 | Sparse corners only |
| 6 | `cone.png` | ≤32 | Sparse |
| 7 | `lamp.png` | ≤48 | Sparse Gridlock identity |
| 8 | `tree.png` | ≤48 | Sparse Neon identity |
| 9 | `billboard.png` | ≤64 | Sparse |
| 10 | `chequer-gantry.png` | ≤128 | Start/finish only |

Do **not** place cityblock / fabric / rooftop. Identity = palette + 2–3 sparse icons per track, not density.

## Delete / stop loading (Neon + Gridlock race path)
- `tex-urban-rooftop-fill*` (all v5 / v51 / v52)
- `tex-urban-lot-tile.png`
- `scenery-cityfabric-row*`
- `scenery-cityblock*` / `scenery-citystreet*`
- Dual-layer UV offset carpet code paths
- Uncapped fabric rings
- Heavy realistic scenery pools for Neon/Gridlock (warehouse large, crane, containers, crowd-dense, grandstand-large) — leave files on disk; do not draw in race path
- Optional later: Cargo/Razor can keep a tiny identity set (crane OR stands) once FPS is green — not now

Keep on disk for later revival: skyline backdrop (screen-space only if free), asphalt grit if unused, old realistic cars.

## Success bar (cold review)
1. FPS ≥55 at Neon FAR mid-straight on box / mid hardware (share `docs/shots/*-fps.txt`).
2. Look reads as flat arcade circuit, not empty void of scattered photoreal stamps.
3. Kerbs readable; cars readable; ≤10 unique stamp types in use.
4. No rooftop tile seams, no fabric clone banding, no dual carpet.

## Proofs wanted
Four shots only after cut: Neon race FAR, Neon grid FAR, Gridlock race FAR, Gridlock grid FAR + FPS txt. Box paths under `/workspace/radcars/docs/shots/`.

Pack id when assets land: `vintage-fast-v1`.
