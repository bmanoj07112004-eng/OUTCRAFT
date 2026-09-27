// The 3D stage for the match on screen (a real race or the title screen's attract match): builds the
// island for the match's world and theme, keeps the player, rival and villager characters in step with
// the simulation (smoothed positions, headings, animation states, carried items, emotes), and feeds the
// island its per-frame view (needed resources, both targets, the rival's colour, glass mode) and the FX
// its rival route line.

import * as THREE from 'three';
import { createPlayer, createRival, createVillager } from '../3d/characters.js';
import { routeTiles } from '../3d/island.js';
import { TILE, CX, CY } from '../3d/coords.js';
import { W, idx } from '../world.js';
import { clock, clamp } from './app.js';

// Dust puffs at the feet while running, for skins without a trail colour of their own.
const DUST = { meadow: '#f4ffe0', dunes: '#fff0c8', frost: '#ffffff', ember: '#b8a8a4', crystal: '#e0d4ff', sky: '#ffffff' };
const SNAP = 0.9; // metres: a jump bigger than this (the sim snapping to a tile) is eased, not cut

const toX = (x) => (x - CX) * TILE;
const toZ = (y) => (y - CY) * TILE;

// Seconds until an agent can stand next to a node (the eta logic of dev/island.html).
function eta(m, a, nodeId) {
  const f = m.world.nodeField[nodeId];
  const s = a.to || a;
  const d = f[idx(s.x, s.y)];
  if (d < 0) return 99;
  return (d + (a.to ? 1 - a.t : 0)) / a.speed + (a.state === 'think' ? a.timer : 0);
}

export class Stage {
  constructor(engine, island, fx) {
    this.engine = engine;
    this.island = island;
    this.fx = fx;
    this.match = null;
    this.theme = null;
    this.player = null;
    this.skinId = null;
    this.rival = null;
    this.rivalId = null;
    this.rivalColor = '#ff7b2e';
    this.villager = createVillager();
    engine.scene.add(this.villager.group);
    this.villagerAt = new THREE.Vector3();
    this.disp = { player: { x: 0, z: 0, h: Math.PI }, rival: { x: 0, z: 0, h: Math.PI } };
    this.emotes = { player: null, rival: null, villager: null };
    this.faceTo = { player: null, rival: null }; // heading overrides (e.g. to celebrate facing the island)
    this.route = [];
    this.need = new Set();
    this.view = { need: this.need, playerTarget: null, rivalTarget: null, rivalColor: '#ff7b2e', glass: false, pred: null, rivalFirst: false, theme: null };
    this.trail = null;
    this._v = new THREE.Vector3();
    this.contest = null; // { node, rivalFirst } while both go for the same node
  }

  // Bind a new match: rebuild the island for its world, dress the characters, put everyone at spawn.
  load(match, theme, skin, rivalDef) {
    this.match = match;
    this.theme = theme;
    this.engine.setTheme(theme);
    this.island.build(match.world, theme);
    this.island.setOrderItem(null);
    this.fx.setAmbient(theme.ambient);
    this.fx.setRoute(null);
    this.setSkin(skin);
    if (!this.rival || this.rivalId !== rivalDef.id) {
      if (this.rival) this.rival.dispose();
      this.rival = createRival(rivalDef);
      this.rivalId = rivalDef.id;
      this.engine.scene.add(this.rival.group);
    }
    this.rivalColor = rivalDef.color;
    this.view.rivalColor = rivalDef.color;
    this.view.theme = theme;
    for (const who of ['player', 'rival']) {
      const a = match[who];
      const d = this.disp[who];
      d.x = toX(a.fx);
      d.z = toZ(a.fy);
      d.h = Math.PI;
      this[who].update(0, { x: d.x, z: d.z, heading: d.h, moving: 0, state: 'idle', carry: [], emote: null });
    }
    this.island.villagerPos(this.villagerAt);
    this.villager.update(0, { x: this.villagerAt.x, z: this.villagerAt.z, y: this.villagerAt.y, heading: 0, moving: 0, state: 'idle', emote: null });
    this.emotes = { player: null, rival: null, villager: null };
    this.faceTo = { player: null, rival: null };
    this.contest = null;
  }

  setSkin(skin) {
    if (!this.player) {
      this.player = createPlayer(skin);
      this.engine.scene.add(this.player.group);
    } else if (this.skinId !== skin.id) this.player.setSkin(skin);
    this.skinId = skin.id;
    this.trail = skin.trail || null;
  }

  // who: 'player' | 'rival' | 'villager'; type: 'hop' | 'sad' | 'cheer' | 'wave'.
  emote(who, type, ms = 1800) {
    this.emotes[who] = { type, until: clock() + ms };
  }

  clearEmotes() {
    this.emotes = { player: null, rival: null, villager: null };
    this.faceTo = { player: null, rival: null };
  }

