// Tests for the meta game: Adventure levels, economy and the save file.   node tools/test-meta.mjs
import assert from 'node:assert/strict';
import { LEVELS, WORLDS, TWISTS, LEVELS_PER_WORLD, MAX_STARS, levelById, worldOf, levelPassed, starsFor, matchConfig } from '../src/levels.js';
import * as eco from '../src/economy.js';
import * as store from '../src/storage.js';
import { fresh, load, save, migrate, recordMatch, codexCount, dexCounts, todaysDaily } from '../src/storage.js';
import * as classic from '../classic/src/storage.js';
import { Match } from '../src/match.js';
import { PlayerModel, HABIT_IDS } from '../src/model.js';
import { RIVALS, ITEMS, ITEM_BY_ID, STARS_TO_WIN, SCORE, COMPONENTS } from '../src/data.js';
import { THEMES } from '../src/3d/themes.js';
import { SKINS, SKIN_BY_ID } from '../src/skins.js';
import { idx } from '../src/world.js';
import { dateKey, daysBetween } from '../src/rng.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

const MIN = 60 * 1000;
const T0 = new Date(2026, 9, 5, 10, 0, 0).getTime(); // a local 10:00, far from midnight
const day = (n, h = 10) => new Date(2026, 9, 5 + n, h, 0, 0).getTime();
const rank = (id) => RIVALS.findIndex((r) => r.id === id);
const TWIST_FIELDS = ['id', 'name', 'desc', 'speedMul', 'respawnMul', 'bag', 'minTier', 'rivalSpeedMul'];

// A match summary with just the fields the meta game reads.
function summary({ win = true, rivalStars = 1, score = 0, crafted = null, timeUp = false, fooled = 0, outread = 0, stw = 3 } = {}) {
  return {
    winner: win ? 'player' : 'rival',
    stars: win ? { player: stw, rival: rivalStars } : { player: 1, rival: stw },
    crafted: crafted || [],
    results: [],
    score,
    timeUp,
    stats: { fooled, outread, snatched: 0, gathers: 10 },
    tells: Object.fromEntries(HABIT_IDS.map((id) => [id, { n: 0, acc: 0, chance: 0 }])),
  };
}

// A passing summary for any level, with the requested score.
function passFor(level, score = 0) {
  const g = level.goal;
  return summary({ score, rivalStars: g.type === 'flawless' ? 0 : 1, crafted: g.type === 'craft' ? [g.item] : [], stw: level.options.starsToWin });
}

// ------------------------------------------------------------ level catalogue
test('catalogue: 6 worlds matching THEMES, 60 levels, 10 per world, ids 1..60', () => {
  assert.equal(WORLDS.length, 6);
  WORLDS.forEach((w, i) => {
    assert.equal(w.id, THEMES[i].id);
    assert.equal(w.name, THEMES[i].name);
    assert.equal(w.theme, THEMES[i]);
    assert.ok(w.blurb && w.rivalIds.length);
  });
  assert.equal(LEVELS.length, 60);
  assert.equal(MAX_STARS, 180);
  LEVELS.forEach((l, i) => {
    assert.equal(l.id, i + 1);
    assert.equal(l.world, Math.floor(i / LEVELS_PER_WORLD));
    assert.equal(l.index, i % LEVELS_PER_WORLD);
    assert.equal(levelById(l.id), l);
    assert.equal(worldOf(l), WORLDS[l.world]);
    assert.ok(l.name && l.name.length <= 22, l.name);
    assert.ok(WORLDS[l.world].rivalIds.includes(l.rival));
  });
  assert.equal(levelById(0), null);
  assert.equal(levelById(61), null);
});

test('catalogue: unique seeds and names, valid rivals, items, twists, rewards', () => {
  assert.equal(new Set(LEVELS.map((l) => l.seed)).size, 60);
  assert.equal(new Set(LEVELS.map((l) => l.name)).size, 60);
  for (const l of LEVELS) {
    assert.ok(Number.isInteger(l.seed) && l.seed > 0);
    assert.ok(rank(l.rival) >= 0, l.rival);
    const { orders, starsToWin, timeLimit } = l.options;
    assert.ok(starsToWin >= 2 && starsToWin <= STARS_TO_WIN);
    assert.ok(orders.length >= 2 * starsToWin - 1, `level ${l.id}: a winner needs ${2 * starsToWin - 1} orders`);
    assert.equal(new Set(orders).size, orders.length, `level ${l.id} repeats an order`);
    for (const id of orders) assert.ok(ITEM_BY_ID[id], id);
    if (l.twist) {
      assert.equal(TWISTS[l.twist.id], l.twist);
      assert.ok(l.twist.desc && l.twist.name);
      for (const k of Object.keys(l.twist)) assert.ok(TWIST_FIELDS.includes(k), `twist field ${k}`);
      if (l.twist.minTier) for (const id of orders) assert.ok(ITEM_BY_ID[id].tier >= l.twist.minTier, `level ${l.id}: ${id} below minTier`);
    }
    if (timeLimit !== undefined) assert.ok(timeLimit >= 40 && timeLimit <= 180);
    const [z, two, three] = l.thresholds;
    assert.ok(z === 0 && two > 0 && three > two, `level ${l.id} thresholds ${l.thresholds}`);
    assert.ok(Number.isInteger(l.reward.coins) && l.reward.coins > 0);
    assert.ok(['win', 'win-time', 'flawless', 'craft'].includes(l.goal.type) && l.goal.text);
    if (l.goal.type === 'craft') assert.ok(orders.slice(0, starsToWin).includes(l.goal.item), `level ${l.id}: craft item must be a guaranteed order`);
    if (l.goal.type === 'win-time') assert.ok(timeLimit);
  }
});

test('catalogue: design rules (gentle start, bosses, rival ladder, time limits, one new thing at a time)', () => {
  const first = LEVELS[0];
  assert.equal(first.rival, 'pip');
  assert.equal(first.twist, null);
  assert.equal(first.goal.type, 'win');
  assert.ok(first.options.orders.every((id) => ITEM_BY_ID[id].tier <= 2) && !first.options.timeLimit);
  for (const w of WORLDS) {
    const ls = LEVELS.filter((l) => l.world === w.index);
    const boss = ls[9];
    assert.ok(boss.boss && ls.filter((l) => l.boss).length === 1);
    assert.equal(boss.rival, w.rivalIds[w.rivalIds.length - 1], `world ${w.number} boss is its strongest rival`);
    assert.ok(boss.reward.gems > 0 && boss.reward.coins >= 2 * ls[0].reward.coins);
    if (w.index < 2) assert.ok(ls.every((l) => !l.options.timeLimit), 'no time limits before world 3');
    if (w.index > 0) assert.ok(rank(boss.rival) >= rank(LEVELS[w.index * 10 - 1].rival), 'bosses never get weaker');
  }
  assert.ok(LEVELS.some((l) => l.world === 2 && l.options.timeLimit));
  // Sawtooth: a hard spike roughly every 4-5 levels, never two hard levels in a row.
  const spikes = LEVELS.filter((l) => l.hard || l.boss).map((l) => l.id);
  for (let i = 1; i < spikes.length; i++) assert.ok(spikes[i] - spikes[i - 1] >= 2 && spikes[i] - spikes[i - 1] <= 6, `spikes ${spikes[i - 1]} -> ${spikes[i]}`);
  // Everything new gets its own level and a one-line explanation.
  const seen = new Set();
  for (const l of LEVELS) {
    const fresh = [`rival:${l.rival}`, l.twist && `twist:${l.twist.id}`, l.options.timeLimit && 'time', `goal:${l.goal.type}`].filter((k) => k && !seen.has(k));
    fresh.forEach((k) => seen.add(k));
    if (l.id > 1) {
      assert.ok(fresh.length <= 1, `level ${l.id} introduces ${fresh.join(' + ')}`);
      if (fresh.length) assert.ok(l.note, `level ${l.id} explains ${fresh[0]}`);
    }
  }
  assert.ok(seen.has('rival:mimic') && seen.has('twist:storm') && seen.has('time') && seen.has('goal:flawless'));
  assert.ok(LEVELS[0].note);
});

