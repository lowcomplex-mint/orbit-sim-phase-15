import type { PartDefinition } from './PartDefinition';
import { resolvePlacedPart, type PartCustomization } from './ProceduralPart';
import type { AttachmentEdge } from './PartGraph';
import { syncDesignGraph } from './PartGraph';
import { ensurePartIds, newPartId } from './PartTree';
import type { PartInstance } from './PartInstance';

/**
 * Rocket design data: placements, optional tree (Phase 9), customization.
 *
 * Format history:
 *   v1 — { defId, xCells, yCells }
 *   v2 — optional `custom`
 *   v2+ — optional `id`, `parentId`, `rootPartId`, `rotationDeg` (additive)
 */

export interface PlacedPartData {
  /** Stable part identity within a design (Phase 9 tree). */
  id?: string;
  defId: string;
  xCells: number;
  yCells: number;
  /** Parent in the attachment tree; null = design root. */
  parentId?: string | null;
  /** CCW rotation in degrees; default 0. */
  rotationDeg?: number;
  custom?: PartCustomization;
}

export interface RocketDesignData {
  version: 1 | 2;
  name: string;
  rootPartId?: string;
  /** Explicit attachment edges (Phase 11); rebuilt from geometry if absent. */
  edges?: AttachmentEdge[];
  parts: PlacedPartData[];
}

function clonePart(p: PlacedPartData): PlacedPartData {
  return {
    ...p,
    custom: p.custom ? { ...p.custom } : undefined,
  };
}

export class RocketDesign {
  name: string;
  parts: PlacedPartData[];
  rootPartId: string | null;
  edges: AttachmentEdge[];

  constructor(
    name = 'Untitled Rocket',
    parts: PlacedPartData[] = [],
    rootPartId: string | null = null,
    edges: AttachmentEdge[] = [],
  ) {
    this.name = name;
    this.parts = parts;
    this.rootPartId = rootPartId;
    this.edges = edges;
  }

  static fromData(data: RocketDesignData): RocketDesign {
    const design = new RocketDesign(
      data.name,
      data.parts.map(clonePart),
      data.rootPartId ?? null,
      data.edges ? data.edges.map((e) => ({ ...e })) : [],
    );
    ensurePartIds(design);
    return design;
  }

  /** Sync edge list + derived tree (called from builder/analysis). */
  ensureTree(catalog: Map<string, PartDefinition>, instances?: PartInstance[]): void {
    syncDesignGraph(this, catalog, instances);
  }

  toData(): RocketDesignData {
    ensurePartIds(this);
    return {
      version: 2,
      name: this.name,
      rootPartId: this.rootPartId ?? undefined,
      edges: this.edges.length > 0 ? this.edges.map((e) => ({ ...e })) : undefined,
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
    parentId: string | null = null,
  ): PlacedPartData {
    const id = newPartId(this.parts);
    const part: PlacedPartData = {
      id,
      defId,
      xCells,
      yCells,
      parentId,
      rotationDeg: 0,
      custom: custom ? { ...custom } : undefined,
    };
    this.parts.push(part);
    if (!this.rootPartId) {
      this.rootPartId = id;
      part.parentId = null;
    }
    return part;
  }

  removePart(part: PlacedPartData): void {
    this.parts = this.parts.filter((p) => p !== part);
    if (part.id) {
      this.edges = this.edges.filter((e) => e.partAId !== part.id && e.partBId !== part.id);
    }
    if (part.id === this.rootPartId) {
      this.rootPartId = this.parts[0]?.id ?? null;
    }
    for (const p of this.parts) {
      if (p.parentId === part.id) p.parentId = this.rootPartId;
    }
  }

  clear(): void {
    this.parts = [];
    this.rootPartId = null;
    this.edges = [];
  }

  partAtCell(
    cellX: number,
    cellY: number,
    catalog: Map<string, PartDefinition>,
  ): PlacedPartData | null {
    return this.partAtGrid(cellX + 0.5, cellY + 0.5, catalog);
  }

  partAtGrid(
    gridX: number,
    gridY: number,
    catalog: Map<string, PartDefinition>,
  ): PlacedPartData | null {
    for (const part of this.parts) {
      const resolved = resolvePlacedPart(part, catalog);
      if (!resolved) continue;
      const { widthCells, heightCells } = resolved.props;
      const rot = part.rotationDeg ?? 0;
      if (rot === 0) {
        const insideX = gridX >= part.xCells && gridX < part.xCells + widthCells;
        const insideY = gridY >= part.yCells && gridY < part.yCells + heightCells;
        if (insideX && insideY) return part;
      } else {
        const cx = part.xCells + widthCells / 2;
        const cy = part.yCells + heightCells / 2;
        const dx = gridX - cx;
        const dy = gridY - cy;
        const rad = (-rot * Math.PI) / 180;
        const lx = dx * Math.cos(rad) - dy * Math.sin(rad) + widthCells / 2;
        const ly = dx * Math.sin(rad) + dy * Math.cos(rad) + heightCells / 2;
        if (lx >= 0 && lx < widthCells && ly >= 0 && ly < heightCells) return part;
      }
    }
    return null;
  }
}