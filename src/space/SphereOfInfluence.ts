import type { Vec2 } from '../math/Vec2';
import type { CelestialBody } from '../physics/CelestialBody';

/**
 * Sphere-of-influence helpers — the groundwork for patched-conics flight.
 *
 * CURRENT USE: FlightSession logs when the active vessel crosses into or out
 * of the Moon's SOI. Physics stays Earth-centric (Moon gravity is already a
 * secondary point-mass term).
 *
 * TODO (patched conics): to actually orbit/land on the Moon,
 *  1. store vessel state relative to the dominant body (needs
 *     space/CelestialFrame.ts),
 *  2. on SOI transition, convert state vectors between frames
 *     (subtract/add the body's analytic position and velocity),
 *  3. collide against the dominant body's surface instead of only Earth's,
 *  4. let rails warp capture elements around the dominant body's mu.
 */

/**
 * Classic SOI radius: r = a * (m / M)^(2/5), expressed via gravitational
 * parameters. Infinity for a root body (nothing dominates it).
 */
export function sphereOfInfluenceRadius(body: CelestialBody): number {
  if (!body.parent || !body.config.orbit) return Infinity;
  return body.config.orbit.radiusM * Math.pow(body.mu / body.parent.mu, 2 / 5);
}

/**
 * The body whose sphere of influence contains `position` at `timeSec`.
 * Checks child bodies first (deepest wins), falls back to the root.
 * `bodies` must be ordered root-first (e.g. [earth, moon]).
 */
export function getDominantBody(
  position: Vec2,
  timeSec: number,
  bodies: CelestialBody[],
): CelestialBody {
  // Walk from the last (deepest) body backwards so children win over parents.
  for (let i = bodies.length - 1; i >= 1; i--) {
    const body = bodies[i];
    const soi = sphereOfInfluenceRadius(body);
    if (position.distanceTo(body.positionAt(timeSec)) < soi) return body;
  }
  return bodies[0];
}
