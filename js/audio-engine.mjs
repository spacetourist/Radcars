/**
 * Radcars — sample-based audio reference implementation (v54 engine/squeal/walls/boost + v55 set + v54.6 boostChain
 * + v54.7 sound release: one-shot sprite, top-gear rpm fix, DOUBLE BOOST engine rush, squeal lift at full slip).
 * Hook map, gains and loading recipe for the game: docs/AUDIO_V547_HANDOFF.md.
 * Supersedes the oscillator recipes in audio-recipes.mjs (kept only for history; do not ship them).
 *
 * Plain ES module, no build step, no dependencies. Everything plays decoded AudioBuffers from assets/audio/:
 *   engine  = 3 on-load loops (idle / low / high) + 2 off-load loops, AudioBufferSourceNode.loop with loopStart/loopEnd,
 *             equal-power crossfaded by a fake RPM, playbackRate inside each band (docs/ENGINE_NOTE_SPEC.md)
 *   squeal  = 1 recorded tyre-squeal loop, gain + rate from slip01
 *   one-shots = recorded impacts / whoosh / rocket / explosion / chime / door-slam, 2–3 variants where it matters
 *   warn    = a recorded reversing-alarm beep, looped and gated per pulse on the agreed v55 timing
 *   music   = chiptune race loop / menu loop / finish sting on its own bus, ducked under heavy SFX and the engine (rev 4, v54.4)
 * Times are AudioContext seconds. Every update() takes `t` so the same code runs live (ctx.currentTime) and offline.
 */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const dB = (d) => Math.pow(10, d / 20);
function gain(ctx, v = 1) { const g = ctx.createGain(); g.gain.value = v; return g; }
function filt(ctx, type, f, Q = 0.707, g = 0) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; b.gain.value = g; return b; }
function chain(...n) { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; }

// ------------------------------------------------------------------ files
/**
 * v54.7 shipped files (48 kHz mono; .ogg = Opus, .m4a = AAC-LC fallback):
 *   loops   eng_idle / eng_low / eng_high / eng_off_low / eng_off_high / squeal (.ogg Opus 56 kbps, .m4a AAC 80 kbps), warn_loop
 *   sprite  sfx_sprite.ogg (Opus, per-clip rate 20–56 kbps) + sfx_sprite.m4a (AAC 64 kbps) + sfx_sprite.json {name: {start, duration}}
 *           every one-shot below lives in the sprite (100 ms digital-silence guards; duration includes a 30 ms silent pad)
 *   music   music_race / music_menu / music_finish (unchanged since v54.4)
 * Loops carry loopStart/loopEnd in seconds (exact sample/48000; both are rising zero crossings, and the file already
 * contains a baked equal-power crossfade before loopEnd, so the wrap is seamless). Base pitch data for the engine.
 */
export const LOOPS = {
  eng_idle:     { loopStart: 0.05, loopEnd: 1.100083, rpm: 519,  firingHz: 17.31,  src: 'Chippy569 190E 21_500 (neutral idle)' },
  eng_low:      { loopStart: 0.05, loopEnd: 1.270208, rpm: 2558, firingHz: 85.26,  src: 'Chippy569 190E 19_2500 (full load)' },
  eng_high:     { loopStart: 0.05, loopEnd: 1.056833, rpm: 6207, firingHz: 206.9,  src: 'Chippy569 190E 20_6500 (full load)' },
  eng_off_low:  { loopStart: 0.05, loopEnd: 1.036312, rpm: 2428, firingHz: 80.94,  src: 'Chippy569 190E 21_2500 (no load)' },
  eng_off_high: { loopStart: 0.05, loopEnd: 1.040896, rpm: 6295, firingHz: 209.84, src: 'Chippy569 190E 21_6500 (no load)' },
  squeal:       { loopStart: 0.05, loopEnd: 1.050271, baseHz: 941,  src: 'audible-edge Chrysler LHS tire squeal 04' },
  warn_loop:    { loopStart: 0.02, loopEnd: 0.140354, baseHz: 1437.8, src: 'C-V backing up beep (truck reversing alarm)' }
};
/** One-shots: event → variants, bus, base gain, max simultaneous voices. */
export const SHOTS = {
  wall_light:     { files: ['wall_light_1', 'wall_light_2', 'wall_light_3'], bus: 'sfx', gain: 1.25, cap: 2 },
  wall_heavy:     { files: ['wall_heavy_1', 'wall_heavy_2', 'wall_heavy_3'], bus: 'sfx', gain: 1.0, cap: 2 },
  boost:          { files: ['boost'], bus: 'sfx', gain: 0.75, cap: 1 },
  boost_end:      { files: ['boost_end'], bus: 'sfx', gain: 0.35, cap: 1 },
  // v54.6 'DOUBLE BOOST': fired INSTEAD of 'boost' when a 2nd boost lands while one is running (see playBoostChain).
  // Gain 1.15: ≈ +1.2 dB momentary-max above 'boost' (0.75) as heard after the master compressor. Own cap: lands on the boost tail.
  boostChain:     { files: ['boost_chain'], bus: 'sfx', gain: 1.15, cap: 1 },
  // v54.7: 0.7 → 1.0: in the race mix the launch sat only +3.0 dB (phone band, M-max) over the top-gear engine vs +7.9 heavy wall / +8.8 boost
  missile_launch: { files: ['missile_launch'], bus: 'sfx', gain: 1.0, cap: 3 },
  explosion:      { files: ['explosion'], bus: 'sfx', gain: 1.0, cap: 3 },
  pickup:         { files: ['pickup'], bus: 'sfx', gain: 0.6, cap: 1 },
  barge:          { files: ['barge_1', 'barge_2'], bus: 'sfx', gain: 0.85, cap: 2 },
  // v54.4: recorded handbrake + drift boost; chip-styled UI / race-flow cues in the soundtrack's key (A minor)
  handbrake:      { files: ['handbrake'], bus: 'sfx', gain: 0.8, cap: 1 },
  drift_boost:    { files: ['drift_boost'], bus: 'sfx', gain: 0.7, cap: 1 },
  drift_sparkle:  { files: ['drift_sparkle'], bus: 'sfx', gain: 0.55, cap: 1 },
  click:          { files: ['ui_click'], bus: 'ui', gain: 0.6, cap: 2 },
  countdown:      { files: ['ui_countdown'], bus: 'ui', gain: 0.55, cap: 1 },
  countdownGo:    { files: ['ui_go'], bus: 'ui', gain: 0.6, cap: 1 },
  lap:            { files: ['ui_lap'], bus: 'ui', gain: 0.5, cap: 1 },
  denied:         { files: ['ui_denied'], bus: 'ui', gain: 0.5, cap: 1 },
  slam:           { files: ['ui_slam'], bus: 'ui', gain: 0.7, cap: 1 },
  // v54.7: podium / win = the slam (sprite clip ui_slam) + the jingle 0.30 s later. ShotPlayer.play('podium' | 'win') plays
  // both (slam gain ×1.0 / ×0.866 of the 'slam' event, as mixed into the v54.4 files); never also play 'slam' for them.
  podium:         { files: ['podium_jingle'], bus: 'ui', gain: 0.7, cap: 1, slam: { gain: 1.0, delay: 0.30 } },
  win:            { files: ['win_fanfare'], bus: 'ui', gain: 0.7, cap: 1, slam: { gain: 0.866, delay: 0.30 } },
  miss:           { files: ['sfx_miss'], bus: 'sfx', gain: 0.5, cap: 2 },
  power:          { files: ['sfx_power'], bus: 'sfx', gain: 0.45, cap: 1 },
  autopilot:      { files: ['sfx_autopilot'], bus: 'sfx', gain: 0.45, cap: 1 },
  powerEnd:       { files: ['sfx_power_end'], bus: 'sfx', gain: 0.45, cap: 1 }
};
/**
 * Music (rev 4): 8-bit chiptune written as code in _src/music/ (chip.py synth + songs.py score + build_music.py).
 * Key A minor. Loops are sample-exact: rendered 3× and the middle cycle cut with 50 ms pre/post-roll, so every tail and
 * echo crossing the seam is baked in. Use AudioBufferSourceNode.loop with these loopStart/loopEnd (seconds).
 * Opus mono (race 44 kbps, menu 40 kbps, sting 48 kbps, constrained VBR) + AAC 64 kbps fallback.
 */