test('matchConfig: builds a Match that runs to the end with the level settings', () => {
  const HUB = { x: 4, y: 10 };
  for (const id of [1, 4, 14, 24, 33, 48, 60]) {
    const level = levelById(id);
    const cfg = matchConfig(level);
    assert.equal(cfg.seed, level.seed);
    assert.equal(cfg.rival, RIVALS[rank(level.rival)]);
    assert.notEqual(cfg.options.orders, level.options.orders, 'a copy, so boosters cannot leak into the catalogue');
    const m = new Match({ ...cfg, model: new PlayerModel() });
    const bag = () => (m.bagSizeFor ? m.bagSizeFor('player') : m.bagSize);
    let t = 0;
    while (m.phase !== 'end' && t < 900) {
      const p = m.player;
      if (m.phase === 'race' && p.state === 'idle' && !p.dest) {
        const need = m.needRemaining('player');
        const home = p.bag.length >= bag() || (p.bag.length && !Object.values(need).some(Boolean));
        const c = m.world.nodes.filter((n) => need[n.type] && !n.reserved && n.readyAt - m.time < 1.5).sort((a, b) => m.world.nodeField[a.id][idx(p.x, p.y)] - m.world.nodeField[b.id][idx(p.x, p.y)]);
        const g = home ? HUB : c[0] || (p.bag.length ? HUB : null);
        if (g) m.command(g.x, g.y);
      }
      m.step(1 / 30);
      m.drainEvents();
      t += 1 / 30;
    }
    assert.equal(m.phase, 'end', `level ${id} did not finish`);
    const s = m.summary();
    assert.ok([0, 1, 2, 3].includes(starsFor(level, s)));
    // Once match.js supports level options, the level's orders and stars-to-win must be used.
    if (typeof m.score === 'number') {
      assert.deepEqual(m.orders.map((o) => o.id), level.options.orders);
      if (!s.timeUp) assert.equal(Math.max(s.stars.player, s.stars.rival), level.options.starsToWin);
    }
  }
});

// The best score a win can reach without a speed bonus, an outread or a fake-out: every order the match
// can play (2 * starsToWin - 1) fully gathered and crafted, plus flawless only when the goal demands it.
function ordinaryWin(level) {
  const stw = level.options.starsToWin;
  const flawless = level.goal.type === 'flawless';
  const orders = level.options.orders.slice(0, flawless ? stw : 2 * stw - 1).map((id) => ITEM_BY_ID[id]);
  let pts = SCORE.matchWin + stw * SCORE.order + (flawless ? SCORE.flawless : 0);
  for (const it of orders) for (const part of it.parts) pts += SCORE.craft + COMPONENTS[part].needs.length * SCORE.gather;
  return pts;
}

test('thresholds: round, ascending, 3 stars a clear step above 2 stars and out of reach of an ordinary win', () => {
  for (const l of LEVELS) {
    const [z, two, three] = l.thresholds;
    assert.equal(z, 0);
    assert.ok(two > 0 && two % 50 === 0 && three % 50 === 0, `level ${l.id} thresholds ${l.thresholds} not multiples of 50`);
    assert.ok(three >= two + Math.max(400, two * 0.1), `level ${l.id}: three ${three} must be at least max(400, 10%) above two ${two}`);
    assert.ok(three > ordinaryWin(l), `level ${l.id}: three ${three} is reachable by an ordinary win (${ordinaryWin(l)})`);
  }
});

test('levelPassed / starsFor: every goal type and the score thresholds', () => {
  const win = LEVELS.find((l) => l.goal.type === 'win');
  const [, two, three] = win.thresholds;
  assert.equal(starsFor(win, summary({ win: false, score: 99999 })), 0);
  assert.equal(starsFor(win, summary({ score: 0 })), 1);
  assert.equal(starsFor(win, summary({ score: two - 1 })), 1);
  assert.equal(starsFor(win, summary({ score: two })), 2);
  assert.equal(starsFor(win, summary({ score: three - 1 })), 2);
  assert.equal(starsFor(win, summary({ score: three })), 3);
  assert.equal(starsFor(win, summary({ score: NaN })), 1);
  assert.equal(levelPassed(win, null), false);
  assert.equal(levelPassed(win, summary({ timeUp: true })), true, 'a plain win may come from the clock');

  const craft = LEVELS.find((l) => l.goal.type === 'craft');
  assert.equal(levelPassed(craft, summary({ crafted: ['torch'] })), craft.goal.item === 'torch');
  assert.equal(levelPassed(craft, summary({ crafted: [craft.goal.item] })), true);
  assert.equal(starsFor(craft, summary({ score: 99999 })), 0, 'a win without the item fails');

  const flawless = LEVELS.find((l) => l.goal.type === 'flawless');
  assert.equal(levelPassed(flawless, summary({ rivalStars: 1 })), false);
  assert.equal(levelPassed(flawless, summary({ rivalStars: 0 })), true);

  const timed = LEVELS.find((l) => l.goal.type === 'win-time');
  assert.equal(levelPassed(timed, summary({ timeUp: true })), false);
  assert.equal(levelPassed(timed, summary({ timeUp: false })), true);
});

// ------------------------------------------------------------ hearts
test('hearts: lose, regenerate over time, refill for gems, clock going backwards', () => {
  const s = fresh();
  assert.deepEqual(eco.heartsNow(s, T0), { n: 5, nextInMs: 0 });
  eco.loseHeart(s, T0);
  assert.equal(s.hearts.n, 4);
  assert.equal(s.hearts.since, T0);
  assert.equal(eco.heartsNow(s, T0 + 5 * MIN).nextInMs, 15 * MIN);
  assert.deepEqual(eco.heartsNow(s, T0 + 20 * MIN), { n: 5, nextInMs: 0 });
  assert.equal(s.hearts.since, null);

  for (let i = 0; i < 3; i++) eco.loseHeart(s, T0 + 30 * MIN);
  assert.equal(eco.heartsNow(s, T0 + 30 * MIN).n, 2);
  eco.loseHeart(s, T0 + 40 * MIN); // the timer keeps running while regenerating
  const h = eco.heartsNow(s, T0 + 60 * MIN);
  assert.deepEqual(h, { n: 2, nextInMs: 10 * MIN });
  assert.equal(eco.heartsNow(s, T0 + 70 * MIN).n, 3);
  assert.equal(eco.heartsNow(s, T0 + 10 * 60 * MIN).n, 5);

  for (let i = 0; i < 7; i++) eco.loseHeart(s, day(1));
  assert.equal(s.hearts.n, 0, 'never below zero');
  assert.equal(eco.canStartLevel(s, day(1)), false);
  assert.equal(eco.canStartLevel(s, day(1) + 20 * MIN), true);
  assert.equal(eco.heartsNow(s, day(1) - 60 * MIN).n, 1, 'a clock set back pays nothing');

  s.wallet.gems = 11;
  assert.deepEqual(eco.refillHearts(s, day(1)), { ok: false, reason: 'gems' });
  s.wallet.gems = 30;
  assert.deepEqual(eco.refillHearts(s, day(1)), { ok: true, reason: null });
  assert.equal(s.wallet.gems, 30 - eco.HEART_REFILL_GEMS);
  assert.deepEqual(eco.heartsNow(s, day(1)), { n: 5, nextInMs: 0 });
  assert.deepEqual(eco.refillHearts(s, day(1)), { ok: false, reason: 'full' });
  assert.equal(s.wallet.gems, 30 - eco.HEART_REFILL_GEMS);
});

// ------------------------------------------------------------ shop, skins, boosters
test('shop: skins can be bought once, only when affordable; only owned skins can be worn', () => {
  const s = fresh();
  for (const k of SKINS) assert.ok(eco.SHOP_BY_ID[k.id]?.kind === 'skin', `${k.id} listed`);
  assert.equal(eco.skinStatus(s, 'explorer'), 'equipped');
  assert.equal(eco.skinStatus(s, 'scout'), 'buy');
  assert.equal(eco.skinStatus(s, 'royal'), 'locked');
  assert.equal(eco.equipSkin(s, 'scout'), false);
  assert.equal(eco.equipSkin(s, 'nope'), false);
  s.wallet.coins = 399;
  assert.deepEqual(eco.buy(s, 'scout', T0), { ok: false, reason: 'coins' });
  s.wallet.coins = 450;
  assert.equal(eco.buy(s, 'scout', T0).ok, true);
  assert.equal(s.wallet.coins, 50);
  assert.deepEqual(eco.buy(s, 'scout', T0), { ok: false, reason: 'owned' });
  assert.equal(s.wallet.coins, 50);
  assert.equal(eco.skinStatus(s, 'scout'), 'owned');
  assert.equal(eco.equipSkin(s, 'scout'), true);
  assert.equal(s.inventory.equipped, 'scout');
  assert.equal(eco.equipSkin(s, 'explorer'), true);
  assert.deepEqual(eco.buy(s, 'festival', T0), { ok: false, reason: 'not-for-sale' });
  assert.deepEqual(eco.buy(s, 'royal', T0), { ok: false, reason: 'not-for-sale' });
  assert.deepEqual(eco.buy(s, 'explorer', T0), { ok: false, reason: 'owned' });
  assert.deepEqual(eco.buy(s, 'bogus', T0), { ok: false, reason: 'unknown' });
  s.wallet.gems = SKIN_BY_ID.astronaut.price.gems - 1;
  assert.deepEqual(eco.buy(s, 'astronaut', T0), { ok: false, reason: 'gems' });
  s.wallet.gems += 1;
  assert.equal(eco.buy(s, 'astronaut', T0).ok, true);
  assert.equal(s.wallet.gems, 0);
  for (const r of Object.keys(eco.REASONS)) assert.ok(eco.REASONS[r]);
});

