// Invariant tests for OUTCRAFT.   node tools/test.mjs
import assert from 'node:assert/strict';
import { generateIsland, idx } from '../src/world.js';
import { Match } from '../src/match.js';
import { PlayerModel, HABIT_IDS } from '../src/model.js';
import { RIVALS, RES, RES_IDS, ITEMS, COMPONENTS } from '../src/data.js';
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

function playMatch(seed, rival, model, onEvent = null) {
  const m = new Match({ seed, rival, model });
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

console.log(`\n${passed} tests passed`);
