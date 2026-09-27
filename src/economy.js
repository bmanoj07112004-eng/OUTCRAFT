// Economy for the 3D edition (pure functions, no DOM): coins, gems and hearts, the shop and skins,
// boosters, Adventure level rewards, the 7-day daily reward and achievements.
//
// Every function takes the save state (src/storage.js) and changes it in place; `now` is a ms timestamp
// passed in so the tests can travel in time. No real money anywhere: everything is earned by playing.
// Rewards everywhere share one shape: { coins?, gems?, booster?, count?, skin?, altGems? }.

import { ITEMS } from './data.js';
import { LEVELS, levelPassed, starsFor } from './levels.js';
import { SKINS, SKIN_BY_ID } from './skins.js';
import { dateKey, daysBetween } from './rng.js';

const clock = (now) => (Number.isFinite(now) ? now : Date.now());
const round5 = (x) => Math.round(x / 5) * 5;

// ------------------------------------------------------------ hearts
export const HEARTS_MAX = 5;
export const HEART_REGEN_MS = 20 * 60 * 1000;
export const HEART_REFILL_GEMS = 12;

// Applies regeneration up to `now` (mutates state.hearts). nextInMs = time until the next heart, 0 when full.
export function heartsNow(state, now = Date.now()) {
  now = clock(now);
  const h = state.hearts;
  if (!Number.isFinite(h.n)) h.n = HEARTS_MAX;
  if (h.n < HEARTS_MAX) {
    // No timer yet, or the device clock moved backwards: (re)start the timer rather than pay out.
    if (!Number.isFinite(h.since) || h.since > now) h.since = now;
    const gained = Math.floor((now - h.since) / HEART_REGEN_MS);
    if (gained > 0) {
      h.n = Math.min(HEARTS_MAX, h.n + gained);
      h.since += gained * HEART_REGEN_MS;
    }
  }
  if (h.n >= HEARTS_MAX) {
    h.n = HEARTS_MAX;
    h.since = null;
    return { n: h.n, nextInMs: 0 };
  }
  return { n: h.n, nextInMs: HEART_REGEN_MS - (now - h.since) };
}

export function canStartLevel(state, now = Date.now()) {
  return heartsNow(state, now).n > 0;
}

// On a failed or abandoned Adventure level. grantLevelResult never takes hearts by itself.
export function loseHeart(state, now = Date.now()) {
  now = clock(now);
  const { n } = heartsNow(state, now);
  if (n > 0) {
    state.hearts.n = n - 1;
    if (state.hearts.since == null) state.hearts.since = now;
  }
  return heartsNow(state, now);
}

export function refillHearts(state, now = Date.now()) {
  if (heartsNow(state, now).n >= HEARTS_MAX) return { ok: false, reason: 'full' };
  if (state.wallet.gems < HEART_REFILL_GEMS) return { ok: false, reason: 'gems' };
  state.wallet.gems -= HEART_REFILL_GEMS;
  state.hearts.n = HEARTS_MAX;
  state.hearts.since = null;
  return { ok: true, reason: null };
}

// ------------------------------------------------------------ boosters
// `options` is merged into the Match options (see the contract in docs/3d-architecture.md).
export const BOOSTERS = {
  boots: { id: 'boots', name: 'Speed Boots', desc: 'You run 12% faster.', icon: '👟', price: { coins: 150 }, options: { playerSpeedMul: 1.12 } },
  backpack: { id: 'backpack', name: 'Big Backpack', desc: 'One extra bag slot, just for you.', icon: '🎒', price: { coins: 200 }, options: { playerBagBonus: 1 } },
  headstart: { id: 'headstart', name: 'Head Start', desc: 'Your rival waits 2.5 s at the start of every order.', icon: '⏱️', price: { coins: 250 }, options: { rivalDelay: 2.5 } },
  fog: { id: 'fog', name: 'Fog Cloak', desc: 'Your rival cannot read you during the first order.', icon: '🌫️', price: { coins: 300 }, options: { blindOrders: 1 } },
};
export const BOOSTER_IDS = Object.keys(BOOSTERS);