export const MUSIC = {
  music_race:   { loop: true,  loopStart: 0.05, loopEnd: 60.05, bpm: 160, bars: 40, key: 'A minor' },
  music_menu:   { loop: true,  loopStart: 0.05, loopEnd: 37.55, bpm: 128, bars: 20, key: 'A minor' },
  music_finish: { loop: false, bpm: 160, key: 'A minor → A major (F–G–A)', dur: 3.2 }
};
export const MUSIC_FILES = Object.keys(MUSIC);
/** v54.7: looped files are separate (loopStart/loopEnd need their own buffer); every one-shot comes from the sprite. */
export const LOOP_FILES = Object.keys(LOOPS);
export const SPRITE = { file: 'sfx_sprite', map: 'sfx_sprite.json' };
/** Sprite clip names (= SHOTS[*].files): every one must be a key of sfx_sprite.json. */
export const SPRITE_CLIPS = [...new Set(Object.values(SHOTS).flatMap((s) => s.files))];
/** @deprecated v54.6 name, kept for old scripts: now only the looped files (one-shots are no longer separate files). */
export const ALL_FILES = LOOP_FILES;

/** Pick the container: Opus-in-Ogg where the browser can decode it (Chrome/Android, Firefox), else AAC (.m4a). */
export function audioExt() {
  try { const a = document.createElement('audio'); if (a.canPlayType && a.canPlayType('audio/ogg; codecs="opus"')) return 'ogg'; } catch (e) { /* worker / offline */ }
  return 'm4a';
}
/**
 * Fetch + decode every file once. Returns { name: AudioBuffer }. Falls back to .m4a per file if .ogg fails to decode.
 * loopStart/loopEnd are seconds, so they stay right if the context runs at 44.1 kHz and the browser resamples.
 */
export async function loadSounds(ctx, baseUrl = 'assets/audio/', ext = audioExt(), names = ALL_FILES) {
  const get = async (n, e) => ctx.decodeAudioData(await (await fetch(`${baseUrl}${n}.${e}`)).arrayBuffer());
  const out = {};
  await Promise.all(names.map(async (n) => {
    try { out[n] = await get(n, ext); } catch (err) { if (ext === 'm4a') throw err; out[n] = await get(n, 'm4a'); }
  }));
  return out;
}
/**
 * v54.7: fetch + decode the one-shot sprite once → { clip: { buffer, start, duration } } (seconds; one shared AudioBuffer).
 * ShotPlayer plays a region with source.start(t, start, duration). Falls back to the .m4a sprite if the .ogg fails.
 */
export async function loadSprite(ctx, baseUrl = 'assets/audio/', ext = audioExt()) {
  const map = await (await fetch(`${baseUrl}${SPRITE.map}`)).json();
  const get = async (e) => ctx.decodeAudioData(await (await fetch(`${baseUrl}${SPRITE.file}.${e}`)).arrayBuffer());
  let buffer; try { buffer = await get(ext); } catch (err) { if (ext === 'm4a') throw err; buffer = await get('m4a'); }
  const out = {};
  for (const [n, r] of Object.entries(map)) out[n] = { buffer, start: r.start, duration: Math.min(r.duration, buffer.duration - r.start) };
  return out;
}
/** Everything the race needs (loops + sprite regions) in one map, ready for SampleEngineVoice / SquealVoice / WarnVoice / ShotPlayer. */
export async function loadAll(ctx, baseUrl = 'assets/audio/', ext = audioExt()) {
  const [loops, clips] = await Promise.all([loadSounds(ctx, baseUrl, ext, LOOP_FILES), loadSprite(ctx, baseUrl, ext)]);
  return { ...loops, ...clips };
}

