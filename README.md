# Radcars

Top-down arcade racer (PWA). **v49-turn-cam**: just the cars, the racetrack and the gameplay — plain Canvas 2D, no image assets on the runtime path, no WebGL/Pixi. v47 added a once-per-lap **boost**; v48 removed the brake and added a seeker missile + boost pads; **v49** tightens the turn radius by ~12% at race speed and keeps the player car fully on screen during countdown / race start. Tracks, missile, boost, pads and car drawing are unchanged.

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
| Seeker missile | Space | slide your thumb **left** from GAS (about 40 px); keep holding for throttle |
| Slow down | lift off the gas (there is no brake) | let go of GAS |
| Steer | ← → / A D | drag the STEER ring toward the direction you want the car to point |
| Pause | P / Esc | ❚❚ |

### Boost

- **2 s** of boost: the top-speed cap rises by **40 %** (1000 → 1400 wu/s) and thrust by **70 %**, ramped in over ~0.2 s and out over ~0.45 s, then the car eases back to normal speed. Steering and grip are unchanged.
- **One charge per lap.** You have a charge from the start (usable from GO); crossing the start/finish line refills it. It never stacks above 1, and a second press while a boost is running does nothing.
- **Last place = unlimited.** While you're last a boost costs nothing and you can fire another as soon as the current one ends (the lap charge is kept).
- The indicator above GAS shows **BOOST READY**, **BOOST** with a countdown bar while active, **BOOST USED** (refills at the line), or magenta **∞ LAST · UNLIMITED**. Your car shows exhaust flames and speed streaks while boosting. Only you can fire the lap boost; the AI only boosts from pads.
- Pausing freezes the boost timer, and any boost press made while paused is ignored. A new race or restart resets the boost.

### Seeker missile (v48)

- **One per lap**, usable from GO, refilled at the start/finish line, never more than 1. Ignored during the countdown and while paused. Diagonal slides on GAS fire only the dominant direction (up = boost, left = missile).
- Launches from your nose and locks onto the car ahead of you in race order (the physically nearest one ahead along the track). It flies at **2000 wu/s** (boosted top speed is 1400) with a **3.0 rad/s** turn limit, follows the track and then homes in with lead, and lives **3.5 s**. It **explodes on wall contact** (and self-destructs if it overshoots its target), so it's not a sure thing: roughly 70 % hit rate when the target is within 1500 wu.
- **In P1 there's no target**: the shot is refused with a **NO TARGET** flash and you keep your charge.
- A hit makes the car do one full **360° spin over 1 s**, cuts it to **30 %** speed, and it can't steer or accelerate until it recovers. Explosion puff + sound.
- The **MISSILE** panel (left of BOOST) shows READY / IN FLIGHT / USED — refills at the line, plus a HIT! or MISS flash.

### Boost pads (v48)

- Amber chevrons on the asphalt (3–4 per track, on straights and corner exits) pointing in the direction of travel. Any car — you or the AI — crossing one gets a free **0.5 s** boost at the same strength as the lap boost. Pads don't use your lap charge and don't stack (re-hitting just tops the remaining time back up to 0.5 s). All cars show flames while pad-boosted.

### No brake

- The brake and reverse keys are gone; lift off the gas to scrub speed. If you end up nose-first against a wall at near-zero speed for ~1.5 s while holding gas, the car automatically reverses briefly (steering its nose back toward the road) and then drives on.

### Updates (PWA)

- The service worker activates new builds immediately (`skipWaiting` + `clients.claim`) and fetches same-origin files network-first with `cache: 'no-store'` (Cache Storage is only the offline fallback); `js/version.js` is the single source of truth for the build (`v48 · missile`, cache `radcars-v48-missile`): `index.html` always fetches it fresh, and it writes the stylesheet, an import map and the main module with `?b=<build>` on every URL, so no cache can mix old and new modules. The title screen shows the build and an **Update / hard refresh** button (unregisters all service workers, deletes all caches, re-downloads the files and reloads with `?r=<timestamp>`). The page checks for an update on load and whenever it becomes visible again, and when a new worker takes over it reloads once — but never mid-race: the reload waits for the menu or results screen. `node docs/verify-sw-update.mjs` checks this end-to-end (a v47 tab moving to v48 without closing it, mid-race deferral, instant reload on the menu).

