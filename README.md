# Radcars

Top-down arcade racer (PWA). **v47-boost**: just the cars, the racetrack and the gameplay — plain Canvas 2D, no image assets on the runtime path, no WebGL/Pixi. v47 adds a once-per-lap **boost** (unlimited while you're last) on top of the v46 handling, tracks and cars, which are unchanged.

## Quick start

```bash
cd /workspace/radcars
python3 -m http.server 4173   # or: npx --yes serve -p 4173
```

Open `http://localhost:4173` (landscape recommended). Live: https://spacetourist.github.io/Radcars/

## Controls

| Action | Keyboard | Touch |
|--------|----------|-------|
| Accelerate | ↑ / W | GAS (press and hold) |
| Boost | Shift | slide your thumb **up** from GAS (about 40 px); keep holding for throttle |
| Brake / reverse | ↓ / S | BRK |
| Steer | ← → / A D | drag the STEER ring toward the direction you want the car to point |
| Pause | P / Esc | ❚❚ |

### Boost

- **2 s** of boost: the top-speed cap rises by **40 %** (1000 → 1400 wu/s) and thrust by **70 %**, ramped in over ~0.2 s and out over ~0.45 s, then the car eases back to normal speed. Steering, grip and braking are unchanged.
- **One charge per lap.** You have a charge from the start (usable from GO); crossing the start/finish line refills it. It never stacks above 1, and a second press while a boost is running does nothing.
- **Last place = unlimited.** While you're last a boost costs nothing and you can fire another as soon as the current one ends (the lap charge is kept).
- The indicator above GAS shows **BOOST READY**, **BOOST** with a countdown bar while active, **BOOST USED** (refills at the line), or magenta **∞ LAST · UNLIMITED**. Your car shows exhaust flames and speed streaks while boosting. Only you can boost; the AI can't.
- Pausing freezes the boost timer, and any boost press made while paused is ignored. A new race or restart resets the boost.

## Gameplay

- Menu → pick one of 4 tracks (Neon Loop, Gridlock Circuit, Razor Hairpin, Cargo Dock) → 3-2-1 countdown → race.
- Laps, AI rival count (1–7) and AI difficulty in Options. HUD shows lap, position, race time and last/best lap flash.
- Results list finishing order, total times and best laps; best lap per track is saved locally.
- Chase camera pulls out and looks ahead with speed (long-chase framing from v43).

## Code map (`js/`)

| File | Purpose |
|------|---------|
| `tracks.js` | Tracks = closed C2 cubic B-spline centreline (control polygons in 100-wu units) + constant half-width (parallel walls). Resampled every 30 wu; index 0 = start/finish; travel clockwise. `project()` / `pointAt()` helpers, starting grid. |
| `physics.js` | Arcade car model (throttle, brake/reverse, speed-scaled steering, lateral grip, boost level → top-speed/thrust multipliers), wall constraint via centreline offset, car–car collisions, lap progress (`dist`). |
| `ai.js` | Centreline follower with lane offsets, corner-speed braking, overtaking dodge, stuck recovery. |
| `game.js` | Race loop, countdown, laps/finish, standings, boost charge/timer/last-place rule, chase camera, HUD info. |
| `render.js` | Canvas 2D: flat ground, asphalt ribbon with kerbs + walls, chequered line, procedural cars (long axis + tapered nose = heading, wheels, stripe, windscreen front, tail-lights back), minimap, boost flame + boost indicator. |
| `ui.js`, `main.js`, `input.js`, `audio.js`, `career.js`, `cars.js`, `util.js` | Menus/HUD, wiring, keyboard + radial touch input, beeps, saved settings, car factory, maths. |

## Verification

`node docs/verify-core.mjs http://localhost:4173/` drives a real race on every track in headless Chrome (holds throttle, steers via key events), checks the drawn orientation of every car (render transform + canvas pixels vs velocity), and writes `docs/shots/74-*.png` + `docs/shots/74-verify.txt`. `node docs/verify-boost.mjs http://localhost:4173/` races all 4 tracks while testing the boost (Shift + a touch slide on GAS in a mobile viewport, last-place unlimited boosts, lap charge used/refilled, pause), measures the speed gain, and writes `docs/shots/75-*.png` + `docs/shots/75-verify.txt`. `node docs/check-geometry.mjs` fails on self-intersection, wall overlap/folding, tight radii, heading or curvature jumps. Requires `puppeteer-core` in `node_modules` and Chrome at `/usr/bin/google-chrome`.

Legacy art under `assets/` and older docs are no longer used by the app.
