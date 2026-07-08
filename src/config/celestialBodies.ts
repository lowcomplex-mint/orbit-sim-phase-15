/**
 * Celestial body configuration for the fictional 1:10-scale Earth system.
 * Values are gameplay-tuned, not real. All lengths in meters.
 */

export interface AtmosphereConfig {
  /** Altitude at which the atmosphere (and drag) ends. */
  heightM: number;
  /** Air density at sea level, kg/m^3. */
  seaLevelDensity: number;
  /** Exponential scale height H: density(alt) = rho0 * exp(-alt / H). */
  scaleHeightM: number;
}

/** Analytic circular orbit — the body moves on rails, it is not integrated. */
export interface CircularOrbitConfig {
  radiusM: number;
  /** Position along the orbit at simTime = 0, radians CCW from +X. */
  startAngleRad: number;
}

/** Purely visual surface band (continents etc.), angles CCW from +X in degrees. */
export interface LandPatchConfig {
  fromDeg: number;
  toDeg: number;
  color: number;
}

export interface CelestialBodyConfig {
  id: string;
  name: string;
  radiusM: number;
  /** Surface gravity in m/s^2; mu is derived as g * r^2. */
  surfaceGravity: number;
  atmosphere?: AtmosphereConfig;
  /** If set, the body circles its parent analytically. If unset, it sits at the origin. */
  orbit?: CircularOrbitConfig;
  surfaceColor: number;
  atmosphereColor?: number;
  landPatches?: LandPatchConfig[];
}

export const EARTH_CONFIG: CelestialBodyConfig = {
  id: 'earth',
  name: 'Earth',
  radiusM: 637_100,
  surfaceGravity: 9.81,
  atmosphere: {
    heightM: 70_000,
    seaLevelDensity: 1.225,
    scaleHeightM: 8_500,
  },
  surfaceColor: 0x1d4e89, // ocean blue
  atmosphereColor: 0x63b4ff,
  // The launch pad sits at 90 deg (the "north pole" of the world frame),
  // so keep a green patch there.
  landPatches: [
    { fromDeg: 62, toDeg: 118, color: 0x3e7c3a },
    { fromDeg: 150, toDeg: 205, color: 0x8a7040 },
    { fromDeg: 238, toDeg: 300, color: 0x46804a },
    { fromDeg: 330, toDeg: 355, color: 0x907a4a },
  ],
};

export const MOON_CONFIG: CelestialBodyConfig = {
  id: 'moon',
  name: 'Moon',
  radiusM: 173_700,
  surfaceGravity: 1.62,
  orbit: {
    radiusM: 8_000_000,
    startAngleRad: Math.PI / 4,
  },
  surfaceColor: 0x9a9a9a,
};

/**
 * Whether the Moon's gravity also pulls on the vessel (as a second point mass).
 * At these masses it is negligible near Earth, so it is safe to keep on.
 * TODO: sphere-of-influence switching so the Moon can be orbited properly.
 */
export const APPLY_MOON_GRAVITY = true;

/**
 * The Sun is purely decorative in the MVP: a bright disc far away in the map view.
 * TODO: heliocentric layer once interplanetary flight becomes a goal.
 */
export const SUN_VISUAL = {
  position: { x: -40_000_000, y: 0 },
  radiusM: 2_500_000,
  color: 0xffd75e,
} as const;
