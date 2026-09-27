// Invariant tests for OUTCRAFT.   node tools/test.mjs
import assert from 'node:assert/strict';
import { generateIsland, idx, nextStep, isWalkable } from '../src/world.js';
import { Match, PLAYER_RADIUS, REACH } from '../src/match.js';
import { PlayerModel, HABIT_IDS } from '../src/model.js';
import { RIVALS, RES, RES_IDS, ITEMS, COMPONENTS, PLAYER_SPEED, SCORE } from '../src/data.js';
import { recordMatch, shareText, todaysDaily } from '../src/storage.js';
import { mulberry32, dayNumber } from '../src/rng.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const HUB = { x: 4, y: 10 };

function greedy(m) {
  const p = m.player;
  const need = m.needRemaining('player');
  if (p.bag.length >= m.bagSize || (p.bag.length && !sum(need))) return HUB;
  const here = idx(p.x, p.y);
  const c = m.world.nodes
    .filter((n) => need[n.type] && !n.reserved && n.readyAt - m.time < 1.5)
    .sort((a, b) => m.world.nodeField[a.id][here] - m.world.nodeField[b.id][here]);
  return c[0] || (p.bag.length ? HUB : null);
}

function playMatch(seed, rival, model, onEvent = null, options = null) {
  const m = new Match({ seed, rival, model, options });
  let t = 0;
  const log = [];
  while (m.phase !== 'end' && t < 400) {
    if (m.phase === 'race' && m.player.state === 'idle' && !m.player.dest) {
      const g = greedy(m);
      if (g) {
        m.command(g.x, g.y);
        log.push(`${m.time.toFixed(3)}:${g.x},${g.y}`);
      }
    }
    m.step(1 / 60);
    for (const e of m.drainEvents()) if (onEvent) onEvent(e, m);
    t += 1 / 60;
  }
  return { m, t, log };
}

test('every island (300 seeds): right node counts; all nodes and the Workshop reachable from both spawns', () => {
  for (let s = 0; s < 300; s++) {
    const w = generateIsland(s * 7919 + 1);
    for (const r of RES_IDS) assert.equal(w.nodes.filter((n) => n.type === r).length, RES[r].nodes);
    for (const sp of [w.spawn.player, w.spawn.rival]) {
      const i = idx(sp.x, sp.y);
      assert.ok(w.hubField[i] >= 0);
      for (const n of w.nodes) assert.ok(w.nodeField[n.id][i] >= 0, `seed ${s} node ${n.id}`);
    }
  }
});

test('every recipe is craftable from the six raw resources', () => {
  for (const it of ITEMS) for (const p of it.parts) for (const r of COMPONENTS[p].needs) assert.ok(RES_IDS.includes(r));
});

test('matches always finish (5 rivals x 40 islands, greedy bot), first to 3 stars', () => {
  for (const rival of RIVALS) {
    const model = new PlayerModel();
    for (let s = 0; s < 40; s++) {
      const { m, t } = playMatch(100 + s, rival, model);
      assert.equal(m.phase, 'end', `${rival.id} seed ${s} stuck at t=${t}`);
      assert.equal(Math.max(m.stars.player, m.stars.rival), 3);
    }
  }
});

test('the Workshop crafts components from exact materials and completes the order', () => {
  const m = new Match({ seed: 42, rival: RIVALS[0], model: new PlayerModel() });
  m.step(3);
  assert.equal(m.phase, 'race');
  const b = m.bench.player;
  for (const p of m.order.parts) for (const r of COMPONENTS[p].needs) b.raw[r] = (b.raw[r] || 0) + 1;
  m.craftCheck('player');
  assert.equal(m.stars.player, 1);
  assert.equal(sum(b.raw), 0, 'materials consumed exactly');
});

test('same seed + same inputs = same match (Daily Commission fairness)', () => {
  const a = playMatch(777, RIVALS[2], new PlayerModel());
  const b = playMatch(777, RIVALS[2], new PlayerModel());
  assert.deepEqual(a.log, b.log);
  assert.deepEqual(a.m.stars, b.m.stars);
});

// Synthetic choice situations for model tests.
function ctxFrom(rng) {
  const n = 2 + Math.floor(rng() * 5);
  const types = ['wood', 'sand', 'ore'];
  const cands = Array.from({ length: n }, (_, i) => ({
    id: i,
    type: types[Math.floor(rng() * 3)],
    dist: 1 + Math.floor(rng() * 8),
    region: Math.floor(rng() * 9),
    side: Math.floor(rng() * 3),
  }));
  cands.forEach((c) => (c.rank = cands.filter((o) => o.dist < c.dist).length));
  const firstType = cands[0].type;
  return {
    cands,
    firstType,
    prevType: types[Math.floor(rng() * 3)],
    bookable: cands.some((c) => c.type === firstType) && cands.some((c) => c.type !== firstType),
  };
}

