// v54.6 verification: DOUBLE BOOST chain (three boosts in a row: BOOST button → pad → drift boost, then a 4th to hit the
// cap), its sound / toast / pink ring / edge flash on ONE frame, LAP BOOST as a chain source, autopilot (pads ignored on
// the rail, BOOST + a drift landing chain), and the Gridlock track pack (loads on Gridlock only, off with ?trackpack=0).
//   node docs/verify-v546.mjs [url] [outdir] [canvas=0|1]
import puppeteer from 'puppeteer-core';
const [,, url = 'http://localhost:4173/', out = 'docs/shots', cv = '0'] = process.argv;
const tag = cv === '1' ? '-canvas' : '';
const qs = (extra = '') => { const a = [cv === '1' ? 'canvas=1' : '', extra].filter(Boolean).join('&'); return url + (a ? '?' + a : ''); };
let fails = 0; const ok = (c, m) => { console.log(`  [${c ? 'ok' : 'FAIL'}] ${m}`); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(); const errs = [], reqs = [];
page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.text().startsWith('[shot]')) console.log('  ' + m.text()); if (['error', 'warning'].includes(m.type())) errs.push(m.text()); });
page.on('request', (r) => { if (/assets\/track\/|trackpack\.js/.test(r.url())) reqs.push(r.url().replace(/^.*?(assets\/track\/|js\/)/, '$1')); });
// sfx log entries carry the race time of the frame they fired on (one update = one race.time)
await page.evaluateOnNewDocument(() => {
  const log = []; const push = log.push.bind(log);
  log.push = (n) => push({ n, t: (() => { try { return window.__RAD_GAME__.world.race.time; } catch (_) { return -1; } })() });
  self.__RAD_SFX_LOG__ = log;
});
async function startRace(ti, extra = '') {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(qs(extra), { waitUntil: 'networkidle2' }); await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle2' });
  reqs.length = 0;
  await page.tap('[data-act=race]'); await page.waitForSelector('#tracks button'); await (await page.$$('#tracks button'))[ti].tap();
  await page.waitForFunction(() => window.__RAD_GAME__?.world?.race?.countdown <= 0, { timeout: 20000 });
}
// keep the car on the road while the chain runs: a light steering bot (keyboard), never the handbrake
const steerBot = () => page.evaluate(async () => {
  const { pointAt } = await import('./js/tracks.js');
  const w = window.__RAD_GAME__.world, p = w.player, t = w.track, keys = new Set();
  const set = (k, v) => { if (v !== keys.has(k)) { v ? keys.add(k) : keys.delete(k); window.dispatchEvent(new KeyboardEvent(v ? 'keydown' : 'keyup', { key: k })); } };
  clearInterval(window.__bot); window.__bot = setInterval(() => {
    const spd = Math.hypot(p.vx, p.vy), tp = pointAt(t, p.sPrev + 160 + spd * 0.35);
    let e = Math.atan2(tp.y - p.y, tp.x - p.x) - p.angle; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
    set('ArrowRight', e > 0.05); set('ArrowLeft', e < -0.05);
  }, 30);
});
// per-frame sampler: level, chain, sources
const sampler = () => page.evaluate(() => {
  const g = window.__RAD_GAME__, w = g.world, p = w.player; window.__tr = [];
  const f = () => { const ch = w.chain; window.__tr.push({ t: Math.round(w.race.time), lvl: +(p.boostLevel || 0).toFixed(3), st: ch.stacks, hold: Math.round(ch.holdMs), rush: Math.round(ch.rushMs), btn: Math.round(w.boost.activeMs), pad: Math.round(p.padMs || 0), dr: Math.round(p.driftBoostMs || 0), spd: Math.round(Math.hypot(p.vx, p.vy)) });
    if (window.__shotAt != null && !window.__shot && ch.landT >= 0 && w.race.time - ch.landT >= window.__shotAt) { window.__shot = true; g.setPaused(true); }
    requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
const forcePad = () => page.evaluate(() => { const p = window.__RAD_GAME__.world.player; p.padLand = (p.padLand || 0) + 1; p.padMs = Math.max(p.padMs || 0, 500); });
const forceDrift = (q = 0.5) => page.evaluate((q) => { const p = window.__RAD_GAME__.world.player; p.driftBoostMs = 400 + 700 * q; p.driftBoostLvl = 0.6 + 0.35 * q; p.driftBoostQ = q; p.driftLand = (p.driftLand || 0) + 1; }, q);
const tapBoost = async () => { await page.evaluate(() => { const w = window.__RAD_GAME__.world; w.boost.charge = 1; }); await page.tap('#btn-boost'); };
const until = (fn, ms = 8000) => page.waitForFunction(fn, { timeout: ms, polling: 16 }).catch(() => null);

// ---------------------------------------------------------------- 1. three boosts in a row (+ a 4th for the cap)
console.log(`=== DOUBLE BOOST chain · Gridlock · ${cv === '1' ? 'canvas' : 'pixi'}`);
await startRace(1);
await steerBot();
// start on the long pad-free stretch (Gridlock pads at s 1100 / 5750 / 19700) with no boost running
await until(() => { const p = window.__RAD_GAME__.world.player; return p.sPrev > 6400 && p.sPrev < 9000 && !(p.padMs > 0) && (p.boostLevel || 0) < 0.02 && !(p.driftBoostMs > 0); }, 30000);
await sampler();
await page.evaluate(() => { window.__shotAt = 110; });
await tapBoost();
await until(() => window.__RAD_GAME__.world.boost.activeMs > 0 && window.__RAD_GAME__.world.player.boostLevel >= 1);
await wait(300); const t1 = await page.evaluate(() => window.__RAD_GAME__.world.race.time);
await forcePad(); // 2nd: chains
await until(() => window.__shot, 3000);
const snap = await page.evaluate(() => { const w = window.__RAD_GAME__.world, fx = w.fxState, p = w.player, z = w.cam.zoom;
  const scr = (x, y) => [Math.round(innerWidth / 2 + (x - w.cam.x) * z), Math.round(innerHeight / 2 + (y - w.cam.y) * z)];
  console.log('[shot] player', JSON.stringify({ at: scr(p.x, p.y), ang: +p.angle.toFixed(2), color: p.color, lvl: p.boostLevel, z, rings: fx.parts.filter((o) => o.k === 'ring').map((o) => ({ at: scr(o.x, o.y), chain: !!o.chain, ms: Math.round(o.ms), s: o.s0 })) })); const t = document.querySelector('.tc-toast'); const cs = getComputedStyle(t);
  return { pink: fx.parts.filter((o) => o.k === 'ring' && o.chain).length, cyan: fx.parts.filter((o) => o.k === 'ring' && !o.chain && o.boost).length, chains: fx.stats.chains, toast: t.querySelector('.tt-text').textContent.trim(), toastOn: !t.classList.contains('hidden'), chainCls: t.classList.contains('tt-chain'), color: cs.color, border: cs.borderColor, shadow: cs.boxShadow }; });
await page.screenshot({ path: `${out}/90-double-boost${tag}.png` });
await page.evaluate(() => window.__RAD_GAME__.setPaused(false));
await wait(500); await forceDrift(1); // 3rd (a perfect drift, 1100 ms) while chained: extends only
await wait(100); await forceDrift(1); // 4th (another 1100 ms): hits the cap
await until(() => window.__RAD_GAME__.world.player.boostLevel < 0.02, 9000);
await wait(200);
const R = await page.evaluate(() => { const w = window.__RAD_GAME__.world; return { tr: window.__tr, log: w.chain.log, count: w.chain.count, ext: w.chain.extends, sfx: self.__RAD_SFX_LOG__.slice(), toasts: (self.__RAD_TOASTS__ || []).map((x) => x.text) }; });
const RUSH = 1.35, RUSH_MS = 1200, CAP = 3000;
const tr = R.tr, peak = Math.max(...tr.map((s) => s.lvl)), maxSt = Math.max(...tr.map((s) => s.st));
const land = R.log[0], tLand = land ? land.t : -1;
const over1 = tr.filter((s) => s.lvl > 1.005), rushDur = over1.length ? over1[over1.length - 1].t - over1[0].t : 0;
const firstOn = tr.find((s) => s.lvl > 0.02), lastOn = [...tr].reverse().find((s) => s.lvl > 0.02);
const fullOn = tr.filter((s) => s.lvl >= 0.999), fullEnd = fullOn.length ? fullOn[fullOn.length - 1].t : 0;
const ch = R.sfx.filter((e) => e.n === 'boostChain'), bo = R.sfx.filter((e) => e.n === 'boost');
console.log('  chain log:', JSON.stringify(R.log));
console.log(`  levels: peak ${peak} · rush >1 for ${rushDur} ms · boost on ${firstOn && firstOn.t}→${lastOn && lastOn.t} (full level until ${fullEnd}; button alone would end at ~${firstOn && firstOn.t + 2000})`);
ok(land && land.src === 'pad' && land.stacks === 2 && land.rushMs === RUSH_MS, `2nd boost (pad) chains: stacks 2, rush ${land && land.rushMs} ms`);
ok(land && Math.abs(land.holdMs - (land.rem + land.add)) <= 1 && land.rem > 1000, `timer extends, not resets: hold ${land && land.holdMs} = time left ${land && land.rem} + pad ${land && land.add}`);
ok(peak >= RUSH - 0.01 && peak <= RUSH + 1e-6, `rush level ${peak} (normal boost 1, cap ${RUSH})`);
ok(rushDur >= RUSH_MS - 100 && rushDur <= RUSH_MS + 350, `rush lasts ${rushDur} ms (≈ ${RUSH_MS} incl. the ease back), then back to level 1`);
const after = tr.filter((s) => s.t > tLand + RUSH_MS + 300 && s.t < fullEnd - 50);
ok(after.length > 10 && after.every((s) => Math.abs(s.lvl - 1) < 0.005), `after the rush: normal boost level 1.000 for ${after.length} frames`);
ok(maxSt === 2, `stacks never above 2 (max ${maxSt})`);
ok(R.log.length === 3 && R.log[1].stacks === 2 && R.log[1].rushMs < RUSH_MS && R.log[2].holdMs <= CAP, `3rd (${R.log[1] && R.log[1].src}) / 4th (${R.log[2] && R.log[2].src}) only extend: hold ${R.log[1] && R.log[1].holdMs} → ${R.log[2] && R.log[2].holdMs} (cap ${CAP})`);
ok(R.log[2] && R.log[2].holdMs === CAP, `4th boost hits the cap exactly (${R.log[2] && R.log[2].holdMs} ms)`);
ok(R.count === 1 && ch.length === 1, `boostChain fired once (${ch.length}), chain count ${R.count}, extends ${R.ext}`);
ok(ch.length === 1 && !bo.some((e) => e.t === ch[0].t), `no 'boost' on the boostChain frame (boost @ ${bo.map((e) => Math.round(e.t)).join(',')}, chain @ ${ch.map((e) => Math.round(e.t))})`);
ok(R.toasts.filter((x) => x === 'DOUBLE BOOST').length === 1 && snap.toast === 'DOUBLE BOOST' && snap.toastOn && snap.chainCls, `toast DOUBLE BOOST once, shown on the shot frame ('${snap.toast}' · ${R.toasts.join(' | ')})`);
ok(/255, 230, 0/.test(snap.color) && /255, 230, 0/.test(snap.border) && /255, 43, 106/.test(snap.shadow), `toast yellow #ffe600 text + ring, pink glow (${snap.color} · ${snap.shadow.slice(0, 40)}…)`);
ok(snap.pink === 1 && snap.chains === 1, `pink ring present on the shot (${snap.pink} pink, ${snap.cyan} cyan)`);
const sameFrame = ch.length === 1 && Math.abs(ch[0].t - tLand) < 1;
ok(sameFrame, `sound, toast flag, ring event on the same frame (sfx t ${ch[0] && Math.round(ch[0].t)} = landing t ${tLand})`);

// ---------------------------------------------------------------- 2. LAP BOOST power as the 2nd boost
console.log('=== LAP BOOST chains');
await page.evaluate(() => { const w = window.__RAD_GAME__.world; w.chain.log.length = 0; w.chain.count = 0; self.__RAD_SFX_LOG__.length = 0; });
await tapBoost(); await until(() => window.__RAD_GAME__.world.player.boostLevel >= 1);
await wait(300); await page.evaluate(() => { window.__RAD_GAME__.world.power.held = 'lapboost'; }); await page.tap('#btn-power');
await wait(400);
const L = await page.evaluate(() => { const w = window.__RAD_GAME__.world; return { log: w.chain.log.slice(), lvl: w.player.boostLevel, act: w.power.active, sfx: self.__RAD_SFX_LOG__.map((e) => e.n) }; });
ok(L.act === 'lapboost' && L.log.length === 1 && /lapboost/.test(L.log[0].src) && L.log[0].stacks === 2 && L.lvl > 1.2, `LAP BOOST during a boost chains (${JSON.stringify(L.log[0])}, level ${L.lvl.toFixed(2)})`);
ok(L.sfx.filter((n) => n === 'boostChain').length === 1, `boostChain once (${L.sfx.join(',')})`);

// ---------------------------------------------------------------- 3. autopilot: pads ignored on the rail, BOOST + drift chain
console.log('=== autopilot');
await startRace(0);
await wait(1200);
await page.evaluate(() => { window.__RAD_GAME__.world.power.held = 'autopilot'; }); await page.tap('#btn-power');
await until(() => window.__RAD_GAME__.world.power.active === 'autopilot');
await wait(600); await tapBoost(); await until(() => window.__RAD_GAME__.world.player.boostLevel >= 1);
await wait(200); await forcePad(); await wait(300);
const A1 = await page.evaluate(() => { const w = window.__RAD_GAME__.world; return { st: w.chain.stacks, n: w.chain.log.length, lvl: w.player.boostLevel }; });
ok(A1.n === 0 && A1.st === 1 && Math.abs(A1.lvl - 1) < 0.01, `pad on the autopilot rail does not chain (stacks ${A1.st}, level ${A1.lvl.toFixed(2)})`);
await forceDrift(0.5); await wait(250);
const A2 = await page.evaluate(() => { const w = window.__RAD_GAME__.world; return { st: w.chain.stacks, log: w.chain.log.slice(), lvl: w.player.boostLevel, top: w.player.top }; });
ok(A2.st === 2 && A2.lvl > 1.2 && A2.log.length === 1, `BOOST + drift landing chains on autopilot (level ${A2.lvl.toFixed(2)})`);

// ---------------------------------------------------------------- 4. track pack: Gridlock only, ?trackpack=0 off
if (cv !== '1') {
  console.log('=== track pack');
  await startRace(1); await wait(800);
  const gp = await page.evaluate(() => { const P = window.__RAD_PIXI__; return { n: P.trackLayer.children.length, bg: P.renderer.background.color.toHex() }; });
  const gReq = reqs.slice();
  ok(gReq.some((r) => /trackpack\.js/.test(r)) && gReq.some((r) => /edge-strip\.png/.test(r)) && gp.bg === '#1a2117', `Gridlock loads the pack (${gReq.length} files: ${[...new Set(gReq.map((r) => r.split('?')[0]))].join(', ')}; bg ${gp.bg}, ${gp.n} track layers)`);
  ok(!gReq.some((r) => /buildings|scenery/.test(r)), 'no buildings atlas requested');
  await startRace(2); await wait(800);
  ok(reqs.length === 0, `Razor Hairpin downloads nothing of the pack (${reqs.length} requests)`);
  await startRace(1, 'trackpack=0'); await wait(800);
  const off = await page.evaluate(() => window.__RAD_PIXI__.renderer.background.color.toHex());
  ok(reqs.length === 0 && off !== '#1a2117', `Gridlock with ?trackpack=0: no pack (${reqs.length} requests, bg ${off})`);
}
ok(errs.length === 0, `no page errors (${errs.slice(0, 3).join(' | ')})`);
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
