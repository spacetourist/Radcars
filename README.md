# Radcars

Top-down arcade racer (PWA). **v45-core**: radically simplified to just the cars, the racetrack and the gameplay — plain Canvas 2D, no image assets on the runtime path, no WebGL/Pixi.

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
| `tracks.js` | Tracks = closed centreline + constant half-width (parallel walls). Resampled; index 0 = start/finish. `project()` / `pointAt()` helpers, starting grid. |
| `physics.js` | Arcade car model (throttle, brake/reverse, speed-scaled steering, lateral grip), wall constraint via centreline offset, car–car collisions, lap progress (`dist`). |
| `ai.js` | Centreline follower with lane offsets, corner-speed braking, overtaking dodge, stuck recovery. |
| `game.js` | Race loop, countdown, laps/finish, standings, chase camera, HUD info. |
| `render.js` | Canvas 2D: flat ground, asphalt ribbon with kerbs + walls, chequered line, procedural cars (nose = heading, windscreen towards the front), minimap. |
| `ui.js`, `main.js`, `input.js`, `audio.js`, `career.js`, `cars.js`, `util.js` | Menus/HUD, wiring, keyboard + radial touch input, beeps, saved settings, car factory, maths. |

## Verification

`node docs/verify-core.mjs http://localhost:4173/` drives a real race on every track in headless Chrome (holds throttle, steers via key events), logs player position / heading vs velocity every 0.5 s and writes `docs/shots/73-core-*.png` + `docs/shots/73-core-verify.txt`. Requires `puppeteer-core` in `node_modules` and Chrome at `/usr/bin/google-chrome`.

Legacy art under `assets/` and older docs are no longer used by the app.
