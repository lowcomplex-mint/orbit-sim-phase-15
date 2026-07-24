/**
 * Placement collision helpers for unrotated AABBs and rotated footprints.
 * Rotated parts use the axis-aligned bounding box of their oriented rectangle
 * (OBB → AABB) for overlap — good enough for VAB until full SAT is needed.
 */

import type { PartDefinition } from '../vehicle/PartDefinition';
import { resolvePlacedPart } from '../vehicle/ProceduralPart';
import type { PlacedPartData, RocketDesign } from '../vehicle/RocketDesign';
import { rectsOverlap } from './GridSystem';

export interface Aabb {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Axis-aligned bounds of a part's footprint after rotationDeg about center. */
export function partWorldAabb(
  placed: PlacedPartData,
  catalog: Map<string, PartDefinition>,
): Aabb | null {
  const resolved = resolvePlacedPart(placed, catalog);
  if (!resolved) return null;
  const w = resolved.props.widthCells;
  const h = resolved.props.heightCells;
  const rot = ((placed.rotationDeg ?? 0) % 360 + 360) % 360;

  // Exact for axis-aligned cardinals.
  if (rot < 1e-6 || Math.abs(rot - 360) < 1e-6) {
    return { x: placed.xCells, y: placed.yCells, w, h };
  }
  if (Math.abs(rot - 180) < 1e-6) {
    return { x: placed.xCells, y: placed.yCells, w, h };
  }
  if (Math.abs(rot - 90) < 1e-6 || Math.abs(rot - 270) < 1e-6) {
    const cx = placed.xCells + w / 2;
    const cy = placed.yCells + h / 2;
    return { x: cx - h / 2, y: cy - w / 2, w: h, h: w };
  }

  // General angle: rotate the four corners about the part center.
  const cx = placed.xCells + w / 2;
  const cy = placed.yCells + h / 2;
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    { x: placed.xCells, y: placed.yCells },
    { x: placed.xCells + w, y: placed.yCells },
    { x: placed.xCells + w, y: placed.yCells + h },
    { x: placed.xCells, y: placed.yCells + h },
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    const dx = c.x - cx;
    const dy = c.y - cy;
    const rx = cx + dx * cos - dy * sin;
    const ry = cy + dx * sin + dy * cos;
    minX = Math.min(minX, rx);
    minY = Math.min(minY, ry);
    maxX = Math.max(maxX, rx);
    maxY = Math.max(maxY, ry);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function partsWouldOverlap(
  a: PlacedPartData,
  b: PlacedPartData,
  catalog: Map<string, PartDefinition>,
): boolean {
  const aa = partWorldAabb(a, catalog);
  const bb = partWorldAabb(b, catalog);
  if (!aa || !bb) return false;
  return rectsOverlap(aa.x, aa.y, aa.w, aa.h, bb.x, bb.y, bb.w, bb.h);
}

/** Would a candidate AABB overlap any part except `ignore`? (unrotated path) */
export function overlapsAnyPartAabb(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  x: number,
  y: number,
  w: number,
  h: number,
  ignore?: PlacedPartData,
): boolean {
  for (const placed of design.parts) {
    if (placed === ignore) continue;
    const box = partWorldAabb(placed, catalog);
    if (!box) continue;
    if (rectsOverlap(x, y, w, h, box.x, box.y, box.w, box.h)) return true;
  }
  return false;
}
