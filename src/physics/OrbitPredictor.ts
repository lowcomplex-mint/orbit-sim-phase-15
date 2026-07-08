import type { OrbitInfo } from '../math/OrbitMath';
import { Vec2 } from '../math/Vec2';

/**
 * Produces a polyline of the current two-body conic for the map view.
 * Because the MVP only integrates Earth (+ negligible Moon) gravity, the
 * analytic conic IS the trajectory — no numerical propagation needed.
 */
export function predictOrbitPoints(
  info: OrbitInfo,
  currentPosition: Vec2,
  samples = 240,
  /** Don't draw hyperbolic legs further out than this radius, m. */
  maxRadius = 40_000_000,
): Vec2[] {
  const { eccentricity: e, semiLatusRectum: p } = info;
  // Degenerate (radial) trajectory: no angular momentum, no drawable conic.
  if (p < 1) return [];

  // Periapsis direction comes from the eccentricity vector; for a perfectly
  // circular orbit any direction works, so use the current position.
  const periapsisDir =
    e > 1e-6 ? info.eccVector.normalized() : currentPosition.normalized();

  const points: Vec2[] = [];
  if (e < 1) {
    // Ellipse: sweep the full true anomaly range.
    for (let i = 0; i <= samples; i++) {
      const nu = (i / samples) * Math.PI * 2;
      const r = p / (1 + e * Math.cos(nu));
      points.push(periapsisDir.rotated(nu).scale(r));
    }
  } else {
    // Hyperbola/parabola: r -> infinity as nu approaches the asymptote
    // angle acos(-1/e), so sample a safely clipped range around periapsis.
    const nuLimit = Math.acos(-1 / Math.max(e, 1.000001)) * 0.95;
    for (let i = 0; i <= samples; i++) {
      const nu = -nuLimit + (i / samples) * 2 * nuLimit;
      const r = p / (1 + e * Math.cos(nu));
      if (r > maxRadius || r <= 0) continue;
      points.push(periapsisDir.rotated(nu).scale(r));
    }
  }
  return points;
}
