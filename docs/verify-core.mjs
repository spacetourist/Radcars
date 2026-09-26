import puppeteer from '../node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import fs from 'fs';
const url = process.argv[2] || 'http://localhost:4173/';
const outDir = process.argv[3] || new URL('./shots', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push('CONSOLE.' + m.type() + ' ' + m.text()); });
page.on('requestfailed', r => errs.push('REQFAIL ' + r.url()));
await page.goto(url, { waitUntil: 'networkidle2' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle2' });
const names = ['neon', 'gridlock', 'razor', 'cargo'];
const lines = [];
const deg = r => (r * 180 / Math.PI);
const summary = [];
for (let ti = 0; ti < 4; ti++) {
  const errStart = errs.length;
  await page.click('[data-act=race]');
  await page.waitForSelector('#tracks button');
  await page.evaluate((ti) => document.querySelectorAll('#tracks button')[ti].click(), ti);
  // In-page steering bot: dispatches real keyboard events to the game's input listeners
  await page.evaluate(async () => {
    const { pointAt } = await import('./js/tracks.js');
    const { angleDiff } = await import('./js/util.js');
    const held = new Set();
    const set = (k, on) => { if (on && !held.has(k)) { held.add(k); window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); } else if (!on && held.has(k)) { held.delete(k); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); } };
    window.__frames = 0; const fr = () => { window.__frames++; window.__fr = requestAnimationFrame(fr); }; fr();
    window.__bot = setInterval(() => {
      const w = window.__RAD_GAME__.world; if (!w) return; const p = w.player;
      const spd = Math.hypot(p.vx, p.vy);
      const tp = pointAt(w.track, p.sPrev + 150 + spd * 0.35);
      const err = angleDiff(p.angle, Math.atan2(tp.y - p.y, tp.x - p.x));
      set('ArrowRight', err > 0.05); set('ArrowLeft', err < -0.05);
      set('ArrowDown', Math.abs(err) > 0.7 && spd > 500);
    }, 30);
  });
  await page.keyboard.down('ArrowUp'); // hold throttle through the countdown and race
  const t0 = Date.now();
  let shot = 0; let done = false; const log = [];
  lines.push(`=== ${names[ti]} ===`);
  lines.push('wall_s  race_ms   x      y      speed  heading  velAngle  diff   lap  dist   ai_laps');
  while (Date.now() - t0 < 180000) {
    await new Promise(r => setTimeout(r, 500));
    const st = await page.evaluate(() => {
      const g = window.__RAD_GAME__; const w = g.world; const p = w.player;
      return { running: g.isRunning(), results: !!document.querySelector('#results'), t: w.race.time, cd: w.race.countdown, x: p.x, y: p.y, vx: p.vx, vy: p.vy, a: p.angle, lap: p.lap, dist: p.dist, L: w.track.length, ai: w.cars.slice(1).map(c => c.lap), aiSpd: w.cars.slice(1).map(c => Math.hypot(c.vx, c.vy)), hud: document.querySelector('[data-h=lap]')?.textContent + ' ' + document.querySelector('[data-h=pos]')?.textContent + ' ' + document.querySelector('[data-h=time]')?.textContent, frames: window.__frames };
    });
    if (st.results) { done = true; break; }
    if (st.cd > 0 || !st.running) continue;
    const spd = Math.hypot(st.vx, st.vy);
    const va = Math.atan2(st.vy, st.vx);
    let diff = deg(((va - st.a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
    log.push({ spd, diff: Math.abs(diff), ...st });
    lines.push(`${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}  ${String(Math.round(st.t)).padStart(6)}  ${String(Math.round(st.x)).padStart(5)}  ${String(Math.round(st.y)).padStart(5)}  ${spd.toFixed(0).padStart(5)}  ${deg(st.a).toFixed(1).padStart(7)}  ${deg(va).toFixed(1).padStart(7)}  ${diff.toFixed(1).padStart(6)}  ${st.lap}  ${Math.round(st.dist).toString().padStart(6)}  ${st.ai.join(',')}  | HUD ${st.hud}`);
    if (shot === 0 && st.t > 6000) { await page.screenshot({ path: `${outDir}/73-core-${names[ti]}-race.png` }); shot++; }
    else if (shot === 1 && st.lap >= 1 && st.t > 16000) { await page.screenshot({ path: `${outDir}/73-core-${names[ti]}-lap2.png` }); shot++; }
  }
  await page.keyboard.up('ArrowUp');
  const fin = await page.evaluate(() => { clearInterval(window.__bot); cancelAnimationFrame(window.__fr); ['ArrowLeft','ArrowRight','ArrowDown'].forEach(k => window.dispatchEvent(new KeyboardEvent('keyup', { key: k }))); return { res: window.__RAD_LAST_RESULT__, frames: window.__frames, html: document.querySelector('#results')?.innerText }; });
  if (done) await page.screenshot({ path: `${outDir}/73-core-${names[ti]}-results.png` });
  const moving = log.filter(l => l.spd > 150);
  const maxDiff = Math.max(...moving.map(l => l.diff));
  const meanDiff = moving.reduce((a, l) => a + l.diff, 0) / moving.length;
  const raceSecs = (log.at(-1)?.t || 1) / 1000;
  const aiMoving = log.length ? Math.min(...log.slice(2).map(l => Math.max(...l.aiSpd))) : 0;
  const sum = `${names[ti]}: finished=${done} playerPlace=${fin.res?.playerPlace} playerTime=${(fin.res?.totalTime/1000).toFixed(2)}s bestLap=${(fin.res?.bestLapMs/1000).toFixed(2)}s  samples=${log.length} moving=${moving.length} meanHeadingVsVel=${meanDiff.toFixed(1)}° maxHeadingVsVel=${maxDiff.toFixed(1)}°  finalAiLaps=${log.at(-1)?.ai.join(',')}  standings=${fin.res?.standings.map(s => s.name + (s.dnf ? '(DNF)' : '')).join('>')}  errors=${errs.length - errStart}`;
  summary.push(sum);
  lines.push('RESULT ' + sum);
  lines.push('');
  await page.evaluate(() => document.querySelector('#title')?.click());
  await page.waitForSelector('[data-act=race]');
}
// FPS probe on a fresh race (Neon) — frames over 5s
await page.click('[data-act=race]'); await page.waitForSelector('#tracks button');
await page.evaluate(() => document.querySelectorAll('#tracks button')[0].click());
await page.keyboard.down('ArrowUp');
await new Promise(r => setTimeout(r, 5000));
const f0 = await page.evaluate(() => new Promise(res => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 3000) requestAnimationFrame(f); else res(n / ((performance.now() - t) / 1000)); }; requestAnimationFrame(f); }));
await page.keyboard.up('ArrowUp');
summary.push(`fps (headless, 1280x720, race at speed): ${f0.toFixed(1)}`);
summary.push(`console errors/warnings total: ${errs.length} ${JSON.stringify(errs.slice(0, 5))}`);
fs.writeFileSync(`${outDir}/73-core-verify.txt`, ['Radcars v45-core verification ' + new Date().toString(), 'URL ' + url, '', 'SUMMARY', ...summary, '', 'MOVEMENT LOG (player every 0.5s; heading & velAngle in degrees; diff = velocity angle minus heading; speed wu/s)', ...lines].join('\n'));
console.log(summary.join('\n'));
await browser.close();
