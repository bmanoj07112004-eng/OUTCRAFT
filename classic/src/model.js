// THE PLAYER MODEL — how the rival learns where you will walk next.
//
// Every time you set off from a node or the Workshop, the game records the choice you face: which
// resource nodes you still need, how far each is, which region/side of the island it is on, what you
// gathered last, and what the order card lists first. When you gather, it records what you picked.
//
// Five interpretable habit models ("experts") each predict your pick. Each one keeps statistics as
// LIFT: how often you chose a kind of option compared with how often a player choosing uniformly at
// random among the SAME options would have. Lift makes habits portable across different islands.
// Experts are combined with fixed-share Hedge (multiplicative weights on log-loss, "sleeping experts"
// when an expert has no opinion). Everything is counts, so every claim can be shown as "k of n".
//
// Pure logic (no DOM) so the Node simulator and tests use the exact same code as the game.

import { RES, REGION_NAMES } from './data.js';

export const HABIT_IDS = ['beeline', 'turf', 'book', 'routine', 'side'];

export const HABITS = {
  beeline: { name: 'Beeline', glyph: '➜', blurb: 'You walk to whatever is closest.' },
  turf: { name: 'Home Turf', glyph: '⌂', blurb: 'You keep returning to the same corner of the island.' },
  book: { name: 'By the Book', glyph: '☰', blurb: 'You gather in the order the card lists.' },
  routine: { name: 'Routine', glyph: '↻', blurb: 'After one resource, you go for the same next one.' },
  side: { name: 'Favourite Side', glyph: '◧', blurb: 'You favour one half of the island.' },
};

const ETA = 0.6;
const SHARE = 0.04;
const PMIN = 0.02;
const SIDE_NAMES = ['left', 'centre', 'right'];

const blank = () => ({ o: 0, e: 0, v: 0, n: 0 });
const lift = (s) => (s.o + 1) / (s.e + 1);
const liftNot = (s) => (s.n - s.o + 1) / (s.n - s.e + 1);
const rnd = (x) => Math.max(0, Math.round(x));
const pct = (x) => `${Math.round(x * 100)}%`;
const resName = (r) => RES[r].name;

// One observation for a "did the player choose option-kind X?" statistic.
// p = chance a uniformly random chooser among the same candidates would have picked X.
function tally(stat, hit, p) {
  stat.n += 1;
  stat.o += hit ? 1 : 0;
  stat.e += p;
  stat.v += p * (1 - p);
}

// Significance of a habit: observed vs expected under uniform choice (Poisson-binomial, normal approx).
// A claim needs a clear effect (lift of 15 points) AND a z-score above a bar that rises with the number
// of statistics searched, so random walkers are almost never accused of having a habit.
function claim(stat, zCrit, minN = 6) {
  if (stat.n < minN || stat.v <= 0) return null;
  const z = (stat.o - stat.e) / Math.sqrt(stat.v);
  const effect = (stat.o - stat.e) / stat.n;
  if (z < zCrit || effect < 0.15) return null;
  return { z, effect, k: rnd(stat.o), n: rnd(stat.n), rate: stat.o / stat.n, chance: stat.e / stat.n };
}

function emptyTables() {
  return {
    beeline: blank(),
    turf: Array.from({ length: 9 }, blank),
    book: blank(),
    routine: {},
    side: Array.from({ length: 3 }, blank),
  };
}

function normalize(a) {
  const s = a.reduce((x, y) => x + y, 0);
  return s > 0 ? a.map((v) => v / s) : a.map(() => 1 / a.length);
}