// ------------------------------------------------------------------ mixer (rev 4: + music bus, volumes, pause)
/**
 * master (0.9) → compressor/limiter (−10 dB, 4:1) → destination
 *   engine bus 0.5 → engineDuck → sfxVol ┐
 *   sfx bus    0.9 → sfxDuck    → sfxVol ├→ master     sfxVol = the "Effects" volume setting (engine + sfx + ui)
 *   ui bus     0.7 ─────────────→ sfxVol ┘             (ui is never ducked)
 *   music bus  MUSIC_MIX.bus → musicHit → musicEng → musicVol → master   musicVol = the separate "Music" setting
 * musicHit: −6 dB under heavy hits / explosions / boost whoosh (−8 dB under boostChain), 20 ms attack, ≈400 ms recovery (τ 130 ms)
 * musicEng: a constant −2.5 dB while the player engine is loud (follows engineLevel01, τ 250 ms)
 */
export const MUSIC_MIX = {
  bus: 0.75,                         // puts the bed at ≈ −20 LUFS in the race mix (measured in v3_race_scene)
  hitDb: -6, hitHoldS: 0.12, hitAttackTau: 0.02, hitReleaseTau: 0.13,
  boostHoldS: 0.3,                   // boost whoosh: −6 dB held 0.3 s
  chainDb: -8, chainHoldS: 0.3,      // v54.6 boostChain: a deeper −8 dB hit duck, same hold, same ≈400 ms recovery
  engDb: -2.5, engLo: 0.35, engHi: 0.85, engTau: 0.25,
  xfadeS: 0.25,                      // race loop → finish sting crossfade
  pauseS: 0.05
};
/** Events that duck the music −6 dB (call mix.duckMusic() when they fire). boostChain ducks −8 dB (MUSIC_MIX.chainDb, via playBoostChain). */
export const MUSIC_DUCK_EVENTS = ['wall_heavy', 'explosion', 'boost', 'barge', 'boostChain'];
/** Volume slider (0..1) → gain: perceptual curve (≈ −40 dB at 0.1, 0 dB at 1); 0 = silent. */
export const volumeGain = (v) => (v <= 0 ? 0 : Math.pow(clamp(v, 0, 1), 2));
export function createMixer(ctx, dest = ctx.destination) {
  const master = gain(ctx, 0.9), comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
  chain(master, comp, dest);
  const engine = gain(ctx, 0.5), engineDuck = gain(ctx, 1), sfx = gain(ctx, 0.9), sfxDuck = gain(ctx, 1), ui = gain(ctx, 0.7), sfxVol = gain(ctx, 1);
  chain(engine, engineDuck, sfxVol); chain(sfx, sfxDuck, sfxVol); ui.connect(sfxVol); sfxVol.connect(master);
  const music = gain(ctx, MUSIC_MIX.bus), musicHit = gain(ctx, 1), musicEng = gain(ctx, 1), musicVol = gain(ctx, 1);
  chain(music, musicHit, musicEng, musicVol, master);
  const hold = (p, t) => { if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); } };
  const vol = { music: 1, sfx: 1 }; let paused = false;
  return {
    master, engine, sfx, ui, music, engineDuck, sfxDuck, musicHit, musicEng, musicVol, sfxVol,
    /** Dip a duck stage by `db` for `holdS`, then recover (attack τ 15 ms, release τ 120 ms). Re-ducking extends it. */
    duck(stage, db, holdS, t = ctx.currentTime) {
      const p = stage.gain; hold(p, t);
      p.setTargetAtTime(dB(db), t, 0.015); p.setTargetAtTime(1, t + holdS, 0.12);
    },
    /** Music under a heavy event: −6 dB (default), 20 ms in, held `holdS`, back over ≈400 ms. A deeper duck wins. */
    duckMusic(db = MUSIC_MIX.hitDb, holdS = MUSIC_MIX.hitHoldS, t = ctx.currentTime) {
      const p = musicHit.gain; hold(p, t);
      const target = Math.min(dB(db), p.value < 1 ? p.value : 1);
      p.setTargetAtTime(target, t, MUSIC_MIX.hitAttackTau); p.setTargetAtTime(1, t + holdS, MUSIC_MIX.hitReleaseTau);
    },
    /** Call every frame with the player engine level 0..1 (e.g. speed01, or engineVol / its max): −2.5 dB when loud. */
    engineLevel(level01, t = ctx.currentTime) {
      musicEng.gain.setTargetAtTime(dB(MUSIC_MIX.engDb * smooth(MUSIC_MIX.engLo, MUSIC_MIX.engHi, level01)), t, MUSIC_MIX.engTau);
    },
    /** Settings sliders 0..1 (persist them, e.g. localStorage 'radcars.musicVol' / 'radcars.sfxVol'; default 0.8 / 1). */
    setMusicVolume(v, t = ctx.currentTime) { vol.music = v; if (!paused) musicVol.gain.setTargetAtTime(volumeGain(v), t, 0.03); },
    setSfxVolume(v, t = ctx.currentTime) { vol.sfx = v; sfxVol.gain.setTargetAtTime(volumeGain(v), t, 0.03); },
    /** Pause menu: music muted (50 ms), engine + sfx off; ui stays so menu clicks work. Resume restores both. */
    setPaused(on, t = ctx.currentTime) {
      paused = on;
      musicVol.gain.setTargetAtTime(on ? 0 : volumeGain(vol.music), t, MUSIC_MIX.pauseS / 3);
      engineDuck.gain.setTargetAtTime(on ? 0 : 1, t, MUSIC_MIX.pauseS / 3); sfxDuck.gain.setTargetAtTime(on ? 0 : 1, t, MUSIC_MIX.pauseS / 3);
    }
  };
}
/**
 * Backgrounding / mute: hidden or pagehide → master to 0 in 50 ms, then ctx.suspend(); visible → resume() only if
 * shouldResume() (a race is running and not paused, or we are on the menu), then master back up. Returns a detach fn.
 */
