import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'shots');
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:4173/index.html?v=' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await sleep(700);
}

async function shot(page, name) {
  const canvas = await page.$('#game');
  const path = join(OUT, name + '.png');
  await canvas.screenshot({ path });
  console.log('wrote', name);
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,720']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('PAGEERR', e.message));

await gotoFresh(page);
console.log('pack', await waitPack(page));

await startTrack(page, 0);
await sleep(1400);
await shot(page, '30-long-filled-grid');

// Finish countdown then snap player to mid-straight (east side, both walls in frame)
await sleep(4200);
const meta = await page.evaluate(async () => {
  const tmod = await import('/js/tracks.js?t=' + Date.now());
  const track = tmod.TRACKS[0];
  const line = track.line;
  // Prefer a long horizontal mid-straight away from S/F: near max |x - cx| on flatter segment
  // East mid-straight: high X, mostly vertical travel — scenery on BOTH left/right of car
  const cx = track.width * 0.5, cy = track.height * 0.5;
  let best = 0, bestScore = -1;
  for (let i = 0; i < line.length; i++) {
    const a = line[i], b = line[(i + 5) % line.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const vertical = Math.abs(dy) / len;
    const east = a.x / track.width;
    const midY = 1 - Math.abs(a.y - cy) / (track.height * 0.5); // prefer mid height
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
    w.player.angle = ang;
    w.cam.x = p.x;
    w.cam.y = p.y;
    w.cam.zoom = 1.58; // ZOOM_NEAR
    if (w.race) { w.race.countdown = 0; w.race.live = true; }
    // freeze briefly so scenery both sides stays framed
    w.__shotFreeze = true;
    return { ok: true, x: p.x, y: p.y, idx, score: bestScore, beads: true };
  }
  return { ok: false, x: p.x, y: p.y, lineLen: line.length, idx, hasGame: !!game };
});
console.log('teleport', JSON.stringify(meta));

// If no world hook, wait for natural mid-straight drive
if (!meta.ok) {
  await sleep(9000);
} else {
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
}
await shot(page, '29-long-filled-race');

// Scenery stats
const stats = await page.evaluate(async () => {
  const tmod = await import('/js/tracks.js?t=' + Date.now());
  const smod = await import('/js/scenery.js?t=' + Date.now());
  const track = tmod.TRACKS[0];
  const sc = smod.buildTrackScenery(track);
  const beads = (sc.mid || []).length;
  return {
    far: sc.far.length,
    mid: sc.mid.length,
    near: sc.near.length,
    world: [track.width, track.height],
    camZoom: window.__RAD_WORLD__ && window.__RAD_WORLD__.cam ? window.__RAD_WORLD__.cam.zoom : null
  };
});
console.log('stats', JSON.stringify(stats));

await browser.close();
