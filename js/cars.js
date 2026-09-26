export const CAR_COLORS = ['#00e8ff', '#ff2b6a', '#b8ff00', '#ffe600', '#ff2bd6', '#ff8a00', '#40c0ff', '#f0f0f0'];
export const AI_NAMES = ['Volt', 'Razor', 'Echo', 'Blaze', 'Nyx', 'Torque', 'Drift', 'Pulse'];

export function createCar(opts) {
  return {
    id: opts.id,
    name: opts.name,
    color: opts.color,
    isPlayer: !!opts.isPlayer,
    x: opts.x,
    y: opts.y,
    angle: opts.angle ?? 0,
    vx: 0,
    vy: 0,
    top: opts.top ?? 1100,
    accel: opts.accel ?? 620,
    // progress
    seg: -1,
    lat: 0,
    sPrev: 0,
    dist: 0,
    lap: 0,
    finished: false,
    finishPlace: 0,
    finishTime: 0,
    lastLapMs: 0,
    bestLapMs: 0,
    lapStartMs: 0,
    // AI
    aiLane: opts.aiLane ?? 0,
    aiLaneNow: opts.aiLane ?? 0,
    aiMargin: opts.aiMargin ?? 0.92,
    aiStuck: 0,
    aiReverse: 0
  };
}
