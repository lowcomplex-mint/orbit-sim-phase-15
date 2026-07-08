import type { CelestialBodyConfig } from '../config/celestialBodies';
import { Vec2 } from '../math/Vec2';

/**
 * A planet or moon. Bodies are kinematic ("on rails"): either fixed at the
 * origin or on an analytic circular orbit around their parent. Only the
 * vessel is numerically integrated.
 */
export class CelestialBody {
  /** Gravitational parameter mu = surfaceGravity * radius^2 (m^3/s^2). */
  readonly mu: number;

  constructor(
    readonly config: CelestialBodyConfig,
    readonly parent: CelestialBody | null = null,
  ) {
    this.mu = config.surfaceGravity * config.radiusM * config.radiusM;
    if (config.orbit && !parent) {
      throw new Error(`${config.name} has an orbit config but no parent body`);
    }
  }

  get radiusM(): number {
    return this.config.radiusM;
  }

  get name(): string {
    return this.config.name;
  }

  /** World position at the given simulation time. Deterministic by construction. */
  positionAt(timeSec: number): Vec2 {
    const orbit = this.config.orbit;
    if (!orbit || !this.parent) return Vec2.ZERO;

    // Mean motion of a circular orbit: n = sqrt(mu_parent / r^3).
    const n = Math.sqrt(this.parent.mu / Math.pow(orbit.radiusM, 3));
    const angle = orbit.startAngleRad + n * timeSec;
    return this.parent.positionAt(timeSec).add(Vec2.fromAngle(angle, orbit.radiusM));
  }

  /**
   * World velocity at the given time (analytic derivative of positionAt):
   * tangential speed n*r, perpendicular to the orbit radius. Zero for a
   * body pinned at the origin. Used for body-relative airspeed, impact
   * speed, and landed-on-a-moving-body handling.
   */
  velocityAt(timeSec: number): Vec2 {
    const orbit = this.config.orbit;
    if (!orbit || !this.parent) return Vec2.ZERO;

    const n = Math.sqrt(this.parent.mu / Math.pow(orbit.radiusM, 3));
    const angle = orbit.startAngleRad + n * timeSec;
    return this.parent
      .velocityAt(timeSec)
      .add(Vec2.fromAngle(angle + Math.PI / 2, n * orbit.radiusM));
  }
}
