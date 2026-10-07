/**
 * v53 'controls': the touch control + HUD layer (DOM/CSS in screen space over the race canvas).
 *
 * Everything that sets where a control sits or how big it is lives in CONTROL_LAYOUT (Graphic Designer's portrait
 * right-thumb spec, base 390×844 CSS px, scaled by s = min(vw/390, vh/844)); swap numbers there to re-layout.
 * Buttons show states (data-state): ready · active · used · unlimited (BOOST while last) · empty / held (POWER).
 * Pointer handling lives in input.js; this module only lays out and paints.
 */
import { ICONS, POWER_ICON } from './icons.js';

export const CONTROL_LAYOUT = {
  base: { w: 390, h: 844 },
  portrait: {
    // HUD row (top): pills at safe-top + 8, 32 tall; widths make LAP x=12, POS x=90, timer x=160
    hud: { top: 8, left: 12, h: 32, gap: 8, lapW: 70, posW: 62, timeW: 104 },
    pause: { right: 12, top: 8, d: 44 },
    minimap: { right: 12, top: 56, w: 96, h: 96 },
    toast: { top: 48, h: 26 },
    zone: 0.34,                                       // control zone = bottom 34% (+ safe-bottom inset)
    steer: { left: 86, bottom: 144, d: 148, dNarrow: 140, knob: 56, narrowBelow: 375 },
    // right-thumb arc around BRAKE (centres, measured from the right / bottom edge of the 390×844 frame)
    buttons: {
      brake: { right: 86, bottom: 132, d: 100 },
      boost: { right: 86, bottom: 230, d: 64 },
      missile: { right: 156, bottom: 202, d: 64 },
      power: { right: 182, bottom: 132, d: 64 }
    },
    hitPad: 6, minHit: 48,                            // hit area = visual + up to 12 px (shrunk so neighbours never overlap), never under 48 px
    carY: 0.42,                                        // camera: car's resting height (fraction of the screen)
    view: { top: 0.19, bottom: 0.655 }                 // keep-in-view band for the car (between HUD and thumbs)
  },
  landscape: {
    hud: { top: 8, left: 12, h: 32, gap: 8, lapW: 70, posW: 62, timeW: 104 },
    pause: { right: 12, top: 8, d: 44 },
    minimap: { right: 12, top: 58, w: 112, h: 96 },
    toast: { top: 48, h: 26 },
    steer: { leftPct: 0.12, bottomPct: 0.26, d: 148, knob: 56 },
    arcScale: 0.85,                                    // the right arc, mirrored from portrait at 0.85
    hitPad: 6, minHit: 48,
    carY: 0.5,
    view: { top: 0.15, bottom: 0.9 }
  }
};

const ACCENT = { brake: '#e02020', boost: '#00e8ff', missile: '#ffe600', power: '#7c8494' };
export const POWER_COLOR = { rocket: '#ff2b6a', lapboost: '#b8ff00', autopilot: '#00e8ff' };
const NAMES = { brake: 'HANDBRAKE', boost: 'BOOST', missile: 'MISSILE', power: 'POWER' };
const POWER_NAME = { rocket: 'ROCKET', lapboost: 'LAP BOOST', autopilot: 'AUTOPILOT' };

let layout = null;          // last computed layout (CSS px) — read by the camera and the minimap
let lefty = false;
const els = {};
let safe = { top: 0, right: 0, bottom: 0, left: 0 };

