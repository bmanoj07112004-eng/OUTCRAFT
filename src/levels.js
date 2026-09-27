// Adventure mode (pure data + scoring, no DOM): 6 worlds x 10 levels on a Candy Crush style map.
//
// Each level fixes the island (seed), the rival, the orders, an optional twist and a goal. Difficulty
// climbs in a sawtooth: a couple of levels ramp up, a harder level (`hard`) spikes about every 4-5
// levels, then a breather (an easier rival or kinder orders) lets the player feel strong again.
// Every 10th level is a boss: the world's strongest rival with its toughest twist, for double reward.
//
// Levers, weakest to strongest: order tiers, twists (introduced one at a time, each with a one-line
// explanation), goal conditions (craft a named item, win flawless, beat the clock) and the rival
// ladder PIP -> WREN -> FOX -> RAVEN -> MIMIC. Star thresholds are calibrated with bot players
// (node tools/levels.mjs): a solid player gets 2 stars on about half its wins, 3 stars on one in five.

import { RIVALS, ITEMS, ITEM_BY_ID, DAILY_TWISTS, STARS_TO_WIN } from './data.js';
import { THEMES } from './3d/themes.js';
import { mulberry32 } from './rng.js';

// ------------------------------------------------------------ twists
// The five Daily Commission twists, plus one combination for the late worlds. Match reads the
// speedMul / respawnMul / bag / minTier / rivalSpeedMul fields; `desc` is the one-line explanation.
const DAILY = Object.fromEntries(DAILY_TWISTS.map((t) => [t.id, t]));

export const TWISTS = {
  bigbag: { ...DAILY.bigbag, desc: 'Bags hold 4 instead of 3, for you and your rival.' },
  rush: { ...DAILY.rush },
  drought: { ...DAILY.drought },
  nimble: { ...DAILY.nimble, desc: 'Your rival moves 10% faster.' },
  masterwork: { ...DAILY.masterwork, desc: 'Only tier 3 and higher orders: bigger recipes, longer races.' },
  storm: { id: 'storm', name: 'Storm Season', desc: 'Resources regrow 40% slower and your rival moves 10% faster.', respawnMul: 1.4, rivalSpeedMul: 1.1 },
};

// ------------------------------------------------------------ worlds
const WORLD_INFO = [
  { rivalIds: ['pip', 'wren'], blurb: 'Green hills, lazy bees, and a rival who is only taking notes. For now.' },
  { rivalIds: ['wren', 'fox'], blurb: 'Hot sand, quick feet. WREN already knows you like short walks.' },
  { rivalIds: ['fox', 'wren', 'raven'], blurb: 'The clock starts ticking, and FOX has learned your routines.' },
  { rivalIds: ['raven', 'fox'], blurb: 'Smoke, lava and RAVEN, who waits where you are going.' },
  { rivalIds: ['raven', 'fox', 'mimic'], blurb: 'Glittering tunnels. Something in the mirrors is copying you.' },
  { rivalIds: ['mimic', 'raven'], blurb: 'Islands in the clouds. MIMIC is you, one step faster.' },
];

export const LEVELS_PER_WORLD = 10;

// `theme` is the THEMES entry itself (engine.setTheme(world.theme)); `id` is the theme id.
export const WORLDS = THEMES.map((t, i) => ({
  id: t.id,
  index: i,
  number: i + 1,
  name: t.name,
  theme: t,
  rivalIds: WORLD_INFO[i].rivalIds,
  blurb: WORLD_INFO[i].blurb,
  first: i * LEVELS_PER_WORLD + 1,
  last: (i + 1) * LEVELS_PER_WORLD,
}));

// ------------------------------------------------------------ the 60 levels
// L(name, rival, orderTiers, extra). orderTiers: one digit per order, easiest first (only the first
// `stw` orders are guaranteed to be played). extra: seed (island), twist (TWISTS id), goal
// ('win' | 'win-time' | 'flawless'), craft (item id -> 'craft' goal, placed at order `stw`),
// time (seconds of race time), stw (orders needed to win), hard (a sawtooth spike).
const L = (name, rival, tiers, extra = {}) => ({ name, rival, tiers, ...extra });

