// In-match controller of the 3D edition. Starts a match for a mode (Adventure level, Daily Commission,
// Quick Race), runs the VS splash and the camera fly-in, steps the simulation on a fixed step, maps every
// sim event to 3D effects + HUD + sound + haptics (as the 2D game did), drives the first-time tutorial,
// the camera and the HUD every frame, and hands the finished match to the results flow in menus.js.
//
// Stages of a match: 'vs' (splash) -> 'intro' (camera fly-in; the order is posted during it) -> 'play'
// (the race, orders one after another) -> 'end' (victory orbit, then the results).
// Hearts: PLAY spends one (economy.startLevelHeart), a pass gives it back; a quit, a restart or a reload
// keeps it spent. A ranked Daily is used up the moment it starts (store.markDailyAttempt).

import * as THREE from 'three';
import { Match } from '../match.js';
import { PlayerModel } from '../model.js';
import { RIVALS, RES, COMPONENTS, SCORE, ITEM_BY_ID } from '../data.js';
import { idx } from '../world.js';
import { THEMES } from '../3d/themes.js';
import { tilePos } from '../3d/island.js';
import { worldToTile } from '../3d/coords.js';
import { levelById, matchConfig, levelPassed, WORLDS } from '../levels.js';
import * as eco from '../economy.js';
import * as store from '../storage.js';
import { sfx, buzz, setIntensity, suspendAudio, unlockAudio, startMusic } from '../audio.js';
import { app, clock, later, cancelLater, stopClock, commit, reloadSave, STEP, pick, pct, playerPortrait, rivalPortrait, equippedSkin } from './app.js';
import * as attract from './attract.js';
import * as menus from './menus.js';

const VS_MS = 2400; // VS splash
const INTRO_S = 3.0; // camera fly-in (s)
const STEP_DELAY = 350; // ms into the fly-in before the order is posted
const END_MS = 2900; // victory orbit before the results
const GUARD_MS = 400; // taps this soon after the VS splash opens are the tail of a double tap
const TUTOR_HOLD = 600; // s: in the tutorial the rival waits out the whole first order
const PLAYER_BLUE = '#3d7bff';
const ORDER_LINES = [(n) => `I need a ${n}!`, (n) => `One ${n}, please!`, (n) => `Who can make me a ${n}?`, (n) => `A ${n}! Quick!`];
// Quick Race islands wear the world where each rival rules; the Daily one rotates by date.
const QUICK_THEME = [0, 1, 2, 3, 4];

let P = null; // the match being played (see begin())
const _v = new THREE.Vector3();
const _s = { x: 0, y: 0, visible: false };
const _move = { x: 0, z: 0 };
const _c = new THREE.Vector3();
const _arrow = { x: 0, y: 0, color: '' };

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

export const active = () => !!P;
export const current = () => P;

function screenOf(v3) {
  return app.engine.worldToScreen(v3, _s);
}

// Keep a label (half its width = half) inside the screen and clear of the HUD columns at the top
// (avatars and stars on the left, the rival and the minimap on the right).
function labelX(x, y, half) {
  const W = window.innerWidth;
  let lo = half + 6;
  let hi = W - half - 6;
  if (y < (window.innerHeight < 560 ? 150 : 215)) {
    lo = Math.max(lo, 84 + half);
    hi = Math.min(hi, W - 84 - half);
  }
  return lo > hi ? W / 2 : Math.max(lo, Math.min(hi, x));
}

// Floating labels skip spots under the HUD panels (order card, meter, minimap, buttons...).
function label(key, x, y, text, style, color) {
  if (!app.hud.isOverPanel(x, y)) app.hud.label(key, x, y, text, style, color);
}

// ------------------------------------------------------------------ starting a match

// Adventure: PLAY spends a heart (given back if the level is passed) and the chosen boosters.
export function startLevel(id, boosterIds = []) {
  const level = levelById(id);
  if (!level || id > app.state.adventure.unlocked) return false;
  const now = Date.now();
  let used = [];
  const boosts = commit((st) => {
    if (!eco.startLevelHeart(st, id, now)) return null;
    used = [...new Set(boosterIds || [])].filter((b) => eco.BOOSTERS[b] && eco.boosterCount(st, b) > 0);
    return eco.useBoosters(st, used);
  });
  if (!boosts) {
    menus.noHearts(level);
    return false;
  }
  const cfg = matchConfig(level);
  begin({
    kind: 'level',
    level,
    seed: cfg.seed,
    rival: cfg.rival,
    rivalIndex: cfg.rivalIndex,
    twist: cfg.twist,
    options: { ...cfg.options, ...boosts, autoReturn: app.state.settings.autoReturn },
    theme: WORLDS[level.world].theme,
    boosters: used,
  });
  return true;
}

// Daily Commission: same island, orders and twist for everyone today; FOX with no memory of you.
// The first attempt of the day is the ranked one, and it counts from the moment it starts.
export function startDaily() {
  const d = store.todaysDaily();
  const ranked = !app.blind && commit((st) => store.markDailyAttempt(st, d));
  const daily = { ...d, ranked };
  begin({
    kind: 'daily',
    daily,
    seed: d.seed,
    rival: RIVALS[d.rivalIndex],
    rivalIndex: d.rivalIndex,
    twist: d.twist,
    options: { autoReturn: app.state.settings.autoReturn },
    theme: THEMES[((d.number % THEMES.length) + THEMES.length) % THEMES.length],
  });
  return true;
}

// Quick Race: the rival ladder; every rival reads the shared notebook.
export function startQuick(index) {
  const st = app.state;
  const i = Math.max(0, Math.min(index ?? st.ladder.unlocked, st.ladder.unlocked, RIVALS.length - 1));
  begin({
    kind: 'quick',
    seed: Math.floor(Math.random() * 1e9),
    rival: RIVALS[i],
    rivalIndex: i,
    twist: null,
    options: { autoReturn: st.settings.autoReturn },
    theme: THEMES[QUICK_THEME[i]],
  });
  return true;
}

