# Radcars

Top-down arcade racer (PWA). **v46-long-aligned**: just the cars, the racetrack and the gameplay — plain Canvas 2D, no image assets on the runtime path, no WebGL/Pixi. v46 redraws the cars so the long axis / nose visibly follow the direction of travel and doubles-plus every circuit with smooth B-spline layouts.

## Quick start

```bash
cd /workspace/radcars
python3 -m http.server 4173   # or: npx --yes serve -p 4173
```

Open `http://localhost:4173` (landscape recommended). Live: https://spacetourist.github.io/Radcars/

## Controls

| Action | Keyboard | Touch |
|--------|----------|-------|
| Accelerate | ↑ / W | GAS |
| Brake / reverse | ↓ / S | BRK |
| Steer | ← → / A D | drag the STEER ring toward the direction you want the car to point |
| Pause | P / Esc | ❚❚ |

## Gameplay

- Menu → pick one of 4 tracks (Neon Loop, Gridlock Circuit, Razor Hairpin, Cargo Dock) → 3-2-1 countdown → race.
- Laps, AI rival count (1–7) and AI difficulty in Options. HUD shows lap, position, race time and last/best lap flash.
- Results list finishing order, total times and best laps; best lap per track is saved locally.
- Chase camera pulls out and looks ahead with speed (long-chase framing from v43).

## Code map (`js/`)

| File | Purpose |
|------|---------|
| `tracks.js` | Tracks = closed C2 cubic B-spline centreline (control polygons in 100-wu units) + constant half-width (parallel walls). Resampled every 30 wu; index 0 = start/finish; travel clockwise. `project()` / `pointAt()` helpers, starting grid. |
| `physics.js` | Arcade car model (throttle, brake/reverse, speed-scaled steering, lateral grip), wall constraint via centreline offset, car–car collisions, lap progress (`dist`). |
| `ai.js` | Centreline follower with lane offsets, corner-speed braking, overtaking dodge, stuck recovery. |
| `game.js` | Race loop, countdown, laps/finish, standings, chase camera, HUD info. |
| `render.js` | Canvas 2D: flat ground, asphalt ribbon with kerbs + walls, chequered line, procedural cars (long axis + tapered nose = heading, wheels, stripe, windscreen front, tail-lights back), minimap. |
| `ui.js`, `main.js`, `input.js`, `audio.js`, `career.js`, `cars.js`, `util.js` | Menus/HUD, wiring, keyboard + radial touch input, beeps, saved settings, car factory, maths. |

## Verification

`node docs/verify-core.mjs http://localhost:4173/` drives a real race on every track in headless Chrome (holds throttle, steers via key events), checks the drawn orientation of every car (render transform + canvas pixels vs velocity), and writes `docs/shots/74-*.png` + `docs/shots/74-verify.txt`. `node docs/check-geometry.mjs` fails on self-intersection, wall overlap/folding, tight radii, heading or curvature jumps. Requires `puppeteer-core` in `node_modules` and Chrome at `/usr/bin/google-chrome`.

Legacy art under `assets/` and older docs are no longer used by the app.
