# trackpack prototype — progress (local branch trackpack-proto, never pushed)
- 19:05 resumed: no box restart; the repo had been switched back to main after the first commit 6dd725d. Back on trackpack-proto; puppeteer-core present; server :4173 up.
- Done in 6dd725d: js/trackpack.js (dynamic import, ?trackpack=1, Gridlock only), pixiRender hooks, GD assets (no build_track.py, no buildings atlas), shots 89-trackpack-*.png, docs/trackpack-proto.md.
- TODO: POOLS_ON_SCREEN constant (default 8), re-verify (race + FPS off/on + 4 shots, read them), commit.
- POOLS_ON_SCREEN added (default 8, &pools=N override); pools now one small mesh each, nearest N drawn.
- cap check: &pools=1 → 1 of 7 in-view pools drawn; default → 7 of 7 (cap 8). 0 errors.
- 19:20 verify: real Gridlock race 390×844 swiftshader, 0 console errors. FPS capped off 59.9–60.0 / on 59.6–59.7 avg, p5 59.5–59.9 both; uncapped 72.9 vs 62.1.
- shots re-taken + read: docs/shots/89-trackpack-{grid,straight,corner-pool,zoomout}.png (HUD/controls unchanged, no seams, S-bend barrier squeezed not folded).
- committing on trackpack-proto (local only).
