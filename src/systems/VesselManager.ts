import type { LogLevel } from '../app/EventBus';
import type { RailsOrbitState } from '../space/KeplerOrbit';
import type { PartDefinition } from '../vehicle/PartDefinition';
import type { PartInstance } from '../vehicle/PartInstance';
import { RocketRuntime, type SerializedRuntime } from '../vehicle/RocketRuntime';

/**
 * Every flying (or resting) object is a Vessel: the persistent world model.
 * The player controls exactly one vessel at a time (`activeId`), but control
 * can be switched from the Tracking Station to any vessel that still has a
 * command pod. Debris free-falls with the same integrator and persists in
 * the world (and in saves) until the player deletes it or the debris cap
 * trims the oldest.
 *
 * TODO (persistence): stations/probes as designed vessel types with their
 * own spawn flows; today they only arise from staging (a jettisoned segment
 * containing a pod becomes a controllable 'probe').
 */

export type VesselType = 'activeRocket' | 'debris' | 'lander' | 'probe' | 'station';

export interface Vessel {
  id: number;
  name: string;
  type: VesselType;
  runtime: RocketRuntime;
  /** Has a command pod, so control can be switched to it. */
  controllable: boolean;
  /**
   * Whether the integrator steps this vessel. Turned off for wrecks resting
   * on the ground so they stay put for free.
   */
  simulated: boolean;
  /** Non-null while this vessel is being propagated analytically (rails warp). */
  railsOrbit: RailsOrbitState | null;
  /** Body the rails elements are relative to ('earth'/'moon'). */
  railsBodyId: string | null;
  createdAtSimTime: number;
  /** Which body's frame the vessel lives in. Always 'earth' until SOI work. */
  parentBodyId: string;
}

export interface SerializedVessel {
  id: number;
  name: string;
  type: VesselType;
  controllable: boolean;
  simulated: boolean;
  createdAtSimTime: number;
  runtime: SerializedRuntime;
}

/** Small retrograde kick given to jettisoned stages so they visibly separate. */
const SEPARATION_PUSH_MS = 1.5;

export class VesselManager {
  readonly vessels: Vessel[] = [];
  private nextId = 1;
  private activeId: number | null = null;

  constructor(
    private readonly log: (level: LogLevel, message: string) => void,
    /** Live getter so the Settings screen can change the cap at runtime. */
    private readonly maxDebris: () => number = () => 6,
  ) {}

  get active(): Vessel | null {
    return this.vessels.find((v) => v.id === this.activeId) ?? null;
  }

  /** Switch control to another vessel (Tracking Station). */
  setActive(id: number): boolean {
    const vessel = this.vessels.find((v) => v.id === id);
    if (!vessel || !vessel.controllable || vessel.runtime.crashed) return false;
    if (this.activeId === id) return true;
    this.activeId = id;
    this.log('info', `Control switched to "${vessel.name}".`);
    return true;
  }

  createVessel(options: {
    name: string;
    type: VesselType;
    runtime: RocketRuntime;
    makeActive: boolean;
    simTime: number;
  }): Vessel {
    const vessel: Vessel = {
      id: this.nextId++,
      name: options.name,
      type: options.type,
      runtime: options.runtime,
      controllable: hasCommandPod(options.runtime.parts),
      simulated: true,
      railsOrbit: null,
      railsBodyId: null,
      createdAtSimTime: options.simTime,
      parentBodyId: 'earth',
    };
    this.vessels.push(vessel);
    if (options.makeActive) this.activeId = vessel.id;
    this.log('info', `Vessel created: "${vessel.name}" (${vessel.type}).`);
    this.enforceDebrisCap();
    return vessel;
  }

  destroyVessel(vessel: Vessel, reason: string): void {
    const index = this.vessels.indexOf(vessel);
    if (index < 0) return;
    this.vessels.splice(index, 1);
    if (this.activeId === vessel.id) this.activeId = null;
    this.log('info', `Vessel removed: "${vessel.name}" — ${reason}.`);
  }

  /**
   * Stage the active vessel. Every jettisoned group (side boosters separate
   * as SEVERAL groups at once) becomes a persistent debris vessel — or a
   * controllable 'probe' if it carries a pod — placed at its own base
   * position with a small push away from the parent's center of mass. The
   * active vessel's own state is untouched, keeping ascents deterministic.
   *
   * Returns the jettisoned groups ([] = hot stage, null = nothing to stage).
   */
  stageActive(
    simTime: number,
  ): { groups: PartInstance[][]; armedChutes: string[] } | null {
    const vessel = this.active;
    if (!vessel) return null;
    const runtime = vessel.runtime;

    const baseVelocity = runtime.velocity;
    const heading = runtime.angleRad;
    const landed = runtime.landed;
    const spin = runtime.angularVelocityRadS;

    const result = runtime.stage();
    if (!result) return null;
    const { groups, armedChutes } = result;

    for (const group of groups) {
      const debris = new RocketRuntime(group.parts);
      debris.position = group.basePositionWorld;
      debris.velocity = baseVelocity.add(group.pushDirWorld.scale(SEPARATION_PUSH_MS));
      debris.angleRad = heading;
      debris.angularVelocityRadS = spin;
      debris.landed = landed;

      const withPod = hasCommandPod(group.parts);
      this.createVessel({
        name: `${vessel.name} — jettisoned at stage ${runtime.stagesFired}`,
        type: withPod ? 'probe' : 'debris',
        runtime: debris,
        makeActive: false,
        simTime,
      });
    }
    return { groups: groups.map((g) => g.parts), armedChutes };
  }

  // ---------------------------------------------------------- persistence --

  serialize(): { nextId: number; activeId: number | null; vessels: SerializedVessel[] } {
    return {
      nextId: this.nextId,
      activeId: this.activeId,
      vessels: this.vessels.map((v) => ({
        id: v.id,
        name: v.name,
        type: v.type,
        controllable: v.controllable,
        simulated: v.simulated,
        createdAtSimTime: v.createdAtSimTime,
        runtime: v.runtime.serialize(),
      })),
    };
  }

  restore(
    data: { nextId: number; activeId: number | null; vessels: SerializedVessel[] },
    catalog: Map<string, PartDefinition>,
  ): void {
    this.vessels.length = 0;
    for (const v of data.vessels) {
      this.vessels.push({
        id: v.id,
        name: v.name,
        type: v.type,
        runtime: RocketRuntime.restore(v.runtime, catalog),
        controllable: v.controllable,
        simulated: v.simulated,
        railsOrbit: null, // rails state is transient; saves resume at 1x warp
        railsBodyId: null,
        createdAtSimTime: v.createdAtSimTime,
        parentBodyId: 'earth',
      });
    }
    this.nextId = Math.max(data.nextId, ...this.vessels.map((v) => v.id + 1), 1);
    this.activeId = data.activeId;
  }

  private enforceDebrisCap(): void {
    const debris = this.vessels.filter((v) => v.type === 'debris');
    let excess = debris.length - Math.max(0, this.maxDebris());
    for (let i = 0; excess > 0 && i < debris.length; i++, excess--) {
      this.destroyVessel(debris[i], 'debris limit reached (adjustable in Settings)');
    }
  }
}

function hasCommandPod(parts: PartInstance[]): boolean {
  return parts.some((p) => p.def.category === 'pod');
}
