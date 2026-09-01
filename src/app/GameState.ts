import type { PartDefinition } from '../vehicle/PartDefinition';
import type { RocketDesign } from '../vehicle/RocketDesign';
import type { SaveSystem } from '../storage/SaveSystem';
import type { GameSettings } from '../storage/Settings';
import type { CareerSystem } from '../systems/CareerSystem';
import type { FlightSession } from '../systems/FlightSession';
import type { EventBus, GameEvents, LogLevel } from './EventBus';

/**
 * Top-level game states. GameApp swaps the active scene between them:
 *   spaceCenter (hub) -> builder / flight / trackingStation
 */
export type GameStateId = 'spaceCenter' | 'builder' | 'flight' | 'trackingStation';

/** A top-level scene. enter/exit must fully create/tear down its world and UI. */
export interface Scene {
  enter(): void;
  exit(): void;
  update(dtSec: number): void;
}

/** Shared, scene-independent state and services. */
export interface GameContext {
  bus: EventBus<GameEvents>;
  /** Part id -> immutable definition. */
  catalog: Map<string, PartDefinition>;
  /** The design being edited/flown. Reassigned on load/clear, never aliased. */
  design: RocketDesign;
  saves: SaveSystem;
  /** Live player settings (persisted by storage/Settings). */
  settings: GameSettings;
  /**
   * The running flight, if any. Owned by GameApp: created on launch,
   * replaced on revert/quickload, kept alive across scene switches. World
   * time advances only while the (unpaused) flight scene updates it.
   */
  session: FlightSession | null;
  /** Career currencies, costs, and world-first milestones. */
  career: CareerSystem;
  /** Convenience wrapper for bus.emit('log', ...). */
  log(level: LogLevel, message: string): void;
  /** Open/close the debug log panel (scene-owned LOG buttons call this). */
  toggleLog(): void;
  /** Modal confirmation for destructive actions. */
  confirm(message: string, onConfirm: () => void): void;
}