export function boosterCount(state, id) {
  return state.inventory.boosters[id] || 0;
}

// Consumes one of each selected (and owned) booster; returns the merged match options for them.
export function useBoosters(state, ids = []) {
  const options = {};
  for (const id of new Set(ids || [])) {
    if (!BOOSTERS[id] || boosterCount(state, id) <= 0) continue;
    state.inventory.boosters[id] -= 1;
    Object.assign(options, BOOSTERS[id].options);
  }
  return options;
}

// ------------------------------------------------------------ rewards
const COIN = '🪙';
const GEM = '💎';

// Short text and icon for any reward, for the result screen, daily calendar and achievements list.
export function rewardLabel(r) {
  const parts = [];
  if (r.skin) parts.push(`${SKIN_BY_ID[r.skin]?.name || r.skin} skin`);
  if (r.coins) parts.push(`${r.coins} coins`);
  if (r.gems) parts.push(`${r.gems} gems`);
  if (r.booster) parts.push(`${r.count || 1}x ${BOOSTERS[r.booster].name}`);
  return parts.join(' + ');
}

export function rewardIcon(r) {
  if (r.skin) return '👕';
  if (r.booster) return BOOSTERS[r.booster].icon;
  if (r.gems) return GEM;
  return COIN;
}

function addCoins(state, n) {
  state.wallet.coins += n;
  state.counters.coinsEarned += n;
}

// Pays a reward into the save; returns what was actually granted (a skin already owned turns into altGems).
function grant(state, r) {
  const got = {};
  if (r.skin) {
    if (!state.inventory.skins.includes(r.skin)) {
      state.inventory.skins.push(r.skin);
      got.skin = r.skin;
    } else if (r.altGems) got.gems = r.altGems;
  }
  if (r.coins) got.coins = r.coins;
  if (r.gems) got.gems = (got.gems || 0) + r.gems;
  if (r.booster) {
    got.booster = r.booster;
    got.count = r.count || 1;
    state.inventory.boosters[r.booster] = boosterCount(state, r.booster) + got.count;
  }
  if (got.coins) addCoins(state, got.coins);
  if (got.gems) state.wallet.gems += got.gems;
  got.label = rewardLabel(got);
  got.icon = rewardIcon(got);
  return got;
}

// ------------------------------------------------------------ shop
// Skins (every skin is listed so the locker can equip any owned one; unpriced skins show how to earn
// them), booster singles and 3-packs, a heart refill and two gems -> coins exchanges.
const PACK = 3;
const PACK_DISCOUNT = 2.5 / 3;

export const SHOP = [
  ...SKINS.map((s) => ({ id: s.id, kind: 'skin', skin: s.id, name: s.name, rarity: s.rarity, source: s.source, desc: s.desc, price: s.price && { ...s.price } })),
  ...BOOSTER_IDS.flatMap((id) => {
    const b = BOOSTERS[id];
    return [
      { id, kind: 'booster', booster: id, count: 1, name: b.name, desc: b.desc, icon: b.icon, price: { ...b.price } },
      { id: `${id}-pack`, kind: 'booster', booster: id, count: PACK, name: `${b.name} x${PACK}`, desc: b.desc, icon: b.icon, price: { coins: round5(b.price.coins * PACK * PACK_DISCOUNT) } },
    ];
  }),
  { id: 'hearts', kind: 'hearts', name: 'Full Hearts', desc: `Refill all ${HEARTS_MAX} hearts now.`, icon: '❤️', price: { gems: HEART_REFILL_GEMS } },
  { id: 'coins-250', kind: 'coins', coins: 250, name: 'Pouch of Coins', desc: 'Trade 10 gems for 250 coins.', icon: COIN, price: { gems: 10 } },
  { id: 'coins-1200', kind: 'coins', coins: 1200, name: 'Chest of Coins', desc: 'Trade 40 gems for 1200 coins.', icon: COIN, price: { gems: 40 } },
];
export const SHOP_BY_ID = Object.fromEntries(SHOP.map((e) => [e.id, e]));

