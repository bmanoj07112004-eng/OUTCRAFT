// OUTCRAFT 3D edition: boot and main loop.
//
// Boot: detect WebGL (else a screen linking the 2D classic), show the loading screen, load the save and
// apply its settings, create the shared engine, island, effects, third-person camera, stage, input and
// HUD, then show the title with the island playing itself behind it.
// Loop: one requestAnimationFrame that runs the game-clock scheduler, steps either the match being
// played (src/game/play.js) or the title's attract match (src/game/attract.js), updates the camera and
// effects, renders (skipped behind opaque menus), and ticks the menus (src/game/menus.js).

import { Engine } from './3d/engine.js';
import { Island3D } from './3d/island.js';
import { FX } from './3d/fx.js';
import { ThirdPersonCamera } from './3d/camera.js';
import { Input } from './3d/input.js';
import { HUD } from './ui/hud.js';
import * as S from './ui/screens.js';
import { PlayerModel } from './model.js';
import * as store from './storage.js';
import { sfx, unlockAudio, startMusic, setSound, setMusic, suspendAudio } from './audio.js';
import { app, clock, skipClock, freezeClock, runDue } from './game/app.js';
import { Stage } from './game/stage.js';
import * as play from './game/play.js';
import * as attract from './game/attract.js';
import * as menus from './game/menus.js';

// Screens that cover the whole 3D view: nothing needs rendering behind them.
const OPAQUE = new Set(['screen-map', 'screen-shop', 'screen-achievements', 'screen-settings', 'screen-codex', 'screen-loading', 'screen-nogl']);
const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

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
  }
  runDue(now);
  const inMatch = play.active();
  const visible = inMatch || !OPAQUE.has(S.currentScreen());
  if (inMatch) play.update(dt, now);
  else attract.update(dt, now, visible);
  if (app.mode !== 'paused') app.cam.update(dt);
  updateViewOffset(dt, inMatch);
  if (visible) {
    app.fx.update(dt, now);
    if (render) e.render();
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
  const st = (app.state = store.load());
  if (app.params.get('glass') === '1') st.settings.glass = true;
  setSound(st.settings.sound);
  setMusic(st.settings.music);
  app.model = new PlayerModel(st.model);
  await nextFrame();

  const canvas = $('game');
  try {
    app.engine = new Engine(canvas, { quality: st.settings.quality });
  } catch (err) {
    console.error(err);
    S.showNoWebGL('The 3D engine could not start on this device.');
    return;
  }
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
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      play.pause();
      suspendAudio(true);
    } else if (app.mode !== 'paused') suspendAudio(false);
  });

  // First frame compiles every shader while the loading screen is still up.
  app.cam.update(0);
  app.engine.render();
  S.renderLoading({ progress: 1, text: 'Ready!' });
  await nextFrame();
  app.mode = 'menu';
  menus.showTitle();
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

boot().catch((err) => {
  console.error(err);
  S.showNoWebGL('Something went wrong while starting the game.');
});
