// One run of the gauntlet as a pure state machine (no timing, no DOM), so it can be simulated.
// Beat lifecycle: beginBeat() -> the Oracle commits to a hidden strike -> player picks a lane ->
// resolveBeat(lane) -> outcome, Mind Bar change, explanation.

import { LANES, EXPERT_IDS } from './oracle.js';
import { oracleForLevel, ECON, SCORE, multiplierFor } from './levels.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Run {
  constructor({ oracle, mode = 'gauntlet', modifier = null, shardRng = null, rng = Math.random, calibration = 3 }) {
    this.oracle = oracle;
    this.mode = mode;
    this.mod = modifier || {};
    this.rng = rng;
    this.shardRng = shardRng || rng;
    oracle.beginRun({ fresh: !!this.mod.fresh });

    this.level = 0;
    this.bar = ECON.start;
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.beatIndex = 0;
    this.beatInLevel = 0;
    this.calibLeft = calibration;
    this.lane = 1;
    this.over = false;
    this.cracked = 0;
    this.reads = 0;
    this.strikes = 0;
    this.dodges = 0;
    this.shards = 0;
    this.grid = []; // D = dodge, S = dodge + shard, R = read
    this.levelStats = [{ name: oracleForLevel(0).name, reads: 0, strikes: 0 }];
    this.current = null;
  }

  levelParams() {
    const o = oracleForLevel(this.level);
    let double = o.double;
    if (this.mod.doubleFrom != null && this.level >= this.mod.doubleFrom) {
      double = double == null ? this.mod.double : Math.min(double, this.mod.double);
    }
    return { ...o, double };
  }

  beatDuration() {
    const o = this.levelParams();
    const t = Math.min(1, this.beatInLevel / ECON.tempoRampBeats);
    let d = o.tempo[0] + (o.tempo[1] - o.tempo[0]) * t;
    if (this.calibLeft > 0) d = Math.max(d, 1150);
    return d * (this.mod.tempoMul || 1);
  }

  beginBeat() {
    const shardLane = Math.floor(this.shardRng() * LANES);
    const calibration = this.calibLeft > 0;
    const o = this.levelParams();
    this.oracle.predict({ shardLane, cur: this.lane });
    const decision = calibration
      ? null
      : this.oracle.decide({ enabled: o.experts, noise: o.noise, double: o.double, boost: this.mod.boost, rng: this.rng });
    this.current = { index: this.beatIndex, shardLane, calibration, decision, duration: this.beatDuration(), level: this.level };
    return this.current;
  }

  resolveBeat(lane) {
    const b = this.current;
    this.lane = lane;
    const res = {
      beat: b,
      lane,
      outcome: 'calib',
      shard: false,
      strike: b.decision ? b.decision.strike : [],
      barDelta: 0,
      scoreDelta: 0,
      explanation: null,
      cracked: false,
      solved: false,
      streak: 0,
      multiplier: 1,
    };

    if (b.calibration) {
      res.shard = lane === b.shardLane;
      if (res.shard) {
        res.scoreDelta = SCORE.shard;
        this.shards++;
      }
      this.oracle.observe(lane, false);
      this.calibLeft--;
    } else {
      const hit = b.decision.strike.includes(lane);
      const ls = this.levelStats[this.levelStats.length - 1];
      this.strikes++;
      ls.strikes++;
      if (hit) {
        res.outcome = 'read';
        res.explanation = this.oracle.explain(lane);
        this.reads++;
        ls.reads++;
        this.streak = 0;
        res.barDelta = ECON.read * (this.mod.readMul || 1);
        this.grid.push('R');
      } else {
        res.outcome = 'dodge';
        this.dodges++;
        this.streak++;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
        const mult = multiplierFor(this.streak);
        res.multiplier = mult;
        let push = ECON.dodge + (this.streak >= ECON.streakAt ? ECON.streakBonus : 0);
        push *= this.mod.dodgeMul || 1;
        res.scoreDelta = SCORE.dodge * mult;
        if (lane === b.shardLane) {
          res.shard = true;
          this.shards++;
          push += ECON.shard * (this.mod.shardMul || 1);
          res.scoreDelta += SCORE.shard * mult;
          this.grid.push('S');
        } else {
          this.grid.push('D');
        }
        res.barDelta = push;
      }
      this.oracle.observe(lane, hit);
      this.bar = clamp(this.bar + res.barDelta, 0, 100);
      this.beatInLevel++;

      if (this.bar >= 100) {
        res.cracked = true;
        res.crackedName = this.levelParams().name;
        res.scoreDelta += SCORE.crack * (this.level + 1);
        this.cracked++;
        this.level++;
        this.bar = ECON.start;
        this.beatInLevel = 0;
        this.levelStats.push({ name: oracleForLevel(this.level).name, reads: 0, strikes: 0 });
      } else if (this.bar <= 0) {
        res.solved = true;
        this.over = true;
      }
    }

    res.streak = this.streak;
    this.score += res.scoreDelta;
    this.beatIndex++;
    this.current = null;
    return res;
  }

  summary() {
    const tells = {};
    for (const id of EXPERT_IDS) tells[id] = { n: this.oracle.stats[id].n, acc: this.oracle.runAccuracy(id) };
    return {
      mode: this.mode,
      modifier: this.mod.id || null,
      score: this.score,
      level: this.level,
      solvedBy: this.levelParams().name,
      cracked: this.cracked,
      reads: this.reads,
      strikes: this.strikes,
      readRate: this.strikes ? this.reads / this.strikes : 0,
      dodges: this.dodges,
      shards: this.shards,
      bestStreak: this.bestStreak,
      beats: this.beatIndex,
      grid: this.grid.slice(),
      levelStats: this.levelStats.map((l) => ({ ...l })),
      tells,
    };
  }
}
