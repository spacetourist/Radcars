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
