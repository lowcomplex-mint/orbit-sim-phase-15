/**
 * VAB mirror symmetry (SYM) across the center column x = 0.
 *
 * Earlier implementation only flipped the part origin with
 * `-(x + width)`. That is correct for free placement but unreliable for
 * attachments: the twin must re-mate via the mirrored node (left↔right),
 * often on the mirrored parent part, and survive graph rebuild.
 */

import {
  cellsNear,
  nodesMatch,
  type AttachmentNodeDef,
  type NodeKind,
} from '../vehicle/AttachmentNode';
import type { PartDefinition } from '../vehicle/PartDefinition';
import { mirroredXCells } from '../vehicle/PartGraph';
import { resolvePlacedPart, type ResolvedPartProps } from '../vehicle/ProceduralPart';
import type { PlacedPartData, RocketDesign } from '../vehicle/RocketDesign';
import { worldAttachmentNodes } from '../vehicle/PartTree';
import { inBounds, overlapsAnyPart } from './GridSystem';

/** Reflect a node kind across a vertical mirror (X flip). */
export function mirrorNodeKind(kind: NodeKind): NodeKind {
  if (kind === 'left') return 'right';
  if (kind === 'right') return 'left';
  return kind; // top / bottom unchanged under X reflection
}

/** Reflect a world X coordinate across x = 0. */
export function mirrorWorldX(xCells: number): number {
  return -xCells;
}

/**
 * Mirror a part origin so the interval [x, x+w] maps to [-x-w, -x].
 * Same formula as the historical BuilderScene helper.
 */
export function mirrorOriginX(xCells: number, widthCells: number): number {
  return mirroredXCells(xCells, widthCells);
}

/** Looser match for finding an existing twin (fractional snap noise). */
const TWIN_MATCH_EPS = 0.051;

function near(a: number, b: number, eps = TWIN_MATCH_EPS): boolean {
  return Math.abs(a - b) < eps;
}

/** Find a geometric mirror twin of a placed part (defId + mirrored footprint). */
export function findMirroredPart(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  part: PlacedPartData,
): PlacedPartData | null {
  const resolved = resolvePlacedPart(part, catalog);
  if (!resolved) return null;
  const mx = mirrorOriginX(part.xCells, resolved.props.widthCells);
  return (
    design.parts.find(
      (p) =>
        p !== part &&
        p.defId === part.defId &&
        near(p.yCells, part.yCells) &&
        near(p.xCells, mx),
    ) ?? null
  );
}

/**
 * Parent for a symmetry twin: prefer the parent's own twin when the parent
 * is off-axis; fall back to the same parent when it sits on the centerline.
 */
export function mirroredParentId(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  parentId: string | null | undefined,
): string | null {
  if (!parentId) return null;
  const parent = design.parts.find((p) => p.id === parentId);
  if (!parent) return null;
  const twin = findMirroredPart(design, catalog, parent);
  return twin?.id ?? parentId;
}

export interface SymmetryTwinResult {
  xCells: number;
  yCells: number;
  parentId: string | null;
  /** True when the twin coincides with the primary (centerline placement). */
  isIdentity: boolean;
  /** True when bounds/overlap/attachment allow the twin. */
  valid: boolean;
  reason?: string;
}

/**
 * Compute where the SYM twin of a successful primary placement should go.
 *
 * If the primary was node-snapped, re-derive the twin from the mirrored
 * parent node + mirrored child node so left/right flanks mate correctly.
 * Otherwise fall back to origin X flip.
 */
