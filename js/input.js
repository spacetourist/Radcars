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
    /** Continuous steer from slider / keys in [-1, 1] */
    sliderSteer: 0,
    sliderActive: false
  };

  const keys = new Set();

  function syncSteer() {
    // Keyboard / leftover left-right still work; slider overrides while dragged
    if (state.sliderActive) {
      state.steer = state.sliderSteer;
      return;
    }
    const keyR = keys.has('ArrowRight') || keys.has('d') || keys.has('D') || state.right;
    const keyL = keys.has('ArrowLeft') || keys.has('a') || keys.has('A') || state.left;
    state.steer = (keyR ? 1 : 0) - (keyL ? 1 : 0);
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

  function bindSteerSlider() {
    const root = document.getElementById('steer-slider');
    const thumb = document.getElementById('steer-thumb');
    if (!root || !thumb) return;

    let pointerId = null;
    let springRaf = 0;

    /** Map raw slider [-1,1] → gameplay steer with deadzone + ease-in.
     *  Thumb follows finger (raw); only the value sent to physics is shaped.
     *  Deadzone ~0.18, cubic ease-in (t³), max scale 0.32 vs keyboard. */
    function curveSteer(raw) {
      const DZ = 0.18;
      const MAX = 0.32;
      const a = Math.abs(raw);
      if (a < DZ) return 0;
      const t = (a - DZ) / (1 - DZ); // 0..1 past deadzone
      const shaped = t * t * t;      // cubic ease-in near centre
      return Math.sign(raw) * shaped * MAX;
    }

    function setThumb(norm) {
      // norm in [-1, 1] — visual / spring uses raw; gameplay uses curve
      const n = Math.max(-1, Math.min(1, norm));
      state.sliderSteer = curveSteer(n);
      state._sliderRaw = n;
      syncSteer();
      const pct = (n + 1) * 50; // 0..100
      thumb.style.left = pct + '%';
      root.classList.toggle('tc-steer-active', Math.abs(n) > 0.02);
    }

    function normFromClientX(clientX) {
      const rect = root.getBoundingClientRect();
      const pad = 32; // thumb radius-ish (matches wider thumb)
      const x = clientX - rect.left;
      const t = (x - pad) / Math.max(1, rect.width - pad * 2);
      return Math.max(-1, Math.min(1, t * 2 - 1));
    }

    function cancelSpring() {
      if (springRaf) {
        cancelAnimationFrame(springRaf);
        springRaf = 0;
      }
    }

    function springToCentre() {
      cancelSpring();
      const step = () => {
        const v = state._sliderRaw ?? 0;
        if (Math.abs(v) < 0.02) {
          setThumb(0);
          state.sliderActive = false;
          syncSteer();
          springRaf = 0;
          return;
        }
        setThumb(v * 0.72);
        springRaf = requestAnimationFrame(step);
      };
      springRaf = requestAnimationFrame(step);
    }

    const onDown = (ev) => {
      ev.preventDefault();
      cancelSpring();
      state.sliderActive = true;
      pointerId = ev.pointerId;
      try { root.setPointerCapture(pointerId); } catch (_) {}
      setThumb(normFromClientX(ev.clientX));
      root.classList.add('active');
    };

    const onMove = (ev) => {
      if (!state.sliderActive) return;
      if (pointerId != null && ev.pointerId !== pointerId) return;
      ev.preventDefault();
      setThumb(normFromClientX(ev.clientX));
    };

    const onUp = (ev) => {
      if (pointerId != null && ev.pointerId !== pointerId) return;
      ev.preventDefault();
      pointerId = null;
      root.classList.remove('active');
      try { root.releasePointerCapture(ev.pointerId); } catch (_) {}
      springToCentre();
    };

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
    // Mouse desktop testing (in case pointer events partial)
    root.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      cancelSpring();
      state.sliderActive = true;
      setThumb(normFromClientX(ev.clientX));
      root.classList.add('active');
      const move = (e) => { e.preventDefault(); setThumb(normFromClientX(e.clientX)); };
      const up = (e) => {
        e.preventDefault();
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        root.classList.remove('active');
        springToCentre();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });

    setThumb(0);
  }

  function bindTouchUI() {
    const root = document.getElementById('touch-controls');
    if (!root) return;
    root.querySelectorAll('[data-action]').forEach((btn) => {
      bindButton(btn, btn.getAttribute('data-action'));
    });
    bindSteerSlider();
  }

  bindTouchUI();

  function consumeFlags() {
    syncSteer();
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
