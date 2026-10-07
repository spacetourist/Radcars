# Radcars audio plan (v54 feel → v55 rivals)

Audio Engineer · 2 Oct 2026 · **rev 3: everything rebuilt from real recordings.** Pure synthesis is out after Callum's verdict ("sounds like bad synth music"). The trigger maths, mixer, hook and v55 warning timing agreed in rev 2 are kept. **rev 3.2 (3 Oct):** squeal mapping retuned to Developer's v54.2 drift data (engine spec §7). Status: draft for Pep. Callum is the final ear. **rev 4 (7 Oct, v54.4):** music is now in scope (an 8-bit chiptune soundtrack, §11) with a music bus and ducking (§5). New recorded `handbrake` and `driftBoost`, the remaining synth beeps replaced by polished files (§2, §3.5), and the new `denied` cue. **rev 4.1 (7 Oct, v54.6 'DOUBLE BOOST'):** new `boostChain` cue for a second boost stacked on a running one (recorded whooshes +4 st + a rising A-major chip arp, §3.6), with a deeper −8 dB music duck (§5). **rev 4.2 (7 Oct, v54.7 sound release):** one-shot sprite (`sfx_sprite.ogg/.m4a/.json`), SFX 203.2 → 147.6 KB Opus, engine top-gear / shift / boost-rev / DOUBLE BOOST rush fixes, squeal +3 dB at full slip, phone-band pass on heavy hits, anti-lag pops on `boost`; see `docs/AUDIO_V547_HANDOFF.md` (supersedes the hook and size details below where they differ).

Companion docs:
- `docs/ENGINE_NOTE_SPEC.md` (rev 3, sample-based): per-loop file, recorded rpm and fundamental, exact loopStart/loopEnd, crossfade table vs rpm01, playbackRate ranges, boost, braking, squeal, rivals.
- `docs/V55_SFX.md` (rev 3): missile launch, explosion, pickup, barge and the warning, all from recordings.
- `assets/audio/_src/audio-engine.mjs`: the plain Web Audio reference implementation (loader, mixer, `SampleEngineVoice`, `SquealVoice`, `ShotPlayer`, `WarnVoice`, all trigger maths).
- `assets/audio/_src/render2.mjs` + `scenes2.mjs`: render the previews by playing the shipped files through that module in headless Chrome.
- `assets/audio/_src/pipeline/`: source download with per-item CC0 check, loop finding, processing, and decode checks.
- `assets/audio/LICENSES.md`: the exact source URL and licence for every file.
- **Superseded:** `assets/audio/_src/superseded-synth/` (the rev 1–2 oscillator recipes). Kept for history only, never shipped.

## 1. Approach in one paragraph

Every sound is a **CC0 recording**: Freesound items with the CC0 licence checked on each item page, plus Kenney packs.
- The **engine** is one real car, Chippy569's dyno sessions of a Mercedes-Benz 190E 16V (4-cylinder): 3 on-load loops (idle 519 rpm, 2558 rpm, 6207 rpm) and 2 no-load loops (2428 rpm, 6295 rpm). They are equal-power crossfaded by a fake RPM, with playbackRate inside each band, and the fake 4-gear dip-and-rise is kept. Every loop point is a rising zero crossing an integer number of engine cycles apart, with a baked crossfade.
- The **squeal** is a real tyre-squeal loop.
- **Wall hits** are real impacts: Kenney taps plus a real metal-rail scrape for the light tier, and real car-crash crunches layered with a Kenney body thump for heavy. There are 3 variants per tier, played with a small random pitch.
- **Boost** is a real air whoosh plus firework-ignition fizz, with a real turbo blow-off when it ends.
- The **v55 set** is a real rocket launch, a real close explosion, a bell chime, door slams from the same 190E, and a real truck reversing-alarm beep looped and gated on the agreed timing.

Per Pep: the target is **punchy arcade, Super Cars-era energy**, not sim realism. So the loops carry a tanh drive and presence lift, the pitch sweeps hard through short gears, and boost barks and blows off. Total: **140.1 KB Opus / 196.8 KB AAC**, under Pep's 150 KB Opus budget (§4).

## 2. Existing `sfx()` events (js/audio.js, read at v53 working copy)

All of them go through `beep()` (one oscillator + exponential decay → `ctx.destination`). Multi-note sounds are chained with `setTimeout`.

