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
  { index: 1, id: 'gridlock', race: '33-gridlock-race', grid: '34-gridlock-grid' },
  { index: 2, id: 'razor_hairpin', race: '35-razor-race', grid: '36-razor-grid' },
  { index: 3, id: 'cargo_dock', race: '37-cargo-race', grid: '38-cargo-grid' }
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
    // Teleport to a long stretch that reads both sides
    const line = track.line;
    const cx = track.width * 0.5, cy = track.height * 0.5;
    let best = 0, bestScore = -1;
    for (let i = 0; i < line.length; i++) {
      const a = line[i], b = line[(i + 5) % line.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const vertical = Math.abs(dy) / len;
      const east = a.x / track.width;
      const midY = 1 - Math.abs(a.y - cy) / (track.height * 0.5);
      const score = east * 3 + vertical * 2 + Math.max(0, midY) * 0.8;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    const idx = best;
    const p = line[idx];
    const n = line[(idx + 1) % line.length];
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
    return {
      id: track.id,
      profile: sc.profile,
      beads: { in: inB, out: outB },
      mid: { in: midIn, out: midOut, n: (sc.mid || []).length },
      near: { in: nearIn, n: (sc.near || []).length },
      far: (sc.far || []).length,
      stampCounts: sc.stampCounts,
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
