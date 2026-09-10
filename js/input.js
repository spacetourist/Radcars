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
    right: false
  };

  const keys = new Set();

  function syncSteer() {
    state.steer = (state.right || keys.has('ArrowRight') || keys.has('d') || keys.has('D') ? 1 : 0)
      - (state.left || keys.has('ArrowLeft') || keys.has('a') || keys.has('A') ? 1 : 0);
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

  // Touch / mouse buttons
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
    // mouse emulate
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

  function bindTouchUI() {
    const root = document.getElementById('touch-controls');
    if (!root) return;
    root.querySelectorAll('[data-action]').forEach((btn) => {
      bindButton(btn, btn.getAttribute('data-action'));
    });
  }

  bindTouchUI();

  function consumeFlags() {
    const out = {
      steer: state.steer,
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
