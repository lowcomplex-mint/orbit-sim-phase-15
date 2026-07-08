/**
 * Attachment nodes are the only way parts connect. Two parts are attached
 * exactly when compatible nodes share the same integer grid vertex. There is
 * no proximity or overlap-based attachment.
 *
 * Kinds pair up: top <-> bottom (vertical stacking) and left <-> right
 * (radial attachment, Phase 4). Side nodes are parity-free: x = 0 and
 * x = width are always integer vertices, so any integer height works.
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

/** top accepts bottom, left accepts right (and vice versa). */
export function nodesMatch(a: NodeKind, b: NodeKind): boolean {
  return (
    (a === 'top' && b === 'bottom') ||
    (a === 'bottom' && b === 'top') ||
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left')
  );
}
