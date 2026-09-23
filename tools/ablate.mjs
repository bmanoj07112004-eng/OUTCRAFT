// AI ablation: same rival speed and timings, with its prediction switched off / habits only / heading only.
// Answers "is the AI doing anything, or is it just a fast opponent?"   node tools/ablate.mjs [matches]
import { Match } from '../src/match.js';
import { PlayerModel } from '../src/model.js';
import { RIVALS } from '../src/data.js';
import { mulberry32 } from '../src/rng.js';
import { idx } from '../src/world.js';

const N = +(process.argv[2] || 150);
const DT = 1 / 30;
const HUB = { x: 4, y: 10 };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const dist = (m, n, a = m.player) => m.world.nodeField[n.id][idx(a.x, a.y)];

// "human" bot: mostly nearest, sometimes second nearest, mild left-side preference.
const human = (rng) => (m) => {
  const p = m.player;
  if (p.bag.length >= m.bagSize || (p.bag.length && !sum(m.needRemaining('player')))) return HUB;
  const need = m.needRemaining('player');
  const c = m.world.nodes.filter((n) => need[n.type] && !n.reserved && n.readyAt - m.time <= 1.5)
    .sort((a, b) => dist(m, a) - dist(m, b) + (a.x < 4 ? -0.6 : 0) - (b.x < 4 ? -0.6 : 0));
  if (!c.length) return p.bag.length ? HUB : null;
  return rng() < 0.72 || c.length === 1 ? c[0] : c[1];
};

function run(rival) {
  let wins = 0, snatch = 0;
  const kinds = { habit: 0, heading: 0, luck: 0 };
  const model = new PlayerModel();
  for (let i = 0; i < N; i++) {
    const rng = mulberry32(i * 97 + 5);
    const m = new Match({ seed: 5000 + i, rival, model });
    const pol = human(rng);
    let t = 0;
    while (m.phase !== 'end' && t < 600) {
      if (m.phase === 'race' && m.player.state === 'idle' && !m.player.dest) {
        const g = pol(m);
        if (g) m.command(g.x, g.y);
      }
      m.step(DT);
      for (const e of m.drainEvents()) if (e.type === 'snatch') kinds[e.text.kind]++;
      t += DT;
    }
    const s = m.summary();
    if (s.winner === 'player') wins++;
    snatch += s.stats.snatched;
  }
  return { win: wins / N, snatch: snatch / N, kinds };
}

const pct = (x) => `${Math.round(x * 100)}%`;
for (const base of RIVALS.slice(1)) {
  const variants = {
    full: base,
    habitsOnly: { ...base, heading: 0 },
    headingOnly: { ...base, experts: [] },
    blind: { ...base, experts: [], heading: 0, steal: 0, deny: 0 },
  };
  const out = [];
  for (const [k, r] of Object.entries(variants)) {
    const res = run(r);
    out.push(`${k}: player wins ${pct(res.win)}, snatches ${res.snatch.toFixed(2)} (habit ${res.kinds.habit} / heading ${res.kinds.heading} / luck ${res.kinds.luck})`);
  }
  console.log(`== ${base.name}\n  ` + out.join('\n  '));
}
