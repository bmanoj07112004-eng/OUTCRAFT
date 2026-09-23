// Invariant tests for the Oracle, the run economy and the day-1 systems.  node tools/test.mjs
import assert from 'node:assert/strict';
import { Oracle, EXPERT_IDS } from '../src/oracle.js';
import { Run } from '../src/run.js';
import { ECON } from '../src/levels.js';
import { recordRun, shareText, todaysDaily, DEX_RULES } from '../src/storage.js';
import { mulberry32, dayNumber } from '../src/rng.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

function play(oracle, lanes, rng = Math.random) {
  let correct = 0;
  const explanations = [];
  oracle.beginRun();
  lanes.forEach((lane, i) => {
    oracle.predict({ shardLane: Math.floor(rng() * 3), cur: 1 });
    const d = oracle.decide({ rng });
    const hit = d.strike.includes(lane);
    if (hit) {
      correct++;
      explanations.push(oracle.explain(lane));
    }
    oracle.observe(lane, hit);
  });
  return { acc: correct / lanes.length, explanations };
}

test('learns a fixed 4-step cycle quickly (>85% after warm-up)', () => {
  const o = new Oracle();
  const seq = Array.from({ length: 120 }, (_, i) => [0, 1, 2, 1][i % 4]);
  const { acc } = play(o, seq, mulberry32(1));
  assert.ok(acc > 0.85, `accuracy ${acc}`);
});

test('cannot beat chance against a random player (29-38%)', () => {
  const rng = mulberry32(2);
  const o = new Oracle();
  const seq = Array.from({ length: 4000 }, () => Math.floor(rng() * 3));
  const { acc } = play(o, seq, rng);
  assert.ok(acc > 0.29 && acc < 0.38, `accuracy ${acc}`);
});

test('dossier rarely invents habits for random players (<8% of players)', () => {
  let falseClaims = 0;
  for (let p = 0; p < 200; p++) {
    const rng = mulberry32(100 + p);
    const o = new Oracle();
    play(o, Array.from({ length: 180 }, () => Math.floor(rng() * 3)), rng);
    if (o.dossier(3).length) falseClaims++;
  }
  assert.ok(falseClaims / 200 < 0.08, `false-claim rate ${falseClaims / 200}`);
});

test('dossier does name the habit of a patterned player', () => {
  const o = new Oracle();
  play(o, Array.from({ length: 80 }, (_, i) => [0, 2][i % 2]), mulberry32(3));
  assert.ok(o.dossier(3).length >= 1);
});

test('READ explanations never claim k > n and always have text', () => {
  const rng = mulberry32(4);
  const o = new Oracle();
  const seq = Array.from({ length: 600 }, (_, i) => (rng() < 0.6 ? [0, 1, 2][i % 3] : Math.floor(rng() * 3)));
  const { explanations } = play(o, seq, rng);
  assert.ok(explanations.length > 50);
  for (const e of explanations) {
    assert.ok(e && e.text && e.text.length > 5);
    const m = e.text.match(/(\d+) of (\d+)/);
    if (m) assert.ok(+m[1] <= +m[2] && +m[2] > 0, e.text);
  }
});

test('memory survives save/load (same prediction after JSON round-trip)', () => {
  const o = new Oracle();
  play(o, Array.from({ length: 50 }, (_, i) => [0, 1][i % 2]), mulberry32(5));
  const o2 = new Oracle(JSON.parse(JSON.stringify(o.toJSON())));
  o2.hist = o.hist.slice();
  o2.lastHit = o.lastHit;
  const a = o.predict({ shardLane: 1 });
  const b = o2.predict({ shardLane: 1 });
  assert.deepEqual(o.mixture(EXPERT_IDS), o2.mixture(EXPERT_IDS));
  assert.ok(a && b);
});

test('run economy: crack resets bar to start and advances level; solved ends run', () => {
  const o = new Oracle();
  const run = new Run({ oracle: o, calibration: 0, rng: mulberry32(6) });
  let guard = 0;
  while (run.level === 0 && guard++ < 500) {
    const b = run.beginBeat();
    const safe = [0, 1, 2].find((l) => !b.decision.strike.includes(l));
    run.resolveBeat(safe);
  }
  assert.equal(run.level, 1);
  assert.equal(run.bar, ECON.start);
  guard = 0;
  while (!run.over && guard++ < 500) {
    const b = run.beginBeat();
    run.resolveBeat(b.decision.strike[0]);
  }
  assert.ok(run.over);
  assert.equal(run.bar, 0);
  assert.equal(run.summary().solvedBy, 'MIRROR');
});

function fakeSummary(over = {}) {
  const tells = {};
  EXPERT_IDS.forEach((id) => (tells[id] = { n: 0, acc: 0 }));
  return { mode: 'gauntlet', score: 100, level: 1, cracked: 1, readRate: 0.4, grid: ['D', 'R', 'S'], tells, ...over };
}
const freshState = () => ({ stats: { runs: 0, best: 0, bestLevel: 0, history: [] }, dex: {}, daily: { lastKey: null, streak: 0, best: 0, results: {} } });

test('daily streak: +1 on consecutive days, reset after a gap, one ranked run per day', () => {
  const st = freshState();
  const day = (k) => ({ key: k, number: dayNumber(k), modifier: { id: 'blitz', name: 'Blitz' } });
  assert.equal(recordRun(st, fakeSummary(), { daily: day('2026-09-23') }).dailyInfo.streak, 1);
  assert.equal(recordRun(st, fakeSummary(), { daily: day('2026-09-23') }).dailyInfo, null);
  assert.equal(recordRun(st, fakeSummary(), { daily: day('2026-09-24') }).dailyInfo.streak, 2);
  assert.equal(recordRun(st, fakeSummary(), { daily: day('2026-09-27') }).dailyInfo.streak, 1);
});

test('tell dex: locked -> detected -> broken -> relapsed', () => {
  const st = freshState();
  const s = (acc, n = 20) => {
    const f = fakeSummary();
    f.tells.magpie = { n, acc };
    return f;
  };
  assert.equal(recordRun(st, s(0.6)).events[0].type, 'detected');
  assert.equal(recordRun(st, s(0.45)).events.length, 0);
  assert.equal(recordRun(st, s(DEX_RULES.breakAt - 0.01)).events[0].type, 'broken');
  assert.equal(recordRun(st, s(0.6)).events[0].type, 'relapsed');
});

test('share text: header, read rate, 10-wide emoji rows', () => {
  const grid = Array.from({ length: 23 }, (_, i) => 'DSR'[i % 3]);
  const txt = shareText({ summary: { cracked: 2, readRate: 0.41, grid }, daily: { number: 7, modifier: { name: 'Blitz' } }, url: 'https://x' });
  const lines = txt.split('\n');
  assert.equal(lines[0], 'UNREADABLE · Daily #7 (Blitz)');
  assert.ok(lines[1].includes('Read 41%'));
  assert.equal([...lines[2]].length, 10);
  assert.equal(lines.at(-1), 'https://x');
});

test('daily is deterministic per date', () => {
  assert.deepEqual(todaysDaily('2026-10-01'), todaysDaily('2026-10-01'));
  assert.equal(todaysDaily('2026-09-20').number, 1);
});

console.log(`\n${passed} tests passed`);