const EXPERTS = {
  beeline: {
    predict(t, c) {
      if (t.beeline.n < 3) return null;
      const near = lift(t.beeline);
      const far = liftNot(t.beeline);
      return normalize(c.cands.map((k) => (k.rank === 0 ? near : far)));
    },
    learn(t, c, i) {
      const nNear = c.cands.filter((k) => k.rank === 0).length;
      tally(t.beeline, c.cands[i].rank === 0, nNear / c.cands.length);
    },
    explain: (t, c, i) => {
      const s = t.beeline;
      if (c.cands[i].rank === 0 && lift(s) > 1) return `You walk to the nearest one, ${rnd(s.o)} of ${rnd(s.n)} trips.`;
      if (c.cands[i].rank !== 0 && liftNot(s) > lift(s)) return `You avoid the nearest one: only ${rnd(s.o)} of ${rnd(s.n)} trips go there.`;
      return null;
    },
  },

  turf: {
    predict(t, c) {
      if (t.turf[0].n < 4) return null;
      return normalize(c.cands.map((k) => lift(t.turf[k.region])));
    },
    learn(t, c, i) {
      for (let r = 0; r < 9; r++) {
        const share = c.cands.filter((k) => k.region === r).length / c.cands.length;
        tally(t.turf[r], c.cands[i].region === r, share);
      }
    },
    explain: (t, c, i) => {
      const r = c.cands[i].region;
      return `You keep heading ${REGION_NAMES[r]}, ${rnd(t.turf[r].o)} of ${rnd(t.turf[r].n)} trips.`;
    },
  },

  book: {
    predict(t, c) {
      if (t.book.n < 3 || !c.bookable) return null;
      const yes = lift(t.book);
      const no = liftNot(t.book);
      return normalize(c.cands.map((k) => (k.type === c.firstType ? yes : no)));
    },
    learn(t, c, i) {
      if (!c.bookable) return;
      const share = c.cands.filter((k) => k.type === c.firstType).length / c.cands.length;
      tally(t.book, c.cands[i].type === c.firstType, share);
    },
    explain: (t, c, i) => {
      const s = t.book;
      if (c.cands[i].type === c.firstType && lift(s) > 1) return `You gather in the order the card lists, ${rnd(s.o)} of ${rnd(s.n)} times.`;
      if (c.cands[i].type !== c.firstType && liftNot(s) > lift(s)) return `You skip the card's first item, ${rnd(s.n - s.o)} of ${rnd(s.n)} times.`;
      return null;
    },
  },

  routine: {
    predict(t, c) {
      const row = c.prevType && t.routine[c.prevType];
      if (!row) return null;
      const n = Math.max(...Object.values(row).map((s) => s.n));
      if (n < 3) return null;
      return normalize(c.cands.map((k) => (row[k.type] ? lift(row[k.type]) : 1)));
    },
    learn(t, c, i) {
      if (!c.prevType) return;
      const row = (t.routine[c.prevType] = t.routine[c.prevType] || {});
      const types = [...new Set(c.cands.map((k) => k.type))];
      for (const ty of types) {
        const share = c.cands.filter((k) => k.type === ty).length / c.cands.length;
        tally((row[ty] = row[ty] || blank()), c.cands[i].type === ty, share);
      }
    },
    explain: (t, c, i) => {
      const s = t.routine[c.prevType]?.[c.cands[i].type] || blank();
      return `After ${resName(c.prevType)}, you go for ${resName(c.cands[i].type)}, ${rnd(s.o)} of ${rnd(s.n)} times.`;
    },
  },

  side: {
    predict(t, c) {
      if (t.side[0].n < 4) return null;
      return normalize(c.cands.map((k) => lift(t.side[k.side])));
    },
    learn(t, c, i) {
      for (let s = 0; s < 3; s++) {
        const share = c.cands.filter((k) => k.side === s).length / c.cands.length;
        tally(t.side[s], c.cands[i].side === s, share);
      }
    },
    explain: (t, c, i) => {
      const s = c.cands[i].side;
      return `You favour the ${SIDE_NAMES[s]} side, ${rnd(t.side[s].o)} of ${rnd(t.side[s].n)} trips.`;
    },
  },
};

export class PlayerModel {
  constructor(saved = null) {
    this.t = saved?.t || emptyTables();
    this.w = {};
    HABIT_IDS.forEach((id) => (this.w[id] = saved?.w?.[id] ?? 1 / HABIT_IDS.length));
    this.matches = saved?.matches ?? 0;
    this.resetMatchStats();
  }

  toJSON() {
    return { t: this.t, w: this.w, matches: this.matches };
  }

  resetMatchStats() {
    this.stats = {};
    HABIT_IDS.forEach((id) => (this.stats[id] = { n: 0, c: 0, chance: 0 }));
  }

  // Between matches, old evidence fades so a player who changes can escape their past.
  beginMatch({ decay = 0.7 } = {}) {
    if (this.matches > 0) {
      const f = (s) => {
        s.o *= decay;
        s.e *= decay;
        s.v *= decay;
        s.n *= decay;
      };
      f(this.t.beeline);
      f(this.t.book);
      this.t.turf.forEach(f);
      this.t.side.forEach(f);
      Object.values(this.t.routine).forEach((row) => Object.values(row).forEach(f));
    }
    HABIT_IDS.forEach((id) => (this.w[id] = 0.6 * this.w[id] + 0.4 / HABIT_IDS.length));
    this.resetMatchStats();
  }

  endMatch() {
    this.matches += 1;
  }

  get memorySize() {
    return Math.round(this.t.beeline.n);
  }

  // ctx.cands: [{id, type, dist, rank, region, side}], ctx.firstType, ctx.prevType, ctx.bookable
  predict(ctx) {
    ctx.preds = {};
    for (const id of HABIT_IDS) ctx.preds[id] = ctx.cands.length > 1 ? EXPERTS[id].predict(this.t, ctx) : null;
    return ctx;
  }

