import { BUILDER, GRID_CELL_METERS } from '../config/constants';
import type { Vec2 } from '../math/Vec2';
import { nodesMatch } from '../vehicle/AttachmentNode';
import { mountKindForNodes } from '../vehicle/PartGraph';
import type { MountKind } from '../vehicle/PartGraph';
import type { PartDefinition } from '../vehicle/PartDefinition';
import { resolvePlacedPart, type ResolvedPartProps } from '../vehicle/ProceduralPart';
import type { RocketDesign } from '../vehicle/RocketDesign';
import { worldAttachmentNodes } from '../vehicle/PartTree';
import { freePlacementOrigin, inBounds, overlapsAnyPart } from './GridSystem';

/** What the builder is currently dragging: definition + resolved geometry. */
export interface DraggedPart {
  def: PartDefinition;
  props: ResolvedPartProps;
}

export interface SnapResult {
  xCells: number;
  yCells: number;
  valid: boolean;
  attached: boolean;
  /** Placed part id when snapping to an attachment (Phase 9 tree). */
  parentId?: string | null;
  /** Node indices for edge creation (Phase 11). */
  parentNodeIndex?: number;
  childNodeIndex?: number;
  mountKind?: MountKind;
}

export function findSnap(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  dragged: DraggedPart,
  pointerWorld: Vec2,
  snapStep: number,
): SnapResult {
  const { widthCells, heightCells, attachmentNodes } = dragged.props;
  const free = freePlacementOrigin(widthCells, heightCells, pointerWorld, snapStep);

  if (design.isEmpty) {
    return {
      ...free,
      valid: inBounds(widthCells, heightCells, free.xCells, free.yCells),
      attached: false,
      parentId: null,
    };
  }

  const cell = GRID_CELL_METERS;
  const snapRadiusSq = (BUILDER.snapRadiusCells * cell) ** 2;
  let best: {
    xCells: number;
    yCells: number;
    distSq: number;
    parentId: string | null;
    parentNodeIndex: number;
    childNodeIndex: number;
    mountKind: MountKind;
  } | null = null;

  for (const placed of design.parts) {
    const resolved = resolvePlacedPart(placed, catalog);
    if (!resolved) continue;
    const placedWorld = worldAttachmentNodes(
      placed.xCells,
      placed.yCells,
      resolved.props.widthCells,
      resolved.props.heightCells,
      placed.rotationDeg ?? 0,
      resolved.props.attachmentNodes,
    );
    for (let parentNodeIndex = 0; parentNodeIndex < placedWorld.length; parentNodeIndex++) {
      const placedNode = placedWorld[parentNodeIndex];
      for (let childNodeIndex = 0; childNodeIndex < attachmentNodes.length; childNodeIndex++) {
        const dragNode = attachmentNodes[childNodeIndex];
        if (!nodesMatch(placedNode.kind, dragNode.kind)) continue;

        const xCells = placedNode.xCells - dragNode.xCells;
        const yCells = placedNode.yCells - dragNode.yCells;

        const centerX = (xCells + widthCells / 2) * cell;
        const centerY = (yCells + heightCells / 2) * cell;
        const distSq =
          (centerX - pointerWorld.x) ** 2 + (centerY - pointerWorld.y) ** 2;
        if (distSq > snapRadiusSq) continue;
        if (!inBounds(widthCells, heightCells, xCells, yCells)) continue;
        if (overlapsAnyPart(design, catalog, widthCells, heightCells, xCells, yCells)) {
          continue;
        }

        if (!best || distSq < best.distSq) {
          best = {
            xCells,
            yCells,
            distSq,
            parentId: placed.id ?? null,
            parentNodeIndex,
            childNodeIndex,
            mountKind: mountKindForNodes(placedNode.kind, dragNode.kind),
          };
        }
      }
    }
  }

  if (best) {
    return {
      xCells: best.xCells,
      yCells: best.yCells,
      valid: true,
      attached: true,
      parentId: best.parentId,
      parentNodeIndex: best.parentNodeIndex,
      childNodeIndex: best.childNodeIndex,
      mountKind: best.mountKind,
    };
  }
  return { ...free, valid: false, attached: false };
}