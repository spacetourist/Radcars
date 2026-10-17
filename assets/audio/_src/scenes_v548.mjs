/**
 * v54.8 DRIFT preview + measurement scenes, through the REAL reference mixer (audio-engine.mjs) with the shipped v54.8 files
 * (engine/squeal/drift_scrub/warn loops + the one-shot sprite + music), in Chrome's OfflineAudioContext.
 *   cd /tmp/pp && node <repo>/assets/audio/_src/render_v547.mjs --assets <repo>/assets/audio --previews <dir> --scenes scenes_v548.mjs [--decoded <dir>]
 * Hooks are wired exactly as docs/AUDIO_V548_DRIFT.md tells the game to wire them:
 *   engineFrame({speed01, boostLevel, slip01, drifting, drift01}, others) → eng.update(..., p) / sq.update(..., p.drifting) / drift.update(...)
 *   sfx('driftStart', {dir}) → A.playDriftStart({shots, eng, drift}, {dir});  sfx('driftEnd', {clean}) → A.playDriftEnd({shots}, {clean})
 *   sfx('driftBoost', {quality}) → A.playDriftBoost(...) (unchanged); its boostLevel bump fires 'boost' on the 0.15 edge as in game.js today.
 * Developer's DRIFT model: angle held 20°–45° (never spins), drift01 = (angle − 20) / 25; auto-straighten = driftEnd {clean: false}.
 * m_* scenes are measurement stems only.
 */
