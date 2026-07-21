/**
 * Attachment graph (Phase 11): explicit edges are the source of truth for how
 * parts connect. The parent/child tree is derived from edges + rootPartId.
 *
 * See phase planning/phase-11-pivot-rules.md for pivot semantics.
 */

import type { PartDefinition } from './PartDefinition';
import {
  cellsNear,
  nodesMatch,
  type AttachmentNodeDef,
  type NodeKind,
} from './AttachmentNode';
import { resolvePlacedPart } from './ProceduralPart';
import type { PlacedPartData, RocketDesign } from './RocketDesign';
import { ensurePartIds, pickRootHeuristic, worldAttachmentNodes } from './PartTree';
import { partsAttached } from './StageSystem';
import { PartInstance } from './PartInstance';

/** How two parts are joined at a specific node pair. */
export type MountKind = 'stack' | 'radial' | 'internal';

export interface AttachmentEdge {
  partAId: string;
  partBId: string;
  mountKind: MountKind;
  partANodeIndex: number;
  partBNodeIndex: number;
}

export interface StructuralCheck {
  ok: boolean;
  problems: string[];
}

function edgeKey(e: AttachmentEdge): string {
  const ids = [e.partAId, e.partBId].sort();
  return `${ids[0]}:${e.partANodeIndex}|${ids[1]}:${e.partBNodeIndex}:${e.mountKind}`;
}

/** Classify mount role from the node kinds at a connection. */
export function mountKindForNodes(a: NodeKind, b: NodeKind): MountKind {
  if (
    (a === 'top' || a === 'bottom') &&
    (b === 'top' || b === 'bottom')
  ) {
    return 'stack';
  }
  if (
    (a === 'left' || a === 'right') &&
    (b === 'left' || b === 'right')
  ) {
    return 'radial';
  }
  return 'internal';
}

function resolvedNodes(
  placed: PlacedPartData,
  catalog: Map<string, PartDefinition>,
): AttachmentNodeDef[] {
  return resolvePlacedPart(placed, catalog)?.props.attachmentNodes ?? [];
}

function worldNodesFor(
  placed: PlacedPartData,
  catalog: Map<string, PartDefinition>,
) {
  const resolved = resolvePlacedPart(placed, catalog);
  if (!resolved) return [];
  return worldAttachmentNodes(
    placed.xCells,
    placed.yCells,
    resolved.props.widthCells,
    resolved.props.heightCells,
    placed.rotationDeg ?? 0,
    resolved.props.attachmentNodes,
  );
}

/** Discover all node-coincident connections between parts. */
export function buildEdgesFromGeometry(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
): AttachmentEdge[] {
  ensurePartIds(design);
  const edges: AttachmentEdge[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < design.parts.length; i++) {
    for (let j = i + 1; j < design.parts.length; j++) {
      const a = design.parts[i];
      const b = design.parts[j];
      if (!a.id || !b.id) continue;

      const aNodes = resolvedNodes(a, catalog);
      const bNodes = resolvedNodes(b, catalog);
      const aWorld = worldNodesFor(a, catalog);
      const bWorld = worldNodesFor(b, catalog);

      for (let ai = 0; ai < aWorld.length; ai++) {
        for (let bi = 0; bi < bWorld.length; bi++) {
          const wa = aWorld[ai];
          const wb = bWorld[bi];
          if (
            !cellsNear(wa.xCells, wb.xCells) ||
            !cellsNear(wa.yCells, wb.yCells) ||
            !nodesMatch(wa.kind, wb.kind)
          ) {
            continue;
          }
          const mountKind = mountKindForNodes(aNodes[ai].kind, bNodes[bi].kind);
          const edge: AttachmentEdge = {
            partAId: a.id,
            partBId: b.id,
            mountKind,
            partANodeIndex: ai,
            partBNodeIndex: bi,
          };
          const key = edgeKey(edge);
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push(edge);
        }
      }
    }
  }
  return edges;
}

/** BFS from root: first visit sets parent. */
export function deriveTreeFromEdges(design: RocketDesign, edges: AttachmentEdge[]): void {
  ensurePartIds(design);
  if (!design.rootPartId || !design.parts.some((part) => part.id === design.rootPartId)) {
    design.rootPartId = design.parts[0]?.id ?? null;
  }
  const rootId = design.rootPartId;
  if (!rootId) return;

  const adjacency = new Map<string, { neighborId: string; edge: AttachmentEdge }[]>();
  for (const e of edges) {
    const listA = adjacency.get(e.partAId) ?? [];
    listA.push({ neighborId: e.partBId, edge: e });
    adjacency.set(e.partAId, listA);
    const listB = adjacency.get(e.partBId) ?? [];
    listB.push({ neighborId: e.partAId, edge: e });
    adjacency.set(e.partBId, listB);
  }

  for (const p of design.parts) {
    p.parentId = p.id === rootId ? null : null;
  }

  const visited = new Set<string>();
  const orientComponent = (componentRootId: string): void => {
    const componentRoot = design.parts.find((part) => part.id === componentRootId);
    if (!componentRoot) return;
    componentRoot.parentId = null;
    visited.add(componentRootId);
    const queue = [componentRootId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const { neighborId } of adjacency.get(currentId) ?? []) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        const child = design.parts.find((part) => part.id === neighborId);
        if (child) child.parentId = currentId;
        queue.push(neighborId);
      }
    }
  };

  // Orient the launchable component from the designated root, then retain a
  // deterministic tree inside every detached component. Structural validation
  // still reports those components as disconnected from the real root, but a
  // freshly duplicated subassembly remains movable as a subtree.
  orientComponent(rootId);
  for (const part of design.parts) {
    if (part.id && !visited.has(part.id)) orientComponent(part.id);
  }
}

