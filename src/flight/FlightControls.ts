import { THROTTLE_KEY_RATE } from '../config/constants';
import { clamp } from '../math/Units';
import type { RocketRuntime } from '../vehicle/RocketRuntime';

export interface FlightControlCallbacks {
  onStage(): void;
  onReset(): void;
  onToggleMap(): void;
  /** +1 / -1 step along the warp ladder. */
  onWarpStep(delta: number): void;
  onTogglePause(): void;
  onCycleSas(): void;
  onToggleLegs(): void;
}

/**
 * Keyboard + touch input for flight. Each frame, `update` writes throttle
 * and rotation input into the rocket; one-shot actions (stage, map, ...)
 * fire through callbacks.
 *
 * Keys: A/D rotate · W/S throttle · Z/X full/cut throttle · Space stage
 *       M map · R reset · ,/. time warp · L toggle legs (flight only).
 */
export class FlightControls {
  /** -1..1 rotation commanded by the on-screen hold buttons. */
  touchRotate = 0;
  /** Called whenever throttle changes via keyboard, to sync the slider UI. */
  onThrottleChanged: ((throttle: number) => void) | null = null;

  private readonly keys = new Set<string>();
  private readonly keyDownHandler = (e: KeyboardEvent) => this.onKeyDown(e);
  private readonly keyUpHandler = (e: KeyboardEvent) => this.keys.delete(e.code);

  constructor(
    private readonly rocket: RocketRuntime,
    private readonly callbacks: FlightControlCallbacks,
  ) {}

  attach(): void {
    window.addEventListener('keydown', this.keyDownHandler);
    window.addEventListener('keyup', this.keyUpHandler);
  }

  detach(): void {
    window.removeEventListener('keydown', this.keyDownHandler);
    window.removeEventListener('keyup', this.keyUpHandler);
  }

  setThrottle(value: number): void {
    this.rocket.throttle = clamp(value, 0, 1);
    this.onThrottleChanged?.(this.rocket.throttle);
  }

  update(dtSec: number): void {
    const keyRotate =
      (this.keys.has('KeyA') ? 1 : 0) - (this.keys.has('KeyD') ? 1 : 0);
    this.rocket.rotationInput = clamp(keyRotate + this.touchRotate, -1, 1);

    const throttleDir =
      (this.keys.has('KeyW') || this.keys.has('ShiftLeft') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ControlLeft') ? 1 : 0);
    if (throttleDir !== 0) {
      this.rocket.throttle = clamp(
        this.rocket.throttle + throttleDir * THROTTLE_KEY_RATE * dtSec,
        0,
        1,
      );
      this.onThrottleChanged?.(this.rocket.throttle);
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    switch (e.code) {
      case 'Space':
        e.preventDefault(); // keep the page from scrolling / buttons from firing
        this.callbacks.onStage();
        break;
      case 'KeyM':
        this.callbacks.onToggleMap();
        break;
      case 'KeyR':
        this.callbacks.onReset();
        break;
      case 'Escape':
        this.callbacks.onTogglePause();
        break;
      case 'KeyG':
        this.callbacks.onCycleSas();
        break;
      case 'KeyL':
        e.preventDefault();
        this.callbacks.onToggleLegs();
        break;
      case 'Comma':
        this.callbacks.onWarpStep(-1);
        break;
      case 'Period':
        this.callbacks.onWarpStep(1);
        break;
      case 'KeyZ':
        this.setThrottle(1);
        this.onThrottleChanged?.(1);
        break;
      case 'KeyX':
        this.setThrottle(0);
        this.onThrottleChanged?.(0);
        break;
      default:
        this.keys.add(e.code);
        return;
    }
  }
}
