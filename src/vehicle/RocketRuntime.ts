import { G0, GRID_CELL_METERS } from '../config/constants';
import { Vec2 } from '../math/Vec2';
import { lerp } from '../math/Units';
import { computeCenterOfMass } from './CenterOfMass';
import type { PartDefinition } from './PartDefinition';
import { PartInstance } from './PartInstance';
import type { PartCustomization } from './ProceduralPart';
import { CHUTE_CD } from './ProceduralPart';
import { computeStagePlan, fireStage, partsAttached, type StagePlan } from './StageSystem';

/**
 * The live flight-state of a rocket: physics state plus the remaining parts.
 * Staging, ignition, and fuel isolation all come from the connectivity-based
 * StagePlan (vehicle/StageSystem.ts), so radial boosters and plain stacks
 * follow the same rules.
 *
 * `position` is the world position (meters) of the BOTTOM-CENTER of the
 * lowest part. Attitude is physically integrated (see RocketPhysics):
 * control torque from reaction wheels + gimbal, DISTURBANCE torque from
 * off-axis thrust (asymmetric boosters!), both against the true moment of
 * inertia, rotating about the live center of mass.
 */

export type SasMode = 'off' | 'stability' | 'prograde' | 'retrograde';

/** Serialized runtime state for the save system. */
export interface SerializedRuntime {
  parts: {
    defId: string;
    xCells: number;
    yCells: number;
    custom?: PartCustomization;
    fuel: number;
    /** Live temperature, K. Absent in older saves = ambient. */
    tempK?: number;
    chuteState?: string;
    drogueFraction?: number;
    mainFraction?: number;
    legsDeployed?: boolean;
  }[];
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  angleRad: number;
  angularVelocityRadS: number;
  throttle: number;
  landed: boolean;
  crashed: boolean;
  stagesFired: number;
  sasMode?: SasMode;
  electricCharge?: number;
}

/** Result of one propulsion tick. */
export interface PropulsionResult {
  forceN: number;
  /** True the first tick a lit engine group ran dry (one event per stage). */
  starvedNow: boolean;
  /** Torque available from gimballing the thrusting engines, N*m. */
  gimbalAuthorityNm: number;
  /** Net disturbance torque from off-CoM thrust, N*m (CCW positive). */
  netTorqueNm: number;
}

/** One group of parts separated by a staging event. */
export interface JettisonedGroup {
  parts: PartInstance[];
  /** World position of the group's own bottom-center (its new runtime base). */
  basePositionWorld: Vec2;
  /** Unit vector pointing away from the parent stack's CoM (separation push). */
  pushDirWorld: Vec2;
}

export class RocketRuntime {
  parts: PartInstance[];
  /** How many stages have been fired so far (global stage = local + this). */
  stagesFired: number;

  /** Bumped whenever the part list changes, so views know to rebuild. */
  revision = 0;

  position = Vec2.ZERO;
  velocity = Vec2.ZERO;
  /** Heading in radians CCW from +X. PI/2 = pointing radially up at the pad. */
  angleRad = Math.PI / 2;
  /** Physically integrated angular velocity, rad/s (CCW positive). */
  angularVelocityRadS = 0;
  /** Commanded rotation, -1..1 (A/D input) — a RATE command for the SAS controller. */
  rotationInput = 0;
  /** 0..1. */
  throttle = 0;
  /**
   * Stability-assist mode. 'stability' damps rotation; prograde/retrograde
   * steer toward the body-relative velocity. Player input always overrides.
   * TODO: radial/normal/target/maneuver hold (needs target + node systems).
   */
  sasMode: SasMode = 'stability';

  landed = false;
  crashed = false;
  /** Set once per stage so "out of fuel" is only reported once. */
  fuelExhaustedNotified = false;

  /** Aggregate drag term Cd * A (m^2), recomputed on staging. */
  dragCdA = 0;

  /** Last propulsion tick's thrust / gimbal authority (engineer readouts). */
  lastThrustN = 0;
  lastGimbalAuthorityNm = 0;

