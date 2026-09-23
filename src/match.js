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

import { generateIsland, idx, nextStep, tileField, regionOf, sideOf } from './world.js';
import { COMPONENTS, ITEMS, PLAYER_SPEED, GATHER_TIME, DEPOSIT_TIME, BAG_SIZE, STARS_TO_WIN } from './data.js';
import { mulberry32 } from './rng.js';

const sumVals = (o) => Object.values(o).reduce((a, b) => a + b, 0);

class Agent {
  constructor(who, spawn, speed) {
    this.who = who;
    this.x = spawn.x;
    this.y = spawn.y;
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
  }
  get fx() {
    return this.to ? this.x + (this.to.x - this.x) * this.t : this.x;
  }
  get fy() {
    return this.to ? this.y + (this.to.y - this.y) * this.t : this.y;
  }
}

export class Match {
  constructor({ seed, rival, model, twist = null, rng = null, enabledExperts = null }) {
    this.seed = seed;
    this.rng = rng || mulberry32((seed ^ 0x5bd1e995) >>> 0);
    this.world = generateIsland(seed);
    this.rivalDef = rival;
    this.model = model;
    this.twist = twist || {};
    this.experts = enabledExperts || rival.experts;
    const speedMul = this.twist.speedMul || 1;
    this.respawnMul = this.twist.respawnMul || 1;
    this.bagSize = this.twist.bag || BAG_SIZE;
    this.player = new Agent('player', this.world.spawn.player, PLAYER_SPEED * speedMul);
    this.rival = new Agent('rival', this.world.spawn.rival, rival.speed * speedMul * (this.twist.rivalSpeedMul || 1));
    this.bench = { player: { raw: {}, made: [] }, rival: { raw: {}, made: [] } };
    this.stars = { player: 0, rival: 0 };
    this.orders = this.pickOrders();
    this.orderIndex = -1;
    this.results = [];
    this.phase = 'intro';
    this.phaseTimer = 0;
    this.time = 0;
    this.events = [];
    this.stats = { snatched: 0, outread: 0, fooled: 0, gathers: 0, rivalGathers: 0, trips: 0, predN: 0, predHits: 0, predChance: 0 };
    this.lastFooled = -99;
    this.ctx = null;
    this.pred = null;
    this.prevType = null;
    this.rivalIntent = null;
    this.rivalReplan = 0;
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

  startOrder(i) {
    this.orderIndex = i;
    for (const who of ['player', 'rival']) this.bench[who].made = this.order.parts.map(() => false);
    this.phase = 'intro';
    this.phaseTimer = i === 0 ? 2.6 : 1.4;
    this.prevType = null;
    this.ctx = null;
    this.pred = null;
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
  }

  // Freeze an agent cleanly between orders: finish half-done actions, snap to a tile.
  settle(a) {
    if (a.state === 'gather') this.finishGather(a, true);
    if (a.state === 'deposit') this.finishDeposit(a, true);
    if (a.to) {
      a.x = a.to.x;
      a.y = a.to.y;
      a.to = null;
      a.t = 0;
    }
    a.dest = null;
    a.queued = null;
    a.state = 'idle';
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

  // ------------------------------------------------------------ player input
  // Tap/click on a tile: walk to a node (and gather it), to the Workshop (deposit), or to a free tile.
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
    if (a.state === 'gather' || a.state === 'deposit') a.queued = dest;
    else {
      a.dest = dest;
      if (a.state === 'wait' || a.state === 'idle') a.state = 'walk';
    }
    return dest;
  }

  // ------------------------------------------------------------ the player's choice context
  buildCtx() {
    const a = this.player;
    const need = this.needRemaining('player');
    if (a.bag.length >= this.bagSize || !sumVals(need)) {
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
      fromX: a.x,
      fromY: a.y,
    };
    this.model.predict(ctx);
    ctx.habit = this.model.mixture(ctx, this.experts);
    this.ctx = ctx;
  }

  // Rival's belief about which node the player goes to next: habits x current walking direction.
  updatePrediction() {
    const ctx = this.ctx;
    if (!ctx) {
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
    if (a.bag.length >= this.bagSize || (totalNeed === 0 && a.bag.length)) return { kind: 'hub', score: 1e9 };
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
        a.dx = step.dx;
        a.dy = step.dy;
        if (step.dx) a.faceX = step.dx;
        a.t = 0;
        a.state = 'walk';
      }
      const need = (1 - a.t) / a.speed;
      if (remaining >= need) {
        remaining -= need;
        a.x = a.to.x;
        a.y = a.to.y;
        a.to = null;
        a.t = 0;
      } else {
        a.t += remaining * a.speed;
        remaining = 0;
      }
    }
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
      if (a.bag.length) {
        a.state = 'deposit';
        a.timer = DEPOSIT_TIME;
      } else {
        a.state = 'idle';
        a.dest = null;
      }
    } else {
      a.state = 'idle';
      a.dest = null;
    }
  }

  startGather(a, n) {
    if (a.bag.length >= this.bagSize) {
      a.state = 'idle';
      a.dest = null;
      if (a.who === 'player') this.emit({ type: 'bagFull' });
      return;
    }
    n.reserved = a.who;
    a.state = 'gather';
    a.timer = GATHER_TIME;
    a.gatherNode = n.id;
    if (a.who === 'rival') {
      const p = this.player;
      const playerWanted = p.dest && p.dest.kind === 'node' && p.dest.id === n.id && (p.state === 'walk' || p.state === 'wait');
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
        if (p.state === 'wait') p.state = 'idle';
        this.ctx = null;
      }
    } else {
      const r = this.rival;
      if (r.dest && r.dest.kind === 'node' && r.dest.id === n.id && r.state === 'walk' && this.needRemaining('rival')[n.type]) {
        this.stats.outread++;
        this.emit({ type: 'outread', node: n });
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
    if (!silent) this.afterAction(a);
  }

  finishDeposit(a, silent = false) {
    const b = this.bench[a.who];
    const items = a.bag.slice();
    for (const r of a.bag) b.raw[r] = (b.raw[r] || 0) + 1;
    a.bag = [];
    a.state = 'idle';
    a.dest = null;
    if (a.who === 'player') this.stats.trips++;
    else {
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
    } else if (a.bag.length >= this.bagSize || (a.bag.length && !sumVals(this.needRemaining('player')))) {
      // Bag full, or everything gathered: head home automatically.
      a.dest = { kind: 'hub' };
      a.state = 'walk';
      this.emit({ type: 'autoReturn', full: a.bag.length >= this.bagSize });
    }
    this.buildCtx();
  }

  // ------------------------------------------------------------ main step
  step(dt) {
    this.time += dt;
    if (this.phase === 'intro') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.phase = 'race';
        this.emit({ type: 'go', index: this.orderIndex });
        this.craftCheck('player');
        if (this.phase === 'race') this.craftCheck('rival');
        if (this.phase !== 'race') return;
        this.rival.state = 'think';
        this.rival.timer = this.rivalDef.think + 0.25;
        this.buildCtx();
      }
      return;
    }
    if (this.phase === 'orderEnd') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        const done = this.stars.player >= STARS_TO_WIN || this.stars.rival >= STARS_TO_WIN || this.orderIndex >= this.orders.length - 1;
        if (done) {
          this.phase = 'end';
          this.model.endMatch();
          this.emit({ type: 'matchEnd', winner: this.stars.player > this.stars.rival ? 'player' : 'rival' });
        } else this.startOrder(this.orderIndex + 1);
      }
      return;
    }
    if (this.phase !== 'race') return;
    if (!this.ctx && this.player.state !== 'gather' && this.player.state !== 'deposit') this.buildCtx();
    this.updatePrediction();
    this.moveAgent(this.player, dt);
    if (this.phase !== 'race') return;
    this.updateRival(dt);
    this.moveAgent(this.rival, dt);
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
      tells,
    };
  }
}
