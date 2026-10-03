// v54.2 'drift' checks at 390×844 DPR 3: Options toggle (persisted), a race with drift ON from the saved option
// (slip01 trace + cornering skid marks), speed streaks heading right and heading up. Shots: docs/shots/86-*.
//   node docs/verify-v542.mjs [url] [outdir] [track=2] [canvas=0|1]
import puppeteer from 'puppeteer-core';
const [,, url = 'http://localhost:4173/', out = 'docs/shots', ti = '2', cv = '0'] = process.argv;
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(); const errs = []; let fails = 0;
const ok = (c, m) => { console.log(`  [${c ? 'ok' : 'FAIL'}] ${m}`); if (!c) fails++; };
page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
const tag = cv === '1' ? '-canvas' : '';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const u = url + (cv === '1' ? '?canvas=1' : '');
// ---- Options (landscape first: Back must stay on screen with the extra row)
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(u, { waitUntil: 'networkidle2' }); await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle2' });
await page.tap('[data-act=options]'); await page.waitForSelector('#drift');
const land = await page.evaluate(() => { const b = document.querySelector('.options-screen [data-act=back]') || document.querySelector('[data-act=back]'); const r = b.getBoundingClientRect(), d = document.querySelector('#drift').getBoundingClientRect(); return { back: [Math.round(r.top), Math.round(r.bottom)], drift: [Math.round(d.top), Math.round(d.bottom)], vh: innerHeight }; });
if (!tag) await page.screenshot({ path: `${out}/86-options-landscape.png` });
ok(land.back[1] <= land.vh && land.back[0] >= 0, `landscape 844×390: Back on screen ${JSON.stringify(land)}`);
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await wait(300);
const off = await page.evaluate(() => document.querySelector('#drift').textContent.trim());
ok(off === 'Off', `Drift handling defaults to Off (${off})`);
await page.tap('#drift'); await wait(200);
const on = await page.evaluate(() => ({ txt: document.querySelector('#drift').textContent.trim(), saved: JSON.parse(localStorage.getItem('radcars_core_v1')).options.drift }));
if (!tag) await page.screenshot({ path: `${out}/86-options-drift-on.png` });
ok(on.txt === 'On' && on.saved === true, `toggle → On, persisted ${JSON.stringify(on)}`);
await page.reload({ waitUntil: 'networkidle2' }); // persisted across a reload
await page.tap('[data-act=options]'); await page.waitForSelector('#drift');
ok(await page.evaluate(() => document.querySelector('#drift').textContent.trim()) === 'On', 'still On after reload');
await page.tap('[data-act=back]'); await wait(200);
// ---- race with drift from the saved option
await page.tap('[data-act=race]'); await page.waitForSelector('#tracks button'); await (await page.$$('#tracks button'))[+ti].tap();
await page.waitForFunction(() => window.__RAD_GAME__?.world?.race?.countdown <= 0, { timeout: 15000 });
ok(await page.evaluate(() => window.__RAD_GAME__.world.player.driftOn === true), 'player.driftOn from the saved option');
await page.evaluate(async () => {
  const { pointAt, indexAt } = await import('./js/tracks.js'); const PH = await import('./js/physics.js');
  const g = window.__RAD_GAME__, w = g.world, p = w.player, t = w.track; let minI = 0; t.pts.forEach((q, i) => { if (q.radius < t.pts[minI].radius) minI = i; });
  const apexS = t.pts[minI].s; window.__trace = []; window.__apexR = Math.round(t.pts[minI].radius);
  const keys = new Set(); const set = (k, v) => { if (v !== keys.has(k)) { v ? keys.add(k) : keys.delete(k); window.dispatchEvent(new KeyboardEvent(v ? 'keydown' : 'keyup', { key: k })); } };
  const corner = (R, top) => { const ww = PH.MAX_TURN * 0.9; return Math.min(top, (ww * R) / (1 + (ww * R * 0.35) / top)); };
  setInterval(() => { // velocity-aware key bot with AI-style braking
    const spd = Math.hypot(p.vx, p.vy), tp = pointAt(t, p.sPrev + 120 + spd * 0.25);
    let e = Math.atan2(tp.y - p.y, tp.x - p.x) - (spd > 50 ? Math.atan2(p.vy, p.vx) : p.angle); while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
    let target = 1e9; for (let d = 0; d <= 800; d += 80) { const vc = corner(t.pts[indexAt(t, p.sPrev + d)].radius, p.top); target = Math.min(target, Math.sqrt(vc * vc + 2 * PH.BRAKE * 0.5 * d)); }
    set('ArrowRight', e > 0.06); set('ArrowLeft', e < -0.06); set('ArrowDown', spd > target + 60);
  }, 30);
  let run = 0, shot = false;
  const f = () => { const rel = ((p.sPrev - apexS + t.length * 1.5) % t.length) - t.length / 2, s01 = PH.slip01(p);
    window.__trace.push({ t: Math.round(w.race.time), rel: Math.round(rel), spd: Math.round(Math.hypot(p.vx, p.vy)), s: +s01.toFixed(3) });
    run = s01 > 0.3 ? run + 1 : 0;
    if (!shot && run >= 24 && Math.abs(rel) < 400) { shot = true; g.setPaused(true); window.__shotReady = true; }
    requestAnimationFrame(f); }; requestAnimationFrame(f);
});
await page.waitForFunction(() => window.__shotReady, { timeout: 40000 }).catch(() => {});
const sk = await page.evaluate(() => ({ ready: !!window.__shotReady, stamps: window.__RAD_GAME__.world.fxState.stats.stamps, smoke: window.__RAD_GAME__.world.fxState.stats.smoke }));
await page.screenshot({ path: `${out}/86-drift-corner${tag}.png` });
ok(sk.ready && sk.stamps > 30, `cornering slide caught mid-corner (slip01 > 0.3 for 24 frames): skid stamps ${sk.stamps}, smoke ${sk.smoke}`);
await page.evaluate(() => window.__RAD_GAME__.setPaused(false));
await wait(14000);
const tr = await page.evaluate(() => ({ R: window.__apexR, tr: window.__trace }));
const passes = []; let cur = null; for (const x of tr.tr) { if (Math.abs(x.rel) < 450) { (cur = cur || []).push(x); } else if (cur) { passes.push(cur); cur = null; } }
for (const ps of passes.slice(0, 2)) { const S = ps.map((x) => x.s).sort((a, b) => a - b), mid = ps.filter((x) => Math.abs(x.rel) < 150).map((x) => x.s).sort((a, b) => a - b);
  console.log(`trace R${tr.R} pass: peak ${S.at(-1)} median ${S[S.length >> 1]} mid-corner median ${mid[mid.length >> 1] ?? '-'} | every ~50 ms (rel wu : speed : slip01): ` + ps.filter((_, i) => i % 3 === 0).map((x) => `${x.rel}:${x.spd}:${x.s.toFixed(2)}`).join(' ')); }
