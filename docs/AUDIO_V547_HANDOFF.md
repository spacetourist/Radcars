# Radcars v54.7 "the sound release": audio handoff

Audio Engineer · 7 Oct 2026 · for Pep / Developer, Callum signs off. **Nothing in `js/` was touched and nothing is committed.** This doc is the whole contract between the audio files and the game: every file, every hook, every gain, and how to load it with plain Web Audio. The reference implementation is `assets/audio/_src/audio-engine.mjs` (plain ES module, no build step, no dependencies), and the sign-off preview was rendered through exactly that code with exactly these files.

**Sign-off preview:** `/workspace/radcars-audio/previews/video/v547/v547_full_race.mp4` (62.5 s, timeline in §10).

## 1. What changed in v54.7, and why (measured)

All measurements use the shipped files decoded by Chrome, played through the reference mixer in headless Chrome (OfflineAudioContext). "Phone" means a 4th-order Butterworth band-pass of 300 Hz–8 kHz (phones lose everything under about 150 Hz). Loudness is K-weighted, momentary-max (M-max, 400 ms).

| Area | Change | Measured before → after |
|---|---|---|
| **Engine: top gear** | The 4th gear now ends at the player's real top speed, speed01 0.909 (PLAYER_TOP 1000 / 1100). v54.6 assumed speed01 reached 1.0, so full throttle stopped at 6300 rpm. | Top-speed cruise: 6222 rpm / 207 Hz → **7002 rpm / 233 Hz** (+2.0 st). The pitch climb across 4th gear went from +3.5 st (169 → 207 Hz) to **+5.2 st** (173 → 233 Hz). |
| **Engine: shift points** | 0.25 / 0.5 / 0.76 → **0.3 / 0.56 / 0.8**. | On the game's throttle curve, gears 1–3 lasted 0.37 / 0.63 / 1.72 s, so two shifts landed inside the first second. They now last **0.46 / 0.81 / 2.0 s**, and then 4th climbs 4900 → 7000 rpm over about 6 s. |
| **Engine: DOUBLE BOOST rush** | The engine used to clamp boostLevel at 1, so the chain rush (boostLevel 1.35 for 1.2 s) was only heard through speed. Now `chainK = (boostLevel − 1)/0.35` adds +0.07 rpm01, +3 % rate, +2 dB shelf at 2.5 kHz and +10 % level. The high-band rate cap went from 1.42 to 1.45. | During the rush: 275–281 Hz → **318–323 Hz** (+2.4 st; +2.0 st above a plain boost), phone level −18.3 → **−16.0 dB** (+2.3 dB). |
| **Engine: boost rev** | `boostHold` 0.08 → 0.13, `boostKick` 0.14 → 0.19 (the 150 ms bark stays +0.06). With cruise now at 7000 rpm, the cruise → boost jump had shrunk to +2.0 st at 0.2 s and +2.9 st at 0.8 s. | Cruise → boost: **+2.7 st at 0.2 s, +3.2 st at 0.4 s, +3.5 st at 0.8 s** (v54.6 from its lower cruise: +2.7 / +3.7 / +4.4). Absolute boost pitch at 0.8 s: 268 → **285 Hz**. Phone level +5.3 dB on the boost (v54.6 +4.8). |
| **Squeal** | +3 dB more between slip 0.8 and 1.0 (handbrake slides, spins). Gain is unchanged below 0.8, so the normal drift mix (0.4–0.75) is the same. | At full slip: squeal −22.1 vs engine −20.9 LUFS (phone −22.1 vs −21.9) → **squeal −19.1 vs engine −20.9 (phone −19.1 vs −21.9)**. The squeal now sits on top during a handbrake slide. Tracking the v54.5 slide (slip pinned at 1.0 for 0.5 s, then a linear 400 ms decay): onset reaches −10 dB in 30–50 ms. Release after the decay starts: −10 dB at 200–220 ms (was 240–270), −20 dB at 310 ms (was 320–330), −40 dB at 460 ms (was 480–490). It follows the 400 ms slip decay. |
| **Heavy hits, explosion, barge, slam** | "Phone pass" on `wall_heavy_1/3`, `explosion`, `barge_1/2`, `ui_slam`: a −4 dB low shelf at 110 Hz, the 35–180 Hz harmonics re-synthesised into 300–1600 Hz at −3 dB, +3 dB at 2.5 kHz, and a tanh soft clip, so the weight survives on a phone. `wall_heavy_2` was re-sliced: its main hit was 125 ms late. | File phone M-max at equal peak: wall_heavy_1 +4.6 dB, wall_heavy_2 +2.5 dB (attack +6.7 dB), wall_heavy_3 +3.1, explosion +3.6, barge +1.6 / +2.9, slam +4.2. **In the race mix (phone band, over the top-gear engine): heavy wall +5.7 → +7.9 dB, explosion on the player +1.8 → +4.8 dB, rival hit −1.1 → +1.9 dB.** |
| **Boost** | The same whoosh and ignition fizz, plus two real anti-lag exhaust pops (modusmogulus 797835, CC0) on the front. | Phone attack −18.6 → **−11.0 dB** (+7.6), attack vs body −1.3 → **+6.1 dB**. In the mix, the boost-button attack is +5.8 → **+11.4 dB** over the engine (same overall loudness). |
| **Missile launch** | 38 ms of silent lead-in cut. Gain 0.7 → **1.0**. | In the mix it sat only +3.0 dB (phone) over the engine, against +7.9 for a heavy wall and +8.8 for a boost. Now **+4.7 dB**, and it starts on the press. |
| **Lead-ins / tails** | Silent lead-ins cut on `drift_boost` (28 ms), `boost_end` (26 ms) and `drift_sparkle` (1 ms); the sparkle delay is now 0.093 s, so the spacing is unchanged. Tails trimmed where they fall under −50 dBFS as played, with a 40 ms fade. | Saves bytes; nothing audible is lost. |
| **Podium / win dedupe** | The slam is no longer baked into the podium/win files. The new clips `podium_jingle` / `win_fanfare` are only the jingle, and `ShotPlayer.play('podium' \| 'win')` plays the slam plus the jingle 0.30 s later. | Matches the v54.4 mixes to −80 dB, except for the baked slam echo: −21 dB (podium) / −27 dB (win) difference. Saves 10.2 KB Opus. |
| **One-shot sprite** | All 29 one-shots are in one `sfx_sprite.ogg` / `.m4a` plus `sfx_sprite.json`. The loops and the music stay as separate files. | Chrome decodes both formats sample-exact: every clip at offset 0, length 1,003,200 samples = the master. Details in §7. |
| **Budget** | Per-clip Opus settings chosen by measured band error (§8). | SFX Opus **203.2 → 147.6 KB** (149.2 KB with the JSON). AAC 310.3 → 314.6 KB (316.3 with the JSON). Music unchanged. |

