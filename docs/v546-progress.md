# v54.6 progress (double boost + track pack trial)
- branch v546-wip from main 21606c2, ff-merged trackpack-proto (6b07b74)

## DOUBLE BOOST (done)
- game.js `chainBoost()` (player only, called from rampBoost): landings are counters, not timers — BOOST trigger
  (`boost.trig`), pad ENTERED (`padLand`, weapons.js stepPads tracks `padIn` so a pad held over many frames is one
  landing), drift boost paid (`driftLand`), LAP BOOST turning on. Pads on the autopilot rail don't count (as before).
- 2nd landing while any boost is on → stacks 2, `holdMs = min(CAP, timeLeft + newBoostMs)` (extends, never resets),
  rush 1200 ms at boostLevel 1.35 (top +54 % vs +40 %, accel +94 % vs +70 %), easing to 1 over the last 400 ms.
  3rd+ while chained → only extends hold (cap 3000 ms from that moment), no rush / sound / toast. Reset when all off.
- Same frame: `sfx('boostChain')` + `world.chainFlash` (toast) + fx event `boostChain` (pink ring + edge flash).
  `sfx('boost')` now fires at the player's 0.15 edge (still a silent placeholder) and is skipped on the chain frame.
- physics clamp 0..1 → 0..CHAIN_RUSH_LVL (AI never exceeds 1 → AI unchanged; hb.mjs HASH identical to v54.5 when no
  chain happens: 12648413a055 both).
- FX: pink #ff2b6a ring at 1.3× the cyan (s0 0.39 → s1 1.82, 300 ms) + pink glow; flame 1.4× length + pink core
  (atlas glow, normal blend — additive pink over the cyan flame only whitens it); streaks ×1.5 rate / cap 9; 120 ms
  white edge flash (4 bars just inside fx.clear). All keyed off chainK = (boostLevel−1)/0.35 so they ease out with
  the rush. Canvas: same flame / core / ring / flash (no atlas core: a pink flame shape).
- Toast "DOUBLE BOOST": #ffe600 text + ring, pink glow (`.tt-chain`, `--glow`).
- audio.js `boostChain` placeholder: rising saw + triangle + sine whoosh.
- Safety sim (/workspace/sim/chain.mjs, bot presses BOOST whenever a pad / drift boost is running → ~3–8 chains per
  race): grip bot (never brakes) 0 walls on all 4 tracks with chains; hb bot: no wall hit happened during a rush.
- docs/verify-v546.mjs: ALL OK pixi + canvas.

## Track pack release (done)
- pixiRender: `PACK_TRACKS = ['gridlock']`, on unless `?trackpack=0`; module + images fetched the first time Gridlock
  is built (verify: Razor / Gridlock?trackpack=0 → 0 requests); until loaded the old look, then rebuilt.
- trackpack.js: removed tpcut + stats + `window.__RAD_TRACKPACK__`; kept `&pools=N`; pools alpha 0.55 + a core copy
  (45 % size, alpha 0.22). js/trackpack.js added to the precache list (images are not precached; SW runtime cache).

## Verify (local, before push)
- verify-v546 pixi + canvas: ALL OK. Chain (pixi): pad lands 583 ms after BOOST → stacks 2, hold 1900 = 1417 left +
  483 pad; peak level 1.350; level > 1 for 1179 ms then 1.000; drift (1083 ms) → hold 2388; drift → 3000 (cap);
  stacks max 2; boostChain ×1, 'boost' never on its frame; toast DOUBLE BOOST ×1 (#ffe600 / pink glow); 1 pink ring.
  LAP BOOST as 2nd → chains (level 1.35). Autopilot: pad ignored on the rail, BOOST + drift chains.
  Track pack: Gridlock fetches js/trackpack.js + 6 assets/track files; Razor and Gridlock?trackpack=0 fetch nothing.
- verify-v544 pixi + canvas PASS; verify-v53 races portrait/landscape × pixi/canvas + desktop pixi ALL OK.
- hb.mjs grip (no chain) HASH 12648413a055 = v54.5.
- FPS 390×844 DPR 3 SwiftShader (avg / p5): Pixi Gridlock v54.5 59.6/59.5, 60.0/59.9 · v54.6 (pack) 58.3/59.5,
  59.4/59.5 · Pixi Razor 60/59.5 both · Canvas: noisy both builds (30 fps p5 dips in 3/8 v54.5 and 3/8 v54.6 runs).
  Forced chains (Pixi Gridlock) 58.1/59.5, Canvas 59.7/59.9.
- Shots: docs/shots/90-double-boost.png, 90-double-boost-canvas.png, 90-gridlock-trackpack-race.png (read).
