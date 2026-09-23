// Balance simulator: plays thousands of runs with bot "players" of different predictability against the
// real Oracle + Run code, then reports how far each persona gets. Used to tune ECON and ORACLES.
//   node tools/sim.mjs [runsPerBot] [consecutiveRunsPerPlayer]
import { Oracle, EXPERT_IDS } from '../src/oracle.js';
import { Run } from '../src/run.js';
import { mulberry32 } from '../src/rng.js';

const RUNS = +(process.argv[2] || 600);
const SESSIONS = +(process.argv[3] || 3); // runs in a row against the same (remembering) Oracle
const MAX_BEATS = 1500;

function pickWeighted(rng, items, weights) {
  const s = weights.reduce((a, b) => a + b, 0);
  let r = rng() * s;
  for (let i = 0; i < items.length; i++) if ((r -= weights[i]) <= 0) return items[i];
  return items[items.length - 1];
}

// A parametric "human": greedy for shards, flees after being hit, falls into a personal cycle, and gets
// more patterned as the tempo rises (cognitive load). With `learns`, it reacts to being read the way the
// READ explanations teach: it chases less after being caught on a shard, flinches less, loops less.
function human(p0) {
  return (rng) => {
    const p = { ...p0 };
    let ci = 0;
    let lastKind = null;
    return (s) => {
      if (p.learns && s.last) {
        if (s.last.hit) {
          if (lastKind === 'chase') p.chase = Math.max(p.chaseMin, p.chase * 0.82);
          if (lastKind === 'flee') p.flee = Math.max(0.12, p.flee * 0.8);
          if (lastKind === 'pattern') p.pattern = Math.max(0.04, p.pattern * 0.85);
        } else if (lastKind === 'chase') {
          p.chase = Math.min(p0.chase, p.chase + 0.015);
        }
      }
      const load = Math.max(0, Math.min(1, (1100 - s.tempo) / 500));
      const pat = p.pattern + p.fatigue * load;
      if (s.last && s.last.hit && rng() < p.flee) {
        lastKind = 'flee';
        return s.cur === 1 ? (rng() < 0.5 ? 0 : 2) : 2 - s.cur;
      }
      if (rng() < p.chase) {
        lastKind = 'chase';
        return s.shardLane;
      }
      if (rng() < pat) {
        lastKind = 'pattern';
        ci = (ci + 1) % p.cycle.length;
        return p.cycle[ci];
      }
      lastKind = 'free';
      if (rng() < p.stay) return s.cur;
      const opts = [0, 1, 2].filter((l) => l !== s.cur);
      return pickWeighted(rng, opts, opts.map((l) => (l === 1 ? p.middle : 1 - p.middle)));
    };
  };
}

const BOTS = {
  random: () => (rng) => () => Math.floor(rng() * 3),
  learner: () => human({ learns: true, chase: 0.6, chaseMin: 0.22, flee: 0.6, stay: 0.2, middle: 0.45, cycle: [0, 1, 2, 1], pattern: 0.2, fatigue: 0.3 }),
  thoughtful: () => human({ chase: 0.4, flee: 0.3, stay: 0.25, middle: 0.4, cycle: [0, 2, 1], pattern: 0.08, fatigue: 0.2 }),
  typical: () => human({ chase: 0.5, flee: 0.5, stay: 0.2, middle: 0.45, cycle: [0, 1, 2, 1], pattern: 0.18, fatigue: 0.3 }),
  naive: () => human({ chase: 0.62, flee: 0.65, stay: 0.15, middle: 0.5, cycle: [0, 1, 2, 1], pattern: 0.3, fatigue: 0.35 }),
  patterned: () => (rng) => {
    const cyc = [0, 1, 2, 1];
    let i = 0;
    return () => (rng() < 0.15 ? Math.floor(rng() * 3) : cyc[(i = (i + 1) % cyc.length)]);
  },
};

function playRun(oracle, policy, rng, calibration) {
  const run = new Run({ oracle, rng, shardRng: rng, calibration });
  let last = null;
  let seconds = 0;
  while (!run.over && run.beatIndex < MAX_BEATS) {
    const b = run.beginBeat();
    seconds += b.duration / 1000;
    const lane = policy({ cur: run.lane, shardLane: b.shardLane, last, tempo: b.duration });
    const r = run.resolveBeat(lane);
    last = { hit: r.outcome === 'read' };
  }
  oracle.endRun();
  return { ...run.summary(), seconds };
}

const pctf = (x) => `${(x * 100).toFixed(0)}%`.padStart(4);
const only = process.argv[4] ? process.argv[4].split(',') : null;
console.log(`runs/bot=${RUNS}, consecutive runs with remembering Oracle=${SESSIONS}\n`);
for (const [name, make] of Object.entries(BOTS)) {
  if (only && !only.includes(name)) continue;
  const perSession = Array.from({ length: SESSIONS }, () => ({ reach: [0, 0, 0, 0, 0, 0], secs: 0, read: 0, beats: 0, score: 0, tells: {}, lvRead: {} }));
  for (let r = 0; r < RUNS; r++) {
    const rng = mulberry32(1000 + r * 7919);
    const oracle = new Oracle();
    const policy = make()(rng);
    for (let s = 0; s < SESSIONS; s++) {
      const res = playRun(oracle, policy, rng, s === 0 ? 6 : 3);
      const agg = perSession[s];
      for (let k = 1; k <= 6; k++) if (res.cracked >= k) agg.reach[k - 1]++;
      agg.secs += res.seconds;
      agg.read += res.readRate;
      agg.beats += res.beats;
      agg.score += res.score;
      res.levelStats.forEach((l, i) => {
        if (!l.strikes) return;
        const k = Math.min(i, 5);
        agg.lvRead[k] = agg.lvRead[k] || { r: 0, n: 0 };
        agg.lvRead[k].r += l.reads;
        agg.lvRead[k].n += l.strikes;
      });
      for (const id of EXPERT_IDS) {
        const t = res.tells[id];
        if (!agg.tells[id]) agg.tells[id] = { acc: 0, det: 0 };
        agg.tells[id].acc += t.acc;
        if (t.n >= 12 && t.acc >= 0.5) agg.tells[id].det++;
      }
    }
  }
  console.log(`== ${name}`);
  perSession.forEach((a, s) => {
    const cr = a.reach.map((v) => pctf(v / RUNS)).join(' ');
    const lv = Object.keys(a.lvRead).map((k) => pctf(a.lvRead[k].r / a.lvRead[k].n)).join(' ');
    console.log(`  run#${s + 1}  cracked>=1..6: ${cr}  | read ${pctf(a.read / RUNS)} per-level [${lv}] | ${(a.secs / RUNS).toFixed(0)}s ${(a.beats / RUNS).toFixed(0)} beats score ${(a.score / RUNS).toFixed(0)}`);
    if (s === 0) {
      const tells = EXPERT_IDS.map((id) => `${id.slice(0, 4)} ${pctf(a.tells[id].acc / RUNS)}/${pctf(a.tells[id].det / RUNS)}`).join(' | ');
      console.log(`         tell acc/detected: ${tells}`);
    }
  });
}