test('honesty: random choosers are almost never accused of a habit (<6% of 300 players)', () => {
  let accused = 0;
  for (let p = 0; p < 300; p++) {
    const rng = mulberry32(p + 11);
    const model = new PlayerModel();
    for (let i = 0; i < 60; i++) {
      const c = ctxFrom(rng);
      model.predict(c);
      model.observe(c, Math.floor(rng() * c.cands.length));
    }
    if (model.dossier(3).length) accused++;
  }
  assert.ok(accused / 300 < 0.06, `accused ${accused}/300`);
});

test('a Beeline player is caught: the claim is made and the nearest option is predicted', () => {
  const rng = mulberry32(5);
  const model = new PlayerModel();
  for (let i = 0; i < 40; i++) {
    const c = ctxFrom(rng);
    model.predict(c);
    model.observe(c, c.cands.findIndex((k) => k.rank === 0));
  }
  assert.ok(model.dossier(3).some((d) => d.id === 'beeline'));
  const c = ctxFrom(rng);
  model.predict(c);
  const mix = model.mixture(c, HABIT_IDS);
  assert.equal(c.cands[mix.indexOf(Math.max(...mix))].rank, 0);
});

test('a player who AVOIDS the nearest node is never told they walk to the nearest one', () => {
  const rng = mulberry32(9);
  const model = new PlayerModel();
  for (let i = 0; i < 40; i++) {
    const c = ctxFrom(rng);
    model.predict(c);
    const far = c.cands.findIndex((k) => k.rank !== 0);
    model.observe(c, far >= 0 ? far : 0);
  }
  for (let i = 0; i < 40; i++) {
    const c = ctxFrom(rng);
    model.predict(c);
    for (let j = 0; j < c.cands.length; j++) {
      const ex = model.explain(c, j, HABIT_IDS);
      if (ex && ex.id === 'beeline') assert.ok(!ex.text.startsWith('You walk to the nearest'), ex.text);
    }
  }
  assert.ok(!model.dossier(3).some((d) => d.id === 'beeline' && d.text.startsWith('You always walk')));
});

test('snatch explanations never claim k > n; the apprentice PIP never claims to predict you', () => {
  const model = new PlayerModel();
  let snatches = 0;
  for (let s = 0; s < 60; s++) {
    const rival = RIVALS[s % 5];
    playMatch(500 + s, rival, model, (e) => {
      if (e.type !== 'snatch') return;
      snatches++;
      const k = e.text.text.match(/(\d+) of (\d+)/);
      if (k) assert.ok(+k[1] <= +k[2] && +k[2] > 0, e.text.text);
      if (rival.id === 'pip') assert.equal(e.text.kind, 'luck');
    });
  }
  assert.ok(snatches > 20, `only ${snatches} snatches seen`);
});

test('ladder unlock, codex and daily streak bookkeeping', () => {
  const st = {
    ladder: { unlocked: 0, beaten: {} },
    codex: {},
    dex: {},
    stats: { matches: 0, wins: 0, snatched: 0, outread: 0, history: [] },
    daily: { lastKey: null, streak: 0, best: 0, results: {} },
  };
  const tells = Object.fromEntries(HABIT_IDS.map((id) => [id, { n: 0, acc: 0, chance: 0 }]));
  const win = {
    winner: 'player',
    stars: { player: 3, rival: 1 },
    rival: 'pip',
    results: [{ item: 'torch', winner: 'player' }],
    crafted: ['torch'],
    stats: { snatched: 1, outread: 2, gathers: 9 },
    tells,
  };
  const r1 = recordMatch(st, win, { rivalIndex: 0 });
  assert.equal(r1.unlocked.id, 'wren');
  assert.deepEqual(r1.newItems, ['torch']);
  assert.deepEqual(recordMatch(st, win, { rivalIndex: 0 }).newItems, []);
  const day = (k) => ({ key: k, number: dayNumber(k), twist: { id: 'rush', name: 'Rush Hour' } });
  assert.equal(recordMatch(st, win, { daily: day('2026-09-23') }).dailyInfo.streak, 1);
  assert.equal(recordMatch(st, win, { daily: day('2026-09-24') }).dailyInfo.streak, 2);
  assert.equal(recordMatch(st, win, { daily: day('2026-09-24') }).dailyInfo, null);
  assert.equal(recordMatch(st, win, { daily: day('2026-09-28') }).dailyInfo.streak, 1);
});

test('share text and deterministic daily', () => {
  const txt = shareText({
    summary: { winner: 'player', stars: { player: 3, rival: 1 }, stats: { snatched: 2, outread: 3 }, results: [{ winner: 'player' }, { winner: 'rival' }, { winner: 'player' }, { winner: 'player' }] },
    daily: { number: 4, twist: { name: 'Rush Hour' } },
    rivalName: 'FOX',
    url: 'https://x',
  });
  assert.equal(txt.split('\n')[0], 'OUTCRAFT · Daily #4 (Rush Hour)');
  assert.ok(txt.includes('Out-crafted FOX 3–1'));
  assert.deepEqual(todaysDaily('2026-10-01'), todaysDaily('2026-10-01'));
});

// ---------------------------------------------------------------- free (analog) movement, options, score
const DT = 1 / 60;
const WALK_OK = (m, x, y) => isWalkable(m.world, x, y);

