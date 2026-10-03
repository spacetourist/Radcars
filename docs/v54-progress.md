# v54 'feel': progress notes

- 00:12 BST: started on branch v54-wip from d4a23ef (v53.1). The old suites are re-running sequentially against a v53.1 worktree on :4175, so they're isolated from v54 edits (/tmp/old54/status).
- game.js wired: emitFeelEvents() (wall events per car, 200 thr / 150 ms cd, strength; boost edge 0.15/0.05; world.fxEvents + world.wallLog), sfx('boost') on press removed, setAudioPaused on pause, engineFrame each frame (silent).
- slip01 retuned: |vLat| on Neon p50 0 / p90 10 / p99 39 / max 52 → SLIP_LO 20, RANGE 50.
- NEXT: FX in pixiRender.js (atlas, pool 64, skid RT, ghosts, streaks, shake), Canvas fallback, verify-v54, old suites (/tmp/old54/status).
- js/fx.js shared FX state + Pixi (atlas) and Canvas draws; verify-v54 PASS on neon Pixi and razor Canvas (labels 9.6 px).
- Wall keep retuned to 0.99→0.84 by sin² (glancing ≤20° keeps 91–98 %, v53.1 89–94 %; 90° keeps 30 %, v53.1 23 %).
- Skid tiles 256², LRU 64, Pixi uploads batched per 50 ms; SLIP_LO 30 / RANGE 60. Quick A/B Pixi: v53.1 59.3, v54 58.8, v54 fx=0 59.1.
- FPS 390x844 DPR3 portrait, same probe (Neon, key bot, 3 s warm-up + 12 s rAF count), same session, alternating:
  Pixi v53.1 59.6 / 60.0, v54 55.9 / 58.3; Canvas v53.1 59.4 / 59.0, v54 58.2 / 58.2. (Earlier single A/B: v54 58.8, v54 ?fx=0 59.1.)
- Impact distribution (node sloppy-driver sim, 4 tracks × 3 runs × 90 s): 549 events, 485 light / 64 heavy, vn p10/p50/p90/max 262/431/631/854;
  mean speed kept by angle <15° 95 %, 15–30° 89 %, 30–50° 74 %, >50° 53 % (v53.1 same driver: 303 events, 240/63, mean keep 83 %).
- Races (verify-v53 races): portrait Pixi 2 laps ALL OK (fps 57.1/58.8/58.6/56.8); portrait Canvas 1 lap: all 4 finished, 0 errors, one FAIL = neon "brake used into corners" (bot held BRAKE 0.2 s — v54 low-speed grip means it rarely needs to), fps 54.3/58.2/55.6/51.3 (SwiftShader portrait Canvas, v53 was 50.6/55.6).
- SHIPPED v54 as 7cc8c56; Pages serves 'v54 · feel' (live phone smoke: Pixi race, fxState on, atlas png+json loaded, 0 errors).

## v54.1 'feel polish' (GD review), branch v541-wip
- Heavy sparks 8–10, lenPx 36–48 CSS px (Pixi scale = lenPx / (55 visible px × zoom); Canvas stroke lenPx/zoom), fanned ~100° around the bounce direction; light unchanged.
- Skids: each rear tyre stamps from last frame's wheel position to this one every ≤ 2.5 wu (¼ of the 10 wu stamp), per-stamp alpha 0.10–0.18 (≈4 overlap); tile uploads still batched per 50 ms.
- Boost ring: one per 0.15 crossing, spawned at the car and drifting at ½ car speed (no follow), 0.3→1.4×, alpha 0.8→0 over 260 ms; verify: early ms 17 scale 0.37, late ms 183 scale 1.08 alpha 0.24, 0 player rings after 300 ms.
- Flame: atlas flame_0..2 (24 fps, ±8 % flicker, additive; LAP BOOST tinted green) on Pixi and Canvas.
- Zoom punch: fx.zoomPunch — 8 % out in 80 ms, ease back over 600 ms to 3 % × boostLevel (measured 0.926 @206 ms → 0.97 hold from ~650 ms).
- Logs: (a) sloppy driver 553 hits: glancing <43° 411 (74 %) wallHit p10/p50/p90/max 239/362/519/620, 0 heavy, keep 85 %; head-on 142 (26 %) 495/624/728/796, 72 heavy, keep 58 %.
  (b) tightest corners (Gridlock R375, Razor R351) flat out and braking: |vLat| = 0 every frame → slip01 0. The model turns the velocity with the heading; vLat only comes from walls/contacts (after a hit |vLat| p50 53 / p90 185 / p99 408 / max 565; away from walls p99 17). → SLIP back to 80/240 (p90 after a hit = 0.44); 30/60 saturated on any brush.
- verify-v53: Neon brake expectation relaxed to > 0.1 s (bot barely brakes on Neon since v54 grip).
- Verify: verify-v541 PASS Neon Pixi + Razor Canvas (final code); races 1 lap ALL OK portrait/landscape Pixi+Canvas, desktop Pixi; FPS table in the report.
