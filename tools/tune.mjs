// Quick tuning: override rival params from JSON and compare full AI vs blind for greedy/human/reader bots.
import { Match } from '../src/match.js';
import { PlayerModel } from '../src/model.js';
import { RIVALS } from '../src/data.js';
import { mulberry32 } from '../src/rng.js';
import { idx } from '../src/world.js';

const N = +(process.argv[2] || 100);
const overrides = JSON.parse(process.argv[3] || '{}');
const DT = 1 / 30;
const HUB = { x: 4, y: 10 };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const dist = (m, n, a = m.player) => m.world.nodeField[n.id][idx(a.x, a.y)];
const home = (m) => m.player.bag.length >= m.bagSize || (m.player.bag.length && !sum(m.needRemaining('player')));
const cands = (m) => { const need = m.needRemaining('player'); return m.world.nodes.filter((n) => need[n.type] && !n.reserved && n.readyAt - m.time <= 1.5); };
const BOTS = {
  greedy: () => (m) => home(m) ? HUB : (cands(m).sort((a, b) => dist(m, a) - dist(m, b))[0] || (m.player.bag.length ? HUB : null)),
  human: (rng) => (m) => {
    if (home(m)) return HUB;
    const c = cands(m).sort((a, b) => dist(m, a) - dist(m, b) + (a.x < 4 ? -0.6 : 0) - (b.x < 4 ? -0.6 : 0));
    if (!c.length) return m.player.bag.length ? HUB : null;
    return rng() < 0.72 || c.length === 1 ? c[0] : c[1];
  },
  reader: (rng) => (m) => {
    if (home(m)) return HUB;
    const r = m.rival, ri = m.rivalIntent;
    const c = cands(m).map((n) => {
      let cost = dist(m, n);
      if (ri && ri.kind === 'node' && ri.id === n.id && dist(m, n, r) / r.speed < dist(m, n) / m.player.speed) cost += 6;
      return { n, cost: cost + rng() * 1.5 };
    }).sort((a, b) => a.cost - b.cost);
    return c.length ? c[0].n : m.player.bag.length ? HUB : null;
  },
};
function run(rival, bot) {
  let wins = 0, sn = 0;
  const model = new PlayerModel();
  for (let i = 0; i < N; i++) {
    const rng = mulberry32(i * 131 + 3);
    const m = new Match({ seed: 9000 + i, rival, model });
    const pol = BOTS[bot](rng);
    let t = 0;
    while (m.phase !== 'end' && t < 600) {
      if (m.phase === 'race' && m.player.state === 'idle' && !m.player.dest) { const g = pol(m); if (g) m.command(g.x, g.y); }
      m.step(DT); m.drainEvents(); t += DT;
    }
    const s = m.summary(); if (s.winner === 'player') wins++; sn += s.stats.snatched;
  }
  return `${Math.round((wins / N) * 100)}%/${(sn / N).toFixed(1)}`;
}
console.log('rival    bot      full(win/snatch)  blind   delta');
for (const base0 of RIVALS) {
  const base = { ...base0, ...(overrides[base0.id] || {}) };
  for (const bot of Object.keys(BOTS)) {
    const full = run(base, bot);
    const blind = run({ ...base, experts: [], heading: 0, steal: 0, deny: 0 }, bot);
    const d = parseInt(blind) - parseInt(full);
    console.log(`${base.name.padEnd(8)} ${bot.padEnd(8)} ${full.padEnd(17)} ${blind.padEnd(7)} ${d > 0 ? '+' : ''}${d}`);
  }
}
