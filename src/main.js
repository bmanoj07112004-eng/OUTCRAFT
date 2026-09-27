// OUTCRAFT 3D edition: boot and main loop.
//
// Boot: detect WebGL (else a screen linking the 2D classic), show the loading screen, load the save and
// apply its settings, create the shared engine, island, effects, third-person camera, stage, input and
// HUD, warm up shaders and portraits, then show the title with the island playing itself behind it. A
// save that breaks the title is kept aside and the game starts fresh.
// Loop: one requestAnimationFrame that runs the game-clock scheduler, steps either the match being
// played (src/game/play.js) or the title's attract match (src/game/attract.js), updates the camera and
// effects, renders (only while the view moves: not behind opaque menus nor while paused), and ticks the
// menus (src/game/menus.js).
// Also: the game clock stops while the tab is hidden and while WebGL is lost, other tabs' saves are
// picked up, and save problems are shown once.

import { Engine } from './3d/engine.js';
import { Island3D } from './3d/island.js';
import { FX } from './3d/fx.js';
import { ThirdPersonCamera } from './3d/camera.js';
import { Input } from './3d/input.js';
import { HUD } from './ui/hud.js';
import * as S from './ui/screens.js';
import { PlayerModel } from './model.js';
import * as store from './storage.js';
import * as eco from './economy.js';
import { RIVALS } from './data.js';
import { LEVELS, levelById } from './levels.js';
import { sfx, unlockAudio, startMusic, setSound, setMusic, suspendAudio } from './audio.js';
import { app, clock, skipClock, freezeClock, stopClock, runDue, commit, reloadSave, playerPortrait, rivalPortrait, equippedSkin } from './game/app.js';
import { Stage } from './game/stage.js';
import * as play from './game/play.js';
import * as attract from './game/attract.js';
import * as menus from './game/menus.js';

// Screens that cover the whole 3D view: nothing needs rendering behind them.
const OPAQUE = new Set(['screen-map', 'screen-shop', 'screen-achievements', 'screen-settings', 'screen-codex', 'screen-loading', 'screen-nogl']);
const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const RIVAL_BY_ID = Object.fromEntries(RIVALS.map((r) => [r.id, r]));

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

function audioOn() {
  unlockAudio();
  startMusic();
}

// ------------------------------------------------------------------ loop
let lastTime = 0;
let held = false; // test hook: the loop stops ticking (only advance() moves the game)

function tick(now, render = true) {
  const dt = lastTime ? Math.min(0.1, Math.max(0, (now - lastTime) / 1000)) : 0;
  lastTime = now;
  const e = app.engine;
  // Re-layout whenever the window size changed, even if no resize event arrived (hidden tabs, webviews).
  if (e.width !== window.innerWidth || e.height !== window.innerHeight) {
    e.resize();
    app.hud.resize();
    app.redraw = true;
  }
  runDue(now);
  const inMatch = play.active();
  const covered = OPAQUE.has(S.currentScreen());
  // A paused match is a still picture: drawn once (app.redraw), then left alone.
  const live = inMatch ? app.mode !== 'paused' : !covered;
  if (inMatch) play.update(dt, now);
  else attract.update(dt, now, live);
  if (app.mode !== 'paused') app.cam.update(dt);
  updateViewOffset(dt, inMatch);
  if (live || (app.redraw && !covered)) {
    app.fx.update(dt, now);
    if (render) e.render();
    app.redraw = false;
  }
  menus.tick(dt);
}

// On wide screens the title menu sits on the right: slide the island left of centre (a projection
// offset, so the orbit itself is unchanged), easing back to centre for every other view.
let viewOff = 0;
function updateViewOffset(dt, inMatch) {
  const e = app.engine;
  const wide = e.width >= 700 && e.width / e.height >= 1.1;
  const target = !inMatch && wide && S.currentScreen() === 'screen-title' ? e.width * 0.16 : 0;
  viewOff = Math.abs(target - viewOff) < 0.5 ? target : viewOff + (target - viewOff) * (1 - Math.exp(-6 * dt));
  const cam = e.camera;
  if (viewOff >= 0.5) cam.setViewOffset(e.width, e.height, viewOff, 0, e.width, e.height);
  else if (cam.view && cam.view.enabled) cam.clearViewOffset();
}

function frame() {
  requestAnimationFrame(frame);
  if (held) return;
  try {
    tick(clock());
  } catch (err) {
    console.error(err);
  }
}

// ------------------------------------------------------------------ notices
// Small notes pinned to the top of the screen (save problems, lost graphics) until closed or replaced.
const notices = new Map();

