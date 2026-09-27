// Title-screen attract mode: behind the menus the island plays itself. A simple bot (usually the nearest
// needed resource, sometimes the second) races the real rival AI on a random island of the player's
// current world, while the camera slowly circles. Quiet: no sounds, no HUD. A finished match is followed
// by a fresh island.

import * as THREE from 'three';
import { Match } from '../match.js';
import { PlayerModel } from '../model.js';
import { RIVALS, RES } from '../data.js';
import { idx } from '../world.js';
import { LEVELS, levelById, WORLDS } from '../levels.js';
import { app, STEP, clock, later, cancelLater, equippedSkin } from './app.js';

let A = null; // { match, acc, endAt }
const _v = new THREE.Vector3();
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

export const running = () => !!A;

// The player's current world and the rival of their current level.
export function menuWorld() {
  const lvl = levelById(Math.min(app.state.adventure.unlocked, LEVELS.length));
  return { theme: WORLDS[lvl.world].theme, rival: RIVALS.find((r) => r.id === lvl.rival) || RIVALS[0] };
}

export function start({ snap = false } = {}) {
  cancelLater('attract');
  const { theme, rival } = menuWorld();
  const match = new Match({ seed: Math.floor(Math.random() * 1e9), rival, model: new PlayerModel() });
  A = { match, acc: 0, endAt: 0 };
  app.stage.load(match, theme, equippedSkin(), rival);
  app.cam.menuOrbit({ x: 0, y: 0, z: 1.5 }, { speed: 0.07, pitch: 0.6, snap });
}

export function stop() {
  cancelLater('attract');
  A = null;
}

// Tap-mode bot, as in the 2D game's attract mode.
function bot(m) {
  const p = m.player;
  const need = m.needRemaining('player');
  const total = sum(need);
  const hub = { x: 4, y: m.world.hubY };
  if (p.bag.length >= m.bagSizeFor('player') || (p.bag.length && !total)) return hub;
  const here = idx(p.x, p.y);
  const c = m.world.nodes
    .filter((n) => need[n.type] && !n.reserved && n.readyAt - m.time < 1.5)
    .sort((a, b) => m.world.nodeField[a.id][here] - m.world.nodeField[b.id][here]);
  if (!c.length) return p.bag.length ? hub : null;
  return Math.random() < 0.6 || c.length === 1 ? c[0] : c[1];
}

function onEvent(e) {
  const isl = app.island;
  switch (e.type) {
    case 'order':
      isl.setOrderItem(e.item.id, '#ffc83d');
      app.stage.emote('villager', 'wave', 1600);
      break;
    case 'gather':
      app.fx.burst(isl.nodePos(e.node.id, _v), RES[e.res].light, 12, 3.5, 0.6);
      break;
    case 'complete': {
      const who = e.who;
      app.stage.emote(who, 'hop', 2000);
      app.stage.emote(who === 'player' ? 'rival' : 'player', 'sad', 2000);
      app.fx.confetti(isl.displayPos(_v));
      later(900, () => A && isl.setOrderItem(null), 'attract');
      break;
    }
    case 'matchEnd':
      app.stage.emote('player', e.winner === 'player' ? 'cheer' : 'sad', 3000);
      app.stage.emote('rival', e.winner === 'player' ? 'sad' : 'cheer', 3000);
      break;
  }
}

// visible = false while an opaque menu covers the 3D view: the island then simply waits.
export function update(dt, now, visible = true) {
  if (!A || !visible) return;
  const m = A.match;
  A.acc = Math.min(A.acc + dt, STEP * 6);
  while (A.acc >= STEP) {
    if (m.phase === 'race' && m.player.state === 'idle' && !m.player.dest) {
      const g = bot(m);
      if (g) m.command(g.x, g.y);
    }
    m.step(STEP);
    A.acc -= STEP;
    for (const e of m.drainEvents()) onEvent(e);
  }
  if (m.phase === 'end') {
    if (!A.endAt) A.endAt = clock() + 3000;
    else if (clock() > A.endAt) {
      start();
      return;
    }
  }
  app.stage.update(dt, now, { glass: false });
}
