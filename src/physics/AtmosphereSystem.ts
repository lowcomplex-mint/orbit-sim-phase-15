import type { CelestialBody } from './CelestialBody';

/**
 * Exponential atmosphere model, usable for ANY body (SOI-aware physics asks
 * about whichever body currently dominates the vessel):
 *   density(alt) = seaLevelDensity * exp(-alt / scaleHeight)
 * hard-cut to zero above the configured atmosphere height. Bodies without an
 * atmosphere config (the Moon) simply return zero everywhere.
 */

export function atmosphereHeightM(body: CelestialBody): number {
  return body.config.atmosphere?.heightM ?? 0;
}

export function airDensityAt(body: CelestialBody, altitudeM: number): number {
  const atm = body.config.atmosphere;
  if (!atm || altitudeM > atm.heightM) return 0;
  return atm.seaLevelDensity * Math.exp(-Math.max(0, altitudeM) / atm.scaleHeightM);
}

/** Density relative to the body's sea level, 0..1. Blends engine thrust/Isp. */
export function densityRatioAt(body: CelestialBody, altitudeM: number): number {
  const atm = body.config.atmosphere;
  if (!atm) return 0;
  return airDensityAt(body, altitudeM) / atm.seaLevelDensity;
}

/**
 * Convenience wrapper bound to one body (the home body's atmosphere is what
 * the map view and rails-warp gating care about).
 */
export class AtmosphereSystem {
  constructor(private readonly body: CelestialBody) {}

  get heightM(): number {
    return atmosphereHeightM(this.body);
  }

  densityAt(altitudeM: number): number {
    return airDensityAt(this.body, altitudeM);
  }

  densityRatioAt(altitudeM: number): number {
    return densityRatioAt(this.body, altitudeM);
  }
}
