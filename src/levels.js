// Adventure mode (pure data + scoring, no DOM): 6 worlds x 10 levels on a Candy Crush style map.
//
// Each level fixes the island (seed), the rival, the orders, an optional twist and a goal. Difficulty
// climbs in a sawtooth: a couple of levels ramp up, a harder level (`hard`) spikes about every 4-5
// levels, then a breather (an easier rival or kinder orders) lets the player feel strong again.
// Every 10th level is a boss: the world's strongest rival with its toughest twist, for double reward.
//
// Levers, weakest to strongest: order tiers, twists (introduced one at a time, each with a one-line
// explanation), goal conditions (craft a named item, win flawless, beat the clock) and the rival
// ladder PIP -> WREN -> FOX -> RAVEN -> MIMIC. Difficulty and star thresholds are calibrated with bot
// players on the joystick (node tools/levels.mjs, casual / average / skilled stick bots plus tap bots):
// an average player gets 2 stars on about half its passes and 3 stars on about one in five, and the
// third star always sits well above the second and out of reach of an ordinary win (it takes beating
// par, outreads and fake-outs, or a flawless match).

import { RIVALS, ITEMS, ITEM_BY_ID, DAILY_TWISTS, STARS_TO_WIN } from './data.js';
import { THEMES } from './3d/themes.js';
import { mulberry32, hashString } from './rng.js';

export const LEVELS_PER_WORLD = 10;

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

// ------------------------------------------------------------ the 60 levels
// L(name, rival, orderTiers, extra). orderTiers: one digit per order, easiest first (only the first
// `stw` orders are sure to be played). extra: seed (island), twist (TWISTS id), goal ('win' |
// 'win-time' | 'flawless'), craft (item id -> 'craft' goal, placed at order `stw`), time (seconds of
// race time), stw (orders needed to win, default 3), hard (a sawtooth spike).
const L = (name, rival, tiers, extra = {}) => ({ name, rival, tiers, ...extra });

