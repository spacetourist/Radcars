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
page.on('pageerror', (e) => console.error('PAGEERR', e.message));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const r of regs) await r.unregister();
}).catch(() => {});
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(900);
await page.waitForSelector('.menu-btns [data-act="single"]', { timeout: 12000 });
await page.click('.menu-btns [data-act="single"]');
await page.waitForSelector('#tracks button.btn.primary', { timeout: 8000 });
const buttons = await page.$$('#tracks button.btn.primary');
await buttons[0].click();
await sleep(1600);
await page.evaluate(() => {
  const el = document.getElementById('touch-controls');
  if (el) el.classList.remove('hidden');
  const g = window.__RAD_GAME__;
  const w = g && g.world;
  if (w && w.race) { w.race.countdown = 0; w.race.live = true; w.race.goFlash = 0; }
});
await sleep(300);
const pad = await page.$('#aim-pad');
if (!pad) throw new Error('aim-pad missing');
const bb = await pad.boundingBox();
const cx = bb.x + bb.width / 2;
const cy = bb.y + bb.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + bb.width * 0.32, cy - bb.height * 0.18, { steps: 6 });
await sleep(250);
const aim = await page.evaluate(() => {
  const s = window.__RAD_INPUT__ && window.__RAD_INPUT__.state;
  return s ? { aimActive: s.aimActive, aimAngle: s.aimAngle } : null;
});
console.log('aim', JSON.stringify(aim));
await page.screenshot({ path: join(OUT, '49-radial-aim-ui.png') });
console.log('wrote 49-radial-aim-ui.png');
await page.mouse.up();
await sleep(150);
const after = await page.evaluate(() => {
  const s = window.__RAD_INPUT__ && window.__RAD_INPUT__.state;
  return s ? { aimActive: s.aimActive, aimAngle: s.aimAngle } : null;
});
console.log('after release', JSON.stringify(after));
await browser.close();
