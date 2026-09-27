// One OUTCRAFT match as a pure, fixed-step simulation (no DOM, no timers): the browser game and the
// Node balance simulator both drive it with step(dt).
//
// Race rules: the villager posts an order; both crafters gather from the same scarce nodes (1 unit
// each, regrows in seconds), carry up to BAG_SIZE items, and deposit at the Workshop, which crafts
// components automatically. First to finish the item wins the order's star. First to 3 stars wins.
//
// The rival picks targets by scoring every node: does it need the resource, how soon can it get
// there, and how likely is the player heading there next (from the PlayerModel's habit prediction
// plus the direction the player is walking). High "you want it and I can beat you there" = a snatch.
//
// The player moves in one of two ways. Tap mode (command): walk a BFS path tile by tile, gather or
// deposit on arrival, walk home by itself when the bag is full. Free mode (setMove, the 3D joystick):
// move continuously, collide with blocked tiles and slide along them, gather needed nodes and deposit
// automatically when in reach; the sim infers which node you are heading for (player.aim) so the
// rival can still read, and be fooled by, your intent. Without the new options and without setMove,
// every match plays out bit-for-bit as it always did.
//
// Level options (orders, starsToWin, timeLimit, boosters) and the Adventure score live here too.

import { W, generateIsland, idx, isWalkable, nextStep, tileField, regionOf, sideOf } from './world.js';
import { COMPONENTS, ITEMS, ITEM_BY_ID, RES_IDS, PLAYER_SPEED, GATHER_TIME, DEPOSIT_TIME, BAG_SIZE, STARS_TO_WIN, SCORE } from './data.js';
import { mulberry32 } from './rng.js';

// Free movement, all in tile units.
export const PLAYER_RADIUS = 0.32; // collision circle
export const REACH = 0.95; // centre-to-centre distance for gathering a node or depositing at a Workshop tile
export const MOVE_DEADZONE = 0.12; // stick magnitude that switches the player into free movement
const MAX_SUBSTEP = 0.2; // longest collision sub-step (well under a tile, so nothing can tunnel)
const MAX_STEP_DIST = 8; // cap on free movement in one step (a huge dt must not mean millions of sub-steps)
const SKIN = 1e-6; // collisions push out a hair past the radius, so resting contact is stable
const AIM_COS = Math.cos((40 * Math.PI) / 180); // aim cone half-angle
const AIM_SOON = 2; // a node counts as a target if it is ready within this many seconds
const AIM_STICKY = 1.25; // the current aim gets this bonus, so it does not flicker between nodes
const DIRS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const sumVals = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

class Agent {
  constructor(who, spawn, speed) {
    this.who = who;
    // Tile the agent stands on: on a path it is the tile the current step started from; in free mode
    // it is the tile containing the centre. Always walkable.
    this.x = spawn.x;
    this.y = spawn.y;
    // Exact position whenever the agent is not between path points.
    this.px = spawn.x;
    this.py = spawn.y;
    // Current path segment: from (ox, oy) to the tile centre `to`, progress t (0..1) over length len.
    // Segments are one tile long, except the first one after free movement.
    this.ox = spawn.x;
    this.oy = spawn.y;
    this.len = 1;
    this.to = null;
    this.t = 0;
    this.dx = 0;
    this.dy = 0;
    this.faceX = who === 'player' ? 1 : -1;
    this.speed = speed;
    this.dest = null;
    this.queued = null;
    this.state = 'idle';
    this.timer = 0;
    this.bag = [];
    this.gatherNode = null;
    this.free = false; // player only: analog stick control instead of tap paths
    this.aim = null; // player only, free mode: node id the player seems to be heading for
    this.vx = 0; // velocity over the last step, tiles per second (for animation)
    this.vy = 0;
  }
  get fx() {
    return this.to ? this.ox + (this.to.x - this.ox) * this.t : this.px;
  }
  get fy() {
    return this.to ? this.oy + (this.to.y - this.oy) * this.t : this.py;
  }
}

export class Match {
  constructor({ seed, rival, model, twist = null, rng = null, enabledExperts = null, options = null }) {
    this.seed = seed;
    this.rng = rng || mulberry32((seed ^ 0x5bd1e995) >>> 0);
    this.world = generateIsland(seed);
    this.rivalDef = rival;
    this.model = model;
    this.twist = twist || {};
    this.experts = enabledExperts || rival.experts;
    this.options = normalizeOptions(options);
    const opt = this.options;
    const speedMul = this.twist.speedMul || 1;
    this.respawnMul = this.twist.respawnMul || 1;
    this.bagSize = this.twist.bag || BAG_SIZE; // the rival's (= shared) bag size
    this.player = new Agent('player', this.world.spawn.player, PLAYER_SPEED * speedMul * opt.playerSpeedMul);
    this.rival = new Agent('rival', this.world.spawn.rival, rival.speed * speedMul * (this.twist.rivalSpeedMul || 1));
    this.bench = { player: { raw: {}, made: [] }, rival: { raw: {}, made: [] } };
    this.stars = { player: 0, rival: 0 };
    this.orders = opt.orders ? opt.orders.map((id) => ITEM_BY_ID[id]) : this.pickOrders();
    this.maxOrders = this.orders.length;
    this.starsToWin = opt.starsToWin;
    this.timeLimit = opt.timeLimit;
    this.orderIndex = -1;
    this.results = [];
    this.phase = 'intro';
    this.phaseTimer = 0;
    this.time = 0;
    this.raceTime = 0; // seconds spent in the 'race' phase (what the time limit counts)
    this.goTime = 0; // match time of the current order's GO (for the speed bonus)
    this.timeUp = false;
    this.score = 0;
    this.events = [];
    this.stats = { snatched: 0, outread: 0, fooled: 0, gathers: 0, rivalGathers: 0, trips: 0, predN: 0, predHits: 0, predChance: 0 };
    this.lastFooled = -99;
    this.ctx = null;
    this.pred = null;
    this.prevType = null;
    this.rivalIntent = null;
    this.rivalReplan = 0;
    // Analog stick (setMove). stickLatch: a tap path was started while the stick was held, so the
    // stick must be released before it takes over again (a held stick never cancels HOME).
    this.moveX = 0;
    this.moveY = 0;
    this.moveMag = 0;
    this.moveUX = 0;
    this.moveUY = 0;
    this.subX = 0; // current collision sub-step (see moveFree)
    this.subY = 0;
    this.stickLatch = false;
    this.homeHinted = false; // free mode: the bagFull hint was sent for the current bag load
    this.freeNeed = Object.fromEntries(RES_IDS.map((r) => [r, 0])); // scratch for needInto
    model.beginMatch();
    this.startOrder(0);
  }

