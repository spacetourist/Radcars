# Radcars

Top-down arcade racer (PWA). **v51-toys-pixi**: Micro Machines-style toy cars on a tabletop track, drawn by **PixiJS v8 (WebGL)** by default with the plain Canvas 2D renderer as a fallback (`?canvas=1`, or automatically when WebGL can't start). Menus are CSS/DOM over a city photo backdrop. v47 added a once-per-lap **boost**; v48 removed the brake and added a seeker missile + boost pads; **v49** tightens the turn radius by ~12% at race speed and keeps the player car fully on screen during countdown / race start; **v50** adds a row of glowing **? bonus boxes** per lap that give power-ups (ROCKET, LAP BOOST, AUTOPILOT). Tracks, handling, physics, AI, camera and gameplay are unchanged in v51.

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
| Use power-up (v50) | E | tap the **POWER** panel (left of MISSILE) |
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

### Bonus boxes + power-ups (v50)

- **Boxes:** one row of 2–3 glowing, rocking purple **?** boxes across the road per lap, on a straight clear of hairpins, pads and the line (Neon s=2400 ×3, Gridlock s=1850 ×3, Razor s=10000 ×2, Cargo s=2000 ×2). Drive through one to collect it: that box vanishes for the rest of the lap and every box respawns when you cross the line. Only you collect; AI cars drive straight through. You hold **one** power-up at a time — while holding, boxes stay put and do nothing.
- **Roll:** ROCKET / LAP BOOST / AUTOPILOT with equal odds (autopilot is half as likely while you're P1).
- **Use:** E or tap the **POWER** panel (it shows the held icon + name, and a timer/bar while one runs). One power-up runs at a time; a press while one is running is ignored and you keep the held one.
- **ROCKET:** fires **3 missiles 0.25 s apart**, each at a different car ahead (the nearest three physically ahead among the cars ahead of you in race order; with fewer targets the spares double up, with none they fly straight down the track). Same homing, wall explosions and hit spin as the v48 missile; doesn't touch your lap missile charge.
- **LAP BOOST:** the v47 boost (top +40 %, thrust +70 %) stays on until you next cross the start/finish line (at least 2 s if used just before it). Flames burn **bright green** (#39ff14); normal and pad boosts stay orange.
- **AUTOPILOT:** for **10 s** the car drives itself along the track centreline (pure-pursuit look-ahead 90 + 0.06·speed wu, yaw ≤ 8 rad/s, no sideways slip), throttle pinned, top speed **+25 %** (1250 wu/s); your steering is ignored and rivals get shoved aside. Cyan halo + ring on the car (blinks in the last 1.5 s) and a countdown on the POWER panel. Then a **1.5 s handback**: the extra top speed eases away and the steering assist fades out (any steering input takes over at once).

### Toy look + Pixi renderer (v51)

- **Renderer:** PixiJS v8 WebGL is the default for the race (track, cars, effects, overlays). Pixi is vendored as a lean local bundle (`vendor/pixi-lean.mjs`, WebGL + Graphics + Sprite + Mesh + earcut only: 453 KB, 132 KB gzipped; no CDN) and loaded with a dynamic import after the title's first frame. `?canvas=1` forces the Canvas 2D renderer; if the WebGL probe or Pixi init fails the game falls back to Canvas with a console warning (`window.__RAD_RENDERER__` / `__RAD_GAME__.rendererKind` say which is active). The HUD panels and countdown light are still drawn by the Canvas 2D HUD code, but in Pixi mode into a detached canvas whose changed rectangles are uploaded as small WebGL sprites (only when they change), and the minimap is drawn in the WebGL scene, so there is no full-screen overlay layer to composite.
- **Lean content:** the felt mat is one static mesh covering everything except the road (earcut of a big rect with the outer edge as a hole, plus the infield); the road (rim, kerbs, asphalt, worn band, neon glow + walls, centre dashes) is baked once per track into a cross-section texture on a single strip mesh, so mat + road fill each screen pixel about once per frame (layered ribbons tripled the frame time on software / weak GPUs); pads, grid boxes and the chequered line are small static Graphics; cars are textures baked from the toy art (one per car style, HD at devicePixelRatio, capped at 2) drawn as rotated Sprites with a pre-baked soft shadow; flames, halos, box glow are pre-baked textures. No per-frame shadowBlur, no filters, no scenery.
- **Toy cars:** glossy gradient body, specular streak, dark outline, chunky tyres, soft offset shadow, windscreen glint, headlights + tail-lights, roof number disc. Variants by car: player = cyan sports car with the white arrow marker; rivals mix hatch (#23 twin stripes, #99 chequer), F1 (#7 dark trim + pink helmet, #5 white wings + yellow helmet), pickup (#11 chequer), muscle (#42 twin stripes, #64 red stripe) and sports (#88 dark roof). Silhouettes keep the long axis + nose = heading.
- **Track look:** felt play-mat per track theme with a faint dot grid, grainy asphalt with a worn centre band and the dashed centreline, chunky shaded red/white kerbs (#e02020/#e8e8e8), a raised-piece shadow, neon edge glow (wide low-alpha stroke under the wall line), painted grid boxes.
- **Menus:** dark glass + neon pill buttons (≥ 48 px) over Callum's rainy city photo (`assets/menu/`: dim for the title, blurred for select/options/results, a portrait crop in portrait), lazy-loaded after first paint with a dark gradient fallback, slow 20 s pan/zoom, hidden and never requested during races. Italic logo with a cyan→pink glow and chequer underline, live toy-car parade on the title, track cards with a neon minimap outline and a toy car lapping, a podium of toy cars on the results. Pause dims the live race. Lays out on desktop, 844×390 landscape phones and portrait phones; races stay landscape.

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
| `weapons.js` | Seeker missile (targeting, guidance, wall/hit tests, trail; untargeted rocket missiles follow the track), spin-out state, boost-pad triggers. |
| `powerups.js` | v50 bonus boxes + power-ups: roll odds, box pickup, rocket target choice, autopilot rail steering / handback assist, autopilot stats. |
| `pixiRender.js` | v51 default race renderer (PixiJS v8 WebGL): felt mat mesh with the road cut out, road baked once into a cross-section texture on one strip mesh, toy-car sprite textures per style at DPR ≤ 2, pre-baked flame/halo/glow textures, pooled sprites for trails/missiles/fx, minimap in-scene, HUD panels as sprites uploaded only on change. Same API as `render.js`. |
| `toyart.js` | v51 toy car art (variants, gloss, stripes, numbers, lights, shadow sprite) and the felt/asphalt noise tiles, shared by both renderers. |
| `render.js` | Canvas 2D (fallback renderer + HUD overlay in Pixi mode): felt ground, asphalt ribbon with kerbs + walls, chequered line, procedural cars (long axis + tapered nose = heading, wheels, stripe, windscreen front, tail-lights back), minimap, boost flames (any car), boost pads, missile + smoke trail + explosions, bonus boxes, autopilot glow, green lap-boost flames, BOOST and MISSILE panels. |
| `ui.js` | v51 CSS/DOM menus: photo backdrop (lazy), title with toy parade, track cards with lapping previews, options, pause, results podium, HUD. |
| `main.js`,  `input.js`, `audio.js`, `career.js`, `cars.js`, `util.js` | Renderer choice (Pixi / `?canvas=1` / auto-fallback) + wiring, keyboard + radial touch input, beeps, saved settings, car factory, maths. |

## Verification

`node docs/verify-core.mjs http://localhost:4173/` drives a real race on every track in headless Chrome (holds throttle, steers via key events), checks the drawn orientation of every car (render transform + canvas pixels vs velocity), and writes `docs/shots/74-*.png` + `docs/shots/74-verify.txt`. `node docs/verify-boost.mjs http://localhost:4173/` races all 4 tracks while testing the boost (Shift + a touch slide on GAS in a mobile viewport, last-place unlimited boosts, lap charge used/refilled, pause), measures the speed gain, and writes `docs/shots/75-*.png` + `docs/shots/75-verify.txt`. `node docs/verify-v48.mjs http://localhost:4173/` races all 4 tracks (3 laps, 5 AI, Normal) checking the missile (Space + left slide on mobile, charge per lap, hit rate, 360° spin + speed loss), pads for player and AI, brake removal and auto-unstick, and writes `docs/shots/76-*.png` + `docs/shots/76-verify.txt`. `node docs/verify-v50.mjs http://localhost:4173/` races all 4 tracks (3 laps, 5 AI, Normal) checking the bonus boxes (one row per lap, pickup, respawn at the line, hold-blocks-pickup) and each power-up forced via `__RAD_GAME__.debug.give()` and collected from a box (rocket: 3 distinct targets, hits + spins; lap boost: green until the line; autopilot: 10 s, wall contacts, centreline deviation, speed, handback), E and a touch tap on POWER in a mobile viewport, missile/boost/pads, finishes and fps; writes `docs/shots/78-*.png` + `docs/shots/78-verify.txt`. `node docs/verify-v51.mjs http://localhost:4173/` measures FPS for Pixi vs the Canvas fallback (Neon + Gridlock, desktop 1280×720 and phone 844×390, close race zoom 0.85 and the far chase zoom ≈0.24, CPU ×1 and ×4) and shoots the toy cars on every track (grid, corner, close-up, boost / green flame / autopilot / spin), every menu on desktop, phone and portrait, touch-target sizes, the menu photo never loading in a race, and `?canvas=1` comparison shots; writes `docs/shots/79-*.png` + `docs/shots/79-verify*.txt`. All verify scripts run against either renderer (append `?canvas=1` for the fallback); the pixel checks read the active renderer via `__RAD_GAME__.readPixels`. `node docs/check-geometry.mjs` fails on self-intersection, wall overlap/folding, tight radii, heading or curvature jumps. Requires `puppeteer-core` in `node_modules` and Chrome at `/usr/bin/google-chrome`.

Legacy art under `assets/` and older docs are no longer used by the app.
