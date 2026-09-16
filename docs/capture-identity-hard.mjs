import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'shots');
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:4173/index.html?v=' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TRACKS = [
  { index: 3, id: 'cargo_dock', race: '48-cargo-crane-rekey-race', grid: '48b-cargo-crane-rekey-grid' }
];

async function disableSW(page) {
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return;
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  }).catch(() => {});
}

async function gotoFresh(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await disableSW(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(700);
}

async function waitPack(page) {
  await page.waitForFunction(() => window.__RAD_PACK_READY__ === true, { timeout: 25000 }).catch(() => {});
  return page.evaluate(async () => {
    try {
      const m = await import('/js/assetPack.js?t=' + Date.now());
      if (!m.isPackReady()) await m.loadAssetPack();
      const info = window.__RAD_PACK_INFO__ || {};
      const pack = m.getAssetPack && m.getAssetPack();
      const crane = pack && pack.scenery && pack.scenery.crane;
      let craneSample = null;
      if (crane && crane.getContext) {
        const ctx = crane.getContext('2d', { willReadFrequently: true });
        const w = crane.width, h = crane.height;
        const pts = [[0.1,0.1],[0.5,0.15],[0.5,0.5],[0.8,0.3]];
        craneSample = pts.map(([fx,fy]) => {
          const d = ctx.getImageData((w*fx)|0, (h*fy)|0, 1, 1).data;
          return [d[0],d[1],d[2],d[3]];
        });
      }
      return {
        ready: m.isPackReady(),
        pack: info.pack || (pack && pack.name),
        scenery: info.scenery,
        craneMd: !!(pack && pack.scenery && pack.scenery.craneMd),
        craneSample
      };
    } catch (e) { return { ready: false, err: String(e) }; }
  });
}

async function startTrack(page, trackIndex) {
  await page.waitForSelector('.menu-btns [data-act="single"]', { timeout: 10000 });
  await page.click('.menu-btns [data-act="single"]');
  await page.waitForSelector('#tracks button.btn.primary', { timeout: 8000 });
  const buttons = await page.$$('#tracks button.btn.primary');
  if (!buttons[trackIndex]) throw new Error('No race button ' + trackIndex);
  await buttons[trackIndex].click();
  await sleep(1000);
}

async function shot(page, name) {
  const canvas = await page.$('#game');
  const path = join(OUT, name + '.png');
  await canvas.screenshot({ path });
  console.log('wrote', name);
}

async function stampAssetCrane(page) {
  return page.evaluate(async () => {
    const m = await import('/js/assetPack.js?t=' + Date.now());
    if (!m.isPackReady()) await m.loadAssetPack();
    const pack = m.getAssetPack();
    const crane = pack && pack.scenery && (pack.scenery.craneMd || pack.scenery.crane);
    if (!crane) return null;
    const c = document.createElement('canvas');
    c.width = 640; c.height = 480;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1a1020';
    ctx.fillRect(0, 0, 640, 480);
    // checker to prove transparency
    for (let y = 0; y < 480; y += 16) for (let x = 0; x < 640; x += 16) {
      if (((x+y)/16)&1) { ctx.fillStyle = '#2a2030'; ctx.fillRect(x,y,16,16); }
    }
    const s = Math.min(560 / crane.width, 400 / crane.height);
    const dw = crane.width * s, dh = crane.height * s;
    ctx.drawImage(crane, (640-dw)/2, (480-dh)/2, dw, dh);
    return c.toDataURL('image/png');
  });
}

async function sceneryMeta(page, trackIndex) {
  return page.evaluate(async (ti) => {
    const tmod = await import('/js/tracks.js?t=' + Date.now());
    const smod = await import('/js/scenery.js?t=' + Date.now());
    const track = tmod.TRACKS[ti];
    const built = smod.buildTrackScenery(track);
    const game = window.__RAD_GAME__;
    const w = game && game.world;
    // Prefer LIVE race scenery so teleports match what is painted
    const live = (typeof window !== 'undefined' && window.__RAD_SCENERY__)
      ? window.__RAD_SCENERY__
      : ((w && w.scenery) ? w.scenery : built);
    const sc = live;
    const lms = track.landmarks || [];
    const line = track.line;
    const id = track.id || '';
    const start = lms.find((l) => l.kind === 'start' || l.id === 'start_finish');
    const wantKind = id === 'cargo_dock' ? 'crane'
      : (id === 'gridlock' ? 'billboard' : 'stand');

    const mid = sc.mid || [];
    const near = sc.near || [];
    const far = sc.far || [];
    let pool = [...mid, ...near].filter((it) => it && it.kind === wantKind);
    if (!pool.length) pool = [...mid, ...near, ...far].filter((it) => it && it.kind === wantKind);

    // Razor: prefer stands near pinch landmarks
    let pinch = null;
    if (id === 'razor_hairpin') {
      pinch = lms.find((l) => /waist_north/i.test(l.id || '')) || lms.find((l) => l.kind === 'kink');
    }

    let target = null;
    let bi = 0;
    let bestScore = -1e15;
    for (const it of pool) {
      if (start && Math.hypot(it.x - start.x, it.y - start.y) < 420) continue; // keep race frame off S/F
      if (it.y < 60 || it.y > track.height - 60 || it.x < 40 || it.x > track.width - 40) continue;
      if (pinch && wantKind === 'stand') {
        const pd = Math.hypot(it.x - pinch.x, it.y - pinch.y);
        if (pd > 380) continue;
      }
      let nearestI = 0, nearestD = 1e15;
      for (let i = 0; i < line.length; i++) {
        const d = Math.hypot(line[i].x - it.x, line[i].y - it.y);
        if (d < nearestD) { nearestD = d; nearestI = i; }
      }
      if (nearestD > 380) continue;
      // Prefer closer-to-track stamps; Gridlock prefers mid-straight (low curvature proxy)
      let score = 400 - nearestD;
      if (id === 'gridlock') score += Math.abs(line[nearestI].x - track.width * 0.5) * -0.05;
      if (pinch && wantKind === 'stand') score += 200 - Math.hypot(it.x - pinch.x, it.y - pinch.y);
      // Prefer stamps deeper in the playfield (not clipped at top)
      score += Math.min(120, it.y) * 0.35;
      if (wantKind === 'crane' && it.img) score += (it.img.width * it.img.height) / 200;
      if (score > bestScore) {
        bestScore = score;
        target = { i: nearestI, it, d: nearestD };
        bi = nearestI;
      }
    }

    // Fallback landmark targeting if no stamp matched
    if (!target) {
      if (id === 'razor_hairpin' && pinch) {
        let bd = 1e15;
        for (let i = 0; i < line.length; i++) {
          const d = Math.hypot(line[i].x - pinch.x, line[i].y - pinch.y);
          if (d < bd) { bd = d; bi = i; }
        }
      } else if (id === 'cargo_dock') {
        const quay = lms.find((l) => /warehouse_corner|quay_east|dock_pinch/i.test(l.id || ''));
        if (quay) {
          let bd = 1e15;
          for (let i = 0; i < line.length; i++) {
            const d = Math.hypot(line[i].x - quay.x, line[i].y - quay.y);
            if (d < bd) { bd = d; bi = i; }
          }
        }
      } else if (id === 'gridlock') {
        let bestS = -1;
        for (let i = 0; i < line.length; i++) {
          const a = line[i];
          if (start && Math.hypot(a.x - start.x, a.y - start.y) < 380) continue;
          const b = line[(i + 8) % line.length];
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const straight = Math.abs(b.y - a.y) / len;
          const score = straight * 3 + (a.x / track.width);
          if (score > bestS) { bestS = score; bi = i; }
        }
      }
    }

    const p = line[bi];
    const n = line[(bi + 1) % line.length];
    const ang = Math.atan2(n.y - p.y, n.x - p.x);
    if (w && w.player && w.cam) {
      w.player.x = p.x; w.player.y = p.y; w.player.angle = ang;
      w.player.vx = 0; w.player.vy = 0;
      if (target && target.it) {
        // Center cam on identity stamp; keep player on nearby track
        w.cam.x = target.it.x;
        w.cam.y = target.it.y;
        w.cam.zoom = id === 'cargo_dock' ? 1.25 : (id === 'gridlock' ? 1.4 : 1.55);
      } else {
        w.cam.x = p.x; w.cam.y = p.y; w.cam.zoom = 1.58;
      }
      if (w.race) { w.race.countdown = 0; w.race.live = true; }
      w.__shotFreeze = true;
    }
    const tally = (arr) => {
      const o = {};
      for (const it of arr || []) {
        const k = it.kind || 'other';
        o[k] = (o[k] || 0) + 1;
      }
      return o;
    };
    const profile = sc.profile || built.profile;
    const stampCounts = sc.stampCounts || built.stampCounts;
    return {
      id: track.id,
      profile,
      stampCounts,
      midKinds: tally(mid),
      nearKinds: tally(near),
      liveScenery: !!(w && w.scenery),
      poolSize: pool.length,
      targetKind: wantKind,
      targetDist: target ? target.d : null,
      targetXY: target ? [target.it.x|0, target.it.y|0] : null,
      poolXY: pool.slice(0, 8).map((it) => [it.x|0, it.y|0]),
      teleported: !!(w && w.player)
    };
  }, trackIndex);
}

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,720']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('PAGEERR', e.message));

await gotoFresh(page);
const pack = await waitPack(page);
console.log('pack', JSON.stringify(pack));
const craneDataUrl = await stampAssetCrane(page);
if (craneDataUrl && craneDataUrl.startsWith('data:image/png;base64,')) {
  const buf = Buffer.from(craneDataUrl.split(',')[1], 'base64');
  writeFileSync(join(OUT, 'asset-crane-v261.png'), buf);
  console.log('wrote asset-crane-v261.png', buf.length);
}

const report = [];
for (const t of TRACKS) {
  await gotoFresh(page);
  const pk = await waitPack(page);
  console.log('track', t.id, 'packReady', pk.ready, pk.pack);
  await startTrack(page, t.index);
  await sleep(1600);
  await shot(page, t.grid);

  await sleep(2400);
  const meta = await sceneryMeta(page, t.index);
  console.log('meta', JSON.stringify(meta));
  if (meta.teleported) {
    await sleep(200);
    await page.evaluate((meta) => {
      const w = window.__RAD_GAME__ && window.__RAD_GAME__.world;
      if (!w || !w.player) return;
      w.player.vx = 0; w.player.vy = 0;
      w.__shotFreeze = true;
      if (meta && meta.targetXY) {
        w.cam.x = meta.targetXY[0];
        w.cam.y = meta.targetXY[1];
        w.cam.zoom = meta.id === 'cargo_dock' ? 1.25 : (meta.id === 'gridlock' ? 1.4 : 1.55);
      }
    }, meta);
    await sleep(350);
  }
  await shot(page, t.race);
  report.push({ id: t.id, pack: pk, meta });
}

await browser.close();
console.log('REPORT', JSON.stringify(report, null, 2));
