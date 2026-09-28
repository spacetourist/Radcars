# v49 progress (tighter turn + camera keep-in-view)

Baseline v48 1ac2be4. Camera bug: countdown look-ahead 200 wu at ZOOM_GRID 0.85 pushes the car ~200 wu behind centre; on a short viewport (e.g. 390px tall → half-height ≈229 wu) the car sits near/past the edge. Fix: clamp look-ahead (and ease zoom if needed) so the player AABB stays inside the view with ~10% of the shorter side as margin, during countdown / early race / low speed; leave high-speed chase alone.
Turning: MAX_TURN 2.9 → ~3.3 for ~12% tighter circle at 1000 wu/s.
16:05 BST verify-v49 PASS. Turn 530.5→466.2 (12.1%). All countdown/GO/mobile on-screen. Committing.
