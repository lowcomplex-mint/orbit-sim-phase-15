import type { CareerState } from '../systems/CareerSystem';
import type { SerializedSession } from '../systems/FlightSession';
import type { RocketDesignData } from '../vehicle/RocketDesign';

/**
 * Persistence: rocket designs (legacy single slot) and full game saves.
 *
 * A game save captures the persistent world: the current design plus the
 * whole flight session (world time + every vessel with its parts, fuel, and
 * state vectors). Slots:
 *   quick    — quicksave/quickload (F5/F9 + pause menu)
 *   auto     — written automatically before launch/staging/revert/scene changes
 *   slot-1..3 — manual slots managed from the Space Center
 *
 * TODO: export/import saves as files; save-file migration once formats
 * change (version field is already checked).
 */

export type SaveSlotId =
  | 'quick'
  | 'auto-1'
  | 'auto-2'
  | 'auto-3'
  | 'slot-1'
  | 'slot-2'
  | 'slot-3';

export const MANUAL_SLOTS: SaveSlotId[] = ['slot-1', 'slot-2', 'slot-3'];
export const AUTO_SLOTS: SaveSlotId[] = ['auto-1', 'auto-2', 'auto-3'];
export const ALL_SLOTS: SaveSlotId[] = ['quick', ...AUTO_SLOTS, ...MANUAL_SLOTS];

export interface SaveGame {
  version: 1;
  /** Human label, e.g. "Quicksave" or "before staging". */
  label: string;
  savedAtIso: string;
  design: RocketDesignData;
  /** null = no flight in progress. */
  session: SerializedSession | null;
  /** Career currencies + milestones (absent in older saves = defaults). */
  career?: CareerState;
}

export interface SaveSlotInfo {
  slot: SaveSlotId;
  label: string;
  savedAtIso: string;
  vesselCount: number;
}

const DESIGN_KEY = 'orbit-sim:design:v1';
const SAVE_PREFIX = 'orbit-sim:savegame:';

export class SaveSystem {
  // ------------------------------------------------------------- designs --

  saveDesign(data: RocketDesignData): boolean {
    try {
      localStorage.setItem(DESIGN_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false; // storage full or blocked (e.g. private browsing)
    }
  }

  loadDesign(): RocketDesignData | null {
    try {
      const raw = localStorage.getItem(DESIGN_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as RocketDesignData;
      if ((data.version !== 1 && data.version !== 2) || !Array.isArray(data.parts)) {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------- game saves --

  /**
   * Corruption-protected write: serialize to a scratch key first, verify it
   * parses back, and only then replace the real slot — a mid-write failure
   * can never destroy the previous good save.
   */
  saveGame(slot: SaveSlotId, data: SaveGame): boolean {
    const key = SAVE_PREFIX + slot;
    const tmpKey = key + ':pending';
    try {
      const json = JSON.stringify(data);
      localStorage.setItem(tmpKey, json);
      JSON.parse(localStorage.getItem(tmpKey) ?? 'null'); // verify round-trip
      localStorage.setItem(key, json);
      localStorage.removeItem(tmpKey);
      return true;
    } catch {
      try {
        localStorage.removeItem(tmpKey);
      } catch {
        /* ignore */
      }
      return false;
    }
  }

  /** Shift the autosave history: auto-2 -> auto-3, auto-1 -> auto-2. */
  rotateAutosaves(): void {
    const two = this.loadGame('auto-2');
    if (two) this.saveGame('auto-3', two);
    const one = this.loadGame('auto-1');
    if (one) this.saveGame('auto-2', one);
  }

  loadGame(slot: SaveSlotId): SaveGame | null {
    try {
      const raw = localStorage.getItem(SAVE_PREFIX + slot);
      if (!raw) return null;
      const data = JSON.parse(raw) as SaveGame;
      if (data.version !== 1 || !data.design) return null;
      return data;
    } catch {
      return null;
    }
  }

  deleteGame(slot: SaveSlotId): void {
    try {
      localStorage.removeItem(SAVE_PREFIX + slot);
    } catch {
      /* ignore */
    }
  }

  /** Metadata of every occupied slot, for the Saved Games screen. */
  listGames(): SaveSlotInfo[] {
    const infos: SaveSlotInfo[] = [];
    for (const slot of ALL_SLOTS) {
      const data = this.loadGame(slot);
      if (!data) continue;
      infos.push({
        slot,
        label: data.label,
        savedAtIso: data.savedAtIso,
        vesselCount: data.session?.vessels.vessels.length ?? 0,
      });
    }
    return infos;
  }
}