export function attachLifecycle(ctx, mix, shouldResume = () => true) {
  const down = () => { mix.master.gain.setTargetAtTime(0, ctx.currentTime, 0.015); setTimeout(() => ctx.suspend && ctx.suspend(), 60); };
  const up = () => { if (!shouldResume()) return; ctx.resume().then(() => mix.master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.03)); };
  const vis = () => (document.hidden ? down() : up());
  document.addEventListener('visibilitychange', vis); window.addEventListener('pagehide', down);
  return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('pagehide', down); };
}
/**
 * One music player on mix.music. play('music_menu' | 'music_race') starts a loop (fade-in optional); finish() crossfades
 * the race loop into the sting (equal-power over MUSIC_MIX.xfadeS, sting starts at full level on the downbeat it is
 * given); stop() fades out. Only one loop source lives at a time; nothing is ever cut without a ramp.
 */
export class MusicPlayer {
  constructor(ctx, mixer, buffers) { this.ctx = ctx; this.mix = mixer; this.b = buffers; this.cur = null; }
  _start(name, t, fadeS) {
    const M = MUSIC[name], s = this.ctx.createBufferSource(); s.buffer = this.b[name];
    if (M.loop) { s.loop = true; s.loopStart = M.loopStart; s.loopEnd = M.loopEnd; }
    const g = gain(this.ctx, 0); chain(s, g, this.mix.music);
    g.gain.setValueAtTime(fadeS > 0 ? 0 : 1, t); if (fadeS > 0) g.gain.linearRampToValueAtTime(1, t + fadeS);
    s.start(t, M.loop ? M.loopStart : 0); return { name, s, g };
  }
  play(name, { t = this.ctx.currentTime, fadeS = 0.4 } = {}) {
    if (this.cur && this.cur.name === name) return this.cur;
    this.stop({ t, fadeS: 0.3 }); this.cur = this._start(name, t, fadeS); return this.cur;
  }
  finish({ t = this.ctx.currentTime, xfadeS = MUSIC_MIX.xfadeS } = {}) {
    const old = this.cur;
    if (old) { // equal-power fade-out of the loop
      const n = 16, curve = new Float32Array(n); for (let i = 0; i < n; i++) curve[i] = Math.cos((i / (n - 1)) * Math.PI / 2);
      old.g.gain.cancelScheduledValues(t); old.g.gain.setValueCurveAtTime(curve, t, xfadeS); old.s.stop(t + xfadeS + 0.05);
    }
    this.cur = this._start('music_finish', t, 0.01); return this.cur;
  }
  stop({ t = this.ctx.currentTime, fadeS = 0.5 } = {}) {
    if (!this.cur) return; const { s, g } = this.cur; this.cur = null;
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.setTargetAtTime(0, t, fadeS / 4); s.stop(t + fadeS + 0.1);
  }
}

// ------------------------------------------------------------------ engine
/**
 * Fake RPM → which loops sound and how fast they play. rpm = RPM0 + RPM_SPAN·rpm01 (rpm01 from the gear table).
 * Bands are [fade-in start, full, full-until, fade-out end] in rpm; gains are equal-power (sin/cos) across each fade.
 * playbackRate = rpm / recorded rpm (clamped to the band's rate range so a loop is never pushed into chipmunk land).
 */
