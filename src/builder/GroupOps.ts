import type { PartDefinition } from '../vehicle/PartDefinition';
import { syncDesignGraph } from '../vehicle/PartGraph';
import {
  resolvePlacedPart,
  type PartCustomization,
} from '../vehicle/ProceduralPart';
import type { PlacedPartData, RocketDesign } from '../vehicle/RocketDesign';
import { partById, subtreeIds } from '../vehicle/PartTree';
import { inBounds, rectsOverlap } from './GridSystem';

/**
 * Graph-safe, design-level transforms for Phase 12 multi-selection.
 *
 * Every successful mutation rebuilds the Phase 11 edge list and derived tree.
 * This is important for arbitrary selections: moving a group can deliberately
 * detach it from the main craft, while internal node connections must remain
 * truthful. BuilderScene still routes the mutation through designChanged(),
 * so undo/redo and engineering panels stay in sync too.
 */

function cloneCustomization(custom?: PartCustomization): PartCustomization | undefined {
  if (!custom) return undefined;
  return {
    ...custom,
    chute: custom.chute ? { ...custom.chute } : undefined,
  };
}

function groupParts(design: RocketDesign, partIds: readonly string[]): PlacedPartData[] {
  const wanted = new Set(partIds);
  return design.parts.filter((part) => part.id && wanted.has(part.id));
}

/**
 * Normalize selected ids to the union of their subtrees. If both an ancestor
 * and descendant are selected, the descendant is processed only once. This
 * prevents group delete/move from silently stranding unselected children.
 */
export function expandGroupIds(
  design: RocketDesign,
  selectedIds: readonly string[],
): string[] {
  const selected = new Set(
    selectedIds.filter((id) => Boolean(partById(design, id))),
  );
  const roots = [...selected].filter((id) => {
    let parentId = partById(design, id)?.parentId ?? null;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return false;
      visited.add(parentId);
      parentId = partById(design, parentId)?.parentId ?? null;
    }
    return true;
  });

  const expanded = new Set<string>();
  for (const rootId of roots) {
    expanded.add(rootId);
    for (const childId of subtreeIds(design, rootId)) expanded.add(childId);
  }
  // Preserve design order for deterministic cloning, logs, and tests.
  return design.parts
    .map((part) => part.id)
    .filter((id): id is string => Boolean(id && expanded.has(id)));
}