  // Weighted blend of the enabled experts: a probability for every candidate node.
  mixture(ctx, enabled = HABIT_IDS) {
    const n = ctx.cands.length;
    const p = new Array(n).fill(0);
    let ws = 0;
    for (const id of enabled) {
      const q = ctx.preds?.[id];
      if (!q) continue;
      ws += this.w[id];
      for (let i = 0; i < n; i++) p[i] += this.w[id] * q[i];
    }
    const base = ws > 0 ? p.map((v) => v / ws) : new Array(n).fill(1 / n);
    return base.map((v) => 0.97 * v + 0.03 / n);
  }

  // The player gathered candidate i: score the experts, then learn.
  observe(ctx, i) {
    if (!ctx.preds) this.predict(ctx);
    const awake = HABIT_IDS.filter((id) => ctx.preds[id]);
    if (awake.length) {
      const mix = this.mixture(ctx, awake);
      const lossMix = -Math.log(Math.max(PMIN, mix[i]));
      for (const id of awake) {
        const q = ctx.preds[id];
        this.w[id] *= Math.exp(-ETA * (-Math.log(Math.max(PMIN, q[i])) - lossMix));
        const mx = Math.max(...q);
        const ties = q.filter((v) => v === mx).length;
        if ((id === 'beeline' && !(lift(this.t.beeline) > liftNot(this.t.beeline))) || (id === 'book' && !(lift(this.t.book) > liftNot(this.t.book)))) continue;
        const s = this.stats[id];
        s.n += 1;
        s.chance += 1 / ctx.cands.length;
        if (q[i] === mx) s.c += 1 / ties;
      }
      const mean = HABIT_IDS.reduce((a, id) => a + this.w[id], 0) / HABIT_IDS.length;
      HABIT_IDS.forEach((id) => (this.w[id] = (1 - SHARE) * this.w[id] + SHARE * mean));
      const ws = HABIT_IDS.reduce((a, id) => a + this.w[id], 0);
      HABIT_IDS.forEach((id) => (this.w[id] /= ws));
    }
    if (ctx.cands.length > 1) for (const id of HABIT_IDS) EXPERTS[id].learn(this.t, ctx, i);
  }

  // Why did the rival expect you at candidate i? Credit the enabled expert that pushed hardest.
  explain(ctx, i, enabled) {
    const ranked = [];
    for (const id of enabled) {
      const q = ctx.preds?.[id];
      if (!q) continue;
      const score = this.w[id] * (q[i] - 1 / ctx.cands.length);
      if (score > 0) ranked.push({ id, score });
    }
    ranked.sort((a, b) => b.score - a.score);
    for (const { id } of ranked) {
      const text = EXPERTS[id].explain(this.t, ctx, i);
      if (text) return { id, text };
    }
    return null;
  }

  // Per-match accuracy for the Tell Dex, compared with a uniform guesser's accuracy.
  matchTell(id) {
    const s = this.stats[id];
    return { n: s.n, acc: s.n ? s.c / s.n : 0, chance: s.n ? s.chance / s.n : 0 };
  }

  // The rival's notes on you: only statistically real habits, strongest first.
  dossier(limit = 3) {
    const out = [];
    const t = this.t;
    const b = claim(t.beeline, 2.9);
    if (b) out.push({ id: 'beeline', s: b.z, text: `You usually walk to the nearest one: ${pct(b.rate)} of trips, when chance says ${pct(b.chance)}.` });
    let bestTurf = null;
    t.turf.forEach((s, r) => {
      const c = claim(s, 3.3);
      if (c && (!bestTurf || c.z > bestTurf.z)) bestTurf = { ...c, r };
    });
    if (bestTurf) out.push({ id: 'turf', s: bestTurf.z, text: `You keep going back to the ${REGION_NAMES[bestTurf.r]}. ${bestTurf.k} of ${bestTurf.n} trips.` });
    const bk = claim(t.book, 2.9);
    if (bk) out.push({ id: 'book', s: bk.z, text: `You gather in the order the card lists. ${bk.k} of ${bk.n} times.` });
    let bestR = null;
    for (const [prev, row] of Object.entries(t.routine)) {
      for (const [ty, s] of Object.entries(row)) {
        const c = claim(s, 3.6, 5);
        if (c && (!bestR || c.z > bestR.z)) bestR = { ...c, prev, ty };
      }
    }
    if (bestR) out.push({ id: 'routine', s: bestR.z, text: `After ${resName(bestR.prev)}, you go for ${resName(bestR.ty)}. ${bestR.k} of ${bestR.n} times.` });
    for (const s of [0, 2]) {
      const c = claim(t.side[s], 3.1);
      if (c) out.push({ id: 'side', s: c.z, text: `You favour the ${SIDE_NAMES[s]} side. ${c.k} of ${c.n} trips.` });
    }
    return out.sort((a, b2) => b2.s - a.s).slice(0, limit);
  }
}
