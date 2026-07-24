import { Container, Graphics } from 'pixi.js';
import { GRID_CELL_METERS } from '../config/constants';
import { legPose, poseInPartLocal, stackCoreCenterXCells } from '../vehicle/LandingLegs';
import type { LegState } from '../vehicle/ProceduralPart';
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
  legState: LegState = 'stowed',
  legPosePart?: ReturnType<typeof poseInPartLocal>,
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
    case 'parachute':
      // Pointed canopy for aerodynamics; local +Y is up.
      g.poly([w / 2, h, 0, 0, w, 0]).fill(def.color).stroke(outline);
      g.poly([w / 2, h * 0.72, w * 0.22, h * 0.18, w * 0.78, h * 0.18]).fill(0xf5ecec);
      break;
    case 'legs': {
      const strut = 0x5c5348;
      const piston = 0x6e655c;
      const footCol = 0x4a4038;
      const outwardSign = legPosePart?.outwardSign ?? -1;
      const housingH = h * 0.42;

      g.rect(0, 0, w, housingH).fill(def.color).stroke(outline);
      g.rect(
        outwardSign < 0 ? 0 : w * 0.12,
        housingH * 0.12,
        w * 0.55,
        housingH * 0.72,
      ).fill(0x72685e);

      const hinge = legPosePart?.hinge ?? { x: outwardSign < 0 ? w : 0, y: housingH * 0.5 };

      if (legState === 'stowed') {
        const tip = legPosePart?.stowedTip ?? { x: outwardSign < 0 ? w * 0.1 : w * 0.9, y: h * 0.94 };
        g.moveTo(hinge.x, hinge.y).lineTo(tip.x, tip.y).stroke({ width: 0.08, color: strut });
        g.rect(tip.x - w * 0.07, tip.y - h * 0.1, w * 0.14, h * 0.08).fill(piston);
      } else if (legPosePart?.knee && legPosePart.foot) {
        const knee = legPosePart.knee;
        const foot = legPosePart.foot;
        if (legState === 'broken') {
          g.poly([hinge.x, hinge.y, knee.x, knee.y, foot.x, foot.y]).fill(strut).stroke(outline);
        } else {
          g.moveTo(hinge.x, hinge.y).lineTo(knee.x, knee.y).stroke({ width: 0.08, color: strut });
          g.circle(knee.x, knee.y, w * 0.07).fill(piston);
          g.moveTo(knee.x, knee.y).lineTo(foot.x, foot.y).stroke({ width: 0.07, color: piston });
          g.rect(foot.x - w * 0.2, foot.y - h * 0.03, w * 0.4, h * 0.06).fill(footCol);
          g.circle(foot.x, foot.y, w * 0.14).fill(footCol).stroke(outline);
        }
      } else {
        const dirX = outwardSign * w * 0.4;
        g.moveTo(hinge.x, hinge.y)
          .lineTo(hinge.x + dirX, -h * 0.35)
          .lineTo(hinge.x + dirX * 1.5, -h * 0.9)
          .stroke({ width: 0.08, color: strut });
        g.circle(hinge.x + dirX * 1.5, -h * 0.9, w * 0.1).fill(footCol).stroke(outline);
      }
      break;
    }
    case 'utility':
      if (def.electricGenPerSec) {
        g.rect(0, 0, w, h).fill(def.color).stroke(outline);
        g.rect(w * 0.08, h * 0.12, w * 0.84, h * 0.76).fill(0x3a5f8a);
        g.rect(w * 0.2, h * 0.22, w * 0.6, h * 0.12).fill({ color: 0xa8c4e8, alpha: 0.55 });
      } else {
        g.rect(0, 0, w, h).fill(def.color).stroke(outline);
        g.rect(w * 0.62, h * 0.22, w * 0.22, h * 0.56).fill(0x9ed4b6);
      }
      break;
    case 'clamp': {
      // Tower base + vertical post + horizontal umbilical (width = reach).
      const postW = Math.min(w * 0.35, 0.22);
      const armH = Math.min(h * 0.18, 0.2);
      const armY = h * 0.72;
      g.rect(0, 0, w, h * 0.12).fill(0x3a424c).stroke(outline);
      g.rect((w - postW) / 2, 0, postW, h).fill(def.color).stroke(outline);
      g.rect(0, armY, w, armH).fill(0x7a8694).stroke(outline);
      g.circle(0, armY + armH / 2, armH * 0.45).fill(0xc4a35a);
      g.circle(w, armY + armH / 2, armH * 0.45).fill(0xc4a35a);
      break;
    }
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
  // Geometric base for rocket.position is still the lowest part; core column
  // for leg outward signs is computed separately in buildStackDisplay.
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
  const baseXM = origin.xCells * cell;
  const baseYM = origin.yCells * cell;
  const coreCenterX = stackCoreCenterXCells(
    parts.map((p) => ({
      xCells: p.xCells,
      widthCells: p.widthCells,
      category: p.def.category,
    })),
  );
  const container = new Container();
  for (const part of parts) {
    const w = part.widthCells * cell;
    const h = part.heightCells * cell;
    const legPosePart =
      part.def.category === 'legs'
        ? poseInPartLocal(
            legPose(part, part.legState, baseXM, baseYM, coreCenterX),
            part,
            baseXM,
            baseYM,
          )
        : undefined;
    const g = buildPartGraphic(
      part.def,
      part.widthCells,
      part.heightCells,
      part.custom?.variant,
      part.def.category === 'legs' ? part.legState : 'stowed',
      legPosePart,
    );
    const px = (part.xCells - origin.xCells) * cell;
    const py = (part.yCells - origin.yCells) * cell;
    if (part.rotationDeg !== 0) {
      g.pivot.set(w / 2, h / 2);
      g.position.set(px + w / 2, py + h / 2);
      g.rotation = (part.rotationDeg * Math.PI) / 180;
    } else {
      g.position.set(px, py);
    }
    container.addChild(g);
  }
  return container;
}