  // ------------------------------------------------------------ orders
  pickOrders() {
    const used = new Set();
    return this.rivalDef.tiers.map((tier0) => {
      const minT = this.twist.minTier || 0;
      const tier = Math.max(tier0, minT);
      let pool = ITEMS.filter((i) => i.tier === tier && !used.has(i.id));
      if (!pool.length) pool = ITEMS.filter((i) => Math.abs(i.tier - tier) <= 1 && i.tier >= minT && !used.has(i.id));
      if (!pool.length) pool = ITEMS.filter((i) => i.tier >= minT && !used.has(i.id));
      if (!pool.length) pool = ITEMS.slice();
      const item = pool[Math.floor(this.rng() * pool.length)];
      used.add(item.id);
      return item;
    });
  }

  get order() {
    return this.orders[this.orderIndex];
  }

  // Booster: during the first `blindOrders` orders the rival cannot read you at all.
  get blind() {
    return this.orderIndex < this.options.blindOrders;
  }

  // Seconds of race time left, or null when the level has no time limit.
  get timeLeft() {
    return this.timeLimit ? Math.max(0, this.timeLimit - this.raceTime) : null;
  }

  bagSizeFor(who) {
    return who === 'player' ? this.bagSize + this.options.playerBagBonus : this.bagSize;
  }

  startOrder(i) {
    this.orderIndex = i;
    for (const who of ['player', 'rival']) this.bench[who].made = this.order.parts.map(() => false);
    this.phase = 'intro';
    this.phaseTimer = i === 0 ? 2.6 : 1.4;
    this.prevType = null;
    this.ctx = null;
    this.pred = null;
    this.homeHinted = false;
    this.emit({ type: 'order', item: this.order, index: i });
  }

  // Remaining raw materials an agent still has to gather: order needs minus workshop stock minus bag.
  needRemaining(who) {
    const b = this.bench[who];
    const need = {};
    this.order.parts.forEach((p, i) => {
      if (!b.made[i]) for (const r of COMPONENTS[p].needs) need[r] = (need[r] || 0) + 1;
    });
    const have = { ...b.raw };
    for (const r of this[who].bag) have[r] = (have[r] || 0) + 1;
    for (const r of Object.keys(need)) need[r] = Math.max(0, need[r] - (have[r] || 0));
    for (const r of Object.keys(need)) if (!need[r]) delete need[r];
    return need;
  }

  // Same numbers as needRemaining, written into `out` (every resource id, 0 if not needed) without
  // allocating, for the per-step free-movement checks.
  needInto(who, out) {
    const b = this.bench[who];
    const parts = this.order.parts;
    for (let k = 0; k < RES_IDS.length; k++) out[RES_IDS[k]] = 0;
    for (let i = 0; i < parts.length; i++) {
      if (b.made[i]) continue;
      const needs = COMPONENTS[parts[i]].needs;
      for (let j = 0; j < needs.length; j++) out[needs[j]]++;
    }
    const bag = this[who].bag;
    for (let j = 0; j < bag.length; j++) out[bag[j]]--;
    for (let k = 0; k < RES_IDS.length; k++) {
      const r = RES_IDS[k];
      out[r] = Math.max(0, out[r] - (b.raw[r] || 0));
    }
    return out;
  }

  // The first resource the order card still lists as missing (for the "By the Book" habit).
  firstCardNeed(who) {
    const need = this.needRemaining(who);
    const b = this.bench[who];
    for (let i = 0; i < this.order.parts.length; i++) {
      if (b.made[i]) continue;
      for (const r of COMPONENTS[this.order.parts[i]].needs) if (need[r]) return r;
    }
    return null;
  }

  craftCheck(who) {
    const b = this.bench[who];
    const parts = this.order.parts;
    let progress = true;
    while (progress) {
      progress = false;
      for (let i = 0; i < parts.length; i++) {
        if (b.made[i]) continue;
        const needs = COMPONENTS[parts[i]].needs;
        const cnt = {};
        needs.forEach((r) => (cnt[r] = (cnt[r] || 0) + 1));
        if (Object.entries(cnt).every(([r, c]) => (b.raw[r] || 0) >= c)) {
          Object.entries(cnt).forEach(([r, c]) => (b.raw[r] -= c));
          b.made[i] = true;
          progress = true;
          this.emit({ type: 'craft', who, part: parts[i], index: i });
          if (who === 'player') this.addScore(SCORE.craft, 'craft');
        }
      }
    }
    if (b.made.every(Boolean)) this.orderWon(who);
  }

