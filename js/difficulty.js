/**
 * Race difficulty ladder. Index 3 (Hard) matches pre-ladder AI behaviour.
 * Lower tiers soften skill, aggression, loadouts, and add more steering noise.
 */
export const DIFFICULTY_LEVELS = [
  {
    id: 'rookie',
    label: 'Rookie',
    blurb: 'Super easy — slow rivals, soft weapons, wide mistakes',
    skillMul: 0.32,
    aggroMul: 0.22,
    engineMul: 0.35,
    armourMul: 0.2,
    weaponMul: 0.35,
    jitterMul: 2.4,
    lookAheadMul: 0.55,
    fireMul: 0.35,
    nitroMul: 0.4
  },
  {
    id: 'easy',
    label: 'Easy',
    blurb: 'Forgiving AI — learn the track and combat',
    skillMul: 0.55,
    aggroMul: 0.45,
    engineMul: 0.55,
    armourMul: 0.45,
    weaponMul: 0.55,
    jitterMul: 1.7,
    lookAheadMul: 0.7,
    fireMul: 0.55,
    nitroMul: 0.65
  },
  {
    id: 'normal',
    label: 'Normal',
    blurb: 'Solid rivals — still beatable with clean laps',
    skillMul: 0.78,
    aggroMul: 0.72,
    engineMul: 0.82,
    armourMul: 0.75,
    weaponMul: 0.8,
    jitterMul: 1.25,
    lookAheadMul: 0.88,
    fireMul: 0.8,
    nitroMul: 0.85
  },
  {
    id: 'hard',
    label: 'Hard',
    blurb: 'Classic — current full-strength AI',
    skillMul: 1,
    aggroMul: 1,
    engineMul: 1,
    armourMul: 1,
    weaponMul: 1,
    jitterMul: 1,
    lookAheadMul: 1,
    fireMul: 1,
    nitroMul: 1
  }
];

export function clampDifficultyIndex(n) {
  const i = Number(n);
  if (!Number.isFinite(i)) return 1;
  return Math.max(0, Math.min(DIFFICULTY_LEVELS.length - 1, i | 0));
}

export function getDifficulty(saveOrIndex) {
  const idx = typeof saveOrIndex === 'number'
    ? saveOrIndex
    : clampDifficultyIndex(saveOrIndex?.options?.difficulty);
  return DIFFICULTY_LEVELS[clampDifficultyIndex(idx)];
}