function toRace(m) {
  while (m.phase !== 'race') m.step(DT);
  m.drainEvents();
}
// Test-only: put an agent exactly at (x, y), off any path.
function teleport(a, x, y) {
  a.to = null;
  a.t = 0;
  a.px = x;
  a.py = y;
  a.x = Math.round(x);
  a.y = Math.round(y);
}
function steerAt(m, tx, ty) {
  const p = m.player;
  const dx = tx - p.fx;
  const dy = ty - p.fy;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) m.setMove(0, 0);
  else m.setMove(dx / d, dy / d);
}
// Steer like a person with a joystick: toward the next tile centre on the BFS field, and once next to
// the target, straight into it (tx, ty = the node or Workshop tile centre).
function steerAlong(m, field, tx, ty) {
  const p = m.player;
  const d = field[idx(p.x, p.y)];
  if (d < 0) return m.setMove(0, 0);
  if (d === 0) return steerAt(m, tx, ty);
  const s = nextStep(m.world, field, p.x, p.y);
  steerAt(m, s.x, s.y);
}
function nearestWorkshop(m) {
  const p = m.player;
  let best = null;
  for (const i of m.world.workshop) {
    const t = { x: i % 9, y: Math.floor(i / 9) };
    if (!best || Math.hypot(t.x - p.fx, t.y - p.fy) < Math.hypot(best.x - p.fx, best.y - p.fy)) best = t;
  }
  return best;
}
function steerHome(m) {
  const t = nearestWorkshop(m);
  steerAlong(m, m.world.hubField, t.x, t.y);
}
// The stick bot: greedy targets like the tap bot, but driven only through setMove.
function stickBot(m, rng = null) {
  const p = m.player;
  if (m.phase !== 'race') return m.setMove(0, 0);
  const w = m.world;
  const need = m.needRemaining('player');
  const here = idx(p.x, p.y);
  if (p.bag.length >= m.bagSizeFor('player') || (p.bag.length && !sum(need))) return steerHome(m);
  const c = w.nodes.filter((n) => need[n.type] && !n.reserved && n.readyAt - m.time < 1.5).sort((a, b) => w.nodeField[a.id][here] - w.nodeField[b.id][here]);
  const n = c.length > 1 && rng && rng() < 0.3 ? c[1] : c[0];
  if (n) return steerAlong(m, w.nodeField[n.id], n.x, n.y);
  if (p.bag.length) return steerHome(m);
  m.setMove(0, 0);
}
function playStick(seed, rival, model, { options = null, onEvent = null, onStep = null, rng = null } = {}) {
  const m = new Match({ seed, rival, model, options });
  let t = 0;
  for (let i = 0; m.phase !== 'end' && t < 400; i++) {
    // Re-decide ten times a second, like a thumb on a stick (and to keep the bot's choice stable).
    if (i % 6 === 0) stickBot(m, rng);
    m.step(DT);
    if (onStep) onStep(m);
    for (const e of m.drainEvents()) if (onEvent) onEvent(e, m);
    t += DT;
  }
  return { m, t };
}
// Distance from (x, y) to the nearest non-walkable tile (as a unit box), within the 3x3 around it.
function clearance(w, x, y) {
  let best = Infinity;
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let ty = cy - 1; ty <= cy + 1; ty++) {
    for (let tx = cx - 1; tx <= cx + 1; tx++) {
      if (isWalkable(w, tx, ty)) continue;
      const ex = x - Math.max(tx - 0.5, Math.min(x, tx + 0.5));
      const ey = y - Math.max(ty - 0.5, Math.min(y, ty + 0.5));
      best = Math.min(best, Math.hypot(ex, ey));
    }
  }
  return best;
}
const angle = (a, b) => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
};

test('free movement fuzz (300 random stick runs): centre never in a blocked tile, x/y walkable, no NaN, circle clear of walls', () => {
  let steps = 0;
  let minClear = Infinity;
  for (let s = 0; s < 300; s++) {
    const rng = mulberry32(s * 7 + 1);
    const m = new Match({ seed: 4000 + s * 3, rival: RIVALS[s % 5], model: new PlayerModel() });
    const p = m.player;
    const mixed = s % 3 === 0; // also taps (tap mode after free mode) and HOME
    let mx = 0;
    let my = 0;
    for (let i = 0; i < 1500 && m.phase !== 'end'; i++) {
      if (i % 10 === 0) {
        const r = rng();
        const a = rng() * Math.PI * 2;
        const mag = r < 0.12 ? 0 : r < 0.2 ? rng() * 0.12 : 0.15 + rng() * 1.3; // idle, dead zone, move (some > 1)
        mx = Math.cos(a) * mag;
        my = Math.sin(a) * mag;
      }
      m.setMove(mx, my);
      if (rng() < 0.01) m.interact();
      if (mixed && rng() < 0.006) m.command(1 + Math.floor(rng() * 7), 1 + Math.floor(rng() * 11));
      if (mixed && rng() < 0.002) m.command(4, m.world.hubY);
      m.step(1 / 120 + rng() * (1 / 20 - 1 / 120));
      steps++;
      assert.ok(Number.isFinite(p.fx) && Number.isFinite(p.fy) && Number.isFinite(p.vx) && Number.isFinite(p.vy), `NaN at seed ${s} step ${i}`);
      assert.ok(WALK_OK(m, Math.round(p.fx), Math.round(p.fy)), `centre in a blocked tile: seed ${s} step ${i} (${p.fx}, ${p.fy})`);
      assert.ok(WALK_OK(m, p.x, p.y), `x/y not walkable: seed ${s} step ${i}`);
      if (p.free && !p.to) assert.ok(p.x === Math.round(p.fx) && p.y === Math.round(p.fy), `x/y is not the centre's tile: seed ${s} step ${i}`);
      if (!mixed) {
        const c = clearance(m.world, p.fx, p.fy);
        minClear = Math.min(minClear, c);
        assert.ok(c >= PLAYER_RADIUS - 1e-9, `circle overlaps a wall by ${PLAYER_RADIUS - c}: seed ${s} step ${i}`);
      }
      m.drainEvents();
    }
  }
  assert.ok(steps > 300000 && minClear < PLAYER_RADIUS + 0.01, `steps ${steps}, closest approach ${minClear}`);
});

