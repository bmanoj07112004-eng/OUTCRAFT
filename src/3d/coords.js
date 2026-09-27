// Sim <-> 3D coordinate mapping shared by every 3D module.
//
// The simulation works in tile units on a 9x13 grid: x grows east, y grows south, and tile (x, y) has
// its centre at (x, y). The 3D world uses metres with Y up. Tile (x, y) centre = (X, 0, Z) where
// X = (x - CX) * TILE and Z = (y - CY) * TILE, so north (small y) is -Z and east is +X.
//
// Characters are modelled facing +Z; a character moving along world direction (dx, dz) uses
// rotation.y = Math.atan2(dx, dz). The ground (top of land tiles) is at Y = GROUND_Y.

import { W, H } from '../world.js';

export const TILE = 2;
export const CX = (W - 1) / 2;
export const CY = (H - 1) / 2;
export const GROUND_Y = 0;
export const WATER_Y = -0.55;

export function tileToWorld(x, y) {
  return { x: (x - CX) * TILE, z: (y - CY) * TILE };
}

export function worldToTile(X, Z) {
  return { x: X / TILE + CX, y: Z / TILE + CY };
}

// Heading angle (for rotation.y) of a movement in tile units.
export function headingOf(dx, dy) {
  return Math.atan2(dx, dy);
}
