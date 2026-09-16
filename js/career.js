const KEY = 'radcars_save_v1';

export const DEFAULT_SAVE = {
  cash: 2500,
  careerTrack: 0,
  careerWins: 0,
  unlockedTracks: 1,
  mute: false,
  car: {
    hp: 10000,
    maxHp: 10000,
    engine: 0,
    armour: 0,
    nitro: 1,
    nitroMax: 1,
    ram: 0,
    weapons: {
      front: 8,
      rear: 4,
      homing: 2,
      mine: 3,
      super: 0
    },
    selectedWeapon: 'front'
  },
  options: {
    aiCount: 5,
    laps: 3,
    /** 0 Rookie … 3 Hard (classic / current AI) */
    difficulty: 1
  }
};

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const data = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_SAVE), ...data, car: { ...structuredClone(DEFAULT_SAVE.car), ...(data.car || {}), weapons: { ...structuredClone(DEFAULT_SAVE.car.weapons), ...((data.car && data.car.weapons) || {}) } }, options: { ...DEFAULT_SAVE.options, ...(data.options || {}) } };
  } catch {
    return structuredClone(DEFAULT_SAVE);
  }
}

export function persistSave(save) {
  localStorage.setItem(KEY, JSON.stringify(save));
}

export function resetSave() {
  const s = structuredClone(DEFAULT_SAVE);
  persistSave(s);
  return s;
}

export function placePrize(place, trackIndex) {
  const base = [1200, 800, 500, 300, 200, 120, 80, 50];
  const mult = 1 + trackIndex * 0.35;
  return Math.floor((base[place - 1] || 40) * mult);
}
