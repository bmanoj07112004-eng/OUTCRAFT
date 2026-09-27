// Menu screens, modals and the currency top bar of the OUTCRAFT 3D edition.
//
// Every render function takes a plain VIEW MODEL (documented with JSDoc at the top of the function)
// plus an object of callbacks, and only touches its own section of index.html. Nothing here reads the
// save file or imports game rules: src/main.js maps state -> view models and calls these functions.
//
// Buttons carry data-act="name" (and optionally data-arg). One delegated listener finds the section
// (the nearest [data-ui] ancestor) and calls callbacks['on' + Name](arg, element) from that section's
// last render, so re-rendering never stacks listeners. Render functions of screens do not change
// visibility (call showScreen); render functions of modals render and open their modal.

import { iconURL } from '../icons.js';

const $ = (id) => document.getElementById(id);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const fmt = (n) => (Number.isFinite(+n) ? Math.round(+n).toLocaleString('en-US') : '0');
const pct = (x) => `${Math.round((+x || 0) * 100)}%`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ icons
// One inline SVG sprite (UI icons + level map decorations), injected once. Icons are referenced with
// <svg><use href="#ic-coin"/></svg>; white glyph icons use currentColor.

function gearPath() {
  const pts = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2 - Math.PI / 2 - Math.PI / 32;
    const r = i % 4 < 2 ? 14.5 : 10.5;
    pts.push(`${(16 + Math.cos(a) * r).toFixed(2)} ${(16 + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join('L')}ZM20.5 16a4.5 4.5 0 1 1-9 0a4.5 4.5 0 1 1 9 0Z`;
}

const STAR_D = 'M16 2.6l4.1 8.3 9.2 1.3-6.6 6.5 1.6 9.1L16 23.5l-8.3 4.3 1.6-9.1-6.6-6.5 9.2-1.3z';
const HEART_D = 'M16 28S3 20 3 11.5C3 7 6.4 4 10.2 4c2.6 0 4.6 1.4 5.8 3.4C17.2 5.4 19.2 4 21.8 4 25.6 4 29 7 29 11.5 29 20 16 28 16 28z';

const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" id="oc-sprite" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">
<defs>
<linearGradient id="g-coin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1a0"/><stop offset=".55" stop-color="#ffc629"/><stop offset="1" stop-color="#f29a00"/></linearGradient>
<linearGradient id="g-gem" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9ef0ff"/><stop offset=".5" stop-color="#3fb4ff"/><stop offset="1" stop-color="#6a4dff"/></linearGradient>
<linearGradient id="g-heart" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8a9c"/><stop offset=".6" stop-color="#ff3b5c"/><stop offset="1" stop-color="#d81b43"/></linearGradient>
<linearGradient id="g-star" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6a8"/><stop offset=".5" stop-color="#ffd23d"/><stop offset="1" stop-color="#ffa000"/></linearGradient>
<linearGradient id="g-lock" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9edf5"/><stop offset="1" stop-color="#a9b2c4"/></linearGradient>
<linearGradient id="g-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a8a"/><stop offset="1" stop-color="#e0304a"/></linearGradient>
<linearGradient id="g-pink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9cd0"/><stop offset="1" stop-color="#ff4f9e"/></linearGradient>
<linearGradient id="g-blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd3ff"/><stop offset="1" stop-color="#2f8cff"/></linearGradient>
<linearGradient id="g-green" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9ff27a"/><stop offset="1" stop-color="#38b52a"/></linearGradient>
<linearGradient id="g-lava" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset=".5" stop-color="#ff7a1f"/><stop offset="1" stop-color="#e0301a"/></linearGradient>
<linearGradient id="g-crys" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d7fbff"/><stop offset=".5" stop-color="#5fe0ff"/><stop offset="1" stop-color="#8a5bff"/></linearGradient>
<linearGradient id="g-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe8ff"/></linearGradient>
</defs>
<symbol id="ic-coin" viewBox="0 0 32 32"><circle cx="16" cy="17.5" r="13" fill="#c97400"/><circle cx="16" cy="15.5" r="13" fill="url(#g-coin)" stroke="#b56a00" stroke-width="1.4"/><circle cx="16" cy="15.5" r="9.2" fill="none" stroke="#fff5c0" stroke-width="1.5" opacity=".85"/><path d="M16 9.6l1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6z" fill="#fff8d2" stroke="#e39500" stroke-width=".7"/></symbol>
<symbol id="ic-gem" viewBox="0 0 32 32"><path d="M9 4.5h14l6.5 8.5L16 29 2.5 13z" fill="url(#g-gem)" stroke="#3a3aa8" stroke-width="1.4" stroke-linejoin="round"/><path d="M2.5 13h27M9 4.5l4 8.5 3 16M23 4.5l-4 8.5-3 16M13 13l3-8.5 3 8.5" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.1" stroke-linejoin="round"/><path d="M9.6 6h4.8l-2.6 5.6H5.4z" fill="#fff" opacity=".7"/></symbol>
<symbol id="ic-heart" viewBox="0 0 32 32"><path d="${HEART_D}" fill="url(#g-heart)" stroke="#b3102f" stroke-width="1.4"/><ellipse cx="10" cy="10.5" rx="3.4" ry="2.2" fill="#fff" opacity=".7" transform="rotate(-32 10 10.5)"/></symbol>
<symbol id="ic-heart-empty" viewBox="0 0 32 32"><path d="${HEART_D}" fill="#000" fill-opacity=".18" stroke="#000" stroke-opacity=".22" stroke-width="1.4"/></symbol>
<symbol id="ic-heart-broken" viewBox="0 0 32 32"><path d="${HEART_D}" fill="url(#g-heart)" stroke="#b3102f" stroke-width="1.4"/><path d="M16 7.5l-2.5 5 4 3.5-3 4.5 1.5 7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/></symbol>
<symbol id="ic-star" viewBox="0 0 32 32"><path d="${STAR_D}" fill="url(#g-star)" stroke="#d27f00" stroke-width="1.5" stroke-linejoin="round"/><path d="M16 7.2l2.3 4.7 5 .8" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" opacity=".75"/></symbol>
<symbol id="ic-star-empty" viewBox="0 0 32 32"><path d="${STAR_D}" fill="#000" fill-opacity=".2" stroke="#000" stroke-opacity=".18" stroke-width="1.5" stroke-linejoin="round"/></symbol>
<symbol id="ic-lock" viewBox="0 0 32 32"><path d="M10 15v-4a6 6 0 0 1 12 0v4" fill="none" stroke="#7d869a" stroke-width="3.6"/><rect x="6" y="13.5" width="20" height="15.5" rx="4" fill="url(#g-lock)" stroke="#5e667a" stroke-width="1.4"/><circle cx="16" cy="20" r="2.4" fill="#4a5163"/><rect x="15" y="21" width="2" height="4.5" rx="1" fill="#4a5163"/></symbol>
<symbol id="ic-crown" viewBox="0 0 32 32"><path d="M4 11l6.5 5L16 6.5l5.5 9.5L28 11l-2.6 14H6.6z" fill="url(#g-star)" stroke="#c77800" stroke-width="1.5" stroke-linejoin="round"/><rect x="6.5" y="23" width="19" height="4" rx="1.5" fill="#ffb300" stroke="#c77800" stroke-width="1.2"/><circle cx="16" cy="18" r="2" fill="#ff4f9e"/></symbol>
<symbol id="ic-bolt" viewBox="0 0 32 32"><path d="M18.5 2.5L6 18h8.5l-2.5 11.5L25 13.5h-8.5z" fill="url(#g-star)" stroke="#c77800" stroke-width="1.5" stroke-linejoin="round"/></symbol>
<symbol id="ic-target" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#ff4d5e" stroke="#b3102f" stroke-width="1.4"/><circle cx="16" cy="16" r="9" fill="#fff"/><circle cx="16" cy="16" r="5" fill="#ff4d5e"/><circle cx="16" cy="16" r="1.8" fill="#fff"/></symbol>
<symbol id="ic-gift" viewBox="0 0 32 32"><rect x="5" y="14" width="22" height="14" rx="3" fill="url(#g-red)" stroke="#a81e36" stroke-width="1.3"/><rect x="3.5" y="9.5" width="25" height="6" rx="2" fill="#ff8a98" stroke="#a81e36" stroke-width="1.3"/><rect x="14" y="9.5" width="4" height="18.5" fill="#ffd23d"/><path d="M16 9.5c-2-5.5-8.5-6.5-8.5-2.2 0 2.2 3.4 2.2 8.5 2.2zm0 0c2-5.5 8.5-6.5 8.5-2.2 0 2.2-3.4 2.2-8.5 2.2z" fill="#ffd23d" stroke="#d99a00" stroke-width="1.1"/></symbol>
<symbol id="ic-trophy" viewBox="0 0 32 32"><path d="M9 7H4.8a4.6 4.6 0 0 0 5.2 5.8M23 7h4.2a4.6 4.6 0 0 1-5.2 5.8" fill="none" stroke="#e39a00" stroke-width="2.6"/><path d="M8.5 3.5h15V11a7.5 7.5 0 0 1-15 0z" fill="url(#g-star)" stroke="#c77800" stroke-width="1.4"/><rect x="14" y="17.5" width="4" height="5" fill="#e39a00"/><rect x="8.5" y="22" width="15" height="6" rx="2" fill="#9a5f2e" stroke="#6b3f1c" stroke-width="1.2"/><path d="M12 6.5v4" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".7"/></symbol>
<symbol id="ic-book" viewBox="0 0 32 32"><path d="M3.5 6.5c4.5-1.7 8.5-1.5 12.5 1.2v20.1c-4-2.6-8-2.8-12.5-1.2z" fill="#6ec4ff" stroke="#1d5fc2" stroke-width="1.4" stroke-linejoin="round"/><path d="M28.5 6.5c-4.5-1.7-8.5-1.5-12.5 1.2v20.1c4-2.6 8-2.8 12.5-1.2z" fill="#9ad8ff" stroke="#1d5fc2" stroke-width="1.4" stroke-linejoin="round"/><path d="M7 11.5c2-.6 4-.5 6 .5M7 15.5c2-.6 4-.5 6 .5M19 12c2-1 4-1.1 6-.5M19 16c2-1 4-1.1 6-.5" stroke="#1d5fc2" stroke-width="1.3" stroke-linecap="round" opacity=".55"/></symbol>
<symbol id="ic-shop" viewBox="0 0 32 32"><path d="M11.5 12V9a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="#a8205f" stroke-width="2.6" stroke-linecap="round"/><path d="M6.5 11h19l-1.6 16.5a1.8 1.8 0 0 1-1.8 1.5H9.9a1.8 1.8 0 0 1-1.8-1.5z" fill="url(#g-pink)" stroke="#a8205f" stroke-width="1.4" stroke-linejoin="round"/><path d="M16 15.5l1.4 2.9 3.2.5-2.3 2.2.5 3.2-2.8-1.5-2.8 1.5.5-3.2-2.3-2.2 3.2-.5z" fill="#fff6c8"/></symbol>
<symbol id="ic-cal" viewBox="0 0 32 32"><rect x="4" y="6" width="24" height="22" rx="4" fill="#fff" stroke="#c46a12" stroke-width="1.4"/><path d="M4 10a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4v3H4z" fill="#ff8a2a"/><path d="M10 3.5v5M22 3.5v5" stroke="#8a4a10" stroke-width="2.6" stroke-linecap="round"/><path d="M16 15.5l1.6 3.2 3.5.5-2.5 2.5.6 3.5-3.2-1.7-3.2 1.7.6-3.5-2.5-2.5 3.5-.5z" fill="#ffc629" stroke="#d98a00" stroke-width=".8"/></symbol>
<symbol id="ic-swords" viewBox="0 0 32 32"><path d="M5 4l14.5 14.5M27 4L12.5 18.5" stroke="#6b7a90" stroke-width="5" stroke-linecap="round"/><path d="M5 4l14.5 14.5M27 4L12.5 18.5" stroke="#eef3fa" stroke-width="2.6" stroke-linecap="round"/><path d="M16.5 22.5l7-7M8.5 15.5l7 7" stroke="#ffc629" stroke-width="3.2" stroke-linecap="round"/><path d="M21 20l5 5M11 20l-5 5" stroke="#9a5f2e" stroke-width="3.4" stroke-linecap="round"/></symbol>
<symbol id="ic-boots" viewBox="0 0 32 32"><path d="M9 4h8v13l8.5 3.6c2 .9 3 2.4 3 4.4V28H7V17z" fill="#ff8a3d" stroke="#a84a10" stroke-width="1.4" stroke-linejoin="round"/><path d="M7 24h21.5v4H7z" fill="#8a4a1c"/><path d="M9 9h8" stroke="#ffd0a8" stroke-width="2"/><path d="M2 11h4M1 16h5M3 21h3" stroke="#3fb4ff" stroke-width="2.2" stroke-linecap="round"/></symbol>
<symbol id="ic-pack" viewBox="0 0 32 32"><path d="M12 9V6.5a4 4 0 0 1 8 0V9" fill="none" stroke="#1f7a35" stroke-width="2.6"/><rect x="6.5" y="8" width="19" height="21" rx="6" fill="url(#g-green)" stroke="#1f7a35" stroke-width="1.4"/><rect x="10" y="17" width="12" height="8.5" rx="3" fill="#7fe07a" stroke="#1f7a35" stroke-width="1.2"/><path d="M16 17v3" stroke="#1f7a35" stroke-width="1.6"/><path d="M13 5.5h6" stroke="#fff" stroke-width="1" opacity=".6"/></symbol>
<symbol id="ic-hourglass" viewBox="0 0 32 32"><path d="M8 4h16M8 28h16" stroke="#8a5a2b" stroke-width="3.2" stroke-linecap="round"/><path d="M10 5h12c0 6-4 8-5 11 1 3 5 5 5 11H10c0-6 4-8 5-11-1-3-5-5-5-11z" fill="#e6f6ff" stroke="#4f86b8" stroke-width="1.4" stroke-linejoin="round"/><path d="M12.5 8h7c-1 2.5-3 3.5-3.5 5-.5-1.5-2.5-2.5-3.5-5zM11.5 26c.5-3 3-4.5 4.5-6 1.5 1.5 4 3 4.5 6z" fill="#ffc629"/></symbol>
<symbol id="ic-fog" viewBox="0 0 32 32"><path d="M8.5 24a6 6 0 0 1-.4-12 8.5 8.5 0 0 1 16.2 1.6A5.2 5.2 0 0 1 23.8 24z" fill="#e3e9f5" stroke="#7d8aa6" stroke-width="1.4"/><path d="M10.5 18.5c3.5-3.5 7.5-3.5 11 0-3.5 3.5-7.5 3.5-11 0z" fill="#fff" stroke="#5a6680" stroke-width="1.3"/><circle cx="16" cy="18.5" r="2" fill="#5a6680"/><path d="M9.5 25L23 12" stroke="#ff4d5e" stroke-width="2.6" stroke-linecap="round"/></symbol>
<symbol id="ic-flag" viewBox="0 0 32 32"><path d="M7 3v26" stroke="#8a5a2b" stroke-width="3" stroke-linecap="round"/><path d="M8 4.5h16l-4 5 4 5H8z" fill="url(#g-red)" stroke="#a81e36" stroke-width="1.3" stroke-linejoin="round"/></symbol>
<symbol id="ic-plus" viewBox="0 0 32 32"><path d="M13 5h6v8h8v6h-8v8h-6v-8H5v-6h8z" fill="currentColor"/></symbol>
<symbol id="ic-check" viewBox="0 0 32 32"><path d="M5.5 17l7 7L26.5 8.5" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="ic-close" viewBox="0 0 32 32"><path d="M8.5 8.5l15 15M23.5 8.5l-15 15" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></symbol>
<symbol id="ic-back" viewBox="0 0 32 32"><path d="M20 5.5L9.5 16 20 26.5" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="ic-play" viewBox="0 0 32 32"><path d="M10 5.5v21a1.6 1.6 0 0 0 2.4 1.4l16-10.5a1.6 1.6 0 0 0 0-2.8l-16-10.5A1.6 1.6 0 0 0 10 5.5z" fill="currentColor"/></symbol>
<symbol id="ic-pause" viewBox="0 0 32 32"><rect x="8" y="6" width="6" height="20" rx="2" fill="currentColor"/><rect x="18" y="6" width="6" height="20" rx="2" fill="currentColor"/></symbol>
<symbol id="ic-home" viewBox="0 0 32 32"><path d="M16 3.5L2.5 15.5h4v12a1 1 0 0 0 1 1h6v-8h5v8h6a1 1 0 0 0 1-1v-12h4z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></symbol>
<symbol id="ic-hand" viewBox="0 0 32 32"><g fill="currentColor"><rect x="7.5" y="9" width="4.2" height="13" rx="2.1"/><rect x="12.3" y="4.5" width="4.2" height="15" rx="2.1"/><rect x="17.1" y="5.5" width="4.2" height="14" rx="2.1"/><rect x="21.9" y="9" width="4.2" height="12" rx="2.1"/><path d="M7.5 16h18.6v4.5c0 5-3.6 8.5-8.8 8.5-4.1 0-6.2-2-8.2-5l-4.4-6.4a2.3 2.3 0 0 1 3.7-2.7l-.9-.1z"/></g></symbol>
<symbol id="ic-gear" viewBox="0 0 32 32"><path d="${gearPath()}" fill="currentColor" fill-rule="evenodd"/></symbol>
<symbol id="ic-clock" viewBox="0 0 32 32"><circle cx="16" cy="17" r="11.5" fill="none" stroke="currentColor" stroke-width="3.6"/><path d="M16 11v6.5l4 2.6" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/><path d="M12 3.5h8" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></symbol>
<symbol id="ic-help" viewBox="0 0 32 32"><path d="M11 12a5 5 0 1 1 7.4 4.4c-1.6.9-2.4 1.8-2.4 3.6v1" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="16" cy="26.5" r="2.4" fill="currentColor"/></symbol>
<symbol id="ic-info" viewBox="0 0 32 32"><circle cx="16" cy="8" r="2.8" fill="currentColor"/><path d="M16 14v13" stroke="currentColor" stroke-width="4.4" stroke-linecap="round"/></symbol>
<symbol id="ic-sound" viewBox="0 0 32 32"><path d="M4.5 12h5.5l7-6v20l-7-6H4.5z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="M21 11a6.5 6.5 0 0 1 0 10M24.5 7a12 12 0 0 1 0 18" stroke="currentColor" stroke-width="2.8" fill="none" stroke-linecap="round"/></symbol>
<symbol id="ic-music" viewBox="0 0 32 32"><path d="M12 23.5V7.5l14-3.5v16" stroke="currentColor" stroke-width="3" fill="none" stroke-linejoin="round"/><ellipse cx="8.5" cy="23.5" rx="4.5" ry="3.6" fill="currentColor"/><ellipse cx="22.5" cy="20" rx="4.5" ry="3.6" fill="currentColor"/></symbol>
<symbol id="ic-camera" viewBox="0 0 32 32"><path d="M4 11a3 3 0 0 1 3-3h3l2-3h8l2 3h3a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" fill="currentColor"/><circle cx="16" cy="16.5" r="5" fill="none" stroke="#fff" stroke-width="2.4" opacity=".9"/></symbol>
<symbol id="ic-eye" viewBox="0 0 32 32"><path d="M2.5 16C7 8.5 25 8.5 29.5 16 25 23.5 7 23.5 2.5 16z" fill="currentColor"/><circle cx="16" cy="16" r="5" fill="#fff"/><circle cx="16" cy="16" r="2.4" fill="currentColor"/></symbol>
<symbol id="ic-look" viewBox="0 0 32 32"><path d="M16 2.5l4.5 5.5h-3v6.5H24v-3l5.5 4.5-5.5 4.5v-3h-6.5V24h3L16 29.5 11.5 24h3v-6.5H8v3L2.5 16 8 11.5v3h6.5V8h-3z" fill="currentColor"/></symbol>
<symbol id="ic-refresh" viewBox="0 0 32 32"><path d="M25 12a10 10 0 1 0 1 7" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/><path d="M27 4v9h-9" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="ic-exit" viewBox="0 0 32 32"><path d="M13 5H7a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h6" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/><path d="M14 16h13M21 9.5l6.5 6.5-6.5 6.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></symbol>
<symbol id="ic-share" viewBox="0 0 32 32"><circle cx="24" cy="7" r="4" fill="currentColor"/><circle cx="8" cy="16" r="4" fill="currentColor"/><circle cx="24" cy="25" r="4" fill="currentColor"/><path d="M11 14.5l10-6M11 17.5l10 6" stroke="currentColor" stroke-width="2.8"/></symbol>
<symbol id="d-tree" viewBox="0 0 64 64"><ellipse cx="32" cy="60" rx="17" ry="3.5" fill="#000" opacity=".16"/><rect x="28" y="38" width="8" height="21" rx="3" fill="#8a5a2b"/><circle cx="32" cy="25" r="18" fill="#3fa84a"/><circle cx="21" cy="33" r="12" fill="#389c43"/><circle cx="43" cy="33" r="12" fill="#33903e"/><circle cx="25" cy="19" r="7.5" fill="#72d46a" opacity=".85"/><circle cx="38" cy="30" r="3" fill="#ff5a5a"/><circle cx="24" cy="36" r="3" fill="#ff5a5a"/></symbol>
<symbol id="d-flower" viewBox="0 0 64 64"><path d="M32 60V34" stroke="#3a9c44" stroke-width="4" stroke-linecap="round"/><path d="M32 50c-8-2-12-8-10-12 6 0 10 6 10 12z" fill="#4fbf4a"/><g fill="#ff8ac2" stroke="#e0508f" stroke-width="1.2"><circle cx="32" cy="17" r="8"/><circle cx="42.5" cy="25" r="8"/><circle cx="38.5" cy="37" r="8"/><circle cx="25.5" cy="37" r="8"/><circle cx="21.5" cy="25" r="8"/></g><circle cx="32" cy="28" r="6.5" fill="#ffd23d" stroke="#e39a00" stroke-width="1.2"/></symbol>
<symbol id="d-bush" viewBox="0 0 64 64"><ellipse cx="32" cy="58" rx="24" ry="4" fill="#000" opacity=".15"/><circle cx="20" cy="44" r="13" fill="#48a848"/><circle cx="44" cy="44" r="13" fill="#3f9c41"/><circle cx="32" cy="36" r="15" fill="#52b64f"/><circle cx="27" cy="30" r="5" fill="#8ee07c" opacity=".8"/><circle cx="40" cy="42" r="2.6" fill="#fff"/><circle cx="22" cy="46" r="2.6" fill="#fff"/></symbol>
<symbol id="d-mushroom" viewBox="0 0 64 64"><ellipse cx="32" cy="60" rx="14" ry="3" fill="#000" opacity=".15"/><path d="M25 34h14l2 24H23z" fill="#fff4e0" stroke="#d9b98a" stroke-width="1.4"/><path d="M8 36C8 20 20 10 32 10s24 10 24 26z" fill="#ff4d4d" stroke="#c02a2a" stroke-width="1.6"/><circle cx="22" cy="24" r="4.5" fill="#fff"/><circle cx="37" cy="19" r="3.6" fill="#fff"/><circle cx="44" cy="29" r="3.6" fill="#fff"/><circle cx="30" cy="31" r="2.8" fill="#fff"/></symbol>
<symbol id="d-cactus" viewBox="0 0 64 64"><ellipse cx="32" cy="60" rx="15" ry="3" fill="#000" opacity=".15"/><rect x="25" y="8" width="14" height="52" rx="7" fill="#4fae4a" stroke="#2f7a30" stroke-width="1.6"/><path d="M25 36h-7a5 5 0 0 1-5-5V22" fill="none" stroke="#4fae4a" stroke-width="8" stroke-linecap="round"/><path d="M39 30h7a5 5 0 0 0 5-5v-8" fill="none" stroke="#4fae4a" stroke-width="8" stroke-linecap="round"/><path d="M32 12v44" stroke="#2f7a30" stroke-width="1.4" opacity=".5"/><circle cx="32" cy="8" r="4" fill="#ff7eb6"/></symbol>
<symbol id="d-palm" viewBox="0 0 64 64"><ellipse cx="34" cy="60" rx="14" ry="3" fill="#000" opacity=".15"/><path d="M30 60c2-14 2-28 4-38" fill="none" stroke="#9a6232" stroke-width="6" stroke-linecap="round"/><path d="M34 20c-8-8-20-8-26-2 8-2 16 0 26 2zM34 20c8-8 20-8 26-2-8-2-16 0-26 2zM34 20c-4-8-2-16 6-18-2 6-4 12-6 18zM34 20c-10 0-18 6-20 14 6-6 12-10 20-14zM34 20c10 0 18 6 20 14-6-6-12-10-20-14z" fill="#3fae4a" stroke="#2a7a33" stroke-width="1.2" stroke-linejoin="round"/><circle cx="32" cy="23" r="3" fill="#8a5a2b"/><circle cx="36" cy="23" r="3" fill="#8a5a2b"/></symbol>
<symbol id="d-dune" viewBox="0 0 64 64"><path d="M2 58c8-16 18-24 30-24s22 8 30 24z" fill="#f0c070"/><path d="M14 58c6-10 12-14 20-14s14 4 20 14z" fill="#e8ad55"/><path d="M26 40l8-24 8 24z" fill="#f6d28a" stroke="#c98a3a" stroke-width="1.4" stroke-linejoin="round"/><path d="M34 16l8 24h-8z" fill="#d9a050"/></symbol>
<symbol id="d-shell" viewBox="0 0 64 64"><ellipse cx="32" cy="58" rx="16" ry="3" fill="#000" opacity=".14"/><path d="M32 12L10 50c8 6 36 6 44 0z" fill="#ffc2c8" stroke="#e0808c" stroke-width="1.6" stroke-linejoin="round"/><path d="M32 12L20 52M32 12v42M32 12l12 40" stroke="#e0808c" stroke-width="1.6"/><path d="M26 54h12l-2 4h-8z" fill="#ffa8b4"/></symbol>
<symbol id="d-pine" viewBox="0 0 64 64"><ellipse cx="32" cy="60" rx="15" ry="3" fill="#000" opacity=".14"/><rect x="29" y="48" width="6" height="11" fill="#7a5230"/><path d="M32 4L14 28h8L10 42h10L6 54h52L44 42h10L42 28h8z" fill="#2f8a5a" stroke="#1f6440" stroke-width="1.4" stroke-linejoin="round"/><path d="M32 4l-8 11 4-1 4 3 4-3 4 1zM22 28l-5 7 6-2 5 3 4-3 4 3 5-3 6 2-5-7zM18 42l-6 8 8-2 6 3 6-3 6 3 6-3 8 2-6-8z" fill="#fff"/></symbol>
<symbol id="d-snowflake" viewBox="0 0 64 64"><g stroke="#ffffff" stroke-width="4" stroke-linecap="round"><path d="M32 6v52M9.5 19l45 26M9.5 45l45-26"/><path d="M26 10l6 6 6-6M26 54l6-6 6 6M10 27l8-2-2-8M54 37l-8 2 2 8M10 37l8 2-2 8M54 27l-8-2 2-8" fill="none" stroke-width="3"/></g></symbol>
<symbol id="d-ice" viewBox="0 0 64 64"><ellipse cx="32" cy="59" rx="22" ry="3.5" fill="#000" opacity=".12"/><path d="M10 58l6-26 12-6 6 32z" fill="#bfe8ff" stroke="#6fb4dc" stroke-width="1.4" stroke-linejoin="round"/><path d="M28 58l4-40 12-8 10 48z" fill="#dff4ff" stroke="#6fb4dc" stroke-width="1.4" stroke-linejoin="round"/><path d="M34 22l8-6 4 20" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></symbol>
<symbol id="d-snowman" viewBox="0 0 64 64"><ellipse cx="32" cy="60" rx="15" ry="3" fill="#000" opacity=".14"/><circle cx="32" cy="46" r="13" fill="#fff" stroke="#b9d0e6" stroke-width="1.6"/><circle cx="32" cy="24" r="10" fill="#fff" stroke="#b9d0e6" stroke-width="1.6"/><path d="M32 25l9 2-9 2z" fill="#ff8a2a"/><circle cx="28.5" cy="21" r="1.6" fill="#333"/><circle cx="35.5" cy="21" r="1.6" fill="#333"/><path d="M22 32h20v4H22z" fill="#ff4d5e"/><path d="M24 14h16l-2-8H26z" fill="#333"/><rect x="21" y="13" width="22" height="3" rx="1.5" fill="#333"/></symbol>
<symbol id="d-volcano" viewBox="0 0 64 64"><path d="M2 60L22 20h20l20 40z" fill="#5a3a34" stroke="#2e1c1a" stroke-width="1.6" stroke-linejoin="round"/><path d="M22 20h20l-4 8-4-4-4 6-4-6-3 5z" fill="url(#g-lava)"/><path d="M28 30l-4 12M36 26l3 14" stroke="#ff7a1f" stroke-width="3" stroke-linecap="round"/><circle cx="26" cy="10" r="5" fill="#8a7a78" opacity=".7"/><circle cx="36" cy="6" r="6" fill="#8a7a78" opacity=".55"/></symbol>
<symbol id="d-flame" viewBox="0 0 64 64"><path d="M32 4c4 12 18 18 18 34a18 18 0 0 1-36 0c0-10 6-14 8-22 2 6 4 8 6 8-2-8 0-14 4-20z" fill="url(#g-lava)" stroke="#c02a0a" stroke-width="1.4"/><path d="M32 30c2 6 8 8 8 16a8 8 0 0 1-16 0c0-6 5-8 8-16z" fill="#fff3a0"/></symbol>
<symbol id="d-rock" viewBox="0 0 64 64"><ellipse cx="32" cy="59" rx="24" ry="3.5" fill="#000" opacity=".18"/><path d="M8 58l4-22 14-10 16 4 12 12 2 16z" fill="#3a3238" stroke="#1e181c" stroke-width="1.6" stroke-linejoin="round"/><path d="M20 42l8-6 6 4M36 50l6-8" stroke="#ff7a1f" stroke-width="2.4" stroke-linecap="round"/><path d="M14 36l12-8 8 2" fill="none" stroke="#6a5a62" stroke-width="2"/></symbol>
<symbol id="d-crystal" viewBox="0 0 64 64"><ellipse cx="32" cy="59" rx="20" ry="3.5" fill="#000" opacity=".2"/><path d="M26 58V20l6-12 6 12v38z" fill="url(#g-crys)" stroke="#4a2fb0" stroke-width="1.4" stroke-linejoin="round"/><path d="M12 58V34l5-8 5 8v24z" fill="url(#g-crys)" stroke="#4a2fb0" stroke-width="1.4" stroke-linejoin="round"/><path d="M42 58V30l5-8 5 8v28z" fill="url(#g-crys)" stroke="#4a2fb0" stroke-width="1.4" stroke-linejoin="round"/><path d="M29 22v30M15 34v18M45 30v22" stroke="#fff" stroke-width="2" opacity=".6"/></symbol>
<symbol id="d-shroom" viewBox="0 0 64 64"><path d="M28 34h8l2 24H26z" fill="#e8e0ff"/><path d="M10 36c0-14 10-22 22-22s22 8 22 22z" fill="#35e0c8" stroke="#1a9a8a" stroke-width="1.6"/><circle cx="24" cy="26" r="3.5" fill="#dffff8"/><circle cx="38" cy="22" r="3" fill="#dffff8"/><circle cx="44" cy="31" r="2.6" fill="#dffff8"/><circle cx="32" cy="30" r="22" fill="#35e0c8" opacity=".12"/></symbol>
<symbol id="d-gem" viewBox="0 0 64 64"><path d="M18 14h28l12 14-26 30L6 28z" fill="url(#g-crys)" stroke="#4a2fb0" stroke-width="1.6" stroke-linejoin="round"/><path d="M6 28h52M18 14l8 14 6 30M46 14l-8 14-6 30M26 28l6-14 6 14" fill="none" stroke="#fff" stroke-width="1.4" opacity=".55"/></symbol>
<symbol id="d-cloud" viewBox="0 0 64 64"><path d="M14 46a10 10 0 0 1 0-20 13 13 0 0 1 24-6 11 11 0 0 1 16 10 8 8 0 0 1-2 16z" fill="url(#g-sky)" stroke="#c9d6f2" stroke-width="1.6"/><path d="M18 30a8 8 0 0 1 10-6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/></symbol>
<symbol id="d-balloon" viewBox="0 0 64 64"><path d="M32 4C19 4 12 13 12 23c0 11 12 19 16 25h8c4-6 16-14 16-25C52 13 45 4 32 4z" fill="#ff6f9f" stroke="#c0386a" stroke-width="1.4"/><path d="M32 4c-6 0-9 9-9 19 0 11 5 19 5 25h8c0-6 5-14 5-25 0-10-3-19-9-19z" fill="#ffd23d"/><path d="M32 4c-2 0-3 9-3 19 0 11 1 19 1 25h4c0-6 1-14 1-25 0-10-1-19-3-19z" fill="#5fc4ff"/><path d="M28 48l-1 6M36 48l1 6" stroke="#8a5a2b" stroke-width="1.4"/><rect x="26" y="53" width="12" height="8" rx="2" fill="#9a6232"/></symbol>
<symbol id="d-isle" viewBox="0 0 64 64"><path d="M6 30h52l-10 12-10 4-6 12-6-12-10-4z" fill="#a38bc9" stroke="#7d67a6" stroke-width="1.4" stroke-linejoin="round"/><path d="M4 30c0-6 10-8 28-8s28 2 28 8z" fill="#8fd894" stroke="#5aa860" stroke-width="1.4"/><circle cx="20" cy="18" r="7" fill="#ff9ec7"/><rect x="19" y="20" width="2.4" height="6" fill="#8a5a2b"/><circle cx="42" cy="16" r="9" fill="#5fbf6a"/><rect x="41" y="20" width="3" height="7" fill="#8a5a2b"/></symbol>
<symbol id="d-rainbow" viewBox="0 0 64 64"><g fill="none" stroke-width="5"><path d="M6 50a26 26 0 0 1 52 0" stroke="#ff5a6e"/><path d="M11 50a21 21 0 0 1 42 0" stroke="#ffb13d"/><path d="M16 50a16 16 0 0 1 32 0" stroke="#ffe14d"/><path d="M21 50a11 11 0 0 1 22 0" stroke="#5fd06a"/><path d="M26 50a6 6 0 0 1 12 0" stroke="#4aa8ff"/></g><path d="M0 52a8 8 0 0 1 14-4 6 6 0 0 1 6 6H0zM44 54a6 6 0 0 1 6-6 8 8 0 0 1 14 4v2z" fill="#fff"/></symbol>
</svg>`;

// Names of the sprite's UI icons (so a view model can pass either an icon name or an emoji).
const ICON_NAMES = new Set([...SPRITE.matchAll(/id="ic-([a-z-]+)"/g)].map((m) => m[1]));
export const hasIcon = (name) => ICON_NAMES.has(name);

export function ensureIcons() {
  if (typeof document === 'undefined' || $('oc-sprite')) return;
  document.body.insertAdjacentHTML('afterbegin', SPRITE);
}

export function svgIcon(name, cls = '') {
  return `<svg class="ic ${cls}" aria-hidden="true"><use href="#ic-${name}"/></svg>`;
}

// Resource/component/item art from src/icons.js, cached as data URLs (toDataURL is not free).
const artCache = new Map();
export function artURL(kind, id, px = 96, silhouette = false) {
  const key = `${kind}:${id}:${px}:${silhouette ? 1 : 0}`;
  let u = artCache.get(key);
  if (!u) {
    u = iconURL(kind, id, px, silhouette);
    artCache.set(key, u);
  }
  return u;
}

// Booster icon: one of our SVG icons when the id or icon name matches, otherwise the text (emoji).
const BOOSTER_ICON = { boots: 'boots', backpack: 'pack', headstart: 'hourglass', fog: 'fog' };
function boosterIcon(b) {
  const n = BOOSTER_ICON[b.icon] || BOOSTER_ICON[b.id];
  return n ? svgIcon(n, 'bi') : `<span class="bi-txt">${esc(b.icon || '?')}</span>`;
}

// Round portrait: an <img> when a URL is given, otherwise a coloured disc with the initial.
function avatar(p, cls = '') {
  const c = esc(p?.color || '#3d7bff');
  const inner = p?.portrait ? `<img alt="" src="${esc(p.portrait)}">` : `<i>${esc((p?.name || '?').slice(0, 1))}</i>`;
  return `<span class="av ${cls}" style="--c:${c}">${inner}</span>`;
}

function starsRow(n, max = 3, cls = '') {
  let s = '';
  for (let i = 0; i < max; i++) s += svgIcon(i < n ? 'star' : 'star-empty', cls);
  return s;
}

function priceHTML(price) {
  if (!price) return '';
  if (price.gems) return `${svgIcon('gem', 'pi')}<b>${fmt(price.gems)}</b>`;
  return `${svgIcon('coin', 'pi')}<b>${fmt(price.coins || 0)}</b>`;
}

// ------------------------------------------------------------------ hooks, dispatch, visibility

const hooks = { sound: () => {}, onAction: null };
const handlers = Object.create(null);
let wired = false;

/**
 * Call once at boot.
 * @param {object} [opts]
 * @param {(name: string, ...args: any[]) => void} [opts.sound]  UI sound hook, called with
 *   'ui' (any button), 'pop' (modal opens), 'whoosh' (screen change), 'star' i (result star i pops),
 *   'coin' (reward counter tick), 'levelComplete', 'fail', 'heart', 'error', 'buy'. Map to sfx[name].
 * @param {(section: string, act: string, arg?: string) => void} [opts.onAction]  called for every
 *   data-act click before the section callback (e.g. to unlock audio on the first tap).
 */
export function initScreens(opts = {}) {
  if (opts.sound) hooks.sound = opts.sound;
  if (opts.onAction) hooks.onAction = opts.onAction;
  ensureIcons();
  wire();
}

function play(name, ...args) {
  try {
    hooks.sound(name, ...args);
  } catch (err) {
    console.error(err);
  }
}

function callbackFor(hostId, act) {
  const cb = handlers[hostId];
  return cb && cb['on' + cap1(act)];
}

function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener('click', (e) => {
    // A tap on a modal's backdrop closes it when the modal has a close action.
    if (e.target.classList && e.target.classList.contains('modal')) {
      const close = callbackFor(e.target.id, 'close');
      if (close) close();
      return;
    }
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    const host = el.closest('[data-ui]');
    if (!host) return;
    const act = el.dataset.act;
    if (hooks.onAction) hooks.onAction(host.id, act, el.dataset.arg);
    if (!el.hasAttribute('data-quiet')) play('ui');
    const fn = callbackFor(host.id, act);
    if (fn) fn(el.dataset.arg, el, e);
  });
  // Settings controls: <input data-set="key">. Checkboxes send booleans, ranges numbers.
  const onSet = (e) => {
    const el = e.target.closest('[data-set]');
    if (!el) return;
    const host = el.closest('[data-ui]');
    const key = el.dataset.set;
    const value = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
    if (el.type === 'range') {
      const out = host && host.querySelector(`[data-out="${key}"]`);
      if (out) out.textContent = `${(+value).toFixed(1)}x`;
    }
    // Ranges report on release ('change'); checkboxes fire both events, so only 'change' counts.
    if (e.type === 'input') return;
    if (el.type !== 'range') play('ui');
    const fn = host && callbackFor(host.id, 'change');
    if (fn) fn(key, value, el);
  };
  document.addEventListener('change', onSet);
  document.addEventListener('input', onSet);
  // iOS Safari only applies :active (the button press-down look) when a touch listener exists.
  document.addEventListener('touchstart', () => {}, { passive: true });
}

let current = null;
let pendingMapScroll = null;

/** Show one screen ('title' or 'screen-title'); null hides every screen. The currency bar shows on
 * screens marked data-topbar. Returns the id now shown. */
export function showScreen(id) {
  const target = id ? (id.startsWith('screen-') ? id : `screen-${id}`) : null;
  if (target && !$(target)) console.warn(`showScreen: no #${target}`);
  const changed = target !== current;
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== target;
  current = target;
  const t = target && $(target);
  const tb = $('topbar');
  if (tb) tb.hidden = !(t && t.hasAttribute('data-topbar'));
  document.body.dataset.screen = target ? target.slice(7) : '';
  if (changed && target && target !== 'screen-loading') play('whoosh');
  if (target === 'screen-map' && pendingMapScroll != null) {
    const lvl = pendingMapScroll;
    requestAnimationFrame(() => scrollToLevel(lvl, false));
  }
  return target;
}