  /** Pooled electric charge (first generalized resource). */
  electricCharge = 0;
  private electricDepletedNotified = false;

  /** Local (post-staging) plan: activations are 1-based from "next press". */
  private plan: StagePlan;

  constructor(parts: PartInstance[], stagesFired = 0) {
    this.parts = [...parts];
    this.stagesFired = stagesFired;
    this.plan = computeStagePlan(this.parts, stagesFired);
    this.electricCharge = this.electricCapacity;
    this.recomputeAggregates();
  }

  /** Place the rocket with its base at `basePosition`, pointing away from the origin. */
  spawnAt(basePosition: Vec2): void {
    this.position = basePosition;
    this.velocity = Vec2.ZERO;
    this.angleRad = basePosition.angle();
    this.angularVelocityRadS = 0;
    this.landed = true;
    this.crashed = false;
  }

  // ------------------------------------------------------------- staging --

  get totalStageCount(): number {
    return this.stagesFired + this.plan.totalStages;
  }

  /** 1-based stage number for display: "Stage 1/2" before the first separation. */
  get currentStageNumber(): number {
    return this.stagesFired + 1;
  }

  /** Whether pressing STAGE would still do anything (release or arm). */
  get canStage(): boolean {
    return (
      this.plan.totalStages > 1 ||
      this.parts.some(
        (p) =>
          this.plan.activation.get(p) === 1 &&
          (p.def.category === 'decoupler' ||
            p.def.category === 'clamp' ||
            (p.def.category === 'parachute' && p.chuteState === 'packed')),
      )
    );
  }

  /** GLOBAL activation stage of a part (override respected). */
  igniteStageOf(part: PartInstance): number {
    return (this.plan.activation.get(part) ?? 1) + this.stagesFired;
  }

  /** GLOBAL activation stage ignoring overrides (context-menu "auto" label). */
  defaultIgniteStageOf(part: PartInstance): number {
    return (this.plan.defaultActivation.get(part) ?? 1) + this.stagesFired;
  }

  /** Engines currently lit: local activation reached (<= 1). */
  get activeEngines(): PartInstance[] {
    return this.parts.filter(
      (p) => p.def.category === 'engine' && (this.plan.activation.get(p) ?? 1) <= 1,
    );
  }

  /** Tanks in the fuel groups that feed the currently lit engines (HUD). */
  get activeTanks(): PartInstance[] {
    const litGroups = new Set<number>();
    for (const engine of this.activeEngines) {
      const group = this.plan.fuelGroup.get(engine);
      if (group !== undefined) litGroups.add(group);
    }
    return this.parts.filter(
      (p) =>
        p.fuelCapacityKg > 0 &&
        (litGroups.size === 0 || litGroups.has(this.plan.fuelGroup.get(p) ?? -1)),
    );
  }

  get activeFuel(): number {
    let f = 0;
    for (const t of this.activeTanks) f += t.fuel;
    return f;
  }

  get activeFuelCapacity(): number {
    let f = 0;
    for (const t of this.activeTanks) f += t.fuelCapacityKg;
    return f;
  }

