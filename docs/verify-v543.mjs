// v54.3 verification: BOOST + MISSILE work during autopilot (every input path), buttons stay live, boostLevel trace,
// autopilot wall hits + handback; speed streaks stay inside the clear band (HUD ↔ controls) in portrait + landscape.
//   node docs/verify-v543.mjs [url] [outdir] [canvas=0|1]
import puppeteer from 'puppeteer-core';
const [,, url = 'http://localhost:4173/', out = 'docs/shots', cv = '0'] = process.argv;
const tag = cv === '1' ? '-canvas' : '';
const u = url + (cv === '1' ? '?canvas=1' : '');
let fails = 0; const ok = (c, m) => { console.log(`  [${c ? 'ok' : 'FAIL'}] ${m}`); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(); const errs = [];
page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(m.text()); });
async function startRace(vp, ti) {
  await page.setViewport(vp);
  await page.goto(u, { waitUntil: 'networkidle2' }); await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle2' });
  await page.tap('[data-act=race]'); await page.waitForSelector('#tracks button'); await (await page.$$('#tracks button'))[ti].tap();
  await page.waitForFunction(() => window.__RAD_GAME__?.world?.race?.countdown <= 0, { timeout: 20000 });
}
const W = () => page.evaluate(() => { const w = window.__RAD_GAME__.world, p = w.player; return { place: [...w.cars].sort((a, b) => b.dist - a.dist).indexOf(p) + 1, t: w.race.time, ap: w.power.active, apMs: w.power.activeMs, hb: !!w.power.handback, act: w.boost.activeMs, src: w.boost.source, lvl: p.boostLevel || 0, shots: w.missile.shots, msrc: w.missile.lastSource, refused: w.missile.refused, flash: w.missile.flash && w.missile.flash.kind, inFlight: w.missiles.filter((m) => !m.dead && !m.rocket).length, fxBoosts: w.fxState.stats.boosts }; });
const raceAt = (ms) => page.waitForFunction((m) => window.__RAD_GAME__.world.race.time >= m, { timeout: 30000, polling: 16 }, ms);
const center = async (sel) => { const b = await (await page.$(sel)).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const btnLook = () => page.evaluate(() => Object.fromEntries(['btn-boost', 'btn-missile'].map((id) => { const e = document.getElementById(id), cs = getComputedStyle(e), ic = getComputedStyle(e.querySelector('.act-icon'));
  return [id, { state: e.dataset.state, disabled: e.classList.contains('disabled') || e.disabled, op: +cs.opacity, filter: cs.filter, iconOp: +ic.opacity, iconFilter: ic.filter, tc: getComputedStyle(document.getElementById('touch-controls')).opacity }]; })));
const charge = () => page.evaluate(() => { const w = window.__RAD_GAME__.world; w.missile.charge = 1; w.boost.charge = 1; });

// ---------------------------------------------------------------- 1. autopilot: boost + missile, portrait 390×844
console.log(`=== autopilot weapons · portrait · ${cv === '1' ? 'canvas' : 'pixi'}`);
await startRace({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 0);
await page.evaluate(() => { window.__RAD_GAME__.debug.give('autopilot'); });
await raceAt(800);
const lookBefore = await btnLook();
await page.evaluate(() => { const g = window.__RAD_GAME__, w = g.world; g.debug.activate(); window.__lv = [];
  const f = () => { if (w.power.active === 'autopilot' || w.power.handback) window.__lv.push([Math.round(w.race.time - w.power.startMs), +(w.player.boostLevel || 0).toFixed(3), Math.round(Math.hypot(w.player.vx, w.player.vy))]); if (!w.player.finished) requestAnimationFrame(f); }; requestAnimationFrame(f); });
await page.waitForFunction(() => window.__RAD_GAME__.world.power.active === 'autopilot', { timeout: 5000 });
const t0 = await page.evaluate(() => window.__RAD_GAME__.world.power.startMs);
await raceAt(t0 + 150);
const lookAp = await btnLook();
await page.screenshot({ path: `${out}/87-autopilot-buttons${tag}.png` });
for (const id of ['btn-boost', 'btn-missile']) {
  const a = lookAp[id], b = lookBefore[id];
  ok(['ready', 'unlimited', 'active'].includes(a.state) && !a.disabled && a.op === 1 && a.iconOp === b.iconOp && a.iconFilter === b.iconFilter && a.tc === '1',
    `${id} live during autopilot: state ${a.state} (before ${b.state}), opacity ${a.op}, icon ${a.iconOp}/${a.iconFilter}, not disabled`);
}
const res = {};
async function tryBoost(name, fire) {
  await charge(); const s0 = await W(); await fire(); await wait(450); const s1 = await W();
  res[name] = s1;
  ok(s0.ap === 'autopilot' && s1.act > 0 && s1.lvl > 0.15 && s1.fxBoosts > s0.fxBoosts, `BOOST via ${name} during autopilot: activeMs ${Math.round(s1.act)}, boostLevel ${s1.lvl.toFixed(2)}, source ${s1.src}, boost fx +${s1.fxBoosts - s0.fxBoosts}`);
}
async function tryMissile(name, fire) {
  await charge(); const s0 = await W(); await fire(); await wait(120); const s1 = await W();
  res['m-' + name] = s1;
  const launched = s1.shots === s0.shots + 1, noTarget = s1.refused > s0.refused;
  ok(s0.ap === 'autopilot' && (launched || noTarget) && (launched ? s1.msrc !== undefined : true), `MISSILE via ${name} during autopilot: ${launched ? 'launched (source ' + s1.msrc + ', in flight ' + s1.inFlight + ')' : 'NO TARGET (P' + s1.place + ', flash ' + s1.flash + ', refused ' + s0.refused + '→' + s1.refused + ', shots ' + s0.shots + '→' + s1.shots + ')'}`);
  return launched;
}
// missiles first, while the field is still ahead (autopilot takes P1 within a few seconds → NO TARGET after that)
const [kx, ky] = await center('#btn-brake');
const slide = async (dx, dy) => { await page.touchscreen.touchStart(kx, ky); for (let i = 1; i <= 4; i++) { await page.touchscreen.touchMove(kx + dx * i / 4, ky + dy * i / 4); await wait(16); } await page.touchscreen.touchEnd(); };
const [mx, my] = await center('#btn-missile');
const l1 = await tryMissile('MISSILE tap', () => page.touchscreen.tap(mx, my));
if (l1) await page.screenshot({ path: `${out}/87-autopilot-missile${tag}.png` });
await tryMissile('Space key', () => page.keyboard.press('Space'));
await tryMissile('slide left from BRAKE', () => slide(-70, 0));
// boosts: BOOST tap → shot with the flame; Shift; slide up from BRAKE (each once the last has ramped out)
const [bx, by] = await center('#btn-boost');
await tryBoost('BOOST tap', () => page.touchscreen.tap(bx, by));
await page.screenshot({ path: `${out}/87-autopilot-boost${tag}.png` });
await page.waitForFunction(() => window.__RAD_GAME__.world.boost.activeMs <= 0 && window.__RAD_GAME__.world.player.boostLevel < 0.05, { timeout: 5000 }); // ramped out → the 0.15 edge re-arms
await tryBoost('Shift key', () => page.keyboard.press('Shift'));
await page.waitForFunction(() => window.__RAD_GAME__.world.boost.activeMs <= 0 && window.__RAD_GAME__.world.player.boostLevel < 0.05, { timeout: 5000 });
await tryBoost('slide up from BRAKE', () => slide(0, -70));
const sources = await page.evaluate(() => window.__RAD_INPUT__.state.taps);
ok(sources.slideBoost >= 1 && sources.slideMissile >= 1 && sources.boost >= 1 && sources.missile >= 1, `input tallies ${JSON.stringify(sources)}`);
const stillAp = await W();
ok(stillAp.ap === 'autopilot', `still on autopilot after all presses (${Math.round(stillAp.apMs)} ms left) — steering stayed with the autopilot`);
// handback: wait for autopilot + handback to end, then steer by hand
await page.waitForFunction(() => { const pw = window.__RAD_GAME__.world.power; return !pw.active && !pw.handback; }, { timeout: 20000 });
const apl = await page.evaluate(() => window.__RAD_GAME__.world.power.apLog.at(-1));
const a0 = await page.evaluate(() => window.__RAD_GAME__.world.player.angle);
await page.keyboard.down('ArrowLeft'); await wait(350); await page.keyboard.up('ArrowLeft');
const a1 = await page.evaluate(() => window.__RAD_GAME__.world.player.angle);
ok(apl && apl.wall === 0 && apl.hbWall === 0, `autopilot with boosts: wall hits ${apl && apl.wall}, handback wall hits ${apl && apl.hbWall}, spdMax ${apl && Math.round(apl.spdMax)}, end speed ${apl && apl.endSpd}`);
ok(Math.abs(a1 - a0) > 0.05, `handback → player steering works (heading moved ${(a1 - a0).toFixed(2)} rad on ArrowLeft)`);
const mres = await page.evaluate(() => { const w = window.__RAD_GAME__.world; return { shots: w.missile.shots, hits: w.missile.hits, refused: w.missile.refused }; });
console.log(`  missiles fired during autopilot: ${mres.shots}, hits ${mres.hits}, refused (no car ahead) ${mres.refused}`);
ok(mres.shots >= 1 && mres.hits >= 1, `at least one autopilot missile launched and hit (${mres.hits}/${mres.shots})`);
const lv = await page.evaluate(() => window.__lv);
const tr = []; let next = 0; for (const [el, l, s] of lv) { if (el >= next && el < 3200) { tr.push(`${el}:${l.toFixed(2)}:${s}`); next = el + 50; } }
console.log('  boostLevel trace from autopilot start (el ms : boostLevel : speed), ~50 ms: ' + tr.join(' '));
const cross = lv.filter((x, i) => i && lv[i - 1][1] <= 0.15 && x[1] > 0.15).map((x) => x[0]);
console.log('  boostLevel 0.15 crossings at autopilot ms: ' + cross.join(', '));
ok(cross.length >= 3, `boostLevel crossed 0.15 on each of the 3 boosts (${cross.length})`);

// ---------------------------------------------------------------- 2. streak band
async function streakCheck(label, ms) {
  return page.evaluate((ms) => new Promise((res) => { const w = window.__RAD_GAME__.world, fx = w.fxState; const t1 = performance.now() + ms;
    const rects = [...document.querySelectorAll('#touch-controls .act, #aim-pad, #hud > .pill, #btn-pause')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
    let n = 0, bad = 0, outBand = 0, seen = new Set(); const H = innerHeight, Wd = innerWidth;
    const f = () => { for (const o of fx.parts) { if (o.k !== 'streak') continue; seen.add(o); const lk = (o.fade ?? 1) * o.a0; if (lk < 0.01) continue; const h = 160 * o.s0;
        for (const s of [-1, 1]) { const x = o.x + o.dx * h * s, y = o.y + o.dy * h * s; n++;
          if (rects.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) || x < 12 || x > Wd - 12) bad++;
          const c = fx.clear; if (c && (x < c.x0 - 0.5 || x > c.x1 + 0.5 || y < c.y0 - 0.5 || y > c.y1 + 0.5)) outBand++; } }
      if (performance.now() < t1) requestAnimationFrame(f); else res({ streaks: seen.size, tips: n, bad, outBand, clear: fx.clear && [fx.clear.x0, fx.clear.y0, fx.clear.x1, fx.clear.y1].map(Math.round) }); };
    requestAnimationFrame(f); }), ms);
}
async function streakShot(dirx, diry, name, vpTag) {
  for (let i = 0; i < 7; i++) { await page.evaluate((dx, dy) => { const w = window.__RAD_GAME__.world, p = w.player, t = w.track; let best = 0, bd = -2;
    t.pts.forEach((q, k) => { const d = q.tx * dx + q.ty * dy; if (d > bd) { bd = d; best = k; } }); const q = t.pts[best];
    if (window.__placed !== best) { window.__placed = best; p.x = q.x; p.y = q.y; }
    p.angle = Math.atan2(q.ty, q.tx); p.vx = q.tx * p.top; p.vy = q.ty * p.top; p.yawRate = 0; }, dirx, diry); await wait(60); }
  for (let k = 0; k < 12; k++) { // pause on a frame with a visible streak (they live 200–350 ms)
    if (await page.evaluate(() => { const fx = window.__RAD_GAME__.world.fxState; if (fx.parts.some((o) => o.k === 'streak' && (o.fade ?? 1) > 0.3 && o.ms < o.life * 0.6)) { window.__RAD_GAME__.setPaused(true); return true; } return false; })) break;
    await page.evaluate((dx, dy) => { const w = window.__RAD_GAME__.world, p = w.player, t = w.track; const q = t.pts[window.__placed]; p.angle = Math.atan2(q.ty, q.tx); p.vx = q.tx * p.top; p.vy = q.ty * p.top; }, dirx, diry); await wait(40);
  }
  await page.evaluate(() => window.__RAD_GAME__.setPaused(true));
  const st = await page.evaluate(() => { const w = window.__RAD_GAME__.world, fx = w.fxState, c = fx.clear; const sp = fx.parts.filter((o) => o.k === 'streak' && (o.fade ?? 1) > 0.01);
    return { n: sp.length, ys: sp.map((o) => Math.round(o.y)), align: sp.map((o) => +Math.abs(o.dx * w.player.vx + o.dy * w.player.vy) / Math.hypot(w.player.vx, w.player.vy)).map((a) => +a.toFixed(2)), clear: c && [c.x0, c.y0, c.x1, c.y1].map(Math.round) }; });
  await page.screenshot({ path: `${out}/87-streaks-${name}-${vpTag}${tag}.png` });
  await page.evaluate(() => { window.__placed = null; window.__RAD_GAME__.setPaused(false); });
  ok(st.n >= 1 && st.align.every((a) => a > 0.98), `streaks heading ${name} (${vpTag}): ${st.n} live, aligned ${st.align.join(',')}, y ${st.ys.join(',')} in clear ${JSON.stringify(st.clear)}`);
}
console.log('=== streak band · portrait');
await streakShot(1, 0, 'right', 'portrait'); await wait(300); await streakShot(-1, 0, 'left', 'portrait');
let sc = await streakCheck('portrait', 6000);
ok(sc.streaks > 0 && sc.bad === 0 && sc.outBand === 0, `portrait 6 s: ${sc.streaks} streaks, ${sc.tips} visible tips, ${sc.bad} on a button/HUD/side margin, ${sc.outBand} outside clear ${JSON.stringify(sc.clear)}`);
console.log('=== streak band · landscape 844×390');
await startRace({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true }, 0);
await wait(3000);
await streakShot(1, 0, 'right', 'landscape');
sc = await streakCheck('landscape', 6000);
ok(sc.streaks > 0 && sc.bad === 0 && sc.outBand === 0, `landscape 6 s: ${sc.streaks} streaks, ${sc.tips} visible tips, ${sc.bad} on a button/HUD/side margin, ${sc.outBand} outside clear ${JSON.stringify(sc.clear)}`);
ok(errs.length === 0, `0 console errors/warnings ${errs.length ? JSON.stringify(errs.slice(0, 3)) : ''}`);
console.log(fails ? `RESULT: FAIL (${fails})` : 'RESULT: PASS');
await browser.close();