**Not changed:** light wall hits (on purpose: a 380 brush stays almost buried, +0.7 dB phone), `pickup`, `handbrake`, the chip UI cues, `denied` (quiet by design since v54.4: +0.7 dB over the engine), `warn_loop`, music, mixer buses and the duck depths.

## 2. Files (assets/audio/, 48 kHz mono)

| File | What | Opus (.ogg) | AAC (.m4a) |
|---|---|---|---|
| `eng_idle`, `eng_low`, `eng_high`, `eng_off_low`, `eng_off_high` | engine loops (Chippy569 190E dyno) | 42,258 B (56 kbps VBR, 40 ms, written by `oggopus.py`) | 64,563 B (unchanged) |
| `squeal` | tyre-squeal loop | 7,840 B | 12,368 B (unchanged) |
| `warn_loop` | v55 incoming-missile beep loop | 2,599 B (unchanged) | 2,892 B (unchanged) |
| **`sfx_sprite`** | all 29 one-shots, 20.9 s | **94,858 B** (per-clip 20–56 kbps) | **234,765 B** (AAC-LC 64 kbps) |
| **`sfx_sprite.json`** | `{clip: {start, duration}}` in seconds | 1,674 B (shared) | (shared) |
| `music_race`, `music_menu`, `music_finish` | chiptune (unchanged since v54.4) | 551,675 B | 836,208 B |

**Totals a device downloads (one format):** SFX **147.6 KB Opus** (+1.7 KB JSON = 149.2 KB; v54.6: 203.2 KB) or **314.6 KB AAC** (+JSON 316.3 KB; v54.6: 310.3 KB). Music **551.7 KB Opus / 836.2 KB AAC** (≤ 600 KB Opus cap). The v54.6 one-shot files (`wall_light_1.ogg` … `ui_win.m4a`, 58 files) are gone from `assets/audio/`; they're kept in `/workspace/radcars-audio/v547/retired_oneshots/`.

Loop points (seconds; the engine table also carries the recorded rpm): `LOOPS` in `audio-engine.mjs`. They're unchanged from v54.6, and the re-encoded Opus loops decode to exactly the master length with offset 0. Seam click metric: all < +3 dB (clean is < +6 dB).

## 3. Loading (plain Web Audio, no build step)

The simplest route: copy `assets/audio/_src/audio-engine.mjs` to `js/audio-engine.mjs` and let `js/audio.js` drive it (§4). `loadAll()` fetches and decodes the 7 loop files and the sprite in parallel. Load the music lazily, menu track first.

```js
import * as A from './audio-engine.mjs';
const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
const mix = A.createMixer(ctx);
const ext = A.audioExt();                                   // 'ogg' (Opus) if canPlayType says so, else 'm4a'
const B = await A.loadAll(ctx, 'assets/audio/', ext);       // { eng_idle: AudioBuffer, …, wall_heavy_1: {buffer, start, duration}, … }
Object.assign(B, await A.loadSounds(ctx, 'assets/audio/', ext, ['music_menu']));   // later: 'music_race', 'music_finish'
const shots = new A.ShotPlayer(ctx, mix, B);                // plays sprite regions: source.start(t, start, duration)
```

**Without the module**, a sprite is just one decoded AudioBuffer plus offsets:

```js
const ext = new Audio().canPlayType('audio/ogg; codecs="opus"') ? 'ogg' : 'm4a';
const [map, sprite] = await Promise.all([
  fetch('assets/audio/sfx_sprite.json').then((r) => r.json()),
  fetch(`assets/audio/sfx_sprite.${ext}`).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b))
]);
function playClip(name, { when = ctx.currentTime, gain = 1, rate = 1, out = ctx.destination } = {}) {
  const r = map[name], s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = sprite; s.playbackRate.value = rate; g.gain.value = gain;
  s.connect(g); g.connect(out);
  s.start(when, r.start, r.duration);   // offset + duration are buffer seconds (rate-independent); ends at when + duration / rate
  return s;
}
```

