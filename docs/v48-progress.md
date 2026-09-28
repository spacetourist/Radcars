# v48 progress notes (missile / pads / no brake)

Status 12:40 BST: all features implemented (uncommitted). js/weapons.js new.
- Missile: 2000 wu/s, turn 3.0 rad/s (min radius 667), life 3.5 s, hitR 34, dies on wall (0.2 s launch grace + launch point clamped 30 wu inside road), also 'overshot' if >300 wu past target.
- P1: refused with NO TARGET flash, charge kept.
- Spin 1000 ms, speed ×0.3, no accel/steer. Pads 4/3/3/3, 0.5 s boost at v47 strength, any car.
- Auto-unstick: gas held, speed <60 for 1.5 s → reverse 0.9 s steering toward road.
- Hit rate across 5 full verify runs at turn 3.0: 171/254 = 67% (runs 66/67/70/72/60%).
- Last full verify run: all PASS except flaky neon "lap 1 target in range" (bot started at t>3000; changed to t>1800).
Remaining: final verify-v48 run → read shots, verify-core (/tmp/vc), verify-boost, commit, push, live check.

12:45 BST: SW update work done (parent steering). sw.js: skipWaiting+claim, network-first cache:'no-store' same-origin, offline fallback ignoreSearch. index.html ?v=48 on main.js/css. main.js: register(updateViaCache:'none'), update() on load + visibilitychange, controllerchange → reload once, deferred while mid-race. docs/verify-sw-update.mjs PASS (v47 tab → v48 after one refresh + 1 auto reload; mid-race deferral; menu immediate). Output docs/shots/76-sw-update.txt.
Next: final verify-v48, verify-core (/tmp/vc), verify-boost, commit/push/live.

12:55 BST: version label + hard refresh done. js/version.js = single source (label, cache name, asset list; writes css/importmap/main module with ?b=build; index.html loads it with ?t=now via document.write). sw.js importScripts it. Menu shows "v48 · missile" + "Update / hard refresh" (unregister, delete caches, refetch assets cache:'reload', location.replace ?r=ts, URL tidied). verify-sw-update PASS incl. mobile tap. Shot docs/shots/76-menu-version.png read OK.
Live check: poll js/version.js (not sw.js) for version 'v48' name 'missile'.
Next: final verify-v48 → verify-core (/tmp/vc) → verify-boost → commit/push/live.
13:10 BST final verify-v48 PASS (hit 30/47=64%; aggregate 6 runs 201/301=67%).
13:25 verify-core PASS (/tmp/vc; pixel check skips cars on pads/with flames).
13:31 verify-boost PASS (/tmp/vb). Next: commit/push.
