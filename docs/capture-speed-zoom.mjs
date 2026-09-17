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
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
}).catch(() => {});
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(800);
await page.click('.menu-btns [data-act="single"]');
await page.waitForSelector('#tracks button.btn.primary');
await (await page.$$('#tracks button.btn.primary'))[0].click();
await sleep(1200);

async function holdAtSpeed(spd, frames) {
  return page.evaluate(async (spd, frames) => {
    const g = window.__RAD_GAME__;
    const w = g.world;
    w.race.countdown = 0; w.race.live = true; w.race.goFlash = 0;
    const p = w.player;
    const line = w.track.line;
    const i = (line.length * 0.35) | 0;
    const a = line[i], b = line[(i + 1) % line.length];
    p.x = a.x; p.y = a.y;
    p.angle = Math.atan2(b.y - a.y, b.x - a.x);
    let last = null;
    for (let f = 0; f < frames; f++) {
      p.vx = Math.cos(p.angle) * spd;
      p.vy = Math.sin(p.angle) * spd;
      await new Promise((r) => requestAnimationFrame(r));
      last = { spd: Math.hypot(p.vx, p.vy), zoom: w.cam.zoom };
    }
    return last;
  }, spd, frames);
}

const crawl = await holdAtSpeed(0.08, 55);
await page.screenshot({ path: join(OUT, '52-zoom-crawl.png') });
console.log('crawl', crawl);
const pace = await holdAtSpeed(0.9, 55);
await page.screenshot({ path: join(OUT, '52b-zoom-pace.png') });
console.log('pace', pace);
await browser.close();