/** Add or replace the edge for a new child snapped onto a parent. */
export function addSnapEdge(
  edges: AttachmentEdge[],
  childPartId: string,
  parentPartId: string,
  childNodeIndex: number,
  parentNodeIndex: number,
  mountKind: MountKind,
): AttachmentEdge[] {
  const filtered = edges.filter(
    (e) =>
      !(
        (e.partAId === childPartId || e.partBId === childPartId) &&
        (e.partAId === parentPartId || e.partBId === parentPartId)
      ),
  );
  filtered.push({
    partAId: parentPartId,
    partBId: childPartId,
    mountKind,
    partANodeIndex: parentNodeIndex,
    partBNodeIndex: childNodeIndex,
  });
  return filtered;
}

export function removeEdgesForPart(edges: AttachmentEdge[], partId: string): AttachmentEdge[] {
  return edges.filter((e) => e.partAId !== partId && e.partBId !== partId);
}

/** Reset non-zero rotations authored under pre-Phase-11 semantics. */
export function migrateRotationSemantics(design: RocketDesign): boolean {
  let changed = false;
  for (const p of design.parts) {
    const rot = p.rotationDeg ?? 0;
    if (rot !== 0) {
      p.rotationDeg = 0;
      changed = true;
    }
  }
  return changed;
}

/**
 * Full graph sync: ids, rotation migration, edges from geometry if missing,
 * derive tree, optional root heuristic on empty root.
 */
export function syncDesignGraph(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  instances?: PartInstance[],
): void {
  if (design.isEmpty) {
    design.rootPartId = null;
    design.edges = [];
    return;
  }
  ensurePartIds(design);
  migrateRotationSemantics(design);

  if (!design.rootPartId || !design.parts.some((part) => part.id === design.rootPartId)) {
    // Preserve an explicitly oriented surviving component when the previous
    // designated root was deleted. Fall back to the pod heuristic only for
    // legacy/unoriented data that has no parentless component root.
    design.rootPartId =
      design.parts.find((part) => part.id && part.parentId === null)?.id ??
      pickRootHeuristic(design, catalog);
  }

  // Geometry + node coincidence is authoritative; edges are rebuilt each sync.
  design.edges = buildEdgesFromGeometry(design, catalog);
  deriveTreeFromEdges(design, design.edges);

  // Legacy saves without edges: adjacency migration already handled via geometry edges.
  void instances;
}

/** Mirror X for symmetry across the center column (matches BuilderScene). */
export function mirroredXCells(xCells: number, widthCells: number): number {
  return -(xCells + widthCells);
}

/** Find the geometric mirror twin of a placed part, if any. */
export function findMirroredPart(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  part: PlacedPartData,
): PlacedPartData | null {
  const resolved = resolvePlacedPart(part, catalog);
  if (!resolved) return null;
  const mx = mirroredXCells(part.xCells, resolved.props.widthCells);
  return (
    design.parts.find(
      (p) =>
        p !== part &&
        p.defId === part.defId &&
        p.yCells === part.yCells &&
        p.xCells === mx,
    ) ?? null
  );
}

/** Resolve mirror parent id when placing a symmetry twin. */
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

export function validateStructure(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
): StructuralCheck {
  const problems: string[] = [];
  if (design.isEmpty) return { ok: false, problems: ['The rocket has no parts.'] };

  ensurePartIds(design);
  syncDesignGraph(design, catalog);

  const edges = design.edges ?? [];
  const rootId = design.rootPartId;
  if (!rootId) {
    problems.push('No root part designated.');
    return { ok: false, problems };
  }

  const partIds = new Set(design.parts.map((p) => p.id!));
  for (const p of design.parts) {
    if (p.parentId && !partIds.has(p.parentId)) {
      problems.push(`Part ${p.defId} references missing parent.`);
    }
  }

  const reachable = new Set<string>();
  const queue = [rootId];
  reachable.add(rootId);
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const a = adjacency.get(e.partAId) ?? [];
    a.push(e.partBId);
    adjacency.set(e.partAId, a);
    const b = adjacency.get(e.partBId) ?? [];
    b.push(e.partAId);
    adjacency.set(e.partBId, b);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const n of adjacency.get(id) ?? []) {
      if (reachable.has(n)) continue;
      reachable.add(n);
      queue.push(n);
    }
  }

  const disconnected = design.parts.filter((p) => p.id && !reachable.has(p.id));
  if (disconnected.length > 0) {
    problems.push(`${disconnected.length} part(s) are not attached to the rocket.`);
  }

  for (const p of design.parts) {
    if (p.id === rootId) continue;
    if (reachable.has(p.id!) && p.parentId === null) {
      problems.push(`Attached part ${p.defId} has no parent in the tree.`);
    }
  }

  // Cross-check with runtime adjacency (staging depends on this).
  if (design.parts.length > 1) {
    const instances = design.parts.map((placed) => {
      const def = catalog.get(placed.defId)!;
      return new PartInstance(
        def,
        placed.xCells,
        placed.yCells,
        placed.custom,
        placed.rotationDeg ?? 0,
      );
    });
    const visited = new Set<PartInstance>([instances[0]]);
    const q: PartInstance[] = [instances[0]];
    while (q.length > 0) {
      const cur = q.pop()!;
      for (const other of instances) {
        if (visited.has(other)) continue;
        if (partsAttached(cur, other)) {
          visited.add(other);
          q.push(other);
        }
      }
    }
    if (visited.size < instances.length) {
      const msg = `${instances.length - visited.size} part(s) fail node-coincidence connectivity.`;
      if (!problems.includes(`${disconnected.length} part(s) are not attached to the rocket.`)) {
        problems.push(msg);
      }
    }
  }

  return { ok: problems.length === 0, problems };
}
