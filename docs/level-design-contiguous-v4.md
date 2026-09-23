# Contiguous city level design (v4) — Graphic Designer brief

**Ship bar:** at ZOOM_FAR on Neon Loop / Gridlock, the player cannot count isolated rectangular stamps. The world reads as one continuous night city. Stamp-farm / perimeter-bead placement is rejected.

Pixi is the race renderer. Canvas is fallback only.

## What failed

Beading `cityblock` / `citystreet` plates along the track with large `beadOut` / `beadIn` gaps produces islands on a dark plate. FPS is fine (~60). Look is not.

## Required architecture (Neon + Gridlock)

1. **Ground (full world AABB):** tile `tex-urban-lot-tile.png` once under the entire track bounds (Pixi TilingSprite). No cyan debug grid. No empty `#07080c` voids in frame.
2. **City fabric ring:** place `cityfabric-row` + cityblock/street trio along outer AND inner walls with **15–25% AABB overlap**. Caps may rise; prefer fewer larger abutting plates over many tiny islands.
3. **Infield fill:** solid. If infield is visible at far zoom, it is filled with lot tile + fabric — never empty.
4. **Outfield fill:** same out to ~1.2× track AABB or camera frustum padding.
5. **Anti-clone:** full trio (`base` / `-b` / `-c`) + pixel-identical = same source; no same source within 400wu.
6. **Landmark accents only:** billboards, tower — sparse. Never warehouse on Neon/Gridlock.
7. **Track ribbon:** keep closed contiguous outer/inner polygons; restore kerb/groove detail in Pixi track bake (not gold batwing deco as the only identity).

## Success proofs (required)

- Neon + Gridlock: race + grid, near zoom AND ZOOM_FAR (`?pixi=1`)
- FPS line still ≥50 at ZOOM_FAR Neon mid-straight
- Cold review: zero countable stamp islands; zero billboard UV bugs; cars not piled at grid

## Assets

| File | Role |
|------|------|
| `assets/generated/tex-urban-lot-tile.png` | Seamless world ground tile |
| `assets/generated/scenery/scenery-cityfabric-row.png` | Edge-to-edge connected city row |
| cityblock / -b / -c, citystreet / -b / -c | Variant accents inside fabric |

Manifest pack: `realistic-v4-contiguous-city`
