import { BUILDER, GRID_CELL_METERS } from '../config/constants';
import type { Vec2 } from '../math/Vec2';
import type { PartDefinition } from '../vehicle/PartDefinition';
import { resolvePlacedPart } from '../vehicle/ProceduralPart';
import type { PlacedPartData, RocketDesign } from '../vehicle/RocketDesign';
import { snapOrigin } from './PlacementGrid';

/**
 * Builder grid math. Positions are in grid cells (fractional since Phase 7);
 * world space uses meters via GRID_CELL_METERS. All functions take explicit
 * RESOLVED dimensions so procedural and fixed parts share one code path.
 */

export interface CellPos {
  xCells: number;
  yCells: number;
}

/** The grid cell under a world-space point (floor — used for legacy lookups). */
export function worldToCell(world: Vec2): CellPos {
  return {
    xCells: Math.floor(world.x / GRID_CELL_METERS),
    yCells: Math.floor(world.y / GRID_CELL_METERS),
  };
}

/** World-space meters → fractional grid-cell coordinates. */
export function worldToGrid(world: Vec2): CellPos {
  return {
    xCells: world.x / GRID_CELL_METERS,
    yCells: world.y / GRID_CELL_METERS,
  };
}

/** Grid origin for a part so that its center sits nearest the pointer, snapped. */
export function freePlacementOrigin(
  widthCells: number,
  heightCells: number,
  pointerWorld: Vec2,
  snapStep: number,
): CellPos {
  const rawX = pointerWorld.x / GRID_CELL_METERS - widthCells / 2;
  const rawY = pointerWorld.y / GRID_CELL_METERS - heightCells / 2;
  return snapOrigin(rawX, rawY, snapStep);
}

export function inBounds(
  widthCells: number,
  heightCells: number,
  xCells: number,
  yCells: number,
): boolean {
  return (
    xCells >= BUILDER.minXCells &&
    xCells + widthCells <= BUILDER.maxXCells &&
    yCells >= BUILDER.minYCells &&
    yCells + heightCells <= BUILDER.maxYCells
  );
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

/** Would a part of the given size at (xCells, yCells) overlap any existing part? */
export function overlapsAnyPart(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  widthCells: number,
  heightCells: number,
  xCells: number,
  yCells: number,
  ignore?: PlacedPartData,
): boolean {
  for (const placed of design.parts) {
    if (placed === ignore) continue;
    const resolved = resolvePlacedPart(placed, catalog);
    if (!resolved) continue;
    if (
      rectsOverlap(
        xCells, yCells, widthCells, heightCells,
        placed.xCells, placed.yCells,
        resolved.props.widthCells, resolved.props.heightCells,
      )
    ) {
      return true;
    }
  }
  return false;
}