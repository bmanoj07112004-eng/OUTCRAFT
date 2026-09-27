// Shared context of the 3D edition: the save file, the rivals' shared notebook, the 3D engine pieces and
// the HUD (filled in by main.js at boot), plus the game clock and a small scheduler that runs on it.
//
// Everything timed in the game (delayed feedback, the VS splash, the results after a match) goes through
// later() on the game clock rather than setTimeout, so the test hook advance(ms) can fast-forward it.

import { portraitURL } from '../3d/characters.js';
import { SKIN_BY_ID, DEFAULT_SKIN } from '../skins.js';

export const REPO_URL = 'https://github.com/bmanoj07112004-eng/OUTCRAFT';
export const ABOUT = { author: 'B Manoj', completed: '23 Sep 2026 · 3D edition' };
export const STEP = 1 / 60; // fixed simulation step (s)

const params = new URLSearchParams(location.search);

export const app = {
  state: null, // save file (src/storage.js)
  model: null, // PlayerModel: what the rivals know about you (shared by Adventure and Quick Race)
  engine: null,
  island: null,
  fx: null,
  cam: null,
  input: null,
  hud: null,
  stage: null, // src/game/stage.js: characters + island bound to the match on screen
  mode: 'boot', // boot | menu | play | paused | over
  blind: params.get('blind') === '1', // ablation: the rival's reads switched off
  params,
  stick: null, // test hook override for the joystick { x, y }
};

// ------------------------------------------------------------------ game clock
let offset = 0;
let frozen = null; // test hook: a stopped clock only moves with skipClock()
export const clock = () => (frozen !== null ? frozen : performance.now() + offset);
export function skipClock(ms) {
  if (frozen !== null) frozen += ms;
  else offset += ms;
}
export function freezeClock(on) {
  if (on && frozen === null) frozen = performance.now() + offset;
  else if (!on && frozen !== null) {
    offset = frozen - performance.now();
    frozen = null;
  }
}

// ------------------------------------------------------------------ scheduler on the game clock
const jobs = [];

// Run fn after ms of game time. tag groups jobs so a whole group can be cancelled (e.g. 'match').
export function later(ms, fn, tag = '') {
  jobs.push({ at: clock() + ms, fn, tag });
}

export function cancelLater(tag) {
  for (let i = jobs.length - 1; i >= 0; i--) if (!tag || jobs[i].tag === tag) jobs.splice(i, 1);
}

// Push a group of jobs back (e.g. by the time the game spent paused).
export function shiftLater(tag, ms) {
  for (const j of jobs) if (j.tag === tag) j.at += ms;
}

export function runDue(now) {
  if (!jobs.length) return;
  // Collect first: a job may schedule or cancel others.
  const due = [];
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].at <= now) {
      due.push(jobs[i]);
      jobs.splice(i, 1);
    }
  }
  due.sort((a, b) => a.at - b.at);
  for (const j of due) {
    try {
      j.fn();
    } catch (err) {
      console.error(err);
    }
  }
}

// ------------------------------------------------------------------ small shared helpers
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const pct = (x) => `${Math.round(x * 100)}%`;

export function equippedSkin() {
  return SKIN_BY_ID[app.state.inventory.equipped] || SKIN_BY_ID[DEFAULT_SKIN];
}

// Portraits are rendered offscreen once per look and cached by characters.js.
export function playerPortrait(size = 96) {
  return portraitURL('player', equippedSkin(), size);
}

export function rivalPortrait(def, size = 96) {
  return portraitURL('rival', def, size);
}

// "mm:ss" (or "h:mm:ss") for a countdown in ms.
export function countdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// "9 h 12 min" style, for waits measured in hours.
export function longWait(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
