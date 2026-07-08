import { G0, GRID_CELL_METERS } from '../config/constants';
import { computeCenterOfMass, type CenterOfMass } from '../vehicle/CenterOfMass';
import type { PartInstance } from '../vehicle/PartInstance';
import { computeStagePlan, fireStage } from '../vehicle/StageSystem';

/**
 * Reusable vehicle engineering analysis (the "KER" math): per-stage thrust,
 * mass, delta-v, and TWR, derived only from part instances. No UI, no
 * rendering — the editor panel consumes this, and the flight HUD can reuse
 * it later.
 *
 * Staging model (matches StageSystem exactly — both walk the same
 * fireStage): stage k runs with every part still attached at k; engines lit
 * at k burn; the stage ends when its decouplers fire.
 *
 * Delta-v simplification for PARALLEL stages (boosters + core burning
 * together): stage k's burnable fuel is the fuel that DEPARTS when stage k
 * fires (plus everything remaining, for the final stage). Fuel the core
 * drains while boosters burn is credited to the core's own stage, so
 * booster-stage dv is slightly conservative and core-stage dv slightly
 * optimistic. A warning flags this. TODO: time-domain burn simulation for
 * exact parallel dv.
 */

export interface StageAnalysis {
  /** 1-based, in firing order (1 = lit from launch). */
  stageNumber: number;
  engineCount: number;
  thrustSeaLevelN: number;
  thrustVacuumN: number;
  /** Mass of the parts that separate when this stage fires (wet/dry), kg. */
  segmentWetKg: number;
  segmentDryKg: number;
  /** Fuel credited to this stage's burn, kg. */
  fuelKg: number;
  /** Full-vehicle mass when this stage ignites / burns out, kg. */
  ignitionMassKg: number;
  burnoutMassKg: number;
  deltaVSeaLevel: number;
  deltaVVacuum: number;
  /** Thrust-to-weight at ignition using sea-level thrust and surface gravity. */
  twrSeaLevel: number;
  /** Full-throttle burn duration in vacuum, seconds (Infinity if no flow). */
  burnTimeVacS: number;
}

export interface VehicleAnalysisResult {
  stages: StageAnalysis[];
  totalWetKg: number;
  totalDryKg: number;
  /** Career foundations: total part cost in funds. */
  totalCostFunds: number;
  partCount: number;
  totalDeltaVSeaLevel: number;
  totalDeltaVVacuum: number;
  centerOfMass: CenterOfMass | null;
  /** CoM height above the bottom of the stack, meters. */
  comHeightAboveBaseM: number | null;
  /** CoM lateral offset from the base column, meters (asymmetry indicator). */
  comLateralOffsetM: number | null;
  warnings: string[];
}

/** Thrust-weighted aggregate Isp: total thrust / total mass flow. */
function aggregateIsp(thrusts: number[], isps: number[]): number {
  let totalThrust = 0;
  let totalFlow = 0;
  for (let i = 0; i < thrusts.length; i++) {
    if (isps[i] <= 0) continue;
    totalThrust += thrusts[i];
    totalFlow += thrusts[i] / isps[i];
  }
  return totalFlow > 0 ? totalThrust / totalFlow : 0;
}