  // Turn an agent to face a heading (null gives the heading back to the simulation).
  face(who, heading) {
    this.faceTo[who] = Number.isFinite(heading) ? heading : null;
  }

  // Heading pointing away from the Workshop hut (open island behind the camera's back).
  awayFromHut(who) {
    const d = this.disp[who];
    const zc = this.island.hubZ ?? toZ(10);
    return Math.atan2(d.x, d.z - zc - 0.5);
  }

  // World position of an agent's feet as shown (smoothed), for cameras, labels and effects.
  feet(who, out = this._v) {
    const d = this.disp[who];
    return out.set(d.x, 0, d.z);
  }

  heading(who) {
    return this.disp[who].h;
  }

  // Per frame. opts.glass shows the rival's % guesses (returns the island's label anchors).
  update(dt, now, opts = {}) {
    const m = this.match;
    if (!m) return [];
    const t = clock();
    for (const who of ['player', 'rival', 'villager']) {
      const e = this.emotes[who];
      if (e && t > e.until) this.emotes[who] = null;
    }
    this.updateAgent('player', m.player, dt);
    this.updateAgent('rival', m.rival, dt);
    this.villager.update(dt, { x: this.villagerAt.x, z: this.villagerAt.z, y: this.villagerAt.y, heading: 0, moving: 0, state: 'idle', emote: this.emotes.villager && this.emotes.villager.type });

    // Trail puffs while running.
    const p = m.player;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > p.speed * 0.55) {
      const d = this.disp.player;
      this._v.set(d.x, 0, d.z);
      this.fx.trail(this._v, this.trail || DUST[this.theme.id] || '#ffffff');
    }

    // Island view: what the order still needs, both targets, who gets to a contested node first.
    const race = m.phase === 'race';
    this.need.clear();
    if (m.phase === 'race' || m.phase === 'intro') for (const r of Object.keys(m.needRemaining('player'))) this.need.add(r);
    const v = this.view;
    v.playerTarget = race ? m.playerTarget() : null;
    const rd = m.rival.dest;
    v.rivalTarget = race && rd && rd.kind === 'node' ? rd.id : null;
    v.rivalFirst = v.rivalTarget !== null && v.rivalTarget === v.playerTarget && eta(m, m.rival, v.rivalTarget) < eta(m, m.player, v.rivalTarget);
    v.glass = !!opts.glass;
    v.pred = m.pred;
    this.contest = v.rivalTarget !== null && v.rivalTarget === v.playerTarget ? { node: v.rivalTarget, rivalFirst: v.rivalFirst } : null;
    const anchors = this.island.update(m, dt, now, v);
    this.fx.setRoute(race && rd ? routeTiles(m, 'rival', this.route) : null, this.rivalColor, v.rivalFirst);
    return anchors;
  }

  updateAgent(who, a, dt) {
    const ch = this[who];
    const d = this.disp[who];
    const tx = toX(a.fx);
    const tz = toZ(a.fy);
    const dx = tx - d.x;
    const dz = tz - d.z;
    if (dx * dx + dz * dz > SNAP * SNAP) {
      const k = 1 - Math.exp(-14 * dt);
      d.x += dx * k;
      d.z += dz * k;
    } else {
      d.x = tx;
      d.z = tz;
    }
    const sp = Math.hypot(a.vx, a.vy);
    const w = this.match.world;
    let face = null;
    if (a.state === 'gather' && a.gatherNode != null) {
      const n = w.nodes[a.gatherNode];
      face = [n.x - a.fx, n.y - a.fy];
    } else if (a.state === 'deposit') {
      // Face the nearest Workshop tile (the bench).
      let best = null;
      let bd = Infinity;
      for (const i of w.workshop) {
        const ddx = (i % W) - a.fx;
        const ddy = Math.floor(i / W) - a.fy;
        const dd = ddx * ddx + ddy * ddy;
        if (dd < bd) {
          bd = dd;
          best = [ddx, ddy];
        }
      }
      face = best;
    } else if (sp > 0.05) face = [a.vx, a.vy];
    if (this.faceTo[who] !== null) d.h = this.faceTo[who];
    else if (face && (face[0] || face[1])) d.h = Math.atan2(face[0], face[1]);
    const n = a.state === 'gather' && a.gatherNode != null ? w.nodes[a.gatherNode] : null;
    const e = this.emotes[who];
    ch.update(dt, {
      x: d.x,
      z: d.z,
      heading: d.h,
      moving: clamp(sp / a.speed, 0, 1),
      state: a.state,
      carry: a.bag,
      emote: e ? e.type : null,
      res: n ? n.type : undefined,
    });
  }

  dispose() {
    if (this.player) this.player.dispose();
    if (this.rival) this.rival.dispose();
    this.villager.dispose();
  }
}
