# Radcars v54.8 DRIFT: audio handoff

Audio Engineer · 7 Oct 2026. **DRIFT replaces HANDBRAKE.** This doc adds to `docs/AUDIO_V547_HANDOFF.md` (loading, buses, the rest of the hook map and the sprite all still apply). Reference code: `assets/audio/_src/audio-engine.mjs`. Preview scene: `assets/audio/_src/scenes_v548.mjs`. js/ is not touched by this pass.

## 1. What you hear

| Moment | Sound | How |
|---|---|---|
| **DRIFT press** `sfx('driftStart', {dir})` | A hard recorded tyre bite, panned up to 0.25 toward the slide side, **plus a clutch-kick rev flare** on the live engine: about +3 st for ~250 ms, +2.5 dB, +2 dB brighter | `drift_start` sprite clip (0.36 s) + `eng.driftKick(t)`. The flare runs on the engine loops already playing, so it always matches the current rpm and costs 0 bytes. |
| **Held slide** (`drifting` true) | The power-slide layer: a smooth squeal crossfaded with a gritty recorded burnout scrub. It's clearly there at drift01 0 (a 20° slide) and gets louder, rougher and brighter toward drift01 1 (45°). The engine stays audible and revs slightly up (wheelspin). | `DriftVoice`: the shipped `squeal` loop (smooth layer) + the new `drift_scrub` loop (gritty layer, 7 tyre-chatter periods at 8.2 Hz), driven by drift01 every frame. Attack ~40 ms, release ~150 ms. |
| Cornering squeal while drifting | Ducked −18 dB, so the two tyre layers hand over instead of stacking | `SquealVoice.update(..., drifting)` |
| **DRIFT release** `sfx('driftEnd', {clean})` | A short grip-catch chirp. `clean: true` is brighter (+1 st, full band). `clean: false` is duller (−1 st, lowpass 4.5 kHz, −1.9 dB). | `drift_end` sprite clip (0.15 s); one clip, two runtime settings |
| Clean drift pays | `driftBoost` follows exactly as in v54.4: its whoosh, the sparkle at q > 0.7, and the music duck. Its boostLevel bump fires `boost` on the 0.15 edge, and `boost_end` when it bleeds out. | unchanged |

## 2. The drift01 mapping (compute it exactly like this)

Developer's model: while DRIFT is held, the slide angle is between 20° and 45°, and the car never spins. Auto-straighten (DRIFT held too long, or sliding into a wall) ends the drift as `clean: false`.

```js
// every frame, from the player car
drifting = <the DRIFT state>;   // true from the press until the car has straightened (release or auto-straighten)
drift01  = drifting ? clamp((abs(angleDeg) - 20) / 25, 0, 1) : 0;   // = A.driftAmount(angleDeg) when drifting
```

| Angle | drift01 | What the layer does (`A.driftLayers(d)`) |
|---|---|---|
| 20° (drift entry) | **0** | **Clearly audible**: smooth squeal 0 dB, rate 0.86; grit −5 dB, rate 0.86, lowpass 4 kHz |
| 32.5° | 0.5 | smooth −3 dB / 0.89; grit −2 dB / 0.92, LP 7.5 kHz |
| 45° (max) | **1** | Rough and bright: smooth −6 dB / 0.92; grit +1 dB / 0.98, LP 14 kHz |

- `drifting` gates everything: the layer's envelope, the squeal duck, the engine's wheelspin, and the smoke flag. **drift01 alone does not.** drift01 = 0 at 20° is still a full drift, so never write `if (drift01 > 0)`.
- Pass `drift01 = 0` when not drifting. When `drifting` goes false the layer releases (~150 ms) and holds its last balance, so the tail doesn't jump.
- The level also scales with speed: `smoothstep(0.1, 0.3, speed01)` (silent when the car is almost stopped). Pan: the held layer leans 0.12 toward `dir`.

## 3. Hook map: game → audio (only the v54.8 changes)

### 3.1 `sfx(name, opts)`

