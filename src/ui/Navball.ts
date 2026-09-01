import type { TelemetrySample } from '../flight/Telemetry';

/**
 * A 2D "navball": a circular gauge whose 12-o'clock direction is radial-out
 * (away from the dominant body — i.e. "up"). Markers show prograde,
 * retrograde, radial-out and radial-in; the white chevron is the vessel's
 * heading. The readout in the middle shows the pitch angle from local
 * vertical.
 *
 * NOTE: a 2D orbit has no normal vector, so the KSP normal/anti-normal
 * markers have no meaning here. TODO(3D): add them if the simulation ever
 * grows an out-of-plane axis.
 */
export class Navball {
  private readonly root: HTMLDivElement;
  private readonly readout: HTMLDivElement;
  private readonly markers: { el: HTMLSpanElement; kind: 'prograde' | 'retrograde' | 'radialOut' | 'radialIn' | 'heading' }[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'navball';

    const defs: [string, string, (typeof this.markers)[number]['kind']][] = [
      ['▲', 'nav-prograde', 'prograde'],
      ['▼', 'nav-retrograde', 'retrograde'],
      ['◉', 'nav-radial-out', 'radialOut'],
      ['◎', 'nav-radial-in', 'radialIn'],
      ['⌃', 'nav-heading', 'heading'],
    ];
    for (const [glyph, className, kind] of defs) {
      const el = document.createElement('span');
      el.className = `nav-marker ${className}`;
      el.textContent = glyph;
      this.root.appendChild(el);
      this.markers.push({ el, kind });
    }

    this.readout = document.createElement('div');
    this.readout.className = 'nav-readout';
    this.root.appendChild(this.readout);

    parent.appendChild(this.root);
  }

  update(t: TelemetrySample): void {
    // Display angle: offset from radial-out, shown with 0 at 12 o'clock.
    // World angles are CCW-positive; CSS rotation is clockwise-positive.
    // Radii scale with the ball so a smaller phone navball stays readable.
    const radius = Math.max(28, this.root.clientWidth / 2);
    const place = (
      el: HTMLSpanElement,
      worldAngle: number | null,
      radiusPx: number,
      keepUpright: boolean,
    ): void => {
      if (worldAngle === null) {
        el.style.visibility = 'hidden';
        return;
      }
      el.style.visibility = 'visible';
      const delta = worldAngle - t.radialOutRad;
      const css = -delta;
      // Prograde/radial glyphs stay screen-up so they stay readable. The
      // heading chevron must NOT un-rotate — it points along the vessel nose.
      el.style.transform = keepUpright
        ? `translate(-50%, -50%) rotate(${css}rad) translateY(${-radiusPx}px) rotate(${-css}rad)`
        : `translate(-50%, -50%) rotate(${css}rad) translateY(${-radiusPx}px)`;
    };

    for (const { el, kind } of this.markers) {
      switch (kind) {
        case 'prograde':
          place(el, t.progradeRad, radius * 0.62, true);
          break;
        case 'retrograde':
          place(el, t.progradeRad === null ? null : t.progradeRad + Math.PI, radius * 0.62, true);
          break;
        case 'radialOut':
          place(el, t.radialOutRad, radius * 0.78, true);
          break;
        case 'radialIn':
          place(el, t.radialOutRad + Math.PI, radius * 0.78, true);
          break;
        case 'heading':
          place(el, t.headingRad, radius * 0.42, false);
          break;
      }
    }

    const pitchDeg = normalizeDeg(((t.headingRad - t.radialOutRad) * 180) / Math.PI);
    this.readout.textContent = `${pitchDeg > 0 ? '+' : ''}${pitchDeg.toFixed(0)}°`;
  }

  destroy(): void {
    this.root.remove();
  }
}

function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
