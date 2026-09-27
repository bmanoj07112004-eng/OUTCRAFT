// Visual themes for the six Adventure worlds (pure data, no three.js). World i uses THEMES[i].
// Colours are CSS hex strings. `sea` is what surrounds the island: water, lava or a cloud sea.
// `ambient` names the floating particle effect: butterflies, dust, snow, embers, sparkles, clouds.
// `props` tells the island builder how to dress obstacles and decoration for the theme:
//   bush     -> the soft obstacle (bush, cactus, snowy shrub, charred stump, glow mushroom, cloud puff)
//   boulder  -> the hard obstacle (rock, sandstone, ice block, basalt, crystal spike, floating stone)
//   deco     -> small non-blocking decoration scattered on free tiles (flowers, shells, snow piles...)

export const THEMES = [
  {
    id: 'meadow',
    name: 'Meadow Isle',
    sky: { top: '#5fb8ff', bottom: '#dff3ff' },
    fog: { color: '#cdeaff', near: 45, far: 120 },
    sun: { color: '#fff1d0', intensity: 2.4, dir: [0.55, 1, 0.35] },
    hemi: { sky: '#ffffff', ground: '#6b8f58', intensity: 1.1 },
    sea: { kind: 'water', color: '#2f9fd8', deep: '#1c6aa8', foam: '#ffffff' },
    ground: { top: ['#8fd672', '#82cb64'], beach: '#f1d9a0', cliff: '#7a5a3c', cliffDark: '#5e4430' },
    props: { bush: '#4fa84a', boulder: '#9aa3b2', deco: 'flowers' },
    ambient: 'butterflies',
  },
  {
    id: 'dunes',
    name: 'Sunny Dunes',
    sky: { top: '#ffb35c', bottom: '#ffe9c2' },
    fog: { color: '#ffe0b0', near: 40, far: 110 },
    sun: { color: '#ffe2b0', intensity: 2.7, dir: [0.3, 1, 0.6] },
    hemi: { sky: '#fff3dc', ground: '#b98b4f', intensity: 1.0 },
    sea: { kind: 'water', color: '#29b6c9', deep: '#167f9a', foam: '#fffbe8' },
    ground: { top: ['#f0cf86', '#e8c274'], beach: '#fbe7b5', cliff: '#c98a4b', cliffDark: '#9c6333' },
    props: { bush: '#5f9e4a', boulder: '#d49a5f', deco: 'shells' },
    ambient: 'dust',
  },
  {
    id: 'frost',
    name: 'Frost Fjord',
    sky: { top: '#8fb8e8', bottom: '#eef6ff' },
    fog: { color: '#e6f0fb', near: 35, far: 100 },
    sun: { color: '#eaf4ff', intensity: 2.0, dir: [0.6, 0.9, 0.2] },
    hemi: { sky: '#f4f9ff', ground: '#7d93ad', intensity: 1.2 },
    sea: { kind: 'water', color: '#3f86b8', deep: '#244f7a', foam: '#e8f6ff' },
    ground: { top: ['#f4f8fc', '#e6eef7'], beach: '#cfdcea', cliff: '#7c8ea3', cliffDark: '#5a6b80' },
    props: { bush: '#3f7f63', boulder: '#bfe3f5', deco: 'snowpiles' },
    ambient: 'snow',
  },
  {
    id: 'ember',
    name: 'Ember Peak',
    sky: { top: '#3a1f33', bottom: '#b8543a' },
    fog: { color: '#7a3a2e', near: 30, far: 95 },
    sun: { color: '#ffb080', intensity: 1.9, dir: [0.4, 1, 0.5] },
    hemi: { sky: '#ffcaa0', ground: '#3a2020', intensity: 0.9 },
    sea: { kind: 'lava', color: '#ff5a1f', deep: '#b0200a', foam: '#ffd24a' },
    ground: { top: ['#5b4b49', '#524341'], beach: '#3b302f', cliff: '#2e2424', cliffDark: '#1d1616' },
    props: { bush: '#3a2a26', boulder: '#2b2b30', deco: 'vents' },
    ambient: 'embers',
  },
  {
    id: 'crystal',
    name: 'Crystal Caverns',
    sky: { top: '#1b1640', bottom: '#5a3f9e' },
    fog: { color: '#3b2f70', near: 30, far: 95 },
    sun: { color: '#cdb8ff', intensity: 1.6, dir: [0.2, 1, 0.4] },
    hemi: { sky: '#b9a8ff', ground: '#2a2250', intensity: 1.0 },
    sea: { kind: 'water', color: '#4b3bb8', deep: '#241a6b', foam: '#bff0ff' },
    ground: { top: ['#6f63a8', '#665a9e'], beach: '#8f86c4', cliff: '#3d3470', cliffDark: '#2a2352' },
    props: { bush: '#35d0c0', boulder: '#8a6bff', deco: 'glowshrooms' },
    ambient: 'sparkles',
  },
  {
    id: 'sky',
    name: 'Sky Gardens',
    sky: { top: '#6aa8ff', bottom: '#fff4f8' },
    fog: { color: '#f4f0ff', near: 40, far: 120 },
    sun: { color: '#fff8e8', intensity: 2.5, dir: [0.5, 1, 0.3] },
    hemi: { sky: '#ffffff', ground: '#b9a6d9', intensity: 1.2 },
    sea: { kind: 'clouds', color: '#ffffff', deep: '#dfe6ff', foam: '#ffffff' },
    ground: { top: ['#9ee3a0', '#8fd894'], beach: '#fff1c9', cliff: '#a38bc9', cliffDark: '#7d67a6' },
    props: { bush: '#ff9ec7', boulder: '#e8e2ff', deco: 'flowers' },
    ambient: 'clouds',
  },
];

export const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));