function notice(id, text, { kind = 'bad', action = null, onAction = null, closable = false } = {}) {
  let el = notices.get(id);
  if (!el) {
    el = document.createElement('div');
    el.setAttribute('role', 'status');
    document.body.append(el);
    notices.set(id, el);
  }
  el.className = `toast ${kind}`;
  el.textContent = text;
  el.onclick = closable ? () => hideNotice(id) : null;
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn btn-white btn-sm';
    b.style.marginLeft = '10px';
    b.textContent = action;
    b.onclick = onAction;
    el.append(b);
  }
  layoutNotices();
}

function hideNotice(id) {
  const el = notices.get(id);
  if (!el) return;
  el.remove();
  notices.delete(id);
  layoutNotices();
}

function layoutNotices() {
  let top = 10;
  for (const el of notices.values()) {
    el.style.cssText = `top:calc(${top}px + var(--st, 0px));bottom:auto;z-index:90`;
    top += el.offsetHeight + 8;
  }
}

// Progress that cannot be saved is said once (storage blocked or full), and stays until tapped away.
let saveWarned = false;
function warnSave(reason) {
  if (saveWarned) return;
  saveWarned = true;
  notice('save', reason === 'quota' ? "This browser's storage is full: your progress can't be saved. (tap to close)" : "This browser won't let OUTCRAFT save: your progress will be lost when you leave. (tap to close)", { closable: true });
}

// ------------------------------------------------------------------ WebGL context loss
// The race waits (paused, clock stopped) until the browser gives the 3D view back; if it takes more
// than 3 s, offer a reload.
let glTimer = 0;
let glPaused = false;

function onContextLost() {
  stopClock('gl');
  glPaused = play.pause();
  notice('gl', 'Restoring graphics…', { kind: '' });
  clearTimeout(glTimer);
  glTimer = setTimeout(() => notice('gl', 'The 3D view did not come back.', { action: 'RELOAD', onAction: () => location.reload() }), 3000);
}

function onContextRestored() {
  clearTimeout(glTimer);
  hideNotice('gl');
  stopClock('gl', false);
  app.redraw = true;
  if (glPaused && app.mode === 'paused' && S.topModal() === 'modal-pause') play.resume();
  glPaused = false;
}

// ------------------------------------------------------------------ the save
function loadSave() {
  const st = (app.state = store.load());
  if (app.params.get('glass') === '1') st.settings.glass = true;
  app.model = new PlayerModel(st.model);
}

// A save that loads but still breaks the game (a bug, a hand edit): keep a copy of it aside and start
// from a fresh save, rather than failing to boot on every visit.
let rescued = false;
function rescueSave(err) {
  console.error(err);
  store.backup();
  app.state = store.wipe();
  app.model = new PlayerModel();
  commit(() => null);
  rescued = true;
}

// Portraits the first map, level popup and match need, rendered behind the loading bar.
function warmPortraits() {
  playerPortrait(96);
  playerPortrait(128);
  const rival = RIVAL_BY_ID[levelById(eco.currentLevel(app.state)).rival];
  rivalPortrait(rival, 96);
  rivalPortrait(rival, 128);
  for (const l of LEVELS) if (l.boss) rivalPortrait(RIVAL_BY_ID[l.rival], 96);
}

function showTitle() {
  try {
    menus.showTitle();
  } catch (err) {
    rescueSave(err);
    app.stage.setSkin(equippedSkin());
    attract.start({ snap: true });
    menus.showTitle();
  }
  if (rescued) S.toast('Your save was damaged, so the game started over. A copy of it was kept.', { kind: 'bad', dur: 5000 });
}

