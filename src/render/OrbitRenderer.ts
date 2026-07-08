import { Container, Graphics } from 'pixi.js';
import type { Vec2 } from '../math/Vec2';

/**
 * Map-view overlay: predicted trajectory, Moon orbit circle, and the
 * atmosphere boundary. Everything is redrawn per frame while the map is
 * open (the polylines are cheap) so stroke widths can compensate for zoom
 * and stay a constant pixel width.
 */
export class OrbitRenderer {
  readonly container = new Container();
  private readonly referenceG = new Graphics();
  private readonly orbitG = new Graphics();

  constructor() {
    this.container.addChild(this.referenceG, this.orbitG);
    this.container.visible = false;
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  /** Moon orbit + atmosphere edge + Moon SOI circle (at the Moon's position). */
  updateReference(
    moonOrbitRadiusM: number,
    atmosphereRadiusM: number,
    strokeWidthM: number,
    moonSoi?: { center: Vec2; radiusM: number },
  ): void {
    const g = this.referenceG;
    g.clear();
    drawCirclePath(g, moonOrbitRadiusM);
    g.stroke({ width: strokeWidthM, color: 0x9a9a9a, alpha: 0.5 });
    drawCirclePath(g, atmosphereRadiusM);
    g.stroke({ width: strokeWidthM, color: 0x63b4ff, alpha: 0.5 });
    if (moonSoi) {
      drawCirclePath(g, moonSoi.radiusM, 90, moonSoi.center);
      g.stroke({ width: strokeWidthM, color: 0xb49aff, alpha: 0.45 });
    }
  }

  /** Predicted conic (world coordinates) with optional Ap/Pe markers. */
  updateOrbit(
    points: Vec2[],
    strokeWidthM: number,
    apsides?: { periapsis: Vec2; apoapsis: Vec2 | null },
  ): void {
    const g = this.orbitG;
    g.clear();
    if (points.length < 2) return;
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      g.lineTo(points[i].x, points[i].y);
    }
    g.stroke({ width: strokeWidthM, color: 0x66d9ff, alpha: 0.9 });

    if (apsides) {
      const r = strokeWidthM * 2.5;
      g.circle(apsides.periapsis.x, apsides.periapsis.y, r).fill(0x63d4ff);
      if (apsides.apoapsis) {
        g.circle(apsides.apoapsis.x, apsides.apoapsis.y, r).fill(0xffa94d);
      }
    }
  }
}

function drawCirclePath(
  g: Graphics,
  radius: number,
  segments = 180,
  center?: Vec2,
): void {
  const cx = center?.x ?? 0;
  const cy = center?.y ?? 0;
  g.moveTo(cx + radius, cy);
  for (let i = 1; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    g.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
  }
}
