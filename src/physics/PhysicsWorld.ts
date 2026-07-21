import type { LogLevel } from '../app/EventBus';
import {
  APPLY_MOON_GRAVITY,
  EARTH_CONFIG,
  MOON_CONFIG,
} from '../config/celestialBodies';
import { MAX_STEPS_PER_FRAME, PHYSICS_DT } from '../config/constants';
import { computeOrbitInfo } from '../math/OrbitMath';
import { canPropagateOnRails, captureRailsOrbit, propagateRailsOrbit } from '../space/KeplerOrbit';
import { getDominantBody } from '../space/SphereOfInfluence';
import type { Vessel, VesselManager } from '../systems/VesselManager';
import { AtmosphereSystem, atmosphereHeightM } from './AtmosphereSystem';
import { CelestialBody } from './CelestialBody';
import { GravitySystem } from './GravitySystem';
import { emptyStepEvents, stepRocket, type StepEvents } from './RocketPhysics';

/**
 * Owns the simulation clock and everything physical: celestial bodies,
 * gravity, atmosphere, and all simulated vessels (via VesselManager).
 *
 * Two propagation regimes:
 *  - Integration (real time / physics warp): fixed PHYSICS_DT steps only,
 *    warp = more steps per frame, never a bigger dt — deterministic
 *    regardless of frame rate.
 *  - Rails (rails warp): vessels with captured Kepler elements get their
 *    state set analytically each frame; no integration error at any factor.
 *
 * TODO (heliocentric): Earth is pinned at the origin — see
 * space/CelestialFrame.ts for the migration plan before that can change.
 */
export class PhysicsWorld {
  readonly earth: CelestialBody;
  readonly moon: CelestialBody;
  readonly gravity: GravitySystem;
  readonly atmosphere: AtmosphereSystem;
  /** Root-first body list, as expected by space/SphereOfInfluence. */
  readonly bodies: CelestialBody[];

  simTime = 0;

  /** Unconsumed frame time, always < PHYSICS_DT. */
  private accumulator = 0;

  constructor(
    readonly vessels: VesselManager,
    private readonly log: (level: LogLevel, message: string) => void,
    /** Live difficulty toggles (Settings). */
    private readonly options?: { heatingEnabled?: () => boolean },
  ) {
    this.earth = new CelestialBody(EARTH_CONFIG);
    this.moon = new CelestialBody(MOON_CONFIG, this.earth);
    this.bodies = [this.earth, this.moon];
    this.gravity = new GravitySystem(
      APPLY_MOON_GRAVITY ? [this.earth, this.moon] : [this.earth],
    );
    this.atmosphere = new AtmosphereSystem(this.earth);
  }

  /**
   * Advance by (frameDt * factor) seconds. Returns what happened to the
   * ACTIVE vessel this frame (debris events are logged internally), plus
   * whether rails warp must drop because a railed vessel crossed an SOI
   * boundary (the conic is only valid around its capture body).
   */
  advance(
    frameDtSec: number,
    factor: number,
    onRails: boolean,
  ): StepEvents & { railsSoiBreak?: boolean; railsAtmosphereBreak?: boolean } {
    return onRails
      ? this.advanceOnRails(frameDtSec * factor)
      : this.advanceIntegrated(frameDtSec * factor);
  }

  private advanceIntegrated(simDtSec: number): StepEvents {
    this.accumulator += simDtSec;
    let steps = Math.floor(this.accumulator / PHYSICS_DT);
    if (steps > MAX_STEPS_PER_FRAME) {
      // Too far behind (e.g. tab was suspended): drop the excess instead of
      // freezing. Only the real-time-to-sim-time mapping stretches.
      steps = MAX_STEPS_PER_FRAME;
      this.accumulator = 0;
    } else {
      this.accumulator -= steps * PHYSICS_DT;
    }

    const activeEvents = emptyStepEvents();
    const active = this.vessels.active;

    for (let i = 0; i < steps; i++) {
      const env = {
        gravity: this.gravity,
        bodies: this.bodies,
        simTime: this.simTime,
        heatingEnabled: this.options?.heatingEnabled?.() ?? true,
      };
      let activeCrashed = false;

      for (const vessel of [...this.vessels.vessels]) {
        if (!vessel.simulated) continue;
        const events = stepRocket(vessel.runtime, env, PHYSICS_DT);
        if (vessel === active) {
          activeEvents.liftoff ||= events.liftoff;
          activeEvents.landed ||= events.landed;
          activeEvents.crashed ||= events.crashed;
          activeEvents.fuelExhausted ||= events.fuelExhausted;
          activeEvents.partsLost.push(...events.partsLost);
          activeCrashed = events.crashed;
        } else {
          this.handleUncontrolledEvents(vessel, events);
        }
      }

      this.simTime += PHYSICS_DT;
      if (activeCrashed) break; // the caller resets warp; no need to catch up
    }
    return activeEvents;
  }