export const REASONS = {
  unknown: 'That is not in the shop.',
  owned: 'You already own it.',
  'not-for-sale': 'This one cannot be bought. Earn it!',
  full: 'Your hearts are already full.',
  coins: 'Not enough coins.',
  gems: 'Not enough gems.',
};

// The currency a price is paid in, or null when the price is missing (not for sale).
function currency(price) {
  if (!price) return null;
  return price.gems ? 'gems' : 'coins';
}

export function canAfford(state, price) {
  const cur = currency(price);
  return !!cur && state.wallet[cur] >= price[cur];
}

export function ownsSkin(state, id) {
  return state.inventory.skins.includes(id);
}

// Shop card state for a skin: 'equipped' | 'owned' | 'buy' | 'locked' (not sold; earned elsewhere).
export function skinStatus(state, id) {
  if (state.inventory.equipped === id) return 'equipped';
  if (ownsSkin(state, id)) return 'owned';
  return SHOP_BY_ID[id]?.price ? 'buy' : 'locked';
}

export function buy(state, id, now = Date.now()) {
  const e = SHOP_BY_ID[id];
  if (!e) return { ok: false, reason: 'unknown' };
  if (e.kind === 'skin' && ownsSkin(state, id)) return { ok: false, reason: 'owned' };
  if (!e.price) return { ok: false, reason: 'not-for-sale' };
  if (e.kind === 'hearts' && heartsNow(state, now).n >= HEARTS_MAX) return { ok: false, reason: 'full' };
  const cur = currency(e.price);
  if (!canAfford(state, e.price)) return { ok: false, reason: cur };
  state.wallet[cur] -= e.price[cur];
  if (e.kind === 'skin') state.inventory.skins.push(e.skin);
  else if (e.kind === 'booster') state.inventory.boosters[e.booster] = boosterCount(state, e.booster) + e.count;
  else if (e.kind === 'hearts') {
    state.hearts.n = HEARTS_MAX;
    state.hearts.since = null;
  } else if (e.kind === 'coins') state.wallet.coins += e.coins;
  return { ok: true, reason: null, entry: e };
}

export function equipSkin(state, id) {
  if (!SKIN_BY_ID[id] || !ownsSkin(state, id)) return false;
  state.inventory.equipped = id;
  return true;
}

// ------------------------------------------------------------ Adventure results
// First clear pays level.reward; a passed replay pays REPLAY_SHARE of the coins. Every star earned for
// the first time on a level pays STAR_GEMS[star] gems (the first star is the clear itself).
export const REPLAY_SHARE = 0.2;
export const STAR_GEMS = [0, 0, 1, 1];

export function levelRecord(state, id) {
  return state.levels[id] || { stars: 0, best: 0, plays: 0 };
}

export function totalStars(state) {
  return LEVELS.reduce((s, l) => s + (state.levels[l.id]?.stars || 0), 0);
}

export function clearedCount(state) {
  return LEVELS.filter((l) => state.levels[l.id]?.stars > 0).length;
}

// Lifetime counters that every finished match feeds (Adventure, Quick Race and Daily Commission).
function countMatch(state, summary) {
  const c = state.counters;
  const st = summary.stats || {};
  c.fakeOuts += st.fooled || 0;
  c.outreads += st.outread || 0;
  if (summary.winner === 'player' && (summary.stars?.rival || 0) === 0) c.flawless += 1;
}

