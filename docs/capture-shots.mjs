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
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await disableSW(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(700);
}

async function startTrack(page, trackIndex) {
  await page.waitForSelector('.menu-btns [data-act="single"]', { timeout: 10000 });
  await page.click('.menu-btns [data-act="single"]');
  await page.waitForSelector('#tracks button.btn.primary', { timeout: 8000 });
  const buttons = await page.$$('#tracks button.btn.primary');
  if (!buttons[trackIndex]) throw new Error('No race button ' + trackIndex);
  await buttons[trackIndex].click();
  await sleep(500);
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

// Neon grid
await gotoFresh(page);
await startTrack(page, 0);
await sleep(800);
await shot(page, '08-neon-loop-v11-grid');
await sleep(4500);
await shot(page, '09-neon-loop-v11-race');

// Gridlock
await gotoFresh(page);
await startTrack(page, 1);
await sleep(5200);
await shot(page, '10-gridlock-v11-race');

// Razor
await gotoFresh(page);
await startTrack(page, 2);
await sleep(5200);
await shot(page, '11-razor-hairpin-v11-race');

// Cargo
await gotoFresh(page);
await startTrack(page, 3);
await sleep(5200);
await shot(page, '12-cargo-dock-v11-race');

await browser.close();
console.log('all shots done');