export const ENGINE = {
  RPM0: 900, RPM_SPAN: 6100,           // rpm01 0 → 900 rpm (idle), 1.0 → 7000, 1.15 (top-gear over-rev) → 7915; boost adds ≈ +800 (+430 more in the DOUBLE BOOST rush)
  bands: {
    idle: { loop: 'eng_idle', fade: [0, 0, 1100, 1700], rate: [1.6, 3.3] },
    low:  { loop: 'eng_low',  fade: [1100, 1700, 3400, 4400], rate: [0.43, 1.72] },
    high: { loop: 'eng_high', fade: [3400, 4400, 99999, 99999], rate: [0.55, 1.45] }   // v54.7: 1.42 → 1.45 for the chain rush
  },
  // off-load (decel / braking) layer: same rpm windows; idle has no off-load twin, the idle loop covers it
  offBands: {
    low:  { loop: 'eng_off_low',  fade: [1100, 1700, 3400, 4400], rate: [0.45, 1.81] },
    high: { loop: 'eng_off_high', fade: [3400, 4400, 99999, 99999], rate: [0.54, 1.40] }
  },
  // fake gears: [speed01 lo, hi, rpm01 at lo, rpm01 at hi] — the upshift is a quick dip-and-rise: rpm drops ~0.35 + a 70 ms volume dip
  // v54.7: (1) top gear ends at the player's real top speed (PLAYER_TOP 1000 / 1100 = 0.909), so full throttle reaches 7000 rpm
  // (v54.6 stopped at rpm01 0.885 ≈ 6300 rpm because speed01 never reaches 1.0); boost speeds (to 1.27 / 1.4) over-rev past it.
  // (2) shift points 0.25 / 0.5 / 0.76 → 0.3 / 0.56 / 0.8: on the game's throttle curve the v54.6 gears lasted 0.37 / 0.63 /
  // 1.72 s (two shifts inside the first second); now 0.46 / 0.81 / 2.0 s, then top gear climbs 4900 → 7000 rpm over ≈ 6 s.
  gears: [[0, 0.3, 0.0, 0.9], [0.3, 0.56, 0.5, 0.92], [0.56, 0.8, 0.58, 0.95], [0.8, 1000 / 1100, 0.66, 1.0]],
  overRevTop: 1.15, downHyst: 0.04,
  shiftDipS: 0.07, shiftDipGain: 0.55,
  // v54.7: hold 0.08 → 0.13, kick 0.14 → 0.19 (same +0.06 bark): with the top-gear fix the cruise sits at 7000 rpm, and the
  // cruise → boost jump had shrunk from +3.1 st (0.2 s) / +4.3 st (0.8 s) to +2.0 / +2.9 st; this restores ≥ +3 st
  boostHold: 0.13,      // +rpm01 × boostLevel (≈ +790 rpm at full boost) on top of the speed-driven rise
  boostKick: 0.19,      // +rpm01 for the first 150 ms after boostLevel crosses 0.15 (the rev "bark")
  boostKickS: 0.15, boostTau: 0.02,
  boostRate: 0.06,      // extra playbackRate × (1 + 0.06·boostEnv): a little more scream than the rpm alone
  boostShelfDb: 4,      // high-shelf (2.5 kHz) +4 dB × boostEnv: brighter, raspier while boosting
  // v54.7 DOUBLE BOOST rush: boostLevel above 1 (CHAIN_RUSH_LVL 1.35 for 1.2 s) → chainK = (boostLevel − 1) / 0.35, smoothed
  chainSpan: 0.35, chainRpm: 0.07, chainRate: 0.03, chainShelfDb: 2, chainVol: 0.10, chainTau: 0.03,
  brakeCutoff: 1800,    // lowpass when fully off-load (load 0); 12 kHz on load
  tauRate: 0.05, tauShift: 0.025, tauGain: 0.06, tauAccel: 0.12,
  rivalPitch: [1.0, 0.94, 1.05, 0.97, 1.08, 0.91, 1.03, 0.99]
};
export function gearFor(s, prev = 0) {
  const G = ENGINE.gears; let n = 0;
  while (n < G.length - 1 && s >= G[n][1]) n++;
  if (n < prev && s > G[prev][0] - ENGINE.downHyst) n = prev;
  return n;
}
export function rpmFor(s, g) {
  const G = ENGINE.gears, [lo, hi, r0, r1] = G[g];
  if (g === G.length - 1 && s > hi) return r1 + (ENGINE.overRevTop - r1) * Math.min(1, (s - hi) / 0.4);
  return r0 + (r1 - r0) * clamp((s - lo) / (hi - lo), 0, 1);
}
export const rpmOf = (rpm01) => ENGINE.RPM0 + ENGINE.RPM_SPAN * rpm01;
/** Equal-power band weight for rpm r. */
export function bandWeight(fade, r) {
  const [a, b, c, d] = fade;
  if (r < a || r > d) return 0;
  if (r < b) return Math.sin(((r - a) / (b - a)) * Math.PI / 2);
  if (r <= c) return 1;
  return Math.cos(((r - c) / (d - c)) * Math.PI / 2);
}
/** load 1 = on the (automatic) throttle, 0 = hard braking; from the smoothed d(speed01)/dt. */
export const loadFor = (accel01) => smooth(-0.9, -0.15, accel01);
export const BOOST_EDGE = { on: 0.15, off: 0.05 };
/** Shared boost edge (engine kick AND the 'boost' one-shot): fires when boostLevel rises past 0.15, re-arms below 0.05. update() → 'on' | 'off' | null */
export class BoostEdge {
  constructor() { this.armed = true; }
  update(level) {
    if (this.armed && level > BOOST_EDGE.on) { this.armed = false; return 'on'; }
    if (!this.armed && level < BOOST_EDGE.off) { this.armed = true; return 'off'; }
    return null;
  }
}
/** Voice level. TRIM lifts the −18 dBFS-RMS loops so the player engine sits ≈ −20 dBFS RMS in the final mix at cruise. */
export const ENGINE_TRIM = 3.2;
export const engineVol = (s, load, boostEnv) => ENGINE_TRIM * (0.3 + 0.12 * Math.min(s, 1) + 0.08 * clamp((s - 1) / 0.4, 0, 1)) * (0.7 + 0.3 * load) * (1 + 0.25 * boostEnv);

/**
 * One engine voice. quality 'full' (player): 3 on-load + 2 off-load looping sources, brake lowpass, boost shelf.
 * quality 'lite' (rivals): the 3 on-load loops only, no filters. All sources start once and loop forever; only
 * gains and playbackRates move, so there is nothing to click.
 */
