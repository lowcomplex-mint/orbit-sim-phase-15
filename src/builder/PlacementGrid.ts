/**
 * Fractional placement grid (VAB Phase 7 — Grok).
 *
 * The original VAB used integer cell coordinates only. Parachutes on tapered
 * pod tops and sub-cell parts (0.5-wide legs, 0.25-wide panels) need finer
 * placement without abandoning snapping entirely. This module owns snap-step
 * selection and all coordinate quantization used by GridSystem and SnapSystem.
 *
 * Snap is always enforced (minimum step 0.1 cells); it is never disabled.
 */

/** Minimum allowed snap step, in grid cells. */
export const MIN_SNAP_STEP_CELLS = 0.1;

/** Maximum / coarsest snap step, in grid cells. */
export const MAX_SNAP_STEP_CELLS = 1;

/** Preset snap steps exposed in the VAB dropdown (0.1 … 1.0). */
export const SNAP_STEP_PRESETS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

export type SnapStepCells = (typeof SNAP_STEP_PRESETS)[number];

import { GRID_EPSILON, cellsNear } from '../vehicle/AttachmentNode';

export { cellsNear, GRID_EPSILON };

/** Clamp and round a requested snap step to a valid preset value. */
export function clampSnapStep(step: number): SnapStepCells {
  const clamped = Math.min(MAX_SNAP_STEP_CELLS, Math.max(MIN_SNAP_STEP_CELLS, step));
  const snapped = Math.round(clamped / MIN_SNAP_STEP_CELLS) * MIN_SNAP_STEP_CELLS;
  const preset = SNAP_STEP_PRESETS.find((p) => Math.abs(p - snapped) < GRID_EPSILON);
  return preset ?? MIN_SNAP_STEP_CELLS;
}

/** Decimal places needed to stringify a snap step without drift. */
function snapDecimals(step: number): number {
  return step < 1 ? 1 : 0;
}

/** Quantize one coordinate to the active snap grid. */
export function snapValue(value: number, step: number): number {
  const snapped = Math.round(value / step) * step;
  return Number(snapped.toFixed(snapDecimals(step)));
}

/** Quantize a part origin to the active snap grid. */
export function snapOrigin(xCells: number, yCells: number, step: number): { xCells: number; yCells: number } {
  return {
    xCells: snapValue(xCells, step),
    yCells: snapValue(yCells, step),
  };
}

/** Human-readable label for toolbar / dropdown. */
export function formatSnapStep(step: number): string {
  return `${step.toFixed(step < 1 ? 1 : 0)} cell`;
}

// --- rotation increment (Phase 9) -----------------------------------------

export const MIN_ROTATE_STEP_DEG = 5;
export const MAX_ROTATE_STEP_DEG = 90;
export const ROTATE_STEP_PRESETS = [5, 10, 15, 30, 45, 90] as const;
export type RotateStepDeg = (typeof ROTATE_STEP_PRESETS)[number];

export function clampRotateStep(step: number): RotateStepDeg {
  const clamped = Math.min(MAX_ROTATE_STEP_DEG, Math.max(MIN_ROTATE_STEP_DEG, step));
  const preset = ROTATE_STEP_PRESETS.find((p) => p === clamped)
    ?? ROTATE_STEP_PRESETS.reduce((best, p) =>
      Math.abs(p - clamped) < Math.abs(best - clamped) ? p : best);
  return preset;
}

export function formatRotateStep(step: number): string {
  return `${step}°`;
}