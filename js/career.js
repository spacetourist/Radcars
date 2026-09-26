/** Persistent settings + best lap per track. */
const KEY = 'radcars_core_v1';

export const DEFAULT_SAVE = {
  mute: false,
  options: { aiCount: 5, laps: 3, difficulty: 1 },
  bestLaps: {}
};

export function loadSave() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!data) return structuredClone(DEFAULT_SAVE);
    return {
      ...structuredClone(DEFAULT_SAVE),
      ...data,
      options: { ...DEFAULT_SAVE.options, ...(data.options || {}) },
      bestLaps: { ...(data.bestLaps || {}) }
    };
  } catch {
    return structuredClone(DEFAULT_SAVE);
  }
}

export function persistSave(save) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (_) {}
}
