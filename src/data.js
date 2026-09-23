// Content tables for OUTCRAFT: resources, one-step components, the 12 craftable items, rivals and daily twists.

export const RES_IDS = ['wood', 'stone', 'ore', 'sand', 'fiber', 'crystal'];

export const RES = {
  wood: { name: 'Wood', color: '#9a6232', light: '#58b368', nodes: 3, respawn: 6.5 },
  stone: { name: 'Stone', color: '#9aa3b2', light: '#c9d0db', nodes: 2, respawn: 9 },
  ore: { name: 'Ore', color: '#6f5b53', light: '#ff8a3d', nodes: 2, respawn: 10.5 },
  sand: { name: 'Sand', color: '#e8c26a', light: '#fbe3a2', nodes: 2, respawn: 8 },
  fiber: { name: 'Fiber', color: '#78b04a', light: '#c7ec8b', nodes: 2, respawn: 7.5 },
  crystal: { name: 'Crystal', color: '#35b9e8', light: '#bff0ff', nodes: 2, respawn: 12 },
};

// Components are crafted automatically at the Workshop as soon as their materials are in stock.
export const COMPONENTS = {
  plank: { name: 'Plank', needs: ['wood'] },
  glass: { name: 'Glass', needs: ['sand', 'wood'] },
  iron: { name: 'Iron', needs: ['ore', 'wood'] },
  rope: { name: 'Rope', needs: ['fiber', 'fiber'] },
  lens: { name: 'Lens', needs: ['sand', 'crystal'] },
  block: { name: 'Block', needs: ['stone', 'stone'] },
  gem: { name: 'Cut Gem', needs: ['crystal', 'stone'] },
};

export const ITEMS = [
  { id: 'torch', name: 'Torch', tier: 1, parts: ['plank', 'rope'], flavor: 'Every island needs a light that argues with the dark.' },
  { id: 'shovel', name: 'Shovel', tier: 1, parts: ['iron', 'plank'], flavor: 'For digging holes, and occasionally treasure.' },
  { id: 'lantern', name: 'Lantern', tier: 2, parts: ['glass', 'iron'], flavor: 'A torch with manners.' },
  { id: 'anvil', name: 'Anvil', tier: 2, parts: ['iron', 'block'], flavor: 'Heavy enough to end any argument.' },
  { id: 'ring', name: 'Ring', tier: 2, parts: ['iron', 'gem'], flavor: 'The villager says it is for a friend.' },
  { id: 'rod', name: 'Fishing Rod', tier: 3, parts: ['plank', 'rope', 'iron'], flavor: 'The fish have been warned.' },
  { id: 'hourglass', name: 'Hourglass', tier: 3, parts: ['glass', 'glass', 'plank'], flavor: 'Measures exactly how late the rival is.' },
  { id: 'compass', name: 'Compass', tier: 3, parts: ['iron', 'lens', 'plank'], flavor: 'Points north. Your rival points at you.' },
  { id: 'telescope', name: 'Telescope', tier: 4, parts: ['lens', 'iron', 'glass'], flavor: 'See the rival coming from three tiles away.' },
  { id: 'bell', name: 'Bell', tier: 4, parts: ['iron', 'iron', 'rope'], flavor: 'Rings once for every order you win.' },
  { id: 'crown', name: 'Crown', tier: 4, parts: ['gem', 'gem', 'iron'], flavor: 'Heavy is the head. Heavier the crafting.' },
  { id: 'clock', name: 'Clock', tier: 5, parts: ['iron', 'glass', 'gem', 'plank'], flavor: 'The masterpiece. Only the best island makers finish one.' },
];

export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

// Flattened raw materials for an item, in "card order" (the order the order card lists them).
export function baseList(item) {
  const out = [];
  for (const p of item.parts) out.push(...COMPONENTS[p].needs);
  return out;
}

