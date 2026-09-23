// THE ORACLE — an online-learning opponent that predicts which lane the player will pick next.
//
// Model: a mixture of seven small, interpretable "habit experts" (frequency and Markov-style count
// models). Each expert outputs a probability for every lane. Their votes are combined with
// multiplicative weights (Hedge) using the "sleeping experts" update (an expert with no opinion is
// neither rewarded nor punished) plus "fixed share" (no expert's weight can collapse, so the Oracle
// can follow a player who changes habits mid-run).
//
// Because every expert is a readable habit, every READ can be explained truthfully by the expert that
// contributed most to it, and each expert doubles as a collectible "Tell" in the meta game.
//
// Pure logic, no DOM: the browser game and the Node balance simulator share this file.

export const LANES = 3;
export const LANE_NAMES = ['LEFT', 'MIDDLE', 'RIGHT'];
export const LANE_SHORT = ['L', 'M', 'R'];
const MOVE_VERBS = ['moved left', 'stayed', 'moved right'];

const SMOOTH = 0.5; // Laplace smoothing: sparse evidence still produces confident guesses
const ETA = 0.55; // Hedge learning rate (on log-loss)
const SHARE = 0.03; // fixed-share mixing per beat
const PMIN = 0.03; // clamp for log-loss
const UNIFORM_MIX = 0.03; // keeps the mixture from ever being 100% certain

export const EXPERT_IDS = ['home', 'autopilot', 'pendulum', 'magpie', 'combo', 'flinch', 'loop'];

// Player-facing names: each expert is a "Tell" the player can discover and then break.
export const TELLS = {
  home: { name: 'Home Lane', glyph: '⌂', blurb: 'You keep drifting back to a favourite lane.' },
  autopilot: { name: 'Autopilot', glyph: '→', blurb: 'Where you go next depends on where you are.' },
  pendulum: { name: 'Pendulum', glyph: '⇄', blurb: 'Your moves swing in a rhythm: go, come back, stay, go.' },
  magpie: { name: 'Magpie', glyph: '◆', blurb: "Shiny thing? You're there. The Oracle knows." },
  combo: { name: 'Combo', glyph: '⋯', blurb: 'You repeat two-step patterns without noticing.' },
  flinch: { name: 'Flinch', glyph: '!', blurb: 'Getting read changes where you run next.' },
  loop: { name: 'Loop', glyph: '∞', blurb: 'You replay whole sequences, four moves long.' },
};

// ---------- small numeric helpers ----------
const sum = (a) => a.reduce((x, y) => x + y, 0);
function normalize(a) {
  const s = sum(a);
  return s > 0 ? a.map((v) => v / s) : a.map(() => 1 / a.length);
}
const smooth = (counts) => normalize(counts.map((c) => c + SMOOTH));
function argmax(a) {
  let b = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i;
  return b;
}
const pct = (p) => `${Math.round(p * 100)}%`;
// ---------- honesty: the Oracle only claims a habit that chance cannot explain ----------
// Exact binomial upper tail P(X >= k) for X ~ Bin(n, p), computed in log space; a normal
// approximation takes over for very large n. Counts are decayed floats, so they are rounded first.
function erfc(x) {
  const t = 1 / (1 + 0.5 * Math.abs(x));
  const y = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? y : 2 - y;
}
function upperTail(k, n, p) {
  k = Math.round(k);
  n = Math.round(n);
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (n > 400) return 0.5 * erfc((k - 0.5 - n * p) / Math.sqrt(2 * n * p * (1 - p)));
  const r = Math.log(p / (1 - p));
  let logPmf = n * Math.log(1 - p);
  let tail = 0;
  for (let i = 0; i <= n; i++) {
    if (i >= k) tail += Math.exp(logPmf);
    logPmf += Math.log((n - i) / (i + 1)) + r;
  }
  return Math.min(1, tail);
}
const lowerTail = (k, n, p) => 1 - upperTail(Math.round(k) + 1, n, p);
// Family-wise error budget per habit type: with Bonferroni over every cell searched, a truly random
// player is told they have that habit less than 0.5% of the time.
const ALPHA = 0.005;
const significant = (pValue, tests) => pValue * tests <= ALPHA;
const moveOf = (from, to) => (to < from ? 0 : to === from ? 1 : 2);
function bump(table, key, idx, size = LANES) {
  if (!table[key]) table[key] = new Array(size).fill(0);
  table[key][idx] += 1;
}
// "k of n" wording from decayed (fractional) counts, never showing k > n or n = 0.
function kOfN(counts, idx) {
  const n = Math.max(1, Math.round(sum(counts)));
  const k = Math.min(n, Math.max(1, Math.round(counts[idx])));
  return `${k} of ${n}`;
}
// Converts a distribution over moves [left, stay, right] into one over lanes, from lane `cur`.
function movesToLanes(m, cur) {
  const lanes = new Array(LANES).fill(0);
  const left = [];
  const right = [];
  for (let l = 0; l < LANES; l++) {
    if (l < cur) left.push(l);
    else if (l > cur) right.push(l);
  }
  lanes[cur] += m[1];
  let spill = 0;
  if (left.length) left.forEach((l) => (lanes[l] += m[0] / left.length));
  else spill += m[0];
  if (right.length) right.forEach((l) => (lanes[l] += m[2] / right.length));
  else spill += m[2];
  const s = sum(lanes);
  return lanes.map((v) => v + spill * (s > 0 ? v / s : 1 / LANES));
}

