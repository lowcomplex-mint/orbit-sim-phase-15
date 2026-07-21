import { GRID_CELL_METERS } from '../config/constants';
import type { Vec2 } from '../math/Vec2';
import type { PartDefinition } from '../vehicle/PartDefinition';
import { resolvePlacedPart } from '../vehicle/ProceduralPart';
import type { RocketDesign } from '../vehicle/RocketDesign';
import { rectsOverlap } from './GridSystem';

export interface GridSelectionBox {
  minXCells: number;
  minYCells: number;
  widthCells: number;
  heightCells: number;
}

/** Normalize a marquee dragged in any direction from world meters to cells. */
export function normalizeSelectionBox(start: Vec2, end: Vec2): GridSelectionBox {
  const minX = Math.min(start.x, end.x) / GRID_CELL_METERS;
  const maxX = Math.max(start.x, end.x) / GRID_CELL_METERS;
  const minY = Math.min(start.y, end.y) / GRID_CELL_METERS;
  const maxY = Math.max(start.y, end.y) / GRID_CELL_METERS;
  return {
    minXCells: minX,
    minYCells: minY,
    widthCells: maxX - minX,
    heightCells: maxY - minY,
  };
}

/** Stable ids whose resolved AABBs intersect the marquee. */
export function partsInSelectionBox(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  start: Vec2,
  end: Vec2,
): string[] {
  const box = normalizeSelectionBox(start, end);
  const ids: string[] = [];
  for (const part of design.parts) {
    if (!part.id) continue;
    const resolved = resolvePlacedPart(part, catalog);
    if (!resolved) continue;
    if (
      rectsOverlap(
        part.xCells,
        part.yCells,
        resolved.props.widthCells,
        resolved.props.heightCells,
        box.minXCells,
        box.minYCells,
        box.widthCells,
        box.heightCells,
      )
    ) {
      ids.push(part.id);
    }
  }
  return ids;
}
