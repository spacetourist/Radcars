import { getAssetPack, isPackReady } from './assetPack.js';

/**
 * Radcars scenery — procedural pre-rendered buildings, crowds, props + skyline.
 * Classic arcade industrial neon attitude; original designs (no third-party IP).
 * Sprites generated once; placements cached per track; drawImage batched each frame.
 */

function shade(hex, amt) {
  const c = hex.replace('#', '');
  if (c.length < 6) return hex;
  const n = parseInt(c, 16);
  let r = (n >> 16) + amt;
  let g = ((n >> 8) & 0xff) + amt;
  let b = (n & 0xff) + amt;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function hexAlpha(hex, a) {
  const c = hex.replace('#', '');
  if (c.length < 6) return hex;
  const n = parseInt(c, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  return { canvas: c, ctx };
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isOnAsphalt(track, x, y) {
  // XOR so the driveable ribbon is detected even if outer/inner were swapped
  return pointInPoly(x, y, track.outer) !== pointInPoly(x, y, track.inner);
}

function perimeterNormals(poly) {
  const n = poly.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = dy / len, ny = -dx / len;
    out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, nx, ny, len });
  }
  const cx = poly.reduce((s, p) => s + p.x, 0) / n;
  const cy = poly.reduce((s, p) => s + p.y, 0) / n;
  for (const e of out) {
    const mx = (e.ax + e.bx) * 0.5, my = (e.ay + e.by) * 0.5;
    const toC = { x: cx - mx, y: cy - my };
    if (e.nx * toC.x + e.ny * toC.y > 0) {
      e.nx = -e.nx;
      e.ny = -e.ny;
    }
  }
  return out;
}

function themeFor(track) {
  // Scenery accents are warm sodium (amber/orange) — never track-wall cyan grids (v19)
  // Track wall colour is a *sparse* identity tip only (lime / pink / yellow).
  const sodiumA = '#ff9a3c';
  const sodiumB = '#ffb84a';
  const sodiumC = '#ffd080';
  const id = track.id || '';
  const wall = track.wall || '';
  if (id === 'gridlock') {
    return {
      skyTop: '#050508', skyMid: '#0c0c12', skyBot: '#0c0c12',
      ground: '#0c0c12', groundHi: '#1e3a28',
      neonA: sodiumA, neonB: sodiumB, neonC: wall || '#b8ff00',
      brick: '#2a3038', brickHi: '#3a4250', metal: '#1a1e26',
      window: '#1a2838', glowWin: sodiumB,
      identity: wall || '#b8ff00',
      skyWash: '#ffc070',
      vintageFast: true,
      infield: '#1e3a28', outfield: '#0c0c12', asphalt: '#2a2a32'
    };
  }
  if (id === 'razor_hairpin') {
    return {
      skyTop: '#08040e', skyMid: '#100818', skyBot: '#141014', // darker night-club canyon
      ground: '#0a080c', groundHi: '#141014', // darker infield plate
      neonA: sodiumA, neonB: '#ff8a50', neonC: wall || '#ff2bd6', // pink tip sparse
      brick: '#241828', brickHi: '#342830', metal: '#161018',
      window: '#140c12', glowWin: '#c07040', // fewer/dimmer lit windows
      identity: wall || '#ff2bd6',
      infieldDark: true,
      skyWash: '#ffb060' // amber only — pink is wall tip, not sky wash
    };
  }
  if (id === 'cargo_dock') {
    return {
      // Dark blue night — match bg-skyline-horizon top (~0,3,11); never green/pink sky
      skyTop: '#00030b', skyMid: '#061018', skyBot: '#121410',
      ground: '#101410', groundHi: '#1a1e16',
      neonA: '#ff8a00', neonB: sodiumB, neonC: wall || '#ffe600', // yellow sodium tip only
      brick: '#243028', brickHi: '#344038', metal: '#141c16',
      window: '#182820', glowWin: '#ff8a00',
      identity: wall || '#ffe600',
      skyWash: '#ffcc44', // yellow sodium wash — never magenta/pink
      killPinkWash: true
    };
  }
  return {
    skyTop: '#050508', skyMid: '#0c0c12', skyBot: '#0c0c12',
    ground: '#0c0c12', groundHi: '#1e3a28',
    neonA: sodiumA, neonB: sodiumB, neonC: sodiumC,
    brick: '#262c36', brickHi: '#363c48', metal: '#1a1e28',
    window: '#1a2434', glowWin: '#ffb060',
    identity: wall || '#ff2bd6',
    vintageFast: true,
    infield: '#1e3a28', outfield: '#0c0c12', asphalt: '#2a2a32'
  };
}

function paintWarehouse(ctx, tw, th, theme, variant) {
  const w = tw, h = th;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(4, h - 10, w - 4, 8);
  const body = shade(theme.brick, variant * 6 - 8);
  ctx.fillStyle = body;
  ctx.fillRect(2, 18, w - 8, h - 26);
  ctx.fillStyle = shade(theme.metal, 20);
  ctx.fillRect(0, 12, w - 4, 10);
  ctx.fillStyle = shade(theme.metal, -10);
  ctx.fillRect(0, 8, w - 4, 5);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  for (let x = 10; x < w - 12; x += 14) ctx.fillRect(x, 22, 2, h - 34);
  const winCol = variant % 2 ? theme.glowWin : theme.window;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const lit = ((variant + col + row) % 3) !== 0;
      ctx.fillStyle = lit ? hexAlpha(winCol, 0.55 + (variant % 3) * 0.1) : 'rgba(8,10,14,0.9)';
      const wx = 10 + col * 18;
      const wy = 28 + row * 22;
      ctx.fillRect(wx, wy, 12, 14);
      if (lit) {
        ctx.fillStyle = hexAlpha(winCol, 0.25);
        ctx.fillRect(wx - 1, wy - 1, 14, 16);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(wx, wy, 12, 14);
    }
  }
  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(w * 0.35, h - 28, w * 0.35, 16);
  ctx.fillStyle = theme.neonC;
  ctx.globalAlpha = 0.7;
  ctx.fillRect(w * 0.35, h - 30, w * 0.35, 2);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.strokeRect(2, 18, w - 8, h - 26);
}

function paintTower(ctx, tw, th, theme, variant) {
  const w = tw, h = th;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(6, h - 8, w - 8, 6);
  const floors = 5 + (variant % 4);
  const floorH = (h - 24) / floors;
  ctx.fillStyle = shade(theme.metal, variant % 2 ? 8 : -4);
  ctx.fillRect(8, 10, w - 20, h - 18);
  // Sparse sodium tip only (v19) — no cyan mast / neon edge strips
  if (variant % 3 === 0) {
    ctx.strokeStyle = hexAlpha(theme.neonC || '#ffd080', 0.55);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 2, 10);
    ctx.lineTo(w / 2 - 2, 3);
    ctx.stroke();
    ctx.fillStyle = hexAlpha(theme.glowWin || '#ffb060', 0.7);
    ctx.beginPath();
    ctx.arc(w / 2 - 2, 3, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let f = 0; f < floors; f++) {
    const y = 14 + f * floorH;
    for (let c = 0; c < 3; c++) {
      // Fewer lit windows — warm sodium, not cyan grids
      const lit = ((f * 3 + c + variant) % 4) === 0;
      ctx.fillStyle = lit ? hexAlpha(theme.glowWin || '#ffb060', 0.4 + (f % 3) * 0.08) : 'rgba(6,8,12,0.95)';
      ctx.fillRect(12 + c * 12, y + 2, 8, floorH - 5);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(8, y + floorH - 1, w - 20, 1);
  }
  // Soft dark mullion only — no neon side strips
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(8, 12, 2, h - 22);
}

function paintNeonShop(ctx, tw, th, theme, variant) {
  const w = tw, h = th;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(3, h - 8, w - 4, 6);
  ctx.fillStyle = shade(theme.brick, 10);
  ctx.fillRect(4, 28, w - 10, h - 34);
  const neon = variant % 2 ? theme.neonB : theme.neonA;
  ctx.fillStyle = neon;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(2, 18, w - 6, 12);
  ctx.globalAlpha = 1;
  ctx.fillStyle = shade(neon, -40);
  ctx.fillRect(2, 28, w - 6, 3);
  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(10, 20, w - 22, 8);
  ctx.fillStyle = variant % 3 === 0 ? theme.neonC : '#fff';
  ctx.fillRect(14, 22, 10, 4);
  ctx.fillRect(28, 22, 6, 4);
  ctx.fillRect(38, 22, 12, 4);
  ctx.fillStyle = hexAlpha(theme.glowWin, 0.35);
  ctx.fillRect(10, 40, w - 24, h - 56);
  // Soft dark edge only — never bright neon AA outline boxes
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(10, 40, w - 24, h - 56);
  ctx.fillStyle = '#080a0e';
  ctx.fillRect(w * 0.4, h - 36, 14, 24);
  ctx.fillStyle = neon;
  ctx.fillRect(w * 0.4 + 10, h - 24, 2, 2);
}

function paintBillboard(ctx, tw, th, theme, variant) {
  const w = tw, h = th;
  ctx.fillStyle = '#1a1c20';
  ctx.fillRect(w * 0.2, h * 0.45, 6, h * 0.5);
  ctx.fillRect(w * 0.72, h * 0.45, 6, h * 0.5);
  ctx.fillStyle = '#0e1014';
  ctx.fillRect(4, 8, w - 8, h * 0.42);
  // Warm sodium face (amber/orange) — never cyan neon frame (v19)
  const cols = [theme.neonC || '#ffd080', theme.glowWin || '#ffb060', theme.neonB || '#ffb84a'];
  ctx.fillStyle = cols[variant % 3];
  ctx.globalAlpha = 0.55;
  ctx.fillRect(8, 12, w - 16, h * 0.34);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(14, 18, w * 0.35, h * 0.2);
  ctx.fillStyle = 'rgba(255, 236, 200, 0.75)';
  ctx.fillRect(w * 0.5, 20, w * 0.28, 6);
  ctx.fillRect(w * 0.5, 30, w * 0.2, 4);
  // Soft dark plate edge — no cyan AA neon box
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(4, 8, w - 8, h * 0.42);
  // Sparse warm accent line only
  if (variant % 2 === 0) {
    ctx.fillStyle = hexAlpha(theme.neonA || '#ff9a3c', 0.35);
    ctx.fillRect(8, 12, w - 16, 2);
  }
}

function paintChimney(ctx, tw, th, theme, variant) {
  const w = tw, h = th;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(w * 0.25, h - 6, w * 0.5, 5);
  ctx.fillStyle = shade(theme.brick, -5);
  ctx.fillRect(w * 0.28, 20, w * 0.4, h - 26);
  ctx.fillStyle = shade(theme.brickHi, 5);
  ctx.fillRect(w * 0.22, 14, w * 0.52, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 30; y < h - 20; y += 16) ctx.fillRect(w * 0.28, y, w * 0.4, 3);
  ctx.fillStyle = 'rgba(180,190,200,0.18)';
  ctx.beginPath();
  ctx.arc(w * 0.45, 10, 8 + (variant % 3), 0, Math.PI * 2);
  ctx.arc(w * 0.55, 4, 6, 0, Math.PI * 2);
  ctx.fill();
  if (variant % 2) {
    ctx.fillStyle = hexAlpha(theme.neonC, 0.35);
    ctx.fillRect(w * 0.28, h - 40, w * 0.4, 3);
  }
}

function paintWaterTower(ctx, tw, th, theme) {
  const w = tw, h = th;
  ctx.strokeStyle = shade(theme.metal, 30);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w * 0.3, h - 4);
  ctx.lineTo(w * 0.45, h * 0.4);
  ctx.moveTo(w * 0.7, h - 4);
  ctx.lineTo(w * 0.55, h * 0.4);
  ctx.moveTo(w * 0.5, h - 4);
  ctx.lineTo(w * 0.5, h * 0.38);
  ctx.stroke();
  ctx.fillStyle = shade(theme.metal, 15);
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.32, w * 0.32, h * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade(theme.metal, -20);
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.38, w * 0.32, h * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexAlpha(theme.neonA, 0.7);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.32, w * 0.32, h * 0.18, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = theme.neonC;
  ctx.globalAlpha = 0.8;
  ctx.fillRect(w * 0.22, h * 0.3, w * 0.56, 4);
  ctx.globalAlpha = 1;
}

