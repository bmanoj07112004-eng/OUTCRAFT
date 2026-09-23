// Balance experiments: try economy/rival configs and compare full AI vs blind for several bots.
//   node tools/experiment.mjs [matches] '<json configs array>'
import { Match } from '../src/match.js';
import { PlayerModel } from '../src/model.js';
import { RIVALS, RES } from '../src/data.js';
import { mulberry32 } from '../src/rng.js';
import { idx } from '../src/world.js';

const N = +(process.argv[2] || 80);
const configs = JSON.parse(process.argv[3] || '[{}]');
const DT = 1 / 30;
const HUB = { x: 4, y: 10 };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const dist = (m, n, a = m.player) => m.world.nodeField[n.id][idx(a.x, a.y)];
const home = (m) => m.player.bag.length >= m.bagSize || (m.player.bag.length && !sum(m.needRemaining('player')));
const cands = (m) => {
  const need = m.needRemaining('player');
  return m.world.nodes.filter((n) => need[n.type] && !n.reserved && n.readyAt - m.time <= 1.5);
};
const BOTS = {
  greedy: () => (m) => (home(m) ? HUB : cands(m).sort((a, b) => dist(m, a) - dist(m, b))[0] || (m.player.bag.length ? HUB : null)),
  human: (rng) => (m) => {
    if (home(m)) return HUB;
    const c = cands(m).sort((a, b) => dist(m, a) - dist(m, b) + (a.x < 4 ? -0.6 : 0) - (b.x < 4 ? -0.6 : 0));
    if (!c.length) return m.player.bag.length ? HUB : null;
    return rng() < 0.72 || c.length === 1 ? c[0] : c[1];
  },
  reader: (rng) => (m) => {
    if (home(m)) return HUB;
    const r = m.rival;
    const ri = m.rivalIntent;
    const c = cands(m)
      .map((n) => {
        let cost = dist(m, n);
        if (ri && ri.kind === 'node' && ri.id === n.id && dist(m, n, r) / r.speed < dist(m, n) / m.player.speed) cost += 6;
        return { n, cost: cost + rng() * 1.5 };
      })
      .sort((a, b) => a.cost - b.cost);
    return c.length ? c[0].n : m.player.bag.length ? HUB : null;
  },
};

function run(rival, bot, twist) {
  let wins = 0;
  let sn = 0;
  const model = new PlayerModel();
  for (let i = 0; i < N; i++) {
    const rng = mulberry32(i * 131 + 3);
    const m = new Match({ seed: 9000 + i, rival, model, twist });
    const pol = BOTS[bot](rng);
    let t = 0;
    while (m.phase !== 'end' && t < 600) {
      if (m.phase === 'race' && m.player.state === 'idle' && !m.player.dest) {
        const g = pol(m);
        if (g) m.command(g.x, g.y);
      }
      m.step(DT);
      m.drainEvents();
      t += DT;
    }
    const s = m.summary();
    if (s.winner === 'player') wins++;
    sn += s.stats.snatched;
  }
  return { win: Math.round((wins / N) * 100), sn: +(sn / N).toFixed(1) };
}

for (const cfg of configs) {
  console.log(`\n### config ${JSON.stringify(cfg)}`);
  const twist = { respawnMul: cfg.respawnMul || 1 };
  for (const base0 of RIVALS) {
    if (cfg.only && !cfg.only.includes(base0.id)) continue;
    const base = { ...base0, ...((cfg.rivals || {})[base0.id] || {}) };
    const out = [];
    for (const bot of Object.keys(BOTS)) {
      const f = run(base, bot, twist);
      const b = run({ ...base, experts: [], heading: 0, steal: 0, deny: 0 }, bot, twist);
      out.push(`${bot} ${f.win}% (blind ${b.win}%, ai +${b.win - f.win})`);
    }
    console.log(`${base.name.padEnd(6)} ${out.join(' | ')}`);
  }
}