// ------------------------------------------------------------------ boot
async function boot() {
  S.initScreens({
    sound: (name, ...args) => sfx[name] && sfx[name](...args),
    onAction: audioOn,
  });
  S.renderLoading({ progress: 0.05, text: 'Starting the engine…' });
  if (!hasWebGL()) {
    S.showNoWebGL('WebGL is switched off or not supported here.');
    return;
  }
  try {
    loadSave();
  } catch (err) {
    rescueSave(err);
  }
  // A level left by a reload or a closed tab: its heart stays spent.
  const left = app.state.activeLevel ? commit((s) => eco.takeStaleActiveLevel(s)) : null;
  const st = app.state;
  setSound(st.settings.sound);
  setMusic(st.settings.music);
  await nextFrame();

  const canvas = $('game');
  try {
    app.engine = new Engine(canvas, { quality: st.settings.quality, autoLevel: st.settings.autoLevel });
  } catch (err) {
    console.error(err);
    S.showNoWebGL('The 3D engine could not start on this device.');
    return;
  }
  // Auto quality only switches between matches (play.js), and starts next time where it settled.
  app.engine.onAutoLevel = (level) => commit((s) => (s.settings.autoLevel = level));
  app.engine.onContextLost = onContextLost;
  app.engine.onContextRestored = onContextRestored;
  S.renderLoading({ progress: 0.3, text: 'Building the island…' });
  await nextFrame();
  app.island = new Island3D(app.engine);
  app.fx = new FX(app.engine);
  app.cam = new ThirdPersonCamera(app.engine.camera);
  app.stage = new Stage(app.engine, app.island, app.fx);
  attract.start({ snap: true });
  S.renderLoading({ progress: 0.6, text: 'Waking up the rivals…' });
  await nextFrame();

  app.input = new Input(
    canvas,
    { onTap: (x, y) => play.tap(x, y), onInteract: () => play.interact(), onHome: () => play.home(), onPause: () => play.pause() },
    { sensitivity: st.settings.sensitivity, invertY: st.settings.invertY, ghost: true },
  );
  app.input.setEnabled(false);
  app.hud = new HUD($('hud'), { onInteract: () => play.interact(), onHome: () => play.home(), onPause: () => play.pause(), onSkipVs: () => play.endVs() });
  app.hud.show(false);

  // Menu keys run after the Input module's own handler (which marks the keys it used).
  window.addEventListener('keydown', (e) => {
    audioOn();
    menus.onKey(e);
  });
  window.addEventListener('pointerdown', audioOn, { passive: true });
  // A hidden tab stops the game clock (nothing falls due behind the player's back) and pauses the race.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopClock('hidden');
      play.pause();
      suspendAudio(true);
    } else {
      stopClock('hidden', false);
      if (app.mode !== 'paused') suspendAudio(false);
    }
  });

  // Shaders and portraits are prepared while the loading screen is still up.
  S.renderLoading({ progress: 0.8, text: 'Painting the portraits…' });
  await nextFrame();
  warmPortraits();
  app.cam.update(0);
  await app.engine.warmup();
  app.engine.render();
  S.renderLoading({ progress: 1, text: 'Ready!' });
  await nextFrame();
  app.mode = 'menu';
  showTitle();
  if (left) S.toast(`You left level ${left} before the end: -1 heart.`, { kind: 'bad', dur: 4200 });

  // Another tab saved: take its save now, or when the match in progress ends.
  app.onSaveReloaded = (live) => menus.refreshAfterReload(live);
  app.onSaveFailed = warnSave;
  store.watchExternal(() => {
    if (app.mode === 'play' || app.mode === 'paused') app.saveChanged = true;
    else reloadSave();
  });
  if (!store.storageAvailable()) warnSave(store.saveStatus().reason);
  lastTime = clock();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ hooks for automated playtests
window.__outcraft = {
  get match() {
    const p = play.current();
    return p ? p.match : null;
  },
  get mode() {
    return app.mode;
  },
  get state() {
    return app.state;
  },
  get engine() {
    return app.engine;
  },
  get screen() {
    return S.currentScreen();
  },
  get play() {
    return play.current();
  },
  app,
  menus,
  // Run the game ahead by ms of game time (simulation, scheduler, camera; one render at the end).
  advance(ms, step = 16) {
    for (let t = 0; t < ms; t += step) {
      skipClock(step);
      tick(clock(), false);
    }
    app.engine.render();
  },
  startLevel: (id, boosters = []) => play.startLevel(id, boosters),
  startDaily: () => play.startDaily(),
  startQuick: (i) => play.startQuick(i),
  // Override the joystick (x right, y forward, -1..1); setStick(null) gives control back.
  setStick(x, y) {
    app.stick = x == null ? null : { x: +x || 0, y: +y || 0 };
  },
  tap: (x, y) => play.tap(x, y),
  // Freeze the real-time loop and the game clock (screenshots then show exactly what advance() produced).
  hold(on = true) {
    held = !!on;
    freezeClock(held);
    lastTime = clock();
  },
  // Skip the VS splash and the camera fly-in.
  skipIntro() {
    play.endVs();
    app.cam.skipIntro();
  },
};

// WebGL problems have their own screen (above); anything else is said as it is.
boot().catch((err) => {
  console.error(err);
  S.showScreen('loading');
  S.renderLoading({ progress: 1, text: 'Something went wrong while starting the game. Reload the page to try again.' });
});
