// Does the rival learn you? Measures how often the rival's top guess matches the node a bot player
// actually picks, match by match, against the chance rate of a uniform guess over the same options.
//   node tools/learning.mjs [players] [matches]
import { Match } from '../src/match.js';
import { PlayerModel, HABIT_IDS } from '../src/model.js';
import { RIVALS } from '../src/data.js';
import { mulberry32 } from '../src/rng.js';
import { idx } from '../src/world.js';

const PLAYERS = +(process.argv[2] || 60);
const MATCHES = +(process.argv[3] || 6);
const HUB = { x: 4, y: 10 };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const dist = (m, n) => m.world.nodeField[n.id][idx(m.player.x, m.player.y)];

// Three "people": a habitual beeliner, a human-ish mix, and a random wanderer (control).
const PEOPLE = {
  beeliner: (rng) => (c) => c[0],
  human: (rng) => (c) => (rng() < 0.72 || c.length === 1 ? c[0] : c[1]),
  random: (rng) => (c) => c[Math.floor(rng() * c.length)],
};

for (const [name, mk] of Object.entries(PEOPLE)) {
  const hits = Array(MATCHES).fill(0);
  const chance = Array(MATCHES).fill(0);
  const n = Array(MATCHES).fill(0);
  for (let p = 0; p < PLAYERS; p++) {
    const rng = mulberry32(p * 17 + 3);
    const pick = mk(rng);
    const model = new PlayerModel();
    for (let k = 0; k < MATCHES; k++) {
      const m = new Match({ seed: 20000 + p * 50 + k, rival: RIVALS[3], model });
      let t = 0;
      while (m.phase !== 'end' && t < 400) {
        if (m.phase === 'race' && m.player.state === 'idle' && !m.player.dest) {
          const pl = m.player;
          const need = m.needRemaining('player');
          let g = null;
          if (pl.bag.length >= m.bagSize || (pl.bag.length && !sum(need))) g = HUB;
          else {
            const c = m.world.nodes.filter((nd) => need[nd.type] && !nd.reserved && nd.readyAt - m.time < 1.5).sort((a, b) => dist(m, a) - dist(m, b));
            g = c.length ? pick(c) : pl.bag.length ? HUB : null;
            // Score the rival's habit prediction for this choice, before the player moves.
            if (g && m.ctx && m.ctx.habit) {
              const i = m.ctx.cands.findIndex((cd) => cd.id === g.id);
              if (i >= 0) {
                const best = m.ctx.habit.indexOf(Math.max(...m.ctx.habit));
                hits[k] += best === i ? 1 : 0;
                chance[k] += 1 / m.ctx.cands.length;
                n[k] += 1;
              }
            }
          }
          if (g) m.command(g.x, g.y);
        }
        m.step(1 / 30);
        m.drainEvents();
        t += 1 / 30;
      }
    }
  }
  const row = hits.map((h, k) => `${Math.round((100 * h) / n[k])}%`).join('  ');
  const ch = chance.map((c, k) => `${Math.round((100 * c) / n[k])}%`).join('  ');
  console.log(`${name.padEnd(9)} rival's top-guess accuracy, match 1..${MATCHES}: ${row}\n${''.padEnd(9)} uniform-guess chance:                  ${ch}`);
}