test('shop: booster singles and packs, heart refill, gems -> coins exchange', () => {
  const s = fresh();
  s.wallet.coins = 1000;
  const b0 = s.inventory.boosters.fog;
  assert.equal(eco.buy(s, 'fog', T0).ok, true);
  assert.equal(s.inventory.boosters.fog, b0 + 1);
  assert.equal(s.wallet.coins, 1000 - eco.BOOSTERS.fog.price.coins);
  const pack = eco.SHOP_BY_ID['boots-pack'];
  assert.ok(pack.count === 3 && pack.price.coins < 3 * eco.BOOSTERS.boots.price.coins);
  const c = s.wallet.coins;
  assert.equal(eco.buy(s, 'boots-pack', T0).ok, true);
  assert.equal(s.inventory.boosters.boots, 1 + 3);
  assert.equal(s.wallet.coins, c - pack.price.coins);
  for (const id of eco.BOOSTER_IDS) {
    const b = eco.BOOSTERS[id];
    assert.ok(b.price.coins >= 60 && b.price.coins <= 120 && b.icon && b.name && b.desc && Object.keys(b.options).length);
    assert.equal(eco.SHOP_BY_ID[`${id}-pack`].price.coins, b.price.coins * 2.5, 'a pack of 3 costs 2.5 singles');
  }
  assert.deepEqual(eco.buy(s, 'hearts', T0), { ok: false, reason: 'full' });
  eco.loseHeart(s, T0);
  s.wallet.gems = 20;
  assert.equal(eco.buy(s, 'hearts', T0).ok, true);
  assert.equal(s.hearts.n, 5);
  assert.equal(s.wallet.gems, 8);
  const coins = s.wallet.coins;
  assert.deepEqual(eco.buy(s, 'coins-250', T0), { ok: false, reason: 'gems' });
  s.wallet.gems = 10;
  assert.equal(eco.buy(s, 'coins-250', T0).ok, true);
  assert.equal(s.wallet.coins, coins + 250);
  assert.equal(s.wallet.gems, 0);
});

test('boosters: useBoosters consumes one of each owned booster and merges the match options', () => {
  const s = fresh(); // boots 1, backpack 1, headstart 0, fog 0
  const o = eco.useBoosters(s, ['boots', 'backpack', 'boots', 'fog', 'bogus']);
  assert.deepEqual(o, { playerSpeedMul: 1.12, playerBagBonus: 1 });
  assert.deepEqual(s.inventory.boosters, { boots: 0, backpack: 0, headstart: 0, fog: 0 });
  assert.deepEqual(eco.useBoosters(s, ['boots']), {});
  s.inventory.boosters.headstart = 2;
  s.inventory.boosters.fog = 1;
  assert.deepEqual(eco.useBoosters(s, ['headstart', 'fog']), { rivalDelay: 2.5, blindOrders: 1 });
  assert.equal(s.inventory.boosters.headstart, 1);
  assert.deepEqual(eco.useBoosters(s), {});
  // Merged on top of a level's options without touching the catalogue.
  const cfg = matchConfig(levelById(3));
  const opts = { ...cfg.options, ...eco.useBoosters(s, ['headstart']) };
  assert.equal(opts.rivalDelay, 2.5);
  assert.equal(levelById(3).options.rivalDelay, undefined);
});

// ------------------------------------------------------------ Adventure results
test('grantLevelResult: first clear, replay, improving stars, unlocking, failing', () => {
  const s = fresh();
  const l1 = levelById(1);
  const [, two, three] = l1.thresholds;
  const coins0 = s.wallet.coins;
  const gems0 = s.wallet.gems;

  const fail = eco.grantLevelResult(s, l1, summary({ win: false, stw: 2 }), T0);
  assert.deepEqual([fail.passed, fail.stars, fail.firstClear, fail.coins, fail.gems, fail.unlocked], [false, 0, false, 0, 0, null]);
  assert.equal(s.adventure.unlocked, 1);
  assert.deepEqual(s.levels[1], { stars: 0, best: 0, plays: 1 });
  assert.equal(s.hearts.n, 5, 'hearts are the caller\'s business (loseHeart)');

  const r1 = eco.grantLevelResult(s, l1, passFor(l1, two), T0);
  assert.deepEqual([r1.passed, r1.stars, r1.newStars, r1.firstClear, r1.unlocked, r1.best], [true, 2, 2, true, 2, two]);
  assert.equal(r1.coins, l1.reward.coins);
  assert.equal(r1.gems, l1.reward.gems + eco.STAR_GEMS[1] + eco.STAR_GEMS[2]);
  assert.equal(s.adventure.unlocked, 2);
  assert.equal(s.wallet.coins, coins0 + r1.coins);
  assert.equal(s.wallet.gems, gems0 + r1.gems);

  const r2 = eco.grantLevelResult(s, l1, passFor(l1, 0), T0);
  assert.deepEqual([r2.stars, r2.newStars, r2.firstClear, r2.unlocked, r2.best, r2.gems], [1, 0, false, null, two, 0]);
  assert.ok(r2.coins > 0 && r2.coins < l1.reward.coins, 'a replay pays a little');
  assert.equal(s.levels[1].stars, 2, 'stars never go down');

  const r3 = eco.grantLevelResult(s, l1, passFor(l1, three + 10), T0);
  assert.deepEqual([r3.stars, r3.newStars, r3.gems, r3.best, r3.unlocked], [3, 1, eco.STAR_GEMS[3], three + 10, null]);
  assert.deepEqual(s.levels[1], { stars: 3, best: three + 10, plays: 4 });
  assert.equal(eco.totalStars(s), 3);
  assert.equal(eco.clearedCount(s), 1);
  assert.equal(s.counters.levelsWon, 3);
  assert.equal(s.counters.starsEarned, 3);
  assert.equal(s.counters.coinsEarned, s.wallet.coins - coins0);

  // A failed replay changes nothing but the play count.
  const before = JSON.stringify({ w: s.wallet, a: s.adventure });
  eco.grantLevelResult(s, l1, summary({ win: false }), T0);
  assert.equal(JSON.stringify({ w: s.wallet, a: s.adventure }), before);
  assert.equal(s.levels[1].plays, 5);

  // Bosses pay double and gems; the last level unlocks nothing further.
  const boss = levelById(10);
  s.adventure.unlocked = 10;
  const rb = eco.grantLevelResult(s, boss, passFor(boss, 0), T0);
  assert.ok(rb.gems >= boss.reward.gems && boss.reward.gems > 0 && rb.unlocked === 11);
  const last = levelById(60);
  s.adventure.unlocked = 60;
  assert.equal(eco.grantLevelResult(s, last, passFor(last, 0), T0).unlocked, null);
  assert.equal(s.adventure.unlocked, 60);
  // Goal conditions: winning the match is not enough on a craft level.
  const craft = LEVELS.find((l) => l.goal.type === 'craft');
  const rc = eco.grantLevelResult(s, craft, summary({ crafted: [] }), T0);
  assert.equal(rc.passed, false);
  assert.equal(s.levels[craft.id].stars, 0);
});

test('recordQuickRace: small capped coin reward per local day, counters for every match', () => {
  const s = fresh();
  const c0 = s.wallet.coins;
  assert.deepEqual(eco.recordQuickRace(s, summary({ win: false, fooled: 2, outread: 3 }), { now: T0 }), { coins: 0, capped: false, paidToday: 0, cap: eco.QUICK_PAID_PER_DAY });
  assert.equal(s.counters.fakeOuts, 2);
  assert.equal(s.counters.outreads, 3);
  let paid = 0;
  for (let i = 0; i < eco.QUICK_PAID_PER_DAY + 3; i++) paid += eco.recordQuickRace(s, summary(), { now: T0 + i * MIN }).coins;
  assert.equal(paid, eco.QUICK_PAID_PER_DAY * eco.QUICK_WIN_COINS);
  assert.equal(eco.recordQuickRace(s, summary(), { now: T0 }).capped, true);
  assert.equal(eco.recordQuickRace(s, summary(), { now: day(1), daily: true }).coins, 2 * eco.QUICK_WIN_COINS, 'a new day pays again');
  assert.equal(s.wallet.coins, c0 + paid + 2 * eco.QUICK_WIN_COINS);
  eco.recordQuickRace(s, summary({ rivalStars: 0 }), { now: day(1) });
  assert.equal(s.counters.flawless, 1);
});

