/**
 * Audio (v54 plumbing, docs/AUDIO.md §5/§7/§9): one AudioContext, mixer buses master → limiter, engine / sfx / ui into
 * master, audio-clock scheduling (no setTimeout note chains), suspend on pause / mute / hidden tab, and the per-frame
 * engine hook. The engine is deliberately SILENT for now (Callum rejected the synth; the recorded set lands later) and
 * nothing from assets/audio/ is loaded. Existing beeps stay until their recordings replace them.
 */
let ctx = null, bus = null;
let muted = false, paused = false, hidden = false;

export function setMuted(m) { muted = !!m; applyState(); }
export function isMuted() { return muted; }
/** Pause menu open / closed (the race clock is frozen): master ramps to 0 and the context suspends. */
export function setAudioPaused(p) { paused = !!p; applyState(); }

function ensure() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (_) { ctx = new AC(); }
    // master 0.9 → limiter (DynamicsCompressor) → destination; engine 0.5 / sfx 0.9 / ui 0.7 → master
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -10; lim.knee.value = 6; lim.ratio.value = 4; lim.attack.value = 0.003; lim.release.value = 0.15;
    const master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(lim); lim.connect(ctx.destination);
    const mk = (g) => { const n = ctx.createGain(); n.gain.value = g; n.connect(master); return n; };
    bus = { master, limiter: lim, engine: mk(0.5), sfx: mk(0.9), ui: mk(0.7) };
    try { self.__RAD_AUDIO__ = { ctx, bus }; } catch (_) {}
  }
  return ctx;
}

const silent = () => muted || paused || hidden;
function applyState() {
  if (!ctx || !bus) return;
  const t = ctx.currentTime, off = silent();
  bus.master.gain.cancelScheduledValues(t);
  bus.master.gain.setTargetAtTime(off ? 0 : 0.9, t, 0.015);
  if (off) setTimeout(() => { if (silent() && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 60);
  else if (ctx.state !== 'running') ctx.resume().catch(() => {});
}

/** One oscillator note on a bus, scheduled `at` seconds from now on the audio clock. */
function beep(freq, dur, type = 'square', gain = 0.04, slide = 0, at = 0, out = 'sfx') {
  if (silent()) return;
  const c = ensure();
  if (!c || c.state !== 'running') return;
  const t0 = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(bus[out] || bus.sfx);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

/** Shared wall-hit strength (docs/AUDIO.md §3.3, assets/fx/README.md): one formula for sound and FX. */
export const WALL = { threshold: 200, range: 700, heavy: 0.6, cooldownMs: 150 };
export const wallStrength = (wallHit) => Math.max(0, Math.min(1, (wallHit - WALL.threshold) / WALL.range));

/** sfx(name, opts): opts.wallHit for 'wall' (gain follows the shared strength). */
export function sfx(name, opts = {}) {
  try { if (self.__RAD_SFX_LOG__) self.__RAD_SFX_LOG__.push(name); } catch (_) {} // verification hook
  const U = 'ui';
  switch (name) {
    case 'wall': { const s = wallStrength(opts.wallHit ?? 450); beep(110, 0.07, 'square', 0.012 + 0.03 * s, -50); break; }
    case 'lap': beep(520, 0.08, 'sine', 0.04, 0, 0, U); beep(680, 0.1, 'sine', 0.04, 0, 0.09, U); break;
    case 'missile': beep(900, 0.28, 'sawtooth', 0.03, -600); beep(240, 0.2, 'triangle', 0.025, -120, 0.04); break;
    case 'hit': beep(90, 0.35, 'sawtooth', 0.06, -50); beep(60, 0.3, 'square', 0.04, -30, 0.05); beep(660, 0.12, 'sine', 0.035, 0, 0.16); break;
    case 'miss': beep(200, 0.18, 'triangle', 0.03, -80); break;
    case 'click': beep(300, 0.04, 'square', 0.025, 0, 0, U); break;
    case 'bonus': beep(660, 0.07, 'square', 0.035); beep(880, 0.07, 'square', 0.035, 0, 0.07); beep(1320, 0.12, 'sine', 0.04, 0, 0.14); break;
    case 'power': beep(300, 0.25, 'sawtooth', 0.035, 600); break;
    case 'autopilot': beep(740, 0.12, 'sine', 0.04, 0, 0.12); beep(990, 0.18, 'sine', 0.04, 0, 0.24); break;
    case 'powerEnd': beep(700, 0.12, 'triangle', 0.035, -300); beep(420, 0.14, 'triangle', 0.03, 0, 0.11); break;
    // v52 finish reveal: a low thump when the place text lands, then a chord (win: fanfare + sparkle)
    case 'slam': beep(120, 0.22, 'sine', 0.09, -70, 0, U); beep(60, 0.28, 'triangle', 0.06, -25, 0, U); beep(523, 0.16, 'square', 0.035, 0, 0.12, U); beep(659, 0.2, 'sine', 0.035, 0, 0.12, U); break;
    case 'podium': sfx('slam'); beep(587, 0.12, 'sine', 0.045, 0, 0.33, U); beep(784, 0.22, 'sine', 0.05, 0, 0.44, U); break;
    case 'win':
      sfx('slam');
      [[523, 0], [659, 120], [784, 240], [1047, 380]].forEach(([f, d]) => beep(f, d === 380 ? 0.42 : 0.14, 'square', 0.04, 0, (330 + d) / 1000, U));
      beep(1568, 0.1, 'sine', 0.03, 0, 1.0, U); beep(2093, 0.16, 'sine', 0.03, 0, 1.09, U);
      break;
    case 'countdown': beep(380, 0.12, 'square', 0.05, 0, 0, U); break;
    case 'countdownGo': beep(520, 0.1, 'square', 0.06, 0, 0, U); beep(780, 0.22, 'sawtooth', 0.05, 0, 0.08, U); break;
    default: break; // 'boost' is no longer a press sound: the boostLevel 0.15 edge will drive the recorded whoosh
  }
}

/**
 * v54 engine hook, called every frame during a race: player { speed01 (vs base 1100, may exceed 1), boostLevel,
 * slip01 } and up to 3 nearest rivals { id, speed01, boostLevel, dist, screenX }. A no-op until the recorded engine
 * lands (docs/ENGINE_NOTE_SPEC.md); kept cheap — it only stores the last frame for the verify scripts.
 */
let lastEngine = null;
export function engineFrame(player, others) { lastEngine = { player, others }; }
export function getEngineFrame() { return lastEngine; }

export function unlockAudio() {
  const c = ensure();
  if (c && !silent() && c.state !== 'running') c.resume().catch(() => {});
}

if (typeof document !== 'undefined') {
  const onVis = () => { hidden = document.visibilityState === 'hidden'; applyState(); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', () => { hidden = true; applyState(); });
  window.addEventListener('pageshow', onVis);
}
