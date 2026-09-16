import { loadSave, persistSave } from './career.js';
import { setMuted, unlockAudio, isMuted } from './audio.js';
import { createInput } from './input.js';
import { createUI } from './ui.js';
import { createGame } from './game.js';
import { loadAssetPack } from './assetPack.js';

loadAssetPack(); // kick off pack ASAP (progressive swap in renderer)

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');

let save = loadSave();
setMuted(save.mute);

const input = createInput();
const game = createGame(canvas, input);
try { window.__RAD_GAME__ = game; } catch (_) {}

const ui = createUI(uiRoot, {
  onMenu(act) {
    unlockAudio();
    if (act === 'career') ui.showTrackSelect(save, 'career');
    else if (act === 'single') ui.showTrackSelect(save, 'single');
    else if (act === 'garage') ui.showGarage(save);
    else if (act === 'options') ui.showOptions(save);
    else if (act === 'title') ui.showTitle(save);
  },
  onStartRace(trackIndex, mode) {
    unlockAudio();
    ui.clear();
    ui.hideHud();
    game.setOnFinish((result) => {
      save = loadSave();
      ui.showResults(result, save, (next) => {
        if (next === 'garage') ui.showGarage(save);
        else ui.showTitle(save);
      });
    });
    game.startRace({
      trackIndex,
      save,
      mode,
      laps: save.options.laps,
      aiCount: save.options.aiCount
    });
    game.setPauseHandler(() => {
      game.setPaused(true);
      ui.showPause(
        () => game.setPaused(false),
        () => {
          game.stopRace();
          ui.showTitle(save);
        }
      );
    });
    // HUD ticker
    startHud();
  },
  onSaveReset(s) {
    save = s;
  }
});

let hudTimer = 0;
function startHud() {
  cancelAnimationFrame(hudTimer);
  const tick = () => {
    if (!game.isRunning()) return;
    const info = game.getHudInfo();
    if (info) ui.updateHud(info);
    // also detect pause via input when race running
    hudTimer = requestAnimationFrame(tick);
  };
  hudTimer = requestAnimationFrame(tick);
}

ui.showTitle(save);

// PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// Resume audio on first gesture
['pointerdown', 'keydown'].forEach((ev) => {
  window.addEventListener(ev, () => unlockAudio(), { once: true });
});