// ---------- the seven experts ----------
// predict(t, ctx) -> probabilities over lanes, or null to abstain ("sleep").
// learn(t, ctx, lane) updates the count tables. explain() justifies a READ. describe() feeds the dossier.
const EXPERTS = {
  home: {
    predict: (t) => (sum(t.home) >= 3 ? smooth(t.home) : null),
    learn: (t, c, lane) => {
      t.home[lane] += 1;
    },
    explain: (t, c, lane) => `You spend ${pct(t.home[lane] / Math.max(1, sum(t.home)))} of your beats in the ${LANE_NAMES[lane]} lane.`,
    describe: (t) => {
      const n = sum(t.home);
      if (n < 10) return null;
      const l = argmax(t.home);
      const p = t.home[l] / n;
      return p >= 0.42 && significant(upperTail(t.home[l], n, 1 / 3), 3) ? { text: `You live in the ${LANE_NAMES[l]} lane. ${pct(p)} of the time.`, s: p - 1 / 3 } : null;
    },
  },

  autopilot: {
    predict: (t, c) => {
      if (c.prev == null) return null;
      const row = t.auto[c.prev];
      return row && sum(row) >= 2 ? smooth(row) : null;
    },
    learn: (t, c, lane) => {
      if (c.prev != null) bump(t.auto, c.prev, lane);
    },
    explain: (t, c, lane) => `After ${LANE_NAMES[c.prev]}, you went ${LANE_NAMES[lane]} ${kOfN(t.auto[c.prev], lane)} times.`,
    describe: (t) => bestRow(t.auto, { minN: 6, cells: 9 }, (k, l, p) => `After ${LANE_NAMES[+k]}, you go ${LANE_NAMES[l]}. ${pct(p)} of the time.`),
  },

  pendulum: {
    predict: (t, c) => {
      if (c.prevMove == null) return null;
      const row = t.pend[c.prevMove];
      return row && sum(row) >= 2 ? movesToLanes(smooth(row), c.cur) : null;
    },
    learn: (t, c, lane) => {
      if (c.prevMove != null && c.prev != null) bump(t.pend, c.prevMove, moveOf(c.prev, lane));
    },
    explain: (t, c, lane) => {
      const m = moveOf(c.cur, lane);
      return `After you ${MOVE_VERBS[c.prevMove]}, you ${MOVE_VERBS[m]} ${kOfN(t.pend[c.prevMove], m)} times.`;
    },
    describe: (t) => {
      const tot = [0, 0, 0];
      Object.values(t.pend).forEach((r) => r.forEach((v, i) => (tot[i] += v)));
      const n = sum(tot);
      if (n >= 10 && tot[1] / n < 0.14 && significant(lowerTail(tot[1], n, 1 / 3), 2)) return { text: `You almost never stay still. ${pct(tot[1] / n)} of the time.`, s: 0.2 };
      if (n >= 10 && tot[1] / n > 0.55 && significant(upperTail(tot[1], n, 1 / 3), 2)) return { text: `You love standing still. ${pct(tot[1] / n)} of the time.`, s: tot[1] / n - 1 / 3 };
      return bestRow(t.pend, { minN: 6, cells: 9, p0: (k, m) => PEND_NULL[+k][m] }, (k, m, p) => `After you ${MOVE_VERBS[+k]}, you ${MOVE_VERBS[m]}. ${pct(p)} of the time.`);
    },
  },

  magpie: {
    predict: (t, c) => {
      const n = t.magpie[0] + t.magpie[1];
      if (c.shardLane == null || n < 3) return null;
      const pChase = (t.magpie[0] + SMOOTH) / (n + 2 * SMOOTH);
      const p = new Array(LANES).fill((1 - pChase) / (LANES - 1));
      p[c.shardLane] = pChase;
      return p;
    },
    learn: (t, c, lane) => {
      if (c.shardLane != null) t.magpie[lane === c.shardLane ? 0 : 1] += 1;
    },
    explain: (t, c, lane) =>
      lane === c.shardLane
        ? `You went for the shard ${kOfN(t.magpie, 0)} times. Greedy.`
        : `You skipped the shard ${kOfN(t.magpie, 1)} times. Too careful.`,
    describe: (t) => {
      const n = t.magpie[0] + t.magpie[1];
      if (n < 8) return null;
      const p = t.magpie[0] / n;
      if (p >= 0.5 && significant(upperTail(t.magpie[0], n, 1 / 3), 2)) return { text: `You chase shards. ${pct(p)} of them. I noticed.`, s: p - 1 / 3 };
      if (p <= 0.12 && significant(lowerTail(t.magpie[0], n, 1 / 3), 2)) return { text: `You're scared of shards. You took ${pct(p)}.`, s: 1 / 3 - p };
      return null;
    },
  },

  combo: {
    predict: (t, c) => {
      if (c.p2 == null) return null;
      const row = t.combo[`${c.p2}${c.prev}`];
      return row && sum(row) >= 2 ? smooth(row) : null;
    },
    learn: (t, c, lane) => {
      if (c.p2 != null) bump(t.combo, `${c.p2}${c.prev}`, lane);
    },
    explain: (t, c, lane) =>
      `After ${LANE_SHORT[c.p2]}→${LANE_SHORT[c.prev]}, you went ${LANE_NAMES[lane]} ${kOfN(t.combo[`${c.p2}${c.prev}`], lane)} times.`,
    describe: (t) =>
      bestRow(t.combo, { minN: 6, cells: 27 }, (k, l, p) => `Your combo: ${LANE_SHORT[+k[0]]}→${LANE_SHORT[+k[1]]}→${LANE_SHORT[l]}. ${pct(p)} of the time.`),
  },

  flinch: {
    predict: (t, c) => {
      if (!c.lastHit || c.prev == null) return null;
      const row = t.flinch[c.prev];
      return row && sum(row) >= 2 ? smooth(row) : null;
    },
    learn: (t, c, lane) => {
      if (c.lastHit && c.prev != null) bump(t.flinch, c.prev, lane);
    },
    explain: (t, c, lane) =>
      `After I read you in ${LANE_NAMES[c.prev]}, you ran ${LANE_NAMES[lane]} ${kOfN(t.flinch[c.prev], lane)} times.`,
    describe: (t) => bestRow(t.flinch, { minN: 6, cells: 9 }, (k, l, p) => `When I read you in ${LANE_NAMES[+k]}, you flee ${LANE_NAMES[l]}. ${pct(p)} of the time.`),
  },

  loop: {
    predict: (t, c) => {
      for (const key of [c.k4, c.k3]) {
        if (key == null) continue;
        const row = t.loop[key];
        if (row && sum(row) >= 2) return smooth(row);
      }
      return null;
    },
    learn: (t, c, lane) => {
      if (c.k3 != null) bump(t.loop, c.k3, lane);
      if (c.k4 != null) bump(t.loop, c.k4, lane);
    },
    explain: (t, c, lane) => {
      const key = c.k4 != null && t.loop[c.k4] && sum(t.loop[c.k4]) >= 2 ? c.k4 : c.k3;
      const seq = key.split('').map((d) => LANE_SHORT[+d]).join('→');
      return `You've played ${seq} before. Next came ${LANE_NAMES[lane]}, ${kOfN(t.loop[key], lane)} times.`;
    },
    describe: (t) => {
      const long = {};
      Object.keys(t.loop).forEach((k) => {
        if (k.length === 4) long[k] = t.loop[k];
      });
      return bestRow(long, { minN: 5, cells: 243 }, (k, l, p) => `You replay ${k.split('').map((d) => LANE_SHORT[+d]).join('→')}→${LANE_SHORT[l]}. ${pct(p)} of the time.`);
    },
  },
};

