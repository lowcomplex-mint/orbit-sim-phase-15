import type { Vec2 } from '../math/Vec2';

/**
 * FUTURE ARCHITECTURE — reference frames for a moving celestial hierarchy.
 * Nothing implements this yet; it documents the agreed migration path so
 * later phases don't have to rediscover it.
 *
 * Today's assumptions (all must change together, behind this interface):
 *  - Earth is pinned at the world origin (physics/CelestialBody.positionAt
 *    returns ZERO for it) and every vessel's state vectors are world = Earth
 *    frame.
 *  - Collision, atmosphere, orbit math, and rails warp all implicitly use
 *    the Earth frame.
 *
 * Migration plan for heliocentric Earth / Moon landings:
 *  1. Vessels store (frameBodyId, position, velocity) instead of raw world
 *     vectors; `toWorld`/`fromWorld` do the conversion using the body's
 *     analytic position AND velocity at time t.
 *  2. Renderers keep drawing in world space (camera code is unaffected).
 *  3. OrbitMath/rails warp operate on frame-relative vectors with the frame
 *     body's mu — they already take (position, velocity, mu), so they are
 *     frame-agnostic today.
 *  4. SOI transitions (space/SphereOfInfluence.ts) become frame switches.
 *  5. Only then may Earth get an `orbit` config around the Sun; the Sun
 *     stops being decorative (config/celestialBodies.ts SUN_VISUAL).
 */
export interface CelestialFrame {
  /** Body this frame is attached to ('earth', 'moon', later 'sun'). */
  readonly bodyId: string;
  /** Convert a frame-relative position to world space at simulation time t. */
  toWorld(frameRelative: Vec2, timeSec: number): Vec2;
  /** Convert a world position into this frame at simulation time t. */
  fromWorld(world: Vec2, timeSec: number): Vec2;
}
