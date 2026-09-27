// The island: a small seeded tile world with a Workshop, obstacles and resource nodes, plus BFS
// distance fields so agents can path by simply walking "downhill" toward any target.

import { mulberry32 } from './rng.js';
import { RES, RES_IDS } from './data.js';

export const W = 9;
export const H = 13;
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const idx = (x, y) => y * W + x;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

export function generateIsland(seed) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const w = tryGenerate((seed + attempt * 7919) >>> 0);
    if (w) return w;
  }
  throw new Error('island generation failed');
}

function tryGenerate(seed) {
  const rng = mulberry32(seed);
  const land = new Array(W * H).fill(false);
  const cx = 4;
  const cy = 6;
  const wobble = Array.from({ length: 8 }, () => rng() * 0.22 - 0.08);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - cx) / 3.85;
      const dy = (y - cy) / 5.9;
      const ang = Math.atan2(dy, dx);
      const k = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 8) % 8;
      land[idx(x, y)] = dx * dx + dy * dy < 1 + wobble[k];
    }
  }
  for (let x = 0; x < W; x++) {
    land[idx(x, 0)] = false;
    land[idx(x, H - 1)] = false;
  }
  for (let y = 0; y < H; y++) {
    land[idx(0, y)] = false;
    land[idx(W - 1, y)] = false;
  }

  // Workshop: 3 tiles wide near the south coast; spawns on either side of it.
  const hubY = 10;
  const workshop = [idx(3, hubY), idx(4, hubY), idx(5, hubY)];
  const spawn = { player: { x: 2, y: hubY }, rival: { x: 6, y: hubY } };
  for (const [x, y] of [
    [2, hubY], [3, hubY], [4, hubY], [5, hubY], [6, hubY],
    [3, hubY - 1], [4, hubY - 1], [5, hubY - 1], [2, hubY - 1], [6, hubY - 1],
    [3, hubY + 1], [4, hubY + 1], [5, hubY + 1],
  ]) land[idx(x, y)] = true;

  const blocked = new Array(W * H).fill(false);
  workshop.forEach((i) => (blocked[i] = true));

  const isFree = (x, y) => inBounds(x, y) && land[idx(x, y)] && !blocked[idx(x, y)];
  const nearHub = (x, y) => y >= hubY - 2 && x >= 1 && x <= 7;

  // Decorative obstacles make routes interesting.
  const obstacles = [];
  let guard = 0;
  while (obstacles.length < 5 && guard++ < 400) {
    const x = 1 + Math.floor(rng() * (W - 2));
    const y = 1 + Math.floor(rng() * (H - 4));
    if (!isFree(x, y) || nearHub(x, y)) continue;
    if (obstacles.some((o) => Math.abs(o.x - x) + Math.abs(o.y - y) < 3)) continue;
    blocked[idx(x, y)] = true;
    obstacles.push({ x, y, kind: rng() < 0.5 ? 'bush' : 'boulder' });
  }

  // Resource nodes: two of each type (three trees), one on each side of the island where possible.
  const nodes = [];
  const want = [];
  for (const r of RES_IDS) for (let k = 0; k < RES[r].nodes; k++) want.push({ type: r, side: k === 0 ? 'L' : k === 1 ? 'R' : 'C' });
  for (let i = want.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [want[i], want[j]] = [want[j], want[i]];
  }
  for (const w of want) {
    let placed = false;
    for (let tries = 0; tries < 300 && !placed; tries++) {
      let x;
      if (w.side === 'L') x = 1 + Math.floor(rng() * 3);
      else if (w.side === 'R') x = 5 + Math.floor(rng() * 3);
      else x = 3 + Math.floor(rng() * 3);
      const y = 1 + Math.floor(rng() * (hubY - 3));
      if (!isFree(x, y) || nearHub(x, y)) continue;
      if (nodes.some((n) => Math.abs(n.x - x) + Math.abs(n.y - y) < 2)) continue;
      blocked[idx(x, y)] = true;
      nodes.push({ id: nodes.length, type: w.type, x, y, respawn: RES[w.type].respawn, readyAt: 0, reserved: null });
      placed = true;
    }
    if (!placed) return null;
  }

  const walkable = land.map((l, i) => l && !blocked[i]);
  const world = { seed, land, blocked, walkable, nodes, obstacles, workshop, hubY, spawn };

  // Everything must be reachable from both spawns.
  const reach = bfs(world, [idx(spawn.player.x, spawn.player.y)]);
  if (reach[idx(spawn.rival.x, spawn.rival.y)] < 0) return null;
  world.nodeField = nodes.map((n) => bfs(world, adjacentWalkable(world, n.x, n.y)));
  for (const n of nodes) {
    const f = world.nodeField[n.id];
    if (f[idx(spawn.player.x, spawn.player.y)] < 0 || f[idx(spawn.rival.x, spawn.rival.y)] < 0) return null;
  }
  const hubAdj = [];
  workshop.forEach((i) => hubAdj.push(...adjacentWalkable(world, i % W, Math.floor(i / W))));
  world.hubField = bfs(world, [...new Set(hubAdj)]);
  world.tileFields = new Map();
  return world;
}

export function adjacentWalkable(world, x, y) {
  const out = [];
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (inBounds(nx, ny) && world.walkable[idx(nx, ny)]) out.push(idx(nx, ny));
  }
  return out;
}

// Multi-source BFS: distance (in steps) from every walkable tile to the nearest source tile; -1 = unreachable.
export function bfs(world, sources) {
  const dist = new Array(W * H).fill(-1);
  const q = [];
  for (const s of sources) {
    if (world.walkable[s] && dist[s] < 0) {
      dist[s] = 0;
      q.push(s);
    }
  }
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    const x = c % W;
    const y = Math.floor(c / W);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const n = idx(nx, ny);
      if (!world.walkable[n] || dist[n] >= 0) continue;
      dist[n] = dist[c] + 1;
      q.push(n);
    }
  }
  return dist;
}

export function tileField(world, x, y) {
  const k = idx(x, y);
  if (!world.tileFields.has(k)) world.tileFields.set(k, bfs(world, [k]));
  return world.tileFields.get(k);
}

// Next step downhill on a field, preferring to keep walking straight (looks natural, avoids zig-zags).
export function nextStep(world, field, x, y, prevDx = 0, prevDy = 0) {
  const here = field[idx(x, y)];
  if (here <= 0) return null;
  let best = null;
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(nx, ny)) continue;
    const d = field[idx(nx, ny)];
    if (d < 0 || d >= here) continue;
    const straight = dx === prevDx && dy === prevDy ? 1 : 0;
    if (!best || d < best.d || (d === best.d && straight > best.s)) best = { x: nx, y: ny, dx, dy, d, s: straight };
  }
  return best;
}

export function regionOf(x, y) {
  const col = x <= 3 ? 0 : x === 4 ? 1 : 2;
  const row = y <= 3 ? 0 : y <= 6 ? 1 : 2;
  return row * 3 + col;
}

export const sideOf = (x) => (x < 4 ? 0 : x > 4 ? 2 : 1); // 0 left, 1 centre, 2 right
