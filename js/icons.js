/**
 * v53 emoji-style icons, drawn as inline SVG vector art (no system emoji fonts, so they look the same on Android, iOS
 * and desktop). Flat colours + a dark outline + a soft highlight, like a modern emoji set. viewBox 0 0 64 64.
 * No gradient ids, so any number of copies can sit on one page.
 */
const O = '#1a1030'; // outline ink
const svg = (body) => `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">${body}</svg>`;

/** A small rocket pointing up-right (🚀 style), drawn in a 64 box; t = transform for re-use. */
const rocket = (t = '', s = 1) => `<g transform="${t}" stroke="${O}" stroke-width="${2.6 / s}" stroke-linejoin="round" stroke-linecap="round">
  <path d="M17 41 C10 44 8 52 7 57 C12 56 20 54 23 47 Z" fill="#ffb020"/><path d="M15 45 C12 47 11 51 11 53 C13 53 17 51 19 48 Z" fill="#ffe600" stroke="none"/>
  <path d="M20 34 L12 33 L8 40 L18 41 Z" fill="#e8213a"/><path d="M30 44 L31 52 L24 56 L23 46 Z" fill="#e8213a"/>
  <path d="M19 45 C21 30 33 13 55 9 C51 31 34 43 19 45 Z" fill="#eef2fa"/>
  <path d="M55 9 C53 15 51 19 49 22 C46 19 45 17 42 15 C46 12 50 10 55 9 Z" fill="#e8213a"/>
  <circle cx="37" cy="27" r="5.4" fill="#36c6ff"/><circle cx="35.6" cy="25.6" r="1.8" fill="#fff" stroke="none"/>
  <path d="M24 40 C27 33 31 27 36 22" fill="none" stroke="#fff" stroke-width="${2.2 / s}" opacity="0.7"/></g>`;