export function computeSymmetryTwin(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  props: ResolvedPartProps,
  primaryX: number,
  primaryY: number,
  primaryParentId: string | null | undefined,
  primaryParentNodeIndex?: number,
  primaryChildNodeIndex?: number,
): SymmetryTwinResult {
  const { widthCells, heightCells, attachmentNodes } = props;
  const mx = mirrorOriginX(primaryX, widthCells);
  if (near(mx, primaryX, GRID_EPS_IDENTITY)) {
    return {
      xCells: primaryX,
      yCells: primaryY,
      parentId: primaryParentId ?? null,
      isIdentity: true,
      valid: false,
      reason: 'identity',
    };
  }

  // --- Preferred path: re-snap using mirrored nodes ---
  if (
    primaryParentId &&
    primaryParentNodeIndex !== undefined &&
    primaryChildNodeIndex !== undefined
  ) {
    const parent = design.parts.find((p) => p.id === primaryParentId);
    const parentResolved = parent ? resolvePlacedPart(parent, catalog) : null;
    if (parent && parentResolved) {
      const parentNodes = worldAttachmentNodes(
        parent.xCells,
        parent.yCells,
        parentResolved.props.widthCells,
        parentResolved.props.heightCells,
        parent.rotationDeg ?? 0,
        parentResolved.props.attachmentNodes,
      );
      const primaryParentNode = parentNodes[primaryParentNodeIndex];
      const primaryChildNode = attachmentNodes[primaryChildNodeIndex];

      if (primaryParentNode && primaryChildNode) {
        const targetWorld = {
          xCells: mirrorWorldX(primaryParentNode.xCells),
          yCells: primaryParentNode.yCells,
          kind: mirrorNodeKind(primaryParentNode.kind),
        };
        const twinChildKind = mirrorNodeKind(primaryChildNode.kind);
        const twinChildLocal = findLocalNode(attachmentNodes, twinChildKind, primaryChildNode);

        // Prefer the geometric twin of the parent; else any part offering the target node.
        const preferredParent = findMirroredPart(design, catalog, parent) ?? parent;
        const host = findHostForMirroredNode(
          design,
          catalog,
          targetWorld,
          preferredParent,
        );

        if (host && twinChildLocal) {
          const hostResolved = resolvePlacedPart(host.part, catalog)!;
          const hostNodes = worldAttachmentNodes(
            host.part.xCells,
            host.part.yCells,
            hostResolved.props.widthCells,
            hostResolved.props.heightCells,
            host.part.rotationDeg ?? 0,
            hostResolved.props.attachmentNodes,
          );
          const hostNode = hostNodes[host.nodeIndex];
          if (hostNode) {
            const xCells = hostNode.xCells - twinChildLocal.xCells;
            const yCells = hostNode.yCells - twinChildLocal.yCells;
            const ok = canPlaceTwin(design, catalog, widthCells, heightCells, xCells, yCells);
            if (ok) {
              return {
                xCells,
                yCells,
                parentId: host.part.id ?? null,
                isIdentity: false,
                valid: true,
              };
            }
            // Fall through to origin-mirror fallback if re-snap collides.
          }
        }
      }
    }
  }

  // --- Fallback: pure origin flip (free place / failed re-snap) ---
  const parentId = mirroredParentId(design, catalog, primaryParentId);
  const ok = canPlaceTwin(design, catalog, widthCells, heightCells, mx, primaryY);
  if (!ok) {
    return {
      xCells: mx,
      yCells: primaryY,
      parentId,
      isIdentity: false,
      valid: false,
      reason: 'no room on the mirrored side',
    };
  }

  // If primary was attached, require the twin to actually share a node with someone
  // after placement; otherwise the graph will treat it as floating.
  if (primaryParentId) {
    const wouldAttach = wouldTwinAttach(
      design,
      catalog,
      widthCells,
      heightCells,
      attachmentNodes,
      mx,
      primaryY,
    );
    if (!wouldAttach) {
      // Try a wider search: snap twin by scanning for any mirrored radial/stack mate.
      const scanned = scanTwinSnap(design, catalog, props, primaryX, primaryY);
      if (scanned) return scanned;
      return {
        xCells: mx,
        yCells: primaryY,
        parentId,
        isIdentity: false,
        valid: false,
        reason: 'mirrored side has no matching attachment node',
      };
    }
  }

  return {
    xCells: mx,
    yCells: primaryY,
    parentId,
    isIdentity: false,
    valid: true,
  };
}

const GRID_EPS_IDENTITY = 1e-4;

function findLocalNode(
  nodes: AttachmentNodeDef[],
  kind: NodeKind,
  hint: AttachmentNodeDef,
): AttachmentNodeDef | null {
  // Prefer the node with the mirrored kind and closest local Y to the primary child.
  let best: AttachmentNodeDef | null = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    if (n.kind !== kind) continue;
    const score = Math.abs(n.yCells - hint.yCells);
    if (score < bestDist) {
      bestDist = score;
      best = n;
    }
  }
  return best ?? nodes.find((n) => n.kind === kind) ?? null;
}

