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
  return pointInPoly(x, y, track.outer) && !pointInPoly(x, y, track.inner);
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
  const sodiumA = '#ff9a3c';
  const sodiumB = '#ffb84a';
  const sodiumC = '#ffd080';
  const id = track.id || '';
  if (id === 'gridlock') {
    return {
      skyTop: '#070a12', skyMid: '#0c1424', skyBot: '#141a22',
      ground: '#121410', groundHi: '#1c1c16',
      neonA: sodiumA, neonB: sodiumB, neonC: '#ffe600',
      brick: '#2a3038', brickHi: '#3a4250', metal: '#1a1e26',
      window: '#1a2838', glowWin: sodiumB
    };
  }
  if (id === 'razor_hairpin') {
    return {
      skyTop: '#0e0816', skyMid: '#1a0e22', skyBot: '#1e1420',
      ground: '#141210', groundHi: '#1e1a16',
      neonA: sodiumA, neonB: '#ff8a50', neonC: sodiumC,
      brick: '#2c2030', brickHi: '#3c3040', metal: '#1c1420',
      window: '#281828', glowWin: sodiumB
    };
  }
  if (id === 'cargo_dock') {
    return {
      skyTop: '#08140c', skyMid: '#0e1a14', skyBot: '#142018',
      ground: '#101410', groundHi: '#1a1e16',
      neonA: '#ff8a00', neonB: sodiumB, neonC: sodiumC,
      brick: '#243028', brickHi: '#344038', metal: '#141c16',
      window: '#182820', glowWin: '#ff8a00'
    };
  }
  return {
    skyTop: '#061018', skyMid: '#0c1a2c', skyBot: '#1a1820',
    ground: '#161410', groundHi: '#242018',
    neonA: sodiumA, neonB: sodiumB, neonC: sodiumC,
    brick: '#262c36', brickHi: '#363c48', metal: '#1a1e28',
    window: '#1a2434', glowWin: '#ffb060'
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
  const buildings = { warehouse: [], tower: [], shop: [], billboard: [], chimney: [], water: [], stand: [], standBlock: [], standLarge: [], _crowdDense: [], _crowdThin: [] };
  const characters = [];
  const props = { barrel: [], cone: [], light: [], fence: [], palm: [], lamp: [], tyrewall: [] };

  const packEarly = getAssetPack();
  const packSc = (packEarly && packEarly.ready && packEarly.scenery) ? packEarly.scenery : null;
  const hasPackPalms = !!(packSc && (packSc.palmSm || packSc.palmMd || packSc.palms || packSc.palm));
  const hasPackBillboards = !!(packSc && (packSc.billboardSm || packSc.billboardMd || packSc.billboard));

  for (let v = 0; v < 6; v++) {
    let c;
    c = makeCanvas(72, 96); paintWarehouse(c.ctx, 72, 96, theme, v); buildings.warehouse.push(c.canvas);
    c = makeCanvas(56, 128); paintTower(c.ctx, 56, 128, theme, v); buildings.tower.push(c.canvas);
    c = makeCanvas(80, 88); paintNeonShop(c.ctx, 80, 88, theme, v); buildings.shop.push(c.canvas);
    if (!hasPackBillboards) {
      c = makeCanvas(96, 72); paintBillboard(c.ctx, 96, 72, theme, v); buildings.billboard.push(c.canvas);
    }
    c = makeCanvas(40, 110); paintChimney(c.ctx, 40, 110, theme, v); buildings.chimney.push(c.canvas);
    c = makeCanvas(64, 100); paintWaterTower(c.ctx, 64, 100, theme); buildings.water.push(c.canvas);
    c = makeCanvas(140, 72); paintGrandstand(c.ctx, 140, 72, theme, v); buildings.stand.push(c.canvas);
    c = makeCanvas(220, 110); paintGrandstandBlock(c.ctx, 220, 110, theme, v); buildings.standBlock.push(c.canvas);
  }
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
    if (sc.warehouseSm) variants.push(sc.warehouseSm);
    if (sc.warehouseMd) variants.push(sc.warehouseMd);
    if (sc.warehouse && variants.length < 2) variants.push(fitPackSprite(sc.warehouse, 100, 80));
    buildings.warehouse = variants.length ? variants : buildings.warehouse;
  }
  if (sc.towerSm || sc.towerMd || sc.tower) {
    const variants = [];
    if (sc.towerSm) variants.push(sc.towerSm);
    if (sc.towerMd) variants.push(sc.towerMd);
    if (sc.tower && variants.length < 2) variants.push(fitPackSprite(sc.tower, 56, 128));
    buildings.tower = variants.length ? variants : buildings.tower;
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
    if (sc.billboardSm) variants.push(sc.billboardSm);
    if (sc.billboardMd) variants.push(sc.billboardMd);
    if (sc.billboard && variants.length < 2) variants.push(fitPackSprite(sc.billboard, 110, 80));
    if (variants.length) buildings.billboard = variants;
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

function addItem(list, img, x, y, scale, layer, sortY, kind) {
  if (!img) return;
  // Shorthand: addItem(..., layer, 'crowd') — string 7th arg is kind, not sortY
  let sy = sortY;
  let k = kind || null;
  if (k == null && typeof sy === 'string' && (sy === 'crowd' || sy === 'prop' || sy === 'building')) {
    k = sy;
    sy = y;
  }
  // Retire thin colourful crowd strips; keep dense pack masses (v18)
  let s = scale;
  if (img.__radCrowd === 'thin') return;
  if (k === 'crowd' || (!k && img.width / Math.max(1, img.height) > 2.4 && img.width > 70)) {
    k = 'crowd';
    const aspect = img.width / Math.max(1, img.height);
    // Dense pack sheets may be wide; only drop unmarked/thin landscape strips
    if (img.__radCrowd !== 'dense' && aspect > 2.2) return;
  }
  list.push({
    img,
    x,
    y,
    w: img.width * s,
    h: img.height * s,
    layer,
    sortY: sy != null ? sy : y,
    kind: k
  });
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

function varyScale(rnd, lo, hi) {
  return lo + rnd() * (hi - lo);
}

/**
 * Build layered scenery placements for a track (cached by caller).
 */
export function buildTrackScenery(track) {
  const theme = themeFor(track);
  const sprites = createScenerySprites(theme);
  const rnd = mulberry32(hashStr(track.id || 'track') ^ 0x5c3e17);
  const far = [];
  const mid = [];
  const near = [];
  const edges = perimeterNormals(track.outer);
  // When pack art is ready, cut remaining procedural neon-framed kinds so they don't dominate
  const packReady = !!(getAssetPack() && getAssetPack().ready);
  const proceduralCut = packReady; // shop / chimney / water still procedural

  const start = track.spawns && track.spawns[0];
  const startX = start ? start.x : track.width * 0.5;
  const startY = start ? start.y : track.height * 0.2;

  // Landmark anchors (from track) drive clustering; thin mid-straights
  const landmarks = (track.landmarks && track.landmarks.length)
    ? track.landmarks
    : [{ id: 'start_finish', x: startX, y: startY, kind: 'start' }];

  function landmarkBoost(x, y) {
    let best = 0;
    let nearest = null;
    for (const lm of landmarks) {
      const d = Math.hypot(x - lm.x, y - lm.y);
      let radius = 160;
      let weight = 0.55;
      if (lm.kind === 'start' || lm.id === 'start_finish') { radius = 300; weight = 1; }
      else if (lm.kind === 'pit') { radius = 240; weight = 0.9; }
      else if (lm.kind === 'chicane' || lm.kind === 'kink') { radius = 200; weight = 0.75; }
      else if (lm.kind === 'corner') { radius = 220; weight = 0.8; }
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

  // Stamp variety tracker — break necklace of identical warehouse/tower/palm/billboard
  const stampLog = [];
  // Hard caps (v19 realistic polish) — horizon carries distance; no cyan tower clusters
  const TOWER_CAP = 5;
  const BILLBOARD_CAP = 5;
  let towerCount = 0;
  let billboardCount = 0;
  const hasStandBlock = !!(sprites.buildings.standBlock && sprites.buildings.standBlock.length);
  const hasStandLarge = !!(sprites.buildings.standLarge && sprites.buildings.standLarge.length);

  function tryAddStamp(list, img, x, y, scale, layer, sortY, kind) {
    if (!img) return false;
    if (kind === 'tower') {
      if (towerCount >= TOWER_CAP) return false;
    }
    if (kind === 'billboard') {
      if (billboardCount >= BILLBOARD_CAP) return false;
    }
    if (!stampOk(stampLog, img, x, y, kind === 'tower' ? 160 : 110, 1)) return false;
    // Extra spacing for towers/billboards so corners don't cluster
    if (kind === 'tower' || kind === 'billboard') {
      let nearSame = 0;
      const r2 = (kind === 'tower' ? 220 : 180) ** 2;
      for (const p of stampLog) {
        if (p.kind !== kind) continue;
        const dx = p.x - x, dy = p.y - y;
        if (dx * dx + dy * dy < r2) nearSame++;
        if (nearSame >= 1) return false;
      }
    }
    addItem(list, img, x, y, scale, layer, sortY);
    stampLog.push({ img, x, y, kind: kind || 'other' });
    if (kind === 'tower') towerCount++;
    if (kind === 'billboard') billboardCount++;
    return true;
  }

  // Far skyline buildings — warehouse-dominated; towers/billboards hard-capped (v19)
  for (const e of edges) {
    const steps = Math.max(2, Math.floor(e.len / 84)); // sparser — horizon carries distance
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
      if (boost < 0.15 && rnd() > 0.35) continue;
      if (boost < 0.35 && rnd() > 0.55) continue;
      const roll = rnd();
      let img, scale, kind = 'other';
      // Prefer warehouse; sparse chimney/water; tower/billboard rare + capped
      if (roll < 0.55) { img = pick(sprites.buildings.warehouse, rnd); scale = varyScale(rnd, 0.8, 1.35); kind = 'warehouse'; }
      else if (roll < 0.68) { img = pick(sprites.buildings.chimney, rnd); scale = varyScale(rnd, 0.75, 1.3); }
      else if (roll < 0.78) { img = pick(sprites.buildings.water, rnd); scale = varyScale(rnd, 0.7, 1.25); }
      else if (roll < 0.88) { img = pick(sprites.buildings.tower, rnd); scale = varyScale(rnd, 0.7, 1.2); kind = 'tower'; }
      else { img = pick(sprites.buildings.billboard, rnd); scale = varyScale(rnd, 0.7, 1.15); kind = 'billboard'; }
      if (!img) continue;
      const sc = Math.min(1.4, scale * (1 + boost * 0.12));
      tryAddStamp(far, img, x, y, sc, 'far', y + (img.height * sc) * 0.5, kind);
    }
  }

  // Mid buildings — warehouse + grandstand mass; tower/billboard hard-capped (v19)
  for (const e of edges) {
    const dens = 0.7 + straightness(e) * 0.3;
    const steps = Math.max(2, Math.floor((e.len / 62) * dens));
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
      if (boost < 0.12 && rnd() > 0.32) continue;
      if (boost < 0.3 && rnd() > 0.5) continue;
      const dStart = Math.hypot(x - startX, y - startY);
      const nearStart = dStart < 280 || (nearest && (nearest.kind === 'start' || nearest.id === 'start_finish'));
      const roll = rnd();
      let img, scale, kind = 'other';
      if (nearStart && roll < 0.45) {
        // Prefer architectural standLarge / standBlock silhouette over thin stands
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
      } else if (boost > 0.45 && nearest && (nearest.kind === 'pit' || nearest.kind === 'corner') && roll < 0.5) {
        if (hasStandBlock && rnd() < 0.55) {
          img = pick(sprites.buildings.standBlock, rnd);
          scale = varyScale(rnd, 0.85, 1.2);
          kind = 'stand';
        } else {
          img = pick(sprites.buildings.warehouse, rnd);
          scale = varyScale(rnd, 0.8, 1.3);
          kind = 'warehouse';
        }
      } else if (roll < 0.06) {
        img = pick(sprites.buildings.shop, rnd);
        scale = varyScale(rnd, 0.75, 1.2);
      } else if (roll < 0.52) {
        img = pick(sprites.buildings.warehouse, rnd);
        scale = varyScale(rnd, 0.75, 1.35);
        kind = 'warehouse';
      } else if (roll < 0.68 && hasStandBlock) {
        img = pick(sprites.buildings.standBlock, rnd);
        scale = varyScale(rnd, 0.8, 1.15);
        kind = 'stand';
      } else if (roll < 0.78) {
        img = pick(sprites.buildings.billboard, rnd);
        scale = varyScale(rnd, 0.7, 1.15);
        kind = 'billboard';
      } else if (roll < 0.90) {
        img = pick(sprites.buildings.tower, rnd);
        scale = varyScale(rnd, 0.7, 1.2);
        kind = 'tower';
      } else {
        img = pick(sprites.buildings.chimney, rnd);
        scale = varyScale(rnd, 0.7, 1.25);
      }
      if (!img) continue;
      tryAddStamp(mid, img, x, y, scale, 'mid', y + img.height * scale * 0.45, kind);
    }
  }

  // Near props along outer wall — NO thin crowd strips (v18). Crowds only with grandstands.
  for (const e of edges) {
    const dens = 0.7 + straightness(e) * 0.35;
    const steps = Math.max(2, Math.floor((e.len / 40) * dens));
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
      // Fewer neon lamps; prefer props + palms with scale variety
      if (roll < 0.26) { img = pick(sprites.props.barrel, rnd); scale = varyScale(rnd, 0.75, 1.25); }
      else if (roll < 0.48) { img = pick(sprites.props.cone, rnd); scale = varyScale(rnd, 0.75, 1.3); }
      else if (roll < 0.64) { img = pick(sprites.props.fence, rnd); scale = varyScale(rnd, 0.8, 1.25); }
      else if (roll < 0.70) { img = pick(sprites.props.light, rnd); scale = varyScale(rnd, 0.7, 1.05); }
      else if (roll < 0.76) { img = pick(sprites.props.lamp, rnd); scale = varyScale(rnd, 0.7, 1.05); }
      else { img = pick(sprites.props.palm, rnd); scale = varyScale(rnd, 0.7, 1.4); }
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
      // S/F grandstand: outer margin near start is razor-thin on Neon Loop,
      // so prefer INFIELD (inside inner poly) facing the grid, then outer fallback.
      const imgLarge = (sprites.buildings.standLarge && sprites.buildings.standLarge.length)
        ? pick(sprites.buildings.standLarge, rnd)
        : pick(sprites.buildings.standBlock, rnd);
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
        addItem(mid, imgLarge, x, y, 1.9, 'mid', y + 110);
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
            // Prefer standLarge / standBlock architectural silhouette
            const flankImg = (hasStandLarge && rnd() < 0.5)
              ? pick(sprites.buildings.standLarge, rnd)
              : (hasStandBlock && rnd() < 0.6)
                ? pick(sprites.buildings.standBlock, rnd)
                : pick(sprites.buildings.stand, rnd);
            addItem(mid, flankImg, fxs, fys, varyScale(rnd, 1.0, 1.25), 'mid');
            // No crowd confetti beside standLarge/standBlock — roof+tiers carry read
            placedF = true;
            break;
          }
          if (placedF) break;
        }
      }
      continue;
    }

    // Major apexes / pits: prefer large block when available, else standard stand
    const isMajor = lm.kind === 'pit' || lm.kind === 'corner';
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
      // Skip dense crowd sheets when architectural stand is present
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

  // Infield yard props (inside inner ring) — low industrial clutter so oval sits in a yard
  {
    const cx = track.width * 0.5, cy = track.height * 0.5;
    const infieldN = track.id === 'neon_loop' ? 28 : 12;
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
      if (roll < 0.28) { img = pick(sprites.props.barrel, rnd); scale = varyScale(rnd, 0.7, 1.2); }
      else if (roll < 0.5) { img = pick(sprites.props.cone, rnd); scale = varyScale(rnd, 0.7, 1.2); }
      else if (roll < 0.68) { img = pick(sprites.props.fence, rnd); scale = varyScale(rnd, 0.7, 1.15); }
      else if (roll < 0.78) { img = pick(sprites.props.lamp, rnd); scale = varyScale(rnd, 0.7, 1.1); }
      else if (roll < 0.92) { img = pick(sprites.buildings.warehouse, rnd); scale = varyScale(rnd, 0.7, 1.15); }
      else { img = pick(sprites.props.light, rnd); scale = varyScale(rnd, 0.7, 1.1); }
      if (!stampOk(stampLog, img, x, y, 55, 1)) continue;
      addItem(near, img, x, y, scale, 'near');
      stampLog.push({ img, x, y });
    }
  }

  // Sparse corner/off-track fill — warehouse-dominated; NO cyan tower clusters (v19)
  for (let i = 0; i < 22; i++) {
    const x = rnd() * (track.width + 160) - 80;
    const y = rnd() * (track.height + 160) - 80;
    if (!tryPlace(track, x, y, 50)) continue;
    if (pointInPoly(x, y, track.outer)) continue;
    const roll = rnd();
    let img, kind = 'other';
    if (roll < 0.62) { img = pick(sprites.buildings.warehouse, rnd); kind = 'warehouse'; }
    else if (roll < 0.78 && hasStandBlock) { img = pick(sprites.buildings.standBlock, rnd); kind = 'stand'; }
    else if (roll < 0.88) { img = pick(sprites.buildings.chimney, rnd); }
    else if (roll < 0.94) { img = pick(sprites.buildings.tower, rnd); kind = 'tower'; }
    else { img = pick(sprites.buildings.billboard, rnd); kind = 'billboard'; }
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

  return {
    trackId: track.id,
    theme,
    sprites,
    far,
    mid,
    near,
    skyline,
    ground,
    startX,
    startY
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
    // windows
    for (let wy = base - bh + 6; wy < base - 8; wy += 10) {
      for (let wx = x + 3; wx < x + bw - 4; wx += 8) {
        if (rnd2() > 0.45) {
          ctx.fillStyle = hexAlpha(rnd2() > 0.5 ? (theme.glowWin || theme.neonC) : theme.neonB, 0.2 + rnd2() * 0.3);
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

function buildGroundPlate(track, theme) {
  // Wide plate: infield + outfield + beyond stamp ring — kill black void (v18)
  const margin = 560;
  const sw = Math.ceil((track.width + margin * 2) / 2);
  const sh = Math.ceil((track.height + margin * 2) / 2);
  const { canvas, ctx } = makeCanvas(sw, sh);
  const g = ctx.createRadialGradient(sw * 0.5, sh * 0.45, 30, sw * 0.5, sh * 0.5, Math.max(sw, sh) * 0.72);
  g.addColorStop(0, theme.groundHi || '#242018');
  g.addColorStop(0.4, theme.ground || '#161410');
  g.addColorStop(0.75, shade(theme.ground || '#161410', -8));
  g.addColorStop(1, shade(theme.ground || '#161410', -18));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, sw, sh);

  const rnd = mulberry32(hashStr((track.id || '') + '-gnd'));

  // Industrial plate panels across whole world (under + around track)
  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  const panel = 28;
  for (let x = 0; x < sw; x += panel) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, sh); ctx.stroke();
  }
  for (let y = 0; y < sh; y += panel) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(sw, y); ctx.stroke();
  }
  // Darker seam every 4 panels
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  for (let x = 0; x < sw; x += panel * 4) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, sh); ctx.stroke();
  }
  for (let y = 0; y < sh; y += panel * 4) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(sw, y); ctx.stroke();
  }

  // Optional pack asphalt tile over entire plate (not just racing surface)
  try {
    const pack = getAssetPack();
    if (pack && pack.ready && pack.asphalt) {
      const tw = 96, th = 54;
      const tile = document.createElement('canvas');
      tile.width = tw; tile.height = th;
      const tctx = tile.getContext('2d');
      tctx.imageSmoothingEnabled = true;
      tctx.drawImage(pack.asphalt, 0, 0, tw, th);
      tctx.globalCompositeOperation = 'source-atop';
      tctx.fillStyle = 'rgba(18, 16, 12, 0.45)';
      tctx.fillRect(0, 0, tw, th);
      const pat = ctx.createPattern(tile, 'repeat');
      if (pat) {
        ctx.globalAlpha = 0.42;
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, sw, sh);
        ctx.globalAlpha = 1;
      }
    }
  } catch (_) {}

  // Warm sodium pools + grit so plate isn't flat black
  for (let i = 0; i < 18; i++) {
    const cx = rnd() * sw, cy = rnd() * sh;
    const r = 40 + rnd() * 90;
    const rg = ctx.createRadialGradient(cx, cy, 4, cx, cy, r);
    rg.addColorStop(0, 'rgba(255, 170, 80, 0.05)');
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

  // Soft outer fade — let screen-space horizon read at grid zoom (v19)
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  const edge = ctx.createRadialGradient(
    sw * 0.5, sh * 0.5, Math.min(sw, sh) * 0.22,
    sw * 0.5, sh * 0.5, Math.max(sw, sh) * 0.52
  );
  edge.addColorStop(0, 'rgba(0,0,0,1)');
  edge.addColorStop(0.45, 'rgba(0,0,0,0.92)');
  edge.addColorStop(0.72, 'rgba(0,0,0,0.45)');
  edge.addColorStop(0.9, 'rgba(0,0,0,0.12)');
  edge.addColorStop(1, 'rgba(0,0,0,0)');
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
  const pack = getAssetPack();
  const packSky = (pack && pack.ready && pack.skyline) ? pack.skyline : null;

  if (packSky) {
    // Full-bleed horizon ONLY (v2.4) — parallax visible behind ground fade (v19)
    const parallax = 0.14;
    // Base fill: deep night sky (never leave raw canvas black)
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, theme.skyTop || '#040810');
    sky.addColorStop(0.45, theme.skyMid || '#0a1424');
    sky.addColorStop(1, theme.ground || '#161410');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Scale to full width; park building bases on screen horizon (~38%)
    const scale = (W / packSky.width) * 1.1;
    const dw = packSky.width * scale;
    const dh = packSky.height * scale;
    const ox = (W - dw) * 0.5 - ((cam.x * parallax) % Math.max(1, dw * 0.12));
    const horizonY = H * 0.42;
    // Asset: sky upper ~65%, city ~20%, black foot ~15% — base ≈ 0.80 of image
    const buildingBase = 0.78;
    const oy = horizonY - dh * buildingBase - (cam.y * parallax * 0.035);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    ctx.drawImage(packSky, ox, oy, dw, dh);

    // Warm underlay starts BELOW city band — do not crush skyline to black
    const gnd = ctx.createLinearGradient(0, horizonY + H * 0.06, 0, H);
    gnd.addColorStop(0, 'rgba(22, 20, 16, 0)');
    gnd.addColorStop(0.22, 'rgba(36, 32, 24, 0.35)');
    gnd.addColorStop(0.55, theme.groundHi || '#242018');
    gnd.addColorStop(1, theme.ground || '#161410');
    ctx.fillStyle = gnd;
    ctx.fillRect(0, horizonY + H * 0.06, W, H - horizonY);

    // Soft sodium wash — city stays readable
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.11;
    ctx.fillStyle = '#ffc070';
    ctx.fillRect(0, horizonY - H * 0.06, W, H * 0.1);
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

  // Soft warm fill (sodium) — neon dialled to accent only
  const hg = ctx.createRadialGradient(W * 0.5, H * 0.58, 10, W * 0.5, H * 0.55, Math.max(W, H) * 0.6);
  hg.addColorStop(0, 'rgba(255, 180, 90, 0.05)');
  hg.addColorStop(0.45, 'rgba(255, 140, 60, 0.025)');
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
  ctx.imageSmoothingEnabled = true;
  // At grid/overview zoom, pull plate alpha so screen-space horizon stays readable (v19)
  const z = zoom || 1;
  const fade = z < 0.7 ? (0.55 + z * 0.5) : 1; // ~0.55–0.9 when zoomed out
  ctx.save();
  ctx.globalAlpha = Math.max(0.5, Math.min(1, fade));
  ctx.drawImage(g, -margin, -margin, g.width * scale, g.height * scale);
  ctx.restore();
}

