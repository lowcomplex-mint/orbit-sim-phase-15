/**
 * Shared canvas pointer tracking + the documented gesture priority used by
 * the VAB, map view, and flight vessel view.
 *
 * Priority (highest first):
 *  1. Two or more pointers on the canvas → pinch-zoom. This wins over pan,
 *     marquee, group-move, long-press, and Move-tool subtree drag. An
 *     in-progress part-placement ghost is kept (pinch zooms the camera
 *     under the ghost instead of cancelling the drop).
 *  2. Single pointer on a part, Place tool, touch → pending long-press.
 *     Finger travel past GESTURE_MOVE_SLOP_PX promotes to pickup drag;
 *     holding still for LONG_PRESS_MS opens part settings.
 *  3. Single pointer on a part, Place tool, mouse → pickup drag immediately.
 *  4. Select tool (or Shift) → tap toggles a part; empty drag is a marquee.
 *  5. Move tool on a selection / subtree → group or subtree drag.
 *  6. Single pointer on empty canvas → pan.
 *  7. Wheel → zoom toward the cursor (desktop).
 *
 * Scene tools that are taps (Rotate select, Root) consume the down and never
 * become camera gestures. Palette scroll-vs-drag lives in PartPalette and
 * is not a canvas gesture.
 *
 * Coordinate space is caller-defined (canvas-local or client); pan/pinch
 * deltas are returned in that same space.
 */

export const LONG_PRESS_MS = 480;
/** Finger travel (px) that cancels long-press and starts a place-tool drag. */
export const GESTURE_MOVE_SLOP_PX = 12;

export interface ScreenPt {
  x: number;
  y: number;
}

export interface PanDelta {
  dx: number;
  dy: number;
}

export interface PinchDelta {
  /** Distance ratio this frame (new / previous). */
  scale: number;
  midX: number;
  midY: number;
}

export interface PointerMoveResult {
  pan: PanDelta | null;
  pinch: PinchDelta | null;
}

/** Tracks active pointers and reports pan (1 finger) or pinch (2 fingers). */
export class PointerTracker {
  private readonly pointers = new Map<number, ScreenPt>();

  get size(): number {
    return this.pointers.size;
  }

  has(id: number): boolean {
    return this.pointers.has(id);
  }

  down(id: number, pt: ScreenPt): void {
    this.pointers.set(id, { x: pt.x, y: pt.y });
  }

  move(id: number, pt: ScreenPt): PointerMoveResult {
    if (!this.pointers.has(id)) return { pan: null, pinch: null };
    const current = { x: pt.x, y: pt.y };

    if (this.pointers.size === 1) {
      const previous = this.pointers.get(id)!;
      this.pointers.set(id, current);
      return {
        pan: { dx: current.x - previous.x, dy: current.y - previous.y },
        pinch: null,
      };
    }

    if (this.pointers.size === 2) {
      const [idA, idB] = [...this.pointers.keys()];
      const beforeA = this.pointers.get(idA)!;
      const beforeB = this.pointers.get(idB)!;
      const prevDist = Math.hypot(beforeA.x - beforeB.x, beforeA.y - beforeB.y);
      this.pointers.set(id, current);
      const afterA = this.pointers.get(idA)!;
      const afterB = this.pointers.get(idB)!;
      const dist = Math.hypot(afterA.x - afterB.x, afterA.y - afterB.y);
      const pinch =
        prevDist > 1 && dist > 1 && dist !== prevDist
          ? {
              scale: dist / prevDist,
              midX: (afterA.x + afterB.x) / 2,
              midY: (afterA.y + afterB.y) / 2,
            }
          : null;
      return { pan: null, pinch };
    }

    this.pointers.set(id, current);
    return { pan: null, pinch: null };
  }

  up(id: number): void {
    this.pointers.delete(id);
  }

  clear(): void {
    this.pointers.clear();
  }
}

export function capturePointer(el: HTMLElement, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* already released or unsupported */
  }
}

export function releasePointer(el: HTMLElement, pointerId: number): void {
  try {
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
  } catch {
    /* already released */
  }
}
