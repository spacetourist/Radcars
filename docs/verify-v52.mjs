/**
 * v52 'finish' verification: the finishing-position reveal, the celebration and the flow to the results.
 *
 *   node docs/verify-v52.mjs [url] [outDir]
 *
 * For each renderer (Pixi WebGL default, ?canvas=1) on desktop 1280×720 and phone 844×390 (DPR 2, touch):
 *   race starts through the menus, the rivals race about half a lap, then debug.finishAt(place) lines the player up to
 *   cross the line on the final lap in a chosen place (P1 / P2 / P3 / lower) on each of the 4 tracks. Checks:
 *   - the reveal (#finish-reveal) is on screen in the same frame the player crosses, with the right ordinal + tier
 *     colour, and the tier's sound fires (audio sfx log);
 *   - the player's car keeps rolling (cruise on the rail, ≥ 200 wu/s) and the rivals keep racing / finishing;
 *   - frame rate during the reveal + celebration (rAF in the page);
 *   - no skip: the results screen comes up at revealMs + outMs; skip (key on desktop, tap/touch on the phone):
 *     right after the tap; results fill in live (rows "racing" → finished) and end with the final #results whose
 *     player place matches; the race loop stops afterwards; 0 console errors / warnings.
 * Shots: docs/shots/80-*.png (reveal per place type, win celebration mid-animation, live + final results).
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const url = process.argv[2] || 'http://localhost:4173/';
const outDir = process.argv[3] || 'docs/shots';
const only = process.argv[4] || '';
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = [];
const log = (s) => { console.log(s); lines.push(s); };
let fails = 0;
const check = (ok, msg) => { log(`  [${ok ? 'ok' : 'FAIL'}] ${msg}`); if (!ok) fails++; return ok; };
const TRACK_IDX = { neon: 0, gridlock: 1, razor: 2, cargo: 3 };
const REVEAL_MS = 3600, OUT_MS = 320;

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
});

// [renderer, viewport, track, place, skip, shots]
const PLAN = [
  ['pixi', 'desktop', 'neon', 1, null, true],
  ['pixi', 'desktop', 'gridlock', 2, 'key', true],
  ['pixi', 'desktop', 'razor', 3, null, true],
  ['pixi', 'desktop', 'cargo', 5, 'click', true],
  ['canvas', 'desktop', 'neon', 1, null, true],
  ['canvas', 'desktop', 'gridlock', 3, null, false],
  ['canvas', 'desktop', 'razor', 2, 'key', false],
  ['canvas', 'desktop', 'cargo', 4, null, true],
  ['pixi', 'phone', 'neon', 1, null, true],
  ['pixi', 'phone', 'razor', 4, 'tap', true],
  ['canvas', 'phone', 'gridlock', 1, null, true],
  ['canvas', 'phone', 'cargo', 3, 'tap', false],
  // clean frame-rate runs for the full win celebration (no screenshots at all)
  ['pixi', 'desktop', 'gridlock', 1, null, false],
  ['pixi', 'phone', 'cargo', 1, null, false],
  ['canvas', 'phone', 'razor', 1, null, false]
].filter(([rk, vp, tr, pl]) => !only || `${tr}-p${pl}-${rk}-${vp}`.includes(only));

const fpsRows = [];
// screenshots stall the compositor for 100+ ms (DPR 2 phone): their windows are left out of the fps figure
const shotTimed = async (page, name) => {
  const a = await page.evaluate(() => performance.now());
  await page.screenshot({ path: name });
  const b = await page.evaluate(() => performance.now());
  await page.evaluate((a, b) => { (window.__shotWin = window.__shotWin || []).push([a, b]); }, a, b);
  log(`    shot ${name}`);
};
for (const [rk, vp, track, place, skip, shots] of PLAN) {
  const tag = `${track}-p${place}-${rk}-${vp}`;
  log(`\n== ${tag}${skip ? ` (skip by ${skip})` : ''}`);
  const page = await browser.newPage();
  await page.setViewport(vp === 'phone' ? { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 720, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text()); });
  await page.goto(url + (rk === 'canvas' ? '?canvas=1' : ''), { waitUntil: 'networkidle2' });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle2' });
  const kind = await page.evaluate(() => window.__RAD_RENDERER__);
  await page.evaluate(() => {
    self.__RAD_SFX_LOG__ = [];
    // stamp the reveal / results DOM the moment it appears, together with the game's finish clock
    window.__stamp = {};
    new MutationObserver(() => {
      const f = window.__RAD_GAME__.world && window.__RAD_GAME__.world.finish, st = window.__stamp, now = performance.now();
      if (!st.reveal && document.querySelector('#finish-reveal')) st.reveal = { now, ms: f ? f.ms : -1, finished: !!(f && window.__RAD_GAME__.world.player.finished) };
      if (!st.results && document.querySelector('.results-screen')) st.results = { now, ms: f ? f.ms : -1, live: !!document.querySelector('.results-screen.live') };
      if (!st.final && document.querySelector('#results')) st.final = { now, ms: f ? f.ms : -1 };
      if (st.reveal && !st.revealGone && !document.querySelector('#finish-reveal')) st.revealGone = { now, ms: f ? f.ms : -1 };
    }).observe(document.body, { childList: true, subtree: true });
  });
  if (vp === 'phone') { await page.tap('[data-act=race]'); } else await page.click('[data-act=race]');
  await page.waitForSelector('#tracks button');
  await sleep(250);
  await page.evaluate((i) => document.querySelectorAll('#tracks button')[i].click(), TRACK_IDX[track]);
  await page.waitForFunction(() => window.__RAD_GAME__.world && window.__RAD_GAME__.isRunning() && window.__RAD_GAME__.world.race.countdown <= 0, { timeout: 15000 });
  check(kind === rk && (await page.evaluate(() => window.__RAD_GAME__.rendererKind)) === rk, `renderer ${kind}`);
  // let the rivals race ~half a lap so a few of them finish behind the reveal
  await page.waitForFunction(() => { const w = window.__RAD_GAME__.world, L = w.track.length; return w.cars.some((c) => !c.isPlayer && c.dist > L * 0.55) || w.race.time > 16000; }, { timeout: 30000, polling: 100 });
  // frame counter for the reveal window
  await page.evaluate(() => { window.__fr = []; const tick = (t) => { window.__fr.push(t); if (window.__fr.length < 4000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const ok = await page.evaluate((pl) => window.__RAD_GAME__.debug.finishAt(pl), place);
  check(ok, `debug.finishAt(${place})`);
  await page.waitForFunction(() => !!window.__RAD_GAME__.world.finish, { timeout: 5000, polling: 'raf' });
  const t0 = await page.evaluate(() => performance.now() - window.__RAD_GAME__.world.finish.ms);
  // reveal content + latency
  await page.waitForFunction(() => !!window.__stamp.reveal, { timeout: 2000 });
  const rv = await page.evaluate(() => { const el = document.querySelector('#finish-reveal'); return { st: window.__stamp.reveal, text: el.querySelector('.fr-place').innerText.replace(/\s/g, ''), word: el.querySelector('.fr-word').innerText, cls: el.className, place: window.__RAD_GAME__.world.player.finishPlace }; });
  const sfxOf = { 1: 'win', 2: 'podium', 3: 'podium' }[place] || 'slam';
  const suf = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'TH' : ({ 1: 'ST', 2: 'ND', 3: 'RD' }[n % 10] || 'TH'));
  const tier = { 1: 'gold', 2: 'silver', 3: 'bronze' }[place] || 'plain';
  check(rv.st.finished && rv.st.ms <= 34, `reveal on screen ${rv.st.ms.toFixed(0)} ms after the line (same frame)`);
  check(rv.place === place && rv.text === suf(place) && rv.cls.includes('tier-' + tier), `reveal "${rv.text}" "${rv.word}" (${rv.cls.replace('finish-reveal ', '')}) for P${rv.place}`);
  // samples during the reveal: motion + celebration + shots
  const samples = [];
  const shotAtMs = shots ? (place === 1 ? [900, 1800] : [900]) : [];
  let skipAt = null;
  for (const at of [500, 900, 1300, 1800, 2400, 3000, 3400]) {
    await page.waitForFunction((a) => window.__RAD_GAME__.world.finish.ms >= a || window.__RAD_GAME__.world.finish.phase !== 'reveal', { polling: 'raf', timeout: 8000 }, at);
    const s = await page.evaluate(() => { const w = window.__RAD_GAME__.world, f = w.finish, p = w.player; const ai = w.cars.filter((c) => !c.isPlayer && !c.finished); return { ms: f.ms, phase: f.phase, spd: Math.hypot(p.vx, p.vy), lat: Math.abs(p.lat), zoom: w.cam.zoom, parts: f.cele.parts.length, aiSpd: ai.length ? ai.reduce((a, c) => a + Math.hypot(c.vx, c.vy), 0) / ai.length : null, finished: w.cars.filter((c) => c.finished).length, sfx: self.__RAD_SFX_LOG__.slice() }; });
    samples.push(s);
    if (s.phase !== 'reveal') break;
    if (shotAtMs.includes(at)) {
      const name = `${outDir}/80-${tag}-${place === 1 && at === 1800 ? 'celebration' : 'reveal'}.png`;
      await shotTimed(page, name);
    }
    if (skip && at >= 1300 && !skipAt) {
      skipAt = s.ms;
      if (skip === 'key') await page.keyboard.press('Enter');
      else if (skip === 'click') await page.mouse.click(640, 360);
      else await page.touchscreen.tap(422, 195);
      log(`    skip by ${skip} at ${s.ms.toFixed(0)} ms`);
      break;
    }
  }
  const sx = samples[samples.length - 1].sfx;
  check(samples.some((s) => s.sfx.includes(sfxOf)), `sound "${sfxOf}" played (sfx: ${sx.slice(-3).join(',')})`);
  const minSpd = Math.min(...samples.map((s) => s.spd));
  check(minSpd >= 200, `player keeps rolling during the reveal: speed ${samples.map((s) => s.spd.toFixed(0)).join('/')} wu/s, |lat| ${samples.map((s) => s.lat.toFixed(0)).join('/')}, zoom ${samples.map((s) => s.zoom.toFixed(2)).join('/')}`);
  const aiS = samples.map((s) => s.aiSpd).filter((v) => v != null);
  check(!aiS.length || Math.min(...aiS) > 250, `rivals keep racing: mean speed ${aiS.map((v) => v.toFixed(0)).join('/') || 'n/a (all home)'}; finished ${samples.map((s) => s.finished).join('→')}`);
  if (place <= 3) check(Math.max(...samples.map((s) => s.parts)) > 0, `celebration particles ${samples.map((s) => s.parts).join('/')}`);
  // results transition
  await page.waitForFunction(() => !!window.__stamp.results, { timeout: 8000, polling: 50 });
  const rs = await page.evaluate(() => ({ ...window.__stamp.results, gone: window.__stamp.revealGone }));
  const expectAt = skip ? skipAt + OUT_MS : REVEAL_MS + OUT_MS;
  check(Math.abs(rs.ms - expectAt) < 160 && rs.gone, `results screen at ${rs.ms.toFixed(0)} ms (expected ≈${expectAt.toFixed(0)}${skip ? ' after skip' : ''}), reveal removed, ${rs.live ? 'live (rivals still finishing)' : 'final'}`);
  // fps over the reveal window (from the line to the results)
  const fr = await page.evaluate((a, b) => {
    const f = window.__fr.filter((t) => t >= a && t <= b), win = window.__shotWin || [];
    let n = 0, dur = 0, worst = 0;
    for (let i = 1; i < f.length; i++) {
      const x = f[i - 1], y = f[i];
      if (win.some(([s, e]) => y >= s - 20 && x <= e + 20)) continue; // interval touches a screenshot
      n++; dur += y - x; worst = Math.max(worst, y - x);
    }
    return { fps: dur ? n / (dur / 1000) : 0, worst, n, shots: win.length };
  }, t0, t0 + rs.ms);
  const fps = fr.fps;
  fpsRows.push({ tag, rk, vp, place, fps, worst: fr.worst, skip: !!skip });
  check(fps >= 57, `frame rate during the reveal / celebration ${fps.toFixed(1)} fps over ${fr.n} frames, worst frame ${fr.worst.toFixed(1)} ms${fr.shots ? ` (${fr.shots} screenshot window(s) excluded)` : ''}`);
  await sleep(500);
  if (rs.live) {
    const lv = await page.evaluate(() => ({ racing: document.querySelectorAll('.res-row.racing').length, spd: Math.hypot(window.__RAD_GAME__.world.player.vx, window.__RAD_GAME__.world.player.vy), running: window.__RAD_GAME__.isRunning() }));
    check(lv.running && lv.spd > 200, `behind the live results the race runs on (player ${lv.spd.toFixed(0)} wu/s), ${lv.racing} rivals marked racing`);
    if (shots) { const n = `${outDir}/80-${tag}-results-live.png`; await page.screenshot({ path: n }); log(`    shot ${n}`); }
  }
  await page.waitForFunction(() => !!window.__stamp.final, { timeout: 60000, polling: 200 });
  const fin = await page.evaluate(() => { const r = window.__RAD_LAST_RESULT__; return { place: r.playerPlace, rows: r.standings.map((s) => `${s.place}.${s.name}${s.dnf ? '(DNF)' : ''}`), aiFinished: r.standings.filter((s) => !s.isPlayer && !s.dnf).length, racingRows: document.querySelectorAll('.res-row.racing').length, card: !!document.querySelector('#results') }; });
  check(fin.place === place && fin.card && fin.racingRows === 0, `final results: P${fin.place} · ${fin.rows.join(' ')} (${fin.aiFinished} rivals finished behind the reveal/results)`);
  await sleep(1900);
  const after = await page.evaluate(() => ({ running: window.__RAD_GAME__.isRunning(), bg: document.getElementById('menu-bg').className }));
  check(!after.running, `race loop stopped after the final results (menu-bg: ${after.bg})`);
  if (shots) { const n = `${outDir}/80-${tag}-results.png`; await page.screenshot({ path: n }); log(`    shot ${n}`); }
  // Menu returns to the title
  await page.click('#title'); await sleep(400);
  check(!!(await page.$('[data-act=race]')) && !(await page.$('#finish-reveal')), 'results → Menu returns to the title');
  check(errs.length === 0, `console errors/warnings: ${errs.length} ${JSON.stringify(errs.slice(0, 3))}`);
  await page.close();
}

log('\nFPS during the reveal / celebration (headless Chrome, SwiftShader)');
for (const r of fpsRows) log(`  ${r.tag.padEnd(28)} ${r.fps.toFixed(1)} fps, worst frame ${r.worst.toFixed(1)} ms${r.skip ? ' (skipped at 1.3 s)' : ''}`);
log(`\nRESULT: ${fails ? `FAIL (${fails})` : 'ALL OK'}`);
fs.writeFileSync(`${outDir}/80-verify.txt`, lines.join('\n') + '\n');
await browser.close();
process.exit(fails ? 1 : 0);