const TABLE = [
  // World 1: Meadow Isle. PIP only watches; you learn to gather, carry and craft. WREN guards the gate.
  L('First Steps', 'pip', '112', { seed: 1101, stw: 2 }),
  L('Buttercup Bend', 'pip', '122', { seed: 1102, stw: 2 }),
  L('Clover Crossing', 'pip', '11222', { seed: 1103 }),
  L('Honeybee Hollow', 'pip', '11222', { seed: 1104, craft: 'lantern', hard: true }),
  L('Picnic Point', 'pip', '122', { seed: 1105, stw: 2 }),
  L('Daisy Chain', 'pip', '12222', { seed: 1106, twist: 'bigbag' }),
  L('Windmill Way', 'pip', '12223', { seed: 1107 }),
  L('Early Bird', 'wren', '11222', { seed: 1108, hard: true }),
  L('Lazy Brook', 'pip', '12223', { seed: 1109, twist: 'bigbag' }),
  L("Wren's Nest", 'wren', '12223', { seed: 1110 }),

  // World 2: Sunny Dunes. WREN beelines to what is closest to you; FOX arrives at the end.
  L('Sandy Toes', 'wren', '11222', { seed: 2101 }),
  L('Seashell Shore', 'wren', '12222', { seed: 2102, craft: 'anvil' }),
  L('Heatwave Hustle', 'wren', '12223', { seed: 2103, twist: 'rush' }),
  L('Mirage Market', 'wren', '122', { seed: 2104, stw: 2, goal: 'flawless', hard: true }),
  L('Oasis Rest', 'wren', '12222', { seed: 2105, twist: 'bigbag' }),
  L('Cactus Corner', 'wren', '12233', { seed: 2106, twist: 'rush' }),
  L('Dry Spell', 'wren', '12233', { seed: 2107, twist: 'drought' }),
  L('Fox Tracks', 'fox', '12222', { seed: 2108, hard: true }),
  L('Palm Shade', 'wren', '12223', { seed: 2109, twist: 'bigbag' }),
  L('Den of the Fox', 'fox', '12233', { seed: 2110, twist: 'drought' }),

  // World 3: Frost Fjord. Time limits arrive; FOX copies your routines; RAVEN watches from the ice.
  L('First Frost', 'fox', '12223', { seed: 3101, time: 100 }),
  L('Snowdrift Lane', 'fox', '22233', { seed: 3102 }),
  L('Icicle Inlet', 'fox', '22233', { seed: 3103, twist: 'rush', time: 90 }),
  L('Beat the Thaw', 'fox', '12223', { seed: 3104, goal: 'win-time', time: 75, hard: true }),
  L('Cocoa Cabin', 'wren', '12233', { seed: 3105, twist: 'bigbag' }),
  L('Frozen Falls', 'fox', '22333', { seed: 3106, craft: 'compass' }),
  L('Quick Paws', 'fox', '22333', { seed: 3107, twist: 'nimble' }),
  L("Raven's Watch", 'raven', '22233', { seed: 3108, hard: true }),
  L('Warm Hearth', 'fox', '12223', { seed: 3109, twist: 'bigbag' }),
  L('Northern Lights', 'raven', '22333', { seed: 3110, twist: 'nimble', time: 100 }),

  // World 4: Ember Peak. RAVEN reads every habit; the orders grow into masterworks.
  L('Ash Meadow', 'raven', '22233', { seed: 4101 }),
  L('Cinder Steps', 'raven', '22333', { seed: 4102, twist: 'drought' }),
  L('Masterwork Forge', 'raven', '33344', { seed: 4103, twist: 'masterwork' }),
  L('Magma Rush', 'raven', '22333', { seed: 4104, twist: 'rush', goal: 'win-time', time: 80, hard: true }),
  L('Obsidian Rest', 'fox', '22333', { seed: 4105, twist: 'bigbag' }),
  L('Smoke Signals', 'raven', '23334', { seed: 4106, craft: 'rod', time: 95 }),
  L('Storm Front', 'raven', '23334', { seed: 4107, twist: 'storm' }),
  L('Lava Lanes', 'raven', '23334', { seed: 4108, twist: 'nimble', goal: 'win-time', time: 85, hard: true }),
  L('Hot Springs', 'fox', '22333', { seed: 4109, twist: 'bigbag' }),
  L('Heart of the Volcano', 'raven', '23344', { seed: 4110, twist: 'storm', time: 100 }),

  // World 5: Crystal Caverns. RAVEN at its sharpest, until MIMIC steps out of the mirrors.
  L('Glimmer Gate', 'raven', '22333', { seed: 5101, twist: 'bigbag' }),
  L('Prism Path', 'raven', '23334', { seed: 5102, twist: 'rush', time: 90 }),
  L('Echo Chamber', 'raven', '33444', { seed: 5103, twist: 'drought', craft: 'bell' }),
  L('Geode Gauntlet', 'raven', '233', { seed: 5104, stw: 2, goal: 'flawless', hard: true }),
  L('Moonpool', 'fox', '23334', { seed: 5105, twist: 'bigbag' }),
  L('Shard Spiral', 'raven', '33344', { seed: 5106, twist: 'masterwork', time: 95 }),
  L('Crystal Rush', 'raven', '23344', { seed: 5107, twist: 'storm', goal: 'win-time', time: 90 }),
  L('Mirror Maze', 'mimic', '22333', { seed: 5108, hard: true }),
  L('Glow Grotto', 'raven', '23334', { seed: 5109, twist: 'bigbag' }),
  L('The Mirror Hall', 'mimic', '23344', { seed: 5110, twist: 'drought' }),

  // World 6: Sky Gardens. MIMIC knows you better than you do. Surprise it.
  L('Cloud Steps', 'mimic', '23334', { seed: 6101, twist: 'bigbag' }),
  L('Kite Hill', 'mimic', '23334', { seed: 6102, twist: 'rush' }),
  L('Rainbow Bridge', 'mimic', '33444', { seed: 6103, craft: 'crown', time: 100 }),
  L('Thunderhead', 'mimic', '33344', { seed: 6104, twist: 'storm', hard: true }),
  L('Petal Drift', 'raven', '23334', { seed: 6105, twist: 'bigbag' }),
  L('Sunbeam Spires', 'mimic', '33445', { seed: 6106, twist: 'masterwork', time: 95 }),
  L('Gale Garden', 'mimic', '33444', { seed: 6107, twist: 'nimble', goal: 'win-time', time: 95 }),
  L('Clockwork Sky', 'mimic', '34544', { seed: 6108, craft: 'clock', hard: true }),
  L('Sky Harbor', 'raven', '33444', { seed: 6109, twist: 'bigbag' }),
  L('Crown of the Clouds', 'mimic', '34445', { seed: 6110, twist: 'storm', time: 110 }),
];