test('free mode: walking into a needed node gathers it; standing by it while it regrows waits, then gathers again', () => {
  // Torch = plank (wood) + rope (fiber, fiber): two fibers from the same node.
  const m = new Match({ seed: 42, rival: RIVALS[0], model: new PlayerModel(), options: { orders: ['torch'], rivalDelay: 99 } });
  toRace(m);
  const w = m.world;
  const p = m.player;
  const here = idx(p.x, p.y);
  const n = w.nodes.filter((k) => k.type === 'fiber').sort((a, b) => w.nodeField[a.id][here] - w.nodeField[b.id][here])[0];
  const gathers = [];
  for (let i = 0; i < 60 * 12 && !gathers.length; i++) {
    steerAlong(m, w.nodeField[n.id], n.x, n.y);
    m.step(DT);
    for (const e of m.drainEvents()) if (e.type === 'gather' && e.who === 'player') gathers.push(e);
  }
  assert.equal(gathers.length, 1, 'no auto gather');
  assert.equal(gathers[0].node.id, n.id);
  assert.deepEqual(p.bag, ['fiber']);
  assert.ok(p.free && !p.dest);
  // Still need one more fiber: stand still next to the regrowing node.
  m.setMove(0, 0);
  m.step(DT);
  assert.equal(p.state, 'wait');
  assert.equal(m.playerTarget(), n.id);
  const readyAt = n.readyAt;
  let again = null;
  for (let i = 0; i < 60 * 12 && !again; i++) {
    m.step(DT);
    for (const e of m.drainEvents()) if (e.type === 'gather' && e.who === 'player') again = e;
  }
  assert.ok(again && again.node.id === n.id, 'did not gather the regrown node');
  assert.ok(again.t >= readyAt && again.t < readyAt + 0.6, 'gathered at the moment it was ready');
  assert.deepEqual(p.bag, ['fiber', 'fiber']);
});

test('free mode: an unneeded node is never auto-gathered; interact() gathers it', () => {
  let checked = 0;
  for (let s = 0; s < 10; s++) {
    const m = new Match({ seed: 60 + s, rival: RIVALS[0], model: new PlayerModel(), options: { rivalDelay: 99 } });
    toRace(m);
    const w = m.world;
    const p = m.player;
    const need = m.needRemaining('player');
    const here = idx(p.x, p.y);
    const u = w.nodes.filter((k) => !need[k.type]).sort((a, b) => w.nodeField[a.id][here] - w.nodeField[b.id][here])[0];
    const got = [];
    let inReach = 0;
    for (let i = 0; i < 60 * 12 && inReach < 30; i++) {
      steerAlong(m, w.nodeField[u.id], u.x, u.y);
      m.step(DT);
      for (const e of m.drainEvents()) if (e.type === 'gather' && e.who === 'player') got.push(e.node.id);
      if (Math.hypot(u.x - p.fx, u.y - p.fy) <= REACH) inReach++; // keep pushing into it for half a second
    }
    assert.ok(inReach >= 30, `seed ${s}: never reached the unneeded node`);
    assert.ok(!got.includes(u.id), `seed ${s}: auto-gathered an unneeded node`);
    assert.ok(m.nodeReady(u) && p.state !== 'gather');
    if (p.bag.length >= m.bagSizeFor('player')) continue; // passed three needed nodes on the way
    m.setMove(0, 0);
    assert.equal(m.canInteract(), 'gather');
    assert.equal(p.state === 'gather', false, 'canInteract has no side effects');
    assert.equal(m.interact(), 'gather');
    assert.equal(m.canInteract(), null, 'busy gathering');
    for (let i = 0; i < 60; i++) {
      m.step(DT);
      for (const e of m.drainEvents()) if (e.type === 'gather' && e.who === 'player') got.push(e.node.id);
    }
    assert.ok(got.includes(u.id), `seed ${s}: interact did not gather`);
    assert.equal(p.bag[p.bag.length - 1], u.type);
    checked++;
  }
  assert.ok(checked >= 6, `only ${checked} islands checked`);
});