export function currentScreen() {
  return current;
}

const modalId = (id) => (id.startsWith('modal-') ? id : `modal-${id}`);

/** Open a modal ('level' or 'modal-level'). No-op if already open. */
export function openModal(id) {
  const el = $(modalId(id));
  if (!el || !el.hidden) return;
  el.hidden = false;
  document.body.classList.add('has-modal');
  play('pop');
}

export function closeModal(id) {
  const el = $(modalId(id));
  if (!el || el.hidden) return;
  el.hidden = true;
  if (el.id === 'modal-result') stopResultAnim();
  if (el.id === 'modal-confirm' && confirmResolve) resolveConfirm(false);
  if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('has-modal');
}

export function closeAllModals() {
  for (const el of document.querySelectorAll('.modal:not([hidden])')) closeModal(el.id);
}

export function isModalOpen(id) {
  const el = $(modalId(id));
  return !!el && !el.hidden;
}

/** The top-most open modal id, or null (useful for Escape / back handling). */
export function topModal() {
  const open = [...document.querySelectorAll('.modal:not([hidden])')];
  return open.length ? open[open.length - 1].id : null;
}

let toastTimer = 0;
/** Short message at the bottom of the menus. kind: '' | 'good' | 'bad'. */
export function toast(text, { dur = 2200, kind = '' } = {}) {
  const t = $('toast');
  if (!t) return;
  t.textContent = text;
  t.className = `toast ${kind}`;
  t.hidden = false;
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), dur);
}

