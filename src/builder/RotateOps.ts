/**
 * Rotate v2 (Phase 13) — pivot rules from phase-11-pivot-rules.md.
 *
 * Stack mounts: rotate about the shared stack joint (quantized 90°).
 * Radial mounts: rotate about the mount point (user Rot step, typically 90°).
 * Root selection: part center (discouraged for stack, but allowed).
 *
 * Geometry matches rendering: origins are bottom-left of the unrotated
 * footprint; rotationDeg is about the part center. Rigid transforms therefore
 * orbit each part's center around the pivot, then recompute origin.
 */

import type { PartDefinition } from '../vehicle/PartDefinition';
import {
  cellsNear,
  nodesMatch,
  type NodeKind,
} from '../vehicle/AttachmentNode';
import {
  mountKindForNodes,
  syncDesignGraph,
  type MountKind,
} from '../vehicle/PartGraph';
import { resolvePlacedPart } from '../vehicle/ProceduralPart';
import type { PlacedPartData, RocketDesign } from '../vehicle/RocketDesign';
import {
  normalizeDeg,
  partById,
  partCenter,
  subtreeParts,
  worldAttachmentNodes,
} from '../vehicle/PartTree';
import { inBounds } from './GridSystem';
import { partsWouldOverlap } from './Collision';

export interface RotatePivotInfo {
  xCells: number;
  yCells: number;
  mountKind: MountKind | 'root';
  /** Preferred step quantization for this mount (degrees). */
  quantizeDeg: number;
}

export function partCenterCells(
  placed: PlacedPartData,
  catalog: Map<string, PartDefinition>,
): { xCells: number; yCells: number } {
  return partCenter(placed, catalog);
}

/** Find the shared attachment joint between child and parent (world cells). */
export function jointBetween(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  childId: string,
  parentId: string,
): { xCells: number; yCells: number; mountKind: MountKind } | null {
  const child = partById(design, childId);
  const parent = partById(design, parentId);
  if (!child || !parent) return null;
  const childResolved = resolvePlacedPart(child, catalog);
  const parentResolved = resolvePlacedPart(parent, catalog);
  if (!childResolved || !parentResolved) return null;

  const cNodes = worldAttachmentNodes(
    child.xCells,
    child.yCells,
    childResolved.props.widthCells,
    childResolved.props.heightCells,
    child.rotationDeg ?? 0,
    childResolved.props.attachmentNodes,
  );
  const pNodes = worldAttachmentNodes(
    parent.xCells,
    parent.yCells,
    parentResolved.props.widthCells,
    parentResolved.props.heightCells,
    parent.rotationDeg ?? 0,
    parentResolved.props.attachmentNodes,
  );

  for (let ci = 0; ci < cNodes.length; ci++) {
    for (let pi = 0; pi < pNodes.length; pi++) {
      const cn = cNodes[ci];
      const pn = pNodes[pi];
      if (
        cellsNear(cn.xCells, pn.xCells) &&
        cellsNear(cn.yCells, pn.yCells) &&
        nodesMatch(cn.kind, pn.kind)
      ) {
        return {
          xCells: pn.xCells,
          yCells: pn.yCells,
          mountKind: mountKindForNodes(cn.kind as NodeKind, pn.kind as NodeKind),
        };
      }
    }
  }
  return null;
}

/** Resolve pivot for rotating the subtree rooted at `partId`. */
export function resolveRotatePivot(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  partId: string,
): RotatePivotInfo {
  const part = partById(design, partId);
  if (!part) return { xCells: 0, yCells: 0, mountKind: 'root', quantizeDeg: 90 };
  if (!part.parentId) {
    const c = partCenter(part, catalog);
    return { ...c, mountKind: 'root', quantizeDeg: 90 };
  }
  const joint = jointBetween(design, catalog, partId, part.parentId);
  if (joint) {
    return {
      xCells: joint.xCells,
      yCells: joint.yCells,
      mountKind: joint.mountKind,
      quantizeDeg: joint.mountKind === 'stack' ? 90 : 15,
    };
  }
  const c = partCenter(part, catalog);
  return { ...c, mountKind: 'root', quantizeDeg: 90 };
}

/**
 * Snap a requested rotation delta to the allowed set for the mount kind.
 * Stack: multiples of 90°. Radial / root: multiples of `stepDeg` (from Rot UI).
 */
