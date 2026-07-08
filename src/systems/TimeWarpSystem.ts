import { PHYSICS_WARP_LEVELS, RAILS_WARP_LEVELS } from '../config/constants';

/**
 * Time warp policy as a pure state machine. It knows the warp ladder and the
 * current position on it; it does NOT touch physics. FlightSession owns the
 * orchestration (eligibility checks, engaging/disengaging rails on the
 * PhysicsWorld, logging).
 *
 * Two fundamentally different warp kinds:
 *  - PhysicsWarp: the normal fixed-dt integrator simply runs more substeps
 *    per frame. Bit-identical to real time, works under thrust and in
 *    atmosphere, but capped low (4x) so the frame budget stays safe.
 *  - RailsWarp: analytic Kepler propagation (space/KeplerOrbit.ts). Exact
 *    and arbitrarily fast, but only valid for an unpowered vessel on a
 *    stable orbit clear of the atmosphere.
 */

export enum TimeWarpMode {
  RealTime = 'realTime',
  PhysicsWarp = 'physicsWarp',
  RailsWarp = 'railsWarp',
}

export interface WarpLevel {
  mode: TimeWarpMode;
  factor: number;
}

/** Reason a rails warp request was denied; shown to the player and logged. */
export interface RailsEligibility {
  ok: boolean;
  reason?: string;
}

function buildLadder(): WarpLevel[] {
  const ladder: WarpLevel[] = [];
  for (const factor of PHYSICS_WARP_LEVELS) {
    ladder.push({
      mode: factor === 1 ? TimeWarpMode.RealTime : TimeWarpMode.PhysicsWarp,
      factor,
    });
  }
  for (const factor of RAILS_WARP_LEVELS) {
    ladder.push({ mode: TimeWarpMode.RailsWarp, factor });
  }
  return ladder;
}

export class TimeWarpSystem {
  static readonly LADDER: readonly WarpLevel[] = buildLadder();

  private index = 0;

  get level(): WarpLevel {
    return TimeWarpSystem.LADDER[this.index];
  }

  get mode(): TimeWarpMode {
    return this.level.mode;
  }

  get factor(): number {
    return this.level.factor;
  }

  /** Short human label for the HUD, e.g. "1x", "4x phys", "250x rails". */
  get label(): string {
    const { mode, factor } = this.level;
    if (mode === TimeWarpMode.RealTime) return '1x';
    return `${factor}x ${mode === TimeWarpMode.PhysicsWarp ? 'phys' : 'rails'}`;
  }

  /** The ladder entry `delta` steps away, clamped to the ladder ends. */
  peek(delta: number): WarpLevel {
    const i = Math.min(Math.max(this.index + delta, 0), TimeWarpSystem.LADDER.length - 1);
    return TimeWarpSystem.LADDER[i];
  }

  /**
   * Move along the ladder. The caller must have already validated (and
   * engaged/disengaged rails); this only updates the pointer.
   * Returns true if the level actually changed.
   */
  applyStep(delta: number): boolean {
    const next = Math.min(Math.max(this.index + delta, 0), TimeWarpSystem.LADDER.length - 1);
    const changed = next !== this.index;
    this.index = next;
    return changed;
  }

  /** Snap back to 1x (crash, control input during rails, ...). */
  dropToRealTime(): boolean {
    const changed = this.index !== 0;
    this.index = 0;
    return changed;
  }
}