test('free mode: reaching the Workshop with items deposits automatically (and interact() deposits too)', () => {
  const m = new Match({ seed: 42, rival: RIVALS[0], model: new PlayerModel(), options: { rivalDelay: 99 } });
  toRace(m);
  const p = m.player;
  let deposit = null;
  let gathered = 0;
  for (let i = 0; i < 60 * 40 && !deposit; i++) {
    if (gathered < 2) stickBot(m);
    else steerHome(m);
    m.step(DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'gather' && e.who === 'player') gathered++;
      if (e.type === 'deposit' && e.who === 'player') deposit = e;
      assert.notEqual(e.type, 'autoReturn');
    }
  }
  assert.ok(deposit, 'no automatic deposit');
  assert.equal(deposit.items.length, 2);
  assert.equal(p.bag.length, 0);
  assert.ok(m.world.workshop.some((i) => Math.hypot((i % 9) - p.fx, Math.floor(i / 9) - p.fy) <= REACH));
  assert.equal(m.canInteract(), null);
  assert.equal(m.interact(), null, 'nothing to do with an empty bag');
  p.bag.push('wood'); // test-only: something to drop off
  assert.equal(m.canInteract(), 'deposit');
  assert.equal(m.interact(), 'deposit');
  assert.equal(p.state, 'deposit');
});

test('aim inference: walking toward a node aims at it, turning toward another switches, nothing behind is aimed', () => {
  let cases = 0;
  for (let s = 0; s < 80 && cases < 12; s++) {
    const m = new Match({ seed: 700 + s, rival: RIVALS[0], model: new PlayerModel(), options: { rivalDelay: 99 } });
    toRace(m);
    const p = m.player;
    // Start in the middle of the island, so there are nodes all around.
    const mid = [[4, 5], [4, 6], [3, 5], [5, 5], [4, 4], [3, 6], [5, 6]].find(([x, y]) => WALK_OK(m, x, y));
    if (!mid) continue;
    teleport(p, mid[0], mid[1]);
    const w = m.world;
    const need = m.needRemaining('player');
    const cand = w.nodes.filter((n) => need[n.type] && m.nodeReady(n));
    const toward = (x, y) => Math.atan2(y - p.fy, x - p.fx);
    // Directions in which walking reads as "going for o": straight at it, or a shortest-path step toward it.
    const reads = (o) => {
      const f = w.nodeField[o.id];
      const here = f[idx(p.x, p.y)];
      const out = [toward(o.x, o.y)];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const d = WALK_OK(m, p.x + dx, p.y + dy) ? f[idx(p.x + dx, p.y + dy)] : -1;
        if (here > 0 && d >= 0 && d < here) out.push(toward(p.x + dx, p.y + dy));
      }
      return out;
    };
    const clearOf = (o, ang) => reads(o).every((r) => angle(r, ang) > (46 * Math.PI) / 180);
    const far = (n) => Math.hypot(n.x - p.fx, n.y - p.fy) > 1.5; // out of reach, so walking does not gather it
    const lone = cand.filter((n) => far(n) && cand.every((o) => o === n || clearOf(o, toward(n.x, n.y))));
    if (lone.length < 2) continue;
    const [a, b] = lone;
    steerAt(m, a.x, a.y);
    m.step(DT);
    assert.equal(p.aim, a.id, `seed ${s}`);
    assert.equal(m.playerTarget(), a.id);
    steerAt(m, b.x, b.y);
    m.step(DT);
    assert.equal(p.aim, b.id, `seed ${s}`);
    const away = toward(a.x, a.y) + Math.PI;
    m.setMove(Math.cos(away), Math.sin(away)); // straight away from a
    m.step(DT);
    if (clearOf(a, away)) assert.notEqual(p.aim, a.id);
    cases++;
  }
  assert.ok(cases >= 8, `only ${cases} cases`);
});

test('a rival snatching the node the free-moving player is walking toward emits snatch', () => {
  let cases = 0;
  for (let s = 0; s < 40 && cases < 8; s++) {
    const m = new Match({ seed: 900 + s, rival: RIVALS[2 + (s % 3)], model: new PlayerModel(), options: { rivalDelay: 99 } });
    toRace(m);
    const w = m.world;
    const p = m.player;
    const r = m.rival;
    const need = m.needRemaining('player');
    const n = w.nodes.find((k) => {
      if (!need[k.type] || !m.nodeReady(k)) return false;
      steerAt(m, k.x, k.y);
      return true;
    });
    m.step(DT);
    if (!n || p.aim !== n.id) continue;
    // Put the rival next to that node, walking to it.
    const adj = w.walkable.findIndex((ok, i) => ok && w.nodeField[n.id][i] === 0);
    teleport(r, adj % 9, Math.floor(adj / 9));
    r.state = 'walk';
    r.dest = { kind: 'node', id: n.id };
    m.rivalReplan = 10;
    m.drainEvents();
    steerAt(m, n.x, n.y);
    m.step(DT);
    const snatch = m.drainEvents().find((e) => e.type === 'snatch');
    assert.ok(snatch, `seed ${s}: no snatch`);
    assert.equal(snatch.node.id, n.id);
    assert.ok(snatch.text && snatch.text.text);
    assert.equal(m.stats.snatched, 1);
    cases++;
  }
  assert.ok(cases >= 6, `only ${cases} cases`);
});