export function quantizeRotateDelta(
  deltaDeg: number,
  mountKind: MountKind | 'root',
  stepDeg: number,
): number {
  if (deltaDeg === 0) return 0;
  const sign = deltaDeg < 0 ? -1 : 1;
  const mag = Math.abs(deltaDeg);
  if (mountKind === 'stack') {
    // Nearest 90° in the commanded direction (at least 90° if non-zero).
    const steps = Math.max(1, Math.round(mag / 90));
    return sign * steps * 90;
  }
  const step = Math.max(1, stepDeg);
  const steps = Math.max(1, Math.round(mag / step));
  return sign * steps * step;
}

/**
 * Rigid-rotate a set of parts about a pivot using center-based geometry.
 * Mutates members in place; does not validate collisions.
 */
export function applyRigidRotationAboutPivot(
  members: PlacedPartData[],
  catalog: Map<string, PartDefinition>,
  pivotX: number,
  pivotY: number,
  deltaDeg: number,
): void {
  if (deltaDeg === 0) return;
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (const p of members) {
    const resolved = resolvePlacedPart(p, catalog);
    if (!resolved) continue;
    const w = resolved.props.widthCells;
    const h = resolved.props.heightCells;
    const cx = p.xCells + w / 2;
    const cy = p.yCells + h / 2;
    const dx = cx - pivotX;
    const dy = cy - pivotY;
    const ncx = pivotX + dx * cos - dy * sin;
    const ncy = pivotY + dx * sin + dy * cos;
    p.xCells = ncx - w / 2;
    p.yCells = ncy - h / 2;
    p.rotationDeg = normalizeDeg((p.rotationDeg ?? 0) + deltaDeg);
  }
}

/**
 * Bounds for every part + overlap only against non-rotating parts that are
 * not the mount parent. Joint partners always share a vertex and their AABBs
 * often interpenetrate slightly after a spin — Sol's Phase 13 note prefers
 * node-coincidence over pure AABB for rotated mates.
 */
function designFitsAfterRotate(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  rotatingIds: ReadonlySet<string>,
  mountParentId: string | null,
): boolean {
  for (const p of design.parts) {
    const resolved = resolvePlacedPart(p, catalog);
    if (!resolved) continue;
    const { widthCells, heightCells } = resolved.props;
    if (!inBounds(widthCells, heightCells, p.xCells, p.yCells)) return false;
  }

  for (const a of design.parts) {
    if (!a.id || !rotatingIds.has(a.id)) continue;
    for (const b of design.parts) {
      if (!b.id || rotatingIds.has(b.id)) continue;
      if (mountParentId && b.id === mountParentId) continue;
      if (partsWouldOverlap(a, b, catalog)) return false;
    }
  }
  return true;
}

/**
 * Rotate the subtree rooted at `rootId` by a (possibly quantized) delta.
 * Returns true if the design was mutated. Syncs the attachment graph on success.
 */
export function tryRotateSubtreeV2(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  rootId: string,
  requestedDeltaDeg: number,
  stepDeg = 15,
): boolean {
  if (requestedDeltaDeg === 0) return true;
  const pivot = resolveRotatePivot(design, catalog, rootId);
  const deltaDeg = quantizeRotateDelta(requestedDeltaDeg, pivot.mountKind, stepDeg);
  if (deltaDeg === 0) return true;

  const members = subtreeParts(design, rootId);
  if (members.length === 0) return false;

  const snapshots = members.map((p) => ({
    p,
    x: p.xCells,
    y: p.yCells,
    rot: p.rotationDeg ?? 0,
  }));

  applyRigidRotationAboutPivot(members, catalog, pivot.xCells, pivot.yCells, deltaDeg);

  const rotatingIds = new Set(
    members.map((m) => m.id).filter((id): id is string => Boolean(id)),
  );
  const rootPart = partById(design, rootId);
  const mountParentId = rootPart?.parentId ?? null;

  if (!designFitsAfterRotate(design, catalog, rotatingIds, mountParentId)) {
    for (const s of snapshots) {
      s.p.xCells = s.x;
      s.p.yCells = s.y;
      s.p.rotationDeg = s.rot;
    }
    return false;
  }

  // Keep joint after rotate: stack/radial mates must still coincide so graph
  // rebuild preserves the intended tree. If geometry drifted off-grid, reject.
  if (pivot.mountKind !== 'root' && mountParentId) {
    const joint = jointBetween(design, catalog, rootId, mountParentId);
    if (!joint) {
      for (const s of snapshots) {
        s.p.xCells = s.x;
        s.p.yCells = s.y;
        s.p.rotationDeg = s.rot;
      }
      return false;
    }
  }

  syncDesignGraph(design, catalog);
  return true;
}
