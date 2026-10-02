# v53 controls progress
Baseline v52 469cdc9. Started 21:45 BST.

## Brief (consolidated)
- Auto-throttle after GO; BRAKE replaces GAS (hold; ~1500 wu/s² down to a crawl floor, never reverses; auto-unstick kept).
- Keys silent: Down/S brake, Up/W no-op, Shift boost, Space missile, E power, P/Esc pause. No key hints anywhere in
  gameplay/HUD; one 'Keyboard controls' section in Options only.
- GD portrait spec (docs/shots/80-controls-portrait-mockup.png): base 390x844, s=min(vw/390,vh/844); steer ring 148
  (140 if <375 wide) knob 56 at (86, bottom-144), floating in left half of control zone, idle 45% alpha, dead 8%;
  BRAKE 100 @ (304,712) red; BOOST 64 @ (304,614) cyan; MISSILE 64 @ (234,642) yellow; POWER 64 @ (208,712) item colour.
  States READY/ACTIVE/USED(NEXT LAP)/UNLIMITED/POWER empty+held; countdown 35%; toasts top+48 1.4 s; HUD pills
  LAP/POS/timer at safe-top+8 32px; pause 44 top-right; minimap 96x96 @ (282, top+44). Landscape: steer (12%x,
  bottom-26%), arc mirrored 0.85 scale, car ~50%. Portrait car ~42%. Finish fades controls 0.2 s. Left-handed toggle.
