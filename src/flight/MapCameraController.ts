import { MAP_CAMERA } from '../config/constants';
import { Vec2 } from '../math/Vec2';
import { CameraController } from './CameraController';

/**
 * Map-view camera behavior: drag panning, wheel zoom-to-cursor, two-finger
 * pinch zoom, and a follow-vessel mode. Panning and zooming ONLY move the
 * camera — physics coordinates are never touched.
 *
 * The controller owns its pointer listeners; the scene toggles `enabled`
 * when entering/leaving map mode so flight view input is unaffected.
 */
export class MapCameraController {
  readonly camera = new CameraController(
    MAP_CAMERA.initialPxPerMeter,
    MAP_CAMERA.minPxPerMeter,
    MAP_CAMERA.maxPxPerMeter,
  );

  /** When true, the camera tracks the active vessel each frame. */
  follow = true;
  /** Only react to input while the map is actually shown. */
  enabled = false;
  /** Called when the user changes follow mode by panning. */
  onFollowChanged: ((follow: boolean) => void) | null = null;

  private canvas: HTMLCanvasElement | null = null;
  private getViewSize: (() => { width: number; height: number }) | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();

  private readonly downHandler = (e: PointerEvent) => this.onPointerDown(e);
  private readonly moveHandler = (e: PointerEvent) => this.onPointerMove(e);
  private readonly upHandler = (e: PointerEvent) => this.onPointerUp(e);

  attach(canvas: HTMLCanvasElement, getViewSize: () => { width: number; height: number }): void {
    this.canvas = canvas;
    this.getViewSize = getViewSize;
    canvas.addEventListener('pointerdown', this.downHandler);
    canvas.addEventListener('pointermove', this.moveHandler);
    canvas.addEventListener('pointerup', this.upHandler);
    canvas.addEventListener('pointercancel', this.upHandler);
  }

  detach(): void {
    if (!this.canvas) return;
    this.canvas.removeEventListener('pointerdown', this.downHandler);
    this.canvas.removeEventListener('pointermove', this.moveHandler);
    this.canvas.removeEventListener('pointerup', this.upHandler);
    this.canvas.removeEventListener('pointercancel', this.upHandler);
    this.canvas = null;
    this.pointers.clear();
  }

  /** Per-frame: track the vessel while follow mode is on. */
  update(activeVesselPosition: Vec2): void {
    if (this.follow) this.camera.center = activeVesselPosition;
  }

  recenter(activeVesselPosition: Vec2): void {
    this.camera.center = activeVesselPosition;
    this.setFollow(true);
  }

  setFollow(follow: boolean): void {
    if (this.follow === follow) return;
    this.follow = follow;
    this.onFollowChanged?.(follow);
  }

  /** Wheel zoom keeping the world point under the cursor fixed. */
  zoomAtScreen(screenX: number, screenY: number, factor: number): void {
    if (!this.getViewSize) return;
    const { width, height } = this.getViewSize();
    const before = this.camera.screenToWorld(screenX, screenY, width, height);
    this.camera.zoomBy(factor);
    const after = this.camera.screenToWorld(screenX, screenY, width, height);
    this.camera.center = this.camera.center.add(before.sub(after));
  }

  // ---------------------------------------------------------- pointer input --

  private onPointerDown(e: PointerEvent): void {
    if (!this.enabled || !this.canvas) return;
    this.pointers.set(e.pointerId, this.local(e));
    try {
      // Keep receiving moves when the finger leaves the canvas mid-drag.
      // Can throw for already-released pointers; tracking works without it.
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* non-fatal */
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.enabled || !this.pointers.has(e.pointerId)) return;
    const current = this.local(e);

    if (this.pointers.size === 1) {
      // Drag pan: the world content follows the finger.
      const previous = this.pointers.get(e.pointerId)!;
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      this.pointers.set(e.pointerId, current);
      if (dx !== 0 || dy !== 0) {
        const s = this.camera.pxPerMeter;
        this.setFollow(false);
        this.camera.center = this.camera.center.add(new Vec2(-dx / s, dy / s));
      }
    } else if (this.pointers.size === 2) {
      // Pinch zoom around the midpoint: measure the two-pointer distance
      // before and after applying this pointer's movement.
      const [idA, idB] = [...this.pointers.keys()];
      const beforeA = this.pointers.get(idA)!;
      const beforeB = this.pointers.get(idB)!;
      const prevDist = Math.hypot(beforeA.x - beforeB.x, beforeA.y - beforeB.y);
      this.pointers.set(e.pointerId, current);
      const afterA = this.pointers.get(idA)!;
      const afterB = this.pointers.get(idB)!;
      const dist = Math.hypot(afterA.x - afterB.x, afterA.y - afterB.y);
      if (prevDist > 1 && dist > 1 && dist !== prevDist) {
        this.setFollow(false);
        this.zoomAtScreen(
          (afterA.x + afterB.x) / 2,
          (afterA.y + afterB.y) / 2,
          dist / prevDist,
        );
      }
    } else {
      this.pointers.set(e.pointerId, current);
    }
  }

  private onPointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
}
