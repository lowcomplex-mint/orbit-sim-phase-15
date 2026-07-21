/**
 * Attachment nodes are the only way parts connect. Two parts are attached
 * exactly when compatible nodes share the same integer grid vertex. There is
 * no proximity or overlap-based attachment.
 *
 * Kinds pair up: top <-> bottom (vertical stacking) and left <-> right
 * (radial attachment, Phase 4). Node coordinates may be fractional since
 * the VAB fractional grid (builder/PlacementGrid.ts); coincidence is
 * exact after snap quantization.
 */

export type NodeKind = 'top' | 'bottom' | 'left' | 'right';

/** Node position relative to the part's bottom-left cell, in grid-vertex units. */
export interface AttachmentNodeDef {
  xCells: number;
  yCells: number;
  kind: NodeKind;
}

/** A node resolved to absolute grid-vertex coordinates. */
export interface WorldNode {
  xCells: number;
  yCells: number;
  kind: NodeKind;
}

/** Comparison tolerance for fractional cell coordinates after snap quantization. */
export const GRID_EPSILON = 1e-6;

/** True when two cell coordinates coincide on the placement grid. */
export function cellsNear(a: number, b: number): boolean {
  return Math.abs(a - b) < GRID_EPSILON;
}

/** Rotate a local node offset around the part center, degrees CCW. */
export function rotateOffset(
  xCells: number,
  yCells: number,
  widthCells: number,
  heightCells: number,
  rotationDeg: number,
): { xCells: number; yCells: number } {
  if (rotationDeg === 0) return { xCells, yCells };
  const cx = widthCells / 2;
  const cy = heightCells / 2;
  const dx = xCells - cx;
  const dy = yCells - cy;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    xCells: cx + dx * cos - dy * sin,
    yCells: cy + dx * sin + dy * cos,
  };
}

/** top accepts bottom, left accepts right (and vice versa). */
export function nodesMatch(a: NodeKind, b: NodeKind): boolean {
  return (
    (a === 'top' && b === 'bottom') ||
    (a === 'bottom' && b === 'top') ||
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left')
  );
}
