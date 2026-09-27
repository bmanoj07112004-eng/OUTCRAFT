// Adventure calibration: bot players progress through the 60 levels with each level's matchConfig (the
// same Match + PlayerModel code as the game), retrying a failed level like a player would. Two bot
// families: tap bots (match.command, the 2D controls) and stick bots (match.setMove, the 3D joystick)
// in three skill presets. Prints per level, for the calibration group (default: the average stick
// player): win and pass rate per attempt, first-try pass rate, score quantiles, the share of passes
// reaching 2 and 3 stars with the current thresholds, and suggested thresholds (2 stars ~ median passing
// score; 3 stars ~ 80th percentile, at least max(400, 10% of two) higher and above any ordinary win; see
// suggest()), plus the pass rate of every other group; then a per-world summary per group, what each star
// band took, and an economy projection.
//
//   node tools/levels.mjs [players=40] [--pop=mixed] [--cal=average] [--levels=1-60] [--warm=0] [--tries=8] [--salt=0] [--json=out.json]
//
// --pop: 'mixed' (default, casual:3,average:4,skilled:2,human:1), one group, or a weighted list such as
// casual:1,average:2. Groups: casual, average, skilled (stick bots), human, greedy, random, reader (tap
// bots). Players are dealt round-robin from the weights. --bot=<tap bot> is the old single-bot mode.
// --json writes every pass (score parts, won order times) for offline analysis.
import { writeFileSync } from 'node:fs';
import { Match } from '../src/match.js';
import { PlayerModel } from '../src/model.js';
import { LEVELS, WORLDS, matchConfig } from '../src/levels.js';
import { SCORE, ITEM_BY_ID, COMPONENTS } from '../src/data.js';
import { fresh, recordMatch } from '../src/storage.js';
import * as eco from '../src/economy.js';
import { SKINS } from '../src/skins.js';
import { mulberry32 } from '../src/rng.js';
import { W, idx, nextStep, isWalkable } from '../src/world.js';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const N = +(args.find((a) => /^\d+$/.test(a)) || 40);
// --levels: a range or a list of ranges (1-60, 4,5,33-35). --warm=K: before a level whose predecessor is
// not in the list, each player first plays the K levels before it once, unscored, so the rival's notes on
// the player look like they would in a full run.
const PICK = new Set(flag('levels', `1-${LEVELS.length}`).split(',').flatMap((r) => {
  const [a, b = a] = r.split('-').map(Number);
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}));
const WARM = +flag('warm', 0);
const MAX_TRIES = +flag('tries', 8);
const SALT = +flag('salt', 0); // changes every bot's random choices, to check that results are stable
const JSON_OUT = flag('json', null);
const DT = 1 / 30;
const HUB = { x: 4, y: 10 };
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

// ------------------------------------------------------------ tap bots (from tools/sim.mjs)
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