// Score needed for 2 and 3 stars, per level (index = id - 1). Calibrated with tools/levels.mjs.
const THRESHOLDS = [
  [2400, 2800], [2400, 2800], [3700, 4200], [3700, 4200], [2400, 2800], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200],
  [3700, 4200], [3700, 4200], [3700, 4200], [2400, 2800], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200],
  [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200],
  [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200],
  [3700, 4200], [3700, 4200], [3700, 4200], [2400, 2800], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200],
  [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200], [3700, 4200],
];

// First-clear coins grow with the world; hard levels pay 1.5x, bosses 2x plus gems.
const BASE_COINS = [25, 35, 45, 55, 65, 75];
const BOSS_GEMS = 5;

const TIME_NOTE = 'New: a time limit. When the clock runs out, whoever has more orders wins (a tie goes to the rival).';

function round5(x) {
  return Math.round(x / 5) * 5;
}

// Deterministic orders from the tier plan: the craft goal item sits at the last guaranteed order,
// the other slots draw distinct items of their tier (nearest tier when a tier runs out).
function pickOrders(row, stw, seed, minTier) {
  const rng = mulberry32((seed ^ 0x2c1b3c6d) >>> 0);
  const tiers = [...row.tiers].map(Number);
  const out = new Array(tiers.length).fill(null);
  const used = new Set();
  if (row.craft) {
    out[stw - 1] = row.craft;
    used.add(row.craft);
  }
  tiers.forEach((t, i) => {
    if (out[i]) return;
    for (let d = 0; d < 5; d++) {
      const pool = ITEMS.filter((it) => (it.tier === t - d || it.tier === t + d) && it.tier >= minTier && !used.has(it.id));
      if (!pool.length) continue;
      const item = pool[Math.floor(rng() * pool.length)];
      out[i] = item.id;
      used.add(item.id);
      return;
    }
  });
  return out;
}