// What a purely random player would do after each pendulum move [left, stay, right]. After moving
// right you are usually at the right edge, so even pure chance moves left 5/9 of the time.
const PEND_NULL = [
  [1 / 9, 1 / 3, 5 / 9],
  [1 / 3, 1 / 3, 1 / 3],
  [5 / 9, 1 / 3, 1 / 9],
];

// Strongest single row in a count table, for the dossier. A row is reported only when it beats what
// chance (p0) would produce, by a meaningful margin (minLift) and a Bonferroni-corrected exact
// binomial test over every cell searched, so random players are almost never told they have a habit.
function bestRow(table, { minN, cells, minLift = 0.15, p0 = () => 1 / 3 }, fmt) {
  let best = null;
  for (const k of Object.keys(table)) {
    const row = table[k];
    const n = sum(row);
    if (n < minN) continue;
    const l = argmax(row);
    const p = row[l] / n;
    const base = p0(k, l);
    if (p - base < minLift || !significant(upperTail(row[l], n, base), cells)) continue;
    const s = (p - base) * Math.min(1, n / 10);
    if (!best || s > best.s) best = { text: fmt(k, l, p), s };
  }
  return best;
}

function emptyTables() {
  return { home: [0, 0, 0], auto: {}, pend: {}, magpie: [0, 0], combo: {}, flinch: {}, loop: {} };
}