test('timeLimit: race time runs out -> match ends, summary.timeUp, more stars wins, a tie goes to the rival', () => {
  // Nobody moves the player: 0-0 (or rival ahead) when time runs out -> the rival wins.
  const m = new Match({ seed: 5, rival: RIVALS[0], model: new PlayerModel(), options: { timeLimit: 6 } });
  const ends = [];
  while (m.phase !== 'end' && m.time < 60) {
    m.step(DT);
    for (const e of m.drainEvents()) if (e.type === 'matchEnd') ends.push(e);
  }
  assert.equal(m.phase, 'end');
  assert.equal(ends.length, 1);
  assert.equal(ends[0].timeUp, true);
  const su = m.summary();
  assert.equal(su.timeUp, true);
  assert.equal(su.winner, 'rival');
  assert.ok(Math.abs(su.raceSeconds - 6) < DT * 1.5, `race seconds ${su.raceSeconds}`);
  assert.ok(su.seconds > su.raceSeconds + 2, 'the intro does not count');
  assert.ok(m.timeLeft === 0);
  // Player one star up when time runs out: the player wins, and the time spent between orders is free.
  const k = new Match({ seed: 42, rival: RIVALS[0], model: new PlayerModel(), options: { timeLimit: 8, rivalDelay: 99 } });
  toRace(k);
  const b = k.bench.player;
  for (const part of k.order.parts) for (const r of COMPONENTS[part].needs) b.raw[r] = (b.raw[r] || 0) + 1;
  k.craftCheck('player');
  while (k.phase !== 'end' && k.time < 60) k.step(DT);
  assert.equal(k.summary().winner, 'player');
  assert.equal(k.summary().timeUp, true);
  assert.ok(k.summary().score >= SCORE.order + SCORE.matchWin + SCORE.flawless);
  // Without a limit nothing changes.
  const n = new Match({ seed: 5, rival: RIVALS[0], model: new PlayerModel() });
  assert.equal(n.timeLeft, null);
});

test('options: orders, starsToWin, playerBagBonus, playerSpeedMul, rivalDelay take effect', () => {
  const o = new Match({ seed: 1, rival: RIVALS[1], model: new PlayerModel(), options: { orders: ['clock', 'nope', 'torch'] } });
  assert.deepEqual(o.orders.map((i) => i.id), ['clock', 'torch']);
  assert.equal(o.maxOrders, 2);
  assert.equal(new Match({ seed: 1, rival: RIVALS[1], model: new PlayerModel() }).maxOrders, 5);
  // First to one star.
  for (let s = 0; s < 10; s++) {
    const { m } = playMatch(300 + s, RIVALS[s % 5], new PlayerModel(), null, { starsToWin: 1 });
    assert.equal(m.phase, 'end');
    assert.equal(m.results.length, 1);
    assert.equal(Math.max(m.stars.player, m.stars.rival), 1);
  }
  // Bigger bag for the player only; the tap bot fills it before walking home.
  const bag = new Match({ seed: 8, rival: RIVALS[2], model: new PlayerModel(), options: { playerBagBonus: 2, orders: ['clock', 'telescope', 'crown'] } });
  assert.equal(bag.bagSizeFor('player'), 5);
  assert.equal(bag.bagSizeFor('rival'), 3);
  assert.equal(bag.bagSize, 3);
  let maxP = 0;
  let maxR = 0;
  while (bag.phase !== 'end' && bag.time < 300) {
    const p = bag.player;
    if (bag.phase === 'race' && p.state === 'idle' && !p.dest) {
      const need = bag.needRemaining('player');
      const c = bag.world.nodes.filter((n) => need[n.type] && !n.reserved && bag.nodeReady(n));
      if (p.bag.length >= bag.bagSizeFor('player') || (p.bag.length && !c.length)) bag.command(4, 10);
      else if (c.length) bag.command(c[0].x, c[0].y);
    }
    bag.step(DT);
    bag.drainEvents();
    maxP = Math.max(maxP, bag.player.bag.length);
    maxR = Math.max(maxR, bag.rival.bag.length);
  }
  assert.equal(maxP, 5);
  assert.ok(maxR <= 3);
  // Faster boots, same rival.
  const fast = new Match({ seed: 8, rival: RIVALS[2], model: new PlayerModel(), options: { playerSpeedMul: 1.5 } });
  assert.equal(fast.player.speed, PLAYER_SPEED * 1.5);
  assert.equal(fast.rival.speed, RIVALS[2].speed);
  toRace(fast);
  const y0 = fast.player.fy;
  fast.setMove(0, -1); // north from the spawn: (2, 9) is always open ground
  fast.step(0.05);
  assert.ok(Math.abs(y0 - fast.player.fy - PLAYER_SPEED * 1.5 * 0.05) < 1e-9);
  // Head start: the rival waits rivalDelay extra seconds at every GO.
  const slow = new Match({ seed: 8, rival: RIVALS[4], model: new PlayerModel(), options: { rivalDelay: 2 } });
  toRace(slow);
  assert.equal(slow.rival.state, 'think');
  assert.ok(Math.abs(slow.rival.timer - (RIVALS[4].think + 0.25 + 2) + DT) < DT * 1.01);
  for (let i = 0; i < 100; i++) slow.step(DT);
  assert.equal(slow.rival.state, 'think');
  assert.equal(slow.rival.fx, slow.world.spawn.rival.x);
  for (let i = 0; i < 60; i++) slow.step(DT);
  assert.notEqual(slow.rival.state, 'think');
});

