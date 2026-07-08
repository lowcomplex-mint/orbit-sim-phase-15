import { ATTITUDE_RESPONSE, CRASH_SPEED, ROTATION_RATE } from '../config/constants';
import { SUN_VISUAL } from '../config/celestialBodies';
import { clamp } from '../math/Units';
import { Vec2 } from '../math/Vec2';
import { getDominantBody } from '../space/SphereOfInfluence';
import type { RocketRuntime } from '../vehicle/RocketRuntime';
import { airDensityAt, densityRatioAt } from './AtmosphereSystem';
import { stepThermal } from './ThermalModel';
import type { CelestialBody } from './CelestialBody';
import type { GravitySystem } from './GravitySystem';

/** Things that happened during one physics step; the caller turns these into log lines. */
export interface StepEvents {
  liftoff: boolean;
  landed: boolean;
  crashed: boolean;
  fuelExhausted: boolean;
  /** Names of parts destroyed by overheating this step. */
  partsLost: string[];
  /** Chute/legs/electricity messages, pre-formatted for the log. */
  notices: { level: 'info' | 'warn'; message: string }[];
}

function normalizeAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let x = a % twoPi;
  if (x > Math.PI) x -= twoPi;
  if (x < -Math.PI) x += twoPi;
  return x;
}

/** Impact tolerance with deployed landing legs at the bottom, m/s. */
const LEGS_CRASH_SPEED = 20;

/**
 * Solar illumination 0/1: the (decorative but directional) Sun lights the
 * vessel unless a body's disc blocks the line of sight — so night-side and
 * behind-the-planet orbits genuinely lose solar power.
 * TODO: partial shadowing / panel orientation once panels articulate.
 */
function sunlightFactor(position: Vec2, env: PhysicsEnvironment): number {
  const sunPos = new Vec2(SUN_VISUAL.position.x, SUN_VISUAL.position.y);
  const toSun = sunPos.sub(position);
  const distToSun = toSun.length();
  const dir = toSun.scale(1 / distToSun);
  for (const body of env.bodies) {
    const rel = body.positionAt(env.simTime).sub(position);
    const proj = rel.dot(dir);
    if (proj > 0 && proj < distToSun) {
      // 0.98: grazing tolerance so the launch pad (near the terminator for
      // our fixed Sun) still counts as daylight.
      const lateral = rel.sub(dir.scale(proj)).length();
      if (lateral < body.radiusM * 0.98) return 0;
    }
  }
  return 1;
}

export function emptyStepEvents(): StepEvents {
  return {
    liftoff: false,
    landed: false,
    crashed: false,
    fuelExhausted: false,
    partsLost: [],
    notices: [],
  };
}

export interface PhysicsEnvironment {
  gravity: GravitySystem;
  /** Root-first body list; collision/atmosphere use whichever body dominates. */
  bodies: CelestialBody[];
  simTime: number;
  /** Difficulty toggle: reentry heating on/off. */
  heatingEnabled: boolean;
}

/**
 * Advance the rocket by one fixed timestep.
 *
 * Translation: semi-implicit Euler (v += a dt; x += v dt) — symplectic, so
 * orbital energy stays bounded over many orbits.
 *
 * Attitude: physically integrated. The player's A/D input is a RATE command;
 * an SAS-style controller applies control torque bounded by the vessel's
 * real authority (reaction wheels + engine gimbal x lever arm from the CoM)
 * against the moment of inertia of the actual mass distribution, and the
 * stack rotates about its live center of mass. Heavy vessels respond
 * sluggishly; a light upper stage snaps around. With no input the
 * controller damps angular velocity to zero (stability assist).
 *
 * SOI-awareness: altitude, atmosphere, airspeed, and ground collision are
 * evaluated against the DOMINANT body (space/SphereOfInfluence), so Moon
 * encounters behave sensibly. State vectors remain world-frame.
 * TODO: body-relative frames for precision far from the origin
 * (space/CelestialFrame.ts).
 */
