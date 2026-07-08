/**
 * Player settings, persisted separately from saves. The live settings object
 * is shared through GameContext so systems (debris cap, autosave hooks) read
 * current values without plumbing.
 */

export interface GameSettings {
  /** How many debris vessels are kept before the oldest is removed. */
  maxDebris: number;
  autosaveOnStaging: boolean;
  autosaveOnSceneChange: boolean;
  /** Difficulty: reentry heating destroys overheated parts. */
  heatingEnabled: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  maxDebris: 6,
  autosaveOnStaging: true,
  autosaveOnSceneChange: true,
  heatingEnabled: true,
};

const SETTINGS_KEY = 'orbit-sim:settings:v1';

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const data = JSON.parse(raw) as Partial<GameSettings>;
    return {
      maxDebris: clampDebris(data.maxDebris ?? DEFAULT_SETTINGS.maxDebris),
      autosaveOnStaging: data.autosaveOnStaging ?? DEFAULT_SETTINGS.autosaveOnStaging,
      autosaveOnSceneChange:
        data.autosaveOnSceneChange ?? DEFAULT_SETTINGS.autosaveOnSceneChange,
      heatingEnabled: data.heatingEnabled ?? DEFAULT_SETTINGS.heatingEnabled,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable — settings just won't persist
  }
}

export function clampDebris(value: number): number {
  return Math.min(20, Math.max(0, Math.round(value)));
}
