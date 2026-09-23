# City carpet level design (v5) — Graphic Designer brief

**Ship bar:** at ZOOM_FAR on Neon Loop / Gridlock (race + grid), the player **cannot count isolated rectangular stamps**. The world reads as one continuous night city carpet. Stamp-farm / perimeter-bead / checkerboard-lot infield is rejected.

Pixi is the race renderer. Canvas is fallback only.

Manifest pack: `realistic-v5-city-carpet`

## What failed (v4 / 2ff8e25 cold review)

Contiguous v4 (`realistic-v4-contiguous-city`) still FAILED cold review:

- **ZOOM_FAR** showed isolated rectangular city stamps on a dark **checkerboard urban lot** tile.
- Meta: Neon `nearRaw 288 → near capped 18`; only ~20 `cityfabric` plates — caps starved the carpet.
- Warehouse scrub OK. FPS ~60.2 OK. Look is not.

Root causes to fix in placement (Developer), not more FPS work:

1. Mid/near/far **caps** crushed fabric density.
2. Infield relied on bare `tex-urban-lot-tile` (reads as empty parking checkerboard).
3. Too few abutting plates; hard rect edges still countable.

## Assets (v5)

| File | Role |
|------|------|
| `assets/generated/scenery/scenery-cityfabric-row.png` | Edge-to-edge city row (kept) |
| `assets/generated/scenery/scenery-cityfabric-row-b.png` | Variant B — rooftop-heavy, fewer streets; warm sodium + purple neon; **baked soft alpha ~28px** |
| `assets/generated/scenery/scenery-cityfabric-row-c.png` | Variant C — denser midrise apartments + alley glow; **baked soft alpha ~32px** |
| `assets/generated/tex-urban-rooftop-fill.png` | **Primary** seamless 1:1 infield/outfield carpet — dense night rooftops / HVAC / wet alleys (true top-down) |
| `assets/generated/tex-urban-lot-tile.png` | Fallback only; do **not** rely on bare lot as the visible infield |
| cityblock / -b / -c, citystreet / -b / -c | **Sparse accents only** — never the fabric |

Preview shots: `docs/shots/asset-cityfabric-row-b.png`, `asset-cityfabric-row-c.png`, `asset-urban-rooftop-fill.png`.

### Alpha / edge notes

- Fabric rows prefer baked soft transparent edges (alpha falloff ~24–40px) so abutting plates do not show hard rects. v5 plates ship with ~28–32px falloff.
- If any rect edge remains visible in-engine, use **30%+ overlap** and/or Developer soft-mask.
- Rooftop fill is opaque seamless (no chroma). Magenta chroma is **not** required for opaque ground tiles.

## Placement requirements (Neon + Gridlock)

1. **Kill mid/near/far caps for cityfabric** on Neon/Gridlock (or exempt fabric from caps entirely). Caps that turn `nearRaw 288 → 18` recreate stamp islands.
2. **Place fabric by wall length / plate world-width** with **25–40% overlap** — continuous rings on **BOTH** walls (outer + inner).
3. **Carpet infield + outfield** with `tex-urban-rooftop-fill` as a Pixi `TilingSprite` (or a dense overlapping fabric grid) so there is **no countable void**. Do not leave bare lot alone as the visible carpet.
4. **cityblock / citystreet trio = sparse accents only**, not the fabric.
5. **Soft alpha** on fabric plate edges **OR** 30%+ overlap until rect edges are invisible.
6. **Track asphalt between kerbs** (not a yellow line floating on void). Keep closed contiguous outer/inner polygons; restore kerb/groove detail in the Pixi track bake.
7. Anti-clone: rotate `cityfabric-row` / `-b` / `-c`; pixel-identical = same source; no same source within 400wu.
8. Landmark accents only: billboards, tower — sparse. **Never warehouse** on Neon/Gridlock.

## Success proofs (required)

- Neon + Gridlock: race + grid, near zoom **and** ZOOM_FAR (`?pixi=1`)
- FPS line still ≥50 at ZOOM_FAR Neon mid-straight
- **Bar:** cannot count isolated rectangular stamps at ZOOM_FAR; infield does not read as empty parking checkerboard; cars not piled at grid; no billboard UV bugs

## Handoff

- Graphic Designer: assets on disk + manifest + this doc.
- Developer / Neon: wire `cityCarpet` mode — rooftop-fill ground tile, fabric-cap exemption, 25–40% overlap rings, sparse accents.