function drawLayer(ctx, items, cam, W, H, zoom, pad) {
  // Frustum cull in world space — extra pad when zoomed out (countdown grid)
  const zoomPad = zoom < 0.85 ? 220 : 0;
  const hw = (W * 0.5) / zoom + pad + zoomPad;
  const hh = (H * 0.5) / zoom + pad + zoomPad;
  const minX = cam.x - hw, maxX = cam.x + hw;
  const minY = cam.y - hh, maxY = cam.y + hh;
  const farZoom = zoom < 0.75;
  ctx.imageSmoothingEnabled = true;
  for (const it of items) {
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
    ctx.drawImage(it.img, left + (it.w - dw) * 0.5, top + (it.h - dh), dw, dh);
  }
}

export function drawSceneryFar(ctx, scenery, cam, W, H, zoom) {
  drawLayer(ctx, scenery.far, cam, W, H, zoom, 160);
}

export function drawSceneryMid(ctx, scenery, cam, W, H, zoom) {
  drawLayer(ctx, scenery.mid, cam, W, H, zoom, 120);
}

export function drawSceneryNear(ctx, scenery, cam, W, H, zoom) {
  drawLayer(ctx, scenery.near, cam, W, H, zoom, 80);
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
      return cached;
    },
    clear() { cached = null; }
  };
}