const TAP = {
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

// Tap control: a new target whenever the player stands idle with nowhere to go.
function tapDriver(name, rng) {
  const policy = TAP[name](rng);
  return (m) => {
    if (m.phase === 'race' && m.player.state === 'idle' && !m.player.dest) {
      const target = policy(m);
      if (target) m.command(target.x, target.y);
    }
  };
}

// ------------------------------------------------------------ stick bots (joystick players)
// A thumb on a joystick, through match.setMove only: steer along the BFS path toward the chosen node
// (or the Workshop), aiming a few path tiles ahead when the line is clear, with a heading error that
// drifts; take a moment to decide after GO, every gather and deposit, and to notice a lost target;
// sometimes hesitate, sometimes pick a farther node or head home half full; press HOME now and then.
// Skilled players also glance at the rival and switch away from a node it will reach first.
//
// react: decision delay (mean, +-spread) s; noise: heading error sd (rad), drifting over `drift` s;
// hesitate: chance of a pause (pause range, s) at a decision; fuzz: how sloppily nodes are compared
// (softmax temperature in tiles of path: 2 = a node 2 tiles farther is picked e^-1 as often); look: path
// tiles steered ahead; watch: chance a decision (or a glance every 0.5 s on the way) accounts for the
// rival; early: chance of heading home part full; home: chance of pressing HOME instead of steering
// home; mag: how far the stick is pushed.
const STICK = {
  casual: { react: [0.4, 0.18], noise: 0.3, drift: 0.5, hesitate: 0.12, pause: [0.3, 1.2], fuzz: 2, look: 2, watch: 0.05, early: 0.08, home: 0.35, mag: 0.97 },
  average: { react: [0.28, 0.12], noise: 0.22, drift: 0.45, hesitate: 0.07, pause: [0.3, 0.9], fuzz: 1.2, look: 3, watch: 0.3, early: 0.04, home: 0.25, mag: 1 },
  skilled: { react: [0.14, 0.07], noise: 0.12, drift: 0.4, hesitate: 0.02, pause: [0.2, 0.5], fuzz: 0.5, look: 4, watch: 0.75, early: 0.01, home: 0.15, mag: 1 },
};
const HOME = { kind: 'hub' };
const RIVAL_EDGE = 0.3; // seconds: a watching player gives up a node the rival would reach first or within this much after it

// Can a circle of the player's size travel in a straight line from (x0, y0) to the tile centre (x1, y1)?
function clearLine(w, x0, y0, x1, y1) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(len / 0.25);
  for (let i = 1; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    for (const [ox, oy] of [[0, 0], [0.34, 0], [-0.34, 0], [0, 0.34], [0, -0.34]]) if (!isWalkable(w, Math.round(x + ox), Math.round(y + oy))) return false;
  }
  return true;
}

