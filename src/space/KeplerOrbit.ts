import { computeOrbitInfo } from '../math/OrbitMath';
import { Vec2 } from '../math/Vec2';

/**
 * Analytic two-body ("on rails") orbit propagation for rails time warp.
 *
 * A vessel's state vectors are converted once into orbital elements when
 * rails warp engages; afterwards position/velocity at any simulation time
 * come from Kepler's equation with NO integration error, so rails warp is
 * exact and O(1) per frame regardless of the warp factor.
 *
 * Limitations (all enforced by the eligibility checks in FlightSession):
 *  - Elliptic orbits only (e < MAX_RAILS_ECCENTRICITY), including suborbital
 *    arcs — rails drops automatically on atmosphere entry. TODO: hyperbolic
 *    propagation via the universal variable formulation for escape warp.
 *  - Two-body around Earth only: the Moon's (negligible near-Earth) pull is
 *    ignored while on rails, so there is a tiny, documented discrepancy vs.
 *    the integrator. TODO: revisit with SOI transitions (space/SphereOfInfluence).
 */

export const MAX_RAILS_ECCENTRICITY = 0.95;

/** True when Kepler rails propagation can represent this conic (bound, not near-parabolic). */
export function canPropagateOnRails(info: { isBound: boolean; eccentricity: number }): boolean {
  return info.isBound && info.eccentricity < MAX_RAILS_ECCENTRICITY;
}

export interface RailsOrbitState {
  mu: number;
  semiMajorAxis: number;
  eccentricity: number;
  /** World angle of the periapsis direction, radians. */
  periapsisAngleRad: number;
  /** +1 = counterclockwise motion (h > 0), -1 = clockwise. */
  direction: 1 | -1;
  meanAnomalyAtEpoch: number;
  epochTimeSec: number;
  /** Mean motion n = sqrt(mu / a^3), rad/s (always positive). */
  meanMotionRadPerSec: number;
}

function normalizeAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let x = a % twoPi;
  if (x > Math.PI) x -= twoPi;
  if (x < -Math.PI) x += twoPi;
  return x;
}

/** Convert state vectors into rails elements. Returns null if not propagatable. */
export function captureRailsOrbit(
  position: Vec2,
  velocity: Vec2,
  mu: number,
  timeSec: number,
): RailsOrbitState | null {
  const info = computeOrbitInfo(position, velocity, mu);
  if (!info.isBound || info.eccentricity >= MAX_RAILS_ECCENTRICITY) return null;

  const a = info.semiMajorAxis;
  const e = info.eccentricity;
  const direction: 1 | -1 = position.cross(velocity) >= 0 ? 1 : -1;
  const periapsisAngleRad = e > 1e-8 ? info.eccVector.angle() : position.angle();

  // True anomaly measured in the direction of motion, then eccentric and
  // mean anomaly via the standard half-angle relation.
  const nu = direction * normalizeAngle(position.angle() - periapsisAngleRad);
  const E = 2 * Math.atan2(
    Math.sqrt(1 - e) * Math.sin(nu / 2),
    Math.sqrt(1 + e) * Math.cos(nu / 2),
  );
  const meanAnomalyAtEpoch = E - e * Math.sin(E);

  return {
    mu,
    semiMajorAxis: a,
    eccentricity: e,
    periapsisAngleRad,
    direction,
    meanAnomalyAtEpoch,
    epochTimeSec: timeSec,
    meanMotionRadPerSec: Math.sqrt(mu / (a * a * a)),
  };
}

/** Solve Kepler's equation E - e sin E = M by Newton iteration. */
function solveKepler(meanAnomaly: number, e: number): number {
  let E = meanAnomaly;
  for (let i = 0; i < 20; i++) {
    const f = E - e * Math.sin(E) - meanAnomaly;
    const step = f / (1 - e * Math.cos(E));
    E -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return E;
}

/** Exact state vectors on the captured orbit at the given simulation time. */
export function propagateRailsOrbit(
  s: RailsOrbitState,
  timeSec: number,
): { position: Vec2; velocity: Vec2 } {
  const { semiMajorAxis: a, eccentricity: e } = s;
  const M = s.meanAnomalyAtEpoch + s.meanMotionRadPerSec * (timeSec - s.epochTimeSec);
  const E = solveKepler(M, e);

  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const b = a * Math.sqrt(1 - e * e); // semi-minor axis
  const r = a * (1 - e * cosE);

  // Perifocal frame: periapsis along +P; motion counterclockwise for +Q.
  const P = a * (cosE - e);
  const Q = b * sinE;
  const eDot = (s.meanMotionRadPerSec * a) / r; // dE/dt = n a / r
  const Pdot = -a * sinE * eDot;
  const Qdot = b * cosE * eDot;

  // Mirror Q for clockwise orbits, then rotate into the world frame.
  const dir = s.direction;
  return {
    position: new Vec2(P, dir * Q).rotated(s.periapsisAngleRad),
    velocity: new Vec2(Pdot, dir * Qdot).rotated(s.periapsisAngleRad),
  };
}
