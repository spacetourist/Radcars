# v54.8 "drift": progress and notes (branch `v548`, not on main)

Status: implemented and verified on branch `v548`, which is v54.7 (2d324d9) plus GD's drift art (cherry-pick of 2904df8) plus this
work. **Not pushed to main**: GD reviews the shots first.

## How it feels

You're flat out into a corner, you hold DRIFT and lean on the steer. The car snaps into the slide in about 70 ms: you hear a hard
tyre bite with the engine flaring under it, the button flares orange and its little car tilts into the slide. The tail swings to
about 20°. Push the steer harder into the corner and it opens up to a held 45° at most, then just sits there. The car goes
where the steer points and turns about 1.3× tighter than gripping, so you're steering the slide, not catching it. Nothing spins.
Speed bleeds off gently (it's floored near 360 wu/s), the scrub sound gets rougher and brighter as the angle grows, and thick
warm-grey smoke rolls off the rear tyres. Thin puffs at 20°, a solid trail at 45°. Dark double skid lines are laid only while
you drift. Let go and the nose and the travel swing back together in about 50 ms without losing speed. You get a short grip-catch
chirp, and on a clean drift of 0.6 s or more a DRIFT BOOST (or PERFECT DRIFT) with its whoosh. Hold it past 4 s, scrub below
240 wu/s or clip a wall and it straightens itself with a duller chirp and no boost. DRIFT with no steer does nothing, so it's
never a brake, and the right-thumb layout is unchanged (DRIFT sits where HANDBRAKE was; keyboard Down / S).

## Mechanic (js/physics.js `stepDrift`)

- Entry: `ctl.driftBtn` held, speed ≥ DRIFT_MIN_SPD 380, |steer| ≥ 0.4 (smoothed, measured against the travel direction).
  Re-armed on release. Never on autopilot, spinning, finished or handback (`ctl.noDrift`).
- Hold: β eases (τ 0.12 s) toward 20° + 25°·|steer into the slide|. The travel turns at 1.3× the grip turn rate. Speed scrubs
  110–300 wu/s² with angle; part throttle holds it near the cap; the floor is 360.
- Exit: release → clean. Over 4 s, speed under 240, a wall or noDrift → not clean. Nose and travel meet with speed kept;
  `drifting` stays true until within 4°.
- State: `car.drifting`, `car.drift01 = clamp((β°−20)/25, 0, 1)`, `car.driftDir`. Events `car.driftEv` go to
  game.js `onDriftEvent`, which calls `sfx('driftStart', {dir})`, `sfx('driftEnd', {clean})` and on a clean ≥ 0.6 s exit
  `sfx('driftBoost', {quality})`. Mini-boost q = 0.4·duration + 0.4·avg drift01 + 0.2, through the existing drift boost path,
  which also chains into DOUBLE BOOST.
- The v54.4 slip-based drift award is off (only DRIFT pays). The v54.2 "Drift handling" option is unchanged.

## Audio (AE, approved by Callum): integrated per docs/AUDIO_V548_DRIFT.md

- The staged files were copied unchanged; `cmp` shows every file byte-identical to `/workspace/radcars-audio/v548/staged`.
  New sprite (`handbrake` out, `drift_start` + `drift_end` in), four re-encoded engine loops, `drift_scrub.{ogg,m4a}`,
  `LICENSES.md`, `_src/audio-engine.mjs` (= `js/audio-engine.mjs`), `_src/scenes_v548.mjs`, and the docs.
- js/audio.js: `driftStart` → `playDriftStart` (bite plus engine rev flare), `driftEnd` → `playDriftEnd` (clean/dull chirp), the
  held `DriftVoice` layer driven by `drifting` / `drift01` every engine frame, and the squeal ducked while drifting.
- No retired `handbrake` clip is referenced: the sprite JSON has no `handbrake`, the game no longer calls `sfx('handbrake')`, and
  the races log no `handbrake` playback. The only mention left is AE's deprecated alias in audio-engine.mjs, which plays
  `drift_start`. It was left alone so the engine stays byte-identical to AE's.
- Sources and licences (from assets/audio/LICENSES.md), all CC0 1.0, pages checked 7 Oct 2026:
  - `drift_scrub`: audible-edge, "Nissan Maxima burnout", freesound 71740.
  - `drift_start`: elliottdj, "Skrrt.wav", freesound 685910, plus 71740 grit.
  - `drift_end`: elliottdj 685910.
  - Smooth slide layer: the existing squeal loop (audible-edge 71739).

## Art (GD, 2904df8), driven by the same values as the audio

- Smoke: `drift_smoke_0..5` (**6 frames**, not 5) from `drift-atlas`. Pixi uses atlas textures with normal blend; Canvas uses
  drawImage from the same atlas. Spawns only while `drifting`. Interval runs 140 → 60 ms as drift01 goes 0 → 1, so it's denser
  with the angle (measured 4.5 puffs/s below drift01 0.35, 16 puffs/s above 0.65). Alternates rear wheels. 24-puff cap per
  car. GD's growth/alpha curves, a0 = 0.35 + 0.2·drift01. Halved at quality 1, off at quality 0.
- Skids: the `drift-skid.png` brush at 12×6 wu, ≤ 3 wu spacing, alpha 0.14–0.24 by drift01, stamped **only while drifting**.
  Deviation: it uses the existing v54 256² skid tiles (shared by Canvas and Pixi) instead of GD's 2048² toroidal RenderTexture,
  so both renderers match and there's no new GPU memory. The v54 slip skids still run outside a drift.
- Button: `NAMES.brake = 'DRIFT'`; `ICONS.brake` is GD's drift-icon.svg; `assets/drift/drift-button.css` is linked after the
  polish layer (heat on `data-state=active`, `--drift-tilt` = ±8° while drifting). A `.flare` pop (350 ms, css/style.css) fires
  on each driftStart from the same `world.driftFx` event that plays the bite.
- Optional, not done: GD's floodlight smoke tint (needs `poolPos` exported from trackpack.js).

## Verification

See docs/reports/v548-*.txt (races both renderers, drift verify, FPS). The shots are in shots/v548/ (not committed).

### Results (17 Oct 2026, headless Chromium + SwiftShader, 412×915 portrait, DPR 2.625)

- **Races, both renderers: ALL OK** (docs/reports/v548-races-{pixi,canvas}.txt). Four tracks × 3 laps, all P1, all AI finish,
  no keyboard hints, keyboard steer + Shift boost, audio 12 files with 0 failures, music mid-race.
  - The bot drifts the big corners (Down from the entry until the corner opens). Drifts per race (Pixi / Canvas):
    Neon 3/3, Gridlock 22/22, Razor 12/12, Cargo 18/18.
  - Clean: Neon 3/3, Gridlock 20/21, Razor 5/5, Cargo 5/6. Every dirty end was the bot clipping a wall on the hairpins.
  - drift_start × starts and drift_end × ends every time; drift_boost (or a DOUBLE BOOST fold) for every mini-boost; zero
    `handbrake` playback.
  - The DriftVoice scrub was on in 100% of drifting samples and 0 non-drifting ones; a button flare on every driftStart; drift
    smoke and drift skid stamps on every track.
- **Drift verify, both renderers: ALL OK** (docs/reports/v548-drift-verify-*.txt). Held angle 15–45° with no spin, drift01
  rising to ~0.9, the hook order driftStart → driftEnd → driftBoost, smoke 4.5 → 16 puffs/s with drift01, skid stamps only
  while drifting, a ±8° icon tilt, a clean-exit DRIFT BOOST, auto-straighten after 4 s with no boost, DRIFT without steer doing
  nothing, GD's atlas and skid brush fetched, no console errors.
- **Clean FPS** (15 s per track, the bot drifting corners; docs/reports/v548-fps*.json):

  | Renderer | Neon | Gridlock | Razor | Cargo |
  |---|---|---|---|---|
  | Pixi | 59.9 / 59.5 | 58.5 / 59.5 | 59.9 / 59.9 | 59.9 / 59.5 |
  | Canvas | 59.9 / 59.9 | 58.5 / 59.5 | 59.0 / 59.5 | 58.2 / 59.5 |

  Values are avg / p5. The first Pixi pass had a one-off stall run on Razor (57.1 / 30.1); the rerun shown here gave 59.9 / 59.9.
- Shots for GD: shots/v548/v548-middrift-412.png and v548-exit-412.png (Pixi), plus `-canvas` versions and per-track race
  shots.