export function analyzeVehicle(
  parts: PartInstance[],
  surfaceGravity: number,
): VehicleAnalysisResult {
  const warnings: string[] = [];
  const plan = computeStagePlan(parts);

  let totalWetKg = 0;
  let totalDryKg = 0;
  let totalCostFunds = 0;
  for (const p of parts) {
    totalWetKg += p.mass;
    totalDryKg += p.dryMassKg;
    totalCostFunds += p.costFunds;
  }

  const stages: StageAnalysis[] = [];
  let current = [...parts];
  let parallelBurnDetected = false;

  for (let stageNumber = 1; stageNumber <= plan.totalStages; stageNumber++) {
    const engines = current.filter(
      (p) => p.def.category === 'engine' && (plan.activation.get(p) ?? 1) <= stageNumber,
    );

    // Thrust limiters scale thrust AND flow together, so Isp and delta-v are
    // unchanged — only TWR and burn time move.
    const thrustSeaLevelN = engines.reduce(
      (s, e) => s + e.def.thrustSeaLevel * e.thrustLimiter,
      0,
    );
    const thrustVacuumN = engines.reduce(
      (s, e) => s + e.def.thrustVacuum * e.thrustLimiter,
      0,
    );
    const ispSL = aggregateIsp(
      engines.map((e) => e.def.thrustSeaLevel * e.thrustLimiter),
      engines.map((e) => e.def.ispSeaLevel),
    );
    const ispVac = aggregateIsp(
      engines.map((e) => e.def.thrustVacuum * e.thrustLimiter),
      engines.map((e) => e.def.ispVacuum),
    );

    const litGroups = new Set(engines.map((e) => plan.fuelGroup.get(e)));
    if (litGroups.size > 1) parallelBurnDetected = true;

    const { kept, groups } = fireStage(current, plan.activation, stageNumber);
    const departing = groups.flat();
    const departingSet = new Set(departing);

    // "Stage mass": what departs when the stage ends — except the final
    // stage, whose mass is the whole remaining vehicle (it never departs).
    const isFinalStage = stageNumber === plan.totalStages;
    let segmentWetKg = 0;
    let segmentDryKg = 0;
    for (const p of isFinalStage ? current : departing) {
      segmentWetKg += p.mass;
      segmentDryKg += p.dryMassKg;
    }

    // Fuel this stage burns: fuel in lit groups that departs with the stage;
    // the final stage burns whatever the lit engines can still reach.
    let fuelKg = 0;
    for (const p of current) {
      if (p.fuelCapacityKg <= 0) continue;
      if (!litGroups.has(plan.fuelGroup.get(p))) continue;
      if (departingSet.has(p) || isFinalStage) fuelKg += p.fuel;
    }

    const ignitionMassKg = current.reduce((s, p) => s + p.mass, 0);
    const burnoutMassKg = ignitionMassKg - fuelKg;

    const canBurn = engines.length > 0 && fuelKg > 0 && burnoutMassKg > 0;
    const deltaVSeaLevel = canBurn ? ispSL * G0 * Math.log(ignitionMassKg / burnoutMassKg) : 0;
    const deltaVVacuum = canBurn ? ispVac * G0 * Math.log(ignitionMassKg / burnoutMassKg) : 0;

    const flowVac = ispVac > 0 ? thrustVacuumN / (ispVac * G0) : 0;
    const burnTimeVacS = canBurn && flowVac > 0 ? fuelKg / flowVac : Infinity;

    if (engines.length > 0 && fuelKg <= 0) {
      warnings.push(`Stage ${stageNumber} has engines but no fuel to burn.`);
    }
    if (engines.length === 0 && fuelKg > 0) {
      warnings.push(`Stage ${stageNumber} has fuel but no lit engine.`);
    }

    stages.push({
      stageNumber,
      engineCount: engines.length,
      thrustSeaLevelN,
      thrustVacuumN,
      segmentWetKg,
      segmentDryKg,
      fuelKg,
      ignitionMassKg,
      burnoutMassKg,
      deltaVSeaLevel,
      deltaVVacuum,
      twrSeaLevel:
        ignitionMassKg > 0 ? thrustSeaLevelN / (ignitionMassKg * surfaceGravity) : 0,
      burnTimeVacS,
    });

    current = kept;
  }

  if (stages.length > 0 && stages[0].twrSeaLevel > 0 && stages[0].twrSeaLevel < 1) {
    warnings.push('Liftoff TWR is below 1 — the rocket cannot leave the pad.');
  }
  if (parts.some((p) => p.def.category === 'engine' && p.igniteStageOverride !== undefined)) {
    warnings.push('Custom ignition stages set — Δv per stage assumes the default order.');
  }
  if (parallelBurnDetected) {
    warnings.push('Parallel staging detected — Δv per stage is approximate.');
  }

  const centerOfMass = computeCenterOfMass(parts);
  let comHeightAboveBaseM: number | null = null;
  let comLateralOffsetM: number | null = null;
  if (centerOfMass && parts.length > 0) {
    let bottom = parts[0];
    for (const p of parts) {
      if (p.yCells < bottom.yCells) bottom = p;
    }
    comHeightAboveBaseM = centerOfMass.yM - bottom.yCells * GRID_CELL_METERS;
    comLateralOffsetM =
      centerOfMass.xM - (bottom.xCells + bottom.widthCells / 2) * GRID_CELL_METERS;
  }

  return {
    stages,
    totalWetKg,
    totalDryKg,
    totalCostFunds,
    partCount: parts.length,
    totalDeltaVSeaLevel: stages.reduce((s, st) => s + st.deltaVSeaLevel, 0),
    totalDeltaVVacuum: stages.reduce((s, st) => s + st.deltaVVacuum, 0),
    centerOfMass,
    comHeightAboveBaseM,
    comLateralOffsetM,
    warnings,
  };
}
