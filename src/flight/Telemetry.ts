import { classifyOrbit, computeOrbitInfo } from '../math/OrbitMath';
import type { OrbitInfo, OrbitStatus } from '../math/OrbitMath';
import { airDensityAt, atmosphereHeightM } from '../physics/AtmosphereSystem';
import { stagnationFluxWm2 } from '../physics/ThermalModel';
import type { Vec2 } from '../math/Vec2';
import { getDominantBody } from '../space/SphereOfInfluence';
import type { FlightSession } from '../systems/FlightSession';
import type { RocketRuntime } from '../vehicle/RocketRuntime';

/**
 * Everything the HUD, navball, map overlay, and Tracking Station need,
 * derived fresh from physics state. All orbital numbers are relative to the
 * DOMINANT body (Earth normally, the Moon inside its SOI), matching what the
 * SOI-aware physics actually does. Telemetry only reads — it never mutates
 * the simulation.
 */
export interface TelemetrySample {
  /** Name of the body dominating the vessel ("Earth"/"Moon"). */
  bodyName: string;
  altitudeM: number;
  speedMS: number;
  /** null when the trajectory is unbound (escaping). */
  apoapsisAltM: number | null;
  /** Can be negative (periapsis below the surface). */
  periapsisAltM: number;
  fuelKg: number;
  fuelCapacityKg: number;
  throttle: number;
  stageNumber: number;
  stageCount: number;
  massKg: number;
  status: OrbitStatus;
  orbit: OrbitInfo;
  simTime: number;
  warpFactor: number;
  /** Human warp label, e.g. "1x", "4x phys", "250x rails". */
  warpLabel: string;
  // --- Navball angles (world frame, radians CCW from +X) -----------------
  headingRad: number;
  /** Direction of body-relative motion; null below 1 m/s. */
  progradeRad: number | null;
  /** Away from the dominant body's center. */
  radialOutRad: number;
  angularVelocityRadS: number;
  // --- Engineer readouts ---------------------------------------------------
  /** Dynamic pressure q = 0.5 * rho * v_air^2, Pa. */
  dynamicPressurePa: number;
  /** Thrust produced last physics tick, N. */
  thrustN: number;
  /** Thrust-to-weight against local gravity (0 when engines off). */
  twr: number;
  /** Control torque available: reaction wheels + current gimbal, N*m. */
  controlAuthorityNm: number;
  /** Hottest part (by fraction of its thermal limit). */
  hottestPartName: string | null;
  hottestTempK: number;
  hottestMaxTempK: number;
  /** Stagnation heat flux, W/m^2 (reentry FX intensity source). */
  heatFluxWm2: number;
  /** Dominant body's world position (map view draws conics around it). */
  bodyPosition: Vec2;
  /** Parachute aggregate status label, null when no chutes aboard. */
  chuteStatus: string | null;
  electricCharge: number;
  electricCapacity: number;
}

export class Telemetry {
  constructor(private readonly session: FlightSession) {}

  /** Telemetry of the active (controlled) vessel. */
  sample(): TelemetrySample {
    return this.sampleRuntime(this.session.activeRuntime);
  }

  /** Telemetry of any vessel — reused by the Tracking Station list. */
  sampleRuntime(runtime: RocketRuntime): TelemetrySample {
    const { world, warp } = this.session;
    const t = world.simTime;
    const body = getDominantBody(runtime.position, t, world.bodies);

    // Body-relative state vectors: the orbit around a moving body is defined
    // by position AND velocity relative to it.
    const relPos = runtime.position.sub(body.positionAt(t));
    const relVel = runtime.velocity.sub(body.velocityAt(t));

    const orbit = computeOrbitInfo(relPos, relVel, body.mu);
    const atmHeight = atmosphereHeightM(body);
    const status = classifyOrbit(
      orbit,
      body.radiusM,
      atmHeight,
      runtime.landed,
      runtime.crashed,
    );
    const speed = relVel.length();

    const altitude = relPos.length() - body.radiusM;
    const density = airDensityAt(body, altitude);
    const dynamicPressurePa = 0.5 * density * speed * speed;
    const radius = relPos.length();
    const localGravity = body.mu / (radius * radius);
    const twr =
      runtime.massKg > 0 && localGravity > 0
        ? runtime.lastThrustN / (runtime.massKg * localGravity)
        : 0;

    let hottestPartName: string | null = null;
    let hottestTempK = 0;
    let hottestMaxTempK = 1;
    let hottestFraction = -1;
    for (const p of runtime.parts) {
      const fraction = p.temperatureK / p.maxTempK;
      if (fraction > hottestFraction) {
        hottestFraction = fraction;
        hottestPartName = p.def.name;
        hottestTempK = p.temperatureK;
        hottestMaxTempK = p.maxTempK;
      }
    }

    return {
      bodyName: body.name,
      altitudeM: relPos.length() - body.radiusM,
      speedMS: speed,
      apoapsisAltM: orbit.isBound ? orbit.apoapsisRadius - body.radiusM : null,
      periapsisAltM: orbit.periapsisRadius - body.radiusM,
      fuelKg: runtime.activeFuel,
      fuelCapacityKg: runtime.activeFuelCapacity,
      throttle: runtime.throttle,
      stageNumber: runtime.currentStageNumber,
      stageCount: runtime.totalStageCount,
      massKg: runtime.massKg,
      status,
      orbit,
      simTime: t,
      warpFactor: warp.factor,
      warpLabel: warp.label,
      headingRad: runtime.angleRad,
      progradeRad: speed > 1 ? relVel.angle() : null,
      radialOutRad: relPos.angle(),
      angularVelocityRadS: runtime.angularVelocityRadS,
      dynamicPressurePa,
      thrustN: runtime.lastThrustN,
      twr,
      controlAuthorityNm: runtime.reactionWheelNm + runtime.lastGimbalAuthorityNm,
      hottestPartName,
      hottestTempK,
      hottestMaxTempK,
      heatFluxWm2: stagnationFluxWm2(density, speed),
      bodyPosition: body.positionAt(t),
      chuteStatus: runtime.chuteStatusLabel,
      electricCharge: runtime.electricCharge,
      electricCapacity: runtime.electricCapacity,
    };
  }
}
