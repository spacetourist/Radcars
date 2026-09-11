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
    // dark asphalt plate with subtle texture
    ctx.beginPath();
    pathPoly(ctx, track.outer);
    const asphaltGrad = ctx.createLinearGradient(0, 0, track.width, track.height);
    asphaltGrad.addColorStop(0, track.asphalt);
    asphaltGrad.addColorStop(0.5, shade(track.asphalt, -10));
    asphaltGrad.addColorStop(1, track.asphalt);
    ctx.fillStyle = asphaltGrad;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    pathPoly(ctx, track.outer);
    ctx.clip();
    // Subtle asphalt grit (deterministic pattern, clipped to track)
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let y = 0; y < track.height; y += 17) {
      for (let x = (y % 34); x < track.width; x += 23) {
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    for (let y = 8; y < track.height; y += 29) {
      for (let x = 11; x < track.width; x += 31) {
        ctx.fillRect(x, y, 2, 1);
      }
    }
    // Outer lane edge (wear / rubber)
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 22;
    ctx.beginPath();
    pathPoly(ctx, track.line);
    ctx.stroke();

    // Dual lane dashes
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([18, 16]);
    ctx.beginPath();
    pathPoly(ctx, track.line);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // Accent hazard dashes offset from racing line
    ctx.strokeStyle = hexAlpha(track.accent, 0.18);
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 28]);
    ctx.beginPath();
    pathPoly(ctx, track.line);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // Soft curb shadow along outer wall (inside track)
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 10;
    strokeLoop(ctx, track.outer);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 8;
    strokeLoop(ctx, track.inner);
    ctx.restore();

    // infield — metal pit / void
    ctx.beginPath();
    pathPoly(ctx, track.inner);
    ctx.fillStyle = shade(track.bg, -10);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    pathPoly(ctx, track.inner);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,230,0,0.045)';
    ctx.lineWidth = 1;
    for (let x = 0; x < track.width; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + track.height, track.height);
      ctx.stroke();
    }
    // infield panel dots
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = 40; y < track.height; y += 56) {
      for (let x = 40; x < track.width; x += 56) {
        ctx.fillRect(x, y, 2, 2);
      }
    }
    ctx.restore();

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Controlled neon barrier glow (thin, not full-scene blur)
    ctx.strokeStyle = track.wall + '55';
    ctx.lineWidth = 11;
    strokeLoop(ctx, track.outer);
    strokeLoop(ctx, track.inner);

    // hazard stripe underlay
    ctx.save();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#111111';
    strokeLoop(ctx, track.outer);
    strokeLoop(ctx, track.inner);
    ctx.setLineDash([9, 9]);
    ctx.strokeStyle = '#ffe600';
    ctx.globalAlpha = 0.6;
    strokeLoop(ctx, track.outer);
    strokeLoop(ctx, track.inner);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.restore();

    // solid neon barrier
    ctx.strokeStyle = track.wall;
    ctx.lineWidth = 4;
    strokeLoop(ctx, track.outer);
    strokeLoop(ctx, track.inner);

    // crisp highlight edge
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.1;
    strokeLoop(ctx, track.outer);
    strokeLoop(ctx, track.inner);

    // chevrons along racing line
    ctx.fillStyle = hexAlpha(track.accent, 0.4);
    for (let i = 0; i < track.line.length; i += 6) {
      const p = track.line[i];
      const n = track.line[(i + 1) % track.line.length];
      const a = Math.atan2(n.y - p.y, n.x - p.x);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(-5, 6);
      ctx.lineTo(-5, -6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Corner hazard marks (static — no flicker)
    ctx.fillStyle = hexAlpha(track.accent, 0.22);
    for (let i = 0; i < track.line.length; i += 11) {
      const p = track.line[i];
      const n = track.line[(i + 1) % track.line.length];
      const a = Math.atan2(n.y - p.y, n.x - p.x);
      const px = Math.cos(a + Math.PI / 2) * 28;
      const py = Math.sin(a + Math.PI / 2) * 28;
      ctx.fillRect(p.x + px - 4, p.y + py - 1.5, 8, 3);
      ctx.fillRect(p.x - px - 4, p.y - py - 1.5, 8, 3);
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

  function drawStartLine(ctx, track) {
    const s = track.spawns[0];
    if (!s) return;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle + Math.PI / 2);
    // Shadow under grid
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(-52, -14, 104, 28);
    // Wider chequered start/finish stripe
    for (let i = -6; i < 7; i++) {
      for (let j = 0; j < 3; j++) {
        ctx.fillStyle = ((i + j) & 1) ? 'rgba(255,230,0,0.9)' : 'rgba(8,8,10,0.88)';
        ctx.fillRect(i * 8, j * 8 - 12, 8, 8);
      }
    }
    // Neon edge rails
    ctx.fillStyle = hexAlpha(track.accent || '#ff2bd6', 0.75);
    ctx.fillRect(-52, -15, 104, 2);
    ctx.fillRect(-52, 12, 104, 2);
    ctx.fillStyle = hexAlpha(track.wall || '#00e8ff', 0.55);
    ctx.fillRect(-52, -17, 104, 1.5);
    ctx.fillRect(-52, 14, 104, 1.5);
    ctx.restore();
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