test('options: blindOrders -> no informed reads (snatches are all luck, no fake-outs) for the first N orders', () => {
  const model = new PlayerModel();
  let blindSnatches = 0;
  let readsAfter = 0;
  for (let s = 0; s < 30; s++) {
    const blind = s % 2 === 0 ? 5 : 2;
    playMatch(1500 + s, RIVALS[3 + (s % 2)], model, (e, m) => {
      if (m.orderIndex < blind) {
        assert.equal(m.pred, null);
        if (e.type === 'snatch') {
          blindSnatches++;
          assert.equal(e.text.kind, 'luck', e.text.text);
          assert.ok(e.text.text.includes('needed it too'));
        }
        assert.notEqual(e.type, 'fooled');
      } else if (e.type === 'snatch' && e.text.kind !== 'luck') readsAfter++;
    }, { blindOrders: blind });
  }
  assert.ok(blindSnatches > 10, `only ${blindSnatches} blind snatches`);
  assert.ok(readsAfter > 0, 'reads come back after the blind orders');
});

test('score: every change emits a score event; events sum to match.score and summary.score', () => {
  const reasons = new Set(['gather', 'craft', 'order', 'speed', 'outread', 'fooled', 'matchWin', 'flawless']);
  const model = new PlayerModel();
  let wins = 0;
  for (let s = 0; s < 40; s++) {
    let total = 0;
    const seen = {};
    let playerOrders = 0;
    const onEvent = (e) => {
      if (e.type === 'complete' && e.who === 'player') playerOrders++;
      if (e.type !== 'score') return;
      assert.ok(reasons.has(e.reason), e.reason);
      assert.ok(Number.isInteger(e.add) && e.add > 0);
      total += e.add;
      assert.equal(e.total, total);
      seen[e.reason] = (seen[e.reason] || 0) + 1;
    };
    const options = s % 4 === 3 ? { timeLimit: 40 } : null;
    const { m } = s % 2 ? playStick(2000 + s, RIVALS[s % 5], model, { onEvent, options }) : playMatch(2000 + s, RIVALS[s % 5], model, onEvent, options);
    const su = m.summary();
    assert.equal(su.score, total);
    assert.equal(m.score, total);
    assert.equal(seen.order || 0, playerOrders);
    assert.equal(seen.order || 0, m.stars.player);
    assert.equal(!!seen.matchWin, su.winner === 'player');
    assert.equal(!!seen.flawless, su.winner === 'player' && m.stars.rival === 0);
    assert.ok((seen.gather || 0) <= m.stats.gathers);
    assert.equal(seen.outread || 0, m.stats.outread);
    assert.equal(seen.fooled || 0, m.stats.fooled);
    if (su.winner === 'player') wins++;
  }
  assert.ok(wins > 5, `wins ${wins}`); // flawless is checked per match above (and forced in the timeLimit test)
});

test('free movement is deterministic: same stick inputs -> identical match', () => {
  const run = () => {
    const trace = [];
    const { m } = playStick(31337, RIVALS[3], new PlayerModel(), { rng: mulberry32(99), onStep: (k) => trace.push(`${k.player.fx},${k.player.fy},${k.rival.fx},${k.player.state}`) });
    return { s: m.summary(), trace };
  };
  const a = run();
  const b = run();
  assert.deepEqual(a.s, b.s);
  assert.deepEqual(a.trace, b.trace);
});

test('stick bot (setMove only) finishes every match (5 rivals x 40 islands); snatches happen through aim', () => {
  let snatches = 0;
  let wins = 0;
  for (const rival of RIVALS) {
    const model = new PlayerModel();
    for (let s = 0; s < 40; s++) {
      const { m, t } = playStick(100 + s, rival, model, { onEvent: (e) => (snatches += e.type === 'snatch' ? 1 : 0) });
      assert.equal(m.phase, 'end', `${rival.id} seed ${s} stuck at t=${t}`);
      assert.equal(Math.max(m.stars.player, m.stars.rival), 3);
      assert.ok(m.player.free);
      if (m.summary().winner === 'player') wins++;
    }
  }
  assert.ok(snatches > 20, `only ${snatches} snatches`);
  assert.ok(wins > 40, `the stick bot only won ${wins}/200`);
});

