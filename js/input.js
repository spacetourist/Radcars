export function createInput() {
  const state = {
    steer: 0,
    accel: false,
    pausePressed: false,
    left: false,
    right: false,
    /** Absolute world heading from radial pad (radians); only while aimActive */
    aimAngle: null,
    aimActive: false,
    /** Relative steer from keys in [-1, 1] when pad inactive */
    keySteer: 0,
    /** Boost request (edge-triggered: Shift key or an upward slide that starts on GAS) */
    boostPressed: false,
    /** How the last boost request was made ('key' | 'slide'), for the HUD/debug */
    boostSource: null,
    /** Missile request (edge-triggered: Space or a left slide that starts on GAS) */
    missilePressed: false,
    missileSource: null
  };
  /** Travel (CSS px) from the GAS touch-down point that counts as a slide: up = boost, left = missile. */
  const SLIDE_PX = 40;

  const keys = new Set();

  function syncSteer() {
    if (state.aimActive && state.aimAngle != null) {
      // Radial owns heading; steer left for AI-compat only unused by physics when aim set
      state.steer = 0;
      return;
    }
    const keyR = keys.has('ArrowRight') || keys.has('d') || keys.has('D') || state.right;
    const keyL = keys.has('ArrowLeft') || keys.has('a') || keys.has('A') || state.left;
    state.keySteer = (keyR ? 1 : 0) - (keyL ? 1 : 0);
    state.steer = state.keySteer;
  }

  // Letter keys are stored lower-case so W/A/S/D release correctly while Shift (boost) is held
  const norm = (k) => (k && k.length === 1 ? k.toLowerCase() : k);

  function onKeyDown(e) {
    keys.add(norm(e.key));
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'A', 'd', 'D', 'w', 'W', ' '].includes(e.key)) {
      e.preventDefault();
    }
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') state.accel = true;
    // v48: no brake / reverse keys — lift off the gas to slow down
    if (e.key === ' ' && !e.repeat) { state.missilePressed = true; state.missileSource = 'key'; }
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (!e.repeat) state.pausePressed = true; }
    if (e.key === 'Shift' && !e.repeat) { state.boostPressed = true; state.boostSource = 'key'; }
    syncSteer();
  }

  function onKeyUp(e) {
    keys.delete(norm(e.key));
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') state.accel = keys.has('ArrowUp') || keys.has('w');
    syncSteer();
  }

  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp);

  const held = new Map();

  function bindButton(el, action) {
    if (!el) return;
    const down = (ev) => {
      ev.preventDefault();
      held.set(action, true);
      applyAction(action, true);
      el.classList.add('active');
    };
    const up = (ev) => {
      ev.preventDefault();
      held.set(action, false);
      applyAction(action, false);
      el.classList.remove('active');
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('mousedown', down);
    el.addEventListener('mouseup', up);
    el.addEventListener('mouseleave', up);
  }

  function applyAction(action, down) {
    switch (action) {
      case 'left': state.left = down; syncSteer(); break;
      case 'right': state.right = down; syncSteer(); break;
      case 'accel': state.accel = down; break;
      case 'pause':
        if (down) state.pausePressed = true;
        break;
      default: break;
    }
  }

  /**
   * Radial aim pad: angle from pad centre → world heading.
   * Camera is axis-aligned; canvas +Y is down, so atan2(dy, dx) matches car.angle
   * (0 = right / +X). Centre deadzone ignores noise; release clears aim (no spring).
   */
  function bindAimPad() {
    const root = document.getElementById('aim-pad');
    const knob = document.getElementById('aim-knob');
    if (!root || !knob) return;

    let pointerId = null;
    const DEAD = 0.18; // fraction of radius — ignore near centre

    function setKnob(nx, ny, active) {
      // nx,ny in [-1,1] pad space (y down)
      const mag = Math.hypot(nx, ny);
      const cx = mag > 1 ? nx / mag : nx;
      const cy = mag > 1 ? ny / mag : ny;
      const maxPx = root.clientWidth * 0.32;
      knob.style.transform = `translate(${cx * maxPx}px, ${cy * maxPx}px)`;
      root.classList.toggle('tc-aim-active', !!active);
      root.classList.toggle('active', !!active);
    }

    function applyFromClient(clientX, clientY) {
      const rect = root.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const r = Math.max(1, rect.width * 0.5);
      const nx = dx / r;
      const ny = dy / r;
      const mag = Math.hypot(nx, ny);
      if (mag < DEAD) {
        // Held in deadzone: keep last aim if already aiming, else idle knob
        setKnob(0, 0, state.aimActive);
        return;
      }
      // World heading matches screen atan2 (camera unrotated)
      state.aimAngle = Math.atan2(dy, dx);
      state.aimActive = true;
      setKnob(nx, ny, true);
      syncSteer();
    }

    function clearAim() {
      state.aimActive = false;
      state.aimAngle = null;
      setKnob(0, 0, false);
      syncSteer();
    }

    const onDown = (ev) => {
      ev.preventDefault();
      pointerId = ev.pointerId;
      try { root.setPointerCapture(pointerId); } catch (_) {}
      applyFromClient(ev.clientX, ev.clientY);
    };

    const onMove = (ev) => {
      if (pointerId == null || ev.pointerId !== pointerId) return;
      ev.preventDefault();
      applyFromClient(ev.clientX, ev.clientY);
    };

    const onUp = (ev) => {
      if (pointerId != null && ev.pointerId !== pointerId) return;
      ev.preventDefault();
      pointerId = null;
      try { root.releasePointerCapture(ev.pointerId); } catch (_) {}
      clearAim();
    };

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);

    setKnob(0, 0, false);
  }

  /**
   * GAS button: press-and-hold = throttle (press on, release off). Slides that start on GAS:
   *   up   ≥ SLIDE_PX → boost    (v47)
   *   left ≥ SLIDE_PX → missile  (v48)
   * The dominant axis decides, so a diagonal slide fires only one of them. One request per
   * slide: bring the thumb back near where it landed (or lift and press again) to re-arm.
   * The throttle stays held during an up/left slide even outside the button; sliding off to
   * the right or downwards releases it as before.
   */
  function bindGas(el) {
    let pid = null, startX = 0, startY = 0, fired = false, gasOn = false;
    const release = () => {
      if (gasOn) { gasOn = false; held.set('accel', false); applyAction('accel', false); }
      el.classList.remove('active');
    };
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      if (pid != null) return;
      pid = ev.pointerId; startX = ev.clientX; startY = ev.clientY; fired = false; gasOn = true;
      try { el.setPointerCapture(pid); } catch (_) {}
      held.set('accel', true);
      applyAction('accel', true);
      el.classList.add('active');
    });
    el.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== pid) return;
      ev.preventDefault();
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!fired) {
        if (-dy >= SLIDE_PX && -dy >= Math.abs(dx)) { fired = true; state.boostPressed = true; state.boostSource = 'slide'; }
        else if (-dx >= SLIDE_PX && -dx > Math.abs(dy)) { fired = true; state.missilePressed = true; state.missileSource = 'slide'; }
      } else if (Math.hypot(dx, dy) < SLIDE_PX / 2) {
        fired = false; // thumb came back: the next slide can request again
      }
      if (!gasOn) return;
      const r = el.getBoundingClientRect();
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      const upSlide = ev.clientY < r.top && ev.clientX >= r.left - 60 && ev.clientX <= r.right + 40;
      const leftSlide = ev.clientX < r.left && ev.clientY >= r.top - 60 && ev.clientY <= r.bottom + 40;
      if (!inside && !upSlide && !leftSlide) release();
    });
    const up = (ev) => {
      if (ev.pointerId !== pid) return;
      ev.preventDefault();
      try { el.releasePointerCapture(pid); } catch (_) {}
      pid = null;
      release();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function bindTouchUI() {
    const root = document.getElementById('touch-controls');
    if (!root) return;
    root.querySelectorAll('[data-action]').forEach((btn) => {
      const act = btn.getAttribute('data-action');
      if (act === 'accel') bindGas(btn);
      else bindButton(btn, act);
    });
    bindAimPad();
  }

  bindTouchUI();

  function consumeFlags() {
    syncSteer();
    const out = {
      steer: state.steer,
      aimAngle: state.aimActive ? state.aimAngle : null,
      accel: state.accel,
      pause: state.pausePressed,
      boost: state.boostPressed,
      boostSource: state.boostSource,
      missile: state.missilePressed,
      missileSource: state.missileSource
    };
    state.pausePressed = false;
    state.boostPressed = false;
    state.missilePressed = false;
    return out;
  }

  /** Drop any queued boost / missile request (new race / resume from pause). */
  function clearBoost() { state.boostPressed = false; state.missilePressed = false; }

  function showTouch(show) {
    const el = document.getElementById('touch-controls');
    if (!el) return;
    el.classList.toggle('hidden', !show);
  }

  return { state, consumeFlags, clearBoost, showTouch, keys };
}