| Game call | Plays | Clip | Params / rule | Music duck |
|---|---|---|---|---|
| `sfx('driftStart', {dir})`: DRIFT pressed; dir −1 = sliding left, +1 = right | `A.playDriftStart({shots, eng, drift}, {dir})` | `drift_start` | gain 0.9 (`SHOTS.driftStart`), cap 1, rate 0.97–1.03, pan dir·0.25; `eng.driftKick(t)` (rev flare); `drift.setDir(dir)` | — |
| `sfx('driftEnd', {clean})`: DRIFT released, or **auto-straighten → `clean: false`** | `A.playDriftEnd({shots}, {clean})` | `drift_end` | gain 1.0, cap 2. clean: rate 1.06 ±1.5 %, gain 1, no filter. not clean: rate 0.94 ±1.5 %, gain 0.8, lowpass 4.5 kHz | — |
| `sfx('driftBoost', {quality})` after a **clean** drift (same frame as `driftEnd`, or right after it) | `A.playDriftBoost(shots, mix, quality)` | `drift_boost` + `drift_sparkle` | unchanged (v54.7 handoff §4.1) | q ≥ 0.5: −(4 + 2q) dB |
| `sfx('handbrake')` **(deprecated)** | `shots.play('handbrake')` | `drift_start` | The `handbrake` clip is gone from the sprite. The alias plays the drift bite centred, with no rev flare, so an old call isn't silent. Switch the call to `driftStart`. | — |

Order on a clean release: `driftEnd` first, then `driftBoost` in the same frame. An auto-straighten into a wall also fires the normal `wall` hit. That's fine: the dull chirp sits under the impact.

### 3.2 `engineFrame({speed01, boostLevel, slip01, drifting, drift01}, others)`: two new fields

```js
const drift = new A.DriftVoice(ctx, mix.engine, B);    // created with eng / sq at race start (B must include 'drift_scrub')
export function engineFrame(p, others) {
  const t = ctx.currentTime;
  const st = eng.update(p.speed01, p.boostLevel, p.slip01, t, p);       // v54.8: reads p.drifting / p.drift01 (wheelspin)
  if (st.edge === 'off') shots.play('boost_end', { t });
  const squealing = sq.update(p.speed01, p.slip01, t, p.drifting);       // v54.8: ducked −18 dB while drifting
  const sliding = drift.update(p.speed01, p.drifting, p.drift01, t);     // v54.8: the held slide layer
  const skidFx = squealing || sliding;                                   // skid smoke + skid marks flag
  mix.engineLevel(Math.min(1, p.speed01), t);
  /* rivals unchanged */
}
// sfx('driftStart', {dir}) → A.playDriftStart({ shots, eng, drift }, { dir });
// sfx('driftEnd', {clean}) → A.playDriftEnd({ shots }, { clean });
// race end: eng.stop(); sq.stop(); drift.stop(); rivals.forEach((v) => v.stop())
```

Loading: `A.LOOP_FILES` now includes `drift_scrub`, so a loader that walks `LOOP_FILES` picks it up with no change (`drift_scrub.ogg` / `.m4a`, same `audioExt()` rule). `A.SPRITE_CLIPS` now lists `drift_start` and `drift_end` and no longer lists `handbrake`.

## 4. Rules

1. **`drifting` is the gate, drift01 is the shade.** See §2.
2. **The squeal ducks while drifting.** `SquealVoice` keeps its own slip01 gate and hysteresis, but while `drifting` is true its output is −18 dB (`SQUEAL.driftDuckDb`), with the drift layer's own shape: down in ~40 ms (τ 13 ms), back in ~150 ms (τ 50 ms). Measured: −18.0 dB, −10 dB within 40 ms of the press, back within 3 dB 80 ms after the release. Outside DRIFT (an ordinary slide without the button) the squeal works exactly as in v54.7.
3. **Smoke / skid-marks flag = `squealing || sliding`** (the two `update()` return values), so FX and audio still share one flag.
4. **The engine stays on top of the low end.** While drifting the engine revs up a little (+0.06 rpm01 · (0.6 + 0.4·drift01) and +12 % level, τ 80 ms), and the layer is placed in the 0.8–1.6 kHz band where the engine is thinnest. Measured: the engine is louder than the layer at 100–630 Hz (by 3 to 40 dB) and in most bands above 2 kHz.
5. **Auto-straighten = `driftEnd {clean: false}`**, no `driftBoost`. A clean release = `driftEnd {clean: true}` + `driftBoost` as before.
6. **One kick per press.** `driftKick` restarts the flare, so pressing again during a flare just restarts it. It never stacks.
7. No music duck for driftStart / driftEnd / the layer. The drift boost keeps its own duck.

