import type { Container } from 'pixi.js';
import { clamp } from '../math/Units';
import { Vec2 } from '../math/Vec2';

/**
 * Maps world coordinates (meters, y up) to screen pixels (y down).
 * The world is never scaled to pixels anywhere else — scenes set a camera
 * center + zoom and call apply() once per frame.
 */
export class CameraController {
  center = Vec2.ZERO;
  pxPerMeter: number;

  constructor(
    initialPxPerMeter: number,
    private readonly minPxPerMeter: number,
    private readonly maxPxPerMeter: number,
  ) {
    this.pxPerMeter = initialPxPerMeter;
  }

  zoomBy(factor: number): void {
    this.pxPerMeter = clamp(
      this.pxPerMeter * factor,
      this.minPxPerMeter,
      this.maxPxPerMeter,
    );
  }

  setZoom(pxPerMeter: number): void {
    this.pxPerMeter = clamp(pxPerMeter, this.minPxPerMeter, this.maxPxPerMeter);
  }

  /**
   * Zoom keeping the world point under (screenX, screenY) fixed.
   * Screen coords are canvas-local pixels.
   */
  zoomAtScreen(
    screenX: number,
    screenY: number,
    factor: number,
    viewWidth: number,
    viewHeight: number,
  ): void {
    const before = this.screenToWorld(screenX, screenY, viewWidth, viewHeight);
    this.zoomBy(factor);
    const after = this.screenToWorld(screenX, screenY, viewWidth, viewHeight);
    this.center = this.center.add(before.sub(after));
  }

  /**
   * Write this camera into a container's transform. The negative y scale
   * flips physics "y up" into screen "y down".
   */
  apply(worldRoot: Container, viewWidth: number, viewHeight: number): void {
    const s = this.pxPerMeter;
    worldRoot.scale.set(s, -s);
    worldRoot.position.set(
      viewWidth / 2 - this.center.x * s,
      viewHeight / 2 + this.center.y * s,
    );
  }

  screenToWorld(
    screenX: number,
    screenY: number,
    viewWidth: number,
    viewHeight: number,
  ): Vec2 {
    const s = this.pxPerMeter;
    return new Vec2(
      (screenX - viewWidth / 2) / s + this.center.x,
      (viewHeight / 2 - screenY) / s + this.center.y,
    );
  }
}
