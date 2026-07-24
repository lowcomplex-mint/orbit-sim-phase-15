import { GRID_CELL_METERS } from '../config/constants';
import type { PartInstance } from './PartInstance';
import type { LegState } from './ProceduralPart';

/** LT-2-style single radial strut geometry (shared by render + physics). */

export interface LegPose {
  /** Hull-facing hinge, meters in stack-local frame (relative to rocket.position). */
  hingeXM: number;
  hingeYM: number;
  /** Outward from the core column: -1 = left flank, +1 = right flank. */
  outwardSign: number;
  /** Stowed tip (strut tucked upward along the hull), stack-local meters. */
  stowedTipXM: number;
  stowedTipYM: number;
  /** Deployed knee / piston joint; null when stowed. */
  kneeXM: number | null;
  kneeYM: number | null;
  /** Deployed foot contact; null when stowed or broken-without-contact. */
  footXM: number | null;
  footYM: number | null;
}

/** engine-mule / engine-wisp stack height (2 cells). */
const ENGINE_REF_HEIGHT_M = 2 * GRID_CELL_METERS;

const DEPLOY_OUTWARD_DEG = 32;
/**
 * Hinge-to-foot deployed length. Tuned ~30% over the 2-cell engine height,
 * with a slight bump over the prior 1.7 m reach.
 */
const TOTAL_DEPLOY_REACH_M = ENGINE_REF_HEIGHT_M * 1.82;
const UPPER_ARM_M = TOTAL_DEPLOY_REACH_M * 0.36;
const PISTON_REACH_M = TOTAL_DEPLOY_REACH_M * 0.64;
const BROKEN_REACH_FRAC = 0.42;
/** Stowed strut runs slightly above the housing top (tucked along the hull). */
const STOWED_TIP_FRAC = 1.04;

/**
 * Core column X for left/right flank tests. Ignores surface-mounted parts
 * (legs, clamps, batteries, solar, chutes) so a pad clamp on the left does
 * not become the "stack center" and flip both struts the same way.
 */
