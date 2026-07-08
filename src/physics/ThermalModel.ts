import { AMBIENT_TEMP_K, PART_HEAT_CAPACITY } from '../config/constants';
import { Vec2 } from '../math/Vec2';
import type { PartInstance } from '../vehicle/PartInstance';
import type { RocketRuntime } from '../vehicle/RocketRuntime';

/**
 * Reentry heating, phase 1 (supersedes the old future/ThermalSystem stub).
 *
 * Per fixed physics step, every part integrates a temperature:
 *   dT = (stagnationHeating * exposure - radiation - convection) / heatCapacity
 *
 *  - Stagnation flux is Sutton-Graves: q = k * sqrt(rho / r_n) * v^3.
 *  - ORIENTATION MATTERS: the part leading into the airstream takes the
 *    full flux — flying nose-first that's the top part; entering retrograde
 *    it's the BOTTOM part, which is why heat shields are mounted there.
 *    Everything else sits in the wake at a small fraction.
 *  - Cooling: radiation (T^4, dominant when glowing) + convection against
 *    ambient air (returns parts to ambient in the lower atmosphere).
 *  - A part above its maxTempK fails and is destroyed
 *    (RocketRuntime.destroyParts handles the structural consequences).
 *
 * TODO: heat shield ablation (mass loss), part-to-part conduction, fairing
 * shielding, occlusion by the leading part's actual silhouette.
 */

const SUTTON_GRAVES_K = 1.7415e-4;
/** Effective stagnation nose radius, m (gentler flux for blunter shapes later). */
const NOSE_RADIUS_M = 0.5;
const STEFAN_BOLTZMANN = 5.67e-8;
const EMISSIVITY = 0.85;
/** Wake exposure: flux fraction reaching parts behind the leading one. */
const WAKE_EXPOSURE = 0.12;
/** Convective exchange coefficient, W/(m^2*K) per unit air density. */
const CONVECTIVE_K = 25;
/**
 * Gameplay scaling. Physical Sutton-Graves flux against a whole part's
 * thermal mass would take tens of minutes to matter; real heating is a SKIN
 * phenomenon. We integrate against an effective skin mass (a fraction of
 * part mass) and boost flux, tuned so a hot uncontrolled reentry destroys
 * unshielded parts in tens of seconds while a normal ascent only warms them.
 */
const GAMEPLAY_FLUX_FACTOR = 3;
const SKIN_MASS_FRACTION = 0.15;
const MIN_SKIN_MASS_KG = 15;

export interface ThermalStepResult {
  /** Parts that exceeded their thermal limit this step. */
  failed: PartInstance[];
}

export function stepThermal(
  rocket: RocketRuntime,
  airDensity: number,
  airspeed: Vec2,
  dt: number,
): ThermalStepResult {
  const result: ThermalStepResult = { failed: [] };
  if (rocket.parts.length === 0) return result;

  const speed = airspeed.length();
  const stagnationFlux =
    airDensity > 0 && speed > 1
      ? SUTTON_GRAVES_K *
        Math.sqrt(airDensity / NOSE_RADIUS_M) *
        speed ** 3 *
        GAMEPLAY_FLUX_FACTOR
      : 0;

  // Which end faces the airstream? Compare airspeed with the heading.
  const movingNoseFirst =
    airspeed.dot(Vec2.fromAngle(rocket.angleRad)) >= 0;
  let leading = rocket.parts[0];
  for (const p of rocket.parts) {
    if (movingNoseFirst ? p.topCells > leading.topCells : p.yCells < leading.yCells) {
      leading = p;
    }
  }

  for (const part of rocket.parts) {
    const area = part.frontalAreaM2;
    const exposure = part === leading ? 1 : WAKE_EXPOSURE;
    const heatIn = stagnationFlux * area * exposure;

    const t = part.temperatureK;
    // Radiate from both faces; convect against ambient air when present.
    const radiated =
      EMISSIVITY * STEFAN_BOLTZMANN * area * 2 * (t ** 4 - AMBIENT_TEMP_K ** 4);
    const convected = CONVECTIVE_K * airDensity * area * (t - AMBIENT_TEMP_K);

    const skinMass = Math.max(part.mass * SKIN_MASS_FRACTION, MIN_SKIN_MASS_KG);
    const heatCapacity = skinMass * PART_HEAT_CAPACITY;
    part.temperatureK = Math.max(
      150,
      t + ((heatIn - radiated - convected) / heatCapacity) * dt,
    );

    if (part.temperatureK > part.maxTempK) result.failed.push(part);
  }
  return result;
}

/** 0..1 "glow" fraction for rendering (starts glowing around 600 K). */
export function glowFraction(part: PartInstance): number {
  const start = 600;
  if (part.temperatureK <= start) return 0;
  return Math.min(1, (part.temperatureK - start) / (part.maxTempK - start));
}

/** Current stagnation heat flux, W/m^2 — drives the reentry visual effect. */
export function stagnationFluxWm2(airDensity: number, speedMS: number): number {
  if (airDensity <= 0 || speedMS <= 1) return 0;
  return (
    SUTTON_GRAVES_K *
    Math.sqrt(airDensity / NOSE_RADIUS_M) *
    speedMS ** 3 *
    GAMEPLAY_FLUX_FACTOR
  );
}
