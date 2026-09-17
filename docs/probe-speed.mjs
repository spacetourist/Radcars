import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,720']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto('http://127.0.0.1:4173/index.html?v=' + Date.now(), { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
}).catch(()=>{});
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(800);
await page.click('.menu-btns [data-act="single"]');
await page.waitForSelector('#tracks button.btn.primary');
await (await page.$$('#tracks button.btn.primary'))[0].click();
await sleep(1200);
const samples = await page.evaluate(async () => {
  const g = window.__RAD_GAME__;
  const inp = window.__RAD_INPUT__;
  const w = g.world;
  w.race.countdown = 0; w.race.live = true; w.race.goFlash = 0;
  inp.state.accel = true;
  const out = [];
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const p = w.player;
    out.push({ spd: Math.hypot(p.vx, p.vy), zoom: w.cam.zoom });
  }
  inp.state.accel = false;
  return out;
});
const zooms = samples.map(s => s.zoom);
const spds = samples.map(s => s.spd);
console.log('spd min/max', Math.min(...spds).toFixed(3), Math.max(...spds).toFixed(3));
console.log('zoom min/max/first/last', Math.min(...zooms).toFixed(3), Math.max(...zooms).toFixed(3), zooms[0].toFixed(3), zooms.at(-1).toFixed(3));
// Find zoom at peak speed
let best = samples[0];
for (const s of samples) if (s.spd > best.spd) best = s;
console.log('at peak spd', best);
// Correlation: when spd>1, avg zoom
const fast = samples.filter(s => s.spd > 1.0);
const slow = samples.filter(s => s.spd < 0.4);
console.log('avg zoom fast', fast.length ? (fast.reduce((a,s)=>a+s.zoom,0)/fast.length).toFixed(3) : 'n/a');
console.log('avg zoom slow', slow.length ? (slow.reduce((a,s)=>a+s.zoom,0)/slow.length).toFixed(3) : 'n/a');
await browser.close();
