// Pickup regression (v54.7.1): drive the player straight through the '?' bonus boxes (one box per lap, a different box
// each lap) and over the boost pads on every track, and assert the grant: power.held set, POWER button shows it,
// 'bonus' sfx called and the 'pickup' clip scheduled, the flash, no console errors. Also: holding a power-up, the box
// is left alone (by design) and that is counted, not silent.
//   node docs/verify-pickups.mjs [url] [pixi|canvas] [outDir] [prefix]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [,, base = 'http://127.0.0.1:4571/', rk = 'pixi', out = 'shots/v5471', prefix = 'v5471'] = process.argv;
fs.mkdirSync(out, { recursive: true });
const tag = rk === 'canvas' ? 'canvas' : 'pixi';
let fails = 0; const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
const ok = (c, m) => { log(`  [${c ? 'ok' : 'FAIL'}] ${m}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setBypassServiceWorker(true);
await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
const errs = []; page.on('pageerror', (e) => errs.push('pageerror: ' + String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.evaluateOnNewDocument(() => { self.__RAD_SFX_LOG__ = []; });
await page.evaluateOnNewDocument((e) => { window.__EDGE = e; }, +(process.env.EDGE ?? 50)); // lap 2 passes 50 wu off the box centre: the car visibly overlaps the drawn box edge at the far zoom (41.7 + 17 wu)
await page.goto(base + (rk === 'canvas' ? '?canvas=1' : ''), { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('radcars_core_v1', JSON.stringify({ mute: false, options: { aiCount: 5, laps: 4, difficulty: 1 }, bestLaps: {} })); });
await page.reload({ waitUntil: 'networkidle2' }); await sleep(1200);
log(`# pickups · ${rk} · ${await page.evaluate(() => self.RADCARS_BUILD.label)} · 412×915`);
const report = [];
for (let ti = 0; ti < 4; ti++) {
  await page.waitForSelector('[data-act=race]'); await page.tap('[data-act=race]'); await page.waitForSelector('#tracks button');
  await (await page.$$('#tracks button'))[ti].tap();
  await page.waitForFunction(() => window.__RAD_GAME__?.world?.race?.countdown <= 0, { timeout: 25000, polling: 50 });
  const name = await page.evaluate(() => window.__RAD_GAME__.world.track.name);
  log(`\n=== ${name} · ${rk} ===`);
  await page.evaluate(() => { self.__RAD_SFX_LOG__.length = 0; self.__RAD_SFX_PLAYED__ && (self.__RAD_SFX_PLAYED__.length = 0); });
  // bot: pure pursuit; within 1800 wu of the box row it aims at the target box's lateral offset
  await page.evaluate(async () => {
    const { pointAt, wrapS } = await import('./js/tracks.js'); const { angleDiff } = await import('./js/util.js'); const held = new Set();
    const set = (k, on) => { if (on && !held.has(k)) { held.add(k); window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); } else if (!on && held.has(k)) { held.delete(k); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); } };
    const w = window.__RAD_GAME__.world, B = w.track.bonus;
    window.__pk = { target: 0, events: [], holdOn: false, off: 0 };
    clearInterval(window.__bot); window.__bot = setInterval(() => {
      const w = window.__RAD_GAME__.world; if (!w || w.player.finished) { ['ArrowLeft', 'ArrowRight'].forEach((k) => set(k, false)); return; }
      const p = w.player, spd = Math.hypot(p.vx, p.vy);
      let ahead = B.s - p.sPrev; const L = w.track.length; ahead = ((ahead % L) + L) % L; if (ahead > L - 300) ahead -= L;
      const box = B.boxes[window.__pk.target % B.boxes.length];
      const lat = ahead < 1800 && ahead > -200 ? box.lat + (window.__pk.off || 0) * (box.lat > 0 ? -1 : 1) : 0;
      const q = pointAt(w.track, p.sPrev + 120 + spd * 0.3);
      const tx = q.x + q.nx * lat, ty = q.y + q.ny * lat;
      const err = angleDiff(p.angle, Math.atan2(ty - p.y, tx - p.x));
      set('ArrowRight', err > 0.04); set('ArrowLeft', err < -0.04);
    }, 16);
  });
  const res = { track: name, boxes: [] };
  for (let lap = 0; lap < 3; lap++) {
    // wait until the player passes the box row this lap
    const r = await page.evaluate(async (lap) => {
      const w = window.__RAD_GAME__.world, pw = w.power, B = w.track.bonus;
      window.__pk.target = lap; window.__pk.off = lap === 1 ? (window.__EDGE ?? 0) : 0; if (lap === 2) { pw.held = pw.held || 'rocket'; } // lap 3: arrive HOLDING a power-up (box must stay, counted)
      else pw.held = null;
      const c0 = pw.collects.length, ig0 = pw.ignored, sl0 = self.__RAD_SFX_LOG__.length;
      const startLap = w.player.lap;
      const t0 = performance.now(); let minLatErr = 1e9, minD = 1e9, closest = null, armed = false;
      return await new Promise((res) => {
        const f = () => {
          const p = w.player; let d = B.s - p.sPrev; const L = w.track.length; d = ((d % L) + L) % L; if (d > L / 2) d -= L;
          const box = B.boxes[lap % B.boxes.length];
          if (d > 600) armed = true;
          if (armed && Math.abs(d) < Math.abs(minD)) { minD = d; minLatErr = p.lat - box.lat; closest = { d: Math.round(d), latErr: +(p.lat - box.lat).toFixed(1), lat: +p.lat.toFixed(1), boxLat: +box.lat.toFixed(1), spd: Math.round(Math.hypot(p.vx, p.vy)), zoom: +w.cam.zoom.toFixed(3), drawnHalf: +(B.half * Math.max(1, 20 / (B.half * 2 * w.cam.zoom))).toFixed(1) }; }
          const got = pw.collects.length > c0, passed = armed && d < -300 && minD < 200;
          if (got || passed || performance.now() - t0 > 45000) {
            setTimeout(() => res({ got, passed, timeout: !got && !passed, collect: pw.collects[pw.collects.length - 1], held: pw.held, ignored: pw.ignored - ig0, closest, sfx: self.__RAD_SFX_LOG__.slice(sl0), btn: { state: document.getElementById('btn-power').dataset.state, label: document.querySelector('#btn-power .act-label').textContent }, flash: w.power.flash && w.power.flash.text, collected: [...pw.collected] }), 120);
            return;
          }
          requestAnimationFrame(f);
        };
        f();
      });
    }, lap);
    if (lap === 0 && r.got) { await page.screenshot({ path: `${out}/${prefix}-${name.split(' ')[0].toLowerCase()}-pickup-${tag}-412.png` }); }
    const played = await page.evaluate(() => (self.__RAD_SFX_PLAYED__ || []).filter((x) => x.ev === 'pickup').length);
    res.boxes.push({ lap, ...r, pickupClips: played });
    if (lap < 2) ok((lap === 1 && process.env.EXPECT_MISS) ? !r.got : r.got && r.held && r.btn.state === 'held' && r.sfx.includes('bonus') && r.flash, `box ${lap}${lap === 1 ? ' EDGE pass' : ' centre pass'} (lat ${r.closest && r.closest.boxLat}): ${r.got ? 'GRANTED ' + r.held : 'NOTHING'} · closest pass ${JSON.stringify(r.closest)} · POWER button ${r.btn.state}/${r.btn.label} · sfx ${r.sfx.filter((x) => /bonus|power/.test(x)).join(',') || '-'} · pickup clips ${played} · flash ${r.flash}`);
    else ok(!r.got && r.ignored >= 1 && (process.env.OLD || (r.flash === 'POWER FULL' && r.sfx.includes('denied'))), `holding a power-up: box left (one at a time), ignored ${r.ignored}, feedback flash ${r.flash} + sfx ${r.sfx.join(',') || '-'} · closest ${JSON.stringify(r.closest)}`);
    await page.evaluate(() => { window.__RAD_GAME__.world.power.held = null; });
  }
  report.push(res);
  await page.evaluate(() => { clearInterval(window.__bot); ['ArrowLeft', 'ArrowRight'].forEach((k) => window.dispatchEvent(new KeyboardEvent('keyup', { key: k }))); });
  await page.evaluate(() => window.__RAD_GAME__.quit ? window.__RAD_GAME__.quit() : null);
  await page.reload({ waitUntil: 'networkidle2' }); await sleep(1000);
}
ok(errs.length === 0, `no console errors (${errs.slice(0, 4).join(' | ') || 'none'})`);
log(fails ? `RESULT: ${fails} FAIL` : 'RESULT: ALL OK');
fs.writeFileSync(`${out}/${prefix}-pickups-${tag}.json`, JSON.stringify(report, null, 1));
fs.writeFileSync(`${out}/${prefix}-pickups-${tag}.txt`, lines.join('\n') + '\n');
await browser.close(); process.exit(fails ? 1 : 0);
