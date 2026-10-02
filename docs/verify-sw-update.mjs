// Service-worker update check (v48): a tab controlled by the v47 build picks up v48 without being closed, and a v48 tab
// auto-reloads onto later deploys, but never mid-race (the reload waits for the menu / results screen).
// Usage: node docs/verify-sw-update.mjs [port=4180]
// Serves a scratch copy of the site from /tmp/radcars-swtest (v47 = git 1f18a78, then the working tree) and swaps files
// underneath the open tab like a GitHub Pages deploy would.
import puppeteer from 'puppeteer-core';
import { execSync, spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';

const port = +(process.argv[2] || 4180);
const repo = new URL('..', import.meta.url).pathname;
const site = '/tmp/radcars-swtest';
const url = `http://localhost:${port}/`;
const out = [];
let fails = 0;
const log = (s) => { console.log(s); out.push(s); };
const check = (ok, msg) => { if (!ok) fails++; log(`  [${ok ? 'ok' : 'FAIL'}] ${msg}`); return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function deploy(ref) {
  rmSync(site, { recursive: true, force: true }); mkdirSync(site, { recursive: true });
  const files = 'index.html sw.js manifest.webmanifest css js icons';
  if (ref === 'worktree') execSync(`cp -r ${files} vendor ${site}/`, { cwd: repo }); // v51+: vendored Pixi
  else execSync(`git archive ${ref} ${files} | tar -x -C ${site}`, { cwd: repo, shell: '/bin/bash' });
}
const cacheName = () => {
  const sw = readFileSync(`${site}/sw.js`, 'utf8'), m = sw.match(/CACHE = '([^']+)'/);
  if (m) return m[1]; // v47: literal in sw.js
  const v = readFileSync(`${site}/js/version.js`, 'utf8'); // v48+: js/version.js is the single source of truth
  return `radcars-${v.match(/version: '([^']+)'/)[1]}-${v.match(/name: '([^']+)'/)[1]}`;
};
const buildLabel = () => { const v = readFileSync(`${site}/js/version.js`, 'utf8'); return `${v.match(/version: '([^']+)'/)[1]} · ${v.match(/name: '([^']+)'/)[1]}`; };
function bumpCache(suffix) { const f = `${site}/js/version.js`; writeFileSync(f, readFileSync(f, 'utf8').replace(/name: '([^']+)'/, (_, c) => `name: '${c}-${suffix}'`)); return cacheName(); }

deploy('1f18a78');
const server = spawn('python3', ['-m', 'http.server', String(port), '--directory', site], { stdio: 'ignore' });
await sleep(800);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
let navs = 0; page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs++; });
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
const state = () => page.evaluate(async () => ({
  caches: await caches.keys(),
  controlled: !!navigator.serviceWorker.controller,
  brk: !!document.querySelector('#btn-brake, .tc-brake'),
  hint: !!document.querySelector('.tc-hint'),
  sw: window.__RAD_SW__ ? { ...window.__RAD_SW__ } : null,
  running: !!(window.__RAD_GAME__ && window.__RAD_GAME__.isRunning()),
  tag: document.getElementById('build-tag')?.textContent || null,
  href: location.href,
  regs: (await navigator.serviceWorker.getRegistrations()).length
}));
async function until(pred, ms) { const t0 = Date.now(); let s; while (Date.now() - t0 < ms) { try { s = await state(); if (pred(s)) return s; } catch (_) { /* mid-navigation */ } await sleep(250); } return s; }

