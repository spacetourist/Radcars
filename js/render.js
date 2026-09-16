import { hpColor } from './util.js';
import { createSpriteBank } from './sprites.js';
import { CAR_COLORS } from './cars.js';
import {
  createSceneryCache,
  drawArenaBackground,
  drawGroundPlate,
  drawSceneryFar,
  drawSceneryMid,
  drawSceneryNear
} from './scenery.js';

/** HD remaster renderer: industrial arena, angular cars, visceral FX — crisp, no mush. */
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let shake = 0;
  let shakePhase = 0;
  let fxTime = 0;
  const particles = [];
  let bufW = 0, bufH = 0, lastDpr = 0;
  const sprites = createSpriteBank();
  try { sprites.warm(CAR_COLORS); } catch (_) {}
  const sceneryCache = createSceneryCache();
  const boomAnims = []; // {x,y,frame,age}

  function resize(cssW, cssH, dpr) {
    const bw = Math.max(1, Math.floor(cssW * dpr));
    const bh = Math.max(1, Math.floor(cssH * dpr));
    // Avoid clearing/resetting the canvas every frame (resize thrash = flicker)
    if (bw === bufW && bh === bufH && dpr === lastDpr) {
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      return;
    }
    bufW = bw;
    bufH = bh;
    lastDpr = dpr;
    canvas.width = bw;
    canvas.height = bh;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Path fills don't need image smoothing; keep it off for crisper edges
    ctx.imageSmoothingEnabled = false;
  }

  function addBoom(x, y, color = '#ff8a00') {
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.0 + Math.random() * 3.0;
      const hot = i % 4;
      const col = hot === 0 ? '#ffffff'
        : hot === 1 ? '#ffe600'
        : hot === 2 ? '#ff8a00'
        : color;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 280 + Math.random() * 320,
        maxLife: 600,
        color: col,
        r: 2.5 + Math.random() * 5,
        spark: hot === 0
      });
    }
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.5 + Math.random() * 2.0;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 360 + Math.random() * 360,
        maxLife: 720,
        color: i % 2 ? '#ff2bd6' : '#00e8ff',
        r: 1.4 + Math.random() * 2.2,
        spark: false
      });
    }
    // Expanding rings — short life, no random flash
    particles.push({
      x, y, vx: 0, vy: 0,
      life: 180, maxLife: 180,
      color: '#ffffff',
      r: 8, ring: true
    });
    particles.push({
      x, y, vx: 0, vy: 0,
      life: 240, maxLife: 240,
      color: '#ff8a00',
      r: 5, ring: true
    });
    particles.push({
      x, y, vx: 0, vy: 0,
      life: 140, maxLife: 140,
      color: '#ff2bd6',
      r: 3, ring: true, ringW: 2
    });
    shake = Math.min(8, shake + 3.8);
    boomAnims.push({ x, y, age: 0, life: 280 });
  }

  function stepParticles(dt) {
    fxTime += dt;
    shakePhase += dt * 0.055;
    for (const p of particles) {
      p.life -= dt;
      if (!p.ring) {
        p.x += p.vx * dt * 0.055;
        p.y += p.vy * dt * 0.055;
        p.vx *= 0.965;
        p.vy *= 0.965;
        p.vy -= 0.0025 * dt;
      } else {
        p.r += dt * (p.ringW ? 0.14 : 0.12);
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life <= 0) particles.splice(i, 1);
    }
    for (let i = boomAnims.length - 1; i >= 0; i--) {
      boomAnims[i].age += dt;
      if (boomAnims[i].age >= boomAnims[i].life) boomAnims.splice(i, 1);
    }
    shake *= Math.pow(0.88, dt / 16);
    if (shake < 0.08) shake = 0;
  }

  function draw(world) {
    const { track, cars, weapons, cam } = world;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    stepParticles(world.dt || 16);

    const scenery = sceneryCache.get(track);

    ctx.save();
    // Sky + distant skyline (screen space, light parallax)
    if (scenery) drawArenaBackground(ctx, scenery, cam, W, H);
    else {
      const floor = ctx.createRadialGradient(W * 0.5, H * 0.45, 40, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
      floor.addColorStop(0, track.bg);
      floor.addColorStop(1, '#050608');
      ctx.fillStyle = floor;
      ctx.fillRect(0, 0, W, H);
    }

    // Deterministic shake (no Math.random per frame — that looked like flicker)
    const sx = shake ? shake * Math.sin(shakePhase * 1.7) * 0.55 : 0;
    const sy = shake ? shake * Math.cos(shakePhase * 1.3) * 0.55 : 0;

    // Pixel-snapped camera: remove subpixel crawl that softens the whole scene
    const zoom = cam.zoom;
    const camX = cam.x;
    const camY = cam.y;
    const tx = Math.round((W * 0.5 + sx) * 100) / 100;
    const ty = Math.round((H * 0.5 + sy) * 100) / 100;
    ctx.translate(tx, ty);
    ctx.scale(zoom, zoom);
    // Round world origin in screen pixels after zoom
    const ox = Math.round(camX * zoom) / zoom;
    const oy = Math.round(camY * zoom) / zoom;
    ctx.translate(-ox, -oy);

    // Ground fill + far/mid scenery behind asphalt
    if (scenery) {
      drawGroundPlate(ctx, scenery, track);
      drawSceneryFar(ctx, scenery, cam, W, H, zoom);
      drawSceneryMid(ctx, scenery, cam, W, H, zoom);
    }

    drawTrack(ctx, track);
    drawStartLine(ctx, track);

    // Near props / crowds on top of asphalt edge (still outside racing line visually)
    if (scenery) drawSceneryNear(ctx, scenery, cam, W, H, zoom);

    // Gantry above trackside clutter so countdown grid reads the start structure
    drawStartGantryOnly(ctx, track);

    for (const m of weapons.mines) {
      if (!m.alive) continue;
      drawMine(ctx, m, fxTime);
    }

    for (const p of weapons.projectiles) {
      if (!p.alive) continue;
      drawProjectile(ctx, p, fxTime);
    }

    for (const c of cars) drawCarShadow(ctx, c);
    for (const c of cars) drawCar(ctx, c, fxTime);

    // Sprite boom sheets
    for (const b of boomAnims) {
      const fi = Math.min(sprites.booms.length - 1, Math.floor((b.age / b.life) * sprites.booms.length));
      const img = sprites.booms[fi];
      if (img) {
        const s = 48 + (b.age / b.life) * 24;
        ctx.globalAlpha = Math.max(0, 1 - b.age / b.life);
        ctx.drawImage(img, b.x - s / 2, b.y - s / 2, s, s);
        ctx.globalAlpha = 1;
      }
    }

    for (const p of particles) {
      const a = Math.max(0, p.life / (p.maxLife || 400));
      ctx.globalAlpha = a;
      if (p.ring) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.ringW || 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.r * a), 0, Math.PI * 2);
        ctx.fill();
        // Tight accent only on white sparks — no soft scene blur
        if (p.spark && a > 0.4) {
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.4, p.r * a * 0.35), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    drawMinimap(ctx, track, cars, W, H);
  }

  function drawTrack(ctx, track) {
    // Soft runoff apron outside outer wall (gravel/dirt) — behind asphalt
    ctx.save();
    ctx.beginPath();
    // Expanded outer ring approx via stroked wide path then filled differently:
    // Draw apron as thick stroke centered on outer wall, clipped outside asphalt
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(28, 24, 18, 0.92)';
    ctx.lineWidth = 46;
    strokeLoop(ctx, track.outer);
    ctx.strokeStyle = 'rgba(42, 36, 28, 0.55)';
    ctx.lineWidth = 28;
    strokeLoop(ctx, track.outer);
    // gravel grit
    ctx.strokeStyle = 'rgba(70, 58, 40, 0.25)';
    ctx.lineWidth = 18;
    ctx.setLineDash([3, 7]);
    strokeLoop(ctx, track.outer);
    ctx.setLineDash([]);
    ctx.restore();

    // Warm asphalt plate
    ctx.beginPath();
    pathPoly(ctx, track.outer);
    const asphaltGrad = ctx.createLinearGradient(0, 0, track.width, track.height);
    asphaltGrad.addColorStop(0, track.asphalt);
    asphaltGrad.addColorStop(0.5, shade(track.asphalt, -8));
    asphaltGrad.addColorStop(1, shade(track.asphalt, 4));
    ctx.fillStyle = asphaltGrad;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    pathPoly(ctx, track.outer);
    ctx.clip();
    // Subtle asphalt grit
    ctx.fillStyle = 'rgba(255,255,255,0.028)';
    for (let y = 0; y < track.height; y += 17) {
      for (let x = (y % 34); x < track.width; x += 23) {
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.045)';
    for (let y = 8; y < track.height; y += 29) {
      for (let x = 11; x < track.width; x += 31) {
        ctx.fillRect(x, y, 2, 1);
      }
    }

    // Worn racing groove — lighter rubber band along racing line
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 34;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    pathPoly(ctx, track.line);
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(220, 210, 190, 0.11)';
    ctx.lineWidth = 18;
    ctx.beginPath();
    pathPoly(ctx, track.line);
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    pathPoly(ctx, track.line);
    ctx.closePath();
    ctx.stroke();

    // Dual lane dashes (subtle)
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2.2;
    ctx.setLineDash([18, 16]);
    ctx.beginPath();
    pathPoly(ctx, track.line);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // Soft curb shadow along walls (inside track)
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 10;
    strokeLoop(ctx, track.outer);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 8;
    strokeLoop(ctx, track.inner);
    ctx.restore();

    // infield — industrial yard / parking plate (not dead black)
    drawInfieldYard(ctx, track);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Red/white (or accent) block kerbs on INNER apexes
    drawBlockKerbs(ctx, track);

    // Outer edge: soft cyan dashed safety glow only (no solid editor outline)
    ctx.strokeStyle = 'rgba(18, 22, 28, 0.95)'; // dark physical rail
    ctx.lineWidth = 5;
    strokeLoop(ctx, track.outer);
    ctx.strokeStyle = hexAlpha(track.wall, 0.2);
    ctx.lineWidth = 11;
    strokeLoop(ctx, track.outer);
    ctx.save();
    ctx.setLineDash([5, 10]);
    ctx.strokeStyle = hexAlpha(track.wall, 0.55);
    ctx.lineWidth = 2.4;
    strokeLoop(ctx, track.outer);
    ctx.setLineDash([]);
    ctx.restore();

    // Inner wall: subdued rail under block kerbs
    ctx.strokeStyle = hexAlpha(track.wall, 0.55);
    ctx.lineWidth = 2.5;
    strokeLoop(ctx, track.inner);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    strokeLoop(ctx, track.inner);

    // Direction arrows — very quiet once groove + kerbs carry readability
    ctx.fillStyle = hexAlpha(track.accent, 0.06);
    for (let i = 0; i < track.line.length; i += 18) {
      const p = track.line[i];
      const n = track.line[(i + 1) % track.line.length];
      const a = Math.atan2(n.y - p.y, n.x - p.x);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(-3, 3.5);
      ctx.lineTo(-3, -3.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /** Industrial infield: parking plate, seams, low yard marks — loop sits in a yard. */
  function drawInfieldYard(ctx, track) {
    const plate = '#2c3440';
    const plateHi = '#3a4452';
    ctx.beginPath();
    pathPoly(ctx, track.inner);
    const g = ctx.createRadialGradient(
      track.width * 0.5, track.height * 0.48, 40,
      track.width * 0.5, track.height * 0.5, Math.max(track.width, track.height) * 0.35
    );
    g.addColorStop(0, plateHi);
    g.addColorStop(0.55, plate);
    g.addColorStop(1, '#242a34');
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    pathPoly(ctx, track.inner);
    ctx.clip();

    // Concrete panel grid
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < track.width; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, track.height); ctx.stroke();
    }
    for (let y = 0; y < track.height; y += 64) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(track.width, y); ctx.stroke();
    }

    // Parking bay chevrons / stalls (faint)
    ctx.strokeStyle = 'rgba(255,230,0,0.18)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 14]);
    const cx = track.width * 0.5, cy = track.height * 0.5;
    for (let row = -2; row <= 2; row++) {
      const y = cy + row * 48;
      ctx.beginPath();
      ctx.moveTo(cx - 160, y);
      ctx.lineTo(cx + 160, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Stall ticks
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1.5;
    for (let col = -3; col <= 3; col++) {
      const x = cx + col * 42;
      ctx.beginPath();
      ctx.moveTo(x, cy - 110);
      ctx.lineTo(x, cy + 110);
      ctx.stroke();
    }

    // Worn patches
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath(); ctx.ellipse(cx - 70, cy + 30, 55, 28, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 90, cy - 40, 40, 22, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.beginPath(); ctx.ellipse(cx + 20, cy + 60, 70, 18, 0.1, 0, Math.PI * 2); ctx.fill();

    // Hazard tape strips (Gridlock vocabulary)
    ctx.strokeStyle = 'rgba(255,230,0,0.14)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.moveTo(cx - 130, cy - 90);
    ctx.lineTo(cx - 40, cy - 90);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,230,0,0.35)';
    ctx.beginPath();
    ctx.moveTo(cx - 130, cy - 90);
    ctx.lineTo(cx - 40, cy - 90);
    ctx.stroke();
    ctx.setLineDash([]);

    // Low service hut silhouette marks
    ctx.fillStyle = 'rgba(30, 36, 46, 0.85)';
    ctx.fillRect(cx - 30, cy - 20, 70, 36);
    ctx.fillStyle = 'rgba(0,232,255,0.12)';
    ctx.fillRect(cx - 24, cy - 12, 16, 10);
    ctx.fillRect(cx + 4, cy - 12, 16, 10);
    ctx.fillStyle = 'rgba(255,43,214,0.1)';
    ctx.fillRect(cx - 30, cy - 22, 70, 2);

    // Grit
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let y = 40; y < track.height; y += 28) {
      for (let x = 40 + (y % 40); x < track.width; x += 37) {
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    }
    ctx.restore();
  }

  /** Block kerbs along high-curvature / landmark apexes on the inner wall. */
  function drawBlockKerbs(ctx, track) {
    const poly = track.inner;
    if (!poly || poly.length < 4) return;
    const n = poly.length;
    const landmarkIdx = new Set();
    if (track.landmarks) {
      for (const lm of track.landmarks) {
        if (lm.kind !== 'corner' && lm.kind !== 'chicane' && lm.kind !== 'kink') continue;
        let best = 0, bd = Infinity;
        for (let i = 0; i < n; i++) {
          const d = Math.hypot(poly[i].x - lm.x, poly[i].y - lm.y);
          if (d < bd) { bd = d; best = i; }
        }
        for (let k = -2; k <= 5; k++) landmarkIdx.add((best + k + n) % n);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = poly[(i - 1 + n) % n];
      const b = poly[i];
      const c = poly[(i + 1) % n];
      const a0 = Math.atan2(b.y - a.y, b.x - a.x);
      const a1 = Math.atan2(c.y - b.y, c.x - b.x);
      let d = a1 - a0;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const turn = Math.abs(d);
      const force = landmarkIdx.has(i);
      if (turn < 0.04 && !force) continue;
      const edgeLen = Math.hypot(c.x - b.x, c.y - b.y) || 1;
      const blocks = Math.max(2, Math.min(12, Math.floor(edgeLen / 12)));
      const ang = Math.atan2(c.y - b.y, c.x - b.x);
      let ox = Math.cos(ang + Math.PI / 2);
      let oy = Math.sin(ang + Math.PI / 2);
      const cx = track.width * 0.5, cy = track.height * 0.5;
      const mx = (b.x + c.x) * 0.5, my = (b.y + c.y) * 0.5;
      if ((mx - cx) * ox + (my - cy) * oy < 0) { ox = -ox; oy = -oy; }
      const intensity = force ? 1 : Math.min(1, turn / 0.28);
      for (let k = 0; k < blocks; k++) {
        const t = (k + 0.5) / blocks;
        const x = b.x + (c.x - b.x) * t + ox * 5;
        const y = b.y + (c.y - b.y) * t + oy * 5;
        const light = (k % 2 === 0);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.globalAlpha = 0.7 + 0.3 * intensity;
        ctx.fillStyle = light ? '#f2f2f2' : '#d0122a';
        ctx.fillRect(-6.5, -3.8, 13, 7.5);
        ctx.restore();
      }
    }
  }

  function strokeLoop(ctx, poly) {
    ctx.beginPath();
    pathPoly(ctx, poly);
    ctx.closePath();
    ctx.stroke();
  }

  function pathPoly(ctx, poly) {
    if (!poly.length) return;
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
  }


  function drawStartGantryOnly(ctx, track) {
    const line = track.line;
    if (!line || !line.length) return;
    const idx = (typeof track.startIndex === 'number')
      ? ((track.startIndex % line.length) + line.length) % line.length
      : 0;
    const p = line[idx];
    if (!p) return;
    const p1 = line[(idx + 1) % line.length] || p;
    const heading = Math.atan2(p1.y - p.y, p1.x - p.x);
    const s = track.spawns && track.spawns[0];
    const ang = (s && s.angle != null) ? s.angle : heading;
    drawGantry(ctx, track, p, ang);
  }

  function drawStartLine(ctx, track) {
    const line = track.line;
    const idx = (typeof track.startIndex === 'number')
      ? ((track.startIndex % line.length) + line.length) % line.length
      : 0;
    const p = line[idx] || (track.spawns && track.spawns[0]);
    if (!p) return;
    const p1 = line[(idx + 1) % line.length] || p;
    const heading = Math.atan2(p1.y - p.y, p1.x - p.x);
    const s = track.spawns && track.spawns[0] ? track.spawns[0] : p;
    const ang = (s.angle != null) ? s.angle : heading;

    // Chequer band across track at start/finish
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang + Math.PI / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-56, -16, 112, 32);
    for (let i = -7; i < 8; i++) {
      for (let j = 0; j < 3; j++) {
        ctx.fillStyle = ((i + j) & 1) ? 'rgba(245,245,245,0.92)' : 'rgba(12,12,14,0.9)';
        ctx.fillRect(i * 8, j * 8 - 12, 8, 8);
      }
    }
    ctx.fillStyle = hexAlpha(track.accent || '#ff2bd6', 0.7);
    ctx.fillRect(-56, -17, 112, 2);
    ctx.fillRect(-56, 12, 112, 2);
    ctx.restore();

    // Simple gantry: 2 posts + crossbar spanning near startIndex
    drawGantry(ctx, track, p, ang);
  }

  function drawGantry(ctx, track, p, ang) {
    const lx = -Math.sin(ang), ly = Math.cos(ang);
    const half = 92;
    const postH = 68;
    const ax = p.x + lx * half;
    const ay = p.y + ly * half;
    const bx = p.x - lx * half;
    const by = p.y - ly * half;
    // Slight foreshortening so posts read in top-down
    const topA = { x: ax - lx * 4, y: ay - postH };
    const topB = { x: bx + lx * 4, y: by - postH };
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(ax, ay + 2, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bx, by + 2, 8, 4, 0, 0, Math.PI * 2); ctx.fill();
    // Posts as thick uprights
    ctx.strokeStyle = '#9aa3b0';
    ctx.lineWidth = 7;
    ctx.lineCap = 'square';
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(topA.x, topA.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(topB.x, topB.y); ctx.stroke();
    ctx.strokeStyle = '#dce2ec';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(ax + 2, ay); ctx.lineTo(topA.x + 2, topA.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + 2, by); ctx.lineTo(topB.x + 2, topB.y); ctx.stroke();
    // Crossbar
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(topA.x, topA.y + 2); ctx.lineTo(topB.x, topB.y + 2); ctx.stroke();
    ctx.strokeStyle = '#e8ecf4';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(topA.x, topA.y); ctx.lineTo(topB.x, topB.y); ctx.stroke();
    // Neon lights on bar
    ctx.fillStyle = hexAlpha(track.wall || '#00e8ff', 0.95);
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = topA.x + (topB.x - topA.x) * t;
      const y = topA.y + (topB.y - topA.y) * t;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = hexAlpha(track.accent || '#ff2bd6', 0.55);
    ctx.beginPath(); ctx.arc((topA.x + topB.x) * 0.5, topA.y - 5, 3.5, 0, Math.PI * 2); ctx.fill();
    // Banner strip
    ctx.fillStyle = 'rgba(12,16,24,0.75)';
    const midY = topA.y + 8;
    ctx.fillRect(Math.min(topA.x, topB.x) + 12, midY, Math.abs(topB.x - topA.x) - 24, 10);
    ctx.fillStyle = hexAlpha(track.wall || '#00e8ff', 0.35);
    ctx.fillRect(Math.min(topA.x, topB.x) + 12, midY, Math.abs(topB.x - topA.x) - 24, 2);
  }

  function drawMine(ctx, m, t) {
    const img = m.armed
      ? sprites.mines[Math.floor((t * 0.012) % sprites.mines.length)]
      : (sprites.mines.unarmed || sprites.mines[0]);
    if (img) {
      const s = 22;
      ctx.drawImage(img, m.x - s / 2, m.y - s / 2, s, s);
      return;
    }
    // fallback vector
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.fillStyle = m.armed ? '#ff2244' : '#5a4828';
    ctx.beginPath();
    ctx.arc(0, 0, m.r || 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawProjectile(ctx, p, t) {
    const type = p.type === 'super' ? 'super' : p.homing ? 'homing' : 'front';
    const frames = sprites.projectiles[type] || sprites.projectiles.front;
    const fi = sprites.carFrameIndex(p.angle);
    const img = frames[fi];
    if (img) {
      const s = 28;
      ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
      return;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#ff8a00';
    ctx.fillRect(-8, -3, 16, 6);
    ctx.restore();
  }

  function drawCarShadow(ctx, c) {
    // Soft ground blob only — body shadow is baked into car sprite
    if (c.dead) return;
    ctx.save();
    ctx.translate(c.x + 3, c.y + 5);
    ctx.rotate(c.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 18, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function angularBody(ctx, x, y, w, h) {
    ctx.beginPath();
    ctx.moveTo(x + w * 0.92, y + h * 0.2);
    ctx.lineTo(x + w, y + h * 0.5);
    ctx.lineTo(x + w * 0.92, y + h * 0.8);
    ctx.lineTo(x + w * 0.55, y + h);
    ctx.lineTo(x + w * 0.1, y + h * 0.92);
    ctx.lineTo(x, y + h * 0.72);
    ctx.lineTo(x, y + h * 0.28);
    ctx.lineTo(x + w * 0.1, y + h * 0.08);
    ctx.lineTo(x + w * 0.55, y);
    ctx.closePath();
  }

  function drawCar(ctx, c, t) {
    ctx.save();
    ctx.translate(c.x, c.y);
    if (c.dead) ctx.globalAlpha = 0.4;

    const tier = Math.min(4, (c.engine | 0) + (c.ram | 0));
    const frames = sprites.getCarFrames(c.color, tier, !!c.isPlayer);
    const fi = sprites.carFrameIndex(c.angle);
    const img = frames[fi];
    const drawW = 48, drawH = 48;
    if (img) {
      // Sprites already include rotation — no ctx.rotate
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.imageSmoothingEnabled = false;
    } else {
      // Fallback vector
      ctx.rotate(c.angle);
      ctx.fillStyle = c.color;
      angularBody(ctx, -18, -12, 36, 24);
      ctx.fill();
      ctx.rotate(-c.angle);
    }

    // Nitro flame (still vector — dynamic)
    if (c.nitroTimer > 0) {
      ctx.save();
      ctx.rotate(c.angle);
      const flick = 0.78 + 0.22 * Math.sin(t * 0.05);
      ctx.globalAlpha = flick * (c.dead ? 0.4 : 1);
      const len = 22 + 6 * Math.sin(t * 0.07);
      const grd = ctx.createLinearGradient(-18, 0, -18 - len, 0);
      grd.addColorStop(0, 'rgba(255,43,214,0.95)');
      grd.addColorStop(0.45, 'rgba(0,232,255,0.7)');
      grd.addColorStop(1, 'rgba(184,255,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(-18, -8);
      ctx.lineTo(-18 - len, 0);
      ctx.lineTo(-18, 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = c.dead ? 0.4 : 1;
    }

    // HP bar (screen-aligned)
    const pct = Math.max(0, c.hp / c.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    roundRect(ctx, -16, -27, 32, 6, 1);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    roundRect(ctx, -16, -27, 32, 6, 1);
    ctx.stroke();
    ctx.fillStyle = hpColor(c.hp, c.maxHp);
    if (pct > 0.02) {
      roundRect(ctx, -16, -27, 32 * pct, 6, 1);
      ctx.fill();
    }
    if (pct < 0.35) {
      ctx.fillStyle = '#ffe600';
      ctx.fillRect(-16 + 32 * pct - 1, -28, 2, 8);
    }

    if (c.isPlayer) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, 27, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,43,214,0.35)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 27, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,232,255,0.28)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 31, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (w <= 0 || h <= 0) return;
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawMinimap(ctx, track, cars, W, H) {
    const mw = 150, mh = 96;
    const ox = W - mw - 14, oy = H - mh - 14;
    ctx.save();
    ctx.fillStyle = 'rgba(8, 10, 14, 0.9)';
    roundRect(ctx, ox - 6, oy - 6, mw + 12, mh + 12, 4);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(ox - 6, oy - 6, mw + 12, 5);
    ctx.fillStyle = '#ffe600';
    for (let i = 0; i < mw + 12; i += 10) {
      ctx.fillRect(ox - 6 + i, oy - 6, 5, 5);
    }
    ctx.strokeStyle = 'rgba(74, 80, 96, 0.95)';
    ctx.lineWidth = 2;
    roundRect(ctx, ox - 6, oy - 6, mw + 12, mh + 12, 4);
    ctx.stroke();

    const sx = mw / track.width, sy = mh / track.height;
    ctx.beginPath();
    track.outer.forEach((p, i) => {
      const x = ox + p.x * sx, y = oy + p.y * sy;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = track.wall;
    ctx.lineWidth = 1.75;
    ctx.stroke();

    // inner ring on minimap
    ctx.beginPath();
    track.inner.forEach((p, i) => {
      const x = ox + p.x * sx, y = oy + p.y * sy;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = hexAlpha(track.wall, 0.45);
    ctx.lineWidth = 1;
    ctx.stroke();

    for (const c of cars) {
      if (c.dead) ctx.globalAlpha = 0.35;
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(ox + c.x * sx, oy + c.y * sy, c.isPlayer ? 3.8 : 2.4, 0, Math.PI * 2);
      ctx.fill();
      if (c.isPlayer) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawCountdown(ctx, text, W, H, opts = {}) {
    ctx.save();
    const flash = !!opts.flash || text === 'GO';
    ctx.fillStyle = flash ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, 0, W, H);

    const pulse = flash ? 1.08 + 0.06 * Math.sin((opts.t || 0) * 0.02) : 1;
    const size = (text === 'GO' ? 92 : 86) * pulse;
    ctx.font = `400 ${size}px "Black Ops One", Impact, "Arial Black", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Hazard flash bars
    if (flash) {
      ctx.fillStyle = 'rgba(184,255,0,0.12)';
      ctx.fillRect(0, H * 0.35, W, H * 0.3);
    }

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(text, W / 2 + 5, H / 2 + 5);
    ctx.fillStyle = '#ff2bd6';
    ctx.fillText(text, W / 2 - 3, H / 2);
    ctx.fillStyle = flash ? '#b8ff00' : '#00e8ff';
    ctx.fillText(text, W / 2, H / 2);

    // Thin neon ring
    ctx.strokeStyle = flash ? 'rgba(184,255,0,0.55)' : 'rgba(0,232,255,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 70 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  return { resize, draw, addBoom, drawCountdown, canvas, ctx };
}

function shade(hex, amt) {
  const c = hex.replace('#', '');
  if (c.length < 6) return hex;
  const n = parseInt(c, 16);
  let r = (n >> 16) + amt;
  let g = ((n >> 8) & 0xff) + amt;
  let b = (n & 0xff) + amt;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function hexAlpha(hex, a) {
  const c = hex.replace('#', '');
  if (c.length < 6) return hex;
  const n = parseInt(c, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}
