import { AMBIENT_TEMP_K, GRID_CELL_METERS } from '../config/constants';
import type { WorldNode } from './AttachmentNode';
import type { PartDefinition } from './PartDefinition';
import {
  clampThrustLimiter,
  resolveChute,
  resolvePartProps,
  type ChuteState,
  type PartCustomization,
  type ResolvedChute,
} from './ProceduralPart';

let nextInstanceId = 1;

/**
 * A concrete part on a rocket: a definition plus grid placement, resolved
 * geometry (procedural dimensions applied), player customization (thrust
 * limiter, ignition stage), and live state (fuel).
 *
 * Geometry and mass are read from the RESOLVED fields here, never from the
 * definition — that is what makes procedural parts work everywhere.
 */
export class PartInstance {
  readonly instanceId: number;

  // Resolved geometry/stats (definition defaults + customization applied).
  readonly widthCells: number;
  readonly heightCells: number;
  readonly dryMassKg: number;
  readonly fuelCapacityKg: number;
  readonly frontalAreaM2: number;
  readonly dragCoefficient: number;
  readonly costFunds: number;
  /** Thermal failure temperature, K (physics/ThermalModel destroys above it). */
  readonly maxTempK: number;
  private readonly nodes: readonly { xCells: number; yCells: number; kind: WorldNode['kind'] }[];

  /** Live temperature, K — heated by reentry, cooled by radiation. */
  temperatureK = AMBIENT_TEMP_K;

  // --- Parachutes (category 'parachute'; see RocketRuntime.stepChutes) ---
  /** Resolved canopy config, null for non-parachutes. */
  readonly chute: ResolvedChute | null;
  chuteState: ChuteState = 'packed';
  drogueFraction = 0;
  mainFraction = 0;

  // --- Landing legs (category 'legs') -----------------------------------
  legsDeployed: boolean;

  /** Engine max-thrust fraction, 0.1..1 (context-menu thrust limiter). */
  readonly thrustLimiter: number;
  /** Engine ignition-stage override; undefined = geometric default. */
  readonly igniteStageOverride: number | undefined;
  /** Original customization, kept verbatim so save files round-trip. */
  readonly custom: PartCustomization | undefined;

  fuel: number;

  constructor(
    readonly def: PartDefinition,
    public xCells: number,
    public yCells: number,
    custom?: PartCustomization,
  ) {
    this.instanceId = nextInstanceId++;
    const props = resolvePartProps(def, custom);
    this.widthCells = props.widthCells;
    this.heightCells = props.heightCells;
    this.dryMassKg = props.dryMassKg;
    this.fuelCapacityKg = props.fuelCapacityKg;
    this.frontalAreaM2 = props.frontalAreaM2;
    this.dragCoefficient = props.dragCoefficient;
    this.costFunds = props.costFunds;
    this.maxTempK = props.maxTempK;
    this.nodes = props.attachmentNodes;
    this.thrustLimiter = clampThrustLimiter(custom?.thrustLimiter);
    this.igniteStageOverride = custom?.igniteStage;
    this.custom = custom ? { ...custom } : undefined;
    this.fuel = this.fuelCapacityKg;
    this.chute = resolveChute(def, custom);
    this.legsDeployed = def.category === 'legs'; // spawn with gear down
  }

  get mass(): number {
    return this.dryMassKg + this.fuel;
  }

  get topCells(): number {
    return this.yCells + this.heightCells;
  }

  get centerXMeters(): number {
    return (this.xCells + this.widthCells / 2) * GRID_CELL_METERS;
  }

  worldNodes(): WorldNode[] {
    return this.nodes.map((n) => ({
      xCells: this.xCells + n.xCells,
      yCells: this.yCells + n.yCells,
      kind: n.kind,
    }));
  }
}
