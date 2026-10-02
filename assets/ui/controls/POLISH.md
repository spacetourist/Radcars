# Radcars in-race controls: polish pass v1

Target: `docs/shots/81-controls-kit-mockup.png` (1170×2532 = 390×844 @3x, preview `-preview.png`) and
`docs/shots/81-controls-kit-states.png` (every state, actual size @2x).
Both are **screenshots of the real v53 markup** (`.act`, `.act-vis`, `.act-ring`, `.act-icon`, `.act-badge`, `.act-label`,
`.tc-aim-pad`, `.tc-aim-ring`, `.tc-aim-knob`, `.tc-pause`, `.hud .pill`) with `css/style.css` + the CSS below, and your icons
from `js/icons.js` used as they are. So if you ship this CSS, the game will look like the shots.

## TL;DR: ship it in one line

```html
<!-- index.html, after css/style.css -->
<link rel="stylesheet" href="assets/ui/controls/controls-polish.css">
```

- No JS changes are required. `CONTROL_LAYOUT`, `--d`, `--ac`, `--p`, `data-state`, `.has-badge`, `.pop`, `.pressed` and `#touch-controls.counting` are all used exactly as `js/controls.js` sets them today.
- Optional: add `'assets/ui/controls/controls-polish.css'`, `svg/infinity-badge.svg` and `fonts/BarlowCondensed-ExtraBold-ui.woff2` to the `sw.js` precache list.
- If you'd rather paste it into `css/style.css`, change the two relative URLs to `../assets/ui/controls/fonts/BarlowCondensed-ExtraBold-ui.woff2` and `../assets/ui/controls/svg/infinity-badge.svg`.
- To check it, serve the repo root (`python3 -m http.server 8765 --bind 127.0.0.1`) and open `docs/mockups/81-controls-kit.html` and `docs/mockups/81-controls-kit-states.html`. To re-shoot:
  `node docs/mockups/_shoot81.mjs http://127.0.0.1:8765/docs/mockups/81-controls-kit.html docs/shots/81-controls-kit-mockup.png 390 844 3`

## Files

| Path | What it is |
|---|---|
| `assets/ui/controls/controls-polish.css` | The whole polish layer (about 250 lines). The single source of truth, also copied at the bottom of this file. |
| `assets/ui/controls/svg/infinity-badge.svg` | 28×18 lime ∞ pill (vector). Used as the `.act-badge` background so the ∞ looks the same on every OS font. This is the only SVG chrome, because CSS can't draw a consistent ∞. |
| `assets/ui/controls/fonts/BarlowCondensed-ExtraBold-ui.woff2` | Barlow Condensed ExtraBold, subset to ASCII plus `· – — • ∞` (13 KB). Used for button labels, STEER and the HUD pills. |
| `assets/ui/controls/fonts/OFL.txt` | Font licence (SIL OFL 1.1, free to bundle). |
| `docs/mockups/81-controls-kit.html` | The live target mockup (track background painted with `js/toyart.js` felt, asphalt and cars). |
| `docs/mockups/81-controls-kit-states.html` | The live states sheet. |
| `docs/mockups/_shoot81.mjs` | Puppeteer screenshot helper: `url out w h dpr`. |

Everything else (rings, sheen, bevel, glow, arcs, dashed rim, gradient rim, ticks) is plain CSS: gradients, masks and box-shadow. No PNG button art is needed.

## Chrome anatomy, applied to every disc

Layered from back to front on `.act-vis`. All values are in CSS px, at logical size.