// ------------------------------------------------------------ daily reward
test('daily reward: consecutive local days, same-day repeat, gaps, day 7 skin then gems', () => {
  const s = fresh();
  assert.equal(eco.DAILY_REWARDS.length, 7);
  assert.equal(eco.DAILY_REWARDS[6].skin, 'festival');
  let st = eco.dailyStatus(s, T0);
  assert.deepEqual([st.canClaim, st.day, st.rewards.length, st.rewards[0].status], [true, 1, 7, 'today']);
  assert.equal(eco.claimDaily(s, T0).day, 1);
  assert.equal(eco.claimDaily(s, T0 + 60 * MIN), null, 'once per day');
  st = eco.dailyStatus(s, T0 + 60 * MIN);
  assert.deepEqual([st.canClaim, st.day, st.rewards[0].status, st.rewards[1].status], [false, 1, 'claimed', 'locked']);
  assert.ok(st.nextInMs > 0 && st.nextInMs <= 14 * 60 * MIN);
  // Just after midnight counts as the next day.
  assert.equal(eco.claimDaily(s, day(1, 0) + MIN).day, 2);
  // Skipping a day starts over.
  assert.equal(eco.claimDaily(s, day(3)).day, 1);
  const owned = s.inventory.skins.length;
  let last;
  for (let d = 4; d <= 9; d++) last = eco.claimDaily(s, day(d));
  assert.equal(last.day, 7);
  assert.equal(last.skin, 'festival');
  assert.ok(s.inventory.skins.includes('festival') && s.inventory.skins.length === owned + 1);
  assert.equal(s.dailyReward.best, 7);
  // The cycle restarts; the next day 7 pays 25 gems because the skin is owned.
  assert.equal(eco.claimDaily(s, day(10)).day, 1);
  assert.equal(eco.dailyStatus(s, day(11)).rewards[6].gems, 25);
  for (let d = 11; d < 16; d++) eco.claimDaily(s, day(d));
  const gems = s.wallet.gems;
  last = eco.claimDaily(s, day(16));
  assert.deepEqual([last.day, last.gems, last.skin], [7, 25, undefined]);
  assert.equal(s.wallet.gems, gems + 25);
  // A clock or time zone moved back a day: no claim until the date catches up.
  assert.equal(eco.dailyStatus(s, day(15)).canClaim, false);
  assert.equal(eco.claimDaily(s, day(15)), null);
  assert.equal(eco.claimDaily(s, day(17)).day, 1);
});

test('daily reward: booster and coin days are paid into the save', () => {
  const s = fresh();
  const before = { ...s.inventory.boosters };
  const coins = s.wallet.coins;
  const got = [];
  for (let d = 0; d < 7; d++) got.push(eco.claimDaily(s, day(d)));
  let expectCoins = coins;
  const expectBoost = { ...before };
  for (const r of eco.DAILY_REWARDS) {
    expectCoins += r.coins || 0;
    if (r.booster) expectBoost[r.booster] += r.count || 1;
  }
  assert.equal(s.wallet.coins, expectCoins);
  assert.deepEqual(s.inventory.boosters, expectBoost);
  assert.ok(got.every((g) => g.label && g.icon));
});

// ------------------------------------------------------------ achievements
test('achievements: progress, claim exactly once, rewards (Royal skin for beating MIMIC)', () => {
  const s = fresh();
  assert.ok(eco.ACHIEVEMENTS.length >= 12);
  assert.equal(new Set(eco.ACHIEVEMENTS.map((a) => a.id)).size, eco.ACHIEVEMENTS.length);
  for (const a of eco.achievementStatus(s)) assert.ok(!a.done && !a.canClaim && a.cur < a.target && a.label, a.id);
  assert.equal(eco.claimableAchievements(s), 0);
  assert.equal(eco.claimAchievement(s, 'first-win'), null, 'not reached yet');
  assert.equal(eco.claimAchievement(s, 'bogus'), null);

  eco.grantLevelResult(s, levelById(1), passFor(levelById(1)), T0);
  const st = eco.achievementStatus(s).find((a) => a.id === 'first-win');
  assert.deepEqual([st.cur, st.target, st.canClaim], [1, 1, true]);
  assert.equal(eco.claimableAchievements(s), 1);
  const wealth = () => s.wallet.coins + s.wallet.gems + Object.values(s.inventory.boosters).reduce((x, y) => x + y, 0);
  const w0 = wealth();
  const got = eco.claimAchievement(s, 'first-win');
  assert.ok(got && got.label && got.icon);
  assert.ok(wealth() > w0, 'the reward is paid');
  assert.equal(eco.claimAchievement(s, 'first-win'), null, 'only once');
  assert.equal(eco.achievementStatus(s).find((a) => a.id === 'first-win').claimed, true);

  // Beat MIMIC in the Adventure -> the Royal skin.
  const mimic = LEVELS.find((l) => l.rival === 'mimic');
  s.adventure.unlocked = mimic.id;
  eco.grantLevelResult(s, mimic, passFor(mimic), T0);
  assert.ok(eco.claimAchievement(s, 'mimic').skin === 'royal' && s.inventory.skins.includes('royal'));
  assert.equal(eco.equipSkin(s, 'royal'), true);

  // Counters, codex, skins and daily streak goals.
  s.counters.fakeOuts = 9;
  assert.equal(eco.claimAchievement(s, 'fakeouts-10'), null);
  eco.recordQuickRace(s, summary({ fooled: 1 }), { now: T0 });
  const fog = s.inventory.boosters.fog;
  assert.ok(eco.claimAchievement(s, 'fakeouts-10'));
  assert.ok(s.inventory.boosters.fog > fog);
  for (const it of ITEMS) s.codex[it.id] = { count: 1, first: '2026-10-05' };
  assert.equal(codexCount(s), 12);
  assert.ok(eco.claimAchievement(s, 'codex'));
  s.inventory.skins.push('scout', 'chef');
  assert.equal(eco.achievementStatus(s).find((a) => a.id === 'skins-5').cur, 4);
  s.inventory.skins.push('pirate');
  assert.ok(eco.claimAchievement(s, 'skins-5'));
  for (let d = 0; d < 7; d++) eco.claimDaily(s, day(d));
  eco.claimDaily(s, day(8)); // the streak breaks, but the achievement was earned
  assert.ok(eco.claimAchievement(s, 'daily-7'));
  // Star goals use the best stars per level.
  for (const l of LEVELS.slice(0, 17)) s.levels[l.id] = { stars: 3, best: 0, plays: 1 };
  assert.ok(eco.totalStars(s) >= 50);
  assert.ok(eco.claimAchievement(s, 'stars-50'));
  assert.equal(eco.claimAchievement(s, 'stars-100'), null);
});

// ------------------------------------------------------------ save file
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// A notebook as PlayerModel.toJSON() writes it, after some play.
function notebook() {
  const m = new PlayerModel();
  m.t.beeline = { o: 30.5, e: 18, v: 7.9, n: 42 };
  m.t.routine = { wood: { stone: { o: 4, e: 1.5, v: 1.1, n: 6 } } };
  m.matches = 12;
  return JSON.parse(JSON.stringify(m.toJSON()));
}

// A save written by the 2D prototype (shape of fresh() in the v1 storage.js) after some play.
const V1_SAVE = {
  model: notebook(),
  ladder: { unlocked: 2, beaten: { pip: true, wren: true } },
  codex: { torch: { count: 3, first: '2026-09-21' }, lantern: { count: 1, first: '2026-09-22' } },
  dex: { beeline: { status: 'detected', acc: 0.6, chance: 0.3, date: '2026-09-22' } },
  stats: { matches: 12, wins: 7, snatched: 20, outread: 9, history: [{ t: 1, win: true, rival: 'pip', snatched: 1, outread: 2, gathers: 9 }] },
  daily: { lastKey: '2026-09-24', streak: 3, best: 4, results: { '2026-09-24': { win: true, stars: { player: 3, rival: 1 }, results: [], twist: 'rush', number: 5, snatched: 1, outread: 2 } } },
  settings: { sound: false, glass: true },
  seenHowTo: true,
  lastPlayed: 1758700000000,
  tutorialDone: true,
  tips: { glass: true },
};

test('save: load() migrates a v1 save without losing anything and adds the new fields', () => {
  globalThis.localStorage = memoryStorage();
  localStorage.setItem('outcraft.v1', JSON.stringify(V1_SAVE));
  const s = load();
  for (const k of Object.keys(V1_SAVE)) if (k !== 'settings') assert.deepEqual(s[k], V1_SAVE[k], k);
  assert.equal(s.settings.sound, false);
  assert.equal(s.settings.glass, true);
  const f = fresh();
  for (const k of ['music', 'quality', 'sensitivity', 'invertY', 'autoReturn']) assert.equal(s.settings[k], f.settings[k]);
  for (const k of ['wallet', 'hearts', 'inventory', 'levels', 'adventure', 'dailyReward', 'achievements', 'counters', 'quickRace']) assert.deepEqual(s[k], f[k], k);
  // The migrated save keeps working with the existing systems.
  const r = recordMatch(s, summary({ crafted: ['torch', 'rod'] }), { rivalIndex: 2, now: T0 });
  assert.deepEqual(r.newItems, ['rod']);
  assert.equal(s.codex.torch.count, 4);
  assert.equal(s.ladder.unlocked, 3);
  save(s);
  assert.deepEqual(load(), JSON.parse(JSON.stringify(s)), 'save/load round trip');
});

