import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:4173/index.html?v=' + Date.now();

const TRACKS = [
  { index: 0, race: '53-neon-city-race', grid: '53b-neon-city-grid' },
  { index: 1, race: '54-gridlock-city-race', grid: '54b-gridlock-city-grid' }
];

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,720']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

async function fresh() {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  }).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(900);
  await page.waitForFunction(() => window.__RAD_PACK_READY__ === true, { timeout: 20000 }).catch(() => {});
}

for (const t of TRACKS) {
  await fresh();
  const info = await page.evaluate(() => window.__RAD_PACK_INFO__ || null);
  console.log('pack', t.race, JSON.stringify(info));
  await page.waitForSelector('.menu-btns [data-act="single"]', { timeout: 12000 });
  await page.click('.menu-btns [data-act="single"]');
  await page.waitForSelector('#tracks button.btn.primary', { timeout: 8000 });
  const buttons = await page.$$('#tracks button.btn.primary');
  await buttons[t.index].click();
  await sleep(1600);
  const canvas = await page.$('#game');
  await canvas.screenshot({ path: join(OUT, t.grid + '.png') });
  console.log('wrote', t.grid);

  await page.evaluate(() => {
    const g = window.__RAD_GAME__;
    const w = g && g.world;
    if (!w) return;
    w.race.countdown = 0; w.race.live = true; w.race.goFlash = 0;
    const line = w.track.line;
    const i = (line.length * 0.38) | 0;
    const a = line[i], b = line[(i + 3) % line.length];
    w.player.x = a.x; w.player.y = a.y;
    w.player.angle = Math.atan2(b.y - a.y, b.x - a.x);
    w.player.vx = Math.cos(w.player.angle) * 0.9;
    w.player.vy = Math.sin(w.player.angle) * 0.9;
    w.cam.x = a.x + Math.cos(w.player.angle) * 120;
    w.cam.y = a.y + Math.sin(w.player.angle) * 120;
    w.cam.zoom = 0.72;
    w.__shotFreeze = true;
  });
  await sleep(400);
  await canvas.screenshot({ path: join(OUT, t.race + '.png') });
  console.log('wrote', t.race);
}
await browser.close();
