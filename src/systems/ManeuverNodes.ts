import type { Vec2 } from '../math/Vec2';

/**
 * FUTURE ARCHITECTURE — maneuver nodes (data model only).
 *
 * A node is a planned impulsive burn at a point on the current orbit. The
 * map view will let the player place/edit nodes and show the post-burn
 * conic; SAS gains a "maneuver hold" mode pointing along `burnDirection`.
 *
 * Implementation notes for later:
 *  - The current orbit is analytic (math/OrbitMath + space/KeplerOrbit), so
 *    "state at node time" is a single propagateRailsOrbit call.
 *  - Post-burn trajectory = computeOrbitInfo(position, velocity + dv).
 *  - Burn duration estimate comes from systems/VehicleAnalysis (thrust,
 *    mass flow) — do not duplicate that math here.
 *
 * TODO: node editing UI in map view; closest-approach markers against a
 * selected target vessel; SOI-transition prediction along the planned conic.
 */
export interface ManeuverNode {
  id: number;
  /** Simulation time of the burn's midpoint, s. */
  timeSec: number;
  /** Delta-v split into orbit-local axes at the node, m/s. */
  progradeDv: number;
  radialDv: number;
  /** World-frame burn direction + magnitude, derived when planning. */
  burnDirection?: Vec2;
  totalDvMS?: number;
}

export interface ManeuverPlan {
  vesselId: number;
  nodes: ManeuverNode[];
}
