import type { PartDefinition } from './PartDefinition';
import { resolvePlacedPart, type PartCustomization } from './ProceduralPart';

/**
 * A rocket design is pure data: part ids, integer grid placements, and
 * optional per-part customization. This is exactly what gets serialized to
 * JSON / localStorage.
 *
 * Format history:
 *   v1 — { defId, xCells, yCells }
 *   v2 — adds optional `custom` (procedural dimensions; Phase 3 extends it
 *        with thrustLimiter/igniteStage — additive, so v2 stays v2 and v1
 *        files load unchanged).
 */

export interface PlacedPartData {
  defId: string;
  xCells: number;
  yCells: number;
  /** Player customization (procedural dims, thrust limiter, ...). */
  custom?: PartCustomization;
}

export interface RocketDesignData {
  version: 1 | 2;
  name: string;
  parts: PlacedPartData[];
}

function clonePart(p: PlacedPartData): PlacedPartData {
  return { ...p, custom: p.custom ? { ...p.custom } : undefined };
}

export class RocketDesign {
  name: string;
  parts: PlacedPartData[];

  constructor(name = 'Untitled Rocket', parts: PlacedPartData[] = []) {
    this.name = name;
    this.parts = parts;
  }

  static fromData(data: RocketDesignData): RocketDesign {
    return new RocketDesign(data.name, data.parts.map(clonePart));
  }

  toData(): RocketDesignData {
    return {
      version: 2,
      name: this.name,
      parts: this.parts.map(clonePart),
    };
  }

  get isEmpty(): boolean {
    return this.parts.length === 0;
  }

  addPart(
    defId: string,
    xCells: number,
    yCells: number,
    custom?: PartCustomization,
  ): void {
    this.parts.push({ defId, xCells, yCells, custom: custom ? { ...custom } : undefined });
  }

  removePart(part: PlacedPartData): void {
    this.parts = this.parts.filter((p) => p !== part);
  }

  clear(): void {
    this.parts = [];
  }

  /** The placed part whose (resolved) footprint covers the given cell, if any. */
  partAtCell(
    cellX: number,
    cellY: number,
    catalog: Map<string, PartDefinition>,
  ): PlacedPartData | null {
    for (const part of this.parts) {
      const resolved = resolvePlacedPart(part, catalog);
      if (!resolved) continue;
      const { widthCells, heightCells } = resolved.props;
      const insideX = cellX >= part.xCells && cellX < part.xCells + widthCells;
      const insideY = cellY >= part.yCells && cellY < part.yCells + heightCells;
      if (insideX && insideY) return part;
    }
    return null;
  }
}