export function stepRocket(
  rocket: RocketRuntime,
  env: PhysicsEnvironment,
  dt: number,
): StepEvents {
  const events = emptyStepEvents();
  if (rocket.crashed) return events;

  const dominant = getDominantBody(rocket.position, env.simTime, env.bodies);
  const bodyPos = dominant.positionAt(env.simTime);
  const bodyVel = dominant.velocityAt(env.simTime);
  const rel = rocket.position.sub(bodyPos);
  const altitude = rel.length() - dominant.radiusM;
  const ratio = densityRatioAt(dominant, altitude);
  /** Velocity relative to the dominant body (drag, heating, SAS prograde). */
  const airspeed = rocket.velocity.sub(bodyVel);

  // --- Gravity (all bodies, point masses). ---
  let accel = env.gravity.accelerationAt(rocket.position, env.simTime);

  // --- Thrust + fuel (per lit engine group; see RocketRuntime). ---
  const propulsion = rocket.computePropulsion(ratio, dt);
  if (propulsion.forceN > 0) {
    accel = accel.add(
      Vec2.fromAngle(rocket.angleRad, propulsion.forceN / rocket.massKg),
    );
  }
  if (propulsion.starvedNow) events.fuelExhausted = true;

  // --- Electricity: avionics drain, solar generation (eclipse-aware). ---
  if (rocket.updateElectricity(dt, sunlightFactor(rocket.position, env))) {
    events.notices.push({
      level: 'warn',
      message: 'Electricity depleted — reaction wheels offline.',
    });
  }

  // --- Launch clamps: the vessel is bolted to the pad until they release
  // through staging. Engines may burn (fuel drains) but nothing moves. ---
  if (rocket.hasLaunchClamps) {
    rocket.velocity = Vec2.ZERO;
    rocket.angularVelocityRadS = 0;
    rocket.landed = true;
    return events;
  }

  // --- Attitude: rate-command controller with physical torque limits, plus
  // the DISTURBANCE torque of off-CoM thrust (asymmetric boosters). The
  // controller fights the disturbance only up to its authority — losing one
  // of two boosters is genuinely hard to fly, as it should be.
  // SAS modes: player input overrides; otherwise 'stability' damps,
  // prograde/retrograde chase the body-relative velocity direction, and
  // 'off' applies no control torque at all. ---
  if (!rocket.landed) {
    const inertia = rocket.momentOfInertiaKgM2;
    const maxTorque = rocket.reactionWheelNm + propulsion.gimbalAuthorityNm;

    let targetRate: number | null;
    if (rocket.rotationInput !== 0) {
      targetRate = rocket.rotationInput * ROTATION_RATE;
    } else {
      switch (rocket.sasMode) {
        case 'off':
          targetRate = null; // no control torque; disturbances act freely
          break;
        case 'prograde':
        case 'retrograde': {
          const speed = airspeed.length();
          if (speed < 5) {
            targetRate = 0;
          } else {
            const target =
              airspeed.angle() + (rocket.sasMode === 'retrograde' ? Math.PI : 0);
            const error = normalizeAngle(target - rocket.angleRad);
            targetRate = clamp(error * 2, -ROTATION_RATE, ROTATION_RATE);
          }
          break;
        }
        default:
          targetRate = 0; // stability assist
      }
    }

    const controlTorque =
      targetRate === null
        ? 0
        : clamp(
            (targetRate - rocket.angularVelocityRadS) * inertia * ATTITUDE_RESPONSE -
              propulsion.netTorqueNm, // feed-forward: trims steady disturbance
            -maxTorque,
            maxTorque,
          );
    rocket.angularVelocityRadS +=
      ((controlTorque + propulsion.netTorqueNm) / inertia) * dt;

    const dTheta = rocket.angularVelocityRadS * dt;
    if (dTheta !== 0) {
      // Rotate about the live center of mass, not the stack base. The CoM's
      // lateral offset is zero for center-column stacks (see CenterOfMass).
      const com = rocket.centerOfMassLocalM;
      const comWorld = com
        ? rocket.position.add(Vec2.fromAngle(rocket.angleRad, com.y))
        : rocket.position;
      rocket.angleRad += dTheta;
      rocket.position = comWorld.add(rocket.position.sub(comWorld).rotated(dTheta));
    }
  } else {
    rocket.angularVelocityRadS = 0;
  }

  // --- Parachutes: gradual deployment + failures (RocketRuntime). ---
  const density = airDensityAt(dominant, altitude);
  const airSpeedNow = airspeed.length();
  const dynamicPressure = 0.5 * density * airSpeedNow * airSpeedNow;
  events.notices.push(
    ...rocket.stepChutes(density, airSpeedNow, dynamicPressure, altitude, dt),
  );

  // --- Drag: F = 0.5 * rho * v_air^2 * (Cd*A + deployed canopies). ---
  // The atmosphere moves with its (possibly orbiting) body.
  const totalCdA = rocket.dragCdA + rocket.chuteDragCdA;
  if (density > 0 && totalCdA > 0 && airSpeedNow > 0.01) {
    const dragForce = dynamicPressure * totalCdA;
    accel = accel.add(airspeed.normalized().scale(-dragForce / rocket.massKg));
  }

  // --- Reentry heating (physics/ThermalModel): heats the leading end,
  // radiates everywhere; parts above their limit are destroyed. ---
  if (env.heatingEnabled) {
    const thermal = stepThermal(rocket, density, airspeed, dt);
    if (thermal.failed.length > 0) {
      for (const part of thermal.failed) events.partsLost.push(part.def.name);
      const vesselLost = rocket.destroyParts(thermal.failed);
      if (vesselLost) {
        events.crashed = true;
        return events; // nothing left to integrate
      }
    }
  }

  // --- Semi-implicit Euler integration. ---
  rocket.velocity = rocket.velocity.add(accel.scale(dt));
  rocket.position = rocket.position.add(rocket.velocity.scale(dt));

  // --- Ground contact with the dominant body. Deployed landing legs at the
  // bottom raise the crash tolerance; a hard-but-survivable hit breaks them.
  const relNew = rocket.position.sub(bodyPos);
  if (relNew.length() <= dominant.radiusM) {
    const impactSpeed = rocket.velocity.sub(bodyVel).length();
    rocket.position = bodyPos.add(relNew.normalized().scale(dominant.radiusM));
    // A landed vessel rides with its body (Earth is static; the Moon isn't).
    rocket.velocity = bodyVel;
    rocket.angularVelocityRadS = 0;
    if (!rocket.landed) {
      const hasLegs = rocket.legsDeployedAtBottom;
      const tolerance = hasLegs ? LEGS_CRASH_SPEED : CRASH_SPEED;
      if (impactSpeed > tolerance) {
        rocket.crashed = true;
        events.crashed = true;
      } else {
        if (hasLegs && impactSpeed > CRASH_SPEED) {
          const broken = rocket.breakBottomLegs();
          if (broken.length > 0) {
            events.notices.push({
              level: 'warn',
              message: `Hard landing — ${broken.join(', ')} broke absorbing the impact.`,
            });
          }
        }
        events.landed = true;
      }
      rocket.landed = true;
    }
  } else if (rocket.landed && relNew.length() - dominant.radiusM > 0.05) {
    rocket.landed = false;
    events.liftoff = true;
  }

  return events;
}