  orderWon(who) {
    if (this.phase !== 'race') return;
    this.stars[who] += 1;
    this.results.push({ item: this.order.id, winner: who });
    const loser = who === 'player' ? 'rival' : 'player';
    // The loser's half-built components go back into its stock as raw materials.
    const lb = this.bench[loser];
    this.order.parts.forEach((p, i) => {
      if (lb.made[i]) for (const r of COMPONENTS[p].needs) lb.raw[r] = (lb.raw[r] || 0) + 1;
    });
    for (const a of [this.player, this.rival]) this.settle(a);
    this.phase = 'orderEnd';
    this.phaseTimer = 2.1;
    this.emit({ type: 'complete', who, item: this.order, stars: { ...this.stars } });
    if (who === 'player') {
      this.addScore(SCORE.order, 'order');
      // Speed bonus: points for every second under par, measured from GO.
      const par = SCORE.parSeconds[Math.min(this.order.tier, SCORE.parSeconds.length - 1)] || 0;
      this.addScore(Math.round(Math.max(0, par - (this.time - this.goTime)) * SCORE.perSecondUnderPar), 'speed');
    }
  }

  // Freeze an agent cleanly between orders: finish half-done actions, snap to a tile.
  settle(a) {
    if (a.state === 'gather') this.finishGather(a, true);
    if (a.state === 'deposit') this.finishDeposit(a, true);
    if (a.to) {
      this.place(a, a.to.x, a.to.y);
      a.to = null;
      a.t = 0;
    }
    a.dest = null;
    a.queued = null;
    a.aim = null;
    a.state = 'idle';
  }

  // The match is over: after the last order, or when the time limit runs out mid-race.
  finish(timeUp) {
    if (timeUp) for (const a of [this.player, this.rival]) this.settle(a);
    this.phase = 'end';
    this.timeUp = timeUp;
    this.model.endMatch();
    const winner = this.stars.player > this.stars.rival ? 'player' : 'rival';
    if (winner === 'player') {
      this.addScore(SCORE.matchWin, 'matchWin');
      if (this.stars.rival === 0) this.addScore(SCORE.flawless, 'flawless');
    }
    this.emit({ type: 'matchEnd', winner, timeUp });
  }

  addScore(add, reason) {
    if (!(add > 0)) return;
    this.score += add;
    this.emit({ type: 'score', add, total: this.score, reason });
  }

  // ------------------------------------------------------------ nodes
  nodeReady(n) {
    return !n.reserved && n.readyAt <= this.time;
  }

  nodeAt(x, y) {
    return this.world.nodes.find((n) => n.x === x && n.y === y) || null;
  }

  fieldFor(dest) {
    if (dest.kind === 'node') return this.world.nodeField[dest.id];
    if (dest.kind === 'hub') return this.world.hubField;
    return tileField(this.world, dest.x, dest.y);
  }

