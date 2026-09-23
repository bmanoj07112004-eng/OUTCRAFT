// Balance simulator: bot players of different styles race every rival on many seeded islands, using
// the exact same Match + PlayerModel code as the browser game.   node tools/sim.mjs [matches] [rivals]
import { Match } from '../src/match.js';
import { PlayerModel } from '../src/model.js';
import { RIVALS } from '../src/data.js';
import { mulberry32 } from '../src/rng.js';
import { idx } from '../src/world.js';

const N = +(process.argv[2] || 200);
const only = process.argv[3] ? process.argv[3].split(',') : null;
const DT = 1 / 30;

const HUB = { x: 4, y: 10 };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

function readyNeeded(m, pad = 0) {
  const need = m.needRemaining('player');
  return m.world.nodes.filter((n) => need[n.type] && !n.reserved && n.readyAt - m.time <= pad);
}
function dist(m, n, a = m.player) {
  return m.world.nodeField[n.id][idx(a.x, a.y)];
}
function mustGoHome(m) {
  const p = m.player;
  return p.bag.length >= m.bagSize || (p.bag.length && !sum(m.needRemaining('player')));
}

// Bots return a target {x,y} when the player is idle.
const BOTS = {
  // Always the nearest node you need: the most natural, most predictable habit.
  greedy: (rng) => (m) => {
    if (mustGoHome(m)) return HUB;
    const c = readyNeeded(m, 1.5).sort((a, b) => dist(m, a) - dist(m, b));
    return c[0] || (m.player.bag.length ? HUB : null);
  },
  // A human-ish mix: usually nearest, sometimes second nearest, prefers the left side a bit.
  human: (rng) => (m) => {
    if (mustGoHome(m)) return HUB;
    const c = readyNeeded(m, 1.5).sort((a, b) => dist(m, a) - dist(m, b) + (a.x < 4 ? -0.6 : 0) - (b.x < 4 ? -0.6 : 0));
    if (!c.length) return m.player.bag.length ? HUB : null;
    return rng() < 0.72 || c.length === 1 ? c[0] : c[1];
  },
  // Unpredictable: uniformly random among needed nodes.
  random: (rng) => (m) => {
    if (mustGoHome(m)) return HUB;
    const c = readyNeeded(m, 1.5);
    return c.length ? c[Math.floor(rng() * c.length)] : m.player.bag.length ? HUB : null;
  },
  // Reads the rival back: nearest node the rival is NOT about to take first.
  reader: (rng) => (m) => {
    if (mustGoHome(m)) return HUB;
    const r = m.rival;
    const ri = m.rivalIntent;
    const c = readyNeeded(m, 1.5)
      .map((n) => {
        let cost = dist(m, n);
        if (ri && ri.kind === 'node' && ri.id === n.id && dist(m, n, r) / r.speed < dist(m, n) / m.player.speed) cost += 6;
        return { n, cost: cost + rng() * 1.5 };
      })
      .sort((a, b) => a.cost - b.cost);
    return c.length ? c[0].n : m.player.bag.length ? HUB : null;
  },
};

function play(rival, botName, seed, model) {
  const rng = mulberry32(seed * 31 + 7);
  const m = new Match({ seed, rival, model });
  const policy = BOTS[botName](rng);
  let t = 0;
  while (m.phase !== 'end' && t < 600) {
    if (m.phase === 'race' && m.player.state === 'idle' && !m.player.dest) {
      const target = policy(m);
      if (target) m.command(target.x, target.y);
    }
    m.step(DT);
    m.drainEvents();
    t += DT;
  }
  return m.summary();
}

const pct = (x) => `${Math.round(x * 100)}%`.padStart(4);
console.log(`matches per cell: ${N} (each bot keeps one remembering PlayerModel across its matches)\n`);
console.log('rival    ' + Object.keys(BOTS).map((b) => b.padEnd(26)).join(''));
for (const rival of RIVALS) {
  if (only && !only.includes(rival.id)) continue;
  let line = rival.name.padEnd(9);
  for (const bot of Object.keys(BOTS)) {
    let wins = 0;
    let snatch = 0;
    let secs = 0;
    let outread = 0;
    let fooled = 0;
    const model = new PlayerModel();
    for (let i = 0; i < N; i++) {
      const s = play(rival, bot, 1000 + i, model);
      if (s.winner === 'player') wins++;
      snatch += s.stats.snatched;
      outread += s.stats.outread;
      fooled += s.stats.fooled;
      secs += s.seconds;
    }
    line += `${pct(wins / N)} win ${(snatch / N).toFixed(1)}sn ${(outread / N).toFixed(1)}or ${(fooled / N).toFixed(1)}fo ${Math.round(secs / N)}s`.padEnd(32);
  }
  console.log(line);
}
