/**
 * Global tuning constants. Everything here is in SI units
 * (meters, kilograms, seconds, newtons, radians) unless the name says otherwise.
 */

/** Fixed physics timestep in seconds. The simulation only ever advances in these steps. */
export const PHYSICS_DT = 1 / 60;

/** Standard gravity, used to convert Isp (s) to exhaust velocity / mass flow. */
export const G0 = 9.81;

/** Builder grid cell size in meters. Part sizes and placements are multiples of this × snap step. */
export const GRID_CELL_METERS = 0.5;

/**
 * Physics-warp factors (KSP-style cap at 4x). Physics warp runs N fixed
 * substeps per frame — bit-identical to real time, safe under thrust and in
 * atmosphere, but bounded so the frame budget can never explode.
 * The first entry must be 1 (real time).
 */
export const PHYSICS_WARP_LEVELS = [1, 2, 3, 4] as const;

/**
 * Rails-warp factors. Rails warp propagates a captured Kepler orbit
 * analytically (space/KeplerOrbit.ts): exact at any factor, but only allowed
 * for unpowered vessels on stable orbits clear of the atmosphere.
 */
export const RAILS_WARP_LEVELS = [10, 50, 250, 1000] as const;

/** Hard cap on physics steps per rendered frame so a stalled tab can never freeze the game. */
export const MAX_STEPS_PER_FRAME = 2000;

/** Impact speed above which touching the ground counts as a crash, in m/s. */
export const CRASH_SPEED = 12;

/**
 * Maximum commanded rotation RATE in rad/s while holding A/D. The SAS-style
 * controller in RocketPhysics chases this rate with torque bounded by the
 * vessel's real authority (reaction wheels + engine gimbal), so heavy stacks
 * lag behind it and light stages reach it quickly.
 */
export const ROTATION_RATE = 1.2;

/**
 * Attitude controller stiffness, 1/s: how aggressively the controller
 * requests torque toward the target rate. Higher = snappier (until the
 * torque limit clips it).
 */
export const ATTITUDE_RESPONSE = 4;

/** Throttle change per second while holding W/S. */
export const THROTTLE_KEY_RATE = 0.6;

/** Builder view settings. Grid bounds are in cells; the origin column is x = 0. */
export const BUILDER = {
  minXCells: -24,
  maxXCells: 24,
  minYCells: 0,
  maxYCells: 60,
  /** How close (in cells) the pointer must be to a valid attachment to snap. */
  snapRadiusCells: 4,
  /** Vertical extent (m) the initial fit-view frames. */
  viewHeightM: 18,
  /** Editor camera zoom range, px per meter. */
  minPxPerMeter: 8,
  maxPxPerMeter: 140,
} as const;

// ----------------------------------------------------------- thermal model --
/** Ambient temperature parts equalize toward, K. */
export const AMBIENT_TEMP_K = 288;
/** Effective heat capacity used for part temperature integration, J/(kg*K). */
export const PART_HEAT_CAPACITY = 800;
/** Dynamic pressure above which the "high aerodynamic stress" warning fires, Pa. */
export const MAX_Q_WARNING_PA = 30_000;
/** Stagnation flux at which the reentry visual effect reaches full intensity, W/m^2. */
export const REENTRY_FX_FULL_FLUX = 1.2e6;

/** Flight camera zoom range, in pixels per meter. */
export const FLIGHT_CAMERA = {
  initialPxPerMeter: 8,
  minPxPerMeter: 0.02,
  maxPxPerMeter: 24,
} as const;

/** Map camera zoom range, in pixels per meter (whole system scale). */
export const MAP_CAMERA = {
  initialPxPerMeter: 4e-5,
  minPxPerMeter: 4e-7,
  maxPxPerMeter: 0.01,
} as const;
