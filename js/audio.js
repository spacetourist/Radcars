/**
 * Audio (v54.7 "the sound release", docs/AUDIO_V547_HANDOFF.md): Audio Engineer's recorded set played through the
 * reference mixer js/audio-engine.mjs (copied verbatim from assets/audio/_src/audio-engine.mjs).
 *
 *   loading  plain Web Audio, no build step. After the renderer is up (main.js → preloadAudio) the one-shot sprite +
 *            its map and the 7 loops are fetched first; only when they are in do the music files follow, one at a time
 *            (menu, race, finish), so music can never delay the first race. Opus (.ogg) where canPlayType says so,
 *            else AAC (.m4a); a file whose .ogg fails to decode falls back to its .m4a. Files are decoded before the
 *            first tap on an OfflineAudioContext (no autoplay warning); the real AudioContext is only created inside
 *            a user gesture (unlockAudio). Buffers are context-independent, so they play in it directly.
 *   music    menu loop on the menus (0.4 s fade in; 1 s when the track arrives after the menu is already showing),
 *            stopped (0.5 s) when a race loads, race loop on the GO frame — or, if it isn't decoded yet, at the next lap
 *            line (never part-way through a lap) — then the finish sting on the place-reveal frame (250 ms crossfade).
 *   drift    v54.8: driftStart / driftEnd one-shots + the held slide layer (DriftVoice) fed drifting / drift01 every frame.
 *   engine   one player voice + squeal + 3 rival voices per race, fed every frame by engineFrame() (also during the
 *            countdown, held 6 dB down until GO); boost_end on the engine's boost edge 'off'; −10 dB for 4 s at the
 *            finish; voices stop when the results come up or the race stops.
 *   pause    mix.setPaused(): music + engine + sfx muted, the ui bus stays live (pause-menu clicks still sound).
 *            Mute (Sound toggle) and hidden tab: master → 0, then suspend.
 *   volumes  Options → Music / Effects (0..1, localStorage radcars.musicVol 0.8 / radcars.sfxVol 1.0, gain = v²).
 *   ?synth=1 the old v54.6 oscillator beeps, nothing is downloaded (kept as a switch for comparison / fallback).
 * Verify hooks: self.__RAD_SFX_LOG__ (game sfx() calls, if the page defines it), self.__RAD_SFX_PLAYED__ (clips actually
 * scheduled, with their audio-clock time), self.__RAD_AUDIO__ (load timeline, context, mixer).
 */
import * as A from './audio-engine.mjs';

const SYNTH = (() => { try { return new URLSearchParams(location.search).get('synth') === '1'; } catch (_) { return false; } })();
const BASE = 'assets/audio/';
const Q = (() => { try { const b = self.RADCARS_BUILD; return b ? `?b=${encodeURIComponent(`${b.version}-${b.name}`)}` : ''; } catch (_) { return ''; } })();
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const VOL_KEY = { music: 'radcars.musicVol', sfx: 'radcars.sfxVol' };
const readVol = (k, d) => { try { const s = localStorage.getItem(k); const v = s == null ? NaN : parseFloat(s); return Number.isFinite(v) ? clamp01(v) : d; } catch (_) { return d; } };
const vol = { music: readVol(VOL_KEY.music, 0.8), sfx: readVol(VOL_KEY.sfx, 1) };

let ctx = null, mix = null, shots = null, music = null;
let muted = false, paused = false, hidden = false;
const B = {};                                   // decoded: loops (AudioBuffer), sprite regions {buffer,start,duration}, music
const load = { started: false, core: false, coreFailed: false, ext: null, files: {}, timeline: [], t0: 0 };
let scene = 'menu', racePending = false, raceOn = false, lastDriftT = -1e9, pendingDrift = null, frames = 0;
let eng = null, sq = null, drift = null, rivals = [], warn = null;
const played = [], perf = { frames: 0, ms: 0 };
try { self.__RAD_SFX_PLAYED__ = played; } catch (_) {}
try {
  self.__RAD_AUDIO__ = {
    synth: SYNTH, load, B, vol, perf,
    get ctx() { return ctx; }, get mix() { return mix; }, get music() { return music; },
    get scene() { return scene; }, get drift() { return driftAudio; }, get driftVoice() { return !!drift; }, get racePending() { return racePending; }, get voices() { return !!eng; }
  };
} catch (_) {}
const mark = (name, ev, extra) => { if (load.timeline.length < 200) load.timeline.push({ name, ev, t: Math.round(performance.now()), ...extra }); };