const TABLE = [
  // World 1: Meadow Isle. PIP only watches; you learn to gather, carry and craft. WREN guards the gate.
  L('First Steps', 'pip', '112', { seed: 1101, stw: 2 }),
  L('Buttercup Bend', 'pip', '122', { seed: 1132, stw: 2 }),
  L('Clover Crossing', 'pip', '12222', { seed: 1203 }),
  L('Honeybee Hollow', 'pip', '11222', { seed: 1184, craft: 'anvil', hard: true }),
  L('Picnic Point', 'pip', '11222', { seed: 1105 }),
  L('Daisy Chain', 'pip', '12222', { seed: 1116, twist: 'bigbag' }),
  L('Windmill Way', 'pip', '12223', { seed: 1157 }),
  L('Early Bird', 'wren', '11222', { seed: 1118, hard: true }),
  L('Lazy Brook', 'pip', '12223', { seed: 1119, twist: 'bigbag' }),
  L("Wren's Nest", 'wren', '12223', { seed: 1190 }),

  // World 2: Sunny Dunes. WREN beelines to what is closest to you; FOX arrives at the end.
  L('Sandy Toes', 'wren', '11222', { seed: 2231 }),
  L('Seashell Shore', 'wren', '12222', { seed: 2152, craft: 'anvil' }),
  L('Heatwave Hustle', 'wren', '12223', { seed: 2113, twist: 'rush' }),
  L('Mirage Market', 'wren', '122', { seed: 2134, stw: 2, goal: 'flawless', hard: true }),
  L('Oasis Rest', 'wren', '12222', { seed: 2265, twist: 'bigbag' }),
  L('Cactus Corner', 'wren', '12233', { seed: 2246, twist: 'rush' }),
  L('Dry Spell', 'wren', '12233', { seed: 2147, twist: 'drought' }),
  L('Fox Tracks', 'fox', '12222', { seed: 2158, hard: true }),
  L('Palm Shade', 'wren', '11222', { seed: 2129, twist: 'bigbag' }),
  L('Den of the Fox', 'fox', '12333', { seed: 2230, twist: 'drought' }),

  // World 3: Frost Fjord. Time limits arrive; FOX copies your routines; RAVEN watches from the ice.
  L('First Frost', 'fox', '12223', { seed: 3251, time: 70 }),
  L('Snowdrift Lane', 'fox', '22233', { seed: 3232 }),
  L('Icicle Inlet', 'fox', '22233', { seed: 3153, twist: 'rush', time: 60 }),
  L('Beat the Thaw', 'fox', '22233', { seed: 3174, goal: 'win-time', time: 45, hard: true }),
  L('Cocoa Cabin', 'wren', '12233', { seed: 3145, twist: 'bigbag' }),
  L('Frozen Falls', 'fox', '23334', { seed: 3126, craft: 'compass' }),
  L('Quick Paws', 'fox', '22233', { seed: 3167, twist: 'nimble' }),
  L("Raven's Watch", 'raven', '22233', { seed: 3218, hard: true }),
  L('Warm Hearth', 'fox', '12223', { seed: 3259, twist: 'bigbag' }),
  L('Northern Lights', 'raven', '23344', { seed: 3200, twist: 'nimble', time: 56 }),

  // World 4: Ember Peak. RAVEN reads every habit; the orders grow into masterworks.
  L('Ash Meadow', 'raven', '12233', { seed: 4251 }),
  L('Cinder Steps', 'raven', '23334', { seed: 4132, twist: 'drought' }),
  L('Masterwork Forge', 'raven', '34444', { seed: 4153, twist: 'masterwork' }),
  L('Magma Rush', 'raven', '22333', { seed: 4254, twist: 'rush', goal: 'win-time', time: 44, hard: true }),
  L('Obsidian Rest', 'fox', '22333', { seed: 4135, twist: 'bigbag' }),
  L('Smoke Signals', 'raven', '23334', { seed: 4136, craft: 'rod', time: 60 }),
  L('Storm Front', 'raven', '22334', { seed: 4227, twist: 'storm' }),
  L('Lava Lanes', 'raven', '23334', { seed: 4218, twist: 'nimble', goal: 'win-time', time: 58, hard: true }),
  L('Hot Springs', 'fox', '22233', { seed: 4229, twist: 'bigbag' }),
  L('Heart of the Volcano', 'raven', '33344', { seed: 4250, twist: 'storm', time: 90 }),

  // World 5: Crystal Caverns. RAVEN at its sharpest, until MIMIC steps out of the mirrors.
  L('Glimmer Gate', 'raven', '12233', { seed: 5161, twist: 'bigbag' }),
  L('Prism Path', 'raven', '23334', { seed: 5112, twist: 'rush', time: 48 }),
  L('Echo Chamber', 'raven', '22334', { seed: 5163, twist: 'drought', craft: 'rod' }),
  L('Geode Gauntlet', 'raven', '233', { seed: 5134, stw: 2, goal: 'flawless', hard: true }),
  L('Moonpool', 'fox', '23334', { seed: 5145, twist: 'bigbag' }),
  L('Shard Spiral', 'raven', '33344', { seed: 5256, twist: 'masterwork', time: 75 }),
  L('Crystal Rush', 'raven', '23344', { seed: 5197, twist: 'storm', goal: 'win-time', time: 80 }),
  L('Mirror Maze', 'mimic', '22333', { seed: 5188, hard: true }),
  L('Glow Grotto', 'raven', '23334', { seed: 5189, twist: 'bigbag' }),
  L('The Mirror Hall', 'mimic', '23344', { seed: 5220, twist: 'drought' }),

  // World 6: Sky Gardens. MIMIC knows you better than you do. Surprise it.
  L('Cloud Steps', 'mimic', '23334', { seed: 6251, twist: 'bigbag' }),
  L('Kite Hill', 'mimic', '33344', { seed: 6162, twist: 'drought' }),
  L('Rainbow Bridge', 'mimic', '22344', { seed: 6253, craft: 'hourglass' }),
  L('Thunderhead', 'mimic', '33344', { seed: 6164, twist: 'storm', hard: true }),
  L('Petal Drift', 'raven', '23334', { seed: 6195, twist: 'bigbag' }),
  L('Sunbeam Spires', 'mimic', '23344', { seed: 6136, twist: 'drought', time: 80 }),
  L('Gale Garden', 'mimic', '33344', { seed: 6127, twist: 'rush', goal: 'win-time', time: 70 }),
  L('Clockwork Sky', 'mimic', '54444', { seed: 6218, hard: true }),
  L('Sky Harbor', 'raven', '33444', { seed: 6169, twist: 'bigbag' }),
  L('Crown of the Clouds', 'mimic', '34444', { seed: 6140, twist: 'storm', time: 85 }),
];

// Score needed for 2 and 3 stars, per level (index = id - 1), from the average stick player's passes in
// `node tools/levels.mjs` runs (two mixed runs of 150 players and three average-only runs of 100, about
// 420 average players): 2 stars ~ its median passing score, 3 stars ~ its 80th percentile, always at
// least max(400, 10% of two) above two and above any ordinary win (no speed bonus, no outread or
// fake-out). Where scores bunch up (short races against PIP, the flawless goals of levels 14 and 44) two
// sits lower so the third star stays within reach of fast play.
const THRESHOLDS = [
  [4800, 5300], [5400, 5950], [5100, 5650], [4450, 6750], [4600, 5100], [4700, 6500], [4050, 4500], [4250, 5200], [4550, 5050], [4500, 5000],
  [4000, 4550], [4550, 5350], [4750, 5250], [5300, 5850], [3800, 4200], [4850, 5500], [4650, 5150], [3700, 4150], [4350, 4800], [4500, 5700],
  [4600, 5150], [4150, 4650], [4300, 4950], [4500, 4950], [4950, 5450], [4350, 4800], [4700, 5200], [4300, 4750], [5200, 5750], [4650, 5150],
  [4650, 5250], [4800, 5600], [4250, 4750], [4550, 5050], [4100, 4800], [4250, 4750], [3800, 4200], [4100, 4600], [5100, 5700], [3700, 4100],
  [5000, 5550], [4650, 5150], [4250, 4700], [5350, 5900], [4400, 4900], [4350, 4800], [4100, 4550], [5000, 5500], [5050, 5650], [4150, 4600],
  [5250, 5800], [4200, 4700], [3700, 4100], [4350, 4800], [4900, 5550], [4050, 4500], [4950, 5450], [4250, 4700], [4550, 5100], [4250, 4800],
];

