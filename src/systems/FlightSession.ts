import type { LogLevel } from '../app/EventBus';
import { instantiateParts } from '../builder/RocketAssembler';
import { computeOrbitInfo } from '../math/OrbitMath';
import { Vec2 } from '../math/Vec2';
import { atmosphereHeightM } from '../physics/AtmosphereSystem';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import type { StepEvents } from '../physics/RocketPhysics';
import { canPropagateOnRails } from '../space/KeplerOrbit';
import { getDominantBody } from '../space/SphereOfInfluence';
import type { PartDefinition } from '../vehicle/PartDefinition';
import type { RocketDesign } from '../vehicle/RocketDesign';
import { RocketRuntime } from '../vehicle/RocketRuntime';
import {
  TimeWarpMode,
  TimeWarpSystem,
  type RailsEligibility,
} from './TimeWarpSystem';
import { VesselManager, type SerializedVessel, type Vessel } from './VesselManager';

/**
 * A running flight: physics world + vessels + time warp, independent of any
 * scene. It survives scene switches, which is what makes "Resume Active
 * Flight", the Tracking Station, and pausing possible.
 *
 * World-time model: simulation time advances ONLY while a scene updates the
 * session (the flight scene, unpaused). The VAB, Space Center, Tracking
 * Station, and the pause menu are non-simulation areas — time stands still
 * there, consistently for the entire world. TODO: optional background
 * catch-up simulation.
 *
 * DOM-free by design — the headless regression sim drives a FlightSession
 * exactly like the game does, and the save system serializes it wholesale.
 */

export interface SerializedSession {
  simTime: number;
  designName: string;
  vessels: { nextId: number; activeId: number | null; vessels: SerializedVessel[] };
}

export interface SessionOptions {
  /** Live debris-cap getter (Settings). */
  maxDebris?: () => number;
  /** Live reentry-heating difficulty toggle (Settings). */
  heatingEnabled?: () => boolean;
}

export class FlightSession {
  readonly vessels: VesselManager;
  readonly world: PhysicsWorld;
  readonly warp = new TimeWarpSystem();
  readonly designName: string;

  private lastDominantBodyId: string;

  private constructor(
    designName: string,
    private readonly log: (level: LogLevel, message: string) => void,
    options?: SessionOptions,
  ) {
    this.designName = designName;
    this.vessels = new VesselManager(log, options?.maxDebris);
    this.world = new PhysicsWorld(this.vessels, log, {
      heatingEnabled: options?.heatingEnabled,
    });
    this.lastDominantBodyId = this.world.earth.config.id;
  }

  /** Start a brand-new flight of a design, on the pad. */
  static launchNew(
    design: RocketDesign,
    catalog: Map<string, PartDefinition>,
    log: (level: LogLevel, message: string) => void,
    options?: SessionOptions,
  ): FlightSession {
    const session = new FlightSession(design.name, log, options);
    const runtime = new RocketRuntime(instantiateParts(design, catalog));
    // Base flush with the launch-pad platform top (= surface radius).
    runtime.spawnAt(new Vec2(0, session.world.earth.radiusM));
    session.vessels.createVessel({
      name: design.name,
      type: 'activeRocket',
      runtime,
      makeActive: true,
      simTime: 0,
    });
    log(
      'info',
      `Flight session started: "${design.name}", ${runtime.parts.length} parts, ` +
        `${Math.round(runtime.massKg)} kg, ${runtime.totalStageCount} stage(s).`,
    );
    return session;
  }

  /** Reconstruct a session (all vessels, world time) from a save. */
  static fromSave(
    data: SerializedSession,
    catalog: Map<string, PartDefinition>,
    log: (level: LogLevel, message: string) => void,
    options?: SessionOptions,
  ): FlightSession {
    const session = new FlightSession(data.designName, log, options);
    session.world.simTime = data.simTime;
    session.vessels.restore(data.vessels, catalog);
    session.lastDominantBodyId = getDominantBody(
      session.activeRuntime.position,
      data.simTime,
      session.world.bodies,
    ).config.id;
    log(
      'info',
      `Flight session restored: ${data.vessels.vessels.length} vessel(s) at ` +
        `T+${Math.round(data.simTime)}s.`,
    );
    return session;
  }

  serialize(): SerializedSession {
    return {
      simTime: this.world.simTime,
      designName: this.designName,
      vessels: this.vessels.serialize(),
    };
  }

  get activeVessel(): Vessel | null {
    return this.vessels.active;
  }

  /** The controlled rocket. A session always has one (possibly crashed). */
  get activeRuntime(): RocketRuntime {
    const vessel = this.vessels.active ?? this.vessels.vessels[0];
    if (!vessel) throw new Error('Flight session has no vessels');
    return vessel.runtime;
  }

