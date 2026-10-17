// v54.8 DRIFT verification: the mechanic (entry, held angle, clean exit + mini-boost, auto-straighten), the audio hooks
// (driftStart / driftEnd / driftBoost actually scheduled, DriftVoice layer on while drifting, no 'handbrake'), GD's art
// driven by the same values (smoke denser with drift01, drift skid stamps only while drifting, button flare on
// driftStart, icon tilt), shots mid-drift and at the exit (portrait 412×915).
//   node docs/verify-v548.mjs [url] [outdir] [pixi|canvas]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [,, base = 'http://127.0.0.1:4547/', out = 'shots/v548', rk = 'pixi'] = process.argv;
const tag = rk === 'canvas' ? '-canvas' : '';
fs.mkdirSync(out, { recursive: true });
let fails = 0; const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
const ok = (c, m) => { log(`  [${c ? 'ok' : 'FAIL'}] ${m}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setBypassServiceWorker(true);
await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(m.text()); });
const reqs = []; page.on('request', (r) => { if (/assets\/(audio|drift)\//.test(r.url())) reqs.push(r.url().replace(/^.*assets\//, '').replace(/\?.*$/, '')); });
await page.evaluateOnNewDocument(() => { const log = []; const push = log.push.bind(log); log.push = (n) => push({ n, t: (() => { try { return window.__RAD_GAME__.world.race.time; } catch (_) { return -1; } })() }); self.__RAD_SFX_LOG__ = log; });
await page.goto(base + (rk === 'canvas' ? '?canvas=1' : ''), { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('radcars_core_v1', JSON.stringify({ mute: false, options: { aiCount: 5, laps: 5, difficulty: 1 }, bestLaps: {} })); });
await page.reload({ waitUntil: 'networkidle2' }); await sleep(1500);
log(`# v54.8 drift verify · ${rk} · ${await page.evaluate(() => self.RADCARS_BUILD.label)}`);
const lb = await page.evaluate(() => ({ label: document.querySelector('#btn-brake .act-label')?.textContent, css: [...document.styleSheets].some((s) => /drift-button\.css/.test(s.href || '')) }));
ok(lb.css, 'GD drift-button.css loaded');
await page.tap('[data-act=race]'); await page.waitForSelector('#tracks button'); await (await page.$$('#tracks button'))[+(process.env.TRACK || 0)].tap();
await page.waitForFunction(() => window.__RAD_GAME__?.world?.race?.countdown <= 0, { timeout: 20000, polling: 50 });
const lbl = await page.evaluate(() => ({ label: document.querySelector('#btn-brake .act-label').textContent, icon: document.querySelector('#btn-brake .act-icon').innerHTML.includes('rotate(30)') }));
ok(lbl.label === 'DRIFT' && lbl.icon, `button reads DRIFT with GD's drift icon (${lbl.label}, icon ${lbl.icon})`);
const A0 = await page.evaluate(() => ({ files: self.__RAD_AUDIO__.load.files, core: self.__RAD_AUDIO__.load.core, scrub: !!self.__RAD_AUDIO__.B.drift_scrub, clips: Object.keys(self.__RAD_AUDIO__.B).filter((k) => /drift|handbrake/.test(k)) }));
ok(A0.core && A0.scrub && A0.files.drift_scrub === 'ogg' && A0.clips.includes('drift_start') && A0.clips.includes('drift_end') && !A0.clips.includes('handbrake'), `drift audio loaded: drift_scrub.${A0.files.drift_scrub}, sprite clips ${A0.clips.join(',')} (no handbrake clip)`);
// bot: steers on keys and DRIFTs the big corners (Down held from just before the corner until it opens out)
await page.evaluate(async () => {
  const { pointAt } = await import('./js/tracks.js'); const { angleDiff } = await import('./js/util.js'); const held = new Set();
  const set = (k, on) => { if (on && !held.has(k)) { held.add(k); window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); } else if (!on && held.has(k)) { held.delete(k); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); } };
  const tan = (w, s) => { const q = pointAt(w.track, s); return Math.atan2(q.ty, q.tx); };
  window.__set = set; window.__force = 0; window.__autoDrift = true; const B = window.__botSt = { hold: false, t0: 0, cool: 0, n: 0 };
  window.__bot = setInterval(() => { const w = window.__RAD_GAME__.world; if (!w || w.race.countdown > 0 || window.__RAD_GAME__.paused) return; const p = w.player, spd = Math.hypot(p.vx, p.vy), T = w.race.time;
    if (window.__force) { set('ArrowRight', window.__force > 0); set('ArrowLeft', window.__force < 0); return; }
    const tp = pointAt(w.track, p.sPrev + 150 + spd * 0.35); const tv = spd > 50 ? Math.atan2(p.vy, p.vx) : p.angle; const err = angleDiff(tv, Math.atan2(tp.y - p.y, tp.x - p.x));
    const ahead = angleDiff(tan(w, p.sPrev + 80), tan(w, p.sPrev + 620)), rest = angleDiff(tv, tan(w, p.sPrev + 260));
    if (window.__autoDrift) {
      if (!B.hold && T > B.cool && spd > 620 && Math.abs(ahead) > 0.65) { B.hold = true; B.t0 = T; B.dir = Math.sign(ahead); B.n++; set('ArrowDown', true); }
      else if (B.hold && ((T - B.t0 > 700 && Math.abs(rest) < 0.3) || T - B.t0 > 3200 || (T - B.t0 > 400 && !p.drifting))) { B.hold = false; B.cool = T + 900; set('ArrowDown', false); }
    }
    if (B.hold && T - B.t0 < 160) { set('ArrowRight', B.dir > 0); set('ArrowLeft', B.dir < 0); return; } // flick in
    set('ArrowRight', err > 0.05); set('ArrowLeft', err < -0.05); }, 30);
  // trace + the two GD shots (pause on the frame; node takes the shot and resumes)
  window.__trace = []; window.__shot = null; const S = window.__shotSt = { mid: false, exit: false, endSeen: 0 };
  const f = () => { const w = window.__RAD_GAME__.world, p = w.player, g = window.__RAD_GAME__; requestAnimationFrame(f); if (!w || g.paused || w.race.countdown > 0) return;
    const sl = self.__RAD_AUDIO__.drift || {}, va = Math.atan2(p.vy, p.vx), b = Math.abs(Math.atan2(Math.sin(p.angle - va), Math.cos(p.angle - va))) * 180 / Math.PI, el = document.getElementById('btn-brake');
    const smoke = w.fxState.parts.filter((o) => o.k === 'drift').length;
    window.__trace.push({ t: Math.round(w.race.time), d: !!p.drifting, d01: +(p.drift01 || 0).toFixed(3), sp: Math.round(Math.hypot(p.vx, p.vy)), beta: +b.toFixed(1), sl: !!sl.sliding, smoke, stamps: w.fxState.stats.driftStamps || 0, spawned: w.fxState.stats.driftSmoke || 0, flare: el.classList.contains('flare'), tilt: el.style.getPropertyValue('--drift-tilt'), lvl: +(p.boostLevel || 0).toFixed(2), wall: p.wallHit > 0 });
    const late = w.race.time > (window.__shotAfter || 0);
    if (!S.mid && late && p.drifting && p.driftSt && p.drift01 > 0.6 && smoke >= 7 && p.driftSt.ms > 450) { S.mid = true; g.setPaused(true); window.__shot = { k: 'mid', d01: p.drift01, smoke, ms: p.driftSt.ms, tilt: el.style.getPropertyValue('--drift-tilt'), state: el.dataset.state, flare: el.classList.contains('flare') }; }
    const L = w.driftLog[w.driftLog.length - 1];
    if (!S.exit && late && L && L.awarded && w.race.time - L.t > 110 && w.race.time - L.t < 400) { S.exit = true; g.setPaused(true); window.__shot = { k: 'exit', log: L, lvl: p.boostLevel, toast: w.driftFlash && w.driftFlash.text, drifting: p.drifting }; }
  };
  requestAnimationFrame(f);
});
await page.evaluate((v) => { window.__shotAfter = v; }, +(process.env.SHOT_AFTER || 22000));
const t0 = Date.now(); let mid = null, ex = null;
while (Date.now() - t0 < 60000 && !(mid && ex)) {
  const sh = await page.evaluate(() => window.__shot);
  if (sh) { await sleep(120); const f = sh.k === 'mid' ? `v548-middrift-412${tag}.png` : `v548-exit-412${tag}.png`; await page.screenshot({ path: `${out}/${f}` }); log(`    shot ${out}/${f} ${JSON.stringify(sh)}`); if (sh.k === 'mid') mid = sh; else ex = sh; await page.evaluate(() => { window.__shot = null; window.__RAD_GAME__.setPaused(false); }); }
  await sleep(40);
}
await sleep(1500);
const ST = await page.evaluate(() => ({ stats: window.__RAD_GAME__.world.driftStats, log: window.__RAD_GAME__.world.driftLog, bot: window.__botSt.n, lap: window.__RAD_GAME__.world.player.lap }));
log(`    driftStats ${JSON.stringify(ST.stats)} · bot DRIFT presses ${ST.bot} · drift log ${JSON.stringify(ST.log.slice(0, 8))}`);
log(`    chain log ${JSON.stringify(await page.evaluate(() => (window.__RAD_GAME__.world.chain || {}).log))}`);
const flare0 = await page.evaluate(() => (self.__RAD_DRIFT_FLARES__ || []).length);
await page.evaluate(() => { window.__autoDrift = false; window.__botSt.hold = false; window.__set('ArrowDown', false); });
const T = await page.evaluate(() => window.__trace), SL = await page.evaluate(() => self.__RAD_SFX_LOG__.map((e) => e.n)), PL = await page.evaluate(() => self.__RAD_SFX_PLAYED__.map((x) => `${x.ev}${x.skipped ? '(skip)' : ''}:${x.file}`));
T.forEach((x, k) => { if (k && Math.abs(x.sp - T[k - 1].sp) > 50) x.wall = true; }); // a car-to-car bump (velocity kick) counts like a wall for the angle check
const D = T.filter((x) => x.d), held = D.filter((x) => x.beta >= 15);
log(`    sfx calls: ${SL.join(', ')}`); log(`    clips played: ${PL.join(', ')}`);
ok(ST.stats.starts >= 2 && flare0 >= ST.stats.starts, `DRIFT + hard steer at speed → slide: ${ST.stats.starts} drifts (${D.length} frames drifting), button flared on each driftStart (${flare0})`);
ok(held.length && Math.min(...held.map((x) => x.beta)) >= 15 && Math.max(...D.filter((x) => !x.wall).map((x) => x.beta)) <= 50, `held angle: ${Math.min(...held.map((x) => x.beta)).toFixed(0)}°–${Math.max(...D.filter((x) => !x.wall).map((x) => x.beta)).toFixed(0)}° while sliding (20–45° target), never spins`);
ok(Math.max(...D.map((x) => x.d01)) > 0.6, `drift01 rises with the angle (max ${Math.max(...D.map((x) => x.d01)).toFixed(2)})`);
ok(SL.includes('driftStart') && SL.includes('driftEnd') && SL.includes('driftBoost') && SL.indexOf('driftEnd') < SL.indexOf('driftBoost'), `hooks fired: driftStart → driftEnd → driftBoost (${SL.filter((n) => /drift/.test(n)).join(' → ')})`);
ok(PL.some((x) => x.startsWith('driftStart:drift_start')) && PL.some((x) => x.startsWith('driftEnd:drift_end')) && PL.some((x) => x.startsWith('drift_boost:drift_boost')) && !PL.some((x) => /handbrake/.test(x)), 'drift sounds actually scheduled: drift_start, drift_end, drift_boost (no handbrake)');
ok(D.filter((x) => x.sl).length > D.length * 0.7 && T.filter((x) => !x.d && x.sl).length < 3, `held slide layer (DriftVoice) on while drifting (${D.filter((x) => x.sl).length}/${D.length} frames), off when not`);
const smokeMax = (lo, hi) => Math.max(0, ...D.filter((x) => x.d01 >= lo && x.d01 <= hi).map((x) => x.smoke));
const rate = (lo, hi) => { let n = 0, ms = 0; for (let k = 1; k < T.length; k++) if (T[k].d && T[k - 1].d && T[k].d01 >= lo && T[k].d01 < hi) { n += T[k].spawned - T[k - 1].spawned; ms += T[k].t - T[k - 1].t; } return ms > 300 ? n / ms * 1000 : NaN; };
const rLo = rate(0, 0.35), rHi = rate(0.65, 1.01);
ok(Math.max(...D.map((x) => x.smoke)) >= 6 && rHi > rLo * 1.4, `drift smoke spawns while drifting and gets denser with drift01: ${rLo.toFixed(1)} puffs/s at drift01 <0.35 → ${rHi.toFixed(1)} puffs/s at ≥0.65 (max live ${Math.max(...D.map((x) => x.smoke))})`);
let stampsIn = 0, stampsOut = 0; for (let k = 1; k < T.length; k++) { const dd = T[k].stamps - T[k - 1].stamps; if (dd > 0) { if (T[k].d || T[k - 1].d) stampsIn += dd; else stampsOut += dd; } }
ok(stampsIn > 20 && stampsOut === 0, `drift skid stamps only while drifting (+${stampsIn} drifting, +${stampsOut} after)`);
ok(mid && mid.tilt && mid.tilt !== '0deg' && mid.state === 'active', `icon leans into the slide mid-drift (--drift-tilt ${mid && mid.tilt}), button heated (state ${mid && mid.state})`);
ok(ex && ex.log.clean && ex.log.awarded && ex.lvl > 0.1, `clean exit pays the mini-boost (${ex && JSON.stringify(ex.log)}, boostLevel ${ex && ex.lvl.toFixed(2)}, toast ${ex && ex.toast})`);
const sp0 = D[0] ? D[0].sp : 0, sp1 = D.length ? D[D.length - 1].sp : 0;
log(`    speed: ${sp0} at entry → ${sp1} at exit; trace saved`);
// auto-straighten: hold DRIFT > 4 s
await page.evaluate(() => { self.__RAD_SFX_LOG__.length = 0; self.__RAD_SFX_PLAYED__.length = 0; window.__autoDrift = false; });
await page.waitForFunction(() => Math.hypot(window.__RAD_GAME__.world.player.vx, window.__RAD_GAME__.world.player.vy) > 600 && !window.__RAD_GAME__.world.player.drifting, { timeout: 15000, polling: 50 });
await page.keyboard.down('ArrowDown'); await page.evaluate(() => { window.__force = 1; }); await sleep(120); await page.evaluate(() => { window.__force = 0; });
await page.waitForFunction(() => self.__RAD_SFX_LOG__.some((e) => e.n === 'driftEnd'), { timeout: 8000, polling: 30 }).catch(() => {});
await page.keyboard.up('ArrowDown'); await sleep(200);
const au = await page.evaluate(() => ({ log: window.__RAD_GAME__.world.driftLog.slice(-1)[0], sl: self.__RAD_SFX_LOG__.map((e) => e.n) }));
ok(au.log && au.log.clean === false && !au.log.awarded && !au.sl.includes('driftBoost'), `auto-straighten (held ${au.log && au.log.ms} ms / wall / slow) → driftEnd clean:false, no boost (${au.sl.filter((n) => /drift/.test(n)).join(',')})`);
// DRIFT with no steer at speed: no drift
await page.evaluate(() => { self.__RAD_SFX_LOG__.length = 0; window.__force = 0; });
await sleep(1500);
await page.evaluate(() => { clearInterval(window.__bot); ['ArrowLeft', 'ArrowRight'].forEach((k) => window.__set(k, false)); });
await page.keyboard.down('ArrowDown'); await sleep(500); await page.keyboard.up('ArrowDown');
const nd = await page.evaluate(() => self.__RAD_SFX_LOG__.filter((e) => e.n === 'driftStart').length);
ok(nd === 0, `DRIFT held without steering does nothing (driftStart ${nd})`);
ok(reqs.some((r) => /drift-atlas\.png/.test(r)) && reqs.some((r) => /drift-skid\.png/.test(r)), `GD drift atlas + skid stamp fetched in race (${[...new Set(reqs.filter((r) => /drift/.test(r)))].join(', ')})`);
ok(errs.length === 0, `no console errors (${errs.slice(0, 3).join(' | ')})`);
fs.writeFileSync(`${out}/v548-drift-trace${tag}.json`, JSON.stringify(T));
log(fails ? `RESULT: ${fails} FAIL` : 'RESULT: ALL OK');
fs.writeFileSync(`${out}/v548-verify${tag}.txt`, lines.join('\n') + '\n');
await browser.close(); process.exit(fails ? 1 : 0);