| Event | Called from | Today | Plan | Ver |
|---|---|---|---|---|
| `click` | ui.js 130, 184, 248, 288, 295, 303, 342, 343, 430, 431 (menus, options, pause, results) | 300 Hz square, 40 ms | **rev 4:** `ui_click` file (chip tick, 50 ms), ui bus | v54.4 |
| `countdown` | game.js 263 (3, 2, 1) | 380 Hz square, 120 ms | **rev 4:** `ui_countdown` (A5/A4 pulse, 0.2 s), ui bus | v54.4 |
| `countdownGo` | game.js 263 (GO) | 520 → 780 Hz | **rev 4:** `ui_go` (A arp + kick + crash, 0.6 s), ui bus. Start `music_race` on the same frame. | v54.4 |
| `wall` | game.js 280 (`player.wallHit > 250`, 300 ms cooldown) | 110 Hz square blip | **Replace** with the recorded `wall_light_1..3` / `wall_heavy_1..3` variants, driven by the shared wall `strength` (§3.2, §3.4). New call: `sfx('wall', { wallHit: player.wallHit })`, triggered at wallHit > 200 with a 150 ms per-car cooldown. | **v54** |
| `boost` | game.js 459 (player BOOST incl. the free last-place boost) | saw sweep | **Replace** with the recorded `boost` (+ `boost_end` blow-off when the boost bleeds out) and the engine boost push (engine spec §6). It is now fired from the engine hook when the player's `boostLevel` rises past 0.15 (re-arms below 0.05), which also covers pads and lap boost. **Remove the game.js 459 call** to avoid double triggers. | **v54** |
| `lap` | game.js 352 | 2-note sine chime | **rev 4:** `ui_lap` (E6 → A6 chime, 0.42 s), ui bus | v54.4 |
| `slam` / `podium` / `win` | game.js 394 via `celebrate.js` TIERS `.sound` | thump + chord / fanfare | **rev 4:** `ui_slam` (real Kenney punch + chip stab), `ui_podium`, `ui_win`. **podium and win already contain the slam**, so play only the one file. Duck the engine −10 dB from the slam, and call `music.finish()` on the same frame (§11). | v54.4 |
| `finish` | **never called** (dead since v52) | — | Remove. | v54 |
| `missile` | game.js 516 (each rocket of a salvo), 624 (seeker launch) | saw down-sweep | **Replace** with the recorded `missile_launch` (real rocket ignition + burn). | v55 |
| `hit` | game.js 633 (rocket), 641 (seeker) | low saw + ping | **Replace** with the recorded `explosion`, gain/pan by the hit car's distance/screen x. | v55 |
| `miss` | game.js 633, 642 | 200 Hz triangle | **rev 4:** `sfx_miss` (pulse bend + falling noise fizzle, 0.26 s), sfx bus | v54.4 |
| `bonus` | game.js 279 (? box collected) | 3-note square arpeggio | **Replace** with the recorded `pickup` (bell chime). | v55 |
| `power` | game.js 541 (power-up activated) | saw up-sweep | **rev 4:** `sfx_power` (rising A-major arp, 0.4 s), sfx bus | v54.4 |
| `autopilot` | game.js 557 | 2-note sine | **rev 4:** `sfx_autopilot` (C#6 → E6 PWM, 0.4 s), sfx bus | v54.4 |
| `powerEnd` | game.js 571 (autopilot end), 573 (lap boost end) | 2-note triangle | **rev 4:** `sfx_power_end` (E6 → A5, 0.32 s), sfx bus | v54.4 |

| `handbrake` **(new)** | Developer's v54.4 handbrake input | — | Recorded `handbrake` (yank + ratchet + tyre bite, 0.42 s), sfx bus, rate 0.97–1.03 (`handbrakeParams`) | v54.4 |
| `driftBoost {quality}` **(new)** | v54.4 drift-boost release, quality 0..1 | — | Recorded whoosh + tonal arp (`drift_boost`) + `drift_sparkle` above q 0.7, via `playDriftBoost()` (§3.5) | v54.4 |
| `boostChain` **(new)** | v54.6 DOUBLE BOOST: a second boost (pad, drift boost or button) lands while one is running; the game fires it **instead of** `boost` (max 2 stacks) | — | Recorded `boost_chain` (0.78 s: big whoosh + the boost whoosh, both +4 st, snap, fizz, plus a rising A-major chip arp), sfx bus, gain 1.15, cap 1, via `playBoostChain()`: **music −8 dB** (§3.6, §5). The BoostEdge can't fire on a stack (boostLevel is already > 0.15), and `boost_end` still plays once when the whole boost bleeds out. | v54.6 |
| `denied` **(new)** | missile button tapped while it shows NO TARGET | — | `ui_denied`: a soft two-note "denied" blip E5 → C5, low-passed, 0.16 s, ui bus, quiet (gain 0.5, file peak −9 dBFS) | v54.4 |

The verification hook `self.__RAD_SFX_LOG__.push(name)` must survive the rewrite, because the verify scripts read it.

## 3. Sound specs

### 3.1 v54 "feel"

| Moment (FX pairing) | Evokes | Method | Bus | Spec |
|---|---|---|---|---|
| **Engine** (all cars) | A real 4-cylinder revving hard through 4 short fake gears, with arcade rasp | 5 looping recordings, crossfaded by rpm (`SampleEngineVoice`) | engine | ENGINE_NOTE_SPEC §2–5, 8 |
| **Braking / decel** | Throttle shut: the no-load recording takes over, closing down | off-load loops × √(0.75·(1−load)) + lowpass 12 k → 1.8 kHz | engine | ENGINE_NOTE_SPEC §5 |
| **Boost push** (flame `flame_0..2`) | Bark up (+850 rpm for 150 ms), then hold +490 rpm, brighter (+4 dB shelf) and louder | live engine params | engine | ENGINE_NOTE_SPEC §6 |
| **Boost fire** (`ring` cyan + `glow`) | Real air whoosh + nitro fizz | `boost` (1.1 s) on the boostLevel 0.15 edge | sfx | §3.2 |
| **Boost end** | Real turbo dump-valve "pssh" when the boost bleeds out | `boost_end` (1.25 s) on the re-arm edge (< 0.05) | sfx | §3.2 |
| **Slide squeal** (`smoke_0..3`, `skid`) | Real tyre squeal, rising with slip | `squeal` loop, rate 0.92–1.12 by slip01 | engine | ENGINE_NOTE_SPEC §7 |
| **Wall hit, light** (strength < 0.6) | A short tap + metal scrape: on the edge, not told off | `wall_light_1..3` | sfx | §3.2 |
| **Wall hit, heavy** (≥ 0.6: shake, vibrate, ring) | Real crunch: body thud + metal/plastic | `wall_heavy_1..3` | sfx | §3.2 |
| **Boost pad / lap boost** | Same as boost fire (same edge) | `boost` | sfx | — |
| **Double boost** (v54.6, 2nd stack while boosting) | A bigger, brighter second rush with a rising chip arp on top | `boost_chain` (0.78 s) via `playBoostChain()`, fired by the game instead of `boost` | sfx | §3.6 |

### 3.2 One-shots and runtime maths (v54)

| File | Length | Built from (CC0, details in LICENSES.md) | Processing |
|---|---|---|---|
| `wall_light_1` | 0.56 s | Kenney `impactPlate_light_001` + 220 ms of Pól's metal-rail scrape (385939) at 0.4 s | tap trimmed to onset; scrape with 60 ms exp decay, BP 900–8 k, −5 dB; HP 70, comp 3:1 |
| `wall_light_2` | 0.22 s | Kenney `impactGeneric_light_002` + scrape at 1.3 s | same |
| `wall_light_3` | 0.35 s | Kenney `impactMetal_light_003` + scrape at 2.6 s | same |
| `wall_heavy_1` | 0.52 s | qubodup "Clank Car Crash Collision" (151624) + Kenney `impactPunch_heavy_001` −4 dB | layered at onset, HP 70, +2 dB @ 120 Hz, comp 3:1, ≤ 0.9 s, 180 ms fade |
| `wall_heavy_2` | 0.90 s | LPA134 "Hood Impact" (329516) 0.10–1.10 s + Kenney `impactMetal_heavy_002` −6 dB | same |
| `wall_heavy_3` | 0.72 s | squareal "Car Crash" (237375) 0.38–1.10 s + qubodup "Fast Collision" (332056) −3 dB + Kenney `impactPunch_heavy_003` −6 dB | same |
| `boost` | 1.10 s | ReadeOnly "woosh" (186956) + derplayer "firework_rocket_ignition" (587173) −7 dB, ramped down | HP 120, +2 dB @ 3.5 kHz, comp 2.5:1, 250 ms fade |
| `boost_end` | 1.25 s | EwanPenman11 "Turbo Spooling and Blow Off" (659544), 0–1.25 s (the blow-off) | HP 700, LP 10 k, FFT denoise (the source is at −38 dBFS), comp 2:1, 450 ms fade, peak −3 dBFS |

All one-shots are peak-normalised to −1.5 dBFS, which leaves room for AAC overshoot: the worst decoded peak is −0.7 dBFS. Levels are set by `SHOTS[event].gain` in audio-engine.mjs: wall_light **1.25**, wall_heavy 1.0, boost 0.75, boost_end 0.35.

**Wall trigger (unchanged maths, `wallParams(car.wallHit)`):**

```
strength = clamp((car.wallHit − 200) / 700, 0, 1)     trigger when wallHit > 200, cooldown 150 ms per car
heavy    = strength ≥ 0.6   (wallHit ≈ 620, the same point GD starts camera shake, vibrate and the ring)
gain     = 0.12 + 0.88 · strength^1.2   (× SHOTS base gain)
rate     = 1.04 − 0.08 · strength, ±4 % random     variant: random of 3, never the same twice running
engine duck only when heavy: −(3 + 3·strength) dB for 250 ms; none below 0.6
```

Measured in `v2_wall_hits_in_context` (engine at cruise, about −19 dBFS RMS), as the level in the first 60 ms after each hit:

| wallHit | 230 | 330 | 450 | 560 | 650 | 800 | 1000 |
|---|---|---|---|---|---|---|---|
| tier | light | light | light | light | heavy | heavy | heavy |
| rise over engine | +0.2 dB | +1.6 dB | +4.9 dB | +7.1 dB | +6.7 dB (+4.4 dB tail) | +8.7 (+6.8) | +9.3 (+7.7) |

Light hits are short ticks with no tail over the engine. A 230 wu/s brush is deliberately almost buried, which is the "on the edge" brief. If Callum wants brushes clearer, raise `SHOTS.wall_light.gain` without changing the agreed formula. The light base gain is 1.25 rather than 1.0 so the top of the light tier (560) matches the bottom of the heavy tier (650) instead of jumping.

### 3.3 Shared cues with visuals

FX and audio read **the same values** from the same source, so a hit never looks heavy but sounds light, or the other way round. `audio-engine.mjs` exports `WALL`, `wallStrength`, `BOOST_EDGE`/`BoostEdge` and `SQUEAL` for the FX code to share.

| Driver | Formula / value | Audio uses it for | FX uses it for |
|---|---|---|---|
| **Wall strength** | `strength = clamp((car.wallHit − 200) / 700, 0, 1)`. Fires when wallHit > 200, 150 ms cooldown per car | wall variant tier, gain, rate, engine duck | spark count / length, smoke on scrapes |
| **Heavy threshold** | `strength ≥ 0.6` (wallHit ≈ 620) | `wall_heavy_*` + engine duck | camera shake, `navigator.vibrate`, sodium `ring` |
| **boostLevel** | `car.boostLevel` from `rampBoost()`, 0…1 | engine boost push; `boost` on the 0.15 rising edge, `boost_end` on the re-arm < 0.05 | boost flame; the cyan `ring` on the same 0.15 edge |
| **slip01** | `clamp((abs(vL) − 40)/220, 0, 1)` (v54.2 drift data) | squeal on > 0.22 / off < 0.15 (with speed01 > 0.25); gain `smoothstep(0.22, 0.80, slip01)`, trim 1.0 (engine spec §7) | skid smoke + skid marks on the same flag (`squeal.update()` returns it) |

### 3.4 v55 "rivals" (summary; full detail in V55_SFX.md)

| Moment | Built from | Length | Bus |
|---|---|---|---|
| Missile / rocket launch | qubodup "Rocket Launch" (182794) | 1.45 s | sfx |
| Incoming-missile warning | C-V "backing up beep" (523413): a truck reversing alarm, looped and gated per pulse (40 % of the gap, +4 st rise, solid +5 st) | 1.5 s sequence | **ui** |
| Explosion | misosound close explosion (251759) + Kenney crunch | 1.45 s | sfx |
| Pickup | 5ro4 "bell ding 1" (611113) +5 st + Leszek_Szary coin tick (146723) | 0.60 s | sfx |
| Barge thump | Chippy569 door slams on the 190E (162531) + Kenney punch, 2 variants | 0.40 s | sfx |

### 3.5 v54.4 additions (rev 4; built by `_src/pipeline/build_v544.py`, metadata in `_src/pipeline/v544_meta.json`)

| File | Length | Built from | Notes |
|---|---|---|---|
| `handbrake` | 0.42 s | mhtaylor67 "Hand Brake" (126043) yank 0.125–0.36 s at 1.18× + ninebilly "Handbrake" (173007) ratchet −7 dB + audible-edge Volvo 740 handbrake turn (76804) tyre bite 7.58–7.86 s at +100 ms | comp 3:1, 80 ms fade |
| `drift_boost` | 0.62 s | florianreichelt "quick woosh" (683101) + a chip arp A5–C6–E6–A6 into an E6 shimmer, −5 dB under the woosh | the tonal reward sits on a real whoosh |
| `drift_sparkle` | 0.90 s | newagesoup "GLEAM-GLOW-SFX-CHIME" (351408), HP 2.5 kHz + a 12.5 % pulse twinkle −9 dB | only for quality > 0.7 |
| `ui_*`, `sfx_miss/power/autopilot/power_end` | 0.05–2.0 s | the soundtrack's chip synth (`_src/music/chip.py`); `ui_slam` also uses Kenney `impactPunch_heavy_002` | all in A (minor/major), so they match the music |

**driftBoost maths (`driftBoostParams(q)`):** rate = 2^((−3 + 6q)/12) (−3 … +3 st). Brightness: lowpass 2.5 kHz · (16k/2.5k)^(q²). Gain 0.7 + 0.3q. The sparkle gain is smoothstep(0.7, 0.9, q), at +0 … +1.8 st, starting 120 ms in. For q ≥ 0.5, duck the music −(4 + 2q) dB. In practice: q 0.4 → −1.8 st, LP 3.4 kHz, no sparkle; q 1.0 → +3 st, full band, sparkle, music −6 dB.

### 3.6 v54.6 'DOUBLE BOOST' (rev 4.1; built by `_src/pipeline/build_v546.py`, metadata in `_src/pipeline/v546_meta.json`)

When a second boost (pad, drift boost or button) lands while one is running, the game fires `sfx('boostChain')` **instead of** `boost`. The extra rush is brief and stacks cap at 2.

| File | Length | Built from (CC0 recordings + project synth) | Processing |
|---|---|---|---|
| `boost_chain` | 0.78 s | **body:** Paul368 "Very Big Whoosh" (237980), 0.46–1.50 s · **air:** ReadeOnly "woosh" (186956, the same whoosh family as `boost`), 0.42–1.00 s · **snap:** qubodup "Whoosh" (60013), 0.025–0.30 s · **fizz:** derplayer "firework_rocket_ignition" (587173, as in `boost`), 0.85–1.55 s, −10 dB · **chip arp** (`_src/music/chip.py`) | Every recorded layer is pitched **+4 st** (×1.26, tape-style). Body: 2× HP 300 Hz, −4 dB low shelf @ 500, +4 dB @ 1.8 k, +3 dB high shelf @ 5 k; 12 ms attack, 300 ms hold, then τ 160 ms decay. Air: HP 1.2 k, +2 dB @ 7 k. Comp 3:1 with a 6 ms attack, so the snap gets through. Chip: 25 % pulse E5–A5–C♯6–E6 in 32nds at the race tempo (160 BPM, 46.9 ms steps), plus a 50 % pulse an octave down, into a held A6 with a 50 Hz A-major shimmer (A–C♯–E–A) and vibrato. 16th-note echo (93.75 ms), LP 9 k. The arp sits 3.5 dB RMS under the whooshes. 100 ms fade-out, so there's no tail. Master −2.0 dBTP. |

**Shape:** full level within 10 ms (−11 dB RMS in the first 10 ms, a −13 dB plateau to 0.25 s), −30 dB by 0.5 s, gone by 0.78 s. Against `boost` in its first 0.5 s, as played (gain 1.15 vs 0.75): about +5 dB above 6 kHz and +2 dB at 3–6 kHz, so it's brighter. It's about +15 dB at 300 Hz–1 kHz, which makes it bigger, though phones only reproduce that partly.

**Level:** `SHOTS.boostChain.gain` is 1.15, against `boost` at 0.75. Through the full mixer, including the master compressor, that's **+1.2 dB momentary-max loudness** above a boost (−8.5 vs −9.7 LUFS M-max in the preview's SFX stem). Integrated it's +0.2 LU (−11.1 vs −11.3), because the cue is shorter. Before the compressor the difference is +2.5 dB.

