import { Graphics } from 'pixi.js';
import { BUILDER, GRID_CELL_METERS } from '../config/constants';

/**
 * The builder grid: cell lines, optional snap-step subdivisions, a highlighted
 * center column, and a ground band at y = 0.
 */
export function buildGridGraphic(snapStepCells = 1): Graphics {
  const step = snapStepCells;
  const cell = GRID_CELL_METERS;
  const g = new Graphics();
  const left = BUILDER.minXCells * cell;
  const right = BUILDER.maxXCells * cell;
  const bottom = BUILDER.minYCells * cell;
  const top = BUILDER.maxYCells * cell;

  g.rect(left - 4, bottom - 3, right - left + 8, 3).fill(0x18251a);

  // Finer lines at the active snap step (hidden when step = 1 cell).
  if (step < 1) {
    const minX = BUILDER.minXCells;
    const maxX = BUILDER.maxXCells;
    const minY = BUILDER.minYCells;
    const maxY = BUILDER.maxYCells;
    const xSteps = Math.round((maxX - minX) / step);
    const ySteps = Math.round((maxY - minY) / step);
    for (let i = 0; i <= xSteps; i++) {
      const x = (minX + i * step) * cell;
      g.moveTo(x, bottom).lineTo(x, top);
    }
    for (let i = 0; i <= ySteps; i++) {
      const y = (minY + i * step) * cell;
      g.moveTo(left, y).lineTo(right, y);
    }
    g.stroke({ width: 0.012, color: 0x1e2a42, alpha: 0.55 });
  }

  for (let x = BUILDER.minXCells; x <= BUILDER.maxXCells; x++) {
    g.moveTo(x * cell, bottom).lineTo(x * cell, top);
  }
  for (let y = BUILDER.minYCells; y <= BUILDER.maxYCells; y++) {
    g.moveTo(left, y * cell).lineTo(right, y * cell);
  }
  g.stroke({ width: 0.02, color: 0x27324d, alpha: 0.8 });

  g.moveTo(0, bottom).lineTo(0, top).stroke({ width: 0.04, color: 0x3d5a80, alpha: 0.9 });
  g.moveTo(left - 4, bottom).lineTo(right + 4, bottom)
    .stroke({ width: 0.08, color: 0x4a7c4e, alpha: 1 });

  return g;
}