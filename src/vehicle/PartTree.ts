/**
 * Explicit part tree for the VAB (Phase 9 — Grok).
 *
 * Connectivity used to be inferred only from attachment-node coincidence.
 * Transform, rotate, and reroot need a first-class parent/child model.
 * Adjacency via `partsAttached` remains for validation and migration.
 */

import type { PartDefinition } from './PartDefinition';
import {
  cellsNear,
  nodesMatch,
  rotateOffset,
  type AttachmentNodeDef,
  type WorldNode,
} from './AttachmentNode';
import { deriveTreeFromEdges } from './PartGraph';
import { resolvePlacedPart } from './ProceduralPart';
import type { PlacedPartData, RocketDesign } from './RocketDesign';
import { partsAttached } from './StageSystem';
import type { PartInstance } from './PartInstance';

let nextPartIdCounter = 1;

/** Allocate a stable placed-part id. */
export function newPartId(existing: PlacedPartData[]): string {
  let max = 0;
  for (const p of existing) {
    if (!p.id) continue;
    const n = Number.parseInt(p.id.replace(/\D/g, ''), 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  nextPartIdCounter = Math.max(nextPartIdCounter, max + 1);
  return `p${nextPartIdCounter++}`;
}

export function ensurePartIds(design: RocketDesign): void {
  for (const p of design.parts) {
    if (!p.id) p.id = newPartId(design.parts);
  }
}

/** Resolve attachment nodes to world grid coordinates with rotation applied. */
export function worldAttachmentNodes(
  xCells: number,
  yCells: number,
  widthCells: number,
  heightCells: number,
  rotationDeg: number,
  nodes: AttachmentNodeDef[],
): WorldNode[] {
  return nodes.map((n) => {
    const local = rotateOffset(n.xCells, n.yCells, widthCells, heightCells, rotationDeg);
    return {
      xCells: xCells + local.xCells,
      yCells: yCells + local.yCells,
      kind: n.kind,
    };
  });
}

export function partById(design: RocketDesign, id: string): PlacedPartData | null {
  return design.parts.find((p) => p.id === id) ?? null;
}

export function childrenOf(design: RocketDesign, parentId: string): PlacedPartData[] {
  return design.parts.filter((p) => p.parentId === parentId);
}

/** All descendants (not including the root id itself). */
export function subtreeIds(design: RocketDesign, rootId: string): string[] {
  const out: string[] = [];
  const queue = childrenOf(design, rootId).map((c) => c.id!);
  while (queue.length > 0) {
    const id = queue.pop()!;
    out.push(id);
    for (const child of childrenOf(design, id)) queue.push(child.id!);
  }
  return out;
}

export function subtreeParts(design: RocketDesign, rootId: string): PlacedPartData[] {
  const root = partById(design, rootId);
  if (!root) return [];
  return [
    root,
    ...subtreeIds(design, rootId)
      .map((id) => partById(design, id))
      .filter((p): p is PlacedPartData => p !== null),
  ];
}

/** Heuristic root: command pod → any pod → first placed part. */
export function pickRootHeuristic(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
): string {
  ensurePartIds(design);
  const pod = design.parts.find((p) => catalog.get(p.defId)?.category === 'pod');
  if (pod?.id) return pod.id;
  return design.parts[0]?.id ?? newPartId(design.parts);
}

/** BFS adjacency migration (one-time for saves without a tree). */
export function migrateTreeFromAdjacency(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  instances: PartInstance[],
): void {
  ensurePartIds(design);
  if (
    design.rootPartId &&
    design.parts.every((p) => p.parentId !== undefined || p.id === design.rootPartId)
  ) {
    return;
  }

  const placedByInstance = new Map<PartInstance, PlacedPartData>();
  for (let i = 0; i < instances.length; i++) {
    placedByInstance.set(instances[i], design.parts[i]);
  }

  const rootId = design.rootPartId ?? pickRootHeuristic(design, catalog);
  design.rootPartId = rootId;

  for (const p of design.parts) {
    p.parentId = p.id === rootId ? null : undefined;
  }

  const rootInst = instances.find((inst) => placedByInstance.get(inst)?.id === rootId);
  if (!rootInst) return;

  const visited = new Set<PartInstance>([rootInst]);
  const queue: PartInstance[] = [rootInst];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const currentPlaced = placedByInstance.get(current)!;
    for (const other of instances) {
      if (visited.has(other)) continue;
      if (!partsAttached(current, other)) continue;
      const otherPlaced = placedByInstance.get(other)!;
      otherPlaced.parentId = currentPlaced.id!;
      visited.add(other);
      queue.push(other);
    }
  }

  for (const p of design.parts) {
    if (p.id !== rootId && p.parentId === undefined) p.parentId = null;
  }
}

/** Set a new tree root and re-derive parent links from edges. Staging order untouched. */
export function rerootDesign(design: RocketDesign, newRootId: string): boolean {
  const target = partById(design, newRootId);
  if (!target?.id || design.rootPartId === newRootId) return false;
  design.rootPartId = newRootId;
  if (design.edges.length > 0) {
    deriveTreeFromEdges(design, design.edges);
  } else {
    // Fallback when edges not yet synced (legacy path).
    const chain: PlacedPartData[] = [target];
    let cursor: PlacedPartData | null = target;
    while (cursor?.parentId) {
      const parent = partById(design, cursor.parentId);
      if (!parent) break;
      chain.push(parent);
      cursor = parent;
    }
    for (let i = 0; i < chain.length - 1; i++) {
      const child = chain[i];
      const parent = chain[i + 1];
      child.parentId = i === chain.length - 2 ? null : chain[i + 2].id ?? null;
      parent.parentId = child.id!;
    }
  }
  return true;
}

export function partCenter(
  placed: PlacedPartData,
  catalog: Map<string, PartDefinition>,
): { xCells: number; yCells: number } {
  const resolved = resolvePlacedPart(placed, catalog)!;
  return {
    xCells: placed.xCells + resolved.props.widthCells / 2,
    yCells: placed.yCells + resolved.props.heightCells / 2,
  };
}

/** Pivot for rotation: parent attachment joint, or part center when root. */
export function rotationPivot(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  partId: string,
): { xCells: number; yCells: number } {
  const part = partById(design, partId);
  if (!part) return { xCells: 0, yCells: 0 };
  if (!part.parentId) return partCenter(part, catalog);

  const parent = partById(design, part.parentId);
  const parentResolved = parent ? resolvePlacedPart(parent, catalog) : null;
  const partResolved = resolvePlacedPart(part, catalog)!;
  if (!parent || !parentResolved) return partCenter(part, catalog);

  const pNodes = worldAttachmentNodes(
    parent.xCells,
    parent.yCells,
    parentResolved.props.widthCells,
    parentResolved.props.heightCells,
    parent.rotationDeg ?? 0,
    parentResolved.props.attachmentNodes,
  );
  const rNodes = worldAttachmentNodes(
    part.xCells,
    part.yCells,
    partResolved.props.widthCells,
    partResolved.props.heightCells,
    part.rotationDeg ?? 0,
    partResolved.props.attachmentNodes,
  );
  for (const pn of pNodes) {
    for (const rn of rNodes) {
      if (
        cellsNear(pn.xCells, rn.xCells) &&
        cellsNear(pn.yCells, rn.yCells) &&
        nodesMatch(pn.kind, rn.kind)
      ) {
        return { xCells: pn.xCells, yCells: pn.yCells };
      }
    }
  }
  return partCenter(part, catalog);
}

export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

/**
 * Legacy origin-based rotation (pre Phase 13). Prefer
 * builder/RotateOps.applyRigidRotationAboutPivot which orbits part centers.
 */
export function applySubtreeRotation(
  members: PlacedPartData[],
  pivotX: number,
  pivotY: number,
  deltaDeg: number,
): void {
  const rad = (deltaDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  for (const p of members) {
    const dx = p.xCells - pivotX;
    const dy = p.yCells - pivotY;
    p.xCells = pivotX + dx * cos - dy * sin;
    p.yCells = pivotY + dx * sin + dy * cos;
    p.rotationDeg = normalizeDeg((p.rotationDeg ?? 0) + deltaDeg);
  }
}

/** Rigid translation of subtree members (caller validates collisions). */
export function applySubtreeTranslation(
  members: PlacedPartData[],
  dxCells: number,
  dyCells: number,
): void {
  for (const p of members) {
    p.xCells += dxCells;
    p.yCells += dyCells;
  }
}