class StickBot {
  constructor(skill, rng) {
    this.k = skill;
    this.rng = rng;
    // Every player has its own pace and steadiness within the preset.
    this.pace = Math.exp(gauss(rng) * 0.2);
    this.noise = skill.noise * Math.exp(gauss(rng) * 0.2);
    this.reset();
  }
  reset() {
    this.target = null;
    this.wait = -1; // decision delay left; -1 = not started
    this.notice = -1; // time left to notice that the current target is gone
    this.pause = 0;
    this.theta = 0;
    this.homing = false;
    this.glance = 0.5;
    this.stuck = 0;
    this.careful = 0;
  }
  reaction() {
    const [mean, spread] = this.k.react;
    return Math.max(0.05, (mean + (this.rng() * 2 - 1) * spread) * this.pace);
  }
  drive(m, events) {
    const p = m.player;
    if (m.phase !== 'race') {
      if (this.target || this.homing || this.wait >= 0) this.reset();
      m.setMove(0, 0);
      return;
    }
    for (const e of events) {
      if ((e.type === 'gather' || e.type === 'deposit') && e.who === 'player') {
        this.target = null;
        this.homing = false;
        this.notice = -1;
        this.wait = this.reaction();
      } else if (e.type === 'snatch' && this.target && this.notice < 0) this.notice = this.reaction();
    }
    // Heading error: a slow random walk around zero.
    const k = this.k;
    this.theta += (-this.theta / k.drift) * DT + this.noise * Math.sqrt((2 * DT) / k.drift) * gauss(this.rng);
    if (p.state === 'gather' || p.state === 'deposit') return;
    if (this.homing) {
      if (!p.free && p.dest) return m.setMove(0, 0); // HOME runs by itself; a push would cancel it
      this.homing = false;
    }
    if (this.wait < 0 && !this.target) this.wait = this.reaction(); // GO: read the card
    if (this.target && this.notice < 0 && !this.valid(m)) this.notice = this.reaction();
    if (this.notice >= 0) {
      this.notice -= DT;
      if (this.notice <= 0) {
        this.notice = -1;
        this.target = null;
        this.wait = 0;
      }
    }
    // A glance at the rival on the way: switch if it is going for my node and will get there first.
    if (this.target && this.target.kind === 'node' && this.notice < 0 && (this.glance -= DT) <= 0) {
      this.glance = 0.5;
      if (this.rng() < k.watch && this.rivalFirst(m, this.target.id)) this.notice = this.reaction() * 0.5;
    }
    if (!this.target) {
      if (this.wait > 0 && (this.wait -= DT) > 0) return m.setMove(0, 0);
      this.target = this.choose(m);
      this.wait = -1;
      if (!this.target) return m.setMove(0, 0);
      if (this.rng() < k.hesitate) this.pause = k.pause[0] + this.rng() * (k.pause[1] - k.pause[0]);
      if (this.target.kind === 'hub' && this.rng() < k.home) {
        m.setMove(0, 0);
        if (m.command(HUB.x, m.world.hubY)) {
          this.homing = true;
          return;
        }
      }
    }
    if (this.pause > 0) {
      this.pause -= DT;
      return m.setMove(0, 0);
    }
    this.steer(m);
  }
  rivalFirst(m, id) {
    const ri = m.rivalIntent;
    if (!ri || ri.kind !== 'node' || ri.id !== id) return false;
    const f = m.world.nodeField[id];
    const r = m.rival;
    const p = m.player;
    const dR = f[idx(r.x, r.y)];
    const dP = f[idx(p.x, p.y)];
    return dR >= 0 && dP >= 0 && dR / r.speed < dP / p.speed + RIVAL_EDGE;
  }
  choose(m) {
    const p = m.player;
    const k = this.k;
    const need = m.needRemaining('player');
    const bag = p.bag.length;
    if (bag >= bagOf(m) || (bag && !sum(need))) return HOME;
    const here = idx(p.x, p.y);
    const watching = this.rng() < k.watch;
    const c = [];
    for (const n of m.world.nodes) {
      if (!need[n.type] || n.reserved) continue;
      const d = m.world.nodeField[n.id][here];
      if (d < 0) continue;
      const eta = d / p.speed;
      const regrow = n.readyAt - m.time;
      if (regrow > eta + 1) continue;
      let cost = d + Math.max(0, regrow - eta) * p.speed;
      if (watching && this.rivalFirst(m, n.id)) cost += 6;
      c.push({ n, cost });
    }
    if (!c.length) {
      if (bag) return HOME;
      // Nothing ready: walk to whatever regrows first and wait there.
      let best = null;
      for (const n of m.world.nodes) if (need[n.type] && !n.reserved && (!best || n.readyAt < best.readyAt)) best = n;
      return best ? { kind: 'node', id: best.id, patient: true } : null;
    }
    if (bag && this.rng() < k.early) return HOME;
    const best = Math.min(...c.map((x) => x.cost));
    let total = 0;
    for (const x of c) total += x.w = Math.exp((best - x.cost) / k.fuzz);
    let r = this.rng() * total;
    const pick = c.find((x) => (r -= x.w) <= 0) || c[0];
    return { kind: 'node', id: pick.n.id };
  }
  valid(m) {
    const t = this.target;
    const p = m.player;
    if (t.kind === 'hub') return p.bag.length > 0;
    const n = m.world.nodes[t.id];
    if (!m.needRemaining('player')[n.type] || p.bag.length >= bagOf(m) || n.reserved === 'rival') return false;
    const d = m.world.nodeField[n.id][idx(p.x, p.y)];
    return t.patient || n.readyAt - m.time <= d / p.speed + 2.5;
  }
  steer(m) {
    const p = m.player;
    const w = m.world;
    const t = this.target;
    let field;
    let tx;
    let ty;
    if (t.kind === 'hub') {
      field = w.hubField;
      let best = Infinity;
      for (const i of w.workshop) {
        const x = i % W;
        const y = Math.floor(i / W);
        const d = Math.hypot(x - p.fx, y - p.fy);
        if (d < best) [best, tx, ty] = [d, x, y];
      }
    } else {
      field = w.nodeField[t.id];
      tx = w.nodes[t.id].x;
      ty = w.nodes[t.id].y;
    }
    const d = field[idx(p.x, p.y)];
    if (d < 0) return m.setMove(0, 0);
    // Unstick: pushing but not moving for a while -> steer carefully tile by tile; later re-decide.
    this.stuck = p.state === 'idle' ? this.stuck + DT : 0;
    if (this.stuck > 0.5) this.careful = 1.5;
    if (this.stuck > 2) {
      this.target = null;
      this.stuck = 0;
      return m.setMove(0, 0);
    }
    const careful = (this.careful -= DT) > 0;
    let gx = tx;
    let gy = ty;
    if (d > 0) {
      let x = p.x;
      let y = p.y;
      let dx = 0;
      let dy = 0;
      const look = careful ? 1 : this.k.look;
      for (let i = 0; i < look; i++) {
        const s = nextStep(w, field, x, y, dx, dy);
        if (!s) break;
        ({ x, y, dx, dy } = s);
        if (i > 0 && !clearLine(w, p.fx, p.fy, x, y)) break;
        gx = x;
        gy = y;
      }
    }
    const ang = Math.atan2(gy - p.fy, gx - p.fx) + (careful ? 0 : this.theta);
    m.setMove(Math.cos(ang) * this.k.mag, Math.sin(ang) * this.k.mag);
  }
}