Notes:
- `start`/`duration` are seconds, so they stay right when the context runs at 44.1 kHz (the browser resamples the whole sprite on decode).
- Each `duration` already includes 30 ms of the silent guard after the clip. A browser that ignored the AAC edit list (1024-sample priming, 21.3 ms) would still play the whole clip, just 21 ms late.
- Fall back to `.m4a` if the `.ogg` fails to decode (`loadSprite()` does this).
- Unlock on the first tap: `ctx.resume()` inside a user-gesture handler (the game's `unlockAudio()` already does this).

## 4. Hook map: game → audio

Gains below are the `SHOTS` base gains; `opts.gain` multiplies them. Buses: **sfx** 0.9 (ducked by `sfxDuck`), **ui** 0.7 (never ducked), **engine** 0.5. All three feed `sfxVol` (the Effects setting) → master 0.9 → compressor (−10 dB, 4:1).

### 4.1 `sfx(name, opts)` → sprite clip and parameters

| Game call (where) | Plays (`shots.play(…)`) | Clip(s) | Params / rule | Music duck |
|---|---|---|---|---|
| `sfx('wall', {wallHit})` (game.js 382, player only, 150 ms cooldown) | `p = A.wallParams(wallHit)` → `shots.play(p.name, {gain: p.gain, rate: p.rate})` | `wall_light_1..3` (strength < 0.6) / `wall_heavy_1..3` (≥ 0.6), random variant, never the same twice running | gain 0.12 + 0.88·s^1.2; rate 1.04 − 0.08·s ± 4 %; heavy: `mix.duck(mix.engineDuck, p.duckDb, 0.25)` (−3 … −6 dB) | heavy: `mix.duckMusic()` −6 dB |
| `sfx('boost')` (game.js 389: boostLevel 0.15 rising edge; skipped on the frame a chain lands) | `shots.play('boost')` | `boost` | gain 0.75 | −6 dB, hold 0.3 s: `mix.duckMusic(A.MUSIC_MIX.hitDb, A.MUSIC_MIX.boostHoldS)` |
| `sfx('boostChain')` (game.js 653) | `A.playBoostChain(shots, mix)` | `boost_chain` | gain 1.15, **instead of `boost`** (§5) | −8 dB, hold 0.3 s (inside playBoostChain) |
| *(no game call)* boostLevel falls below 0.05 | `if (engState.edge === 'off') shots.play('boost_end')` in the engine hook | `boost_end` | gain 0.35 | — |
| `sfx('driftBoost', {quality})` (game.js 572) | `A.playDriftBoost(shots, mix, quality)` | `drift_boost` + `drift_sparkle` (q > 0.7, starts 0.093 s later) | rate −3 … +3 st, LP 2.5 → 16 kHz, gain 0.7 + 0.3q; sparkle smoothstep(0.7, 0.9, q). The drift boost then raises boostLevel, so the 0.15 edge **also** fires `boost`: that's the game's design ("through the normal boost path"), and the preview plays both. | q ≥ 0.5: −(4 + 2q) dB |
| `sfx('handbrake')` (game.js 684) | `shots.play('handbrake', A.handbrakeParams())` | `handbrake` | gain 0.8, rate 0.97–1.03 | — |
| `sfx('missile')` (game.js 703 rocket salvo, 812 seeker) | `shots.play('missile_launch', {rate: 0.98 + Math.random() * 0.06})` | `missile_launch` | **gain 1.0** (v54.7), cap 3 | — |
| `sfx('hit')` (game.js 821 / 829) | `shots.play('explosion', {gain: 0.8})`, engine `mix.duck(mix.engineDuck, −4, 0.3)` | `explosion` | a hit on the car ahead: 0.8 for now (no position in today's game; v55: gain/pan from `rivalMix`) | −6 dB |
| *(v55)* missile hits the player | `warn.stop(); shots.play('explosion'); mix.duck(mix.engineDuck, −8, 0.4)` | `explosion` | gain 1.0 | −6 dB, hold 0.25 s |
| `sfx('miss')` | `shots.play('miss')` | `sfx_miss` | gain 0.5 | — |
| `sfx('denied')` (game.js 808, NO TARGET) | `shots.play('denied')` | `ui_denied` | gain 0.5, ui bus, quiet on purpose | — |
| `sfx('bonus')` (game.js 355) | `shots.play('pickup')` | `pickup` | gain 0.6 | — |
| `sfx('power')`, `sfx('autopilot')`, `sfx('powerEnd')` | `shots.play('power' \| 'autopilot' \| 'powerEnd')` | `sfx_power`, `sfx_autopilot`, `sfx_power_end` | gain 0.45 | — |
| `sfx('lap')` (game.js 467) | `shots.play('lap')` | `ui_lap` | gain 0.5, ui | — |
| `sfx('click')` (ui.js) | `shots.play('click')` | `ui_click` | gain 0.6, ui | — |
| `sfx('countdown')`, `sfx('countdownGo')` (game.js 339) | `shots.play('countdown' \| 'countdownGo')` | `ui_countdown`, `ui_go` | 0.55 / 0.6, ui. On GO also start the race music (§4.3). | — |
| `sfx(f.cele.tier.sound)` = `'slam'` / `'podium'` / `'win'` (game.js 509) | `shots.play(tier.sound)` | `slam` → `ui_slam`; `podium` → `ui_slam` + `podium_jingle` at +0.30 s; `win` → `ui_slam` (×0.866) + `win_fanfare` at +0.30 s | 0.7, ui. **Don't also play `slam` for podium/win** (§5). | — |
| *(v55)* barge: `car.carHit` | `p = A.bargeParams(carHit, playerInvolved)` → `shots.play('barge', p)` | `barge_1/2` | gain (0.35 + 0.65k), rival-vs-rival −9 dB | −6 dB (player involved) |

`MUSIC_DUCK_EVENTS` in the module lists the events that duck: wall_heavy, explosion, boost, barge, boostChain (plus driftBoost q ≥ 0.5 inside `playDriftBoost`).

### 4.2 `engineFrame({speed01, boostLevel, slip01}, others)` (game.js 399, every frame)

```js
// created at race start: one player voice, a squeal voice, RIVAL_VOICES (3) 'lite' voices
const eng = new A.SampleEngineVoice(ctx, mix.engine, B);
const sq = new A.SquealVoice(ctx, mix.engine, B);
const rivals = [0.94, 1.05, 0.97].map((p) => new A.SampleEngineVoice(ctx, mix.engine, B, { quality: 'lite', pitchMul: p }));
export function engineFrame(p, others) {
  const t = ctx.currentTime;
  const st = eng.update(p.speed01, p.boostLevel, p.slip01, t);   // boostLevel up to 1.35 (DOUBLE BOOST rush) is used now
  if (st.edge === 'off') shots.play('boost_end', { t });          // nothing in game.js fires boost_end
  const squealing = sq.update(p.speed01, p.slip01, t);            // same flag as skid smoke / marks
  mix.engineLevel(Math.min(1, p.speed01), t);                     // music −2.5 dB while the engine is loud
  rivals.forEach((v, i) => {
    const o = others[i];
    if (!o) return v.place(0, 0, t);
    const m = A.rivalMix(o.dist, o.screenX);                       // screenX is normalised 0..1 (vw defaults to 1 in v54.7)
    v.place(m.gain, m.pan, t); if (m.gain > 0) v.update(o.speed01, Math.min(1, o.boostLevel || 0), 0, t);
  });
}
```

Countdown: hold the engine 6 dB down until GO with `mix.duck(mix.engineDuck, −6, secondsToGo)`. At the finish: `mix.duck(mix.engineDuck, −10, 4)`. At race end: `eng.stop(); sq.stop(); rivals.forEach((v) => v.stop())`.

### 4.3 Music (`MusicPlayer`, music bus 0.75 → musicHit → musicEng → musicVol)

| Moment | Call |
|---|---|
| Title / menus (first tap) | `music.play('music_menu')` (0.4 s fade-in) |
| Race loads (before the countdown) | `music.stop({fadeS: 0.5})` |
| GO | `music.play('music_race', {fadeS: 0})`, on the same frame as `sfx('countdownGo')` |
| Player finishes (the frame `sfx(tier.sound)` fires) | `music.finish()`: equal-power 250 ms crossfade from the race loop into `music_finish` (3.2 s, not looped) |
| Results screen → menu | `music.play('music_menu', {fadeS: 1.0})` |
| Quit from pause | `music.stop()` then `music.play('music_menu')` |

### 4.4 Incoming-missile warning (v55, `warnPulse` is not in js/ yet)

`const warn = new A.WarnVoice(ctx, mix.ui, B)`. The game calls `warnPulse({ttc, solid})` from the game clock (gap `A.warnGap(ttc)`: 480 → 160 ms as ttc goes 1.5 → 0.3 s; solid below 0.3 s) → `warn.pulse({ttc, solid})`. Call `warn.tick()` every frame (it releases a solid tone if no solid pulse arrived for 150 ms). Call `warn.stop()` on impact or evade. It's on the ui bus, so it's never ducked. In the preview: 41.0–42.5 s.

## 5. Rules that matter

1. **`boostChain` plays instead of `boost`.** game.js already skips `sfx('boost')` on the frame a chain lands. The engine's BoostEdge can't fire on a stack (boostLevel is already > 0.15). `boost_end` plays once, when the whole stacked boost bleeds out (re-arm < 0.05).
2. **`podium` / `win` contain the slam.** In v54.7 the slam isn't baked into a file any more: `ShotPlayer.play('podium')` plays `ui_slam` at once and `podium_jingle` 0.30 s later (`win`: slam ×0.866, then `win_fanfare`). The game fires only `sfx(tier.sound)`. Never add `sfx('slam')` for podium/win, or you'll get two slams.
3. **`boost_end` is the audio module's job**, on `eng.update(...).edge === 'off'`.
4. **Squeal on/off flag = skid FX flag.** `sq.update()` returns it, so audio and smoke share the same hysteresis (on > 0.22, off < 0.15, speed01 > 0.25).
5. **Never cut a source without a ramp.** Voice caps steal with a 10 ms fade. Loops stop through `stop()` (τ 30–50 ms).

## 6. Volumes, pause and visibility

- **Settings:** two sliders, **Music** and **Effects** (0..1, persisted, e.g. `localStorage['radcars.musicVol']` default 0.8, `['radcars.sfxVol']` default 1.0) → `mix.setMusicVolume(v)` / `mix.setSfxVolume(v)` (gain = v², so 0.1 ≈ −20 dB, 0 = silent). Effects covers the engine, sfx and ui. The existing single "Sound On/Off" toggle (`save.mute` → `setMuted`) stays as the master mute: master → 0 and suspend, as `audio.js` already does.
- **Pause menu:** `mix.setPaused(true)` mutes the music (50 ms) and the engine/sfx buses, but **keeps the ui bus** so pause-menu clicks are heard. Resume: `mix.setPaused(false)`. Today's `setAudioPaused()` suspends the whole context, which would also silence those clicks. Use `mix.setPaused` for pause, and suspend only for mute/hidden.
- **Hidden tab / pagehide:** `A.attachLifecycle(ctx, mix, () => !paused && !muted)`. On hide: master → 0 in 50 ms, then `ctx.suspend()`. On visible: `resume()` only if a race is running unpaused (or on the menu), then master back up. Loops keep their phase. The race clock is frozen by the game anyway.

## 7. The sprite

- **Layout:** 100 ms of digital silence, clip, 100 ms of silence, … Every clip starts on a 20 ms boundary (960 samples). The JSON `duration` = clip length + 30 ms pad. Total 20.9 s (1,003,200 samples).
- **Opus:** one Ogg stream written by `_src/pipeline/oggopus.py` (ctypes on the system libopus; RFC 7845 headers, CRC'd pages, pre-skip 312, exact final granule so the decoded length is exact). Bitrate, frame size and VBR/CVBR switch per clip in the guard before it. **The encoder state is reset in the guard after every clip** (`OPUS_RESET_STATE` at clip end + 1272 samples). Without the reset, libopus kept spending the clip's bitrate for about 340 ms of silence (about 72 KB over the sprite); with it, silence costs 3 bytes per frame. Container overhead plus guards: 1,524 B.
- **AAC:** ffmpeg `aac` 64 kbps, `+faststart`. At 64 k the clip band error is 0.73 dB mean, the same as the v54.6 80 k per-file AAC (0.75). 80 k would cost 274 KB for 0.51 dB. Silent frames cost 4 B.
- **Verified in Chrome (decodeAudioData, 48 kHz):** both formats decode to exactly 1,003,200 samples. Every clip cross-correlates with its master at **offset 0 samples** in both `.ogg` and `.m4a`. Guard peak: Opus ≤ −65 dBFS, AAC ≤ −110 dBFS after the clip (AAC pre-echo before a clip ≤ −49 dBFS, which is outside every played region). Report: `/workspace/radcars-audio/v547/meas/decode_check_v547.json`.

**Clip map** (`sfx_sprite.json` holds only `{start, duration}`; the rest is in `_src/pipeline/sprite_v547_meta.json`):

| # | clip | start (s) | duration (s, incl. 30 ms pad) | Opus setting | Opus bytes | band error v54.6 → v54.7 (mean / p95 dB) | decoded offset ogg / m4a |
|---|---|---|---|---|---|---|---|
| 1 | `wall_light_1` | 0.100 | 0.560 | 48 k / 40 ms / VBR | 2,938 | 0.57 / 1.63 → 0.71 / 2.03 | 0 / 0 |
| 2 | `wall_light_2` | 0.740 | 0.254 | 52 k / 40 ms / VBR | 1,692 | 0.56 / 1.56 → 0.64 / 1.96 | 0 / 0 |
| 3 | `wall_light_3` | 1.080 | 0.370 | 56 k / 40 ms / VBR | 2,789 | 0.51 / 1.62 → 0.64 / 1.89 | 0 / 0 |
| 4 | `wall_heavy_1` | 1.520 | 0.510 | 44 k / 20 ms / CVBR | 2,951 | 0.64 / 1.79 → 0.78 / 2.16 | 0 / 0 |
| 5 | `wall_heavy_2` | 2.100 | 0.905 | 36 k / 20 ms / CVBR | 4,285 | 0.49 / 1.32 → 0.63 / 1.66 | 0 / 0 |
| 6 | `wall_heavy_3` | 3.080 | 0.745 | 48 k / 40 ms / CVBR | 4,551 | 0.62 / 1.78 → 0.73 / 2.06 | 0 / 0 |
| 7 | `boost` | 3.900 | 1.100 | 48 k / 20 ms / CVBR | 6,717 | 0.56 / 1.65 → 0.71 / 1.90 | 0 / 0 |
| 8 | `boost_chain` | 5.080 | 0.760 | 52 k / 40 ms / VBR | 4,492 | 0.63 / 1.82 → 0.72 / 2.10 | 0 / 0 |
| 9 | `boost_end` | 5.920 | 1.075 | 44 k / 40 ms / VBR | 5,865 | 0.52 / 1.63 → 0.80 / 2.71 | 0 / 0 |
| 10 | `handbrake` | 7.080 | 0.420 | 20 k / 40 ms / VBR | 1,056 | 1.55 / 4.53 → 1.76 / 5.14 | 0 / 0 |
| 11 | `drift_boost` | 7.580 | 0.610 | 32 k / 40 ms / VBR | 2,433 | 1.00 / 4.10 → 1.34 / 4.94 | 0 / 0 |
| 12 | `drift_sparkle` | 8.260 | 0.830 | 40 k / 40 ms / VBR | 4,276 | 0.70 / 2.01 → 0.91 / 2.85 | 0 / 0 |
| 13 | `missile_launch` | 9.160 | 1.450 | 44 k / 40 ms / CVBR | 8,108 | 0.55 / 1.47 → 0.66 / 1.77 | 0 / 0 |
| 14 | `explosion` | 10.680 | 1.460 | 40 k / 40 ms / CVBR | 7,373 | 0.60 / 1.74 → 0.71 / 1.94 | 0 / 0 |
| 15 | `pickup` | 12.220 | 0.585 | 40 k / 20 ms / VBR | 4,695 | 0.71 / 2.73 → 0.94 / 3.89 | 0 / 0 |
| 16 | `barge_1` | 12.880 | 0.375 | 32 k / 40 ms / VBR | 1,404 | 0.75 / 1.97 → 0.92 / 2.60 | 0 / 0 |
| 17 | `barge_2` | 13.340 | 0.380 | 24 k / 20 ms / VBR | 1,185 | 0.77 / 2.15 → 1.04 / 2.98 | 0 / 0 |
| 18 | `ui_click` | 13.800 | 0.080 | 52 k / 20 ms / CVBR | 666 | 1.93 / 9.18 → 1.81 / 7.91 | 0 / 0 |
| 19 | `ui_countdown` | 13.960 | 0.230 | 28 k / 40 ms / VBR | 844 | 0.82 / 5.04 → 1.14 / 4.12 | 0 / 0 |
| 20 | `ui_go` | 14.260 | 0.630 | 28 k / 40 ms / VBR | 2,297 | 1.32 / 5.56 → 1.79 / 5.89 | 0 / 0 |
| 21 | `ui_lap` | 14.960 | 0.450 | 40 k / 20 ms / CVBR | 2,432 | 1.43 / 7.45 → 1.83 / 9.43 | 0 / 0 |
| 22 | `ui_denied` | 15.480 | 0.190 | 20 k / 20 ms / VBR | 947 | 0.93 / 4.10 → 1.37 / 5.30 | 0 / 0 |
| 23 | `ui_slam` | 15.740 | 0.605 | 24 k / 40 ms / VBR | 1,909 | 0.93 / 3.68 → 1.19 / 3.91 | 0 / 0 |
| 24 | `podium_jingle` | 16.420 | 0.880 | 36 k / 40 ms / CVBR | 3,948 | 1.05 / 4.64 → 1.51 / 6.58 | 0 / 0 |
| 25 | `win_fanfare` | 17.380 | 1.670 | 28 k / 40 ms / VBR | 5,815 | 0.87 / 3.09 → 1.36 / 4.51 | 0 / 0 |
| 26 | `sfx_miss` | 19.120 | 0.290 | 24 k / 40 ms / VBR | 901 | 0.95 / 3.80 → 1.44 / 5.09 | 0 / 0 |
| 27 | `sfx_power` | 19.480 | 0.430 | 36 k / 40 ms / VBR | 2,062 | 1.04 / 4.91 → 1.52 / 5.97 | 0 / 0 |
| 28 | `sfx_autopilot` | 19.980 | 0.430 | 44 k / 40 ms / CVBR | 2,419 | 0.93 / 4.48 → 1.40 / 6.19 | 0 / 0 |
| 29 | `sfx_power_end` | 20.480 | 0.350 | 48 k / 40 ms / VBR | 2,284 | 1.03 / 3.34 → 1.14 / 4.20 | 0 / 0 |


## 8. Budget: per file, before → after, and the quality cost

Opus settings were chosen per clip from a rate–distortion sweep (16–64 kbps × 20/40 ms × VBR/CVBR, encoded exactly as in the sprite), picking the smallest setting whose 1/3-octave band error against the master stays within a cap over the v54.6 shipped file. Caps (mean / p95 dB over v54.6): **gameplay priority** (walls, boost, boostChain, missile, explosion) 0.15 / 0.4; **other recorded** (boost_end, handbrake, drift_boost, drift_sparkle, pickup, barge) 0.5 / 1.2; **chip UI** 0.5 / 2.0; **loops** 0.1 / 0.3.

Measured cost (band error vs master, decoded in Chrome): priority clips +0.12 dB mean (max +0.15), +0.31 dB p95; other recorded +0.25 / +0.86; chip UI +0.36 / +0.82; loops +0.07 / +0.19. These are objective spectral-error numbers, not a listening test; the sign-off MP4 is the ear check. The chip cues carry the largest cost because square waves are the hardest case for any codec, and they're also the least exposed (UI, short). Settings: `_src/pipeline/sprite_v547_settings.json`.

AAC per clip isn't meaningful inside one stream (the encoder's bit reservoir moves bits between clips), so AAC is reported as totals.

| file / clip | Opus v54.6 | Opus v54.7 | AAC v54.6 | note |
|---|---|---|---|---|
| `wall_light_1` | 4,191 | 2,938 | 6,842 |  |
| `wall_light_2` | 2,437 | 1,692 | 3,539 |  |
| `wall_light_3` | 4,073 | 2,789 | 4,654 |  |
| `wall_heavy_1` | 4,114 | 2,951 | 6,370 |  |
| `wall_heavy_2` | 6,554 | 4,285 | 10,306 |  |
| `wall_heavy_3` | 5,795 | 4,551 | 8,604 |  |
| `boost` | 9,181 | 6,717 | 12,457 |  |
| `boost_chain` | 5,734 | 4,492 | 9,101 |  |
| `boost_end` | 10,608 | 5,865 | 14,525 |  |
| `handbrake` | 2,682 | 1,056 | 5,018 |  |
| `drift_boost` | 4,386 | 2,433 | 7,555 |  |
| `drift_sparkle` | 5,657 | 4,276 | 10,246 |  |
| `missile_launch` | 9,960 | 8,108 | 16,023 |  |
| `explosion` | 9,317 | 7,373 | 16,079 |  |
| `pickup` | 5,784 | 4,695 | 7,261 |  |
| `barge_1` | 2,202 | 1,404 | 5,116 |  |
| `barge_2` | 2,178 | 1,185 | 5,207 |  |
| `ui_click` | 649 | 666 | 1,622 |  |
| `ui_countdown` | 1,383 | 844 | 3,387 |  |
| `ui_go` | 4,197 | 2,297 | 7,346 |  |
| `ui_lap` | 2,967 | 2,432 | 5,521 |  |
| `ui_denied` | 1,381 | 947 | 2,840 |  |
| `ui_slam` | 4,065 | 1,909 | 7,398 |  |
| `podium_jingle` | 7,385 | 3,948 | 12,988 | was `ui_podium` (slam inside) |
| `win_fanfare` | 12,539 | 5,815 | 21,690 | was `ui_win` (slam inside) |
| `sfx_miss` | 1,821 | 901 | 3,796 |  |
| `sfx_power` | 2,832 | 2,062 | 5,274 |  |
| `sfx_autopilot` | 3,003 | 2,419 | 5,295 |  |
| `sfx_power_end` | 2,357 | 2,284 | 4,426 |  |
| `eng_idle` | 10,170 | 8,323 | 12,893 | separate loop file, re-encoded 56 k / 40 ms (.m4a unchanged) |
| `eng_low` | 11,625 | 9,743 | 14,657 | separate loop file, re-encoded 56 k / 40 ms (.m4a unchanged) |
| `eng_high` | 10,042 | 8,073 | 12,457 | separate loop file, re-encoded 56 k / 40 ms (.m4a unchanged) |
| `eng_off_low` | 9,569 | 8,045 | 12,265 | separate loop file, re-encoded 56 k / 40 ms (.m4a unchanged) |
| `eng_off_high` | 10,236 | 8,074 | 12,291 | separate loop file, re-encoded 56 k / 40 ms (.m4a unchanged) |
| `squeal` | 9,490 | 7,840 | 12,368 | separate loop file, re-encoded 56 k / 40 ms (.m4a unchanged) |
| `warn_loop` | 2,599 | 2,599 | 2,892 | unchanged file |
| **SFX total** | **203,163** | **147,555** (+ JSON 1,674) | **310,309** | v54.7 AAC: **314,588** (+ JSON) = sprite 234,765 + loops 79,823 |
| music (unchanged) | 551,675 | 551,675 | 836,208 | ≤ 600 KB Opus cap |

The Opus per-clip column is the clip's own bytes inside the sprite. The sprite file adds 1,524 B for headers, pages and guards (94,858 B total).

## 9. Loudness and gain table

Clip levels are the v54.7 masters. "As played" = clip M-max + 20·log10(SHOTS gain × bus gain), before Effects volume, master 0.9 and the compressor. "In race" = phone-band M-max rise over the top-gear engine bed (−21.4 LUFS phone) in the preview's SFX stem (`m_v547_sfx_only`), v54.6 → v54.7, from `/workspace/radcars-audio/v547/meas/incontext_v547.json`.

| event | clip | bus | gain | cap | length s | peak dBFS | RMS dBFS | M-max LUFS | phone M-max | as played | in race, phone (v54.6 → v54.7) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `wall_light` | `wall_light_1` | sfx | 1.25 | 2 | 0.53 | -1.5 | -21.7 | -20.0 | -20.4 | -19.0 | +2.9 → +2.8 dB |
| `wall_light` | `wall_light_2` | sfx | 1.25 | 2 | 0.224 | -1.5 | -16.5 | -18.8 | -19.0 | -17.8 |  |
| `wall_light` | `wall_light_3` | sfx | 1.25 | 2 | 0.34 | -1.5 | -18.6 | -16.9 | -16.9 | -15.9 |  |
| `wall_heavy` | `wall_heavy_1` | sfx | 1 | 2 | 0.48 | -1.5 | -13.0 | -12.5 | -14.9 | -13.4 | +5.7 → +7.9 dB |
| `wall_heavy` | `wall_heavy_2` | sfx | 1 | 2 | 0.875 | -1.5 | -19.1 | -16.3 | -18.8 | -17.2 |  |
| `wall_heavy` | `wall_heavy_3` | sfx | 1 | 2 | 0.715 | -1.5 | -14.6 | -11.9 | -13.2 | -12.8 |  |
| `boost` | `boost` | sfx | 0.75 | 1 | 1.07 | -1.5 | -16.4 | -11.4 | -12.5 | -14.9 | +8.9 → +8.9 dB |
| `boost_end` | `boost_end` | sfx | 0.35 | 1 | 1.045 | -3.0 | -26.5 | -24.2 | -24.3 | -34.2 |  |
| `boostChain` | `boost_chain` | sfx | 1.15 | 1 | 0.73 | -2.2 | -17.0 | -12.7 | -13.7 | -12.4 | +9.7 → +9.8 dB |
| `missile_launch` | `missile_launch` | sfx | 1 | 3 | 1.42 | -1.5 | -16.7 | -14.5 | -15.2 | -15.5 | +3.2 → +4.7 dB |
| `explosion` | `explosion` | sfx | 1 | 3 | 1.43 | -1.5 | -18.8 | -15.6 | -17.7 | -16.5 | +1.8 → +4.8 dB |
| `pickup` | `pickup` | sfx | 0.6 | 1 | 0.555 | -2.0 | -20.4 | -15.9 | -17.8 | -21.2 | +3.4 → +3.4 dB |
| `barge` | `barge_1` | sfx | 0.85 | 2 | 0.345 | -1.5 | -16.6 | -18.1 | -21.0 | -20.5 |  |
| `barge` | `barge_2` | sfx | 0.85 | 2 | 0.35 | -1.5 | -15.8 | -17.3 | -20.9 | -19.6 |  |
| `handbrake` | `handbrake` | sfx | 0.8 | 1 | 0.39 | -1.5 | -17.9 | -16.4 | -16.7 | -19.2 | +5.5 → +6.3 dB |
| `drift_boost` | `drift_boost` | sfx | 0.7 | 1 | 0.58 | -1.5 | -19.3 | -16.6 | -16.8 | -20.7 |  |
| `drift_sparkle` | `drift_sparkle` | sfx | 0.55 | 1 | 0.8 | -3.0 | -20.1 | -14.3 | -18.3 | -20.4 |  |
| `click` | `ui_click` | ui | 0.6 | 2 | 0.05 | -6.0 | -24.1 | -30.5 | -30.9 | -38.0 |  |
| `countdown` | `ui_countdown` | ui | 0.55 | 1 | 0.2 | -3.0 | -13.9 | -16.3 | -16.5 | -24.6 |  |
| `countdownGo` | `ui_go` | ui | 0.6 | 1 | 0.6 | -1.5 | -14.8 | -11.6 | -12.0 | -19.1 |  |
| `lap` | `ui_lap` | ui | 0.5 | 1 | 0.42 | -2.0 | -13.6 | -11.2 | -11.5 | -20.4 | +5.1 → +5.0 dB |
| `denied` | `ui_denied` | ui | 0.5 | 1 | 0.16 | -9.0 | -17.0 | -21.3 | -21.6 | -30.4 | +0.7 → +0.7 dB |
| `slam` | `ui_slam` | ui | 0.7 | 1 | 0.575 | -1.5 | -16.9 | -15.2 | -16.9 | -21.4 |  |
| `podium` | `podium_jingle` | ui | 0.7 | 1 | 0.85 | -4.3 | -16.0 | -13.4 | -13.8 | -19.6 |  |
| `win` | `win_fanfare` | ui | 0.7 | 1 | 1.64 | -1.5 | -15.0 | -11.9 | -12.1 | -18.1 |  |
| `miss` | `sfx_miss` | sfx | 0.5 | 2 | 0.26 | -4.0 | -12.7 | -14.5 | -15.5 | -21.4 |  |
| `power` | `sfx_power` | sfx | 0.45 | 1 | 0.4 | -3.0 | -10.7 | -9.6 | -9.9 | -17.5 |  |
| `autopilot` | `sfx_autopilot` | sfx | 0.45 | 1 | 0.4 | -3.0 | -10.3 | -8.9 | -9.2 | -16.8 |  |
| `powerEnd` | `sfx_power_end` | sfx | 0.45 | 1 | 0.32 | -4.0 | -15.0 | -14.5 | -14.7 | -22.3 |  |

Other in-race numbers (phone, over the engine bed, v54.6 → v54.7): light wall 380 +0.8 → +0.7 dB (meant to be almost buried), drift boost q 0.9 + its boost whoosh +8.6 → +8.6, the rival hit (`'hit'`, gain 0.8 in both renders) −0.3 → +1.9. Engine bed: top gear −20.2 LUFS full band / −21.4 phone (steps measurement); squeal at full slip −19.1 LUFS. Music bed ≈ −20 LUFS with −2.5 dB under a loud engine (unchanged). Mixer: master 0.9 → DynamicsCompressor threshold −10 dB, knee 6, ratio 4, attack 3 ms, release 150 ms.

Engine levels by speed (steady, full mixer, engine only): speed01 0.05 → −24.5 LUFS (phone −25.9), 0.45 → −21.9 (−22.9), 0.91 top → −20.2 (−21.4), 1.27 boost → −18.8 (−20.0), 1.4 chain → −18.4 (−19.5). Pitch: the measured firing frequency tracks the model (rpm / 30) within 1 Hz at every step.

## 10. Sign-off preview (one MP4)

`/workspace/radcars-audio/previews/video/v547/v547_full_race.mp4`: 62.5 s, 1280×480. It shows a scrolling showwaves cline, the current event label with a running clock, and a whole-race overview strip with a playhead (H.264 crf 28, AAC 160 k). It was rendered by `_src/render_v547.mjs --scenes scenes_v547.mjs` in headless Chrome, using the real mixer and the shipped files (loops, sprite, music). The video is made by `/workspace/radcars-audio/tools/video_v547.py`. The WAV/Opus/AAC copies, the timeline and the stems are in `/workspace/radcars-audio/previews/v547/`.

| t (s) | event |
|---|---|
| 0.0 | menu: `music_menu`; `click` at 1.3 / 2.5 / 3.6 |
| 4.0 | race loads: menu music fades out (0.5 s); the engine idles from 4.6, held −6 dB |
| 5.0 / 6.0 / 7.0 | `countdown` 3-2-1 |
| 8.0 | `countdownGo` + `music_race`; full throttle. Upshifts at 8.47 / 9.25 / 11.33 s, then 4th climbs to 7000 rpm (≈ 17 s) |
| 15.6 – 20.2 | a rival closes from behind and passes on the right at 17.6 (rival engine voice, `rivalMix` gain/pan) |
| 20.8 / 22.0 | light wall hits (wallHit 380 / 500) |
| 24.4 | heavy wall hit (wallHit 880): `wall_heavy`, engine −5.9 dB, music −6 dB |
| 27.8 | `handbrake`: slip01 pinned at 1.0 for 0.5 s, then a 0.4 s decay; squeal on 27.80 – 28.65 |
| 28.7 | `driftBoost` q 0.9 (whoosh, arp, sparkle; music −5.8 dB), plus the 0.15-edge `boost` 20 ms later; `boost_end` at 30.1 |
| 32.6 | BOOST button: `boost` (whoosh + anti-lag pops), music −6 dB |
| 33.6 | a pad lands on it: **`boostChain` instead of `boost`**, music −8 dB, engine rush (boostLevel 1.35 for 1.2 s); `boost_end` at 36.5 |
| 38.6 | `pickup` (`sfx('bonus')`) |
| 41.0 – 42.5 | incoming-missile warning: pulses 480 → 160 ms rising +4 st, solid from 42.2 |
| 42.5 | impact on the player: `warn.stop()` + `explosion`, engine −8 dB, music −6 dB |
| 45.0 | player fires: `missile_launch` |
| 46.2 | `'hit'`: `explosion` on the car ahead (gain 0.8), engine −4 dB, music −6 dB |
| 48.6 | MISSILE tapped with NO TARGET: `denied` |
| 51.0 | `lap` chime |
| 57.0 | finish: `podium` → `ui_slam` + `podium_jingle` at 57.3; race loop → `music_finish` (250 ms crossfade); engine −10 dB, coasting to a stop |

## 11. Open risks

1. **Old Safari AAC edit list.** Safari only decodes Ogg Opus from 18.4. Older iPhones take the `.m4a` files, which rely on the MP4 edit list to drop 1024 priming samples. If a decoder ignores it, every sprite clip starts 21 ms late (the 30 ms pad still covers the whole clip) and loop points land 21 ms late (still clean, because the loops run continuously across their pre-roll). Check once on a real iPhone running iOS < 18.4.
2. **Custom Ogg Opus writer.** `sfx_sprite.ogg` and the six loop `.ogg` files come from `oggopus.py`, not ffmpeg. They are valid RFC 7845 streams: Chrome and ffmpeg decode them sample-exact, and `loadSprite`/`loadSounds` fall back to `.m4a` on a decode error. Firefox and Safari 18.4+ haven't been tested here; please do one smoke test of each.
3. **Podium/win dedupe changes the slam slightly.** The v54.4 podium/win files had the slam's echo/reverb baked in. Played as separate clips, the result differs by −21 dB (podium) / −27 dB (win) from the old mixes, and the slam itself got the phone pass (+4.2 dB phone presence).
4. **`warnPulse` doesn't exist in js/ yet** (v55). The warning is in the preview, and the hook is specified in §4.4 and V55_SFX.md.
5. **`others[].screenX` is normalised (0..1).** `rivalMix` now defaults to vw = 1. Code that passes pixels must pass `vw`.
6. **`denied` is quiet on purpose** (v54.4: +0.7 dB over the engine). If Callum wants it clearer, raise `SHOTS.denied.gain`; no file change is needed.
7. **Drift boost plays two cues.** A drift boost plays `drift_boost` and then the 0.15-edge `boost` whoosh, as game.js is written today (preview 28.7 s). If that's too much, skip `boost` within 0.3 s of a `driftBoost` in the audio module.
8. **AAC is 316 KB**, over a 150 KB per-format cap if that cap applies to AAC too (it applies to Opus here, at 149.2 KB). Getting AAC near 150 KB needs about 40–48 kbps AAC-LC: at 48 k the clip band error is 1.23 dB (vs 0.73 at 64 k) and loops are 1.15 dB (vs 0.64). Only pre-18.4 iPhones download the AAC files.
9. **Old preview scripts** (`render2/3`, `scenes2/3`, `scenes_v546`) load the retired one-shot files and only run against `/workspace/radcars-audio/v547/snapshot_v546_assets/`.

## 12. Rebuild and re-render

```bash
# masters (v54.6 masters → v54.7 masters), then the sprite + Opus loops
python3 assets/audio/_src/pipeline/build_v547.py <v54.6 masters> <v54.7 masters>
python3 assets/audio/_src/pipeline/build_sprite_v547.py <v54.7 masters> <loop masters> <out>   # sfx_sprite.{ogg,m4a,json}, eng_*.ogg, squeal.ogg
# previews + Chrome decode check (puppeteer-core lives in /tmp/pp)
cd /tmp/pp && node <repo>/assets/audio/_src/render_v547.mjs --assets <repo>/assets/audio --previews <dir> --scenes scenes_v547.mjs --decoded <dir>
python3 /workspace/radcars-audio/tools/video_v547.py
```

Measurement scripts (workbench): `scenes_v547m.mjs` (engine sweep/steps, handbrake slide), `tools/measure_engine_v547.py`, `tools/measure_squeal_v547.py`, `v547/meas/incontext.py`, `v547/build/check_decode.py`, `v547/build/budget_table.py`. Before/after renders: `/workspace/radcars-audio/v547/meas/{before,after,race_before}/`.
