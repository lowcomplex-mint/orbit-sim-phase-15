import { Vec2 } from './Vec2';

/**
 * Two-body orbital mechanics around a single point mass.
 * Positions are relative to the attracting body's center; mu = G * M.
 */

export interface OrbitInfo {
  /** Specific orbital energy, J/kg. Negative = bound orbit. */
  specificEnergy: number;
  /** Semi-major axis, m. Infinity for a (near-)parabolic trajectory. */
  semiMajorAxis: number;
  /** Eccentricity vector: points from the focus toward periapsis, magnitude e. */
  eccVector: Vec2;
  eccentricity: number;
  /** Semi-latus rectum p = h^2 / mu. Radius formula: r = p / (1 + e cos(nu)). */
  semiLatusRectum: number;
  periapsisRadius: number;
  /** Infinity for escape trajectories. */
  apoapsisRadius: number;
  isBound: boolean;
}

export function computeOrbitInfo(position: Vec2, velocity: Vec2, mu: number): OrbitInfo {
  const r = position.length();
  const v2 = velocity.lengthSq();
  const specificEnergy = v2 / 2 - mu / r;

  // e = ((v^2 - mu/r) * r_vec - (r_vec . v_vec) * v_vec) / mu
  const eccVector = position
    .scale(v2 - mu / r)
    .sub(velocity.scale(position.dot(velocity)))
    .scale(1 / mu);
  const eccentricity = eccVector.length();

  // Specific angular momentum (scalar in 2D) gives the semi-latus rectum,
  // which stays finite and positive for every conic, unlike the semi-major axis.
  const h = position.cross(velocity);
  const semiLatusRectum = (h * h) / mu;

  const semiMajorAxis =
    Math.abs(specificEnergy) < 1e-9 ? Infinity : -mu / (2 * specificEnergy);
  const isBound = specificEnergy < 0;

  // For bound orbits use a(1 -+ e): unlike p/(1 -+ e) it stays numerically
  // stable for near-radial trajectories (h ~ 0 => p ~ 0 and e ~ 1, e.g. a
  // rocket climbing straight up), where the p-form divides ~0 by ~0.
  const periapsisRadius = isBound
    ? semiMajorAxis * (1 - eccentricity)
    : semiLatusRectum / (1 + eccentricity);
  const apoapsisRadius = isBound ? semiMajorAxis * (1 + eccentricity) : Infinity;

  return {
    specificEnergy,
    semiMajorAxis,
    eccVector,
    eccentricity,
    semiLatusRectum,
    periapsisRadius,
    apoapsisRadius,
    isBound,
  };
}

/** Speed of a circular orbit at radius r. */
export function circularOrbitSpeed(mu: number, radius: number): number {
  return Math.sqrt(mu / radius);
}

/** Orbital period of an elliptic orbit (NaN if unbound). */
export function orbitalPeriod(mu: number, semiMajorAxis: number): number {
  return 2 * Math.PI * Math.sqrt(Math.pow(semiMajorAxis, 3) / mu);
}

export type OrbitStatus = 'landed' | 'crashed' | 'suborbital' | 'orbiting' | 'escaping';

/**
 * Classify the vessel's trajectory. "Orbiting" requires the entire orbit
 * (periapsis included) to clear the atmosphere.
 */
export function classifyOrbit(
  info: OrbitInfo,
  bodyRadius: number,
  atmosphereHeight: number,
  landed: boolean,
  crashed: boolean,
): OrbitStatus {
  if (crashed) return 'crashed';
  if (landed) return 'landed';
  if (!info.isBound) return 'escaping';
  if (info.periapsisRadius > bodyRadius + atmosphereHeight) return 'orbiting';
  return 'suborbital';
}