export function setMuted(m) { muted = !!m; applyState(); }
export function isMuted() { return muted; }
/** Pause menu open / closed: mix.setPaused (the ui bus stays live so the pause-menu clicks are heard). */
export function setAudioPaused(p) {
  paused = !!p;
  if (SYNTH) { synthApply(); return; }
  if (mix) mix.setPaused(paused);
}

// ------------------------------------------------------------------ context + lifecycle
const silent = () => muted || hidden;
function createContext() {
  if (ctx || typeof window === 'undefined') return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch (_) { try { ctx = new AC(); } catch (e) { return null; } }
  mix = A.createMixer(ctx);
  mix.musicVol.gain.value = A.volumeGain(vol.music); mix.sfxVol.gain.value = A.volumeGain(vol.sfx);
  mix.setMusicVolume(vol.music); mix.setSfxVolume(vol.sfx);
  if (silent()) mix.master.gain.value = 0;
  if (paused) mix.setPaused(true);
  shots = new LoggedShots(ctx, mix, B);
  music = new A.MusicPlayer(ctx, mix, B);
  if (ctxWaiters.length) { ctxWaiters.forEach((f) => f(ctx)); ctxWaiters.length = 0; }
  if (scene === 'menu' && B.music_menu) music.play('music_menu', { fadeS: 0.4 });
  applyState();
  return ctx;
}
function applyState() {
  if (SYNTH) { synthApply(); return; }
  if (!ctx || !mix) return;
  const t = ctx.currentTime, off = silent();
  mix.master.gain.cancelScheduledValues(t);
  mix.master.gain.setTargetAtTime(off ? 0 : 0.9, t, 0.015);
  if (off) setTimeout(() => { if (silent() && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 60);
  else if (ctx.state !== 'running') ctx.resume().catch(() => {});
}
/** Call inside a user gesture (menus, race start, first tap): creates / resumes the context and starts the preload. */
export function unlockAudio() {
  if (SYNTH) { const c = synthEnsure(); if (c && !synthSilent() && c.state !== 'running') c.resume().catch(() => {}); return; }
  preloadAudio();
  const c = createContext();
  if (c && !silent() && c.state !== 'running') c.resume().catch(() => {});
}

// ------------------------------------------------------------------ loading
const ctxWaiters = [];
let decoder = null;
function decodeCtx() {
  if (ctx) return Promise.resolve(ctx);
  if (decoder === null) {
    const O = self.OfflineAudioContext || self.webkitOfflineAudioContext;
    try { decoder = O ? new O(1, 1, 48000) : false; } catch (_) { decoder = false; }
  }
  return decoder ? Promise.resolve(decoder) : new Promise((r) => ctxWaiters.push(r)); // no offline context: wait for the tap
}
async function decode(ab) {
  const c = await decodeCtx();
  return new Promise((res, rej) => { try { const p = c.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); } catch (e) { rej(e); } });
}
async function fetchBuf(name, ext) {
  mark(name, 'req', { ext });
  const r = await fetch(`${BASE}${name}.${ext}${Q}`);
  if (!r.ok) throw new Error(`${name}.${ext}: HTTP ${r.status}`);
  const ab = await r.arrayBuffer();
  mark(name, 'got', { ext, bytes: ab.byteLength });
  return ab;
}
/** Fetch + decode one file; .ogg that fails to decode → .m4a. */
async function loadFile(name, ext) {
  try { const b = await decode(await fetchBuf(name, ext)); load.files[name] = ext; mark(name, 'dec', { ext }); return b; }
  catch (err) {
    if (ext === 'm4a') throw err;
    mark(name, 'fallback', { why: String(err && err.message || err) });
    const b = await decode(await fetchBuf(name, 'm4a')); load.files[name] = 'm4a'; mark(name, 'dec', { ext: 'm4a' }); return b;
  }
}
/** Start the background download (idempotent). main.js calls it once the renderer is up; unlockAudio() calls it too. */
export function preloadAudio() {
  if (SYNTH || load.started || typeof fetch === 'undefined') return;
  load.started = true; load.t0 = Math.round(performance.now());
  const ext = load.ext = A.audioExt();
  const core = (async () => {
    const map = fetch(`${BASE}${A.SPRITE.map}${Q}`).then((r) => r.json());
    const sprite = loadFile(A.SPRITE.file, ext);
    const loops = A.LOOP_FILES.map((n) => loadFile(n, ext).then((b) => { B[n] = b; }));
    const [m, buf] = await Promise.all([map, sprite]);
    for (const [n, r] of Object.entries(m)) B[n] = { buffer: buf, start: r.start, duration: Math.min(r.duration, buf.duration - r.start) };
    await Promise.all(loops);
  })();
  core.then(() => { load.core = true; mark('core', 'ready'); }, (e) => { load.coreFailed = true; mark('core', 'failed', { why: String(e && e.message || e) }); })
    .then(async () => {
      // music only after the sprite + engine, one file at a time (menu first)
      for (const n of ['music_menu', 'music_race', 'music_finish']) {
        try { B[n] = await loadFile(n, ext); musicArrived(n); } catch (e) { mark(n, 'failed', { why: String(e && e.message || e) }); }
      }
    });
}
function musicArrived(name) {
  if (name === 'music_menu' && scene === 'menu' && music) music.play('music_menu', { fadeS: 1.0 }); // late: fade in over ~1 s
}

// ------------------------------------------------------------------ one-shots
class LoggedShots extends A.ShotPlayer {
  play(event, o = {}) {
    const S = A.SHOTS[event], t0 = o.t ?? this.ctx.currentTime;
    const r = super.play(event, o);
    if (r && S) {
      if (played.length > 600) played.splice(0, 300);
      played.push({ ev: event, file: r.file, g: +(o.gain ?? 1).toFixed(3), t: +(t0 + (S.slam ? S.slam.delay / (o.rate || 1) : 0)).toFixed(4), now: Math.round(performance.now()) });
    }
    return r;
  }
}

/** Shared wall-hit strength (docs/AUDIO.md §3.3, assets/fx/README.md): one formula for sound and FX. */
export const WALL = { threshold: 200, range: 700, heavy: 0.6, cooldownMs: 150 };
export const wallStrength = (wallHit) => Math.max(0, Math.min(1, (wallHit - WALL.threshold) / WALL.range));

/** sfx(name, opts): game / UI events → sprite clips (handoff §4.1). opts.wallHit for 'wall', opts.quality for 'driftBoost'. */
export function sfx(name, opts = {}) {
  try { if (self.__RAD_SFX_LOG__) self.__RAD_SFX_LOG__.push(name); } catch (_) {} // verification hook
  if (SYNTH) { synthSfx(name, opts); return; }
  musicCue(name);
  if (!ctx || !load.core || silent()) return;
  const t = ctx.currentTime;
  switch (name) {
    case 'wall': {
      const p = A.wallParams(opts.wallHit ?? 450); if (!p) break;
      shots.play(p.name, { gain: p.gain, rate: p.rate, t });
      if (p.heavy) { mix.duck(mix.engineDuck, p.duckDb, p.duckS, t); mix.duckMusic(undefined, undefined, t); }
      break;
    }
    case 'boost':
      // a drift boost already played its own cue; its boostLevel edge would add the whoosh on top (AE: skip for 0.3 s)
      if (t - lastDriftT < 0.3) { played.push({ ev: 'boost', skipped: 'driftBoost', t: +t.toFixed(4), now: Math.round(performance.now()) }); break; }
      shots.play('boost', { t }); mix.duckMusic(A.MUSIC_MIX.hitDb, A.MUSIC_MIX.boostHoldS, t);
      break;
    case 'boostChain':                                                         // INSTEAD of 'boost' (game.js never sends both)
      if (pendingDrift) { played.push({ ev: 'drift_boost', skipped: 'boostChain', t: +t.toFixed(4), now: Math.round(performance.now()) }); pendingDrift = null; }
      A.playBoostChain(shots, mix, t); break;
    case 'driftBoost':
      // held for one frame: a drift landing that chains reaches chainBoost on the NEXT frame, and a chained drift boost
      // plays boostChain instead of drift_boost (audio-engine.mjs playBoostChain); otherwise it plays 1 frame later
      lastDriftT = t; pendingDrift = { q: opts.quality ?? 0.5, frame: frames }; break;
    // v54.8 DRIFT (docs/AUDIO_V548_DRIFT.md): the tyre bite + clutch-kick rev flare on the slide's start, the grip-catch
    // chirp on its end (clean: released; false: auto-straighten / wall). The held slide layer runs in engineFrame.
    case 'driftStart': A.playDriftStart({ shots, eng, drift }, { dir: opts.dir || 0 }, t); break;
    case 'driftEnd': A.playDriftEnd({ shots }, { clean: opts.clean !== false }, t); break;
    case 'missile': shots.play('missile_launch', { rate: 0.98 + Math.random() * 0.06, t }); break;
    case 'hit': shots.play('explosion', { gain: 0.8, t }); mix.duck(mix.engineDuck, -4, 0.3, t); mix.duckMusic(undefined, undefined, t); break;
    case 'bonus': shots.play('pickup', { t }); break;
    case 'steerOff': shots.play('denied', { gain: 0.7, t }); break;           // thumb left the steer ring (AE: denied at ~70 %)
    case 'steerOn': shots.play('click', { t }); break;                        // steering taken back
    case 'miss': case 'denied': case 'power': case 'autopilot': case 'powerEnd': case 'lap': case 'click':
    case 'countdown': case 'countdownGo': case 'slam': case 'podium': case 'win':
      shots.play(name, { t }); break;                                         // podium / win carry their own slam
    default: break;
  }
}

// ------------------------------------------------------------------ music scenes (handoff §4.3)
function musicCue(name) {
  if (name === 'countdownGo') {
    scene = 'race';
    if (music && B.music_race) { music.play('music_race', { fadeS: 0 }); racePending = false; } else racePending = true;
  } else if (name === 'lap') {
    if (racePending && music && B.music_race) { music.play('music_race', { fadeS: 0 }); racePending = false; }
  } else if (name === 'slam' || name === 'podium' || name === 'win') {
    scene = 'finish'; racePending = false;
    if (music) { if (B.music_finish) music.finish(); else music.stop({ fadeS: 0.5 }); }
    if (mix) mix.duck(mix.engineDuck, -10, 4);
  }
}
/** Menus (title / track select / options): the menu loop. fadeS 1.0 when coming back from the results. */
export function musicMenu(fadeS = 0.4) {
  scene = 'menu'; racePending = false;
  if (SYNTH || !music) return;
  if (B.music_menu) music.play('music_menu', { fadeS });
}

// ------------------------------------------------------------------ race lifecycle + engine (handoff §4.2)
/** game.startRace: music out (0.5 s), fresh voices, engine held −6 dB until GO. */
export function raceAudioStart(countdownMs = 3800) {
  scene = 'load'; racePending = false; raceOn = true; lastDriftT = -1e9; pendingDrift = null;
  if (SYNTH || !ctx) return;
  stopVoices();
  if (paused) { paused = false; mix.setPaused(false); }
  if (music) music.stop({ fadeS: 0.5 });
  mix.duck(mix.engineDuck, -6, Math.max(0, countdownMs) / 1000);
}
/** The results came up or the race stopped (quit, again, title): every race voice stops (ramped). */
export function raceAudioEnd() {
  raceOn = false;
  if (SYNTH) return;
  stopVoices();
  if (paused && mix) { paused = false; mix.setPaused(false); } // quit from the pause menu
  if ((scene === 'race' || scene === 'load') && music) { music.stop({ fadeS: 0.5 }); scene = 'results'; } // no finish sting (quit / timeout)
  racePending = false;
}
function makeVoices() {
  eng = new A.SampleEngineVoice(ctx, mix.engine, B);
  sq = new A.SquealVoice(ctx, mix.engine, B);
  drift = B.drift_scrub ? new A.DriftVoice(ctx, mix.engine, B) : null; // v54.8 held power-slide layer
  rivals = [0.94, 1.05, 0.97].slice(0, A.RIVAL_VOICES).map((p) => { const v = new A.SampleEngineVoice(ctx, mix.engine, B, { quality: 'lite', pitchMul: p }); v.audible = false; return v; });
  warn = new A.WarnVoice(ctx, mix.ui, B);
}
function stopVoices() {
  if (!ctx) return;
  const t = ctx.currentTime;
  try { if (eng) eng.stop(t); if (sq) sq.stop(t); if (drift) drift.stop(t); rivals.forEach((v) => v.stop(t)); if (warn) warn.stop(t); } catch (_) {}
  eng = sq = drift = warn = null; rivals = [];
}
/**
 * Every race frame (also the countdown): player { speed01 (vs base 1100, may exceed 1), boostLevel (≤ 1.35 in the
 * DOUBLE BOOST rush), slip01 } and up to 3 nearest rivals { id, speed01, boostLevel, dist, screenX 0..1 }.
 */
let lastEngine = null;
const driftAudio = { squealing: false, sliding: false, drifting: false, drift01: 0 }; // v54.8 verify hook (self.__RAD_AUDIO__.drift)
export function engineFrame(p, others) {
  lastEngine = { player: p, others };
  if (SYNTH || !raceOn || !ctx || !load.core || ctx.state !== 'running') return;
  const c0 = performance.now();
  if (!eng) makeVoices();
  const t = ctx.currentTime;
  frames++;
  if (pendingDrift && frames - pendingDrift.frame >= 2) { if (!silent()) A.playDriftBoost(shots, mix, pendingDrift.q, t); pendingDrift = null; }
  const st = eng.update(p.speed01, p.boostLevel, p.slip01, t, p);          // v54.8: reads p.drifting / p.drift01 (wheelspin)
  if (st.edge === 'off') shots.play('boost_end', { t });                     // game.js never fires boost_end
  const squealing = sq.update(p.speed01, p.slip01, t, !!p.drifting);         // v54.8: ducked −18 dB while drifting
  const sliding = drift ? drift.update(p.speed01, !!p.drifting, p.drifting ? p.drift01 || 0 : 0, t) : false;
  driftAudio.squealing = squealing; driftAudio.sliding = sliding; driftAudio.drifting = !!p.drifting; driftAudio.drift01 = p.drift01 || 0;
  mix.engineLevel(Math.min(1, p.speed01), t);
  for (let i = 0; i < rivals.length; i++) {
    const v = rivals[i], o = others && others[i];
    const m = o ? A.rivalMix(o.dist, o.screenX) : { gain: 0, pan: 0 };
    v.place(m.gain, m.pan, t);
    if (m.gain > 0) v.update(o.speed01, Math.min(1, o.boostLevel || 0), 0, t);
    else if (v.audible) v.out.gain.setTargetAtTime(0, t, 0.08);             // culled: place() alone doesn't move the gain
    v.audible = m.gain > 0;
  }
  if (warn) warn.tick(t);
  perf.frames++; perf.ms += performance.now() - c0;                         // main-thread cost (verify hook)
}
export function getEngineFrame() { return lastEngine; }

/** v55 incoming-missile warning (handoff §4.4): pulses from the game clock; stop on impact / evade. */
export function warnPulse(o) { if (warn && ctx && !silent()) warn.pulse(o, ctx.currentTime); }
export function warnStop() { if (warn && ctx) warn.stop(ctx.currentTime); }

// ------------------------------------------------------------------ volumes (Options)
export function getVolumes() { return { music: vol.music, sfx: vol.sfx }; }
export function setMusicVolume(v) { vol.music = clamp01(+v || 0); try { localStorage.setItem(VOL_KEY.music, String(vol.music)); } catch (_) {} if (mix) mix.setMusicVolume(vol.music); }
export function setSfxVolume(v) { vol.sfx = clamp01(+v || 0); try { localStorage.setItem(VOL_KEY.sfx, String(vol.sfx)); } catch (_) {} if (mix) mix.setSfxVolume(vol.sfx); }

if (typeof document !== 'undefined' && !SYNTH) {
  const onVis = () => { hidden = document.visibilityState === 'hidden'; applyState(); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', () => { hidden = true; applyState(); });
  window.addEventListener('pageshow', onVis);
  // iOS can leave the context 'interrupted' / suspended after a call or backgrounding: any later tap resumes it
  window.addEventListener('pointerdown', () => { if (ctx && !silent() && ctx.state !== 'running') ctx.resume().catch(() => {}); }, true);
}

// ------------------------------------------------------------------ ?synth=1: the v54.6 oscillator beeps (no files)
let sctx = null, sbus = null;
const synthSilent = () => muted || paused || hidden;
function synthEnsure() {
  if (typeof window === 'undefined') return null;
  if (!sctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { sctx = new AC({ latencyHint: 'interactive' }); } catch (_) { sctx = new AC(); }
    const lim = sctx.createDynamicsCompressor();
    lim.threshold.value = -10; lim.knee.value = 6; lim.ratio.value = 4; lim.attack.value = 0.003; lim.release.value = 0.15;
    const master = sctx.createGain(); master.gain.value = 0.9;
    master.connect(lim); lim.connect(sctx.destination);
    const mk = (g) => { const n = sctx.createGain(); n.gain.value = g; n.connect(master); return n; };
    sbus = { master, limiter: lim, engine: mk(0.5), sfx: mk(0.9), ui: mk(0.7) };
  }
  return sctx;
}
function synthApply() {
  if (!sctx || !sbus) return;
  const t = sctx.currentTime, off = synthSilent();
  sbus.master.gain.cancelScheduledValues(t);
  sbus.master.gain.setTargetAtTime(off ? 0 : 0.9, t, 0.015);
  if (off) setTimeout(() => { if (synthSilent() && sctx.state === 'running') sctx.suspend().catch(() => {}); }, 60);
  else if (sctx.state !== 'running') sctx.resume().catch(() => {});
}
if (typeof document !== 'undefined' && SYNTH) {
  const onVis = () => { hidden = document.visibilityState === 'hidden'; synthApply(); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', () => { hidden = true; synthApply(); });
  window.addEventListener('pageshow', onVis);
}
function beep(freq, dur, type = 'square', gain = 0.04, slide = 0, at = 0, out = 'sfx') {
  if (synthSilent()) return;
  const c = synthEnsure();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(sbus[out] || sbus.sfx);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function synthSfx(name, opts) {
  const U = 'ui';
  switch (name) {
    case 'wall': { const s = wallStrength(opts.wallHit ?? 450); beep(110, 0.07, 'square', 0.012 + 0.03 * s, -50); break; }
    case 'denied': beep(196, 0.07, 'square', 0.018, -30, 0, U); break;
    case 'driftBoost': { const q = opts.quality ?? 0.5; beep(660 + 260 * q, 0.1, 'sine', 0.02 + 0.02 * q, 220, 0, U); break; }
    case 'boostChain': beep(240, 0.34, 'sawtooth', 0.026, 560); beep(480, 0.28, 'triangle', 0.03, 900, 0.07); beep(960, 0.16, 'sine', 0.018, 700, 0.16); break;
    case 'lap': beep(520, 0.08, 'sine', 0.04, 0, 0, U); beep(680, 0.1, 'sine', 0.04, 0, 0.09, U); break;
    case 'missile': beep(900, 0.28, 'sawtooth', 0.03, -600); beep(240, 0.2, 'triangle', 0.025, -120, 0.04); break;
    case 'hit': beep(90, 0.35, 'sawtooth', 0.06, -50); beep(60, 0.3, 'square', 0.04, -30, 0.05); beep(660, 0.12, 'sine', 0.035, 0, 0.16); break;
    case 'miss': beep(200, 0.18, 'triangle', 0.03, -80); break;
    case 'click': case 'steerOn': beep(300, 0.04, 'square', 0.025, 0, 0, U); break;
    case 'steerOff': beep(196, 0.07, 'square', 0.018 * 0.7, -30, 0, U); break;
    case 'bonus': beep(660, 0.07, 'square', 0.035); beep(880, 0.07, 'square', 0.035, 0, 0.07); beep(1320, 0.12, 'sine', 0.04, 0, 0.14); break;
    case 'power': beep(300, 0.25, 'sawtooth', 0.035, 600); break;
    case 'autopilot': beep(740, 0.12, 'sine', 0.04, 0, 0.12); beep(990, 0.18, 'sine', 0.04, 0, 0.24); break;
    case 'powerEnd': beep(700, 0.12, 'triangle', 0.035, -300); beep(420, 0.14, 'triangle', 0.03, 0, 0.11); break;
    case 'slam': beep(120, 0.22, 'sine', 0.09, -70, 0, U); beep(60, 0.28, 'triangle', 0.06, -25, 0, U); beep(523, 0.16, 'square', 0.035, 0, 0.12, U); beep(659, 0.2, 'sine', 0.035, 0, 0.12, U); break;
    case 'podium': synthSfx('slam', opts); beep(587, 0.12, 'sine', 0.045, 0, 0.33, U); beep(784, 0.22, 'sine', 0.05, 0, 0.44, U); break;
    case 'win':
      synthSfx('slam', opts);
      [[523, 0], [659, 120], [784, 240], [1047, 380]].forEach(([f, d]) => beep(f, d === 380 ? 0.42 : 0.14, 'square', 0.04, 0, (330 + d) / 1000, U));
      beep(1568, 0.1, 'sine', 0.03, 0, 1.0, U); beep(2093, 0.16, 'sine', 0.03, 0, 1.09, U);
      break;
    case 'countdown': beep(380, 0.12, 'square', 0.05, 0, 0, U); break;
    case 'countdownGo': beep(520, 0.1, 'square', 0.06, 0, 0, U); beep(780, 0.22, 'sawtooth', 0.05, 0, 0.08, U); break;
    default: break;
  }
}