  /**
   * Fire the next stage. Decouplers assigned to the current stage release
   * their components — possibly SEVERAL at once (both side boosters). If the
   * stage has no decouplers it is a "hot stage": it only advances ignition.
   * Returns the jettisoned groups (empty array = hot stage), or null when
   * nothing is left to activate.
   */
  stage(): { groups: JettisonedGroup[]; armedChutes: string[] } | null {
    if (!this.canStage) return null;

    // Arm parachutes assigned to the firing stage (they stay attached).
    const armedChutes: string[] = [];
    for (const p of this.parts) {
      if (
        p.def.category === 'parachute' &&
        this.plan.activation.get(p) === 1 &&
        p.chuteState === 'packed'
      ) {
        p.chuteState = 'armed';
        armedChutes.push(p.def.name);
      }
    }

    // Capture the pre-staging frame for group placement.
    const oldBase = this.baseOrigin()!;
    const oldCom = this.centerOfMassLocalM ?? { x: 0, y: 0 };
    const heading = this.angleRad;

    const { kept, groups } = fireStage(this.parts, this.plan.activation, 1);

    const jettisoned: JettisonedGroup[] = groups.map((groupParts) => {
      const base = baseOriginOf(groupParts)!;
      const center = geometricCenterOf(groupParts);
      const pushLocal = new Vec2(center.xM - (oldBase.xM + oldCom.x), center.yM - (oldBase.yM + oldCom.y));
      return {
        parts: groupParts,
        basePositionWorld: this.localToWorld(base.xM - oldBase.xM, base.yM - oldBase.yM, oldBase, heading),
        pushDirWorld: pushLocal.length() > 1e-6
          ? rotateLocalToWorld(pushLocal, heading).normalized()
          : Vec2.fromAngle(heading, -1), // degenerate: push straight back
      };
    });

    this.parts = kept;
    this.stagesFired++;
    this.revision++;
    this.fuelExhaustedNotified = false;
    this.plan = computeStagePlan(this.parts, this.stagesFired);
    this.recomputeAggregates();

    // The base may have moved up AND sideways (e.g. the old bottom part was
    // a booster engine): shift the world position so the kept parts stay
    // exactly where they were.
    const newBase = this.baseOrigin();
    if (newBase) {
      this.position = this.localToWorld(
        newBase.xM - oldBase.xM,
        newBase.yM - oldBase.yM,
        oldBase,
        heading,
      );
    }
    return { groups: jettisoned, armedChutes };
  }

  // ------------------------------------------------------------- masses --

  get massKg(): number {
    let m = 0;
    for (const p of this.parts) m += p.mass;
    return m;
  }

