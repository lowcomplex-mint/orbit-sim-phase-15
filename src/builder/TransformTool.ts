import { inBounds } from './GridSystem';
import type { PartDefinition } from '../vehicle/PartDefinition';
import { resolvePlacedPart } from '../vehicle/ProceduralPart';
import { removeEdgesForPart } from '../vehicle/PartGraph';
import {
  applySubtreeTranslation,
  subtreeParts,
} from '../vehicle/PartTree';
import { RocketDesign, type PlacedPartData } from '../vehicle/RocketDesign';
import { partsWouldOverlap } from './Collision';
import { tryRotateSubtreeV2 } from './RotateOps';

function designFits(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  ignore?: PlacedPartData,
): boolean {
  for (const p of design.parts) {
    const resolved = resolvePlacedPart(p, catalog);
    if (!resolved) continue;
    const { widthCells, heightCells } = resolved.props;
    if (!inBounds(widthCells, heightCells, p.xCells, p.yCells)) return false;
  }
  for (let i = 0; i < design.parts.length; i++) {
    for (let j = i + 1; j < design.parts.length; j++) {
      const a = design.parts[i];
      const b = design.parts[j];
      if (ignore && (a === ignore || b === ignore)) continue;
      if (partsWouldOverlap(a, b, catalog)) return false;
    }
  }
  return true;
}

/** Translate a subtree if the result stays in bounds and overlap-free. */
export function tryTranslateSubtree(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  rootId: string,
  dxCells: number,
  dyCells: number,
): boolean {
  if (dxCells === 0 && dyCells === 0) return true;
  const members = subtreeParts(design, rootId);
  const snapshots = members.map((p) => ({ p, x: p.xCells, y: p.yCells }));
  applySubtreeTranslation(members, dxCells, dyCells);
  if (!designFits(design, catalog)) {
    for (const s of snapshots) {
      s.p.xCells = s.x;
      s.p.yCells = s.y;
    }
    return false;
  }
  return true;
}

/** Rotate a subtree (Phase 13 pivot rules). Optional stepDeg for radial quantization. */
export function tryRotateSubtree(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  rootId: string,
  deltaDeg: number,
  stepDeg = 15,
): boolean {
  return tryRotateSubtreeV2(design, catalog, rootId, deltaDeg, stepDeg);
}

export function removeSubtree(design: RocketDesign, rootId: string): void {
  const ids = new Set(subtreeParts(design, rootId).map((p) => p.id));
  for (const id of ids) {
    if (id) design.edges = removeEdgesForPart(design.edges, id);
  }
  design.parts = design.parts.filter((p) => !ids.has(p.id));
  if (design.rootPartId && ids.has(design.rootPartId)) {
    design.rootPartId = design.parts[0]?.id ?? null;
  }
  for (const p of design.parts) {
    if (p.parentId && ids.has(p.parentId)) p.parentId = design.rootPartId ?? null;
  }
}

export function attachParentOnSnap(
  design: RocketDesign,
  placed: PlacedPartData,
  parentId: string | null,
): void {
  placed.parentId = parentId;
  if (!design.rootPartId) design.rootPartId = placed.id ?? null;
  if (parentId === null && placed.id) design.rootPartId = placed.id;
}