export const ICONS = {
  /** v54.8 DRIFT (GD, assets/drift/drift-icon.svg): a yellow toy car turned 30° with a smoke curl off the rear tyres.
   *  The kind key stays 'brake' so ids / classes / input / layout are unchanged. */
  brake: svg(`<g stroke="#1a1030" stroke-width="2.6"><circle cx="25.5" cy="32.5" r="4.2" fill="#bfc4d6"/><circle cx="19.5" cy="38.5" r="6" fill="#bfc4d6"/><circle cx="39.5" cy="45.5" r="4.2" fill="#bfc4d6"/><circle cx="31.5" cy="50" r="6.2" fill="#bfc4d6"/><circle cx="13.5" cy="47" r="8.6" fill="#bfc4d6"/><circle cx="22.5" cy="53.5" r="6.8" fill="#bfc4d6"/><circle cx="23" cy="44" r="5" fill="#bfc4d6"/></g><g stroke="none"><circle cx="25.5" cy="32.5" r="4.2" fill="#bfc4d6"/><circle cx="19.5" cy="38.5" r="6" fill="#bfc4d6"/><circle cx="39.5" cy="45.5" r="4.2" fill="#bfc4d6"/><circle cx="31.5" cy="50" r="6.2" fill="#bfc4d6"/><circle cx="13.5" cy="47" r="8.6" fill="#bfc4d6"/><circle cx="22.5" cy="53.5" r="6.8" fill="#bfc4d6"/><circle cx="23" cy="44" r="5" fill="#bfc4d6"/><circle cx="24.6" cy="31.2" r="2.3" fill="#eef0f7"/><circle cx="18.6" cy="37.2" r="4.1" fill="#eef0f7"/><circle cx="38.6" cy="44.2" r="2.3" fill="#eef0f7"/><circle cx="30.6" cy="48.7" r="4.3" fill="#eef0f7"/><circle cx="12.6" cy="45.7" r="6.7" fill="#eef0f7"/><circle cx="21.6" cy="52.2" r="4.9" fill="#eef0f7"/><circle cx="22.1" cy="42.7" r="3.1" fill="#eef0f7"/></g><path d="M15.5 44.6 C12.2 43.2 9.6 46.6 11.4 49.4 C13.2 52 17.6 51 17.8 47.6 C18 44.6 15 42.4 12 43.2" fill="none" stroke="#8d93ab" stroke-width="2" stroke-linecap="round"/><path d="M27 49.6 C29.5 51.6 33 51.4 35 49.4" fill="none" stroke="#8d93ab" stroke-width="1.8" stroke-linecap="round"/><path d="M3.5 38.5 C4.8 34.5 8 31.5 12 30.5 M5 58.5 C8 60.2 12 60.4 15.5 59.2" fill="none" stroke="#e4e7f2" stroke-width="2.4" stroke-linecap="round" opacity="0.85"/><g transform="translate(40 25.5) rotate(30) scale(0.94)" stroke="#1a1030" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">
  <rect x="-12.1" y="-13.6" width="4.2" height="8" rx="1.6" fill="#4a4262" stroke-width="2"/><path d="M-10.7 -11.6 L-10.7 -7.6" stroke="#a49cc0" stroke-width="1.3"/><rect x="7.9" y="-13.6" width="4.2" height="8" rx="1.6" fill="#4a4262" stroke-width="2"/><path d="M9.3 -11.6 L9.3 -7.6" stroke="#a49cc0" stroke-width="1.3"/><rect x="-12.1" y="4.8" width="4.2" height="8" rx="1.6" fill="#4a4262" stroke-width="2"/><path d="M-10.7 6.8 L-10.7 10.8" stroke="#a49cc0" stroke-width="1.3"/><rect x="7.9" y="4.8" width="4.2" height="8" rx="1.6" fill="#4a4262" stroke-width="2"/><path d="M9.3 6.8 L9.3 10.8" stroke="#a49cc0" stroke-width="1.3"/>
  <path d="M-7.5 -16.2 Q0 -18.6 7.5 -16.2 Q10 -15.2 10 -11 L10 12.5 Q10 16.8 6 16.8 L-6 16.8 Q-10 16.8 -10 12.5 L-10 -11 Q-10 -15.2 -7.5 -16.2 Z" fill="#ffd21a"/>
  <path d="M6.2 -13.6 Q8.7 -12.8 8.7 -10 L8.7 12.2 Q8.7 15.4 5.6 15.5 Z" fill="#ff9a1f" stroke="none"/>
  <path d="M-7.6 -10.5 L-7.6 10.5" fill="none" stroke="#fff6b0" stroke-width="2.2" opacity="0.9"/>
  <rect x="-1.7" y="-16.6" width="3.4" height="9.4" fill="#ffffff" stroke="none" opacity="0.92"/>
  <rect x="-1.7" y="10.6" width="3.4" height="5.6" fill="#ffffff" stroke="none" opacity="0.92"/>
  <path d="M-7.4 -6.4 L7.4 -6.4 L5.6 -0.6 L-5.6 -0.6 Z" fill="#36c6ff" stroke-width="2"/>
  <path d="M-4.6 -4.6 L-1.2 -4.6" fill="none" stroke="#ffffff" stroke-width="1.6" opacity="0.85"/>
  <path d="M-5.6 6 L5.6 6 L6.8 10.2 L-6.8 10.2 Z" fill="#2393d6" stroke-width="2"/>
  <circle cx="-6" cy="-14.2" r="1.6" fill="#fffbd0" stroke-width="1.2"/><circle cx="6" cy="-14.2" r="1.6" fill="#fffbd0" stroke-width="1.2"/>
  <rect x="-8" y="14.6" width="3.6" height="2" rx="0.8" fill="#ff2a2a" stroke-width="1.1"/><rect x="4.4" y="14.6" width="3.6" height="2" rx="0.8" fill="#ff2a2a" stroke-width="1.1"/>
</g>`),
  /** BOOST: lightning bolt */
  boost: svg(`<g stroke="${O}" stroke-width="3" stroke-linejoin="round">
    <path d="M38 4 L12 36 L29 36 L23 60 L52 25 L34 25 Z" fill="#ffd21a"/>
    <path d="M34 11 L19 31 L27 31" fill="none" stroke="#fff6b0" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M52 25 L34 25 L36 21" fill="none" stroke="#ff9a1f" stroke-width="0" /></g>
    <path d="M44 25 L28 47 L31 36" fill="none" stroke="#ff9a1f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`),
  /** MISSILE: rocket */
  missile: svg(rocket()),
  /** POWER (empty / mystery): a gift box with a question mark */
  gift: svg(`<g stroke="${O}" stroke-width="2.6" stroke-linejoin="round">
    <path d="M22 16 C14 8 8 14 14 19 C17 21 24 21 30 21 C27 18 25 18 22 16 Z" fill="#ffd21a"/><path d="M42 16 C50 8 56 14 50 19 C47 21 40 21 34 21 C37 18 39 18 42 16 Z" fill="#ffd21a"/>
    <rect x="10" y="29" width="44" height="29" rx="3" fill="#9b4dff"/><rect x="7" y="20" width="50" height="11" rx="3" fill="#b679ff"/>
    <rect x="28" y="20" width="8" height="38" fill="#ffd21a"/></g>
    <text x="45" y="52" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="20" fill="#fff" stroke="${O}" stroke-width="2.4" paint-order="stroke">?</text>`),
  /** ROCKET power-up: three rockets fanned out */
  rocket3: svg(`${rocket('translate(-5 14) scale(0.62)', 0.62)}${rocket('translate(28 18) scale(0.62)', 0.62)}${rocket('translate(9 -3) scale(0.72)', 0.72)}`),
  /** LAP BOOST power-up: green flame */
  lapboost: svg(`<g stroke="${O}" stroke-width="2.8" stroke-linejoin="round">
    <path d="M34 4 C36 15 50 21 50 38 C50 50 42 59 32 59 C21 59 14 51 14 41 C14 31 20 26 22 18 C26 23 28 27 30 29 C32 20 31 12 34 4 Z" fill="#3fdc2c"/>
    <path d="M32 30 C34 37 41 40 41 47 C41 53 37 56 32 56 C27 56 23 53 23 48 C23 43 27 41 28 36 C30 39 31 41 32 41 C32 37 31 34 32 30 Z" fill="#c8ff3a" stroke-width="2"/></g>
    <path d="M22 40 C21 45 23 49 25 51" fill="none" stroke="#e9ffd0" stroke-width="2.4" stroke-linecap="round" opacity="0.8"/>`),
  /** AUTOPILOT power-up: steering wheel + sparkle */
  autopilot: svg(`<g stroke="${O}" stroke-width="2.6" stroke-linejoin="round">
    <circle cx="30" cy="35" r="23" fill="#2a3346"/><circle cx="30" cy="35" r="16" fill="#0f1830" stroke-width="2"/>
    <path d="M14 33 L24 33 L27 39 L33 39 L36 33 L46 33 L46 37 L36 39 L33 52 L27 52 L24 39 L14 37 Z" fill="#8fa3c2"/>
    <circle cx="30" cy="36" r="5" fill="#00e8ff"/></g>
    <path d="M10 26 C12 19 17 14 24 12" fill="none" stroke="#7d8fb0" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M51 3 L54 11 L62 14 L54 17 L51 25 L48 17 L40 14 L48 11 Z" fill="#ffe600" stroke="${O}" stroke-width="2.2" stroke-linejoin="round"/>`),
  /** PAUSE: two bars */
  pause: svg(`<g stroke="${O}" stroke-width="2.6"><rect x="16" y="13" width="11" height="38" rx="3" fill="#f2f5ff"/><rect x="37" y="13" width="11" height="38" rx="3" fill="#f2f5ff"/></g>`),
  /** HIT / MISS / NO TARGET toasts */
  hit: svg(`<path d="M32 4 L38 22 L58 18 L44 32 L58 46 L38 42 L32 60 L26 42 L6 46 L20 32 L6 18 L26 22 Z" fill="#ffb020" stroke="${O}" stroke-width="2.6" stroke-linejoin="round"/><path d="M32 18 L35 28 L46 26 L38 33 L46 40 L35 38 L32 48 L29 38 L18 40 L26 33 L18 26 L29 28 Z" fill="#fff36b"/>`),
  miss: svg(`<circle cx="32" cy="32" r="24" fill="#ff5a6a" stroke="${O}" stroke-width="2.6"/><path d="M22 22 L42 42 M42 22 L22 42" stroke="#fff" stroke-width="7" stroke-linecap="round"/>`)
};

/** power-up kind → icon key */
export const POWER_ICON = { rocket: 'rocket3', lapboost: 'lapboost', autopilot: 'autopilot' };

/** Rasterise an icon for canvas / WebGL use (cached per key + size). */
const rasterCache = new Map();
export function iconImage(key, px) {
  const id = key + '@' + px;
  if (rasterCache.has(id)) return rasterCache.get(id);
  const img = new Image(px, px);
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ICONS[key].replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" `));
  rasterCache.set(id, img);
  return img;
}
