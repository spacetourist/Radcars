// Release race verification (v54.7+): a real race on every track, portrait phone 412×915, headless Chromium.
//   node docs/verify-races.mjs <url> <outDir> <pixi|canvas> [laps=3] [prefix=v547] [extraQuery]
// Per track: on-screen shots (countdown, early race, mid race, finish reveal, results), car orientation (sprite axis vs
// heading), the player drives (distance), AI cars race (all 5 move and finish), lap times, finish place, frame rate
// (rAF over the race: avg, p5 and worst frame), keyboard-only driving (arrow keys + Shift boost), no key hints in the
// gameplay UI, audio: files decoded without errors, clips actually scheduled (countdown/GO/lap/boost/finish), music
// playing, engine voices on; plus env DRIFT=1 adds drift-state sampling (v54.8).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [,, base = 'http://127.0.0.1:4547/', outDir = 'shots/v547', rk = 'pixi', lapsArg = '3', prefix = 'v547', extraQ = ''] = process.argv;
const laps = Number(lapsArg);
const TRACKS = ['neon', 'gridlock', 'razor', 'cargo'];
const VP = { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true };
const KEY_HINT = /\b(Shift|Space|Esc|WASD|keyboard|arrow keys)\b|\bkey\b|press [a-z]\b/i;
fs.mkdirSync(outDir, { recursive: true });
const lines = []; let fails = 0;
const log = (s) => { lines.push(s); console.log(s); };
const check = (ok, msg) => { if (!ok) fails++; log(`  [${ok ? 'ok' : 'FAIL'}] ${msg}`); return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qs = [rk === 'canvas' ? 'canvas=1' : '', extraQ].filter(Boolean).join('&');
const url = base + (qs ? '?' + qs : '');
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setBypassServiceWorker(true);
await page.setViewport(VP);
const errs = [], audioReqFail = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
page.on('requestfailed', (r) => { if (/assets\/audio\//.test(r.url())) audioReqFail.push(r.url()); });
page.on('response', (r) => { if (/assets\/audio\//.test(r.url()) && r.status() >= 400) audioReqFail.push(`${r.status()} ${r.url()}`); });
await page.evaluateOnNewDocument(() => { self.__RAD_SFX_LOG__ = []; });
await page.goto(url, { waitUntil: 'networkidle2' });
await page.evaluate((laps) => { localStorage.clear(); localStorage.setItem('radcars_core_v1', JSON.stringify({ mute: false, options: { aiCount: 5, laps, difficulty: 1, leftHanded: false, drift: false }, bestLaps: {} })); }, laps);
await page.reload({ waitUntil: 'networkidle2' });
await sleep(1200);
const shot = async (name) => { const f = `${outDir}/${prefix}-${name}-${rk}-412.png`; await page.screenshot({ path: f }); log(`    shot ${f}`); return f; };
const build = await page.evaluate(() => self.RADCARS_BUILD && self.RADCARS_BUILD.label);
log(`# ${prefix} race verification · ${rk} · 412×915 DPR 2.625 · ${laps} laps · build ${build} · ${new Date().toISOString()}`);

async function startBot() {
  await page.evaluate(async () => {
    const { pointAt } = await import('./js/tracks.js');
    const { angleDiff } = await import('./js/util.js');
    const held = new Set();
    const set = (k, on) => { if (on && !held.has(k)) { held.add(k); window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); } else if (!on && held.has(k)) { held.delete(k); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); } };
    window.__botStats = { ticks: 0, brake: 0, boosts: 0 };
    clearInterval(window.__bot);
    window.__bot = setInterval(() => {
      const w = window.__RAD_GAME__.world; if (!w || w.player.finished) { ['ArrowLeft', 'ArrowRight', 'ArrowDown'].forEach((k) => set(k, false)); return; }
      const p = w.player, spd = Math.hypot(p.vx, p.vy);
      const tp = pointAt(w.track, p.sPrev + 150 + spd * 0.35);
      const err = angleDiff(p.angle, Math.atan2(tp.y - p.y, tp.x - p.x));
      set('ArrowRight', err > 0.05); set('ArrowLeft', err < -0.05);
      const a1 = pointAt(w.track, p.sPrev + 60), a2 = pointAt(w.track, p.sPrev + 60 + spd * 0.55);
      const turn = Math.abs(angleDiff(Math.atan2(a1.ty, a1.tx), Math.atan2(a2.ty, a2.tx)));
      set('ArrowDown', (turn > 0.75 && spd > 640) || (Math.abs(err) > 0.8 && spd > 480));
      window.__botStats.ticks++; if (held.has('ArrowDown')) window.__botStats.brake++;
    }, 30);
  });
}
const stopBot = () => page.evaluate(() => { clearInterval(window.__bot); ['ArrowLeft', 'ArrowRight', 'ArrowDown'].forEach((k) => window.dispatchEvent(new KeyboardEvent('keyup', { key: k }))); });
const sample = () => page.evaluate(() => {
  const g = window.__RAD_GAME__, w = g.world; if (!w) return null;
  const p = w.player, fr = window.__RAD_DEBUG__ && window.__RAD_DEBUG__.frame;
  const errOf = (q) => { const a = Math.atan2(q.lenAxis.y, q.lenAxis.x) - (q.angle + (q.spinVis || 0)); return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))); };
  let orient = 0, orientAI = 0;
  if (fr && fr.cars) for (const q of fr.cars) { if (!q.lenAxis) continue; if (q.isPlayer) orient = errOf(q); else orientAI = Math.max(orientAI, errOf(q)); }
  const info = g.getHudInfo(), A = self.__RAD_AUDIO__;
  return { t: w.race.time, lap: p.lap, lastLapMs: p.lastLapMs || 0, finished: p.finished, place: info.place, spd: Math.hypot(p.vx, p.vy), dist: p.dist,
    ai: w.cars.filter((c) => !c.isPlayer).map((c) => ({ d: c.dist, f: !!c.finished, s: Math.hypot(c.vx, c.vy) })),
    orient, orientAI, drifting: !!p.drifting, drift01: +(p.drift01 || 0),
    reveal: !!document.querySelector('#finish-reveal'), results: !!document.querySelector('#results'),
    music: A && A.music && A.music.cur ? A.music.cur.name : null, ctx: A && A.ctx ? A.ctx.state : null, voices: A ? A.voices : null,
    text: [...document.querySelectorAll('#app *')].filter((el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; }).map((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ')).join(' | ') };
});
const report = [];
let firstTap = true;
for (let ti = 0; ti < TRACKS.length; ti++) {
  const name = TRACKS[ti];
  log(`\n=== ${name} · ${rk} ===`);
  await page.evaluate(() => { self.__RAD_SFX_PLAYED__ && (self.__RAD_SFX_PLAYED__.length = 0); self.__RAD_SFX_LOG__.length = 0; });
  await page.waitForSelector('[data-act=race]');
  await page.tap('[data-act=race]'); // real touch: unlocks the AudioContext on the first tap
  await page.waitForSelector('#tracks button');
  if (firstTap) { firstTap = false; await sleep(400); const c = await page.evaluate(() => self.__RAD_AUDIO__.ctx && self.__RAD_AUDIO__.ctx.state); check(c === 'running', `first touch unlocked the AudioContext (${c})`); }
  await (await page.$$('#tracks button'))[ti].tap();
  await page.waitForFunction(() => window.__RAD_GAME__?.world && window.__RAD_GAME__.isRunning(), { timeout: 20000 });
  const kind = await page.evaluate(() => window.__RAD_GAME__.rendererKind);
  check(kind === rk, `renderer ${kind}`);
  await page.evaluate(() => { window.__RAD_DEBUG__ = {}; });
  await sleep(1500); await shot(`${name}-countdown`);
  await page.waitForFunction(() => window.__RAD_GAME__.world.race.countdown <= 0, { timeout: 20000, polling: 50 });
  await startBot();
  // frame timing over the whole race
  await page.evaluate(() => { window.__ft = []; window.__ftOn = true; let last = performance.now(); const f = (t) => { if (!window.__ftOn) return; window.__ft.push(t - last); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); });
  const t0 = Date.now();
  let s = null, lapTimes = [], prevLap = 0, revealSeen = false, orientMax = 0, orientAIMax = 0, hint = '', shots = {}, musicMid = null, ctxMid = null, voicesMid = null, kbBoost = null, aiStart = null, aiMid = null, driftSeen = 0, driftMax = 0;
  while (Date.now() - t0 < 300000) {
    await sleep(200);
    try { s = await sample(); } catch (e) { continue; }
    if (!s) continue;
    if (s.results) break;
    if (s.reveal) { revealSeen = true; if (!shots.reveal) { shots.reveal = await shot(`${name}-finish`); } }
    if (s.lap > prevLap) { lapTimes.push(s.lastLapMs); prevLap = s.lap; }
    if (s.finished) continue;
    if (!aiStart && s.t > 500) aiStart = s.ai.map((a) => a.d);
    if (s.drifting) driftSeen++; driftMax = Math.max(driftMax, s.drift01);
    orientMax = Math.max(orientMax, s.orient); orientAIMax = Math.max(orientAIMax, s.orientAI);
    const m = s.text.match(KEY_HINT); if (m && !hint) hint = m[0];
    if (!shots.early && s.t > 7000) shots.early = await shot(`${name}-race-early`);
    if (kbBoost === null && s.t > 10000) { // keyboard BOOST (Shift) still works
      const b0 = await page.evaluate(() => ({ uses: window.__RAD_GAME__.world.boost.uses + (window.__RAD_GAME__.world.boost.freeUses || 0), ms: window.__RAD_GAME__.world.boost.activeMs }));
      await page.keyboard.press('Shift'); await sleep(250);
      const b1 = await page.evaluate(() => ({ uses: window.__RAD_GAME__.world.boost.uses + (window.__RAD_GAME__.world.boost.freeUses || 0), ms: window.__RAD_GAME__.world.boost.activeMs, lvl: window.__RAD_GAME__.world.player.boostLevel, st: document.getElementById('btn-boost').dataset.state }));
      kbBoost = { b0, b1 }; shots.boost = await shot(`${name}-boost`);
    }
    if (!shots.mid && s.lap >= 1 && s.t > 25000) { shots.mid = await shot(`${name}-race-mid`); musicMid = s.music; ctxMid = s.ctx; voicesMid = s.voices; aiMid = s.ai.map((a) => a.d); }
  }
  await page.evaluate(() => { window.__ftOn = false; });
  const ft = (await page.evaluate(() => window.__ft)).slice(5).filter((d) => d > 0);
  await stopBot();
  const srt = [...ft].sort((a, b) => a - b), avgMs = ft.reduce((a, b) => a + b, 0) / Math.max(1, ft.length);
  const fps = 1000 / avgMs, p5 = 1000 / srt[Math.floor(srt.length * 0.95)], worst = srt[srt.length - 1], slow = ft.filter((d) => d > 25).length;
  await sleep(600);
  shots.results = await shot(`${name}-results`);
  const res = await page.evaluate(() => window.__RAD_LAST_RESULT__);
  const st = res && res.standings ? res.standings : [];
  const me = st.find((q) => q.isPlayer);
  const dnf = st.filter((q) => q.dnf).map((q) => q.name);
  const PL = await page.evaluate(() => (self.__RAD_SFX_PLAYED__ || []).map((x) => x.ev + (x.skipped ? '(skip)' : '')));
  const SL = await page.evaluate(() => self.__RAD_SFX_LOG__.map((x) => (typeof x === 'string' ? x : x.n)));
  const A = await page.evaluate(() => { const L = self.__RAD_AUDIO__.load; return { files: L.files, core: L.core, failed: L.timeline.filter((e) => /fail/.test(e.ev)), perf: self.__RAD_AUDIO__.perf }; });
  const cnt = (arr, k) => arr.filter((x) => x === k).length;
  const fmt = (ms) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(2).padStart(5, '0')}`;
  check(!!s && s.results, `race completed → results (${((Date.now() - t0) / 1000).toFixed(0)} s wall)`);
  check(revealSeen, 'finish reveal shown');
  check(lapTimes.length === laps && lapTimes.every((x) => x > 5000), `laps ${lapTimes.length}/${laps}: ${lapTimes.map(fmt).join(' · ')}`);
  check(st.length === 6 && dnf.length === 0, `all 6 cars finished (DNF: ${dnf.join(',') || 'none'}); player P${me ? me.place : '?'} in ${me ? fmt(me.finishTime) : '?'}`);
  const aiMoved = aiStart && aiMid ? aiMid.map((d, i) => d - aiStart[i]) : [];
  check(aiMoved.length === 5 && aiMoved.every((d) => d > 2000), `AI cars race: all 5 covered distance by mid race (${aiMoved.map((d) => Math.round(d)).join(', ')} wu)`);
  check(orientMax < 0.05 && orientAIMax < 0.05, `cars point the way they drive: sprite axis vs heading max err player ${orientMax.toFixed(3)} / AI ${orientAIMax.toFixed(3)} rad`);
  check(!hint, `no keyboard hints in the gameplay UI (${hint || 'none'})`);
  check(kbBoost && kbBoost.b1.ms > 0, `keyboard: arrow keys steered the whole race; Shift fired BOOST (active ${kbBoost ? Math.round(kbBoost.b1.ms) : '?'} ms, button ${kbBoost && kbBoost.b1.st})`);
  check(fps >= 50, `FPS avg ${fps.toFixed(1)}, p5 ${p5.toFixed(1)}, worst frame ${worst.toFixed(1)} ms, ${slow} frames > 25 ms of ${ft.length}`);
  check(A.core && !A.failed.length && !audioReqFail.length, `audio files loaded (${Object.entries(A.files).map(([k, v]) => k + '.' + v).length} files, failures ${A.failed.length + audioReqFail.length})`);
  check(cnt(PL, 'countdown') >= 3 && cnt(PL, 'countdownGo') === 1 && cnt(PL, 'lap') === laps - 1 && PL.some((x) => ['slam', 'podium', 'win'].includes(x)) && PL.includes('boost'),
    `sfx scheduled: countdown×${cnt(PL, 'countdown')} GO×${cnt(PL, 'countdownGo')} lap×${cnt(PL, 'lap')} boost×${cnt(PL, 'boost')} wall×${PL.filter((x) => /^wall/.test(x)).length} finish=${PL.filter((x) => ['slam', 'podium', 'win'].includes(x)).join(',')}`);
  check(musicMid === 'music_race' && ctxMid === 'running' && voicesMid, `mid race: music ${musicMid}, context ${ctxMid}, engine voices ${voicesMid}`);
  const audioMs = A.perf.frames ? A.perf.ms / A.perf.frames : 0;
  log(`    audio main-thread cost ${audioMs.toFixed(3)} ms/frame over ${A.perf.frames} frames`);
  if (process.env.DRIFT) log(`    drift: drifting in ${driftSeen} samples, drift01 max ${driftMax.toFixed(2)}`);
  report.push({ track: name, renderer: rk, place: me ? me.place : null, finish: me ? fmt(me.finishTime) : null, laps: lapTimes.map(fmt), best: me ? fmt(me.bestLapMs) : null,
    fps: +fps.toFixed(1), p5: +p5.toFixed(1), worstMs: +worst.toFixed(1), slow, audioMsPerFrame: +audioMs.toFixed(3), orient: +orientMax.toFixed(3), sfx: PL.length, music: musicMid, shots, driftSeen, driftMax });
  await page.evaluate(() => document.querySelector('#title')?.click());
  await sleep(600);
}
check(errs.length === 0, `no console errors / warnings (${errs.slice(0, 5).join(' | ') || 'none'})`);
log(fails ? `RESULT: ${fails} FAIL` : 'RESULT: ALL OK');
fs.writeFileSync(`${outDir}/${prefix}-races-${rk}.json`, JSON.stringify(report, null, 1));
fs.writeFileSync(`${outDir}/${prefix}-races-${rk}.txt`, lines.join('\n') + '\n');
await browser.close();
process.exit(fails ? 1 : 0);
