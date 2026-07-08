import { Container, Graphics } from 'pixi.js';
import type { CelestialBodyConfig } from '../config/celestialBodies';
import { SUN_VISUAL } from '../config/celestialBodies';

/**
 * Builds static display containers for celestial bodies. All geometry is in
 * meters in world space; the camera transform does the rest. Bodies are big,
 * so circles are generated as explicit polygons with enough segments to look
 * round both from orbit and from the launch pad.
 */

/** Flat [x0,y0,x1,y1,...] polygon approximating a circle. */
function circlePoints(radius: number, segments: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  return pts;
}

/** Annular sector between two radii and two angles (for land patches). */
function bandPoints(
  rOuter: number,
  rInner: number,
  fromRad: number,
  toRad: number,
): number[] {
  const span = toRad - fromRad;
  // ~0.125 deg per segment keeps the surface visually smooth near the pad.
  const segments = Math.max(8, Math.ceil(span / (Math.PI / 1440)));
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = fromRad + (span * i) / segments;
    pts.push(Math.cos(a) * rOuter, Math.sin(a) * rOuter);
  }
  for (let i = segments; i >= 0; i--) {
    const a = fromRad + (span * i) / segments;
    pts.push(Math.cos(a) * rInner, Math.sin(a) * rInner);
  }
  return pts;
}

export function createEarthView(config: CelestialBodyConfig): Container {
  const container = new Container();
  const r = config.radiusM;
  const g = new Graphics();

  // Atmosphere: a few concentric translucent discs approximate a gradient.
  // TODO: replace with a proper radial-gradient shader or texture.
  if (config.atmosphere) {
    const atmColor = config.atmosphereColor ?? 0x63b4ff;
    const h = config.atmosphere.heightM;
    for (const [fraction, alpha] of [
      [1.0, 0.10],
      [0.55, 0.12],
      [0.25, 0.16],
    ] as const) {
      g.poly(circlePoints(r + h * fraction, 720)).fill({ color: atmColor, alpha });
    }
  }

  // Planet body (ocean). High segment count so the horizon is smooth even
  // at builder-scale zoom near the surface.
  g.poly(circlePoints(r, 2880)).fill(config.surfaceColor);

  // Land patches: colored bands hugging the surface, ~12 km deep so the
  // ground still looks solid while ascending through the lower atmosphere.
  for (const patch of config.landPatches ?? []) {
    g.poly(
      bandPoints(
        r,
        r - 12_000,
        (patch.fromDeg * Math.PI) / 180,
        (patch.toDeg * Math.PI) / 180,
      ),
    ).fill(patch.color);
  }

  // Launch pad at the "north pole" (angle 90 deg). The platform TOP is flush
  // with the surface radius r — exactly where rockets spawn — so the vehicle
  // sits on the pad with no clipping. The service tower stands clear of the
  // vehicle envelope (rockets occupy roughly x = -2..2).
  g.rect(-15, r - 3, 30, 3).fill(0x5c6570); // platform, top at r
  g.rect(-16, r - 0.5, 32, 0.5).fill(0x6d7681); // deck lip
  g.rect(-7.5, r, 1.4, 10).fill(0x4a525c); // service tower
  g.rect(-7.5, r + 3, 3.2, 0.35).fill(0x4a525c); // tower arms (retracted look)
  g.rect(-7.5, r + 6, 3.2, 0.35).fill(0x4a525c);

  container.addChild(g);
  return container;
}

export function createMoonView(config: CelestialBodyConfig): Container {
  const container = new Container();
  const g = new Graphics();
  const r = config.radiusM;
  g.poly(circlePoints(r, 720)).fill(config.surfaceColor);
  // A few craters so rotation/scale is visible.
  g.poly(circlePoints(r * 0.18, 64)).fill(0x7f7f7f);
  const g2 = new Graphics();
  g2.poly(circlePoints(r * 0.1, 48)).fill(0x858585);
  g2.position.set(r * 0.4, r * 0.35);
  const g3 = new Graphics();
  g3.poly(circlePoints(r * 0.13, 48)).fill(0x8a8a8a);
  g3.position.set(-r * 0.35, -r * 0.4);
  container.addChild(g, g2, g3);
  return container;
}

/** Decorative Sun for the map view. Not a gravity source in the MVP. */
export function createSunView(): Container {
  const container = new Container();
  const g = new Graphics();
  g.poly(circlePoints(SUN_VISUAL.radiusM * 2.2, 128)).fill({
    color: SUN_VISUAL.color,
    alpha: 0.15,
  });
  g.poly(circlePoints(SUN_VISUAL.radiusM, 128)).fill(SUN_VISUAL.color);
  container.addChild(g);
  container.position.set(SUN_VISUAL.position.x, SUN_VISUAL.position.y);
  return container;
}