  // Nearest node whose centre is within REACH of the agent's centre. `need` (optional) keeps only
  // resources the order still needs; `readyOnly` keeps only nodes that can be gathered right now.
  nodeInReach(a, need, readyOnly) {
    const px = a.fx;
    const py = a.fy;
    const nodes = this.world.nodes;
    let best = null;
    let bestD = REACH * REACH + 1e-9;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (need && !need[n.type]) continue;
      if (readyOnly && !this.nodeReady(n)) continue;
      const dx = n.x - px;
      const dy = n.y - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  nearWorkshop(a) {
    const px = a.fx;
    const py = a.fy;
    const ws = this.world.workshop;
    for (let i = 0; i < ws.length; i++) {
      const dx = (ws[i] % W) - px;
      const dy = Math.floor(ws[i] / W) - py;
      if (dx * dx + dy * dy <= REACH * REACH) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ player input
  // Tap/click on a tile: walk to a node (and gather it), to the Workshop (deposit), or to a free tile.
  // Works from anywhere, including mid free movement (the first step starts at the exact position).
  command(x, y) {
    if (this.phase !== 'race') return null;
    const w = this.world;
    let dest = null;
    const node = this.nodeAt(x, y);
    if (node) dest = { kind: 'node', id: node.id };
    else if (w.workshop.includes(idx(x, y))) dest = { kind: 'hub' };
    else if (x >= 0 && y >= 0 && x < 9 && y < 13 && w.walkable[idx(x, y)]) dest = { kind: 'tile', x, y };
    if (!dest) return null;
    const a = this.player;
    // An impatient double-tap on the node you are already gathering is ignored.
    if (a.state === 'gather' && dest.kind === 'node' && dest.id === a.gatherNode) return null;
    this.leaveFree(a);
    if (a.state === 'gather' || a.state === 'deposit') a.queued = dest;
    else {
      a.dest = dest;
      if (a.state === 'wait' || a.state === 'idle') a.state = 'walk';
    }
    return dest;
  }

  // Analog stick in tile units (mx east, my south), magnitude clamped to 1. Above MOVE_DEADZONE the
  // player switches to free movement at the next step (cancelling any tap path); (0, 0) stops.
  setMove(mx, my) {
    mx = num(mx, 0);
    my = num(my, 0);
    let mag = Math.hypot(mx, my);
    if (mag > 1) {
      mx /= mag;
      my /= mag;
      mag = 1;
    }
    this.moveX = mx;
    this.moveY = my;
    this.moveMag = mag;
    if (mag > 1e-9) {
      this.moveUX = mx / mag;
      this.moveUY = my / mag;
    }
  }

  // The Interact button: gather the nearest ready node in reach (needed or not), or deposit at the
  // Workshop. Returns 'gather' | 'deposit' | null.
  interact() {
    if (this.phase !== 'race') return null;
    const a = this.player;
    if (a.state === 'gather' || a.state === 'deposit') return null;
    const n = this.nodeInReach(a, null, true);
    if (n) {
      if (a.bag.length >= this.bagSizeFor('player')) {
        this.emit({ type: 'bagFull', full: true });
        return null;
      }
      this.stopPath(a);
      if (a.free) a.aim = n.id;
      this.startGather(a, n);
      return 'gather';
    }
    if (a.bag.length && this.nearWorkshop(a)) {
      this.stopPath(a);
      this.startDeposit(a);
      return 'deposit';
    }
    return null;
  }

  // What interact() would do right now, without doing it (lights up the Interact button).
  canInteract() {
    if (this.phase !== 'race') return null;
    const a = this.player;
    if (a.state === 'gather' || a.state === 'deposit') return null;
    if (this.nodeInReach(a, null, true)) return a.bag.length < this.bagSizeFor('player') ? 'gather' : null;
    return a.bag.length && this.nearWorkshop(a) ? 'deposit' : null;
  }

  // The node the player is going for: the tap destination, or in free mode the inferred aim.
  playerTarget() {
    const a = this.player;
    if (a.free) return a.aim;
    return a.dest && a.dest.kind === 'node' ? a.dest.id : null;
  }

  // A fresh stick push takes over from tap control (never in the middle of gathering or depositing).
  updateControl() {
    const a = this.player;
    if (this.moveMag <= MOVE_DEADZONE) this.stickLatch = false;
    else if (!a.free && !this.stickLatch && a.state !== 'gather' && a.state !== 'deposit') {
      this.stopPath(a);
      a.free = true;
      a.dx = 0;
      a.dy = 0;
      if (a.state === 'walk' || a.state === 'wait') a.state = 'idle';
    }
  }

  // Back to tap control (a tap, HOME, or the automatic walk home).
  leaveFree(a) {
    a.free = false;
    a.aim = null;
    if (this.moveMag > MOVE_DEADZONE) this.stickLatch = true;
  }

  // Drop any tap path; an agent between two tiles stops exactly where it is.
  stopPath(a) {
    if (a.to) {
      a.px = a.fx;
      a.py = a.fy;
      a.to = null;
      a.t = 0;
      a.x = Math.round(a.px);
      a.y = Math.round(a.py);
    }
    a.dest = null;
    a.queued = null;
  }

  place(a, x, y) {
    a.x = x;
    a.y = y;
    a.px = x;
    a.py = y;
  }

  // ------------------------------------------------------------ the player's choice context
  buildCtx() {
    const a = this.player;
    const need = this.needRemaining('player');
    if (a.bag.length >= this.bagSizeFor('player') || !sumVals(need)) {
      this.ctx = null;
      return;
    }
    const here = idx(a.x, a.y);
    const cands = [];
    for (const n of this.world.nodes) {
      if (!need[n.type]) continue;
      if (!(this.nodeReady(n) || (!n.reserved && n.readyAt - this.time < 2))) continue;
      const dist = this.world.nodeField[n.id][here];
      if (dist < 0) continue;
      cands.push({ id: n.id, type: n.type, dist, region: regionOf(n.x, n.y), side: sideOf(n.x) });
    }
    if (!cands.length) {
      this.ctx = null;
      return;
    }
    for (const c of cands) c.rank = cands.filter((o) => o.dist < c.dist).length;
    const firstType = this.firstCardNeed('player');
    const ctx = {
      cands,
      firstType,
      prevType: this.prevType,
      bookable: cands.some((c) => c.type === firstType) && cands.some((c) => c.type !== firstType),
      // Where this choice starts: the path tile, or the exact spot when not between tiles.
      fromX: a.to ? a.x : a.fx,
      fromY: a.to ? a.y : a.fy,
    };
    this.model.predict(ctx);
    ctx.habit = this.model.mixture(ctx, this.experts);
    this.ctx = ctx;
  }

  // Rival's belief about which node the player goes to next: habits x current walking direction.
  updatePrediction() {
    const ctx = this.ctx;
    if (!ctx || this.blind) {
      this.pred = null;
      return;
    }
    const a = this.player;
    const px = a.fx;
    const py = a.fy;
    const mx = px - ctx.fromX;
    const my = py - ctx.fromY;
    const moved = Math.hypot(mx, my);
    const k = this.rivalDef.heading * 2.5;
    const head = ctx.cands.map((c) => {
      if (moved < 0.5 || k === 0) return 1;
      const n = this.world.nodes[c.id];
      const vx = n.x - px;
      const vy = n.y - py;
      const d = Math.hypot(vx, vy) || 1;
      return Math.exp((k * (mx * vx + my * vy)) / (moved * d));
    });
    const hs = head.reduce((s, v) => s + v, 0);
    const joint = ctx.cands.map((c, i) => ctx.habit[i] * head[i]);
    const js = joint.reduce((s, v) => s + v, 0);
    this.pred = new Map();
    ctx.cands.forEach((c, i) => this.pred.set(c.id, { p: joint[i] / js, habit: ctx.habit[i], head: head[i] / hs, i }));
  }

  // ------------------------------------------------------------ the rival's mind
  rivalChoose() {
    const a = this.rival;
    const def = this.rivalDef;
    const need = this.needRemaining('rival');
    const totalNeed = sumVals(need);
    if (a.bag.length >= this.bagSizeFor('rival') || (totalNeed === 0 && a.bag.length)) return { kind: 'hub', score: 1e9 };
    const from = a.to ? idx(a.to.x, a.to.y) : idx(a.x, a.y);
    const extra = a.to ? (1 - a.t) / a.speed : 0;
    const pHere = idx(this.player.to ? this.player.to.x : this.player.x, this.player.to ? this.player.to.y : this.player.y);
    let best = null;
    for (const n of this.world.nodes) {
      if (n.reserved && n.reserved !== 'rival') continue;
      const dR = this.world.nodeField[n.id][from];
      if (dR < 0) continue;
      const tR = dR / a.speed + extra;
      const wait = Math.max(0, n.readyAt - (this.time + tR));
      if (wait > 3) continue;
      const useful = need[n.type] ? 1 : 0;
      const pr = this.pred ? this.pred.get(n.id) : null;
      const pP = pr ? pr.p : 0;
      // Only an INFORMED read counts: belief above what a uniform guess over your options would give.
      // A rival with no knowledge of you therefore never goes out of its way to take a resource from you.
      const nC = this.pred ? this.pred.size : 1;
      const informed = nC > 1 ? Math.max(0, (pP - 1 / nC) / (1 - 1 / nC)) : 0;
      const dP = this.world.nodeField[n.id][pHere];
      const tP = dP < 0 ? 99 : dP / this.player.speed;
      const beat = 1 / (1 + Math.exp(-(tP - tR - wait) / 0.45));
      const steal = informed * beat * (useful ? def.steal : def.deny);
      if (!useful && steal < 0.08) continue;
      const score = (useful + steal) / (tR + wait + 0.8);
      if (!best || score > best.score) best = { kind: 'node', id: n.id, score, pP, steal, useful, pr, ctx: this.ctx };
    }
    if (!best) return a.bag.length ? { kind: 'hub', score: 1e9 } : { kind: 'idle', score: 0 };
    return best;
  }

  updateRival(dt) {
    const a = this.rival;
    if (a.state === 'gather' || a.state === 'deposit') return;
    if (a.state === 'think') {
      a.timer -= dt;
      if (a.timer > 0) return;
      a.state = 'idle';
    }
    this.rivalReplan -= dt;
    if ((a.state === 'walk' || a.state === 'wait') && this.rivalReplan > 0) return;
    this.rivalReplan = 0.25;
    const c = this.rivalChoose();
    const cur = this.rivalIntent;
    const same = cur && cur.kind === c.kind && cur.id === c.id;
    const curValid = cur && cur.kind === 'node' && a.dest && a.dest.kind === 'node' && !(this.world.nodes[cur.id].reserved === 'player');
    if (!same && curValid && a.state === 'walk' && c.score < cur.score * 1.25) return;
    this.rivalIntent = { ...c, at: this.time };
    if (c.kind === 'node') a.dest = { kind: 'node', id: c.id };
    else if (c.kind === 'hub') a.dest = { kind: 'hub' };
    else a.dest = null;
    if (a.dest && a.state !== 'walk') a.state = 'walk';
  }

  // ------------------------------------------------------------ agent mechanics
  moveAgent(a, dt) {
    if (a.state === 'gather' || a.state === 'deposit') {
      a.timer -= dt;
      if (a.timer <= 0) a.state === 'gather' ? this.finishGather(a) : this.finishDeposit(a);
      return;
    }
    if (a.state === 'think') return;
    if (a.free) {
      this.moveFree(a, dt);
      return;
    }
    if (a.state === 'wait') {
      if (!a.dest || a.dest.kind !== 'node') a.state = 'walk';
      else {
        const n = this.world.nodes[a.dest.id];
        const f = this.world.nodeField[n.id];
        if (f[idx(a.x, a.y)] !== 0) a.state = 'walk'; // target changed while waiting
        else {
          if (this.nodeReady(n)) this.startGather(a, n);
          return;
        }
      }
    }
    let remaining = dt;
    let guard = 0;
    while (remaining > 1e-9 && guard++ < 8) {
      if (!a.to) {
        if (!a.dest) {
          a.state = 'idle';
          return;
        }
        const step = nextStep(this.world, this.fieldFor(a.dest), a.x, a.y, a.dx, a.dy);
        if (!step) {
          this.arrive(a);
          return;
        }
        a.to = { x: step.x, y: step.y };
        // Normally a whole tile from centre to centre; after free movement the first leg starts at
        // the exact position (still inside the start tile, so it only crosses walkable tiles).
        a.ox = a.px;
        a.oy = a.py;
        a.len = a.px === a.x && a.py === a.y ? 1 : Math.hypot(step.x - a.px, step.y - a.py);
        a.dx = step.dx;
        a.dy = step.dy;
        if (step.dx) a.faceX = step.dx;
        a.t = 0;
        a.state = 'walk';
      }
      const need = ((1 - a.t) * a.len) / a.speed;
      if (remaining >= need) {
        remaining -= need;
        this.place(a, a.to.x, a.to.y);
        a.to = null;
        a.t = 0;
      } else {
        a.t += (remaining * a.speed) / a.len;
        remaining = 0;
      }
    }
  }

  // Free (analog) movement for one step: slide with the stick, then work out the aim and the automatic
  // gather / deposit. No allocations here: it runs every frame.
  moveFree(a, dt) {
    const need = this.needInto('player', this.freeNeed);
    const pushing = this.moveMag > MOVE_DEADZONE;
    let moved = false;
    const dist = Math.min(a.speed * this.moveMag * dt, MAX_STEP_DIST);
    if (pushing && dist > 0) {
      const n = Math.ceil(dist / MAX_SUBSTEP);
      // The sub-step goes through fields, not arguments: V8 boxes (allocates) doubles passed to calls.
      this.subX = (this.moveUX * dist) / n;
      this.subY = (this.moveUY * dist) / n;
      const x0 = a.px;
      const y0 = a.py;
      // Axis-separated: slide along x, then along y, so blocked motion on one axis keeps the other.
      for (let i = 0; i < n; i++) {
        this.slide(a, true);
        this.slide(a, false);
      }
      a.x = Math.round(a.px);
      a.y = Math.round(a.py);
      if (this.moveUX > 0.2 || this.moveUX < -0.2) a.faceX = this.moveUX > 0 ? 1 : -1;
      moved = (a.px - x0) * (a.px - x0) + (a.py - y0) * (a.py - y0) > 1e-12;
    }
    this.updateAim(a, need, pushing);
    if (a.bag.length && this.nearWorkshop(a)) {
      this.startDeposit(a);
      return;
    }
    const room = a.bag.length < this.bagSizeFor('player');
    if (room) {
      const n = this.nodeInReach(a, need, true);
      if (n) {
        a.aim = n.id;
        this.startGather(a, n);
        return;
      }
    }
    // Standing next to a needed node that is regrowing (or being gathered): wait for it.
    if (moved) a.state = 'walk';
    else a.state = room && this.nodeInReach(a, need, false) ? 'wait' : 'idle';
  }

  // Move the collision circle one sub-step along x (or y) and push it out of every blocked tile it
  // overlaps, along the shortest way out: straight back from a wall face, around a corner.
  // Out-of-bounds counts as blocked.
  slide(a, alongX) {
    const x0 = a.px;
    const y0 = a.py;
    if (alongX) a.px += this.subX;
    else a.py += this.subY;
    const w = this.world;
    const r2 = PLAYER_RADIUS * PLAYER_RADIUS;
    for (let iter = 0; iter < 3; iter++) {
      let hit = false;
      const cx = Math.round(a.px);
      const cy = Math.round(a.py);
      for (let ty = cy - 1; ty <= cy + 1; ty++) {
        for (let tx = cx - 1; tx <= cx + 1; tx++) {
          if (isWalkable(w, tx, ty)) continue;
          const ex = a.px - Math.max(tx - 0.5, Math.min(a.px, tx + 0.5));
          const ey = a.py - Math.max(ty - 0.5, Math.min(a.py, ty + 0.5));
          const d2 = ex * ex + ey * ey;
          if (d2 >= r2) continue;
          hit = true;
          if (d2 > 1e-12) {
            const d = Math.sqrt(d2);
            const k = (PLAYER_RADIUS + SKIN - d) / d;
            a.px += ex * k;
            a.py += ey * k;
          } else {
            // Centre on or inside the box (only after a tap path cut a corner): leave by the nearest face.
            const l = a.px - (tx - 0.5);
            const rt = tx + 0.5 - a.px;
            const u = a.py - (ty - 0.5);
            const dn = ty + 0.5 - a.py;
            const m = Math.min(l, rt, u, dn);
            if (m === l) a.px = tx - 0.5 - PLAYER_RADIUS - SKIN;
            else if (m === rt) a.px = tx + 0.5 + PLAYER_RADIUS + SKIN;
            else if (m === u) a.py = ty - 0.5 - PLAYER_RADIUS - SKIN;
            else a.py = ty + 0.5 + PLAYER_RADIUS + SKIN;
          }
        }
      }
      if (!hit) break;
    }
    // Safety net: the centre never ends up in a blocked tile, whatever the geometry.
    if (!isWalkable(w, Math.round(a.px), Math.round(a.py))) {
      a.px = x0;
      a.py = y0;
    }
  }

  // Which node the free-moving player is heading for: the needed node (ready now or within AIM_SOON)
  // that best matches the stick direction inside a 40 degree cone, nearer (by path) and straighter
  // ahead scoring higher; otherwise a needed node the player is standing next to; otherwise none.
  // "Matches" means pointing straight at the node, or along a shortest-path step toward it, so a
  // player walking around an obstacle is still read correctly. A full bag aims at nothing.
  updateAim(a, need, pushing) {
    let best = null;
    if (a.bag.length >= this.bagSizeFor('player')) {
      a.aim = null;
      return;
    }
    if (pushing) {
      const w = this.world;
      const nodes = w.nodes;
      const here = idx(a.x, a.y);
      let bestS = 0;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (!need[n.type] || n.reserved || n.readyAt - this.time >= AIM_SOON) continue;
        const f = w.nodeField[n.id];
        const steps = f[here];
        if (steps < 0) continue;
        // Best cosine between the stick and the way to the node: k = -1 straight at it, k = 0..3 the
        // neighbouring tiles that are one step closer on its path.
        let c = -1;
        for (let k = -1; k < 4; k++) {
          let tx = n.x;
          let ty = n.y;
          if (k >= 0) {
            if (steps === 0) break;
            tx = a.x + DIRS4[k][0];
            ty = a.y + DIRS4[k][1];
            if (!isWalkable(w, tx, ty)) continue;
            const d = f[idx(tx, ty)];
            if (d < 0 || d >= steps) continue;
          }
          const vx = tx - a.px;
          const vy = ty - a.py;
          const len = Math.sqrt(vx * vx + vy * vy);
          if (len > 1e-6) c = Math.max(c, (vx * this.moveUX + vy * this.moveUY) / len);
        }
        if (c < AIM_COS) continue;
        let s = (c - AIM_COS) / (1 - AIM_COS) / (steps + 2);
        if (n.id === a.aim) s *= AIM_STICKY;
        if (s > bestS) {
          bestS = s;
          best = n;
        }
      }
    }
    if (!best) best = this.nodeInReach(a, need, false);
    a.aim = best ? best.id : null;
  }

  arrive(a) {
    const d = a.dest;
    if (d.kind === 'node') {
      const n = this.world.nodes[d.id];
      if (this.nodeReady(n)) this.startGather(a, n);
      else {
        a.state = 'wait';
        if (a.who === 'rival') this.rivalReplan = 0;
      }
    } else if (d.kind === 'hub') {
      if (a.bag.length) this.startDeposit(a);
      else {
        a.state = 'idle';
        a.dest = null;
      }
    } else {
      a.state = 'idle';
      a.dest = null;
    }
  }

  startDeposit(a) {
    a.state = 'deposit';
    a.timer = DEPOSIT_TIME;
  }

  startGather(a, n) {
    if (a.bag.length >= this.bagSizeFor(a.who)) {
      a.state = 'idle';
      a.dest = null;
      if (a.who === 'player') this.emit({ type: 'bagFull', full: true });
      return;
    }
    n.reserved = a.who;
    a.state = 'gather';
    a.timer = GATHER_TIME;
    a.gatherNode = n.id;
    if (a.who === 'rival') {
      const p = this.player;
      // What the player is going for: the tapped node, or in free mode the node it is walking toward.
      const target = p.free ? p.aim === n.id : p.dest && p.dest.kind === 'node' && p.dest.id === n.id;
      const playerWanted = target && (p.state === 'walk' || p.state === 'wait');
      if (playerWanted) {
        this.stats.snatched++;
        this.emit({ type: 'snatch', node: n, text: this.snatchReason(n) });
        // The rival saw where you were going, so that choice still counts as evidence about you.
        if (this.ctx) {
          const i = this.ctx.cands.findIndex((c) => c.id === n.id);
          if (i >= 0) this.model.observe(this.ctx, i);
        }
        // Don't leave the player standing at an empty node: stop them so they can pick another.
        p.dest = null;
        p.queued = null;
        p.aim = null;
        if (p.state === 'wait') p.state = 'idle';
        this.ctx = null;
      }
    } else {
      const r = this.rival;
      if (r.dest && r.dest.kind === 'node' && r.dest.id === n.id && r.state === 'walk' && this.needRemaining('rival')[n.type]) {
        this.stats.outread++;
        this.emit({ type: 'outread', node: n });
        this.addScore(SCORE.outread, 'outread');
      }
    }
  }

  // Honest explanation of a snatch, from the evidence the rival actually used.
  snatchReason(n) {
    const def = this.rivalDef;
    const intent = this.rivalIntent && this.rivalIntent.id === n.id ? this.rivalIntent : null;
    const pr = intent && intent.pr;
    if (!pr || (!def.experts.length && !def.heading) || intent.steal < 0.02) {
      return { kind: 'luck', text: `${def.name} needed it too and got there first.` };
    }
    const ctx = intent.ctx || this.ctx;
    const nC = ctx ? ctx.cands.length : 3;
    if (pr.head > pr.habit * 1.3 && pr.head > 1 / nC) {
      return { kind: 'heading', text: `${def.name} saw which way you were walking. Pick one it can't reach first.` };
    }
    if (pr.habit >= 0.35 && ctx) {
      const ex = this.model.explain(ctx, pr.i, this.experts);
      // Every read comes with a way to beat it next time.
      const counter = { beeline: ' Try a farther one.', turf: ' Try another part of the island.', book: ' Grab things out of card order.', routine: ' Mix up what you grab next.', side: ' Try the other side.' };
      if (ex) return { kind: 'habit', habit: ex.id, text: `${def.name} predicted you. ${ex.text}${counter[ex.id] || ''}` };
    }
    return { kind: 'luck', text: `Lucky guess. ${def.name} only gave that node ${Math.round(pr.p * 100)}%.` };
  }

  finishGather(a, silent = false) {
    const n = this.world.nodes[a.gatherNode];
    // Score only gathers the order needed, so farming spare resources earns nothing.
    const useful = a.who === 'player' && !silent && !!this.needRemaining('player')[n.type];
    n.reserved = null;
    n.readyAt = this.time + n.respawn * this.respawnMul;
    a.bag.push(n.type);
    a.gatherNode = null;
    a.state = 'idle';
    a.dest = null;
    if (a.who === 'player') {
      this.stats.gathers++;
      // FAKED OUT: the rival committed to the node it was sure you wanted, and you took another one.
      const ri = this.rivalIntent;
      if (!silent && ri && ri.kind === 'node' && ri.id !== n.id && ri.pr && ri.pr.p >= 0.4 && ri.steal > 0.15 && this.time - this.lastFooled > 5) {
        this.lastFooled = this.time;
        this.stats.fooled++;
        this.emit({ type: 'fooled', node: this.world.nodes[ri.id], p: ri.pr.p });
        this.addScore(SCORE.fooled, 'fooled');
      }
      if (this.ctx) {
        const i = this.ctx.cands.findIndex((c) => c.id === n.id);
        if (i >= 0) {
          // How often the rival's top guess (before you moved) was right, vs a uniform guess.
          if (this.ctx.cands.length > 1) {
            const h = this.ctx.habit;
            this.stats.predN++;
            this.stats.predHits += h.indexOf(Math.max(...h)) === i ? 1 : 0;
            this.stats.predChance += 1 / this.ctx.cands.length;
          }
          this.model.observe(this.ctx, i);
        }
      }
      this.prevType = n.type;
      this.ctx = null;
    } else {
      this.stats.rivalGathers++;
      a.state = 'think';
      a.timer = this.rivalDef.think;
    }
    if (!silent) this.emit({ type: 'gather', who: a.who, node: n, res: n.type });
    if (useful) this.addScore(SCORE.gather, 'gather');
    if (!silent) this.afterAction(a);
  }

  finishDeposit(a, silent = false) {
    const b = this.bench[a.who];
    const items = a.bag.slice();
    for (const r of a.bag) b.raw[r] = (b.raw[r] || 0) + 1;
    a.bag = [];
    a.state = 'idle';
    a.dest = null;
    if (a.who === 'player') {
      this.stats.trips++;
      this.homeHinted = false;
    } else {
      a.state = 'think';
      a.timer = this.rivalDef.think;
    }
    if (silent) return;
    this.emit({ type: 'deposit', who: a.who, items });
    this.craftCheck(a.who);
    if (this.phase === 'race') this.afterAction(a);
  }

  afterAction(a) {
    if (a.who !== 'player') return;
    if (a.queued) {
      a.dest = a.queued;
      a.queued = null;
      a.state = 'walk';
    } else if (a.bag.length >= this.bagSizeFor('player') || (a.bag.length && !sumVals(this.needRemaining('player')))) {
      const full = a.bag.length >= this.bagSizeFor('player');
      if (a.free && !this.options.autoReturn) {
        // Free mode: no automatic walk; tell the player once per load (the HOME button runs there).
        if (!this.homeHinted) {
          this.homeHinted = true;
          this.emit({ type: 'bagFull', full });
        }
      } else {
        // Bag full, or everything gathered: head home automatically.
        if (a.free) this.leaveFree(a);
        a.dest = { kind: 'hub' };
        a.state = 'walk';
        this.emit({ type: 'autoReturn', full });
      }
    }
    this.buildCtx();
  }

  // ------------------------------------------------------------ main step
  step(dt) {
    this.time += dt;
    const p = this.player;
    const r = this.rival;
    if (this.phase !== 'race') p.vx = p.vy = r.vx = r.vy = 0;
    if (this.phase === 'intro') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.phase = 'race';
        this.goTime = this.time;
        this.emit({ type: 'go', index: this.orderIndex });
        this.craftCheck('player');
        if (this.phase === 'race') this.craftCheck('rival');
        if (this.phase !== 'race') return;
        r.state = 'think';
        r.timer = this.rivalDef.think + 0.25 + this.options.rivalDelay;
        this.buildCtx();
      }
      return;
    }
    if (this.phase === 'orderEnd') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        const done = this.stars.player >= this.starsToWin || this.stars.rival >= this.starsToWin || this.orderIndex >= this.orders.length - 1;
        if (done) this.finish(false);
        else this.startOrder(this.orderIndex + 1);
      }
      return;
    }
    if (this.phase !== 'race') return;
    this.raceTime += dt;
    if (this.timeLimit && this.raceTime >= this.timeLimit) {
      this.finish(true);
      return;
    }
    this.updateControl();
    if (!this.ctx && p.state !== 'gather' && p.state !== 'deposit') this.buildCtx();
    this.updatePrediction();
    this.moveTracked(p, dt);
    if (this.phase !== 'race') {
      p.vx = p.vy = r.vx = r.vy = 0;
      return;
    }
    this.updateRival(dt);
    this.moveTracked(r, dt);
    if (this.phase !== 'race') p.vx = p.vy = r.vx = r.vy = 0;
  }

  // moveAgent, plus the agent's velocity over the step (for animation).
  moveTracked(a, dt) {
    const x0 = a.fx;
    const y0 = a.fy;
    this.moveAgent(a, dt);
    a.vx = dt > 0 ? (a.fx - x0) / dt : 0;
    a.vy = dt > 0 ? (a.fy - y0) / dt : 0;
  }

  emit(e) {
    e.t = this.time;
    this.events.push(e);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  summary() {
    const tells = {};
    for (const id of ['beeline', 'turf', 'book', 'routine', 'side']) tells[id] = this.model.matchTell(id);
    return {
      winner: this.stars.player > this.stars.rival ? 'player' : 'rival',
      stars: { ...this.stars },
      rival: this.rivalDef.id,
      results: this.results.slice(),
      crafted: this.results.filter((r) => r.winner === 'player').map((r) => r.item),
      stats: { ...this.stats },
      seconds: this.time,
      raceSeconds: this.raceTime,
      tells,
      score: this.score,
      timeUp: this.timeUp,
      options: { ...this.options, orders: this.options.orders && this.options.orders.slice() },
    };
  }
}

// Level and booster options with defaults; bad values fall back to the defaults.
function normalizeOptions(o) {
  o = o || {};
  const orders = Array.isArray(o.orders) ? o.orders.filter((id) => ITEM_BY_ID[id]) : [];
  const stw = Math.floor(num(o.starsToWin, STARS_TO_WIN));
  const tl = num(o.timeLimit, 0);
  const mul = num(o.playerSpeedMul, 1);
  return {
    orders: orders.length ? orders : null,
    starsToWin: stw >= 1 ? stw : STARS_TO_WIN,
    timeLimit: tl > 0 ? tl : null,
    playerSpeedMul: mul > 0 ? mul : 1,
    playerBagBonus: Math.max(0, Math.floor(num(o.playerBagBonus, 0))),
    rivalDelay: Math.max(0, num(o.rivalDelay, 0)),
    blindOrders: Math.max(0, Math.floor(num(o.blindOrders, 0))),
    autoReturn: !!o.autoReturn,
  };
}
