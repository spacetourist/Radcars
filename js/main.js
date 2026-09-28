import { loadSave, persistSave } from './career.js';
import { setMuted, unlockAudio } from './audio.js';
import { createInput } from './input.js';
import { createUI } from './ui.js';
import { createGame } from './game.js';
import { TRACKS } from './tracks.js';

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');

const save = loadSave();
setMuted(save.mute);

const input = createInput();
const game = createGame(canvas, input);
try { window.__RAD_GAME__ = game; window.__RAD_INPUT__ = input; } catch (_) {}

const ui = createUI(uiRoot, {
  onMenu(act) {
    unlockAudio();
    if (act === 'race') ui.showTrackSelect(save);
    else if (act === 'options') ui.showOptions(save);
    else ui.showTitle();
  },
  onStartRace: startRace,
  onHardRefresh: hardRefresh
});

/** Menu "Update / hard refresh": drop every service worker and cache, then reload past any HTTP cache. */
async function hardRefresh() {
  swState.reloading = true; // no controllerchange auto-reload racing this one
  try { if ('serviceWorker' in navigator) await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister())); } catch (_) {}
  try { if (self.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k))); } catch (_) {}
  // re-download every file with cache:'reload' so the browser's HTTP cache can't hand back an old module after the reload
  try { await Promise.all(((self.RADCARS_BUILD && self.RADCARS_BUILD.assets) || []).map((a) => fetch(new URL(a, location.href), { cache: 'reload' }).catch(() => {}))); } catch (_) {}
  const u = new URL(location.href); u.searchParams.set('r', Date.now());
  location.replace(u.href);
}
// tidy the address bar after a hard refresh (?r=timestamp)
if (new URLSearchParams(location.search).has('r')) { const u = new URL(location.href); u.searchParams.delete('r'); history.replaceState(null, '', u.pathname + u.search + u.hash); }

function startRace(trackIndex) {
  unlockAudio();
  ui.clear();
  ui.hideHud();
  game.setOnFinish((result) => {
    const id = TRACKS[trackIndex].id;
    if (result.bestLapMs && (!save.bestLaps[id] || result.bestLapMs < save.bestLaps[id])) {
      save.bestLaps[id] = Math.round(result.bestLapMs);
      persistSave(save);
    }
    ui.hideHud();
    ui.showResults(result, (next) => (next === 'again' ? startRace(trackIndex) : ui.showTitle()));
  });
  game.setPauseHandler(() => {
    ui.showPause(
      () => game.setPaused(false),
      () => { game.stopRace(); ui.hideHud(); ui.showTitle(); }
    );
  });
  game.startRace({
    trackIndex,
    laps: save.options.laps,
    aiCount: save.options.aiCount,
    difficulty: save.options.difficulty
  });
  const tick = () => {
    if (!game.isRunning()) return;
    const info = game.getHudInfo();
    if (info) ui.updateHud(info);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

ui.showTitle();

// ---- service worker: always pick up a new deploy without closing the tab ----
// The SW activates immediately (skipWaiting + clients.claim). When a new one takes control we reload once, but never
// mid-race: the reload waits until the menu, pause-quit or the results screen.
const swState = { hadController: false, pending: false, reloading: false, updates: 0 };
try { window.__RAD_SW__ = swState; } catch (_) {}
const midRace = () => game.isRunning() && !(game.world && game.world.race && game.world.race.over);
function maybeReload() {
  if (!swState.pending || swState.reloading || midRace()) return;
  swState.reloading = true;
  location.reload();
}
if ('serviceWorker' in navigator) {
  swState.hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!swState.hadController) { swState.hadController = true; return; } // first install: nothing stale to replace
    swState.pending = true;
    maybeReload();
  });
  setInterval(maybeReload, 500);
  const checkForUpdate = () => navigator.serviceWorker.getRegistration().then((r) => { if (r) { swState.updates++; return r.update(); } }).catch(() => {});
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(checkForUpdate).catch(() => {});
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
}
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => unlockAudio(), { once: true }));
