import { Container, Graphics } from 'pixi.js';
import { glowFraction } from '../physics/ThermalModel';
import type { Vessel } from '../systems/VesselManager';
import { FlameEffect } from './EffectsRenderer';
import { buildStackDisplay, computeStackOrigin, type StackOrigin } from './RocketRenderer';

/**
 * World-space display of one vessel: part stack, engine flame, and a
 * screen-fixed-size map marker. FlightScene keeps one per vessel and calls
 * sync() every frame; the stack rebuilds itself when the runtime's part
 * list changes (tracked via RocketRuntime.revision).
 */
export class VesselView {
  readonly container = new Container();
  private readonly flame = new FlameEffect();
  private readonly marker = new Graphics();
  private readonly chuteG = new Graphics();
  private readonly plasmaG = new Graphics();
  private stack: Container | null = null;
  private origin: StackOrigin = { xCells: 0, yCells: 0 };
  private revision = -1;

  constructor(private readonly parent: Container, markerColor: number) {
    this.container.addChild(this.plasmaG, this.flame.graphic, this.chuteG);
    parent.addChild(this.container);

    this.marker.poly([0, 1.2, -0.7, -0.8, 0.7, -0.8]).fill(markerColor);
    this.marker.visible = false;
    parent.addChild(this.marker);
  }

  sync(
    vessel: Vessel,
    options: {
      isActive: boolean;
      mapMode: boolean;
      mapPxPerMeter: number;
      /** 0..1 heating intensity: draws the plasma sheath. */
      reentryIntensity?: number;
    },
  ): void {
    const rt = vessel.runtime;
    if (rt.revision !== this.revision) this.rebuild(vessel);

    this.container.position.set(rt.position.x, rt.position.y);
    this.container.rotation = rt.angleRad - Math.PI / 2;

    const burning =
      options.isActive && !rt.crashed && rt.activeFuel > 0 && rt.activeEngines.length > 0;
    this.flame.update(rt.activeEngines, this.origin, rt.throttle, burning);

    this.drawChutes(vessel);
    this.drawPlasma(vessel, options.reentryIntensity ?? 0);

    // Reentry glow: tint each part graphic toward orange-red as it heats.
    // Stack children are created in parts order by buildStackDisplay.
    if (this.stack) {
      for (let i = 0; i < rt.parts.length && i < this.stack.children.length; i++) {
        const glow = glowFraction(rt.parts[i]);
        const g = 255 - Math.round(150 * glow);
        const b = 255 - Math.round(215 * glow);
        this.stack.children[i].tint = (255 << 16) | (g << 8) | b;
      }
    }

    this.marker.visible = options.mapMode;
    if (options.mapMode) {
      this.marker.position.set(rt.position.x, rt.position.y);
      this.marker.rotation = rt.angleRad - Math.PI / 2;
      // Constant on-screen size regardless of map zoom.
      this.marker.scale.set(
        (options.isActive ? 10 : 6) / options.mapPxPerMeter,
      );
    }
  }

  destroy(): void {
    this.parent.removeChild(this.container, this.marker);
    this.container.destroy({ children: true });
    this.marker.destroy();
  }

  /** Canopies above each deploying/deployed parachute, scaled by fraction. */
  private drawChutes(vessel: Vessel): void {
    const g = this.chuteG;
    g.clear();
    const cell = 0.5;
    for (const p of vessel.runtime.parts) {
      if (!p.chute) continue;
      const fraction = Math.max(p.mainFraction, p.drogueFraction * 0.5);
      if (fraction <= 0.02) continue;
      const cx = (p.xCells + p.widthCells / 2 - this.origin.xCells) * cell;
      const topY = (p.topCells - this.origin.yCells) * cell;
      const isDrogue = p.mainFraction <= p.drogueFraction * 0.5;
      const spanM = (isDrogue ? p.chute.diameterM * 0.4 : p.chute.diameterM) * 0.35 * fraction;
      const rise = 2.2 + spanM * 0.9;
      // Shroud lines + canopy arc (approximated semi-ellipse).
      g.moveTo(cx - p.widthCells * cell * 0.4, topY)
        .lineTo(cx - spanM, topY + rise)
        .moveTo(cx + p.widthCells * cell * 0.4, topY)
        .lineTo(cx + spanM, topY + rise)
        .stroke({ width: 0.06, color: 0xd8dee9, alpha: 0.8 });
      const pts: number[] = [cx - spanM, topY + rise];
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI;
        pts.push(cx - Math.cos(a) * spanM, topY + rise + Math.sin(a) * spanM * 0.55);
      }
      g.poly(pts).fill({ color: isDrogue ? 0xd0883a : 0xd05a5a, alpha: 0.9 });
    }
  }

  /** Plasma sheath on the leading (velocity-facing) side during hot entry. */
  private drawPlasma(vessel: Vessel, intensity: number): void {
    const g = this.plasmaG;
    g.clear();
    if (intensity <= 0.03) return;
    const rt = vessel.runtime;
    // Airspeed direction in stack-local frame (heading = local +y).
    const v = rt.velocity;
    if (v.length() < 10) return;
    const local = v.rotated(-(rt.angleRad - Math.PI / 2));
    const dirY = local.y >= 0 ? 1 : -1;
    const heightM = rt.stackHeightM;
    const leadY = dirY > 0 ? heightM : 0;
    const flicker = 0.9 + Math.random() * 0.2;
    const width = (1.2 + intensity * 1.6) * flicker;
    const trail = (heightM + 2.5 + intensity * 6) * flicker;
    // Sheath hugging the leading edge, tapering to a tail past the vessel.
    g.poly([
      -width, leadY,
      width, leadY,
      width * 0.45, leadY - dirY * trail * 0.4,
      0, leadY - dirY * trail,
      -width * 0.45, leadY - dirY * trail * 0.4,
    ]).fill({ color: 0xff9040, alpha: 0.28 + intensity * 0.35 });
    // Bright compression cap just ahead of the leading edge.
    g.poly([
      -width * 0.55, leadY,
      width * 0.55, leadY,
      0, leadY + dirY * (0.8 + intensity * 1.4),
    ]).fill({ color: 0xffe0a0, alpha: 0.5 * intensity + 0.2 });
  }

  private rebuild(vessel: Vessel): void {
    this.stack?.destroy({ children: true });
    this.origin = computeStackOrigin(vessel.runtime.parts);
    this.stack = buildStackDisplay(vessel.runtime.parts, this.origin);
    this.container.addChild(this.stack);
    this.revision = vessel.runtime.revision;
  }
}