## 5. Parameters (all in `audio-engine.mjs`)

| Constant | Value | Meaning |
|---|---|---|
| `DRIFT.angleMin / angleSpan` | 20 / 25 | drift01 = clamp((angle − 20) / 25) |
| `DRIFT.trim` | 1.41 (+3 dB) | layer level into the engine bus (0.5) |
| `DRIFT.attackTau / releaseTau` | 0.013 / 0.05 s | ≈ 40 ms attack, ≈ 150 ms release (also used for the squeal duck) |
| `DRIFT.mixTau` | 0.06 s | layer balance glide while held (it jumps on the press) |
| `DRIFT.smoothDb / smoothRate` | [0, −6] dB / [0.86, 0.92] | smooth layer (the squeal loop) over drift01 0 → 1 |
| `DRIFT.gritDb / gritRate / gritLp` | [−5, +1] dB / [0.86, 0.98] / 4 → 14 kHz (exponential) | gritty layer (drift_scrub) over drift01 0 → 1 |
| `DRIFT.minSpeed / fullSpeed` | 0.1 / 0.3 | speed01 fade-in of the layer |
| `DRIFT.panMax / startPan` | 0.12 / 0.25 | held layer / driftStart lean toward `dir` |
| `DRIFT.startRate` | 0.97–1.03 | driftStart random pitch |
| `DRIFT.endClean / endDirty` | rate 1.06, gain 1, full band / rate 0.94, gain 0.8, LP 4.5 kHz | driftEnd |
| `ENGINE.kickSt / kickDb / kickShelfDb` | 3 st / 2.5 dB / 2 dB | clutch-kick flare depth |
| `ENGINE.kickAttackS / kickHoldS / kickTau` | 0.025 / 0.12 / 0.06 s | flare shape: 25 ms up, 120 ms hold, then exponential τ 60 ms |
| `ENGINE.driftRpm / driftVol / driftTau` | 0.06 / 0.12 / 0.08 s | wheelspin while drifting |
| `SQUEAL.driftDuckDb` | −18 dB | cornering squeal while drifting |
| `SHOTS.driftStart / driftEnd` | gain 0.9 cap 1 / gain 1.0 cap 2, sfx bus | |
| `LOOPS.drift_scrub` | loopStart 0.05, loopEnd 0.897063 s (samples 2400 → 43059) | 0.847 s loop with a baked crossfade |

## 6. Measured (Chrome OfflineAudioContext, the shipped Opus files through the full mixer)

Phone band = 300 Hz – 8 kHz (4th-order Butterworth), K-weighted LUFS. Numbers are in `/workspace/radcars-audio/v548/meas/measure_v548.json`.

**The held layer vs the engine** (speed01 0.91, top gear, slip01 0.85):

| State | Engine alone, phone | Layer vs engine, phone / full band | Layer centroid | Roughness (envelope modulation) | Engine + layer, phone |
|---|---|---|---|---|---|
| not drifting | −21.4 LUFS | — | — | — | — |
| drifting, drift01 0 (20°) | −20.4 (+1.0 dB wheelspin) | **+0.1 / −1.1 dB** (clearly there, level with the engine) | 2,087 Hz | 0.307 | −17.3 |
| drift01 0.5 | −20.3 | +0.6 / −0.5 dB | 2,972 Hz | 0.338 | −17.0 |
| drift01 1 (45°) | −20.4 | **+2.8 / +1.7 dB** | 3,743 Hz | 0.309 | −15.7 |

Brightness climbs 2.1 → 3.7 kHz, and the grit layer goes from −5 to +1 dB, which is what you hear as roughness. The envelope-modulation figure stays around 0.31–0.34 because the smooth layer fills in too.