function goalFor(type, stw, time, item) {
  switch (type) {
    case 'win-time':
      return { type, text: `Win ${stw} orders before the ${time} s clock runs out.` };
    case 'flawless':
      return { type, text: `Win ${stw} orders without losing a single one.` };
    case 'craft':
      return { type, item, text: `Win the race and craft the ${ITEM_BY_ID[item].name} yourself.` };
    default:
      return { type: 'win', text: time ? `Lead when the ${time} s clock runs out, or win ${stw} orders first.` : `Win ${stw} orders before your rival does.` };
  }
}

function build() {
  const seen = { twists: new Set(), rivals: new Set(), goals: new Set(), time: false };
  return TABLE.map((row, i) => {
    const id = i + 1;
    const world = Math.floor(i / LEVELS_PER_WORLD);
    const index = i % LEVELS_PER_WORLD;
    const boss = index === LEVELS_PER_WORLD - 1;
    const stw = row.stw || STARS_TO_WIN;
    const twist = row.twist ? TWISTS[row.twist] : null;
    const orders = pickOrders(row, stw, row.seed, twist?.minTier || 0);
    const options = { orders, starsToWin: stw };
    if (row.time) options.timeLimit = row.time;
    const goalType = row.craft ? 'craft' : row.goal || 'win';
    const goal = goalFor(goalType, stw, row.time, row.craft);

    // One line about whatever this level introduces (at most one new thing per level by design).
    const rival = RIVALS.find((r) => r.id === row.rival);
    let note = null;
    if (!seen.rivals.has(rival.id) && id > 1) note = `New rival: ${rival.name}, ${rival.title}. ${rival.blurb}`;
    else if (twist && !seen.twists.has(twist.id)) note = `New twist: ${twist.name}. ${twist.desc}`;
    else if (row.time && !seen.time) note = TIME_NOTE;
    else if (goalType !== 'win' && !seen.goals.has(goalType)) note = `New goal: ${goal.text}`;
    seen.rivals.add(rival.id);
    if (twist) seen.twists.add(twist.id);
    if (row.time) seen.time = true;
    seen.goals.add(goalType);

    const hard = !!row.hard;
    const coins = round5(BASE_COINS[world] * (hard ? 1.5 : 1) * (boss ? 2 : 1));
    const [two, three] = THRESHOLDS[i];
    return {
      id,
      world,
      index,
      name: row.name,
      seed: row.seed,
      rival: rival.id,
      twist,
      options,
      goal,
      thresholds: [0, two, three],
      reward: { coins, gems: boss ? BOSS_GEMS : 0 },
      boss,
      hard,
      note,
    };
  });
}

export const LEVELS = build();
export const MAX_STARS = LEVELS.length * 3;

export function levelById(id) {
  return LEVELS[id - 1] || null;
}

export function worldOf(level) {
  return WORLDS[level.world];
}

// All levels require winning the match; the goal may add a condition.
export function levelPassed(level, summary) {
  if (!summary || summary.winner !== 'player') return false;
  const g = level.goal;
  if (g.type === 'win-time') return !summary.timeUp;
  if (g.type === 'flawless') return (summary.stars?.rival || 0) === 0;
  if (g.type === 'craft') return (summary.crafted || []).includes(g.item);
  return true;
}

export function starsFor(level, summary) {
  if (!levelPassed(level, summary)) return 0;
  const score = Number(summary.score) || 0;
  return 1 + (score >= level.thresholds[1] ? 1 : 0) + (score >= level.thresholds[2] ? 1 : 0);
}

// Everything main.js needs to start a level: new Match({ seed, rival, twist, options, model }).
// Booster options (economy.useBoosters) are merged on top by the caller.
export function matchConfig(level, rivals = RIVALS) {
  const rival = rivals.find((r) => r.id === level.rival) || RIVALS.find((r) => r.id === level.rival);
  return {
    seed: level.seed,
    rival,
    rivalIndex: RIVALS.findIndex((r) => r.id === level.rival),
    twist: level.twist ? { ...level.twist } : null,
    options: { ...level.options, orders: level.options.orders.slice() },
  };
}