**Trigger (`playBoostChain(shots, mix, t)`):** `shots.play('boostChain')` + `mix.duckMusic(MUSIC_MIX.chainDb = −8, chainHoldS = 0.3)`. The cap is 1 with its own voice, so it lands on top of the first boost's tail. A third trigger would restart it with the usual 10 ms steal fade. The `BoostEdge` can't fire on a stack, because boostLevel is already above 0.15. If boostLevel had dipped under 0.05 that frame (edge re-armed), skip the edge's `boost` on the frame `boostChain` fires. A chained drift boost plays `boostChain` instead of `drift_boost`; adding `drift_sparkle` on top for q > 0.7 is optional. `boost_end` plays once, when the whole (stacked) boost bleeds out.

## 4. Format and file-size budget

**v54.7 (rev 4.2) — the current shipped set.** Full detail, hook map and loading code: `docs/AUDIO_V547_HANDOFF.md`. Every one-shot is now a clip in one sprite; the loops and the music stay separate files. The rev 3–4.1 notes below are kept as history (their per-file one-shot sizes no longer exist as files).

| Spent on | Files | Opus (.ogg) | AAC (.m4a) |
|---|---|---|---|
| Engine loops (`eng_idle/low/high/off_low/off_high`) | 5 | **42.3 KB** (56 kbps VBR, 40 ms; was 51.6) | 64.6 KB (unchanged) |
| Tyre squeal loop | 1 | 7.8 KB (was 9.5) | 12.4 KB (unchanged) |
| Warning beep loop (`warn_loop`) | 1 | 2.6 KB (unchanged) | 2.9 KB (unchanged) |
| **One-shot sprite** (`sfx_sprite`, 29 clips, 20.9 s; per-clip Opus 20–56 kbps, AAC-LC 64 kbps) | 1 | **94.9 KB** | **234.8 KB** |
| Sprite map (`sfx_sprite.json`) | 1 | 1.7 KB (shared) | (shared) |
| **SFX total** | 9 | **147.6 KB** (149.2 KB with the JSON; v54.6: 203.2) | **314.6 KB** (316.3 KB with the JSON; v54.6: 310.3) |
| Music (`music_race/menu/finish`, unchanged) | 3 | **551.7 KB** | 836.2 KB |