- **Envelope:** attack −10 / −3 / −1 dB at 30 / 40 / 50 ms. Release −3 / −10 / −20 / −26 dB at 0 / 90 / 130 / 160 ms.
- **Clutch kick** (pitch tracked from the spectrum): +2.05 st at 62 ms, peak +2.9 st at 138 ms, +1.3 at 212 ms, +0.5 at 263 ms, ~0 by 375 ms. With drifting: peak +3.45 st, settling to +0.7 st of wheelspin (rpm 6,998 → 7,276). Level +3.1 dB at the peak.
- **Loop seams** (decoded, click metric, under +6 dB = clean): drift_scrub Opus −1.76 dB (level jump 0.88 dB), AAC −4.01 dB (jump 0.20). The source loop: 7 chatter periods of 121.5 ms, envelope-phase correlation 0.85, seam −2.97 dB. All the other loops are still under +3 dB.
- **Dry one-shots:**

  | Clip | Peak | M-max (phone) | Centroid |
  |---|---|---|---|
  | driftStart | −2.7 dBFS | −14.0 (−14.1) LUFS | 4,488 Hz |
  | driftEnd clean | −2.6 dBFS | −20.8 LUFS | 4,459 Hz |
  | driftEnd not clean | −4.2 dBFS | −21.8 LUFS | 3,270 Hz |

  driftStart pan: ±3.5 dB L/R at dir ∓1.
- **In the race** (phone band, cruise bed −21.6 LUFS):

  | Event | Level |
  |---|---|
  | driftStart | **+7.4 dB** (all four presses: +7.4 / +7.4 / +7.6 / +7.4); its 10 ms attack is ≈ +9.6 dB over the local bed |
  | driftEnd + driftBoost | +8.5 / +8.7 dB |
  | tap driftEnd (clean, no boost) | +3.7 dB vs cruise (attack +6.3 over the local bed) |
  | auto-straighten driftEnd (not clean) | +3.2 dB (attack +5.0) |
  | held slides, engine + layer | +5.2 / +5.4 dB vs cruise |

  Preview peak: 0.831 (−1.6 dBFS).
- **Decode:** both sprite formats decode in Chrome to 1,013,760 samples, every clip at offset 0. drift_scrub: Opus 45,459 samples (= master), AAC 45,456 (3 short, inside the post-roll, past loopEnd). Band error vs master (mean / p95 dB):

  | Clip | Opus | AAC |
  |---|---|---|
  | drift_start | 0.76 / 2.44 | 0.72 |
  | drift_end | 0.73 / 2.27 | 1.05 |
  | drift_scrub | 0.74 / 2.12 | 0.68 / 2.56 |

## 7. Budget (Pep's rule: sprite + engine/drift loops ≤ 150 KB Opus; KB = 1000 B)

| Format | v54.7 | v54.8 | Change |
|---|---|---|---|
| **Opus, non-music, incl. `sfx_sprite.json`** | 149,229 B | **149,330 B** | +101 B, **670 B under 150,000** |
| Opus without the JSON | 147,555 B | 147,996 B | +441 B |
| AAC, non-music, incl. JSON (no cap) | 316,262 B | 331,471 B | +15,209 B (drift_scrub.m4a 10,790 + sprite +4,759 − JSON 340). AAC stays at the 64k sprite / 80k loop quality settings. |

Per file, Opus: sfx_sprite 94,858 → 93,865; eng_idle 8,323 → 7,734; eng_low 9,743 → 9,047; eng_off_low 8,045 → 7,440; eng_off_high 8,074 → 6,899; eng_high 8,073 and squeal 7,840 unchanged (byte-identical); warn_loop 2,599 unchanged; **drift_scrub 4,499 new**; sfx_sprite.json 1,674 → 1,334.

**New drift sounds: 7,383 B Opus** (drift_start 1,800, drift_end 1,084, drift_scrub 4,499). The smooth layer reuses the squeal loop, and the rev flare is processing on the engine, so both are 0 B.

**Where the room came from.** Each cut is measured as band error (mean / p95 dB) of the Chrome-decoded file against the same master, v54.7 → v54.8:

