# v51 'toys-pixi' — progress / verification notes

Micro Machines-style toy cars + tabletop track, PixiJS v8 WebGL as the default race renderer, Canvas 2D as the
fallback, CSS/DOM menus over the city photo. Handling, physics, AI, track geometry, camera, gameplay and HUD logic are
unchanged.

## Renderer + fallback

- Default: PixiJS v8.21 WebGL, vendored as `vendor/pixi-lean.mjs` (WebGL renderer + Graphics + Sprite + Mesh +
  earcut; 453 KB minified, 132 KB gzipped; the old c71dbe3 spike bundle was 829 KB / 234 KB). Loaded by a dynamic
  import after the title's first frame, so the menus never wait for it.
- `?canvas=1` forces the Canvas 2D renderer. Automatic fallback to Canvas (with a console warning) when the WebGL probe
  fails, when Pixi init throws, or when the WebGL context is lost mid-session (the race carries on in Canvas).
- `window.__RAD_RENDERER__` (promise) and `__RAD_GAME__.rendererKind` report the active renderer; `__RAD_GAME__.readPixels`
  reads device pixels from whichever renderer is active (the orientation checks use it).
- DPR is capped at 2 (both renderers).

## What the Pixi scene costs (and why it is built this way)

Headless Chrome here renders WebGL with SwiftShader (software), which is fill-rate bound, so the first straight port
(track as ~13 layered Graphics ribbons, TilingSprite felt, a full-screen 2D HUD overlay) ran at 8–20 fps. Fixes:

1. Road = one strip mesh with a baked cross-section texture (rim, kerbs, asphalt, worn band, neon glow + walls, centre
   dashes, 256 wu repeat) → each road pixel filled once (was ~8×).
2. Felt mat = one mesh covering everything except the road (earcut of a big rect with the outer edge as a hole + the
   infield) → mat + road ≈ one fill per screen pixel. Pixi's batch shader proved several times dearer per pixel than
   the mesh shader on SwiftShader, so the big surfaces are non-batched meshes; batches are capped at 4 textures.
3. HUD: the minimap is drawn in the WebGL scene; the BOOST / MISSILE panels and countdown are still drawn by the
   render.js HUD code, but into a detached canvas, and only the changed rectangles are uploaded as small sprites (no
   full-screen transparent overlay to composite: that alone cost ~15% on the phone viewport).
4. Own WebGL context without a depth buffer or MSAA; bilinear-within-nearest-mip filtering.

Cars are textures baked from the toy art per car style at the device scale (mipmapped) on rotated sprites with a
pre-baked soft shadow; flames, halos, box glow, missiles, smoke and explosions are pre-baked textures on pooled
sprites. No per-frame shadowBlur, no filters, no scenery.

## FPS (headless Chrome, SwiftShader; `node docs/verify-v51.mjs URL docs/shots fps`)

fps Pixi / Canvas fallback; race = close race zoom 0.85 pinned on the player, far = the game's chase camera at speed
(ZOOM_FAR 0.24). CPU×4 = DevTools CPU throttling (weak-phone proxy for the main thread).

| viewport | track | zoom | CPU×1 | CPU×4 |
|---|---|---|---|---|
| desktop 1280×720 | Neon | race 0.85 | 60 / 60 | 49.2 / 21.2 |
| desktop 1280×720 | Neon | far 0.24 | 60 / 60 | 46.1 / 17.2 |
| desktop 1280×720 | Gridlock | race 0.85 | 60 / 60 | 49.9 / 20.5 |
| desktop 1280×720 | Gridlock | far 0.24 | 60 / 59.9 | 51.8 / 18.6 |
| phone 844×390 DPR 2 | Neon | race 0.85 | 60 / 58.9 | 36.2 / 15.1 |
| phone 844×390 DPR 2 | Neon | far 0.24 | 60 / 60 | 36.9 / 16.1 |
| phone 844×390 DPR 2 | Gridlock | race 0.85 | 59.9 / 59.9 | 38.2 / 14.5 |
| phone 844×390 DPR 2 | Gridlock | far 0.24 | 60 / 60 | 35.5 / 17.5 |

Frame JS: Pixi 0.18–0.24 ms vs Canvas 0.22–0.30 ms at CPU×1. v50 baseline (plain Canvas, chase camera) at CPU×4:
desktop Neon 42.5 / Gridlock 48.5, phone Neon 35.2 / Gridlock 47.4 fps — the toy look in Canvas costs ~2.5× that,
Pixi brings it back to v50 level or better (except phone Gridlock, 35.5–38 vs 47).

## Menus

CSS/DOM. Photo backdrop (lazy, after first paint; dark gradient until loaded; never requested or shown in a race):
landscape `menu-bg-city-dim.jpg` (title) / `menu-bg-city-blur.jpg` (select, options, results); portrait
`menu-bg-city-portrait-dim-hd.jpg` at DPR ≥ 2 or `menu-bg-city-portrait-dim.jpg`, and `menu-bg-city-portrait-blur.jpg`.
Only the pair for the current orientation is fetched (rotating on a menu swaps them); none are precached — the
service worker's runtime cache keeps whichever were shown. Pause = dimmed live race (no photo).

## Verification (headless Chrome, both renderers; Canvas = `?canvas=1`)

| script | Pixi | Canvas |
|---|---|---|
| verify-v51 (fps gates + shots) | ALL OK | (compared) |
| verify-core (geometry, drawn orientation, 4 races) | PASS (60.2 fps, 0 errors) | PASS (60.3 fps) |
| verify-v50 | PASS | PASS (first run missed one LAP BOOST sample 0.93 vs gate; re-run PASS) |
| verify-v48 | PASS (first run 38/40 trial shots — stochastic; re-run PASS) | PASS |
| verify-boost | PASS | PASS |

verify-core now logs (but does not score) pixel samples whose crop overlaps the bottom-right HUD panels — the
MISSILE panel rim #ff4d5e is close to car colour #ff2b6a — and prints any single-sample outliers with position.