let confirmResolve = null;
function resolveConfirm(v) {
  const r = confirmResolve;
  confirmResolve = null;
  if (r) r(v);
}
/** Generic yes/no dialog. Resolves true on OK, false on cancel/close. */
export function confirmDialog({ title = 'Are you sure?', text = '', ok = 'OK', cancel = 'CANCEL', danger = false } = {}) {
  resolveConfirm(false);
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  const okBtn = $('confirm-ok');
  okBtn.textContent = ok;
  okBtn.className = `btn ${danger ? 'btn-red' : 'btn-green'}`;
  $('confirm-cancel').textContent = cancel;
  handlers['modal-confirm'] = {
    onOk: () => {
      const r = confirmResolve;
      confirmResolve = null;
      closeModal('confirm');
      if (r) r(true);
    },
    onCancel: () => closeModal('confirm'),
  };
  openModal('confirm');
  return new Promise((res) => (confirmResolve = res));
}

// ------------------------------------------------------------------ top bar

const tbLast = {};
function bump(el) {
  if (!el) return;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}
function setText(id, text) {
  const el = $(id);
  if (el && el.textContent !== text) el.textContent = text;
}

/**
 * Currency bar (hearts, coins, gems). Cheap to call every second: only changed text is written, and a
 * value that went up bumps its pill.
 * @param {object} vm
 * @param {number} vm.coins
 * @param {number} vm.gems
 * @param {number} vm.hearts          hearts now
 * @param {number} [vm.heartsMax=5]
 * @param {string} [vm.heartsText]    countdown to the next heart, e.g. '12:34' ('' or omitted = FULL)
 * @param {object} [cb]  onHearts(), onCoins(), onGems() (e.g. open the shop on the right tab)
 */