export class SampleEngineVoice {
  constructor(ctx, out, buffers, { quality = 'full', pitchMul = 1, t0 = ctx.currentTime } = {}) {
    this.ctx = ctx; this.q = quality; this.pitchMul = pitchMul;
    this.gear = 0; this.prevS = 0; this.accel = 0; this.boostEnv = 0; this.chainEnv = 0; this.edge = new BoostEdge(); this.boostStart = -1e9; this.dipUntil = -1; this.lastT = null;
    this.distGain = 1; this.lastLoad = 1;
    this.out = gain(ctx, 0);
    this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    let head = this.out;
    if (quality === 'full') {
      this.lp = filt(ctx, 'lowpass', 12000, 0.7);
      this.shelf = filt(ctx, 'highshelf', 2500, 0.707, 0);
      chain(this.lp, this.shelf, this.out); head = this.lp;
    }
    const mk = (band) => {
      const L = LOOPS[band.loop], s = ctx.createBufferSource(); s.buffer = buffers[band.loop];
      s.loop = true; s.loopStart = L.loopStart; s.loopEnd = L.loopEnd;
      const g = gain(ctx, 0); chain(s, g, head);
      // stagger start offsets so player and rivals never phase-lock on the same loop
      s.start(t0, L.loopStart + ((pitchMul * 7.31) % 1) * (L.loopEnd - L.loopStart) * 0.9);
      return { band, L, s, g };
    };
    this.on = Object.values(ENGINE.bands).map(mk);
    this.off = quality === 'full' ? Object.values(ENGINE.offBands).map(mk) : [];
    if (this.pan) chain(this.out, this.pan, out); else this.out.connect(out);
  }
  /**
   * speed01 0..1.4, boostLevel 0..1.35 (rampBoost; > 1 only during the DOUBLE BOOST rush), slip01 (unused here),
   * t = audio time of this frame. Returns state; state.edge === 'off' is the cue for the 'boost_end' one-shot (game.js never fires it).
   */
  update(speed01, boostLevel = 0, slip01 = 0, t = this.ctx.currentTime) {
    const E = ENGINE, s = clamp(speed01 || 0, 0, 1.4);
    const dt = this.lastT == null ? 1 / 60 : clamp(t - this.lastT, 1 / 240, 0.1); this.lastT = t;
    const a = (s - this.prevS) / dt; this.prevS = s;
    this.accel += (a - this.accel) * (1 - Math.exp(-dt / E.tauAccel));
    const load = s > 1 ? 1 : loadFor(this.accel);
    const lvl = clamp(boostLevel || 0, 0, 1), chainK = clamp(((boostLevel || 0) - 1) / E.chainSpan, 0, 1);
    const edge = this.edge.update(lvl); if (edge === 'on') this.boostStart = t;
    this.boostEnv += (lvl - this.boostEnv) * (1 - Math.exp(-dt / E.boostTau));
    this.chainEnv += (chainK - this.chainEnv) * (1 - Math.exp(-dt / E.chainTau));
    const kick = t - this.boostStart < E.boostKickS && lvl > BOOST_EDGE.off ? E.boostKick - E.boostHold : 0;
    const g = gearFor(s, this.gear), shifted = g !== this.gear;
    if (g > this.gear) this.dipUntil = t + E.shiftDipS;
    this.gear = g;
    const rpm01 = rpmFor(s, g) + this.boostEnv * E.boostHold + kick + this.chainEnv * E.chainRpm, rpm = rpmOf(rpm01);
    const tr = shifted || kick ? E.tauShift : E.tauRate, push = 1 + E.boostRate * this.boostEnv + E.chainRate * this.chainEnv;
    const set = (v, on) => {
      const w = bandWeight(v.band.fade, rpm) * on;
      v.g.gain.setTargetAtTime(w, t, E.tauGain);
      const rate = clamp(rpm / v.L.rpm, v.band.rate[0], v.band.rate[1]) * this.pitchMul * push;
      v.s.playbackRate.setTargetAtTime(rate, t, tr);
    };
    // on-load vs off-load: equal-power on `load`; rivals (no off layer) just stay on-load
    const onW = this.off.length ? Math.sqrt(0.25 + 0.75 * load) : 1, offW = this.off.length ? Math.sqrt(0.75 * (1 - load)) : 0;
    for (const v of this.on) set(v, v.band.loop === 'eng_idle' ? 1 : onW);
    for (const v of this.off) set(v, offW);
    const dip = t < this.dipUntil ? E.shiftDipGain : 1;
    this.out.gain.setTargetAtTime(engineVol(s, load, this.boostEnv) * (1 + E.chainVol * this.chainEnv) * dip * this.distGain, t, dip < 1 ? 0.012 : E.tauGain);
    if (this.lp) {
      this.lp.frequency.setTargetAtTime(E.brakeCutoff + (12000 - E.brakeCutoff) * load * load, t, 0.08);
      this.shelf.gain.setTargetAtTime(E.boostShelfDb * this.boostEnv + E.chainShelfDb * this.chainEnv, t, 0.05);
    }
    this.lastLoad = load;
    return { gear: g, rpm01, rpm, load, edge, chain: this.chainEnv };
  }
  place(distGain, pan, t = this.ctx.currentTime) { this.distGain = distGain; if (this.pan) this.pan.pan.setTargetAtTime(pan, t, 0.05); }
  stop(t = this.ctx.currentTime) { this.out.gain.setTargetAtTime(0, t, 0.05); for (const v of [...this.on, ...this.off]) v.s.stop(t + 0.4); }
}

/**
 * Rival mixing: { gain, pan } from distance (world units) and screen x; gain 0 = cull (free the voice).
 * v54.7: the game's others[].screenX is normalised 0..1, so vw defaults to 1 (pass vw only for a pixel screenX).
 */
export function rivalMix(dist, screenX, vw = 1) {
  const g = dist > 1400 ? 0 : 0.5 / (1 + Math.pow(dist / 350, 2));
  return { gain: g < 0.02 ? 0 : g, pan: clamp((screenX - vw / 2) / (vw / 2), -1, 1) * 0.6 };
}
export const RIVAL_VOICES = 3;

// ------------------------------------------------------------------ squeal
/**
 * v54.2 drift data (Developer): slip01 = clamp((|vL| − 40) / 220, 0, 1). Drift on, hardest corners peak / mid-corner:
 * Razor 0.74/0.73, Neon 0.70/0.67, Gridlock 0.63/0.56, Cargo 0.57/0.39; entry ≈ 0.3, fades to 0 ≈ 400 wu after the exit.
 * Gate: on above 0.22, off below 0.15 (hysteresis); needs speed01 > 0.25 (off below 0.18).
 * Level: trim · smoothstep(0.22, 0.80, slip01): entry 0.3 = faint onset, 0.4–0.7 = clearly audible just under the engine,
 *        0.75 = near full, 0.8–1.0 = full (spins / wall hits). The gain follows slip continuously, so corner exits fade out
 *        with the slip itself. Rising moves use τ 20 ms (≈ 60 ms attack); falling moves τ 60 ms (≈ 180 ms release).
 * Pitch: playbackRate 0.92 → 1.12 across slip01 0.22 → 1.0.
 */
export const SQUEAL = { on: 0.22, off: 0.15, minSpeed: 0.25, offSpeed: 0.18, lo: 0.22, hi: 0.8, trim: 1.0, attackTau: 0.02, releaseTau: 0.06, rate0: 0.92, rateSpan: 0.20, rateTau: 0.06,
  topDb: 3, topLo: 0.8 };   // v54.7: +3 dB more from slip 0.8 → 1.0 (handbrake slide / spins), so the squeal tops the engine there