- Icons: emoji-style inline SVG (no system emoji, no 'MSL' abbreviations). Tilt steer optional (skip unless time).
## Plan / status
- [ ] physics/input brake  - [ ] js/icons.js  - [ ] js/controls.js layout+states  - [ ] HUD/minimap  - [ ] camera
- [ ] options (left-handed + keyboard section)  - [ ] brake lights  - [ ] verify-v53 + shots  - [ ] old scripts  - [ ] ship
- 21:51 BST: implemented physics brake floor, input.js rewrite (brake/taps/floating steer), icons.js (SVG
  emoji set, checked /tmp/icons.png), controls.js (CONTROL_LAYOUT + states + toasts), HUD pills, minimap box (both
  renderers), camera band (carY 0.42 portrait), brake lights (both), options (left-handed + keyboard section),
  version v53 controls. NOTE: box restarted mid-run — reinstalled puppeteer-core (npm i --no-save; package.json is
  tracked, don't commit changes to it) and restarted http.server :4173. Next: smoke test in portrait.
- 21:56 BST: GD keeps icons; icon size 58% of disc; ∞ badge present. Test flag lesson: use --use-gl=swiftshader (not --use-angle) or Canvas runs at 2 fps headless. GD wants 81-gd-*.png at 390x844 DPR3 (boost-ready, missile-used, power-rocket3, brake-pressed, steer-active, countdown, unlimited).
- ~21:58 BST: verify-v53.mjs written (races/touch/states/fps). touch portrait pixi ALL OK. Fixes: ring floats on any touch, brake ring overlay removed, active icons keep colour + white halo. Bot brake threshold turn>0.75 (corners max ~0.96 rad).
- ~22:02 BST: patched verify-v49 (brake now expected), v50 (BRAKE instead of GAS rect), boost + v48 mobile sections (slide from BRAKE, steer on floating-ring centre). QUEUED v53.1 'chrome' (GD polish kit) — only after v53 is live + reported.
- 22:07 BST verify-v53 races landscape pixi: RESULT: ALL OK (races-landscape-pixi)
- 22:08 BST verify-v53 races desktop pixi: RESULT: ALL OK (races-desktop-pixi)
- 22:08 BST verify-v53 races portrait pixi: RESULT: ALL OK (races-portrait-pixi)
- 22:08 BST: README updated (touch-only controls table, v53 sections, code map, verify-v53). Chain /tmp/v53/run.sh running (status /tmp/v53/status; logs /tmp/v53/*.log, /tmp/v53/old/*.log). Trial races portrait pixi ALL OK; desktop pixi all 4 ok.
- 22:11 BST verify-v53 races desktop canvas: RESULT: ALL OK (races-desktop-canvas)
- 22:11 BST verify-v53 races portrait canvas: RESULT: ALL OK (races-portrait-canvas)
- 22:11 BST verify-v53 races landscape canvas: RESULT: ALL OK (races-landscape-canvas)
- 22:11 BST verify-v53 touch portrait pixi: RESULT: ALL OK (touch-portrait-pixi)
- 22:11 BST verify-v53 touch narrow pixi: RESULT: ALL OK (touch-narrow-pixi)
- 22:11 BST verify-v53 touch tall pixi: RESULT: ALL OK (touch-tall-pixi)
- 22:12 BST verify-v53 touch landscape pixi: RESULT: ALL OK (touch-landscape-pixi)
- 22:12 BST verify-v53 touch portrait canvas: RESULT: ALL OK (touch-portrait-canvas)
- 22:12 BST verify-v53 touch landscape canvas: RESULT: ALL OK (touch-landscape-canvas)
- 22:12 BST verify-v53 fps portrait pixi: RESULT: ALL OK (fps-portrait-pixi)
- 22:13 BST verify-v53 fps portrait canvas: RESULT: FAIL (fps-portrait-canvas)
- 22:13 BST verify-v53 fps landscape pixi: RESULT: ALL OK (fps-landscape-pixi)
- 22:13 BST verify-v53 fps landscape canvas: RESULT: ALL OK (fps-landscape-canvas)
- 22:14 BST verify-v53 fps desktop pixi: RESULT: ALL OK (fps-desktop-pixi)
- 22:14 BST verify-v53 fps desktop canvas: RESULT: ALL OK (fps-desktop-canvas)
- 22:15 BST verify-v53 states 3: RESULT: ALL OK (states)
- 22:19 BST verify-core core-canvas: OVERALL: FAIL
- 22:19 BST verify-core core-pixi: OVERALL: PASS
- 22:24 BST verify-v49 v49-canvas: OVERALL: FAIL
- 22:24 BST verify-v49 v49-pixi: OVERALL: FAIL
- 22:29 BST verify-v50 v50-canvas: OVERALL: FAIL (7)
- 22:29 BST verify-v50 v50-pixi: OVERALL: FAIL (2)
- 22:39 BST verify-boost boost-canvas: 
- 22:39 BST verify-boost boost-pixi: 
- 22:49 BST verify-v48 v48-canvas: OVERALL: FAIL
- 22:49 BST verify-v48 v48-pixi: OVERALL: FAIL
- 22:57 BST verify-v52 v52: RESULT: FAIL (9)
- 22:57 BST verify-v51 v51: RESULT: 15 FAIL(S)

### 22:57 BST: old-suite triage
- **Real bug, fixed (pre-existing since v47):** `rampBoost` fell into the ramp-out branch whenever the level was already 1, so a held boost flickered 1 ↔ 0.96 every frame (0.93 at 30 fps). That is why verify-v50 canvas LAP BOOST read "≥0.93". The level now holds steady at its target.
- **Real UX bug, fixed:** a slide from BRAKE kept braking after it fired, so every slide-boost first lost about 400 wu/s. The brake now lets go once a slide fires, and slides back onto BRAKE to brake again. verify-boost (touch car stuck last for 60 s) and the verify-v48 slide checks now expect brake=false after a slide.
- **Real layout issue, fixed:** in landscape, at the 0.85 arc scale, the POWER and BRAKE hit squares (visual + 12 px) touched or overlapped. The hit pad now shrinks so neighbouring round hit areas never overlap, and `.act` has border-radius 50%. verify-v50 "no overlap with BRAKE" now passes, and verify-v53 gained a "round hit areas don't overlap" check.
- **Stale tests, harness updated:** verify-v48 "no BRK control" and "Down does not brake" (v53 brings BRAKE back by design). verify-boost desktop 'idle' (with auto-throttle the bot now holds BRAKE at GO to fall to last). verify-boost touch "clear of last" now slide-boosts while last, like a player would. verify-v50 lap-boost end waits out the 2 s minimum-duration rule when E lands near the line. verify-v49 version-label pins are expected (unchanged).
- **Contention:** fps / reveal-fps FAILs in verify-v52, verify-v48 razor and fps-portrait-canvas all came from running 2–3 headless browsers at once. Re-running sequentially (/tmp/v53/rerun.sh).
- 22:58 BST verify-sw-update: OVERALL: FAIL
- 22:58 BST rerun (sequential): verify-v53 fps portrait canvas: RESULT: FAIL (fps-portrait-canvas)
- 22:58 BST rerun (sequential): verify-v53 touch portrait pixi: RESULT: ALL OK (touch-portrait-pixi)
- 22:59 BST rerun (sequential): verify-v53 touch landscape pixi: RESULT: ALL OK (touch-landscape-pixi)
- 22:59 BST rerun (sequential): verify-v53 touch narrow pixi: RESULT: ALL OK (touch-narrow-pixi)
- 22:59 BST rerun (sequential): verify-v53 touch tall pixi: RESULT: ALL OK (touch-tall-pixi)
- 22:59 BST rerun (sequential): verify-v53 touch portrait canvas: RESULT: ALL OK (touch-portrait-canvas)
- 22:59 BST rerun (sequential): verify-v53 touch landscape canvas: RESULT: ALL OK (touch-landscape-canvas)
- 23:05 BST rerun (sequential): verify-boost boost-pixi: OVERALL: PASS
- 23:11 BST rerun (sequential): verify-boost boost-canvas: OVERALL: FAIL
- 23:16 BST rerun (sequential): verify-v50 v50-pixi: OVERALL: PASS
- 23:22 BST rerun (sequential): verify-v50 v50-canvas: OVERALL: PASS
- 23:32 BST rerun (sequential): verify-v48 v48-pixi: OVERALL: FAIL
- 23:43 BST rerun (sequential): verify-v48 v48-canvas: OVERALL: FAIL

### 23:47 BST: ship decision
- Sequential reruns after the fixes: verify-v53 touch on portrait, narrow, tall and landscape (Pixi), and on portrait and landscape (Canvas): ALL OK. verify-v50 Pixi and Canvas: PASS (lap boost now ≥ 0.99, POWER/BRAKE hit areas clear). verify-boost Pixi: PASS.
- Also fixed (real regression from v53): the extra Left-handed row pushed Options' Back button off-screen at 844×390 and 740×360. In short landscape, the rows now use 44 px targets and Back sits in the free corner under the help card. Checked at 844×390, 740×360, 667×375, 390×844 and 1280×720 (all buttons ≥ 44 px and on screen).
- Open, for a follow-up commit (all old-suite timing/perf items; no gameplay regressions found):
  - fps-portrait-canvas: 53.6–55.8 fps headless SwiftShader, alone. Landscape canvas (same pixel count) gets 59.7. Not yet compared with v52.
  - verify-v48 razor Pixi race: rAF 53.7.
  - verify-v48 canvas "lap 1 target in range": the bot leads, so no target is ahead.
  - verify-boost canvas: race rAF 54.8, plus the slide-while-not-last margin (harness now needs a 450 wu gap to the car behind).
  - verify-v51 and verify-v52 FPS / reveal-FPS items were measured while other suites ran in parallel. verify-v51 rocket needs a target ahead (harness now brakes until a rival passes).
  - verify-sw-update step 4 (menu reload: navigations 0). BRK pin updated.
