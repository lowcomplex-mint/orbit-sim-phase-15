import { formatDistance, formatMissionTime, formatSpeed } from '../math/Units';
import type { TelemetrySample } from '../flight/Telemetry';

/**
 * Flight telemetry readout: a row of chips along the top of the screen.
 * Pure DOM; it only ever consumes TelemetrySample objects.
 */
export class Hud {
  readonly root: HTMLDivElement;
  private readonly values = new Map<string, HTMLSpanElement>();

  private static readonly FIELDS = [
    ['alt', 'ALT'],
    ['vel', 'VEL'],
    ['apo', 'APO'],
    ['per', 'PER'],
    ['fuel', 'FUEL'],
    ['thr', 'THR'],
    ['stage', 'STAGE'],
    ['status', 'STATUS'],
    ['warp', 'WARP'],
    ['time', 'TIME'],
  ] as const;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-top';
    for (const [key, label] of Hud.FIELDS) {
      const chip = document.createElement('div');
      chip.className = 'chip';
      const labelEl = document.createElement('span');
      labelEl.className = 'label';
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.className = 'value';
      valueEl.textContent = '—';
      chip.append(labelEl, valueEl);
      this.root.appendChild(chip);
      this.values.set(key, valueEl);
    }
    parent.appendChild(this.root);
  }

  update(t: TelemetrySample): void {
    this.set('alt', formatDistance(t.altitudeM));
    this.set('vel', formatSpeed(t.speedMS));
    this.set('apo', t.apoapsisAltM === null ? '—' : formatDistance(t.apoapsisAltM));
    this.set('per', formatDistance(t.periapsisAltM));
    this.set(
      'fuel',
      t.fuelCapacityKg > 0
        ? `${Math.round(t.fuelKg)} kg (${Math.round((100 * t.fuelKg) / t.fuelCapacityKg)}%)`
        : 'none',
    );
    this.set('thr', `${Math.round(t.throttle * 100)}%`);
    this.set('stage', `${t.stageNumber}/${t.stageCount}`);
    this.set(
      'status',
      t.status.toUpperCase() + (t.bodyName !== 'Earth' ? ` @ ${t.bodyName.toUpperCase()}` : ''),
    );
    this.set('warp', t.warpLabel);
    this.set('time', formatMissionTime(t.simTime));
  }

  destroy(): void {
    this.root.remove();
  }

  private set(key: string, text: string): void {
    const el = this.values.get(key);
    if (el && el.textContent !== text) el.textContent = text;
  }
}
