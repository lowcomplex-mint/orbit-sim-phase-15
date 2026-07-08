import { BUILDER, GRID_CELL_METERS } from '../config/constants';
import type { Vec2 } from '../math/Vec2';
import { nodesMatch } from '../vehicle/AttachmentNode';
import type { PartDefinition } from '../vehicle/PartDefinition';
import { resolvePlacedPart, type ResolvedPartProps } from '../vehicle/ProceduralPart';
import type { RocketDesign } from '../vehicle/RocketDesign';
import { freePlacementOrigin, inBounds, overlapsAnyPart } from './GridSystem';

/**
 * Snapping is attachment-driven: a dragged part may only land where one of
 * its nodes EXACTLY coincides with a compatible node of a placed part (both
 * are integer grid vertices, so alignment is exact by construction — there
 * is no floating-point "close enough" placement).
 *
 * The only exception: the first part of an empty design may be placed
 * anywhere in bounds.
 *
 * Procedural parts pass through unchanged: the caller resolves dimensions
 * and nodes once (DraggedPart.props) and placed parts are resolved here.
 */

/** What the builder is currently dragging: definition + resolved geometry. */
export interface DraggedPart {
  def: PartDefinition;
  props: ResolvedPartProps;
}

export interface SnapResult {
  xCells: number;
  yCells: number;
  valid: boolean;
  /** True when the position comes from an attachment node (not free placement). */
  attached: boolean;
}

export function findSnap(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  dragged: DraggedPart,
  pointerWorld: Vec2,
): SnapResult {
  const { widthCells, heightCells, attachmentNodes } = dragged.props;
  const free = freePlacementOrigin(widthCells, heightCells, pointerWorld);

  if (design.isEmpty) {
    return {
      ...free,
      valid: inBounds(widthCells, heightCells, free.xCells, free.yCells),
      attached: false,
    };
  }

  const cell = GRID_CELL_METERS;
  const snapRadiusSq = (BUILDER.snapRadiusCells * cell) ** 2;
  let best: { xCells: number; yCells: number; distSq: number } | null = null;

  for (const placed of design.parts) {
    const resolved = resolvePlacedPart(placed, catalog);
    if (!resolved) continue;
    for (const placedNode of resolved.props.attachmentNodes) {
      const nodeX = placed.xCells + placedNode.xCells;
      const nodeY = placed.yCells + placedNode.yCells;
      for (const dragNode of attachmentNodes) {
        if (!nodesMatch(placedNode.kind, dragNode.kind)) continue;

        // Candidate origin that makes the two nodes coincide exactly.
        const xCells = nodeX - dragNode.xCells;
        const yCells = nodeY - dragNode.yCells;

        // Rank candidates by how close the part's center would be to the pointer.
        const centerX = (xCells + widthCells / 2) * cell;
        const centerY = (yCells + heightCells / 2) * cell;
        const distSq =
          (centerX - pointerWorld.x) ** 2 + (centerY - pointerWorld.y) ** 2;
        if (distSq > snapRadiusSq) continue;
        if (!inBounds(widthCells, heightCells, xCells, yCells)) continue;
        if (overlapsAnyPart(design, catalog, widthCells, heightCells, xCells, yCells)) {
          continue;
        }

        if (!best || distSq < best.distSq) best = { xCells, yCells, distSq };
      }
    }
  }

  if (best) {
    return { xCells: best.xCells, yCells: best.yCells, valid: true, attached: true };
  }
  return { ...free, valid: false, attached: false };
}