| Layer | Value | Notes |
|---|---|---|
| Drop shadow (sits the disc above the track) | `0 10px 16px -4px rgba(0,0,0,.62), 0 3px 5px rgba(0,0,0,.45)` | `--sh-drop` |
| Outer glow | `0 0 10px ac@78%, 0 0 26px ac@34%` + a `0 0 0 1px rgba(0,0,0,.5)` dark keyline outside the ring | `--sh-glow`; the keyline keeps the ring crisp on bright kerbs |
| Neon ring | `border: 3px solid var(--ac)` (BRAKE 4px) | |
| Hot core line (neon-tube look) | `outline: 1px solid color-mix(ac 45%, #fff); outline-offset: -2px` (BRAKE 1.5px, offset -2.75px) | Outline follows border-radius in Chrome 94+, Safari 16.4+ and Firefox 88+. Older engines just skip it. |
| Inner bevel | `inset 0 0 0 1px rgba(255,255,255,.15)` | Part of `--sh-bevel` |
| Convex underside | `inset 0 -9px 14px -7px rgba(0,0,0,.6)` | Part of `--sh-bevel` |
| Inner neon spill | `inset 0 0 12px ac@22%` | |
| Glass fill | `rgba(8,8,14,.72)` + a dark centre `radial(circle at 50% 42%, rgba(14,16,26,.62) → transparent)` + an accent bounce light `radial(120% 85% at 50% 108%, ac@24% → transparent 58%)` | The dark centre keeps kerbs from showing through behind the icon |
| Top sheen | `.act-vis::before`: `left/right 9%, top 3%, height 48%`, `border-radius: 50% 50% 46% 46% / 64% 64% 36% 36%`, `linear-gradient(180deg, rgba(255,255,255,.20), rgba(255,255,255,.06) 55%, transparent)` | Sits under the icon, so the icon stays crisp |
| Icon | `.act-icon { width: 60%; height: 60%; transform: translateY(calc(var(--d) * -0.1)) }` (BRAKE 56% / -0.085) + `drop-shadow(0 1.5px 1px rgba(0,0,0,.55)) drop-shadow(0 0 5px ac@55%)` | Your icons as they are. Raised so the label fits inside the disc |
| Label (inside the disc, under the icon) | `.act-label { top: calc(50% + var(--d) * .205); font: 800 calc(var(--d) * .15)/1 var(--font-ui); letter-spacing: .07em; color: #f0f0f0; text-shadow: 0 0 6px ac@85%, 0 1px 1px rgba(0,0,0,.9) }` | 64 px disc gives a 9.6 px label; BRAKE gets 13.5 px at top `.215` |

`--font-ui: "Barlow Condensed UI", "Barlow Condensed", "Roboto Condensed", "Arial Narrow", sans-serif`

## States, by the selectors controls.js already toggles