export function renderTopBar(vm, cb = {}) {
  handlers.topbar = cb;
  for (const k of ['coins', 'gems', 'hearts']) {
    const v = Math.max(0, Math.floor(+vm[k] || 0));
    if (tbLast[k] === v) continue;
    const up = tbLast[k] !== undefined && v > tbLast[k];
    tbLast[k] = v;
    setText(`tb-${k}`, fmt(v));
    if (up) bump($(`tb-${k}`)?.closest('.cur'));
  }
  const full = vm.hearts >= (vm.heartsMax || 5);
  setText('tb-hearts-t', full || !vm.heartsText ? 'FULL' : vm.heartsText);
}

// ------------------------------------------------------------------ loading / no WebGL

/** Loading screen progress. @param {{progress?: number, text?: string}} vm  progress 0..1 */
export function renderLoading(vm = {}) {
  const bar = $('load-bar');
  if (bar) bar.style.transform = `scaleX(${clamp(+vm.progress || 0, 0, 1)})`;
  if (vm.text != null) setText('load-text', vm.text);
}

/** Show the "WebGL not available" fallback (links to classic/). */
export function showNoWebGL(reason = '') {
  if (reason) setText('nogl-reason', reason);
  showScreen('nogl');
}

// ------------------------------------------------------------------ title

/**
 * Title screen (the 3D island plays itself behind it).
 * @param {object} vm
 * @param {number} vm.level              current Adventure level (PLAY shows "Level 12")
 * @param {string} [vm.levelName]        its name
 * @param {string} vm.dailySub           e.g. '#4 · Rush Hour' or 'Done · streak 3'
 * @param {boolean} [vm.dailyDone]       today's commission already played
 * @param {string} vm.quickSub           e.g. 'vs FOX'
 * @param {boolean} [vm.dailyReward]     a daily reward can be claimed (badge)
 * @param {number} [vm.achievements]     achievements ready to claim (badge count)
 * @param {string} [vm.codex]            e.g. '3/12'
 * @param {{greet: string, lines: string[], notebook: number, nextRival?: string}|null} [vm.dossier]
 *                                       "Your rivals remember you" card (null hides it)
 * @param {string} [vm.docsHref]         design docs link
 * @param {object} cb  onPlay, onDaily, onQuick, onShop, onDailyReward, onAchievements, onCodex,
 *                     onSettings, onHow, onAbout
 */
export function renderTitle(vm, cb = {}) {
  handlers['screen-title'] = cb;
  setText('title-level', `Level ${vm.level || 1}${vm.levelName ? ` · ${vm.levelName}` : ''}`);
  setText('title-daily-sub', vm.dailySub || '');
  setText('title-quick-sub', vm.quickSub || '');
  $('btn-title-daily')?.classList.toggle('done', !!vm.dailyDone);
  const bd = $('badge-daily');
  if (bd) bd.hidden = !vm.dailyReward;
  const ba = $('badge-ach');
  if (ba) {
    ba.hidden = !(vm.achievements > 0);
    ba.textContent = vm.achievements > 0 ? String(vm.achievements) : '';
  }
  const bc = $('badge-codex');
  if (bc) {
    bc.hidden = !vm.codex;
    bc.textContent = vm.codex || '';
  }
  if (vm.docsHref) {
    const a = $('title-docs');
    if (a) a.href = vm.docsHref;
  }
  const box = $('title-dossier');
  if (!box) return;
  const d = vm.dossier;
  if (!d) {
    box.hidden = true;
    return;
  }
  const lines = (d.lines || []).length ? d.lines : ['No clear habits yet. We are still watching.'];
  box.innerHTML = `<div class="dz-head">${svgIcon('eye', 'dz-ic')} YOUR RIVALS REMEMBER YOU</div>
    <p class="dz-line">“${esc(d.greet)}”</p>${lines.map((l) => `<p class="dz-line">“${esc(l)}”</p>`).join('')}
    <div class="dz-meta">Notebook: <b>${fmt(d.notebook)}</b> of your choices${d.nextRival ? ` · Next rival: <b>${esc(d.nextRival)}</b>` : ''}</div>`;
  box.hidden = false;
}

// ------------------------------------------------------------------ level map

// Art direction per world theme: background band colours, road colours, bubble colours, decorations.
const MAP_STYLE = {
  meadow: { band: ['#7fd65a', '#b6ec7c'], bub: ['#6fe0ff', '#1f8fe8', '#136bb8'], rib: ['#4cc23f', '#2c8f25'], deco: ['tree', 'flower', 'bush', 'mushroom', 'tree', 'flower'] },
  dunes: { band: ['#ffc566', '#ffe29a'], bub: ['#ffd16b', '#ff8a2a', '#c95a0e'], rib: ['#ff9f2e', '#d06a10'], deco: ['cactus', 'palm', 'dune', 'shell', 'cactus', 'palm'] },
  frost: { band: ['#a9d4f5', '#e9f5ff'], bub: ['#b5ecff', '#46b0f0', '#2474b8'], rib: ['#5ab8f5', '#2a7ec4'], deco: ['pine', 'snowflake', 'ice', 'snowman', 'pine', 'snowflake'] },
  ember: { band: ['#5a2328', '#b9502e'], bub: ['#ffb060', '#ff5a2a', '#b82a10'], rib: ['#ff6a2a', '#b83210'], deco: ['volcano', 'flame', 'rock', 'flame', 'volcano', 'rock'] },
  crystal: { band: ['#3a2b86', '#7b5ad8'], bub: ['#d6a8ff', '#9a5bff', '#5a2fc4'], rib: ['#a26bff', '#6a3ad0'], deco: ['crystal', 'shroom', 'gem', 'crystal', 'shroom', 'gem'] },
  sky: { band: ['#9cc8ff', '#ffe3f1'], bub: ['#ffb3d9', '#ff5fa8', '#c0307a'], rib: ['#ff7ab8', '#d0408a'], deco: ['cloud', 'balloon', 'isle', 'rainbow', 'cloud', 'balloon'] },
};
const THEME_ORDER = ['meadow', 'dunes', 'frost', 'ember', 'crystal', 'sky'];
const MAP = { step: 96, banner: 150, padBottom: 110, padTop: 240, amp: 26 };

// Deterministic pseudo-random in [0, 1) for decoration placement.
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

let mapState = null;

/**
 * Adventure level map: a vertical winding path of level bubbles through the worlds, bottom to top.
 * Opens scrolled to the current level (call scrollToLevel to move it).
 * @param {object} vm
 * @param {Array<{name: string, themeId?: string, stars?: number, maxStars?: number}>} vm.worlds
 *        in order, bottom (world 1) to top; themeId one of meadow|dunes|frost|ember|crystal|sky
 * @param {Array<{id: number, world: number, stars?: number, boss?: boolean,
 *         state: 'done'|'current'|'locked', rivalPortrait?: string, rivalColor?: string, rivalName?: string}>} vm.levels
 *        in id order; `world` is the 0-based world index; stars = best stars earned (0..3)
 * @param {number} vm.current            the level to highlight and scroll to
 * @param {string} [vm.playerPortrait]   portrait on the current level's pin
 * @param {string} [vm.playerColor]
 * @param {number} [vm.stars]            total stars earned
 * @param {number} [vm.maxStars]         total stars available
 * @param {object} cb  onLevel(id) for a playable bubble, onLocked(id) for a locked one (default: toast),
 *                     onBack()
 */
