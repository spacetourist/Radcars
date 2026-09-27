import { TRACKS } from './tracks.js';
import { DIFFICULTIES } from './game.js';
import { sfx, setMuted } from './audio.js';
import { persistSave } from './career.js';
import { fmtTime } from './util.js';

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

  const clear = () => { root.innerHTML = ''; };
  const showHud = () => hud.classList.remove('hidden');
  const hideHud = () => hud.classList.add('hidden');

  function screen(html) {
    clear();
    hideHud();
    const el = document.createElement('div');
    el.className = 'screen';
    el.innerHTML = html;
    root.appendChild(el);
    return el;
  }

  function bindBack(el) {
    const b = el.querySelector('[data-act=back]');
    if (b) b.onclick = () => { sfx('click'); api.onMenu('title'); };
  }

  function showTitle() {
    const el = screen(`
      <div class="title-hero">
        <h1 class="logo-title">Radcars</h1>
        <p class="tagline">Top-down arcade racing</p>
      </div>
      <div class="menu-btns">
        <button class="btn primary" data-act="race">Race</button>
        <button class="btn" data-act="options">Options</button>
      </div>`);
    el.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => { sfx('click'); api.onMenu(b.dataset.act); };
    });
  }

  function showTrackSelect(save) {
    const o = save.options;
    const el = screen(`
      <h1>Pick a track</h1>
      <p class="tagline">${DIFFICULTIES[o.difficulty].label} · ${o.laps} laps · ${o.aiCount} rivals</p>
      <div class="grid2" id="tracks"></div>
      <div class="row" style="margin-top:14px"><button class="btn" data-act="back">Back</button></div>`);
    const grid = el.querySelector('#tracks');
    TRACKS.forEach((t, i) => {
      const card = document.createElement('div');
      card.className = 'card track-pick';
      card.style.borderColor = t.wall;
      const best = save.bestLaps[t.id];
      card.innerHTML = `
        <h3>${t.name}</h3>
        <p>Difficulty ${'★'.repeat(t.difficulty)}${'☆'.repeat(3 - t.difficulty)}</p>
        <p class="stat">Best lap ${fmtTime(best)}</p>
        <button class="btn primary" data-i="${i}">Race</button>`;
      card.querySelector('button').onclick = () => { sfx('click'); api.onStartRace(i); };
      grid.appendChild(card);
    });
    bindBack(el);
  }

  function showOptions(save) {
    const o = save.options;
    const el = screen(`
      <h1>Options</h1>
      <div class="card">
        <div class="shop-item"><div class="info"><strong>Sound</strong></div>
          <button class="btn" id="mute">${save.mute ? 'Off' : 'On'}</button></div>
        <div class="shop-item"><div class="info"><strong>AI difficulty</strong></div>
          <div class="row"><button class="btn" data-k="difficulty" data-d="-1">−</button>
          <span class="stat">${DIFFICULTIES[o.difficulty].label}</span>
          <button class="btn" data-k="difficulty" data-d="1">+</button></div></div>
        <div class="shop-item"><div class="info"><strong>AI rivals</strong><br/><span class="muted">1–7</span></div>
          <div class="row"><button class="btn" data-k="aiCount" data-d="-1">−</button>
          <span class="stat">${o.aiCount}</span>
          <button class="btn" data-k="aiCount" data-d="1">+</button></div></div>
        <div class="shop-item"><div class="info"><strong>Laps</strong><br/><span class="muted">1–10</span></div>
          <div class="row"><button class="btn" data-k="laps" data-d="-1">−</button>
          <span class="stat">${o.laps}</span>
          <button class="btn" data-k="laps" data-d="1">+</button></div></div>
      </div>
      <p class="muted" style="margin-top:12px;text-align:center">
        Keyboard: ↑/W accelerate · ↓/S brake/reverse · ←→/AD steer · Shift boost · P pause<br/>
        Touch: drag the ring to point the car · GAS / BRK buttons · slide up from GAS to boost
      </p>
      <div class="row" style="margin-top:14px"><button class="btn" data-act="back">Back</button></div>`);
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
      <div class="screen">
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

  function showResults(result, onDone) {
    const rows = result.standings.map((s) => `
      <div class="shop-item"><div class="info"><span style="color:${s.color}">■</span> ${s.place}. ${s.isPlayer ? '<strong>You</strong>' : s.name}</div>
      <div class="stat">${s.dnf ? 'DNF' : fmtTime(s.finishTime)} · best ${fmtTime(s.bestLapMs)}</div></div>`).join('');
    const el = screen(`
      <h1>Race Over</h1>
      <p class="tagline">${result.trackName} · You finished P${result.playerPlace}</p>
      <div class="card" id="results">${rows}</div>
      <div class="row" style="margin-top:14px">
        <button class="btn primary" id="again">Race again</button>
        <button class="btn" id="title">Menu</button>
      </div>`);
    el.querySelector('#again').onclick = () => { sfx('click'); onDone('again'); };
    el.querySelector('#title').onclick = () => { sfx('click'); onDone('title'); };
  }

  return { showTitle, showTrackSelect, showOptions, updateHud, hideHud, showPause, showResults, clear };
}
