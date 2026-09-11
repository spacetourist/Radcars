# Radcars

Original-branded top-down **combat racer** (PWA) — 90s arcade combat-circuit soul with an HD remaster presentation (crisp canvas, smooth UI, bold limited palette). No third-party track/car IP.

## Quick start

```bash
cd /workspace/radcars
# any static server works (ES modules need http://, not file://)
npx --yes serve -p 4173
# or:
python3 -m http.server 4173
```

Open `http://localhost:4173` in a desktop browser (landscape recommended).

### Android Chrome (PWA)

1. Serve the folder on your LAN (`npx serve` / `python3 -m http.server`) or host it.
2. On the phone, open the URL in **Chrome**.
3. Menu → **Install app** / **Add to Home Screen**.
4. Launch landscape; use on-screen GAS / steer / FIRE / N2O.

### Optional Capacitor APK

```bash
npm init -y
npm i @capacitor/core @capacitor/cli @capacitor/android
npx cap init Radcars com.radcars.app --web-dir .
npx cap add android
npx cap sync android
npx cap open android
```

Build a release APK/AAB from Android Studio. Point `webDir` at this folder (or a `dist/` copy).

## Controls

| Action | Desktop | Touch |
|--------|---------|-------|
| Steer | ← → / A D | Left hold buttons |
| Accelerate | ↑ / W | GAS |
| Brake | ↓ / S | BRK |
| Fire | Space / Enter | FIRE |
| Nitro | N / Shift | N2O |
| Cycle weapon | Q / E | (shop select) |
| Pause | P / Esc | ❚❚ |

## Features

- Top-down closed tracks with wall bounce & car-car contact
- 3–7 AI rivals (racing line, overtaking, weapons, nitro)
- Weapons: front / rear / homing missiles, mines, optional super (max ~3 live)
- Damage, place prizes, garage shop (repair, engine, armour, nitro, ram, ammo)
- Career (unlock tracks) + single race · `localStorage` save
- Mute + procedural beep SFX · offline-capable service worker

## Project layout

```
radcars/
  index.html
  manifest.webmanifest
  sw.js
  README.md
  css/style.css
  icons/
  js/
    main.js      entry + screens wiring
    game.js      race loop
    physics.js   accel / drag / walls / nitro
    tracks.js    4 geometric circuits
    cars.js      entities + checkpoints
    ai.js        rivals
    weapons.js   projectiles / mines
    input.js     keyboard + touch
    render.js    HD canvas draw
    scenery.js   procedural buildings / crowds / skyline
    sprites.js   pre-rendered cars / FX sheets
    shop.js      garage economy
    career.js    save / prizes
    audio.js     beeps
    ui.js        menus / HUD
    util.js      math helpers
```

## Art direction

**HD remaster of a 90s top-down combat racer:** bold arcade palette, chunky car silhouettes, clear barriers, arcade menus — rendered at high resolution with anti-aliased shapes, soft shadows, and smooth UI (not low-res pixel/CRT mush).

**Scenery:** each track gets a painted sky + parallax skyline, industrial ground fill, and layers of pre-rendered buildings (warehouses, towers, neon shops, billboards, chimneys, water towers), props, and original crowd/mechanic sprites packed outside the asphalt — denser on straights and at start/finish. Title screen uses a matching neon skyline backdrop.

## Known gaps / future polish

- AI racing line is waypoint-based (can cut corners on odd geometry)
- No rubber-band difficulty curve beyond per-track stats
- Weapon cycle on touch is garage-only (Q/E on desktop)
- Capacitor project files not pre-generated (notes only)
- Single local player only
