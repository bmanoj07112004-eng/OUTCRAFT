// Shared context of the 3D edition: the save file, the rivals' shared notebook, the 3D engine pieces and
// the HUD (filled in by main.js at boot), plus the game clock and a small scheduler that runs on it.
//
// Everything timed in the game (delayed feedback, the VS splash, the results after a match) goes through
// later() on the game clock rather than setTimeout, so the test hook advance(ms) can fast-forward it.
// The clock stands still while a match is paused, while the tab is hidden and while the 3D view is lost.
//
// The save is written through commit(): another tab (or the classic game) may have saved in between.

import { portraitURL } from '../3d/characters.js';
import { SKIN_BY_ID, DEFAULT_SKIN } from '../skins.js';
import { PlayerModel } from '../model.js';
import * as store from '../storage.js';

export const REPO_URL = 'https://github.com/bmanoj07112004-eng/OUTCRAFT';
export const ABOUT = { author: 'B Manoj', completed: '23 Sep 2026 · first public build' };
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
  redraw: false, // render one frame even though the 3D view is still (a pause, a resize)
  saveChanged: false, // another tab wrote the save during this match: finish() reloads it first
  onSaveReloaded: null, // (live) => void: the save was reloaded from storage (menus re-render)
  onSaveFailed: null, // (reason) => void: a write failed ('blocked' | 'quota')
};

// ------------------------------------------------------------------ game clock
let offset = 0;
let frozen = null; // test hook: a stopped clock only moves with skipClock()
let stoppedAt = null; // game time at which stopClock() stopped it
const stops = new Set();
const running = () => (frozen !== null ? frozen : performance.now() + offset);
export const clock = () => (stoppedAt !== null ? stoppedAt : running());
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

// Stop the game clock for a reason ('pause', 'hidden', 'gl'); it runs again, from where it stopped,
// once every reason is gone.
export function stopClock(reason, on = true) {
  if (on) {
    if (!stops.size) stoppedAt = running();
    stops.add(reason);
  } else if (stops.delete(reason) && !stops.size) {
    skipClock(stoppedAt - running());
    stoppedAt = null;
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

// ------------------------------------------------------------------ the save file
// change(state) edits the save and returns a result. When another tab saved a newer version meanwhile
// (store.save refuses a stale write), that version is loaded and the change is applied again on top of it.
export function commit(change) {
  let r = change(app.state);
  if (store.save(app.state)) return r;
  if (store.saveStatus().reason === 'stale') {
    reloadSave();
    r = change(app.state);
    if (store.save(app.state)) return r;
  }
  const why = store.saveStatus().reason;
  if (why !== 'stale' && app.onSaveFailed) app.onSaveFailed(why);
  return r;
}

// Load the stored save (written by another tab). During a match the rivals' notebook in play is kept:
// it is saved with the result.
export function reloadSave() {
  const live = app.mode === 'play' || app.mode === 'paused';
  app.state = store.load();
  if (app.params.get('glass') === '1') app.state.settings.glass = true;
  if (!live) {
    try {
      app.model = new PlayerModel(app.state.model);
    } catch (err) {
      console.error(err);
      app.model = new PlayerModel();
    }
  }
  app.saveChanged = false;
  if (app.onSaveReloaded) app.onSaveReloaded(live);
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
