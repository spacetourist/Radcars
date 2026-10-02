/**
 * v51 shots + checks (imported by docs/verify-v51.mjs): race close-ups of the toy cars on all tracks with a
 * nose-vs-road check, overlay shots (spin / boost / green flame / autopilot), phone layout, every menu screen on
 * desktop + 844×390, touch-target sizes, and "menu photo never loads or shows during a race".
 */
const ALL = ['neon', 'gridlock', 'razor', 'cargo'];

export async function runShots(ctx) {
  const { browser, url, outDir, tracks, log, check, newPage, startRace, install, quitRace, sleep, watchErrors } = ctx;
  let fails = 0;
  const ck = (ok, msg) => { if (!check(ok, msg)) fails++; return ok; };

  const shotAt = async (page, name, wx, wy, cw, ch, scale) => {
    const vp = page.viewport();
    const pos = await page.evaluate((wx, wy) => { const c = window.__RAD_GAME__.world.cam; const el = document.getElementById('game'); return { x: (wx - c.x) * c.zoom + el.clientWidth / 2, y: (wy - c.y) * c.zoom + el.clientHeight / 2 }; }, wx, wy);
    cw = Math.min(cw, vp.width); ch = Math.min(ch, vp.height);
    const x = Math.max(0, Math.min(vp.width - cw, pos.x - cw / 2)), y = Math.max(0, Math.min(vp.height - ch, pos.y - ch / 2));
    const file = `${outDir}/79-${name}.png`;
    await page.screenshot({ path: file, clip: { x, y, width: cw, height: ch, scale } });
    log(`    shot ${file}`);
  };
  const shotFull = async (page, name) => { const file = `${outDir}/79-${name}.png`; await page.screenshot({ path: file }); log(`    shot ${file}`); };
  const player = (page) => page.evaluate(() => { const p = window.__RAD_GAME__.world.player; return { x: p.x, y: p.y }; });
  const state = (page) => page.evaluate(() => { const w = window.__RAD_GAME__.world, p = w.player; return { t: w.race.time, cd: w.race.countdown, lap: p.lap, spd: Math.hypot(p.vx, p.vy), radius: w.track.pts[p.seg]?.radius ?? 1e9, results: !!document.querySelector('#results'),
    near: w.cars.filter((c) => !c.isPlayer && Math.hypot(c.x - p.x, c.y - p.y) < 650).length, spin: w.cars.filter((c) => c.spinMs > 0).map((c) => c.id), power: w.power.active, lvl: p.boostLevel || 0, place: window.__RAD_GAME__.getHudInfo?.().place }; });
  const waitFor = async (page, pred, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await state(page); if (pred(s)) return s; await sleep(40); } return null; };

  /** Every car's drawn nose (debug transform of the sprite) vs the road tangent at its position and vs its velocity. */
  const noseCheck = async (page, label) => {
    const r = await page.evaluate(async () => {
      const { pointAt } = await import('./js/tracks.js');
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const w = window.__RAD_GAME__.world, f = window.__RAD_DEBUG__.frame;
      const out = [];
      for (const d of f.cars) {
        if (d.spinning) continue;
        const c = w.cars.find((k) => k.id === d.id), tp = pointAt(w.track, c.sPrev);
        const drawn = Math.atan2(d.lenAxis.y, d.lenAxis.x), road = Math.atan2(tp.ty, tp.tx);
        const dif = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 180 / Math.PI;
        const spd = Math.hypot(c.vx, c.vy);
        out.push({ id: d.id, variant: d.variant, road: +dif(drawn, road).toFixed(1), vel: spd > 120 ? +dif(drawn, Math.atan2(c.vy, c.vx)).toFixed(1) : null });
      }
      return out;
    });
    const worst = Math.max(...r.map((x) => x.road));
    ck(r.length >= 4 && worst < 40, `${label}: ${r.length} cars, drawn nose vs road tangent worst ${worst}° (${r.map((x) => `${x.id}:${x.variant}:${x.road}°`).join(' ')}); vs velocity worst ${Math.max(0, ...r.map((x) => x.vel ?? 0))}°`);
    return r;
  };
  const packShot = async (page, name, minW = 520) => {
    const box = await page.evaluate(() => { const w = window.__RAD_GAME__.world, c = w.cam, el = document.getElementById('game'); const xs = w.cars.map((k) => (k.x - c.x) * c.zoom + el.clientWidth / 2), ys = w.cars.map((k) => (k.y - c.y) * c.zoom + el.clientHeight / 2); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; });
    const vp = page.viewport();
    let cw = Math.max(minW, box.x1 - box.x0 + 120, (box.y1 - box.y0 + 110) * 16 / 9); cw = Math.min(vp.width, cw); const ch = Math.min(vp.height, Math.round(cw * 9 / 16));
    const x = Math.max(0, Math.min(vp.width - cw, (box.x0 + box.x1) / 2 - cw / 2)), y = Math.max(0, Math.min(vp.height - ch, (box.y0 + box.y1) / 2 - ch / 2));
    const file = `${outDir}/79-${name}.png`;
    await page.screenshot({ path: file, clip: { x, y, width: cw, height: ch, scale: Math.max(1, Math.min(3, 1300 / cw)) } });
    log(`    shot ${file}`);
  };
  const touchTargets = async (page, label) => {
    const r = await page.evaluate(() => [...document.querySelectorAll('#ui button, #pause-ov button')].filter((b) => b.offsetParent).map((b) => { const q = b.getBoundingClientRect(); return { t: b.textContent.trim().slice(0, 14), w: Math.round(q.width), h: Math.round(q.height), off: q.left < 0 || q.top < 0 || q.right > innerWidth + 0.5 || q.bottom > innerHeight + 0.5 }; }));
    const bad = r.filter((b) => b.w < 44 || b.h < 44 || b.off);
    ck(r.length > 0 && bad.length === 0, `${label}: ${r.length} buttons ≥ 44 px and on screen${bad.length ? ' — BAD ' + JSON.stringify(bad) : ''}`);
  };
  const menuBgState = (page) => page.evaluate(() => { const b = document.getElementById('menu-bg'); return { display: getComputedStyle(b).display, cls: b.className }; });

  // ---------------------------------------------------------------- desktop races on every track
  const page = await newPage('desktop');
  const errs = []; watchErrors(page, errs);
  const menuReq = []; let racing = false;
  page.on('request', (r) => { if (r.url().includes('/assets/menu/') && racing) menuReq.push(r.url()); });
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await page.evaluate(() => { window.__RAD_DEBUG__ = {}; });
  let kindLogged = false;
  for (const name of tracks) {
    log(`\n=== ${name.toUpperCase()} — desktop race (1280×720) ===`);
    await startRace(page, ALL.indexOf(name));
    racing = true;
    if (!kindLogged) { kindLogged = true; const rk = await page.evaluate(() => window.__RAD_GAME__.rendererKind); ck(url.includes('canvas=1') ? rk === 'canvas' : rk === 'pixi', `active race renderer: ${rk}`); }
    await install(page);
    await page.evaluate(() => { window.__RAD_DEBUG__ = {}; window.__botOn = false; });
    const mb = await menuBgState(page);
    ck(mb.display === 'none', `menu photo layer hidden in the race (display ${mb.display})`);
    if (name === 'neon') { await sleep(1500); await shotFull(page, 'menu-countdown-desktop'); }
    await waitFor(page, (s) => s.cd <= 0 && s.t > 760, 12000);
    await noseCheck(page, 'grid (just after GO)');
    await packShot(page, `${name}-grid`);
    await page.evaluate(() => { window.__botOn = true; });
    let s = await waitFor(page, (x) => x.t > 7000 && x.radius < 1100 && x.near >= 1 && x.spd > 300, 30000);
    if (!s) log('    (no crowded corner found in 30 s — shooting where the player is)');
    const p = await player(page);
    await shotAt(page, `${name}-corner`, p.x, p.y, 640, 360, 2);
    await noseCheck(page, 'mid-race corner');
    if (name === 'neon') {
      await shotAt(page, 'player-closeup', p.x, p.y, 260, 146, 4);
      // boost (orange flames)
      await page.keyboard.down('Shift'); await sleep(60); await page.keyboard.up('Shift');
      await sleep(350);
      s = await state(page);
      ck(s.lvl > 0.3, `Shift boost burning (level ${s.lvl.toFixed(2)})`);
      let q = await player(page); await shotAt(page, 'boost-flame', q.x, q.y, 380, 214, 3);
      await waitFor(page, (x) => x.lvl < 0.02, 6000);
      // LAP BOOST (green flames)
      await page.evaluate(() => window.__RAD_GAME__.debug.give('lapboost')); await page.keyboard.press('e');
      await sleep(500);
      s = await state(page); ck(s.power === 'lapboost', `LAP BOOST active (${s.power})`);
      q = await player(page); await shotAt(page, 'green-flame', q.x, q.y, 380, 214, 3);
      // pause overlay over the dimmed live race
      await page.keyboard.press('p'); await page.waitForSelector('#resume'); await sleep(350);
      await shotFull(page, 'menu-pause-desktop'); await touchTargets(page, 'pause (desktop)');
      ck((await menuBgState(page)).display === 'none', 'pause uses the dimmed live race (no photo during the race)');
      await page.click('#resume'); await sleep(200);
    }
    if (name === 'razor') {
      // AUTOPILOT halo
      await page.evaluate(() => window.__RAD_GAME__.debug.give('autopilot')); await page.keyboard.press('e');
      await sleep(900);
      s = await state(page); ck(s.power === 'autopilot', `AUTOPILOT active (${s.power})`);
      const q = await player(page); await shotAt(page, 'autopilot', q.x, q.y, 380, 214, 3);
      await waitFor(page, (x) => !x.power, 14000);
    }
    if (name === 'gridlock' || name === 'cargo') {
      // ROCKET salvo → a spun-out toy car
      // v53: auto-throttle never lifts, so the bot often leads by now; a rocket needs a target ahead — brake until
      // a rival passes (max 8 s), then fire
      if ((await state(page)).place === 1) { await page.keyboard.down('ArrowDown'); await waitFor(page, (x) => x.place > 1, 8000); await page.keyboard.up('ArrowDown'); }
      await page.evaluate(() => window.__RAD_GAME__.debug.give('rocket')); await page.keyboard.press('e');
      s = await waitFor(page, (x) => x.spin.length > 0, 9000);
      if (s) {
        await sleep(220);
        const c = await page.evaluate((id) => { const k = window.__RAD_GAME__.world.cars.find((q) => q.id === id); return { x: k.x, y: k.y, spin: k.spinVis }; }, s.spin[0]);
        await shotAt(page, `${name}-spin`, c.x, c.y, 380, 214, 3);
        ck(true, `rocket hit car ${s.spin[0]} → spin drawn (spinVis ${c.spin?.toFixed(2)} rad)`);
      } else ck(false, 'no rocket hit within 9 s');
    }
    racing = false;
    await quitRace(page);
    await page.evaluate(() => { window.__RAD_DEBUG__ = {}; });
  }
  ck(menuReq.length === 0, `no menu photo requests while racing (${menuReq.length})`);

  // ---------------------------------------------------------------- menus on desktop + phone
  for (const kind of ['desktop', 'phone']) {
    log(`\n=== MENUS ${kind} ===`);
    const pg = kind === 'desktop' ? page : await newPage('phone');
    const e2 = kind === 'desktop' ? errs : []; if (kind !== 'desktop') watchErrors(pg, e2);
    // "during the race" = from the Race click until the results screen appears (stamped in the page by a
    // MutationObserver; the results screen itself may re-request the photo, which is fine)
    const req = []; let raceT0 = Infinity;
    pg.on('request', (r) => { if (r.url().includes('/assets/menu/')) req.push({ u: r.url().split('/').pop().split('?')[0], t: Date.now() }); });
    await pg.goto(url, { waitUntil: 'networkidle2' });
    await pg.evaluate(() => localStorage.clear());
    await pg.reload({ waitUntil: 'networkidle2' });
    await sleep(1800);
    let mb = await menuBgState(pg);
    ck(mb.display === 'block' && /dim-ready/.test(mb.cls), `title: photo layer shown + loaded lazily (${mb.cls})`);
    const tag = await pg.evaluate(() => ({ tag: document.getElementById('build-tag')?.textContent, btn: !!document.getElementById('hard-refresh'), label: self.RADCARS_BUILD.label }));
    ck(tag.btn && tag.tag === tag.label, `title shows "${tag.tag}" + Update / hard refresh button`);
    await shotFull(pg, `menu-title-${kind}`); await touchTargets(pg, `title (${kind})`);
    await pg.click('[data-act=options]'); await sleep(900);
    await shotFull(pg, `menu-options-${kind}`); await touchTargets(pg, `options (${kind})`);
    mb = await menuBgState(pg); ck(/blur/.test(mb.cls), `options uses the blurred photo (${mb.cls})`);
    // 1 lap, 3 rivals for a quick results screen
    for (let i = 0; i < 2; i++) { await pg.click('[data-k=laps][data-d="-1"]'); await sleep(80); }
    for (let i = 0; i < 2; i++) { await pg.click('[data-k=aiCount][data-d="-1"]'); await sleep(80); }
    await pg.click('[data-act=back]'); await sleep(300);
    await pg.click('[data-act=race]'); await pg.waitForSelector('#tracks button'); await sleep(900);
    await shotFull(pg, `menu-select-${kind}`); await touchTargets(pg, `track select (${kind})`);
    await pg.evaluate(() => { window.__resAt = 0; new MutationObserver((_, ob) => { if (document.querySelector('#results')) { window.__resAt = Date.now(); ob.disconnect(); } }).observe(document.body, { childList: true, subtree: true }); });
    raceT0 = Date.now();
    await pg.evaluate(() => document.querySelectorAll('#tracks button')[0].click());
    await pg.waitForFunction(() => window.__RAD_GAME__.world && window.__RAD_GAME__.isRunning(), { timeout: 10000 });
    await install(pg);
    if (kind === 'phone') {
      await sleep(1500); await shotFull(pg, 'menu-countdown-phone');
      await pg.waitForFunction(() => window.__RAD_GAME__.world.race.countdown <= 0);
      await sleep(5000); await shotFull(pg, 'phone-race');
      await pg.evaluate(() => { window.__RAD_DEBUG__ = {}; });
      await noseCheck(pg, 'phone race');
      await pg.keyboard.press('p'); await pg.waitForSelector('#resume'); await sleep(350);
      await shotFull(pg, 'menu-pause-phone'); await touchTargets(pg, 'pause (phone)');
      await pg.click('#resume');
    }
    await pg.waitForFunction(() => !!document.querySelector('#results'), { timeout: 120000, polling: 250 });
    const resAt = await pg.evaluate(() => window.__resAt || Date.now());
    req.forEach((r) => { r.inRace = r.t >= raceT0 && r.t < resAt; });
    await sleep(900);
    await shotFull(pg, `menu-results-${kind}`); await touchTargets(pg, `results (${kind})`);
    ck(req.filter((r) => r.inRace).length === 0, `${kind}: menu photo requests during the race: ${req.filter((r) => r.inRace).length} (all: ${req.map((r) => r.u).join(', ')})`);
    await pg.click('#title'); await sleep(500);
    ck(!!(await pg.$('[data-act=race]')), 'results → Menu returns to the title');
    await pg.evaluate(() => localStorage.clear());
    ck(e2.length === 0, `${kind} console errors: ${e2.length ? e2.slice(0, 4).join(' | ') : 'none'}`);
    if (kind !== 'desktop') await pg.close();
  }
  await page.close();

  // ---------------------------------------------------------------- portrait phone menus (races stay landscape)
  {
    log('\n=== MENUS portrait 390×844 ===');
    const pg = await browser.newPage();
    await pg.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const e3 = []; watchErrors(pg, e3);
    const preq = []; pg.on('request', (r) => { if (r.url().includes('/assets/menu/')) preq.push(r.url().split('/').pop().split('?')[0]); });
    await pg.goto(url, { waitUntil: 'networkidle2' });
    await sleep(1800);
    const bgv = await pg.evaluate(() => { const b = document.getElementById('menu-bg'); return { dim: b.style.getPropertyValue('--bg-dim').split('/').pop(), cls: b.className, shown: getComputedStyle(b.querySelector('.mb-dim')).opacity }; });
    ck(/menu-bg-city-portrait-dim-hd\.jpg/.test(bgv.dim) && /dim-ready/.test(bgv.cls), `portrait title (DPR 2) uses the HD portrait photo (${bgv.dim} ${bgv.cls})`);
    await shotFull(pg, 'menu-title-portrait'); await touchTargets(pg, 'title (portrait)');
    await pg.click('[data-act=options]'); await sleep(900);
    await shotFull(pg, 'menu-options-portrait'); await touchTargets(pg, 'options (portrait)');
    const bgo = await pg.evaluate(() => document.getElementById('menu-bg').style.getPropertyValue('--bg-blur').split('/').pop());
    ck(/menu-bg-city-portrait-blur\.jpg/.test(bgo), `portrait options uses the portrait blur photo (${bgo})`);
    await pg.click('[data-act=back]'); await sleep(300);
    await pg.click('[data-act=race]'); await pg.waitForSelector('#tracks button'); await sleep(900);
    await shotFull(pg, 'menu-select-portrait');
    const cards = await pg.evaluate(() => [...document.querySelectorAll('#tracks button')].map((b) => { const q = b.getBoundingClientRect(); return q.width >= 44 && q.height >= 44 && q.left >= 0 && q.right <= innerWidth + 0.5; }));
    ck(cards.length === 4 && cards.every(Boolean), `portrait track select: 4 Race buttons ≥ 44 px within the width (scrollable list)`);
    ck(preq.every((u) => /portrait-(dim-hd|blur)\.jpg$/.test(u)), `portrait loads only the files it shows: ${[...new Set(preq)].join(', ')}`);
    // standard-DPR portrait picks the 1080 dim
    {
      const p1 = await browser.newPage();
      await p1.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await p1.goto(url, { waitUntil: 'networkidle2' }); await sleep(1800);
      const d1 = await p1.evaluate(() => document.getElementById('menu-bg').style.getPropertyValue('--bg-dim').split('/').pop());
      ck(/menu-bg-city-portrait-dim\.jpg/.test(d1), `portrait title at DPR 1 uses the 1080 portrait photo (${d1})`);
      await p1.close();
    }
    ck(e3.length === 0, `portrait console errors: ${e3.length ? e3.slice(0, 4).join(' | ') : 'none'}`);
    await pg.close();
  }

  // ---------------------------------------------------------------- Canvas fallback comparison shots (?canvas=1)
  {
    log('\n=== CANVAS FALLBACK comparison (?canvas=1) ===');
    const cu = url + (url.includes('?') ? '&' : '?') + 'canvas=1';
    const pg = await newPage('desktop');
    const e4 = []; watchErrors(pg, e4);
    await pg.goto(cu, { waitUntil: 'networkidle2' });
    await pg.evaluate(() => localStorage.clear());
    await pg.reload({ waitUntil: 'networkidle2' });
    await startRace(pg, 0);
    ck((await pg.evaluate(() => window.__RAD_GAME__.rendererKind)) === 'canvas', '?canvas=1 → Canvas renderer active');
    await install(pg);
    await pg.evaluate(() => { window.__RAD_DEBUG__ = {}; window.__botOn = false; });
    await waitFor(pg, (s) => s.cd <= 0 && s.t > 760, 12000);
    await packShot(pg, 'canvas-neon-grid');
    await pg.evaluate(() => { window.__botOn = true; });
    await waitFor(pg, (x) => x.t > 7000 && x.radius < 1100 && x.near >= 1 && x.spd > 300, 30000);
    const p = await player(pg);
    await shotAt(pg, 'canvas-neon-corner', p.x, p.y, 640, 360, 2);
    await quitRace(pg);
    ck(e4.length === 0, `canvas fallback console errors: ${e4.length ? e4.slice(0, 4).join(' | ') : 'none'}`);
    await pg.close();
  }
  return fails;
}