// ---- streaks: heading right, heading up (a track point whose tangent matches, held at top speed)
async function streakShot(dirx, diry, name) {
  for (let i = 0; i < 7; i++) { await page.evaluate((dx, dy) => { const w = window.__RAD_GAME__.world, p = w.player, t = w.track; let best = 0, bd = -2;
    t.pts.forEach((q, k) => { const d = q.tx * dx + q.ty * dy; if (d > bd) { bd = d; best = k; } }); const q = t.pts[best];
    if (!window.__placed || window.__placed !== best) { window.__placed = best; p.x = q.x; p.y = q.y; } else { const s = Math.hypot(p.vx, p.vy); void s; }
    p.angle = Math.atan2(q.ty, q.tx); p.vx = q.tx * p.top; p.vy = q.ty * p.top; p.yawRate = 0; }, dirx, diry); await wait(60); }
  await page.evaluate(() => window.__RAD_GAME__.setPaused(true));
  const st = await page.evaluate(() => { const w = window.__RAD_GAME__.world, p = w.player; const sp = w.fxState.parts.filter((o) => o.k === 'streak'); const dx = p.vx / Math.hypot(p.vx, p.vy), dy = p.vy / Math.hypot(p.vx, p.vy);
    return { phase: w.race.phase, fin: !!p.finished, spd: Math.round(Math.hypot(p.vx, p.vy)), paused: !!w.paused, n: sp.length, dir: [+dx.toFixed(2), +dy.toFixed(2)], align: sp.map((o) => +(Math.abs((o.dx ?? 0) * dx + (o.dy ?? -1) * dy)).toFixed(2)) }; });
  await page.screenshot({ path: `${out}/86-streaks-${name}${tag}.png` });
  await page.evaluate(() => { window.__placed = null; window.__RAD_GAME__.setPaused(false); });
  console.log(name, JSON.stringify(st));
  ok(st.n >= 1 && st.align.every((a) => a > 0.98), `streaks heading ${name}: ${st.n} live, aligned with travel ${st.dir}`);
}
await streakShot(1, 0, 'right'); await wait(300); await streakShot(0, -1, 'up');
ok(errs.length === 0, `0 console errors/warnings ${errs.length ? JSON.stringify(errs.slice(0, 3)) : ''}`);
console.log(fails ? `RESULT: FAIL (${fails})` : 'RESULT: PASS');
await browser.close();