How it fits under 150 KB: per-clip Opus settings chosen by measured 1/3-octave band error against the masters (gameplay hits / boost / missile / explosion ≤ +0.15 dB mean over the v54.6 files, loops ≤ +0.1 dB), encoder reset in every 100 ms guard (silence costs 3 B per frame), podium/win no longer carry their own copy of the slam (−10.2 KB), and tails trimmed at an as-played −50 dBFS floor. Chrome decodes both sprite formats sample-exact (every clip at offset 0). AAC stays at quality parity with v54.6 (64 kbps in one stream = 0.73 dB band error vs 0.75 for the old 80 kbps per-file AAC).


- **Primary:** Opus in Ogg (`.ogg`), **mono, 48 kHz, VBR, `-application audio`**:
  - 64 kbps with 20 ms frames for all v54 files and `warn_loop`.
  - v55 one-shots (rev 3.1, to fit the 150 KB budget): `explosion` 54 kbps / 40 ms, `missile_launch` 56 kbps / 40 ms, `pickup` 52 kbps / 20 ms, `barge_1`/`barge_2` 50 kbps / 40 ms. See the rev 3.1 note below for how quality was checked.
- **Fallback:** AAC-LC in MP4 (`.m4a`), mono, 48 kHz, 80 kbps for every file, `+faststart`. AAC bitrates were not lowered: the budget is Opus, and the AAC copies only got the same tail trims.
- **Selection:** `audioExt()` uses `canPlayType('audio/ogg; codecs="opus"')`, else `.m4a`. `loadSounds()` also retries a file as `.m4a` if the `.ogg` fails to decode.
- **Loop points work in both formats.** In Chrome, both decode sample-aligned with the source (offset 0; ENGINE_NOTE_SPEC §2).
- **Safari caveat:** Safari decodes Ogg Opus only from 18.4. Older iPhones take the AAC copy, which relies on the MP4 edit list to trim 1024 samples of priming. Check once on a real iPhone. If it's ignored, loop points land 21 ms late (still clean, because the loops are continuous across their pre-roll).
- **Measured sizes (a device downloads only one format):**

  | Spent on | Files | Opus (.ogg) | AAC (.m4a) |
  |---|---|---|---|
  | Engine loops | 5 (`eng_idle/low/high/off_low/off_high`) | **51.6 KB** | 64.6 KB |
  | Tyre squeal loop | 1 | 9.5 KB | 12.4 KB |
  | Wall hits | 6 (3 light + 3 heavy) | 27.2 KB | 40.3 KB |
  | Boost + blow-off | 2 | 19.8 KB | 27.0 KB |
  | **v54 subtotal** | 14 | **108.1 KB** | **144.2 KB** |
  | v55: missile 10.0 / 16.0, explosion 9.3 / 16.1, pickup 5.8 / 7.3, barge ×2 4.4 / 10.3, warn loop 2.6 / 2.9 | 6 | 32.0 KB | 52.6 KB |
  | **Total through v55** | **20** | **140.1 KB** | **196.8 KB** |

  **rev 4 (v54.4) adds 16 small SFX/UI files: 57.3 KB Opus / 104.4 KB AAC.** Those are Opus 48 kbps constrained VBR (20 ms frames), mono, and AAC 80 kbps. SFX total: **197.4 KB Opus** (was 140.1). That's over Pep's 150 KB SFX cap, so it needs his OK. If it has to come down, the easy trims are `ui_win` (12.5 KB) and `ui_podium` (7.4 KB) at 40 kbps, and dropping `drift_sparkle`'s tail.
  **rev 4.1 (v54.6) adds `boost_chain`: 5.7 KB Opus (5,734 B; 56 kbps constrained VBR, 20 ms frames) / 9.1 KB AAC (9,101 B; 80 kbps).** New SFX total: **203.2 KB Opus / 310.3 KB AAC** (was 197.4 / 301.2), still over the 150 KB cap (see above). Why 56 rather than 48 kbps: at 48 k the 1/3-octave band error against the master was 1.40 dB mean / 4.48 dB p95, because the encoder's high-band fill adds about +1.4 dB of 8–20 kHz energy to this noisy whoosh. At 56 k it was 0.55 / 1.92 dB (64 k: 0.51 / 1.76), for 0.9 KB more. Chrome decodes both files sample-aligned (offset 0, 37,440 samples). Decoded true peak: Opus −2.1 dBTP, AAC −1.6 dBTP.
  **Music (separate budget, §11): 551.7 KB Opus / 836.2 KB AAC.**

  **Budget (Pep, rev 3.1): under 150 KB Opus, aiming for about 140 KB.** Now 140.1 KB, so 9.9 KB of headroom. AAC has no separate cap; it was 300 KB before.

  The biggest spend is the engine (37 % of the Opus total), because five real loops are what make it sound like a car. The 1.0–1.3 s loops are long enough that the loop doesn't drone, while 50 ms pre/post-roll keeps decoding safe. The engine, squeal, walls and boost were not touched in rev 3.1.

  **Rev 3.1 trim (v55 only, 151.9 → 140.1 KB Opus):**
  1. **Tails.** I cut only the parts that had already decayed to about −50 dBFS per 50 ms window or below, then re-faded the last 80 ms. Nothing before the new fade changed.
     - `explosion`: 1.805 → 1.45 s, fade 1.37–1.45 s.
     - `missile_launch`: 1.507 → 1.45 s, fade 1.37–1.45 s.
     - `pickup`: 0.75 → 0.60 s, fade 0.52–0.60 s.
  2. **Opus bitrate and frame size.** For each file I picked the lowest setting whose measured error stayed within about 0.1–0.2 dB of the 64 kbps version.
     - Spectral check: mean / 95th-percentile absolute 1/3-octave band error vs the master. Explosion 0.45 / 1.3 dB (was 0.34 / 1.0 at 64 k); missile 0.53 / 1.6 (0.44 / 1.4); pickup 0.43 / 1.3 (0.34 / 0.8); barges 0.52–0.55 / 1.4–1.6 (0.41–0.43 / 1.1–1.4).
     - Timing check: 2 ms envelope error was within +0.2 dB of the 64 k version.
     - The suggested 40 kbps was **rejected**: it roughly tripled the band error (1.3–1.5 / 3.4–4.0 dB on explosion and missile). `warn_loop` stays at 64 k, because 48 k measurably degraded it and it's only 2.6 KB.
     - Chrome still decodes every changed file sample-aligned (offset 0, exact length), and the worst decoded peak is −0.7 dBFS.
  3. **The second barge variant was kept.** It wasn't needed to reach the target.