function driverFor(group, rng) {
  if (STICK[group]) {
    const bot = new StickBot(STICK[group], rng);
    return (m, events) => bot.drive(m, events);
  }
  return tapDriver(group, rng);
}

// ------------------------------------------------------------ population
const POPS = { mixed: 'casual:3,average:4,skilled:2,human:1' };
const POP = flag('pop', flag('bot', 'mixed'));
const weights = (POPS[POP] || POP).split(',').map((s) => {
  const [g, w = '1'] = s.split(':');
  if (!STICK[g] && !TAP[g]) throw new Error(`unknown bot group ${g}`);
  return { g, w: +w };
});
const GROUPS = weights.map((x) => x.g);
const DEAL = weights.flatMap(({ g, w }) => new Array(w).fill(g));
const CAL = flag('cal', GROUPS.includes('average') ? 'average' : GROUPS[0]);
if (!GROUPS.includes(CAL)) throw new Error(`calibration group ${CAL} is not in the population`);

// Features of the extended match.js (options, score) that this tool depends on.
const probe = new Match({ ...matchConfig(LEVELS[0]), model: new PlayerModel() });
const HAS_OPTIONS = probe.orders.map((o) => o.id).join() === LEVELS[0].options.orders.join();
const HAS_SCORE = typeof probe.score === 'number';

// One match; returns the summary plus the score split by reason and the won orders' [tier, seconds,
// index, par scale].
function play(level, driver, model) {
  const cfg = matchConfig(level);
  const m = new Match({ seed: cfg.seed, rival: cfg.rival, twist: cfg.twist, options: cfg.options, model });
  const parts = {};
  const won = [];
  let go = 0;
  let events = [];
  let t = 0;
  let race = 0;
  while (m.phase !== 'end' && t < 900) {
    if (m.phase === 'race') race += DT;
    driver(m, events);
    m.step(DT);
    events = m.drainEvents();
    for (const e of events) {
      if (e.type === 'go') go = e.t;
      else if (e.type === 'complete' && e.who === 'player') won.push([e.item.tier, +(e.t - go).toFixed(3), m.orderIndex, m.parScale ?? 1]);
      else if (e.type === 'score') {
        const q = (parts[e.reason] ||= { n: 0, pts: 0 });
        q.n++;
        q.pts += e.add;
      }
    }
    t += DT;
  }
  const s = m.summary();
  if (s.score == null) s.score = m.score || 0;
  return { s, race, seconds: t, parts, won };
}

