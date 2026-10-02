import { loadSave, persistSave } from './career.js';
import { setMuted, unlockAudio } from './audio.js';
import { createInput } from './input.js';
import { createUI } from './ui.js';
import { createGame } from './game.js';
import { createRenderer } from './render.js';
import { TRACKS } from './tracks.js';

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');

const save = loadSave();
setMuted(save.mute);

const input = createInput();
const game = createGame(canvas, input);
try { window.__RAD_GAME__ = game; window.__RAD_INPUT__ = input; } catch (_) {}

// v51 renderer choice: PixiJS v8 (WebGL) by default; ?canvas=1 forces the Canvas 2D renderer, and any WebGL / Pixi
// init failure falls back to it automatically. Pixi (vendor/pixi-lean.mjs) loads after the menu has painted.
const params = new URLSearchParams(location.search);
const forceCanvas = params.get('canvas') === '1';
const rendererReady = new Promise((resolve) => {
  const useCanvas = (why) => { if (why) console.warn('[radcars] Canvas 2D renderer:', why); game.setRenderer(createRenderer(canvas)); resolve('canvas'); };
  if (forceCanvas) return useCanvas();
  const probe = document.createElement('canvas');
  const pctx = window.WebGLRenderingContext && (probe.getContext('webgl2') || probe.getContext('webgl'));
  const glOk = !!pctx;
  try { const lose = pctx && pctx.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); } catch (_) {}
  if (!glOk) return useCanvas('WebGL unavailable');
  requestAnimationFrame(() => setTimeout(() => {
    import('./pixiRender.js')
      .then((m) => m.createPixiRenderer(canvas, document.getElementById('app')))
      .then((r) => {
        game.setRenderer(r); resolve('pixi');
        // a lost WebGL context mid-session (GPU reset, tab memory pressure): carry on with the Canvas renderer
        const gl = document.getElementById('pixi');
        if (gl) gl.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          console.warn('[radcars] WebGL context lost: switching to the Canvas 2D renderer');
          gl.remove(); canvas.classList.remove('hud-overlay');
          game.setRenderer(createRenderer(canvas));
        }, { once: true });
      })
      .catch((e) => useCanvas('Pixi init failed: ' + (e && e.message)));
  }, 0));
});
try { window.__RAD_RENDERER__ = rendererReady; } catch (_) {}

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
  rendererReady.then(() => startRaceNow(trackIndex));
}
function startRaceNow(trackIndex) {
  ui.clear();
  ui.hideHud();
  // v52: called with a live result when the reveal ends (rivals still finishing), again as each one finishes, and
  // with the final result; the results screen updates in place. Leaving it stops the still-running race.
  game.setOnFinish((result) => {
    const id = TRACKS[trackIndex].id;
    if (result.bestLapMs && (!save.bestLaps[id] || result.bestLapMs < save.bestLaps[id])) {
      save.bestLaps[id] = Math.round(result.bestLapMs);
      persistSave(save);
    }
    ui.hideHud();
    ui.showResults(result, (next) => { game.stopRace(); if (next === 'again') startRace(trackIndex); else ui.showTitle(); });
  });
  game.setOnReveal((info) => ui.showFinishReveal(info));
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
    if (info && info.finished) { ui.hideHud(); return; } // v52: the finish reveal / results take over
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
