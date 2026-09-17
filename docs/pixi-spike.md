# PixiJS v8 race-render spike (Phase B)

Graphic Designer approved this spike in parallel with Canvas A.1. Physics, `tracks.js`, input, and the Canvas renderer stay intact when the flag is **off**.

## How to enable

| Method | Value |
|--------|--------|
| Query string | `?pixi=1` (or `?pixi=true`) |
| Disable override | `?pixi=0` |
| Persist | `localStorage.setItem('radcarsPixi', '1')` then reload |

Default is **off** — normal Canvas play is unchanged.

## What this ports

- **Pixi Application** covering the race view (`#pixi-game`); Canvas `#game` kept for resize math but hidden via `.rad-pixi-hidden`.
- **Layer order** (back → front): skyline (screen-space) → ground plate → far → mid → track (half-res baked canvas texture) → near → cars → FX stub → countdown text.
- **Pack textures** as Pixi `Sprite`s from existing scenery stamps (already bake-capped in `assetPack.js` — no unbound 1280 plates).
- **Camera** matches game cam (screen-centre translate, `scale(zoom)`, pivot on cam x/y).
- **Cars** as sprites from `createSpriteBank()` frames at world x/y.
- **Track** baked once per track id at 0.5× into a canvas texture.

## Still Canvas (not ported)

- Weapons / mines / projectiles / boom particles
- Minimap
- Full kerb / gantry / asphalt grit detail (track bake is simplified)
- Menu / UI / HUD chrome
- Screen shake / full FX stack
- Shipping flag default-on (stays off)

## Files

| Path | Role |
|------|------|
| `js/pixiRender.js` | Pixi stage, layers, draw path (`isPixiFlagOn`, `createPixiRenderer`) |
| `vendor/pixi.min.mjs` | Vendored Pixi v8 ESM (~812KB) for offline / Pages |
| `js/game.js` | Flag gate: skip Canvas world draw when Pixi ready |
| `package.json` | `pixi.js@^8` for installs / upgrades |
| `index.html` | `importmap` → `pixi.js` → vendor bundle |
| `sw.js` | Lists `pixiRender.js` + vendor; cache `radcars-v36-pixi-spike` |

## Dependency / serve notes

```bash
npm install          # installs pixi.js@8
npm start            # static serve
# or: python3 -m http.server 4173
```

Runtime import uses **`../vendor/pixi.min.mjs`** (offline-friendly). Same bytes as `node_modules/pixi.js/dist/pixi.min.mjs`.

## Success check

1. Open `/` — Canvas Neon Loop plays as before.
2. Open `/?pixi=1` — Pixi stage shows Neon Loop with skyline + ground tint + city stamps + cars under the same camera (`window.__RAD_PIXI_READY__ === true`, `#pixi-game` present).
3. Layers ordered; scenery from pack-baked stamps (Md/Sm), not raw 1280 plates.

## Blockers / follow-ups

- First frames may Canvas-draw until `createPixiRenderer` resolves, then switch.
- Weapons/FX/minimap invisible under Pixi until ported.
- Parent owns git commit / push; SW cache name can be retuned on ship.