- **Loading:** fetch and decode once at race select, not on the title screen, and keep the `AudioBuffer`s for the session. Don't add audio to the service-worker precache. sw.js runtime-caches same-origin GETs, so the fetched format works offline next time. If a file isn't decoded when it's triggered, fall back to the old `beep()` so the game never goes silent. The engine waits for its 5 loops before starting.

## 5. Mixing: buses, priority, ducking, voice limits

```
master 0.9 → DynamicsCompressor (thr −10 dB, knee 6, ratio 4, attack 3 ms, release 150 ms) → destination
  ├─ sfxVol (Effects setting) ← engine 0.5 → engineDuck    player engine, ≤3 rival engines, slide squeal
  │                           ← sfx    0.9 → sfxDuck       hits, boost, boostChain, weapons, pickup, barge, power-ups, handbrake, driftBoost
  │                           ← ui     0.7                 clicks, countdown, lap, finish jingles, denied, missile warning (never ducked)
  └─ musicVol (Music setting) ← musicEng ← musicHit ← music 0.75    race / menu loop, finish sting (rev 4, §11)
```

`createMixer(ctx)` in `audio-engine.mjs` builds exactly this graph (rev 4 adds `music`, `musicHit`, `musicEng`, `musicVol`, `sfxVol`, and the methods `duckMusic`, `engineLevel`, `setMusicVolume`, `setSfxVolume`, `setPaused`). `mix.duck(stage, dB, holdS)` uses a 15 ms attack and 120 ms release, and a new duck extends the current one.

**Priority (high → low):** ui and warning → player explosion / heavy wall / barge → boost / pickup / launches → player engine + squeal → rival engines → distant one-shots.

