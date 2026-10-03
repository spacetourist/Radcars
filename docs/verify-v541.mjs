// v54.1 'feel polish' checks at 390×844 DPR 3: real wall hits (light + heavy) via a lateral placement next to the wall,
// a forced slide (skid arc), boost (ring + ghosts) and top-speed streaks. Each moment is frozen with setPaused(true)
// (the renderer keeps drawing the frozen FX state) and shot as docs/shots/83-*. Usage:
//   node docs/verify-v541.mjs [url] [outdir] [track] [canvas=0|1]
import puppeteer from 'puppeteer-core';
const [,, url = 'http://localhost:4173/', out = 'docs/shots', ti = '0', cv = '0'] = process.argv;
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage(); const errs = []; let fails = 0;
const ok = (c, m) => { console.log(`  [${c ? 'ok' : 'FAIL'}] ${m}`); if (!c) fails++; };
page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const u = url + (cv === '1' ? (url.includes('?') ? '&' : '?') + 'canvas=1' : '');
await page.goto(u, { waitUntil: 'networkidle2' });
await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'networkidle2' });
await page.tap('[data-act=race]'); await page.waitForSelector('#tracks button'); await (await page.$$('#tracks button'))[+ti].tap();
await page.waitForFunction(() => window.__RAD_GAME__?.world?.race?.countdown <= 0, { timeout: 15000 });
const tag = cv === '1' ? '-canvas' : '';
const shot = (n) => page.screenshot({ path: `${out}/85-${n}${tag}.png` });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await page.evaluate(async () => { window.__T = await import('./js/tracks.js'); window.__PH = await import('./js/physics.js'); });
// labels: small discs ≥ 9 CSS px
const labels = await page.evaluate(() => [...document.querySelectorAll('.act .act-label')].map((l) => ({ act: l.closest('.act').className, text: l.textContent.trim(), px: parseFloat(getComputedStyle(l).fontSize), vis: l.offsetParent !== null })));
console.log('labels', JSON.stringify(labels));
ok(labels.filter((l) => l.vis && !/act-brake/.test(l.act)).every((l) => l.px >= 9), 'small-disc labels ≥ 9 CSS px');


const place = (deg, spd, lat = null, ahead = 40) => page.evaluate((deg, spd, lat, ahead) => {
  const w = window.__RAD_GAME__.world, p = w.player, t = w.track, pr = window.__T.pointAt(t, p.sPrev + ahead);
  const L = lat == null ? t.halfW - 38 : lat; p.x = pr.x + pr.nx * L; p.y = pr.y + pr.ny * L;
  const r = deg * Math.PI / 180, hx = pr.tx * Math.cos(r) + pr.nx * Math.sin(r), hy = pr.ty * Math.cos(r) + pr.ny * Math.sin(r);
  p.angle = Math.atan2(hy, hx); p.vx = hx * spd; p.vy = hy * spd; p.yawRate = 0;
}, deg, spd, lat, ahead);
const pause = (v) => page.evaluate((v) => window.__RAD_GAME__.setPaused(v), v);

// 1. heavy wall hit: 8–10 sparks, 36–48 CSS px, fanned
const n0 = await page.evaluate(() => window.__RAD_GAME__.world.wallLog.length);
await place(65, 950);
await page.waitForFunction((n) => window.__RAD_GAME__.world.wallLog.length > n, { timeout: 3000, polling: 'raf' }, n0).catch(() => {});
await wait(30); await pause(true);
const heavy = await page.evaluate(() => { const w = window.__RAD_GAME__.world, sp = w.fxState.parts.filter((o) => o.k === 'spark');
  const rots = sp.map((o) => o.rot), spread = rots.length ? (Math.max(...rots) - Math.min(...rots)) * 180 / Math.PI : 0;
  return { hit: w.wallLog.at(-1), n: sp.length, len: sp.map((o) => Math.round(o.lenPx)), spreadDeg: Math.round(spread) }; });
await shot('heavy-hit'); await pause(false);
console.log('heavy', JSON.stringify(heavy));
ok(heavy.n >= 8 && heavy.n <= 10, `heavy: ${heavy.n} sparks (8–10)`);
ok(heavy.len.every((l) => l >= 36 && l <= 48), `heavy: spark lengths ${heavy.len.join(',')} CSS px (36–48)`);
ok(heavy.spreadDeg >= 60, `heavy: fanned over ${heavy.spreadDeg}°`);
await wait(700);

