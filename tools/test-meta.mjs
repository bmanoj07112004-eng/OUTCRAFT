// Tests for the meta game: Adventure levels, economy and the save file.   node tools/test-meta.mjs
import assert from 'node:assert/strict';
import { LEVELS, WORLDS, TWISTS, LEVELS_PER_WORLD, MAX_STARS, levelById, worldOf, levelPassed, starsFor, matchConfig } from '../src/levels.js';
import * as eco from '../src/economy.js';
import { fresh, load, save, migrate, recordMatch, codexCount } from '../src/storage.js';
import { Match } from '../src/match.js';
import { PlayerModel, HABIT_IDS } from '../src/model.js';
import { RIVALS, ITEMS, ITEM_BY_ID, STARS_TO_WIN } from '../src/data.js';
import { THEMES } from '../src/3d/themes.js';
import { SKINS, SKIN_BY_ID } from '../src/skins.js';
import { idx } from '../src/world.js';

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
    assert.ok(b.price.coins >= 150 && b.price.coins <= 300 && b.icon && b.name && b.desc && Object.keys(b.options).length);
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
  assert.deepEqual(eco.recordQuickRace(s, summary({ win: false, fooled: 2, outread: 3 }), { now: T0 }), { coins: 0, capped: false });
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

// A save written by the 2D prototype (shape of fresh() in the v1 storage.js) after some play.
const V1_SAVE = {
  model: { v: 1, choices: 42, experts: { beeline: { hits: 10, n: 20 } } },
  ladder: { unlocked: 2, beaten: { pip: true, wren: true } },
  codex: { torch: { count: 3, first: '2026-09-21' }, lantern: { count: 1, first: '2026-09-22' } },
  dex: { beeline: { status: 'detected', acc: 0.6, chance: 0.3, date: '2026-09-22' } },
  stats: { matches: 12, wins: 7, snatched: 20, outread: 9, history: [{ t: 1, win: true, rival: 'pip', snatched: 1, outread: 2, gathers: 9 }] },
  daily: { lastKey: '2026-09-24', streak: 3, best: 4, results: { '2026-09-24': { win: true } } },
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

console.log(`\n${passed} tests passed`);
