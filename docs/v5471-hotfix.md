# v54.7.1 "pickups": hotfix for "drove right over a power-up and got nothing" (Callum, live v54.7)

## Root cause

The '?' bonus-box hitbox was smaller than the box on screen.

- **What was drawn:** at racing speed the camera sits at the far chase zoom (0.24). Both renderers enlarge the box so it
  is never under 20 CSS px across, so it was drawn up to **41.7 wu** half-size (1.6×), with its glow larger still.
- **What counted:** `stepBonus` still tested the bare **26 wu** half-size. Pickup needed the car centre within 43 wu of
  the box centre (26 + half the car width).
- **Result:** a car visibly overlapping the box's edge (centres 44–58 wu apart) got nothing: no grant, no POWER button,
  no sound.
- **Reproduced on main (2d324d9), Pixi, 412×915:** passes 50 wu off-centre missed on Neon (49.5 wu), Gridlock (56.5 wu)
  and Razor (55.1 wu); Cargo (43 wu) just made it. Centre passes always worked.
- **Not the cause:** nothing in v54.7 touched the pickup code (the track pack v1.1, zoom and audio diffs don't reach it),
  `sfx('bonus')` plays `pickup` fine, the console showed no errors, and no flag was stuck.
- **Second reason "nothing" happens, by design:** while you hold a power-up, boxes are left alone (one at a time). Until
  now that was completely silent.

## Fix

1. **Hitbox = the drawn box.** Pickup uses `bonusDrawHalf(half, camera zoom)` + 4 wu slack. This is the same function
   (tracks.js) that both renderers now use to size the box, so they can't drift apart again.
2. **Swept check.** Crossing the box row between two frames also counts, so a long frame at speed can't step over a box.
3. **Holding a power-up:** the box still stays, but you now get a "POWER FULL" toast (in the held power-up's colour)
   plus the `denied` blip, once per pass. Brushing a neighbouring box on the same pass you just collected from doesn't
   trigger it.
4. **Version:** v54.7.1 "pickups", so the service-worker cache changes and installed copies auto-update.

## Test

`node docs/verify-pickups.mjs <url> <pixi|canvas> [outDir] [prefix]` runs 4 tracks at 412×915, natural driving, one box
per lap:

- **Centre pass:** must grant (power held, POWER button 'held', `bonus` sfx, `pickup` clip, toast).
- **Edge pass 50 wu off-centre:** must grant. This failed on 3 of 4 tracks on v54.7.
- **Arriving while holding a power-up:** the box must stay, with POWER FULL and the denied blip.
- **Console:** no errors.

It also takes a pickup shot per track. `EDGE=0` and `OLD=1` reproduce the old checks.