  /** Advance the session by one rendered frame. Returns active-vessel events. */
  update(frameDtSec: number): StepEvents {
    // Any control input cancels rails warp (KSP behavior) — physics needs to
    // integrate again before thrust or rotation can act.
    if (this.warp.mode === TimeWarpMode.RailsWarp) {
      const rt = this.activeRuntime;
      if (rt.throttle > 0 || rt.rotationInput !== 0) {
        this.world.disengageRails();
        this.warp.dropToRealTime();
        this.log('info', 'Rails warp cancelled: control input.');
      }
    }

    const events = this.world.advance(
      frameDtSec,
      this.warp.factor,
      this.warp.mode === TimeWarpMode.RailsWarp,
    );

    // A railed vessel crossed an SOI boundary: its conic is no longer valid,
    // so hand the encounter back to the integrator (KSP-style warp drop).
    if (events.railsSoiBreak) {
      this.world.disengageRails();
      this.warp.dropToRealTime();
      this.log('info', 'Sphere-of-influence transition — rails warp disengaged.');
    }
    if (events.railsAtmosphereBreak) {
      this.world.disengageRails();
      this.warp.dropToRealTime();
      this.log('info', 'Entered the atmosphere — rails warp disengaged.');
    }

    if (events.crashed && this.warp.dropToRealTime()) {
      this.log('info', 'Time warp reset (vessel crashed).');
    }

    this.logSoiTransitions();
    return events;
  }

  /**
   * Step along the warp ladder. Entering rails territory is gated by
   * eligibility; a denial is logged with its reason and the level stays put.
   */
  stepWarp(delta: number): void {
    const current = this.warp.level;
    const target = this.warp.peek(delta);
    if (target === current) return;

    const enteringRails =
      target.mode === TimeWarpMode.RailsWarp && current.mode !== TimeWarpMode.RailsWarp;
    const leavingRails =
      current.mode === TimeWarpMode.RailsWarp && target.mode !== TimeWarpMode.RailsWarp;

    if (enteringRails) {
      const eligibility = this.checkRailsEligibility();
      if (!eligibility.ok) {
        this.log('warn', `Rails warp denied: ${eligibility.reason}`);
        return;
      }
      this.world.engageRails();
    }
    if (leavingRails) this.world.disengageRails();

    if (this.warp.applyStep(delta)) {
      this.log('info', `Time warp: ${this.warp.label}.`);
    }
  }

  /** Fire the next stage of the active vessel (drops rails warp first). */
  stage(): void {
    if (this.warp.mode === TimeWarpMode.RailsWarp) {
      this.world.disengageRails();
      this.warp.dropToRealTime();
      this.log('info', 'Rails warp cancelled: staging.');
    }

    const runtime = this.activeRuntime;
    const result = this.vessels.stageActive(this.world.simTime);
    if (!result) {
      this.log('warn', 'No stages left.');
      return;
    }
    const { groups, armedChutes } = result;
    for (const chute of armedChutes) {
      this.log('info', `${chute} armed.`);
    }
    if (groups.length === 0) {
      this.log(
        'info',
        `Stage ${runtime.currentStageNumber}/${runtime.totalStageCount}: ` +
          (armedChutes.length > 0
            ? 'parachutes armed.'
            : 'engines activated (no separation).'),
      );
      return;
    }
    const partCount = groups.reduce((s, g) => s + g.length, 0);
    this.log(
      'info',
      `Stage ${runtime.currentStageNumber}/${runtime.totalStageCount}: ` +
        `separated ${groups.length} group(s), ${partCount} part(s); ` +
        `mass now ${Math.round(runtime.massKg)} kg.`,
    );
  }

  /**
   * Can the active vessel go on rails right now? SOI-aware: any bound elliptic
   * arc qualifies while outside the dominant body's atmosphere (suborbital
   * return paths included — rails auto-drops on atmosphere entry).
   */
  checkRailsEligibility(): RailsEligibility {
    const rt = this.activeRuntime;
    if (rt.crashed) return { ok: false, reason: 'the vessel is destroyed' };
    if (rt.landed) return { ok: false, reason: 'the vessel is landed' };
    if (rt.throttle > 0) return { ok: false, reason: 'engines are throttled up' };

    const t = this.world.simTime;
    const dominant = getDominantBody(rt.position, t, this.world.bodies);
    const relPos = rt.position.sub(dominant.positionAt(t));
    const relVel = rt.velocity.sub(dominant.velocityAt(t));

    const atmHeight = atmosphereHeightM(dominant);
    const altitude = relPos.length() - dominant.radiusM;
    if (altitude <= atmHeight) {
      return { ok: false, reason: 'the vessel is inside the atmosphere' };
    }

    const info = computeOrbitInfo(relPos, relVel, dominant.mu);
    if (!info.isBound) {
      return {
        ok: false,
        reason: 'the trajectory is escape — hyperbolic rails propagation is TODO',
      };
    }
    if (!canPropagateOnRails(info)) {
      return {
        ok: false,
        reason: 'the orbit is too eccentric (near-parabolic rails propagation is TODO)',
      };
    }
    return { ok: true };
  }

  /**
   * Log SOI boundary crossings of the active vessel. Physics is already
   * dominant-body-aware (collision, atmosphere, telemetry); full frame
   * switching is the remaining TODO (space/SphereOfInfluence.ts).
   */
  private logSoiTransitions(): void {
    const rt = this.activeRuntime;
    const dominant = getDominantBody(rt.position, this.world.simTime, this.world.bodies);
    if (dominant.config.id !== this.lastDominantBodyId) {
      this.log('info', `Entered the sphere of influence of ${dominant.name}.`);
      this.lastDominantBodyId = dominant.config.id;
    }
  }
}
