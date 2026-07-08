import type { LogLevel } from '../app/EventBus';
import type { PartDefinition } from '../vehicle/PartDefinition';
import { resolvePlacedPart } from '../vehicle/ProceduralPart';
import type { RocketDesign } from '../vehicle/RocketDesign';

/**
 * Career-mode foundations. Sandbox already runs on top of this: costs are
 * charged and milestones award currencies, but nothing is gated yet.
 *
 * Design rule: career is an added RULE layer, not a separate game. Future
 * career mode will consult the same CareerState to gate launches (funds),
 * parts (tech tree), and facilities — see ARCHITECTURE.md.
 *
 * TODO: contracts (reach altitude/orbit/land...), tech tree + part unlocks,
 * facility upgrades, recovery value for vessels landed near the Space
 * Center, difficulty presets adjusting rewards.
 */

export interface CareerState {
  funds: number;
  science: number;
  reputation: number;
  /** Milestone id -> simTime when first achieved. */
  milestones: Record<string, number>;
}

export const DEFAULT_CAREER: CareerState = {
  funds: 150_000,
  science: 0,
  reputation: 0,
  milestones: {},
};

const MILESTONES: Record<
  string,
  { label: string; funds: number; science: number; reputation: number }
> = {
  firstLiftoff: { label: 'First Liftoff', funds: 5_000, science: 5, reputation: 1 },
  firstStaging: { label: 'First Staging', funds: 2_000, science: 2, reputation: 0 },
  firstSpace: { label: 'First Flight Above the Atmosphere', funds: 10_000, science: 10, reputation: 2 },
  firstOrbit: { label: 'First Stable Orbit', funds: 25_000, science: 25, reputation: 5 },
  firstLanding: { label: 'First Safe Landing', funds: 10_000, science: 10, reputation: 3 },
  firstSoiTransition: { label: 'First Sphere-of-Influence Crossing', funds: 30_000, science: 40, reputation: 5 },
};

export class CareerSystem {
  state: CareerState = { ...DEFAULT_CAREER, milestones: {} };

  constructor(private readonly log: (level: LogLevel, message: string) => void) {}

  /** Record a world-first milestone (idempotent). */
  award(id: keyof typeof MILESTONES | string, simTime: number): void {
    if (this.state.milestones[id] !== undefined) return;
    const reward = MILESTONES[id];
    if (!reward) return;
    this.state.milestones[id] = simTime;
    this.state.funds += reward.funds;
    this.state.science += reward.science;
    this.state.reputation += reward.reputation;
    this.log(
      'info',
      `🏆 Milestone: ${reward.label}! +${reward.funds} funds, +${reward.science} science.`,
    );
  }

  /** Deduct the launch cost (sandbox: informational, can go negative). */
  chargeLaunch(cost: number, designName: string): void {
    this.state.funds -= cost;
    this.log(
      'info',
      `Launch cost of "${designName}": ${Math.round(cost)} funds ` +
        `(balance ${Math.round(this.state.funds)}).`,
    );
  }

  restore(state: CareerState | undefined): void {
    this.state = state
      ? { ...DEFAULT_CAREER, ...state, milestones: { ...state.milestones } }
      : { ...DEFAULT_CAREER, milestones: {} };
  }

  serialize(): CareerState {
    return { ...this.state, milestones: { ...this.state.milestones } };
  }
}

/** Total part cost of a design, funds. */
export function designCost(
  design: RocketDesign,
  catalog: Map<string, PartDefinition>,
): number {
  let cost = 0;
  for (const placed of design.parts) {
    cost += resolvePlacedPart(placed, catalog)?.props.costFunds ?? 0;
  }
  return cost;
}