### Tighter turn + camera (v49)

- **Turn:** `MAX_TURN` raised from 2.9 → 3.3 rad/s. At 1000 wu/s the kinematic circle shrinks from ~530 wu to ~466 wu (~12% tighter). Grip and top speed are unchanged.
- **Camera:** countdown / low-speed look-ahead is clamped so the player's AABB stays inside the view with ~10% of the shorter screen side as margin (hard-corrected after smoothing). High-speed chase pull-out is unchanged. Fixes the bug where a short viewport (mobile landscape) could leave the car off-screen at the start.

## Gameplay

- Menu → pick one of 4 tracks (Neon Loop, Gridlock Circuit, Razor Hairpin, Cargo Dock) → 3-2-1 countdown → race.
- Laps, AI rival count (1–7) and AI difficulty in Options. HUD shows lap, position, race time and last/best lap flash.
- Results list finishing order, total times and best laps; best lap per track is saved locally.
- Chase camera pulls out and looks ahead with speed (long-chase framing from v43).

## Code map (`js/`)

| File | Purpose |
|------|---------|
| `tracks.js` | Tracks = closed C2 cubic B-spline centreline (control polygons in 100-wu units) + constant half-width (parallel walls). Resampled every 30 wu; index 0 = start/finish; travel clockwise. `project()` / `pointAt()` helpers, starting grid. |
| `physics.js` | Arcade car model (throttle, brake/reverse for AI + auto-unstick, speed-scaled steering, lateral grip, boost level → top-speed/thrust multipliers), wall constraint via centreline offset, car–car collisions, lap progress (`dist`). |
| `ai.js` | Centreline follower with lane offsets, corner-speed braking, overtaking dodge, stuck recovery. |
| `game.js` | Race loop, countdown, laps/finish, standings, boost charge/timer/last-place rule, missile charge, pads, auto-unstick, chase camera, HUD info. |
| `weapons.js` | Seeker missile (targeting, guidance, wall/hit tests, trail), spin-out state, boost-pad triggers. |
| `render.js` | Canvas 2D: flat ground, asphalt ribbon with kerbs + walls, chequered line, procedural cars (long axis + tapered nose = heading, wheels, stripe, windscreen front, tail-lights back), minimap, boost flames (any car), boost pads, missile + smoke trail + explosions, BOOST and MISSILE panels. |
| `ui.js`, `main.js`, `input.js`, `audio.js`, `career.js`, `cars.js`, `util.js` | Menus/HUD, wiring, keyboard + radial touch input, beeps, saved settings, car factory, maths. |

## Verification

`node docs/verify-core.mjs http://localhost:4173/` drives a real race on every track in headless Chrome (holds throttle, steers via key events), checks the drawn orientation of every car (render transform + canvas pixels vs velocity), and writes `docs/shots/74-*.png` + `docs/shots/74-verify.txt`. `node docs/verify-boost.mjs http://localhost:4173/` races all 4 tracks while testing the boost (Shift + a touch slide on GAS in a mobile viewport, last-place unlimited boosts, lap charge used/refilled, pause), measures the speed gain, and writes `docs/shots/75-*.png` + `docs/shots/75-verify.txt`. `node docs/verify-v48.mjs http://localhost:4173/` races all 4 tracks (3 laps, 5 AI, Normal) checking the missile (Space + left slide on mobile, charge per lap, hit rate, 360° spin + speed loss), pads for player and AI, brake removal and auto-unstick, and writes `docs/shots/76-*.png` + `docs/shots/76-verify.txt`. `node docs/check-geometry.mjs` fails on self-intersection, wall overlap/folding, tight radii, heading or curvature jumps. Requires `puppeteer-core` in `node_modules` and Chrome at `/usr/bin/google-chrome`.

Legacy art under `assets/` and older docs are no longer used by the app.
