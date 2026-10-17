// v54.7 verification ("the sound release"): Audio Engineer's recorded set wired in (load order, Opus decode + AAC
// fallback, sfx → clip rules, engine voices, music scenes incl. late tracks, pause / volumes / ?synth=1), GD's
// screen-sized boost rings + BOOST button DOUBLE BOOST pulse, the thumb-off steer ring, no keyboard hints in gameplay.
//   node docs/verify-v547.mjs [url] [outdir] [canvas=0|1]
import puppeteer from 'puppeteer-core';
const [,, url = 'http://localhost:4173/', out = 'docs/shots', cv = '0'] = process.argv;
const tag = cv === '1' ? '-canvas' : '';
const qs = (extra = '') => { const a = [cv === '1' ? 'canvas=1' : '', extra].filter(Boolean).join('&'); return url + (a ? '?' + a : ''); };
let fails = 0; const ok = (c, m) => { console.log(`  [${c ? 'ok' : 'FAIL'}] ${m}`); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
let page, T0 = 0, areqs = [], hold = null, held = [];
async function newPage(vp = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }) {
  if (page) await page.close();
  page = await browser.newPage();
  await page.setBypassServiceWorker(true);
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(m.text()); });
  areqs = []; held = []; hold = null;
  page.on('request', (r) => { if (/assets\/audio\//.test(r.url())) areqs.push({ f: r.url().replace(/^.*assets\/audio\/([^?]+).*$/, '$1'), t: Date.now() - T0, ev: 'req' }); });
  page.on('requestfinished', (r) => { if (/assets\/audio\//.test(r.url())) areqs.push({ f: r.url().replace(/^.*assets\/audio\/([^?]+).*$/, '$1'), t: Date.now() - T0, ev: 'fin' }); });
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    if (hold && hold.test(r.url())) { held.push(r); return; }
    if (bad && bad.test(r.url())) { r.respond({ status: 200, contentType: 'audio/ogg', body: Buffer.from('OggS not really an ogg file') }); return; }
    r.continue();
  });
  await page.evaluateOnNewDocument(() => {
    const log = []; const push = log.push.bind(log);
    log.push = (n) => push({ n, t: (() => { try { return window.__RAD_GAME__.world.race.time; } catch (_) { return -1; } })(), c: (() => { try { return +self.__RAD_AUDIO__.ctx.currentTime.toFixed(4); } catch (_) { return -1; } })() });
    self.__RAD_SFX_LOG__ = log;
  });
  await page.setViewport(vp);
}
let bad = null;
const release = () => { const h = held; held = []; hold = null; h.forEach((r) => r.continue()); };
async function boot(extra = '', save = null) {
  T0 = Date.now();
  await page.goto(qs(extra), { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => { localStorage.clear(); if (s) localStorage.setItem('radcars_core_v1', JSON.stringify(s)); }, save);
  areqs = []; T0 = Date.now();
  await page.reload({ waitUntil: 'networkidle2' });
}
const SAVE = (o) => ({ mute: false, bestLaps: {}, options: { aiCount: 5, laps: 3, difficulty: 1, leftHanded: false, drift: false, ...o } });
async function toRace(ti) {
  await page.tap('[data-act=race]'); await page.waitForSelector('#tracks button'); await (await page.$$('#tracks button'))[ti].tap();
  await page.waitForFunction(() => window.__RAD_GAME__?.world?.race?.countdown <= 0, { timeout: 20000 });
}
const steerBot = () => page.evaluate(async () => {
  const { pointAt } = await import('./js/tracks.js');
  const w = window.__RAD_GAME__.world, p = w.player, t = w.track, keys = new Set();
  const set = (k, v) => { if (v !== keys.has(k)) { v ? keys.add(k) : keys.delete(k); window.dispatchEvent(new KeyboardEvent(v ? 'keydown' : 'keyup', { key: k })); } };
  clearInterval(window.__bot); window.__bot = setInterval(() => {
    if (!window.__RAD_GAME__.world || window.__RAD_GAME__.world.player !== p) return;
    const spd = Math.hypot(p.vx, p.vy), tp = pointAt(t, p.sPrev + 160 + spd * 0.35);
    let e = Math.atan2(tp.y - p.y, tp.x - p.x) - p.angle; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
    set('ArrowRight', e > 0.05); set('ArrowLeft', e < -0.05);
  }, 30);
});
const until = (fn, ms = 8000, arg) => page.waitForFunction(fn, { timeout: ms, polling: 16 }, arg).then(() => true).catch(() => false);
const forcePad = () => page.evaluate(() => { const p = window.__RAD_GAME__.world.player; p.padLand = (p.padLand || 0) + 1; p.padMs = Math.max(p.padMs || 0, 500); });
const forceDrift = (q = 0.5) => page.evaluate((q) => { const p = window.__RAD_GAME__.world.player; p.driftBoostMs = 400 + 700 * q; p.driftBoostLvl = 0.6 + 0.35 * q; p.driftBoostQ = q; p.driftLand = (p.driftLand || 0) + 1; }, q);
const tapBoost = async () => { await page.evaluate(() => { window.__RAD_GAME__.world.boost.charge = 1; }); await page.tap('#btn-boost'); };
const played = () => page.evaluate(() => self.__RAD_SFX_PLAYED__.slice());
const sfxLog = () => page.evaluate(() => self.__RAD_SFX_LOG__.slice());
const clearLogs = () => page.evaluate(() => { self.__RAD_SFX_PLAYED__.length = 0; self.__RAD_SFX_LOG__.length = 0; });
const idle = () => until(() => { const p = window.__RAD_GAME__.world.player, w = window.__RAD_GAME__.world; return (p.boostLevel || 0) < 0.02 && !(p.padMs > 0) && !(p.driftBoostMs > 0) && w.chain.stacks === 0 && !w.power.active; }, 20000);
const padFree = () => until(() => { const p = window.__RAD_GAME__.world.player; return p.sPrev > 6400 && p.sPrev < 9000 && !(p.padMs > 0) && (p.boostLevel || 0) < 0.02 && !(p.driftBoostMs > 0); }, 60000);
const audio = () => page.evaluate(() => { const A = self.__RAD_AUDIO__, m = A.mix; return { ctx: A.ctx && A.ctx.state, scene: A.scene, pending: A.racePending, voices: A.voices, cur: A.music && A.music.cur && A.music.cur.name, curGain: A.music && A.music.cur ? +A.music.cur.g.gain.value.toFixed(3) : null,
  eng: m && +m.engineDuck.gain.value.toFixed(3), sfxD: m && +m.sfxDuck.gain.value.toFixed(3), musicVol: m && +m.musicVol.gain.value.toFixed(3), sfxVol: m && +m.sfxVol.gain.value.toFixed(3), master: m && +m.master.gain.value.toFixed(3), t: A.ctx && A.ctx.currentTime }; });
const hintScan = () => page.evaluate(() => {
  const re = /keyboard|\bshift\b|wasd|arrow keys|\bspace\b|\besc\b|press [a-z]\b|\bkey\b/i, hits = [];
  const vis = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  document.querySelectorAll('#app *').forEach((el) => { const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim(); if (own && re.test(own) && vis(el)) hits.push(own.slice(0, 60)); });
  return hits;
});

// ================================================================ 1. load order, Opus decode, first tap
console.log(`=== loading · ${cv === '1' ? 'canvas' : 'pixi'}`);
await newPage();
await boot('', SAVE({}));
await wait(1500);
const L0 = await page.evaluate(() => ({ load: JSON.parse(JSON.stringify(self.__RAD_AUDIO__.load)), ctx: !!self.__RAD_AUDIO__.ctx, nav: performance.getEntriesByType('navigation')[0].loadEventEnd }));
const coreFiles = ['sfx_sprite.json', 'sfx_sprite.ogg', 'eng_idle.ogg', 'eng_low.ogg', 'eng_high.ogg', 'eng_off_low.ogg', 'eng_off_high.ogg', 'squeal.ogg', 'warn_loop.ogg'];
const fin = (f) => (areqs.find((r) => r.f === f && r.ev === 'fin') || {}).t, req = (f) => (areqs.find((r) => r.f === f && r.ev === 'req') || {}).t;
const coreDone = Math.max(...coreFiles.map((f) => fin(f) ?? 1e9)), musicReq = ['music_menu.ogg', 'music_race.ogg', 'music_finish.ogg'].map(req);
console.log(`  requests: ${areqs.filter((r) => r.ev === 'req').map((r) => `${r.f}@${r.t}`).join(' ')}`);
ok(coreFiles.every((f) => req(f) != null) && musicReq.every((t) => t != null), `sprite + map + 7 loops + 3 music files requested (${areqs.filter((r) => r.ev === 'req').length})`);
ok(musicReq.every((t) => t >= coreDone), `music requested only after the sprite + engine arrived (core done ${coreDone} ms, music ${musicReq.join(' / ')} ms)`);
ok(musicReq[0] < musicReq[1] && musicReq[1] < musicReq[2], 'music one at a time: menu, race, finish');
ok(L0.load.ext === 'ogg' && Object.values(L0.load.files).every((e) => e === 'ogg') && L0.load.core, `Opus decodes in Chrome: every file decoded as .ogg (${JSON.stringify(L0.load.files)})`);
ok(!L0.ctx, 'no AudioContext before the first tap (decoded on an OfflineAudioContext, no autoplay warning)');
ok(Math.min(...areqs.map((r) => r.t)) > 0 && req('sfx_sprite.ogg') > 0, `audio starts after the renderer (first audio request ${req('sfx_sprite.json')} ms after the reload, page load event ${Math.round(L0.nav)} ms)`);
await page.tap('[data-act=race]'); await wait(700);
let a = await audio(), P = await played();
ok(a.ctx === 'running' && a.cur === 'music_menu' && P.some((x) => x.ev === 'click'), `first tap: context running, menu music on (${a.cur}), menu click heard (${P.map((x) => x.file).join(',')})`);

// ================================================================ 2. menu track arriving late → ~1 s fade
console.log('=== late menu track');
await newPage(); hold = /music_menu/;
await boot('', SAVE({}));
await page.tap('[data-act=race]'); await wait(600);
a = await audio(); ok(a.ctx === 'running' && a.cur === null, `menu showing, menu track not here yet: no music (cur ${a.cur})`);
release(); await until(() => self.__RAD_AUDIO__.music.cur, 8000);
const fade = []; for (let i = 0; i < 6; i++) { fade.push((await audio()).curGain); await wait(200); }
ok(fade[0] < 0.6 && fade[fade.length - 1] > 0.95 && fade.some((g) => g > 0.25 && g < 0.85), `late menu track fades in over ~1 s (gain every 200 ms: ${fade.join(' → ')})`);

// ================================================================ 3. race: boost / chain / drift sounds, rings, BOOST button, thumb-off, pause
console.log('=== race · Gridlock · boosts, rings, button, thumb-off, pause');
await newPage(); await boot('', SAVE({ laps: 3, aiCount: 5 }));
await toRace(1);
a = await audio();
ok(a.cur === 'music_race' && a.voices && !a.pending, `GO: race music on the GO frame (${a.cur}), engine voices running (${a.voices})`);
const go = (await sfxLog()).find((e) => e.n === 'countdownGo');
ok(!!go, 'countdownGo fired');
await steerBot();
ok((await hintScan()).length === 0, `no keyboard hints visible in gameplay (${(await hintScan()).join(' | ')})`);
await padFree(); await clearLogs();
// cyan ring: pause when a boost ring is at ~75 % of its life
await page.evaluate(() => { const g = window.__RAD_GAME__, w = g.world; window.__ringShot = null;
  const f = () => { const r = w.fxState.parts.find((o) => o.k === 'ring' && o.boost && !o.chain && o.carId === w.player.id && o.ms >= 190); if (r && !window.__ringShot) { g.setPaused(true); window.__ringShot = { z: w.cam.zoom, s0: r.s0, s1: r.s1, ms: r.ms, life: r.life }; return; } requestAnimationFrame(f); }; requestAnimationFrame(f); });
await tapBoost();
await until(() => window.__ringShot, 4000);
const ring = await page.evaluate(async () => { const { boostRingK, partLook } = await import('./js/fx.js'); const r = window.__ringShot, kind = window.__RAD_GAME__.rendererKind;
  const D = kind === 'pixi' ? 106 : 115, k = boostRingK(r.z, innerWidth, innerHeight, D);
  return { ...r, kind, nowPx: Math.round(D * (r.s0 + (r.s1 - r.s0) * Math.min(1, r.ms / r.life)) * k * r.z), fullPx: Math.round(D * r.s1 * k * r.z), oldPx: Math.round(D * r.s1 * r.z), pinkPx: Math.round(D * 1.82 * k * r.z) }; });
await page.screenshot({ path: `${out}/94-boost-ring${tag}.png` });
console.log('  ring', JSON.stringify(ring));
ok(Math.abs(ring.fullPx - 140) <= 4 && Math.abs(ring.pinkPx - 182) <= 5, `boost ring sized by 1/zoom: cyan ${ring.fullPx} px, pink ${ring.pinkPx} px across at 390 px wide (zoom ${ring.z.toFixed(2)}; v54.6 was ${ring.oldPx} px)`);
await page.evaluate(() => window.__RAD_GAME__.setPaused(false));
await wait(500);
// DOUBLE BOOST: pause 150 ms into the rush
await page.evaluate(() => { const g = window.__RAD_GAME__, w = g.world; window.__chainShot = false;
  const f = () => { if (w.chain.landT >= 0 && w.race.time - w.chain.landT >= 150 && !window.__chainShot) { window.__chainShot = true; g.setPaused(true); return; } requestAnimationFrame(f); }; requestAnimationFrame(f); });
await forcePad();
await until(() => window.__chainShot, 3000);
const btnState = () => page.evaluate(() => { const b = document.getElementById('btn-boost'), pip = b.querySelector('.act-pip'), badge = b.querySelector('.act-badge'), ov = getComputedStyle(b.querySelector('.act-vis'), '::after');
  return { state: b.dataset.state, chain: b.classList.contains('chain'), p: +b.style.getPropertyValue('--p'), pip: getComputedStyle(pip).display, pipText: pip.textContent, badge: getComputedStyle(badge).display, anim: ov.animationName, dur: ov.animationDuration, label: b.querySelector('.act-label').textContent }; });
const B1 = await btnState();
await page.screenshot({ path: `${out}/94-boost-chain-pulse${tag}.png` });
await wait(125); await page.screenshot({ path: `${out}/94-boost-chain-pulse-b${tag}.png` }); // the other half of the 4 Hz cycle
console.log('  button mid-chain', JSON.stringify(B1));
ok(B1.state === 'active' && B1.chain && B1.p === 1, `BOOST stays full mid-chain (state ${B1.state}, --p ${B1.p})`);
ok(B1.anim === 'actChainPulse' && B1.dur === '0.25s', `pulses cyan/pink at 4 Hz (${B1.anim} ${B1.dur})`);
ok(B1.pip === 'block' && B1.pipText === '×2' && B1.badge === 'none', `pink ×2 pip where the ∞ badge sits (pip ${B1.pip}, badge ${B1.badge})`);
await page.evaluate(() => window.__RAD_GAME__.setPaused(false));
await wait(300); await forceDrift(1); // a 3rd landing mid-chain extends the hold towards the 3 s cap (no new rush / sound)
await until(() => { const ch = window.__RAD_GAME__.world.chain; return ch.rushMs === 0 && ch.stacks === 2; }, 3000); await wait(120);
const B2 = await btnState(); await page.screenshot({ path: `${out}/94-boost-chain-drain${tag}.png` }); await wait(300); const B3 = await btnState();
console.log('  drain', JSON.stringify(B2), JSON.stringify(B3));
ok(B2.state === 'active' && !B2.chain && B2.p < 1 && B2.p > 0.5 && B3.p < B2.p, `after the rush: drains in cyan (no pulse / pip; --p ${B2.p} → ${B3.p})`);
await idle(); await wait(300);
let PL = await played(), SL = await sfxLog();
const bo = PL.filter((x) => x.ev === 'boost' && !x.skipped), bc = PL.filter((x) => x.ev === 'boostChain'), be = PL.filter((x) => x.ev === 'boost_end');
const lb = SL.filter((e) => e.n === 'boost'), lc = SL.filter((e) => e.n === 'boostChain');
console.log('  played', PL.map((x) => `${x.ev}${x.skipped ? '(skip)' : ''}@${x.t}`).join(' '));
ok(bo.length === 1 && bc.length === 1 && bc[0].t > bo[0].t, `button → 'boost' once, pad → 'boostChain' once (${bo.length} / ${bc.length})`);
ok(lc.length === 1 && !lb.some((e) => e.t === lc[0].t) && !PL.some((x) => x.ev === 'boost' && Math.abs(x.t - bc[0].t) < 0.02), `no boost + boostChain on the same frame (boost @ race ${lb.map((e) => Math.round(e.t))}, chain @ ${lc.map((e) => Math.round(e.t))})`);
ok(be.length === 1 && be[0].t > bc[0].t, `boost_end once, when the stacked boost bled out (@ ${be.map((x) => x.t)})`);
// drift boost: the edge whoosh is skipped for 0.3 s after the drift cue
await clearLogs(); // as game.js does it: sfx('driftBoost') on the award frame, boostLevel ramps from the next frame
await page.evaluate(async (q) => { const m = await import('./js/audio.js'), p = window.__RAD_GAME__.world.player; m.sfx('driftBoost', { quality: q }); p.driftBoostMs = 400 + 700 * q; p.driftBoostLvl = 0.6 + 0.35 * q; p.driftBoostQ = q; p.driftLand = (p.driftLand || 0) + 1; }, 0.85);
await idle(); await wait(300);
PL = await played();
const db = PL.find((x) => x.ev === 'drift_boost'), sk = PL.find((x) => x.ev === 'boost' && x.skipped), sp = PL.find((x) => x.ev === 'drift_sparkle');
ok(db && sk && sk.skipped === 'driftBoost' && !PL.some((x) => x.ev === 'boost' && !x.skipped && Math.abs(x.t - db.t) < 0.5), `drift boost: drift_boost + sparkle (${!!sp}), its boost-edge whoosh skipped (edge ${sk && db ? ((sk.t - db.t) * 1000).toFixed(0) : '?'} ms from the cue)`);
ok(PL.filter((x) => x.ev === 'boost_end').length >= 1, `boost_end after the drift boost (${PL.map((x) => x.ev).join(',')})`);
// a drift landing that chains: boostChain instead of drift_boost (and no edge whoosh)
await clearLogs(); await tapBoost(); await until(() => window.__RAD_GAME__.world.player.boostLevel >= 1); await wait(300); await clearLogs();
// as game.js does it: sfx('driftBoost') on the award frame, the chain lands on the next frame
await page.evaluate(async (q) => { const m = await import('./js/audio.js'), p = window.__RAD_GAME__.world.player; m.sfx('driftBoost', { quality: q }); p.driftBoostMs = 400 + 700 * q; p.driftBoostLvl = 0.6 + 0.35 * q; p.driftBoostQ = q; p.driftLand = (p.driftLand || 0) + 1; }, 0.6);
await wait(500); PL = await played();
ok(PL.some((x) => x.ev === 'boostChain') && PL.some((x) => x.ev === 'drift_boost' && x.skipped === 'boostChain') && !PL.some((x) => x.ev === 'drift_boost' && !x.skipped) && !PL.some((x) => x.ev === 'boost' && !x.skipped),
  `chained drift boost: boostChain instead of drift_boost (${PL.map((x) => x.ev + (x.skipped ? '(skip)' : '')).join(',')})`);
await idle(); await wait(200);
// thumb-off
await clearLogs();
const ringBox = await page.evaluate(() => { const r = document.getElementById('aim-pad').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await page.touchscreen.touchStart(ringBox.x, ringBox.y); await page.touchscreen.touchMove(ringBox.x + 20, ringBox.y - 30); await wait(250); await page.touchscreen.touchEnd();
await wait(420);
const th = await page.evaluate(() => { const r = document.getElementById('aim-pad'); return { lost: r.classList.contains('lost'), ring: getComputedStyle(r.querySelector('.tc-aim-ring')).borderColor }; });
await page.screenshot({ path: `${out}/94-thumb-off${tag}.png` });
await page.touchscreen.touchStart(ringBox.x, ringBox.y); await wait(50);
const rg = await page.evaluate(() => document.getElementById('aim-pad').classList.contains('regain'));
await page.screenshot({ path: `${out}/94-thumb-regain${tag}.png` });
await page.touchscreen.touchEnd(); await wait(100);
PL = await played();
ok(th.lost && rg, `thumb-off: lost state shown, cyan regain flash on the next touch (${th.ring})`);
const ui = PL.filter((x) => x.ev === 'denied' || x.ev === 'click');
ok(ui[0] && ui[0].ev === 'denied' && ui[0].file === 'ui_denied' && ui[0].g === 0.7 && ui[1] && ui[1].ev === 'click', `steerOff → denied clip at 70 % (${ui[0] && ui[0].g}), steerOn → click (${ui.map((x) => x.ev).join(',')})`);
// pause: music + engine + sfx muted, ui live, context NOT suspended
await clearLogs();
await page.tap('#btn-pause'); await page.waitForSelector('#pause-ov'); await wait(300);
const ap = await audio();
await page.tap('#resume'); await wait(300);
const ar = await audio(); PL = await played();
ok(ap.ctx === 'running' && ap.eng < 0.02 && ap.sfxD < 0.02 && ap.musicVol < 0.02, `pause: mix.setPaused (engine ${ap.eng}, sfx ${ap.sfxD}, music ${ap.musicVol}), context still ${ap.ctx}`);
ok(PL.some((x) => x.ev === 'click') && ar.eng > 0.9 && ar.musicVol > 0.5, `pause-menu click plays on the live ui bus; resume restores (engine ${ar.eng}, music ${ar.musicVol})`);

// ================================================================ 4. race music late → starts at the next lap; finish → slam + jingle; results → menu
console.log('=== race music late · Neon Loop, 2 laps · finish');
await newPage(); hold = /music_race/;
await boot('', SAVE({ laps: 2, aiCount: 1, difficulty: 0 }));
await toRace(0);
await steerBot(); await wait(200);
a = await audio();
ok(a.pending && a.cur === null, `GO without the race track decoded: no music yet, pending (cur ${a.cur})`);
release(); await until(() => !!self.__RAD_AUDIO__.B.music_race, 10000); await wait(1500);
a = await audio();
const lap0 = await page.evaluate(() => window.__RAD_GAME__.world.player.lap);
ok(a.pending && a.cur === null && lap0 === 0, `race track decoded mid-lap: still waits for the line (cur ${a.cur}, lap ${lap0})`);
await until(() => window.__RAD_GAME__.world.player.lap >= 1, 120000);
await wait(100); a = await audio();
const lapSfx = (await sfxLog()).filter((e) => e.n === 'lap');
ok(a.cur === 'music_race' && !a.pending && lapSfx.length === 1, `race music starts on the lap line (${a.cur})`);
await clearLogs();
await until(() => window.__RAD_GAME__.world.finish && window.__RAD_GAME__.world.finish.slammed, 120000); await wait(400);
PL = await played(); SL = await sfxLog(); a = await audio();
const tier = SL.filter((e) => ['slam', 'podium', 'win'].includes(e.n)), slam = PL.find((x) => x.ev === 'slam'), jing = PL.find((x) => x.ev === 'podium' || x.ev === 'win');
console.log('  finish', JSON.stringify({ tier: tier.map((e) => e.n), played: PL.map((x) => `${x.ev}@${x.t}`) }));
ok(tier.length === 1, `one tier sound from the game (${tier.map((e) => e.n)}), never an extra slam`);
if (tier[0] && tier[0].n !== 'slam') ok(slam && jing && PL.indexOf(slam) < PL.indexOf(jing) && Math.abs(jing.t - slam.t - 0.30) < 0.005 && PL.filter((x) => x.ev === 'slam').length === 1, `slam, then the ${jing && jing.file} 0.30 s later (Δ ${jing && slam ? (jing.t - slam.t).toFixed(3) : '?'} s)`);
else ok(slam, 'slam (4th place or lower)');
ok(a.cur === 'music_finish' && a.eng < 0.6, `finish: race loop → finish sting (${a.cur}), engine ducked (${a.eng})`);
await page.waitForSelector('#title', { timeout: 30000 }); await wait(400);
a = await audio(); ok(!a.voices, 'results: engine voices stopped');
await page.tap('#title'); await wait(500); const m1 = await audio(); await wait(700); const m2 = await audio();
ok(m1.cur === 'music_menu' && m1.curGain > 0.2 && m1.curGain < 0.75 && m2.curGain > 0.95, `results → menu: menu loop fades in over 1 s (${m1.curGain} → ${m2.curGain})`);
// podium (direct): slam + podium_jingle 0.30 s later
await clearLogs();
await page.evaluate(async () => { const m = await import('./js/audio.js'); m.sfx('podium'); });
PL = await played();
ok(PL.length === 2 && PL[0].ev === 'slam' && PL[1].file === 'podium_jingle' && Math.abs(PL[1].t - PL[0].t - 0.3) < 0.005, `podium = slam + podium_jingle +0.30 s (${PL.map((x) => `${x.file}@${x.t}`).join(' ')})`);

// ================================================================ 5. Options: Music / Effects volume
console.log('=== volumes');
await page.tap('[data-act=options]'); await page.waitForSelector('input[data-vol=music]');
const sl = await page.evaluate(() => [...document.querySelectorAll('input[data-vol]')].map((r) => ({ k: r.dataset.vol, v: r.value })));
ok(sl.length === 2 && sl[0].v === '8' && sl[1].v === '10', `Options has Music (${sl[0] && sl[0].v}/10) and Effects (${sl[1] && sl[1].v}/10) sliders`);
await page.evaluate(() => { const r = document.querySelector('input[data-vol=music]'); r.value = '5'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); const s = document.querySelector('input[data-vol=sfx]'); s.value = '7'; s.dispatchEvent(new Event('input')); });
await wait(300); a = await audio();
const ls = await page.evaluate(() => [localStorage.getItem('radcars.musicVol'), localStorage.getItem('radcars.sfxVol')]);
ok(ls[0] === '0.5' && ls[1] === '0.7' && Math.abs(a.musicVol - 0.25) < 0.02 && Math.abs(a.sfxVol - 0.49) < 0.02, `persisted (${ls.join(' / ')}) and applied as v² (music ${a.musicVol}, effects ${a.sfxVol})`);
await page.screenshot({ path: `${out}/94-options-volume${tag}.png` });
await page.reload({ waitUntil: 'networkidle2' }); await page.tap('[data-act=options]'); await page.waitForSelector('input[data-vol=music]');
const sl2 = await page.evaluate(() => [...document.querySelectorAll('input[data-vol]')].map((r) => r.value));
ok(sl2[0] === '5' && sl2[1] === '7', `volumes survive a reload (${sl2.join(' / ')})`);

// ================================================================ 6. AAC fallback + ?synth=1
console.log('=== AAC fallback · ?synth=1');
await newPage(); bad = /sfx_sprite\.ogg/;
await boot('', SAVE({})); await wait(1500);
let lf = await page.evaluate(() => ({ files: self.__RAD_AUDIO__.load.files, core: self.__RAD_AUDIO__.load.core }));
await page.tap('[data-act=race]'); await wait(400); PL = await played();
ok(lf.core && lf.files.sfx_sprite === 'm4a' && PL.some((x) => x.ev === 'click'), `a sprite .ogg that won't decode falls back to the AAC .m4a (${lf.files.sfx_sprite}), clicks play`);
bad = null;
await newPage(); await boot('synth=1', SAVE({})); await wait(1500);
await page.tap('[data-act=race]'); await wait(300); await (await page.$$('#tracks button'))[2].tap();
await page.waitForFunction(() => window.__RAD_GAME__?.world?.race?.countdown <= 0, { timeout: 20000 });
SL = await sfxLog();
ok(areqs.length === 0 && SL.some((e) => e.n === 'countdownGo'), `?synth=1: no sound files downloaded (${areqs.length}), old beeps still fire (${SL.map((e) => e.n).join(',')})`);
ok(errs.length === 0, `no console errors / warnings (${errs.slice(0, 4).join(' | ')})`);
console.log(fails ? `RESULT: ${fails} FAIL` : 'RESULT: ALL OK');
await browser.close();
process.exit(fails ? 1 : 0);