export class Oracle {
  constructor(saved = null) {
    this.t = saved?.t ? saved.t : emptyTables();
    this.w = {};
    EXPERT_IDS.forEach((id) => (this.w[id] = saved?.w?.[id] ?? 1 / EXPERT_IDS.length));
    this.runsSeen = saved?.runsSeen ?? 0;
    this.resetRunState();
  }

  toJSON() {
    return { t: this.t, w: this.w, runsSeen: this.runsSeen };
  }

  // Memory fades between runs so a player who changes can escape their past self.
  beginRun({ decay = 0.6, fresh = false } = {}) {
    if (fresh) this.t = emptyTables();
    else if (this.runsSeen > 0) this.decayTables(decay);
    EXPERT_IDS.forEach((id) => (this.w[id] = 0.6 * this.w[id] + 0.4 / EXPERT_IDS.length));
    this.resetRunState();
  }

  resetRunState() {
    this.hist = [];
    this.lastHit = false;
    this.ctx = null;
    this.stats = {};
    EXPERT_IDS.forEach((id) => (this.stats[id] = { n: 0, c: 0 }));
  }

  endRun() {
    this.runsSeen += 1;
  }

  decayTables(f) {
    const t = this.t;
    t.home = t.home.map((v) => v * f);
    t.magpie = t.magpie.map((v) => v * f);
    for (const name of ['auto', 'pend', 'combo', 'flinch', 'loop']) {
      for (const k of Object.keys(t[name])) {
        t[name][k] = t[name][k].map((v) => v * f);
        if (sum(t[name][k]) < 0.15) delete t[name][k];
      }
    }
  }

  get memorySize() {
    return Math.round(sum(this.t.home));
  }

  // Step 1 of a beat: look at the past (never the present) and form every expert's opinion.
  predict({ shardLane = null, cur = 1 } = {}) {
    const h = this.hist;
    const L = h.length;
    const ctx = {
      prev: L >= 1 ? h[L - 1] : null,
      p2: L >= 2 ? h[L - 2] : null,
      prevMove: L >= 2 ? moveOf(h[L - 2], h[L - 1]) : null,
      k3: L >= 3 ? h.slice(L - 3).join('') : null,
      k4: L >= 4 ? h.slice(L - 4).join('') : null,
      lastHit: this.lastHit,
      shardLane,
      cur: L >= 1 ? h[L - 1] : cur,
    };
    ctx.preds = {};
    for (const id of EXPERT_IDS) ctx.preds[id] = EXPERTS[id].predict(this.t, ctx);
    this.ctx = ctx;
    return ctx;
  }

