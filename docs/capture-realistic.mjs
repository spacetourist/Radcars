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
  }, { timeout: 25000 }).catch(() => {});
  const ready = await page.evaluate(async () => {
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
  if (m.type() === 'error' || m.text().includes('assetPack') || m.text().includes('PACK')) {
    console.log('CONSOLE', m.type(), m.text());
  }
});

await gotoFresh(page);
await waitPack(page);

// Neon Loop grid — pack v2
await startTrack(page, 0);
await sleep(1100);
await shot(page, '18-no-outlines-grid');

// Mid-race (multiple AI colours on grid)
await sleep(5200);
await shot(page, '19-no-outlines-race');

const info = await page.evaluate(async () => {
  const m = await import('/js/assetPack.js');
  const p = m.getAssetPack();
  const carKeys = p && p.cars ? Object.keys(p.cars) : [];
  const cars = {};
  for (const k of carKeys) {
    const c = p.cars[k];
    cars[k] = c ? { w: c.width, h: c.height } : null;
  }
  return {
    ready: m.isPackReady(),
    pack: p && p.name,
    colorMap: m.PACK_CAR_COLOR_MAP,
    cars,
    carCount: carKeys.filter((k) => p.cars[k]).length,
    scenery: p && p.scenery ? {
      warehouse: !!(p.scenery.warehouse && p.scenery.warehouse.width),
      grandstand: !!(p.scenery.grandstand && p.scenery.grandstand.width),
      tower: !!(p.scenery.tower && p.scenery.tower.width),
      crowd: !!(p.scenery.crowd && p.scenery.crowd.width),
      tyrewall: !!(p.scenery.tyrewall && p.scenery.tyrewall.width),
      props: !!(p.scenery.props && p.scenery.props.width),
      palms: !!(p.scenery.palms && p.scenery.palms.width),
      billboard: !!(p.scenery.billboard && p.scenery.billboard.width),
      palmSm: p.scenery.palmSm ? [p.scenery.palmSm.width, p.scenery.palmSm.height] : null,
      billboardSm: p.scenery.billboardSm ? [p.scenery.billboardSm.width, p.scenery.billboardSm.height] : null,
      towerSm: p.scenery.towerSm ? [p.scenery.towerSm.width, p.scenery.towerSm.height] : null,
      crowdDense: !!(p.scenery.crowdDense && p.scenery.crowdDense.width),
      crowdDenseMd: p.scenery.crowdDenseMd ? [p.scenery.crowdDenseMd.width, p.scenery.crowdDenseMd.height] : null,
      grandstandLarge: !!(p.scenery.grandstandLarge && p.scenery.grandstandLarge.width),
      standLarge: p.scenery.standLarge ? [p.scenery.standLarge.width, p.scenery.standLarge.height] : null,
      standBlock: p.scenery.standBlock ? [p.scenery.standBlock.width, p.scenery.standBlock.height] : null
    } : null,
    skyline: !!(p && p.skyline),
    asphalt: !!(p && p.asphalt),
    windowInfo: typeof window !== 'undefined' ? window.__RAD_PACK_INFO__ : null
  };
});
console.log('pack info', JSON.stringify(info, null, 2));

await browser.close();
console.log('done');
