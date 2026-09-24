# Vintage Fast — Dev ship note (engine pivot)

**GD brief (source of truth):** `docs/level-design-vintage-fast-v1.md`  
**Style:** `vintage-sprint` · **SW:** `radcars-v44-vintage-fast` · **Pack:** `vintage-fast-v1`

## What Dev shipped

Neon Loop + Gridlock (canvas default; Pixi `?pixi=1` also gutted):

| Layer | Behaviour |
|-------|-----------|
| Outfield | `#0c0c12` solid |
| Infield | `#1e3a28` solid |
| Asphalt | `#2a2a32` flat |
| Kerbs | Procedural `#e02020` / `#e8e8e8` |
| Cars | vintage `car-cyan/pink/lime` chroma |
| Roadside | ≤16 sparse stamps (tree/lamp/cone/tyre/billboard + 1 gantry) |

**OFF race path (files remain on disk):** dual rooftop TilingSprites, lot tile, cityfabric-row*, cityblock*, citystreet*, heavy warehouse/crane/containers/crowd-dense/grandstand-large for Neon/Gridlock. City-carpet production-lock **PAUSED**.

**Kept:** long courses, chase cam, ZOOM_FAR 0.24. Razor/Cargo untouched this pass.

## Proofs

`docs/shots/71-*-vintage-fast*.png` + `*-fps.txt`.
