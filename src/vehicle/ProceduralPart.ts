import type { AttachmentNodeDef } from './AttachmentNode';
import type { PartDefinition, ProceduralPartConfig } from './PartDefinition';
import { sideNodes, stackNodes } from './PartDefinition';
import type { PlacedPartData } from './RocketDesign';

/**
 * Part customization & procedural resolution: the single place where a part
 * definition plus optional per-instance settings become concrete geometry
 * and stats. Every consumer (snapping, rendering, physics, analysis, career
 * costs) goes through resolvePartProps/resolvePlacedPart.
 *
 * WIDTH RULE: stack attachment nodes live on integer grid VERTICES at the
 * part's center column (x + width/2), so procedural widths step by 2 cells.
 * Side nodes and engine-plate mount nodes are parity-free.
 */

/**
 * Everything a player can tweak on one placed part. All fields optional —
 * absent means "definition default". Serialized verbatim in the design JSON.
 */
export interface PartCustomization {
  /** Procedural dimensions, integer grid cells. */
  widthCells?: number;
  heightCells?: number;
  /** Engine max-thrust fraction (context menu "thrust limiter"), 0.1..1. */
  thrustLimiter?: number;
  /**
   * Engine ignition-stage override / decoupler fire-stage override
   * (1-based firing order). See vehicle/StageSystem.ts.
   */
  igniteStage?: number;
  /** Shape variant id (nose cones: 'cone' | 'rounded' | 'blunt'). */
  variant?: string;
  /** Procedural parachute configuration (category 'parachute' only). */
  chute?: ChuteConfig;
}

// ----------------------------------------------------------- parachutes --

export type ChuteType = 'main' | 'drogue' | 'combo';
export type ChuteMaterial = 'nylon' | 'reinforced' | 'hitemp';

/** Editor-configurable parachute parameters (RealChute-inspired). */
export interface ChuteConfig {
  type: ChuteType;
  /** Full canopy diameter, m. */
  diameterM: number;
  /** Main canopy deploys below this altitude (drogue at 4x this). */
  deployAltM: number;
  material: ChuteMaterial;
}

export const CHUTE_MATERIALS: Record<
  ChuteMaterial,
  {
    label: string;
    maxSpeedMS: number;
    maxQPa: number;
    maxTempK: number;
    massFactor: number;
    costFactor: number;
  }
> = {
  nylon: { label: 'Nylon', maxSpeedMS: 280, maxQPa: 18_000, maxTempK: 520, massFactor: 1, costFactor: 1 },
  reinforced: { label: 'Reinforced', maxSpeedMS: 380, maxQPa: 30_000, maxTempK: 650, massFactor: 1.6, costFactor: 1.8 },
  hitemp: { label: 'High-temp', maxSpeedMS: 480, maxQPa: 42_000, maxTempK: 900, massFactor: 2.2, costFactor: 3.2 },
};

export const CHUTE_PRESETS: Record<string, { label: string; config: ChuteConfig }> = {
  smallMain: { label: 'Small main', config: { type: 'main', diameterM: 7, deployAltM: 1200, material: 'nylon' } },
  mediumMain: { label: 'Medium main', config: { type: 'main', diameterM: 10, deployAltM: 1400, material: 'nylon' } },
  heavyMain: { label: 'Heavy main', config: { type: 'main', diameterM: 14, deployAltM: 1600, material: 'reinforced' } },
  drogue: { label: 'Drogue', config: { type: 'drogue', diameterM: 3.5, deployAltM: 4000, material: 'reinforced' } },
  combo: { label: 'Combo (drogue+main)', config: { type: 'combo', diameterM: 9, deployAltM: 1200, material: 'reinforced' } },
};

export const DEFAULT_CHUTE: ChuteConfig = CHUTE_PRESETS.mediumMain.config;

/** Canopy drag coefficient (round canopy). */
export const CHUTE_CD = 1.5;

