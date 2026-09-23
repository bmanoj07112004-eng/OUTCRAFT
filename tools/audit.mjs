// Audit of the writeup's AI claims.   node tools/audit.mjs [matches] [players] [matchesPerPlayer]
// (1) Control arms: "blind" (tune.mjs) switches off prediction AND contesting. "contest-only" keeps the rival's
//     steal/deny weights but gives it a uniform belief about you (no habit models, no heading), so
//     full vs contest-only isolates what learning adds. Same islands and bots as tools/tune.mjs.
// (2) Honesty over repeated looks: random choosers vs FOX, checked after every match: how many ever get a
//     NEW TELL card (z-gated: n >= 8, lift >= 25 points, z >= 2.6) or a dossier habit claim (significance-gated)?
import { Match } from '../src/match.js';
import { PlayerModel } from '../src/model.js';
import { RIVALS } from '../src/data.js';
import { mulberry32 } from '../src/rng.js';
import { idx } from '../src/world.js';
import { recordMatch } from '../src/storage.js';

const N = +(process.argv[2] || 150);
const PLAYERS = +(process.argv[3] || 300);
const PER = +(process.argv[4] || 15);
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
  random: (rng) => (m) => {
    if (home(m)) return HUB;
    const c = cands(m);
    return c.length ? c[Math.floor(rng() * c.length)] : m.player.bag.length ? HUB : null;
  },
};

function play(m, pol) {
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
  return m.summary();
}

function run(rival, bot) {
  let wins = 0, sn = 0, choices = 0;
  const model = new PlayerModel();
  for (let i = 0; i < N; i++) {
    const s = play(new Match({ seed: 9000 + i, rival, model }), BOTS[bot](mulberry32(i * 131 + 3)));
    if (s.winner === 'player') wins++;
    sn += s.stats.snatched;
    choices += s.stats.predN;
  }
  return { cell: `${Math.round((wins / N) * 100)}%/${(sn / N).toFixed(1)}`, choices: choices / N };
}

console.log(`$ node tools/audit.mjs ${N} ${PLAYERS} ${PER}`);
console.log(`(1) player win% / snatches per match, ${N} matches per cell (same islands as tune.mjs)`);
console.log('rival    bot      full        contest-only  blind       choices/match');
for (const base of RIVALS.slice(1)) {
  for (const bot of ['greedy', 'human', 'reader']) {
    const f = run(base, bot);
    const u = run({ ...base, experts: [], heading: 0 }, bot);
    const b = run({ ...base, experts: [], heading: 0, steal: 0, deny: 0 }, bot);
    console.log(`${base.name.padEnd(8)} ${bot.padEnd(8)} ${f.cell.padEnd(11)} ${u.cell.padEnd(13)} ${b.cell.padEnd(11)} ${f.choices.toFixed(1)}`);
  }
}

let tellFirst = 0, tellAny = 0, claimAny = 0;
for (let p = 0; p < PLAYERS; p++) {
  const rng = mulberry32(p * 7919 + 11);
  const model = new PlayerModel();
  const state = { ladder: { unlocked: 0, beaten: {} }, codex: {}, dex: {}, stats: { matches: 0, wins: 0, snatched: 0, outread: 0, history: [] }, daily: { lastKey: null, streak: 0, best: 0, results: {} } };
  let told = false, claimed = false;
  for (let k = 0; k < PER; k++) {
    const s = play(new Match({ seed: 20000 + p * 50 + k, rival: RIVALS[2], model }), BOTS.random(rng));
    const rec = recordMatch(state, s, { rivalIndex: 2 });
    if (rec.events.some((e) => e.type === 'detected')) {
      if (k === 0) tellFirst++;
      told = true;
    }
    if (model.dossier(2).length) claimed = true;
  }
  if (told) tellAny++;
  if (claimed) claimAny++;
}
const pc = (x) => `${((x / PLAYERS) * 100).toFixed(1)}%`;
console.log(`\n(2) ${PLAYERS} random choosers x ${PER} matches vs FOX, checked after every match`);
console.log(`NEW TELL card in match 1: ${pc(tellFirst)} | any NEW TELL card: ${pc(tellAny)} | any dossier habit claim: ${pc(claimAny)}`);
