/**
 * Subassemblies (Phase 13) — save/load selection groups as reusable fragments.
 *
 * Built on Phase 12 expandGroupIds / parent topology, not a parallel graph.
 * Parts are stored with positions relative to the group's bounding origin;
 * placing remaps ids and inserts a detached component (same as duplicate).
 */

import type { PartDefinition } from '../vehicle/PartDefinition';
import { syncDesignGraph } from '../vehicle/PartGraph';
import {
  resolvePlacedPart,
  type PartCustomization,
} from '../vehicle/ProceduralPart';
import type { PlacedPartData, RocketDesign } from '../vehicle/RocketDesign';
import { expandGroupIds } from './GroupOps';
import { inBounds, rectsOverlap } from './GridSystem';

export interface SubassemblyPart {
  defId: string;
  /** Position relative to subassembly origin (min corner of group AABB). */
  xCells: number;
  yCells: number;
  rotationDeg?: number;
  /** Local parent index within `parts`, or null for component roots. */
  parentIndex: number | null;
  custom?: PartCustomization;
}

export interface SubassemblyData {
  version: 1;
  name: string;
  parts: SubassemblyPart[];
  /** Bounding size of the group at extraction time. */
  widthCells: number;
  heightCells: number;
}

const STORAGE_KEY = 'orbit-sim:subassemblies:v1';

function cloneCustomization(custom?: PartCustomization): PartCustomization | undefined {
  if (!custom) return undefined;
  return {
    ...custom,
    chute: custom.chute ? { ...custom.chute } : undefined,
  };
}

/** Extract the expanded selection into a portable subassembly definition. */
export function extractSubassembly(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  partIds: readonly string[],
  name: string,
): SubassemblyData | null {
  const expanded = expandGroupIds(design, partIds);
  const parts = design.parts.filter((p) => p.id && expanded.includes(p.id));
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

  const idToIndex = new Map<string, number>();
  parts.forEach((p, i) => idToIndex.set(p.id!, i));

  const payload: SubassemblyPart[] = parts.map((part) => {
    const parentIndex =
      part.parentId && idToIndex.has(part.parentId)
        ? idToIndex.get(part.parentId)!
        : null;
    return {
      defId: part.defId,
      xCells: part.xCells - minX,
      yCells: part.yCells - minY,
      rotationDeg: part.rotationDeg ?? 0,
      parentIndex,
      custom: cloneCustomization(part.custom),
    };
  });

  return {
    version: 1,
    name: name.trim() || 'Subassembly',
    parts: payload,
    widthCells: maxX - minX,
    heightCells: maxY - minY,
  };
}

function placementClear(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  candidates: { x: number; y: number; w: number; h: number }[],
): boolean {
  for (const c of candidates) {
    if (!inBounds(c.w, c.h, c.x, c.y)) return false;
    for (const other of design.parts) {
      const resolved = resolvePlacedPart(other, catalog);
      if (!resolved) continue;
      if (
        rectsOverlap(
          c.x,
          c.y,
          c.w,
          c.h,
          other.xCells,
          other.yCells,
          resolved.props.widthCells,
          resolved.props.heightCells,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Insert a subassembly at (originX, originY). Returns the new parts, or null
 * if the footprint collides / is out of bounds.
 */
export function placeSubassembly(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  data: SubassemblyData,
  originX: number,
  originY: number,
): PlacedPartData[] | null {
  if (data.version !== 1 || data.parts.length === 0) return null;

  const candidates = data.parts.map((sp) => {
    const def = catalog.get(sp.defId);
    const resolved = def
      ? resolvePlacedPart(
          { defId: sp.defId, xCells: 0, yCells: 0, custom: sp.custom },
          catalog,
        )
      : null;
    const w = resolved?.props.widthCells ?? 1;
    const h = resolved?.props.heightCells ?? 1;
    return {
      x: originX + sp.xCells,
      y: originY + sp.yCells,
      w,
      h,
    };
  });
  if (!placementClear(design, catalog, candidates)) return null;

  // Roots first so graph sync can orient the detached component.
  const order: number[] = [];
  const visited = new Set<number>();
  const roots = data.parts
    .map((_, i) => i)
    .filter((i) => data.parts[i].parentIndex === null);
  const queue = [...roots];
  while (queue.length > 0) {
    const i = queue.shift()!;
    if (visited.has(i)) continue;
    visited.add(i);
    order.push(i);
    data.parts.forEach((sp, j) => {
      if (sp.parentIndex === i) queue.push(j);
    });
  }
  data.parts.forEach((_, i) => {
    if (!visited.has(i)) order.push(i);
  });

  const copies: PlacedPartData[] = [];
  const indexToCopy = new Map<number, PlacedPartData>();
  for (const i of order) {
    const sp = data.parts[i];
    const copy = design.addPart(
      sp.defId,
      originX + sp.xCells,
      originY + sp.yCells,
      cloneCustomization(sp.custom),
      null,
    );
    copy.rotationDeg = sp.rotationDeg ?? 0;
    copies.push(copy);
    indexToCopy.set(i, copy);
  }

  syncDesignGraph(design, catalog);

  for (const i of order) {
    const sp = data.parts[i];
    const copy = indexToCopy.get(i)!;
    if (sp.parentIndex !== null && indexToCopy.has(sp.parentIndex)) {
      copy.parentId = indexToCopy.get(sp.parentIndex)!.id ?? null;
    } else {
      copy.parentId = null;
    }
  }

  return copies;
}

/** Auto-place to the right of existing craft (or origin if empty). */
export function placeSubassemblyAuto(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  data: SubassemblyData,
): PlacedPartData[] | null {
  let originX = -1;
  let originY = 0;
  if (!design.isEmpty) {
    let maxX = -Infinity;
    let minY = Infinity;
    for (const p of design.parts) {
      const r = resolvePlacedPart(p, catalog);
      if (!r) continue;
      maxX = Math.max(maxX, p.xCells + r.props.widthCells);
      minY = Math.min(minY, p.yCells);
    }
    originX = maxX + 2;
    originY = Number.isFinite(minY) ? minY : 0;
  }
  const offsets = [
    { x: 0, y: 0 },
    { x: 0, y: 2 },
    { x: 2, y: 0 },
    { x: -2, y: 0 },
    { x: 0, y: -2 },
  ];
  for (const o of offsets) {
    const placed = placeSubassembly(
      design,
      catalog,
      data,
      originX + o.x,
      originY + o.y,
    );
    if (placed) return placed;
  }
  return null;
}

// ------------------------------------------------------------- persistence --

export function loadSubassemblyLibrary(): SubassemblyData[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as SubassemblyData[];
    if (!Array.isArray(data)) return [];
    return data.filter((s) => s && s.version === 1 && Array.isArray(s.parts));
  } catch {
    return [];
  }
}

export function saveSubassemblyLibrary(list: SubassemblyData[]): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function addToSubassemblyLibrary(entry: SubassemblyData): boolean {
  const list = loadSubassemblyLibrary();
  list.push(entry);
  return saveSubassemblyLibrary(list);
}

export function removeFromSubassemblyLibrary(index: number): boolean {
  const list = loadSubassemblyLibrary();
  if (index < 0 || index >= list.length) return false;
  list.splice(index, 1);
  return saveSubassemblyLibrary(list);
}
