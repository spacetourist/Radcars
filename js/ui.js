import { TRACKS, pointAt } from './tracks.js';
import { DIFFICULTIES } from './game.js';
import { sfx, setMuted } from './audio.js';
import { persistSave } from './career.js';
import { fmtTime } from './util.js';
import { CAR_COLORS } from './cars.js';
import { CAR_STYLES, drawToy, textureTile } from './toyart.js';

/**
 * v51 'toys' menus: Callum's rainy neon city photo behind the menus (menu-only, lazily loaded), dark glass panels,
 * dark pill buttons with neon borders, a glowing italic RADCARS wordmark with a chequer underline, a parade of the
 * new toy cars, track cards with neon minimap outlines and a toy car lapping them, and a podium on the results screen.
 * Everything else is CSS + Canvas 2D (no web fonts).
 */
export function createUI(root, api) {
  const hud = document.createElement('div');
  hud.className = 'hud hidden';
  hud.id = 'hud';
  hud.innerHTML = `
    <div class="hud-left">
      <span class="pill pill-lap">LAP <strong data-h="lap">1/3</strong></span>
      <span class="pill">POS <strong data-h="pos">1/6</strong></span>
      <span class="pill pill-laptime hidden" data-h="lapflash"></span>
    </div>
    <div class="hud-right">
      <span class="pill"><strong data-h="time">0:00.00</strong></span>
    </div>`;
  document.getElementById('app').appendChild(hud);

  // Menu backdrop: Callum's rainy neon city photo. Menu-only: attached lazily after first paint (dark gradient until
  // then), never requested once a race has started, and the whole layer is display:none (animation stopped) in races.
  const bg = document.getElementById('menu-bg');
  // Landscape: dim (title) + blur (select / options / results). Portrait: Graphic Designer's portrait crops, the dim one
  // in HD (1440×2560) at devicePixelRatio ≥ 2, else 1080×1920. Only the pair for the current orientation is fetched.
  const BG = {
    l: { dim: 'assets/menu/menu-bg-city-dim.jpg', blur: 'assets/menu/menu-bg-city-blur.jpg' },
    p: { dim: 'assets/menu/menu-bg-city-portrait-dim.jpg', dimHd: 'assets/menu/menu-bg-city-portrait-dim-hd.jpg', blur: 'assets/menu/menu-bg-city-portrait-blur.jpg' }
  };
  const portraitMq = window.matchMedia ? window.matchMedia('(orientation: portrait)') : null;
  const orient = () => (portraitMq && portraitMq.matches ? 'p' : 'l');
  const bgSrc = (o, kind) => (o === 'p' && kind === 'dim' && (window.devicePixelRatio || 1) >= 2 ? BG.p.dimHd : BG[o][kind]);
  const pending = new Set();
  let bgWanted = null, bgStarted = false, bgOrient = orient();
  function loadBg(kind) {
    const o = bgOrient, src = bgSrc(o, kind);
    const img = new Image();
    img.decoding = 'async';
    pending.add(img);
    img.onload = () => {
      pending.delete(img);
      if (!bg || o !== bgOrient) return; // orientation flipped while loading
      bg.style.setProperty(kind === 'blur' ? '--bg-blur' : '--bg-dim', `url("${new URL(src, location.href).href}")`);
      bg.classList.add(kind === 'blur' ? 'blur-ready' : 'dim-ready');
    };
    img.onerror = () => pending.delete(img);
    img.src = src;
  }
  function cancelBgLoads() { for (const img of pending) { img.onload = null; img.src = ''; } pending.clear(); }
  function startBgLoads() {
    if (bgStarted || !bg) return;
    bgStarted = true;
    const first = bgWanted === 'blur' ? 'blur' : 'dim', rest = first === 'blur' ? 'dim' : 'blur';
    if (!bg.classList.contains(first + '-ready')) loadBg(first);
    setTimeout(() => { if (bgWanted && !bg.classList.contains(rest + '-ready')) loadBg(rest); }, 1200);
  }
  // rotating the phone on a menu swaps to the other orientation's photos (lazily, as above); never during a race
  if (portraitMq) {
    const onFlip = () => {
      if (orient() === bgOrient || !bg) return;
      bgOrient = orient(); cancelBgLoads(); bgStarted = false;
      bg.classList.remove('dim-ready', 'blur-ready');
      bg.style.removeProperty('--bg-dim'); bg.style.removeProperty('--bg-blur');
      if (bgWanted) startBgLoads();
    };
    if (portraitMq.addEventListener) portraitMq.addEventListener('change', onFlip); else if (portraitMq.addListener) portraitMq.addListener(onFlip);
  }
  function setBg(mode) {
    bgWanted = mode;
    if (!bg) return;
    bg.classList.toggle('on', !!mode);
    bg.classList.toggle('blur', mode === 'blur');
    if (!mode) { // race: cancel anything still downloading so nothing loads mid-race
      cancelBgLoads();
      if (!bg.classList.contains('dim-ready') || !bg.classList.contains('blur-ready')) bgStarted = false;
      return;
    }
    if (!bgStarted) requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { if (bgWanted) startBgLoads(); }, 50)));
  }

  // one shared animation loop for whatever menu canvases are on screen
  const anims = new Set();
  let rafId = 0, lastT = 0;
  function loop(t) {
    rafId = 0;
    const dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 0); lastT = t;
    for (const a of [...anims]) { if (!a.el.isConnected) { anims.delete(a); continue; } a.draw(t / 1000, dt); }
    if (anims.size && document.visibilityState !== 'hidden') rafId = requestAnimationFrame(loop);
    else lastT = 0;
  }
  function animate(el, draw) { anims.add({ el, draw }); if (!rafId) rafId = requestAnimationFrame(loop); }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && anims.size && !rafId) rafId = requestAnimationFrame(loop); });

  /** Size a canvas to its CSS box at device resolution; returns the 2D context scaled to CSS px. */
  function fitCanvas(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, cv.clientWidth), h = Math.max(1, cv.clientHeight);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h, dpr };
  }

  const clear = () => { anims.clear(); root.innerHTML = ''; setBg(null); };
  const showHud = () => hud.classList.remove('hidden');
  const hideHud = () => hud.classList.add('hidden');

  function screen(html, cls = '', bgMode = 'blur') {
    anims.clear();
    root.innerHTML = '';
    hideHud();
    setBg(bgMode);
    const el = document.createElement('div');
    el.className = 'screen ' + cls;
    el.innerHTML = html;
    root.appendChild(el);
    return el;
  }

  function bindBack(el) {
    const b = el.querySelector('[data-act=back]');
    if (b) b.onclick = () => { sfx('click'); api.onMenu('title'); };
  }

  const styleOf = (id) => CAR_STYLES[id === 0 ? 0 : 1 + ((Math.max(1, id) - 1) % (CAR_STYLES.length - 1))];

  /** Title strip: a toy road with the six-car field driving past (player cyan sports car leading). */
  function paradeCanvas(cv) {
    let asphalt = null;
    const field = [0, 1, 2, 3, 4, 5].map((id) => ({ id, st: styleOf(id), color: CAR_COLORS[id % CAR_COLORS.length], lane: id % 2 ? 1 : -1 }));
    animate(cv, (t) => {
      const { g, w, h, dpr } = fitCanvas(cv);
      if (!asphalt) asphalt = g.createPattern(textureTile('asphalt', '#2a2a32', 256, 5), 'repeat');
      g.clearRect(0, 0, w, h);
      const rh = Math.min(h - 14, 64), ry = (h - rh) / 2;
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, ry + 4, w, rh + 6);          // raised-piece shadow
      g.fillStyle = '#0b0c10'; g.fillRect(0, ry - 3, w, rh + 6);
      const kb = 6;
      for (const y of [ry, ry + rh - kb]) {
        g.fillStyle = '#e02020'; g.fillRect(0, y, w, kb);
        g.fillStyle = '#e8e8e8';
        const off = (t * 150) % 36;
        for (let x = -36 + (36 - off) % 36; x < w; x += 36) g.fillRect(x, y, 18, kb);
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, y === ry ? y + kb - 1.5 : y, w, 1.5);
      }
      g.fillStyle = asphalt; g.fillRect(0, ry + kb, w, rh - kb * 2);
      g.fillStyle = 'rgba(255,255,255,0.16)';
      for (let x = -((t * 150) % 70); x < w; x += 70) g.fillRect(x, ry + rh / 2 - 1.5, 30, 3);
      // cars: world scrolls left at 150 px/s; cars move right at their own pace, wrapping around
      const s = Math.min(1, (rh * 0.36) / 30), span = w + 160;
      field.forEach((c, i) => {
        const x = ((i * span) / field.length + t * 70) % span - 80;
        drawToy(g, c.st, c.color, c.id === 0, x, ry + rh / 2 + c.lane * rh * 0.2, 0, s, dpr);
      });
    });
  }

  function showTitle() {
    const el = screen(`
      <div class="title-hero">
        <div class="toybox-badge">MICRO TABLETOP RACERS</div>
        <h1 class="logo-title"><span>Rad</span><span>cars</span></h1>
        <p class="tagline">Top-down arcade racing</p>
      </div>
      <canvas class="parade" aria-hidden="true"></canvas>
      <div class="menu-btns">
        <button class="btn primary" data-act="race">Race</button>
        <button class="btn blue" data-act="options">Options</button>
      </div>
      <div class="build-row">
        <span class="build-tag" id="build-tag">${(self.RADCARS_BUILD && self.RADCARS_BUILD.label) || 'dev'}</span>
        <button class="btn btn-mini" id="hard-refresh" title="Clear the offline cache and reload the latest version">Update / hard refresh</button>
      </div>`, 'title-screen', 'dim');
    el.querySelector('#hard-refresh').onclick = (e) => { e.currentTarget.disabled = true; e.currentTarget.textContent = 'Updating…'; api.onHardRefresh && api.onHardRefresh(); };
    el.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => { sfx('click'); api.onMenu(b.dataset.act); };
    });
    paradeCanvas(el.querySelector('.parade'));
  }

  /** Track card preview: the layout as a neon minimap outline on dark glass, with a toy car lapping it. */
  function trackPreview(cv, t, idx) {
    let base = null, key = '';
    const b = t.bounds;
    animate(cv, (time) => {
      const { g, w, h, dpr } = fitCanvas(cv);
      const pad = 12, sc = Math.min((w - pad * 2) / (b.maxX - b.minX), (h - pad * 2) / (b.maxY - b.minY));
      const ox = (w - (b.maxX - b.minX) * sc) / 2 - b.minX * sc, oy = (h - (b.maxY - b.minY) * sc) / 2 - b.minY * sc;
      const k = `${w}x${h}@${dpr}`;
      if (!base || key !== k) {
        key = k;
        base = document.createElement('canvas'); base.width = Math.round(w * dpr); base.height = Math.round(h * dpr);
        const q = base.getContext('2d');
        q.setTransform(dpr, 0, 0, dpr, 0, 0);
        q.fillStyle = 'rgba(4,4,10,0.55)'; q.fillRect(0, 0, w, h);
        const path = new Path2D();
        t.pts.forEach((p, i) => (i ? path.lineTo(p.x * sc + ox, p.y * sc + oy) : path.moveTo(p.x * sc + ox, p.y * sc + oy)));
        path.closePath();
        const rw = Math.max(7, t.halfW * 2 * sc);
        q.lineJoin = 'round'; q.lineCap = 'round';
        // neon minimap outline: wide low-alpha glow strokes under a dark road with bright edge lines (no shadowBlur)
        q.strokeStyle = t.wall;
        q.globalAlpha = 0.12; q.lineWidth = rw + 14; q.stroke(path);
        q.globalAlpha = 0.22; q.lineWidth = rw + 7; q.stroke(path);
        q.globalAlpha = 1; q.lineWidth = rw + 3; q.stroke(path);
        q.strokeStyle = '#2a2a32'; q.lineWidth = rw - 1; q.stroke(path);
        q.setLineDash([3, 4]); q.strokeStyle = 'rgba(255,255,255,0.22)'; q.lineWidth = 1; q.stroke(path); q.setLineDash([]);
        // start / finish checker
        const p0 = pointAt(t, 0), a0 = Math.atan2(p0.ty, p0.tx);
        q.save(); q.translate(p0.x * sc + ox, p0.y * sc + oy); q.rotate(a0);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) { q.fillStyle = (r + c) % 2 ? '#111' : '#fff'; q.fillRect(-2 + c * 2, -rw / 2 + (r * rw) / 4, 2, rw / 4); }
        q.restore();
      }
      g.drawImage(base, 0, 0, w, h);
      // a little toy car lapping the preview (one lap ≈ 9 s)
      const s0 = ((time / 9) % 1) * t.length, p = pointAt(t, s0);
      drawToy(g, CAR_STYLES[0], CAR_COLORS[0], false, p.x * sc + ox, p.y * sc + oy, Math.atan2(p.ty, p.tx), Math.max(0.24, Math.min(0.42, t.halfW * 2 * sc / 30)), dpr);
    });
  }

  function showTrackSelect(save) {
    const o = save.options;
    const el = screen(`
      <h1>Pick a track</h1>
      <p class="tagline">${DIFFICULTIES[o.difficulty].label} · ${o.laps} laps · ${o.aiCount} rivals</p>
      <div class="track-grid" id="tracks"></div>
      <div class="row foot-row"><button class="btn grey" data-act="back">Back</button></div>`, 'select-screen');
    const grid = el.querySelector('#tracks');
    TRACKS.forEach((t, i) => {
      const card = document.createElement('div');
      card.className = 'card track-pick';
      card.style.setProperty('--accent', t.wall);
      const best = save.bestLaps[t.id];
      card.innerHTML = `
        <canvas class="track-preview" aria-hidden="true"></canvas>
        <h3>${t.name}</h3>
        <p class="stars" aria-label="Difficulty ${t.difficulty} of 3">${'★'.repeat(t.difficulty)}<span>${'★'.repeat(3 - t.difficulty)}</span></p>
        <p class="stat">Best lap <b>${fmtTime(best)}</b></p>
        <button class="btn primary" data-i="${i}">Race</button>`;
      card.querySelector('button').onclick = () => { sfx('click'); api.onStartRace(i); };
      card.querySelector('canvas').onclick = () => card.querySelector('button').click();
      grid.appendChild(card);
      trackPreview(card.querySelector('canvas'), t, i);
    });
    bindBack(el);
  }

  function showOptions(save) {
    const o = save.options;
    const stepper = (k, val) => `<div class="stepper"><button class="btn round" data-k="${k}" data-d="-1" aria-label="less">−</button>
          <span class="val">${val}</span>
          <button class="btn round" data-k="${k}" data-d="1" aria-label="more">+</button></div>`;
    const el = screen(`
      <h1>Options</h1>
      <div class="opt-wrap">
        <div class="card opt-card">
          <div class="opt-row"><strong>Sound</strong>
            <button class="btn toggle ${save.mute ? '' : 'on'}" id="mute">${save.mute ? 'Off' : 'On'}</button></div>
          <div class="opt-row"><strong>AI difficulty</strong>${stepper('difficulty', DIFFICULTIES[o.difficulty].label)}</div>
          <div class="opt-row"><strong>AI rivals <span class="muted">1–7</span></strong>${stepper('aiCount', o.aiCount)}</div>
          <div class="opt-row"><strong>Laps <span class="muted">1–10</span></strong>${stepper('laps', o.laps)}</div>
        </div>
        <div class="card help-card">
          <h3>How to drive</h3>
          <p><b>Keyboard</b> ↑/W accelerate (lift off to slow) · ←→/AD steer · Shift boost · Space missile · E power-up · P pause</p>
          <p><b>Touch</b> drag the ring to point the car · hold GAS · slide up from GAS to boost · slide left from GAS to fire a missile · tap POWER to use a power-up</p>
          <p>Chevron pads give any car a free 0.5 s boost · drive through a <b>?</b> box for a power-up (rocket, lap boost, autopilot)</p>
        </div>
      </div>
      <div class="row foot-row"><button class="btn grey" data-act="back">Back</button></div>`, 'options-screen');
    const lim = { difficulty: [0, DIFFICULTIES.length - 1], aiCount: [1, 7], laps: [1, 10] };
    el.querySelectorAll('[data-k]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.k;
        o[k] = Math.max(lim[k][0], Math.min(lim[k][1], o[k] + Number(b.dataset.d)));
        persistSave(save);
        sfx('click');
        showOptions(save);
      };
    });
    el.querySelector('#mute').onclick = () => {
      save.mute = !save.mute;
      setMuted(save.mute);
      persistSave(save);
      sfx('click');
      showOptions(save);
    };
    bindBack(el);
  }

  let lastKey = '';
  function updateHud(info) {
    showHud();
    const lap = `${info.lap}/${info.totalLaps}`;
    const pos = `${info.place}/${info.total}`;
    const time = fmtTime(info.timeMs || 1).replace('—', '0:00.00');
    const flash = info.lapFlashMs > 0 ? `LAST ${fmtTime(info.lapFlashLast)} · BEST ${fmtTime(info.lapFlashBest)}` : '';
    const key = [lap, pos, time, flash].join('|');
    if (key === lastKey) return;
    lastKey = key;
    hud.querySelector('[data-h=lap]').textContent = lap;
    hud.querySelector('[data-h=pos]').textContent = pos;
    hud.querySelector('[data-h=time]').textContent = time;
    const f = hud.querySelector('[data-h=lapflash]');
    f.textContent = flash;
    f.classList.toggle('hidden', !flash);
    f.classList.toggle('lap-flash', !!flash);
  }

  function showPause(onResume, onQuit) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.id = 'pause-ov';
    ov.innerHTML = `
      <div class="screen pause-screen">
        <h1>Paused</h1>
        <div class="menu-btns">
          <button class="btn primary" id="resume">Resume</button>
          <button class="btn danger" id="quit">Quit</button>
        </div>
      </div>`;
    document.getElementById('app').appendChild(ov);
    ov.querySelector('#resume').onclick = () => { ov.remove(); sfx('click'); onResume(); };
    ov.querySelector('#quit').onclick = () => { ov.remove(); sfx('click'); onQuit(); };
  }

  /** Podium: the top three toy cars on gold / silver / bronze plastic blocks. */
  function podiumCanvas(cv, top) {
    let drawn = '';
    animate(cv, (time) => {
      const { g, w, h, dpr } = fitCanvas(cv);
      g.clearRect(0, 0, w, h);
      const bw = Math.min(110, w / 3.4), gap = Math.min(14, bw * 0.12), cx = w / 2, baseY = h - 4;
      const blocks = [
        { p: top[1], x: cx - bw - gap, hgt: h * 0.34, col: ['#e9edf3', '#9ea7b5'], n: '2' },
        { p: top[0], x: cx, hgt: h * 0.48, col: ['#ffe36b', '#d79a12'], n: '1' },
        { p: top[2], x: cx + bw + gap, hgt: h * 0.26, col: ['#f0b07a', '#a8602c'], n: '3' }
      ];
      for (const b of blocks) {
        if (!b.p) continue;
        const x0 = b.x - bw / 2, y0 = baseY - b.hgt;
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0 + 5, y0 + 7, bw, b.hgt - 3);
        const lg = g.createLinearGradient(0, y0, 0, baseY); lg.addColorStop(0, b.col[0]); lg.addColorStop(1, b.col[1]);
        g.fillStyle = lg; g.beginPath(); g.roundRect ? g.roundRect(x0, y0, bw, b.hgt, [10, 10, 4, 4]) : g.rect(x0, y0, bw, b.hgt); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(x0 + 6, y0 + 4, bw - 12, 3);
        g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,0.45)'; g.stroke();
        g.fillStyle = 'rgba(0,0,0,0.55)'; g.font = `900 ${Math.round(Math.min(b.hgt * 0.5, bw * 0.45))}px "Arial Rounded MT Bold", "Arial Black", Roboto, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(b.n, b.x, y0 + b.hgt * 0.56);
        const bob = b.n === '1' ? Math.sin(time * 3) * 2 : 0;
        const s = Math.min(1.25, bw / 64 * 0.95);
        drawToy(g, styleOf(b.p.id ?? (b.p.isPlayer ? 0 : 1)), b.p.color, b.p.isPlayer, b.x, y0 - 20 * s + bob, -Math.PI / 2 + 0.0001, s, dpr);
        g.fillStyle = b.p.isPlayer ? '#00e8ff' : '#fff'; g.font = `900 ${Math.round(Math.max(11, bw * 0.13))}px "Arial Rounded MT Bold", "Arial Black", Roboto, sans-serif`;
        g.textBaseline = 'bottom'; g.fillText(b.p.isPlayer ? 'YOU' : b.p.name.toUpperCase(), b.x, Math.max(Math.round(Math.max(11, bw * 0.13)) + 2, y0 - 20 * s + bob - 34 * s - 4)); // above the car's nose
      }
      drawn = 'y';
    });
    return drawn;
  }

  function showResults(result, onDone) {
    const rows = result.standings.map((s) => `
      <div class="res-row ${s.isPlayer ? 'me' : ''}"><span class="place p${s.place}">${s.place}</span><span class="swatch" style="background:${s.color}"></span>
      <span class="who">${s.isPlayer ? '<strong>You</strong>' : s.name}</span>
      <span class="stat">${s.dnf ? 'DNF' : fmtTime(s.finishTime)} · best ${fmtTime(s.bestLapMs)}</span></div>`).join('');
    const el = screen(`
      <h1>${result.playerPlace === 1 ? 'You win!' : 'Race Over'}</h1>
      <p class="tagline">${result.trackName} · You finished P${result.playerPlace}</p>
      <div class="results-wrap">
        <canvas class="podium" aria-hidden="true"></canvas>
        <div class="card" id="results">${rows}</div>
      </div>
      <div class="row foot-row">
        <button class="btn primary" id="again">Race again</button>
        <button class="btn grey" id="title">Menu</button>
      </div>`, 'results-screen');
    el.querySelector('#again').onclick = () => { sfx('click'); onDone('again'); };
    el.querySelector('#title').onclick = () => { sfx('click'); onDone('title'); };
    podiumCanvas(el.querySelector('.podium'), result.standings.slice(0, 3));
  }

  return { showTitle, showTrackSelect, showOptions, updateHud, hideHud, showPause, showResults, clear };
}
