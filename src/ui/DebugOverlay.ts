import type { FlightSession } from '../systems/FlightSession';

/**
 * Developer overlay (F3): frame rate, scene, world statistics, save status.
 * TODO: developer console with commands (set orbit, add fuel, teleport...)
 * and cheat toggles — see ARCHITECTURE.md.
 */
export class DebugOverlay {
  private readonly root: HTMLDivElement;
  private visible = false;
  private sinceUpdate = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'debug-overlay';
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.hidden = !this.visible;
  }

  update(info: {
    fps: number;
    scene: string;
    session: FlightSession | null;
    lastSave: string;
  }): void {
    if (!this.visible) return;
    this.sinceUpdate += 1;
    if (this.sinceUpdate < 15) return; // ~4 Hz refresh is plenty
    this.sinceUpdate = 0;

    const s = info.session;
    const vessels = s?.vessels.vessels ?? [];
    const parts = vessels.reduce((n, v) => n + v.runtime.parts.length, 0);
    const debris = vessels.filter((v) => v.type === 'debris').length;
    this.root.textContent = [
      `FPS ${info.fps.toFixed(0)}`,
      `scene ${info.scene}`,
      `T+ ${s ? s.world.simTime.toFixed(0) : '—'}s`,
      `vessels ${vessels.length} (debris ${debris})`,
      `parts ${parts}`,
      `active #${s?.activeVessel?.id ?? '—'}`,
      `warp ${s?.warp.label ?? '—'}`,
      `save: ${info.lastSave}`,
    ].join('  ·  ');
  }
}
