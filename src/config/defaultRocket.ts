import type { RocketDesignData } from '../vehicle/RocketDesign';

/**
 * The stock two-stage rocket, now built with procedural fuel tanks.
 * ~5,500 m/s of vacuum delta-v vs ~2,350 m/s orbital speed — comfortably
 * enough for a stable ~90 km orbit. Verified by `npm run sim`.
 *
 * Stack, bottom to top (x = -1 centers the 2-cell-wide parts on the pad):
 *   Mule engine, 2x4 tank, Decoupler | Wisp engine, 2x2 tank, Capsule
 */
export const DEFAULT_ROCKET_DESIGN: RocketDesignData = {
  version: 2,
  name: 'Stock Orbiter',
  parts: [
    { defId: 'engine-mule', xCells: -1, yCells: 0 },
    {
      defId: 'procedural-fuel-tank',
      xCells: -1,
      yCells: 2,
      custom: { widthCells: 2, heightCells: 4 },
    },
    { defId: 'decoupler-1', xCells: -1, yCells: 6 },
    { defId: 'engine-wisp', xCells: -1, yCells: 7 },
    {
      defId: 'procedural-fuel-tank',
      xCells: -1,
      yCells: 9,
      custom: { widthCells: 2, heightCells: 2 },
    },
    { defId: 'pod-mk1', xCells: -1, yCells: 11 },
  ],
};
