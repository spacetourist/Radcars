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
  await sleep(500);
}

async function waitPack(page) {
  await page.waitForFunction(() => {
    return window.__RAD_PACK_READY__ === true;
  }, { timeout: 20000 }).catch(() => {});
  // Also poll via module side-channel if we expose it
  const ready = await page.evaluate(async () => {
    // Dynamic import of pack status
    try {
      const m = await import('/js/assetPack.js?t=' + Date.now());
      if (!m.isPackReady()) await m.loadAssetPack();
      return m.isPackReady();
    } catch (e) {
      return false;
    }
  });
  console.log('pack ready:', ready);
  return ready;
}

async function startTrack(page, trackIndex) {
  await page.waitForSelector('.menu-btns [data-act="single"]', { timeout: 10000 });
  await page.click('.menu-btns [data-act="single"]');
  await page.waitForSelector('#tracks button.btn.primary', { timeout: 8000 });
  const buttons = await page.$$('#tracks button.btn.primary');
  if (!buttons[trackIndex]) throw new Error('No race button ' + trackIndex);
  await buttons[trackIndex].click();
  await sleep(600);
}

async function shot(page, name) {
  const canvas = await page.$('#game');
  const path = join(OUT, name + '.png');
  await canvas.screenshot({ path });
  console.log('wrote', name, path);
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,720']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('PAGEERR', e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.text().includes('assetPack')) console.log('CONSOLE', m.type(), m.text());
});

await gotoFresh(page);
await waitPack(page);

// Neon Loop grid
await startTrack(page, 0);
await sleep(900);
await shot(page, '12-realistic-grid');

// Mid-race
await sleep(4800);
await shot(page, '13-realistic-race');

// Quick sanity: pack cars used?
const info = await page.evaluate(async () => {
  const m = await import('/js/assetPack.js');
  const p = m.getAssetPack();
  return {
    ready: m.isPackReady(),
    cars: p && p.cars ? {
      cyan: !!(p.cars.cyan && p.cars.cyan.width),
      pink: !!(p.cars.pink && p.cars.pink.width),
      lime: !!(p.cars.lime && p.cars.lime.width),
      cyanSize: p.cars.cyan ? [p.cars.cyan.width, p.cars.cyan.height] : null
    } : null,
    scenery: p && p.scenery ? {
      warehouse: !!(p.scenery.warehouse && p.scenery.warehouse.width),
      grandstand: !!(p.scenery.grandstand && p.scenery.grandstand.width),
      warehouseSm: p.scenery.warehouseSm ? [p.scenery.warehouseSm.width, p.scenery.warehouseSm.height] : null
    } : null,
    skyline: !!(p && p.skyline),
    asphalt: !!(p && p.asphalt)
  };
});
console.log('pack info', JSON.stringify(info, null, 2));

await browser.close();
console.log('done');
