// v54.4 verification: HANDBRAKE button (label, gestures), a handbrake slide through Razor's hairpin (slip01 trace, skid
// marks, drift boost → toast + flame + boostLevel), MISSILE NO TARGET state (dimmed, tappable, denied blip, back to
// ready when a target appears, on autopilot), streaks clear of the minimap + toast pills.
//   node docs/verify-v544.mjs [url] [outdir] [canvas=0|1]
import puppeteer from 'puppeteer-core';
const [,, url = 'http://localhost:4173/', out = 'docs/shots', cv = '0'] = process.argv;
const tag = cv === '1' ? '-canvas' : '';
const u = url + (cv === '1' ? '?canvas=1' : '');
let fails = 0; const ok = (c, m) => { console.log(`  [${c ? 'ok' : 'FAIL'}] ${m}`); if (!c) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(); const errs = [];
page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(m.text()); });
await page.evaluateOnNewDocument(() => { self.__RAD_SFX_LOG__ = []; });
async function startRace(ti) {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(u, { waitUntil: 'networkidle2' }); await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle2' });
  await page.tap('[data-act=race]'); await page.waitForSelector('#tracks button'); await (await page.$$('#tracks button'))[ti].tap();
  await page.waitForFunction(() => window.__RAD_GAME__?.world?.race?.countdown <= 0, { timeout: 20000 });
}
const center = async (sel) => { const b = await (await page.$(sel)).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

// ---------------------------------------------------------------- 1. HANDBRAKE button + gestures
console.log(`=== handbrake · portrait · ${cv === '1' ? 'canvas' : 'pixi'}`);
await startRace(2);
const lbl = await page.evaluate(() => { const b = document.getElementById('btn-brake'), r = b.getBoundingClientRect(); return { text: b.querySelector('.act-label').textContent, aria: b.getAttribute('aria-label'), w: Math.round(r.width), x: Math.round(r.left), y: Math.round(r.top), lw: Math.round(b.querySelector('.act-label').getBoundingClientRect().width) }; });
ok(lbl.text === 'HANDBRAKE' && lbl.aria === 'HANDBRAKE' && lbl.w === 112 && lbl.lw < lbl.w, `button reads HANDBRAKE (label ${lbl.lw}px inside the ${lbl.w}px disc at ${lbl.x},${lbl.y} — same place / size as BRAKE)`);
await page.screenshot({ path: `${out}/88-handbrake-button${tag}.png` });
const [kx, ky] = await center('#btn-brake');
const slide = async (dx, dy) => { await page.touchscreen.touchStart(kx, ky); for (let i = 1; i <= 4; i++) { await page.touchscreen.touchMove(kx + dx * i / 4, ky + dy * i / 4); await wait(16); } await page.touchscreen.touchEnd(); };
const g0 = await page.evaluate(() => { const w = window.__RAD_GAME__.world; w.boost.charge = 1; w.missile.charge = 1; return { b: w.boost.uses + w.boost.freeUses, m: w.missile.shots + w.missile.refused }; });
await slide(0, -70); await wait(150); await slide(-70, 0); await wait(150);
const g1 = await page.evaluate(() => { const w = window.__RAD_GAME__.world; return { b: w.boost.uses + w.boost.freeUses, m: w.missile.shots + w.missile.refused, taps: window.__RAD_INPUT__.state.taps }; });
ok(g1.b > g0.b && g1.m > g0.m, `slide up from HANDBRAKE boosts, slide left fires (${JSON.stringify(g1.taps)})`);

// ---------------------------------------------------------------- 2. handbrake slide + drift boost (keyboard bot)
await page.evaluate(async () => {
  const { pointAt, indexAt } = await import('./js/tracks.js'); const PH = await import('./js/physics.js');
  const g = window.__RAD_GAME__, w = g.world, p = w.player, t = w.track;
  const keys = new Set(); const set = (k, v) => { if (v !== keys.has(k)) { v ? keys.add(k) : keys.delete(k); window.dispatchEvent(new KeyboardEvent(v ? 'keydown' : 'keyup', { key: k })); } };
  window.__tr = []; let hb = false, hbMs = 0, shot1 = false;
  setInterval(() => {
    const spd = Math.hypot(p.vx, p.vy), tp = pointAt(t, p.sPrev + 140 + spd * 0.3);
    let e = Math.atan2(tp.y - p.y, tp.x - p.x) - (spd > 50 ? Math.atan2(p.vy, p.vx) : p.angle); while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
    let en = Math.atan2(tp.y - p.y, tp.x - p.x) - p.angle; while (en > Math.PI) en -= 2 * Math.PI; while (en < -Math.PI) en += 2 * Math.PI;
    let minR = 1e9; for (let d = 0; d <= 380; d += 40) minR = Math.min(minR, t.pts[indexAt(t, p.sPrev + d)].radius);
    if (!hb && minR < 380 && spd > 700 && Math.abs(e) > 0.15) { hb = true; hbMs = 0; }
    if (hb) { hbMs += 30; if (Math.abs(en) < 0.3 || hbMs > 400 || spd < 420) hb = false; }
    set('ArrowRight', e > 0.06); set('ArrowLeft', e < -0.06); set('ArrowDown', hb);
  }, 30);
  const f = () => { const s = PH.slip01(p); window.__tr.push([Math.round(w.race.time), +s.toFixed(2), p.hbHeld ? 1 : 0, Math.round(Math.hypot(p.vx, p.vy)), +(p.boostLevel || 0).toFixed(2)]);
    if (!shot1 && s > 0.8 && p.driftRun && p.driftRun.hb && p.driftRun.ms > 250) { shot1 = true; g.setPaused(true); window.__slideShot = true; }
    if (!window.__dbShot && w.driftFlash && w.race.time - w.driftFlash.t > 200 && p.boostLevel > 0.4) { window.__dbShot = true; g.setPaused(true); window.__dbReady = true; }
    requestAnimationFrame(f); }; requestAnimationFrame(f);
});
await page.waitForFunction(() => window.__slideShot, { timeout: 40000 }).catch(() => {});
const sl = await page.evaluate(() => ({ ok: !!window.__slideShot, stamps: window.__RAD_GAME__.world.fxState.stats.stamps, smoke: window.__RAD_GAME__.world.fxState.stats.smoke }));
await page.screenshot({ path: `${out}/88-handbrake-slide${tag}.png` });
ok(sl.ok && sl.stamps > 30, `handbrake slide caught (slip01 > 0.8, ${sl.stamps} skid stamps, ${sl.smoke} smoke)`);
await page.evaluate(() => window.__RAD_GAME__.setPaused(false));
await page.waitForFunction(() => window.__dbReady, { timeout: 30000 }).catch(() => {});
const db = await page.evaluate(() => { const w = window.__RAD_GAME__.world, t = document.getElementById('tc-toast'); return { ok: !!window.__dbReady, flash: w.driftFlash, lvl: w.player.boostLevel, toast: t && !t.classList.contains('hidden') ? t.textContent.trim() : null, toastLog: (self.__RAD_TOASTS__ || []).map((x) => x.text).filter((x) => /DRIFT/.test(x)), log: w.driftLog.slice(-6), sfx: self.__RAD_SFX_LOG__.filter((n) => n === 'driftBoost' || n === 'handbrake').length, boosts: w.fxState.stats.boosts }; });
await page.screenshot({ path: `${out}/88-drift-boost${tag}.png` });
ok(db.ok && db.flash && db.lvl > 0.4 && (/DRIFT/.test(db.toast || '') || db.toastLog.length > 0), `drift boost: toast "${db.toast}" (log ${JSON.stringify(db.toastLog)}) q ${db.flash && db.flash.q.toFixed(2)}, boostLevel ${db.lvl.toFixed(2)}, sfx handbrake/driftBoost ${db.sfx}, recent drifts ${JSON.stringify(db.log)}`);
await page.evaluate(() => window.__RAD_GAME__.setPaused(false));
await wait(6000);
const tr = await page.evaluate(() => window.__tr);
const i0 = tr.findIndex((x, k) => k > 30 && x[2]); let j = i0; while (j < tr.length && !(tr[j][1] < 0.15 && !tr[j][2] && j > i0 + 6)) j++;
const seg = tr.slice(Math.max(0, i0 - 6), j + 12), out50 = []; let nx = -1e9; for (const x of seg) if (x[0] >= nx) { out50.push(`${x[0] - tr[i0][0]}:${x[1].toFixed(2)}${x[2] ? 'H' : ''}:${x[3]}:b${x[4]}`); nx = x[0] + 50; }
const vals = seg.map((x) => x[1]).filter((v) => v > 0).sort((a, b) => a - b);
console.log(`  slip01 through the first handbrake corner (ms from press : slip01[H=held] : speed : boostLevel), ~50 ms; peak ${vals.at(-1)} median ${vals[vals.length >> 1]}: ${out50.join(' ')}`);

// ---------------------------------------------------------------- 3. MISSILE NO TARGET
console.log('=== missile NO TARGET');
await startRace(0);
await page.evaluate(() => { const w = window.__RAD_GAME__.world, p = w.player; for (const c of w.cars) if (c !== p) c.dist -= 1500; w.missile.charge = 1; }); // player now leads
await wait(300);
const nt = await page.evaluate(() => { const e = document.getElementById('btn-missile'), cs = getComputedStyle(e), v = getComputedStyle(e.querySelector('.act-vis')); return { state: e.dataset.state, label: e.querySelector('.act-label').textContent, pe: cs.pointerEvents, op: cs.opacity, filter: v.filter, disabled: e.disabled || e.classList.contains('disabled') }; });
await page.screenshot({ path: `${out}/88-missile-no-target${tag}.png` });
ok(nt.state === 'notarget' && nt.label === 'NO TARGET' && !nt.disabled && nt.pe !== 'none' && nt.filter !== 'none', `no car ahead → MISSILE "${nt.label}" dimmed (${nt.filter}), not disabled (pointer-events ${nt.pe}, opacity ${nt.op})`);
const [mx, my] = await center('#btn-missile');
const d0 = await page.evaluate(() => ({ r: window.__RAD_GAME__.world.missile.refused, s: self.__RAD_SFX_LOG__.filter((n) => n === 'denied').length }));
await page.touchscreen.tap(mx, my); await wait(150);
const d1 = await page.evaluate(() => ({ r: window.__RAD_GAME__.world.missile.refused, s: self.__RAD_SFX_LOG__.filter((n) => n === 'denied').length, charge: window.__RAD_GAME__.world.missile.charge }));
ok(d1.r === d0.r + 1 && d1.s === d0.s + 1 && d1.charge === 1, `tap in NO TARGET → refused, sfx('denied') ×${d1.s - d0.s}, charge kept`);
// autopilot on, then a rival appears ahead → ready at once
await page.evaluate(() => { const G = window.__RAD_GAME__; G.debug.give('autopilot'); G.debug.activate(); });
await page.waitForFunction(() => window.__RAD_GAME__.world.power.active === 'autopilot', { timeout: 5000 });
const stAp = await page.evaluate(() => document.getElementById('btn-missile').dataset.state);
await page.evaluate(async () => { const { pointAt } = await import('./js/tracks.js'); const PH = await import('./js/physics.js'); const w = window.__RAD_GAME__.world, p = w.player, t = w.track;
  const r = w.cars.find((c) => c !== p); const q = pointAt(t, p.sPrev + 320); r.x = q.x; r.y = q.y; r.angle = Math.atan2(q.ty, q.tx); r.vx = Math.cos(r.angle) * 600; r.vy = Math.sin(r.angle) * 600; r.seg = -1; PH.initCarOnTrack(r, t, p.dist + 320); window.__tgAt = performance.now(); });
await page.waitForFunction(() => document.getElementById('btn-missile').dataset.state === 'ready', { timeout: 3000 }).catch(() => {});
const back = await page.evaluate(() => ({ st: document.getElementById('btn-missile').dataset.state, label: document.getElementById('btn-missile').querySelector('.act-label').textContent, ms: Math.round(performance.now() - window.__tgAt), ap: window.__RAD_GAME__.world.power.active }));
ok(stAp === 'notarget' && back.st === 'ready' && back.label === 'MISSILE' && back.ap === 'autopilot', `on autopilot: ${stAp} → ${back.st} "${back.label}" ${back.ms} ms after a car appears ahead`);
await page.screenshot({ path: `${out}/88-missile-ready-autopilot${tag}.png` });

// ---------------------------------------------------------------- 4. streaks clear of minimap + toasts
console.log('=== streaks vs minimap / toasts');
await page.evaluate(async () => { const C = await import('./js/controls.js'); window.__toastT = setInterval(() => C.toast('DRIFT BOOST', 'boost', '#b8ff00'), 1200); C.toast('DRIFT BOOST', 'boost', '#b8ff00'); });
const sc = await page.evaluate(() => new Promise((res) => { const w = window.__RAD_GAME__.world, fx = w.fxState; const t1 = performance.now() + 7000; let tips = 0, inMini = 0, inToast = 0, n = new Set(), toastSeen = 0;
  const f = async () => { const C = await import('./js/controls.js'); const lay = C.getLayout(), m = lay && lay.minimap; const te = document.getElementById('tc-toast'); const tr = te && !te.classList.contains('hidden') ? te.getBoundingClientRect() : null; if (tr && tr.width) toastSeen++;
    for (const o of fx.parts) { if (o.k !== 'streak') continue; n.add(o); if ((o.fade ?? 1) * o.a0 < 0.01) continue; const h = 160 * o.s0;
      for (const k of [-1, -0.5, 0, 0.5, 1]) { const x = o.x + o.dx * h * k, y = o.y + o.dy * h * k; tips++;
        if (m && x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h) inMini++;
        if (tr && tr.width && x >= tr.left && x <= tr.right && y >= tr.top && y <= tr.bottom) inToast++; } }
    if (performance.now() < t1) requestAnimationFrame(f); else res({ streaks: n.size, tips, inMini, inToast, toastSeen, obs: (fx.clear && fx.clear.obs || []).map((r) => [r.l, r.t, r.r, r.b].map(Math.round)) }); };
  requestAnimationFrame(f); }));
await page.evaluate(() => clearInterval(window.__toastT));
ok(sc.streaks > 0 && sc.toastSeen > 0 && sc.inMini === 0 && sc.inToast === 0, `7 s with toasts up: ${sc.streaks} streaks, ${sc.tips} visible points, ${sc.inMini} on the minimap, ${sc.inToast} on a toast (obstacles ${JSON.stringify(sc.obs)})`);
ok(errs.length === 0, `0 console errors/warnings ${errs.length ? JSON.stringify(errs.slice(0, 3)) : ''}`);
console.log(fails ? `RESULT: FAIL (${fails})` : 'RESULT: PASS');
await browser.close();
