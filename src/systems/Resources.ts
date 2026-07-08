/**
 * FUTURE ARCHITECTURE — generalized resources.
 *
 * Today fuel is a single hardcoded quantity on PartInstance (`fuel`), drained
 * per fuel group by RocketRuntime.computePropulsion. This module fixes the
 * shape the generalization will take so parts/config can start declaring it.
 *
 * Migration plan:
 *  1. PartDefinition gains `resources?: Partial<Record<ResourceId, number>>`
 *     (capacity per resource) — `fuelCapacity` becomes `resources.liquidFuel`.
 *  2. PartInstance stores `amounts: Map<ResourceId, number>`.
 *  3. Engines declare consumption per resource per second at full throttle;
 *     computePropulsion drains all of them (fails if any runs dry).
 *  4. Electricity is the first non-fuel resource: batteries store it, probe
 *     cores drain it, and control is lost at zero charge.
 *  5. Crossfeed rules per category (decouplers block; plates/adapters pass) —
 *     today's rule (fuel groups cut at decouplers) is the special case.
 *
 * TODO: implement steps 1-3 next time fuel logic is touched; the fuel-group
 * machinery in vehicle/StageSystem.ts already provides the flow topology.
 */

export type ResourceId =
  | 'liquidFuel'
  | 'oxidizer'
  | 'monopropellant'
  | 'solidFuel'
  | 'electricity'
  | 'supplies' // life support, far future
  | 'scienceData'; // career, future

export interface ResourceDefinition {
  id: ResourceId;
  label: string;
  /** kg per unit (0 for massless resources like electricity/science). */
  massPerUnit: number;
}

export const RESOURCE_DEFINITIONS: ResourceDefinition[] = [
  { id: 'liquidFuel', label: 'Liquid Fuel', massPerUnit: 1 },
  { id: 'oxidizer', label: 'Oxidizer', massPerUnit: 1 },
  { id: 'monopropellant', label: 'Monopropellant', massPerUnit: 1 },
  { id: 'solidFuel', label: 'Solid Fuel', massPerUnit: 1 },
  { id: 'electricity', label: 'Electric Charge', massPerUnit: 0 },
  { id: 'supplies', label: 'Supplies', massPerUnit: 1 },
  { id: 'scienceData', label: 'Science Data', massPerUnit: 0 },
];