function begin(cfg) {
  unlockAudio();
  startMusic();
  if (P) teardown();
  const st = app.state;
  let rivalDef = cfg.rival;
  if (app.blind) rivalDef = { ...rivalDef, experts: [], heading: 0, steal: 0, deny: 0 };
  // The Daily rival never uses your saved memory, so everyone's daily result is comparable.
  const model = cfg.kind === 'daily' ? new PlayerModel() : app.model;
  // A match quit before it saw anything gives the notebook back as it was (beginMatch fades it).
  const snap = model === app.model ? JSON.parse(JSON.stringify(model)) : null;
  const tutorial = cfg.kind === 'level' && cfg.level.id === 1 && !st.tutorial3d;
  const options = tutorial ? { ...cfg.options, rivalDelay: TUTOR_HOLD } : cfg.options;
  const match = new Match({ seed: cfg.seed, rival: rivalDef, model, twist: cfg.twist, options });
  P = {
    ...cfg,
    rivalDef,
    model,
    snap,
    match,
    stage: 'vs',
    stepping: false,
    acc: 0,
    tutorial,
    tut: 'move', // tutorial step for the first order: 'move' -> 'tap' -> 'gather'
    tips: {},
    shownStars: { player: 0, rival: 0 },
    made: [],
    bagPending: [],
    popT: 0,
    popX: 0,
    popK: 0,
    idleSince: clock(),
    bubble: null,
    vbubble: null,
    warned: {},
    won: false,
    goalLost: false,
    vsAt: clock(),
    endAt: 0,
  };
  attract.stop();
  app.mode = 'play';
  app.engine.allowQualityChange = false;
  menus.hideForMatch();
  app.stage.load(match, cfg.theme, equippedSkin(), rivalDef);

  const hud = app.hud;
  const skin = equippedSkin();
  const player = { portrait: playerPortrait(128), color: skin.colors.body };
  const rival = { name: rivalDef.name, color: rivalDef.color, portrait: rivalPortrait(rivalDef, 128), title: rivalDef.title };
  hud.setup({ rival, player, starsToWin: match.starsToWin, thresholds: cfg.level ? cfg.level.thresholds : null, timeLimit: match.timeLimit, bagSize: match.bagSizeFor('player') });
  const th = cfg.theme;
  hud.setMinimapWorld(match.world, { sea: th.sea.kind === 'clouds' ? '#bcd0f5' : th.sea.color, land: th.ground.top[0], beach: th.ground.beach, block: th.props.bush });
  hud.setChrome(false);
  hud.show(true);
  app.input.setEnabled(true);

  // Behind the splash the camera circles the island; the fly-in blends out of that orbit.
  app.cam.menuOrbit({ x: 0, y: 0, z: 1 }, { snap: true, speed: 0.1, pitch: 0.7 });
  const mem = model.memorySize;
  let title;
  let goal;
  let sub;
  if (cfg.kind === 'level') {
    const l = cfg.level;
    title = `${l.boss ? 'BOSS · ' : ''}LEVEL ${l.id} · ${l.name.toUpperCase()}`;
    goal = l.goal.text;
    if (tutorial) sub = `First time? ${rivalDef.name} waits while you learn the controls.`;
    else sub = l.twist ? `Twist · ${l.twist.name}: ${l.twist.desc}` : mem > 0 ? `${mem} of your moves in its notebook` : 'It has never seen you play. Yet.';
  } else if (cfg.kind === 'daily') {
    title = `DAILY COMMISSION #${cfg.daily.number}`;
    goal = `${cfg.twist.name}: ${cfg.twist.desc}`;
    sub = cfg.daily.ranked ? 'It has never seen you play. Only your first attempt counts.' : 'Practice run: only your first attempt counts.';
  } else {
    title = 'QUICK RACE';
    goal = `First to ${match.starsToWin} orders wins.`;
    sub = mem > 0 ? `${mem} of your moves in its notebook` : 'It has never seen you play. Yet.';
  }
  if (app.blind) sub = 'PRACTICE · blind rival (?blind=1): no rewards';
  hud.vs({ player, rival, title, goal, sub, dur: 1e9 });
  later(VS_MS, endVs, 'match');
  setIntensity(1);
  sfx.whoosh();
}

// VS splash over (timed out or tapped): the camera flies in, the order is posted shortly after.
export function endVs() {
  if (!P || P.stage !== 'vs') return;
  P.stage = 'intro';
  if (app.hud.vsActive) app.hud.hideVs(false);
  const f = app.stage.feet('player', _v);
  app.cam.follow(f.x, f.z, Math.PI, 0);
  app.cam.intro({ x: 0, y: 0, z: 0 }, introDone, { duration: INTRO_S });
  later(STEP_DELAY, () => P && (P.stepping = true), 'match');
}

function introDone() {
  if (!P) return;
  P.stepping = true;
  if (P.stage === 'intro') {
    P.stage = 'play';
    app.hud.setChrome(true);
  }
}

// ------------------------------------------------------------------ per frame
// Nothing moves while paused (the game clock stands still too).
export function update(dt, now) {
  if (!P || app.mode === 'paused') return;
  const m = P.match;
  const input = app.input;
  const cam = app.cam;
  if (app.mode === 'play') {
    // The stick moves the player only once the race is on (camera-relative, magnitude included).
    if (P.stage === 'play') {
      const s = app.stick || input.stick;
      const d = cam.moveFromStick(s.x, s.y, _move);
      m.setMove(d.x, d.z);
    } else m.setMove(0, 0);
    const l = input.consumeLook();
    cam.orbit(l.dx, l.dy);
    cam.zoom(input.consumeZoom());
    if (P.stepping && P.stage !== 'end') {
      P.acc = Math.min(P.acc + dt, STEP * 8);
      while (P.acc >= STEP && P) {
        m.step(STEP);
        P.acc -= STEP;
        handleEvents();
        if (!P || P.stage === 'end') break;
      }
    }
  }
  if (!P) return;
  const glass = !!app.state.settings.glass && P.stage !== 'end';
  const anchors = app.stage.update(app.mode === 'paused' ? 0 : dt, now, { glass });
  if (cam.mode === 'follow' || cam.mode === 'intro') {
    const f = app.stage.feet('player', _v);
    const sp = Math.hypot(m.player.vx, m.player.vy);
    cam.viewHeight = app.engine.height;
    cam.follow(f.x, f.z, app.stage.heading('player'), Math.min(1, sp / m.player.speed));
    // During the race: lean toward what the player goes for next, look over the hut, and see through
    // node tops or the order card standing in front of the player.
    const race = P.stage === 'play' && cam.mode === 'follow';
    const focus = race ? app.island.focusFor(m, _focus) : null;
    cam.setFocus(focus ? focus.x : null, focus ? focus.z : null);
    cam.lift = race ? hutInTheWay(dt, f.x, f.z) : 0;
    app.island.setViewer(race ? app.engine.camera.position : null, f.x, f.z);
  } else app.island.setViewer(null);
  if (Math.hypot(m.player.vx, m.player.vy) > 0.05) P.idleSince = clock();
  hudFrame(anchors);
}