| State | Selector | Look |
|---|---|---|
| READY / HELD | `.act[data-state="ready"\|"held"] .act-vis` | Full chrome above. HELD uses the item colour (`--ac` from `POWER_COLOR`). |
| Ready "pop" | `.act.pop[data-state="ready"] .act-vis::after` | **Replaces** the box-shadow `actPulse` with a 2px ring that scales 1→1.45 and fades out over 0.7s. Uses only transform and opacity, so it runs on the compositor. |
| ACTIVE | `[data-state="active"]` | `scale(1.06)`; fill `radial(circle at 50% 62%, ac+white → ac 46% → ac@52% black)`; brighter sheen (.5); rim becomes a dark accent track `color-mix(ac 40%, #000)`; **countdown = white arc on the rim**: `.act-ring { inset:-3px; conic-gradient(#fff 0 calc(var(--p)*1turn), transparent 0); mask: ring 3px }`; glow `0 0 14px ac, 0 0 34px ac@55%`; label turns `#0c0c12` (dark text reads on cyan and yellow, white doesn't). **The icon keeps its colours**: drop the old `brightness(0) invert(1)`, because your dark outlines read on any accent. |
| USED | `[data-state="used"]` | Fill `#3a3a48`, rim `2px #565668`, no glow, sheen at 45%, icon `opacity .35; filter: grayscale(1)`, label `#a4a9bc` ("NEXT LAP"); **recharge arc on the rim**: `conic(rgba(240,240,240,.62) 0 calc(var(--p)*1turn), transparent 0)` masked to 3px. |
| UNLIMITED | `[data-state="unlimited"]` + `.has-badge` | Rim `transparent`; `.act-ring` = `conic-gradient(#00e8ff, #ff2b6a 33%, #b8ff00 66%, #00e8ff)` masked to 3px and **rotating** (`actSpin 2.4s linear infinite`, a transform, so it's cheap); tri-colour halo `-5px -3px 14px cyan@.6, 5px -2px 14px pink@.55, 0 6px 14px lime@.5`. Badge: `right:-9px; top:-6px; 28×18; background: url(svg/infinity-badge.svg)`; the ∞ text node is kept for accessibility and hidden with `font-size:0`; glow `0 0 8px lime@.85`. Replaces the `actCycle` box-shadow animation. |
| POWER EMPTY | `[data-state="empty"]` | Even 24-dash rim: `repeating-conic-gradient(from -3.5deg, #8a90a4 0 7deg, transparent 7deg 15deg)` masked to 2px (crisper than `border: dashed`); no glow; gift `opacity .35; grayscale(1)`; label `#8a90a4`. |
| DISABLED | `.act.disabled`, `#touch-controls.counting .act` | `opacity: .35` on the whole control. |
| PRESSED (tap feedback) | `.act.pressed` | Existing `scale(.92)` on the disc, now also applied to the label. |

`--p` meaning is unchanged: in **active** it's the fraction left (the arc unwinds clockwise from 12 o'clock); in **used** it's the lap-recharge progress. Arcs are drawn **on** the rim, not outside it, so BOOST and MISSILE (75 px apart) can both be active without their arcs touching.

### BRAKE (`.act-brake`, 100 px)
- Idle: `border 4px #e02020`; fill `radial(circle at 50% 45%, rgba(90,12,16,.90) → rgba(40,6,10,.92))` + red bounce light; glow `0 0 12px red@.8, 0 0 30px red@.36`; core line `1.5px #ff7a7a`; label white with a red glow.
- Pressed (`data-state="active"`): `scale(.94)`; fill `radial(circle at 50% 62%, #ff4a4a → #e02020 48% → #8a0f14)`; rim `#ff9a9a`; glow `0 0 18px rgba(255,40,40,.95), 0 0 42px rgba(255,40,40,.5)`; drop shadow tightened to `0 6px 10px -3px` (it's pushed down); label white with a dark-red shadow.

### STEER (`.tc-aim-pad` 148 px, `.tc-aim-knob` 56 px)
- Ring: `3px #00e8ff` + `outline 1px #9ff8ff, offset -2px`; glass `radial(circle, cyan@.07 → rgba(8,8,14,.62) 72%)` + top sheen; glow `0 0 12px cyan@.65, 0 0 30px cyan@.24`; drop `0 12px 20px -6px rgba(0,0,0,.55)`. Idle opacity **0.7** (was 0.45, which looked washed out).
- `.tc-aim-pad::before`: 4 cardinal ticks + 4 faint diagonals in a 7px band just inside the rim (two `repeating-conic-gradient`s, masked).
- `.active`: opacity 1, rim `#6ff5ff`, glow `16px / 40px`.
- `.tc-aim-ring` guide: `inset 22%`, `1.5px cyan@.32`.
- Knob: rim `3px #f0f0f0`; fill `radial(70% 45% at 50% 18%, white@.38)` + `radial(circle at 50% 62%, #1d2742 → #0d1222)`; drop shadow `0 9px 14px -3px rgba(0,0,0,.7), 0 2px 4px rgba(0,0,0,.5)` + cyan halo `0 0 10px`; `::after` grip ring `inset 30%, 1.5px cyan@.55`.
- Label: `800 11px Barlow Condensed`, `letter-spacing .18em`, `bottom:-19px`, cyan glow.

### PAUSE (`.tc-pause`, 44 px)
`2.5px solid #d0d6e0`, glass plus sheen, bevel, `0 0 10px silver@.5`, drop `0 6px 10px -3px`.

### HUD pills (`.hud .pill`)
Same type as the buttons: `font: 800 16px Barlow Condensed`, `letter-spacing .06em`; glass with a hard 50% gloss line; dark keyline, glow and drop shadow; the key word (LAP / P) is tinted `color-mix(--pc 70%, #fff)` with white numbers; `.pill-pos { gap: .04em }` so it reads "P3/6", not "P 3/6".

### Thumb-zone scrim
`#touch-controls::before`: the bottom 36% gets `linear-gradient(to top, rgba(4,6,12,.58), rgba(4,6,12,.30) 45%, transparent)`. It's free (one static layer) and it's what makes the discs pop over busy felt and kerbs.

## Performance notes (60 fps on mid phones)
- Everything is static paint except: the unlimited rim spin (`transform`, on the compositor), the ready ping (`transform` + `opacity`), and the `--p` arcs (one small conic repaint per 1% step, which `paint()` already throttles).
- No `backdrop-filter`, on purpose: over a WebGL canvas it forces a re-blur every frame. If you want frosted glass on high-end devices only, add `backdrop-filter: blur(6px) saturate(1.2)` to `.act-vis` behind a `@supports` check plus a device-tier flag.
- Removed the box-shadow keyframe animations (`actPulse`, `actCycle`), because they repaint every frame.
- `will-change: transform` is only worth adding to `.tc-aim-knob` (already set).

## Hit areas
Unchanged. `.act` is still the hit box (visual + 12 px, minimum 48); glows and the ∞ badge are visual only. The badge overhangs the disc by 9 px at the top right, still inside the BOOST hit box.

## Caveats
- Labels at 1x (64 px discs) are 9.6 px condensed caps. They're crisp on 2x/3x phones, but on a 1x desktop window they're small; bump `.act-label` to `calc(var(--d) * .16)` there if needed.
- `color-mix()` needs Safari 16.2+ / Chrome 111+ (style.css already uses it).
- The mockup's POS pill is yellow per the brief; in-game, P3 follows `data-place="3"` (bronze `#e0915a`).

---

## Full CSS (same as `controls-polish.css`)

```css
/* ==========================================================================
   Radcars in-race controls: polish layer v1 (Graphic Designer, 2026-10-02)
   Load AFTER css/style.css:
     <link rel="stylesheet" href="assets/ui/controls/controls-polish.css">
   Only restyles the existing v53 markup from js/controls.js / js/ui.js:
     .act > .act-vis > (.act-ring, .act-icon, .act-badge) + .act-label
     .tc-aim-pad > (.tc-aim-ring, .tc-aim-knob, .tc-aim-label), .tc-pause, .hud .pill
   No layout numbers change: CONTROL_LAYOUT still owns positions and --d.
   ========================================================================== */

@font-face {
  font-family: "Barlow Condensed UI";
  src: url("fonts/BarlowCondensed-ExtraBold-ui.woff2") format("woff2");
  font-weight: 800; font-style: normal; font-display: block;
}

:root {
  --font-ui: "Barlow Condensed UI", "Barlow Condensed", "Roboto Condensed", "Arial Narrow", sans-serif;
  --c-void: #0c0c12;
  --c-glass: rgba(8, 8, 14, 0.72);
  --c-used: #3a3a48;
  --c-white: #f0f0f0;
  --c-silver: #d0d6e0;
  /* one ring mask, reused by every arc / dashed / gradient ring (thickness = --rw) */
  --ring-mask: radial-gradient(farthest-side, transparent calc(100% - var(--rw, 3px) - 0.5px), #000 calc(100% - var(--rw, 3px)));
}

/* bottom scrim behind the thumb zone: the felt gets busy there, this makes every disc pop */
#touch-controls::before {
  content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 36%;
  background: linear-gradient(to top, rgba(4, 6, 12, 0.58) 0%, rgba(4, 6, 12, 0.30) 45%, rgba(4, 6, 12, 0) 100%);
  pointer-events: none;
}

/* ---------- action disc: shared chrome (READY look is the default) ---------- */
.act-vis {
  border: 3px solid var(--ac);
  background:
    radial-gradient(120% 85% at 50% 108%, color-mix(in srgb, var(--ac) 24%, transparent) 0%, transparent 58%),
    radial-gradient(circle at 50% 42%, rgba(14, 16, 26, 0.62) 0%, rgba(10, 10, 18, 0.30) 72%, rgba(0, 0, 0, 0) 100%),
    var(--c-glass);
  --sh-drop: 0 10px 16px -4px rgba(0, 0, 0, 0.62), 0 3px 5px rgba(0, 0, 0, 0.45);
  --sh-bevel: inset 0 0 0 1px rgba(255, 255, 255, 0.15), inset 0 -9px 14px -7px rgba(0, 0, 0, 0.6);
  --sh-glow: 0 0 0 1px rgba(0, 0, 0, 0.5), 0 0 10px color-mix(in srgb, var(--ac) 78%, transparent), 0 0 26px color-mix(in srgb, var(--ac) 34%, transparent);
  box-shadow: var(--sh-bevel), inset 0 0 12px color-mix(in srgb, var(--ac) 22%, transparent), var(--sh-glow), var(--sh-drop);
  outline: 1px solid color-mix(in srgb, var(--ac) 45%, #fff); outline-offset: -2px;   /* hot core line = neon-tube look */
}
/* convex top sheen (glass highlight), sits under the icon */
.act-vis::before {
  content: ""; position: absolute; left: 9%; right: 9%; top: 3%; height: 48%;
  border-radius: 50% 50% 46% 46% / 64% 64% 36% 36%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.20) 0%, rgba(255, 255, 255, 0.06) 55%, rgba(255, 255, 255, 0) 100%);
  pointer-events: none;
}
.act-icon {
  position: relative; z-index: 1;
  width: 60%; height: 60%;
  transform: translateY(calc(var(--d) * -0.1));       /* lift the icon so the label fits inside the disc */
}
.act-icon svg {
  filter: drop-shadow(0 1.5px 1px rgba(0, 0, 0, 0.55)) drop-shadow(0 0 5px color-mix(in srgb, var(--ac) 55%, transparent));
}
/* label moves INSIDE the disc, under the icon */
.act-label {
  z-index: 2;
  top: calc(50% + var(--d) * 0.205);
  font: 800 calc(var(--d) * 0.15)/1 var(--font-ui);
  letter-spacing: 0.07em;
  color: var(--c-white);
  text-shadow: 0 0 6px color-mix(in srgb, var(--ac) 85%, transparent), 0 1px 1px rgba(0, 0, 0, 0.9);
  transition: transform 0.08s ease;
}
.act.pressed .act-label { transform: translateX(-50%) scale(0.92); }
.act-ring { inset: -3px; --rw: 3px; }

/* READY / HELD: same chrome, accent = --ac (JS sets the item colour for HELD) */
.act[data-state="ready"] .act-vis, .act[data-state="held"] .act-vis {
  border: 3px solid var(--ac);
  box-shadow: var(--sh-bevel), inset 0 0 12px color-mix(in srgb, var(--ac) 22%, transparent), var(--sh-glow), var(--sh-drop);
}
/* "just became ready": a single neon ping ring instead of animating box-shadow (compositor-only) */
.act.pop[data-state="ready"] .act-vis { animation: none; }
.act.pop[data-state="ready"] .act-vis::after {
  content: ""; position: absolute; inset: -3px; border-radius: 50%; pointer-events: none;
  border: 2px solid var(--ac); animation: actPing 0.7s cubic-bezier(0.2, 0.7, 0.3, 1) 1 forwards;
}
@keyframes actPing { from { transform: scale(1); opacity: 0.95; } to { transform: scale(1.45); opacity: 0; } }

/* ACTIVE: lit accent dome; the rim becomes the countdown: white arc = fraction left (--p) over a dark accent track.
   Drawn ON the rim (not outside it) so BOOST + MISSILE can both be active without their arcs colliding. */
.act[data-state="active"] .act-vis {
  border: 3px solid color-mix(in srgb, var(--ac) 40%, #000);
  transform: scale(1.06);
  background:
    radial-gradient(circle at 50% 62%, color-mix(in srgb, var(--ac) 92%, #fff) 0%, var(--ac) 46%, color-mix(in srgb, var(--ac) 52%, #000) 100%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4), inset 0 -10px 14px -6px rgba(0, 0, 0, 0.42),
    0 0 0 1px rgba(0, 0, 0, 0.5), 0 0 14px var(--ac), 0 0 34px color-mix(in srgb, var(--ac) 55%, transparent), var(--sh-drop);
}
.act[data-state="active"] .act-vis::before { background: linear-gradient(180deg, rgba(255, 255, 255, 0.5) 0%, rgba(255, 255, 255, 0.12) 62%, rgba(255, 255, 255, 0) 100%); }
.act[data-state="active"] .act-icon svg { filter: drop-shadow(0 2px 1.5px rgba(0, 0, 0, 0.45)); } /* keep the full-colour icon: its dark outline reads on any accent */
.act[data-state="active"] .act-label { color: var(--c-void); text-shadow: 0 1px 0 rgba(255, 255, 255, 0.35); }
.act[data-state="active"] .act-ring {
  inset: -3px; --rw: 3px;
  background: conic-gradient(#ffffff 0 calc(var(--p) * 1turn), transparent 0);
  -webkit-mask: var(--ring-mask); mask: var(--ring-mask);
}

/* USED: flat grey puck, faded mono icon, recharge arc drawn ON the rim (--p = lap progress) */
.act[data-state="used"] .act-vis {
  border: 2px solid #565668;
  background: radial-gradient(120% 85% at 50% 108%, rgba(0, 0, 0, 0.22) 0%, rgba(0, 0, 0, 0) 58%), var(--c-used);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 -9px 14px -7px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 0, 0, 0.45), var(--sh-drop);
}
.act[data-state="used"] .act-vis::before { opacity: 0.45; }
.act[data-state="used"] .act-vis, .act[data-state="empty"] .act-vis, .act[data-state="unlimited"] .act-vis { outline: none; }
.act[data-state="active"] .act-vis { outline: none; }
.act[data-state="used"] .act-icon { opacity: 0.35; filter: grayscale(1); }
.act[data-state="used"] .act-icon svg { filter: drop-shadow(0 1.5px 1px rgba(0, 0, 0, 0.5)); }
.act[data-state="used"] .act-ring {
  inset: -2px; --rw: 3px;
  background: conic-gradient(rgba(240, 240, 240, 0.62) 0 calc(var(--p) * 1turn), transparent 0);
  -webkit-mask: var(--ring-mask); mask: var(--ring-mask);
}
.act[data-state="used"] .act-label { color: #a4a9bc; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.9); }

/* UNLIMITED (BOOST while last): cyan→pink→lime gradient rim that spins, tri-colour halo, lime ∞ badge */
.act[data-state="unlimited"] .act-vis {
  animation: none;
  border: 3px solid transparent;
  box-shadow: var(--sh-bevel), inset 0 0 12px rgba(0, 232, 255, 0.22),
    0 0 0 1px rgba(0, 0, 0, 0.5), -5px -3px 14px rgba(0, 232, 255, 0.6), 5px -2px 14px rgba(255, 43, 106, 0.55), 0 6px 14px rgba(184, 255, 0, 0.5), var(--sh-drop);
}
.act[data-state="unlimited"] .act-ring {
  inset: -3px; --rw: 3px;
  background: conic-gradient(from 0deg, #00e8ff, #ff2b6a 33%, #b8ff00 66%, #00e8ff);
  -webkit-mask: var(--ring-mask); mask: var(--ring-mask);
  animation: actSpin 2.4s linear infinite;
}
@keyframes actSpin { to { transform: rotate(1turn); } }
.act-badge {
  z-index: 3; right: -9px; top: -6px; width: 28px; height: 18px; border-radius: 9px;
  background: url("svg/infinity-badge.svg") center / 100% 100% no-repeat;
  font-size: 0; color: transparent;                       /* keep the ∞ text node for a11y, hide the glyph */
  box-shadow: 0 0 8px rgba(184, 255, 0, 0.85), 0 2px 4px rgba(0, 0, 0, 0.6);
}

/* POWER EMPTY: even dashed rim (24 dashes), faded mono gift, no glow */
.act[data-state="empty"] .act-vis {
  border: 2px solid transparent;
  background: var(--c-glass);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 -9px 14px -7px rgba(0, 0, 0, 0.55), var(--sh-drop);
}
.act[data-state="empty"] .act-vis::before { opacity: 0.5; }
.act[data-state="empty"] .act-ring {
  inset: -2px; --rw: 2px;
  background: repeating-conic-gradient(from -3.5deg, #8a90a4 0 7deg, transparent 7deg 15deg);
  -webkit-mask: var(--ring-mask); mask: var(--ring-mask);
}
.act[data-state="empty"] .act-icon { opacity: 0.35; filter: grayscale(1); }
.act[data-state="empty"] .act-icon svg { filter: drop-shadow(0 1.5px 1px rgba(0, 0, 0, 0.5)); }
.act[data-state="empty"] .act-label { color: #8a90a4; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.9); }

/* DISABLED (countdown, or any .act.disabled): whole control at 35% */
.act.disabled, #touch-controls.counting .act, #touch-controls.counting .tc-pause { opacity: 0.35; }

/* ---------- BRAKE (100 px, 4 px rim) ---------- */
.act-brake .act-vis, .act-brake[data-state="ready"] .act-vis {
  border: 4px solid #e02020;
  background:
    radial-gradient(120% 85% at 50% 108%, rgba(224, 32, 32, 0.38) 0%, transparent 58%),
    radial-gradient(circle at 50% 45%, rgba(90, 12, 16, 0.90) 0%, rgba(40, 6, 10, 0.92) 100%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15), inset 0 -12px 18px -8px rgba(0, 0, 0, 0.6), inset 0 0 16px rgba(224, 32, 32, 0.28),
    0 0 0 1px rgba(0, 0, 0, 0.5), 0 0 12px rgba(224, 32, 32, 0.8), 0 0 30px rgba(224, 32, 32, 0.36), var(--sh-drop);
}
.act-brake .act-ring { inset: -4px; }
.act-brake .act-vis { outline: 1.5px solid #ff7a7a; outline-offset: -2.75px; }
.act-brake .act-icon { width: 56%; height: 56%; transform: translateY(calc(var(--d) * -0.085)); }
.act-brake .act-label { font-size: calc(var(--d) * 0.135); top: calc(50% + var(--d) * 0.215); }
.act-brake .act-label { color: var(--c-white); text-shadow: 0 0 7px rgba(255, 50, 50, 0.95), 0 1px 1px rgba(0, 0, 0, 0.9); letter-spacing: 0.09em; }
.act-brake .act-icon svg { filter: drop-shadow(0 2px 1.5px rgba(0, 0, 0, 0.55)) drop-shadow(0 0 6px rgba(255, 60, 60, 0.45)); }
.act-brake[data-state="active"] .act-vis {
  border-color: #ff9a9a;
  transform: scale(0.94);
  background: radial-gradient(circle at 50% 62%, #ff4a4a 0%, #e02020 48%, #8a0f14 100%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35), inset 0 -12px 18px -8px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(0, 0, 0, 0.5), 0 0 18px rgba(255, 40, 40, 0.95), 0 0 42px rgba(255, 40, 40, 0.5), 0 6px 10px -3px rgba(0, 0, 0, 0.6);
}
.act-brake[data-state="active"] .act-vis::before { background: linear-gradient(180deg, rgba(255, 255, 255, 0.42) 0%, rgba(255, 255, 255, 0.1) 62%, rgba(255, 255, 255, 0) 100%); }
.act-brake[data-state="active"] .act-ring { background: none; }
.act-brake[data-state="active"] .act-label { color: #fff; text-shadow: 0 1px 2px rgba(80, 0, 0, 0.9); transform: translateX(-50%) scale(0.94); }

/* ---------- STEER ring (148) + knob (56) ---------- */
.tc-aim-pad {
  border: 3px solid #00e8ff;
  outline: 1px solid #9ff8ff; outline-offset: -2px;
  background:
    radial-gradient(90% 55% at 50% 0%, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0) 70%),
    radial-gradient(circle, rgba(0, 232, 255, 0.07) 0%, rgba(8, 8, 14, 0.62) 72%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.13), inset 0 0 26px rgba(0, 232, 255, 0.16), inset 0 -14px 22px -10px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(0, 0, 0, 0.45), 0 0 12px rgba(0, 232, 255, 0.65), 0 0 30px rgba(0, 232, 255, 0.24), 0 12px 20px -6px rgba(0, 0, 0, 0.55);
  opacity: 0.7;
}
/* 4 cardinal ticks + 4 faint diagonals just inside the rim */
.tc-aim-pad::before {
  content: ""; position: absolute; inset: 6px; border-radius: 50%; pointer-events: none; --rw: 7px;
  background:
    repeating-conic-gradient(from -2deg, rgba(0, 232, 255, 0.75) 0 4deg, transparent 4deg 90deg),
    repeating-conic-gradient(from 44deg, rgba(0, 232, 255, 0.28) 0 2deg, transparent 2deg 90deg);
  -webkit-mask: var(--ring-mask); mask: var(--ring-mask);
}
.tc-aim-pad.active {
  opacity: 1; border-color: #6ff5ff;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18), inset 0 0 30px rgba(0, 232, 255, 0.26), inset 0 -14px 22px -10px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(0, 0, 0, 0.45), 0 0 16px rgba(0, 232, 255, 0.9), 0 0 40px rgba(0, 232, 255, 0.36), 0 12px 20px -6px rgba(0, 0, 0, 0.55);
}
.tc-aim-ring { inset: 22%; border: 1.5px solid rgba(0, 232, 255, 0.32); box-shadow: inset 0 0 10px rgba(0, 232, 255, 0.12); }
.tc-aim-knob {
  border: 3px solid var(--c-white);
  background:
    radial-gradient(70% 45% at 50% 18%, rgba(255, 255, 255, 0.38) 0%, rgba(255, 255, 255, 0) 100%),
    radial-gradient(circle at 50% 62%, #1d2742 0%, #0d1222 100%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18), inset 0 -8px 12px -5px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(0, 0, 0, 0.5), 0 0 10px rgba(0, 232, 255, 0.55), 0 9px 14px -3px rgba(0, 0, 0, 0.7), 0 2px 4px rgba(0, 0, 0, 0.5);
}
.tc-aim-knob::after { /* grip ring */
  content: ""; position: absolute; inset: 30%; border-radius: 50%;
  border: 1.5px solid rgba(0, 232, 255, 0.55); box-shadow: 0 0 6px rgba(0, 232, 255, 0.4);
}
.tc-aim-label {
  bottom: -19px; font: 800 11px/1 var(--font-ui); letter-spacing: 0.18em; color: #00e8ff;
  text-shadow: 0 0 6px rgba(0, 232, 255, 0.8), 0 1px 1px rgba(0, 0, 0, 0.9);
}

/* ---------- PAUSE (44, silver) ---------- */
.tc-pause {
  padding: calc(11px * var(--cs, 1));
  border: 2.5px solid var(--c-silver);
  background: radial-gradient(90% 55% at 50% 0%, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0) 70%), var(--c-glass);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15), inset 0 -6px 10px -5px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(0, 0, 0, 0.5), 0 0 10px rgba(208, 214, 224, 0.5), 0 6px 10px -3px rgba(0, 0, 0, 0.55);
}
.tc-pause svg { filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.5)); }

/* ---------- HUD pills: same glass + type as the buttons ---------- */
.hud { font-family: var(--font-ui); font-weight: 800; font-size: calc(16px * var(--cs, 1)); letter-spacing: 0.06em; }
.hud .pill {
  border-width: 2px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.02) 50%, rgba(255, 255, 255, 0) 51%), var(--c-glass);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.10), inset 0 0 8px color-mix(in srgb, var(--pc) 18%, transparent),
    0 0 0 1px rgba(0, 0, 0, 0.5), 0 0 10px color-mix(in srgb, var(--pc) 55%, transparent), 0 6px 10px -3px rgba(0, 0, 0, 0.55);
  color: color-mix(in srgb, var(--pc) 70%, #fff);
}
.hud .pill strong { color: #fff; font-weight: 800; }
.hud .pill-pos { gap: 0.04em; }
```