  mixture(ids, boost = null) {
    const preds = this.ctx.preds;
    const p = new Array(LANES).fill(0);
    let wsum = 0;
    for (const id of ids) {
      const q = preds[id];
      if (!q) continue;
      const w = this.w[id] * (boost && boost[id] ? boost[id] : 1);
      wsum += w;
      for (let l = 0; l < LANES; l++) p[l] += w * q[l];
    }
    const base = wsum > 0 ? p.map((v) => v / wsum) : new Array(LANES).fill(1 / LANES);
    return base.map((v) => (1 - UNIFORM_MIX) * v + UNIFORM_MIX / LANES);
  }

  // Step 2: commit to a strike. The level decides which experts may vote, how noisy the Oracle is,
  // and whether it may strike two lanes when it is confident.
  decide({ enabled = EXPERT_IDS, noise = 0, double = null, boost = null, rng = Math.random } = {}) {
    const probs = this.mixture(enabled, boost);
    const order = [0, 1, 2].sort((a, b) => probs[b] - probs[a] || rng() - 0.5);
    const top = probs[order[0]];
    const confidence = Math.max(0, Math.min(1, (top - 1 / LANES) / (1 - 1 / LANES)));
    let strike;
    let wild = false;
    if (rng() < noise) {
      strike = [Math.floor(rng() * LANES)];
      wild = true;
    } else if (double != null && top >= double) {
      strike = [order[0], order[1]];
    } else {
      strike = [order[0]];
    }
    this.decision = { probs, strike, confidence, wild, enabled };
    return this.decision;
  }

  // Why did that strike land? Credit the enabled expert that pushed hardest toward the lane.
  explain(lane) {
    const d = this.decision;
    const ctx = this.ctx;
    if (!d) return null;
    if (d.wild) return { text: 'A wild guess. Luck is also a weapon.', expert: null, lucky: true };
    if (d.probs[lane] < 0.42) {
      return { text: `Lucky guess. I only gave ${LANE_NAMES[lane]} ${pct(d.probs[lane])}.`, expert: null, lucky: true };
    }
    let best = null;
    let bestScore = -1;
    for (const id of d.enabled) {
      const q = ctx.preds[id];
      if (!q) continue;
      const score = this.w[id] * (q[lane] - 1 / LANES);
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    if (!best) return { text: 'I just knew.', expert: null, lucky: false };
    return { text: EXPERTS[best].explain(this.t, ctx, lane), expert: best, lucky: false };
  }

  // Step 3: see what the player actually did; update weights, stats and habit tables.
  observe(lane, wasHit) {
    const ctx = this.ctx || this.predict({});
    const preds = ctx.preds;
    const awake = EXPERT_IDS.filter((id) => preds[id]);
    const mixAll = this.mixture(awake);
    const lossMix = -Math.log(Math.max(PMIN, mixAll[lane]));
    for (const id of awake) {
      const q = preds[id];
      const loss = -Math.log(Math.max(PMIN, q[lane]));
      this.w[id] *= Math.exp(-ETA * (loss - lossMix));
      // Accuracy for the Tell Dex: credit an argmax hit, splitting credit on ties.
      const mx = Math.max(...q);
      const ties = q.filter((v) => v === mx).length;
      this.stats[id].n += 1;
      if (q[lane] === mx) this.stats[id].c += 1 / ties;
    }
    const mean = sum(EXPERT_IDS.map((id) => this.w[id])) / EXPERT_IDS.length;
    EXPERT_IDS.forEach((id) => (this.w[id] = (1 - SHARE) * this.w[id] + SHARE * mean));
    const ws = sum(EXPERT_IDS.map((id) => this.w[id]));
    EXPERT_IDS.forEach((id) => (this.w[id] /= ws));

    for (const id of EXPERT_IDS) EXPERTS[id].learn(this.t, ctx, lane);
    this.hist.push(lane);
    if (this.hist.length > 64) this.hist.shift();
    this.lastHit = !!wasHit;
    this.ctx = null;
    this.decision = null;
  }

  runAccuracy(id) {
    const s = this.stats[id];
    return s.n ? s.c / s.n : 0;
  }

  // The Oracle's notes on you, strongest habit first.
  dossier(limit = 3) {
    const lines = [];
    for (const id of EXPERT_IDS) {
      const d = EXPERTS[id].describe(this.t);
      if (d) lines.push({ id, ...d });
    }
    return lines.sort((a, b) => b.s - a.s).slice(0, limit);
  }

  weightsSnapshot() {
    return EXPERT_IDS.map((id) => ({ id, w: this.w[id] })).sort((a, b) => b.w - a.w);
  }
}