function paintGrandstand(ctx, tw, th, theme, variant) {
  const w = tw, h = th;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(2, h - 6, w - 2, 5);
  for (let t = 0; t < 4; t++) {
    const y = h - 14 - t * 12;
    const inset = t * 4;
    ctx.fillStyle = shade(theme.metal, t * 8 - 10);
    ctx.fillRect(inset, y, w - inset * 2, 11);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(inset, y + 9, w - inset * 2, 2);
    for (let i = 0; i < 8; i++) {
      const cx = inset + 8 + i * ((w - inset * 2 - 16) / 7);
      const cols = [theme.neonA, theme.neonB, theme.neonC, '#fff8e8', '#ff8a00'];
      ctx.fillStyle = cols[(i + variant + t) % cols.length];
      ctx.globalAlpha = 0.75;
      ctx.fillRect(cx, y + 2, 3, 5);
      ctx.beginPath();
      ctx.arc(cx + 1.5, y + 1, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.fillStyle = shade(theme.metal, -15);
  ctx.beginPath();
  ctx.moveTo(0, h - 14 - 4 * 12);
  ctx.lineTo(w * 0.5, h - 14 - 4 * 12 - 14);
  ctx.lineTo(w, h - 14 - 4 * 12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = hexAlpha(theme.neonA, 0.5);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, h - 14 - 4 * 12);
  ctx.lineTo(w * 0.5, h - 14 - 4 * 12 - 14);
  ctx.lineTo(w, h - 14 - 4 * 12);
  ctx.stroke();
}

/** Large solid grandstand mass — reads as architecture, not crowd stamps. */
function paintGrandstandBlock(ctx, tw, th, theme, variant) {
  const w = tw, h = th;
  // Base podium / shadow
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(4, h - 10, w - 8, 8);
  // Concrete body
  ctx.fillStyle = shade(theme.metal, -8);
  ctx.fillRect(0, 18, w, h - 28);
  ctx.fillStyle = shade(theme.metal, 12);
  ctx.fillRect(0, 18, w, 8);
  // Tiered seating bands
  const tiers = 5;
  for (let t = 0; t < tiers; t++) {
    const y = 28 + t * ((h - 48) / tiers);
    const inset = 6 + t * 3;
    ctx.fillStyle = shade(theme.brick, t * 6 - 6);
    ctx.fillRect(inset, y, w - inset * 2, (h - 48) / tiers - 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(inset, y + (h - 48) / tiers - 4, w - inset * 2, 2);
    // Dense crowd row (small stamps that still read as mass with the block)
    for (let i = 0; i < 14; i++) {
      const cx = inset + 6 + i * ((w - inset * 2 - 12) / 13);
      const cols = [theme.neonA, theme.neonB, theme.neonC, '#fff', '#ff8a00', '#e8c090'];
      ctx.fillStyle = cols[(i + variant + t) % cols.length];
      ctx.globalAlpha = 0.7;
      ctx.fillRect(cx, y + 3, 3.5, 6);
      ctx.beginPath();
      ctx.arc(cx + 1.75, y + 2, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  // Roof canopy — large mass
  ctx.fillStyle = shade(theme.metal, -20);
  ctx.beginPath();
  ctx.moveTo(-4, 22);
  ctx.lineTo(w * 0.5, 2);
  ctx.lineTo(w + 4, 22);
  ctx.lineTo(w - 8, 28);
  ctx.lineTo(8, 28);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = hexAlpha(theme.neonA, 0.65);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-4, 22);
  ctx.lineTo(w * 0.5, 2);
  ctx.lineTo(w + 4, 22);
  ctx.stroke();
  // Fascia stripe
  ctx.fillStyle = hexAlpha(theme.neonB, 0.55);
  ctx.fillRect(10, 26, w - 20, 3);
  // Support columns
  ctx.fillStyle = shade(theme.metal, 25);
  ctx.fillRect(14, h - 22, 6, 14);
  ctx.fillRect(w / 2 - 3, h - 22, 6, 14);
  ctx.fillRect(w - 20, h - 22, 6, 14);
}

function paintCharacter(ctx, tw, th, theme, variant) {
  const w = tw, h = th;
  const cx = w / 2;
  const palette = [
    theme.neonA, theme.neonB, theme.neonC, '#ff8a00', '#e8e8f0', '#4a90ff', '#ff4466'
  ];
  const shirt = palette[variant % palette.length];
  const pants = shade(theme.metal, 10 + (variant % 5) * 4);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(cx, h - 3, 7, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pants;
  ctx.fillRect(cx - 5, h * 0.55, 4, h * 0.38);
  ctx.fillRect(cx + 1, h * 0.55, 4, h * 0.38);
  ctx.fillStyle = shirt;
  ctx.fillRect(cx - 6, h * 0.32, 12, h * 0.28);
  ctx.fillStyle = shade(shirt, -15);
  const pose = variant % 4;
  if (pose === 0) {
    ctx.fillRect(cx - 10, h * 0.34, 4, h * 0.2);
    ctx.fillRect(cx + 6, h * 0.34, 4, h * 0.2);
  } else if (pose === 1) {
    ctx.fillRect(cx - 10, h * 0.22, 4, h * 0.2);
    ctx.fillRect(cx + 6, h * 0.22, 4, h * 0.2);
  } else if (pose === 2) {
    ctx.fillRect(cx - 11, h * 0.36, h * 0.18, 3);
    ctx.fillRect(cx + 6, h * 0.34, 4, h * 0.2);
  } else {
    ctx.fillRect(cx - 10, h * 0.34, 4, h * 0.2);
    ctx.fillRect(cx + 5, h * 0.28, 3, h * 0.16);
  }
  ctx.fillStyle = '#e8c4a0';
  ctx.beginPath();
  ctx.arc(cx, h * 0.24, 5.5, 0, Math.PI * 2);
  ctx.fill();
  const headgear = variant % 5;
  if (headgear === 0) {
    ctx.fillStyle = '#1a1a1e';
    ctx.beginPath();
    ctx.arc(cx, h * 0.21, 5.5, Math.PI, 0);
    ctx.fill();
  } else if (headgear === 1) {
    ctx.fillStyle = theme.neonC;
    ctx.beginPath();
    ctx.arc(cx, h * 0.2, 6, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(cx - 7, h * 0.2, 14, 3);
  } else if (headgear === 2) {
    ctx.fillStyle = theme.neonB;
    ctx.fillRect(cx - 6, h * 0.16, 12, 5);
  } else if (headgear === 3) {
    ctx.fillStyle = theme.neonA;
    ctx.fillRect(cx - 1.5, h * 0.08, 3, 10);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - 6, h * 0.32, 12, h * 0.28);
}

function paintBarrel(ctx, tw, th, theme, variant) {
  const w = tw, h = th;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(w / 2, h - 2, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  const col = variant % 2 ? '#c45a12' : '#3a6a3a';
  ctx.fillStyle = col;
  ctx.fillRect(w / 2 - 8, 6, 16, h - 12);
  ctx.fillStyle = shade(col, 30);
  ctx.beginPath();
  ctx.ellipse(w / 2, 6, 8, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade(col, -20);
  ctx.beginPath();
  ctx.ellipse(w / 2, h - 6, 8, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = theme.neonC;
  ctx.fillRect(w / 2 - 8, h * 0.4, 16, 3);
  ctx.fillStyle = '#111';
  ctx.fillRect(w / 2 - 8, h * 0.55, 16, 2);
}

function paintCone(ctx, tw, th) {
  const w = tw, h = th;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(w / 2, h - 2, 7, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff8a00';
  ctx.beginPath();
  ctx.moveTo(w / 2, 2);
  ctx.lineTo(w / 2 + 8, h - 4);
  ctx.lineTo(w / 2 - 8, h - 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(w / 2 - 5, h * 0.45, 10, 4);
}

function paintLight(ctx, tw, th, theme, variant) {
  const w = tw, h = th;
  ctx.fillStyle = shade(theme.metal, 20);
  ctx.fillRect(w / 2 - 2, 16, 4, h - 18);
  ctx.fillStyle = shade(theme.metal, 40);
  ctx.fillRect(w / 2 - 10, 8, 20, 10);
  // Warm sodium / soft fill — neon beams dialled back (v18)
  const glow = variant % 2 ? '#ffb84a' : '#ffe0a0';
  ctx.fillStyle = hexAlpha(glow, 0.18);
  ctx.beginPath();
  ctx.moveTo(w / 2 - 10, 18);
  ctx.lineTo(w / 2 + 10, 18);
  ctx.lineTo(w / 2 + 14, h);
  ctx.lineTo(w / 2 - 14, h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = glow;
  ctx.globalAlpha = 0.75;
  ctx.fillRect(w / 2 - 8, 10, 16, 5);
  ctx.globalAlpha = 1;
}

function paintFence(ctx, tw, th, theme) {
  const w = tw, h = th;
  ctx.strokeStyle = shade(theme.metal, 35);
  ctx.lineWidth = 2;
  for (let x = 4; x < w; x += 10) {
    ctx.beginPath();
    ctx.moveTo(x, 8);
    ctx.lineTo(x, h - 4);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(2, 12);
  ctx.lineTo(w - 2, 12);
  ctx.moveTo(2, h * 0.55);
  ctx.lineTo(w - 2, h * 0.55);
  ctx.stroke();
  // No neon AA outline box around fence panel
}

function paintPalm(ctx, tw, th, theme, variant) {
  const w = tw, h = th;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(w / 2, h - 2, 6, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5a4030';
  ctx.fillRect(w / 2 - 3, h * 0.35, 6, h * 0.6);
  ctx.fillStyle = '#2a8a4a';
  for (let i = 0; i < 5; i++) {
    const a = -1.2 + i * 0.55 + (variant % 3) * 0.05;
    ctx.beginPath();
    ctx.moveTo(w / 2, h * 0.38);
    ctx.quadraticCurveTo(
      w / 2 + Math.cos(a) * 28,
      h * 0.38 + Math.sin(a) * 10 - 8,
      w / 2 + Math.cos(a) * 22,
      h * 0.2 + Math.sin(a) * 18
    );
    ctx.lineTo(w / 2, h * 0.38);
    ctx.fill();
  }
  ctx.fillStyle = hexAlpha(theme.neonA, 0.4);
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.32, 3, 0, Math.PI * 2);
  ctx.fill();
}

function paintStreetlamp(ctx, tw, th, theme, variant) {
  const w = tw, h = th;
  ctx.fillStyle = shade(theme.metal, 25);
  ctx.fillRect(w / 2 - 2, 20, 4, h - 22);
  ctx.beginPath();
  ctx.moveTo(w / 2, 20);
  ctx.quadraticCurveTo(w / 2 + 18, 8, w / 2 + 22, 14);
  ctx.strokeStyle = shade(theme.metal, 25);
  ctx.lineWidth = 3;
  ctx.stroke();
  // Sodium bulb + soft halo (no cyan/pink neon clash)
  const glow = variant % 2 ? '#ffc05a' : '#ffe8b0';
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(w / 2 + 22, 16, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexAlpha(glow, 0.14);
  ctx.beginPath();
  ctx.arc(w / 2 + 22, 16, 12, 0, Math.PI * 2);
  ctx.fill();
}

export function createScenerySprites(theme) {
  const buildings = { warehouse: [], warehouseSm: [], tower: [], towerSm: [], shop: [], billboard: [], billboardMd: [], chimney: [], water: [], stand: [], standBlock: [], standLarge: [], crane: [], containers: [], cityblock: [], cityblockMd: [], citystreet: [], citystreetMd: [], _crowdDense: [], _crowdThin: [] };
  const characters = [];
  const props = { barrel: [], cone: [], light: [], fence: [], palm: [], lamp: [], tyrewall: [] };

  const packEarly = getAssetPack();
  const packSc = (packEarly && packEarly.ready && packEarly.scenery) ? packEarly.scenery : null;
  const hasPackPalms = !!(packSc && (packSc.palmSm || packSc.palmMd || packSc.palms || packSc.palm));
  const hasPackBillboards = !!(packSc && (packSc.billboardSm || packSc.billboardMd || packSc.billboard));

  const hasPackWarehouse = !!(packSc && (packSc.warehouseSm || packSc.warehouseMd || packSc.warehouse));
  const hasPackTower = !!(packSc && (packSc.towerSm || packSc.towerMd || packSc.tower));
  for (let v = 0; v < 6; v++) {
    let c;
    // v27: never bake procedural cyan-window cards into slots pack will own
    if (!hasPackWarehouse) {
      c = makeCanvas(72, 96); paintWarehouse(c.ctx, 72, 96, theme, v); buildings.warehouse.push(c.canvas);
    }
    if (!hasPackTower) {
      c = makeCanvas(56, 128); paintTower(c.ctx, 56, 128, theme, v); buildings.tower.push(c.canvas);
    }
    c = makeCanvas(80, 88); paintNeonShop(c.ctx, 80, 88, theme, v); buildings.shop.push(c.canvas);
    if (!hasPackBillboards) {
      c = makeCanvas(96, 72); paintBillboard(c.ctx, 96, 72, theme, v); buildings.billboard.push(c.canvas);
    }
    c = makeCanvas(40, 110); paintChimney(c.ctx, 40, 110, theme, v); buildings.chimney.push(c.canvas);
    c = makeCanvas(64, 100); paintWaterTower(c.ctx, 64, 100, theme); buildings.water.push(c.canvas);
    c = makeCanvas(140, 72); paintGrandstand(c.ctx, 140, 72, theme, v); buildings.stand.push(c.canvas);
    c = makeCanvas(220, 110); paintGrandstandBlock(c.ctx, 220, 110, theme, v); buildings.standBlock.push(c.canvas);
  }
  // Procedural fallback for infield-light beads (only when no pack warehouse)
  if (buildings.warehouse.length) buildings.warehouseSm = buildings.warehouse.slice(0, 3);

  for (let v = 0; v < 12; v++) {
    const c = makeCanvas(28, 40);
    paintCharacter(c.ctx, 28, 40, theme, v);
    characters.push(c.canvas);
  }
  for (let v = 0; v < 4; v++) {
    let c;
    c = makeCanvas(24, 28); paintBarrel(c.ctx, 24, 28, theme, v); props.barrel.push(c.canvas);
    c = makeCanvas(22, 26); paintCone(c.ctx, 22, 26); props.cone.push(c.canvas);
    c = makeCanvas(36, 56); paintLight(c.ctx, 36, 56, theme, v); props.light.push(c.canvas);
    c = makeCanvas(64, 28); paintFence(c.ctx, 64, 28, theme); props.fence.push(c.canvas);
    if (!hasPackPalms) {
      c = makeCanvas(48, 64); paintPalm(c.ctx, 48, 64, theme, v); props.palm.push(c.canvas);
    }
    c = makeCanvas(48, 64); paintStreetlamp(c.ctx, 48, 64, theme, v); props.lamp.push(c.canvas);
  }

  // Prefer realistic pack art for warehouse / tower / grandstand / crowd / props / palms / billboards
  applyPackBuildingArt(buildings, characters, props);

  return { buildings, characters, props, theme };
}

/** Swap warehouse / tower / stand / crowd / props / palms / billboards when pack sprites are ready. */
function applyPackBuildingArt(buildings, characters, props) {
  const pack = getAssetPack();
  if (!pack || !pack.ready || !pack.scenery) return;
  const sc = pack.scenery;
  if (sc.warehouseSm || sc.warehouseMd || sc.warehouse) {
    const variants = [];
    // Prefer Md first (v27 pack fidelity — larger stamps at race zoom)
    if (sc.warehouseMd) variants.push(sc.warehouseMd);
    if (sc.warehouseSm) variants.push(sc.warehouseSm);
    if (sc.warehouse && variants.length < 2) variants.push(fitPackSprite(sc.warehouse, 140, 110));
    buildings.warehouse = variants.length ? variants : buildings.warehouse;
    if (sc.warehouseSm) buildings.warehouseSm = [sc.warehouseSm];
    else if (variants.length) buildings.warehouseSm = [variants[variants.length - 1]];
    // Clear procedural cyan-window cards when pack warehouse present
    if (variants.length) {
      /* pack replaces procedural slot entirely */
    }
  }
  if (sc.towerSm || sc.towerMd || sc.tower) {
    const variants = [];
    if (sc.towerSm) variants.push(sc.towerSm);
    if (sc.towerMd) variants.push(sc.towerMd);
    if (sc.tower && variants.length < 2) variants.push(fitPackSprite(sc.tower, 56, 128));
    buildings.tower = variants.length ? variants : buildings.tower;
    if (sc.towerSm) buildings.towerSm = [sc.towerSm];
    else if (variants.length) buildings.towerSm = [variants[0]];
  }
  if (sc.stand || sc.grandstand) {
    const stand = sc.stand || fitPackSprite(sc.grandstand, 160, 80);
    buildings.stand = [stand];
  }
  // v2.3: large grandstand → standBlock / standLarge for S/F mass
  if (sc.standLarge || sc.standBlock || sc.grandstandLarge || sc.grandstand) {
    const block = sc.standLarge || sc.standBlock
      || (sc.grandstandLarge && fitPackSprite(sc.grandstandLarge, 300, 150))
      || fitPackSprite(sc.grandstand, 240, 120);
    buildings.standBlock = [block];
    if (sc.standLarge || sc.grandstandLarge) {
      buildings.standLarge = [sc.standLarge || fitPackSprite(sc.grandstandLarge, 300, 150)];
    }
  }
  // Crowd: dense pack ONLY at S/F + major apexes — thin colourful strips retired (v18)
  if (characters) {
    const dense = [];
    if (sc.crowdDenseLg) dense.push(sc.crowdDenseLg);
    if (sc.crowdDenseMd) dense.push(sc.crowdDenseMd);
    if (sc.crowdDenseSm) dense.push(sc.crowdDenseSm);
    if (sc.crowdDense && !dense.length) dense.push(fitPackSprite(sc.crowdDense, 160, 72));
    // Fallback: if no dense sheet, use largest crowd cut only (never thin strip sheet)
    if (!dense.length && sc.crowdLg) dense.push(sc.crowdLg);
    if (!dense.length && sc.crowd) dense.push(fitPackSprite(sc.crowd, 140, 64));
    if (dense.length) {
      characters.length = 0;
      for (const v of dense) {
        try { v.__radCrowd = 'dense'; } catch (_) {}
        characters.push(v);
      }
      buildings._crowdDense = dense;
      buildings._crowdThin = []; // retired
    }
  }
  // Props sheet → cones/barrels at pits/start; tyrewall for apex stacks
  if (props) {
    if (sc.propCone || sc.propBarrel || sc.propsSm || sc.props) {
      const cone = sc.propCone || sc.propsSm || fitPackSprite(sc.props, 28, 32);
      const barrel = sc.propBarrel || sc.propsMd || fitPackSprite(sc.props, 32, 36);
      if (cone) props.cone = [cone];
      if (barrel) props.barrel = [barrel];
    }
    if (sc.tyrewallSm || sc.tyrewallMd || sc.tyrewall) {
      const variants = [];
      if (sc.tyrewallSm) variants.push(sc.tyrewallSm);
      if (sc.tyrewallMd) variants.push(sc.tyrewallMd);
      if (sc.tyrewall && !variants.length) variants.push(fitPackSprite(sc.tyrewall, 64, 40));
      props.tyrewall = variants.length ? variants : (props.tyrewall || []);
    }
    // Palms sheet → retire procedural palms when pack art present
    if (sc.palmSm || sc.palmMd || sc.palms || sc.palm) {
      const variants = [];
      if (sc.palmSm) variants.push(sc.palmSm);
      if (sc.palmMd) variants.push(sc.palmMd);
      if (sc.palms && variants.length < 2) variants.push(fitPackSprite(sc.palms, 56, 76));
      if (sc.palm && variants.length < 2) variants.push(fitPackSprite(sc.palm, 56, 76));
      if (variants.length) props.palm = variants;
    }
  }
  // Billboard sheet → retire procedural neon-frame billboards
  if (sc.billboardSm || sc.billboardMd || sc.billboard) {
    const variants = [];
    if (sc.billboardMd) variants.push(sc.billboardMd);
    if (sc.billboardSm) variants.push(sc.billboardSm);
    if (sc.billboard && variants.length < 2) variants.push(fitPackSprite(sc.billboard, 140, 100));
    if (variants.length) buildings.billboard = variants;
    if (sc.billboardMd) buildings.billboardMd = [sc.billboardMd];
    else if (variants.length) buildings.billboardMd = [variants[0]];
  }
  // v2.5/v27 Cargo quay — Md preferred; never outside cargo_dock (profile.quayAssets)
  if (sc.crane || sc.craneMd || sc.craneSm) {
    const variants = [];
    // v28: prefer Md only for race-readable quay landmarks (skip Sm)
    if (sc.craneMd) variants.push(sc.craneMd);
    else if (sc.crane) variants.push(sc.crane);
    else if (sc.craneSm) variants.push(sc.craneSm);
    buildings.crane = variants;
  }
  if (sc.containers || sc.containersMd || sc.containersSm) {
    const variants = [];
    if (sc.containersMd) variants.push(sc.containersMd);
    if (sc.containersSm) variants.push(sc.containersSm);
    if (sc.containers) variants.push(sc.containers);
    buildings.containers = variants;
  }
  // A.1 city circuit — unique base + -b plates into Md/Sm pools (not only LOD of one source)
  {
    const cbMdPool = [];
    const cbSmPool = [];
    if (sc.cityblockMdVariants && sc.cityblockMdVariants.length) cbMdPool.push(...sc.cityblockMdVariants);
    else {
      if (sc.cityblockMd) cbMdPool.push(sc.cityblockMd);
      if (sc.cityblockBMd || sc['cityblock-b-md']) cbMdPool.push(sc.cityblockBMd || sc['cityblock-b-md']);
      if (sc.cityblockCMd || sc['cityblock-c-md']) cbMdPool.push(sc.cityblockCMd || sc['cityblock-c-md']);
      if (sc['cityblock-b'] && !cbMdPool.includes(sc['cityblock-b'])) cbMdPool.push(sc['cityblock-b']);
      if (sc['cityblock-c'] && !cbMdPool.includes(sc['cityblock-c'])) cbMdPool.push(sc['cityblock-c']);
      if (sc.cityblock && !cbMdPool.includes(sc.cityblock)) cbMdPool.push(sc.cityblock);
    }
    if (sc.cityblockSmVariants && sc.cityblockSmVariants.length) cbSmPool.push(...sc.cityblockSmVariants);
    else {
      if (sc.cityblockSm) cbSmPool.push(sc.cityblockSm);
      if (sc.cityblockBSm || sc['cityblock-b-sm']) cbSmPool.push(sc.cityblockBSm || sc['cityblock-b-sm']);
      if (sc.cityblockCSm || sc['cityblock-c-sm']) cbSmPool.push(sc.cityblockCSm || sc['cityblock-c-sm']);
    }
    if (cbMdPool.length || cbSmPool.length) {
      buildings.cityblock = cbMdPool.length ? cbMdPool.slice() : cbSmPool.slice();
      buildings.cityblockMd = cbMdPool.length ? cbMdPool.slice() : buildings.cityblock.slice();
      buildings.cityblockSm = cbSmPool.length ? cbSmPool.slice() : buildings.cityblockMd.slice();
    }
  }
  {
    const csMdPool = [];
    const csSmPool = [];
    if (sc.citystreetMdVariants && sc.citystreetMdVariants.length) csMdPool.push(...sc.citystreetMdVariants);
    else {
      if (sc.citystreetMd) csMdPool.push(sc.citystreetMd);
      if (sc.citystreetBMd || sc['citystreet-b-md']) csMdPool.push(sc.citystreetBMd || sc['citystreet-b-md']);
      if (sc.citystreetCMd || sc['citystreet-c-md']) csMdPool.push(sc.citystreetCMd || sc['citystreet-c-md']);
      if (sc['citystreet-b'] && !csMdPool.includes(sc['citystreet-b'])) csMdPool.push(sc['citystreet-b']);
      if (sc['citystreet-c'] && !csMdPool.includes(sc['citystreet-c'])) csMdPool.push(sc['citystreet-c']);
      if (sc.citystreet && !csMdPool.includes(sc.citystreet)) csMdPool.push(sc.citystreet);
    }
    if (sc.citystreetSmVariants && sc.citystreetSmVariants.length) csSmPool.push(...sc.citystreetSmVariants);
    else {
      if (sc.citystreetSm) csSmPool.push(sc.citystreetSm);
      if (sc.citystreetBSm || sc['citystreet-b-sm']) csSmPool.push(sc.citystreetBSm || sc['citystreet-b-sm']);
      if (sc.citystreetCSm || sc['citystreet-c-sm']) csSmPool.push(sc.citystreetCSm || sc['citystreet-c-sm']);
    }
    if (csMdPool.length || csSmPool.length) {
      buildings.citystreet = csMdPool.length ? csMdPool.slice() : csSmPool.slice();
      buildings.citystreetMd = csMdPool.length ? csMdPool.slice() : buildings.citystreet.slice();
      buildings.citystreetSm = csSmPool.length ? csSmPool.slice() : buildings.citystreetMd.slice();
    }
  }
  // Contiguous city fabric plates (Neon/Gridlock ring)
  {
    const cfMdPool = [];
    const cfSmPool = [];
    if (sc.cityfabricMdVariants && sc.cityfabricMdVariants.length) cfMdPool.push(...sc.cityfabricMdVariants);
    else {
      if (sc.cityfabricMd) cfMdPool.push(sc.cityfabricMd);
      if (sc.cityfabricRowMd || sc['cityfabric-row-md']) cfMdPool.push(sc.cityfabricRowMd || sc['cityfabric-row-md']);
      if (sc['cityfabric-row'] && !cfMdPool.includes(sc['cityfabric-row'])) cfMdPool.push(sc['cityfabric-row']);
      if (sc.cityfabric && !cfMdPool.includes(sc.cityfabric)) cfMdPool.push(sc.cityfabric);
    }
    if (sc.cityfabricSmVariants && sc.cityfabricSmVariants.length) cfSmPool.push(...sc.cityfabricSmVariants);
    else {
      if (sc.cityfabricSm) cfSmPool.push(sc.cityfabricSm);
      if (sc.cityfabricRowSm || sc['cityfabric-row-sm']) cfSmPool.push(sc.cityfabricRowSm || sc['cityfabric-row-sm']);
    }
    if (cfMdPool.length || cfSmPool.length) {
      buildings.cityfabric = cfMdPool.length ? cfMdPool.slice() : cfSmPool.slice();
      buildings.cityfabricMd = cfMdPool.length ? cfMdPool.slice() : buildings.cityfabric.slice();
      buildings.cityfabricSm = cfSmPool.length ? cfSmPool.slice() : buildings.cityfabricMd.slice();
    }
  }
}

function fitPackSprite(source, maxW, maxH) {
  if (!source) return null;
  const sw = source.width || 1;
  const sh = source.height || 1;
  const s = Math.min(maxW / sw, maxH / sh);
  const dw = Math.max(1, Math.round(sw * s));
  const dh = Math.max(1, Math.round(sh * s));
  const { canvas, ctx } = makeCanvas(dw, dh);
  ctx.clearRect(0, 0, dw, dh);
  ctx.drawImage(source, 0, 0, dw, dh);
  return canvas;
}


function pickCrowd(sprites, rnd, preferDense) {
  const dense = sprites.buildings && sprites.buildings._crowdDense;
  if (dense && dense.length) return pick(dense, rnd);
  // Never fall back to thin strip sheets
  const chars = (sprites.characters || []).filter((c) => c && c.__radCrowd !== 'thin');
  if (chars.length) return pick(chars, rnd);
  return null;
}

function pick(arr, rnd) {
  return arr[(rnd() * arr.length) | 0];
}

function addItem(list, img, x, y, scale, layer, sortY, kind, opts) {
  if (!img) return;
  // Shorthand: addItem(..., layer, 'crowd') — string 7th arg is kind, not sortY
  let sy = sortY;
  let k = kind || null;
  let o = opts || null;
  if (k == null && typeof sy === 'string' && (sy === 'crowd' || sy === 'prop' || sy === 'building')) {
    k = sy;
    sy = y;
  }
  if (o == null && k && typeof k === 'object') { o = k; k = null; }
  // Retire thin colourful crowd strips; keep dense pack masses (v18)
  let s = scale;
  if (img.__radCrowd === 'thin') return;
  if (k === 'crowd' || (!k && img.width / Math.max(1, img.height) > 2.4 && img.width > 70)) {
    k = 'crowd';
    const aspect = img.width / Math.max(1, img.height);
    // Dense pack sheets may be wide; only drop unmarked/thin landscape strips
    if (img.__radCrowd !== 'dense' && aspect > 2.2) return;
  }
  const item = {
    img,
    x,
    y,
    w: img.width * s,
    h: img.height * s,
    layer,
    sortY: sy != null ? sy : y,
    kind: k
  };
  if (o) {
    if (o.flipX) item.flipX = true;
    if (o.rot) item.rot = o.rot;
  }
  list.push(item);
}

function tryPlace(track, x, y, pad) {
  if (x < -80 || y < -80 || x > track.width + 80 || y > track.height + 80) return false;
  if (isOnAsphalt(track, x, y)) return false;
  // keep clear of asphalt by sampling nearby
  if (isOnAsphalt(track, x + pad, y) || isOnAsphalt(track, x - pad, y)) return false;
  if (isOnAsphalt(track, x, y + pad) || isOnAsphalt(track, x, y - pad)) return false;
  return true;
}

/** Cap identical stamp repeats within a radius; returns false if too many matches nearby. */
function stampOk(placed, img, x, y, radius, maxSame) {
  if (!img || !placed) return true;
  let n = 0;
  const r2 = radius * radius;
  for (const p of placed) {
    if (p.img !== img) continue;
    const dx = p.x - x, dy = p.y - y;
    if (dx * dx + dy * dy < r2) {
      n++;
      if (n >= maxSame) return false;
    }
  }
  return true;
}

/** Plate family key for A.1.1 anti-clone (cityblock / cityblock-b / …). */
function plateSrcKey(img) {
  if (!img) return null;
  return img._srcKey || img.__srcKey || null;
}

/** All alternate plates in a city family trio (base / -b / -c). */
function cityFamilyKeys(key) {
  if (!key) return [];
  if (key === 'cityblock' || key === 'cityblock-b' || key === 'cityblock-c') {
    return ['cityblock', 'cityblock-b', 'cityblock-c'];
  }
  if (key === 'citystreet' || key === 'citystreet-b' || key === 'citystreet-c') {
    return ['citystreet', 'citystreet-b', 'citystreet-c'];
  }
  return [];
}

/** Prefer next plate in trio for A.1.1 anti-clone within ~400wu. */
function cityAlternateKey(key) {
  const fam = cityFamilyKeys(key);
  if (fam.length < 2) return null;
  const i = fam.indexOf(key);
  if (i < 0) return fam[0];
  return fam[(i + 1) % fam.length];
}

/** Remaining trio keys excluding `key` (prefer -c when fleeing base↔-b lookalikes). */
function cityAlternateKeys(key) {
  const fam = cityFamilyKeys(key);
  if (!fam.length) return [];
  const rest = fam.filter((k) => k !== key);
  // Prefer -c first when leaving base or -b (stronger visual separation)
  rest.sort((a, b) => {
    const ac = a.endsWith('-c') ? 0 : 1;
    const bc = b.endsWith('-c') ? 0 : 1;
    return ac - bc;
  });
  return rest;
}

function varyScale(rnd, lo, hi) {
  return lo + rnd() * (hi - lo);
}

/** A.1 city circuit: mid/near = cityblock + citystreet + billboard only; far = darker cityblockSm. */
function cityStampVariety(rnd, kind) {
  // Anti-clone: flip / small rot or 180 / ±10–15% scale jitter
  const flipX = rnd() < 0.48;
  let rot = 0;
  const r = rnd();
  if (r < 0.18) rot = Math.PI; // 180 flip
  else if (r < 0.42) rot = (rnd() - 0.5) * 0.22; // ~±6°
  else if (r < 0.55) rot = (rnd() - 0.5) * 0.12;
  const jitter = 1 + (rnd() - 0.5) * 0.28; // ±14%
  return { flipX, rot, jitter };
}

function pickCityCircuitStamp(sprites, profile, rnd, opts = {}) {
  const preferFar = !!opts.preferFar;
  const preferFabric = !!opts.preferFabric;
  // warehouseBias → 0: never emit warehouse for cityCircuit profiles
  const cfMd = (sprites.buildings.cityfabricMd && sprites.buildings.cityfabricMd.length)
    ? sprites.buildings.cityfabricMd
    : (sprites.buildings.cityfabric || []);
  const cfSm = (sprites.buildings.cityfabricSm && sprites.buildings.cityfabricSm.length)
    ? sprites.buildings.cityfabricSm
    : cfMd;
  const cbSm = (sprites.buildings.cityblockSm && sprites.buildings.cityblockSm.length)
    ? sprites.buildings.cityblockSm
    : null;
  const cbMd = (sprites.buildings.cityblockMd && sprites.buildings.cityblockMd.length)
    ? sprites.buildings.cityblockMd
    : (sprites.buildings.cityblock || []);
  const csMd = (sprites.buildings.citystreetMd && sprites.buildings.citystreetMd.length)
    ? sprites.buildings.citystreetMd
    : (sprites.buildings.citystreet || []);
  const bbMd = (sprites.buildings.billboardMd && sprites.buildings.billboardMd.length)
    ? sprites.buildings.billboardMd
    : (sprites.buildings.billboard || []);
  const u = rnd();
  const cfW = Math.max(0, profile.cityfabricBias || 0);
  // Accents are sparse — allow near-zero weights (no floor that re-inflates cityblock/street)
  const cbW = Math.max(0, profile.cityblockBias || 0);
  const csW = Math.max(0, profile.citystreetBias || 0);
  const bbW = Math.max(0, profile.billboardBias || 0);
  const sum = cfW + cbW + csW + bbW;
  const cfCut = cfW / sum;
  const cbCut = cfCut + cbW / sum;
  const csCut = cbCut + csW / sum;

  function wrap(img, kind, lo, hi) {
    if (!img) return null;
    const v = cityStampVariety(rnd, kind);
    // Fabric: always flipX chance + small rot jitter (FAR anti-band); rare 180
    const rot = (kind === 'cityfabric')
      ? ((rnd() < 0.10) ? Math.PI : (rnd() - 0.5) * 0.14)
      : v.rot;
    return {
      img,
      kind,
      scale: varyScale(rnd, lo, hi) * (kind === 'cityfabric' ? (1 + (rnd() - 0.5) * 0.12) : v.jitter),
      flipX: kind === 'cityfabric' ? (rnd() < 0.5) : v.flipX,
      rot
    };
  }

  if (preferFabric && cfMd.length) {
    return wrap(pick(cfMd, rnd), 'cityfabric', 1.15, 1.55);
  }
  if (preferFar) {
    if (cfSm.length && rnd() < 0.72) return wrap(pick(cfSm, rnd), 'cityfabric', 0.85, 1.15);
    const farPool = cbSm && cbSm.length ? cbSm : cbMd;
    if (farPool.length) return wrap(pick(farPool, rnd), 'cityblock', 0.72, 1.05);
    if (csMd.length) return wrap(pick(csMd, rnd), 'citystreet', 0.7, 0.98);
    return null;
  }
  if (u < cfCut && cfMd.length) {
    return wrap(pick(cfMd, rnd), 'cityfabric', 1.1, 1.5);
  }
  if (u < cbCut && cbMd.length) {
    return wrap(pick(cbMd, rnd), 'cityblock', 0.9, 1.28);
  }
  if (u < csCut && csMd.length) {
    return wrap(pick(csMd, rnd), 'citystreet', 0.88, 1.22);
  }
  if (bbW > 0.001 && bbMd.length) {
    return wrap(pick(bbMd, rnd), 'billboard', 0.88, 1.25);
  }
  if (cfMd.length) return wrap(pick(cfMd, rnd), 'cityfabric', 1.1, 1.45);
  if (cbMd.length) return wrap(pick(cbMd, rnd), 'cityblock', 0.9, 1.2);
  if (csMd.length) return wrap(pick(csMd, rnd), 'citystreet', 0.88, 1.18);
  return null;
}

/** Keep largest stamps first; enforce spacing so caps favour landmarks over beads. */
function enforceLayerCap(list, cap, minDist) {
  if (!list || list.length <= cap) return list || [];
  const scored = list.slice().sort((a, b) => {
    const sa = (a.w || 0) * (a.h || 0);
    const sb = (b.w || 0) * (b.h || 0);
    return sb - sa;
  });
  const kept = [];
  const d2 = (minDist || 140) ** 2;
  for (const it of scored) {
    if (kept.length >= cap) break;
    let ok = true;
    for (const k of kept) {
      const dx = k.x - it.x, dy = k.y - it.y;
      if (dx * dx + dy * dy < d2) { ok = false; break; }
    }
    if (ok) kept.push(it);
  }
  // If spacing rejected too many, fill remaining by size without spacing
  if (kept.length < cap) {
    for (const it of scored) {
      if (kept.length >= cap) break;
      if (!kept.includes(it)) kept.push(it);
    }
  }
  return kept.sort((a, b) => a.sortY - b.sortY);
}

/**
 * Shared Neon Loop density rules (frozen v23 / rolled v24) + per-track stamp mix.
 * Lighting / bead cadence / caps are shared; stamp bias + identity colour are per-track.
 */
export const SCENERY_DENSITY = {
  // Both-sides beads (world units along densified perimeter)
  beadOut: 480,
  beadIn: 560,
  towerCap: 5,
  billboardCap: 5,
  // Phase A visible stamp budgets (build + draw)
  midCap: 18,
  farCap: 10,
  nearCap: 12,
  // Infield yard props (scaled later by profile)
  infieldYardBase: 22
};

/**
 * @param {object} track
 * @returns {{
 *   id: string,
 *   beadOut: number, beadIn: number,
 *   towerCap: number, billboardCap: number,
 *   infieldYardN: number,
 *   palmChance: number,
 *   warehouseScale: [number, number],
 *   standBias: number,       // 0..1 extra stand preference (mid / pinch)
 *   warehouseBias: number,   // 0..1 extra warehouse preference
 *   billboardBias: number,   // 0..1 extra billboard preference
 *   pinchStandExtra: number, // extra stand stacks at kink/chicane (razor)
 *   label: string
 * }}
 */
export function getSceneryDensityProfile(track) {
  const id = (track && track.id) || 'neon_loop';
  const base = {
    id,
    beadOut: SCENERY_DENSITY.beadOut,
    beadIn: SCENERY_DENSITY.beadIn,
    towerCap: SCENERY_DENSITY.towerCap,
    billboardCap: SCENERY_DENSITY.billboardCap,
    infieldYardN: SCENERY_DENSITY.infieldYardBase,
    palmChance: 0.12,
    lampChance: 0.18,
    warehouseScale: [0.8, 1.35],
    standBias: 0.35,
    warehouseBias: 0.55,
    billboardBias: 0.12,
    pinchStandExtra: 0,
    urbanSkyline: false,     // Gridlock: warehouseSm + billboardMd + towerSm beads
    cityCircuit: false,      // Neon/Gridlock: cityblock + citystreet + billboards
    cityfabricBias: 0,
    cityblockBias: 0,
    citystreetBias: 0,
    midCap: SCENERY_DENSITY.midCap,
    farCap: SCENERY_DENSITY.farCap,
    nearCap: SCENERY_DENSITY.nearCap,
    pinchStandsOnly: false,  // Razor: stands only at narrow pinch
    pinchRadius: 240,        // Razor: expanded stands-only zone around waists
    standsOnlyAtSF: false,   // Cargo: grandstands only at S/F
    quayAssets: false,       // Cargo: crane + containers
    craneCount: 0,
    containerBias: 0,
    infieldDark: false,
    infieldGapMul: 1,        // >1 → harder gaps (Gridlock continuous-wall fix)
    label: 'reference'
  };
  if (id === 'gridlock') {
    // vintage-sprint: flat fills, no city carpet / fabric / rooftop (perf pivot)
    return {
      ...base,
      beadOut: 99999,
      beadIn: 99999,
      billboardCap: 0,
      billboardBias: 0,
      warehouseScale: [0.68, 1.05],
      warehouseBias: 0,
      standBias: 0,
      infieldYardN: 0,
      palmChance: 0,
      lampChance: 0,
      urbanSkyline: false,
      cityCircuit: false,
      cityfabricBias: 0,
      cityblockBias: 0,
      citystreetBias: 0,
      towerCap: 0,
      standsOnlyAtSF: true,
      infieldGapMul: 1,
      midCap: 0,
      farCap: 0,
      nearCap: 0,
      cityAccentCap: 0,
      vintageFast: true,
      label: 'vintage_sprint_gridlock'
    };
  }
  if (id === 'razor_hairpin') {
    // Night canyon (v28): stands-only pinch; warehouseBias ~0; darker infield
    return {
      ...base,
      standBias: 0.9,
      warehouseBias: 0.06,
      billboardBias: 0.06,
      pinchStandExtra: 8,
      pinchStandsOnly: true,
      pinchRadius: 360,
      infieldYardN: 6,
      palmChance: 0.015,
      lampChance: 0.12,
      warehouseScale: [0.72, 1.1],
      infieldDark: true,
      infieldGapMul: 1.25,
      label: 'night_canyon'
    };
  }
  if (id === 'cargo_dock') {
    // Industrial quay: warehouse+containers on long straight; stands only at S/F; crane landmarks
    return {
      ...base,
      warehouseBias: 0.9,
      standBias: 0.08,
      billboardBias: 0.08,
      warehouseScale: [0.88, 1.5],
      infieldYardN: 18,
      palmChance: 0.03,
      lampChance: 0.16,
      standsOnlyAtSF: true,
      quayAssets: true,
      craneCount: 3,
      containerBias: 0.18, // fewer larger Md — let horizon peek at grid (v27)
      label: 'industrial_quay'
    };
  }
  // neon_loop — vintage-sprint flat arcade (city carpet paused)
  return {
    ...base,
    beadOut: 99999,
    beadIn: 99999,
    infieldYardN: 0,
    palmChance: 0,
    lampChance: 0,
    standBias: 0,
    warehouseBias: 0,
    billboardBias: 0,
    billboardCap: 0,
    towerCap: 0,
    cityCircuit: false,
    cityfabricBias: 0,
    cityblockBias: 0,
    citystreetBias: 0,
    midCap: 0,
    farCap: 0,
    nearCap: 0,
    cityAccentCap: 0,
    vintageFast: true,
    label: 'vintage_sprint_neon'
  };
}

/**
 * Build layered scenery placements for a track (cached by caller).
 */
export function buildTrackScenery(track) {
  const theme = themeFor(track);
  const profile = getSceneryDensityProfile(track);
  const sprites = createScenerySprites(theme);
  const rnd = mulberry32(hashStr(track.id || 'track') ^ 0x5c3e17);
  const far = [];
  const mid = [];
  const near = [];

  // vintage-sprint: skip ALL heavy stamp / fabric / rooftop paths — flat fills + sparse vintage props
  if (profile.vintageFast) {
    const start = track.spawns && track.spawns[0];
    const startX = start ? start.x : track.width * 0.5;
    const startY = start ? start.y : track.height * 0.2;
    const ground = buildVintageGroundPlate(track, theme);
    const skyline = null; // no pack skyline cost on race path
    const midV = [];
    const nearV = [];
    // Sparse roadside from vintage-fast-v1 (hard cap ≤16 world stamps)
    const ROAD_CAP = 16;
    try {
      const pack = getAssetPack();
      const props = (pack && pack.vintage && pack.vintage.props) ? pack.vintage.props : null;
      if (props && Object.keys(props).length) {
        const id = track.id || '';
        // Identity: Neon prefers tree; Gridlock prefers lamp; shared tyre/cone/billboard
        const pool = [];
        if (id === 'gridlock') {
          if (props.lamp) pool.push(['lamp', props.lamp]);
          if (props.cone) pool.push(['cone', props.cone]);
          if (props['barrier-tyre']) pool.push(['barrier-tyre', props['barrier-tyre']]);
          if (props.billboard) pool.push(['billboard', props.billboard]);
        } else {
          if (props.tree) pool.push(['tree', props.tree]);
          if (props.cone) pool.push(['cone', props.cone]);
          if (props['barrier-tyre']) pool.push(['barrier-tyre', props['barrier-tyre']]);
          if (props.billboard) pool.push(['billboard', props.billboard]);
        }
        const gantry = props['chequer-gantry'] || null;
        const edgesV = perimeterNormals(track.outer);
        let placed = 0;
        // Place along outer wall at large spacing
        let acc = 0;
        const spacing = 520;
        let nextAt = spacing * 0.4;
        let pi = 0;
        for (const e of edgesV) {
          if (placed >= ROAD_CAP) break;
          const end = acc + e.len;
          while (nextAt <= end + 1e-6 && placed < ROAD_CAP) {
            const tt = e.len > 0 ? (nextAt - acc) / e.len : 0.5;
            const bx = e.ax + (e.bx - e.ax) * tt;
            const by = e.ay + (e.by - e.ay) * tt;
            const x = bx + e.nx * (42 + rnd() * 28);
            const y = by + e.ny * (42 + rnd() * 28);
            nextAt += spacing;
            if (isOnAsphalt(track, x, y)) continue;
            if (!pool.length) break;
            const [kind, img] = pool[pi % pool.length];
            pi++;
            const scale = kind === 'billboard' ? 1.1 : (kind === 'tree' || kind === 'lamp' ? 1.0 : 0.85);
            const w = (img.width || 32) * scale;
            const h = (img.height || 32) * scale;
            midV.push({
              img, x, y, w, h, scale, kind, sortY: y + h * 0.45, layer: 'mid'
            });
            placed++;
          }
          acc = end;
        }
        // Start/finish gantry once
        if (gantry && placed < ROAD_CAP) {
          const gx = startX + 10;
          const gy = startY - 70;
          if (!isOnAsphalt(track, gx, gy)) {
            const scale = 1.2;
            const w = (gantry.width || 64) * scale;
            const h = (gantry.height || 48) * scale;
            nearV.push({
              img: gantry, x: gx, y: gy, w, h, scale,
              kind: 'chequer-gantry', sortY: gy + h * 0.5, layer: 'near'
            });
            placed++;
          }
        }
      }
    } catch (_) {}
    const stampCounts = {
      tower: 0, billboard: midV.filter((i) => i.kind === 'billboard').length,
      crane: 0, containers: 0,
      cityblock: 0, citystreet: 0, cityfabric: 0, cityAccents: 0,
      warehouse: 0, warehouseAfterScrub: 0,
      far: 0, mid: midV.length, near: nearV.length,
      farRaw: 0, midRaw: midV.length, nearRaw: nearV.length,
      caps: { mid: ROAD_CAP, far: 0, near: 4, fabricUncapped: false, cityAccentCap: 0, vintageFast: true },
      roadsideCap: ROAD_CAP,
      roadsideTotal: midV.length + nearV.length,
      mode: 'vintage-sprint'
    };
    try {
      if (typeof window !== 'undefined') {
        window.__RAD_VINTAGE_FAST__ = {
          track: track.id,
          stamps: midV.length + nearV.length,
          rooftop: false, fabric: false, mode: 'vintage-sprint',
          props: stampCounts.roadsideTotal
        };
      }
    } catch (_) {}
    return {
      trackId: track.id,
      theme,
      profile,
      sprites,
      far: [],
      mid: midV,
      near: nearV,
      nearThin: nearV.slice(0, 4),
      skyline,
      ground,
      startX,
      startY,
      beadAnchors: [],
      beadSpacing: profile.beadOut,
      beadSpacingIn: profile.beadIn,
      stampCounts
    };
  }
  const edges = perimeterNormals(track.outer);
  // When pack art is ready, cut remaining procedural neon-framed kinds so they don't dominate
  const packReady = !!(getAssetPack() && getAssetPack().ready);
  const proceduralCut = packReady; // shop / chimney / water still procedural

  const start = track.spawns && track.spawns[0];
  const startX = start ? start.x : track.width * 0.5;
  const startY = start ? start.y : track.height * 0.2;

  // Landmark anchors (from track) + mid-straight beads so long circuits aren't empty corridors
  const landmarks = (track.landmarks && track.landmarks.length)
    ? track.landmarks.slice()
    : [{ id: 'start_finish', x: startX, y: startY, kind: 'start' }];

  // Scale spacing / landmark radii with perimeter so long circuits don't explode stamp count
  const sizeScale = Math.sqrt(((track.width || 1600) * (track.height || 1000)) / (1600 * 1000));
  const ss = Math.max(1, Math.min(2.2, sizeScale));
  const stepFar = 84 * ss;
  const stepMid = 62 * ss;
  const stepNear = 48 * ss; // was 40 — fewer palms/props on long tracks
  // Shared density (Neon Loop frozen v23 → all tracks v24):
  //   outfield beadOut wu → warehouse / standLarge (richer, still gapped)
  //   infield  beadIn  wu → warehouseSm / stand only (lighter; gaps required)
  // Per-track: stamp mix / caps / palm chance via profile (not mood clone)
  const BEAD_SPACING = profile.beadOut;
  const BEAD_SPACING_IN = profile.beadIn;

  // Mid-straight landmark beads — arc-length along densified perimeter (edges are short)
  const beadAnchors = [];
  function pushBead(x, y, side) {
    const minGap = (side === 'in' ? BEAD_SPACING_IN : BEAD_SPACING) * 0.7;
    for (const lm of landmarks) {
      if (lm.kind === 'bead') continue;
      // Infield: allow closer to corner landmarks so race-zoom apexes aren't empty
      const clear = side === 'in' ? 90 : 200;
      if (Math.hypot(x - lm.x, y - lm.y) < clear) return;
    }
    // Spacing only vs same-side beads — outer/inner pairs sit across the lane
    for (const b of beadAnchors) {
      if (b.side !== side) continue;
      if (Math.hypot(x - b.x, y - b.y) < minGap) return;
    }
    beadAnchors.push({ id: `bead_${side}_${beadAnchors.length}`, x, y, kind: 'bead', side });
  }
  function collectArcBeads(polyEdges, inward, side, spacing) {
    let acc = 0;
    let nextAt = spacing * 0.5;
    for (const e of polyEdges) {
      const end = acc + e.len;
      while (nextAt <= end + 1e-6) {
        const t = e.len > 0 ? (nextAt - acc) / e.len : 0.5;
        const bx = e.ax + (e.bx - e.ax) * t;
        const by = e.ay + (e.by - e.ay) * t;
        let nearCorner = false;
        for (const lm of landmarks) {
          if (lm.kind === 'corner' || lm.kind === 'chicane' || lm.kind === 'kink' || lm.kind === 'start') {
            if (Math.hypot(bx - lm.x, by - lm.y) < 110) { nearCorner = true; break; }
          }
        }
        // Outfield skips corners; infield still beads near apexes (lighter stamps, gapped)
        if (!nearCorner || side === 'in') {
          const nx = inward ? -e.nx : e.nx;
          const ny = inward ? -e.ny : e.ny;
          // Infield: sit clearly inside inner wall so race zoom reads both sides
          const dist = inward ? (36 + rnd() * 44) : (36 + rnd() * 36);
          const px = bx + nx * dist;
          const py = by + ny * dist;
          if (inward) {
            if (!pointInPoly(px, py, track.inner)) { nextAt += spacing; continue; }
            if (isOnAsphalt(track, px, py)) { nextAt += spacing; continue; }
          }
          pushBead(px, py, side);
        }
        nextAt += spacing;
      }
      acc = end;
    }
  }
  collectArcBeads(edges, false, 'out', BEAD_SPACING);
  const innerEdges = perimeterNormals(track.inner);
  collectArcBeads(innerEdges, true, 'in', BEAD_SPACING_IN);
  // Mirror outer beads into infield (steps must clear asphalt band into inner poly)
  const cx = track.width * 0.5, cy = track.height * 0.5;
  const outBeads = beadAnchors.filter((b) => b.side === 'out').slice();
  for (const ob of outBeads) {
    const dx = cx - ob.x, dy = cy - ob.y;
    const len = Math.hypot(dx, dy) || 1;
    for (const step of [620, 680, 740, 580, 800, 540, 860, 500]) {
      const x = ob.x + (dx / len) * step;
      const y = ob.y + (dy / len) * step;
      if (!pointInPoly(x, y, track.inner)) continue;
      if (isOnAsphalt(track, x, y)) continue;
      // Gaps required on infield — wider clash than outfield
      let clash = false;
      for (const b of beadAnchors) {
        if (b.side !== 'in') continue;
        if (Math.hypot(x - b.x, y - b.y) < BEAD_SPACING_IN * 0.65) { clash = true; break; }
      }
      if (clash) continue;
      beadAnchors.push({ id: `bead_in_m_${beadAnchors.length}`, x, y, kind: 'bead', side: 'in' });
      break;
    }
  }
  for (const b of beadAnchors) landmarks.push(b);

  // Contiguous city fabric (Neon/Gridlock): continuous wall rings + infield/outfield carpet.
  // step ≈ plateWorldWidth × 0.65–0.75 (25–40% overlap). Fabric never intentional gaps.
  let cityAccentCount = 0;
  const CITY_ACCENT_CAP = (profile.cityAccentCap != null ? profile.cityAccentCap : 10);
  function placeCityFabricRing() {
    if (!profile.cityCircuit || profile.vintageFast) return;
    const cfPool = (sprites.buildings.cityfabricMd && sprites.buildings.cityfabricMd.length)
      ? sprites.buildings.cityfabricMd
      : (sprites.buildings.cityfabric || []);
    if (!cfPool.length) return;
    const sampleImg = cfPool[0];
    // plateWorldWidth uses typical fabric scale (~1.3)
    const plateWorldWidth = Math.max(160, (sampleImg.width || 320) * 1.3);
    // Continuous wall-length rings: step ≈ plateW × 0.65–0.75 (25–40% overlap)
    const step = plateWorldWidth * (0.65 + rnd() * 0.10);
    // FAR lock: multi-ring radial stagger + flipX / rot jitter kills clone banding
    function walk(polyEdges, inward, layerList, layerName, ringIdx) {
      const phase = (ringIdx * 0.37 + (inward ? 0.19 : 0)) * step;
      const radialBase = inward
        ? (40 + ringIdx * 52)
        : (46 + ringIdx * 58);
      let acc = 0;
      let nextAt = step * 0.12 + phase;
      let plateI = ringIdx % Math.max(1, cfPool.length);
      for (const e of polyEdges) {
        const end = acc + e.len;
        while (nextAt <= end + 1e-6) {
          const t = e.len > 0 ? (nextAt - acc) / e.len : 0.5;
          const bx = e.ax + (e.bx - e.ax) * t;
          const by = e.ay + (e.by - e.ay) * t;
          const nx = inward ? -e.nx : e.nx;
          const ny = inward ? -e.ny : e.ny;
          // Radial stagger between rings (+ small along-wall jitter)
          const dist = radialBase + rnd() * 28 + (rnd() - 0.5) * 10;
          const along = (rnd() - 0.5) * step * 0.08;
          const tx = -(ny), ty = nx; // tangent
          const x = bx + nx * dist + tx * along;
          const y = by + ny * dist + ty * along;
          nextAt += step;
          if (inward) {
            if (!pointInPoly(x, y, track.inner)) continue;
            if (isOnAsphalt(track, x, y)) continue;
          } else {
            if (isOnAsphalt(track, x, y)) continue;
          }
          const pickC = pickCityCircuitStamp(sprites, profile, rnd, { preferFabric: true });
          if (!pickC || !pickC.img) continue;
          // Prefer rotating a/b/c along the ring to break same-src bands
          let img = pickC.img;
          if (cfPool.length > 1) {
            img = cfPool[plateI % cfPool.length] || img;
            plateI++;
          }
          const scale = pickC.scale || varyScale(rnd, 1.15, 1.5);
          // Always randomise flipX; small rot jitter (or rare 180)
          const flipX = rnd() < 0.5;
          let rot = (rnd() - 0.5) * 0.14; // ~±4°
          if (rnd() < 0.10) rot = Math.PI;
          const opts = { flipX, rot };
          tryAddStamp(layerList, img, x, y, scale, layerName, y, 'cityfabric', opts);
        }
        acc = end;
      }
    }
    // Outer rings (0..2) + inner rings (0..1), phase-staggered — 3rd outer kills FAR stamp-cliff
    walk(edges, false, mid, 'mid', 0);
    walk(edges, false, mid, 'mid', 1);
    walk(edges, false, far, 'far', 2);
    walk(innerEdges, true, mid, 'mid', 0);
    walk(innerEdges, true, mid, 'mid', 1);
    // Sparse accents only (~8–12 total) — not the density engine
    const accentStep = step * 3.2;
    function walkAccent(polyEdges, inward) {
      let acc = 0;
      let nextAt = accentStep * 0.55;
      for (const e of polyEdges) {
        const end = acc + e.len;
        while (nextAt <= end + 1e-6) {
          const t = e.len > 0 ? (nextAt - acc) / e.len : 0.5;
          const bx = e.ax + (e.bx - e.ax) * t;
          const by = e.ay + (e.by - e.ay) * t;
          const nx = inward ? -e.nx : e.nx;
          const ny = inward ? -e.ny : e.ny;
          const dist = inward ? (70 + rnd() * 40) : (80 + rnd() * 50);
          const x = bx + nx * dist;
          const y = by + ny * dist;
          nextAt += accentStep;
          if (cityAccentCount >= CITY_ACCENT_CAP) return;
          if (isOnAsphalt(track, x, y)) continue;
          if (inward && !pointInPoly(x, y, track.inner)) continue;
          const pickC = pickCityCircuitStamp(sprites, profile, rnd, {});
          if (!pickC || !pickC.img) continue;
          if (pickC.kind !== 'cityblock' && pickC.kind !== 'citystreet') continue;
          const opts = (pickC.flipX || pickC.rot) ? { flipX: !!pickC.flipX, rot: pickC.rot || 0 } : null;
          tryAddStamp(mid, pickC.img, x, y, pickC.scale || varyScale(rnd, 0.9, 1.2), 'mid', y, pickC.kind, opts);
        }
        acc = end;
      }
    }
    walkAccent(edges, false);
    walkAccent(innerEdges, true);
  }

  /** Sparse outfield fabric carpet — extends readable city past ring cliff (FAR lock). */
  function placeCityFabricCarpet() {
    if (!profile.cityCircuit || profile.vintageFast) return;
    const cfPool = (sprites.buildings.cityfabricMd && sprites.buildings.cityfabricMd.length)
      ? sprites.buildings.cityfabricMd
      : (sprites.buildings.cityfabric || []);
    if (!cfPool.length) return;
    const sampleImg = cfPool[0];
    const pw = Math.max(140, (sampleImg.width || 320) * 1.2);
    const ph = Math.max(100, (sampleImg.height || 200) * 1.05);
    // Rooftop owns dense fill — sparse step kills clone banding but removes hard stamp-cliff
    let rooftopOn = false;
    try {
      const packRt = getAssetPack();
      rooftopOn = !!(packRt && packRt.ready && packRt.urbanRooftop);
    } catch (_) {}
    const stepX = pw * (rooftopOn ? 1.05 : 0.55);
    const stepY = ph * (rooftopOn ? 1.05 : 0.55);
    const margin = Math.max(track.width || 2900, track.height || 2100) * (rooftopOn ? 0.55 : 0.12);
    const x0 = -margin, y0 = -margin;
    const x1 = (track.width || 2900) + margin;
    const y1 = (track.height || 2100) + margin;
    let row = 0;
    for (let y = y0; y < y1; y += stepY, row++) {
      const xOff = (row % 2) * stepX * 0.5;
      for (let x = x0 + xOff; x < x1; x += stepX) {
        if (isOnAsphalt(track, x, y)) continue;
        const inInner = pointInPoly(x, y, track.inner);
        const inOuter = pointInPoly(x, y, track.outer);
        // Carpet infield (inside inner) + outfield (outside outer). Skip asphalt band.
        if (!inInner && inOuter) continue;
        // With rooftop fill: skip dense infield (rooftop owns it); only extend OUTFIELD past rings
        if (rooftopOn && inInner) continue;
        const pickC = pickCityCircuitStamp(sprites, profile, rnd, { preferFabric: true });
        if (!pickC || !pickC.img) continue;
        const scale = (pickC.scale || 1.2) * (0.92 + rnd() * 0.2);
        const flipX = rnd() < 0.5;
        let rot = (rnd() - 0.5) * 0.16;
        if (rnd() < 0.10) rot = Math.PI;
        const opts = { flipX, rot };
        // Prefer rotating a/b/c
        let img = pickC.img;
        if (cfPool.length > 1) img = cfPool[(row + ((x / stepX) | 0)) % cfPool.length] || img;
        // Far layer for deep outfield; mid for infield + near-track outfield
        const deepOut = !inInner && !inOuter && (
          x < -40 || y < -40 || x > track.width + 40 || y > track.height + 40
        );
        const layerList = deepOut ? far : mid;
        const layerName = deepOut ? 'far' : 'mid';
        tryAddStamp(layerList, img, x, y, scale, layerName, y, 'cityfabric', opts);
      }
    }
  }
  // placeCityFabricRing/Carpet deferred until tryAddStamp/stampOpts exist

  function landmarkBoost(x, y) {
    let best = 0;
    let nearest = null;
    for (const lm of landmarks) {
      const d = Math.hypot(x - lm.x, y - lm.y);
      let radius = 160 * ss;
      let weight = 0.55;
      if (lm.kind === 'start' || lm.id === 'start_finish') { radius = 300 * ss; weight = 1; }
      else if (lm.kind === 'pit') { radius = 240 * ss; weight = 0.9; }
      else if (lm.kind === 'chicane' || lm.kind === 'kink') { radius = 200 * ss; weight = 0.75; }
      else if (lm.kind === 'corner') { radius = 220 * ss; weight = 0.8; }
      else if (lm.kind === 'bead') { radius = 210; weight = 0.72; } // fixed — fill mid-straights
      if (d < radius) {
        const b = weight * (1 - d / radius);
        if (b > best) { best = b; nearest = lm; }
      }
    }
    return { boost: best, nearest };
  }

  function straightness(e) {
    return Math.min(1.5, e.len / 80);
  }

  // Pinch landmarks (Razor waists / chicanes) — stands-only zone when pinchStandsOnly
  const pinchLmsCore = landmarks.filter((lm) =>
    lm.kind === 'kink' || lm.kind === 'chicane' ||
    (lm.id && /waist|pinch|apex|hairpin/i.test(lm.id)));
  const pinchR = (profile.pinchRadius != null ? profile.pinchRadius : 240);
  function nearPinch(x, y, r = pinchR) {
    for (const lm of pinchLmsCore) {
      if (Math.hypot(x - lm.x, y - lm.y) < r) return true;
    }
    return false;
  }
  function nearStartFinish(x, y, r = 320) {
    for (const lm of landmarks) {
      if (lm.kind === 'start' || lm.id === 'start_finish') {
        if (Math.hypot(x - lm.x, y - lm.y) < r) return true;
      }
    }
    return false;
  }

  // Stamp variety tracker — break necklace of identical warehouse/tower/palm/billboard
  const stampLog = [];
  // Hard caps (v19) — profile may raise billboards (Gridlock); towers stay sparse
  const TOWER_CAP = profile.towerCap;
  const BILLBOARD_CAP = profile.billboardCap;
  let towerCount = 0;
  let billboardCount = 0;
  let craneCount = 0;
  const hasStandBlock = !!(sprites.buildings.standBlock && sprites.buildings.standBlock.length);
  const hasStandLarge = !!(sprites.buildings.standLarge && sprites.buildings.standLarge.length);
  const hasCrane = !!(profile.quayAssets && sprites.buildings.crane && sprites.buildings.crane.length);
  const hasContainers = !!(profile.quayAssets && sprites.buildings.containers && sprites.buildings.containers.length);
  const whSmListEarly = (sprites.buildings.warehouseSm && sprites.buildings.warehouseSm.length)
    ? sprites.buildings.warehouseSm : sprites.buildings.warehouse;
  const towerSmList = (sprites.buildings.towerSm && sprites.buildings.towerSm.length)
    ? sprites.buildings.towerSm : sprites.buildings.tower;
  const bbMdList = (sprites.buildings.billboardMd && sprites.buildings.billboardMd.length)
    ? sprites.buildings.billboardMd : sprites.buildings.billboard;

  // A.1.1: map sourceKey → alternate plate canvas (Md preferred)
  const cityAltByKey = Object.create(null);
  {
    const cbMd = sprites.buildings.cityblockMd || sprites.buildings.cityblock || [];
    const csMd = sprites.buildings.citystreetMd || sprites.buildings.citystreet || [];
    for (const im of cbMd) {
      const k = plateSrcKey(im);
      if (k) cityAltByKey[k] = im;
    }
    for (const im of csMd) {
      const k = plateSrcKey(im);
      if (k) cityAltByKey[k] = im;
    }
  }

  function tryAddStamp(list, img, x, y, scale, layer, sortY, kind, opts) {
    if (!img) return false;
    // Prefer explicit opts; else consume pending stampOpts from city pick
    let o = opts || stampOpts || null;
    if (!opts && stampOpts) stampOpts = null;
    if (kind === 'tower') {
      if (towerCount >= TOWER_CAP) return false;
    }
    if (kind === 'billboard') {
      if (billboardCount >= BILLBOARD_CAP) return false;
    }
    const cityKind = (kind === 'cityblock' || kind === 'citystreet' || kind === 'cityfabric');
    const cityTrio = (kind === 'cityblock' || kind === 'citystreet');
    const sc = scale || 1;
    const halfW = (img.width * sc) * 0.5;
    const stampH = img.height * sc;

    // Don't draw city street/block under billboard frames (scaffold bleed ship-blocker)
    if (cityKind) {
      for (const p of stampLog) {
        if (p.kind !== 'billboard') continue;
        const bw = (p.w != null ? p.w : ((p.img && p.img.width) || 120)) * 0.5;
        const bh = p.h != null ? p.h : ((p.img && p.img.height) || 100);
        // AABB overlap with billboard footprint (pad slightly)
        if (Math.abs(p.x - x) < bw + halfW * 0.55 && Math.abs(p.y - y) < (bh + stampH) * 0.55) {
          return false;
        }
      }
    }
    // Soft: also keep billboards from landing on dense street fabric
    if (kind === 'billboard') {
      for (const p of stampLog) {
        if (p.kind !== 'citystreet' && p.kind !== 'cityblock' && p.kind !== 'cityfabric') continue;
        const pw = (p.w != null ? p.w : ((p.img && p.img.width) || 120)) * 0.5;
        const ph = p.h != null ? p.h : ((p.img && p.img.height) || 100);
        if (Math.abs(p.x - x) < pw + halfW * 0.5 && Math.abs(p.y - y) < (ph + stampH) * 0.5) {
          return false;
        }
      }
    }

    // A.1.1 hard rule: no identical plate (same source key OR same canvas) within ~400wu —
    // alternate across full trio base / -b / -c (prefer -c when base↔-b conflict).
    // cityfabric exempt — abutting ring requires same plate within 400wu.
    if (cityTrio) {
      let key = plateSrcKey(img);
      const antiR2 = 400 * 400;
      function keyConflict(testKey, testImg) {
        for (const p of stampLog) {
          if (p.kind !== kind) continue;
          const pk = p.srcKey || plateSrcKey(p.img);
          const sameKey = testKey && pk && pk === testKey;
          const sameImg = testImg && p.img === testImg;
          if (!sameKey && !sameImg) continue;
          const dx = p.x - x, dy = p.y - y;
          if (dx * dx + dy * dy < antiR2) return true;
        }
        return false;
      }
      if (keyConflict(key, img)) {
        const alts = cityAlternateKeys(key);
        let swapped = false;
        for (const altKey of alts) {
          const altImg = cityAltByKey[altKey];
          if (!altImg || altImg === img) continue;
          if (keyConflict(altKey, altImg)) continue;
          img = altImg;
          key = altKey;
          swapped = true;
          break;
        }
        if (!swapped) return false;
      }
      // If base↔-b still adjacent within 400wu, force stronger separation via -c or reject
      if (key === 'cityblock' || key === 'cityblock-b' || key === 'citystreet' || key === 'citystreet-b') {
        const sibling = key.endsWith('-b') ? key.slice(0, -2) : (key + '-b');
        const nearSibling = stampLog.some((p) => {
          if (p.kind !== kind) return false;
          const pk = p.srcKey || plateSrcKey(p.img);
          if (pk !== sibling) return false;
          const dx = p.x - x, dy = p.y - y;
          return dx * dx + dy * dy < antiR2;
        });
        if (nearSibling) {
          const cKey = key.startsWith('cityblock') ? 'cityblock-c' : 'citystreet-c';
          const cImg = cityAltByKey[cKey];
          if (cImg && !keyConflict(cKey, cImg)) {
            img = cImg;
            key = cKey;
          } else {
            // Fall back: push farther — reject if another same-family within 400
            return false;
          }
        }
      }
    }
    // cityfabric: allow 25–40% AABB overlap (continuous rings/carpet). Accents stay sparser.
    const cityRad = cityKind
      ? Math.max(48, Math.min(halfW, stampH) * (kind === 'cityfabric' ? 0.48 : 0.88))
      : 110;
    const sameImgMax = kind === 'cityfabric' ? 4 : 1;
    if (!stampOk(stampLog, img, x, y, kind === 'tower' ? 160 : (kind === 'containers' ? 150 : (cityKind ? cityRad : 110)), sameImgMax)) return false;
    if (kind === 'tower' || kind === 'billboard' || kind === 'containers' || cityKind) {
      let nearSame = 0;
      const r2 = (kind === 'tower' ? 220 : kind === 'containers' ? 260 : cityKind ? (cityRad * 0.85) ** 2 : 180 ** 2);
      const maxNear = kind === 'cityfabric' ? 8 : (cityKind ? 2 : 1);
      for (const p of stampLog) {
        if (p.kind !== kind) continue;
        const dx = p.x - x, dy = p.y - y;
        if (dx * dx + dy * dy < r2) nearSame++;
        if (nearSame >= maxNear) return false;
      }
    }
    // Hard accent budget for cityblock/citystreet on city circuits
    if (profile.cityCircuit && (kind === 'cityblock' || kind === 'citystreet')) {
      if (typeof cityAccentCount === 'number' && cityAccentCount >= CITY_ACCENT_CAP) return false;
    }
    addItem(list, img, x, y, scale, layer, sortY, kind || null, o);
    stampLog.push({
      img, x, y, kind: kind || 'other', srcKey: plateSrcKey(img),
      w: img.width * sc, h: img.height * sc
    });
    if (kind === 'tower') towerCount++;
    if (kind === 'billboard') billboardCount++;
    if (profile.cityCircuit && (kind === 'cityblock' || kind === 'citystreet')) {
      if (typeof cityAccentCount === 'number') cityAccentCount++;
    }
    return true;
  }
  let stampOpts = null;

  // City fabric ring + carpet need tryAddStamp + stampOpts (opts passed explicitly)
  placeCityFabricRing();
  placeCityFabricCarpet();
  function applyCityPick(pickC) {
    if (!pickC || !pickC.img) return null;
    return {
      img: pickC.img,
      scale: pickC.scale,
      kind: pickC.kind,
      opts: (pickC.flipX || pickC.rot) ? { flipX: !!pickC.flipX, rot: pickC.rot || 0 } : null
    };
  }


  // Far skyline buildings — warehouse-dominated; towers/billboards hard-capped (v19)
  for (const e of edges) {
    const steps = Math.max(2, Math.floor(e.len / stepFar)); // sparser — horizon carries distance
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const bx = e.ax + (e.bx - e.ax) * t;
      const by = e.ay + (e.by - e.ay) * t;
      const distOut = 90 + rnd() * 140;
      const jx = (rnd() - 0.5) * 30;
      const jy = (rnd() - 0.5) * 30;
      const x = bx + e.nx * distOut + jx;
      const y = by + e.ny * distOut + jy;
      if (!tryPlace(track, x, y, 40)) continue;
      if (pointInPoly(x, y, track.inner)) continue;
      const { boost } = landmarkBoost(x, y);
      if (boost < 0.1 && rnd() > 0.5) continue;
      if (boost < 0.28 && rnd() > 0.7) continue;
      const roll = rnd();
      let img, scale, kind = 'other';
      const [wLo, wHi] = profile.warehouseScale;
      const bbGate = 1 - profile.billboardBias; // lower → more billboards
      const atPinchFar = profile.pinchStandsOnly && nearPinch(x, y);
      if (atPinchFar) {
        img = pick(sprites.buildings.stand, rnd); scale = varyScale(rnd, 0.85, 1.2); kind = 'stand';
      } else if (profile.cityCircuit) {
        const pickC = pickCityCircuitStamp(sprites, profile, rnd, { preferFabric: true, preferFar: true });
        if (pickC && pickC.img) { img = pickC.img; scale = pickC.scale; kind = 'cityfabric'; stampOpts = (pickC.flipX || pickC.rot) ? { flipX: !!pickC.flipX, rot: pickC.rot || 0 } : null; }
        else { continue; }
      } else if (profile.urbanSkyline) {
        // Gridlock far: light warehouseSm / towerSm — save billboard cap for mid race beads
        if (roll < 0.22 + profile.warehouseBias * 0.5) {
          img = pick(whSmListEarly, rnd); scale = varyScale(rnd, wLo, wHi); kind = 'warehouse';
        } else if (roll < 0.55) {
          img = pick(towerSmList, rnd); scale = varyScale(rnd, 0.7, 1.15); kind = 'tower';
        } else if (roll < 0.72) {
          img = pick(sprites.buildings.chimney, rnd); scale = varyScale(rnd, 0.75, 1.25);
        } else {
          img = pick(towerSmList, rnd); scale = varyScale(rnd, 0.65, 1.1); kind = 'tower';
        }
      } else if (roll < 0.42 + profile.warehouseBias * 0.25) {
        img = pick(sprites.buildings.warehouse, rnd); scale = varyScale(rnd, wLo, wHi); kind = 'warehouse';
      } else if (roll < 0.62) {
        img = pick(sprites.buildings.chimney, rnd); scale = varyScale(rnd, 0.75, 1.3);
      } else if (roll < 0.72) {
        img = pick(sprites.buildings.water, rnd); scale = varyScale(rnd, 0.7, 1.25);
      } else if (roll < bbGate || profile.billboardBias >= 0.22) {
        img = pick(sprites.buildings.tower, rnd); scale = varyScale(rnd, 0.7, 1.2); kind = 'tower';
      } else {
        img = pick(sprites.buildings.billboard, rnd); scale = varyScale(rnd, 0.7, 1.15); kind = 'billboard';
      }
      if (!img) continue;
      const sc = Math.min(1.4, scale * (1 + boost * 0.12));
      tryAddStamp(far, img, x, y, sc, 'far', y + (img.height * sc) * 0.5, kind);
    }
  }

  // Mid buildings — warehouse + grandstand mass; tower/billboard hard-capped (v19)
  for (const e of edges) {
    const dens = (profile.cityCircuit ? 0.55 : 0.7) + straightness(e) * (profile.cityCircuit ? 0.2 : 0.3);
    const steps = Math.max(2, Math.floor((e.len / (profile.cityCircuit ? stepMid * 1.15 : stepMid)) * dens));
    for (let s = 0; s < steps; s++) {
      const t = (s + rnd() * 0.6) / steps;
      const bx = e.ax + (e.bx - e.ax) * t;
      const by = e.ay + (e.by - e.ay) * t;
      const distOut = 38 + rnd() * 55;
      const x = bx + e.nx * distOut + (rnd() - 0.5) * 18;
      const y = by + e.ny * distOut + (rnd() - 0.5) * 18;
      if (!tryPlace(track, x, y, 28)) continue;
      if (pointInPoly(x, y, track.outer)) continue;
      const { boost, nearest } = landmarkBoost(x, y);
      // Keep mid-straight beads; only cull far from any anchor (v22)
      if (boost < 0.08 && rnd() > 0.55) continue;
      if (boost < 0.22 && rnd() > 0.72) continue;
      const dStart = Math.hypot(x - startX, y - startY);
      const nearStart = dStart < 280 || (nearest && (nearest.kind === 'start' || nearest.id === 'start_finish'));
      const atPinch = profile.pinchStandsOnly && nearPinch(x, y);
      const allowStand = !profile.standsOnlyAtSF || nearStart;
      const roll = rnd();
      let img, scale, kind = 'other';
      if (atPinch) {
        // Razor pinch: stands ONLY — stack canyon walls
        if (hasStandLarge && rnd() < 0.6) {
          img = pick(sprites.buildings.standLarge, rnd);
          scale = varyScale(rnd, 0.85, 1.18);
        } else if (hasStandBlock && rnd() < 0.75) {
          img = pick(sprites.buildings.standBlock, rnd);
          scale = varyScale(rnd, 0.9, 1.22);
        } else {
          img = pick(sprites.buildings.stand, rnd);
          scale = varyScale(rnd, 0.95, 1.3);
        }
        kind = 'stand';
      } else if (nearStart && allowStand && roll < (0.2 + profile.standBias * 0.7) && !profile.cityCircuit) {
        // Prefer architectural standLarge / standBlock — Cargo (standsOnlyAtSF) only here
        // A.1: cityCircuit never places stands in mid — city stamps only
        if (hasStandLarge && rnd() < 0.55) {
          img = pick(sprites.buildings.standLarge, rnd);
          scale = varyScale(rnd, 0.85, 1.15);
          kind = 'stand';
        } else if (hasStandBlock && rnd() < 0.7) {
          img = pick(sprites.buildings.standBlock, rnd);
          scale = varyScale(rnd, 0.9, 1.2);
          kind = 'stand';
        } else {
          img = pick(sprites.buildings.stand, rnd);
          scale = varyScale(rnd, 0.95, 1.35);
          kind = 'stand';
        }
      } else if (nearStart && profile.cityCircuit && roll < 0.55) {
        const pickC = pickCityCircuitStamp(sprites, profile, rnd, { preferFabric: true });
        if (pickC && pickC.img) {
          img = pickC.img; scale = pickC.scale; kind = 'cityfabric';
          stampOpts = (pickC.flipX || pickC.rot) ? { flipX: !!pickC.flipX, rot: pickC.rot || 0 } : null;
        }
      } else if (boost > 0.45 && nearest && (nearest.kind === 'pit' || nearest.kind === 'corner') && roll < 0.5) {
        if (allowStand && hasStandBlock && rnd() < 0.55) {
          img = pick(sprites.buildings.standBlock, rnd);
          scale = varyScale(rnd, 0.85, 1.2);
          kind = 'stand';
        } else if (hasContainers && profile.containerBias > 0.3 && rnd() < profile.containerBias * 0.5) {
          img = pick(sprites.buildings.containers, rnd);
          scale = varyScale(rnd, 1.1, 1.45);
          kind = 'containers';
        } else if (profile.cityCircuit) {
          const pickC = pickCityCircuitStamp(sprites, profile, rnd, { preferFabric: true });
          if (pickC && pickC.img) { img = pickC.img; scale = pickC.scale; kind = 'cityfabric'; stampOpts = (pickC.flipX || pickC.rot) ? { flipX: !!pickC.flipX, rot: pickC.rot || 0 } : null; }
          else { continue; }
        } else if (profile.urbanSkyline) {
          img = pick(bbMdList, rnd);
          scale = varyScale(rnd, 0.85, 1.22);
          kind = 'billboard';
        } else {
          img = pick(sprites.buildings.warehouse, rnd);
          scale = varyScale(rnd, 0.8, 1.3);
          kind = 'warehouse';
        }
      } else if (nearest && nearest.kind === 'bead' && roll < 0.88) {
        // Mid-straight beads — identity mix (v25)
        const [wLo, wHi] = profile.warehouseScale;
        if (profile.cityCircuit) {
          const pickC = pickCityCircuitStamp(sprites, profile, rnd, { preferFabric: true });
          if (pickC && pickC.img) { img = pickC.img; scale = pickC.scale; kind = 'cityfabric'; stampOpts = (pickC.flipX || pickC.rot) ? { flipX: !!pickC.flipX, rot: pickC.rot || 0 } : null; }
          else { continue; }
        } else if (profile.urbanSkyline) {
          // Gridlock v28: billboardMd dominant; warehouseSm rare; towerSm accents
          const u = rnd();
          const whGate = Math.min(0.2, 0.05 + profile.warehouseBias * 0.4);
          if (u < whGate) {
            img = pick(whSmListEarly, rnd); scale = varyScale(rnd, wLo, wHi); kind = 'warehouse';
          } else if (u < whGate + Math.max(0.45, profile.billboardBias)) {
            img = pick(bbMdList, rnd); scale = varyScale(rnd, 0.9, 1.28); kind = 'billboard';
          } else if (u < 0.9) {
            img = pick(towerSmList, rnd); scale = varyScale(rnd, 0.7, 1.15); kind = 'tower';
          } else if (allowStand && hasStandLarge && rnd() < profile.standBias) {
            img = pick(sprites.buildings.standLarge, rnd); scale = varyScale(rnd, 0.72, 1.0); kind = 'stand';
          } else {
            img = pick(bbMdList, rnd); scale = varyScale(rnd, 0.9, 1.22); kind = 'billboard';
          }
        } else if (profile.quayAssets) {
          // Cargo long straight: warehouse + containers; never stands
          if (hasContainers && rnd() < profile.containerBias) {
            img = pick(sprites.buildings.containers, rnd);
            scale = varyScale(rnd, 1.15, 1.55);
            kind = 'containers';
          } else {
            img = pick(sprites.buildings.warehouse, rnd);
            scale = varyScale(rnd, wLo, wHi);
            kind = 'warehouse';
          }
        } else if (allowStand && hasStandLarge && rnd() < profile.standBias * 0.55) {
          img = pick(sprites.buildings.standLarge, rnd);
          scale = varyScale(rnd, 0.75, 1.08);
          kind = 'stand';
        } else if (allowStand && hasStandBlock && rnd() < profile.standBias * 0.45) {
          img = pick(sprites.buildings.standBlock, rnd);
          scale = varyScale(rnd, 0.8, 1.12);
          kind = 'stand';
        } else {
          img = pick(sprites.buildings.warehouse, rnd);
          scale = varyScale(rnd, 0.8, 1.35);
          kind = 'warehouse';
        }
      } else if (roll < 0.06) {
        img = pick(sprites.buildings.shop, rnd);
        scale = varyScale(rnd, 0.75, 1.2);
      } else {
        // Profile stamp mix — warehouse / stand / billboard bias (shared density, different identity)
        const [wLo, wHi] = profile.warehouseScale;
        const r2 = rnd();
        // Phase A city / Gridlock: city stamps first, warehouses scarce
        if (profile.cityCircuit) {
          const pickC = pickCityCircuitStamp(sprites, profile, rnd, { preferFabric: true });
          if (pickC && pickC.img) { img = pickC.img; scale = pickC.scale; kind = 'cityfabric'; stampOpts = (pickC.flipX || pickC.rot) ? { flipX: !!pickC.flipX, rot: pickC.rot || 0 } : null; }
          else { continue; }
        } else {
        const whCut = profile.urbanSkyline
          ? Math.min(0.16, profile.warehouseBias * 0.7)
          : profile.warehouseBias;
        const standCut = allowStand ? (whCut + profile.standBias * 0.55) : whCut;
        const bbCut = standCut + (profile.urbanSkyline ? Math.max(0.5, profile.billboardBias) : profile.billboardBias);
        if (hasContainers && profile.quayAssets && r2 < profile.containerBias * 0.35) {
          img = pick(sprites.buildings.containers, rnd);
          scale = varyScale(rnd, 1.1, 1.45);
          kind = 'containers';
        } else if (r2 < whCut) {
          img = pick(profile.urbanSkyline ? whSmListEarly : sprites.buildings.warehouse, rnd);
          scale = varyScale(rnd, wLo, wHi);
          kind = 'warehouse';
        } else if (r2 < standCut && (hasStandBlock || hasStandLarge)) {
          if (hasStandLarge && rnd() < profile.standBias) {
            img = pick(sprites.buildings.standLarge, rnd);
            scale = varyScale(rnd, 0.75, 1.12);
          } else if (hasStandBlock) {
            img = pick(sprites.buildings.standBlock, rnd);
            scale = varyScale(rnd, 0.8, 1.15);
          } else {
            img = pick(sprites.buildings.stand, rnd);
            scale = varyScale(rnd, 0.85, 1.2);
          }
          kind = 'stand';
        } else if (r2 < bbCut || profile.billboardBias >= 0.22) {
          img = pick(profile.urbanSkyline ? bbMdList : sprites.buildings.billboard, rnd);
          scale = varyScale(rnd, profile.urbanSkyline ? 0.85 : 0.7, profile.urbanSkyline ? 1.25 : 1.15);
          kind = 'billboard';
        } else if (rnd() < 0.45) {
          img = pick(profile.urbanSkyline ? towerSmList : sprites.buildings.tower, rnd);
          scale = varyScale(rnd, 0.7, 1.2);
          kind = 'tower';
        } else {
          img = pick(profile.urbanSkyline ? bbMdList : sprites.buildings.chimney, rnd);
          scale = varyScale(rnd, 0.7, 1.25);
          kind = profile.urbanSkyline ? 'billboard' : 'other';
        }
        } // end !cityCircuit mix
      }
      if (!img) continue;
      tryAddStamp(mid, img, x, y, scale, 'mid', y + img.height * scale * 0.45, kind);
    }
  }

  // Gridlock urban: warm billboards along outer arc — denser to use billboardCap 9 (v25)
  // City carpet pass: billboardBias 0 → leave off
  if (profile.billboardBias >= 0.22) {
    let acc = 0;
    const spacing = profile.billboardBias >= 0.55 ? 200 : (profile.billboardBias >= 0.35 ? 280 : 420);
    let nextAt = spacing * 0.28;
    for (const e of edges) {
      const end = acc + e.len;
      while (nextAt <= end + 1e-6) {
        const t = e.len > 0 ? (nextAt - acc) / e.len : 0.5;
        const bx = e.ax + (e.bx - e.ax) * t;
        const by = e.ay + (e.by - e.ay) * t;
        let placed = false;
        for (const dist of [55, 72, 40, 90]) {
          const x = bx + e.nx * dist + (rnd() - 0.5) * 10;
          const y = by + e.ny * dist + (rnd() - 0.5) * 10;
          if (y < 50 || y > track.height - 50) continue; // keep in race-readable band
          if (nearStartFinish(x, y, 360)) continue; // race beads, not S/F wall
          if (pointInPoly(x, y, track.outer)) continue;
          if (!tryPlace(track, x, y, 16)) continue;
          let img, kind = 'billboard', sc = varyScale(rnd, 0.95, 1.3);
          if (profile.cityCircuit) {
            // Billboards left off for city carpet pass
            continue;
          }
          if (!img) img = pick(bbMdList.length ? bbMdList : sprites.buildings.billboard, rnd);
          if (!img) break;
          if (tryAddStamp(mid, img, x, y, sc, 'mid',
            y + img.height * 0.45, kind)) {
            placed = true;
            break;
          }
        }
        nextAt += spacing;
      }
      acc = end;
    }
  }

  // Explicit mid-straight bead clusters (v23 both-sides / v25 identity):
  // outfield = profile mix; infield = warehouseSm/stand only + harder gaps
  // City circuit: SKIP — fabric ring + carpet replace bead islands (accents capped separately)
  const whSmList = whSmListEarly;
  for (const bead of (profile.cityCircuit ? [] : beadAnchors)) {
    const isIn = bead.side === 'in';
    const atPinch = profile.pinchStandsOnly && nearPinch(bead.x, bead.y);
    const atSF = nearStartFinish(bead.x, bead.y, 300);
    const allowStand = !profile.standsOnlyAtSF || atSF;
    // Infield: 1–2 lighter stamps with gaps; outfield: richer 2–3
    const cluster = isIn
      ? (1 + (rnd() < 0.28 ? 1 : 0))
      : (2 + (rnd() < 0.45 ? 1 : 0));
    for (let k = 0; k < cluster; k++) {
      const ang = rnd() * Math.PI * 2;
      const rad = (k === 0 ? 0 : (isIn ? 14 + rnd() * 36 : 10 + rnd() * 28));
      const x = bead.x + Math.cos(ang) * rad;
      const y = bead.y + Math.sin(ang) * rad;
      if (x < -70 || y < -70 || x > track.width + 70 || y > track.height + 70) continue;
      if (isOnAsphalt(track, x, y)) continue;
      const inInner = pointInPoly(x, y, track.inner);
      const inOuter = pointInPoly(x, y, track.outer);
      if (!inInner && inOuter) continue; // asphalt ring pocket
      if (!inInner && !inOuter && !tryPlace(track, x, y, 14)) continue;
      if (isIn && !inInner) continue;
      const roll = rnd();
      let img, scale, kind = 'warehouse';
      if (isIn) {
        // A.1 cityCircuit infield beads: city stamps only
        if (profile.cityCircuit) {
          const pickC = pickCityCircuitStamp(sprites, profile, rnd);
          if (pickC && pickC.img) {
            img = pickC.img; scale = pickC.scale; kind = pickC.kind;
            stampOpts = (pickC.flipX || pickC.rot) ? { flipX: !!pickC.flipX, rot: pickC.rot || 0 } : null;
          } else {
            img = pick(bbMdList, rnd); scale = varyScale(rnd, 0.8, 1.1); kind = 'billboard';
          }
        } else if (atPinch || (profile.pinchStandsOnly && profile.warehouseBias < 0.12) ||
            (roll < (profile.pinchStandsOnly ? 0.7 : 0.4) && allowStand)) {
          img = pick(sprites.buildings.stand, rnd);
          scale = varyScale(rnd, 0.82, 1.08);
          kind = 'stand';
        } else if (!atPinch && profile.warehouseBias >= 0.12) {
          img = pick(whSmList, rnd);
          scale = varyScale(rnd, 0.78, 1.12);
          kind = 'warehouse';
        } else {
          img = pick(sprites.buildings.stand, rnd);
          scale = varyScale(rnd, 0.82, 1.08);
          kind = 'stand';
        }
      } else if (atPinch) {
        // Razor outfield pinch: stack stands only
        if (hasStandLarge && rnd() < 0.55) {
          img = pick(sprites.buildings.standLarge, rnd);
          scale = varyScale(rnd, 0.78, 1.12);
        } else if (hasStandBlock && rnd() < 0.7) {
          img = pick(sprites.buildings.standBlock, rnd);
          scale = varyScale(rnd, 0.85, 1.18);
        } else {
          img = pick(sprites.buildings.stand, rnd);
          scale = varyScale(rnd, 0.9, 1.2);
        }
        kind = 'stand';
      } else {
        // Outfield bead identity mix (v25)
        const [wLo, wHi] = profile.warehouseScale;
        if (profile.cityCircuit) {
          const pickC = pickCityCircuitStamp(sprites, profile, rnd);
          if (pickC && pickC.img) { img = pickC.img; scale = pickC.scale; kind = pickC.kind; stampOpts = (pickC.flipX || pickC.rot) ? { flipX: !!pickC.flipX, rot: pickC.rot || 0 } : null; }
          else { img = pick(bbMdList, rnd); scale = varyScale(rnd, 0.85, 1.18); kind = 'billboard'; }
        } else if (profile.urbanSkyline) {
          // Gridlock v28 race beads: billboardMd first, then towerSm; warehouses scarce
          const u = rnd();
          const whGate = Math.min(0.18, 0.04 + profile.warehouseBias * 0.35);
          if (u < whGate) {
            img = pick(whSmList, rnd); scale = varyScale(rnd, wLo, Math.min(wHi, 1.1)); kind = 'warehouse';
          } else if (u < whGate + Math.max(0.5, profile.billboardBias)) {
            img = pick(bbMdList, rnd); scale = varyScale(rnd, 0.88, 1.25); kind = 'billboard';
          } else if (u < 0.92) {
            img = pick(towerSmList, rnd); scale = varyScale(rnd, 0.7, 1.12); kind = 'tower';
          } else {
            img = pick(bbMdList, rnd); scale = varyScale(rnd, 0.85, 1.18); kind = 'billboard';
          }
        } else if (profile.quayAssets) {
          // Cargo long straight: warehouse + containers; stands only at S/F
          if (allowStand && hasStandLarge && rnd() < 0.12) {
            img = pick(sprites.buildings.standLarge, rnd);
            scale = varyScale(rnd, 0.75, 1.05);
            kind = 'stand';
          } else if (hasContainers && rnd() < profile.containerBias) {
            img = pick(sprites.buildings.containers, rnd);
            scale = varyScale(rnd, 1.2, 1.6);
            kind = 'containers';
          } else {
            img = pick(sprites.buildings.warehouse, rnd);
            scale = varyScale(rnd, Math.max(wLo, 0.88), Math.min(wHi + 0.1, 1.55));
            kind = 'warehouse';
          }
        } else {
          const standRoll = profile.standBias;
          if (allowStand && roll < standRoll * 0.9 && hasStandLarge) {
            img = pick(sprites.buildings.standLarge, rnd);
            scale = varyScale(rnd, 0.72, 1.08);
            kind = 'stand';
          } else if (allowStand && roll < standRoll * 0.9 + 0.18 && hasStandBlock) {
            img = pick(sprites.buildings.standBlock, rnd);
            scale = varyScale(rnd, 0.85, 1.18);
            kind = 'stand';
          } else {
            img = pick(sprites.buildings.warehouse, rnd);
            scale = varyScale(rnd, Math.max(wLo, 0.85), Math.min(wHi + 0.1, 1.5));
            kind = 'warehouse';
          }
        }
      }
      if (!img) continue;
      // Infield: wider stamp radius so beads stay gapped (Gridlock top wall was continuous)
      const gapMul = profile.infieldGapMul || 1;
      const stampR = isIn ? (145 * gapMul) : 90;
      if (!stampOk(stampLog, img, x, y, stampR, 1)) continue;
      const layerList = isIn ? near : mid;
      const layerName = isIn ? 'near' : 'mid';
      tryAddStamp(layerList, img, x, y, scale, layerName, y + img.height * scale * 0.45, kind);
    }
  }

  // Light infield ribbon along inner wall — warehouseSm/stand with gaps (v23 both-sides)
  // Ensures race zoom always has content inside the lane, not only sparse mirrored beads.
  {
    const whSm = whSmList;
    const gapMul = profile.infieldGapMul || 1;
    const stepIn = 200 * gapMul; // harder gaps on Gridlock continuous top wall
    const keepChance = 0.62 / gapMul; // lower keep → more gaps
    for (const e of innerEdges) {
      const steps = Math.max(1, Math.floor(e.len / stepIn));
      for (let s = 0; s < steps; s++) {
        if (rnd() > keepChance) continue;
        const t = (s + 0.35 + rnd() * 0.3) / steps;
        const bx = e.ax + (e.bx - e.ax) * t;
        const by = e.ay + (e.by - e.ay) * t;
        const dist = 40 + rnd() * 50;
        const x = bx - e.nx * dist + (rnd() - 0.5) * 12;
        const y = by - e.ny * dist + (rnd() - 0.5) * 12;
        if (!pointInPoly(x, y, track.inner)) continue;
        if (isOnAsphalt(track, x, y)) continue;
        const atPinch = profile.pinchStandsOnly && nearPinch(x, y);
        const roll = rnd();
        let img, scale, kind;
        // A.1 cityCircuit infield: city stamps only (no warehouse / stand wall)
        if (profile.cityCircuit) {
          // Carpet already fills infield — skip duplicate ribbon accents
          continue;
        } else if (atPinch || (profile.pinchStandsOnly && profile.warehouseBias < 0.12 && roll < 0.72)) {
          img = pick(sprites.buildings.stand, rnd);
          scale = varyScale(rnd, 0.8, 1.05);
          kind = 'stand';
        } else if (roll < 0.38 && !profile.standsOnlyAtSF) {
          img = pick(sprites.buildings.stand, rnd);
          scale = varyScale(rnd, 0.8, 1.05);
          kind = 'stand';
        } else if (!atPinch && profile.warehouseBias >= 0.12) {
          img = pick(whSm, rnd);
          scale = varyScale(rnd, 0.75, 1.08);
          kind = 'warehouse';
        } else {
          img = pick(sprites.buildings.stand, rnd);
          scale = varyScale(rnd, 0.8, 1.05);
          kind = 'stand';
        }
        if (!img) continue;
        if (!stampOk(stampLog, img, x, y, 150 * gapMul, 1)) continue;
        tryAddStamp(near, img, x, y, scale, 'near', y + img.height * scale * 0.45, kind);
      }
    }
  }

  // Near props along outer wall — NO thin crowd strips (v18). Crowds only with grandstands.
  for (const e of edges) {
    const dens = 0.7 + straightness(e) * 0.35;
    const steps = Math.max(2, Math.floor((e.len / stepNear) * dens));
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.3 + rnd() * 0.4) / steps;
      const bx = e.ax + (e.bx - e.ax) * t;
      const by = e.ay + (e.by - e.ay) * t;
      const distOut = 14 + rnd() * 22;
      const x = bx + e.nx * distOut + (rnd() - 0.5) * 8;
      const y = by + e.ny * distOut + (rnd() - 0.5) * 8;
      if (!tryPlace(track, x, y, 12)) continue;
      if (pointInPoly(x, y, track.outer)) continue;
      const { boost } = landmarkBoost(x, y);
      if (boost < 0.1 && rnd() > 0.35) continue;
      const roll = rnd();
      let img, scale;
      // Streetlight density via lampChance; palms sparse (Gridlock: dense poles / less palm)
      const lampShare = Math.min(0.48, 0.12 + (profile.lampChance || 0.18));
      if (roll < 0.22) { img = pick(sprites.props.barrel, rnd); scale = varyScale(rnd, 0.75, 1.25); }
      else if (roll < 0.42) { img = pick(sprites.props.cone, rnd); scale = varyScale(rnd, 0.75, 1.3); }
      else if (roll < 0.58) { img = pick(sprites.props.fence, rnd); scale = varyScale(rnd, 0.8, 1.25); }
      else if (roll < 0.58 + lampShare * 0.35) { img = pick(sprites.props.light, rnd); scale = varyScale(rnd, 0.7, 1.05); }
      else if (roll < 0.58 + lampShare) { img = pick(sprites.props.lamp, rnd); scale = varyScale(rnd, 0.7, 1.1); }
      else if (rnd() < profile.palmChance * 3.2) { img = pick(sprites.props.palm, rnd); scale = varyScale(rnd, 0.7, 1.35); }
      else { img = pick(sprites.props.lamp, rnd); scale = varyScale(rnd, 0.7, 1.05); }
      if (!stampOk(stampLog, img, x, y, 70, 1)) continue;
      addItem(near, img, x, y, scale, 'near');
      stampLog.push({ img, x, y });
    }
  }

  // One clear grandstand BLOCK facing start/finish + smaller stands at pit / corners
  const standAnchors = landmarks.filter((lm) =>
    lm.kind === 'start' || lm.id === 'start_finish' || lm.kind === 'pit' || lm.kind === 'corner');
  let placedStartBlock = false;
  for (const lm of standAnchors) {
    const isStart = lm.kind === 'start' || lm.id === 'start_finish';
    const cx = track.width * 0.5, cy = track.height * 0.5;
    const dx = lm.x - cx, dy = lm.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len, ny = dy / len;
    const tx = -ny, ty = nx;

    if (isStart && !placedStartBlock) {
      // S/F mass: cityCircuit → cityblock; Razor prefer standLarge; Cargo (low standBias) → warehouse
      let imgLarge;
      let sfKind = 'stand';
      let sfOpts = null;
      if (profile.cityCircuit) {
        // One accent at S/F if budget remains; else fabric
        const pickC = pickCityCircuitStamp(sprites, profile, rnd, cityAccentCount < CITY_ACCENT_CAP ? {} : { preferFabric: true });
        if (pickC && pickC.img) {
          imgLarge = pickC.img;
          sfKind = pickC.kind || 'cityfabric';
          sfOpts = (pickC.flipX || pickC.rot) ? { flipX: !!pickC.flipX, rot: pickC.rot || 0 } : null;
        } else {
          imgLarge = pick(sprites.buildings.cityfabricMd || sprites.buildings.cityfabric, rnd)
            || pick(sprites.buildings.cityblockMd || sprites.buildings.cityblock, rnd);
          sfKind = 'cityfabric';
        }
      } else if (profile.standBias < 0.25) {
        imgLarge = pick(sprites.buildings.warehouse, rnd)
          || pick(sprites.buildings.standBlock, rnd);
        sfKind = 'warehouse';
      } else {
        imgLarge = (sprites.buildings.standLarge && sprites.buildings.standLarge.length)
          ? pick(sprites.buildings.standLarge, rnd)
          : pick(sprites.buildings.standBlock, rnd);
      }
      const trySpots = [];
      // Infield (toward center) — classic spectator mass inside the loop
      for (const dist of [200, 180, 220, 160, 240, 140]) {
        trySpots.push({ x: lm.x - nx * dist, y: lm.y - ny * dist, pad: 12 });
      }
      // Outer runoff (tiny band just outside outer poly)
      for (const dist of [230, 235, 225, 240, 220, 245]) {
        trySpots.push({ x: lm.x + nx * dist, y: lm.y + ny * dist, pad: 6 });
      }
      // Lateral outside near S/F
      for (const side of [-1, 1]) {
        for (const dist of [40, 70]) {
          trySpots.push({
            x: lm.x + nx * dist + tx * side * 150,
            y: lm.y + ny * dist + ty * side * 150,
            pad: 10
          });
        }
      }
      for (const spot of trySpots) {
        const { x, y, pad } = spot;
        if (x < -70 || y < -70 || x > track.width + 70 || y > track.height + 70) continue;
        // Accept infield (inside inner) OR outside outer; never on asphalt
        const inInner = pointInPoly(x, y, track.inner);
        const inOuter = pointInPoly(x, y, track.outer);
        if (isOnAsphalt(track, x, y)) continue;
        if (!inInner && inOuter) continue; // still in some non-asphalt outer pocket — skip
        if (!inInner && !inOuter && !tryPlace(track, x, y, pad)) continue;
        // Infield S/F mass must be near-layer (yard fill covers mid)
        const startLayer = inInner ? near : mid;
        const startLayerName = inInner ? 'near' : 'mid';
        if (profile.cityCircuit && (sfKind === 'cityblock' || sfKind === 'citystreet')) {
          if (!tryAddStamp(startLayer, imgLarge, x, y, 1.9, startLayerName, y + 110, sfKind, sfOpts)) continue;
        } else {
          addItem(startLayer, imgLarge, x, y, 1.9, startLayerName, y + 110, sfKind || null, sfOpts || null);
          stampLog.push({ img: imgLarge, x, y, kind: sfKind || 'other', srcKey: plateSrcKey(imgLarge) });
        }
        placedStartBlock = true;
        // Architecture silhouette only — dense crowd sheets read as confetti (v19)
        // Optional single oversized mass tucked into stand base, never a slab field
        if (!hasStandLarge && !hasStandBlock) {
          const cimg = pickCrowd(sprites, rnd, true);
          if (cimg) {
            addItem(near, cimg,
              x + (rnd() - 0.5) * 40,
              y + (inInner ? -12 : 20) + rnd() * 10,
              varyScale(rnd, 1.55, 1.85), 'near', 'crowd');
          }
        }
        break;
      }
      // flanking smaller stands (outer or infield)
      for (const side of [-1, 1]) {
        for (const dist of [90, 70, 110]) {
          const fx = lm.x + nx * 30 + tx * side * dist;
          const fy = lm.y + ny * 30 + ty * side * dist;
          const fx2 = lm.x - nx * 170 + tx * side * (dist * 0.6);
          const fy2 = lm.y - ny * 170 + ty * side * (dist * 0.6);
          let placedF = false;
          for (const [fxs, fys] of [[fx, fy], [fx2, fy2]]) {
            if (isOnAsphalt(track, fxs, fys)) continue;
            const okInner = pointInPoly(fxs, fys, track.inner);
            const okOuter = !pointInPoly(fxs, fys, track.outer) && tryPlace(track, fxs, fys, 12);
            if (!okInner && !okOuter) continue;
            // Prefer standLarge / standBlock — Cargo quay flanks with warehouses
            let flankImg;
            if (profile.standBias < 0.25) {
              flankImg = pick(sprites.buildings.warehouse, rnd) || pick(sprites.buildings.stand, rnd);
            } else {
              flankImg = (hasStandLarge && rnd() < 0.5)
                ? pick(sprites.buildings.standLarge, rnd)
                : (hasStandBlock && rnd() < 0.6)
                  ? pick(sprites.buildings.standBlock, rnd)
                  : pick(sprites.buildings.stand, rnd);
            }
            const flankInner = pointInPoly(fxs, fys, track.inner);
            addItem(flankInner ? near : mid, flankImg, fxs, fys, varyScale(rnd, 1.0, 1.25), flankInner ? 'near' : 'mid');
            // No crowd confetti beside standLarge/standBlock — roof+tiers carry read
            placedF = true;
            break;
          }
          if (placedF) break;
        }
      }
      continue;
    }

    // Major apexes / pits — Cargo (standsOnlyAtSF): warehouse/containers instead of stands
    const isMajor = lm.kind === 'pit' || lm.kind === 'corner';
    if (profile.standsOnlyAtSF) {
      const count = lm.kind === 'pit' ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const lat = (i - (count - 1) * 0.5) * 55;
        const out = isMajor ? 95 : 80;
        const x = lm.x + nx * out + tx * lat;
        const y = lm.y + ny * out + ty * lat;
        if (pointInPoly(x, y, track.outer)) continue;
        if (!tryPlace(track, x, y, 18) && isOnAsphalt(track, x, y)) continue;
        let img, kind = 'warehouse';
        if (hasContainers && rnd() < (profile.containerBias || 0.4)) {
          img = pick(sprites.buildings.containers, rnd); kind = 'containers';
        } else {
          img = pick(sprites.buildings.warehouse, rnd);
        }
        if (!img) continue;
        tryAddStamp(mid, img, x, y, 1.1 + rnd() * 0.25, 'mid', y + img.height * 0.45, kind);
      }
      continue;
    }
    const count = lm.kind === 'pit' ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const lat = (i - (count - 1) * 0.5) * 55;
      const out = isMajor ? 95 : 80;
      const x = lm.x + nx * out + tx * lat;
      const y = lm.y + ny * out + ty * lat;
      if (pointInPoly(x, y, track.outer)) continue;
      if (!tryPlace(track, x, y, 18) && isOnAsphalt(track, x, y)) continue;
      let img;
      if (isMajor && hasStandLarge && rnd() < 0.55) {
        img = pick(sprites.buildings.standLarge, rnd);
        addItem(mid, img, x, y, 1.15 + rnd() * 0.2, 'mid');
      } else if (isMajor && hasStandBlock && rnd() < 0.75) {
        img = pick(sprites.buildings.standBlock, rnd);
        addItem(mid, img, x, y, 1.2 + rnd() * 0.2, 'mid');
      } else {
        img = pick(sprites.buildings.stand, rnd);
        addItem(mid, img, x, y, 1.05 + rnd() * 0.15, 'mid');
      }
      if (!(hasStandLarge || hasStandBlock)) {
        const cimg = pickCrowd(sprites, rnd, true);
        if (cimg) {
          addItem(near, cimg,
            x + (rnd() - 0.5) * 40,
            y + 12 + rnd() * 10,
            varyScale(rnd, 1.5, 1.8), 'near', 'crowd');
        }
      }
    }
  }

  // No extra crowd slab field at S/F — standLarge/standBlock carry spectator read (v19)
  if (start) {
    const ang = start.angle || 0;
    const lx = -Math.sin(ang), ly = Math.cos(ang);
    for (const side of [-1, 1]) {
      const x = startX + lx * side * 95 - Math.cos(ang) * 20;
      const y = startY + ly * side * 95 - Math.sin(ang) * 20;
      if (!tryPlace(track, x, y, 24)) continue;
      if (pointInPoly(x, y, track.outer)) continue;
      if (rnd() > 0.45) {
        addItem(near, pick(sprites.props.lamp, rnd), x + side * 20, y - 10, 1, 'near');
      }
    }
  }

  // Gridlock-style trackside hazard vocabulary at pit + start (cones/barrels/fences)
  const hazardLms = landmarks.filter((lm) =>
    lm.kind === 'start' || lm.id === 'start_finish' || lm.kind === 'pit' || lm.kind === 'chicane');
  for (const lm of hazardLms) {
    const cx = track.width * 0.5, cy = track.height * 0.5;
    const dx = lm.x - cx, dy = lm.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len, ny = dy / len;
    const tx = -ny, ty = nx;
    const heavy = (lm.kind === 'pit' || lm.kind === 'start' || lm.id === 'start_finish');
    const nProps = heavy ? 14 : 6;
    for (let i = 0; i < nProps; i++) {
      const lat = (rnd() - 0.5) * (heavy ? 140 : 80);
      const out = 18 + rnd() * (heavy ? 36 : 28);
      const x = lm.x + nx * out + tx * lat;
      const y = lm.y + ny * out + ty * lat;
      if (!tryPlace(track, x, y, 10)) continue;
      if (pointInPoly(x, y, track.outer)) continue;
      const roll = rnd();
      let img, scale;
      if (roll < 0.28) { img = pick(sprites.props.cone, rnd); scale = 0.95 + rnd() * 0.2; }
      else if (roll < 0.52) { img = pick(sprites.props.barrel, rnd); scale = 0.9 + rnd() * 0.25; }
      else if (roll < 0.7) { img = pick(sprites.props.fence, rnd); scale = 0.85 + rnd() * 0.2; }
      else if (roll < 0.85) { img = pick(sprites.props.light, rnd); scale = 0.85 + rnd() * 0.2; }
      else { img = pick(sprites.props.lamp, rnd); scale = 0.9 + rnd() * 0.2; }
      addItem(near, img, x, y, scale, 'near');
    }
    // Yellow hazard fence run along pit outer
    if (lm.kind === 'pit' || heavy) {
      for (let i = 0; i < 4; i++) {
        const x = lm.x + nx * (22 + i * 2) + tx * (i - 1.5) * 36;
        const y = lm.y + ny * (22 + i * 2) + ty * (i - 1.5) * 36;
        if (!tryPlace(track, x, y, 8)) continue;
        if (pointInPoly(x, y, track.outer)) continue;
        addItem(near, pick(sprites.props.fence, rnd), x, y, 1.0, 'near');
      }
    }
  }

  // Tyre wall stacks at tight apexes (corner / chicane / kink / hairpin)
  const apexLms = landmarks.filter((lm) =>
    lm.kind === 'corner' || lm.kind === 'chicane' || lm.kind === 'kink' ||
    (lm.id && /hairpin|apex/i.test(lm.id)));
  const tyreSprites = (sprites.props.tyrewall && sprites.props.tyrewall.length)
    ? sprites.props.tyrewall
    : null;
  if (tyreSprites) {
    for (const lm of apexLms) {
      const cx = track.width * 0.5, cy = track.height * 0.5;
      const dx = lm.x - cx, dy = lm.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len, ny = dy / len;
      const tx = -ny, ty = nx;
      const nStacks = lm.kind === 'chicane' || lm.kind === 'kink' ? 5 : 3;
      for (let i = 0; i < nStacks; i++) {
        const lat = (i - (nStacks - 1) * 0.5) * 28 + (rnd() - 0.5) * 8;
        const out = 16 + rnd() * 14;
        const x = lm.x + nx * out + tx * lat;
        const y = lm.y + ny * out + ty * lat;
        if (!tryPlace(track, x, y, 10)) continue;
        if (pointInPoly(x, y, track.outer)) continue;
        const img = pick(tyreSprites, rnd);
        addItem(near, img, x, y, 0.95 + rnd() * 0.25, 'near');
      }
      // Inner-apex stack (toward track center) when pad allows
      for (let i = 0; i < 2; i++) {
        const x = lm.x - nx * (12 + i * 10) + tx * (rnd() - 0.5) * 20;
        const y = lm.y - ny * (12 + i * 10) + ty * (rnd() - 0.5) * 20;
        if (!tryPlace(track, x, y, 8)) continue;
        if (pointInPoly(x, y, track.inner)) continue;
        addItem(near, pick(tyreSprites, rnd), x, y, 0.85 + rnd() * 0.2, 'near');
      }
    }
  }

  // Razor: denser stand architecture at pinch / kink landmarks (night-canyon identity)
  if (profile.pinchStandExtra > 0) {
    const pinchLms = landmarks.filter((lm) =>
      lm.kind === 'kink' || lm.kind === 'chicane' || (lm.id && /waist|pinch|apex/i.test(lm.id)));
    for (const lm of pinchLms) {
      const pcx = track.width * 0.5, pcy = track.height * 0.5;
      const dx = lm.x - pcx, dy = lm.y - pcy;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len, ny = dy / len;
      const tx = -ny, ty = nx;
      for (let i = 0; i < profile.pinchStandExtra; i++) {
        const lat = (i - (profile.pinchStandExtra - 1) * 0.5) * 42 + (rnd() - 0.5) * 10;
        // Prefer outer runoff at pinch; fallback slightly infield
        const candidates = [
          { x: lm.x + nx * (70 + rnd() * 30) + tx * lat, y: lm.y + ny * (70 + rnd() * 30) + ty * lat },
          { x: lm.x - nx * (90 + rnd() * 40) + tx * lat * 0.6, y: lm.y - ny * (90 + rnd() * 40) + ty * lat * 0.6 }
        ];
        for (const spot of candidates) {
          const { x, y } = spot;
          if (isOnAsphalt(track, x, y)) continue;
          const inInner = pointInPoly(x, y, track.inner);
          const inOuter = pointInPoly(x, y, track.outer);
          if (!inInner && inOuter) continue;
          if (!inInner && !inOuter && !tryPlace(track, x, y, 14)) continue;
          let img;
          if (hasStandLarge && rnd() < 0.55) img = pick(sprites.buildings.standLarge, rnd);
          else if (hasStandBlock && rnd() < 0.7) img = pick(sprites.buildings.standBlock, rnd);
          else img = pick(sprites.buildings.stand, rnd);
          if (!img) continue;
          if (!stampOk(stampLog, img, x, y, 100, 1)) continue;
          const layerList = inInner ? near : mid;
          tryAddStamp(layerList, img, x, y, varyScale(rnd, 0.9, 1.2), inInner ? 'near' : 'mid',
            y + img.height * 0.45, 'stand');
          break;
        }
      }
    }
  }

  // Cargo quay: rare crane landmarks (1–3 per lap) — NEVER on Neon/Gridlock/Razor
  if (hasCrane && profile.craneCount > 0) {
    const want = Math.max(1, Math.min(3, profile.craneCount | 0));
    const craneLms = landmarks.filter((lm) =>
      lm.kind === 'corner' || lm.kind === 'kink' || lm.kind === 'pit' || lm.kind === 'bead' ||
      (lm.id && /quay|warehouse|dock|pinch/i.test(lm.id)));
    const pool = (craneLms.length ? craneLms : landmarks).filter((lm) => lm.kind !== 'start');
    const used = [];
    for (let attempt = 0; attempt < pool.length && craneCount < want; attempt++) {
      const lm = pool[attempt];
      if (nearStartFinish(lm.x, lm.y, 220)) continue;
      let tooClose = false;
      for (const u of used) {
        if (Math.hypot(lm.x - u.x, lm.y - u.y) < 380) { tooClose = true; break; }
      }
      if (tooClose) continue;
      const pcx = track.width * 0.5, pcy = track.height * 0.5;
      const dx = lm.x - pcx, dy = lm.y - pcy;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len, ny = dy / len;
      const tx = -ny, ty = nx;
      let placed = false;
      // Prefer near-trackside in-bounds so race zoom reads the crane (v28)
      const margin = 40;
      for (const dist of [85, 105, 70, 130, 155, 190, 60]) {
        for (const side of [1, -1, 0.35, -0.35, 0.7, -0.7, 0]) {
          const x = lm.x + nx * dist + tx * side * 48;
          const y = lm.y + ny * dist + ty * side * 48;
          // Keep crane fully in race-readable bounds (avoid y<0 horizon clip)
          if (x < margin || y < margin || x > track.width - margin || y > track.height - margin) continue;
          if (isOnAsphalt(track, x, y)) continue;
          const inInner = pointInPoly(x, y, track.inner);
          const inOuter = pointInPoly(x, y, track.outer);
          if (!inInner && inOuter) continue;
          if (!inInner && !inOuter && !tryPlace(track, x, y, 12)) continue;
          // Prefer craneMd (first in variants list)
          const img = pick(sprites.buildings.crane, rnd);
          if (!img) continue;
          if (!stampOk(stampLog, img, x, y, 160, 1)) continue;
          const layerList = inInner ? near : mid;
          // Bypass tower/billboard caps — crane is its own kind
          const sca = varyScale(rnd, 1.65, 2.05);
          // Prefer near layer so crane draws after mid warehouses
          const craneLayerList = near;
          const craneLayerName = 'near';
          // High sortY so lattice boom paints above warehouse stacks (v28)
          addItem(craneLayerList, img, x, y, sca, craneLayerName,
            y + img.height * sca * 0.95 + 80, 'crane');
          stampLog.push({ img, x, y, kind: 'crane' });
          craneCount++;
          used.push({ x: lm.x, y: lm.y });
          // Cull overlapping warehouses so crane silhouette reads
          for (let i = mid.length - 1; i >= 0; i--) {
            const o = mid[i];
            if (!o || o.kind !== 'warehouse') continue;
            if (Math.hypot(o.x - x, o.y - y) < 140) mid.splice(i, 1);
          }
          for (let i = near.length - 1; i >= 0; i--) {
            const o = near[i];
            if (!o || o.kind !== 'warehouse') continue;
            if (Math.hypot(o.x - x, o.y - y) < 140) near.splice(i, 1);
          }
          for (let i = stampLog.length - 1; i >= 0; i--) {
            const o = stampLog[i];
            if (!o || o.kind !== 'warehouse') continue;
            if (Math.hypot(o.x - x, o.y - y) < 140) stampLog.splice(i, 1);
          }
          placed = true;
          break;
        }
        if (placed) break;
      }
    }
  }

  // Infield yard props (inside inner ring) — low industrial clutter so oval sits in a yard
  {
    const cx = track.width * 0.5, cy = track.height * 0.5;
    const infieldN = profile.infieldYardN;
    for (let i = 0; i < infieldN; i++) {
      const ang = rnd() * Math.PI * 2;
      const rad = 40 + rnd() * 140;
      const x = cx + Math.cos(ang) * rad * (track.width / 1600);
      const y = cy + Math.sin(ang) * rad * (track.height / 1000) * 0.85;
      if (!pointInPoly(x, y, track.inner)) continue;
      // keep clear of inner wall
      let nearWall = false;
      for (const p of track.inner) {
        if (Math.hypot(p.x - x, p.y - y) < 36) { nearWall = true; break; }
      }
      if (nearWall) continue;
      const roll = rnd();
      let img, scale;
      const [wLo, wHi] = profile.warehouseScale;
      if (roll < 0.22) { img = pick(sprites.props.barrel, rnd); scale = varyScale(rnd, 0.7, 1.2); }
      else if (roll < 0.4) { img = pick(sprites.props.cone, rnd); scale = varyScale(rnd, 0.7, 1.2); }
      else if (roll < 0.55) { img = pick(sprites.props.fence, rnd); scale = varyScale(rnd, 0.7, 1.15); }
      else if (roll < 0.64) {
        // Razor dark infield: fewer lit lamps
        if (profile.infieldDark && rnd() > 0.35) { img = pick(sprites.props.fence, rnd); scale = varyScale(rnd, 0.7, 1.1); }
        else { img = pick(sprites.props.lamp, rnd); scale = varyScale(rnd, 0.7, 1.1); }
      } else if (!profile.cityCircuit && roll < 0.64 + (profile.infieldDark ? 0.08 : profile.warehouseBias * 0.4)) {
        img = pick(whSmListEarly, rnd); scale = varyScale(rnd, wLo * 0.85, wHi * 0.9);
      } else if (profile.cityCircuit && roll < 0.78) {
        // Soft props only — fabric carpet owns the infield mass
        img = pick(sprites.props.barrel, rnd); scale = varyScale(rnd, 0.7, 1.1);
      } else { img = pick(sprites.props.barrel, rnd); scale = varyScale(rnd, 0.7, 1.1); }
      const infieldCityKey = null; // city accents not from yard
      if (infieldCityKey) {
        const k = infieldCityKey.startsWith('citystreet') ? 'citystreet' : 'cityblock';
        tryAddStamp(near, img, x, y, scale, 'near', y, k, stampOpts);
        stampOpts = null;
      } else if (!stampOk(stampLog, img, x, y, 55, 1)) {
        continue;
      } else if (stampOpts) {
        addItem(near, img, x, y, scale, 'near', y, null, stampOpts);
        stampLog.push({ img, x, y, kind: 'other', srcKey: plateSrcKey(img) });
        stampOpts = null;
      } else {
        addItem(near, img, x, y, scale, 'near');
        stampLog.push({ img, x, y });
      }
    }
  }

  // Sparse corner/off-track fill — profile-biased; NO cyan tower clusters (v19/v28)
  for (let i = 0; i < 22; i++) {
    const x = rnd() * (track.width + 160) - 80;
    const y = rnd() * (track.height + 160) - 80;
    if (!tryPlace(track, x, y, 50)) continue;
    if (pointInPoly(x, y, track.outer)) continue;
    const atPinch = profile.pinchStandsOnly && nearPinch(x, y);
    const roll = rnd();
    let img, kind = 'other';
    if (atPinch) {
      img = pick(hasStandBlock ? sprites.buildings.standBlock : sprites.buildings.stand, rnd);
      kind = 'stand';
    } else {
      if (profile.cityCircuit) {
        const pickC = pickCityCircuitStamp(sprites, profile, rnd, { preferFabric: true, preferFar: true });
        if (pickC && pickC.img) { img = pickC.img; kind = 'cityfabric'; stampOpts = (pickC.flipX || pickC.rot) ? { flipX: !!pickC.flipX, rot: pickC.rot || 0 } : null; }
        else { continue; }
      } else {
      const whCut = profile.warehouseBias < 0.15 ? profile.warehouseBias * 0.5 : (0.45 + profile.warehouseBias * 0.3);
      const standCut = profile.standsOnlyAtSF ? whCut : (whCut + profile.standBias * 0.35);
      const bbCut = standCut + profile.billboardBias;
      if (hasContainers && profile.quayAssets && roll < profile.containerBias * 0.4) {
        img = pick(sprites.buildings.containers, rnd); kind = 'containers';
      } else if (roll < whCut) { img = pick(sprites.buildings.warehouse, rnd); kind = 'warehouse'; }
      else if (roll < standCut && hasStandBlock) { img = pick(sprites.buildings.standBlock, rnd); kind = 'stand'; }
      else if (roll < bbCut || profile.billboardBias >= 0.22) { img = pick(sprites.buildings.billboard, rnd); kind = 'billboard'; }
      else if (roll < 0.92) { img = pick(sprites.buildings.chimney, rnd); }
      else { img = pick(sprites.buildings.tower, rnd); kind = 'tower'; }
      }
    }
    if (!img) continue;
    const scale = varyScale(rnd, 0.75, 1.3);
    tryAddStamp(far, img, x, y, scale, 'far', y, kind);
  }

  // Sort for painter's algorithm within layer
  const byY = (a, b) => a.sortY - b.sortY;
  far.sort(byY);
  mid.sort(byY);
  near.sort(byY);

  // Pre-render distant skyline strip (screen-space parallax)
  const skyline = buildSkylineStrip(theme, track);
  // Ground plate cached at modest resolution
  const ground = buildGroundPlate(track, theme);

  // Phase A: enforce visible stamp budgets — prefer larger Md landmarks.
  // cityfabric is EXEMPT from mid/near/far caps (continuous carpet must survive).
  const midCap = profile.midCap != null ? profile.midCap : SCENERY_DENSITY.midCap;
  const farCap = profile.farCap != null ? profile.farCap : SCENERY_DENSITY.farCap;
  const nearCap = profile.nearCap != null ? profile.nearCap : SCENERY_DENSITY.nearCap;
  const midKeepDist = profile.cityCircuit ? 72 : 150;
  function splitFabricCap(list, cap, minDist) {
    const arr = list || [];
    if (!profile.cityCircuit) return enforceLayerCap(arr, cap, minDist);
    const fabric = arr.filter((it) => it && it.kind === 'cityfabric');
    const other = arr.filter((it) => it && it.kind !== 'cityfabric');
    const cappedOther = enforceLayerCap(other, cap, minDist);
    return cappedOther.concat(fabric).sort((a, b) => a.sortY - b.sortY);
  }
  const farCapped = splitFabricCap(far, farCap, profile.cityCircuit ? 140 : 180);
  const midCapped = splitFabricCap(mid, midCap, midKeepDist);
  const nearCapped = splitFabricCap(near, nearCap, profile.cityCircuit ? 90 : 120);
  // Thinner near list for low-zoom draw path — still keep fabric
  const nearThin = splitFabricCap(nearCapped, Math.max(4, Math.floor(nearCap * 0.45)), 160);

  // A.1 hard scrub: cityCircuit mid/near/far never keep warehouse stamps
  let farFinal = farCapped;
  let midFinal = midCapped;
  let nearFinal = nearCapped;
  let nearThinFinal = nearThin;
  if (profile.cityCircuit) {
    const dropWh = (arr) => (arr || []).filter((it) => it && it.kind !== 'warehouse');
    farFinal = dropWh(farFinal);
    midFinal = dropWh(midFinal);
    nearFinal = dropWh(nearFinal);
    nearThinFinal = dropWh(nearThinFinal);
  }

  const finalAll = [...farFinal, ...midFinal, ...nearFinal];
  const fabricFinal = finalAll.filter((it) => it.kind === 'cityfabric').length;
  const accentFinal = finalAll.filter((it) => it.kind === 'cityblock' || it.kind === 'citystreet').length;
  const stampCounts = {
    tower: towerCount,
    billboard: billboardCount,
    crane: craneCount,
    containers: stampLog.filter((p) => p.kind === 'containers').length,
    cityblock: finalAll.filter((it) => it.kind === 'cityblock').length,
    citystreet: finalAll.filter((it) => it.kind === 'citystreet').length,
    cityfabric: fabricFinal,
    cityAccents: accentFinal,
    warehouse: stampLog.filter((p) => p.kind === 'warehouse').length,
    warehouseAfterScrub: profile.cityCircuit
      ? finalAll.filter((it) => it.kind === 'warehouse').length
      : null,
    cityblockMdPool: (sprites.buildings.cityblockMd || []).length,
    citystreetMdPool: (sprites.buildings.citystreetMd || []).length,
    far: farFinal.length, mid: midFinal.length, near: nearFinal.length,
    farRaw: far.length, midRaw: mid.length, nearRaw: near.length,
    caps: {
      mid: midCap, far: farCap, near: nearCap,
      fabricUncapped: !!profile.cityCircuit,
      cityAccentCap: profile.cityCircuit ? CITY_ACCENT_CAP : null
    }
  };
  return {
    trackId: track.id,
    theme,
    profile,
    sprites,
    far: farFinal,
    mid: midFinal,
    near: nearFinal,
    nearThin: nearThinFinal,
    skyline,
    ground,
    startX,
    startY,
    beadAnchors: beadAnchors.slice(),
    beadSpacing: BEAD_SPACING,
    beadSpacingIn: BEAD_SPACING_IN,
    stampCounts
  };
}

function buildSkylineStrip(theme, track) {
  const W = 900, H = 220;
  const { canvas, ctx } = makeCanvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, theme.skyTop);
  g.addColorStop(0.55, theme.skyMid);
  g.addColorStop(1, theme.skyBot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // stars / grit
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  const rnd = mulberry32(hashStr((track.id || '') + '-sky'));
  for (let i = 0; i < 80; i++) {
    const x = rnd() * W, y = rnd() * H * 0.55;
    ctx.globalAlpha = 0.15 + rnd() * 0.5;
    ctx.fillRect(x, y, 1 + (rnd() > 0.85 ? 1 : 0), 1);
  }
  ctx.globalAlpha = 1;

  // silhouette row
  const rnd2 = mulberry32(hashStr((track.id || '') + '-sil'));
  let x = -20;
  while (x < W + 40) {
    const bw = 18 + rnd2() * 50;
    const bh = 40 + rnd2() * 100;
    const base = H - 8;
    ctx.fillStyle = shade(theme.metal, -20 + (rnd2() * 20) | 0);
    ctx.fillRect(x, base - bh, bw, bh);
    // windows — Razor darker: much sparser lit cells
    const winGate = theme.infieldDark ? 0.82 : 0.45;
    for (let wy = base - bh + 6; wy < base - 8; wy += 10) {
      for (let wx = x + 3; wx < x + bw - 4; wx += 8) {
        if (rnd2() > winGate) {
          ctx.fillStyle = hexAlpha(rnd2() > 0.5 ? (theme.glowWin || theme.neonC) : theme.neonB, theme.infieldDark ? (0.12 + rnd2() * 0.18) : (0.2 + rnd2() * 0.3));
          ctx.fillRect(wx, wy, 4, 5);
        }
      }
    }
    // antenna
    if (rnd2() > 0.7) {
      ctx.strokeStyle = hexAlpha(theme.neonC || '#ffd080', 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + bw * 0.5, base - bh);
      ctx.lineTo(x + bw * 0.5, base - bh - 12);
      ctx.stroke();
      ctx.fillStyle = hexAlpha(theme.glowWin || '#ffb060', 0.65);
      ctx.fillRect(x + bw * 0.5 - 1.5, base - bh - 14, 3, 3);
    }
    x += bw + 4 + rnd2() * 16;
  }

  // Soft warm sodium haze (not cyan neon)
  ctx.fillStyle = hexAlpha(theme.neonC || '#ffd080', 0.1);
  ctx.fillRect(0, H - 18, W, 6);
  ctx.fillStyle = hexAlpha(theme.glowWin || '#ffb060', 0.08);
  ctx.fillRect(0, H - 12, W, 4);

  return canvas;
}

function buildVintageGroundPlate(track, theme) {
  // Cheap flat outfield + infield — no rooftop/lot tiling, no dual patterns
  const margin = 400;
  const sw = Math.ceil((track.width + margin * 2) / 2);
  const sh = Math.ceil((track.height + margin * 2) / 2);
  const { canvas, ctx } = makeCanvas(sw, sh);
  const outfield = (theme && theme.outfield) || '#0c0c12';
  const infield = (theme && theme.infield) || '#1e3a28';
  ctx.fillStyle = outfield;
  ctx.fillRect(0, 0, sw, sh);
  // Infield (inside inner kerb) in plate space
  if (track.inner && track.inner.length) {
    ctx.save();
    ctx.translate(margin / 2, margin / 2);
    ctx.scale(0.5, 0.5);
    ctx.beginPath();
    const pts = track.inner;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = infield;
    ctx.fill();
    ctx.restore();
  }
  canvas._margin = margin;
  canvas._scale = 2;
  canvas._vintageFast = true;
  return canvas;
}

function buildGroundPlate(track, theme) {
  if (theme && theme.vintageFast) return buildVintageGroundPlate(track, theme);

  // Wide plate: infield + outfield + beyond stamp ring — FAR lock pad ≥ ~1000wu
  const margin = 1100;
  const sw = Math.ceil((track.width + margin * 2) / 2);
  const sh = Math.ceil((track.height + margin * 2) / 2);
  const { canvas, ctx } = makeCanvas(sw, sh);
  // Slightly lifted plate so race zoom isn't void-black (v22)
  const g = ctx.createRadialGradient(sw * 0.5, sh * 0.45, 30, sw * 0.5, sh * 0.5, Math.max(sw, sh) * 0.72);
  g.addColorStop(0, theme.groundHi || '#2e2a22');
  g.addColorStop(0.35, '#221e18');
  g.addColorStop(0.7, theme.ground || '#1a1712');
  g.addColorStop(1, shade(theme.ground || '#161410', -6));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, sw, sh);

  const rnd = mulberry32(hashStr((track.id || '') + '-gnd'));

  // Soft lot seams (not a harsh black void grid) — stamps sit on continuous fabric
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  const panel = 36;
  for (let x = 0; x < sw; x += panel) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, sh); ctx.stroke();
  }
  for (let y = 0; y < sh; y += panel) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(sw, y); ctx.stroke();
  }
  // Very soft block seams
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  for (let x = 0; x < sw; x += panel * 4) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, sh); ctx.stroke();
  }
  for (let y = 0; y < sh; y += panel * 4) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(sw, y); ctx.stroke();
  }

  // Continuous asphalt / rooftop / lot fabric under scenery (A.1 / FAR lock)
  try {
    const pack = getAssetPack();
    const groundTex = (pack && pack.ready && (pack.urbanRooftop || pack.asphalt)) || null;
    if (groundTex) {
      const useRoof = !!(pack.urbanRooftop && groundTex === pack.urbanRooftop);
      const tw = useRoof ? 96 : 128, th = useRoof ? 96 : 72;
      const tile = document.createElement('canvas');
      tile.width = tw; tile.height = th;
      const tctx = tile.getContext('2d');
      tctx.imageSmoothingEnabled = true;
      tctx.drawImage(groundTex, 0, 0, tw, th);
      tctx.globalCompositeOperation = 'source-atop';
      // Warm lot tint — lighter when rooftop fill is the readable surface
      tctx.fillStyle = useRoof ? 'rgba(20, 18, 14, 0.12)' : 'rgba(28, 24, 18, 0.28)';
      tctx.fillRect(0, 0, tw, th);
      const pat = ctx.createPattern(tile, 'repeat');
      if (pat) {
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, sw, sh);
        ctx.globalAlpha = 1;
      }
      // Second pass: slightly offset street fabric so stamps can overlap 10–20% into it
      const tile2 = document.createElement('canvas');
      tile2.width = tw; tile2.height = th;
      const t2 = tile2.getContext('2d');
      t2.drawImage(groundTex, -tw * 0.15, -th * 0.1, tw, th);
      t2.globalCompositeOperation = 'source-atop';
      t2.fillStyle = 'rgba(22, 20, 16, 0.35)';
      t2.fillRect(0, 0, tw, th);
      const pat2 = ctx.createPattern(tile2, 'repeat');
      if (pat2) {
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = pat2;
        ctx.fillRect(0, 0, sw, sh);
        ctx.globalAlpha = 1;
      }
    } else {
      // Procedural asphalt fallback lot
      ctx.fillStyle = 'rgba(36, 32, 26, 0.55)';
      ctx.fillRect(0, 0, sw, sh);
      ctx.fillStyle = 'rgba(48, 44, 36, 0.18)';
      for (let i = 0; i < 40; i++) {
        const lx = rnd() * sw, ly = rnd() * sh;
        ctx.fillRect(lx, ly, 40 + rnd() * 90, 28 + rnd() * 60);
      }
    }
  } catch (_) {
    ctx.fillStyle = 'rgba(36, 32, 26, 0.55)';
    ctx.fillRect(0, 0, sw, sh);
  }

  // Warm sodium pools + grit so plate isn't flat black
  for (let i = 0; i < 28; i++) {
    const cx = rnd() * sw, cy = rnd() * sh;
    const r = 50 + rnd() * 110;
    const rg = ctx.createRadialGradient(cx, cy, 4, cx, cy, r);
    rg.addColorStop(0, 'rgba(255, 170, 80, 0.08)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let i = 0; i < 700; i++) {
    ctx.fillRect(rnd() * sw, rnd() * sh, 1 + (rnd() > 0.88 ? 1 : 0), 1);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (let i = 0; i < 120; i++) {
    const bw = 18 + rnd() * 50, bh = 10 + rnd() * 28;
    ctx.fillRect(rnd() * sw, rnd() * sh, bw, bh);
  }

  // Razor night-canyon: crush infield plate brightness (fewer lit windows feel)
  if (theme.infieldDark) {
    ctx.fillStyle = 'rgba(3, 1, 6, 0.52)';
    ctx.fillRect(0, 0, sw, sh);
  }

  // Soft outer fade — solid over track ring; gentle edge for horizon peek at grid (v22)
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  const edge = ctx.createRadialGradient(
    sw * 0.5, sh * 0.5, Math.min(sw, sh) * 0.42,
    sw * 0.5, sh * 0.5, Math.max(sw, sh) * 0.78
  );
  edge.addColorStop(0, 'rgba(0,0,0,1)');
  edge.addColorStop(0.55, 'rgba(0,0,0,1)');
  edge.addColorStop(0.78, 'rgba(0,0,0,0.92)');
  edge.addColorStop(0.9, 'rgba(0,0,0,0.72)');
  edge.addColorStop(1, 'rgba(0,0,0,0.42)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, sw, sh);
  ctx.restore();

  canvas._margin = margin;
  canvas._scale = 2;
  return canvas;
}

/** Draw screen-space sky + parallax skyline behind the world. */
export function drawArenaBackground(ctx, scenery, cam, W, H) {
  const theme = scenery.theme;
  // vintage-sprint: solid void — no pack skyline fill-rate cost
  if ((scenery.profile && scenery.profile.vintageFast) || (theme && theme.vintageFast)) {
    ctx.fillStyle = (theme && theme.outfield) || '#0c0c12';
    ctx.fillRect(0, 0, W, H);
    return;
  }
  const pack = getAssetPack();
  const packSky = (pack && pack.ready && pack.skyline) ? pack.skyline : null;

  if (packSky) {
    // Full-bleed horizon ONLY (v2.4 / v27 sky fix) — pack.skyline above plate
    const parallax = 0.14;
    const z = (cam && cam.zoom) || 1;
    const raceZoom = z >= 1.15;
    const cargo = !!(theme.killPinkWash || theme.skyWash);
    // Base fill: dark blue night under skyline (Cargo never green/pink)
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, theme.skyTop || '#00030b');
    sky.addColorStop(0.45, theme.skyMid || '#061018');
    sky.addColorStop(1, raceZoom ? '#141210' : (theme.ground || '#161410'));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Scale full width; force skyline top ≤ 0 so dark-blue PNG covers upper band
    const scale = (W / packSky.width) * (raceZoom ? 1.12 : 1.18);
    const dw = packSky.width * scale;
    const dh = packSky.height * scale;
    const ox = (W - dw) * 0.5 - ((cam.x * parallax) % Math.max(1, dw * 0.12));
    const horizonY = H * (raceZoom ? 0.36 : 0.44);
    // Asset: sky upper ~65%, city ~20%, black foot ~15% — park city on horizon
    const buildingBase = raceZoom ? 0.72 : 0.80;
    let oy = horizonY - dh * buildingBase - (cam.y * parallax * 0.035);
    if (oy > -2) oy = -Math.max(4, H * 0.02); // full-bleed: never leave maroon gap above
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    ctx.drawImage(packSky, ox, oy, dw, dh);
    if (raceZoom) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(packSky, ox, oy + H * 0.004, dw, dh);
      ctx.globalAlpha = 1;
    }

    // Ground underlay starts BELOW city band — must not paint over upper sky
    const gndTop = horizonY + H * (raceZoom ? 0.08 : 0.04);
    const gnd = ctx.createLinearGradient(0, gndTop, 0, H);
    gnd.addColorStop(0, 'rgba(22, 20, 16, 0)');
    gnd.addColorStop(0.25, raceZoom ? 'rgba(36, 32, 24, 0.08)' : 'rgba(36, 32, 24, 0.28)');
    gnd.addColorStop(0.55, raceZoom ? 'rgba(40, 36, 28, 0.36)' : (theme.groundHi || '#242018'));
    gnd.addColorStop(1, theme.ground || '#161410');
    ctx.fillStyle = gnd;
    ctx.fillRect(0, gndTop, W, H - gndTop);

    // Sodium wash — yellow for Cargo, amber otherwise; NEVER magenta/pink; keep off upper sky
    const washColor = theme.skyWash || '#ffc070';
    const washA = raceZoom ? (theme.killPinkWash ? 0.28 : 0.40) : (theme.killPinkWash ? 0.08 : 0.14);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = washA;
    ctx.fillStyle = washColor;
    // Band sits on city foot only — not the dark blue sky dome
    ctx.fillRect(0, horizonY - H * 0.02, W, H * 0.10);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  } else {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, theme.skyTop);
    sky.addColorStop(0.45, theme.skyMid);
    sky.addColorStop(1, theme.skyBot);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Parallax procedural skyline
    const img = scenery.skyline;
    if (img) {
      const parallax = 0.15;
      const ox = -((cam.x * parallax) % img.width);
      const oy = H * 0.28 - (cam.y * parallax * 0.05);
      ctx.globalAlpha = 0.95;
      ctx.imageSmoothingEnabled = true;
      for (let i = -1; i <= 2; i++) {
        ctx.drawImage(img, ox + i * img.width, oy, img.width, img.height * 0.85);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Soft warm fill — Cargo yellow sodium only (no magenta/pink sky wash)
  const killPink = !!(theme && theme.killPinkWash);
  const hg = ctx.createRadialGradient(W * 0.5, H * 0.62, 10, W * 0.5, H * 0.58, Math.max(W, H) * 0.55);
  if (killPink) {
    hg.addColorStop(0, 'rgba(255, 200, 70, 0.035)');
    hg.addColorStop(0.5, 'rgba(255, 170, 40, 0.015)');
  } else {
    hg.addColorStop(0, 'rgba(255, 180, 90, 0.05)');
    hg.addColorStop(0.45, 'rgba(255, 140, 60, 0.025)');
  }
  hg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, W, H);
}

/** Draw pre-baked ground plate in world space (call inside camera transform). */
export function drawGroundPlate(ctx, scenery, track, zoom = 1) {
  const g = scenery.ground;
  if (!g) return;
  const margin = g._margin || 200;
  const scale = g._scale || 2;
  ctx.imageSmoothingEnabled = !(g._vintageFast);
  if (g._vintageFast || (scenery.profile && scenery.profile.vintageFast)) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.drawImage(g, -margin, -margin, g.width * scale, g.height * scale);
    ctx.restore();
    return;
  }
  // Overview: plate still reads; race: stronger skyline peek through plate (v23)
  const z = zoom || 1;
  // A.1: stronger plate so stamps sit on continuous ground (less black void)
  let fade = 0.82;
  if (z < 0.7) fade = 0.70 + z * 0.35;
  else if (z < 1.05) fade = 0.78 + (z - 0.7) * 0.2; // grid ~0.88 → ~0.82
  else if (z < 1.35) fade = 0.68;
  else fade = 0.62;
  ctx.save();
  ctx.globalAlpha = Math.max(0.62, Math.min(0.92, fade));
  ctx.drawImage(g, -margin, -margin, g.width * scale, g.height * scale);
  ctx.restore();
}

function drawLayer(ctx, items, cam, W, H, zoom, pad, visCap) {
  // Frustum cull in world space — extra pad when zoomed out (countdown grid)
  const zoomPad = zoom < 0.85 ? 220 : 0;
  const hw = (W * 0.5) / zoom + pad + zoomPad;
  const hh = (H * 0.5) / zoom + pad + zoomPad;
  const minX = cam.x - hw, maxX = cam.x + hw;
  const minY = cam.y - hh, maxY = cam.y + hh;
  const farZoom = zoom < 0.75;
  const cap = (visCap != null && visCap > 0) ? visCap : 999;
  let drawn = 0;
  ctx.imageSmoothingEnabled = true;
  for (const it of items) {
    if (drawn >= cap) break;
    // Far / overview: drop thin crowd strips (grandstand mass already in mid layer)
    if (farZoom && it.kind === 'crowd') continue;
    const left = it.x - it.w * 0.5;
    const top = it.y - it.h;
    if (left + it.w < minX || left > maxX || top + it.h < minY || top > maxY) continue;
    let dw = it.w, dh = it.h;
    // Skip leftover thin crowd strips if any slipped through
    if (it.kind === 'crowd') {
      const aspect = (it.img.width || 1) / Math.max(1, it.img.height || 1);
      // Retire thin colourful strips / confetti slabs at any zoom (v19)
      if (aspect > 2.4 && it.h < 52) continue;
      if (it.h < 36) continue;
    }
    // Soft contact shadow under stamp
    const shX = left + (it.w - dw) * 0.5 + dw * 0.5;
    const shY = top + (it.h - dh) + dh * 0.92;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(shX, shY, dw * 0.38, Math.max(3, dh * 0.06), 0, 0, Math.PI * 2);
    ctx.fill();
    const dx = left + (it.w - dw) * 0.5;
    const dy = top + (it.h - dh);
    if (it.flipX || it.rot) {
      ctx.save();
      const cx = dx + dw * 0.5;
      const cy = dy + dh * 0.85; // pivot near ground contact
      ctx.translate(cx, cy);
      if (it.rot) ctx.rotate(it.rot);
      if (it.flipX) ctx.scale(-1, 1);
      ctx.drawImage(it.img, -dw * 0.5, -dh * 0.85, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(it.img, dx, dy, dw, dh);
    }
    drawn++;
  }
}

export function drawSceneryFar(ctx, scenery, cam, W, H, zoom) {
  const vf = !!(scenery.profile && scenery.profile.vintageFast);
  drawLayer(ctx, scenery.far, cam, W, H, zoom, 160, vf ? 0 : 10);
}

export function drawSceneryMid(ctx, scenery, cam, W, H, zoom) {
  const vf = !!(scenery.profile && scenery.profile.vintageFast);
  drawLayer(ctx, scenery.mid, cam, W, H, zoom, 120, vf ? 16 : 18);
}

export function drawSceneryNear(ctx, scenery, cam, W, H, zoom) {
  // Phase A: at low zoom drop most near stamps (use nearThin if present)
  const z = zoom != null ? zoom : ((cam && cam.zoom) || 1);
  const vf = !!(scenery.profile && scenery.profile.vintageFast);
  let items = scenery.near;
  let visCap = vf ? 4 : 12;
  if (z < 0.7) {
    items = scenery.nearThin || scenery.near;
    visCap = vf ? 2 : 5;
  } else if (z < 0.85) {
    visCap = vf ? 3 : 8;
  }
  drawLayer(ctx, items, cam, W, H, zoom, 80, visCap);
}

/** Title / menu backdrop — neon skyline painting as canvas. */
export function createMenuBackdrop(width = 1280, height = 720) {
  const theme = themeFor({ id: 'neon_loop', wall: '#00e8ff', accent: '#ff2bd6' });
  const { canvas, ctx } = makeCanvas(width, height);
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, '#03060e');
  g.addColorStop(0.4, '#0a1430');
  g.addColorStop(0.75, '#12101c');
  g.addColorStop(1, '#0a0c10');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  const rnd = mulberry32(0x7a0ca75);
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 120; i++) {
    ctx.globalAlpha = 0.12 + rnd() * 0.5;
    ctx.fillRect(rnd() * width, rnd() * height * 0.55, rnd() > 0.9 ? 2 : 1, 1);
  }
  ctx.globalAlpha = 1;

  // distant skyline silhouettes
  let x = -30;
  const base = height * 0.72;
  while (x < width + 40) {
    const bw = 22 + rnd() * 70;
    const bh = 50 + rnd() * 160;
    ctx.fillStyle = shade(theme.metal, -25 + ((rnd() * 25) | 0));
    ctx.fillRect(x, base - bh, bw, bh);
    for (let wy = base - bh + 8; wy < base - 10; wy += 11) {
      for (let wx = x + 4; wx < x + bw - 5; wx += 9) {
        if (rnd() > 0.4) {
          ctx.fillStyle = hexAlpha(rnd() > 0.5 ? theme.neonA : theme.neonB, 0.3 + rnd() * 0.45);
          ctx.fillRect(wx, wy, 4, 6);
        }
      }
    }
    if (rnd() > 0.65) {
      ctx.strokeStyle = theme.neonA;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + bw * 0.5, base - bh);
      ctx.lineTo(x + bw * 0.5, base - bh - 16);
      ctx.stroke();
      ctx.fillStyle = theme.neonB;
      ctx.beginPath();
      ctx.arc(x + bw * 0.5, base - bh - 16, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    x += bw + 6 + rnd() * 20;
  }

  // mid neon shops row
  const sprites = createScenerySprites(theme);
  for (let i = 0; i < 10; i++) {
    const img = sprites.buildings.shop[i % sprites.buildings.shop.length];
    const sx = 40 + i * 120 + (rnd() * 20);
    const sy = base - 10;
    ctx.drawImage(img, sx, sy - img.height * 0.9, img.width * 0.9, img.height * 0.9);
  }
  // crowd line
  for (let i = 0; i < 40; i++) {
    const img = sprites.characters[i % sprites.characters.length];
    const sx = 30 + i * 32 + (rnd() * 10);
    ctx.drawImage(img, sx, base + 8, img.width * 1.1, img.height * 1.1);
  }
  // palm + lamps
  for (let i = 0; i < 6; i++) {
    const lamp = sprites.props.lamp[i % 4];
    ctx.drawImage(lamp, 80 + i * 200, base - 40, lamp.width, lamp.height);
  }

  // track oval hint
  ctx.strokeStyle = hexAlpha(theme.neonA, 0.35);
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.ellipse(width * 0.5, height * 0.82, width * 0.38, height * 0.1, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = hexAlpha(theme.neonB, 0.25);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(width * 0.5, height * 0.82, width * 0.28, height * 0.06, 0, 0, Math.PI * 2);
  ctx.stroke();

  // vignette
  const vig = ctx.createRadialGradient(width * 0.5, height * 0.45, width * 0.15, width * 0.5, height * 0.5, width * 0.7);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, width, height);

  // scanline grit
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (let y = 0; y < height; y += 4) ctx.fillRect(0, y, width, 1);

  return canvas;
}

/** Ensure menu backdrop element exists behind UI. */
export function installMenuBackdrop() {
  let el = document.getElementById('menu-backdrop');
  if (!el) {
    el = document.createElement('canvas');
    el.id = 'menu-backdrop';
    el.setAttribute('aria-hidden', 'true');
    const app = document.getElementById('app');
    if (app) app.insertBefore(el, app.firstChild);
    else document.body.prepend(el);
  }
  const w = Math.min(1600, Math.max(960, window.innerWidth || 1280));
  const h = Math.min(900, Math.max(540, window.innerHeight || 720));
  if (el.width !== w || el.height !== h || !el._painted) {
    const src = createMenuBackdrop(w, h);
    el.width = w;
    el.height = h;
    const ctx = el.getContext('2d');
    ctx.drawImage(src, 0, 0, w, h);
    el._painted = true;
  }
  el.classList.add('visible');
  return el;
}

export function hideMenuBackdrop() {
  const el = document.getElementById('menu-backdrop');
  if (el) el.classList.remove('visible');
}

/** Scenery cache helper for renderer. */
export function createSceneryCache() {
  let cached = null;
  return {
    get(track) {
      if (!track) return null;
      const packGen = isPackReady() ? 1 : 0;
      if (cached && cached.trackId === track.id && cached._packGen === packGen) return cached;
      cached = buildTrackScenery(track);
      cached._packGen = packGen;
      try { if (typeof window !== 'undefined') window.__RAD_SCENERY__ = cached; } catch (_) {}
      return cached;
    },
    clear() { cached = null; }
  };
}
