// Clean FPS check (no screenshots inside the window): portrait 412×915 DPR 2.625, every track, bot driving on keys.
//   node docs/verify-fps.mjs <url> <pixi|canvas> [seconds=15] [extraQuery] [outFile]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [,, base = 'http://127.0.0.1:4547/', rk = 'pixi', secs = '15', extraQ = '', outFile = ''] = process.argv;
const qs = [rk === 'canvas' ? 'canvas=1' : '', extraQ].filter(Boolean).join('&');
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setBypassServiceWorker(true);
await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(base + (qs ? '?' + qs : ''), { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('radcars_core_v1', JSON.stringify({ mute: false, options: { aiCount: 5, laps: 3, difficulty: 1 }, bestLaps: {} })); });
await page.reload({ waitUntil: 'networkidle2' }); await sleep(1500);
const out = [];
const build = await page.evaluate(() => self.RADCARS_BUILD && self.RADCARS_BUILD.label);
for (let ti = 0; ti < 4; ti++) {
  await page.waitForSelector('[data-act=race]'); await page.tap('[data-act=race]'); await page.waitForSelector('#tracks button');
  await (await page.$$('#tracks button'))[ti].tap();
  await page.waitForFunction(() => window.__RAD_GAME__?.world?.race?.countdown <= 0, { timeout: 25000, polling: 50 });
  await page.evaluate(async () => {
    const { pointAt } = await import('./js/tracks.js'); const { angleDiff } = await import('./js/util.js'); const held = new Set();
    const set = (k, on) => { if (on && !held.has(k)) { held.add(k); window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); } else if (!on && held.has(k)) { held.delete(k); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); } };
    clearInterval(window.__bot); window.__bot = setInterval(() => { const w = window.__RAD_GAME__.world; if (!w) return; const p = w.player, spd = Math.hypot(p.vx, p.vy);
      const tp = pointAt(w.track, p.sPrev + 150 + spd * 0.35); const err = angleDiff(p.angle, Math.atan2(tp.y - p.y, tp.x - p.x));
      set('ArrowRight', err > 0.05); set('ArrowLeft', err < -0.05);
      const a1 = pointAt(w.track, p.sPrev + 60), a2 = pointAt(w.track, p.sPrev + 60 + spd * 0.55); const turn = Math.abs(angleDiff(Math.atan2(a1.ty, a1.tx), Math.atan2(a2.ty, a2.tx)));
      set('ArrowDown', (turn > 0.75 && spd > 640) || (Math.abs(err) > 0.8 && spd > 480)); }, 30);
  });
  await sleep(2500);
  const ft = await page.evaluate((ms) => new Promise((res) => { const ts = []; const t0 = performance.now(); const f = (t) => { ts.push(t); if (t - t0 < ms) requestAnimationFrame(f); else res(ts); }; requestAnimationFrame(f); }), Number(secs) * 1000);
  const d = ft.slice(1).map((t, i) => t - ft[i]); const s = [...d].sort((a, b) => a - b);
  const r = { track: ['neon', 'gridlock', 'razor', 'cargo'][ti], fps: +(d.length / ((ft[ft.length - 1] - ft[0]) / 1000)).toFixed(1), p5: +(1000 / s[Math.floor(s.length * 0.95)]).toFixed(1), worstMs: +s[s.length - 1].toFixed(1), over25: d.filter((x) => x > 25).length, frames: d.length };
  out.push(r); console.log(`${build} ${rk}${extraQ ? ' ' + extraQ : ''} ${r.track}: ${r.fps} fps avg, p5 ${r.p5}, worst ${r.worstMs} ms, ${r.over25}/${r.frames} frames > 25 ms`);
  await page.evaluate(() => { clearInterval(window.__bot); window.__RAD_GAME__.stopRace(); });
  await page.evaluate(() => document.querySelector('#title')?.click()).catch(() => {});
  await page.goto(page.url(), { waitUntil: 'networkidle2' }); await sleep(1200);
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
await browser.close();
