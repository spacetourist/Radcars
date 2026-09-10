let ctx = null;
let muted = false;

export function setMuted(m) {
  muted = !!m;
}

export function isMuted() {
  return muted;
}

function ensure() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function beep(freq, dur, type = 'square', gain = 0.04, slide = 0) {
  if (muted) return;
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

export function sfx(name) {
  switch (name) {
    case 'fire': beep(420, 0.08, 'square', 0.05, -180); break;
    case 'explode': beep(90, 0.22, 'sawtooth', 0.07, -60); beep(60, 0.3, 'square', 0.04, -40); break;
    case 'hit': beep(160, 0.1, 'triangle', 0.05, -80); break;
    case 'wall': beep(110, 0.07, 'square', 0.035, -50); break;
    case 'nitro': beep(280, 0.15, 'sawtooth', 0.04, 220); break;
    case 'lap': beep(520, 0.08, 'sine', 0.04); setTimeout(() => beep(680, 0.1, 'sine', 0.04), 90); break;
    case 'finish': beep(440, 0.1, 'sine', 0.05); setTimeout(() => beep(554, 0.1, 'sine', 0.05), 100); setTimeout(() => beep(659, 0.18, 'sine', 0.06), 200); break;
    case 'buy': beep(660, 0.06, 'sine', 0.04); beep(880, 0.08, 'sine', 0.035); break;
    case 'click': beep(300, 0.04, 'square', 0.025); break;
    case 'mine': beep(200, 0.06, 'triangle', 0.04, -100); break;
    default: break;
  }
}

export function unlockAudio() {
  ensure();
}
