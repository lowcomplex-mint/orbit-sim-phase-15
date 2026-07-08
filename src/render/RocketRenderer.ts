import { Container, Graphics } from 'pixi.js';
import { GRID_CELL_METERS } from '../config/constants';
import type { PartDefinition } from '../vehicle/PartDefinition';
import type { PartInstance } from '../vehicle/PartInstance';

/**
 * Placeholder part art: colored rectangles with a category-specific accent.
 * Local origin is the part's bottom-left corner; units are meters.
 * Dimensions come from the caller (resolved per instance), never from the
 * definition, so procedural parts render at their actual size. `variant`
 * selects nose-cone shapes.
 */
export function buildPartGraphic(
  def: PartDefinition,
  widthCells: number,
  heightCells: number,
  variant?: string,
): Graphics {
  const cell = GRID_CELL_METERS;
  const w = widthCells * cell;
  const h = heightCells * cell;
  const g = new Graphics();
  const outline = { width: 0.05, color: 0x0c111d, alpha: 0.9 };

  switch (def.category) {
    case 'pod':
      // Tapered capsule with a window.
      g.poly([0, 0, w, 0, w * 0.78, h, w * 0.22, h]).fill(def.color).stroke(outline);
      g.circle(w / 2, h * 0.42, Math.min(w, h) * 0.16).fill(0x2f6fb3);
      break;
    case 'engine': {
      // Mount block on top, flared nozzle below.
      g.rect(w * 0.15, h * 0.55, w * 0.7, h * 0.45).fill(def.color).stroke(outline);
      g.poly([w * 0.3, h * 0.55, w * 0.7, h * 0.55, w * 0.92, 0, w * 0.08, 0])
        .fill(0x525a66)
        .stroke(outline);
      break;
    }
    case 'decoupler':
      g.rect(0, 0, w, h).fill(def.color).stroke(outline);
      if (w >= h) {
        g.rect(0, h * 0.38, w, h * 0.24).fill(0x1a1f2b); // stack: horizontal band
      } else {
        g.rect(w * 0.38, 0, w * 0.24, h).fill(0x1a1f2b); // radial: vertical band
      }
      break;
    case 'nose':
      if (variant === 'blunt') {
        g.poly([0, 0, w, 0, w * 0.8, h * 0.85, w * 0.2, h * 0.85]).fill(def.color).stroke(outline);
      } else if (variant === 'rounded') {
        // Approximate dome: sampled semi-ellipse.
        const pts: number[] = [0, 0];
        for (let i = 0; i <= 8; i++) {
          const a = (i / 8) * Math.PI;
          pts.push(w / 2 - (Math.cos(a) * w) / 2, Math.sin(a) * h * 0.95);
        }
        pts.push(w, 0);
        g.poly(pts).fill(def.color).stroke(outline);
      } else {
        g.poly([0, 0, w, 0, w / 2, h]).fill(def.color).stroke(outline);
      }
      break;
    case 'structural': {
      // Engine plate: slab with a mount dot every 2 cells.
      g.rect(0, 0, w, h).fill(def.color).stroke(outline);
      for (let x = 1; x < widthCells; x += 2) {
        g.circle(x * cell, h * 0.5, Math.min(0.12, h * 0.3)).fill(0x2a3550);
      }
      break;
    }
    case 'tank':
      g.rect(0, 0, w, h).fill(def.color).stroke(outline);
      g.rect(w * 0.12, h * 0.12, w * 0.2, h * 0.76).fill({ color: 0xffffff, alpha: 0.18 });
      break;
    default:
      g.rect(0, 0, w, h).fill(def.color).stroke(outline);
      break;
  }
  return g;
}

/** Where a stack display's local origin sits, in grid coordinates. */
export interface StackOrigin {
  /** Grid-vertex x of the stack center column (bottom part's center). */
  xCells: number;
  /** Grid y of the lowest part. */
  yCells: number;
}

export function computeStackOrigin(parts: PartInstance[]): StackOrigin {
  let bottom = parts[0];
  for (const p of parts) {
    if (p.yCells < bottom.yCells) bottom = p;
  }
  return {
    xCells: bottom.xCells + bottom.widthCells / 2,
    yCells: bottom.yCells,
  };
}

/**
 * Builds the flight display of a part stack. Local origin = bottom-center of
 * the stack (matching RocketRuntime.position); local +Y = rocket forward.
 */
export function buildStackDisplay(parts: PartInstance[], origin: StackOrigin): Container {
  const cell = GRID_CELL_METERS;
  const container = new Container();
  for (const part of parts) {
    const g = buildPartGraphic(part.def, part.widthCells, part.heightCells, part.custom?.variant);
    g.position.set(
      (part.xCells - origin.xCells) * cell,
      (part.yCells - origin.yCells) * cell,
    );
    container.addChild(g);
  }
  return container;
}