/**
 * Runtime parachute state. "Deploying" and "waiting for safe conditions"
 * are derived from `armed` plus the deployment fractions.
 */
export type ChuteState = 'packed' | 'armed' | 'deployed' | 'cut' | 'failed';

/** Flight-only landing-leg state (VAB always renders stowed). */
export type LegState = 'stowed' | 'deployed' | 'broken';

/** Fully resolved chute properties used by physics and analysis. */
export interface ResolvedChute extends ChuteConfig {
  /** Main canopy area, m^2. */
  canopyAreaM2: number;
  /** Drogue canopy area (combo/drogue types), m^2. */
  drogueAreaM2: number;
  maxSpeedMS: number;
  maxQPa: number;
  maxTempK: number;
}

export function resolveChute(
  def: PartDefinition,
  custom?: PartCustomization,
): ResolvedChute | null {
  if (def.category !== 'parachute') return null;
  const config = { ...DEFAULT_CHUTE, ...custom?.chute };
  const material = CHUTE_MATERIALS[config.material];
  const fullArea = (Math.PI * config.diameterM * config.diameterM) / 4;
  return {
    ...config,
    canopyAreaM2: config.type === 'drogue' ? 0 : fullArea,
    drogueAreaM2: config.type === 'main' ? 0 : fullArea * (config.type === 'drogue' ? 1 : 0.18),
    maxSpeedMS: material.maxSpeedMS,
    maxQPa: material.maxQPa,
    maxTempK: material.maxTempK,
  };
}

/** The dimension subset, used by the palette steppers. */
export interface ProceduralDimensions {
  widthCells: number;
  heightCells: number;
}

export const MIN_THRUST_LIMITER = 0.1;

/** Nose-cone shape variants: drag, mass, and heat tolerance trade off. */
export const NOSE_VARIANTS: Record<
  string,
  { label: string; dragCoefficient: number; massFactor: number; maxTempBonusK: number }
> = {
  cone: { label: 'Cone', dragCoefficient: 0.15, massFactor: 1.0, maxTempBonusK: 0 },
  rounded: { label: 'Rounded', dragCoefficient: 0.2, massFactor: 1.1, maxTempBonusK: 150 },
  blunt: { label: 'Blunt', dragCoefficient: 0.32, massFactor: 1.25, maxTempBonusK: 700 },
};

/** Thermal failure defaults per category (def.maxTempK overrides). */
const DEFAULT_MAX_TEMP_K: Record<string, number> = {
  pod: 1400,
  tank: 1100,
  engine: 2200,
  decoupler: 1100,
  nose: 1600,
  parachute: 900,
  legs: 1300,
  heatshield: 3200,
  structural: 1300,
};

/** A part definition with per-instance customization applied. */
export interface ResolvedPartProps {
  widthCells: number;
  heightCells: number;
  dryMassKg: number;
  fuelCapacityKg: number;
  frontalAreaM2: number;
  dragCoefficient: number;
  costFunds: number;
  maxTempK: number;
  attachmentNodes: AttachmentNodeDef[];
}

/** Clamp requested dimensions to the part's rules (integers, bounds, even width). */
export function clampProceduralDimensions(
  config: ProceduralPartConfig,
  dims: ProceduralDimensions,
): ProceduralDimensions {
  const step = config.widthStepCells;
  let width = Math.round(dims.widthCells / step) * step;
  width = Math.min(config.maxWidthCells, Math.max(config.minWidthCells, width));
  let height = Math.floor(dims.heightCells);
  height = Math.min(config.maxHeightCells, Math.max(config.minHeightCells, height));
  return { widthCells: width, heightCells: height };
}

export function clampThrustLimiter(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(MIN_THRUST_LIMITER, value));
}

