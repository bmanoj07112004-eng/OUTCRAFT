// Adventure calibration: bot players progress through the 60 levels with each level's matchConfig (tap
// mode via match.command, the same Match + PlayerModel code as the game), retrying a failed level like a
// player would. Prints per level: win and pass rate per attempt, first-try pass rate, median score, the
// share of passes reaching 2 and 3 stars with the current thresholds, and suggested thresholds (2 stars
// ~ median passing score, 3 stars ~ 80th percentile and at least MIN_GAP higher). Ends with an economy
// projection (coins, gems and when the first shop skin and the first gem skin become affordable).
//
//   node tools/levels.mjs [players=40] [--levels=1-60] [--bot=human|greedy|random|reader] [--tries=8] [--salt=0]
import { Match } from '../src/match.js';
import { PlayerModel } from '../src/model.js';
import { LEVELS, WORLDS, matchConfig } from '../src/levels.js';
import { fresh, recordMatch } from '../src/storage.js';
import * as eco from '../src/economy.js';
import { SKINS } from '../src/skins.js';
import { mulberry32 } from '../src/rng.js';
import { idx } from '../src/world.js';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const N = +(args.find((a) => /^\d+$/.test(a)) || 40);
const [from, to] = flag('levels', `1-${LEVELS.length}`).split('-').map(Number);
const BOT = flag('bot', 'human');
const MAX_TRIES = +flag('tries', 8);
const SALT = +flag('salt', 0); // changes every bot's random choices, to check that results are stable
const DT = 1 / 30;
const HUB = { x: 4, y: 10 };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

// ------------------------------------------------------------ bots (from tools/sim.mjs)
const bagOf = (m) => (m.bagSizeFor ? m.bagSizeFor('player') : m.bagSize);
function readyNeeded(m, pad = 0) {
  const need = m.needRemaining('player');
  return m.world.nodes.filter((n) => need[n.type] && !n.reserved && n.readyAt - m.time <= pad);
}
function dist(m, n, a = m.player) {
  return m.world.nodeField[n.id][idx(a.x, a.y)];
}
function mustGoHome(m) {
  const p = m.player;
  return p.bag.length >= bagOf(m) || (p.bag.length && !sum(m.needRemaining('player')));
}