import * as A from './audio-engine.mjs';
const SR = 48000;
export const SCENES = [];
let BUF = null;
const scene = (name, seconds, build, opts = {}) => SCENES.push({ name, seconds, build, opts });
export async function init(ext = 'ogg') {
  const ctx = new OfflineAudioContext(1, SR, SR);
  const [a, m] = await Promise.all([A.loadAll(ctx, '/assets/', ext), A.loadSounds(ctx, '/assets/', ext, A.MUSIC_FILES)]); BUF = { ...a, ...m };
}
let seed = 54800; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export async function render(sc) {
  seed = 54800;
  const ctx = new OfflineAudioContext(2, Math.ceil(sc.seconds * SR), SR), mix = A.createMixer(ctx), shots = new A.ShotPlayer(ctx, mix, BUF, rand);
  if (sc.opts.musicOnly) mix.setSfxVolume(0, 0);
  if (sc.opts.sfxOnly) mix.setMusicVolume(0, 0);
  const state = [], log = sc.build(ctx, mix, shots, state, sc.opts) || [];
  const buf = await ctx.startRendering();
  return { ch: [Float32Array.from(buf.getChannelData(0)), Float32Array.from(buf.getChannelData(1))], log, state };
}
// ------------------------------------------------------------------ the preview timeline (s)
// each drift: [press t, hold s, dir, kind, driftBoost quality or 0, label]; drift01 shape 0.4 → 1.0 → 0.6 over the hold
export const DRIFTS = [
  { t: 2.0,  hold: 1.6, dir: -1, clean: true,  q: 0.75, shape: 'arc',  label: 'corner 1 (left)' },
  { t: 7.0,  hold: 1.2, dir: +1, clean: true,  q: 0.9,  shape: 'arc',  label: 'corner 2 (right)' },
  { t: 11.6, hold: 0.35, dir: -1, clean: true, q: 0,    shape: 'tap',  label: 'tap-drift' },
  { t: 14.0, hold: 3.6, dir: +1, clean: false, q: 0,    shape: 'long', label: 'long burning slide -> auto-straighten' }
];
export const T = { end: 28.6, musicOut: 20.4, engOut: 20.4, dry: [21.4, 22.3, 23.2, 23.9], solo: 24.8, soloEnd: 27.8 };
/** drift01 over a hold (Developer's angle model: 20°–45° → 0..1). */
function drift01At(d, u) {           // u = seconds since the press
  const k = u / d.hold;
  if (d.shape === 'tap') return 0.3 * Math.min(1, u / 0.25);                                // a flick: 20° → 27.5°
  if (d.shape === 'long') return u < 1.2 ? 0.4 + 0.6 * (u / 1.2) : Math.min(1, 0.97 + 0.03 * Math.sin(u * 7)) - (u > d.hold - 0.6 ? 0.4 * (u - (d.hold - 0.6)) / 0.6 : 0);
  return k < 0.45 ? 0.4 + 0.6 * (k / 0.45) : 1.0 - 0.4 * ((k - 0.45) / 0.55);              // 0.4 → 1.0 → 0.6
}
/** Player state per 60 fps frame: top-gear cruise, drifts scrub speed, release lets slip decay over 0.4 s, drift boosts bump boostLevel. */
function sim(seconds, fps = 60) {
  const out = [], dt = 1 / fps; let v = 935, lvl = 0;
  for (let i = 0; i * dt < seconds - 1e-9; i++) {
    const t = i * dt; let drifting = false, d01 = 0, slip = 0, tgt = 0;
    for (const d of DRIFTS) {
      const u = t - d.t, end = d.hold;
      if (u >= -0.3 && u < 0) slip = Math.max(slip, 0.3 * (1 + u / 0.3));                    // corner entry before the press
      if (u >= 0 && u < end) { drifting = true; d01 = drift01At(d, u); slip = Math.max(slip, 0.75 + 0.25 * d01); }
      if (u >= end && u < end + 0.4) slip = Math.max(slip, (0.75 + 0.25 * drift01At(d, end - 1e-3)) * (1 - (u - end) / 0.4));  // straightening
      const bs = (400 + 700 * d.q) / 1000; if (d.q > 0 && u >= end && u < end + bs) tgt = 0.6 + 0.35 * d.q;
    }
    lvl = tgt > lvl ? Math.min(tgt, lvl + dt / 0.22) : tgt < lvl ? Math.max(tgt, lvl - dt / 0.45) : lvl;
    const top = 1000 * (1 + 0.4 * lvl);
    if (t < T.engOut) { if (drifting) v = Math.max(720, v - (60 + 90 * d01) * dt); else if (v < top) v = Math.min(top, v + 640 * (1 + 0.7 * lvl) * 1.42 * Math.pow(Math.max(0, 1 - v / (top * 1.04)), 1.45) * dt); else v += (top - v) * Math.min(1, 3 * dt); }
    out.push({ t, speed01: v / 1100, boostLevel: lvl, slip01: slip, drifting, drift01: d01 });
  }
  return out;
}
const near = (t, x) => Math.abs(t - x) < 1 / 120;
function preview(ctx, mix, shots, state, opts) {
  const log = [], L = (t, s) => log.push(`${t.toFixed(2).padStart(6)}  ${s}`);
  const music = new A.MusicPlayer(ctx, mix, BUF);
  music.play('music_race', { t: 0, fadeS: 0 }); L(0, 'music_race loop; engine at top-gear cruise');
  const eng = new A.SampleEngineVoice(ctx, mix.engine, BUF, { t0: 0 }), sq = new A.SquealVoice(ctx, mix.engine, BUF, 0), drift = new A.DriftVoice(ctx, mix.engine, BUF, 0);
  const V = { shots, eng, drift };
  let wasDrift = false, wasSq = false, smoke = false;
  for (const f of sim(T.end)) {
    const t = f.t;
    for (const d of DRIFTS) {
      if (near(t, d.t)) { const p = A.playDriftStart(V, { dir: d.dir }, t); L(t, `${d.label}: sfx('driftStart', {dir: ${d.dir}}) -> drift_start (pan ${p.pan.toFixed(2)}) + engine clutch kick +3 st / 250 ms; drifting, drift01 ${d.shape === 'tap' ? '0 -> 0.3' : d.shape === 'long' ? '0.4 -> 1.0 held' : '0.4 -> 1.0 -> 0.6'}`); }
      if (near(t, d.t + d.hold)) {
        A.playDriftEnd(V, { clean: d.clean }, t);
        L(t, `sfx('driftEnd', {clean: ${d.clean}}) -> drift_end ${d.clean ? '(bright)' : '(dull: held too long, auto-straighten)'}`);
        if (d.q > 0) { A.playDriftBoost(shots, mix, d.q, t); L(t, `sfx('driftBoost', {quality: ${d.q}}) (clean drift pays)`); }
      }
    }
    if (t < T.engOut) {
      // --- engine hook: engineFrame({speed01, boostLevel, slip01, drifting, drift01}, others)
      const r = eng.update(f.speed01, f.boostLevel, f.slip01, t, f);
      const on = sq.update(f.speed01, f.slip01, t, f.drifting), dOn = drift.update(f.speed01, f.drifting, f.drift01, t);
      if (r.edge === 'on') { shots.play('boost', { t }); mix.duckMusic(A.MUSIC_MIX.hitDb, A.MUSIC_MIX.boostHoldS, t); L(t, "boostLevel edge 0.15 -> sfx('boost') (the drift boost's whoosh), music -6 dB"); }
      if (r.edge === 'off') { shots.play('boost_end', { t }); L(t, "boostLevel < 0.05 -> 'boost_end'"); }
      mix.engineLevel(Math.min(1, f.speed01), t);
      if (dOn !== wasDrift) { L(t, dOn ? 'drift layer on (cornering squeal ducked -18 dB)' : 'drift layer released (150 ms)'); wasDrift = dOn; }
      if (on !== wasSq) { L(t, on ? `cornering squeal gate on (slip ${f.slip01.toFixed(2)})` : 'cornering squeal gate off'); wasSq = on; }
      smoke = on || dOn;
      state.push({ t: +t.toFixed(4), s: +f.speed01.toFixed(4), b: +f.boostLevel.toFixed(3), slip: +f.slip01.toFixed(3), drifting: f.drifting ? 1 : 0, d01: +f.drift01.toFixed(3), rpm: Math.round(r.rpm), kick: +r.kick.toFixed(3), sq: on ? 1 : 0, smoke: smoke ? 1 : 0 });
    }
  }
  eng.stop(T.engOut); sq.stop(T.engOut); music.stop({ t: T.musicOut, fadeS: 0.5 }); L(T.musicOut, 'music fades out, engine off: dry one-shots');
  const [a, b, c, e] = T.dry;
  A.playDriftStart({ shots }, { dir: -1 }, a); L(a, "dry: sfx('driftStart', {dir: -1})");
  A.playDriftStart({ shots }, { dir: +1 }, b); L(b, "dry: sfx('driftStart', {dir: +1})");
  A.playDriftEnd({ shots }, { clean: true }, c); L(c, "dry: sfx('driftEnd', {clean: true})");
  A.playDriftEnd({ shots }, { clean: false }, e); L(e, "dry: sfx('driftEnd', {clean: false})");
  // the held slide layer on its own: drift01 0 for 1 s, then a sweep 0 -> 1 over 1.5 s, held, released
  for (let t = T.solo; t < T.soloEnd + 0.4; t += 1 / 60) {
    const u = t - T.solo, held = t < T.soloEnd, d01 = u < 1 ? 0 : Math.min(1, (u - 1) / 1.5);
    drift.update(0.8, held, d01, t);
  }
  L(T.solo, 'dry: drift layer solo, drift01 0 (a 20° slide) for 1 s, then 0 -> 1 (45°) over 1.5 s'); L(T.soloEnd, 'dry: drift layer release (150 ms)');
  drift.stop(T.end - 0.2);
  return log;
}
scene('v548_drift', T.end, preview);
scene('m_v548_sfx_only', T.end, preview, { sfxOnly: true });
// ------------------------------------------------------------------ measurement stems (no music)
// stems: 'eng' = engine only, 'layer' = drift layer only, 'sq' = cornering squeal only, 'all' = engine + squeal + layer
function steady(ctx, mix, shots, state, o) {
  const s01 = o.speed ?? 0.909, eng = o.stem === 'layer' || o.stem === 'sq' ? null : new A.SampleEngineVoice(ctx, mix.engine, BUF, { t0: 0 });
  const sq = o.stem === 'eng' || o.stem === 'layer' ? null : new A.SquealVoice(ctx, mix.engine, BUF, 0);
  const dr = o.stem === 'eng' || o.stem === 'sq' ? null : new A.DriftVoice(ctx, mix.engine, BUF, 0);
  const log = [];
  for (let t = 0; t < o.seconds; t += 1 / 60) {
    const k = o.track(t), r = eng ? eng.update(s01, 0, k.slip01, t, k) : null;
    if (sq) sq.update(s01, k.slip01, t, k.drifting); if (dr) dr.update(s01, k.drifting, k.drift01, t);
    if (o.kickAt && near(t, o.kickAt) && eng) eng.driftKick(t);
    if (r) state.push({ t: +t.toFixed(4), rpm: Math.round(r.rpm), kick: +r.kick.toFixed(3), drift: +r.drift.toFixed(3) });
  }
  return log;
}
// level sweep: not drifting 0–2 s, drifting at drift01 0 (2–4), 0.5 (4–6), 1.0 (6–8), released at 8.0; slip01 0.85 while drifting
const sweep = (t) => { const dr = t >= 2 && t < 8; return { drifting: dr, drift01: !dr ? 0 : t < 4 ? 0 : t < 6 ? 0.5 : 1, slip01: dr ? 0.85 : 0 }; };
for (const stem of ['eng', 'layer', 'sq', 'all']) scene(`m_drift_sweep_${stem}`, 9, steady, { stem, seconds: 9, track: sweep });
// the cornering squeal it replaces: slip01 0.85 without drifting, for the "ducked" comparison
scene('m_sq_slip085', 9, steady, { stem: 'sq', seconds: 9, track: (t) => ({ drifting: false, drift01: 0, slip01: t >= 2 && t < 8 ? 0.85 : 0 }) });
// the clutch-kick flare: engine only at cruise, kick at 2.0 s (not drifting) and at 5.0 s (drifting at drift01 0.4 from 5.0)
scene('m_eng_kick', 8, steady, { stem: 'eng', seconds: 8, kickAt: 2.0, track: (t) => ({ drifting: t >= 5 && t < 7, drift01: 0.4, slip01: 0 }) });
scene('m_eng_kick2', 8, steady, { stem: 'eng', seconds: 8, kickAt: 5.0, track: (t) => ({ drifting: t >= 5 && t < 7, drift01: 0.4, slip01: 0 }) });
// one-shots dry, each 1 s apart: driftStart centre, driftEnd clean, driftEnd not clean, v54.7 handbrake slot (= driftStart alias)
scene('m_oneshots', 5, (ctx, mix, shots) => {
  shots.play('driftStart', { t: 0.5, rate: 1 }); A.playDriftEnd({ shots }, { clean: true }, 1.5); A.playDriftEnd({ shots }, { clean: false }, 2.5); shots.play('handbrake', { t: 3.5 }); return [];
});
