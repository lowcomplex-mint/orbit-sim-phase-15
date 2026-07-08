import { Vec2 } from '../math/Vec2';
import type { CelestialBody } from './CelestialBody';

/**
 * Sums point-mass gravity from every registered body:
 *   a = -mu * r_hat / |r|^2
 * Bodies are on rails, so their positions come from `positionAt(time)`.
 */
export class GravitySystem {
  constructor(private readonly bodies: CelestialBody[]) {}

  accelerationAt(position: Vec2, timeSec: number): Vec2 {
    let accel = Vec2.ZERO;
    for (const body of this.bodies) {
      const toVessel = position.sub(body.positionAt(timeSec));
      const distSq = toVessel.lengthSq();
      if (distSq < 1) continue; // guard against a singularity at a body's center
      accel = accel.add(toVessel.normalized().scale(-body.mu / distSq));
    }
    return accel;
  }
}
