import { Graphics } from 'pixi.js';
import { GRID_CELL_METERS } from '../config/constants';
import type { PartInstance } from '../vehicle/PartInstance';
import type { StackOrigin } from './RocketRenderer';

/**
 * Engine exhaust flames. The Graphics lives inside the rocket's display
 * container, so it inherits position and rotation for free. The flicker is
 * purely cosmetic — physics never reads anything from here.
 */
export class FlameEffect {
  readonly graphic = new Graphics();

  update(
    activeEngines: PartInstance[],
    origin: StackOrigin,
    throttle: number,
    burning: boolean,
  ): void {
    const g = this.graphic;
    g.clear();
    if (!burning || throttle <= 0) return;

    const cell = GRID_CELL_METERS;
    for (const engine of activeEngines) {
      const cx = (engine.xCells + engine.widthCells / 2 - origin.xCells) * cell;
      const y = (engine.yCells - origin.yCells) * cell;
      const flicker = 0.9 + Math.random() * 0.2;
      const len = (0.6 + 2.0 * throttle) * flicker;
      const halfW = engine.widthCells * cell * 0.22;
      g.poly([cx - halfW, y, cx + halfW, y, cx, y - len]).fill({
        color: 0xffa030,
        alpha: 0.85,
      });
      g.poly([cx - halfW * 0.45, y, cx + halfW * 0.45, y, cx, y - len * 0.6]).fill({
        color: 0xffe680,
        alpha: 0.9,
      });
    }
  }
}
