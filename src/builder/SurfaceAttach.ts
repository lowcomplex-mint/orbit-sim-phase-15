/**
 * VAB surface-snap candidates (placement). Geometry/connectivity rules live in
 * vehicle/SurfaceAttach.ts.
 */

import { BUILDER, GRID_CELL_METERS } from '../config/constants';
import type { Vec2 } from '../math/Vec2';
import type { PartDefinition } from '../vehicle/PartDefinition';
import type { MountKind } from '../vehicle/PartGraph';
import {
  boxesSurfaceFlush,
  canSurfaceAttach,
  canSurfaceHost,
} from '../vehicle/SurfaceAttach';
import { resolvePlacedPart, type ResolvedPartProps } from '../vehicle/ProceduralPart';
import type { RocketDesign } from '../vehicle/RocketDesign';
import { snapValue } from './PlacementGrid';
import { inBounds, overlapsAnyPart } from './GridSystem';

export {
  canSurfaceAttach,
  canSurfaceHost,
  placedPartsSurfaceAttached,
  instancesSurfaceAttached,
} from '../vehicle/SurfaceAttach';

export interface SurfaceSnapCandidate {
  xCells: number;
  yCells: number;
  distSq: number;
  parentId: string | null;
  mountKind: MountKind;
}

export function findSurfaceSnapCandidates(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
  props: ResolvedPartProps,
  def: PartDefinition,
  pointerWorld: Vec2,
  snapStep: number,
): SurfaceSnapCandidate[] {
  if (!canSurfaceAttach(def)) return [];
  const { widthCells, heightCells } = props;
  const cell = GRID_CELL_METERS;
  const snapRadiusSq = (BUILDER.snapRadiusCells * cell) ** 2;
  const px = pointerWorld.x / cell;
  const py = pointerWorld.y / cell;
  const out: SurfaceSnapCandidate[] = [];

  for (const host of design.parts) {
    const resolved = resolvePlacedPart(host, catalog);
    if (!resolved || !canSurfaceHost(resolved.def)) continue;
    const hw = resolved.props.widthCells;
    const hh = resolved.props.heightCells;
    const hx = host.xCells;
    const hy = host.yCells;
    const hostCx = hx + hw / 2;
    const sides: Array<'left' | 'right'> =
      px < hostCx ? ['left', 'right'] : ['right', 'left'];

    for (const side of sides) {
      const xCells = side === 'left' ? hx - widthCells : hx + hw;
      let yCells = snapValue(py - heightCells / 2, snapStep);
      const minY = hy - heightCells + snapStep;
      const maxY = hy + hh - snapStep;
      yCells = Math.min(maxY, Math.max(minY, yCells));
      yCells = snapValue(yCells, snapStep);

      if (!inBounds(widthCells, heightCells, xCells, yCells)) continue;
      if (overlapsAnyPart(design, catalog, widthCells, heightCells, xCells, yCells)) {
        continue;
      }

      const child = { x: xCells, y: yCells, w: widthCells, h: heightCells };
      const hostBox = { x: hx, y: hy, w: hw, h: hh };
      if (!boxesSurfaceFlush(child, hostBox)) continue;

      const centerX = (xCells + widthCells / 2) * cell;
      const centerY = (yCells + heightCells / 2) * cell;
      const distSq =
        (centerX - pointerWorld.x) ** 2 + (centerY - pointerWorld.y) ** 2;
      if (distSq > snapRadiusSq) continue;

      out.push({
        xCells,
        yCells,
        distSq,
        parentId: host.id ?? null,
        mountKind: 'radial',
      });
    }
  }

  out.sort((a, b) => a.distSq - b.distSq);
  return out;
}
