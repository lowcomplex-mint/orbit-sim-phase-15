import type { AttachmentNodeDef } from './AttachmentNode';

/**
 * Static description of a part type. Instances (with live fuel state and,
 * for procedural parts, per-instance dimensions) are PartInstance;
 * definitions are immutable data loaded from config/parts.ts.
 *
 * IMPORTANT: geometry/mass consumers must NOT read widthCells/heightCells/
 * dryMass/fuelCapacity straight from a definition — always go through
 * resolvePartProps (vehicle/ProceduralPart.ts), which applies per-instance
 * procedural dimensions. The fields here are the defaults.
 */

export type PartCategory =
  | 'pod'
  | 'tank'
  | 'engine'
  | 'decoupler'
  | 'clamp'
  | 'nose'
  | 'structural'
  | 'parachute'
  | 'legs'
  | 'heatshield'
  | 'utility';

/** How a part participates in future habitation (see future/HabitationSystem.ts). */
export type HabitationRole = 'command' | 'habitat' | 'lifeSupport';

/** Sizing rules and per-cell stat scaling for procedural parts. */
export interface ProceduralPartConfig {
  minWidthCells: number;
  maxWidthCells: number;
  /**
   * Width step. Must be 2: attachment nodes sit on integer grid VERTICES at
   * the part's center column (x + width/2), so only even widths keep the
   * node on the grid. See vehicle/ProceduralPart.ts for the full rationale.
   */
  widthStepCells: number;
  minHeightCells: number;
  maxHeightCells: number;
  /** Fuel per grid cell of volume, kg. */
  fuelPerCellKg: number;
  /** Dry (structural) mass per grid cell of volume, kg. */
  dryMassPerCellKg: number;
  /** Frontal area per cell of width, m^2 (0.4 => 0.8 m^2 at the standard 1 m width). */
  frontalAreaPerWidthCell: number;
  /** Cost per grid cell, funds (career foundations). */
  costPerCell?: number;
  /**
   * How attachment nodes are generated from the resolved size:
   *  - 'tank' (default): stack nodes + side flanks.
   *  - 'enginePlate': one top node + an engine mount node every 2 cells of
   *    width — symmetric engine clusters.
   */
  nodeLayout?: 'tank' | 'enginePlate';
}

export interface PartDefinition {
  id: string;
  name: string;
  category: PartCategory;

  /** Default footprint on the builder grid, in cells (overridden for procedural parts). */
  widthCells: number;
  heightCells: number;

  /** Default mass without fuel, kg. */
  dryMass: number;
  /** Default fuel the part can hold, kg. 0 for non-tanks. */
  fuelCapacity: number;

  /** Thrust in newtons. 0 for non-engines. */
  thrustSeaLevel: number;
  thrustVacuum: number;
  /** Specific impulse in seconds. Only meaningful for engines. */
  ispSeaLevel: number;
  ispVacuum: number;

  /** Dimensionless drag coefficient of this part's shape. */
  dragCoefficient: number;
  /** Default cross-section area facing the airstream, m^2. */
  frontalArea: number;

  attachmentNodes: AttachmentNodeDef[];
  /** Whether activating a stage does something with this part (decouplers, chutes...). */
  stageable: boolean;

  /**
   * Engine gimbal range in degrees. Contributes control torque proportional
   * to current thrust and the engine's lever arm from the center of mass.
   */
  gimbalRangeDeg?: number;
  /** Reaction-wheel torque (pods), N*m. Control authority without thrust. */
  reactionWheelNm?: number;

  /** Placeholder-art fill color. */
  color: number;

  /** Present only on procedural parts; enables per-instance sizing. */
  procedural?: ProceduralPartConfig;

  /** Part cost in funds (career foundations; shown in sandbox too). */
  cost?: number;

  // --- Electricity (first generalized resource; systems/Resources.ts) ----
  /** Electric charge storage, units. */
  electricCapacity?: number;
  /** Continuous drain (probe cores/avionics), units/s. */
  electricDrainPerSec?: number;
  /** Generation in full sunlight (solar panels), units/s. */
  electricGenPerSec?: number;
  /**
   * Thermal failure temperature, K. Defaults per category in
   * vehicle/ProceduralPart.ts when absent; physics/ThermalModel.ts destroys
   * parts above the resolved limit.
   */
  maxTempK?: number;

  /** Kept in the catalog so old saves load, but hidden from the palette. */
  legacy?: boolean;

  // --- Future habitation data (declared, not yet simulated). ------------
  // These are read by future/HabitationSystem.summarizeHabitation and shown
  // as plain info in the engineering panel; no gameplay consumes them yet.
  crewCapacity?: number;
  /** Pressurized volume in m^3 (fictional 2D bookkeeping unit). */
  habitableVolume?: number;
  habitationRole?: HabitationRole;
}

/**
 * Standard stack nodes for a vertical part: one bottom node and one top node,
 * both on the part's center column. Requires an even widthCells so the center
 * lands on an integer grid vertex.
 */
export function stackNodes(widthCells: number, heightCells: number): AttachmentNodeDef[] {
  if (widthCells % 2 !== 0) {
    throw new Error(`stackNodes needs an even widthCells, got ${widthCells}`);
  }
  return [
    { xCells: widthCells / 2, yCells: 0, kind: 'bottom' },
    { xCells: widthCells / 2, yCells: heightCells, kind: 'top' },
  ];
}

/**
 * Radial attachment points at mid-height on both flanks (left/right kinds
 * pair with each other). No parity constraint: the flanks are always on
 * integer vertices.
 */
export function sideNodes(widthCells: number, heightCells: number): AttachmentNodeDef[] {
  const midY = Math.floor(heightCells / 2);
  return [
    { xCells: 0, yCells: midY, kind: 'left' },
    { xCells: widthCells, yCells: midY, kind: 'right' },
  ];
}