// Extra camera pitch to see the player (feet included) over the Workshop hut: the smallest lift that
// clears the roof, from any side. It engages after 0.2 s in the hut's shadow and lets go after 0.6 s in
// the clear, so walking along the edge does not make the view bob; the camera eases and rate-limits it.
const _focus = { x: 0, z: 0 };
const _hutLift = { match: null, on: false, blocked: 0, clear: 0, lift: 0 };
function hutInTheWay(dt, x, z) {
  const h = _hutLift;
  if (h.match !== P.match) Object.assign(h, { match: P.match, on: false, blocked: 0, clear: 0, lift: 0 });
  const want = app.island.hutLift(app.cam, x, z);
  if (want > 0) {
    h.clear = 0;
    h.blocked += dt;
    if (h.on || h.blocked >= 0.2) {
      h.on = true;
      h.lift = want;
    }
  } else {
    h.blocked = 0;
    h.clear += dt;
    if (h.on && h.clear >= 0.6) h.on = false;
  }
  return h.on ? h.lift : 0;
}

function hudFrame(anchors) {
  const m = P.match;
  const hud = app.hud;
  const p = m.player;
  const race = m.phase === 'race' && P.stage === 'play';
  if (m.order && (P.stepping || m.orderIndex > 0)) hud.setOrder({ item: m.order.id, index: m.orderIndex, total: m.maxOrders, made: P.made });
  hud.setStars(P.shownStars.player, P.shownStars.rival);
  hud.setScore(m.score, P.won);
  hud.setTimer(m.timeLeft);

  // Bag: items still flying in from the node are shown when they land.
  const t = clock();
  while (P.bagPending.length && P.bagPending[0] <= t) P.bagPending.shift();
  const shown = Math.max(0, p.bag.length - P.bagPending.length);
  hud.setBag(shown === p.bag.length ? p.bag : p.bag.slice(0, shown), m.bagSizeFor('player'));

  hud.setHint(race ? hintText(m) : '');
  const ci = race ? m.canInteract() : null;
  let res;
  if (ci === 'gather') {
    const n = m.nodeInReach(p, null, true);
    res = n ? n.type : undefined;
  }
  hud.setInteract(ci, res);
  const need = m.needRemaining('player');
  const ready = p.bag.length >= m.bagSizeFor('player') || (p.bag.length > 0 && !sum(need));
  hud.setHome(!race ? 'off' : ready ? 'glow' : 'normal');
  const rd = m.rival.dest;
  hud.updateMinimap({
    nodes: m.world.nodes,
    time: m.time,
    player: { x: p.fx, y: p.fy, heading: app.stage.heading('player') },
    rival: { x: m.rival.fx, y: m.rival.fy },
    rivalTarget: race && rd && rd.kind === 'node' ? rd.id : null,
    playerTarget: race ? m.playerTarget() : null,
    need: app.stage.need,
  });

  // Floating labels projected from 3D.
  hud.beginLabels();
  const c = app.stage.contest;
  if (race && c) {
    const s = screenOf(app.island.nodePos(c.node, _v));
    if (s.visible) label('contest', labelX(s.x, s.y, 58), s.y - 8, c.rivalFirst ? `${P.rivalDef.name} FIRST` : 'YOU FIRST', 'pill', c.rivalFirst ? '#ff4d5e' : '#3ec22b');
  }
  // Speech bubbles stay clear of the bag and buttons at the bottom.
  const now = clock();
  const low = window.innerHeight - (window.innerHeight < 560 ? 90 : 170);
  if (P.bubble && now < P.bubble.until) {
    const s = screenOf(app.stage.rival.anchor(_v));
    if (s.visible) label('say-rival', labelX(s.x, s.y, 92), Math.min(s.y, low), P.bubble.text, 'bubble', P.rivalDef.color);
  }
  if (P.vbubble && now < P.vbubble.until) {
    const s = screenOf(app.stage.villager.anchor(_v));
    if (s.visible) label('say-villager', labelX(s.x, s.y, 92), Math.min(s.y, low), P.vbubble.text, 'bubble', '#ff8c42');
  }
  // Bag ready: mark the Workshop.
  if (race && ready && !P.tutorial) {
    app.island.displayPos(_v).y += 0.9; // just above the floating order card
    const s = screenOf(_v);
    if (s.visible) label('workshop', labelX(s.x, s.y, 62), s.y, 'DROP IT HERE', 'pill', '#2f86ff');
  }
  if (anchors && anchors.length) {
    for (const a of anchors) {
      const s = screenOf(a.pos);
      if (s.visible && !hud.isOverPanel(s.x, s.y)) hud.glassLabel(`g${a.id}`, s.x, s.y, a.p);
    }
  }
  hud.endLabels();

  // Time running out.
  const left = m.timeLeft;
  if (race && left != null) {
    if (left <= 30 && !P.warned[30] && m.timeLimit > 40) {
      P.warned[30] = true;
      hud.toast('30 seconds left!', { kind: 'info', dur: 2200 });
      hud.pulse('timer');
    }
    if (left <= 10 && !P.warned[10]) {
      P.warned[10] = true;
      hud.toast('10 seconds! Hurry!', { kind: 'bad', dur: 2200, priority: 'high' });
      sfx.error();
      buzz([30, 40, 30]);
    }
    const sec = Math.ceil(left);
    if (sec <= 5 && sec > 0 && !P.warned[`s${sec}`]) {
      P.warned[`s${sec}`] = true;
      sfx.tap();
      hud.pulse('timer');
    }
  }
  // The tutorial's pointer, or else an arrow at the screen edge toward where to go next.
  const pointing = P.tutorial ? tutorialFrame(m, need, ready) : false;
  if (!P.tutorial) hud.pointer(null);
  hud.edgeArrow(race && !pointing ? offScreenGoal(m, need, ready) : null);
}

