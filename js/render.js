import { WEAPON_LABELS } from './weapons.js';
import { hpColor } from './util.js';

/** HD remaster renderer: crisp anti-aliased shapes, soft shadows, arcade palette. */
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  let shake = 0;
  const particles = [];

  function resize(cssW, cssH, dpr) {
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }

  function addBoom(x, y, color = '#ff9a3c') {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * 2.4;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 280 + Math.random() * 320,
        maxLife: 600,
        color: i % 3 === 0 ? '#ffe066' : color,
        r: 2.5 + Math.random() * 4
      });
    }
    // flash ring
    particles.push({
      x, y, vx: 0, vy: 0,
      life: 180, maxLife: 180,
      color: '#ffffff',
      r: 8, ring: true
    });
    shake = Math.min(8, shake + 3.5);
  }

  function stepParticles(dt) {
    for (const p of particles) {
      p.life -= dt;
      if (!p.ring) {
        p.x += p.vx * dt * 0.055;
        p.y += p.vy * dt * 0.055;
        p.vx *= 0.97;
        p.vy *= 0.97;
        p.vy -= 0.002 * dt;
      } else {
        p.r += dt * 0.12;
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life <= 0) particles.splice(i, 1);
    }
    shake *= Math.pow(0.88, dt / 16);
  }

  function draw(world) {
    const { track, cars, weapons, cam } = world;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    stepParticles(world.dt || 16);

    ctx.save();
    ctx.fillStyle = track.bg;
    ctx.fillRect(0, 0, W, H);

    const sx = shake * (Math.random() - 0.5) * 0.6;
    const sy = shake * (Math.random() - 0.5) * 0.6;
    ctx.translate(W / 2 + sx, H / 2 + sy);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    drawTrack(ctx, track);
    drawStartLine(ctx, track);

    for (const m of weapons.mines) {
      if (!m.alive) continue;
      drawMine(ctx, m);
    }

    for (const p of weapons.projectiles) {
      if (!p.alive) continue;
      drawProjectile(ctx, p);
    }

    // soft car shadows first
    for (const c of cars) drawCarShadow(ctx, c);
    for (const c of cars) drawCar(ctx, c);

    for (const p of particles) {
      const a = Math.max(0, p.life / (p.maxLife || 400));
      ctx.globalAlpha = a;
      if (p.ring) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    drawMinimap(ctx, track, cars, W, H);
  }

  function drawTrack(ctx, track) {
    // asphalt with soft inner shadow feel
    ctx.beginPath();
    pathPoly(ctx, track.outer);
    ctx.fillStyle = track.asphalt;
    ctx.fill();

    // subtle asphalt noise bands
    ctx.save();
    ctx.beginPath();
    pathPoly(ctx, track.outer);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 14;
    ctx.beginPath();
    pathPoly(ctx, track.line);
    ctx.stroke();
    ctx.restore();

    // infield
    ctx.beginPath();
    pathPoly(ctx, track.inner);
    ctx.fillStyle = track.bg;
    ctx.fill();

    // clear high-contrast barriers
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // wall outer glow
    ctx.strokeStyle = track.wall + '55';
    ctx.lineWidth = 14;
    strokeLoop(ctx, track.outer);
    strokeLoop(ctx, track.inner);

    // solid barrier
    ctx.strokeStyle = track.wall;
    ctx.lineWidth = 5;
    strokeLoop(ctx, track.outer);
    strokeLoop(ctx, track.inner);

    // inner highlight edge
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.5;
    strokeLoop(ctx, track.outer);
    strokeLoop(ctx, track.inner);

    // racing line
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 14]);
    ctx.beginPath();
    pathPoly(ctx, track.line);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // chevrons
    ctx.fillStyle = hexAlpha(track.accent, 0.28);
    for (let i = 0; i < track.line.length; i += 7) {
      const p = track.line[i];
      const n = track.line[(i + 1) % track.line.length];
      const a = Math.atan2(n.y - p.y, n.x - p.x);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-5, 6);
      ctx.lineTo(-5, -6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
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
    for (let i = -5; i < 6; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = ((i + j) & 1) ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
        ctx.fillRect(i * 9, j * 10 - 10, 9, 10);
      }
    }
    ctx.restore();
  }

  function drawMine(ctx, m) {
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.shadowColor = m.armed ? 'rgba(255,60,80,0.7)' : 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = m.armed ? 10 : 4;
    ctx.beginPath();
    ctx.arc(0, 0, m.r, 0, Math.PI * 2);
    ctx.fillStyle = m.armed ? '#ff3355' : '#6a5530';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (m.armed) {
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawProjectile(ctx, p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    const col = p.type === 'super' ? '#ffe066' : p.homing ? '#ff66dd' : '#ff9a3c';
    ctx.shadowColor = col;
    ctx.shadowBlur = 12;
    // body
    ctx.fillStyle = col;
    roundRect(ctx, -8, -3, 16, 6, 2);
    ctx.fill();
    // tip
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(4, -3);
    ctx.lineTo(4, 3);
    ctx.fill();
    // trail
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = col;
    ctx.fillRect(-18, -1.5, 10, 3);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawCarShadow(ctx, c) {
    if (c.dead) return;
    ctx.save();
    ctx.translate(c.x + 3, c.y + 4);
    ctx.rotate(c.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, -17, -11, 34, 22, 5);
    ctx.fill();
    ctx.restore();
  }

  function drawCar(ctx, c) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    if (c.dead) ctx.globalAlpha = 0.4;

    // chunky silhouette body — smooth HD
    ctx.fillStyle = c.color;
    roundRect(ctx, -17, -11, 34, 22, 5);
    ctx.fill();

    // side skirts
    ctx.fillStyle = shade(c.color, -35);
    ctx.fillRect(-14, -12.5, 22, 2.5);
    ctx.fillRect(-14, 10, 22, 2.5);

    // cabin glass
    ctx.fillStyle = 'rgba(18, 28, 48, 0.9)';
    roundRect(ctx, -1, -7.5, 13, 15, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(140, 200, 255, 0.18)';
    roundRect(ctx, 1, -5.5, 7, 11, 2);
    ctx.fill();

    // nose / bumper
    ctx.fillStyle = shade(c.color, 40);
    roundRect(ctx, 11, -6, 7, 12, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(14, -4, 3, 3);
    ctx.fillRect(14, 1, 3, 3);

    // rear spoiler
    ctx.fillStyle = shade(c.color, -50);
    ctx.fillRect(-18, -9, 4, 18);

    // outline for readibility
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.25;
    roundRect(ctx, -17, -11, 34, 22, 5);
    ctx.stroke();

    if (c.nitroTimer > 0) {
      const flicker = 0.7 + Math.random() * 0.3;
      ctx.globalAlpha = flicker;
      const grd = ctx.createLinearGradient(-17, 0, -36, 0);
      grd.addColorStop(0, 'rgba(180,100,255,0.9)');
      grd.addColorStop(1, 'rgba(180,100,255,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(-17, -7);
      ctx.lineTo(-34 - Math.random() * 6, 0);
      ctx.lineTo(-17, 7);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = c.dead ? 0.4 : 1;
    }

    // HP bar (world-aligned)
    ctx.rotate(-c.angle);
    const pct = Math.max(0, c.hp / c.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, -15, -24, 30, 5, 2);
    ctx.fill();
    ctx.fillStyle = hpColor(c.hp, c.maxHp);
    roundRect(ctx, -15, -24, 30 * pct, 5, 2);
    ctx.fill();

    if (c.isPlayer) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(63,223,255,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function roundRect(ctx, x, y, w, h, r) {
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
    ctx.fillStyle = 'rgba(8, 12, 24, 0.82)';
    roundRect(ctx, ox - 6, oy - 6, mw + 12, mh + 12, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(61, 90, 154, 0.8)';
    ctx.lineWidth = 1.5;
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

    for (const c of cars) {
      if (c.dead) ctx.globalAlpha = 0.35;
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(ox + c.x * sx, oy + c.y * sy, c.isPlayer ? 3.8 : 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawCountdown(ctx, text, W, H) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, 0, W, H);
    ctx.font = '800 72px Trebuchet MS, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(text, W / 2 + 3, H / 2 + 3);
    ctx.fillStyle = '#3fdfff';
    ctx.fillText(text, W / 2, H / 2);
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