test('save: fresh() has the contract fields; partial and corrupt saves are repaired', () => {
  const f = fresh();
  assert.deepEqual(f.wallet, { coins: 300, gems: 15 });
  assert.deepEqual(f.hearts, { n: 5, since: null });
  assert.deepEqual(f.inventory, { skins: ['explorer'], equipped: 'explorer', boosters: { boots: 1, backpack: 1, headstart: 0, fog: 0 } });
  assert.deepEqual(f.adventure, { unlocked: 1 });
  assert.deepEqual(f.counters, { levelsWon: 0, starsEarned: 0, fakeOuts: 0, outreads: 0, flawless: 0, coinsEarned: 0 });
  assert.deepEqual(f.settings, { sound: true, music: true, glass: false, quality: 'auto', sensitivity: 1, invertY: false, autoReturn: false });
  assert.notEqual(fresh().inventory, fresh().inventory, 'no shared objects between saves');

  const s = migrate({
    wallet: { coins: 120.7, gems: -4 },
    hearts: { n: 2, since: 'soon' },
    inventory: { skins: ['scout', 'ghost', 'scout'], equipped: 'ghost', boosters: { fog: 2 } },
    levels: { 1: { stars: 3, best: 4000, plays: 2 }, 2: { stars: 9 }, junk: { stars: 1 }, 3: 'x' },
    adventure: { unlocked: 0 },
    dailyReward: { lastKey: '2026-10-01', day: 12 },
    counters: { outreads: 4 },
    settings: { quality: 'ultra', sensitivity: 50, invertY: 'yes' },
    achievements: null,
  });
  assert.deepEqual(s.wallet, { coins: 120, gems: 0 });
  assert.deepEqual(s.hearts, { n: 2, since: null });
  assert.deepEqual(s.inventory.skins, ['explorer', 'scout']);
  assert.equal(s.inventory.equipped, 'explorer');
  assert.deepEqual(s.inventory.boosters, { boots: 1, backpack: 1, headstart: 0, fog: 2 });
  assert.deepEqual(s.levels, { 1: { stars: 3, best: 4000, plays: 2 }, 2: { stars: 3, best: 0, plays: 0 } });
  assert.equal(s.adventure.unlocked, 1);
  assert.deepEqual(s.dailyReward, { lastKey: '2026-10-01', day: 7, best: 7 });
  assert.equal(s.counters.outreads, 4);
  assert.equal(s.counters.levelsWon, 0);
  assert.deepEqual([s.settings.quality, s.settings.sensitivity, s.settings.invertY], ['auto', 3, false]);
  assert.deepEqual(s.achievements, { claimed: {} });
  assert.deepEqual(s.stats, f.stats);

  globalThis.localStorage = memoryStorage();
  assert.deepEqual(load(), fresh(), 'no save yet');
  localStorage.setItem('outcraft.v1', '{not json');
  assert.deepEqual(load(), fresh(), 'corrupt JSON');
  localStorage.setItem('outcraft.v1', 'null');
  assert.deepEqual(load(), fresh(), 'a JSON null');
  globalThis.localStorage = undefined;
  assert.deepEqual(load(), fresh(), 'no localStorage at all');
  save(fresh()); // must not throw
});

// ------------------------------------------------------------ save file: tabs, failures, repairs
const tabB = await import('../src/storage.js?tab=b'); // a second tab: its own module state, the same storage
const tabC = await import('../src/storage.js?tab=c');
const stored = () => JSON.parse(localStorage.getItem('outcraft.v1'));
const useStorage = (value) => Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value });

function quotaStorage(limit) {
  const m = memoryStorage();
  const setItem = (k, v) => {
    if (String(v).length > limit) {
      const e = new Error('The quota has been exceeded.');
      e.name = 'QuotaExceededError';
      throw e;
    }
    m.setItem(k, v);
  };
  return { ...m, setItem };
}

test('save: every save bumps rev; a stale tab cannot overwrite newer progress, and saves again after reloading', () => {
  useStorage(memoryStorage());
  const a = load();
  const b = tabB.load();
  assert.equal(a.rev, 0);
  a.wallet.coins = 1850;
  a.adventure.unlocked = 12;
  assert.equal(save(a), true);
  assert.equal(a.rev, 1);
  assert.deepEqual(store.saveStatus(), { ok: true, reason: null });
  assert.equal(save(a), true);
  assert.equal(stored().rev, 2);
  // Tab B, idle since before that, autosaves its stale copy (the heart-regen tick): refused.
  b.hearts.n = 5;
  assert.equal(tabB.save(b), false);
  assert.deepEqual(tabB.saveStatus(), { ok: false, reason: 'stale' });
  assert.equal(b.rev, 0, 'a refused save leaves the state alone');
  assert.deepEqual([stored().wallet.coins, stored().adventure.unlocked, stored().rev], [1850, 12, 2]);
  // Reloaded (what watchExternal triggers), tab B saves on top of A's progress...
  const b2 = tabB.load();
  assert.equal(b2.wallet.coins, 1850);
  b2.wallet.gems = 99;
  assert.equal(tabB.save(b2), true);
  assert.equal(b2.rev, 3);
  // ...and now tab A is the stale one.
  assert.equal(save(a), false);
  assert.equal(store.saveStatus().reason, 'stale');
  assert.equal(stored().wallet.gems, 99);
  // A reset never moves rev backwards, so the other tab still sees it as newer.
  const a2 = load();
  const w = store.wipe({ settings: a2.settings });
  assert.equal(save(w), true);
  assert.equal(w.rev, 4);
  assert.deepEqual([stored().wallet.coins, stored().rev], [300, 4]);
  assert.equal(tabB.save(b2), false, 'B must reload after the reset');
  // A tab that never loaded compares with the rev of the state it saves.
  assert.equal(tabC.save({ ...fresh(), rev: 2 }), false);
  assert.equal(tabC.save({ ...fresh(), rev: 4 }), true);
  assert.equal(stored().rev, 5);
});

test('save: watchExternal calls back when another tab writes the save, until unsubscribed', () => {
  const ls = memoryStorage();
  useStorage(ls);
  const handlers = new Set();
  globalThis.window = { addEventListener: (t, h) => t === 'storage' && handlers.add(h), removeEventListener: (t, h) => t === 'storage' && handlers.delete(h) };
  let calls = 0;
  const off = store.watchExternal(() => calls++);
  const fire = (e) => handlers.forEach((h) => h(e));
  fire({ key: 'outcraft.v1', storageArea: ls });
  fire({ key: 'something.else', storageArea: ls });
  fire({ key: 'outcraft.v1', storageArea: memoryStorage() }); // sessionStorage
  fire({ key: null, storageArea: ls }); // localStorage.clear() in another tab
  assert.equal(calls, 2);
  off();
  assert.equal(handlers.size, 0);
  delete globalThis.window;
  const noop = store.watchExternal(() => calls++);
  assert.equal(typeof noop, 'function', 'no window (Node): a no-op');
  noop();
});

test('save: blocked or full storage is reported; a full storage is trimmed and retried once', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      const e = new Error('The operation is insecure.');
      e.name = 'SecurityError';
      throw e;
    },
  });
  assert.deepEqual(load(), fresh());
  assert.deepEqual(store.saveStatus(), { ok: false, reason: 'blocked' });
  assert.equal(store.storageAvailable(), false);
  assert.equal(save(fresh()), false);
  assert.equal(store.saveStatus().reason, 'blocked');
  assert.equal(store.backup('x'), false);

  useStorage(memoryStorage());
  assert.equal(store.storageAvailable(), true);
  const s = load();
  for (let i = 0; i < 40; i++) s.stats.history.push({ t: i, win: true, rival: 'pip', snatched: 1, outread: 1, gathers: 9 });
  for (let i = 1; i <= 14; i++) s.daily.results[`2026-09-${String(i).padStart(2, '0')}`] = { win: true, stars: { player: 3, rival: 0 }, results: [] };
  const size = JSON.stringify({ ...s, rev: 1 }).length;
  useStorage(quotaStorage(size - 100));
  load();
  localStorage.setItem('outcraft.v1.bak', 'old');
  assert.equal(save(s), true, 'fits once the oldest history is trimmed');
  assert.deepEqual([s.stats.history.length, Object.keys(s.daily.results).length, s.rev], [10, 7, 1]);
  assert.equal(Object.keys(s.daily.results).sort()[0], '2026-09-08', 'the newest Daily results are kept');
  assert.equal(localStorage.getItem('outcraft.v1.bak'), null, 'the backup made room');
  assert.equal(stored().rev, 1);

  useStorage(quotaStorage(100));
  load();
  const t = fresh();
  assert.equal(save(t), false);
  assert.deepEqual(store.saveStatus(), { ok: false, reason: 'quota' });
  assert.equal(t.rev, 0, 'rev is only bumped by a save that went through');
  useStorage(quotaStorage(0));
  assert.equal(store.storageAvailable(), false);
  assert.equal(store.saveStatus().reason, 'quota');
  useStorage(memoryStorage());
});