try {
  log(`SW update test — ${new Date().toString()}`);
  log(`\n1) v47 tab (git 1f18a78, cache ${cacheName()})`);
  await page.goto(url, { waitUntil: 'networkidle2' });
  let s = await until((x) => x.controlled && x.caches.includes('radcars-v47-boost'), 10000);
  check(s.controlled && s.caches.includes('radcars-v47-boost') && s.brk && !s.sw, `tab is controlled by the v47 worker (caches ${JSON.stringify(s.caches)}, BRK button present, no v48 page code)`);

  deploy('worktree'); const wt = cacheName(); // working-tree build (was pinned to radcars-v48-missile)
  log(`\n2) deploy v48 (working tree, cache ${wt}) under the open tab; the user refreshes / returns to it once`);
  const n0 = navs;
  await page.reload({ waitUntil: 'networkidle2' });
  // the v48 touch hint (.tc-hint) was removed in later builds, so it is no longer required here
  s = await until((x) => x.caches.includes(wt) && !x.caches.includes('radcars-v47-boost') && x.sw && !x.brk && navs - n0 >= 2, 15000);
  check(s.caches.includes(wt) && !s.caches.includes('radcars-v47-boost') && s.controlled && !!s.sw && !s.brk,
    `same tab now runs v48: caches ${JSON.stringify(s.caches)}, v48 page code=${!!s.sw}, BRK gone=${!s.brk}; navigations ${navs - n0} (1 refresh + ${navs - n0 - 1} automatic reload when the v48 worker took control)`);

  log(`\n3) next deploy while MID-RACE: update found on visibilitychange, reload deferred until the menu`);
  await page.click('[data-act=race]'); await page.waitForSelector('#tracks button');
  await page.evaluate(() => document.querySelectorAll('#tracks button')[0].click());
  await until((x) => x.running, 5000);
  await sleep(4500); // past the countdown, racing
  const next1 = bumpCache('next1');
  const n1 = navs;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  s = await until((x) => x.sw && x.sw.pending, 10000);
  await sleep(2500);
  s = await state();
  check(s.sw && s.sw.pending && navs === n1 && s.running, `new worker (${next1}) took control during the race: reload pending=${s.sw?.pending}, navigations during the race ${navs - n1}, race still running=${s.running}`);
  await page.keyboard.press('p'); await page.waitForSelector('#quit'); await page.click('#quit');
  s = await until((x) => navs > n1 && x.caches.includes(next1) && x.sw && !x.sw.pending, 8000);
  check(navs > n1 && s.caches.includes(next1) && s.sw && !s.sw.pending, `after quitting to the menu the tab reloaded once onto ${next1} (navigations ${navs - n1}, caches ${JSON.stringify(s.caches)})`);

  log(`\n4) next deploy while on the MENU: reloads straight away`);
  const next2 = bumpCache('next2');
  const n2 = navs;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  s = await until((x) => navs > n2 && x.caches.includes(next2) && x.sw, 10000);
  await sleep(1500);
  check(navs - n2 === 1 && s.caches.includes(next2), `menu tab reloaded exactly once onto ${next2} (navigations ${navs - n2})`);

  log(`\n5) menu "Update / hard refresh" button (a newer build is on the server but the tab hasn't looked for it)`);
  const next3 = bumpCache('next3'), label3 = buildLabel();
  await page.evaluate(async () => { const c = await caches.open('radcars-stale-marker'); await c.put('./stale-marker', new Response('old')); });
  const before = await state();
  log(`    before: tag "${before.tag}", caches ${JSON.stringify(before.caches)}, registrations ${before.regs}`);
  await page.screenshot({ path: `${repo}docs/shots/76-menu-version-before-refresh.png` });
  const n3 = navs; const reqs = [];
  page.on('request', (r) => { if (r.isNavigationRequest()) reqs.push(r.url()); });
  const dbg = []; page.on('response', (r) => { if (/ui\.js|version\.js/.test(r.url())) dbg.push([r.url().replace(url, '/'), r.status(), r.fromCache(), r.fromServiceWorker(), r.request().headers()['cache-control'] || '']); });
  await page.click('#hard-refresh');
  s = await until((x) => navs > n3 && x.tag === label3 && x.controlled && x.caches.includes(next3), 12000);
  await sleep(1000); s = await state();
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
  await sleep(400);
  await page.screenshot({ path: `${repo}docs/shots/76-menu-version.png` });
  // the button on a touch screen: tap it (mobile Chrome path) and make sure it still lands on the current build
  const n4 = navs; await page.tap('#hard-refresh');
  const s4 = await until((x) => navs > n4 && x.tag === label3 && x.controlled, 12000);
  check(navs > n4 && s4.tag === label3 && s4.controlled, `tapping the button in a mobile viewport (844×390 touch) reloads onto "${s4.tag}" too`);
  if (!s.tag) log('    DEBUG ' + JSON.stringify(await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /js\//.test(e.name)).map((e) => [e.name.replace(location.origin, ''), e.transferSize, e.deliveryType]))) + ' reqs ' + JSON.stringify(dbg));
  check(!s.caches.includes('radcars-stale-marker') && !before.caches.every((k) => s.caches.includes(k)) && reqs.some((u) => /[?&]r=\d+/.test(u)),
    `button wiped the caches (stale marker + ${before.caches.filter((k) => k !== 'radcars-stale-marker').join(', ')} gone) and reloaded via ${reqs.find((u) => /r=/.test(u))?.replace(url, '/')}`);
  check(s.tag === label3 && s.caches.includes(next3) && s.controlled && !/[?&]r=/.test(s.href) && s.regs === 1,
    `reload landed on the current build: tag "${s.tag}", caches ${JSON.stringify(s.caches)}, fresh worker in control, ${s.regs} registration, address bar tidied to ${s.href.replace(url, '/') || '/'}`);
  check(errs.length === 0, `page errors: ${errs.length} ${JSON.stringify(errs.slice(0, 3))}`);
} catch (e) { check(false, `exception: ${e.stack || e}`); }
await browser.close();
server.kill();
log(`\nOVERALL: ${fails ? 'FAIL' : 'PASS'}`);
writeFileSync(`${repo}docs/shots/76-sw-update.txt`, out.join('\n') + '\n');
process.exit(fails ? 1 : 0);
