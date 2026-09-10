import { TRACKS } from './tracks.js';
import { SHOP_ITEMS, buyItem, priceOf, formatMoney } from './shop.js';
import { WEAPON_LABELS } from './weapons.js';
import { sfx, setMuted, isMuted } from './audio.js';
import { persistSave, resetSave } from './career.js';
import { hpColor } from './util.js';

export function createUI(root, api) {
  const hud = document.createElement('div');
  hud.className = 'hud hidden';
  hud.id = 'hud';
  document.getElementById('app').appendChild(hud);

  function clear() {
    root.innerHTML = '';
  }

  function showTitle(save) {
    clear();
    hideHud();
    const el = document.createElement('div');
    el.className = 'screen';
    el.innerHTML = `
      <div class="title-logo"><span class="sub">Combat Circuit</span></div>
      <h1>Radcars</h1>
      <p class="tagline">90s arcade soul · HD remaster clarity · original brand</p>
      <div class="menu-btns">
        <button class="btn primary" data-act="career">Career</button>
        <button class="btn" data-act="single">Single Race</button>
        <button class="btn" data-act="garage">Garage / Shop</button>
        <button class="btn" data-act="options">Options</button>
      </div>
      <p class="muted" style="text-align:center;margin-top:14px">
        Cash: <span class="cash">${formatMoney(save.cash)}</span>
        · Circuit ${Math.min(save.careerTrack + 1, TRACKS.length)}/${TRACKS.length}
        · Wins ${save.careerWins}
      </p>
    `;
    root.appendChild(el);
    el.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => { sfx('click'); api.onMenu(b.dataset.act); };
    });
  }

  function showTrackSelect(save, mode) {
    clear();
    hideHud();
    const el = document.createElement('div');
    el.className = 'screen';
    const unlocked = mode === 'career' ? Math.min(save.unlockedTracks, TRACKS.length) : TRACKS.length;
    el.innerHTML = `
      <h1>${mode === 'career' ? 'Career' : 'Single Race'}</h1>
      <p class="tagline">Pick a circuit · ${save.options.laps} laps · ${save.options.aiCount} rivals</p>
      <div class="grid2" id="tracks"></div>
      <div class="row" style="margin-top:14px">
        <button class="btn" data-act="back">Back</button>
      </div>
    `;
    root.appendChild(el);
    const grid = el.querySelector('#tracks');
    TRACKS.forEach((t, i) => {
      const locked = i >= unlocked;
      const card = document.createElement('div');
      card.className = 'card track-pick';
      card.style.borderColor = t.wall;
      card.innerHTML = `
        <h3>${t.name} ${locked ? '🔒' : ''}</h3>
        <p>Difficulty ${'★'.repeat(t.difficulty)}${'☆'.repeat(3 - t.difficulty)}</p>
        <p class="stat">Geometric circuit · weapons enabled</p>
        <button class="btn primary" ${locked ? 'disabled' : ''} data-i="${i}">Race</button>
      `;
      grid.appendChild(card);
      const btn = card.querySelector('button');
      if (!locked) btn.onclick = () => { sfx('click'); api.onStartRace(i, mode); };
    });
    el.querySelector('[data-act=back]').onclick = () => { sfx('click'); api.onMenu('title'); };
  }

  function showGarage(save) {
    clear();
    hideHud();
    const c = save.car;
    const el = document.createElement('div');
    el.className = 'screen';
    el.innerHTML = `
      <h1>Garage</h1>
      <p class="tagline">Cash: <span class="cash">${formatMoney(save.cash)}</span>
        · HP <span style="color:${hpColor(c.hp, c.maxHp)}">${Math.round(c.hp)}/${c.maxHp}</span>
        · Eng ${c.engine} · Arm ${c.armour} · Ram ${c.ram} · N2O ${c.nitro}/${c.nitroMax}
      </p>
      <div class="card" style="margin-bottom:10px">
        <h3>Loadout</h3>
        <p class="stat">Front ${c.weapons.front} · Rear ${c.weapons.rear} · Homing ${c.weapons.homing} · Mine ${c.weapons.mine} · Super ${c.weapons.super}</p>
        <p class="stat">Selected: ${WEAPON_LABELS[c.selectedWeapon] || c.selectedWeapon}</p>
        <div class="row" style="margin-top:8px" id="wsel"></div>
      </div>
      <div class="card" id="shop"></div>
      <div class="row" style="margin-top:14px">
        <button class="btn" data-act="back">Back</button>
      </div>
    `;
    root.appendChild(el);
    const wsel = el.querySelector('#wsel');
    Object.keys(WEAPON_LABELS).forEach((k) => {
      const b = document.createElement('button');
      b.className = 'btn' + (c.selectedWeapon === k ? ' primary' : '');
      b.textContent = WEAPON_LABELS[k];
      b.onclick = () => {
        save.car.selectedWeapon = k;
        persistSave(save);
        sfx('click');
        showGarage(save);
      };
      wsel.appendChild(b);
    });
    const shop = el.querySelector('#shop');
    shop.innerHTML = '<h3>Shop</h3>';
    SHOP_ITEMS.forEach((item) => {
      const price = priceOf(item, save);
      const row = document.createElement('div');
      row.className = 'shop-item';
      const lvl = item.level ? ` (Lv ${item.level(save)}${item.max != null ? '/' + item.max : ''})` : '';
      row.innerHTML = `
        <div class="info"><strong>${item.name}${lvl}</strong><br/><span class="muted">${item.desc}</span></div>
        <div class="price">${formatMoney(price)}</div>
      `;
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'Buy';
      btn.disabled = !item.can(save) || save.cash < price;
      btn.onclick = () => {
        const r = buyItem(save, item.id);
        if (r.ok) showGarage(save);
        else sfx('click');
      };
      row.appendChild(btn);
      shop.appendChild(row);
    });
    el.querySelector('[data-act=back]').onclick = () => { sfx('click'); api.onMenu('title'); };
  }

  function showOptions(save) {
    clear();
    hideHud();
    const el = document.createElement('div');
    el.className = 'screen';
    el.innerHTML = `
      <h1>Options</h1>
      <div class="card">
        <div class="shop-item">
          <div class="info"><strong>Mute SFX</strong></div>
          <button class="btn" id="mute">${save.mute ? 'Unmute' : 'Mute'}</button>
        </div>
        <div class="shop-item">
          <div class="info"><strong>AI rivals</strong><br/><span class="muted">3–7</span></div>
          <div class="row">
            <button class="btn" id="ai-dec">−</button>
            <span class="stat" id="ai-v">${save.options.aiCount}</span>
            <button class="btn" id="ai-inc">+</button>
          </div>
        </div>
        <div class="shop-item">
          <div class="info"><strong>Laps</strong></div>
          <div class="row">
            <button class="btn" id="lap-dec">−</button>
            <span class="stat" id="lap-v">${save.options.laps}</span>
            <button class="btn" id="lap-inc">+</button>
          </div>
        </div>
        <div class="shop-item">
          <div class="info"><strong>Reset career save</strong></div>
          <button class="btn danger" id="reset">Reset</button>
        </div>
      </div>
      <p class="muted" style="margin-top:12px;text-align:center">
        Desktop: Arrows/WASD drive · Space fire · N nitro · Q/E weapon · P pause<br/>
        Mobile: on-screen hold buttons (landscape)
      </p>
      <div class="row" style="margin-top:14px"><button class="btn" data-act="back">Back</button></div>
    `;
    root.appendChild(el);
    el.querySelector('#mute').onclick = () => {
      save.mute = !save.mute;
      setMuted(save.mute);
      persistSave(save);
      sfx('click');
      showOptions(save);
    };
    el.querySelector('#ai-dec').onclick = () => { save.options.aiCount = Math.max(3, save.options.aiCount - 1); persistSave(save); showOptions(save); };
    el.querySelector('#ai-inc').onclick = () => { save.options.aiCount = Math.min(7, save.options.aiCount + 1); persistSave(save); showOptions(save); };
    el.querySelector('#lap-dec').onclick = () => { save.options.laps = Math.max(2, save.options.laps - 1); persistSave(save); showOptions(save); };
    el.querySelector('#lap-inc').onclick = () => { save.options.laps = Math.min(5, save.options.laps + 1); persistSave(save); showOptions(save); };
    el.querySelector('#reset').onclick = () => {
      if (confirm('Reset all career progress?')) {
        const s = resetSave();
        setMuted(s.mute);
        api.onSaveReset(s);
        showOptions(s);
      }
    };
    el.querySelector('[data-act=back]').onclick = () => { sfx('click'); api.onMenu('title'); };
  }

  function showHud() { hud.classList.remove('hidden'); }
  function hideHud() { hud.classList.add('hidden'); }

  function updateHud(info) {
    showHud();
    const w = info.weapon;
    const ammo = info.ammo;
    hud.innerHTML = `
      <div>
        <span class="pill">Lap ${Math.min(info.lap + 1, info.totalLaps)}/${info.totalLaps}</span>
        <span class="pill">Pos ${info.place}/${info.total}</span>
        <span class="pill">HP <span style="color:${hpColor(info.hp, info.maxHp)}">${Math.round(info.hp)}</span></span>
      </div>
      <div>
        <span class="pill">${WEAPON_LABELS[w] || w} ×${ammo}</span>
        <span class="pill">N2O ${info.nitro}</span>
        <span class="pill">${info.time}</span>
      </div>
    `;
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
          <button class="btn danger" id="quit">Quit to Title</button>
        </div>
      </div>
    `;
    document.getElementById('app').appendChild(ov);
    ov.querySelector('#resume').onclick = () => { ov.remove(); sfx('click'); onResume(); };
    ov.querySelector('#quit').onclick = () => { ov.remove(); sfx('click'); onQuit(); };
  }

  function showResults(result, save, onContinue) {
    clear();
    hideHud();
    const el = document.createElement('div');
    el.className = 'screen';
    const rows = result.standings.map((s) =>
      `<div class="shop-item"><div class="info">${s.place}. ${s.name}${s.isPlayer ? ' (You)' : ''}${s.dead ? ' 💀' : ''}</div>
       <div>${s.isPlayer ? '<span class="cash">+' + formatMoney(s.prize) + '</span>' : ''}</div></div>`
    ).join('');
    el.innerHTML = `
      <h1>Race Over</h1>
      <p class="tagline">${result.trackName} · You finished P${result.playerPlace}</p>
      <div class="card">${rows}</div>
      <p class="stat" style="text-align:center;margin-top:10px">Cash: <span class="cash">${formatMoney(save.cash)}</span></p>
      <div class="row" style="margin-top:14px">
        <button class="btn primary" id="cont">Garage</button>
        <button class="btn" id="title">Title</button>
      </div>
    `;
    root.appendChild(el);
    el.querySelector('#cont').onclick = () => { sfx('click'); onContinue('garage'); };
    el.querySelector('#title').onclick = () => { sfx('click'); onContinue('title'); };
  }

  return {
    showTitle, showTrackSelect, showGarage, showOptions,
    updateHud, hideHud, showPause, showResults, clear
  };
}
