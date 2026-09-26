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
try { window.__RAD_GAME__ = game; } catch (_) {}

const ui = createUI(uiRoot, {
  onMenu(act) {
    unlockAudio();
    if (act === 'race') ui.showTrackSelect(save);
    else if (act === 'options') ui.showOptions(save);
    else ui.showTitle();
  },
  onStartRace: startRace
});

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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => unlockAudio(), { once: true }));
