# v54.7 "sound" release (verified 17 Oct 2026)

Branch trackpack-v11 → main. Contents: AE's v54.7 audio set (a9e1f97, signed off by Callum) wired through
js/audio.js + js/audio-engine.mjs (verbatim copy of assets/audio/_src/audio-engine.mjs), GD's track pack v1.1
(abcc17c, c00e2f5), steer-ring thumb-off (dfe81e8, 4fd055d), screen-sized boost rings, BOOST button DOUBLE BOOST
pulse, Music / Effects volume sliders, version v54.7 · sound (SW cache radcars-v54.7-sound).

## Audio
- `git diff a9e1f97 -- assets/audio`: empty, so the shipped files are byte-identical to AE's signed-off set.
  assets/audio/_src holds only the tracked reference audio-engine.mjs (no untracked build scripts).
- One-shots: sfx_sprite.{ogg,m4a} + sfx_sprite.json. Engine loops, squeal and warn loop, plus 3 music tracks, are
  separate files with the sample-exact loop points from LOOPS. Music ducking comes from mix.duckMusic (heavy wall,
  boost, boostChain, hit, driftBoost q ≥ 0.5) and the engine-level duck.
- Loading: starts after the renderer and the load event. Sprite, map and 7 loops come first, then music one file at a
  time. Decoding runs on an OfflineAudioContext. The AudioContext is created and resumed on the first touch
  (pointerdown/keydown → unlockAudio). Audio main-thread cost is about 0.04 ms per frame.

## Verification
- docs/verify-v547.mjs, Pixi and Canvas: ALL OK. Covers load order, Opus decode, first-tap unlock, late music,
  rings (cyan 140 px, pink 182 px at 390 wide), BOOST full mid-chain with the actChainPulse 0.25 s (4 Hz) animation
  and the ×2 pip, the drain in cyan, boost/boostChain/driftBoost rules, thumb-off, pause, finish slam + jingle,
  volumes, AAC fallback, ?synth=1 and 0 console errors.
- docs/verify-races.mjs: a real 3-lap race on each track at 412×915 portrait (DPR 2.625), Pixi and Canvas, keyboard
  bot. All races finished, all AI finished, cars oriented correctly, no key hints, Shift BOOST works, audio loaded and
  clips scheduled. Reports: shots/v547/v547-races-{pixi,canvas}.{txt,json}. The in-race FPS figures there include
  screenshot stalls (each capture is about 700 ms), so the clean figures come from verify-fps.
- docs/verify-fps.mjs: 15 s of racing per track, no captures, 412×915 DPR 2.625, SwiftShader:

| build | renderer | neon | gridlock | razor | cargo (avg / p5 fps) |
|---|---|---|---|---|---|
| v54.7 | pixi | 59.7 / 59.9 | 58.9 / 59.5 | 59.9 / 59.9 | 60.0 / 59.9 |
| v54.7 | canvas | 59.9 / 59.5 | 60.0 / 59.9 | 59.5 / 59.5 | 59.5 / 59.9 |
| v54.6 (live) | pixi | 59.9 / 59.5 | 59.3 / 59.9 | 59.8 / 59.5 | 59.9 / 59.5 |
| v54.6 (live) | canvas | 59.9 / 59.5 | 59.9 / 59.9 | 59.9 / 59.5 | 59.1 / 59.5 |

- docs/verify-sw-v547.mjs: a v54.6 tab mid-race picks up the v54.7 worker without reloading, then reloads onto
  "v54.7 · sound" after quitting to the menu. The ~54 s install time mid-race in headless SwiftShader is the same for a
  v54.6 → v54.6 bump, so it's environmental.
