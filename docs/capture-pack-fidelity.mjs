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
  { index: 3, id: 'cargo_dock', race: '42-cargo-sky-fix-race', grid: '42b-cargo-sky-fix-grid' },
  { index: 1, id: 'gridlock', race: '43-gridlock-fidelity-race', grid: '43b-gridlock-fidelity-grid' },
  { index: 2, id: 'razor_hairpin', race: '44-razor-fidelity-race', grid: '44b-razor-fidelity-grid' }
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
      const info = window.__RAD_PACK_INFO__ || {};
      return { ready: m.isPackReady(), skyline: !!(info.skyline), skylineRel: info.skylineRel, scenery: info.scenery };
    } catch (e) { return { ready: false, err: String(e) }; }
  });
}

async function startTrack(page, trackIndex) {
  await page.waitForSelector('.menu-btns [data-act="single"]', { timeout: 10000 });
  await page.click('.menu-btns [data-act="single"]');
  await page.waitForSelector('#tracks button.btn.primary', { timeout: 8000 });
  const buttons = await page.$$('#tracks button.btn.primary');
  if (!buttons[trackIndex]) throw new Error('No race button ' + trackIndex);
  await buttons[trackIndex].click();
  await sleep(900);
}

async function shot(page, name) {
  const canvas = await page.$('#game');
  const path = join(OUT, name + '.png');
  await canvas.screenshot({ path });
  console.log('wrote', name);
}

async function sampleSky(page) {
  return page.evaluate(() => {
    const c = document.getElementById('game');
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    const pts = [
      [0.5, 0.04], [0.2, 0.06], [0.8, 0.06], [0.5, 0.12], [0.5, 0.2]
    ];
    return pts.map(([fx, fy]) => {
      const d = ctx.getImageData((w * fx) | 0, (h * fy) | 0, 1, 1).data;
      return { x: fx, y: fy, rgb: [d[0], d[1], d[2]] };
    });
  });
}

async function sceneryMeta(page, trackIndex) {
  return page.evaluate(async (ti) => {
    const tmod = await import('/js/tracks.js?t=' + Date.now());
    const smod = await import('/js/scenery.js?t=' + Date.now());
    const track = tmod.TRACKS[ti];
    const sc = smod.buildTrackScenery(track);
    const lms = track.landmarks || [];
    const line = track.line;
    let bi = 0;
    const id = track.id || '';
    if (id === 'razor_hairpin') {
      const pinch = lms.find((l) => /waist_north/i.test(l.id || '')) || lms.find((l) => l.kind === 'kink');
      if (pinch) {
        let bd = 1e15;
        for (let i = 0; i < line.length; i++) {
          const d = Math.hypot(line[i].x - pinch.x, line[i].y - pinch.y);
          if (d < bd) { bd = d; bi = i; }
        }
      }
    } else if (id === 'cargo_dock') {
      const quay = lms.find((l) => /warehouse_corner|quay_east|dock_pinch/i.test(l.id || ''));
      if (quay) {
        let bd = 1e15;
        for (let i = 0; i < line.length; i++) {
          const d = Math.hypot(line[i].x - quay.x, line[i].y - quay.y);
          if (d < bd) { bd = d; bi = i; }
        }
      }
    } else if (id === 'gridlock') {
      const start = lms.find((l) => l.kind === 'start');
      let bestS = -1;
      for (let i = 0; i < line.length; i++) {
        const a = line[i];
        if (start && Math.hypot(a.x - start.x, a.y - start.y) < 380) continue;
        const b = line[(i + 8) % line.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const straight = Math.abs(b.y - a.y) / len;
        const score = straight * 3 + (a.x / track.width);
        if (score > bestS) { bestS = score; bi = i; }
      }
    }
    const p = line[bi];
    const n = line[(bi + 1) % line.length];
    const ang = Math.atan2(n.y - p.y, n.x - p.x);
    const game = window.__RAD_GAME__;
    const w = game && game.world;
    if (w && w.player && w.cam) {
      w.player.x = p.x; w.player.y = p.y; w.player.angle = ang;
      w.player.vx = 0; w.player.vy = 0;
      w.cam.x = p.x; w.cam.y = p.y; w.cam.zoom = 1.58;
      if (w.race) { w.race.countdown = 0; w.race.live = true; }
      w.__shotFreeze = true;
    }
    return {
      id: track.id,
      profile: sc.profile,
      theme: { skyTop: sc.theme.skyTop, skyWash: sc.theme.skyWash, killPinkWash: sc.theme.killPinkWash },
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
  const pack = await waitPack(page);
  console.log('pack', JSON.stringify(pack), 'track', t.id);
  await startTrack(page, t.index);
  await sleep(1500);
  await shot(page, t.grid);
  const skyGrid = await sampleSky(page);
  console.log('skyGrid', JSON.stringify(skyGrid));

  await sleep(2500);
  const meta = await sceneryMeta(page, t.index);
  console.log('meta', JSON.stringify(meta));
  if (meta.teleported) {
    await sleep(200);
    await page.evaluate(() => {
      const w = window.__RAD_GAME__ && window.__RAD_GAME__.world;
      if (!w || !w.player) return;
      w.cam.x = w.player.x; w.cam.y = w.player.y; w.cam.zoom = 1.58;
      w.player.vx = 0; w.player.vy = 0;
    });
    await sleep(200);
  }
  await shot(page, t.race);
  const skyRace = await sampleSky(page);
  console.log('skyRace', JSON.stringify(skyRace));
  report.push({ id: t.id, pack, meta, skyGrid, skyRace });
}

await browser.close();
console.log('REPORT', JSON.stringify(report, null, 2));