export function renderMap(vm, cb = {}) {
  const locked = (id) => {
    play('error');
    if (cb.onLocked) cb.onLocked(id);
    else toast(`Level ${id} is locked. Beat level ${id - 1} first!`);
  };
  handlers['screen-map'] = {
    onBack: cb.onBack,
    onJump: () => scrollToLevel(vm.current, true),
    onLevel: (arg) => {
      const id = +arg;
      const l = vm.levels[id - 1];
      if (!l || l.state === 'locked') return locked(id);
      if (cb.onLevel) cb.onLevel(id);
    },
  };
  setText('map-stars', `${fmt(vm.stars || 0)}/${fmt(vm.maxStars || vm.levels.length * 3)}`);

  const worlds = vm.worlds && vm.worlds.length ? vm.worlds : [{ name: 'Adventure' }];
  const perWorld = Math.max(1, Math.ceil(vm.levels.length / worlds.length));
  const bandH = MAP.banner + perWorld * MAP.step;
  const total = MAP.padBottom + worlds.length * bandH + MAP.padTop;
  // Level positions: y measured from the top of the map, x in percent of the path column.
  const pts = vm.levels.map((l, i) => {
    const w = Math.min(worlds.length - 1, Math.floor(i / perWorld));
    const j = i - w * perWorld;
    const fromBottom = MAP.padBottom + w * bandH + MAP.banner + j * MAP.step + MAP.step / 2;
    const x = 50 + MAP.amp * Math.sin(i * 0.78 + 0.35);
    return { x, y: total - fromBottom };
  });
  const styleOf = (w) => MAP_STYLE[worlds[w]?.themeId] || MAP_STYLE[THEME_ORDER[w % 6]];

  // Background: one continuous gradient through every world band, blending at the borders.
  const stops = [];
  worlds.forEach((_, w) => {
    const st = styleOf(w).band;
    const bottom = total - (MAP.padBottom + w * bandH);
    const top = bottom - bandH;
    stops.push(`${st[0]} ${Math.max(0, bottom - 40)}px`, `${st[1]} ${top + 90}px`);
  });
  stops.reverse();
  const topCol = styleOf(worlds.length - 1).band[1];
  const bg = `linear-gradient(to bottom, ${topCol} 0px, ${stops.join(', ')}, ${styleOf(0).band[0]} ${total}px)`;

  // Road: Catmull-Rom through the bubble centres, in (percent, px) space; the SVG stretches only in x.
  const seg = (i) => {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    return `C${c1x.toFixed(2)} ${c1y.toFixed(1)} ${c2x.toFixed(2)} ${c2y.toFixed(1)} ${p2.x.toFixed(2)} ${p2.y.toFixed(1)}`;
  };
  const pathTo = (n) => {
    if (!pts.length) return '';
    let d = `M${pts[0].x.toFixed(2)} ${(pts[0].y + 70).toFixed(1)}L${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < Math.min(n, pts.length - 1); i++) d += seg(i);
    return d;
  };
  const curIdx = clamp((vm.current || 1) - 1, 0, pts.length - 1);
  const fullD = pathTo(pts.length);
  const doneD = pathTo(curIdx);

  let html = `<div class="map-bg" style="height:${total}px;background:${bg}"></div>`;
  // Big blurred theme shapes at the far edges (visible on wide screens) and the world banners.
  worlds.forEach((wd, w) => {
    const st = styleOf(w);
    const bottom = total - (MAP.padBottom + w * bandH);
    for (let k = 0; k < 9; k++) {
      const r = hash(w * 31 + k);
      const left = k % 2 ? 80 + r * 16 : 4 + r * 16;
      const y = bottom - MAP.banner * 0.3 - ((k + 0.5) * (bandH - MAP.banner * 0.3)) / 9;
      const s = 64 + hash(w * 17 + k) * 60;
      html += `<svg class="deco deco-outer" style="left:${left.toFixed(1)}%;top:${y.toFixed(0)}px;width:${s.toFixed(0)}px;height:${s.toFixed(0)}px"><use href="#d-${st.deco[(k + 1) % st.deco.length]}"/></svg>`;
    }
    const got = wd.stars ?? 0;
    const max = wd.maxStars ?? perWorld * 3;
    const lockedWorld = vm.levels[w * perWorld]?.state === 'locked';
    html += `<div class="map-banner ${lockedWorld ? 'locked' : ''}" style="top:${bottom - MAP.banner / 2 + 6}px;--r1:${st.rib[0]};--r2:${st.rib[1]}">
      <div class="mb-ribbon"><small>WORLD ${w + 1}</small><b>${esc(wd.name)}</b></div>
      <div class="mb-stars">${lockedWorld ? `${svgIcon('lock', 'mb-ic')} Beat level ${w * perWorld} to unlock` : `${svgIcon('star', 'mb-ic')} ${got}/${max}`}</div></div>`;
  });
  html += `<div class="map-col" style="height:${total}px">`;
  html += `<svg class="map-road" viewBox="0 0 100 ${total}" preserveAspectRatio="none" style="height:${total}px">
    <path d="${fullD}" class="rd-shadow"/><path d="${fullD}" class="rd-edge"/><path d="${fullD}" class="rd-road"/>
    <path d="${doneD}" class="rd-done"/><path d="${fullD}" class="rd-dots"/></svg>`;
  // Decorations beside the road, on the side away from each bubble.
  pts.forEach((p, i) => {
    const w = Math.min(worlds.length - 1, Math.floor(i / perWorld));
    const st = styleOf(w);
    const r = hash(i + 7);
    const left = p.x > 50 ? 6 + r * 20 : 74 + r * 20;
    const s = 44 + hash(i * 3 + 1) * 34;
    const y = p.y + (hash(i * 5 + 2) - 0.5) * 60;
    html += `<svg class="deco" style="left:${left.toFixed(1)}%;top:${y.toFixed(0)}px;width:${s.toFixed(0)}px;height:${s.toFixed(0)}px"><use href="#d-${st.deco[(i + w) % st.deco.length]}"/></svg>`;
  });
  vm.levels.forEach((l, i) => {
    const p = pts[i];
    const w = Math.min(worlds.length - 1, Math.floor(i / perWorld));
    const st = styleOf(w);
    const cls = `lvl ${l.state} ${l.boss ? 'boss' : ''}`;
    const vars = `--b1:${st.bub[0]};--b2:${st.bub[1]};--b3:${st.bub[2]};left:${p.x.toFixed(2)}%;top:${p.y.toFixed(0)}px`;
    let inner = '';
    if (l.state === 'done') inner += `<span class="lvl-stars">${starsRow(l.stars || 0, 3, 'ls')}</span>`;
    if (l.boss) inner += `<span class="lvl-crown">${svgIcon('crown')}</span>`;
    if (l.boss && l.rivalPortrait) inner += `<span class="lvl-disc"><img class="lvl-boss" alt="" src="${esc(l.rivalPortrait)}"><b class="lvl-num">${l.id}</b></span>`;
    else inner += `<span class="lvl-disc"><b class="lvl-num">${l.id}</b></span>`;
    if (l.state === 'locked') inner += `<span class="lvl-lock">${svgIcon('lock')}</span>`;
    // The pin leans away from the next bubble so the two never overlap.
    const pinSide = pts[i + 1] && pts[i + 1].x > p.x ? 'pin-l' : 'pin-r';
    if (l.state === 'current') inner += `<span class="lvl-pin ${pinSide}">${avatar({ portrait: vm.playerPortrait, color: vm.playerColor || '#3d7bff', name: 'You' }, 'pin-av')}</span>`;
    html += `<button class="${cls}" style="${vars}" data-act="level" data-arg="${l.id}"${l.state === 'locked' ? ' data-quiet' : ''} aria-label="Level ${l.id}${l.state === 'locked' ? ' (locked)' : ''}">${inner}</button>`;
  });
  html += `<div class="map-top" style="top:${MAP.padTop * 0.6}px">${svgIcon('lock', 'mt-ic')}<b>More islands soon!</b></div>`;
  html += '</div>';
  const inner = $('map-inner');
  inner.style.height = `${total}px`;
  inner.innerHTML = html;
  mapState = { pts, current: vm.current, total };
  pendingMapScroll = vm.current;
  const scroller = $('map-scroll');
  if (!scroller.dataset.wired) {
    scroller.dataset.wired = '1';
    let raf = 0;
    scroller.addEventListener(
      'scroll',
      () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          updateJump();
        });
      },
      { passive: true },
    );
  }
  if (current === 'screen-map') scrollToLevel(vm.current, false);
}

function updateJump() {
  const btn = $('map-jump');
  const sc = $('map-scroll');
  if (!btn || !sc || !mapState) return;
  const p = mapState.pts[mapState.current - 1];
  if (!p) return;
  const mid = sc.scrollTop + sc.clientHeight / 2;
  const far = Math.abs(p.y - mid) > sc.clientHeight * 0.75;
  btn.hidden = !far;
  if (far) {
    btn.classList.toggle('down', p.y > mid);
    setText('map-jump-n', String(mapState.current));
  }
}

/** Scroll the level map so level `id` sits a little below the middle of the screen. */
export function scrollToLevel(id, smooth = true) {
  const sc = $('map-scroll');
  if (!sc || !mapState) return;
  const p = mapState.pts[clamp(id, 1, mapState.pts.length) - 1];
  if (!p) return;
  if (!sc.clientHeight) {
    pendingMapScroll = id;
    return;
  }
  pendingMapScroll = null;
  const top = clamp(p.y - sc.clientHeight * 0.55, 0, Math.max(0, mapState.total - sc.clientHeight));
  sc.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  if (!smooth) updateJump();
}

// ------------------------------------------------------------------ level popup

let popupSel = { id: null, set: new Set() };

/**
 * Level popup (opens the modal): rival vs you, goal, twist, star targets, boosters, PLAY.
 * Re-render after buying a booster: the selection is kept while the level id stays the same.
 * @param {object} vm
 * @param {number} vm.id
 * @param {string} vm.name
 * @param {string} vm.worldName
 * @param {string} [vm.themeId]           colours the header
 * @param {boolean} [vm.boss]
 * @param {boolean} [vm.hard]
 * @param {{name: string, title?: string, color: string, portrait?: string}} vm.rival
 * @param {{portrait?: string, color?: string}} [vm.player]
 * @param {string} vm.goal                goal text
 * @param {{name: string, desc: string}|null} [vm.twist]
 * @param {string|null} [vm.note]         what this level introduces (one line)
 * @param {number} [vm.timeLimit]         seconds, if any
 * @param {number[]} vm.thresholds        [0, twoStarScore, threeStarScore]
 * @param {number} [vm.stars]             best stars so far
 * @param {number} [vm.best]              best score so far
 * @param {Array<{id: string, name: string, desc: string, icon?: string, count: number,
 *         price: {coins?: number, gems?: number}, canAfford: boolean}>} vm.boosters
 * @param {string[]} [vm.selected]        booster ids selected when the popup first opens
 * @param {number} vm.hearts
 * @param {string} [vm.heartsText]        time to the next heart
 * @param {object} cb  onPlay(selectedIds), onClose(), onBuyBooster(id) (count was 0),
 *                     onNoHearts() (PLAY pressed with 0 hearts)
 */
export function renderLevelPopup(vm, cb = {}) {
  if (popupSel.id !== vm.id) popupSel = { id: vm.id, set: new Set(vm.selected || []) };
  for (const b of vm.boosters || []) if (!(b.count > 0)) popupSel.set.delete(b.id);
  const st = MAP_STYLE[vm.themeId] || MAP_STYLE.meadow;
  const card = $('level-card');
  const t = vm.thresholds || [0, 0, 0];
  const boosters = (vm.boosters || [])
    .map((b) => {
      const sel = popupSel.set.has(b.id);
      const foot = b.count > 0 ? `<i class="bc-count">${b.count}</i>` : `<i class="bc-buy ${b.canAfford ? '' : 'poor'}">${priceHTML(b.price)}</i>`;
      return `<button class="bchip ${sel ? 'sel' : ''} ${b.count > 0 ? '' : 'empty'}" data-act="booster" data-arg="${esc(b.id)}" title="${esc(b.desc)}">
        <span class="bc-ic">${boosterIcon(b)}</span>${foot}${sel ? `<i class="bc-check">${svgIcon('check')}</i>` : ''}<span class="bc-name">${esc(b.name)}</span></button>`;
    })
    .join('');
  const selNames = (vm.boosters || []).filter((b) => popupSel.set.has(b.id));
  const noHearts = !(vm.hearts > 0);
  card.style.setProperty('--r1', vm.boss ? '#ff5a6e' : st.rib[0]);
  card.style.setProperty('--r2', vm.boss ? '#c0223a' : st.rib[1]);
  card.innerHTML = `
    <button class="ibtn ibtn-close" data-act="close" aria-label="Close">${svgIcon('close')}</button>
    <div class="ribbon"><span>${vm.boss ? 'BOSS · ' : ''}LEVEL ${vm.id}</span></div>
    <div class="lp-world">${esc(vm.worldName)} · ${esc(vm.name)}${vm.hard ? ' <i class="tag-hard">HARD</i>' : ''}</div>
    <div class="lp-best">${starsRow(vm.stars || 0, 3, 'lp-star')}</div>
    <div class="vs-row">
      <div class="vs-side">${avatar({ ...(vm.player || {}), name: 'You', color: vm.player?.color || '#3d7bff' }, 'av-lg')}<b>YOU</b></div>
      <div class="vs-mid">VS</div>
      <div class="vs-side">${avatar(vm.rival, 'av-lg')}<b style="color:${esc(vm.rival.color)}">${esc(vm.rival.name)}</b><small>${esc(vm.rival.title || '')}</small></div>
    </div>
    <div class="lp-goal">${svgIcon('target', 'lp-ic')}<div><small>GOAL</small><p>${esc(vm.goal)}</p></div></div>
    ${vm.twist ? `<div class="lp-twist">${svgIcon('bolt', 'lp-ic')}<div><small>TWIST · ${esc(vm.twist.name)}</small><p>${esc(vm.twist.desc)}</p></div></div>` : ''}
    ${vm.timeLimit ? `<div class="lp-twist lp-time">${svgIcon('clock', 'lp-ic lp-clock')}<div><small>TIME LIMIT</small><p>${Math.floor(vm.timeLimit / 60)}:${String(Math.round(vm.timeLimit % 60)).padStart(2, '0')} of race time.</p></div></div>` : ''}
    ${vm.note ? `<div class="lp-note">${esc(vm.note)}</div>` : ''}
    <div class="lp-targets">
      <div class="lpt">${starsRow(1, 1, 'lpt-s')}<b>WIN</b></div>
      <div class="lpt">${starsRow(2, 2, 'lpt-s')}<b>${fmt(t[1])}</b></div>
      <div class="lpt">${starsRow(3, 3, 'lpt-s')}<b>${fmt(t[2])}</b></div>
    </div>
    ${vm.best ? `<div class="lp-bestscore">Best score <b>${fmt(vm.best)}</b></div>` : ''}
    <div class="lp-boost-h">BOOSTERS <small>${selNames.length ? esc(selNames.map((b) => b.name).join(' + ')) : 'tap to use'}</small></div>
    <div class="lp-boosts">${boosters}</div>
    <button class="btn btn-green btn-xl lp-play ${noHearts ? 'nohearts' : ''}" data-act="play">
      <span class="btn-main">${noHearts ? 'NO HEARTS' : 'PLAY'}</span>
      <span class="lp-heart">${svgIcon('heart')}<b>${noHearts ? esc(vm.heartsText || '') : '1'}</b></span>
    </button>
    <p class="lp-fine">Hearts are only lost if you fail or quit.</p>`;
  handlers['modal-level'] = {
    onClose: () => {
      closeModal('level');
      if (cb.onClose) cb.onClose();
    },
    onBooster: (id) => {
      const b = (vm.boosters || []).find((k) => k.id === id);
      if (!b) return;
      if (!(b.count > 0)) {
        if (!b.canAfford) {
          play('error');
          toast(`Not enough ${b.price?.gems ? 'gems' : 'coins'} for ${b.name}.`, { kind: 'bad' });
          return;
        }
        if (cb.onBuyBooster) cb.onBuyBooster(id);
        return;
      }
      if (popupSel.set.has(id)) popupSel.set.delete(id);
      else popupSel.set.add(id);
      renderLevelPopup(vm, cb);
    },
    onPlay: () => {
      if (noHearts) {
        play('error');
        if (cb.onNoHearts) cb.onNoHearts();
        else toast(`No hearts left. Next heart in ${vm.heartsText || 'a while'}.`, { kind: 'bad' });
        return;
      }
      if (cb.onPlay) cb.onPlay([...popupSel.set]);
    },
  };
  openModal('level');
}

/** Booster ids currently selected in the level popup. */
export function selectedBoosters() {
  return [...popupSel.set];
}

// ------------------------------------------------------------------ notebook (shared by results)

/**
 * "What the rival learned about you" block.
 * @typedef {object} NotebookVM
 * @property {string} rivalName
 * @property {boolean} predicting     false for a rival that only takes notes (PIP)
 * @property {number} predN           choices it could judge this match
 * @property {number} acc             share of its top guesses that were right (0..1)
 * @property {number} chance          what a blind guess would get (0..1)
 * @property {Array<{glyph: string, name: string, weight: number, used: boolean}>} rows  weight 0..100
 */
function notebookHTML(nb) {
  if (!nb) return '';
  let line;
  if (!nb.predicting) line = `${esc(nb.rivalName)} was not predicting yet, only taking notes for the others.`;
  else if (nb.predN >= 3) line = `It guessed your next stop <b>${pct(nb.acc)}</b> of the time. A blind guess would get ${pct(nb.chance)}.`;
  else line = 'Not enough choices this match to judge its guesses.';
  const rows = (nb.rows || [])
    .map((r) => `<div class="nb-row ${r.used ? '' : 'off'}"><span class="nm">${esc(r.glyph)} ${esc(r.name)}</span><span class="bar"><i style="width:${clamp(+r.weight || 0, 0, 100)}%"></i></span><span class="tag3">${r.used ? '' : 'not used'}</span></div>`)
    .join('');
  return `<div class="nb-head">WHAT ${esc(nb.rivalName)} LEARNED ABOUT YOU</div><div class="nb-line">${line}</div>${rows}<div class="nb-foot">Bars: how much each habit explains your choices (the rival's model weights).</div>`;
}

// ------------------------------------------------------------------ level result

let resultTimers = [];
let resultGen = 0; // bumps on every stop, so running count-ups end themselves
function stopResultAnim() {
  resultTimers.forEach(clearTimeout);
  resultTimers = [];
  resultGen++;
}
function later(ms, fn) {
  resultTimers.push(setTimeout(fn, ms));
}
// Counts an element's number up from 0 over `dur` ms (eased), calling tick() every few steps.
function countUp(el, to, dur, tick) {
  if (!el) return;
  const gen = resultGen;
  const t0 = performance.now();
  let last = -1;
  const step = (now) => {
    if (gen !== resultGen) return;
    const k = clamp((now - t0) / dur, 0, 1);
    const v = Math.round(to * (1 - Math.pow(1 - k, 3)));
    if (v !== last) {
      el.textContent = fmt(v);
      last = v;
    }
    if (tick) tick(k);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Level result (opens the modal). Win: stars pop in one by one, the score counts up, rewards and
 * badges appear. Fail: the heart lost, why, a tip.
 * @param {object} vm
 * @param {boolean} vm.passed
 * @param {number} vm.id
 * @param {string} vm.name
 * @param {number} vm.stars              stars earned this attempt (0..3)
 * @param {number} vm.score
 * @param {number} [vm.best]             best score after this attempt
 * @param {boolean} [vm.newBest]
 * @param {boolean} [vm.firstClear]
 * @param {number} [vm.coins]            coins earned
 * @param {number} [vm.gems]             gems earned
 * @param {boolean} [vm.hasNext]         NEXT LEVEL is available
 * @param {{name: string, color: string, portrait?: string}} vm.rival
 * @param {string} [vm.playerPortrait]
 * @param {{player: number, rival: number}} [vm.matchStars]  orders won by each side
 * @param {string} [vm.quote]            the rival's line
 * @param {string} [vm.reason]           fail: what went wrong ("FOX won 3-1", "Time ran out"...)
 * @param {string} [vm.tip]              fail: advice from what happened
 * @param {boolean} [vm.heartLost]
 * @param {number} [vm.hearts]           hearts left
 * @param {string} [vm.heartsText]       time to the next heart
 * @param {NotebookVM} [vm.notebook]     "what the rival learned" (collapsible)
 * @param {object} cb  onNext(), onReplay(), onMap(), onRetry()
 */
export function renderLevelResult(vm, cb = {}) {
  stopResultAnim();
  const card = $('result-card');
  const ms = vm.matchStars;
  const vsLine = ms ? `<div class="lr-vs">${avatar({ name: 'You', color: '#3d7bff', portrait: vm.playerPortrait }, 'av-sm')}<b>${ms.player}</b><span>–</span><b style="color:${esc(vm.rival.color)}">${ms.rival}</b>${avatar(vm.rival, 'av-sm')}</div>` : '';
  const quote = vm.quote ? `<div class="lr-quote">${avatar(vm.rival, 'av-sm')}<p>“${esc(vm.quote)}”</p></div>` : '';
  const nb = vm.notebook
    ? `<details class="lr-learn"><summary>${svgIcon('eye', 'lr-eye')} What ${esc(vm.notebook.rivalName)} learned about you</summary><div class="notebook">${notebookHTML(vm.notebook)}</div></details>`
    : '';
  if (vm.passed) {
    card.className = 'modal-card result-card win';
    card.innerHTML = `
      <div class="lr-rays"></div>
      <div class="ribbon"><span>LEVEL COMPLETE!</span></div>
      <div class="lr-sub">Level ${vm.id} · ${esc(vm.name)}</div>
      <div class="lr-stars">${[0, 1, 2].map((i) => `<span class="lr-star s${i}">${svgIcon('star-empty', 'lr-empty')}${i < vm.stars ? svgIcon('star', 'lr-full') : ''}</span>`).join('')}</div>
      <div class="lr-score"><small>SCORE</small><b id="lr-score">0</b></div>
      <div class="lr-badges">${vm.newBest ? '<i class="badge-new">NEW BEST!</i>' : vm.best ? `<i class="badge-best">BEST ${fmt(vm.best)}</i>` : ''}${vm.firstClear ? '<i class="badge-first">FIRST CLEAR</i>' : ''}</div>
      <div class="lr-rewards">
        ${vm.coins ? `<div class="rw rw-coin">${svgIcon('coin')}<b>+<span id="lr-coins">0</span></b></div>` : ''}
        ${vm.gems ? `<div class="rw rw-gem">${svgIcon('gem')}<b>+<span id="lr-gems">0</span></b></div>` : ''}
      </div>
      ${vsLine}${quote}${nb}
      <div class="lr-btns">
        ${vm.hasNext ? `<button class="btn btn-green btn-lg" data-act="next"><span class="btn-main">NEXT LEVEL ${svgIcon('play', 'bi-inline')}</span></button>` : ''}
        <div class="row">
          <button class="btn btn-blue" data-act="replay">${svgIcon('refresh', 'bi-inline')} REPLAY</button>
          <button class="btn btn-white" data-act="map">${svgIcon('flag', 'bi-inline')} MAP</button>
        </div>
      </div>`;
    // Choreography: stars one at a time, then the score, then the rewards.
    later(250, () => play('levelComplete'));
    for (let i = 0; i < 3; i++) {
      if (i >= vm.stars) break;
      later(550 + i * 420, () => {
        card.querySelector(`.lr-star.s${i}`)?.classList.add('on');
        play('star', i);
      });
    }
    const tScore = 500 + Math.max(1, vm.stars) * 420;
    later(Math.min(tScore, 900), () => countUp($('lr-score'), vm.score || 0, 1100));
    later(tScore + 500, () => {
      card.querySelector('.lr-rewards')?.classList.add('on');
      if (vm.coins) countUp($('lr-coins'), vm.coins, 700, (k) => k < 1 && Math.random() < 0.25 && play('coin'));
      if (vm.gems) countUp($('lr-gems'), vm.gems, 500);
      if (vm.coins || vm.gems) play('coin');
    });
    later(tScore + 900, () => card.querySelector('.lr-badges')?.classList.add('on'));
  } else {
    card.className = 'modal-card result-card fail';
    card.innerHTML = `
      <div class="ribbon"><span>LEVEL FAILED</span></div>
      <div class="lr-sub">Level ${vm.id} · ${esc(vm.name)}</div>
      ${vm.heartLost ? `<div class="lr-heart">${svgIcon('heart-broken', 'lr-hb')}<b>-1</b></div><div class="lr-hearts">${vm.hearts ?? 0} left${vm.heartsText ? ` · next in ${esc(vm.heartsText)}` : ''}</div>` : ''}
      ${vm.reason ? `<div class="lr-reason">${esc(vm.reason)}</div>` : ''}
      ${vm.tip ? `<div class="lr-tip">${svgIcon('help', 'lr-tip-ic')}<p><b>TIP</b> ${esc(vm.tip)}</p></div>` : ''}
      <div class="lr-score small"><small>SCORE</small><b>${fmt(vm.score || 0)}</b></div>
      ${vsLine}${quote}${nb}
      <div class="lr-btns">
        <button class="btn btn-green btn-lg" data-act="retry"><span class="btn-main">RETRY</span><span class="lp-heart">${svgIcon('heart')}<b>1</b></span></button>
        <button class="btn btn-white" data-act="map">${svgIcon('flag', 'bi-inline')} MAP</button>
      </div>`;
    later(200, () => play('fail'));
    if (vm.heartLost) later(700, () => play('heart'));
  }
  handlers['modal-result'] = { onNext: cb.onNext, onReplay: cb.onReplay, onMap: cb.onMap, onRetry: cb.onRetry };
  openModal('result');
}

// ------------------------------------------------------------------ quick race / daily results

/**
 * Results of a Quick Race or Daily Commission (the 2D results, restyled): score, items, stats, tip,
 * unlocks, Tells, the rival's notebook, the rival's quote, daily line.
 * @param {object} vm
 * @param {boolean} vm.win
 * @param {{name: string, color: string, portrait?: string}} vm.rival
 * @param {{player: number, rival: number}} vm.stars
 * @param {string} [vm.playerColor]
 * @param {string} [vm.playerPortrait]
 * @param {Array<{id: string, name: string, won: boolean, isNew?: boolean}>} vm.items
 * @param {{snatched: number, outread: number, fooled: number, seconds: number}} vm.stats
 * @param {string} [vm.tip]
 * @param {{name: string, color: string, title: string}|null} [vm.unlocked]  new rival unlocked
 * @param {Array<{type: 'detected'|'relapsed'|'broken', glyph: string, name: string, blurb: string,
 *         acc?: number, chance?: number}>} [vm.tells]
 * @param {NotebookVM} [vm.notebook]
 * @param {{text: string, sub: string}} [vm.quote]
 * @param {string|null} [vm.daily]       daily status line (null for Quick Race)
 * @param {number} [vm.coins]            coins earned
 * @param {boolean} [vm.canNext]         NEXT RIVAL available
 * @param {boolean} [vm.isDaily]
 * @param {object} cb  onAgain(), onNext(), onShare(), onCodex(), onMenu()
 */
export function renderResults(vm, cb = {}) {
  handlers['screen-results'] = cb;
  const r = vm.rival;
  const col = esc(r.color);
  $('res-title').innerHTML = vm.win ? `YOU OUT-CRAFTED<br><span style="color:${col}">${esc(r.name)}</span>` : `<span style="color:${col}">${esc(r.name)}</span> OUT-CRAFTED YOU`;
  $('res-banner').className = `ribbon ${vm.win ? '' : 'lose'}`;
  $('res-banner').innerHTML = `<span>${vm.win ? 'VICTORY!' : 'DEFEAT'}</span>`;
  $('res-score').innerHTML = `${avatar({ name: 'You', color: vm.playerColor || '#3d7bff', portrait: vm.playerPortrait }, 'av-md')}<b style="color:${esc(vm.playerColor || '#3d7bff')}">${vm.stars.player}</b><span>–</span><b style="color:${col}">${vm.stars.rival}</b>${avatar(r, 'av-md')}`;
  $('res-items').innerHTML = (vm.items || [])
    .map((it) => `<div class="res-item ${it.won ? 'won' : 'lost'}"><img alt="" src="${artURL('item', it.id, 96)}">${esc(it.name)}${it.isNew ? '<span class="new">NEW</span>' : ''}</div>`)
    .join('');
  const s = vm.stats || {};
  $('res-stats').innerHTML = `<span><b>${s.snatched || 0}</b> snatched from you</span><span><b>${s.outread || 0}</b> times you got there first</span><span><b>${s.fooled || 0}</b> fake-outs</span><span><b>${Math.round(s.seconds || 0)}</b>s</span>${vm.tip ? `<div class="tip">Tip: ${esc(vm.tip)}</div>` : ''}`;
  const coins = $('res-coins');
  coins.hidden = !vm.coins;
  if (vm.coins) coins.innerHTML = `${svgIcon('coin')}<b>+${fmt(vm.coins)}</b>`;
  const un = $('res-unlock');
  un.hidden = !vm.unlocked;
  if (vm.unlocked) un.innerHTML = `New rival unlocked: <b style="color:${esc(vm.unlocked.color)}">${esc(vm.unlocked.name)}</b>, ${esc(vm.unlocked.title)}`;
  $('res-tells').innerHTML = (vm.tells || [])
    .map((e) => {
      if (e.type === 'broken') return `<div class="tell-event broken"><span class="g">${esc(e.glyph)}</span><div><span class="tag2" style="color:#1f9a58">TELL BROKEN</span> <b>${esc(e.name)}</b>: they can't read it anymore.</div></div>`;
      return `<div class="tell-event detected"><span class="g">${esc(e.glyph)}</span><div><span class="tag2" style="color:#d9384f">${e.type === 'relapsed' ? 'RELAPSED' : 'NEW TELL'}</span> <b>${esc(e.name)}</b>: ${esc(e.blurb)} Read ${pct(e.acc)} vs ${pct(e.chance)} by chance.</div></div>`;
    })
    .join('');
  $('res-notebook').innerHTML = notebookHTML(vm.notebook);
  $('res-notebook').hidden = !vm.notebook;
  const q = vm.quote;
  $('res-quote').hidden = !q;
  if (q) $('res-quote').innerHTML = `${avatar(r, 'q-av')}“${esc(q.text)}”<small>${esc(q.sub || '')}</small>`;
  const d = $('res-daily');
  d.hidden = !vm.daily;
  if (vm.daily) d.textContent = vm.daily;
  $('btn-res-next').hidden = !vm.canNext;
  setText('btn-res-again-t', vm.isDaily ? 'PLAY AGAIN' : 'REMATCH');
  setText('btn-res-share-t', vm.isDaily ? 'SHARE DAILY' : 'SHARE');
  play(vm.win ? 'levelComplete' : 'fail');
}

// ------------------------------------------------------------------ quick race rival list

let rivalSel = 0;
/**
 * Quick Race rival ladder. Selection is handled here; RACE calls onRace(index).
 * @param {object} vm
 * @param {Array<{name: string, title: string, blurb: string, color: string, portrait?: string,
 *         locked: boolean, beaten?: boolean, next?: boolean}>} vm.rivals
 * @param {number} vm.selected           index selected when the list opens
 * @param {object} cb  onRace(index), onSelect(index), onBack()
 */
export function renderRivals(vm, cb = {}) {
  rivalSel = vm.selected ?? 0;
  const draw = () => {
    $('rival-list').innerHTML = vm.rivals
      .map((r, i) => {
        const status = r.locked ? `${svgIcon('lock', 'rs-ic')} LOCKED` : r.beaten ? `${svgIcon('check', 'rs-ic')} BEATEN` : r.next ? 'NEXT' : '';
        return `<button class="rival-card ${r.locked ? 'locked' : ''} ${i === rivalSel ? 'sel' : ''}" data-act="pick" data-arg="${i}" style="--c:${esc(r.color)}">
          ${avatar(r, 'av-md')}<div class="rc-txt"><div class="rival-name">${esc(r.name)}</div><div class="rival-title">${esc(r.title)}</div><div class="rival-blurb">${esc(r.blurb)}</div></div>
          <div class="rival-status ${r.beaten ? 'beaten' : ''} ${r.next ? 'next' : ''}">${status}</div></button>`;
      })
      .join('');
    setText('btn-race-t', `RACE ${vm.rivals[rivalSel]?.name || ''}`);
  };
  handlers['screen-rivals'] = {
    onBack: cb.onBack,
    onPick: (arg) => {
      const i = +arg;
      if (vm.rivals[i]?.locked) {
        play('error');
        toast(`Beat ${vm.rivals[i - 1]?.name || 'the previous rival'} to unlock ${vm.rivals[i].name}.`);
        return;
      }
      rivalSel = i;
      draw();
      if (cb.onSelect) cb.onSelect(i);
    },
    onRace: () => cb.onRace && cb.onRace(rivalSel),
  };
  draw();
}

// ------------------------------------------------------------------ shop

let shopTab = 'skins';
/**
 * Shop with three tabs. The skins tab has a live 3D preview canvas (#shop-preview, see
 * shopPreviewCanvas()) on a pedestal; set vm.previewLive when a Preview renders into it, otherwise the
 * selected skin's portrait is shown there.
 * @param {object} vm
 * @param {'skins'|'boosters'|'hearts'} [vm.tab]   tab to show (default: the last one)
 * @param {string} [vm.selectedSkin]      skin shown in the preview (default: equipped)
 * @param {boolean} [vm.previewLive]
 * @param {Array<{id: string, name: string, desc: string, rarity: string, rarityName: string,
 *         rarityColor: string, portrait?: string, price: {coins?: number, gems?: number}|null,
 *         sourceText?: string, owned: boolean, equipped: boolean, canAfford: boolean}>} vm.skins
 *         sourceText explains how to get a skin that is not sold ("Day 7 daily reward")
 * @param {Array<{id: string, name: string, desc: string, icon?: string, count: number,
 *         price: {coins?: number, gems?: number}, pack?: number, canAfford: boolean}>} vm.boosters
 * @param {{n: number, max: number, nextText?: string, refillGems: number, canRefill: boolean}} vm.hearts
 * @param {Array<{id: string, gems: number, coins: number, canAfford: boolean, label?: string}>} [vm.exchange]
 *         gems -> coins offers
 * @param {object} cb  onTab(tab), onSelectSkin(id), onBuy(id) (skin, booster or exchange id),
 *                     onEquip(id), onRefill(), onBack()
 */
export function renderShop(vm, cb = {}) {
  if (vm.tab) shopTab = vm.tab;
  const skins = vm.skins || [];
  const sel = skins.find((s) => s.id === vm.selectedSkin) || skins.find((s) => s.equipped) || skins[0];
  for (const b of document.querySelectorAll('#shop-tabs .tab')) b.classList.toggle('on', b.dataset.arg === shopTab);
  for (const p of document.querySelectorAll('#screen-shop .shop-pane')) p.hidden = p.dataset.pane !== shopTab;

  // Skins: preview stage + info + grid.
  if (sel) {
    const stage = $('shop-stage');
    stage.style.setProperty('--rc', sel.rarityColor);
    const fb = $('shop-fallback');
    fb.hidden = !!vm.previewLive || !sel.portrait;
    if (sel.portrait && fb.getAttribute('src') !== sel.portrait) fb.src = sel.portrait;
    let action;
    if (sel.equipped) action = `<button class="btn btn-white btn-lg" disabled>${svgIcon('check', 'bi-inline')} EQUIPPED</button>`;
    else if (sel.owned) action = `<button class="btn btn-green btn-lg" data-act="equip" data-arg="${esc(sel.id)}">EQUIP</button>`;
    else if (sel.price) action = `<button class="btn ${sel.canAfford ? 'btn-orange' : 'btn-grey'} btn-lg" data-act="buy" data-arg="${esc(sel.id)}"><span class="btn-main">BUY ${priceHTML(sel.price)}</span></button>`;
    else action = `<button class="btn btn-grey btn-lg" disabled>${svgIcon('lock', 'bi-inline')} ${esc(sel.sourceText || 'Not sold')}</button>`;
    $('shop-skin-info').innerHTML = `<div class="si-name">${esc(sel.name)} <i class="rar" style="--rc:${esc(sel.rarityColor)}">${esc(sel.rarityName)}</i></div><p class="si-desc">${esc(sel.desc)}</p>${action}`;
  }
  $('shop-skin-grid').innerHTML = skins
    .map((s) => {
      const tag = s.equipped ? `<i class="sk-tag eq">${svgIcon('check', 'sk-ic')}</i>` : s.owned ? '<i class="sk-tag own">OWNED</i>' : s.price ? `<i class="sk-tag price ${s.canAfford ? '' : 'poor'}">${priceHTML(s.price)}</i>` : `<i class="sk-tag src">${svgIcon('lock', 'sk-ic')}</i>`;
      const pic = s.portrait ? `<img alt="" src="${esc(s.portrait)}">` : `<span class="sk-ph">${esc(s.name.slice(0, 1))}</span>`;
      return `<button class="skin-card ${sel && s.id === sel.id ? 'sel' : ''} ${s.owned ? 'owned' : ''}" data-act="skin" data-arg="${esc(s.id)}" style="--rc:${esc(s.rarityColor)}"><span class="sk-pic">${pic}</span><span class="sk-name">${esc(s.name)}</span>${tag}</button>`;
    })
    .join('');

  // Boosters.
  $('shop-boost-list').innerHTML = (vm.boosters || [])
    .map(
      (b) => `<div class="boost-card"><span class="bk-ic">${boosterIcon(b)}<i class="bk-count">×${b.count}</i></span>
      <div class="bk-txt"><b>${esc(b.name)}</b><p>${esc(b.desc)}</p></div>
      <button class="btn ${b.canAfford ? 'btn-orange' : 'btn-grey'} btn-sm" data-act="buy" data-arg="${esc(b.id)}"><span class="btn-main">${b.pack > 1 ? `×${b.pack} ` : ''}${priceHTML(b.price)}</span></button></div>`,
    )
    .join('');

  // Hearts & gems.
  const h = vm.hearts || { n: 0, max: 5, refillGems: 0, canRefill: false };
  let hearts = '';
  for (let i = 0; i < h.max; i++) hearts += svgIcon(i < h.n ? 'heart' : 'heart-empty', 'hh');
  const full = h.n >= h.max;
  $('shop-hearts-card').innerHTML = `<div class="hc-row">${hearts}</div>
    <p class="hc-txt">${full ? 'Your hearts are full. Go play!' : `Next heart in <b>${esc(h.nextText || '--:--')}</b>. Hearts refill on their own.`}</p>
    <button class="btn ${!full && h.canRefill ? 'btn-pink' : 'btn-grey'} btn-lg" data-act="refill" ${full ? 'disabled' : ''}><span class="btn-main">REFILL ${svgIcon('gem', 'pi')}<b>${fmt(h.refillGems)}</b></span></button>`;
  $('shop-exchange').innerHTML = (vm.exchange || [])
    .map(
      (x) => `<button class="xchg ${x.canAfford ? '' : 'poor'}" data-act="buy" data-arg="${esc(x.id)}">
      <span class="xc-top">${svgIcon('coin', 'xc-coin')}<b>${fmt(x.coins)}</b></span><span class="xc-lbl">${esc(x.label || 'coins')}</span>
      <span class="xc-price">${svgIcon('gem', 'pi')}<b>${fmt(x.gems)}</b></span></button>`,
    )
    .join('');

  handlers['screen-shop'] = {
    onBack: cb.onBack,
    onTab: (tab) => {
      shopTab = tab;
      renderShop({ ...vm, tab }, cb);
      if (cb.onTab) cb.onTab(tab);
    },
    onSkin: (id) => {
      renderShop({ ...vm, selectedSkin: id }, cb);
      if (cb.onSelectSkin) cb.onSelectSkin(id);
    },
    onEquip: (id) => cb.onEquip && cb.onEquip(id),
    onBuy: (id) => {
      const item = [...skins, ...(vm.boosters || []), ...(vm.exchange || [])].find((k) => k.id === id);
      if (item && item.canAfford === false) {
        play('error');
        toast('Not enough to buy that yet. Win levels to earn more!', { kind: 'bad' });
        return;
      }
      if (cb.onBuy) cb.onBuy(id);
    },
    onRefill: () => {
      if (!h.canRefill) {
        play('error');
        toast(`A refill costs ${h.refillGems} gems.`, { kind: 'bad' });
        return;
      }
      if (cb.onRefill) cb.onRefill();
    },
  };
}

/** The canvas the 3D skin Preview should render into (always the same element). */
export function shopPreviewCanvas() {
  return $('shop-preview');
}

/** Current shop tab. */
export function shopCurrentTab() {
  return shopTab;
}

// ------------------------------------------------------------------ daily reward

const REWARD_ICON = { coins: 'coin', gems: 'gem', booster: 'gift', skin: 'crown', hearts: 'heart' };
/**
 * Daily reward calendar (opens the modal).
 * @param {object} vm
 * @param {number} vm.day                today's day in the 7-day cycle (1..7)
 * @param {boolean} vm.canClaim
 * @param {Array<{day: number, label: string, kind: 'coins'|'gems'|'booster'|'skin'|'hearts',
 *         amount?: number, icon?: string, claimed: boolean, today: boolean}>} vm.rewards   7 entries
 * @param {string} [vm.nextText]         when claimed: time until tomorrow's reward
 * @param {object} cb  onClaim(), onClose()
 */
export function renderDailyReward(vm, cb = {}) {
  const tiles = (vm.rewards || [])
    .map((r) => {
      const state = r.claimed ? 'claimed' : r.today ? 'today' : 'future';
      const ic = BOOSTER_ICON[r.icon] ? boosterIcon({ icon: r.icon }) : svgIcon(REWARD_ICON[r.kind] || 'gift', 'dr-ic');
      return `<div class="dr-tile ${state} ${r.day === 7 ? 'big' : ''}"><small>DAY ${r.day}</small><span class="dr-art">${ic}</span><b>${esc(r.label)}</b>${r.claimed ? `<i class="dr-done">${svgIcon('check')}</i>` : ''}</div>`;
    })
    .join('');
  $('daily-card').innerHTML = `
    <button class="ibtn ibtn-close" data-act="close" aria-label="Close">${svgIcon('close')}</button>
    <div class="ribbon"><span>DAILY REWARD</span></div>
    <p class="dr-sub">Come back every day. Day 7 is special!</p>
    <div class="dr-grid">${tiles}</div>
    ${vm.canClaim ? `<button class="btn btn-green btn-xl" data-act="claim"><span class="btn-main">CLAIM DAY ${vm.day}</span></button>` : `<div class="dr-next">${svgIcon('clock', 'dr-clock')} Next reward in <b>${esc(vm.nextText || 'tomorrow')}</b></div>`}`;
  handlers['modal-daily'] = {
    onClose: () => {
      closeModal('daily');
      if (cb.onClose) cb.onClose();
    },
    onClaim: () => cb.onClaim && cb.onClaim(),
  };
  openModal('daily');
}

// ------------------------------------------------------------------ achievements

/**
 * Achievements list.
 * @param {object} vm
 * @param {Array<{id: string, name: string, desc: string, icon?: string, cur: number, target: number,
 *         done: boolean, claimed: boolean, reward: {label: string, kind?: 'coins'|'gems'|'skin'}}>} vm.list
 * @param {object} cb  onClaim(id), onBack()
 */
export function renderAchievements(vm, cb = {}) {
  handlers['screen-achievements'] = cb;
  const list = vm.list || [];
  const ready = list.filter((a) => a.done && !a.claimed).length;
  setText('ach-summary', ready ? `${ready} ready to claim!` : `${list.filter((a) => a.claimed).length}/${list.length} done`);
  $('ach-list').innerHTML = list
    .map((a) => {
      const k = a.target > 0 ? clamp(a.cur / a.target, 0, 1) : 0;
      const rk = a.reward?.kind || 'coins';
      const rIc = svgIcon(rk === 'gems' ? 'gem' : rk === 'skin' ? 'crown' : 'coin', 'ar-ic');
      const btn = a.claimed ? `<i class="ach-claimed">${svgIcon('check', 'ac-ic')} DONE</i>` : a.done ? `<button class="btn btn-green btn-sm ach-claim" data-act="claim" data-arg="${esc(a.id)}">CLAIM</button>` : `<i class="ach-reward">${rIc}${esc(a.reward?.label || '')}</i>`;
      return `<div class="ach ${a.claimed ? 'claimed' : a.done ? 'ready' : ''}">
        <span class="ach-ic">${a.icon && !hasIcon(a.icon) ? `<span class="ach-emoji">${esc(a.icon)}</span>` : svgIcon(a.icon || 'trophy')}</span>
        <div class="ach-txt"><b>${esc(a.name)}</b><p>${esc(a.desc)}</p>
          <div class="ach-bar"><i style="width:${(k * 100).toFixed(1)}%"></i><span>${fmt(Math.min(a.cur, a.target))}/${fmt(a.target)}</span></div></div>
        <div class="ach-side">${btn}</div></div>`;
    })
    .join('');
}

// ------------------------------------------------------------------ settings

/**
 * Settings. Every control reports through onChange(key, value).
 * @param {object} vm
 * @param {'auto'|'low'|'medium'|'high'} vm.quality
 * @param {boolean} vm.sound
 * @param {boolean} vm.music
 * @param {number} vm.sensitivity        camera sensitivity (0.3..2)
 * @param {boolean} vm.invertY
 * @param {boolean} vm.autoReturn        auto-walk home when the bag is full
 * @param {boolean} vm.glass             show the rival's thoughts
 * @param {string} [vm.info]             small footer text (version, fps...)
 * @param {object} cb  onChange(key, value) with key in quality|sound|music|sensitivity|invertY|
 *                     autoReturn|glass; onReset(); onHow(); onAbout(); onBack()
 */
export function renderSettings(vm, cb = {}) {
  handlers['screen-settings'] = {
    ...cb,
    onQuality: (q) => {
      for (const b of document.querySelectorAll('#set-quality button')) b.classList.toggle('on', b.dataset.arg === q);
      if (cb.onChange) cb.onChange('quality', q);
    },
  };
  for (const b of document.querySelectorAll('#set-quality button')) b.classList.toggle('on', b.dataset.arg === vm.quality);
  for (const k of ['sound', 'music', 'invertY', 'autoReturn', 'glass']) {
    const el = document.querySelector(`#screen-settings [data-set="${k}"]`);
    if (el) el.checked = !!vm[k];
  }
  const sens = document.querySelector('#screen-settings [data-set="sensitivity"]');
  if (sens) sens.value = String(vm.sensitivity ?? 1);
  setText('set-sens-out', `${(+(vm.sensitivity ?? 1)).toFixed(1)}x`);
  setText('set-info', vm.info || '');
}

// ------------------------------------------------------------------ codex and tells

/**
 * Codex of crafted items + your Tells.
 * @param {object} vm
 * @param {Array<{id: string, name: string, tier: number, got: boolean, count: number, flavor: string}>} vm.items
 * @param {Array<{glyph: string, name: string, blurb: string, status: 'locked'|'detected'|'broken',
 *         statusText?: string}>} vm.tells
 * @param {{matches: number, wins: number, snatched: number, outread: number, notebook: number}} vm.meta
 * @param {object} cb  onBack(), onForget()
 */
export function renderCodex(vm, cb = {}) {
  handlers['screen-codex'] = cb;
  const items = vm.items || [];
  setText('codex-count', `${items.filter((i) => i.got).length}/${items.length}`);
  $('codex-grid').innerHTML = items
    .map((it) => `<div class="codex-item ${it.got ? '' : 'locked'}" title="${esc(it.got ? it.flavor : 'Win an order for this item to add it')}"><img alt="" src="${artURL('item', it.id, 96, !it.got)}"><div class="ci-name">${it.got ? esc(it.name) : '???'}</div><div class="tier">${'★'.repeat(it.tier)}</div><div class="cnt">${it.got ? `crafted ×${it.count}` : 'not yet'}</div></div>`)
    .join('');
  $('tells-grid').innerHTML = (vm.tells || [])
    .map((t) => (t.status === 'locked' ? '<div class="tell-card"><b>???</b><br>Not detected yet.</div>' : `<div class="tell-card ${t.status}"><b>${esc(t.glyph)} ${esc(t.name)}</b><br>${esc(t.blurb)}<div class="st">${esc(t.statusText || '')}</div></div>`))
    .join('');
  const m = vm.meta || {};
  $('codex-meta').innerHTML = `Matches <b>${fmt(m.matches)}</b> · Wins <b>${fmt(m.wins)}</b> · Snatched from you <b>${fmt(m.snatched)}</b> · You beat them to <b>${fmt(m.outread)}</b>.<br>Notebook: <b>${fmt(m.notebook)}</b> choices. Stored only on this device.`;
}

// ------------------------------------------------------------------ pause, how to play, about

/**
 * Pause menu (opens the modal).
 * @param {object} vm
 * @param {string} [vm.title]            e.g. 'Level 12 · Frozen Falls' or 'Quick Race vs FOX'
 * @param {boolean} vm.glass             show the rival's thoughts
 * @param {boolean} [vm.canRestart]
 * @param {string} [vm.quitText]         e.g. 'QUIT (-1 heart)'
 * @param {object} cb  onResume(), onRestart(), onSettings(), onQuit(), onGlass(on)
 */
export function renderPause(vm, cb = {}) {
  setText('pause-title', vm.title || '');
  $('pause-restart').hidden = vm.canRestart === false;
  setText('pause-quit-t', vm.quitText || 'QUIT');
  const g = $('pause-glass');
  g.checked = !!vm.glass;
  handlers['modal-pause'] = {
    ...cb,
    onChange: (key, value) => key === 'glass' && cb.onGlass && cb.onGlass(value),
  };
  openModal('pause');
}

/** How to play. @param {{okText?: string}} vm  cb: onOk() */
export function renderHow(vm = {}, cb = {}) {
  handlers['screen-how'] = cb;
  setText('how-ok-t', vm.okText || 'GOT IT');
}

/** About. @param {{completed?: string, author?: string, docsHref?: string}} vm  cb: onBack() */
export function renderAbout(vm = {}, cb = {}) {
  handlers['screen-about'] = cb;
  if (vm.completed) setText('about-done', vm.completed);
  if (vm.author) setText('about-author', vm.author);
  if (vm.docsHref) $('about-doc').href = vm.docsHref;
}

/** Wire the static sections that need no view model (loading, no-WebGL). cb: onClassic() */
export function renderStatic(cb = {}) {
  handlers['screen-nogl'] = cb;
}