// Call once per finished Adventure level (not for quits). Does not take hearts: call loseHeart on a fail.
export function grantLevelResult(state, level, summary, now = Date.now()) {
  const passed = levelPassed(level, summary);
  const stars = starsFor(level, summary);
  const score = Math.max(0, Math.round(Number(summary.score) || 0));
  const rec = { ...levelRecord(state, level.id) };
  const prevStars = rec.stars;
  rec.plays += 1;
  rec.stars = Math.max(prevStars, stars);
  if (passed) rec.best = Math.max(rec.best, score);
  state.levels[level.id] = rec;

  const firstClear = passed && prevStars === 0;
  const newStars = Math.max(0, stars - prevStars);
  let coins = 0;
  let gems = 0;
  if (firstClear) {
    coins = level.reward.coins;
    gems = level.reward.gems || 0;
  } else if (passed) coins = Math.max(5, round5(level.reward.coins * REPLAY_SHARE));
  for (let s = prevStars + 1; s <= stars; s++) gems += STAR_GEMS[s];

  let unlocked = null;
  if (passed && level.id >= state.adventure.unlocked && level.id < LEVELS.length) {
    state.adventure.unlocked = level.id + 1;
    unlocked = level.id + 1;
  }

  addCoins(state, coins);
  state.wallet.gems += gems;
  const c = state.counters;
  if (passed) c.levelsWon += 1;
  c.starsEarned += newStars;
  countMatch(state, summary);
  state.lastPlayed = clock(now);
  return { passed, stars, newStars, firstClear, coins, gems, unlocked, best: rec.best, score, prevStars };
}

// ------------------------------------------------------------ Quick Race and Daily Commission
// A small coin reward per win, for at most QUICK_PAID_PER_DAY paid wins per local day (no farming).
// Call it once for every finished Quick Race or Daily Commission match, won or lost (it also feeds the
// fake-out / outread / flawless achievements).
export const QUICK_WIN_COINS = 10;
export const QUICK_PAID_PER_DAY = 5;

export function recordQuickRace(state, summary, { now = Date.now(), daily = false } = {}) {
  countMatch(state, summary);
  const q = state.quickRace;
  const key = dateKey(new Date(clock(now)));
  if (q.key !== key) {
    q.key = key;
    q.paid = 0;
  }
  if (summary.winner !== 'player') return { coins: 0, capped: false };
  if (q.paid >= QUICK_PAID_PER_DAY) return { coins: 0, capped: true };
  q.paid += 1;
  const coins = QUICK_WIN_COINS * (daily ? 2 : 1);
  addCoins(state, coins);
  return { coins, capped: false };
}

// ------------------------------------------------------------ daily reward
// Seven consecutive local days; missing a day starts again at day 1; after day 7 the cycle restarts.
export const DAILY_REWARDS = [
  { day: 1, booster: 'headstart', count: 1 },
  { day: 2, coins: 75 },
  { day: 3, gems: 3 },
  { day: 4, booster: 'fog', count: 1 },
  { day: 5, coins: 150 },
  { day: 6, gems: 5 },
  { day: 7, skin: 'festival', altGems: 25 },
];

// Day 7 pays the Festival skin, or 25 gems once it is owned.
function resolveDaily(state, r) {
  if (r.skin && ownsSkin(state, r.skin)) return { day: r.day, gems: r.altGems };
  return { ...r };
}

function msToMidnight(now) {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime() - now;
}

// day = the day that can be claimed now (canClaim) or the day already claimed today. Each entry of
// `rewards` carries label, icon and status 'claimed' | 'today' | 'locked' for the calendar.
export function dailyStatus(state, now = Date.now()) {
  now = clock(now);
  const d = state.dailyReward;
  const gap = d.lastKey ? daysBetween(d.lastKey, dateKey(new Date(now))) : null;
  let canClaim;
  let day;
  if (gap === 0 || (gap !== null && gap < 0)) {
    // Already claimed today (a negative gap = the clock or time zone moved back: wait for it to catch up).
    canClaim = false;
    day = Math.max(1, d.day);
  } else {
    canClaim = true;
    day = gap === 1 ? (d.day % 7) + 1 : 1;
  }
  const rewards = DAILY_REWARDS.map((r) => {
    const x = resolveDaily(state, r);
    const status = r.day < day || (r.day === day && !canClaim) ? 'claimed' : r.day === day ? 'today' : 'locked';
    return { ...x, label: rewardLabel(x), icon: rewardIcon(x), status };
  });
  return { canClaim, day, rewards, nextInMs: canClaim ? 0 : msToMidnight(now) };
}

