import { TRACKS } from './tracks.js';
import { SHOP_ITEMS, buyItem, priceOf, formatMoney } from './shop.js';
import { WEAPON_LABELS } from './weapons.js';
import { sfx, setMuted, isMuted } from './audio.js';
import { persistSave, resetSave } from './career.js';
import { hpColor } from './util.js';
import { installMenuBackdrop, hideMenuBackdrop } from './scenery.js';

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
    try { installMenuBackdrop(); } catch (_) {}
    const el = document.createElement('div');
    el.className = 'screen';
    el.innerHTML = `
      <div class="title-hero">
        <div class="glow-ring" aria-hidden="true"></div>
        <div class="title-logo"><span class="sub">Underground Circuit</span></div>
        <h1 class="logo-title">Radcars</h1>
        <p class="tagline">Bigger. Faster. Louder.</p>
      </div>
      <p class="muted" style="text-align:center;margin:-6px 0 16px;letter-spacing:0.04em">
        Polite racing is for cowards.
      </p>
      <div class="menu-btns">
        <button class="btn primary" data-act="career">Career</button>
        <button class="btn" data-act="single">Single Race</button>
        <button class="btn" data-act="garage">Garage / Shop</button>
        <button class="btn" data-act="options">Options</button>
      </div>
      <div class="cash-chrome">
        <span>Cash <span class="cash">${formatMoney(save.cash)}</span></span>
        <span class="sep">│</span>
        <span>Circuit ${Math.min(save.careerTrack + 1, TRACKS.length)}/${TRACKS.length}</span>
        <span class="sep">│</span>
        <span>Wins ${save.careerWins}</span>
      </div>
    `;
    root.appendChild(el);
    el.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => { sfx('click'); api.onMenu(b.dataset.act); };
    });
  }

  function showTrackSelect(save, mode) {
    clear();
    hideHud();
    try { installMenuBackdrop(); } catch (_) {}
    const el = document.createElement('div');
    el.className = 'screen';
    const unlocked = mode === 'career' ? Math.min(save.unlockedTracks, TRACKS.length) : TRACKS.length;
    el.innerHTML = `
      <h1>${mode === 'career' ? 'Career' : 'Single Race'}</h1>
      <p class="tagline">Pick your arena · ${save.options.laps} laps · ${save.options.aiCount} rivals</p>
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
        <p class="stat">Industrial circuit · weapons hot</p>
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
    try { installMenuBackdrop(); } catch (_) {}
    const c = save.car;
    const el = document.createElement('div');
    el.className = 'screen garage-screen';
    el.innerHTML = `
      <div class="dealer-banner">⚠ Black Market Pit · Cash only · No receipts ⚠</div>
      <h1>Garage</h1>
      <p class="tagline">Cash: <span class="cash">${formatMoney(save.cash)}</span></p>
      <p class="muted" style="text-align:center;margin:-10px 0 12px">
        HP <span style="color:${hpColor(c.hp, c.maxHp)}">${Math.round(c.hp)}/${c.maxHp}</span>
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
    shop.innerHTML = '<h3>Arms &amp; Upgrades</h3><p class="muted" style="margin-bottom:8px">Shady pit-stop stock — buy it before it walks.</p>';
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
    try { installMenuBackdrop(); } catch (_) {}
    const el = document.createElement('div');
    el.className = 'screen';
    el.innerHTML = `
      <h1>Options</h1>
      <p class="tagline">Tune the mayhem</p>
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
          <div class="info"><strong>Laps</strong><br/><span class="muted">2–8</span></div>
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
    el.querySelector('#lap-inc').onclick = () => { save.options.laps = Math.min(8, save.options.laps + 1); persistSave(save); showOptions(save); };
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

  let hudBuilt = false;
  let lastHudKey = '';
  function ensureHudDom() {
    if (hudBuilt) return;
    hud.innerHTML = `
      <div class="hud-left">
        <span class="pill pill-lap">LAP <strong data-h="lap">1/3</strong></span>
        <span class="pill">POS <strong data-h="pos">1/6</strong></span>
        <span class="pill">HP <strong data-h="hp">10000</strong></span>
        <span class="pill pill-laptime hidden" data-h="lapflash">LAST — · BEST —</span>
      </div>
      <div class="hud-right">
        <span class="pill"><strong data-h="wep">ROCKET</strong></span>
        <span class="pill">N2O <strong data-h="n2o">0</strong></span>
        <span class="pill"><strong data-h="time">0:00.00</strong></span>
      </div>
    `;
    hudBuilt = true;
  }

  function fmtLap(ms) {
    if (!ms || ms <= 0) return '—';
    const t = ms / 1000;
    const mm = Math.floor(t / 60);
    const ss = Math.floor(t % 60).toString().padStart(2, '0');
    const cs = Math.floor((t % 1) * 100).toString().padStart(2, '0');
    return mm > 0 ? `${mm}:${ss}.${cs}` : `${ss}.${cs}`;
  }

  function updateHud(info) {
    hideMenuBackdrop();
    showHud();
    ensureHudDom();
    const w = info.weapon;
    const ammo = info.ammo;
    // info.lap is already 1-based display lap from game.getHudInfo
    const lap = `${info.lap}/${info.totalLaps}`;
    const pos = `${info.place}/${info.total}`;
    const hp = String(Math.round(info.hp));
    const wep = `${WEAPON_LABELS[w] || w} ×${ammo}`;
    const n2o = String(info.nitro);
    const time = info.time;
    const flash = info.lapFlashMs > 0;
    const flashTxt = flash
      ? `LAST ${fmtLap(info.lapFlashLast)} · BEST ${fmtLap(info.lapFlashBest)}`
      : '';
    // Avoid rewriting innerHTML every RAF — that caused HUD flicker
    const key = [lap, pos, hp, wep, n2o, time, flashTxt].join('|');
    if (key === lastHudKey) return;
    lastHudKey = key;
    const set = (k, v) => {
      const el = hud.querySelector(`[data-h="${k}"]`);
      if (el && el.textContent !== v) el.textContent = v;
    };
    set('lap', lap);
    set('pos', pos);
    set('hp', hp);
    const hpEl = hud.querySelector('[data-h="hp"]');
    if (hpEl) hpEl.style.color = hpColor(info.hp, info.maxHp);
    set('wep', wep);
    set('n2o', n2o);
    set('time', time);
    const flashEl = hud.querySelector('[data-h="lapflash"]');
    if (flashEl) {
      if (flash) {
        flashEl.textContent = flashTxt;
        flashEl.classList.remove('hidden');
        flashEl.classList.add('lap-flash');
      } else {
        flashEl.classList.add('hidden');
        flashEl.classList.remove('lap-flash');
      }
    }
  }

  function showPause(onResume, onQuit) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.id = 'pause-ov';
    ov.innerHTML = `
      <div class="screen">
        <h1>Paused</h1>
        <p class="tagline">Still breathing?</p>
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
    try { installMenuBackdrop(); } catch (_) {}
    const el = document.createElement('div');
    el.className = 'screen';
    const rows = result.standings.map((s) =>
      `<div class="shop-item"><div class="info">${s.place}. ${s.name}${s.isPlayer ? ' (You)' : ''}${s.dead ? ' 💀' : ''}</div>
       <div>${s.isPlayer ? '<span class="cash">+' + formatMoney(s.prize) + '</span>' : ''}</div></div>`
    ).join('');
    const tot = result.totalTime != null ? fmtLap(result.totalTime) : '';
    const best = result.bestLapMs ? fmtLap(result.bestLapMs) : '';
    const timing = [tot && `Total ${tot}`, best && `Best lap ${best}`].filter(Boolean).join(' · ');
    el.innerHTML = `
      <h1>Race Over</h1>
      <p class="tagline">${result.trackName} · You finished P${result.playerPlace}${timing ? ' · ' + timing : ''}</p>
      <div class="card">${rows}</div>
      <div class="cash-chrome" style="margin-top:12px">
        <span>Cash <span class="cash">${formatMoney(save.cash)}</span></span>
      </div>
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