// The corrupted-but-parseable saves that used to stop the 3D edition behind the "no WebGL" screen
// (robustness review, corrupt.mjs), plus a few more of the same kind.
const HIST = { matches: 3, wins: 1, snatched: 0, outread: 0, history: [] };
const CORRUPT = {
  dailyRewardKeyNum: { dailyReward: { lastKey: 20260926, day: 3 } },
  dailyKeyNum: { daily: { lastKey: 5, streak: 2, best: 2, results: {} } },
  quickRaceKeyObj: { quickRace: { key: {}, paid: 1 } },
  modelString: { model: 'corrupt', stats: HIST },
  modelPartial: { model: { t: {}, w: {}, matches: 2 }, stats: HIST },
  ladderOOR: { ladder: { unlocked: 7, beaten: {} } },
  codexPrim: { codex: { torch: 5 } },
  dexPrim: { dex: { beeline: 'detected' } },
  lastPlayedStr: { lastPlayed: 'yesterday', stats: HIST },
  resultsBad: { daily: { lastKey: null, streak: 0, best: 0, results: { '2026-10-05': true } } },
  resultsNoStars: { daily: { lastKey: '2026-10-05', streak: 1, best: 1, results: { '2026-10-05': { win: true }, soon: { stars: { player: 1, rival: 3 } } } } },
  modelBadWeights: { model: { ...notebook(), w: { beeline: 'heavy' } } },
  modelBadRoutine: { model: { ...notebook(), t: { ...notebook().t, routine: { wood: 3 } } } },
  ladderBeaten: { ladder: { unlocked: -2, beaten: { pip: 'yes', fox: true, ghost: true } } },
  historyJunk: { stats: { ...HIST, history: [null, 3, { t: 1, win: true }] } },
  tipsString: { tips: 'glass', tutorialDone: 'yes' },
  activeLevelBad: { activeLevel: { id: '4', at: T0 }, replays: { key: 7, paid: 'lots' } },
  unlockedHuge: { adventure: { unlocked: 1e9 }, dexExtra: 1, dex: { book: { status: 'detected', acc: 'x' } } },
};

// Everything the title, map, level popup, a level, a Daily and the calendar do with a save.
function playThrough(s) {
  const d = todaysDaily(dateKey(new Date(T0)));
  const done = s.daily.results[d.key];
  if (done) assert.ok(Number.isFinite(done.stars.player) && Number.isFinite(done.stars.rival));
  for (const k of [s.daily.lastKey, s.dailyReward.lastKey]) if (k) daysBetween(k, d.key);
  assert.ok(RIVALS[s.ladder.unlocked].name);
  const model = new PlayerModel(s.model);
  model.dossier(1);
  model.beginMatch();
  model.endMatch();
  eco.dailyStatus(s, T0);
  eco.achievementStatus(s);
  codexCount(s);
  dexCounts(s);
  eco.heartsNow(s, T0);
  assert.ok(levelById(eco.currentLevel(s)));
  const l1 = levelById(1);
  assert.equal(eco.startLevelHeart(s, 1, T0), eco.heartsNow(s, T0).n > 0);
  recordMatch(s, summary({ crafted: ['torch'] }), { now: T0 });
  eco.finishLevelHeart(s, eco.grantLevelResult(s, l1, passFor(l1), T0).passed, T0);
  const ranked = store.markDailyAttempt(s, d);
  recordMatch(s, summary(), { daily: { ...d, ranked }, now: T0 });
  eco.recordQuickRace(s, summary(), { now: T0, daily: ranked });
  eco.claimDaily(s, T0);
  if (s.tips) s.tips.glass = true;
  return JSON.parse(JSON.stringify(s));
}

test('save: every corrupted save shape boots and plays; the broken field is repaired, the rest kept', () => {
  const m = {};
  for (const [name, saved] of Object.entries(CORRUPT)) {
    const s = migrate(JSON.parse(JSON.stringify(saved)));
    assert.doesNotThrow(() => playThrough(migrate(JSON.parse(JSON.stringify(saved)))), name);
    assert.deepEqual(migrate(JSON.parse(JSON.stringify(s))), s, `${name}: repairing is stable`);
    m[name] = s;
  }
  assert.deepEqual([m.dailyRewardKeyNum.dailyReward.lastKey, m.dailyRewardKeyNum.dailyReward.day], [null, 3]);
  assert.deepEqual([m.dailyKeyNum.daily.lastKey, m.dailyKeyNum.daily.streak], [null, 2]);
  assert.deepEqual(m.quickRaceKeyObj.quickRace, { key: null, paid: 1 });
  assert.equal(m.modelString.model, null);
  assert.equal(m.modelPartial.model, null);
  assert.equal(m.modelString.stats.matches, 3, 'the rest of the save is kept');
  assert.equal(m.modelBadWeights.model, null);
  assert.equal(m.modelBadRoutine.model, null);
  assert.deepEqual(migrate({ model: notebook() }).model, notebook(), 'a healthy notebook is kept as is');
  assert.equal(m.ladderOOR.ladder.unlocked, RIVALS.length - 1);
  assert.deepEqual(m.ladderBeaten.ladder, { unlocked: 0, beaten: { fox: true } });
  assert.deepEqual(m.codexPrim.codex, {});
  assert.deepEqual(migrate({ codex: { torch: { count: 2.5, first: '2026-10-01' }, rod: { count: 'x' } } }).codex, { torch: { count: 2, first: '2026-10-01' } });
  assert.deepEqual(m.dexPrim.dex, {});
  assert.deepEqual(m.unlockedHuge.dex, { book: { status: 'detected', acc: 0 } });
  assert.equal(m.lastPlayedStr.lastPlayed, null);
  assert.deepEqual(m.resultsBad.daily.results, {});
  assert.deepEqual(m.resultsNoStars.daily.results, { '2026-10-05': { win: true, stars: { player: 0, rival: 0 } } });
  assert.deepEqual(m.historyJunk.stats.history, [{ t: 1, win: true }]);
  assert.deepEqual(['tips' in m.tipsString, m.tipsString.tutorialDone], [false, false]);
  assert.deepEqual([m.activeLevelBad.activeLevel, m.activeLevelBad.replays], [null, { key: null, paid: 0 }]);
  assert.equal(m.unlockedHuge.adventure.unlocked, LEVELS.length);

  // Through load(): an unreadable save is backed up before anything overwrites it.
  useStorage(memoryStorage());
  const truncated = '{"wallet":{"coins":4200,"gems":80},"levels":{"1":{"stars":3';
  localStorage.setItem('outcraft.v1', truncated);
  const s = load();
  assert.deepEqual(s, fresh());
  assert.equal(localStorage.getItem('outcraft.v1.bak'), truncated);
  assert.equal(save(s), true);
  assert.equal(localStorage.getItem('outcraft.v1.bak'), truncated, 'still there after the next save');
  localStorage.setItem('outcraft.v1', JSON.stringify(CORRUPT.ladderOOR));
  assert.equal(load().ladder.unlocked, RIVALS.length - 1);
  assert.equal(store.backup(), true);
  assert.equal(localStorage.getItem('outcraft.v1.bak'), JSON.stringify(CORRUPT.ladderOOR));
});

test('save: the 3D-only flags start false, even for a classic save that finished the 2D tutorial', () => {
  const f = fresh();
  assert.deepEqual([f.rev, f.tutorial3d, f.seenHowTo3d, f.activeLevel, f.replays], [0, false, false, null, { key: null, paid: 0 }]);
  const s = migrate(JSON.parse(JSON.stringify(V1_SAVE)));
  assert.deepEqual([s.tutorialDone, s.seenHowTo, s.tutorial3d, s.seenHowTo3d], [true, true, false, false]);
  const t = migrate({ tutorial3d: true, seenHowTo3d: 'yes', activeLevel: { id: 12, at: T0 }, rev: 7.5 });
  assert.deepEqual([t.tutorial3d, t.seenHowTo3d, t.activeLevel, t.rev], [true, false, { id: 12, at: T0 }, 7]);
});

test('classic: MAKE THEM FORGET ME resets only the 2D progress; coins, skins, levels and hearts survive', () => {
  useStorage(memoryStorage());
  const s = load();
  Object.assign(s.wallet, { coins: 1150, gems: 40 });
  s.adventure.unlocked = 7;
  s.levels[1] = { stars: 3, best: 4200, plays: 2 };
  s.inventory.skins.push('scout');
  s.hearts = { n: 3, since: T0 };
  s.achievements.claimed['first-win'] = true;
  s.tutorial3d = true;
  s.settings.music = false;
  s.model = notebook();
  s.codex.torch = { count: 2, first: '2026-10-01' };
  s.ladder = { unlocked: 3, beaten: { pip: true, wren: true, fox: true } };
  s.stats.matches = 7;
  s.tutorialDone = true;
  assert.equal(save(s), true);
  // The classic page: load, forget (exactly as classic/src/main.js does), save.
  let c = classic.load();
  c = classic.wipe({ settings: c.settings, seenHowTo: true });
  classic.save(c);
  const raw = stored();
  assert.deepEqual([raw.model, raw.codex, raw.dex, raw.ladder, raw.stats.matches, raw.seenHowTo, raw.tutorialDone], [null, {}, {}, { unlocked: 0, beaten: {} }, 0, true, undefined]);
  const back = load();
  assert.deepEqual(back.wallet, { coins: 1150, gems: 40 });
  assert.deepEqual([back.adventure.unlocked, back.levels[1], back.inventory.skins, back.hearts], [7, { stars: 3, best: 4200, plays: 2 }, ['explorer', 'scout'], { n: 3, since: T0 }]);
  assert.deepEqual([back.achievements.claimed, back.tutorial3d, back.settings.music, back.rev], [{ 'first-win': true }, true, false, 2], 'the classic write bumps rev too');
  // No save at all: a plain classic fresh start.
  useStorage(memoryStorage());
  assert.deepEqual(Object.keys(classic.wipe({ seenHowTo: true })).sort(), ['codex', 'daily', 'dex', 'ladder', 'lastPlayed', 'model', 'seenHowTo', 'settings', 'stats']);
});