function findHostForMirroredNode(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  target: { xCells: number; yCells: number; kind: NodeKind },
  preferred: PlacedPartData,
): { part: PlacedPartData; nodeIndex: number } | null {
  const candidates = [preferred, ...design.parts.filter((p) => p !== preferred)];
  for (const part of candidates) {
    const resolved = resolvePlacedPart(part, catalog);
    if (!resolved) continue;
    const nodes = worldAttachmentNodes(
      part.xCells,
      part.yCells,
      resolved.props.widthCells,
      resolved.props.heightCells,
      part.rotationDeg ?? 0,
      resolved.props.attachmentNodes,
    );
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (
        cellsNear(n.xCells, target.xCells) &&
        cellsNear(n.yCells, target.yCells) &&
        n.kind === target.kind
      ) {
        return { part, nodeIndex: i };
      }
    }
  }
  // Soft search: same kind near target (fractional drift).
  for (const part of candidates) {
    const resolved = resolvePlacedPart(part, catalog);
    if (!resolved) continue;
    const nodes = worldAttachmentNodes(
      part.xCells,
      part.yCells,
      resolved.props.widthCells,
      resolved.props.heightCells,
      part.rotationDeg ?? 0,
      resolved.props.attachmentNodes,
    );
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.kind !== target.kind) continue;
      if (near(n.xCells, target.xCells) && near(n.yCells, target.yCells)) {
        return { part, nodeIndex: i };
      }
    }
  }
  return null;
}

function canPlaceTwin(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  widthCells: number,
  heightCells: number,
  xCells: number,
  yCells: number,
): boolean {
  return (
    inBounds(widthCells, heightCells, xCells, yCells) &&
    !overlapsAnyPart(design, catalog, widthCells, heightCells, xCells, yCells)
  );
}

function wouldTwinAttach(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  widthCells: number,
  heightCells: number,
  attachmentNodes: AttachmentNodeDef[],
  xCells: number,
  yCells: number,
  rotationDeg = 0,
): boolean {
  const twinWorld = worldAttachmentNodes(
    xCells,
    yCells,
    widthCells,
    heightCells,
    rotationDeg,
    attachmentNodes,
  );
  for (const placed of design.parts) {
    const resolved = resolvePlacedPart(placed, catalog);
    if (!resolved) continue;
    const hostWorld = worldAttachmentNodes(
      placed.xCells,
      placed.yCells,
      resolved.props.widthCells,
      resolved.props.heightCells,
      placed.rotationDeg ?? 0,
      resolved.props.attachmentNodes,
    );
    for (const a of twinWorld) {
      for (const b of hostWorld) {
        if (
          cellsNear(a.xCells, b.xCells) &&
          cellsNear(a.yCells, b.yCells) &&
          nodesMatch(a.kind, b.kind)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Last-resort scan: try pairing every twin child node with every host node of
 * matching kind near the mirrored primary footprint.
 */
function scanTwinSnap(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  props: ResolvedPartProps,
  primaryX: number,
  primaryY: number,
): SymmetryTwinResult | null {
  const { widthCells, heightCells, attachmentNodes } = props;
  const primaryCenterX = primaryX + widthCells / 2;
  const targetCenterX = mirrorWorldX(primaryCenterX);
  const primaryCenterY = primaryY + heightCells / 2;

  let best: SymmetryTwinResult | null = null;
  let bestDist = Infinity;

  for (const placed of design.parts) {
    const resolved = resolvePlacedPart(placed, catalog);
    if (!resolved) continue;
    const hostWorld = worldAttachmentNodes(
      placed.xCells,
      placed.yCells,
      resolved.props.widthCells,
      resolved.props.heightCells,
      placed.rotationDeg ?? 0,
      resolved.props.attachmentNodes,
    );
    for (const hostNode of hostWorld) {
      for (const childNode of attachmentNodes) {
        if (!nodesMatch(hostNode.kind, childNode.kind)) continue;
        const xCells = hostNode.xCells - childNode.xCells;
        const yCells = hostNode.yCells - childNode.yCells;
        // Prefer the mirror half-plane opposite the primary.
        const centerX = xCells + widthCells / 2;
        if (primaryCenterX < -0.05 && centerX < 0) continue;
        if (primaryCenterX > 0.05 && centerX > 0) continue;
        if (!canPlaceTwin(design, catalog, widthCells, heightCells, xCells, yCells)) continue;
        const dist =
          (centerX - targetCenterX) ** 2 +
          (yCells + heightCells / 2 - primaryCenterY) ** 2;
        if (dist < bestDist) {
          bestDist = dist;
          best = {
            xCells,
            yCells,
            parentId: placed.id ?? null,
            isIdentity: false,
            valid: true,
          };
        }
      }
    }
  }
  return best;
}
