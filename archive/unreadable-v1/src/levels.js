// Content tables: the five Oracles of the gauntlet, the Mind Bar economy, and Daily Oracle modifiers.
// Every Oracle shares the same memory of the player; a level only decides which habit-experts may vote,
// how often the Oracle guesses wildly, how fast the beat is, and whether it can strike two lanes.

export const ORACLES = [
  {
    name: 'PUPIL',
    color: '#4fd8ff',
    experts: ['home', 'autopilot'],
    noise: 0.3,
    tempo: [1150, 960],
    double: null,
    intro: "I'm new at this. Show me how you move.",
    cracked: 'Fine. You win this one. The others were watching.',
  },
  {
    name: 'MIRROR',
    color: '#9d8cff',
    experts: ['home', 'autopilot', 'pendulum', 'magpie'],
    noise: 0.22,
    tempo: [1060, 870],
    double: null,
    intro: 'I copy you. Even the parts you never notice.',
    cracked: "You weren't where you were supposed to be.",
  },
  {
    name: 'HOUND',
    color: '#ffab40',
    experts: ['home', 'autopilot', 'pendulum', 'magpie', 'combo', 'flinch'],
    noise: 0.13,
    tempo: [980, 790],
    double: null,
    intro: 'I can smell panic. Especially right after I hit you.',
    cracked: 'You stopped flinching. How annoying.',
  },
  {
    name: 'SPHINX',
    color: '#ff5fb0',
    experts: ['home', 'autopilot', 'pendulum', 'magpie', 'combo', 'flinch', 'loop'],
    noise: 0.07,
    tempo: [900, 720],
    double: 0.78,
    intro: 'Riddle me this: where will you be? When I am sure, I strike twice.',
    cracked: 'No pattern... Impossible. Unless you are the pattern.',
  },
  {
    name: 'ORACLE',
    color: '#ff3d3d',
    experts: ['home', 'autopilot', 'pendulum', 'magpie', 'combo', 'flinch', 'loop'],
    noise: 0.03,
    tempo: [820, 640],
    double: 0.66,
    intro: 'I have seen every move you have ever made.',
    cracked: 'Unreadable. I will remember this too.',
  },
];

// After the fifth Oracle the gauntlet keeps going: ORACLE +1, +2 ... each a little faster.
export function oracleForLevel(level) {
  if (level < ORACLES.length) return { ...ORACLES[level], level, plus: 0 };
  const plus = level - ORACLES.length + 1;
  const base = ORACLES[ORACLES.length - 1];
  return {
    ...base,
    name: `ORACLE +${plus}`,
    level,
    plus,
    tempo: [Math.max(560, base.tempo[0] - 40 * plus), Math.max(500, base.tempo[1] - 30 * plus)],
    double: Math.max(0.6, base.double - 0.01 * plus),
    intro: plus === 1 ? 'Again. From the top. Faster.' : 'Faster.',
    cracked: 'Again?',
  };
}

// The Mind Bar is a tug of war: 50 at the start of each Oracle, 100 cracks it, 0 means you were solved.
export const ECON = {
  start: 50,
  dodge: 4,
  shard: 5, // on top of the dodge
  read: -7,
  streakAt: 5, // from the 5th dodge in a row, each dodge pushes +1 more
  streakBonus: 1,
  tempoRampBeats: 36, // beats to go from tempo[0] to tempo[1]
};

export const SCORE = { dodge: 10, shard: 25, crack: 300 };
export const multiplierFor = (streak) => 1 + Math.min(4, Math.floor(streak / 4));

// Daily Oracle: one modifier per date, the same for every player.
export const MODIFIERS = [
  { id: 'blitz', name: 'Blitz', desc: 'Every beat is 15% faster. Panic makes patterns.', tempoMul: 0.85 },
  { id: 'goldrush', name: 'Gold Rush', desc: 'Shards push twice as hard, and the Oracle knows you want them.', shardMul: 2, boost: { magpie: 2.5 } },
  { id: 'amnesia', name: 'Amnesia', desc: 'The Oracle wakes up with no memory of you. Fresh start.', fresh: true },
  { id: 'twin', name: 'Twin Strike', desc: 'From MIRROR on, every Oracle can strike two lanes when confident.', doubleFrom: 1, double: 0.72 },
  { id: 'glass', name: 'Glass Mind', desc: 'Reads cost less, dodges push less. A long, patient duel.', readMul: 0.7, dodgeMul: 0.8 },
];