| # | Cut / re-encode | Opus setting v54.7 → v54.8 | Saved | Quality cost (mean / p95 band error) |
|---|---|---|---|---|
| 1 | **`handbrake` clip retired** (DRIFT replaces it) | removed | **1,056 B** | none (the sound is gone; the `handbrake` alias plays drift_start) |
| 2 | `eng_off_high` loop (lift-off at high rpm) | 56k → 48k VBR | 1,175 B | 0.51 / 1.38 → 0.62 / 1.67 (**+0.11 / +0.29**) |
| 3 | `win_fanfare` (1st-place jingle) | 28k VBR → 24k CVBR | 807 B | 1.36 / 4.51 → 1.45 / 4.89 (+0.10 / +0.38) |
| 4 | `eng_low` loop | 56k → 52k VBR | 696 B | 0.70 / 2.12 → 0.75 / 2.30 (+0.05 / +0.18) |
| 5 | `eng_off_low` loop | 56k → 52k VBR | 605 B | 0.60 / 1.72 → 0.67 / 1.85 (+0.07 / +0.13) |
| 6 | `eng_idle` loop | 56k → 52k VBR | 589 B | 0.62 / 1.77 → 0.65 / 1.87 (+0.03 / +0.10) |
| 7 | `boost_end` (blow-off) | 44k → 40k VBR | 539 B | 0.80 / 2.77 → 0.85 / 3.01 (+0.05 / +0.24) |
| 8 | `podium_jingle` (2nd/3rd-place jingle) | 36k CVBR → 32k VBR | 440 B | 1.51 / 6.58 → 1.70 / 7.46 (**+0.18 / +0.88**, the largest; a chip jingle, so it's the high harmonics that get coarser) |
| 9 | `wall_heavy_1` | 44k/20 ms CVBR → 40k/40 ms CVBR | 354 B | 0.79 / 2.27 → 0.80 / 2.30 (+0.01 / +0.03) |
| 10 | `missile_launch` | 44k CVBR → 44k VBR | 340 B | 0.66 / 1.77 → 0.67 / 1.95 (+0.02 / +0.18) |
| 11 | `sfx_sprite.json` written minified | — | 340 B | none (same data) |
| 12 | `wall_light_2` | 52k → 48k VBR | 130 B | 0.64 / 1.96 → 0.70 / 2.06 (+0.06 / +0.10) |
| 13 | `barge_2` | 24k/20 ms → 28k/40 ms VBR | 47 B | 1.05 / 2.99 → 1.00 / 2.99 (**−0.04, better**) |
| — | Untouched clips, encoder drift from new offsets (drift_boost +76, pickup +8, drift_sparkle −91, explosion −101, wall_heavy_2 −3) plus Ogg overhead (−53) | same settings | 164 B | none (band error identical to 0.01 dB) |

Total freed: 7,282 B, of which **6,226 B came from cuts beyond the handbrake** (items 2–13 and the drift line). That pays for the 7,383 B of new drift sounds, plus 101 B net. For scale: the v54.7 caps were +0.15 / +0.4 dB for gameplay hits and +0.1 / +0.3 for loops. Every gameplay cut is inside those caps. The engine loops are at +0.03 to +0.11 mean, so eng_off_high is 0.01 dB over its loop cap on the mean and inside it on p95. The two finish jingles go over the gameplay caps but stay inside the v54.7 "chip UI" cap (+0.5 / +2.0). Nothing touched boost, boostChain, explosion, the squeal or eng_high.

## 8. Sources (all CC0 1.0, item pages checked 7 Oct 2026, logged in `assets/audio/LICENSES.md` and `_src/pipeline/sources.tsv`)

| Shipped | Source |
|---|---|
| `drift_scrub` loop | audible-edge, "Nissan Maxima burnout (04-25-2009).wav", https://freesound.org/people/audible-edge/sounds/71740/ (3.70–5.25 s, HP 380 Hz, gentle EQ, 2:1 comp; loop 4.047–4.894 s) |
| `drift_start` | elliottdj, "Skrrt.wav", https://freesound.org/people/elliottdj/sounds/685910/ (burst at 4.918 s, HP 250 Hz) + 71740 grit (4.20–4.56 s, −6 dB); 150 ms hold then a τ 70 ms decay, 3:1 comp |
| `drift_end` | elliottdj "Skrrt.wav" 685910 (the short burst at 3.687 s with its natural stop) |
| Smooth layer | the shipped `squeal` loop (audible-edge 71739) |

Checked but not used (CC0, logged): monosfera 628044 (crowd and engine under the tyres), loganzsound 774265 (bike), shatterstars 492071 (shoe), audible-edge 71741 / 76805 / 76806 (handbrake turns with less grit), johnnydekk 614627.

## 9. Preview

`/workspace/radcars-audio/previews/video/v548/v548_drift.mp4` (28.6 s, 1280×480, H.264 crf 28, AAC 160k stereo). Rendered in headless Chrome by `render_v547.mjs --scenes scenes_v548.mjs`: the shipped files through the real mixer, with the race music and the engine. WAV/Opus/AAC copies and `v548_drift.timeline.txt` are in `/workspace/radcars-audio/previews/v548/`.

| t (s) | What happens |
|---|---|
| 0.0 | race music, engine at top-gear cruise |
| 2.0 | **corner 1 (left)**: driftStart (pan −0.25) + clutch kick; held slide drift01 0.4 → 1.0 → 0.6 |
| 3.6 | driftEnd clean + driftBoost q 0.75 → boost whoosh 3.62, blow-off 4.88 |
| 7.0 | **corner 2 (right)**, same shape |
| 8.2 | driftEnd clean + driftBoost q 0.9 (sparkle) → boost 8.23, blow-off 9.62 |
| 11.6 | **tap-drift** (0.35 s, drift01 0 → 0.3) → driftEnd clean 11.95, no boost |
| 14.0 | **long burning slide (right)**: drift01 0.4 → 1.0, held at 45° |
| 17.6 | **auto-straighten**: driftEnd clean: false (dull) |
| 20.4 | music and engine out: dry section |
| 21.4 / 22.3 | driftStart dry, dir −1 / +1 |
| 23.2 / 23.9 | driftEnd dry, clean / not clean |
| 24.8 | layer solo at drift01 0 (20°) for 1 s |
| 25.8 | layer sweep drift01 0 → 1 over 1.5 s |
| 27.8 | release (150 ms) |

## 10. Rebuild

```bash
# masters (Freesound HQ previews in <fs>: 71740, 685910), then the sprite + Opus/AAC loops
python3 assets/audio/_src/pipeline/build_v548.py <fs dir> <v54.8 masters>
python3 assets/audio/_src/pipeline/build_sprite_v548.py <masters (v54.7 + drift_start/drift_end)> <loop masters (+ drift_scrub)> <out>
# preview + Chrome decode (puppeteer-core in /tmp/pp)
cd /tmp/pp && node <repo>/assets/audio/_src/render_v547.mjs --assets <repo>/assets/audio --previews <dir> --scenes scenes_v548.mjs --decoded <dir>
```

Settings: `_src/pipeline/sprite_v548_settings.json`. Metadata: `sprite_v548_meta.json` (per-clip bytes, offsets) and `v548_meta.json` (drift sources, loop points, seam). Workbench (not in the repo): `/workspace/radcars-audio/v548/` (`meas/measure_v548.py`, `build/budget_v548.py`, `meas/budget_v548.json`, and the v54.7 asset snapshot in `snapshot_v547_assets/`).

## 11. Open points

- The rev flare is processing on the engine, not a recorded blip. A recorded throttle blip would cost about 2–3 KB that the budget doesn't have. Callum should judge the flare by ear in the preview.
- Headroom is 670 B Opus. The next new sound needs another cut. The cheapest next ones, from the rate–distortion sweep: drift_sparkle 40 → 36k (424 B, +0.19 / +0.64 dB) and sfx_power 36 → 32k (230 B, +0.14 / +0.41 dB). Both were tried for this release and put back, because the budget fit without them.
- The `handbrake` alias should be removed once game.js calls `driftStart`.