/** Squeal gain (before the bus) for a given slip01, ignoring the gate. */
export const squealGain = (slip01) => SQUEAL.trim * smooth(SQUEAL.lo, SQUEAL.hi, slip01) * (1 + (dB(SQUEAL.topDb) - 1) * smooth(SQUEAL.topLo, 1, slip01));
export const squealRate = (slip01) => SQUEAL.rate0 + SQUEAL.rateSpan * clamp((slip01 - SQUEAL.lo) / (1 - SQUEAL.lo), 0, 1);
export class SquealVoice {
  constructor(ctx, out, buffers, t0 = ctx.currentTime) {
    this.ctx = ctx; this.on = false; this.target = 0; this.out = gain(ctx, 0);
    const L = LOOPS.squeal; this.s = ctx.createBufferSource(); this.s.buffer = buffers.squeal; this.s.loop = true; this.s.loopStart = L.loopStart; this.s.loopEnd = L.loopEnd;
    chain(this.s, this.out, out); this.s.start(t0, L.loopStart);
  }
  /** Call every frame. Returns the on/off flag (share it with skid smoke and skid marks). */
  update(speed01, slip01, t = this.ctx.currentTime) {
    const S = SQUEAL, sl = clamp(slip01 || 0, 0, 1);
    if (!this.on && sl > S.on && speed01 > S.minSpeed) this.on = true;
    else if (this.on && (sl < S.off || speed01 < S.offSpeed)) this.on = false;
    const target = this.on ? squealGain(sl) : 0;
    this.out.gain.setTargetAtTime(target, t, target > this.target ? S.attackTau : S.releaseTau);
    this.target = target;
    this.s.playbackRate.setTargetAtTime(squealRate(sl), t, S.rateTau);
    return this.on;
  }
  stop(t = this.ctx.currentTime) { this.out.gain.setTargetAtTime(0, t, 0.03); this.s.stop(t + 0.3); }
}

// ------------------------------------------------------------------ one-shots
/**
 * Plays SHOTS[event] variants with small random pitch, never the same variant twice running, voice cap per event.
 * buffers[file] is either an AudioBuffer (v54.6 separate files) or a sprite region { buffer, start, duration } (v54.7).
 * Events with `slam` (podium / win) also play the 'slam' clip at t and their own clip at t + slam.delay.
 */
export class ShotPlayer {
  constructor(ctx, mixer, buffers, rand = Math.random) { this.ctx = ctx; this.mix = mixer; this.b = buffers; this.rand = rand; this.last = {}; this.live = {}; }
  play(event, { gain: g = 1, rate = 1, pan = 0, t = this.ctx.currentTime, variant, lp } = {}) {
    const S = SHOTS[event]; if (!S) return null;
    if (S.slam) { this.play('slam', { gain: g * S.slam.gain * S.gain / SHOTS.slam.gain, rate, pan, t }); t += S.slam.delay / rate; }
    let i = variant ?? Math.floor(this.rand() * S.files.length);
    if (variant == null && S.files.length > 1 && i === this.last[event]) i = (i + 1) % S.files.length;
    this.last[event] = i;
    const live = (this.live[event] = (this.live[event] || []).filter((v) => v.end > t));
    if (live.length >= S.cap) { const old = live.shift(); try { old.g.gain.setTargetAtTime(0, t, 0.01); old.s.stop(t + 0.05); } catch (e) { /* already stopped */ } }
    const r = this.b[S.files[i]], buf = r.buffer || r, off = r.start || 0, dur = r.duration ?? buf.duration;
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const gg = gain(this.ctx, S.gain * g);
    if (lp) { const f = filt(this.ctx, 'lowpass', lp, 0.707); chain(s, f, gg); } else s.connect(gg);
    if (pan && this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; chain(gg, p, this.mix[S.bus]); } else gg.connect(this.mix[S.bus]);
    s.start(t, off, dur); live.push({ s, g: gg, end: t + dur / rate });
    return { source: s, file: S.files[i] };
  }
}
/**
 * sfx('driftBoost', {quality}) (v54.4): q 0..1 → pitch −3 … +3 st, brightness LP 2.5 → 16 kHz, level 0.7 … 1.0,
 * plus the sparkle layer (fades in from q 0.7 to 0.9). Duck the music like the boost whoosh when q ≥ 0.5.
 */
export const DRIFT_BOOST = { st0: -3, stSpan: 6, lp0: 2500, lp1: 16000, g0: 0.7, sparkleOn: 0.7, sparkleFull: 0.9, duckQ: 0.5, sparkleDelay: 0.093 };
export function driftBoostParams(quality) {
  const q = clamp(quality || 0, 0, 1), D = DRIFT_BOOST, rate = Math.pow(2, (D.st0 + D.stSpan * q) / 12);
  return { rate, lp: D.lp0 * Math.pow(D.lp1 / D.lp0, q * q), gain: D.g0 + (1 - D.g0) * q,
    sparkle: smooth(D.sparkleOn, D.sparkleFull, q), sparkleRate: Math.pow(2, (D.stSpan * Math.max(0, q - 0.7)) / 12), duckMusic: q >= D.duckQ };
}
/** Play the whole drift-boost cue through a ShotPlayer (+ music duck). */
export function playDriftBoost(shots, mix, quality, t = shots.ctx.currentTime) {
  const p = driftBoostParams(quality);
  shots.play('drift_boost', { t, rate: p.rate, lp: p.lp, gain: p.gain });
  // v54.7: 0.12 → 0.093 s because drift_boost lost 28 ms of silent lead-in (sparkle 1 ms): same spacing as heard in v54.6
  if (p.sparkle > 0) shots.play('drift_sparkle', { t: t + DRIFT_BOOST.sparkleDelay, gain: p.sparkle, rate: p.sparkleRate });
  if (p.duckMusic && mix.duckMusic) mix.duckMusic(-4 - 2 * quality, 0.1, t);
  return p;
}
/**
 * sfx('boostChain') (v54.6 'DOUBLE BOOST'): a second boost (pad, drift boost or button) lands while one is running →
 * the game fires 'boostChain' INSTEAD of 'boost' (stacks cap at 2). The BoostEdge never fires here (boostLevel is
 * already above 0.15), so there is no double trigger; 'boost_end' still plays once, when the whole boost bleeds out.
 * Plays boost_chain (0.78 s: recorded whooshes +4 st + a rising A-major chip arp) and ducks the music −8 dB.
 * A chained drift boost plays this instead of drift_boost (adding drift_sparkle for q > 0.7 on top is optional).
 * If boostLevel had dipped below 0.05 (edge re-armed) on the frame boostChain fires, skip the edge's 'boost' that frame.
 */
