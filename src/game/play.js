// In-match controller of the 3D edition. Starts a match for a mode (Adventure level, Daily Commission,
// Quick Race), runs the VS splash and the camera fly-in, steps the simulation on a fixed step, maps every
// sim event to 3D effects + HUD + sound + haptics (as the 2D game did), drives the first-time tutorial,
// the camera and the HUD every frame, and hands the finished match to the results flow in menus.js.
//
// Stages of a match: 'vs' (splash) -> 'intro' (camera fly-in; the order is posted during it) -> 'play'
// (the race, orders one after another) -> 'end' (victory orbit, then the results).

import * as THREE from 'three';
import { Match } from '../match.js';
import { PlayerModel } from '../model.js';
import { RIVALS, RES, COMPONENTS, SCORE } from '../data.js';
import { idx } from '../world.js';
import { THEMES } from '../3d/themes.js';
import { tilePos } from '../3d/island.js';
import { worldToTile } from '../3d/coords.js';
import { levelById, matchConfig, levelPassed, WORLDS } from '../levels.js';
import * as eco from '../economy.js';
import * as store from '../storage.js';
import { sfx, buzz, setIntensity, suspendAudio, unlockAudio, startMusic } from '../audio.js';
import { app, clock, later, cancelLater, shiftLater, STEP, pick, pct, playerPortrait, rivalPortrait, equippedSkin } from './app.js';
import * as attract from './attract.js';
import * as menus from './menus.js';

const VS_MS = 2400; // VS splash
const INTRO_S = 3.0; // camera fly-in (s)
const STEP_DELAY = 350; // ms into the fly-in before the order is posted
const END_MS = 2900; // victory orbit before the results
const PLAYER_BLUE = '#3d7bff';
const ORDER_LINES = [(n) => `I need a ${n}!`, (n) => `One ${n}, please!`, (n) => `Who can make me a ${n}?`, (n) => `A ${n}! Quick!`];
// Quick Race islands wear the world where each rival rules; the Daily one rotates by date.
const QUICK_THEME = [0, 1, 2, 3, 4];

let P = null; // the match being played (see begin())
const _v = new THREE.Vector3();
const _s = { x: 0, y: 0, visible: false };
const _move = { x: 0, z: 0 };

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

// ------------------------------------------------------------------ starting a match

// Adventure: needs a heart (only lost on a fail or a quit); boosters are consumed now.
export function startLevel(id, boosterIds = []) {
  const level = levelById(id);
  const st = app.state;
  if (!level || id > st.adventure.unlocked) return false;
  if (!eco.canStartLevel(st, Date.now())) {
    menus.noHearts(level);
    return false;
  }
  const cfg = matchConfig(level);
  const used = [...new Set(boosterIds || [])].filter((b) => eco.BOOSTERS[b] && eco.boosterCount(st, b) > 0);
  const boosts = eco.useBoosters(st, used);
  store.save(st);
  begin({
    kind: 'level',
    level,
    seed: cfg.seed,
    rival: cfg.rival,
    rivalIndex: cfg.rivalIndex,
    twist: cfg.twist,
    options: { ...cfg.options, ...boosts, autoReturn: st.settings.autoReturn },
    theme: WORLDS[level.world].theme,
    boosters: used,
  });
  return true;
}

