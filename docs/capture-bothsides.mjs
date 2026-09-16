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
await shot(page, '32-bothsides-grid');

await sleep(4200);
const meta = await page.evaluate(async () => {
  const tmod = await import('/js/tracks.js?t=' + Date.now());
  const smod = await import('/js/scenery.js?t=' + Date.now());
  const track = tmod.TRACKS[0];
  const sc = smod.buildTrackScenery(track);
  const beads = sc.beadAnchors || [];
  const inB = beads.filter((b) => b.side === 'in').length;
  const outB = beads.filter((b) => b.side === 'out').length;
  // Count mid stamps inside inner poly vs outside outer
  let midIn = 0, midOut = 0;
  for (const it of sc.mid || []) {
    const inside = (() => {
      const poly = track.inner;
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        const intersect = ((yi > it.y) !== (yj > it.y)) &&
          (it.x < (xj - xi) * (it.y - yi) / ((yj - yi) || 1e-9) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    })();
    if (inside) midIn++; else midOut++;
  }
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
  // nearest infield mid stamps to teleport point
  const nearIn = (sc.mid || []).filter((it) => {
    const d = Math.hypot(it.x - p.x, it.y - p.y);
    return d < 420;
  }).map((it) => ({ x: it.x|0, y: it.y|0, d: Math.hypot(it.x - p.x, it.y - p.y)|0, w: it.w|0 }));
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
    return {
      ok: true, x: p.x, y: p.y, idx, score: bestScore,
      beads: { in: inB, out: outB }, mid: { in: midIn, out: midOut, nearCam: nearIn.slice(0, 8) },
      far: sc.far.length, midN: sc.mid.length, nearN: sc.near.length
    };
  }
  return { ok: false, beads: { in: inB, out: outB }, mid: { in: midIn, out: midOut } };
});
console.log('teleport', JSON.stringify(meta, null, 2));

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
await shot(page, '31-bothsides-race');

await browser.close();