  /** Height of the remaining stack in meters. */
  get stackHeightM(): number {
    if (this.parts.length === 0) return 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of this.parts) {
      minY = Math.min(minY, p.yCells);
      maxY = Math.max(maxY, p.topCells);
    }
    return (maxY - minY) * GRID_CELL_METERS;
  }

  /** Bottom part's center column / base line, in absolute grid meters. */
  private baseOrigin(): { xM: number; yM: number } | null {
    return baseOriginOf(this.parts);
  }

  /**
   * Live center of mass in stack-local meters: x = lateral offset from the
   * base column (nonzero for asymmetric vessels!), y = height above base.
   */
  get centerOfMassLocalM(): { x: number; y: number } | null {
    const com = computeCenterOfMass(this.parts);
    const base = this.baseOrigin();
    if (!com || !base) return null;
    return { x: com.xM - base.xM, y: com.yM - base.yM };
  }

  /** Moment of inertia about the center of mass, kg*m^2. */
  get momentOfInertiaKgM2(): number {
    const com = this.centerOfMassLocalM;
    const base = this.baseOrigin();
    if (!com || !base) return 1;
    let inertia = 0;
    for (const p of this.parts) {
      const w = p.widthCells * GRID_CELL_METERS;
      const h = p.heightCells * GRID_CELL_METERS;
      const cx = (p.xCells + p.widthCells / 2) * GRID_CELL_METERS - base.xM;
      const cy = (p.yCells + p.heightCells / 2) * GRID_CELL_METERS - base.yM;
      const dx = cx - com.x;
      const dy = cy - com.y;
      inertia += p.mass * (dx * dx + dy * dy) + (p.mass * (w * w + h * h)) / 12;
    }
    return Math.max(inertia, 50);
  }

  /**
   * Reaction-wheel torque available. Wheels need electricity: a vessel WITH
   * electrical parts whose charge hits zero loses them (engine gimbal still
   * works while burning). Vessels with no electrical system at all keep
   * their wheels — backward compatible with pre-electricity designs.
   */
  get reactionWheelNm(): number {
    if (this.electricCapacity > 0 && this.electricCharge <= 0) return 0;
    let torque = 0;
    for (const p of this.parts) torque += p.def.reactionWheelNm ?? 0;
    return torque;
  }

  // ----------------------------------------------------------- electricity --

  get electricCapacity(): number {
    let cap = 0;
    for (const p of this.parts) cap += p.def.electricCapacity ?? 0;
    return cap;
  }

  /**
   * Drain avionics + SAS, generate from solar panels (0..1 sun factor).
   * Returns true the moment the battery runs flat (one notice per depletion).
   */
  updateElectricity(dt: number, sunFactor: number): boolean {
    const capacity = this.electricCapacity;
    if (capacity <= 0) return false;

    let rate = 0;
    for (const p of this.parts) {
      rate -= p.def.electricDrainPerSec ?? 0;
      rate += (p.def.electricGenPerSec ?? 0) * sunFactor;
    }
    if (this.sasMode !== 'off') rate -= 0.05; // SAS avionics draw

    this.electricCharge = Math.min(capacity, Math.max(0, this.electricCharge + rate * dt));
    if (this.electricCharge > 0) {
      this.electricDepletedNotified = false;
      return false;
    }
    if (this.electricDepletedNotified) return false;
    this.electricDepletedNotified = true;
    return true;
  }

  // ------------------------------------------------------------ parachutes --

  get parachutes(): PartInstance[] {
    return this.parts.filter((p) => p.chute !== null);
  }

  /** Extra drag term from deployed canopies (added to dragCdA). */
  get chuteDragCdA(): number {
    let cda = 0;
    for (const p of this.parachutes) {
      if (p.chuteState === 'failed' || p.chuteState === 'cut') continue;
      // Fraction squared: canopies produce little drag until mostly open.
      cda +=
        CHUTE_CD *
        (p.chute!.drogueAreaM2 * p.drogueFraction * p.drogueFraction +
          p.chute!.canopyAreaM2 * p.mainFraction * p.mainFraction);
    }
    return cda;
  }

  /** Arm every packed chute (flight CHUTES button / staging). */
  armParachutes(): number {
    let armed = 0;
    for (const p of this.parachutes) {
      if (p.chuteState === 'packed') {
        p.chuteState = 'armed';
        armed++;
      }
    }
    return armed;
  }

  /**
   * Per-step parachute logic: gradual deployment gated by altitude, safety
   * limits per material, and failure when abused. Returns notices to log.
   */
  stepChutes(
    density: number,
    speedMS: number,
    dynamicPressurePa: number,
    altitudeM: number,
    dt: number,
  ): { level: 'info' | 'warn'; message: string }[] {
    const notices: { level: 'info' | 'warn'; message: string }[] = [];
    for (const p of this.parachutes) {
      const c = p.chute!;
      if (p.chuteState !== 'armed' && p.chuteState !== 'deployed') continue;

      // Failure first: an open canopy abused beyond its material limits.
      const openFraction = Math.max(p.drogueFraction, p.mainFraction);
      if (
        openFraction > 0.05 &&
        (speedMS > c.maxSpeedMS * 1.25 ||
          dynamicPressurePa > c.maxQPa * 1.5 ||
          p.temperatureK > c.maxTempK)
      ) {
        p.chuteState = 'failed';
        p.drogueFraction = 0;
        p.mainFraction = 0;
        const reason =
          p.temperatureK > c.maxTempK ? 'overheated' : 'shredded — speed too high';
        notices.push({ level: 'warn', message: `Parachute failed: ${reason}!` });
        continue;
      }

      if (density < 1e-5) continue; // vacuum: keep waiting silently

      // Drogue phase (drogue/combo): opens high, tougher limits.
      if (c.drogueAreaM2 > 0 && altitudeM < c.deployAltM * 4) {
        if (speedMS < c.maxSpeedMS * 1.8 && dynamicPressurePa < c.maxQPa * 1.8) {
          const before = p.drogueFraction;
          p.drogueFraction = Math.min(1, p.drogueFraction + dt / 1.5);
          if (before < 1 && p.drogueFraction >= 1) {
            notices.push({ level: 'info', message: 'Drogue chute deployed.' });
          }
        }
      }
      // Main canopy: only below its deploy altitude and within limits.
      if (c.canopyAreaM2 > 0 && altitudeM < c.deployAltM) {
        if (speedMS < c.maxSpeedMS && dynamicPressurePa < c.maxQPa) {
          const before = p.mainFraction;
          p.mainFraction = Math.min(1, p.mainFraction + dt / 4);
          if (before < 1 && p.mainFraction >= 1) {
            p.chuteState = 'deployed';
            notices.push({ level: 'info', message: 'Main parachute deployed.' });
          }
        }
      } else if (c.canopyAreaM2 === 0 && p.drogueFraction >= 1) {
        p.chuteState = 'deployed';
      }
    }
    return notices;
  }

  /** Human status of the "most interesting" chute, for UI. */
  get chuteStatusLabel(): string | null {
    const chutes = this.parachutes;
    if (chutes.length === 0) return null;
    let best = 'packed';
    const rank: Record<string, number> = { packed: 0, armed: 1, deployed: 3, cut: 2, failed: 4 };
    for (const p of chutes) {
      const label =
        p.chuteState === 'armed'
          ? p.mainFraction > 0 || p.drogueFraction > 0
            ? 'deploying'
            : 'armed (waiting)'
          : p.chuteState;
      if ((rank[p.chuteState] ?? 0) >= (rank[best] ?? 0)) best = label;
    }
    return best;
  }

  // ---------------------------------------------------------- legs & clamps --

  get hasLaunchClamps(): boolean {
    return this.parts.some((p) => p.def.category === 'clamp');
  }

  /** Deployed legs sitting at the very bottom of the stack absorb landings. */
  get legsDeployedAtBottom(): boolean {
    let minY = Infinity;
    for (const p of this.parts) minY = Math.min(minY, p.yCells);
    return this.parts.some(
      (p) => p.def.category === 'legs' && p.legsDeployed && p.yCells === minY,
    );
  }

  /** Toggle all landing legs. Returns the new state, or null if no legs. */
  toggleLegs(): boolean | null {
    const legs = this.parts.filter((p) => p.def.category === 'legs');
    if (legs.length === 0) return null;
    const deploy = !legs.every((l) => l.legsDeployed);
    for (const l of legs) l.legsDeployed = deploy;
    this.revision++; // legs render differently when deployed
    return deploy;
  }

  /** Break the bottom legs on a hard-but-survivable landing. */
  breakBottomLegs(): string[] {
    let minY = Infinity;
    for (const p of this.parts) minY = Math.min(minY, p.yCells);
    const broken = this.parts.filter(
      (p) => p.def.category === 'legs' && p.yCells === minY,
    );
    if (broken.length > 0) this.destroyParts(broken);
    return broken.map((p) => p.def.name);
  }

  /** Local stack coords (relative to a base origin) -> world position. */
  private localToWorld(
    dxM: number,
    dyM: number,
    _base: { xM: number; yM: number },
    heading: number,
  ): Vec2 {
    return this.position.add(rotateLocalToWorld(new Vec2(dxM, dyM), heading));
  }

  // ------------------------------------------------------------ propulsion --

  /**
   * One propulsion tick: thrust of all lit engines at the given atmosphere
   * density ratio, fuel drained per engine group from its OWN fuel group's
   * tanks, plus gimbal authority and the net disturbance torque of off-CoM
   * thrust (zero for symmetric designs).
   */
  computePropulsion(densityRatio: number, dt: number): PropulsionResult {
    const result: PropulsionResult = {
      forceN: 0,
      starvedNow: false,
      gimbalAuthorityNm: 0,
      netTorqueNm: 0,
    };
    if (this.throttle <= 0 || this.crashed) return result;

    const com = this.centerOfMassLocalM;
    const base = this.baseOrigin();

    // Group lit engines by fuel group (their tank supply).
    const groups = new Map<number, PartInstance[]>();
    for (const engine of this.activeEngines) {
      const groupId = this.plan.fuelGroup.get(engine) ?? -1;
      const group = groups.get(groupId);
      if (group) group.push(engine);
      else groups.set(groupId, [engine]);
    }

    let anyStarved = false;
    for (const [groupId, engines] of groups) {
      let thrustMax = 0;
      let flowMax = 0;
      for (const e of engines) {
        const thrust =
          lerp(e.def.thrustVacuum, e.def.thrustSeaLevel, densityRatio) * e.thrustLimiter;
        const isp = lerp(e.def.ispVacuum, e.def.ispSeaLevel, densityRatio);
        thrustMax += thrust;
        if (isp > 0) flowMax += thrust / (isp * G0);
      }
      if (thrustMax <= 0) continue;

      const tanks = this.parts.filter(
        (p) => p.fuel > 0 && this.plan.fuelGroup.get(p) === groupId,
      );
      let available = 0;
      for (const t of tanks) available += t.fuel;
      const wanted = flowMax * this.throttle * dt;
      const consumed = Math.min(wanted, available);
      if (consumed > 0) {
        for (const t of tanks) t.fuel -= consumed * (t.fuel / available);
      }
      const fraction = wanted > 0 ? consumed / wanted : 0;
      if (fraction < 0.999) anyStarved = true;

      const groupForce = thrustMax * this.throttle * fraction;
      result.forceN += groupForce;

      if (groupForce > 0 && com && base) {
        for (const e of engines) {
          const engineThrust =
            (lerp(e.def.thrustVacuum, e.def.thrustSeaLevel, densityRatio) *
              e.thrustLimiter *
              groupForce) /
            thrustMax;
          const engineX = (e.xCells + e.widthCells / 2) * GRID_CELL_METERS - base.xM;
          const engineY = (e.yCells + e.heightCells / 2) * GRID_CELL_METERS - base.yM;

          // Thrust acts along the heading (+y local): torque = dx * F.
          result.netTorqueNm += engineThrust * (engineX - com.x);

          const gimbalDeg = e.def.gimbalRangeDeg ?? 0;
          if (gimbalDeg > 0) {
            const leverArm = Math.abs(engineY - com.y);
            result.gimbalAuthorityNm +=
              engineThrust * Math.sin((gimbalDeg * Math.PI) / 180) * leverArm;
          }
        }
      }
    }

    if (anyStarved && !this.fuelExhaustedNotified) {
      this.fuelExhaustedNotified = true;
      result.starvedNow = true;
    }
    this.lastThrustN = result.forceN;
    this.lastGimbalAuthorityNm = result.gimbalAuthorityNm;
    return result;
  }

  /**
   * Remove parts destroyed by heat/damage. Whatever loses its connection to
   * the root (the pod, else the largest fragment) is destroyed with them —
   * a burned-through decoupler takes everything below it. Returns true if
   * the vessel itself is lost (no parts / no structural root remaining).
   * TODO: disconnected-but-intact fragments could become debris vessels.
   */
  destroyParts(destroyed: PartInstance[]): boolean {
    const destroyedSet = new Set(destroyed);
    const remaining = this.parts.filter((p) => !destroyedSet.has(p));

    // Keep only the component still connected to the root: BFS from a pod
    // (or the first remaining part for pod-less debris).
    let kept: PartInstance[] = [];
    if (remaining.length > 0) {
      const start =
        remaining.find((p) => p.def.category === 'pod') ?? remaining[0];
      const visited = new Set<PartInstance>([start]);
      const queue = [start];
      while (queue.length > 0) {
        const current = queue.pop()!;
        for (const other of remaining) {
          if (!visited.has(other) && partsAttached(current, other)) {
            visited.add(other);
            queue.push(other);
          }
        }
      }
      kept = remaining.filter((p) => visited.has(p));
    }

    this.parts = kept;
    this.revision++;
    if (this.parts.length === 0) {
      this.crashed = true;
      return true;
    }
    this.plan = computeStagePlan(this.parts, this.stagesFired);
    this.recomputeAggregates();
    return false;
  }

  // ---------------------------------------------------------- persistence --

  serialize(): SerializedRuntime {
    return {
      parts: this.parts.map((p) => ({
        defId: p.def.id,
        xCells: p.xCells,
        yCells: p.yCells,
        custom: p.custom ? { ...p.custom } : undefined,
        fuel: p.fuel,
        tempK: p.temperatureK,
        chuteState: p.chute ? p.chuteState : undefined,
        drogueFraction: p.chute ? p.drogueFraction : undefined,
        mainFraction: p.chute ? p.mainFraction : undefined,
        legsDeployed: p.def.category === 'legs' ? p.legsDeployed : undefined,
      })),
      position: { x: this.position.x, y: this.position.y },
      velocity: { x: this.velocity.x, y: this.velocity.y },
      angleRad: this.angleRad,
      angularVelocityRadS: this.angularVelocityRadS,
      throttle: this.throttle,
      landed: this.landed,
      crashed: this.crashed,
      stagesFired: this.stagesFired,
      sasMode: this.sasMode,
      electricCharge: this.electricCharge,
    };
  }

  static restore(
    data: SerializedRuntime,
    catalog: Map<string, PartDefinition>,
  ): RocketRuntime {
    const parts = data.parts.map((p) => {
      const def = catalog.get(p.defId);
      if (!def) throw new Error(`Unknown part id in save: ${p.defId}`);
      const instance = new PartInstance(def, p.xCells, p.yCells, p.custom);
      instance.fuel = Math.min(p.fuel, instance.fuelCapacityKg);
      if (p.tempK !== undefined) instance.temperatureK = p.tempK;
      if (p.chuteState !== undefined) {
        instance.chuteState = p.chuteState as PartInstance['chuteState'];
        instance.drogueFraction = p.drogueFraction ?? 0;
        instance.mainFraction = p.mainFraction ?? 0;
      }
      if (p.legsDeployed !== undefined) instance.legsDeployed = p.legsDeployed;
      return instance;
    });
    const runtime = new RocketRuntime(parts, data.stagesFired);
    runtime.position = new Vec2(data.position.x, data.position.y);
    runtime.velocity = new Vec2(data.velocity.x, data.velocity.y);
    runtime.angleRad = data.angleRad;
    runtime.angularVelocityRadS = data.angularVelocityRadS;
    runtime.throttle = data.throttle;
    runtime.landed = data.landed;
    runtime.crashed = data.crashed;
    runtime.sasMode = data.sasMode ?? 'stability';
    runtime.electricCharge = Math.min(
      data.electricCharge ?? runtime.electricCapacity,
      runtime.electricCapacity,
    );
    return runtime;
  }

  /**
   * MVP drag model: one aggregate Cd*A using the nose part's coefficient and
   * the largest single frontal area. TODO: sum per-column areas (boosters
   * add wetted area) and orientation-dependent drag.
   */
  private recomputeAggregates(): void {
    if (this.parts.length === 0) {
      this.dragCdA = 0;
      return;
    }
    let nose = this.parts[0];
    let maxArea = 0;
    for (const p of this.parts) {
      if (p.topCells > nose.topCells) nose = p;
      maxArea = Math.max(maxArea, p.frontalAreaM2);
    }
    // Resolved per-instance coefficient: nose-cone shape variants matter.
    this.dragCdA = nose.dragCoefficient * maxArea;
  }
}

function baseOriginOf(parts: PartInstance[]): { xM: number; yM: number } | null {
  if (parts.length === 0) return null;
  let bottom = parts[0];
  for (const p of parts) {
    if (p.yCells < bottom.yCells) bottom = p;
  }
  return {
    xM: (bottom.xCells + bottom.widthCells / 2) * GRID_CELL_METERS,
    yM: bottom.yCells * GRID_CELL_METERS,
  };
}

function geometricCenterOf(parts: PartInstance[]): { xM: number; yM: number } {
  let x = 0;
  let y = 0;
  for (const p of parts) {
    x += (p.xCells + p.widthCells / 2) * GRID_CELL_METERS;
    y += (p.yCells + p.heightCells / 2) * GRID_CELL_METERS;
  }
  return { xM: x / parts.length, yM: y / parts.length };
}

/** Rotate stack-local (x right, y along heading) into world axes. */
function rotateLocalToWorld(local: Vec2, heading: number): Vec2 {
  return Vec2.fromAngle(heading, local.y).add(Vec2.fromAngle(heading - Math.PI / 2, local.x));
}
