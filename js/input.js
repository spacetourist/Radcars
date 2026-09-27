export function createInput() {
  const state = {
    steer: 0,
    accel: false,
    brake: false,
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
    boostSource: null
  };
  /** Upward travel (CSS px) from the GAS touch-down point that counts as a boost slide. */
  const BOOST_SLIDE_PX = 40;

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
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'A', 'd', 'D', 'w', 'W', 's', 'S'].includes(e.key)) {
      e.preventDefault();
    }
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') state.accel = true;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') state.brake = true;
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (!e.repeat) state.pausePressed = true; }
    if (e.key === 'Shift' && !e.repeat) { state.boostPressed = true; state.boostSource = 'key'; }
    syncSteer();
  }

  function onKeyUp(e) {
    keys.delete(norm(e.key));
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') state.accel = keys.has('ArrowUp') || keys.has('w') || keys.has('W');
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') state.brake = keys.has('ArrowDown') || keys.has('s') || keys.has('S');
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
      case 'brake': state.brake = down; break;
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
   * GAS button: press-and-hold = throttle, exactly as before (press on, release off,
   * sliding off the button sideways/down releases it). New in v47: sliding the finger
   * UP by BOOST_SLIDE_PX or more from where it landed requests a boost; the throttle stays
   * held while the finger is in that upward slide, even if it leaves the top of the button.
   * One request per slide: bring the thumb back down (or lift and press again) to re-arm.
   */
  function bindGas(el) {
    let pid = null, startY = 0, slid = false, gasOn = false;
    const release = () => {
      if (gasOn) { gasOn = false; held.set('accel', false); applyAction('accel', false); }
      el.classList.remove('active');
    };
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      if (pid != null) return;
      pid = ev.pointerId; startY = ev.clientY; slid = false; gasOn = true;
      try { el.setPointerCapture(pid); } catch (_) {}
      held.set('accel', true);
      applyAction('accel', true);
      el.classList.add('active');
    });
    el.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== pid) return;
      ev.preventDefault();
      const dy = ev.clientY - startY;
      if (!slid && dy <= -BOOST_SLIDE_PX) {
        slid = true;
        state.boostPressed = true;
        state.boostSource = 'slide';
      } else if (slid && dy > -BOOST_SLIDE_PX / 2) {
        slid = false; // thumb came back down: the next upward slide can request again
      }
      if (!gasOn) return;
      // keep the old "slide off the button releases gas" behaviour, except for the upward boost slide
      const r = el.getBoundingClientRect();
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      const upSlide = ev.clientY < r.top && ev.clientX >= r.left - 40 && ev.clientX <= r.right + 40;
      if (!inside && !upSlide) release();
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
      brake: state.brake,
      pause: state.pausePressed,
      boost: state.boostPressed,
      boostSource: state.boostSource
    };
    state.pausePressed = false;
    state.boostPressed = false;
    return out;
  }

  /** Drop any queued boost request (new race / resume from pause). */
  function clearBoost() { state.boostPressed = false; }

  function showTouch(show) {
    const el = document.getElementById('touch-controls');
    if (!el) return;
    el.classList.toggle('hidden', !show);
  }

  return { state, consumeFlags, clearBoost, showTouch, keys };
}
