import { MAP_CAMERA } from '../config/constants';
import { Vec2 } from '../math/Vec2';
import { capturePointer, PointerTracker } from '../ui/CanvasGestures';
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
  private readonly pointers = new PointerTracker();

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
    this.camera.zoomAtScreen(screenX, screenY, factor, width, height);
  }

  // ---------------------------------------------------------- pointer input --

  private onPointerDown(e: PointerEvent): void {
    if (!this.enabled || !this.canvas) return;
    this.pointers.down(e.pointerId, this.local(e));
    capturePointer(this.canvas, e.pointerId);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.enabled || !this.pointers.has(e.pointerId)) return;
    const result = this.pointers.move(e.pointerId, this.local(e));
    if (result.pinch) {
      this.setFollow(false);
      this.zoomAtScreen(result.pinch.midX, result.pinch.midY, result.pinch.scale);
      return;
    }
    if (result.pan && (result.pan.dx !== 0 || result.pan.dy !== 0)) {
      const s = this.camera.pxPerMeter;
      this.setFollow(false);
      this.camera.center = this.camera.center.add(
        new Vec2(-result.pan.dx / s, result.pan.dy / s),
      );
    }
  }

  private onPointerUp(e: PointerEvent): void {
    this.pointers.up(e.pointerId);
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
}