// The best score a win can reach without a speed bonus, an outread or a fake-out: every order the match
// can play (2 * starsToWin - 1) fully gathered and crafted, plus flawless only when the goal demands it.
// Three stars must take more than that (tools/test-meta.mjs checks the same rule).
function ordinaryWin(level) {
  const stw = level.options.starsToWin;
  const flawless = level.goal.type === 'flawless';
  const orders = level.options.orders.slice(0, flawless ? stw : 2 * stw - 1).map((id) => ITEM_BY_ID[id]);
  let pts = SCORE.matchWin + stw * SCORE.order + (flawless ? SCORE.flawless : 0);
  for (const it of orders) for (const part of it.parts) pts += SCORE.craft + COMPONENTS[part].needs.length * SCORE.gather;
  return pts;
}

// ------------------------------------------------------------ run the players
const levels = LEVELS.filter((l) => PICK.has(l.id));
const blank = () => ({ tries: 0, wins: 0, passes: 0, first: 0, timeUps: 0, stuck: 0, players: 0, scores: [], race: [], plays: [] });
const stats = new Map(levels.map((l) => [l.id, Object.fromEntries(GROUPS.map((g) => [g, blank()]))]));
const dump = [];

const DAY_MS = 86400000;
const SESSION_MS = 30 * 60 * 1000; // the projected player plays 30 minutes a day
const START = new Date(2026, 9, 1, 9, 0, 0).getTime();
const SHOP_SKINS = SKINS.filter((k) => k.price);
const firstCoinSkin = Math.min(...SHOP_SKINS.filter((k) => k.price.coins).map((k) => k.price.coins));
const firstGemSkin = Math.min(...SHOP_SKINS.filter((k) => k.price.gems).map((k) => k.price.gems));
const econ = { coinSkinAt: [], gemSkinAt: [], worldEnd: WORLDS.map(() => []) };

const t0 = Date.now();
for (let p = 0; p < N; p++) {
  const group = DEAL[p % DEAL.length];
  const rng = mulberry32(p * 7919 + 13 + SALT * 104729);
  const driver = driverFor(group, rng);
  const model = new PlayerModel();
  const state = fresh();
  let now = START;
  let dayStart = START;
  let coinAt = null;
  let gemAt = null;
  for (const level of levels) {
    if (WARM && !PICK.has(level.id - 1)) for (const w of LEVELS.slice(Math.max(0, level.id - 1 - WARM), level.id - 1)) play(w, driver, model);
    const st = stats.get(level.id)[group];
    st.players++;
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

      const { s, race, seconds, parts, won } = play(level, driver, model);
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
        const n = (r) => parts[r]?.n || 0;
        st.plays.push({ score: s.score, speed: parts.speed?.pts || 0, reads: n('outread') + n('fooled'), flawless: n('flawless'), rivalStars: s.stars.rival });
        if (JSON_OUT) dump.push({ level: level.id, group, player: p, tri, score: s.score, rivalStars: s.stars.rival, timeUp: s.timeUp, race: +race.toFixed(2), parts, won });
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
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ pop: POP, n: N, salt: SALT, score: SCORE, passes: dump }));

// ------------------------------------------------------------ report
const pct = (x) => `${Math.round(x * 100)}%`.padStart(4);
const quant = (arr, q) => {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const i = (a.length - 1) * q;
  const lo = Math.floor(i);
  const [v, w] = [a[lo], a[Math.min(a.length - 1, lo + 1)]];
  return v === w ? v : v + (w - v) * (i - lo); // (Infinity = never, in the economy projection)
};
const r50 = (x) => Math.round(x / 50) * 50;
const up50 = (x) => Math.ceil(x / 50) * 50;
const minGap = (two) => Math.max(400, two * 0.1); // the third star stays a clearly separate goal
const share = (scores, x) => scores.filter((v) => v >= x).length / (scores.length || 1);