export function playBoostChain(shots, mix, t = shots.ctx.currentTime) {
  const v = shots.play('boostChain', { t });
  if (mix.duckMusic) mix.duckMusic(MUSIC_MIX.chainDb, MUSIC_MIX.chainHoldS, t);
  return v;
}
/** sfx('handbrake'): small random pitch so repeated yanks don't machine-gun. */
export const handbrakeParams = (rand = Math.random) => ({ name: 'handbrake', gain: 1, rate: 0.97 + rand() * 0.06 });
/** Wall: strength from car.wallHit; trigger > 200; heavy at ≥ 0.6; 150 ms per-car cooldown is the caller's. */
export const WALL = { min: 200, span: 700, heavy: 0.6, cooldownMs: 150 };
export const wallStrength = (wallHit) => clamp((wallHit - WALL.min) / WALL.span, 0, 1);
export function wallParams(wallHit, rand = Math.random) {
  if (!(wallHit > WALL.min)) return null;
  const s = wallStrength(wallHit), heavy = s >= WALL.heavy;
  return { name: heavy ? 'wall_heavy' : 'wall_light', gain: 0.12 + 0.88 * Math.pow(s, 1.2), rate: 1.04 - 0.08 * s + (rand() - 0.5) * 0.08, strength: s, heavy, duckDb: heavy ? -3 - 3 * s : 0, duckS: 0.25 };
}
/** Barge: car.carHit closing speed → params; rival-vs-rival −9 dB. */
export function bargeParams(carHit, playerInvolved = true, rand = Math.random) {
  if (!(carHit > 120)) return null;
  const k = clamp((carHit - 80) / 500, 0, 1);
  return { name: 'barge', gain: (0.35 + 0.65 * k) * (playerInvolved ? 1 : dB(-9)), rate: 1.06 - 0.12 * k + (rand() - 0.5) * 0.06 };
}

// ------------------------------------------------------------------ v55 incoming-missile warning
/** Agreed timing: pulses while locked and ttc < 1.5 s; gap 480 → 160 ms as ttc 1.5 → 0.3 s; solid under 0.3 s. Pitch rises +4 st, solid +5 st. */
export const WARN = { ttcStart: 1.5, ttcSolid: 0.3, gapMax: 0.48, gapMin: 0.16, beepFrac: 0.4, rate0: 1.0, rateSpan: 0.26, rateSolid: 1.335, level: 0.42, keepAliveS: 0.15, releaseTau: 0.012, attackS: 0.003 };
const warnK = (ttc) => 1 - clamp((ttc - WARN.ttcSolid) / (WARN.ttcStart - WARN.ttcSolid), 0, 1);
export const warnGap = (ttc) => WARN.gapMin + (WARN.gapMax - WARN.gapMin) * (1 - warnK(ttc));
export const warnRate = (ttc) => WARN.rate0 + WARN.rateSpan * warnK(ttc);
export const warnHz = (ttc) => LOOPS.warn_loop.baseHz * warnRate(ttc);
/**
 * sfx('warn', {ttc, solid}) → pulse(). A pulse = the recorded beep loop gated to 40 % of the current gap, starting now
 * (when the arrow lights). Solid = the same loop held; kept alive by solid pulses, released by stop()/sfx('warnEnd')
 * or by tick() when no solid pulse arrived for 150 ms. Every release is setTargetAtTime τ 12 ms: no clicks.
 */
export class WarnVoice {
  constructor(ctx, out, buffers) { this.ctx = ctx; this.outBus = out; this.buf = buffers.warn_loop; this.held = null; this.until = 0; }
  _src(rate, t) {
    const L = LOOPS.warn_loop, s = this.ctx.createBufferSource(); s.buffer = this.buf; s.loop = true; s.loopStart = L.loopStart; s.loopEnd = L.loopEnd;
    s.playbackRate.value = rate; const g = gain(this.ctx, 0); chain(s, g, this.outBus); s.start(t, L.loopStart); return { s, g };
  }
  pulse({ ttc, solid }, t = this.ctx.currentTime) {
    if (solid) {
      this.until = t + WARN.keepAliveS;
      if (this.held) return;
      const v = this._src(WARN.rateSolid, t);
      v.g.gain.setValueAtTime(0, t); v.g.gain.linearRampToValueAtTime(WARN.level, t + WARN.attackS);
      this.held = v; return;
    }
    const len = warnGap(ttc) * WARN.beepFrac, end = t + len, v = this._src(warnRate(ttc), t);
    v.g.gain.setValueAtTime(0, t); v.g.gain.linearRampToValueAtTime(WARN.level, t + WARN.attackS);
    v.g.gain.setValueAtTime(WARN.level, end - 0.004); v.g.gain.setTargetAtTime(0, end - 0.004, WARN.releaseTau / 3);
    v.s.stop(end + 0.06);
  }
  tick(t = this.ctx.currentTime) { if (this.held && t > this.until) this.stop(t); }
  stop(t = this.ctx.currentTime) {
    if (!this.held) return;
    const { s, g } = this.held; this.held = null;
    g.gain.setTargetAtTime(0, t, WARN.releaseTau); s.stop(t + 0.12);
  }
}