function proceduralNodes(
  config: ProceduralPartConfig,
  dims: ProceduralDimensions,
): AttachmentNodeDef[] {
  if (config.nodeLayout === 'stack') {
    return stackNodes(dims.widthCells, dims.heightCells);
  }
  if (config.nodeLayout === 'enginePlate') {
    // One top node + an engine mount every 2 cells: symmetric clusters.
    const nodes: AttachmentNodeDef[] = [
      { xCells: dims.widthCells / 2, yCells: dims.heightCells, kind: 'top' },
    ];
    for (let x = 1; x < dims.widthCells; x += 2) {
      nodes.push({ xCells: x, yCells: 0, kind: 'bottom' });
    }
    return nodes;
  }
  return [
    ...stackNodes(dims.widthCells, dims.heightCells),
    ...sideNodes(dims.widthCells, dims.heightCells),
  ];
}

/**
 * Resolve a definition (+ optional customization) into concrete props.
 * Non-procedural parts ignore the dimension fields; nose variants apply to
 * any part whose def id has entries in NOSE_VARIANTS semantics (category
 * 'nose' today).
 */
export function resolvePartProps(
  def: PartDefinition,
  custom?: PartCustomization,
): ResolvedPartProps {
  const variant =
    def.category === 'nose' ? NOSE_VARIANTS[custom?.variant ?? 'cone'] : undefined;
  const baseMaxTemp = def.maxTempK ?? DEFAULT_MAX_TEMP_K[def.category] ?? 1200;

  if (!def.procedural) {
    // Procedural parachutes: canopy size/material drive mass and cost.
    const chute = resolveChute(def, custom);
    const chuteMaterial = chute ? CHUTE_MATERIALS[chute.material] : null;
    const chuteArea = chute ? Math.max(chute.canopyAreaM2, chute.drogueAreaM2) : 0;
    const chuteMass = chuteMaterial ? 20 + chuteArea * 0.55 * chuteMaterial.massFactor : 0;
    const chuteCost = chuteMaterial ? 100 + chuteArea * 8 * chuteMaterial.costFactor : 0;

    return {
      widthCells: def.widthCells,
      heightCells: def.heightCells,
      dryMassKg: chute ? chuteMass : def.dryMass * (variant?.massFactor ?? 1),
      fuelCapacityKg: def.fuelCapacity,
      frontalAreaM2: def.frontalArea,
      dragCoefficient: variant?.dragCoefficient ?? def.dragCoefficient,
      costFunds: chute ? chuteCost : (def.cost ?? 0),
      maxTempK: chute ? CHUTE_MATERIALS[chute.material].maxTempK + 200 : baseMaxTemp + (variant?.maxTempBonusK ?? 0),
      attachmentNodes: def.attachmentNodes,
    };
  }

  const config = def.procedural;
  const dims = clampProceduralDimensions(config, {
    widthCells: custom?.widthCells ?? def.widthCells,
    heightCells: custom?.heightCells ?? def.heightCells,
  });
  const cells = dims.widthCells * dims.heightCells;
  return {
    widthCells: dims.widthCells,
    heightCells: dims.heightCells,
    dryMassKg: cells * config.dryMassPerCellKg,
    fuelCapacityKg: cells * config.fuelPerCellKg,
    frontalAreaM2: dims.widthCells * config.frontalAreaPerWidthCell,
    dragCoefficient: def.dragCoefficient,
    costFunds: cells * (config.costPerCell ?? 0),
    maxTempK: baseMaxTemp,
    attachmentNodes: proceduralNodes(config, dims),
  };
}

/** A placed design part resolved for grid/snapping/rendering purposes. */
export interface ResolvedPlacedPart {
  placed: PlacedPartData;
  def: PartDefinition;
  props: ResolvedPartProps;
}

export function resolvePlacedPart(
  placed: PlacedPartData,
  catalog: Map<string, PartDefinition>,
): ResolvedPlacedPart | null {
  const def = catalog.get(placed.defId);
  if (!def) return null;
  return { placed, def, props: resolvePartProps(def, placed.custom) };
}