| Trigger | Duck |
|---|---|
| Heavy wall hit (strength ≥ 0.6 only) | engine −4.8…−6 dB (−(3 + 3·strength)), 250 ms. Light hits: no duck. |
| Explosion on the player | engine −8 dB 400 ms. sfx −3 dB 300 ms *after* the explosion starts, so the salvo tail sits under it. |
| Explosion on a rival | engine −4 dB 250 ms, only if within 600 wu |
| Finish slam (v52 reveal) | engine −10 dB until the results screen, then fade the engine bus to 0 over 1 s and stop the voices |
| Countdown | engine held at −6 dB until GO |
| Heavy wall / explosion / boost whoosh / player barge (`MUSIC_DUCK_EVENTS`) | **music −6 dB** (`mix.duckMusic()`): 20 ms attack, 120 ms hold (explosion 250 ms, boost 300 ms = `MUSIC_MIX.boostHoldS`), recovery τ 130 ms (back within 1 dB in about 400 ms). `boostChain` is also in `MUSIC_DUCK_EVENTS`, but at −8 dB (next row). |
| driftBoost q ≥ 0.5 | music −(4 + 2q) dB, same shape |
| **boostChain** (v54.6, `playBoostChain()`) | **music −8 dB** (`MUSIC_MIX.chainDb`), a bit deeper than the boost whoosh's −6. Same shape: 20 ms attack, 300 ms hold (`chainHoldS`), recovery τ 130 ms, back within 1 dB about 230 ms after the hold ends (≈ 400 ms recovery). It lands while the boost duck is still active or recovering, and the deeper duck wins. Measured −8.0 dB. |
| Player engine loud | music **−2.5 dB, constant** while loud: `mix.engineLevel(speed01)` every frame → −2.5 · smoothstep(0.35, 0.85, level) dB, τ 250 ms |
| Pause | `mix.setPaused(true)`: music muted and engine/sfx off in 50 ms. ui stays live for the pause menu. Then `ctx.suspend()` once the menu no longer needs ui. Reverse on resume. |
| Backgrounding / mute | `attachLifecycle(ctx, mix, shouldResume)`: hidden/pagehide → master to 0 in 50 ms, then `ctx.suspend()`. Music and everything else stop. Resume on visible only if `shouldResume()`. |

**Voice limits:**

| Class | Limit | Steal policy |
|---|---|---|
| Engines | 1 player `'full'` (5 looping sources) + **3 rival `'lite'`** (3 looping sources each), pooled | Reassign to the loudest rivals with 1.25× hysteresis (engine spec §8) |
| Squeal | 1 (player) | — |
| Warning | 1 held loop. Beeps never overlap by construction (beep ≤ 40 % of the gap). | — |
| One-shots | **12 total.** Per event: wall_light 2, wall_heavy 2, barge 2, boost 1, boostChain 1 (its own voice, so it overlaps the boost tail), boost_end 1, pickup 1, missile_launch 3 (a salvo is 3 × 250 ms), explosion 3 | Over the cap, stop the oldest of that sound with a 10 ms fade. Over the global cap, drop the quietest non-player sound. |
| Rival-vs-rival barges | play only within 600 wu, at −9 dB | — |

