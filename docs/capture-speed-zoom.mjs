import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'shots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:4173/index.html?v=' + Date.now();

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,720']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return;
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
}).catch(() => {});
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(900);
await page.waitForSelector('.menu-btns [data-act="single"]', { timeout: 12000 });
await page.click('.menu-btns [data-act="single"]');
await page.waitForSelector('#tracks button.btn.primary', { timeout: 8000 });
const buttons = await page.$$('#tracks button.btn.primary');
await buttons[0].click();
await sleep(1600);

async function setSpeed(spd, holdMs) {
  return page.evaluate(async (spd, holdMs) => {
    const g = window.__RAD_GAME__;
    const w = g && g.world;
    if (!w || !w.player) return null;
    w.race.countdown = 0; w.race.live = true; w.race.goFlash = 0;
    const p = w.player;
    // Place mid-straight-ish using current pos; set velocity along facing
    p.vx = Math.cos(p.angle) * spd;
    p.vy = Math.sin(p.angle) * spd;
    // Force several camera updates by spinning time
    const start = performance.now();
    while (performance.now() - start < holdMs) {
      // keep velocity locked so speed doesn't decay for the proof
      p.vx = Math.cos(p.angle) * spd;
      p.vy = Math.sin(p.angle) * spd;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return { zoom: w.cam.zoom, spd, cam: { x: w.cam.x, y: w.cam.y }, px: p.x, py: p.y };
  }, spd, holdMs);
}

const slow = await setSpeed(0.4, 900);
await page.screenshot({ path: join(OUT, '50-zoom-slow.png') });
console.log('slow', JSON.stringify(slow));

const fast = await setSpeed(3.8, 1100);
await page.screenshot({ path: join(OUT, '50b-zoom-fast.png') });
console.log('fast', JSON.stringify(fast));

await browser.close();
