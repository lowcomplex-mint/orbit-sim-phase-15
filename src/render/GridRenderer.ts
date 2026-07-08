import { Graphics } from 'pixi.js';
import { BUILDER, GRID_CELL_METERS } from '../config/constants';

/**
 * The builder grid: cell lines, a highlighted center column, and a ground
 * band at y = 0. Drawn once; the builder camera scales it.
 */
export function buildGridGraphic(): Graphics {
  const cell = GRID_CELL_METERS;
  const g = new Graphics();
  const left = BUILDER.minXCells * cell;
  const right = BUILDER.maxXCells * cell;
  const bottom = BUILDER.minYCells * cell;
  const top = BUILDER.maxYCells * cell;

  // Ground band below the grid.
  g.rect(left - 4, bottom - 3, right - left + 8, 3).fill(0x18251a);

  for (let x = BUILDER.minXCells; x <= BUILDER.maxXCells; x++) {
    g.moveTo(x * cell, bottom).lineTo(x * cell, top);
  }
  for (let y = BUILDER.minYCells; y <= BUILDER.maxYCells; y++) {
    g.moveTo(left, y * cell).lineTo(right, y * cell);
  }
  g.stroke({ width: 0.02, color: 0x27324d, alpha: 0.8 });

  // Center column guide (where rockets are usually built).
  g.moveTo(0, bottom).lineTo(0, top).stroke({ width: 0.04, color: 0x3d5a80, alpha: 0.9 });
  // Ground line.
  g.moveTo(left - 4, bottom).lineTo(right + 4, bottom)
    .stroke({ width: 0.08, color: 0x4a7c4e, alpha: 1 });

  return g;
}
