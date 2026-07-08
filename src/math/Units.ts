/**
 * Numeric helpers and human-readable formatting for SI quantities.
 * Physics stays in raw SI; only the UI formats values through these.
 */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Meters -> "834 m" / "12.5 km" / "1,203 km". */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  const abs = Math.abs(meters);
  if (abs < 1_000) return `${meters.toFixed(0)} m`;
  if (abs < 100_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000).toLocaleString('en-US')} km`;
}

/** m/s -> "12 m/s" / "1,842 m/s". */
export function formatSpeed(metersPerSecond: number): string {
  if (!Number.isFinite(metersPerSecond)) return '—';
  return `${Math.round(metersPerSecond).toLocaleString('en-US')} m/s`;
}

/** kg -> "820 kg" / "4.32 t". */
export function formatMass(kg: number): string {
  if (kg < 1000) return `${Math.round(kg)} kg`;
  return `${(kg / 1000).toFixed(2)} t`;
}

/** Seconds -> "T+ 0:04:31". */
export function formatMissionTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `T+ ${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