function readSafe() {
  let p = document.getElementById('safe-probe');
  if (!p) {
    p = document.createElement('div'); p.id = 'safe-probe';
    p.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(p);
  }
  const cs = getComputedStyle(p);
  safe = { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
}

function btnHtml(id, kind) {
  return `<button type="button" id="${id}" class="act act-${kind}" data-act="${kind}" data-state="ready" aria-label="${NAMES[kind]}">
    <span class="act-vis"><span class="act-ring"></span><span class="act-icon">${ICONS[kind === 'power' ? 'gift' : kind]}</span><span class="act-badge">∞</span></span>
    <span class="act-label">${NAMES[kind]}</span></button>`;
}

/** Build the control layer markup into #touch-controls (called once, before input.js binds to it). */
export function buildControls() {
  const root = document.getElementById('touch-controls');
  if (!root) return;
  root.innerHTML = `
    <div class="tc-steer-zone" id="steer-zone"></div>
    <div class="tc-aim-pad" id="aim-pad" aria-label="Steer"><div class="tc-aim-ring"></div><div class="tc-aim-knob" id="aim-knob"></div><div class="tc-aim-label">STEER</div></div>
    ${btnHtml('btn-brake', 'brake')}${btnHtml('btn-boost', 'boost')}${btnHtml('btn-missile', 'missile')}${btnHtml('btn-power', 'power')}
    <button type="button" id="btn-pause" class="tc-pause" aria-label="Pause">${ICONS.pause}</button>
    <div class="tc-toast hidden" id="tc-toast"><span class="tt-icon"></span><span class="tt-text"></span></div>`;
  for (const k of ['brake', 'boost', 'missile', 'power']) els[k] = document.getElementById('btn-' + k);
  els.pad = document.getElementById('aim-pad'); els.zone = document.getElementById('steer-zone');
  els.pause = document.getElementById('btn-pause'); els.toast = document.getElementById('tc-toast');
  els.root = root;
  for (const k of ['brake', 'boost', 'missile', 'power']) els[k].style.setProperty('--ac', ACCENT[k]);
  relayout();
  addEventListener('resize', relayout);
  addEventListener('orientationchange', () => setTimeout(relayout, 60));
}

export function setLeftHanded(v) { lefty = !!v; if (els.root) { els.root.classList.toggle('lefty', lefty); relayout(); } }
export const isLeftHanded = () => lefty;
export const getLayout = () => layout;

function place(el, cx, cy, d, pad, minHit) {
  const hit = Math.max(minHit, d + pad * 2);
  el.style.left = (cx - hit / 2) + 'px'; el.style.top = (cy - hit / 2) + 'px';
  el.style.width = el.style.height = hit + 'px';
  el.style.setProperty('--d', d + 'px');
  return { x: cx - d / 2, y: cy - d / 2, w: d, h: d, cx, cy, hit };
}

/** Recompute every position from CONTROL_LAYOUT for the current viewport (+ safe-area insets, + left-handed). */
export function relayout() {
  const app = document.getElementById('app');
  if (!app) return;
  readSafe();
  const vw = app.clientWidth || innerWidth, vh = app.clientHeight || innerHeight;
  const portrait = vh >= vw;
  const L = portrait ? CONTROL_LAYOUT.portrait : CONTROL_LAYOUT.landscape;
  const B = CONTROL_LAYOUT.base;
  const s = portrait ? Math.min(vw / B.w, vh / B.h) : Math.min(1.3, Math.max(0.8, vh / 390));
  const arc = portrait ? s : s * L.arcScale;
  const mx = (x) => (lefty ? vw - x : x); // mirror for left-handed play
  const out = { portrait, vw, vh, s, safe: { ...safe }, carY: L.carY, view: L.view, buttons: {} };
  // steering ring
  let sd, scx, scy;
  if (portrait) {
    sd = (vw < L.steer.narrowBelow ? L.steer.dNarrow : L.steer.d) * s;
    scx = safe.left + L.steer.left * s; scy = vh - safe.bottom - L.steer.bottom * s;
  } else {
    sd = L.steer.d * s;
    scx = Math.max(safe.left + sd / 2 + 10, L.steer.leftPct * vw); scy = vh - Math.max(safe.bottom, 0) - L.steer.bottomPct * vh;
    scy = Math.min(scy, vh - safe.bottom - sd / 2 - 10);
  }
  if (lefty) scx = vw - scx;
  const pad = els.pad;
  if (pad) {
    pad.style.left = (scx - sd / 2) + 'px'; pad.style.top = (scy - sd / 2) + 'px';
    pad.style.width = pad.style.height = sd + 'px';
    pad.style.setProperty('--knob', (L.steer.knob * s) + 'px');
  }
  out.steer = { cx: scx, cy: scy, d: sd };
  // control zone (floating steer area = the steer half of it)
  const zoneTop = portrait ? vh - safe.bottom - vh * L.zone : Math.min(scy - sd / 2 - 30, vh * 0.45);
  out.zoneTop = zoneTop;
  if (els.zone) {
    els.zone.style.top = zoneTop + 'px'; els.zone.style.height = (vh - zoneTop) + 'px';
    els.zone.style.width = (vw / 2) + 'px'; els.zone.style.left = (lefty ? vw / 2 : 0) + 'px';
  }
  // action arc
  const arcBtns = Object.entries(portrait ? L.buttons : CONTROL_LAYOUT.portrait.buttons).map(([k, b]) =>
    ({ k, cx: mx(vw - safe.right - b.right * arc), cy: vh - safe.bottom - b.bottom * arc, d: b.d * arc, pad: L.hitPad }));
  // the hit pad never lets two neighbouring hit squares overlap (a tap between BRAKE and POWER must be unambiguous)
  for (const a of arcBtns) for (const b of arcBtns) {
    if (a === b) continue;
    const gap = Math.hypot(a.cx - b.cx, a.cy - b.cy) - (a.d + b.d) / 2; // hit areas are round (border-radius: 50%)
    a.pad = Math.max(0, Math.min(a.pad, gap / 2 - 1));
  }
  for (const a of arcBtns) if (els[a.k]) out.buttons[a.k] = place(els[a.k], a.cx, a.cy, a.d, a.pad, Math.min(L.minHit, a.d + a.pad * 2));
  // HUD + pause + minimap + toast
  const H = L.hud;
  out.hud = { top: safe.top + H.top * s, left: safe.left + H.left * s, h: H.h * s };
  app.style.setProperty('--cs', String(s));
  app.style.setProperty('--hud-top', out.hud.top + 'px');
  app.style.setProperty('--hud-left', out.hud.left + 'px');
  app.style.setProperty('--hud-right', (safe.right + L.pause.right * s) + 'px');
  app.style.setProperty('--toast-top', (safe.top + L.toast.top * s) + 'px');
  app.classList.toggle('portrait', portrait);
  app.classList.toggle('landscape', !portrait);
  if (els.pause) {
    const d = L.pause.d * s;
    els.pause.style.width = els.pause.style.height = d + 'px';
    els.pause.style.top = (safe.top + L.pause.top * s) + 'px';
    els.pause.style.right = (safe.right + L.pause.right * s) + 'px';
    out.pause = { x: vw - safe.right - L.pause.right * s - d, y: safe.top + L.pause.top * s, w: d, h: d };
  }
  const M = L.minimap;
  out.minimap = { x: vw - safe.right - M.right * s - M.w * s, y: safe.top + M.top * s, w: M.w * s, h: M.h * s };
  out.toast = { top: safe.top + L.toast.top * s, h: L.toast.h * s };
  app.style.setProperty('--toast-right', (portrait ? vw - out.minimap.x + 8 : out.hud.left) + 'px');
  layout = out;
  try { self.__RAD_LAYOUT__ = out; } catch (_) {}
  return out;
}

// ---------------------------------------------------------------- per-frame state painting
const prev = {};
let toastT = 0, toastKey = '';
export function toast(text, icon, color) {
  const t = els.toast; if (!t) return;
  t.querySelector('.tt-icon').innerHTML = icon ? ICONS[icon] : '';
  t.querySelector('.tt-text').textContent = text;
  t.style.setProperty('--ac', color || '#ffffff');
  t.classList.remove('hidden', 'show'); void t.offsetWidth; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 1400);
  toastKey = text;
  try { (self.__RAD_TOASTS__ = self.__RAD_TOASTS__ || []).push({ text, icon, t: performance.now() }); } catch (_) {}
}