  private advanceOnRails(
    simDtSec: number,
  ): StepEvents & { railsSoiBreak?: boolean; railsAtmosphereBreak?: boolean } {
    this.simTime += simDtSec;
    let soiBreak = false;
    let atmosBreak = false;
    for (const vessel of this.vessels.vessels) {
      if (!vessel.railsOrbit) continue;
      // Conic is BODY-RELATIVE: translate by the capture body's live state.
      const body =
        this.bodies.find((b) => b.config.id === vessel.railsBodyId) ?? this.earth;
      const state = propagateRailsOrbit(vessel.railsOrbit, this.simTime);
      vessel.runtime.position = body.positionAt(this.simTime).add(state.position);
      vessel.runtime.velocity = body.velocityAt(this.simTime).add(state.velocity);

      const relPos = vessel.runtime.position.sub(body.positionAt(this.simTime));
      const altitude = relPos.length() - body.radiusM;
      if (altitude <= atmosphereHeightM(body)) atmosBreak = true;

      // If the vessel drifted into another body's SOI (e.g. a trans-lunar
      // ellipse reaching the Moon), the captured conic is no longer the
      // truth — drop to integration so the encounter is flown for real.
      const dominantNow = getDominantBody(
        vessel.runtime.position,
        this.simTime,
        this.bodies,
      );
      if (dominantNow.config.id !== vessel.railsBodyId) soiBreak = true;
    }
    return { ...emptyStepEvents(), railsSoiBreak: soiBreak, railsAtmosphereBreak: atmosBreak };
  }

  /**
   * Put every simulated vessel on rails AROUND ITS OWN DOMINANT BODY —
   * a lunar orbiter rails around the Moon while debris rails around Earth.
   * The caller has already validated the ACTIVE vessel; uncontrolled vessels
   * that cannot ride rails (escape trajectories) are removed,
   * KSP-style, with an honest log.
   * TODO: integrate airborne debris across rails warp instead of removing it.
   */
  engageRails(): void {
    for (const vessel of [...this.vessels.vessels]) {
      if (!vessel.simulated) continue; // wrecks on the ground stay put

      const rt = vessel.runtime;
      const body = getDominantBody(rt.position, this.simTime, this.bodies);
      const relPos = rt.position.sub(body.positionAt(this.simTime));
      const relVel = rt.velocity.sub(body.velocityAt(this.simTime));
      const info = computeOrbitInfo(relPos, relVel, body.mu);
      const captured = canPropagateOnRails(info)
        ? captureRailsOrbit(relPos, relVel, body.mu, this.simTime)
        : null;

      if (captured) {
        vessel.railsOrbit = captured;
        vessel.railsBodyId = body.config.id;
      } else if (vessel.controllable) {
        // Should be unreachable: FlightSession checks eligibility first.
        this.log('error', 'Rails warp engaged with an ineligible active vessel.');
      } else {
        this.vessels.destroyVessel(
          vessel,
          `not on a propagatable orbit at rails warp (e=${info.eccentricity.toFixed(2)}; per-vessel propagation TODO)`,
        );
      }
    }
    this.accumulator = 0;
  }

  /**
   * Hand every railed vessel back to the integrator. State vectors were kept
   * current during rails, so this only clears the captured elements.
   */
  disengageRails(): void {
    for (const vessel of this.vessels.vessels) {
      vessel.railsOrbit = null;
      vessel.railsBodyId = null;
    }
    this.accumulator = 0;
  }

  private handleUncontrolledEvents(vessel: Vessel, events: StepEvents): void {
    if (events.partsLost.length > 0 && vessel.runtime.parts.length === 0) {
      this.vessels.destroyVessel(vessel, 'burned up on reentry');
      return;
    }
    if (events.crashed) {
      this.log('info', `"${vessel.name}" impacted the surface.`);
      vessel.simulated = false; // leave the wreck where it fell
    } else if (events.landed) {
      this.log('info', `"${vessel.name}" touched down intact.`);
      vessel.simulated = false;
    }
  }
}