// Rivals, weakest to strongest. `experts` = which habit models the rival may use to predict you.
// `heading` = how strongly it reads the direction you are walking. `deny` = how much it values taking a
// resource away from you even if it does not need it. `think` = pause before each decision (seconds).
export const RIVALS = [
  {
    id: 'pip',
    look: 'sprout',
    quips: { snatch: ['Oh! Sorry!', 'I needed it too...'], beaten: ['Wow, fast!', 'Teach me that!'], winOrder: ['I did it?!', 'Yay!'], loseOrder: ['Aww.', 'Next one!'], fooled: ['Wait, where?'] },
    name: 'PIP',
    color: '#ffb547',
    speed: 3,
    experts: [],
    heading: 0,
    deny: 0,
    steal: 0,
    think: 0.55,
    tiers: [1, 1, 2, 2, 2],
    title: 'The Apprentice',
    blurb: 'Slow, polite, and only watching. For now.',
    intro: "Hi! I'm Pip. I'm just here to learn how you do it.",
    win: 'I watched everything you did. Everything.',
    lose: 'You won! I took notes though.',
  },
  {
    id: 'wren',
    look: 'beak',
    quips: { snatch: ['Early bird!', 'Too slow~', 'Mine!'], beaten: ['Hey!', 'That was mine!'], winOrder: ['Tweet tweet.', 'Easy.'], loseOrder: ['Hmph.', 'Lucky.'], fooled: ['Huh?!', 'Not fair!'] },
    name: 'WREN',
    color: '#ff6f9f',
    speed: 3.5,
    experts: ['beeline', 'turf'],
    heading: 0.5,
    deny: 0.8,
    steal: 2,
    think: 0.35,
    tiers: [1, 2, 2, 3, 3],
    title: 'The Early Bird',
    blurb: 'Knows you love short walks. Gets there first.',
    intro: 'Pip told me about you. You like the nearest thing, right?',
    win: 'You always take the closest one. Always.',
    lose: 'Fine. Next time I start where you start.',
  },
  {
    id: 'fox',
    look: 'ears',
    quips: { snatch: ['Called it.', 'Same route again?', 'Thanks!'], beaten: ['Clever...', 'Grr.'], winOrder: ['Too predictable.', 'Copied and pasted.'], loseOrder: ['Rude.', 'You changed!'], fooled: ['...Sneaky.', 'You tricked me!'] },
    name: 'FOX',
    color: '#ff7b2e',
    speed: 3.75,
    experts: ['beeline', 'turf', 'book', 'routine'],
    heading: 0.9,
    deny: 1.6,
    steal: 2.8,
    think: 0.25,
    tiers: [2, 2, 3, 3, 4],
    title: 'The Copycat',
    blurb: 'Learns your routines. Steals what you need, even when it does not.',
    intro: 'Same order every time? Cute. I brought a bag.',
    win: "You're a creature of habit. I'm a creature of your habits.",
    lose: 'You changed your routine. Rude.',
  },
  {
    id: 'raven',
    look: 'crest',
    quips: { snatch: ['Foreseen.', 'I was waiting.', 'Predictable.'], beaten: ['Interesting.', 'Noted.'], winOrder: ['As I wrote.', 'Inevitable.'], loseOrder: ['An anomaly.', 'Noted. Twice.'], fooled: ['Unexpected.', 'You learn.'] },
    name: 'RAVEN',
    color: '#9b7bff',
    speed: 3.9,
    experts: ['beeline', 'turf', 'book', 'routine', 'side'],
    heading: 1.3,
    deny: 2.1,
    steal: 3.3,
    think: 0.15,
    tiers: [2, 3, 3, 4, 4],
    title: 'The Watcher',
    blurb: 'Reads every habit and every step. Waits where you are going.',
    intro: 'I have watched every island you ever walked on.',
    win: 'Predictable. Pleasantly predictable.',
    lose: 'Unexpected. I will remember that too.',
  },
  {
    id: 'mimic',
    look: 'mirror',
    quips: { snatch: ['You were going to.', 'Mirror, mirror.', 'Your move. Mine now.'], beaten: ['...You changed.', 'Not like me.'], winOrder: ['I am you. Faster.', 'Reflected.'], loseOrder: ['Impossible.', 'Who are you?'], fooled: ['That is not you!', 'Error.'] },
    name: 'MIMIC',
    color: '#14b8a6',
    speed: 4.15,
    experts: ['beeline', 'turf', 'book', 'routine', 'side'],
    heading: 1.2,
    deny: 3.2,
    steal: 4.5,
    think: 0.05,
    tiers: [3, 3, 4, 4, 5],
    title: 'The Mirror',
    blurb: 'A step faster than you. Knows you better than you do.',
    intro: 'I am what you would be, if you were never surprised.',
    win: 'I only did what you were about to do.',
    lose: 'You out-crafted yourself. Remarkable.',
  },
];

export const PLAYER_SPEED = 3.8; // tiles per second
export const GATHER_TIME = 0.45;
export const DEPOSIT_TIME = 0.25;
export const BAG_SIZE = 3;
export const STARS_TO_WIN = 3;

// Daily Commission twists: the same island, orders and twist for every player on a given date.
// The Daily rival always starts with no memory of you, so everyone's result is comparable.
export const DAILY_TWISTS = [
  { id: 'rush', name: 'Rush Hour', desc: 'Everyone moves 15% faster.', speedMul: 1.15 },
  { id: 'drought', name: 'Slow Growth', desc: 'Resources take 40% longer to regrow.', respawnMul: 1.4 },
  { id: 'bigbag', name: 'Big Bags', desc: 'Bags hold 4 instead of 3.', bag: 4 },
  { id: 'masterwork', name: 'Masterwork', desc: 'Only tier 3+ orders today.', minTier: 3 },
  { id: 'nimble', name: 'Nimble Rival', desc: 'Your rival moves 10% faster today.', rivalSpeedMul: 1.1 },
];

export const REGION_NAMES = ['north-west', 'north', 'north-east', 'west', 'centre', 'east', 'south-west', 'south', 'south-east'];