// Daily Commission: same island, orders and twist for everyone today; FOX with no memory of you.
export function startDaily() {
  const d = store.todaysDaily();
  const daily = { ...d, ranked: !app.state.daily.results[d.key] };
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
  const match = new Match({ seed: cfg.seed, rival: rivalDef, model, twist: cfg.twist, options: cfg.options });
  P = {
    ...cfg,
    rivalDef,
    model,
    match,
    stage: 'vs',
    stepping: false,
    acc: 0,
    tutorial: cfg.kind === 'level' && cfg.level.id === 1 && !st.tutorialDone,
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
    pausedAt: 0,
  };
  attract.stop();
  app.mode = 'play';
  menus.hideForMatch();
  app.stage.load(match, cfg.theme, equippedSkin(), rivalDef);

  const hud = app.hud;
  const skin = equippedSkin();
  const player = { portrait: playerPortrait(128), color: skin.colors.body };
  const rival = { name: rivalDef.name, color: rivalDef.color, portrait: rivalPortrait(rivalDef, 128), title: rivalDef.title };
  hud.setup({ rival, player, starsToWin: match.starsToWin, thresholds: cfg.level ? cfg.level.thresholds : null, timeLimit: match.timeLimit, bagSize: match.bagSizeFor('player') });
  const th = cfg.theme;
  hud.setMinimapWorld(match.world, { sea: th.sea.kind === 'clouds' ? '#bcd0f5' : th.sea.color, land: th.ground.top[0], beach: th.ground.beach, block: th.props.bush });
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
    sub = l.twist ? `Twist · ${l.twist.name}: ${l.twist.desc}` : mem > 0 ? `${mem} of your moves in its notebook` : 'It has never seen you play. Yet.';
  } else if (cfg.kind === 'daily') {
    title = `DAILY COMMISSION #${cfg.daily.number}`;
    goal = `${cfg.twist.name}: ${cfg.twist.desc}`;
    sub = cfg.daily.ranked ? 'It has never seen you play. Only your first attempt counts.' : 'Practice run: only your first attempt counts.';
  } else {
    title = 'QUICK RACE';
    goal = `First to ${match.starsToWin} orders wins.`;
    sub = mem > 0 ? `${mem} of your moves in its notebook` : 'It has never seen you play. Yet.';
  }
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
  if (P.stage === 'intro') P.stage = 'play';
}

// ------------------------------------------------------------------ per frame
export function update(dt, now) {
  if (!P) return;
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
    cam.follow(f.x, f.z, app.stage.heading('player'), Math.min(1, sp / m.player.speed));
    cam.lift = hutInTheWay(f.x, f.z) ? 0.55 : 0;
  }
  if (Math.hypot(m.player.vx, m.player.vy) > 0.05) P.idleSince = clock();
  hudFrame(anchors);
}

