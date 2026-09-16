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
await sleep(1200);
await shot(page, '26-long-circuit-grid');

// Mid-race after countdown (~3.8s) + drive
await sleep(6500);
await shot(page, '27-long-circuit-race');

// HUD shot — full page so LAP pill is visible
const hudPath = join(OUT, '28-long-circuit-hud.png');
await page.screenshot({ path: hudPath });
console.log('wrote 28-long-circuit-hud');

const meta = await page.evaluate(async () => {
  const t = await import('/js/tracks.js?t=' + Date.now());
  const track = t.TRACKS[0];
  const hud = document.querySelector('#hud');
  const lap = hud && hud.querySelector('[data-h="lap"]');
  return {
    world: [track.width, track.height],
    cps: track.checkpoints.length,
    line: track.line.length,
    cpR: track.cpHitRadius,
    lapText: lap ? lap.textContent : null,
    hudHtml: hud ? hud.innerText.slice(0, 200) : null
  };
});
console.log('meta', JSON.stringify(meta));

await browser.close();
