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
import {
  boxesSurfaceFlush,
  canSurfaceAttach,
  canSurfaceHost,
} from './SurfaceAttach';

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

  // Surface-attach parts with no node mate yet: one radial edge to the best
  // flush host (largest lateral contact). Skip if a node edge already binds
  // the part (avoids legs also graphing onto a capsule they merely brush).
  for (const surf of design.parts) {
    if (!surf.id) continue;
    const sResolved = resolvePlacedPart(surf, catalog);
    if (!sResolved || !canSurfaceAttach(sResolved.def)) continue;
    const alreadyBound = edges.some(
      (e) => e.partAId === surf.id || e.partBId === surf.id,
    );
    if (alreadyBound) continue;
    const sBox = {
      x: surf.xCells,
      y: surf.yCells,
      w: sResolved.props.widthCells,
      h: sResolved.props.heightCells,
    };
    let best: { id: string; score: number } | null = null;
    for (const host of design.parts) {
      if (!host.id || host === surf) continue;
      const hResolved = resolvePlacedPart(host, catalog);
      if (!hResolved || !canSurfaceHost(hResolved.def)) continue;
      const hBox = {
        x: host.xCells,
        y: host.yCells,
        w: hResolved.props.widthCells,
        h: hResolved.props.heightCells,
      };
      if (!boxesSurfaceFlush(sBox, hBox)) continue;
      const yOverlap = Math.max(
        0,
        Math.min(sBox.y + sBox.h, hBox.y + hBox.h) - Math.max(sBox.y, hBox.y),
      );
      const xOverlap = Math.max(
        0,
        Math.min(sBox.x + sBox.w, hBox.x + hBox.w) - Math.max(sBox.x, hBox.x),
      );
      const score = yOverlap * 10 + xOverlap; // prefer tall side contact
      if (!best || score > best.score) best = { id: host.id, score };
    }
    if (best) {
      const key = `${[surf.id, best.id].sort().join(':')}:surface`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({
          partAId: surf.id,
          partBId: best.id,
          mountKind: 'radial',
          partANodeIndex: 0,
          partBNodeIndex: 0,
        });
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

/**
 * Phase 11 once wiped non-zero rotationDeg every sync (pre-Rotate-v2
 * semantics). Phase 13 keeps intentional rotations; this is a no-op kept so
 * older call sites compile and docs can mention the migration history.
 */
export function migrateRotationSemantics(_design: RocketDesign): boolean {
  return false;
}

/**
 * Full graph sync: ids, edges from geometry, derive tree, root repair.
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

/** Mirror X for symmetry across the center column (see builder/Symmetry.ts). */
export function mirroredXCells(xCells: number, widthCells: number): number {
  return -(xCells + widthCells);
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
