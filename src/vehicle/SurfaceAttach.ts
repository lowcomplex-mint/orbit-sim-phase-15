/**
 * KSP-style surface attach (hull flush mates without a node pair).
 * Used by staging adjacency and the VAB snap/graph rebuild.
 */

import { GRID_EPSILON } from './AttachmentNode';
import type { PartDefinition } from './PartDefinition';
import type { PartInstance } from './PartInstance';
import { resolvePlacedPart } from './ProceduralPart';
import type { PlacedPartData } from './RocketDesign';

const DEFAULT_SURFACE_CATEGORIES = new Set(['legs', 'utility', 'clamp']);

const SURFACE_HOST_CATEGORIES = new Set([
  'tank',
  'pod',
  'engine',
  'structural',
  'decoupler',
  'nose',
  'heatshield',
]);

export function canSurfaceAttach(def: PartDefinition): boolean {
  if (def.surfaceAttach === true) return true;
  if (def.surfaceAttach === false) return false;
  return DEFAULT_SURFACE_CATEGORIES.has(def.category);
}

export function canSurfaceHost(def: PartDefinition): boolean {
  return SURFACE_HOST_CATEGORIES.has(def.category);
}

export interface AabbCells {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boxesSurfaceFlush(a: AabbCells, b: AabbCells): boolean {
  const yOverlap = a.y < b.y + b.h - GRID_EPSILON && b.y < a.y + a.h - GRID_EPSILON;
  const xOverlap = a.x < b.x + b.w - GRID_EPSILON && b.x < a.x + a.w - GRID_EPSILON;
  const eps = GRID_EPSILON * 10;
  if (yOverlap) {
    if (Math.abs(a.x + a.w - b.x) < eps) return true;
    if (Math.abs(b.x + b.w - a.x) < eps) return true;
  }
  if (xOverlap) {
    if (Math.abs(a.y + a.h - b.y) < eps) return true;
    if (Math.abs(b.y + b.h - a.y) < eps) return true;
  }
  return false;
}

export function placedPartsSurfaceAttached(
  a: PlacedPartData,
  b: PlacedPartData,
  catalog: Map<string, PartDefinition>,
): boolean {
  const ra = resolvePlacedPart(a, catalog);
  const rb = resolvePlacedPart(b, catalog);
  if (!ra || !rb) return false;
  const aSurf = canSurfaceAttach(ra.def);
  const bSurf = canSurfaceAttach(rb.def);
  if (!aSurf && !bSurf) return false;
  if (!canSurfaceHost(ra.def) && !canSurfaceHost(rb.def) && !(aSurf && bSurf)) {
    return false;
  }
  return boxesSurfaceFlush(
    { x: a.xCells, y: a.yCells, w: ra.props.widthCells, h: ra.props.heightCells },
    { x: b.xCells, y: b.yCells, w: rb.props.widthCells, h: rb.props.heightCells },
  );
}

export function instancesSurfaceAttached(a: PartInstance, b: PartInstance): boolean {
  const aSurf = canSurfaceAttach(a.def);
  const bSurf = canSurfaceAttach(b.def);
  if (!aSurf && !bSurf) return false;
  if (!canSurfaceHost(a.def) && !canSurfaceHost(b.def) && !(aSurf && bSurf)) {
    return false;
  }
  return boxesSurfaceFlush(
    { x: a.xCells, y: a.yCells, w: a.widthCells, h: a.heightCells },
    { x: b.xCells, y: b.yCells, w: b.widthCells, h: b.heightCells },
  );
}