function placementValid(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  candidates: readonly PlacedPartData[],
  excluded: ReadonlySet<PlacedPartData>,
): boolean {
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    const resolved = resolvePlacedPart(candidate, catalog);
    if (!resolved) return false;
    const { widthCells: width, heightCells: height } = resolved.props;
    if (!inBounds(width, height, candidate.xCells, candidate.yCells)) return false;

    for (const other of design.parts) {
      if (excluded.has(other)) continue;
      const otherResolved = resolvePlacedPart(other, catalog);
      if (!otherResolved) continue;
      if (
        rectsOverlap(
          candidate.xCells,
          candidate.yCells,
          width,
          height,
          other.xCells,
          other.yCells,
          otherResolved.props.widthCells,
          otherResolved.props.heightCells,
        )
      ) {
        return false;
      }
    }

    // Rigid transforms preserve a valid group's internal spacing, but this
    // check also keeps the helper safe for malformed/imported designs.
    for (let otherIndex = index + 1; otherIndex < candidates.length; otherIndex++) {
      const other = candidates[otherIndex];
      const otherResolved = resolvePlacedPart(other, catalog);
      if (!otherResolved) return false;
      if (
        rectsOverlap(
          candidate.xCells,
          candidate.yCells,
          width,
          height,
          other.xCells,
          other.yCells,
          otherResolved.props.widthCells,
          otherResolved.props.heightCells,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function translatedCandidates(
  parts: readonly PlacedPartData[],
  dxCells: number,
  dyCells: number,
): PlacedPartData[] {
  return parts.map((part) => ({
    ...part,
    xCells: part.xCells + dxCells,
    yCells: part.yCells + dyCells,
  }));
}

/** Test a rigid group translation without mutating the design. */
export function canMoveGroup(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  partIds: readonly string[],
  dxCells: number,
  dyCells: number,
): boolean {
  const expandedIds = expandGroupIds(design, partIds);
  const parts = groupParts(design, expandedIds);
  if (parts.length === 0) return false;
  if (dxCells === 0 && dyCells === 0) return true;
  return placementValid(
    design,
    catalog,
    translatedCandidates(parts, dxCells, dyCells),
    new Set(parts),
  );
}

/** Rigidly translate a selected group. False means no mutation occurred. */
export function moveGroup(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  partIds: readonly string[],
  dxCells: number,
  dyCells: number,
): boolean {
  const expandedIds = expandGroupIds(design, partIds);
  if ((dxCells === 0 && dyCells === 0) || !canMoveGroup(
    design,
    catalog,
    partIds,
    dxCells,
    dyCells,
  )) {
    return false;
  }
  for (const part of groupParts(design, expandedIds)) {
    part.xCells += dxCells;
    part.yCells += dyCells;
  }
  syncDesignGraph(design, catalog);
  return true;
}

/**
 * Duplicate a group beside the original, trying right, left, above, then
 * below. Copies receive fresh stable ids and preserve internal geometry;
 * graph sync rediscovers their internal edges while leaving them detached
 * from the source until the player moves them onto a valid mount.
 */
export function duplicateGroup(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  partIds: readonly string[],
): PlacedPartData[] | null {
  const expandedIds = expandGroupIds(design, partIds);
  const parts = groupParts(design, expandedIds);
  if (parts.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const part of parts) {
    const resolved = resolvePlacedPart(part, catalog);
    if (!resolved) return null;
    minX = Math.min(minX, part.xCells);
    minY = Math.min(minY, part.yCells);
    maxX = Math.max(maxX, part.xCells + resolved.props.widthCells);
    maxY = Math.max(maxY, part.yCells + resolved.props.heightCells);
  }

  const gap = 2;
  const width = maxX - minX;
  const height = maxY - minY;
  const offsets = [
    { x: width + gap, y: 0 },
    { x: -(width + gap), y: 0 },
    { x: 0, y: height + gap },
    { x: 0, y: -(height + gap) },
  ];

  const offset = offsets.find(({ x, y }) =>
    placementValid(
      design,
      catalog,
      translatedCandidates(parts, x, y),
      new Set(),
    ),
  );
  if (!offset) return null;

  // Append every source-tree root before its descendants. Detached component
  // trees are derived from the first part encountered in design order, so
  // this preserves the source root across this and every later graph sync.
  const sourceIds = new Set(parts.map((part) => part.id!));
  const roots = parts.filter(
    (part) => !part.parentId || !sourceIds.has(part.parentId),
  );
  const orderedSources: PlacedPartData[] = [];
  const queued = [...roots];
  const visited = new Set<string>();
  while (queued.length > 0) {
    const source = queued.shift()!;
    if (!source.id || visited.has(source.id)) continue;
    visited.add(source.id);
    orderedSources.push(source);
    queued.push(...parts.filter((candidate) => candidate.parentId === source.id));
  }
  // Imported malformed trees can contain orphans/cycles. Keep duplication
  // lossless and deterministic even when no valid tree walk reaches them.
  for (const source of parts) {
    if (source.id && !visited.has(source.id)) orderedSources.push(source);
  }

  const sourceByCopy = new Map<PlacedPartData, PlacedPartData>();
  const copyBySourceId = new Map<string, PlacedPartData>();
  const copies = orderedSources.map((source) => {
    const copy = design.addPart(
      source.defId,
      source.xCells + offset.x,
      source.yCells + offset.y,
      cloneCustomization(source.custom),
      null,
    );
    copy.rotationDeg = source.rotationDeg ?? 0;
    sourceByCopy.set(copy, source);
    copyBySourceId.set(source.id!, copy);
    return copy;
  });
  syncDesignGraph(design, catalog);

  // Reapply the exact source parent topology after edge discovery. For a
  // normal tree this matches the derived result; doing it explicitly also
  // preserves a valid spanning tree when the geometric graph has a cycle.
  for (const copy of copies) {
    const source = sourceByCopy.get(copy)!;
    copy.parentId = source.parentId && sourceIds.has(source.parentId)
      ? copyBySourceId.get(source.parentId)?.id ?? null
      : null;
  }
  return copies;
}

/** Delete selected parts and repair root/edges/tree. Returns the count removed. */
export function deleteGroup(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  partIds: readonly string[],
): number {
  const doomed = new Set(expandGroupIds(design, partIds));
  const before = design.parts.length;
  design.parts = design.parts.filter((part) => !part.id || !doomed.has(part.id));
  const removed = before - design.parts.length;
  if (removed === 0) return 0;

  if (design.parts.length === 0) {
    design.rootPartId = null;
    design.edges = [];
  } else {
    if (design.rootPartId && doomed.has(design.rootPartId)) design.rootPartId = null;
    syncDesignGraph(design, catalog);
  }
  return removed;
}