export function stackCoreCenterXCells(
  parts: ReadonlyArray<{ xCells: number; widthCells: number; category: string }>,
): number {
  let sum = 0;
  let n = 0;
  for (const p of parts) {
    const cat = p.category;
    if (
      cat === 'legs' ||
      cat === 'clamp' ||
      cat === 'utility' ||
      cat === 'parachute'
    ) {
      continue;
    }
    sum += p.xCells + p.widthCells / 2;
    n++;
  }
  if (n > 0) return sum / n;
  for (const p of parts) {
    sum += p.xCells + p.widthCells / 2;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/** Which flank this leg sits on (by center column vs stack core). */
export function legOutwardSign(part: PartInstance, stackCenterXCells: number): number {
  const cx = part.xCells + part.widthCells / 2;
  return cx < stackCenterXCells - 1e-6 ? -1 : 1;
}

/** Hull-facing attachment vertex in absolute grid meters. */
function hullMountVertexM(
  part: PartInstance,
  outwardSign: number,
): { xM: number; yM: number } {
  const cell = GRID_CELL_METERS;
  const mountKind = outwardSign < 0 ? 'right' : 'left';
  const node = part.worldNodes().find((n) => n.kind === mountKind) ?? part.worldNodes()[0];
  return { xM: node.xCells * cell, yM: node.yCells * cell };
}

function toStackLocal(
  xM: number,
  yM: number,
  baseXM: number,
  baseYM: number,
): { x: number; y: number } {
  return { x: xM - baseXM, y: yM - baseYM };
}

function deployDir(outwardSign: number): { x: number; y: number } {
  const rad = (DEPLOY_OUTWARD_DEG * Math.PI) / 180;
  const x = outwardSign * Math.sin(rad);
  const y = -Math.cos(rad);
  const len = Math.hypot(x, y);
  return { x: x / len, y: y / len };
}

/**
 * Full leg pose for one `legs-1` instance. Coordinates are stack-local meters
 * relative to `rocket.position` (bottom-center of the lowest stack part).
 */
export function legPose(
  part: PartInstance,
  legState: LegState,
  baseXM: number,
  baseYM: number,
  stackCenterXCells: number,
): LegPose {
  const cell = GRID_CELL_METERS;
  const w = part.widthCells * cell;
  const h = part.heightCells * cell;
  const outwardSign = legOutwardSign(part, stackCenterXCells);
  const mount = hullMountVertexM(part, outwardSign);
  const hinge = toStackLocal(mount.xM, mount.yM, baseXM, baseYM);

  const outerEdgeX = outwardSign < 0 ? part.xCells * cell - baseXM : (part.xCells + part.widthCells) * cell - baseXM;
  const stowedTip = {
    x: outerEdgeX + outwardSign * w * 0.08,
    y: (part.yCells + h * STOWED_TIP_FRAC) * cell - baseYM,
  };

  if (legState === 'stowed') {
    return {
      hingeXM: hinge.x,
      hingeYM: hinge.y,
      outwardSign,
      stowedTipXM: stowedTip.x,
      stowedTipYM: stowedTip.y,
      kneeXM: null,
      kneeYM: null,
      footXM: null,
      footYM: null,
    };
  }

  const dir = deployDir(outwardSign);
  const reach =
    legState === 'broken' ? TOTAL_DEPLOY_REACH_M * BROKEN_REACH_FRAC : TOTAL_DEPLOY_REACH_M;
  const upper = legState === 'broken' ? UPPER_ARM_M * 0.55 : UPPER_ARM_M;
  const piston = legState === 'broken' ? reach - upper : PISTON_REACH_M;
  const knee = { x: hinge.x + dir.x * upper, y: hinge.y + dir.y * upper };
  const foot = { x: knee.x + dir.x * piston, y: knee.y + dir.y * piston };

  return {
    hingeXM: hinge.x,
    hingeYM: hinge.y,
    outwardSign,
    stowedTipXM: stowedTip.x,
    stowedTipYM: stowedTip.y,
    kneeXM: knee.x,
    kneeYM: knee.y,
    footXM: foot.x,
    footYM: foot.y,
  };
}

/** Convert a stack-local pose into part-local meters (graphic origin = bottom-left). */
export function poseInPartLocal(
  pose: LegPose,
  part: PartInstance,
  baseXM: number,
  baseYM: number,
): {
  outwardSign: number;
  hinge: { x: number; y: number };
  stowedTip: { x: number; y: number };
  knee: { x: number; y: number } | null;
  foot: { x: number; y: number } | null;
} {
  const cell = GRID_CELL_METERS;
  const ox = part.xCells * cell - baseXM;
  const oy = part.yCells * cell - baseYM;
  const map = (x: number, y: number) => ({ x: x - ox, y: y - oy });
  return {
    outwardSign: pose.outwardSign,
    hinge: map(pose.hingeXM, pose.hingeYM),
    stowedTip: map(pose.stowedTipXM, pose.stowedTipYM),
    knee: pose.kneeXM !== null && pose.kneeYM !== null ? map(pose.kneeXM, pose.kneeYM) : null,
    foot: pose.footXM !== null && pose.footYM !== null ? map(pose.footXM, pose.footYM) : null,
  };
}

/** Ground contact samples for one leg part (feet when deployed). */
export function legContactPointsLocal(
  part: PartInstance,
  baseXM: number,
  baseYM: number,
  stackCenterXCells: number,
): { x: number; y: number }[] {
  if (part.def.category !== 'legs' || part.legState !== 'deployed') return [];
  const pose = legPose(part, part.legState, baseXM, baseYM, stackCenterXCells);
  if (pose.footXM === null || pose.footYM === null) return [];
  return [{ x: pose.footXM, y: pose.footYM }];
}