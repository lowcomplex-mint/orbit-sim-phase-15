import { Application, Container } from 'pixi.js';

/**
 * Owns the PixiJS application and the single world container that scenes
 * draw into. Everything inside `worldRoot` uses PHYSICS coordinates
 * (meters, y up); the camera transform applied to `worldRoot` is the only
 * place meters are converted to screen pixels.
 */
export class Renderer {
  readonly app = new Application();
  readonly worldRoot = new Container();

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      background: 0x05070f,
      resizeTo: host,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.worldRoot);
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  get viewWidth(): number {
    return this.app.screen.width;
  }

  get viewHeight(): number {
    return this.app.screen.height;
  }
}