test('classic: a stale 2D tab writes only its own fields over newer 3D progress, and 3D tabs see it as newer', () => {
  useStorage(memoryStorage());
  const s = load();
  s.wallet.coins = 500;
  assert.equal(save(s), true);
  const c = classic.load(); // the 2D tab loads rev 1
  const s2 = load();
  Object.assign(s2.wallet, { coins: 1850 });
  s2.adventure.unlocked = 12;
  assert.equal(save(s2), true); // another tab: rev 2
  c.stats.matches = 7;
  c.codex.torch = { count: 1, first: '2026-10-01' };
  classic.save(c); // stale 2D save
  const raw = stored();
  assert.deepEqual([raw.wallet.coins, raw.adventure.unlocked, raw.stats.matches, raw.codex.torch.count, raw.rev], [1850, 12, 7, 1, 3]);
  assert.equal(save(s2), false, 'the 3D tab that last saved rev 2 must reload first');
  assert.equal(store.saveStatus().reason, 'stale');
});

// ------------------------------------------------------------ hearts: Candy Crush model
test('hearts: PLAY spends a heart, a pass refunds it; a fail, a quit or a reload keeps it spent', () => {
  const s = fresh();
  assert.equal(eco.startLevelHeart(s, 3, T0), true);
  assert.deepEqual([s.hearts.n, s.hearts.since, s.activeLevel], [4, T0, { id: 3, at: T0 }]);
  assert.equal(eco.finishLevelHeart(s, true, T0 + 2 * MIN), true);
  assert.deepEqual([s.hearts.n, s.hearts.since, s.activeLevel], [5, null, null]);
  assert.equal(eco.finishLevelHeart(s, true, T0 + 3 * MIN), false, 'no level in progress: nothing to refund');
  assert.equal(s.hearts.n, 5);
  // A fail keeps the heart spent.
  eco.startLevelHeart(s, 3, T0 + 10 * MIN);
  assert.equal(eco.finishLevelHeart(s, false, T0 + 12 * MIN), false);
  assert.deepEqual([s.hearts.n, s.activeLevel], [4, null]);
  // Quit or restart.
  eco.startLevelHeart(s, 3, T0 + 13 * MIN);
  eco.abandonLevel(s);
  assert.deepEqual([s.hearts.n, s.activeLevel], [3, null]);
  assert.equal(eco.finishLevelHeart(s, true, T0 + 14 * MIN), false, 'an abandoned level refunds nothing');
  // A refund while regenerating keeps the running timer, as if the heart had never been spent.
  eco.startLevelHeart(s, 4, T0 + 15 * MIN);
  assert.equal(s.hearts.n, 2);
  eco.finishLevelHeart(s, true, T0 + 16 * MIN);
  assert.deepEqual([s.hearts.n, s.hearts.since], [3, T0 + 10 * MIN]);
  assert.deepEqual(eco.heartsNow(s, T0 + 30 * MIN), { n: 4, nextInMs: 20 * MIN });
  // A reload or a closed app mid-level: the save already has the heart spent and the level in progress.
  useStorage(memoryStorage());
  load();
  eco.startLevelHeart(s, 4, T0 + 31 * MIN);
  assert.equal(save(s), true);
  const r = load();
  assert.deepEqual([r.hearts.n, r.activeLevel], [3, { id: 4, at: T0 + 31 * MIN }]);
  assert.equal(eco.takeStaleActiveLevel(r), 4);
  assert.deepEqual([r.hearts.n, r.activeLevel, eco.takeStaleActiveLevel(r)], [3, null, null]);
  assert.equal(eco.finishLevelHeart(r, true, T0 + 32 * MIN), false, 'nothing to refund after the reload');
  // No heart: nothing is spent and no level starts, until one regenerates.
  const z = fresh();
  z.hearts = { n: 0, since: T0 };
  assert.equal(eco.startLevelHeart(z, 2, T0 + MIN), false);
  assert.deepEqual([z.hearts, z.activeLevel], [{ n: 0, since: T0 }, null]);
  assert.equal(eco.startLevelHeart(z, 2, T0 + 20 * MIN), true);
  assert.deepEqual([z.hearts.n, z.hearts.since, z.activeLevel.id], [0, T0 + 20 * MIN, 2]);
});

// ------------------------------------------------------------ Adventure rewards
test('grantLevelResult: replays pay coins 3 times a day (new stars still pay gems); the next day pays again', () => {
  const s = fresh();
  const l = levelById(2);
  const m = levelById(1);
  s.adventure.unlocked = 2;
  const [, , three] = l.thresholds;
  const pay = (lv) => Math.max(5, Math.round((lv.reward.coins * eco.REPLAY_SHARE) / 5) * 5);
  assert.equal(eco.grantLevelResult(s, m, passFor(m), T0).firstClear, true);
  const first = eco.grantLevelResult(s, l, passFor(l, 0), T0);
  assert.deepEqual([first.firstClear, first.replayCapped, first.replaysPaid, first.replayCap], [true, false, 0, eco.REPLAYS_PAID_PER_DAY]);
  assert.equal(eco.REPLAYS_PAID_PER_DAY, 3);
  const r1 = eco.grantLevelResult(s, m, passFor(m), T0 + MIN);
  assert.deepEqual([r1.coins, r1.replayCapped, r1.replaysPaid], [pay(m), false, 1]);
  for (let i = 2; i <= 3; i++) {
    const r = eco.grantLevelResult(s, l, passFor(l, 0), T0 + i * MIN);
    assert.deepEqual([r.coins, r.replayCapped, r.replaysPaid], [pay(l), false, i], 'replays of any level share the allowance');
  }
  const fail = eco.grantLevelResult(s, l, summary({ win: false }), T0 + 4 * MIN);
  assert.deepEqual([fail.coins, fail.replayCapped, fail.replaysPaid], [0, false, 3], 'a failed replay is not a paid replay');
  const coins = s.wallet.coins;
  const gems = s.wallet.gems;
  const capped = eco.grantLevelResult(s, l, passFor(l, three), T0 + 5 * MIN);
  assert.deepEqual([capped.coins, capped.replayCapped, capped.newStars, capped.gems], [0, true, 2, eco.STAR_GEMS[2] + eco.STAR_GEMS[3]]);
  assert.deepEqual([s.wallet.coins, s.wallet.gems, s.levels[2].stars], [coins, gems + capped.gems, 3]);
  assert.equal(eco.grantLevelResult(s, l, passFor(l, 0), day(1, 0) - MIN).replayCapped, true, 'still the same local day at 23:59');
  const next = eco.grantLevelResult(s, l, passFor(l, 0), day(1, 0) + MIN);
  assert.deepEqual([next.coins, next.replayCapped, next.replaysPaid], [pay(l), false, 1]);
  assert.equal(s.levels[2].plays, 7);
});

test('grantLevelResult / recordQuickRace: practice (the blind rival) and a level above the unlocked one grant nothing', () => {
  const s = fresh();
  const l1 = levelById(1);
  const before = JSON.stringify(s);
  const p = eco.grantLevelResult(s, l1, passFor(l1, 99999), T0, { practice: true });
  assert.deepEqual([p.passed, p.stars, p.newStars, p.coins, p.gems, p.booster, p.unlocked, p.firstClear, p.practice], [true, 3, 0, 0, 0, null, null, false, true]);
  const q = eco.recordQuickRace(s, summary({ fooled: 3, rivalStars: 0 }), { now: T0, daily: true, practice: true });
  assert.deepEqual(q, { coins: 0, capped: false, paidToday: 0, cap: eco.QUICK_PAID_PER_DAY, practice: true });
  // The save was reset while level 5 was being played: its result must not unlock levels 1-6.
  const five = levelById(5);
  const g = eco.grantLevelResult(s, five, passFor(five, 99999), T0);
  assert.deepEqual([g.passed, g.coins, g.gems, g.unlocked, g.ignored], [true, 0, 0, null, true]);
  assert.equal(JSON.stringify(s), before, 'nothing in the save changed');
  // An unlocked level is granted as usual.
  s.adventure.unlocked = 5;
  assert.equal(eco.grantLevelResult(s, five, passFor(five), T0).unlocked, 6);
});