test('tap mode after free mode: paths smoothly from the exact position and reaches the target', () => {
  for (let s = 0; s < 20; s++) {
    const m = new Match({ seed: 1200 + s, rival: RIVALS[0], model: new PlayerModel(), options: { rivalDelay: 99 } });
    toRace(m);
    const p = m.player;
    m.setMove(0.6, -0.8); // wander off the tile grid
    for (let i = 0; i < 20; i++) m.step(DT);
    m.setMove(0, 0);
    m.step(DT);
    assert.ok(p.free);
    const need = m.needRemaining('player');
    const n = m.world.nodes.find((k) => need[k.type] && m.nodeReady(k));
    assert.ok(m.command(n.x, n.y));
    assert.ok(!p.free);
    let got = null;
    let px = p.fx;
    let py = p.fy;
    for (let i = 0; i < 60 * 15 && !got; i++) {
      m.step(DT);
      assert.ok(Math.hypot(p.fx - px, p.fy - py) <= p.speed * DT + 1e-9, `seed ${s}: jumped`);
      px = p.fx;
      py = p.fy;
      for (const e of m.drainEvents()) if (e.type === 'gather' && e.who === 'player') got = e;
    }
    assert.ok(got && got.node.id === n.id, `seed ${s}: never gathered the tapped node`);
    assert.equal(m.world.nodeField[n.id][idx(p.x, p.y)], 0);
  }
});

test('stick vs tap control: dead zone keeps a tap path, a held stick never cancels HOME, a fresh push does', () => {
  const m = new Match({ seed: 42, rival: RIVALS[0], model: new PlayerModel(), options: { rivalDelay: 99 } });
  toRace(m);
  const p = m.player;
  const far = m.world.hubField.findIndex((d) => d >= 6);
  teleport(p, far % 9, Math.floor(far / 9)); // far from the Workshop, so walking home takes a while
  assert.ok(m.command(4, 10));
  m.setMove(0.1, 0); // inside the dead zone
  for (let i = 0; i < 20; i++) m.step(DT);
  assert.ok(!p.free && p.dest);
  m.setMove(0, -1); // push: free movement takes over
  m.step(DT);
  assert.ok(p.free && !p.dest && !p.to);
  p.bag.push('wood'); // test-only: something to take home
  m.command(4, m.world.hubY); // HOME while still holding the stick
  for (let i = 0; i < 20; i++) {
    m.step(DT);
    assert.ok(!p.free, 'held stick cancelled HOME');
  }
  assert.ok(p.dest && p.dest.kind === 'hub');
  m.setMove(0, 0);
  m.step(DT);
  m.setMove(1, 0);
  m.step(DT);
  assert.ok(p.free && !p.dest, 'a fresh push did not take over');
});

test('bag full in free mode: one bagFull hint and no walk home; options.autoReturn walks home', () => {
  for (const autoReturn of [false, true]) {
    const m = new Match({ seed: 77, rival: RIVALS[0], model: new PlayerModel(), options: { rivalDelay: 99, orders: ['clock'], autoReturn } });
    toRace(m);
    const p = m.player;
    const ev = [];
    for (let i = 0; i < 60 * 40 && p.bag.length < 3; i++) {
      stickBot(m);
      m.step(DT);
      ev.push(...m.drainEvents());
    }
    assert.equal(p.bag.length, 3);
    m.setMove(0, 0);
    for (let i = 0; i < 60 * 8; i++) {
      m.step(DT);
      ev.push(...m.drainEvents());
    }
    const hints = ev.filter((e) => e.type === 'bagFull');
    const returns = ev.filter((e) => e.type === 'autoReturn');
    if (!autoReturn) {
      assert.equal(hints.length, 1);
      assert.equal(hints[0].full, true);
      assert.equal(returns.length, 0);
      assert.equal(p.bag.length, 3, 'stayed put with a full bag');
    } else {
      assert.equal(returns.length, 1);
      assert.equal(hints.length, 0);
      assert.ok(ev.some((e) => e.type === 'deposit' && e.who === 'player'), 'walked home and deposited');
    }
  }
});

test('speed bonus: stock left over from a lost order shrinks the par instead of counting as speed', () => {
  let checked = 0;
  for (let s = 0; s < 80 && checked < 5; s++) {
    let lost = false;
    let pending = null;
    playMatch(9000 + s, RIVALS[4], new PlayerModel(), (e, m) => {
      if (e.type === 'complete' && e.who === 'rival') lost = true;
      if (e.type === 'go') {
        const share = m.missingShare('player');
        assert.equal(m.parScale, share);
        assert.ok(share >= 0 && share <= 1);
        pending = lost && share < 1 ? share : null;
        lost = false;
      }
      if (e.type === 'score' && e.reason === 'speed' && pending != null) {
        const par = SCORE.parSeconds[Math.min(m.order.tier, SCORE.parSeconds.length - 1)] * pending;
        assert.ok(e.add <= Math.round(par * SCORE.perSecondUnderPar), 'speed points never exceed the scaled par');
        checked++;
        pending = null;
      }
    });
  }
  assert.ok(checked > 0, 'found wins right after a lost order with leftover stock');
});

console.log(`\n${passed} tests passed`);
