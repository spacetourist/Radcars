import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'shots');
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:4173/index.html?v=' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TRACKS = [
  { index: 1, id: 'gridlock', race: '39-gridlock-id-race', grid: '39b-gridlock-id-grid' },
  { index: 2, id: 'razor_hairpin', race: '40-razor-id-race', grid: '40b-razor-id-grid' },
  { index: 3, id: 'cargo_dock', race: '41-cargo-id-race', grid: '41b-cargo-id-grid' }
];

async function disableSW(page) {
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return;
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  }).catch(() => {});
}

async function gotoFresh(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await disableSW(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(600);
}

async function waitPack(page) {
  await page.waitForFunction(() => window.__RAD_PACK_READY__ === true, { timeout: 25000 }).catch(() => {});
  return page.evaluate(async () => {
    try {
      const m = await import('/js/assetPack.js?t=' + Date.now());
      if (!m.isPackReady()) await m.loadAssetPack();
      return m.isPackReady();
    } catch (e) { return false; }
  });
}

async function startTrack(page, trackIndex) {
  await page.waitForSelector('.menu-btns [data-act="single"]', { timeout: 10000 });
  await page.click('.menu-btns [data-act="single"]');
  await page.waitForSelector('#tracks button.btn.primary', { timeout: 8000 });
  const buttons = await page.$$('#tracks button.btn.primary');
  if (!buttons[trackIndex]) throw new Error('No race button ' + trackIndex);
  await buttons[trackIndex].click();
  await sleep(800);
}

async function shot(page, name) {
  const canvas = await page.$('#game');
  const path = join(OUT, name + '.png');
  await canvas.screenshot({ path });
  console.log('wrote', name);
}

async function sceneryMeta(page, trackIndex) {
  return page.evaluate(async (ti) => {
    const tmod = await import('/js/tracks.js?t=' + Date.now());
    const smod = await import('/js/scenery.js?t=' + Date.now());
    const track = tmod.TRACKS[ti];
    const sc = smod.buildTrackScenery(track);
    const beads = sc.beadAnchors || [];
    const inB = beads.filter((b) => b.side === 'in').length;
    const outB = beads.filter((b) => b.side === 'out').length;
    let midIn = 0, midOut = 0;
    const pointIn = (px, py, poly) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        const intersect = ((yi > py) !== (yj > py)) &&
          (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };
    for (const it of sc.mid || []) {
      if (pointIn(it.x, it.y, track.inner)) midIn++; else midOut++;
    }
    let nearIn = 0;
    for (const it of sc.near || []) {
      if (pointIn(it.x, it.y, track.inner)) nearIn++;
    }
    // Teleport: identity-aware viewpoint (Cargo long quay; Razor pinch; Gridlock outfield)
    const line = track.line;
    const cx = track.width * 0.5, cy = track.height * 0.5;
    let best = 0, bestScore = -1;
    const id = track.id || '';
    // Prefer landmark-based views when available
    const lms = track.landmarks || [];
    let forced = null;
    if (id === 'razor_hairpin') {
      const pinch = lms.find((l) => l.kind === 'kink' || /waist|pinch/i.test(l.id || ''));
      if (pinch && pinch.index != null) forced = pinch.index;
    } else if (id === 'cargo_dock') {
      const quay = lms.find((l) => /warehouse|quay|dock/i.test(l.id || '')) || lms.find((l) => l.kind === 'corner');
      if (quay && quay.index != null) forced = quay.index;
    }
    if (forced != null) {
      best = forced % line.length;
    } else {
      for (let i = 0; i < line.length; i++) {
        const a = line[i], b = line[(i + 5) % line.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const vertical = Math.abs(dy) / len;
        const east = a.x / track.width;
        const midY = 1 - Math.abs(a.y - cy) / (track.height * 0.5);
        let score = east * 3 + vertical * 2 + Math.max(0, midY) * 0.8;
        if (id === 'cargo_dock') score = (1 - Math.abs(a.y - cy) / (track.height * 0.5)) * 2 + (a.x / track.width) * 2;
        if (score > bestScore) { bestScore = score; best = i; }
      }
    }
    let p = line[best];
    let n = line[(best + 1) % line.length];
    // Prefer explicit landmark world coords for identity proofs
    if (id === 'razor_hairpin') {
      const pinch = lms.find((l) => /waist_north/i.test(l.id || '')) ||
        lms.find((l) => l.kind === 'kink');
      if (pinch) {
        p = { x: pinch.x, y: pinch.y };
        // aim along nearest line tangent
        let bi = 0, bd = 1e15;
        for (let i = 0; i < line.length; i++) {
          const d = Math.hypot(line[i].x - p.x, line[i].y - p.y);
          if (d < bd) { bd = d; bi = i; }
        }
        n = line[(bi + 1) % line.length];
        p = line[bi];
      }
    } else if (id === 'cargo_dock') {
      const quay = lms.find((l) => /warehouse_corner|quay_east/i.test(l.id || ''));
      if (quay) {
        let bi = 0, bd = 1e15;
        for (let i = 0; i < line.length; i++) {
          const d = Math.hypot(line[i].x - quay.x, line[i].y - quay.y);
          if (d < bd) { bd = d; bi = i; }
        }
        p = line[bi];
        n = line[(bi + 1) % line.length];
      }
    } else if (id === 'gridlock') {
      // Mid outfield straight — avoid S/F stand mass
      const start = lms.find((l) => l.kind === 'start');
      let bi = 0, bestS = -1;
      for (let i = 0; i < line.length; i++) {
        const a = line[i];
        if (start && Math.hypot(a.x - start.x, a.y - start.y) < 350) continue;
        const b = line[(i + 8) % line.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const straight = Math.abs(b.y - a.y) / len;
        const score = straight * 3 + (a.x / track.width);
        if (score > bestS) { bestS = score; bi = i; }
      }
      p = line[bi];
      n = line[(bi + 1) % line.length];
    }
    const ang = Math.atan2(n.y - p.y, n.x - p.x);
    const game = window.__RAD_GAME__;
    const w = game && game.world;
    if (w && w.player && w.cam) {
      w.player.x = p.x;
      w.player.y = p.y;
      w.player.angle = ang;
      w.player.vx = 0;
      w.player.vy = 0;
      w.cam.x = p.x;
      w.cam.y = p.y;
      w.cam.zoom = 1.58;
      if (w.race) { w.race.countdown = 0; w.race.live = true; }
      w.__shotFreeze = true;
    }
    const kindCount = (arr) => {
      const m = {};
      for (const it of arr || []) {
        const k = it.kind || 'other';
        m[k] = (m[k] || 0) + 1;
      }
      return m;
    };
    return {
      id: track.id,
      profile: sc.profile,
      beads: { in: inB, out: outB },
      mid: { in: midIn, out: midOut, n: (sc.mid || []).length },
      near: { in: nearIn, n: (sc.near || []).length },
      far: (sc.far || []).length,
      stampCounts: sc.stampCounts,
      midKinds: kindCount(sc.mid),
      nearKinds: kindCount(sc.near),
      pack: (window.__RAD_PACK_INFO__ && window.__RAD_PACK_INFO__.scenery) || null,
      teleported: !!(w && w.player)
    };
  }, trackIndex);
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,720']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('PAGEERR', e.message));

const report = [];

for (const t of TRACKS) {
  await gotoFresh(page);
  console.log('pack', await waitPack(page), 'track', t.id);
  await startTrack(page, t.index);
  await sleep(1400);
  await shot(page, t.grid);

  await sleep(3500);
  const meta = await sceneryMeta(page, t.index);
  console.log('meta', JSON.stringify(meta, null, 2));
  report.push(meta);

  if (meta.teleported) {
    await sleep(250);
    await page.evaluate(() => {
      const w = window.__RAD_GAME__ && window.__RAD_GAME__.world;
      if (!w || !w.player) return;
      w.cam.x = w.player.x;
      w.cam.y = w.player.y;
      w.cam.zoom = 1.58;
      w.player.vx = 0; w.player.vy = 0;
    });
    await sleep(200);
  } else {
    await sleep(6000);
  }
  await shot(page, t.race);
}

await browser.close();
console.log('REPORT', JSON.stringify(report, null, 2));