**Positional one-shots** (rival explosions and barges): gain = `rivalMix(dist, screenX, vw).gain × 2` (that undoes the engine's −6 dB trim), and the same pan rule.

## 6. Sources and licences

- **CC0 only**, checked per item. Every source file's author, title, page URL and licence is in `assets/audio/LICENSES.md`, and the raw log of the per-page check is in `_src/pipeline/sources.tsv`.
- **Freesound:** used only when the item page's licence is CC0, which `fs_get.sh` checks automatically. Downloads are Freesound's public HQ previews, because the originals need a login. They're lossy but high quality, above the shipped bitrate.
- **Kenney** "Impact Sounds" and "Sci-Fi Sounds": CC0, verified in the packs' License.txt.
- **Not used:**
  - Sonniss GDC: not CC0, and the bundles are only multi-GB torrents or zips.
  - CC-BY or unclear items, e.g. qubodup's OGA "Car Engine Loop 96kHz", which is CC-BY/GPL.
  - domasx2's OGA CC0 engine loops: all pitch variants of one quiet sample, and worse than the dyno recordings.
  - Ziph's OGA engines: synthesised.

## 7. Mobile concerns (Chrome on Android first)

- **Unlock:** keep the existing `unlockAudio()` on the first `pointerdown`/`keydown` in main.js 146. Android Chrome allows `resume()` inside that activation. For iOS, also start a 1-sample silent `AudioBufferSource` inside the same handler, and listen on `touchend` too. Today `ensure()` can create the context outside a gesture (any `sfx()` call). That's harmless because it stays suspended until the tap, but don't start the engine voices until `ctx.state === 'running'`.
- **States:** handle `suspended` and also iOS's `interrupted` (phone call or Siri). On the next touch, call `resume()` again: a non-`once` pointerdown listener that is a no-op while running.
- **Latency:** `new AudioContext({ latencyHint: 'interactive' })`. Android output latency is typically 20–60 ms, and 100 ms+ on some budget devices. Trigger every sound in the same frame as its visual and never pre-schedule. `ctx.outputLatency` is worth logging in the verify scripts.
- **CPU:** sample playback is cheaper than the old oscillators. At full load: player 5 looping sources + 5 gains + lowpass + shelf + panner, squeal 1 source + 1 gain, and 3 rivals × (3 sources + 4 gains + panner), about 35 nodes, no WaveShapers, plus short one-shot sources. If FPS stays under 45, drop rival voices first (3 → 1 → 0), mirroring the FX README rule that smoke goes first.
- **Memory:** every file is decoded once per session. That's about 17 s of mono 48 kHz audio, about 3.3 MB of decoded PCM (Chrome keeps AudioBuffers as float32), which is fine on any phone that runs PixiJS.
- **Backgrounding:** on `visibilitychange` → hidden (and on `pagehide`), call `ctx.suspend()`. When visible again, `resume()` only if a race is running and not paused. Today nothing suspends audio. That was harmless with short beeps, but continuous engines would drone in the background.
- **Mute:** `setMuted(true)` should ramp the master to 0 and suspend, not just skip new beeps. Held voices (engine, warning tone) otherwise keep sounding.
- **Silent switch (iOS):** Web Audio follows the ringer switch by default (`navigator.audioSession.type` 'auto'/'ambient' on Safari 16.4+). Keep it that way so a game doesn't blare in silent mode.
- **Phone speakers** roll off below about 300 Hz. The engine loops carry +3 dB at 2.6 kHz and a tanh drive, so the firing harmonics and mechanical rasp carry on a phone. The 85–210 Hz firing fundamentals only matter on headphones.

## 8. Howler vs plain Web Audio: **plain Web Audio**

No clear case for Howler:
1. Even sample-based, the heart of v54 is `AudioParam` automation: 5 crossfaded loops with per-frame playbackRate, sample-accurate `loopStart`/`loopEnd`, the brake filter, and a gated warning loop. Howler exposes none of that (no loopStart/loopEnd on a sprite with rate automation), so we'd write the Web Audio code anyway.
2. Only 20 small files ship (152 KB). Howler's sprites, HTML5-audio fallback and pooling solve problems we don't have.
3. Codec choice (`canPlayType` + decode fallback) and unlock are about 30 lines, and they're already sketched above.
4. The codebase is plain ES modules with no build step and an existing Web Audio `audio.js`. Howler would add a vendored UMD file (about 36 KB min, about 10 KB gz) and a second audio graph alongside ours.

Revisit only if we move to many long streamed files (music, which is out of scope).

## 9. Code changes Developer will need (js/ is not touched by this pass)

1. `sfx(name, opts)`: add an options argument: `wall {wallHit}` (→ shared strength), `warn {ttc, solid}` + `warnEnd`, `barge {carHit, pan, playerInvolved}`, `hit {dist, screenX}`.
2. A mixer with buses, created once, plus `loadSounds()` for the files (§4). Simplest path: copy `assets/audio/_src/audio-engine.mjs` into `js/` (for example as `js/audio-engine.mjs`) and call it from `audio.js`.
3. Replace `setTimeout` chains with audio-clock offsets (`t0 + 0.09`, etc.).
4. Suspend on pause, visibility and mute (§7).
5. v54 engine hook → `engineFrame({ speed01, boostLevel, slip01 }, others)` (engine spec §10), with rivals as `{id, index, speed01, boostLevel, dist, screenX}`. Remove the `sfx('boost')` at game.js 459, because the hook fires it on the boostLevel edge.
8. Shared cue constants (§3.4) live in one module used by both the FX and the audio code.
6. **`car.carHit` is never cleared.** physics.js 141 sets it on contact, but unlike `wallHit` it's never reset, so barges can't be edge-detected. Zero it at the top of `resolveCarCollisions()` (needed for v55 barging).
7. version.js: add `audio-engine.mjs` to `RADCARS_BUILD.assets` if it moves into `js/`. Audio files stay out of the precache list (sw.js runtime-caches them on first fetch).

## 10. Previews for Callum

**rev 4 (v54.4 + music):** the MP4s are in `/workspace/radcars-audio/previews/video/v3/`, with WAV, Opus and AAC copies plus timelines in `/workspace/radcars-audio/previews/v3/`. They're rendered by `_src/render3.mjs` + `scenes3.mjs`, which play the shipped files through the real mixer in headless Chrome. The `m_*` stems are for measurement only (`measurements.json`).

| Preview | What happens |
|---|---|
| `v3_race_scene.mp4` (38 s) | countdown 3-2-1 (engine −6 dB) → GO at 3.0 s, race loop starts → light hits 8.0 / 9.6 s → handbrake 11.8 s + drift → driftBoost q 0.4 at 13.4 s → handbrake 15.6 s → driftBoost q 1.0 at 17.0 s (sparkle, music duck) → BOOST 20–22 s (whoosh, music −6 dB, blow-off) → heavy wall 24.5 s → explosion 27 s → lap chime 30 s → finish 33 s: podium (with slam) + race loop crossfades into the sting |
| `v3_menu_loop_seam.mp4` (46 s) | the menu track from the top, through the loop seam at 37.5 s |
| `v3_race_loop_x2.mp4` (122 s) | the race loop twice: seams at 60 s and 120 s |
| `v3_oneshots.mp4` (22 s) | handbrake, driftBoost at q 0 / 0.4 / 0.7 / 1.0, click, countdown ×3, GO, lap, denied ×2, miss, power, autopilot, powerEnd, slam, podium, win |

**rev 4.1 (v54.6 DOUBLE BOOST):** `/workspace/radcars-audio/previews/video/v3/v3_boost_chain.mp4` (12 s). The WAV/Opus/AAC copies, timeline, measurement stems (`m_bc_*`) and `measurements.json` are in `/workspace/radcars-audio/previews/v3_546/`. It's rendered by `_src/render_v546.mjs --scenes scenes_v546.mjs` (render3 plus a `--scenes` flag), which plays the shipped files through the real mixer in headless Chrome. The MP4 is built by `/workspace/radcars-audio/tools/video_v546.py`: a scrolling showwaves cline, a whole-clip overview with a playhead, and event labels. There's no engine in this scene, so the ducks are heard and measured without the −2.5 dB engine baseline.

| Preview | What happens |
|---|---|
| `v3_boost_chain.mp4` (12 s) | 0.0 race loop starts → **1.50 `boost`** (music −6 dB) → **2.50 `boostChain`** lands on top, 1.0 s later (music −8 dB, back by about 3.0 s) → 5.00 `boost_end` (the stacked boost bleeds out) → 6.40 music fades out over 0.5 s → **7.60 `boostChain` solo, dry** → 9.10 `boost` solo, dry (reference) → 10.60 `boostChain` solo, dry again |

v2 (rev 3) previews:

All in `/workspace/radcars-audio/previews/v2/`. Each preview is a `.wav` plus `.ogg` (Opus 96 k) / `.m4a` (AAC 128 k), with a `.timeline.txt` of the simulated game state per scene. They were rendered by playing **the shipped files** through `audio-engine.mjs` and the real mixer in headless Chrome. The **MP4s** are in `/workspace/radcars-audio/previews/video/v2/` (waveform video with a title).

| Preview | What happens |
|---|---|
| `v2_engine_sweep` (18 s) | idle on the grid → GO → 4 gears with dip-and-rise shifts → BOOST 5.0–7.0 s (whoosh + push, blow-off at about 7.5 s) → v54.2 drift corners with the real squeal: Cargo-like 7.8–9.2 s (entry 0.30 → peak 0.57 → mid 0.39) and Razor-like 10.0–11.5 s (0.30 → 0.74 → 0.73), each fading over 400 wu → wall scrape at 12.6 s (wallHit 420, \|vL\| 185 = p90, about 0.15 s scrub) and hard hit at 13.5 s (wallHit 800, \|vL\| 565 = max, about 0.3 s) → BRAKE 14.4–15.5 s (no-load loops + lowpass) → re-accelerate |
| `v2_wall_hits_in_context` (9 s) | engine at cruise, wall hits at 230 / 330 / 450 / 560 (light) and 650 / 800 / 1000 wu/s (heavy, with engine duck) |
| `v2_boost` (5.5 s) | cruise at the cap → BOOST for 2 s → bleed-off with blow-off |
| `v2_rivals` (7 s) | player + 3 rival engines (overtake left→right, alongside right, pulling away) |
| `v2_v55_warn_approach` (4 s) | the agreed 1.5 s incoming warning → solid → impact explosion, engine ducked, car spins |
| `v2_v55_set_in_context` (11 s) | pickup → 3-rocket salvo → 2 explosions → 3 barges (one rival-vs-rival) → incoming lock → impact |
| `v2_oneshots_dry` (16 s) | every one-shot variant on its own |

The rev 1–2 synth previews in `previews/` and `previews/video/*.mp4` are superseded.

## 11. Music (rev 4, v54.4)

Callum asked for an 8-bit chiptune soundtrack, so the music is synthesised. Gameplay SFX stay recorded. Everything is written as code in `assets/audio/_src/music/`:
- `chip.py`: the synth. PolyBLEP band-limited pulse with per-sample duty (PWM sweeps), NES-style per-frame duty sequences, delayed vibrato, portamento slides and 50 Hz per-frame arpeggios. A 32-step NES triangle (bass). NES 15-bit LFSR noise in long and short mode (drums). An Amiga-style echo.
- `songs.py`: the score as data (chords, 8th-note melody tokens, 16-step drum grids).
- `build_music.py`: renders it. Run `python3 build_music.py <outdir>` (numpy + scipy), then encode as in the table below.

| File | Length | BPM / key | Form | loopStart → loopEnd (s) | Opus | AAC |
|---|---|---|---|---|---|---|
| `music_race` | 60.000 s loop (+50 ms pre/post-roll) | **160**, A minor | 40 bars: A hook (Am–F–C–G–Am–F–G–E) · A2 (+harmony, 4-on-floor, shimmer arps) · B pre-chorus (F–G–Em–Am…) · C breakdown/build (Dm–Am–Dm–E…, snare roll) · A3 (lead at 12.5 % duty, octave double) | **0.05 → 60.05** (samples 2400 → 2882400) | 338.6 KB (44 kbps) | 497.4 KB (64 kbps) |
| `music_menu` | 37.500 s loop | **128**, A minor / C | 20 bars: A (F–G–Em–Am), B (Dm–Am–F–G…E), 4-bar turnaround. Half-time drums, 50 % PWM lead with echo, broken-chord arps, walking bass | **0.05 → 37.55** (2400 → 1802400) | 193.2 KB (40 kbps) | 311.4 KB |
| `music_finish` | 3.2 s, one-shot | 160, A minor → **A major** | C–E–G–C pickup, F and G stabs, then an A-major chord with vibrato lead, arp shimmer, kick and crash | — | 19.8 KB (48 kbps) | 27.4 KB |
| **Total** | | | | | **551.7 KB** (target ≤ 600) | 836.2 KB |

**Voices:** a lead pulse (duty and PWM per section, slides marked `~`, vibrato on long notes), a harmony pulse (the chord tone below the lead), an arp pulse (16th broken chords, or 50 Hz per-frame shimmer), and bass on triangle **plus a 12.5 % pulse an octave up** so it still reads on phone speakers. Drums are a triangle-sweep kick with a pulse click, a noise+tone snare, short-LFSR hats, a noise crash and triangle toms. All of it is mono.

**Seamless loops:** the score is deterministic. It's rendered 3× back to back and the middle cycle is cut with 50 ms of pre/post-roll, so every note tail and echo that crosses the seam is already in the file. In the master, the post-roll is bit-identical to the loop head (seam diff 0.0). L is an integer number of samples (an 8th note = 9000 samples at 160 BPM, 11250 at 128), so loopEnd − loopStart is exact.

**Encoding:** Opus mono, constrained VBR, `-application audio`. The master peaks at −3 dBFS, so the decoded peak is ≤ −1.7 dBFS. AAC-LC mono 64 kbps as the fallback.

**Player (`MusicPlayer` in audio-engine.mjs):**
- Menu: `play('music_menu')` (0.4 s fade-in).
- Race select: load `MUSIC_FILES` after the SFX, so the engine never waits on music.
- GO: `play('music_race', {fadeS: 0})` on the countdownGo frame (the loop crossfades out of the menu track over 0.3 s).
- Finish (the slam frame): `finish()` crossfades the race loop out (equal-power, 250 ms) and starts the sting at full level.
- Results screen: `play('music_menu')` again after the sting (≥ 3.2 s).
- Pause: `mix.setPaused(true)` mutes the music.
- Backgrounding: `attachLifecycle` suspends.
- Settings: **Music volume** (`setMusicVolume`, default 0.8) is separate from **Effects volume** (`setSfxVolume`, default 1, covering engine, sfx and ui). Both use a squared slider curve; persist them in localStorage.

**Measured (Chrome OfflineAudioContext, shipped Opus files, `previews/v3/measurements.json`):**
- Music bed in the race (GO → finish, ducks active): **−20.3 LUFS**. Undocked it's −17.8. The SFX + engine stem is −15.2 LUFS, and the full mix is −14.4 LUFS with a true peak of −1.3 dBFS. The loops alone through the bus: race −17.9 LUFS, menu −16.5 LUFS.
- Duck depth, music relative to an undocked render, in 50 ms windows:

  | Trigger | Music level |
  |---|---|
  | Engine-loud baseline | −2.5 dB (−2.48 measured at cruise) |
  | Heavy wall hit | −8.3 dB total (−6 hit + −2.5 engine), back to the −2.5 baseline about 400 ms later |
  | Boost whoosh | −8.5 dB held for 0.3 s, then the same recovery |
  | Explosion | −7.5 dB |
  | driftBoost q 1.0 | −8.3 dB |
  | **boostChain** (rev 4.1, `v3_boost_chain`, no engine baseline) | **−8.0 dB** hit duck, held 0.3 s, back within 1 dB 530 ms after the trigger. The boost in the same render measures −6.0 dB and 500 ms. In a race with the engine loud, expect about −10.5 dB total. |
  | Light hits | no hit duck |

- Seams: in the rendered `v3_race_loop_x2`, the audio after the 120 s seam is bit-identical to the audio after the 60 s seam. Cycle 2 equals cycle 1 after the first 2 s (the start differs only by the master compressor's settling). The largest sample step near a seam is 0.21, against 0.37 at p99.9 across the track, so there's no click. In the decoded Opus file, the jump at the seam is 0.03, below the track's typical (p99) step of 0.15. Menu: the same result.