// The nearest node (by walking distance) of a resource the order still needs, ready now.
function nearestNeeded(m, need) {
  const field = m.world.nodeField;
  const here = idx(m.player.x, m.player.y);
  let best = null;
  let bd = Infinity;
  for (const n of m.world.nodes) {
    if (!need[n.type] || !m.nodeReady(n)) continue;
    const d = field[n.id][here];
    if (d >= 0 && d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

// Where the player should head next (the Workshop once the bag is ready, else the node it is going for
// or the nearest needed one), as an edge arrow target when that spot is off screen; else null.
function offScreenGoal(m, need, ready) {
  let color = '#ffc629';
  if (ready) {
    app.island.workshopPos('player', _v);
    color = PLAYER_BLUE;
  } else {
    const id = m.playerTarget() ?? nearestNeeded(m, need)?.id;
    if (id == null) return null;
    app.island.nodePos(id, _v);
  }
  const s = screenOf(_v);
  const W = app.engine.width;
  const H = app.engine.height;
  const cam = app.engine.camera;
  _c.copy(_v).applyMatrix4(cam.matrixWorldInverse);
  if (_c.z < 0) {
    if (s.visible && s.x > 24 && s.x < W - 24 && s.y > 24 && s.y < H - 24) return null;
  } else {
    // Behind the camera the projection flips: aim along the direction in view space instead.
    const k = 1e4 / Math.max(1e-3, Math.hypot(_c.x, _c.y));
    s.x = W / 2 + _c.x * k;
    s.y = H / 2 + (Math.abs(_c.x) + Math.abs(_c.y) > 1e-3 ? -_c.y * k : 1e4);
  }
  _arrow.x = s.x;
  _arrow.y = s.y;
  _arrow.color = color;
  return _arrow;
}

function hintText(m) {
  const p = m.player;
  if (p.bag.length >= m.bagSizeFor('player')) return 'Bag full: head to the Workshop';
  const need = m.needRemaining('player');
  const parts = Object.entries(need).map(([r, n]) => `${RES[r].name}${n > 1 ? ` ×${n}` : ''}`);
  if (!parts.length) return p.bag.length ? 'All gathered: take it to the Workshop!' : '';
  return `Still need: ${parts.join(', ')}`;
}

const touchUI = () => app.input.lastDevice === 'touch';
const homeWord = () => (touchUI() ? 'tap HOME' : 'press Space');

// Tutorial instructions and the rival's honest reasons outrank every other toast.
function tip(text, dur = 4600) {
  app.hud.toast(text, { kind: 'info', dur, priority: 'high' });
}

// ------------------------------------------------------------------ events -> feedback
function handleEvents() {
  const evs = P.match.drainEvents();
  for (const e of evs) {
    if (!P) return;
    onEvent(e);
  }
}

function quip(kind, ms = 1700) {
  const q = P.rivalDef.quips && P.rivalDef.quips[kind];
  if (q) P.bubble = { text: pick(q), until: clock() + ms };
}

// Score floaters: stacked when several land at once.
function popAt(text, x, y, style, dur) {
  if (app.hud.isOverPanel(x, y)) return;
  const now = clock();
  if (now - P.popT < 380 && Math.abs(x - P.popX) < 80) P.popK++;
  else P.popK = 0;
  P.popT = now;
  P.popX = x;
  app.hud.pop(text, labelX(x, y, text.length * 6 + 12), y - P.popK * 26, style, dur);
}

function popWorld(text, pos, style, dur, dy = 0) {
  const s = screenOf(pos);
  if (s.visible) popAt(text, s.x, s.y + dy, style, dur);
}

function playerHead() {
  return app.stage.player.anchor(new THREE.Vector3());
}

function onEvent(e) {
  const m = P.match;
  const hud = app.hud;
  const isl = app.island;
  const fx = app.fx;
  const R = P.rivalDef;
  switch (e.type) {
    case 'order': {
      sfx.order();
      isl.setOrderItem(e.item.id, '#ffc83d');
      P.made = e.item.parts.map(() => false);
      app.stage.emote('villager', 'wave', 1800);
      P.vbubble = { text: pick(ORDER_LINES)(e.item.name), until: clock() + 2100 };
      if (e.index === 0 && R.intro) later(500, () => P && (P.bubble = { text: R.intro, until: clock() + 2600 }), 'match');
      break;
    }
    case 'go': {
      sfx.go();
      hud.caption('GO!', { color: '#ffffff', size: 1.5, dur: 800 });
      if (e.index > 0 && Math.random() < 0.5) quip(m.stars.rival > m.stars.player ? 'winOrder' : 'loseOrder', 1400);
      if (e.index === 0 && P.kind === 'daily') hud.toast(`Daily #${P.daily.number}: ${P.twist.name}. ${P.twist.desc}`, { kind: 'info', dur: 3600 });
      if (e.index === 0 && P.boosters && P.boosters.length && !P.tutorial) hud.toast(`Boosters on: ${P.boosters.map((id) => eco.BOOSTERS[id].name).join(' + ')}`, { kind: 'good', dur: 2600, priority: 'low' });
      if (P.tutorial && e.index === 0) {
        // The rival sat out this order (it started thinking just now); from the next one it races.
        m.options.rivalDelay = P.options.rivalDelay || 0;
        later(900, () => P && P.tut === 'move' && tip(touchUI() ? 'Drag the joystick with your left thumb: walk into a resource with a gold ring.' : 'Walk with WASD or the arrow keys into a resource with a gold ring.', 5200), 'match');
        later(9000, () => P && P.tut === 'move' && tip(`Follow the hand: walking into a resource gathers it. Your bag holds ${P.match.bagSizeFor('player')}.`), 'match');
      }
      if (P.tutorial && e.index === 1) tip(`Now ${R.name} races you! Its dotted line shows where it is heading next.`);
      break;
    }
    case 'gather': {
      const pos = isl.nodePos(e.node.id, new THREE.Vector3());
      fx.burst(pos, RES[e.res].light, e.who === 'player' ? 16 : 10, 4, 0.7);
      if (e.who === 'player') {
        sfx.gather(e.res);
        buzz(12);
        P.idleSince = clock();
        const s = screenOf(pos);
        if (s.visible) hud.fly('res', e.res, s.x, s.y, 'bag', 520);
        P.bagPending.push(clock() + 500);
        if (P.tutorial && P.tut === 'move') {
          P.tut = 'tap';
          tip(touchUI() ? 'Nice! You can also TAP a gold-ringed resource to run there. Try it!' : 'Nice! You can also CLICK a gold-ringed resource to run there. Try it!');
        } else if (P.tutorial && P.tut === 'tap') P.tut = 'gather';
      } else sfx.rivalGather();
      break;
    }
    case 'deposit': {
      const bench = isl.workshopPos(e.who, new THREE.Vector3());
      if (e.who === 'player') {
        sfx.deposit();
        P.idleSince = clock();
        P.bagPending.length = 0;
        fx.ring(bench, PLAYER_BLUE, 0.7);
        const s = screenOf(playerHead());
        const x = s.x;
        const y = s.y;
        if (s.visible) e.items.forEach((r, i) => later(i * 80, () => P && hud.fly('res', r, x, y, 'order', 480), 'match'));
      } else fx.ring(bench, R.color, 0.6);
      break;
    }
    case 'craft': {
      const bench = isl.workshopPos(e.who, new THREE.Vector3());
      if (e.who === 'player') {
        const i = e.index;
        later(430, () => {
          if (!P) return;
          sfx.craft();
          P.made[i] = true;
          fx.burst(bench, '#7dff9a', 18, 3.5, 0.6);
          popWorld(`+${COMPONENTS[e.part].name}`, bench, 'good', 1200, -24);
        }, 'match');
        if (P.tutorial && !P.tips.craft) {
          P.tips.craft = true;
          later(700, () => P && tip('Your bench crafts each part once its materials arrive. Keep gathering what the card needs!', 4200), 'match');
          later(6000, () => P && P.stage === 'play' && tip(touchUI() ? 'Drag on the right side of the screen to look around.' : 'Drag with the mouse to look around.', 3600), 'match');
        }
      } else fx.burst(bench, R.color, 12, 3, 0.5);
      break;
    }
    case 'complete': {
      const disp = isl.displayPos(new THREE.Vector3());
      const who = e.who;
      const other = who === 'player' ? 'rival' : 'player';
      app.stage.emote(who, 'hop', 2200);
      app.stage.emote(other, 'sad', 2200);
      quip(who === 'player' ? 'loseOrder' : 'winOrder', 2000);
      const item = e.item;
      const stars = e.stars[who];
      if (who === 'player') {
        buzz([20, 40, 60]);
        later(500, () => {
          if (!P) return;
          sfx.complete();
          hud.caption('CRAFTED!', { sub: `${item.name} · +1 star`, color: '#ffc629', size: 1.15, dur: 1600 });
          fx.confetti(disp);
          fx.burst(disp, '#ffc83d', 30, 5, 0.9);
        }, 'match');
        later(950, () => {
          if (!P) return;
          const s = screenOf(disp);
          hud.fly('item', item.id, s.visible ? s.x : innerWidth / 2, s.visible ? s.y : innerHeight * 0.4, 'star-player', 650);
          isl.setOrderItem(null);
        }, 'match');
        later(1600, () => {
          if (!P) return;
          P.shownStars.player = stars;
          hud.pulse('stars-player');
          sfx.star(stars - 1);
        }, 'match');
      } else {
        sfx.rivalComplete();
        app.cam.shake(0.45);
        buzz([60]);
        hud.caption('TOO LATE!', { sub: `${R.name} made the ${item.name}`, color: R.color, size: 0.95, dur: 1600 });
        goalCheck(e);
        fx.burst(disp, R.color, 24, 4.5, 0.8);
        later(700, () => {
          if (!P) return;
          const s = screenOf(disp);
          hud.fly('item', item.id, s.visible ? s.x : innerWidth / 2, s.visible ? s.y : innerHeight * 0.4, 'star-rival', 600);
          isl.setOrderItem(null);
        }, 'match');
        later(1300, () => {
          if (!P) return;
          P.shownStars.rival = stars;
          hud.pulse('stars-rival');
        }, 'match');
      }
      break;
    }
    case 'snatch': {
      const pos = isl.nodePos(e.node.id, new THREE.Vector3());
      sfx.snatch();
      buzz([40, 50, 40]);
      quip('snatch');
      app.cam.shake(0.35);
      popWorld('SNATCHED!', pos, 'bad', 1400, -10);
      fx.burst(pos, '#ff4d6d', 16, 4, 0.6);
      hud.toast(e.text.kind === 'luck' ? `${e.text.text} Pick another one!` : e.text.text, { kind: 'bad', dur: 4400, priority: 'high' });
      if (!P.tutorial && !P.tips.glass && !(app.state.tips && app.state.tips.glass) && P.rivalIndex > 0) {
        P.tips.glass = true;
        later(4800, () => {
          // Only mid-race: pausing (where the switch is) is not possible once the match is over.
          if (!P || P.stage !== 'play' || P.match.phase === 'end') return;
          commit((st) => ((st.tips = st.tips || {}).glass = true));
          hud.toast("Curious how it reads you? Pause and switch on 'Show the rival's thoughts'.", { kind: 'info', dur: 4500, priority: 'low' });
        }, 'match');
      }
      if (P.tutorial && !P.tips.snatch && !P.tips.line) {
        P.tips.snatch = true;
        later(4700, () => P && tip('Watch its dotted line. When it turns red, it is going for YOUR target. Change course!', 4200), 'match');
      }
      break;
    }
    case 'outread': {
      const pos = isl.nodePos(e.node.id, new THREE.Vector3());
      sfx.outread();
      buzz(20);
      quip('beaten', 1400);
      popWorld(P.level ? `BEAT IT! +${SCORE.outread}` : 'BEAT IT!', pos, 'gold', 1400, -10);
      fx.burst(pos, '#ffc83d', 18, 4, 0.6);
      hud.toast(`You beat ${R.name} to it. It was heading there too.`, { kind: 'good', dur: 2600, priority: 'low' });
      break;
    }
    case 'fooled': {
      const pos = isl.nodePos(e.node.id, new THREE.Vector3());
      sfx.outread();
      buzz([15, 30, 15]);
      quip('fooled', 1600);
      popWorld(P.level ? `FAKED OUT! +${SCORE.fooled}` : 'FAKED OUT!', pos, 'good', 1500, -10);
      fx.burst(pos, '#3ec22b', 16, 4, 0.6);
      hud.toast(`${R.name} bet ${pct(e.p)} you'd take that ${RES[e.node.type].name}. You went elsewhere.`, { kind: 'good', dur: 3000 });
      break;
    }
    case 'bagFull': {
      // The tutorial's first trip home has its own, longer instruction.
      if (!(P.tutorial && m.stats.trips === 0)) hud.toast(e.full ? `Bag full! Head to the Workshop, or ${homeWord()}.` : `Everything gathered! Take it to the Workshop, or ${homeWord()}.`, { dur: 2600 });
      hud.pulse('home');
      break;
    }
    case 'score':
      onScore(e);
      break;
    case 'matchEnd':
      onMatchEnd(e);
      break;
  }
}

// Adventure score floaters (the meter only exists in Adventure). BEAT IT / FAKED OUT carry their own points.
function onScore(e) {
  if (!P.level) return;
  const text = `+${e.add}`;
  const isl = app.island;
  switch (e.reason) {
    case 'outread':
    case 'fooled':
      break;
    case 'gather':
      popWorld(text, playerHead(), 'score', 1100, -30);
      break;
    case 'craft':
      later(430, () => P && popWorld(text, isl.workshopPos('player', new THREE.Vector3()), 'score', 1100, -54), 'match');
      break;
    case 'order':
    case 'speed':
      later(700, () => P && popWorld(e.reason === 'speed' ? `${text} speed` : text, isl.displayPos(new THREE.Vector3()), 'gold', 1400, 20), 'match');
      break;
    default:
      later(900, () => P && popAt(`${text} ${e.reason === 'flawless' ? 'flawless' : 'win'}`, innerWidth / 2, innerHeight * 0.42, 'gold', 1600), 'match');
  }
}

// The end cinematic. In Adventure the level decides the mood: a won match can still miss the goal.
function onMatchEnd(e) {
  const m = P.match;
  const R = P.rivalDef;
  P.stage = 'end';
  P.endAt = clock();
  const summary = m.summary();
  const win = e.winner === 'player';
  P.won = P.level ? levelPassed(P.level, summary) : win;
  const missed = win && !P.won ? missedGoal(P.level, summary) : null;
  app.input.setEnabled(false);
  m.setMove(0, 0);
  app.hud.setChrome(false);
  app.hud.edgeArrow(null);
  // The winner turns to face the island (the hut behind them), and the camera swings round in front.
  app.stage.face(e.winner, app.stage.awayFromHut(e.winner));
  const f = app.stage.feet(e.winner, new THREE.Vector3());
  later(400, () => {
    if (!P) return;
    app.cam.follow(f.x, f.z, app.stage.heading(e.winner), 0);
    app.cam.victory(f.x, f.z);
  }, 'match');
  app.stage.emote('player', P.won ? 'cheer' : 'sad', 9000);
  app.stage.emote('rival', P.won ? 'sad' : 'cheer', 9000);
  quip(P.won ? 'loseOrder' : 'winOrder', 2400);
  app.hud.pointer(null);
  setIntensity(0);
  const s = m.stars;
  if (P.won) {
    sfx.win();
    app.hud.caption(e.timeUp ? 'TIME UP!' : 'YOU WIN!', { sub: e.timeUp ? `You win! You out-crafted ${R.name}` : `You out-crafted ${R.name}`, color: '#ffc629', size: 1.1, dur: 2400 });
    const top = app.island.displayPos(new THREE.Vector3());
    for (let i = 0; i < 3; i++) later(250 + i * 380, () => P && app.fx.confetti(new THREE.Vector3(f.x + (i - 1) * 1.2, 2.5, f.z)), 'match');
    later(150, () => P && app.fx.confetti(top), 'match');
  } else if (missed) {
    sfx.lose();
    app.hud.caption(e.timeUp ? 'TIME UP!' : 'GOAL MISSED', { sub: missed, color: '#ff5a6e', size: 1, dur: 2600 });
  } else {
    sfx.lose();
    const sub = !e.timeUp ? 'It read you this time' : s.player === s.rival ? `Tied ${s.player}–${s.rival}: ties go to ${R.name}` : `${R.name} was ahead when time ran out`;
    app.hud.caption(e.timeUp ? 'TIME UP!' : `${R.name} WINS`, { sub, color: R.color, size: 1, dur: 2400 });
  }
  later(END_MS, finish, 'match');
}

// Why a won match still fails the level, short enough for the end caption.
function missedGoal(level, summary) {
  const g = level.goal;
  const n = summary.stars.rival;
  if (g.type === 'win-time') return 'Goal missed: win before time runs out';
  if (g.type === 'flawless') return `${P.rivalDef.name} took ${n} order${n === 1 ? '' : 's'}: not flawless`;
  if (g.type === 'craft') return `You had to craft the ${ITEM_BY_ID[g.item].name} yourself`;
  return 'Goal missed';
}

// The rival just won an order: say so at once if that makes the level's goal impossible while the
// match goes on (a flawless goal, or the item the goal asks you to craft).
function goalCheck(e) {
  const l = P.level;
  if (!l || P.goalLost || e.stars.rival >= P.match.starsToWin) return;
  const g = l.goal;
  const R = P.rivalDef;
  let text = null;
  if (g.type === 'flawless') text = `Goal failed: ${R.name} won an order, and this level needs a flawless win.`;
  else if (g.type === 'craft' && e.item.id === g.item) text = `Goal failed: ${R.name} made the ${e.item.name}, and you had to craft it yourself.`;
  if (!text) return;
  P.goalLost = true;
  later(1700, () => P && P.stage === 'play' && app.hud.toast(`${text} Pause > Restart to try again.`, { kind: 'bad', dur: 5000, priority: 'high' }), 'match');
}

// ------------------------------------------------------------------ first-time tutorial (level 1)
// One step at a time while the rival sits out the first order: walk into a resource, tap one, take the
// bag home with HOME; from the second order the rival races and its route line is explained.
// Returns true while the tutorial's pointer is showing.
function tutorialFrame(m, need, ready) {
  const hud = app.hud;
  if (P.stage !== 'play' || m.phase !== 'race') {
    hud.pointer(null);
    return false;
  }
  const p = m.player;
  if (m.stats.trips === 0 && ready && p.state !== 'deposit' && !(p.dest && p.dest.kind === 'hub')) {
    if (!P.tips.home) {
      P.tips.home = true;
      tip(touchUI() ? 'Bag ready! Tap HOME to run to the Workshop (or walk into it).' : 'Bag ready! Press Space (HOME) to run to the Workshop, or walk into it.');
    }
    hud.pointer('home', 'HOME');
    return true;
  }
  const stuck = m.orderIndex === 0 && clock() - P.idleSince > 4000 && p.state === 'idle';
  if (((m.orderIndex === 0 && P.tut !== 'gather') || stuck) && sum(need) && p.state !== 'gather') {
    const n = nearestNeeded(m, need);
    if (n) {
      tilePos(n.x, n.y, _v).y = 1.1; // point at the resource itself, not the top of a tall tree
      const s = screenOf(_v);
      hud.pointer({ x: s.x, y: s.y, label: P.tut === 'tap' ? (touchUI() ? 'TAP' : 'CLICK') : 'GO HERE', visible: s.visible });
      return true;
    }
  }
  // A red line: the rival will beat you to your target.
  const c = app.stage.contest;
  if (c && c.rivalFirst && !P.tips.line) {
    P.tips.line = true;
    app.hud.toast(`Red line! ${P.rivalDef.name} will get there first. Pick a different one!`, { kind: 'bad', dur: 4200, priority: 'high' });
  }
  hud.pointer(null);
  return false;
}

// ------------------------------------------------------------------ controls
export function tap(x, y) {
  if (!P || app.mode !== 'play') return;
  if (P.stage === 'vs') {
    if (clock() - P.vsAt >= GUARD_MS) endVs();
    return;
  }
  if (P.stage === 'intro') {
    app.cam.skipIntro();
    return;
  }
  const m = P.match;
  if (P.stage !== 'play' || m.phase !== 'race') return;
  if (app.hud.isOverPanel(x, y)) return; // a tap on a HUD panel never walks to what is behind it
  const dest = tapTarget(m, x, y);
  if (!dest) return;
  sfx.tap();
  if (P.tutorial && P.tut === 'tap' && dest.kind === 'node') P.tut = 'gather';
  const pos = new THREE.Vector3();
  if (dest.kind === 'node') {
    const n = m.world.nodes[dest.id];
    tilePos(n.x, n.y, pos);
  } else if (dest.kind === 'hub') tilePos(4, m.world.hubY, pos);
  else tilePos(dest.x, dest.y, pos);
  pos.y = 0.05;
  app.fx.ring(pos, '#ffffff', 0.55);
}

// What the finger visibly touches: a node top, or the tile under the first visible surface (a node's
// or a Workshop tile means that node / the Workshop; the floating order card means the Workshop too).
// The fitted invisible proxies only catch near misses in front of that surface (e.g. the edge of a node
// seen against the sea or a bush).
function tapTarget(m, x, y) {
  const isl = app.island;
  const eng = app.engine;
  const vis = eng.raycast(x, y, isl.pickVisible, false)[0];
  if (isl.display && isl.display.visible && isl.cardFade > 0.5) {
    const c = eng.raycast(x, y, [isl.card], false)[0];
    if (c && (!vis || c.distance < vis.distance)) return m.command(4, m.world.hubY);
  }
  if (vis) {
    const id = isl.nodeOfHit(vis);
    if (id >= 0) return m.command(m.world.nodes[id].x, m.world.nodes[id].y);
    const t = worldToTile(vis.point.x, vis.point.z);
    const dest = m.command(Math.round(t.x), Math.round(t.y));
    if (dest) return dest;
  }
  const hits = eng.raycast(x, y, isl.pickTargets, false);
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const u = h.object.userData;
    if (vis && h.distance > vis.distance + 0.3) break;
    if (u.kind === 'node') return m.command(m.world.nodes[u.id].x, m.world.nodes[u.id].y);
    if (u.kind === 'hub') return m.command(4, m.world.hubY);
    if (!vis) {
      const t = worldToTile(h.point.x, h.point.z);
      return m.command(Math.round(t.x), Math.round(t.y));
    }
  }
  return null;
}

export function interact() {
  if (!P || app.mode !== 'play' || P.stage !== 'play') return;
  const r = P.match.interact();
  if (r) sfx.tap();
  else if (P.match.phase === 'race' && P.match.canInteract() === null && !P.tips.interact) {
    P.tips.interact = true;
    app.hud.toast('Walk up to a resource (or the Workshop) first. Needed ones gather by themselves.', { dur: 2800, priority: 'low' });
  }
}

export function home() {
  if (!P || app.mode !== 'play' || P.stage !== 'play') return;
  const m = P.match;
  const d = m.command(4, m.world.hubY);
  if (!d) return;
  sfx.tap();
  app.hud.pulse('home');
  const pos = tilePos(4, m.world.hubY, new THREE.Vector3());
  pos.y = 0.05;
  app.fx.ring(pos, PLAYER_BLUE, 0.6);
}

// ------------------------------------------------------------------ pause / resume / quit / restart
// Pausing stops the game clock: the sim, the scheduled feedback, emotes and bubbles all wait. The end
// cinematic cannot be paused, unless the results never came (then Quit must stay reachable).
export function pause() {
  if (!P || app.mode !== 'play' || P.stage === 'vs') return false;
  if (P.stage === 'end' && clock() - P.endAt < END_MS + 2000) return false;
  app.mode = 'paused';
  stopClock('pause');
  app.redraw = true;
  app.input.setEnabled(false);
  P.match.setMove(0, 0);
  suspendAudio(true);
  menus.showPause(P);
  return true;
}

export function resume() {
  if (!P || app.mode !== 'paused') return;
  app.mode = 'play';
  stopClock('pause', false);
  if (P.stage !== 'end') app.input.setEnabled(true);
  suspendAudio(false);
  menus.closePause();
}

// A match already decided (someone reached the winning stars) is finished and recorded, not abandoned.
function decided() {
  const m = P.match;
  return m.phase === 'end' || Math.max(m.stars.player, m.stars.rival) >= m.starsToWin;
}

// Quit or restart once the winner is known: the match is played out and recorded instead.
function finishDecided() {
  menus.closePause();
  const m = P.match;
  let guard = 0;
  while (m.phase !== 'end' && guard++ < 4000) m.step(STEP);
  m.drainEvents();
  app.mode = 'play';
  finish();
}

// What leaving a match early costs, asked before a quit or a restart (null: nothing to confirm).
function leaveCost(what) {
  if (P.kind === 'level') return `The heart this try used is not given back${what === 'restart' ? ', and the new try uses another one. Boosters used this time are gone' : ''}.`;
  if (P.kind === 'daily' && P.daily.ranked) return `This is your ranked attempt: it is recorded as a loss${what === 'restart' ? ' and the new run is practice' : ''}.`;
  return null;
}

// Abandon (quit / restart): nothing is recorded. The level's heart stays spent, a ranked Daily keeps its
// loss. The notebook keeps what it saw; if it saw nothing, it goes back to how it was before the match.
function abandon() {
  const m = P.match;
  const shared = P.model === app.model;
  if (shared) {
    if (m.stats.gathers || m.stats.snatched) {
      if (m.phase !== 'end') app.model.endMatch();
    } else app.model = new PlayerModel(P.snap);
  }
  const model = shared ? app.model.toJSON() : null;
  const level = P.kind === 'level';
  commit((st) => {
    if (model) st.model = model;
    if (level) eco.abandonLevel(st);
  });
}

export async function quit() {
  if (!P) return;
  if (decided()) return finishDecided();
  const cfg = P;
  const cost = leaveCost('quit');
  if (cost) {
    const ok = await menus.confirm({ title: cfg.kind === 'level' ? 'Quit this level?' : 'Quit the Daily?', text: cost, ok: 'QUIT', danger: true });
    if (!ok || P !== cfg) return;
  }
  abandon();
  leave();
  if (cfg.kind === 'level') menus.showMap();
  else menus.showTitle();
}

export async function restart() {
  if (!P) return;
  if (decided()) return finishDecided();
  const cfg = P;
  const cost = leaveCost('restart');
  if (cost) {
    const ok = await menus.confirm({ title: cfg.kind === 'level' ? 'Restart this level?' : 'Restart the Daily?', text: cost, ok: 'RESTART', danger: true });
    if (!ok || P !== cfg) return;
  }
  if (cfg.kind === 'level') {
    abandon();
    if (!eco.canStartLevel(app.state, Date.now())) {
      // No heart left for another try: back to the map, where the level popup shows the countdown.
      leave();
      menus.showMap(cfg.level.id);
      return;
    }
    teardown();
    startLevel(cfg.level.id, []);
    return;
  }
  abandon();
  teardown();
  if (cfg.kind === 'daily') startDaily();
  else startQuick(cfg.rivalIndex);
}

// ------------------------------------------------------------------ finishing
// Record the match and show the results. If anything throws on the way, the player goes back to the
// menus rather than being stuck on the end cinematic.
function finish() {
  if (!P || app.mode === 'over') return;
  cancelLater('match');
  const kind = P.kind;
  try {
    const result = record();
    app.mode = 'over';
    stopClock('pause', false);
    app.engine.allowQualityChange = true;
    P.stage = 'end';
    app.input.setEnabled(false);
    app.hud.show(false);
    suspendAudio(false);
    menus.showMatchResult(result);
  } catch (err) {
    console.error(err);
    try {
      reloadSave(); // drop whatever half of the result made it into memory
      if (kind === 'level') commit((st) => eco.abandonLevel(st));
    } catch (e) {
      console.error(e);
    }
    leave();
    if (kind === 'level') menus.showMap();
    else menus.showTitle();
    menus.toast('Something went wrong while saving this match. Sorry!', { kind: 'bad', dur: 4000 });
  }
}

// Fold the finished match into the save (reloaded first if another tab wrote it meanwhile). ?blind=1 is
// practice: the result is shown, nothing is paid or unlocked.
function record() {
  if (app.saveChanged) reloadSave();
  const cfg = P;
  const now = Date.now();
  const summary = cfg.match.summary();
  summary.blind = app.blind;
  const model = cfg.model === app.model ? app.model.toJSON() : null;
  const ranked = !!(cfg.daily && cfg.daily.ranked);
  const result = { kind: cfg.kind, summary, level: cfg.level, daily: cfg.daily, rival: cfg.rivalDef, rivalIndex: cfg.rivalIndex, model: cfg.model, practice: app.blind };
  return commit((st) => {
    if (model) st.model = model;
    if (cfg.tutorial) st.tutorial3d = true;
    if (cfg.kind === 'level') {
      const prev = eco.levelRecord(st, cfg.level.id);
      result.prev = { stars: prev.stars, best: prev.best };
      result.rec = store.recordMatch(st, summary, { now });
      result.grant = eco.grantLevelResult(st, cfg.level, summary, now, { practice: app.blind });
      eco.finishLevelHeart(st, result.grant.passed, now);
    } else {
      result.rec = store.recordMatch(st, summary, { rivalIndex: cfg.daily ? null : cfg.rivalIndex, daily: ranked ? cfg.daily : null, now });
      result.coins = eco.recordQuickRace(st, summary, { now, daily: ranked, practice: app.blind });
    }
    return result;
  });
}

// Back to the menus: forget the match; the title's attract match takes over the 3D stage.
export function leave() {
  if (!P) return;
  teardown();
  app.mode = 'menu';
  attract.start();
}

function teardown() {
  cancelLater('match');
  P = null;
  stopClock('pause', false);
  app.engine.allowQualityChange = true;
  app.cam.lift = 0;
  app.hud.reset();
  app.hud.show(false);
  app.input.setEnabled(false);
  app.fx.setRoute(null);
  app.stage.clearEmotes();
  setIntensity(0);
  suspendAudio(false);
}
