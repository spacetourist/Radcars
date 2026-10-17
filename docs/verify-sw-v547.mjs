// In-game auto-update check for a release: a tab running the live build (git <from>, default 14d6cd3 = v54.6) is
// moved onto the working tree build by the service worker, mid-race deferred until the menu.
//   node docs/verify-sw-v547.mjs [from=14d6cd3] [port=4181]
import puppeteer from 'puppeteer-core';
import { execSync, spawn } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
const from = process.argv[2] || '14d6cd3', port = +(process.argv[3] || 4181);
const repo = new URL('..', import.meta.url).pathname, site = '/workspace/tmp/radcars-swtest-' + port, url = `http://127.0.0.1:${port}/`;
let fails = 0; const check = (ok, m) => { if (!ok) fails++; console.log(`  [${ok ? 'ok' : 'FAIL'}] ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const files = 'index.html sw.js manifest.webmanifest css js icons vendor assets';
function deploy(ref) {
  rmSync(site, { recursive: true, force: true }); mkdirSync(site, { recursive: true });
  if (ref === 'worktree') execSync(`cp -r ${files} ${site}/`, { cwd: repo });
  else execSync(`git archive ${ref} ${files} | tar -x -C ${site}`, { cwd: repo, shell: '/bin/bash' });
  const v = readFileSync(`${site}/js/version.js`, 'utf8');
  return { cache: `radcars-${v.match(/version: '([^']+)'/)[1]}-${v.match(/name: '([^']+)'/)[1]}`, label: `${v.match(/version: '([^']+)'/)[1]} · ${v.match(/name: '([^']+)'/)[1]}` };
}
const old = deploy(from);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', site], { stdio: 'ignore' });
await sleep(800);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
let navs = 0; page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs++; });
const state = () => page.evaluate(async () => ({ caches: await caches.keys(), controlled: !!navigator.serviceWorker.controller, tag: document.getElementById('build-tag')?.textContent || null,
  sw: window.__RAD_SW__ ? { ...window.__RAD_SW__ } : null, running: !!(window.__RAD_GAME__ && window.__RAD_GAME__.isRunning()) }));
async function until(pred, ms) { const t0 = Date.now(); let s; while (Date.now() - t0 < ms) { try { s = await state(); if (pred(s)) return s; } catch (_) {} await sleep(250); } return s; }
try {
  await page.goto(url, { waitUntil: 'networkidle2' });
  let s = await until((x) => x.controlled && x.caches.includes(old.cache), 15000);
  check(s.controlled && s.caches.includes(old.cache), `tab controlled by the ${old.label} worker (tag "${s.tag}", caches ${JSON.stringify(s.caches)})`);
  // start a race, then deploy the new build underneath it
  await page.tap('[data-act=race]'); await page.waitForSelector('#tracks button');
  await page.evaluate(() => document.querySelectorAll('#tracks button')[0].click());
  await until((x) => x.running, 8000); await sleep(4500);
  const nu = deploy('worktree');
  const n1 = navs;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const tU = Date.now(); s = await until((x) => x.caches.includes(nu.cache) && x.sw && x.sw.pending, 60000); const dU = Date.now() - tU; await sleep(2000); s = await state();
  check(s.caches.includes(nu.cache) && navs === n1 && s.running, `new ${nu.label} worker installed mid-race, no reload during the race (navigations ${navs - n1}, running ${s.running}, pending ${s.sw && s.sw.pending}, new worker in control after ${(dU / 1000).toFixed(1)} s, update checks ${s.sw && s.sw.updates})`);
  await page.keyboard.press('p'); await page.waitForSelector('#quit'); await page.click('#quit');
  s = await until((x) => navs > n1 && x.tag === nu.label && x.controlled, 15000);
  check(navs > n1 && s.tag === nu.label && !s.caches.includes(old.cache), `after quitting to the menu the tab reloaded onto "${s.tag}" (caches ${JSON.stringify(s.caches)})`);
} catch (e) { check(false, 'exception ' + (e.stack || e)); }
await browser.close(); server.kill();
console.log(fails ? 'RESULT: FAIL' : 'RESULT: ALL OK');
process.exit(fails ? 1 : 0);
