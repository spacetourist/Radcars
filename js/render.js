import { WEAPON_LABELS } from './weapons.js';
import { hpColor } from './util.js';

/** HD remaster renderer: industrial arena, angular cars, visceral FX. */
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

  function addBoom(x, y, color = '#ff8a00') {
    // core fireball spray
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.1 + Math.random() * 3.4;
      const hot = i % 4;
      const col = hot === 0 ? '#ffffff'
        : hot === 1 ? '#ffe600'
        : hot === 2 ? '#ff8a00'
        : color;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 320 + Math.random() * 380,
        maxLife: 700,
        color: col,
        r: 3 + Math.random() * 6,
        spark: hot === 0
      });
    }
    // secondary debris chunks
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 2.2;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 400 + Math.random() * 400,
        maxLife: 800,
        color: i % 2 ? '#ff2bd6' : '#00e8ff',
        r: 1.5 + Math.random() * 2.5,
        spark: true
      });
    }
    // flash rings
    particles.push({
      x, y, vx: 0, vy: 0,
      life: 200, maxLife: 200,
      color: '#ffffff',
      r: 10, ring: true
    });
    particles.push({
      x, y, vx: 0, vy: 0,
      life: 280, maxLife: 280,
      color: '#ff8a00',
      r: 6, ring: true
    });
    particles.push({
      x, y, vx: 0, vy: 0,
      life: 160, maxLife: 160,
      color: '#ff2bd6',
      r: 4, ring: true, ringW: 2
    });
    shake = Math.min(14, shake + 5.5);
  }

  function stepParticles(dt) {
    for (const p of particles) {
      p.life -= dt;
      if (!p.ring) {
        p.x += p.vx * dt * 0.055;
        p.y += p.vy * dt * 0.055;
        p.vx *= 0.965;
        p.vy *= 0.965;
        p.vy -= 0.0025 * dt;
      } else {
        p.r += dt * (p.ringW ? 0.16 : 0.14);
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life <= 0) particles.splice(i, 1);
    }
    shake *= Math.pow(0.86, dt / 16);
  }

  function draw(world) {
    const { track, cars, weapons, cam } = world;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    stepParticles(world.dt || 16);

    ctx.save();
    // arena floor: dark industrial void
    const floor = ctx.createRadialGradient(W * 0.5, H * 0.45, 40, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
    floor.addColorStop(0, track.bg);
    floor.addColorStop(1, '#050608');
    ctx.fillStyle = floor;
    ctx.fillRect(0, 0, W, H);

    const sx = shake * (Math.random() - 0.5) * 0.7;
    const sy = shake * (Math.random() - 0.5) * 0.7;
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

    for (const c of cars) drawCarShadow(ctx, c);
    for (const c of cars) drawCar(ctx, c);

    for (const p of particles) {
      const a = Math.max(0, p.life / (p.maxLife || 400));
      ctx.globalAlpha = a;
      if (p.ring) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.ringW || 3.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        if (p.spark) {
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 8;
        }
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * a, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    drawMinimap(ctx, track, cars, W, H);
  }

  function drawTrack(ctx, track) {
    // dark asphalt plate
    ctx.beginPath();
    pathPoly(ctx, track.outer);
    const asphaltGrad = ctx.createLinearGradient(0, 0, track.width, track.height);
    asphaltGrad.addColorStop(0, track.asphalt);
    asphaltGrad.addColorStop(0.5, shade(track.asphalt, -8));
    asphaltGrad.addColorStop(1, track.asphalt);
    ctx.fillStyle = asphaltGrad;
    ctx.fill();

    // asphalt grain + lane wear
    ctx.save();
    ctx.beginPath();
    pathPoly(ctx, track.outer);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 18;
    ctx.beginPath();
    pathPoly(ctx, track.line);
    ctx.stroke();
    // faint hazard dashes along racing line
    ctx.strokeStyle = hexAlpha(track.accent, 0.12);
    ctx.lineWidth = 3;
    ctx.setLineDash([16, 22]);
    ctx.beginPath();
    pathPoly(ctx, track.line);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // infield — metal pit / void
    ctx.beginPath();
    pathPoly(ctx, track.inner);
    ctx.fillStyle = shade(track.bg, -10);
    ctx.fill();
    // infield panel hatch
    ctx.save();
    ctx.beginPath();
    pathPoly(ctx, track.inner);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,230,0,0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < track.width; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + track.height, track.height);
      ctx.stroke();
    }
    ctx.restore();

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // neon barrier glow
    ctx.strokeStyle = track.wall + '66';
    ctx.lineWidth = 16;
    strokeLoop(ctx, track.outer);
    strokeLoop(ctx, track.inner);

    // hazard stripe underlay on barriers
    ctx.save();
    ctx.lineWidth = 9;
    ctx.strokeStyle = '#111111';
    strokeLoop(ctx, track.outer);
    strokeLoop(ctx, track.inner);
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = '#ffe600';
    ctx.globalAlpha = 0.55;
    strokeLoop(ctx, track.outer);
    strokeLoop(ctx, track.inner);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.restore();

    // solid neon barrier
    ctx.strokeStyle = track.wall;
    ctx.lineWidth = 4.5;
    strokeLoop(ctx, track.outer);
    strokeLoop(ctx, track.inner);

    // highlight edge
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1.25;
    strokeLoop(ctx, track.outer);
    strokeLoop(ctx, track.inner);

    // racing line dashed
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 14]);
    ctx.beginPath();
    pathPoly(ctx, track.line);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // chevrons
    ctx.fillStyle = hexAlpha(track.accent, 0.35);
    for (let i = 0; i < track.line.length; i += 7) {
      const p = track.line[i];
      const n = track.line[(i + 1) % track.line.length];
      const a = Math.atan2(n.y - p.y, n.x - p.x);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-6, 7);
      ctx.lineTo(-6, -7);
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
        ctx.fillStyle = ((i + j) & 1) ? 'rgba(255,230,0,0.75)' : 'rgba(0,0,0,0.7)';
        ctx.fillRect(i * 9, j * 10 - 10, 9, 10);
      }
    }
    ctx.restore();
  }

  function drawMine(ctx, m) {
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.shadowColor = m.armed ? 'rgba(255,34,68,0.85)' : 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = m.armed ? 14 : 4;
    // spiked disc
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 === 0 ? m.r + 3 : m.r - 1;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = m.armed ? '#ff2244' : '#5a4828';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (m.armed) {
      ctx.fillStyle = '#ffe600';
      ctx.shadowColor = '#ffe600';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  function drawProjectile(ctx, p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    const col = p.type === 'super' ? '#ffe600' : p.homing ? '#ff2bd6' : '#ff8a00';
    ctx.shadowColor = col;
    ctx.shadowBlur = 16;
    // elongated rocket body
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(4, -4.5);
    ctx.lineTo(-10, -3.5);
    ctx.lineTo(-10, 3.5);
    ctx.lineTo(4, 4.5);
    ctx.closePath();
    ctx.fill();
    // tip glow
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(5, -3);
    ctx.lineTo(5, 3);
    ctx.fill();
    // fins
    ctx.fillStyle = shade(col, -40);
    ctx.fillRect(-10, -6, 5, 2.5);
    ctx.fillRect(-10, 3.5, 5, 2.5);
    // trail flare
    ctx.shadowBlur = 0;
    const grd = ctx.createLinearGradient(-10, 0, -28, 0);
    grd.addColorStop(0, col);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(-10, -2.5);
    ctx.lineTo(-26 - Math.random() * 6, 0);
    ctx.lineTo(-10, 2.5);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawCarShadow(ctx, c) {
    if (c.dead) return;
    ctx.save();
    ctx.translate(c.x + 3, c.y + 5);
    ctx.rotate(c.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    angularBody(ctx, -18, -12, 36, 24);
    ctx.fill();
    ctx.restore();
  }

  function angularBody(ctx, x, y, w, h) {
    // wedge / bodykit silhouette
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

  function drawCar(ctx, c) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    if (c.dead) ctx.globalAlpha = 0.4;

    const glow = c.isPlayer ? 'rgba(0,232,255,0.45)' : hexAlpha(c.color, 0.35);
    ctx.shadowColor = glow;
    ctx.shadowBlur = c.isPlayer ? 12 : 6;

    // main angular body
    ctx.fillStyle = c.color;
    angularBody(ctx, -18, -12, 36, 24);
    ctx.fill();
    ctx.shadowBlur = 0;

    // dark underbody / skirts
    ctx.fillStyle = shade(c.color, -45);
    ctx.beginPath();
    ctx.moveTo(-14, -13.5);
    ctx.lineTo(8, -13.5);
    ctx.lineTo(6, -11);
    ctx.lineTo(-12, -11);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-14, 13.5);
    ctx.lineTo(8, 13.5);
    ctx.lineTo(6, 11);
    ctx.lineTo(-12, 11);
    ctx.closePath();
    ctx.fill();

    // cabin canopy
    ctx.fillStyle = 'rgba(10, 14, 22, 0.92)';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(12, -5.5);
    ctx.lineTo(12, 5.5);
    ctx.lineTo(0, 7);
    ctx.lineTo(-4, 5);
    ctx.lineTo(-4, -5);
    ctx.closePath();
    ctx.fill();
    // glass gleam
    ctx.fillStyle = 'rgba(0, 232, 255, 0.22)';
    ctx.beginPath();
    ctx.moveTo(2, -4.5);
    ctx.lineTo(10, -3.5);
    ctx.lineTo(10, 3.5);
    ctx.lineTo(2, 4.5);
    ctx.closePath();
    ctx.fill();

    // aggressive nose / bumper
    ctx.fillStyle = shade(c.color, 35);
    ctx.beginPath();
    ctx.moveTo(14, -5);
    ctx.lineTo(19, 0);
    ctx.lineTo(14, 5);
    ctx.lineTo(11, 4);
    ctx.lineTo(11, -4);
    ctx.closePath();
    ctx.fill();

    // headlight glow
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#00e8ff';
    ctx.shadowBlur = 8;
    ctx.fillRect(15, -3.5, 3, 2.2);
    ctx.fillRect(15, 1.3, 3, 2.2);
    ctx.shadowBlur = 0;

    // rear wing / spoiler (chunky)
    ctx.fillStyle = shade(c.color, -55);
    ctx.fillRect(-19, -10, 5, 20);
    ctx.fillRect(-21, -11, 9, 3);
    ctx.fillRect(-21, 8, 9, 3);
    // neon accent stripe on spoiler
    ctx.fillStyle = c.isPlayer ? '#ff2bd6' : '#b8ff00';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(-18.5, -9, 2, 18);
    ctx.globalAlpha = c.dead ? 0.4 : 1;

    // side neon accent line
    ctx.strokeStyle = c.isPlayer ? 'rgba(0,232,255,0.7)' : hexAlpha(c.color, 0.55);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-10, -10.5);
    ctx.lineTo(10, -10.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-10, 10.5);
    ctx.lineTo(10, 10.5);
    ctx.stroke();

    // outline
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.35;
    angularBody(ctx, -18, -12, 36, 24);
    ctx.stroke();

    if (c.nitroTimer > 0) {
      const flicker = 0.75 + Math.random() * 0.25;
      ctx.globalAlpha = flicker;
      const grd = ctx.createLinearGradient(-18, 0, -42, 0);
      grd.addColorStop(0, 'rgba(255,43,214,0.95)');
      grd.addColorStop(0.45, 'rgba(0,232,255,0.7)');
      grd.addColorStop(1, 'rgba(184,255,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(-18, -8);
      ctx.lineTo(-40 - Math.random() * 8, 0);
      ctx.lineTo(-18, 8);
      ctx.closePath();
      ctx.fill();
      // extra spark jets
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = flicker * 0.6;
      ctx.beginPath();
      ctx.arc(-28 - Math.random() * 4, (Math.random() - 0.5) * 6, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = c.dead ? 0.4 : 1;
    }

    // HP bar
    ctx.rotate(-c.angle);
    const pct = Math.max(0, c.hp / c.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRect(ctx, -15, -26, 30, 5, 1);
    ctx.fill();
    ctx.fillStyle = hpColor(c.hp, c.maxHp);
    roundRect(ctx, -15, -26, 30 * pct, 5, 1);
    ctx.fill();
    // hazard tip on low HP
    if (pct < 0.35) {
      ctx.fillStyle = '#ffe600';
      ctx.fillRect(-15 + 30 * pct - 1, -27, 2, 7);
    }

    if (c.isPlayer) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,43,214,0.4)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,232,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
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
    ctx.fillStyle = 'rgba(8, 10, 14, 0.88)';
    roundRect(ctx, ox - 6, oy - 6, mw + 12, mh + 12, 4);
    ctx.fill();
    // hazard top strip on minimap bezel
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
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);
    ctx.font = '400 78px "Black Ops One", Impact, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(text, W / 2 + 4, H / 2 + 4);
    ctx.fillStyle = '#ff2bd6';
    ctx.fillText(text, W / 2 - 2, H / 2);
    ctx.fillStyle = '#00e8ff';
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
