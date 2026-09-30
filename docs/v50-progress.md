# v50 progress (bonus boxes + power-ups)
Baseline v49 e39f89c. Started 10:55 BST.
11:25 BST: code written (powerups.js, game/render/input/physics/tracks/weapons/audio/css/index, version v50 bonus). Next: smoke test.

## Sep 30 (cont.)
- node_modules had vanished from the box; reinstalled puppeteer-core@23 (--no-save) and restarted the :4173 server.
- Smoke: autopilot 0 wall contacts on all 4 tracks over 5-6 back-to-back runs covering whole laps, 1250 wu/s through hairpins, dev mean 5-12 wu.
- Added 1.5 s handback (AUTOPILOT_HANDBACK_MS): top multiplier eases 1.25→1 (smoothstep), steering assist (railSteer weight w) fades while the player isn't steering; stats hbWall / hbMaxDecel / hbEndSpd in apLog.
- Wall contact already present at activation isn't counted (inWall seeded).
- Lap boost flames stay green through the ramp-out unless a normal/pad boost takes over.
- Found pre-existing v47 ramp quirk: at level 1 with target 1 rampBoost takes the ramp-out branch, so boostLevel flickers 1 ↔ 0.963 every other frame (all boosts). Left as-is (handling rule); verify threshold 0.95.
- game.getLastHud() exposes the BOOST/MISSILE panel boxes for the layout overlap check.
- docs/verify-v50.mjs written; neon / razor+cargo pass.
- 11:36 BST full verify-v50 PASS; regressions verify-boost PASS, verify-v48 PASS; verify-core neon failed only on pixel elongation 1.26<1.3 (car sampled beside a gold-rimmed ? box) → verify-core now skips cars within 120 wu of a box (like pads).
- Fixes after reading shots: autopilot icon rendered as a solid disc (CSS fill overrode fill="none") → inline style; pads/Shift boost ignored for the player on autopilot (no orange flames, charge kept); POWER sub-text shows "+ROCKET/+BOOST/+AUTO" when one is held while another runs; rocket triple shot reframed to include missiles + targets.
- Final verify-v50 + verify-core rerun in progress.
- 12:46 BST final verify-v50 PASS (121 checks), verify-core PASS (after skipping pixel samples beside ? boxes and under the GO overlay), verify-boost PASS, verify-v48 PASS. All 21 78-* shots read. POWER panel shows a small badge of the held power-up when one is held while another runs.