test('bosses: the first clear pays a booster on top of the double reward; replays and other levels do not', () => {
  const s = fresh();
  const bosses = LEVELS.filter((l) => l.boss);
  assert.equal(new Set(bosses.slice(0, eco.BOOSTER_IDS.length).map(eco.bossBooster)).size, eco.BOOSTER_IDS.length, 'every booster in turn');
  for (const boss of bosses) {
    s.adventure.unlocked = boss.id;
    const id = eco.bossBooster(boss);
    const n = eco.boosterCount(s, id);
    const r = eco.grantLevelResult(s, boss, passFor(boss), T0);
    assert.deepEqual([r.firstClear, r.booster, eco.boosterCount(s, id)], [true, id, n + 1]);
    assert.equal(eco.grantLevelResult(s, boss, passFor(boss), T0).booster, null);
    assert.equal(eco.boosterCount(s, id), n + 1);
  }
  assert.equal(eco.bossBooster(levelById(9)), null);
  s.adventure.unlocked = 9;
  assert.equal(eco.grantLevelResult(s, levelById(9), passFor(levelById(9)), T0).booster, null);
});

test('currentLevel / adventureComplete: the title and map never point at a cleared level 60', () => {
  const s = fresh();
  assert.deepEqual([eco.currentLevel(s), eco.adventureComplete(s)], [1, false]);
  for (const l of LEVELS.slice(0, 5)) eco.grantLevelResult(s, l, passFor(l), T0);
  assert.deepEqual([s.adventure.unlocked, eco.currentLevel(s)], [6, 6]);
  for (const l of LEVELS.slice(0, 59)) s.levels[l.id] = { stars: 3, best: 1, plays: 1 };
  s.levels[7].stars = 2;
  s.adventure.unlocked = 60;
  assert.deepEqual([eco.currentLevel(s), eco.adventureComplete(s)], [60, false]);
  const last = levelById(60);
  const r = eco.grantLevelResult(s, last, passFor(last), T0);
  assert.deepEqual([r.passed, r.unlocked, s.adventure.unlocked], [true, null, 60]);
  assert.equal(eco.adventureComplete(s), true);
  assert.equal(eco.currentLevel(s), 7, 'all cleared: the first level still short of 3 stars');
  s.levels[7].stars = 3;
  assert.equal(eco.currentLevel(s), 60, 'one star on level 60');
  s.levels[60].stars = 3;
  assert.equal(eco.currentLevel(s), 60, 'everything perfect: the last level');
  // A save whose unlocked level is ahead of an uncleared one points at the gap.
  const odd = fresh();
  odd.adventure.unlocked = 6;
  for (const id of [1, 2, 4, 5]) odd.levels[id] = { stars: 1, best: 0, plays: 1 };
  assert.equal(eco.currentLevel(odd), 3);
});

// ------------------------------------------------------------ Daily Commission and Quick Race
test('Daily Commission: the ranked attempt is used up when it starts; quit, restart or reload leave a loss', () => {
  const d = todaysDaily('2026-10-05');
  const s = fresh();
  assert.equal(store.markDailyAttempt(s, d), true);
  const e = s.daily.results[d.key];
  assert.deepEqual([e.pending, e.win, e.stars, e.number, e.twist], [true, false, { player: 0, rival: 0 }, d.number, d.twist.id]);
  assert.deepEqual([s.daily.streak, s.daily.best, s.daily.lastKey], [1, 1, d.key]);
  // Quit, restart or reload before the end: every later attempt today is practice.
  useStorage(memoryStorage());
  load();
  save(s);
  const r = load();
  assert.equal(store.markDailyAttempt(r, d), false);
  assert.equal(r.daily.streak, 1, 'the day is counted once');
  assert.equal(recordMatch(r, summary(), { daily: { ...d, ranked: false }, now: T0 }).dailyInfo, null, 'a practice win records nothing');
  assert.deepEqual([r.daily.results[d.key].pending, r.daily.results[d.key].win], [true, false]);
  assert.ok(classic.load().daily.results[d.key], 'the classic game sees the attempt as used too');

  // The ranked attempt that finishes replaces its pending entry (the streak is not counted twice).
  const s2 = fresh();
  s2.daily = { lastKey: '2026-10-04', streak: 3, best: 3, results: {} };
  assert.equal(store.markDailyAttempt(s2, d), true);
  assert.equal(s2.daily.streak, 4);
  const rec = recordMatch(s2, summary({ rivalStars: 2 }), { daily: { ...d, ranked: true }, now: T0 });
  assert.deepEqual(rec.dailyInfo, { ranked: true, streak: 4 });
  const res = s2.daily.results[d.key];
  assert.deepEqual([res.win, res.stars, 'pending' in res], [true, { player: 3, rival: 2 }, false]);
  assert.equal(recordMatch(s2, summary({ win: false }), { daily: { ...d, ranked: true }, now: T0 }).dailyInfo, null, 'a final result is never replaced');
  assert.equal(s2.daily.results[d.key].win, true);
  assert.equal(store.markDailyAttempt(s2, todaysDaily('2026-10-06')), true, 'tomorrow is ranked again');
  assert.equal(s2.daily.streak, 5);
  // Callers that record a Daily without marking it first still count it once.
  const s3 = fresh();
  assert.equal(recordMatch(s3, summary(), { daily: d, now: T0 }).dailyInfo.streak, 1);
  assert.equal(store.markDailyAttempt(s3, d), false);
});

test('recordQuickRace: returns { coins, capped, paidToday, cap }; only the ranked Daily pays double', () => {
  const s = fresh();
  const W = eco.QUICK_WIN_COINS;
  const cap = eco.QUICK_PAID_PER_DAY;
  assert.deepEqual(eco.recordQuickRace(s, summary(), { now: T0, daily: { ranked: false } }), { coins: W, capped: false, paidToday: 1, cap });
  assert.deepEqual(eco.recordQuickRace(s, summary(), { now: T0, daily: { ranked: true } }), { coins: 2 * W, capped: false, paidToday: 2, cap });
  assert.deepEqual(eco.recordQuickRace(s, summary(), { now: T0, daily: true }), { coins: 2 * W, capped: false, paidToday: 3, cap });
  assert.deepEqual(eco.recordQuickRace(s, summary({ win: false }), { now: T0 }), { coins: 0, capped: false, paidToday: 3, cap });
  eco.recordQuickRace(s, summary(), { now: T0 });
  eco.recordQuickRace(s, summary(), { now: T0 });
  assert.deepEqual(eco.recordQuickRace(s, summary(), { now: T0 }), { coins: 0, capped: true, paidToday: cap, cap });
  assert.deepEqual(eco.recordQuickRace(s, summary({ win: false }), { now: T0 }), { coins: 0, capped: false, paidToday: cap, cap });
  assert.deepEqual(eco.recordQuickRace(s, summary(), { now: day(1) }), { coins: W, capped: false, paidToday: 1, cap });
});

// ------------------------------------------------------------ daily reward calendar
test('daily reward: the claimed day-7 tile shows the Festival skin it paid; the streak shown on the title', () => {
  const s = fresh();
  assert.equal(eco.dailyStreak(s, day(0)), 0);
  for (let d = 0; d < 6; d++) eco.claimDaily(s, day(d));
  assert.equal(eco.dailyStreak(s, day(5)), 6);
  assert.deepEqual([eco.dailyStatus(s, day(6)).day, eco.dailyStreak(s, day(6))], [7, 6]);
  assert.equal(eco.claimDaily(s, day(6)).skin, 'festival');
  let st = eco.dailyStatus(s, day(6, 22));
  const tile = st.rewards[6];
  assert.deepEqual([tile.status, tile.skin, tile.gems, st.streak], ['claimed', 'festival', undefined, 7]);
  assert.ok(tile.label.includes(SKIN_BY_ID.festival.name));
  // The skin marker survives a save round trip.
  assert.equal(eco.dailyStatus(migrate(JSON.parse(JSON.stringify(s))), day(6, 22)).rewards[6].skin, 'festival');
  // The next day a new run starts, and day 7 now offers the gems.
  st = eco.dailyStatus(s, day(7));
  assert.deepEqual([st.day, st.streak, st.rewards[6].gems, st.rewards[6].skin, st.rewards[6].status], [1, 0, 25, undefined, 'locked']);
  eco.claimDaily(s, day(7));
  eco.claimDaily(s, day(8));
  assert.equal(eco.dailyStreak(s, day(9)), 2);
  assert.equal(eco.dailyStreak(s, day(10)), 0, 'a missed day breaks the streak');
  // A day 7 paid in gems (skin already owned) shows the gems.
  for (let d = 10; d <= 16; d++) eco.claimDaily(s, day(d));
  st = eco.dailyStatus(s, day(16));
  assert.deepEqual([st.day, st.rewards[6].status, st.rewards[6].gems, st.rewards[6].skin], [7, 'claimed', 25, undefined]);
});

console.log(`\n${passed} tests passed`);