const BOTS = {
  greedy: () => (m) => {
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
  random: (rng) => (m) => {
    if (mustGoHome(m)) return HUB;
    const c = readyNeeded(m, 1.5);
    return c.length ? c[Math.floor(rng() * c.length)] : m.player.bag.length ? HUB : null;
  },
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
if (!BOTS[BOT]) throw new Error(`unknown bot ${BOT}`);

// Features of the extended match.js (options, score) that this tool depends on.
const probe = new Match({ ...matchConfig(LEVELS[0]), model: new PlayerModel() });
const HAS_OPTIONS = probe.orders.map((o) => o.id).join() === LEVELS[0].options.orders.join();
const HAS_SCORE = typeof probe.score === 'number';

function play(level, rng, model) {
  const cfg = matchConfig(level);
  const m = new Match({ seed: cfg.seed, rival: cfg.rival, twist: cfg.twist, options: cfg.options, model });
  const policy = BOTS[BOT](rng);
  let t = 0;
  let race = 0;
  while (m.phase !== 'end' && t < 900) {
    if (m.phase === 'race') {
      race += DT;
      if (m.player.state === 'idle' && !m.player.dest) {
        const target = policy(m);
        if (target) m.command(target.x, target.y);
      }
    }
    m.step(DT);
    m.drainEvents();
    t += DT;
  }
  const s = m.summary();
  if (s.score == null) s.score = m.score || 0;
  return { s, race, seconds: t };
}

// ------------------------------------------------------------ run the players
const levels = LEVELS.filter((l) => l.id >= from && l.id <= to);
const stats = new Map(levels.map((l) => [l.id, { tries: 0, wins: 0, passes: 0, first: 0, timeUps: 0, scores: [], race: [], stuck: 0 }]));

const DAY_MS = 86400000;
const SESSION_MS = 30 * 60 * 1000; // the projected player plays 30 minutes a day
const START = new Date(2026, 9, 1, 9, 0, 0).getTime();
const SHOP_SKINS = SKINS.filter((k) => k.price);
const firstCoinSkin = Math.min(...SHOP_SKINS.filter((k) => k.price.coins).map((k) => k.price.coins));
const firstGemSkin = Math.min(...SHOP_SKINS.filter((k) => k.price.gems).map((k) => k.price.gems));
const econ = { coinSkinAt: [], gemSkinAt: [], worldEnd: WORLDS.map(() => []) };

const t0 = Date.now();
for (let p = 0; p < N; p++) {
  const rng = mulberry32(p * 7919 + 13 + SALT * 104729);
  const model = new PlayerModel();
  const state = fresh();
  let now = START;
  let dayStart = START;
  let coinAt = null;
  let gemAt = null;
  for (const level of levels) {
    const st = stats.get(level.id);
    let passed = false;
    for (let tri = 0; tri < MAX_TRIES && !passed; tri++) {
      // A casual day: a 30 minute session, then come back the next morning; wait out empty hearts.
      if (now - dayStart > SESSION_MS) {
        const d = new Date(dayStart + DAY_MS);
        d.setHours(9, 0, 0, 0);
        now = dayStart = d.getTime();
      }
      eco.claimDaily(state, now);
      if (!eco.canStartLevel(state, now)) now += eco.heartsNow(state, now).nextInMs;

      const { s, race, seconds } = play(level, rng, model);
      recordMatch(state, s, { now });
      const r = eco.grantLevelResult(state, level, s, now);
      if (!r.passed) eco.loseHeart(state, now);
      for (const a of eco.achievementStatus(state)) if (a.canClaim) eco.claimAchievement(state, a.id);
      now += (seconds + 25) * 1000;

      passed = r.passed;
      st.tries++;
      st.wins += s.winner === 'player' ? 1 : 0;
      st.timeUps += s.timeUp ? 1 : 0;
      if (passed) {
        st.passes++;
        st.first += tri === 0 ? 1 : 0;
        st.scores.push(s.score);
        st.race.push(race);
      }
    }
    if (!passed) st.stuck++;
    if (coinAt === null && state.wallet.coins >= firstCoinSkin) coinAt = level.id;
    if (gemAt === null && state.wallet.gems >= firstGemSkin) gemAt = level.id;
    if (level.index === 9) econ.worldEnd[level.world].push({ coins: state.wallet.coins, gems: state.wallet.gems, stars: eco.totalStars(state), day: Math.round((now - START) / DAY_MS) + 1 });
  }
  econ.coinSkinAt.push(coinAt ?? Infinity);
  econ.gemSkinAt.push(gemAt ?? Infinity);
}

// ------------------------------------------------------------ report
const pct = (x) => `${Math.round(x * 100)}%`.padStart(4);
const quant = (arr, q) => {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const i = (a.length - 1) * q;
  const lo = Math.floor(i);
  return a[lo] + (a[Math.min(a.length - 1, lo + 1)] - a[lo]) * (i - lo);
};
const r50 = (x) => Math.round(x / 50) * 50;
const MIN_GAP = 100; // keep the third star a visibly separate target even when scores bunch up

console.log(`OUTCRAFT Adventure calibration: ${N} "${BOT}" bot players, levels ${from}-${to}, up to ${MAX_TRIES} tries per level (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (!HAS_OPTIONS || !HAS_SCORE) {
  console.log('WARNING: src/match.js does not support level options and/or score yet.');
  console.log(`         options (orders/starsToWin/timeLimit): ${HAS_OPTIONS ? 'yes' : 'NO'}   score: ${HAS_SCORE ? 'yes' : 'NO'}`);
  console.log('         Results below use the default orders and 3 stars; thresholds stay provisional.');
}
console.log('\n  #  level                   rival  twist       goal      time tUp | win  pass 1st  tries | med score | 2*   3*  (now: two/three) | suggest two/three | race s');
const suggested = new Map();
for (const level of levels) {
  const st = stats.get(level.id);
  const [, two, three] = level.thresholds;
  const med = quant(st.scores, 0.5);
  const p80 = quant(st.scores, 0.8);
  let sTwo = r50(med);
  let sThree = Math.max(sTwo + MIN_GAP, r50(p80));
  if (!st.scores.length) [sTwo, sThree] = [two, three];
  suggested.set(level.id, [sTwo, sThree]);
  const got2 = st.scores.filter((x) => x >= two).length / (st.scores.length || 1);
  const got3 = st.scores.filter((x) => x >= three).length / (st.scores.length || 1);
  const tag = level.boss ? 'B' : level.hard ? 'H' : ' ';
  console.log(
    `${String(level.id).padStart(3)}${tag} ${level.name.padEnd(22).slice(0, 22)} ${level.rival.padEnd(6)} ${(level.twist?.id || '-').padEnd(11)} ${level.goal.type.padEnd(9)} ${String(level.options.timeLimit || '-').padStart(4)} ${level.options.timeLimit ? pct(st.timeUps / st.tries) : '   -'} |` +
      ` ${pct(st.wins / st.tries)} ${pct(st.passes / st.tries)} ${pct(st.first / N)} ${(st.tries / N).toFixed(1).padStart(4)}${st.stuck ? '!' : ' '} |` +
      ` ${String(Math.round(med)).padStart(9)} | ${pct(got2)} ${pct(got3)} (${two}/${three}) | ${String(sTwo).padStart(6)}/${String(sThree).padEnd(6)} | ${quant(st.race, 0.5).toFixed(0).padStart(3)} (p90 ${quant(st.race, 0.9).toFixed(0)})`,
  );
  if (level.index === 9) console.log('');
}

console.log('World summary (pass rate per attempt, first-try pass rate):');
for (const w of WORLDS) {
  const ls = levels.filter((l) => l.world === w.index);
  if (!ls.length) continue;
  const tries = ls.reduce((s, l) => s + stats.get(l.id).tries, 0);
  const passes = ls.reduce((s, l) => s + stats.get(l.id).passes, 0);
  const first = ls.reduce((s, l) => s + stats.get(l.id).first, 0) / (ls.length * N);
  console.log(`  ${w.number} ${w.name.padEnd(16)} pass ${pct(passes / tries)}  first try ${pct(first)}`);
}

console.log('\nSuggested THRESHOLDS (paste into src/levels.js):');
const rows = [];
for (let i = 0; i < LEVELS.length; i += 10) {
  rows.push('  ' + LEVELS.slice(i, i + 10).map((l) => `[${(suggested.get(l.id) || l.thresholds.slice(1)).join(', ')}]`).join(', ') + ',');
}
console.log(rows.join('\n'));

console.log(`\nEconomy projection (no spending, daily reward claimed on each ${SESSION_MS / 60000}-minute play day, achievements claimed):`);
const med = (a) => quant(a, 0.5);
console.log(`  first coin skin (${firstCoinSkin} coins) affordable after level: median ${med(econ.coinSkinAt)}  (p25 ${quant(econ.coinSkinAt, 0.25)}, p75 ${quant(econ.coinSkinAt, 0.75)})`);
console.log(`  first gem skin (${firstGemSkin} gems) affordable after level: median ${med(econ.gemSkinAt)}  (p25 ${quant(econ.gemSkinAt, 0.25)}, p75 ${quant(econ.gemSkinAt, 0.75)})`);
for (const w of WORLDS) {
  const e = econ.worldEnd[w.index];
  if (!e.length) continue;
  console.log(`  end of world ${w.number}: coins ${Math.round(med(e.map((x) => x.coins)))}, gems ${Math.round(med(e.map((x) => x.gems)))}, stars ${Math.round(med(e.map((x) => x.stars)))}, play day ${Math.round(med(e.map((x) => x.day)))}`);
}
