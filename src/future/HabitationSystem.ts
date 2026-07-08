import type { PartInstance } from '../vehicle/PartInstance';

/**
 * FUTURE ARCHITECTURE — habitation & life support.
 *
 * Nothing here is gameplay yet. Part definitions may declare `crewCapacity`,
 * `habitableVolume`, and `habitationRole` (see vehicle/PartDefinition.ts);
 * this module aggregates them so UI can display honest static facts.
 *
 * Planned wiring (in dependency order):
 *  1. Vessel gains a `habitation: VesselHabitationState` built from its
 *     parts by this module when the vessel is created (systems/VesselManager).
 *  2. Mission elapsed time (PhysicsWorld.simTime) drives supply consumption
 *     per crew member; rates live in config, never in UI code.
 *  3. Life-support parts add recycling; habitats add volume/comfort;
 *     radiation shielding matters once solar events exist.
 *  4. Surface bases and stations are just Vessels of type 'station' with
 *     habitation state — VesselManager already supports the type.
 *
 * TODO: crew as entities (assignment in the builder, transfer in flight).
 * TODO: supplies/waste/comfort simulation with warp-safe (analytic) accrual
 *       so rails warp doesn't have to integrate life support tick by tick.
 */

export interface HabitationSummary {
  /** Total seats declared by the parts. */
  crewCapacity: number;
  /** Total pressurized volume, m^3 (fictional 2D bookkeeping unit). */
  habitableVolumeM3: number;
  /** Number of parts that declare any habitation role. */
  habitationParts: number;
}

/** Aggregate the declared (static) habitation facts of a part stack. */
export function summarizeHabitation(parts: PartInstance[]): HabitationSummary {
  let crewCapacity = 0;
  let habitableVolumeM3 = 0;
  let habitationParts = 0;
  for (const p of parts) {
    crewCapacity += p.def.crewCapacity ?? 0;
    habitableVolumeM3 += p.def.habitableVolume ?? 0;
    if (p.def.habitationRole) habitationParts++;
  }
  return { crewCapacity, habitableVolumeM3, habitationParts };
}