// Suggested [two, three] from the calibration group's passing scores: two ~ median; three = the multiple
// of 50 whose share of passes is closest to 20% (~ 80th percentile), but at least minGap above two and
// above an ordinary win. Where scores bunch up (short races, flawless goals) that gap would push three
// past nearly every pass, so two steps down: first while at most 65% of passes reach it, until 15% reach
// three; then, only if needed to keep the third star within reach of fast play, until 12% do.
function suggest(level, scores) {
  const ord = up50(ordinaryWin(level) + 1);
  const threeFor = (two) => {
    let t = Math.max(up50(two + minGap(two)), ord);
    while (share(scores, t + 50) >= 0.2) t += 50;
    return share(scores, t) - 0.2 > 0.2 - share(scores, t + 50) ? t + 50 : t;
  };
  let two = r50(quant(scores, 0.5));
  let three = threeFor(two);
  for (const [cap2, min3] of [[0.65, 0.15], [1, 0.12]]) {
    while (share(scores, three) < min3 && two > 50 && share(scores, two - 50) <= cap2) {
      two -= 50;
      three = threeFor(two);
    }
  }
  return [two, three];
}
const others = GROUPS.filter((g) => g !== CAL);

console.log(`OUTCRAFT Adventure calibration: ${N} players (${POPS[POP] || POP}), ${levels.length} levels${WARM ? ` (warm-up ${WARM})` : ''}, up to ${MAX_TRIES} tries per level (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (!HAS_OPTIONS || !HAS_SCORE) {
  console.log('WARNING: src/match.js does not support level options and/or score yet.');
  console.log(`         options (orders/starsToWin/timeLimit): ${HAS_OPTIONS ? 'yes' : 'NO'}   score: ${HAS_SCORE ? 'yes' : 'NO'}`);
  console.log('         Results below use the default orders and 3 stars; thresholds stay provisional.');
}
console.log(`\nCalibration group: ${CAL} (${stats.get(levels[0].id)[CAL].players} players). Pass = per attempt; 2*/3* = share of passes. Other groups: pass per attempt.`);
console.log(`  #  level                  rival  twist      goal      time tUp | win  pass 1st  tries | score p50  p80 | 2*   3*  (now two/three) | suggest two/three | ${others.map((g) => g.slice(0, 7).padStart(7)).join(' ')} | race s`);
const suggested = new Map();
for (const level of levels) {
  const st = stats.get(level.id)[CAL];
  const [, two, three] = level.thresholds;
  const med = quant(st.scores, 0.5);
  const p80 = quant(st.scores, 0.8);
  const [sTwo, sThree] = st.scores.length ? suggest(level, st.scores) : [two, three];
  suggested.set(level.id, [sTwo, sThree]);
  const tag = level.boss ? 'B' : level.hard ? 'H' : ' ';
  const n = st.players || 1;
  console.log(
    `${String(level.id).padStart(3)}${tag} ${level.name.padEnd(22).slice(0, 22)} ${level.rival.padEnd(6)} ${(level.twist?.id || '-').padEnd(10)} ${level.goal.type.padEnd(9)} ${String(level.options.timeLimit || '-').padStart(4)} ${level.options.timeLimit ? pct(st.timeUps / (st.tries || 1)) : '   -'} |` +
      ` ${pct(st.wins / (st.tries || 1))} ${pct(st.passes / (st.tries || 1))} ${pct(st.first / n)} ${(st.tries / n).toFixed(1).padStart(4)}${st.stuck ? '!' : ' '} |` +
      `      ${String(Math.round(med)).padStart(4)} ${String(Math.round(p80)).padStart(4)} | ${pct(share(st.scores, two))} ${pct(share(st.scores, three))} (${two}/${three}) | ${String(sTwo).padStart(6)}/${String(sThree).padEnd(6)} |` +
      ` ${others.map((g) => pct(stats.get(level.id)[g].passes / (stats.get(level.id)[g].tries || 1)).padStart(7)).join(' ')} | ${quant(st.race, 0.5).toFixed(0).padStart(3)} (p90 ${quant(st.race, 0.9).toFixed(0)})`,
  );
  if (level.index === 9) console.log('');
}

console.log('World summary per group: pass rate per attempt, first-try pass rate, share of passes with 2 and 3 stars (current thresholds):');
console.log(`  world              ${GROUPS.map((g) => g.padEnd(24)).join(' ')}`);
for (const w of WORLDS) {
  const ls = levels.filter((l) => l.world === w.index);
  if (!ls.length) continue;
  const cells = GROUPS.map((g) => {
    const all = ls.map((l) => ({ l, st: stats.get(l.id)[g] }));
    const tries = all.reduce((s, x) => s + x.st.tries, 0) || 1;
    const passes = all.reduce((s, x) => s + x.st.passes, 0);
    const first = all.reduce((s, x) => s + x.st.first, 0) / (all.reduce((s, x) => s + x.st.players, 0) || 1);
    const got2 = all.reduce((s, x) => s + x.st.scores.filter((v) => v >= x.l.thresholds[1]).length, 0) / (passes || 1);
    const got3 = all.reduce((s, x) => s + x.st.scores.filter((v) => v >= x.l.thresholds[2]).length, 0) / (passes || 1);
    return `${pct(passes / tries)} ${pct(first)} ${pct(got2)} ${pct(got3)}`.padEnd(24);
  });
  console.log(`  ${w.number} ${w.name.padEnd(16)} ${cells.join(' ')}`);
}
console.log(`  (columns per group: pass, first try, 2*, 3*)`);

// What the stars took: the calibration group's passes split by stars earned (current thresholds).
console.log(`\nWhat each star band took (${CAL}, current thresholds): share of passes, mean score, speed bonus, outreads + fake-outs, flawless, rival stars`);
const bands = [[], [], [], []];
for (const level of levels) for (const x of stats.get(level.id)[CAL].plays) bands[1 + (x.score >= level.thresholds[1]) + (x.score >= level.thresholds[2])].push(x);
const nPlays = bands.reduce((s, b) => s + b.length, 0) || 1;
const mean = (b, f) => b.reduce((s, x) => s + f(x), 0) / (b.length || 1);
for (const k of [1, 2, 3]) {
  const b = bands[k];
  console.log(`  ${k} star${k > 1 ? 's' : ' '} ${pct(b.length / nPlays)}  score ${Math.round(mean(b, (x) => x.score))}  speed ${Math.round(mean(b, (x) => x.speed))}  reads ${mean(b, (x) => x.reads).toFixed(2)}  flawless ${pct(mean(b, (x) => x.flawless))}  rival stars ${mean(b, (x) => x.rivalStars).toFixed(2)}`);
}

console.log('\nSuggested THRESHOLDS (paste into src/levels.js):');
const rows = [];
for (let i = 0; i < LEVELS.length; i += 10) {
  rows.push('  ' + LEVELS.slice(i, i + 10).map((l) => `[${(suggested.get(l.id) || l.thresholds.slice(1)).join(', ')}]`).join(', ') + ',');
}
console.log(rows.join('\n'));

console.log(`\nEconomy projection (all players, no spending, daily reward claimed on each ${SESSION_MS / 60000}-minute play day, achievements claimed):`);
const med = (a) => quant(a, 0.5);
console.log(`  first coin skin (${firstCoinSkin} coins) affordable after level: median ${med(econ.coinSkinAt)}  (p25 ${quant(econ.coinSkinAt, 0.25)}, p75 ${quant(econ.coinSkinAt, 0.75)})`);
console.log(`  first gem skin (${firstGemSkin} gems) affordable after level: median ${med(econ.gemSkinAt)}  (p25 ${quant(econ.gemSkinAt, 0.25)}, p75 ${quant(econ.gemSkinAt, 0.75)})`);
for (const w of WORLDS) {
  const e = econ.worldEnd[w.index];
  if (!e.length) continue;
  console.log(`  end of world ${w.number}: coins ${Math.round(med(e.map((x) => x.coins)))}, gems ${Math.round(med(e.map((x) => x.gems)))}, stars ${Math.round(med(e.map((x) => x.stars)))}, play day ${Math.round(med(e.map((x) => x.day)))}`);
}
