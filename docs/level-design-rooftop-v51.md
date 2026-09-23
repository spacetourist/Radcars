# Rooftop fill v5.1 (FAR lock)

## Why
`67f4745` / radcars-v40 fixed void edges (padWu=1930) and improved fabric banding, but FAR still showed **countable rooftop tile rectangles** — especially dark grid patches on Gridlock. Production lock FAIL on tile rects.

## Assets
- `assets/generated/tex-urban-rooftop-fill.png` — primary soft seamless (replaces procedural v5)
- `tex-urban-rooftop-fill-v51.png` — same as primary
- `tex-urban-rooftop-fill-v51b.png` — second variant for dual-layer / offset
- Old procedural kept as `tex-urban-rooftop-fill-v5-procedural.png`
- Tile proof: `docs/shots/asset-urban-rooftop-fill-v51-tileproof.png`

## Wiring
1. Reload primary rooftop texture from pack (cache-bust).
2. Keep padWu / camera-follow cover from v40.
3. Keep tileScale ~0.12–0.18 (do not raise back to 0.55).
4. Prefer dual TilingSprite: primary + v51b at ~40–50% alpha, UV offset ~(0.37, 0.41), optional slight rotation — kills countable grid.
5. Re-proof four FAR shots only.

## Bar
PASS production lock only when FAR has: zero void edges, **no countable tile rectangles**, banding OK, FPS ≥50.
