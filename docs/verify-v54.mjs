// v54 'feel' checks at 390×844 DPR 3: real wall hits (light + heavy) via a lateral placement next to the wall,
// a forced slide (skid arc), boost (ring + ghosts) and top-speed streaks. Each moment is frozen with setPaused(true)
// (the renderer keeps drawing the frozen FX state) and shot as docs/shots/83-*. Usage:
//   node docs/verify-v54.mjs [url] [outdir] [track] [canvas=0|1]
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await page.evaluate(async () => { window.__T = await import('./js/tracks.js'); window.__PH = await import('./js/physics.js'); });
// labels: small discs ≥ 9 CSS px
const labels = await page.evaluate(() => [...document.querySelectorAll('.act .act-label')].map((l) => ({ act: l.closest('.act').className, text: l.textContent.trim(), px: parseFloat(getComputedStyle(l).fontSize), vis: l.offsetParent !== null })));
console.log('labels', JSON.stringify(labels));
ok(labels.filter((l) => l.vis && !/act-brake/.test(l.act)).every((l) => l.px >= 9), 'small-disc labels ≥ 9 CSS px');

// place the player against the wall: same progress s, lat just inside the limit, heading `deg` into the wall
async function wallShot(deg, spd, name) {
  const before = await page.evaluate(() => window.__RAD_GAME__.world.wallLog.length);
  await page.evaluate((deg, spd) => {
    const w = window.__RAD_GAME__.world, p = w.player, t = w.track, pr = window.__T.pointAt(t, p.sPrev + 40), side = 1;
    const lat = (t.halfW - 38) * side; p.x = pr.x + pr.nx * lat; p.y = pr.y + pr.ny * lat;
    const ta = Math.atan2(pr.ty, pr.tx), a = ta + side * deg * Math.PI / 180 * (Math.sign(pr.nx * -pr.ty + pr.ny * pr.tx) || 1);
    // heading toward +n: rotate tangent toward the normal
    const hx = pr.tx * Math.cos(deg * Math.PI / 180) + pr.nx * Math.sin(deg * Math.PI / 180), hy = pr.ty * Math.cos(deg * Math.PI / 180) + pr.ny * Math.sin(deg * Math.PI / 180);
    p.angle = Math.atan2(hy, hx); p.vx = hx * spd; p.vy = hy * spd; p.yawRate = 0;
  }, deg, spd);
  await page.waitForFunction((n) => window.__RAD_GAME__.world.wallLog.length > n, { timeout: 3000, polling: 'raf' }, before).catch(() => {});
  await wait(45);
  await page.evaluate(() => window.__RAD_GAME__.setPaused(true));
  const st = await page.evaluate(() => { const w = window.__RAD_GAME__.world, fx = w.fxState; return { hit: w.wallLog.at(-1), parts: fx.parts.map((o) => o.k), shake: fx.shake.amp, stats: { ...fx.stats } }; });
  await page.screenshot({ path: `${out}/83-${name}${tag}.png` });
  await page.evaluate(() => window.__RAD_GAME__.setPaused(false));
  return st;
}
const light = await wallShot(22, 800, 'wall-light');
console.log('light', JSON.stringify(light));
ok(light.hit && light.hit.vn > 200 && light.hit.vn < 620, `light hit vn ${light.hit?.vn} in 200–620`);
const nSp = (s) => s.parts.filter((k) => k === 'spark').length;
ok(nSp(light) >= 2 && nSp(light) <= 3 && !light.parts.includes('ring'), `light: ${nSp(light)} sparks, no ring`);
ok(light.stats.vibrate === 0, 'light: no vibrate');
await wait(600);
const heavy = await wallShot(65, 950, 'wall-heavy');
console.log('heavy', JSON.stringify(heavy));
ok(heavy.hit && heavy.hit.vn >= 620, `heavy hit vn ${heavy.hit?.vn} ≥ 620`);
ok(nSp(heavy) >= 6 && heavy.parts.includes('ring') && heavy.stats.heavy === 1, `heavy: ${nSp(heavy)} sparks + ring (+120 ms glow)`);
ok(heavy.shake > 0 && heavy.shake <= 4, `heavy: shake amp ${heavy.shake?.toFixed?.(2)} px (≤ 4)`);
await wait(700);