function paint(k, st) {
  const el = els[k]; if (!el) return;
  const p = prev[k] || (prev[k] = {});
  if (p.state !== st.state) {
    el.dataset.state = st.state;
    if (st.state === 'ready' || st.state === 'held') { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    p.state = st.state;
  }
  if (st.color && p.color !== st.color) { el.style.setProperty('--ac', st.color); p.color = st.color; }
  if (st.icon && p.icon !== st.icon) { el.querySelector('.act-icon').innerHTML = ICONS[st.icon]; p.icon = st.icon; }
  if (p.label !== st.label) { el.querySelector('.act-label').textContent = st.label; p.label = st.label; }
  const f = st.p == null ? -1 : Math.round(st.p * 100) / 100;
  if (p.p !== f) { el.style.setProperty('--p', String(Math.max(0, f))); p.p = f; }
  const badge = !!st.badge;
  if (p.badge !== badge) { el.classList.toggle('has-badge', badge); p.badge = badge; }
}

/**
 * Paint every control from the race state. Returns the button boxes (canvas CSS px) for the verify scripts.
 * w: world (game.js), info: { boostMs, autopilotMs, rocketCount, braking }
 */
export function updateControls(w, info) {
  if (!els.root || !w) return null;
  const counting = w.race.countdown > 0;
  if (prev.counting !== counting) { els.root.classList.toggle('counting', counting); prev.counting = counting; }
  const p = w.player, b = w.boost, ms = w.missile, pw = w.power, L = w.track.length;
  const lapFrac = (((p.dist % L) + L) % L) / L;
  // BRAKE
  paint('brake', { state: info.braking ? 'active' : 'ready', label: 'HANDBRAKE', p: null }); // v54.4: BRAKE → HANDBRAKE
  // BOOST
  let bs;
  if (b.activeMs > 0) bs = { state: 'active', label: 'BOOST', p: b.activeMs / info.boostMs, badge: b.free };
  else if (b.last && !counting) bs = { state: 'unlimited', label: 'BOOST', p: null, badge: true };
  else if (b.charge > 0) bs = { state: 'ready', label: 'BOOST', p: null };
  else bs = { state: 'used', label: 'NEXT LAP', p: lapFrac };
  paint('boost', bs);
  // MISSILE
  let mst;
  if (ms.inFlight) mst = { state: 'active', label: 'MISSILE', p: 1 };
  else if (counting) mst = { state: 'locked', label: '', p: Math.min(1, Math.max(0, 1 - w.race.countdown / (w.race.countdownMs || 3800))) }; // v54.4.1 start lockout: ring fills to GO
  else if (ms.charge > 0 && ms.hasTarget === false && !counting) mst = { state: 'notarget', label: 'NO TARGET', p: null }; // v54.4
  else if (ms.charge > 0) mst = { state: 'ready', label: 'MISSILE', p: null };
  else mst = { state: 'used', label: 'NEXT LAP', p: lapFrac };
  paint('missile', mst);
  // POWER
  let ps;
  const kind = pw.active || pw.held;
  if (pw.active) {
    const frac = pw.active === 'autopilot' ? pw.activeMs / info.autopilotMs : pw.active === 'rocket' ? pw.rocketQueue.length / info.rocketCount : 1;
    ps = { state: 'active', label: POWER_NAME[pw.active], p: frac, icon: POWER_ICON[pw.active], color: POWER_COLOR[pw.active], badge: false };
  } else if (pw.held) ps = { state: 'held', label: POWER_NAME[pw.held], p: null, icon: POWER_ICON[pw.held], color: POWER_COLOR[pw.held] };
  else ps = { state: 'empty', label: 'POWER', p: null, icon: 'gift', color: ACCENT.power };
  paint('power', ps);
  if (pw.active && pw.held && prev.nextHeld !== pw.held) prev.nextHeld = pw.held; // (held one waits for the active one)
  // toasts on state changes (not during the countdown, not on the first frame)
  if (!counting && prev.started) {
    if (prev.boostState && prev.boostState !== 'ready' && bs.state === 'ready') toast('BOOST READY', 'boost', ACCENT.boost);
    if (prev.boostState && prev.boostState !== 'unlimited' && bs.state === 'unlimited' && !(prev.boostState === 'active' && b.free)) toast('LAST · BOOST ∞', 'boost', '#b8ff00');
    if (prev.msState && !['ready', 'notarget'].includes(prev.msState) && ['ready', 'notarget'].includes(mst.state)) toast('MISSILE READY', 'missile', ACCENT.missile);
  }
  const msFlash = ms.flash ? ms.flash.text + ms.flash.ms0 : '';
  if (ms.flash && prev.msFlash !== ms.flash) {
    const k = ms.flash.kind;
    toast(k === 'hit' ? 'HIT! SPUN OUT' : k === 'miss' ? 'MISSED' : 'NO CAR AHEAD', k === 'hit' ? 'hit' : k === 'miss' ? 'miss' : 'missile', k === 'hit' ? '#b8ff00' : k === 'miss' ? '#ff6a6a' : '#ffb000');
  }
  prev.msFlash = ms.flash;
  if (w.driftFlash && prev.dfFlash !== w.driftFlash) { const q = w.driftFlash.q; toast(w.driftFlash.text, 'boost', q >= 0.8 ? '#ffd23f' : '#b8ff00'); } // v54.4 drift boost
  prev.dfFlash = w.driftFlash;
  if (pw.flash && prev.pwFlash !== pw.flash) {
    const got = pw.flash.kind === 'got';
    const icon = got ? POWER_ICON[pw.held] || 'gift' : pw.flash.text.startsWith('ROCKET') ? 'rocket3' : 'gift';
    toast(pw.flash.text, icon, got ? POWER_COLOR[pw.held] : pw.flash.kind === 'hit' ? '#b8ff00' : '#ff6a6a');
  }
  prev.pwFlash = pw.flash;
  prev.boostState = bs.state; prev.msState = mst.state; prev.started = !counting;
  void msFlash;
  return layout && layout.buttons;
}

/** New race: forget the previous race's states so nothing toasts on the first frame. */
export function resetControls() {
  for (const k of Object.keys(prev)) delete prev[k];
  if (els.toast) els.toast.classList.add('hidden');
  try { self.__RAD_TOASTS__ = []; } catch (_) {}
  relayout();
}
