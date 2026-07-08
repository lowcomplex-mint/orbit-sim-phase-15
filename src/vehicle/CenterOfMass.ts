import { GRID_CELL_METERS } from '../config/constants';
import type { PartInstance } from './PartInstance';

/**
 * Center-of-mass calculation for a part stack, using each part's geometric
 * center and current mass (dry + remaining fuel). Coordinates are absolute
 * grid-space meters (grid cell coordinates * GRID_CELL_METERS), the same
 * frame the builder draws in.
 *
 * TODO (torque): once radial attachment exists, thrust can act off the CoM
 * axis; then RocketPhysics should apply torque = r x F per engine and
 * integrate angular velocity with a moment of inertia derived from the same
 * part masses/positions used here. With today's center-column stacks every
 * engine thrusts exactly through the CoM, so torque would be identically
 * zero — which is why it is deferred, not hacked in.
 */

export interface CenterOfMass {
  /** Grid-space meters. */
  xM: number;
  yM: number;
  totalMassKg: number;
}

export function computeCenterOfMass(parts: PartInstance[]): CenterOfMass | null {
  if (parts.length === 0) return null;
  let mass = 0;
  let momentX = 0;
  let momentY = 0;
  for (const p of parts) {
    const m = p.mass;
    const cx = (p.xCells + p.widthCells / 2) * GRID_CELL_METERS;
    const cy = (p.yCells + p.heightCells / 2) * GRID_CELL_METERS;
    mass += m;
    momentX += m * cx;
    momentY += m * cy;
  }
  return { xM: momentX / mass, yM: momentY / mass, totalMassKg: mass };
}
