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
await sleep(700);
await page.click('.menu-btns [data-act="single"]');
await page.waitForSelector('#tracks button.btn.primary');
await (await page.$$('#tracks button.btn.primary'))[0].click();
await sleep(1000);
const report = await page.evaluate(async () => {
  const g = window.__RAD_GAME__;
  const inp = window.__RAD_INPUT__;
  const w = g.world;
  const gridZoom = w.cam.zoom;
  w.race.countdown = 0; w.race.live = true; w.race.goFlash = 0;
  // One frame at rest after GO
  await new Promise((r) => requestAnimationFrame(r));
  const afterGo = w.cam.zoom;
  inp.state.accel = true;
  const series = [];
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    series.push({ i, spd: Math.hypot(w.player.vx, w.player.vy), zoom: w.cam.zoom });
  }
  inp.state.accel = false;
  const peak = series.reduce((a,b)=> b.spd>a.spd?b:a, series[0]);
  return { gridZoom, afterGo, peak, last: series.at(-1), early: series[10], mid: series[40] };
});
console.log(JSON.stringify(report, null, 2));
await browser.close();
