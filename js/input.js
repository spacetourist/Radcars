/**
 * Input (v53 'controls'): auto-throttle, so the player only steers, brakes and fires.
 * Touch (mobile-first, see js/controls.js for the data-driven layout):
 *   - STEER: floating ring — a touch anywhere in the steer half of the control zone re-centres the ring under the
 *     thumb; the finger's angle from the centre sets the car's heading (8% dead zone, smoothed). Snaps back on release.
 *   - BRAKE: hold. Slide up from BRAKE = boost, slide towards the arc (left; right when left-handed) = missile.
 *   - BOOST / MISSILE / POWER: dedicated tap buttons. Every control owns its own pointer (multi-touch safe).
 * Keyboard (desktop / testing, never shown in the HUD): arrows/WASD steer, Down/S brake, Shift boost, Space missile,
 * E power-up, P/Esc pause. Up/W does nothing (the throttle is automatic).
 */
export function createInput() {
  const state = {
    steer: 0,
    accel: false,           // Up/W held (no effect since v53: auto-throttle) — kept for old callers
    brake: false,           // v53: keyboard Down/S or the BRAKE button
    brakeTouch: false, brakeKey: false,
    pausePressed: false,
    left: false,
    right: false,
    aimAngle: null,
    aimActive: false,
    keySteer: 0,
    boostPressed: false, boostSource: null,
    missilePressed: false, missileSource: null,
    powerPressed: false, powerSource: null,
    taps: { brake: 0, boost: 0, missile: 0, power: 0, steer: 0, slideBoost: 0, slideMissile: 0 } // verification tallies
  };
  const SLIDE_PX = 40;
  const keys = new Set();
  const lefty = () => !!document.getElementById('touch-controls')?.classList.contains('lefty');

  function syncSteer() {
    if (state.aimActive && state.aimAngle != null) { state.steer = 0; return; }
    const keyR = keys.has('ArrowRight') || keys.has('d') || state.right;
    const keyL = keys.has('ArrowLeft') || keys.has('a') || state.left;
    state.keySteer = (keyR ? 1 : 0) - (keyL ? 1 : 0);
    state.steer = state.keySteer;
  }
  const syncBrake = () => { state.brakeKey = keys.has('ArrowDown') || keys.has('s'); state.brake = state.brakeKey || state.brakeTouch; };

  // Letter keys are stored lower-case so W/A/S/D release correctly while Shift (boost) is held
  const norm = (k) => (k && k.length === 1 ? k.toLowerCase() : k);

  function onKeyDown(e) {
    keys.add(norm(e.key));
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'A', 'd', 'D', 'w', 'W', 's', 'S', ' '].includes(e.key)) e.preventDefault();
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') state.accel = true;
    if (e.key === ' ' && !e.repeat) { state.missilePressed = true; state.missileSource = 'key'; }
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (!e.repeat) state.pausePressed = true; }
    if (e.key === 'Shift' && !e.repeat) { state.boostPressed = true; state.boostSource = 'key'; }
    if ((e.key === 'e' || e.key === 'E') && !e.repeat) { state.powerPressed = true; state.powerSource = 'key'; }
    syncSteer(); syncBrake();
  }
  function onKeyUp(e) {
    keys.delete(norm(e.key));
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') state.accel = keys.has('ArrowUp') || keys.has('w');
    syncSteer(); syncBrake();
  }
  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => { keys.clear(); state.accel = false; syncSteer(); syncBrake(); });

  const press = (el, ms = 160) => { el.classList.add('pressed'); setTimeout(() => el.classList.remove('pressed'), ms); };
  const buzz = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) {} };

  /** Floating steering ring (Pointer Events + capture). */
  function bindSteer() {
    const root = document.getElementById('aim-pad');
    const knob = document.getElementById('aim-knob');
    const zone = document.getElementById('steer-zone');
    if (!root || !knob) return;
    let pid = null, cx = 0, cy = 0, sx = 0, sy = 0; // ring centre (client px), smoothed unit vector
    const DEAD = 0.08;
    const radius = () => Math.max(1, root.clientWidth / 2);
    function setKnob(nx, ny) {
      const m = Math.hypot(nx, ny), k = m > 1 ? 1 / m : 1, maxPx = radius() - knob.clientWidth / 2 + 4;
      knob.style.transform = `translate(${nx * k * maxPx}px, ${ny * k * maxPx}px)`;
    }
    function apply(x, y) {
      const r = radius(), nx = (x - cx) / r, ny = (y - cy) / r, m = Math.hypot(nx, ny);
      setKnob(nx, ny);
      if (m < DEAD) return; // dead zone: keep the last heading while held
      const ux = nx / m, uy = ny / m;
      // radial output with light smoothing (fast enough for hairpins, kills jitter)
      if (!state.aimActive) { sx = ux; sy = uy; } else { sx += (ux - sx) * 0.6; sy += (uy - sy) * 0.6; }
      state.aimAngle = Math.atan2(sy, sx); state.aimActive = true;
      syncSteer();
    }
    function down(ev, float) {
      ev.preventDefault();
      if (pid != null) return;
      pid = ev.pointerId;
      const tgt = ev.currentTarget;
      try { tgt.setPointerCapture(pid); } catch (_) {}
      const rr = root.getBoundingClientRect();
      if (float) {
        // re-centre under the thumb (kept fully on screen)
        const r = rr.width / 2, app = document.getElementById('app').getBoundingClientRect();
        cx = Math.min(app.right - r - 4, Math.max(app.left + r + 4, ev.clientX));
        cy = Math.min(app.bottom - r - 4, Math.max(app.top + r + 4, ev.clientY));
        root.style.translate = `${cx - (rr.left + r)}px ${cy - (rr.top + r)}px`;
      } else { cx = rr.left + rr.width / 2; cy = rr.top + rr.height / 2; }
      root.classList.add('active');
      state.taps.steer++;
      apply(ev.clientX, ev.clientY);
    }
    function move(ev) { if (ev.pointerId !== pid) return; ev.preventDefault(); apply(ev.clientX, ev.clientY); }
    function up(ev) {
      if (ev.pointerId !== pid) return;
      ev.preventDefault();
      try { ev.currentTarget.releasePointerCapture(pid); } catch (_) {}
      pid = null;
      state.aimActive = false; state.aimAngle = null;
      root.classList.remove('active');
      root.style.translate = ''; // snap back
      setKnob(0, 0); syncSteer();
    }
    for (const [el, float] of [[root, true], [zone, true]]) { // spec: any touch in the steer half re-centres the ring
      if (!el) continue;
      el.addEventListener('pointerdown', (ev) => down(ev, float));
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    }
    setKnob(0, 0);
  }

  /** BRAKE: hold; slide up = boost, slide towards the arc = missile (one request per slide). */
  function bindBrake(el) {
    if (!el) return;
    let pid = null, x0 = 0, y0 = 0, fired = false;
    const release = () => { state.brakeTouch = false; syncBrake(); el.classList.remove('active'); };
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      if (pid != null) return;
      pid = ev.pointerId; x0 = ev.clientX; y0 = ev.clientY; fired = false;
      try { el.setPointerCapture(pid); } catch (_) {}
      state.brakeTouch = true; syncBrake(); state.taps.brake++;
      el.classList.add('active');
      buzz(8);
    });
    el.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== pid) return;
      ev.preventDefault();
      const dx = (ev.clientX - x0) * (lefty() ? -1 : 1), dy = ev.clientY - y0;
      if (!fired) {
        if (-dy >= SLIDE_PX && -dy >= Math.abs(dx)) { fired = true; state.boostPressed = true; state.boostSource = 'slide'; state.taps.slideBoost++; }
        else if (-dx >= SLIDE_PX && -dx > Math.abs(dy)) { fired = true; state.missilePressed = true; state.missileSource = 'slide'; state.taps.slideMissile++; }
        // a slide is a boost / missile gesture, not braking: the brake lets go while the thumb is slid away
        if (fired) { state.brakeTouch = false; syncBrake(); el.classList.remove('active'); }
      } else if (Math.hypot(dx, dy) < SLIDE_PX / 2) {
        fired = false; state.brakeTouch = true; syncBrake(); el.classList.add('active'); // slid back onto BRAKE: brake again
      }
    });
    const up = (ev) => {
      if (ev.pointerId !== pid) return;
      ev.preventDefault();
      try { el.releasePointerCapture(pid); } catch (_) {}
      pid = null; release();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  /** Tap buttons fire on pointerdown (no click delay); each keeps its own pointer so it works mid-steer / mid-brake. */
  function bindTap(el, fn) {
    if (!el) return;
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      try { el.setPointerCapture(ev.pointerId); } catch (_) {}
      fn(ev.pointerType === 'touch' ? 'tap' : ev.pointerType || 'tap');
      press(el);
    });
    el.addEventListener('pointerup', (ev) => { try { el.releasePointerCapture(ev.pointerId); } catch (_) {} });
  }

  bindSteer();
  bindBrake(document.getElementById('btn-brake'));
  bindTap(document.getElementById('btn-boost'), (src) => { state.boostPressed = true; state.boostSource = src; state.taps.boost++; });
  bindTap(document.getElementById('btn-missile'), (src) => { state.missilePressed = true; state.missileSource = src; state.taps.missile++; });
  bindTap(document.getElementById('btn-power'), (src) => { state.powerPressed = true; state.powerSource = src; state.taps.power++; });
  bindTap(document.getElementById('btn-pause'), () => { state.pausePressed = true; });

  function consumeFlags() {
    syncSteer(); syncBrake();
    const out = {
      steer: state.steer,
      aimAngle: state.aimActive ? state.aimAngle : null,
      accel: state.accel,
      brake: state.brake,
      pause: state.pausePressed,
      boost: state.boostPressed, boostSource: state.boostSource,
      missile: state.missilePressed, missileSource: state.missileSource,
      power: state.powerPressed, powerSource: state.powerSource
    };
    state.pausePressed = false; state.boostPressed = false; state.missilePressed = false; state.powerPressed = false;
    return out;
  }

  /** Drop any queued boost / missile / power request (new race / resume from pause). */
  function clearBoost() { state.boostPressed = false; state.missilePressed = false; state.powerPressed = false; }

  let fadeT = 0;
  /** show: true = visible, false = hidden, 'fade' = fade out over 0.2 s then hide (v53 finish). */
  function showTouch(show) {
    const el = document.getElementById('touch-controls');
    if (!el) return;
    clearTimeout(fadeT);
    if (show === 'fade') {
      el.classList.add('fading');
      state.brakeTouch = false; syncBrake();
      fadeT = setTimeout(() => { el.classList.add('hidden'); el.classList.remove('fading'); }, 200);
      return;
    }
    el.classList.remove('fading');
    el.classList.toggle('hidden', !show);
    if (!show) { state.brakeTouch = false; syncBrake(); }
  }

  return { state, consumeFlags, clearBoost, showTouch, keys };
}