// Returns the granted reward ({ day, label, icon, coins?, gems?, booster?, count?, skin? }) or null.
export function claimDaily(state, now = Date.now()) {
  now = clock(now);
  const st = dailyStatus(state, now);
  if (!st.canClaim) return null;
  const d = state.dailyReward;
  d.lastKey = dateKey(new Date(now));
  d.day = st.day;
  d.best = Math.max(d.best || 0, st.day);
  return { day: st.day, ...grant(state, DAILY_REWARDS[st.day - 1]) };
}

// ------------------------------------------------------------ achievements
const clearedWith = (state, rival) => LEVELS.some((l) => l.rival === rival && state.levels[l.id]?.stars > 0);
const codexDone = (state) => ITEMS.filter((i) => state.codex[i.id]?.count).length;

const A = (id, name, desc, icon, target, value, reward) => ({ id, name, desc, icon, target, reward, progress: (s) => [Math.min(target, value(s)), target] });

export const ACHIEVEMENTS = [
  A('first-win', 'First Victory', 'Clear your first Adventure level.', '🏁', 1, clearedCount, { booster: 'boots', count: 1 }),
  A('levels-10', 'Island Hopper', 'Clear 10 Adventure levels.', '🏝️', 10, clearedCount, { gems: 10 }),
  A('levels-30', 'Halfway Hero', 'Clear 30 Adventure levels.', '🗺️', 30, clearedCount, { gems: 20 }),
  A('stars-50', 'Star Collector', 'Earn 50 stars on the level map.', '⭐', 50, totalStars, { coins: 400 }),
  A('stars-100', 'Star Hoarder', 'Earn 100 stars on the level map.', '🌟', 100, totalStars, { gems: 25 }),
  A('stars-150', 'Constellation', 'Earn 150 stars on the level map.', '✨', 150, totalStars, { gems: 50 }),
  A('fakeouts-10', 'Master of Disguise', 'Fake out your rival 10 times.', '🎭', 10, (s) => s.counters.fakeOuts, { booster: 'fog', count: 2 }),
  A('outreads-25', 'One Step Ahead', 'Beat your rival to a resource it wanted 25 times.', '👣', 25, (s) => s.counters.outreads, { booster: 'boots', count: 2 }),
  A('flawless', 'Flawless', 'Win a match without losing a single order.', '💯', 1, (s) => s.counters.flawless, { booster: 'backpack', count: 1 }),
  A('codex', 'Master Crafter', `Craft all ${ITEMS.length} items at least once.`, '🔨', ITEMS.length, codexDone, { gems: 30 }),
  A('mimic', 'Mirror Breaker', 'Beat MIMIC in the Adventure.', '🪞', 1, (s) => (clearedWith(s, 'mimic') ? 1 : 0), { skin: 'royal', altGems: 50 }),
  A('daily-7', 'Seven Days Strong', 'Claim the daily reward 7 days in a row.', '📅', 7, (s) => s.dailyReward.best || 0, { gems: 15 }),
  A('skins-5', 'Fashionista', 'Own 5 skins.', '👗', 5, (s) => s.inventory.skins.length, { coins: 500 }),
];
export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

export function achievementStatus(state) {
  return ACHIEVEMENTS.map((a) => {
    const [cur, target] = a.progress(state);
    const claimed = !!state.achievements.claimed[a.id];
    const done = cur >= target;
    return { id: a.id, name: a.name, desc: a.desc, icon: a.icon, reward: a.reward, label: rewardLabel(a.reward), cur, target, done, claimed, canClaim: done && !claimed };
  });
}

export function claimableAchievements(state) {
  return achievementStatus(state).filter((a) => a.canClaim).length;
}

// Returns the granted reward, or null when the goal is not reached yet or was already claimed.
export function claimAchievement(state, id) {
  const a = ACHIEVEMENT_BY_ID[id];
  if (!a || state.achievements.claimed[id]) return null;
  const [cur, target] = a.progress(state);
  if (cur < target) return null;
  state.achievements.claimed[id] = true;
  return grant(state, a.reward);
}
