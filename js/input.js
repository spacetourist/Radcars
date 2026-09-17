export function createInput() {
  const state = {
    steer: 0,
    accel: false,
    brake: false,
    fire: false,
    firePressed: false,
    nitro: false,
    nitroPressed: false,
    pausePressed: false,
    weaponCycle: 0,
    left: false,
    right: false,
    /** Absolute world heading from radial pad (radians); only while aimActive */
    aimAngle: null,
    aimActive: false,
    /** Relative steer from keys in [-1, 1] when pad inactive */
    keySteer: 0
  };

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

  function onKeyDown(e) {
    keys.add(e.key);
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'a', 'A', 'd', 'D', 'w', 'W', 's', 'S'].includes(e.key)) {
      e.preventDefault();
    }
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') state.accel = true;
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') state.brake = true;
    if (e.key === ' ' || e.key === 'Enter') { if (!e.repeat) state.firePressed = true; state.fire = true; }
    if (e.key === 'n' || e.key === 'N' || e.key === 'Shift') { if (!e.repeat) state.nitroPressed = true; }
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (!e.repeat) state.pausePressed = true; }
    if (e.key === 'q' || e.key === 'Q') state.weaponCycle = -1;
    if (e.key === 'e' || e.key === 'E') state.weaponCycle = 1;
    syncSteer();
  }

  function onKeyUp(e) {
    keys.delete(e.key);
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') state.accel = keys.has('ArrowUp') || keys.has('w') || keys.has('W');
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') state.brake = keys.has('ArrowDown') || keys.has('s') || keys.has('S');
    if (e.key === ' ' || e.key === 'Enter') state.fire = false;
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
      case 'fire':
        state.fire = down;
        if (down) state.firePressed = true;
        break;
      case 'nitro':
        if (down) state.nitroPressed = true;
        break;
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

  function bindTouchUI() {
    const root = document.getElementById('touch-controls');
    if (!root) return;
    root.querySelectorAll('[data-action]').forEach((btn) => {
      bindButton(btn, btn.getAttribute('data-action'));
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
      fire: state.firePressed,
      nitro: state.nitroPressed,
      pause: state.pausePressed,
      weaponCycle: state.weaponCycle
    };
    state.firePressed = false;
    state.nitroPressed = false;
    state.pausePressed = false;
    state.weaponCycle = 0;
    return out;
  }

  function showTouch(show) {
    const el = document.getElementById('touch-controls');
    if (!el) return;
    el.classList.toggle('hidden', !show);
  }

  return { state, consumeFlags, showTouch, keys };
}