// First-clear coins grow with the world; hard levels pay 1.5x, bosses 2x plus gems.
const BASE_COINS = [15, 25, 35, 45, 55, 65];
const BOSS_GEMS = 5;

// ------------------------------------------------------------ worlds
const BLURBS = [
  'Green hills, lazy bees, and a rival who is only taking notes. For now.',
  'Hot sand, quick feet. WREN already knows you like short walks.',
  'The clock starts ticking, and FOX has learned your routines.',
  'Smoke, lava and RAVEN, who waits where you are going.',
  'Glittering tunnels. Something in the mirrors is copying you.',
  'Islands in the clouds. MIMIC is you, one step faster.',
];

const rivalRank = (id) => RIVALS.findIndex((r) => r.id === id);

// `theme` is the THEMES entry itself (engine.setTheme(world.theme)); `id` is the theme id.
// rivalIds = the rivals met in the world, weakest first (the last one is the boss).
export const WORLDS = THEMES.map((t, i) => ({
  id: t.id,
  index: i,
  number: i + 1,
  name: t.name,
  theme: t,
  rivalIds: [...new Set(TABLE.slice(i * LEVELS_PER_WORLD, (i + 1) * LEVELS_PER_WORLD).map((row) => row.rival))].sort((a, b) => rivalRank(a) - rivalRank(b)),
  blurb: BLURBS[i],
  first: i * LEVELS_PER_WORLD + 1,
  last: (i + 1) * LEVELS_PER_WORLD,
}));

// ------------------------------------------------------------ building the catalogue
const WELCOME = 'Gather what the order needs, carry it to the Workshop, and finish the item before PIP does.';
const TIME_NOTE = 'New: a time limit. When the clock runs out, whoever has won more orders wins (a tie goes to the rival).';

function round5(x) {
  return Math.round(x / 5) * 5;
}

// Deterministic orders from the tier plan: the craft goal item sits at the last guaranteed order,
// the other slots draw distinct items of their tier (nearest tier when a tier runs out). Seeded by the
// level id, not the island seed, so re-rolling an island keeps the orders.
function pickOrders(row, stw, id, minTier) {
  const rng = mulberry32(hashString(`outcraft-level-${id}`));
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
  const clock = time ? ` The clock: ${time} s.` : '';
  switch (type) {
    case 'win-time':
      return { type, text: `Win ${stw} orders before the ${time} s clock runs out.` };
    case 'flawless':
      return { type, text: `Win ${stw} orders without losing a single one.${clock}` };
    case 'craft':
      return { type, item, text: `Win the race and craft the ${ITEM_BY_ID[item].name} yourself.${clock}` };
    default:
      return { type: 'win', text: time ? `Win ${stw} orders first, or be ahead when the ${time} s clock runs out.` : `Win ${stw} orders before your rival does.` };
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
    const orders = pickOrders(row, stw, id, twist?.minTier || 0);
    const options = { orders, starsToWin: stw };
    if (row.time) options.timeLimit = row.time;
    const goalType = row.craft ? 'craft' : row.goal || 'win';
    const goal = goalFor(goalType, stw, row.time, row.craft);

    // One line about whatever this level introduces (the table adds at most one new thing per level).
    const rival = RIVALS.find((r) => r.id === row.rival);
    let note = null;
    if (id === 1) note = WELCOME;
    else if (!seen.rivals.has(rival.id)) note = `New rival: ${rival.name}, ${rival.title}. ${rival.blurb}`;
    else if (twist && !seen.twists.has(twist.id)) note = `New twist: ${twist.name}. ${twist.desc}`;
    else if (row.time && !seen.time) note = TIME_NOTE;
    else if (goalType !== 'win' && !seen.goals.has(goalType)) note = `New goal: ${goal.text}`;
    else if (boss) note = `Boss level: ${rival.name} at full strength. Beat it for a double reward.`;
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
// Booster options (economy.useBoosters) are merged on top by the caller: { ...cfg.options, ...boosts }.
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