// 2. skid at speed: a slide at ~950 wu/s on a straight leaves one continuous mark per tyre
await place(0, 950, 0, 20);
const st0 = await page.evaluate(() => window.__RAD_GAME__.world.fxState.stats.stamps);
await page.keyboard.down('ArrowUp');
for (let i = 0; i < 4; i++) { await page.evaluate(() => { const p = window.__RAD_GAME__.world.player, s = Math.hypot(p.vx, p.vy), va = p.angle - 0.5; p.vx = Math.cos(va) * s; p.vy = Math.sin(va) * s; }); await page.keyboard.down('ArrowLeft'); await wait(90); }
await pause(true);
const skid = await page.evaluate((st0) => { const w = window.__RAD_GAME__.world, fx = w.fxState; return { stamps: fx.stats.stamps - st0, spd: Math.round(Math.hypot(w.player.vx, w.player.vy)), tiles: fx.skid.tiles.size }; }, st0);
await shot('skid-speed'); await page.keyboard.up('ArrowLeft'); await pause(false);
console.log('skid', JSON.stringify(skid));
ok(skid.stamps > 60, `skid at speed: ${skid.stamps} stamps (path-interpolated), ${skid.tiles} tiles`);
await wait(500);

// 3. boost shockwave early + late, then gone; zoom punch curve
await place(0, 600, 0, 20);
await page.evaluate(() => { window.__RAD_GAME__.world.boost.charge = 1; });
const b0 = await page.evaluate(() => window.__RAD_GAME__.world.fxState.stats.boosts);
// freeze on the very frame the shockwave spawns (rAF watcher runs right after the game's own frame)
await page.evaluate((n) => { const g = window.__RAD_GAME__; const f = () => { const fx = g.world.fxState; if (fx.parts.some((o) => o.k === 'ring' && o.boost && o.carId === g.world.player.id)) g.setPaused(true); else requestAnimationFrame(f); }; requestAnimationFrame(f); }, b0);
await page.keyboard.press('Shift');
await page.waitForFunction(() => window.__RAD_GAME__.world.fxState.parts.some((o) => o.k === 'ring' && o.boost && o.carId === window.__RAD_GAME__.world.player.id), { timeout: 3000, polling: 'raf' }).catch(() => {});
await wait(50);
const ringAt = () => page.evaluate(() => { const w = window.__RAD_GAME__.world, fx = w.fxState, r = fx.parts.filter((o) => o.k === 'ring' && o.boost && o.carId === w.player.id); const p = w.player;
  return r.map((o) => ({ ms: Math.round(o.ms), scale: +(o.s0 + (o.s1 - o.s0) * o.ms / o.life).toFixed(2), alpha: +(o.a0 * (1 - o.ms / o.life)).toFixed(2), distFromCar: Math.round(Math.hypot(o.x - p.x, o.y - p.y)) })); });
const early = await ringAt(); await shot('boost-early'); await pause(false);
await page.waitForFunction(() => window.__RAD_GAME__.world.fxState.parts.some((o) => o.k === 'ring' && o.boost && o.carId === window.__RAD_GAME__.world.player.id && o.ms >= 170), { timeout: 2000, polling: 'raf' }).catch(() => {});
await pause(true); const late = await ringAt(); await shot('boost-late'); await pause(false);
const curve = await page.evaluate(async () => { const { zoomPunch } = await import('./js/fx.js'); const w = window.__RAD_GAME__.world, fx = w.fxState, out = [];
  await new Promise((res) => { const t0 = performance.now(); const f = () => { out.push({ el: Math.round(w.race.time - fx.punchAt), mul: +zoomPunch(fx, w.race.time, w.player.boostLevel || 0).toFixed(3), rings: fx.parts.filter((o) => o.k === 'ring' && o.boost && o.carId === w.player.id).length }); if (performance.now() - t0 < 700) requestAnimationFrame(f); else res(); }; f(); });
  return out; });
console.log('ring early', JSON.stringify(early), 'late', JSON.stringify(late));
console.log('punch', JSON.stringify(curve.filter((_, i) => i % 6 === 0)));
ok(early.length === 1 && early[0].scale <= 0.45, `boost ring early: ${early.length} ring, scale ${early[0]?.scale}`);
ok(late.length === 1 && late[0].scale >= 1.0 && late[0].alpha <= 0.35, `boost ring late: scale ${late[0]?.scale}, alpha ${late[0]?.alpha}`);
ok(curve.filter((c) => c.el >= 300).every((c) => c.rings === 0), `player boost ring gone after 300 ms (no shield): ${curve.filter((c) => c.el >= 300).length} frames checked`);
const after = curve.filter((c) => c.el >= 700);
ok(curve.some((c) => c.el >= 200 && c.el < 600 && c.mul < 0.95) && (!after.length || after.every((c) => c.mul >= 0.965)), `zoom punch eases back to the ~3 % hold (${after.length ? after.at(-1).mul : 'n/a'})`);

// 4. flame (full boost)
await wait(150); await pause(true);
const fl = await page.evaluate(() => ({ lvl: window.__RAD_GAME__.world.player.boostLevel }));
await shot('flame'); await pause(false); await page.keyboard.up('ArrowUp');
ok(fl.lvl > 0.5, `flame shot at boostLevel ${fl.lvl.toFixed(2)}`);
ok(errs.length === 0, `0 console errors/warnings ${errs.length ? JSON.stringify(errs.slice(0, 3)) : ''}`);
console.log(fails ? `RESULT: FAIL (${fails})` : 'RESULT: PASS');
await browser.close();