// Would the Workshop hut hide the player from the camera's normal (unlifted) spot? Then look over it.
const _hut = new THREE.Box3();
const _ray = new THREE.Ray();
const _cp = new THREE.Vector3();
function hutInTheWay(x, z) {
  const cam = app.cam;
  const zc = app.island.hubZ;
  if (!Number.isFinite(zc) || z > zc || z < zc - 7 || Math.abs(x) > 5) return false;
  const cp = Math.cos(cam.pitch);
  _cp.set(x - Math.sin(cam.yaw) * cp * cam.distance, 1.4 + Math.sin(cam.pitch) * cam.distance, z - Math.cos(cam.yaw) * cp * cam.distance);
  // The hut itself (roof included; the benches beside it are low). Its centre sits 0.22 m north of the deck.
  _hut.min.set(-1.35, 0, zc - 1.22);
  _hut.max.set(1.35, 2.35, zc + 0.78);
  _ray.origin.set(x, 0.3, z); // from the feet: lift early enough to keep the whole body in view
  _ray.direction.copy(_cp).sub(_ray.origin).normalize();
  return !!_ray.intersectBox(_hut, _cp.set(0, 0, 0));
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
    if (s.visible) hud.label('contest', labelX(s.x, s.y, 58), s.y - 8, c.rivalFirst ? `${P.rivalDef.name} FIRST` : 'YOU FIRST', 'pill', c.rivalFirst ? '#ff4d5e' : '#3ec22b');
  }
  // Speech bubbles stay clear of the bag and buttons at the bottom.
  const now = clock();
  const low = window.innerHeight - (window.innerHeight < 560 ? 90 : 170);
  if (P.bubble && now < P.bubble.until) {
    const s = screenOf(app.stage.rival.anchor(_v));
    if (s.visible) hud.label('say-rival', labelX(s.x, s.y, 92), Math.min(s.y, low), P.bubble.text, 'bubble', P.rivalDef.color);
  }
  if (P.vbubble && now < P.vbubble.until) {
    const s = screenOf(app.stage.villager.anchor(_v));
    if (s.visible) hud.label('say-villager', labelX(s.x, s.y, 92), Math.min(s.y, low), P.vbubble.text, 'bubble', '#ff8c42');
  }
  // Bag ready: mark the Workshop.
  if (race && ready && !P.tutorial) {
    app.island.displayPos(_v).y += 0.9; // just above the floating order card
    const s = screenOf(_v);
    if (s.visible) hud.label('workshop', labelX(s.x, s.y, 62), s.y, 'DROP IT HERE', 'pill', '#2f86ff');
  }
  if (anchors && anchors.length) {
    for (const a of anchors) {
      const s = screenOf(a.pos);
      if (s.visible) hud.glassLabel(`g${a.id}`, s.x, s.y, a.p);
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
      hud.toast('10 seconds! Hurry!', { kind: 'bad', dur: 2200 });
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
  if (P.tutorial) tutorialFrame(m);
  else hud.pointer(null);
}

function hintText(m) {
  const p = m.player;
  if (p.bag.length >= m.bagSizeFor('player')) return 'Bag full: head to the Workshop';
  const need = m.needRemaining('player');
  const parts = Object.entries(need).map(([r, n]) => `${RES[r].name}${n > 1 ? ` ×${n}` : ''}`);
  if (!parts.length) return p.bag.length ? 'All gathered: take it to the Workshop!' : '';
  return `Still need: ${parts.join(', ')}`;
}

const homeWord = () => (app.input.lastDevice === 'touch' ? 'tap HOME' : 'press Space');

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
      if (e.index === 0 && P.boosters && P.boosters.length && !P.tutorial) hud.toast(`Boosters on: ${P.boosters.map((id) => eco.BOOSTERS[id].name).join(' + ')}`, { kind: 'good', dur: 2600 });
      if (P.tutorial && e.index === 0) {
        const touch = app.input.lastDevice === 'touch';
        hud.toast(touch ? 'Move with the joystick (left thumb). Drag on the right to look around.' : 'Move with WASD or the arrow keys. Drag with the mouse to look around.', { kind: 'info', dur: 5200 });
        later(5600, () => P && P.match.stats.gathers === 0 && hud.toast('Walk into a resource with a gold ring to gather it. Your bag holds 3.', { kind: 'info', dur: 4600 }), 'match');
      }
      if (P.tutorial && e.index === 1) hud.toast(`That dotted line is ${R.name}'s route. Its ring shows what it wants next.`, { kind: 'info', dur: 4600 });
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
        if (P.tutorial && !P.tips.gather) {
          P.tips.gather = true;
          hud.toast('Nice! Gather what the card needs, then walk into the Workshop.', { kind: 'good', dur: 3800 });
        }
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
          later(700, () => P && hud.toast('Parts craft themselves at your bench once their materials arrive.', { kind: 'info', dur: 3200 }), 'match');
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
          hud.caption('CRAFTED!', { sub: `${item.name} delivered · +1 star`, color: '#ffc629', size: 1.15, dur: 1600 });
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
        hud.caption(`${R.name} GOT IT`, { sub: `${item.name} goes to your rival`, color: R.color, size: 0.95, dur: 1600 });
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
      hud.toast(e.text.kind === 'luck' ? `${e.text.text} Pick another one!` : e.text.text, { kind: 'bad', dur: 4400 });
      const st = app.state;
      st.tips = st.tips || {};
      if (!P.tutorial && !st.tips.glass && P.rivalIndex > 0) {
        st.tips.glass = true;
        store.save(st);
        later(4800, () => P && hud.toast("Curious how it reads you? Pause and switch on 'Show the rival's thoughts'.", { kind: 'info', dur: 4500 }), 'match');
      }
      if (P.tutorial && !P.tips.snatch && !P.tips.line) {
        P.tips.snatch = true;
        later(4700, () => P && hud.toast('Watch its dotted line. When it turns red, it is going for YOUR target. Change course!', { kind: 'info', dur: 4200 }), 'match');
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
      hud.toast(`You beat ${R.name} to it. It was heading there too.`, { kind: 'good', dur: 2600 });
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
      hud.toast(e.full ? `Bag full! Head to the Workshop, or ${homeWord()}.` : `Everything gathered! Take it to the Workshop, or ${homeWord()}.`, { dur: 2600 });
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

function onMatchEnd(e) {
  const m = P.match;
  const R = P.rivalDef;
  P.stage = 'end';
  const win = e.winner === 'player';
  P.won = P.level ? levelPassed(P.level, m.summary()) : win;
  app.input.setEnabled(false);
  m.setMove(0, 0);
  // The winner turns to face the island (the hut behind them), and the camera swings round in front.
  app.stage.face(e.winner, app.stage.awayFromHut(e.winner));
  const f = app.stage.feet(e.winner, new THREE.Vector3());
  later(400, () => {
    if (!P) return;
    app.cam.follow(f.x, f.z, app.stage.heading(e.winner), 0);
    app.cam.victory(f.x, f.z);
  }, 'match');
  app.stage.emote('player', win ? 'cheer' : 'sad', 9000);
  app.stage.emote('rival', win ? 'sad' : 'cheer', 9000);
  quip(win ? 'loseOrder' : 'winOrder', 2400);
  app.hud.pointer(null);
  setIntensity(0);
  if (win) {
    sfx.win();
    app.hud.caption(e.timeUp ? "TIME'S UP · YOU WIN!" : 'YOU WIN!', { sub: `You out-crafted ${R.name}`, color: '#ffc629', size: 1.2, dur: 2400 });
    const top = app.island.displayPos(new THREE.Vector3());
    for (let i = 0; i < 3; i++) later(250 + i * 380, () => P && app.fx.confetti(new THREE.Vector3(f.x + (i - 1) * 1.2, 2.5, f.z)), 'match');
    later(150, () => P && app.fx.confetti(top), 'match');
  } else {
    sfx.lose();
    app.hud.caption(e.timeUp ? "TIME'S UP" : `${R.name} WINS`, { sub: e.timeUp ? `${R.name} was ahead when the clock ran out` : 'It read you this time', color: R.color, size: 1, dur: 2400 });
  }
  later(END_MS, finish, 'match');
}

// ------------------------------------------------------------------ first-time tutorial (level 1)
function tutorialFrame(m) {
  const hud = app.hud;
  if (P.stage !== 'play' || m.phase !== 'race') return hud.pointer(null);
  const p = m.player;
  const need = m.needRemaining('player');
  const total = sum(need);
  if (m.stats.trips === 0 && p.bag.length && (p.bag.length >= m.bagSizeFor('player') || !total) && p.state !== 'deposit' && !(p.dest && p.dest.kind === 'hub')) {
    if (!P.tips.home) {
      P.tips.home = true;
      hud.toast(`Bag ready! Walk into the Workshop, or ${homeWord()}.`, { kind: 'info', dur: 4200 });
    }
    return hud.pointer('home', 'HOME');
  }
  const stuck = m.orderIndex === 0 && clock() - P.idleSince > 4000 && p.state === 'idle';
  if ((m.stats.gathers === 0 || stuck) && total && p.state !== 'gather') {
    const here = idx(p.x, p.y);
    const n = m.world.nodes.filter((k) => need[k.type] && m.nodeReady(k)).sort((a, b) => m.world.nodeField[a.id][here] - m.world.nodeField[b.id][here])[0];
    if (n) {
      tilePos(n.x, n.y, _v).y = 1.1; // point at the resource itself, not the top of a tall tree
      const s = screenOf(_v);
      return hud.pointer({ x: s.x, y: s.y, label: 'GO HERE', visible: s.visible });
    }
  }
  // A red line: the rival will beat you to your target.
  const c = app.stage.contest;
  if (c && c.rivalFirst && !P.tips.line) {
    P.tips.line = true;
    hud.toast(`Red line! ${P.rivalDef.name} will get there first. Pick a different one!`, { kind: 'bad', dur: 4200 });
  }
  hud.pointer(null);
}

// ------------------------------------------------------------------ controls
export function tap(x, y) {
  if (!P || app.mode !== 'play') return;
  if (P.stage === 'vs') return endVs();
  if (P.stage === 'intro') {
    app.cam.skipIntro();
    return;
  }
  const m = P.match;
  if (P.stage !== 'play' || m.phase !== 'race') return;
  const hits = app.engine.raycast(x, y, app.island.pickTargets);
  if (!hits.length) return;
  const h = hits[0];
  const u = h.object.userData || {};
  let dest = null;
  if (u.kind === 'node') {
    const n = m.world.nodes[u.id];
    dest = m.command(n.x, n.y);
  } else if (u.kind === 'hub') dest = m.command(4, m.world.hubY);
  else {
    const t = worldToTile(h.point.x, h.point.z);
    dest = m.command(Math.round(t.x), Math.round(t.y));
  }
  if (!dest) return;
  sfx.tap();
  const pos = new THREE.Vector3();
  if (dest.kind === 'node') {
    const n = m.world.nodes[dest.id];
    tilePos(n.x, n.y, pos);
  } else if (dest.kind === 'hub') tilePos(4, m.world.hubY, pos);
  else tilePos(dest.x, dest.y, pos);
  pos.y = 0.05;
  app.fx.ring(pos, '#ffffff', 0.55);
}

export function interact() {
  if (!P || app.mode !== 'play' || P.stage !== 'play') return;
  const r = P.match.interact();
  if (r) sfx.tap();
  else if (P.match.phase === 'race' && P.match.canInteract() === null && !P.tips.interact) {
    P.tips.interact = true;
    app.hud.toast('Walk up to a resource (or the Workshop) first. Needed ones gather by themselves.', { dur: 2800 });
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
export function pause() {
  if (!P || app.mode !== 'play' || P.stage === 'vs' || P.stage === 'end') return false;
  app.mode = 'paused';
  P.pausedAt = clock();
  app.input.setEnabled(false);
  P.match.setMove(0, 0);
  suspendAudio(true);
  menus.showPause(P);
  return true;
}

export function resume() {
  if (!P || app.mode !== 'paused') return;
  app.mode = 'play';
  shiftLater('match', clock() - P.pausedAt);
  app.input.setEnabled(true);
  suspendAudio(false);
  menus.closePause();
}

// A match already decided (someone reached the winning stars) is finished and recorded, not abandoned.
function decided() {
  const m = P.match;
  return m.phase === 'end' || Math.max(m.stars.player, m.stars.rival) >= m.starsToWin;
}

function fastForward() {
  const m = P.match;
  let guard = 0;
  while (m.phase !== 'end' && guard++ < 4000) m.step(STEP);
  m.drainEvents();
}

// Abandon: the model still closes the match (what it saw counts); a level costs a heart.
function abandon() {
  const st = app.state;
  const m = P.match;
  if (m.phase !== 'end') P.model.endMatch();
  if (P.model === app.model) st.model = app.model.toJSON();
  if (P.kind === 'level') eco.loseHeart(st, Date.now());
  store.save(st);
}

export async function quit() {
  if (!P) return;
  if (decided()) {
    menus.closePause();
    fastForward();
    app.mode = 'play';
    return finish();
  }
  if (P.kind === 'level') {
    const ok = await menus.confirm({ title: 'Quit this level?', text: 'Quitting counts as a loss: you will lose one heart.', ok: 'QUIT', danger: true });
    if (!ok || !P) return;
  }
  const kind = P.kind;
  abandon();
  leave();
  if (kind === 'level') menus.showMap();
  else menus.showTitle();
}

export async function restart() {
  if (!P) return;
  const cfg = P;
  if (cfg.kind === 'level') {
    const ok = await menus.confirm({ title: 'Restart this level?', text: 'Restarting counts as a loss: you will lose one heart. Boosters used this time are gone.', ok: 'RESTART', danger: true });
    if (!ok || !P) return;
    abandon();
    if (!eco.canStartLevel(app.state, Date.now())) {
      // That was the last heart: back to the map, where the level popup shows the countdown.
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
function finish() {
  if (!P || app.mode === 'over') return;
  cancelLater('match');
  const m = P.match;
  const st = app.state;
  const now = Date.now();
  const summary = m.summary();
  summary.blind = app.blind;
  if (P.model === app.model) st.model = app.model.toJSON();
  if (P.kind !== 'daily') st.tutorialDone = true;
  const result = { kind: P.kind, summary, level: P.level, daily: P.daily, rival: P.rivalDef, rivalIndex: P.rivalIndex, model: P.model };
  if (P.kind === 'level') {
    const prev = eco.levelRecord(st, P.level.id);
    result.prev = { stars: prev.stars, best: prev.best };
    result.rec = store.recordMatch(st, summary, { now });
    result.grant = eco.grantLevelResult(st, P.level, summary, now);
    if (!result.grant.passed) eco.loseHeart(st, now);
  } else {
    result.rec = store.recordMatch(st, summary, { rivalIndex: P.daily ? null : P.rivalIndex, daily: P.daily && P.daily.ranked ? P.daily : null, now });
    result.coins = eco.recordQuickRace(st, summary, { now, daily: !!P.daily });
  }
  store.save(st);
  app.mode = 'over';
  P.stage = 'end';
  app.input.setEnabled(false);
  app.hud.show(false);
  suspendAudio(false);
  menus.showMatchResult(result);
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
  app.cam.lift = 0;
  app.hud.reset();
  app.hud.show(false);
  app.input.setEnabled(false);
  app.fx.setRoute(null);
  app.stage.clearEmotes();
  setIntensity(0);
  suspendAudio(false);
}