// skid arc: kick the velocity 0.6 rad off the heading a few times while steering hard
await page.evaluate(() => { const w = window.__RAD_GAME__.world, p = w.player, pr = window.__T.pointAt(w.track, p.sPrev); p.x = pr.x; p.y = pr.y; p.angle = Math.atan2(pr.ty, pr.tx); p.vx = pr.tx * 700; p.vy = pr.ty * 700; });
await page.keyboard.down('ArrowUp');
for (let i = 0; i < 5; i++) { await page.evaluate(() => { const p = window.__RAD_GAME__.world.player, s = Math.hypot(p.vx, p.vy), va = p.angle - 0.55; p.vx = Math.cos(va) * s; p.vy = Math.sin(va) * s; }); await page.keyboard.down('ArrowLeft'); await wait(110); }
await page.evaluate(() => window.__RAD_GAME__.setPaused(true));
const skid = await page.evaluate(() => { const fx = window.__RAD_GAME__.world.fxState; return { tiles: fx.skid.tiles.size, stamps: fx.stats.stamps, smoke: fx.parts.filter((o) => o.k === 'smoke').length, q: fx.quality }; });
await page.screenshot({ path: `${out}/83-skid-arc${tag}.png` });
await page.keyboard.up('ArrowLeft');
await page.evaluate(() => window.__RAD_GAME__.setPaused(false));
console.log('skid', JSON.stringify(skid));
ok(skid.stamps > 10 && skid.tiles > 0, `skid: ${skid.stamps} stamps in ${skid.tiles} tile(s), smoke ${skid.smoke}, quality ${skid.q}`);

// boost: Shift with a full charge → boost event at boostLevel 0.15 → cyan ring + ghosts
await wait(500);
await page.evaluate(() => { const w = window.__RAD_GAME__.world, p = w.player, pr = window.__T.pointAt(w.track, p.sPrev); p.x = pr.x; p.y = pr.y; p.angle = Math.atan2(pr.ty, pr.tx); p.vx = pr.tx * 600; p.vy = pr.ty * 600; w.boost.charge = 1; });
const b0 = await page.evaluate(() => window.__RAD_GAME__.world.fxState.stats.boosts);
await page.keyboard.press('Shift');
await page.waitForFunction((n) => window.__RAD_GAME__.world.fxState.stats.boosts > n, { timeout: 3000, polling: 'raf' }, b0).catch(() => {});
await page.waitForFunction(() => (window.__RAD_GAME__.world.fxState.ghosts.get(window.__RAD_GAME__.world.player)?.pts.length || 0) >= 3, { timeout: 2000, polling: 'raf' }).catch(() => {});
await page.evaluate(() => window.__RAD_GAME__.setPaused(true));
const boost = await page.evaluate(() => { const w = window.__RAD_GAME__.world, fx = w.fxState; return { lvl: w.player.boostLevel, rings: fx.parts.filter((o) => o.k === 'ring').length, ghosts: fx.ghosts.get(w.player)?.pts.length || 0, boosts: fx.stats.boosts }; });
await page.screenshot({ path: `${out}/83-boost-trail${tag}.png` });
await page.evaluate(() => window.__RAD_GAME__.setPaused(false));
console.log('boost', JSON.stringify(boost));
ok(boost.boosts > b0 && boost.ghosts >= 3, `boost: event fired, level ${boost.lvl?.toFixed(2)}, ring ${boost.rings}, ghosts ${boost.ghosts}`);

// streaks: hold top speed on a straight-ish stretch
await wait(400);
for (let i = 0; i < 6; i++) { await page.evaluate(() => { const w = window.__RAD_GAME__.world, p = w.player, pr = window.__T.pointAt(w.track, p.sPrev + 20); p.x = pr.x; p.y = pr.y; p.angle = Math.atan2(pr.ty, pr.tx); p.vx = pr.tx * p.top; p.vy = pr.ty * p.top; }); await wait(60); }
await page.evaluate(() => window.__RAD_GAME__.setPaused(true));
const streak = await page.evaluate(() => { const fx = window.__RAD_GAME__.world.fxState; return { live: fx.parts.filter((o) => o.k === 'streak').length, total: fx.stats.streaks, q: fx.quality }; });
await page.screenshot({ path: `${out}/83-streaks${tag}.png` });
await page.evaluate(() => window.__RAD_GAME__.setPaused(false));
await page.keyboard.up('ArrowUp');
console.log('streak', JSON.stringify(streak));
ok(streak.live >= 1 && streak.live <= 6, `streaks: ${streak.live} live (≤ 6), ${streak.total} total, quality ${streak.q}`);
const cap = await page.evaluate(() => { const fx = window.__RAD_GAME__.world.fxState; return { parts: fx.parts.length, dropped: fx.stats.dropped }; });
ok(cap.parts <= 64, `particle pool ≤ 64 (now ${cap.parts}, dropped ${cap.dropped})`);
ok(errs.length === 0, `0 console errors/warnings ${errs.length ? JSON.stringify(errs.slice(0, 3)) : ''}`);
console.log(fails ? `RESULT: FAIL (${fails})` : 'RESULT: PASS');
await browser.close();
