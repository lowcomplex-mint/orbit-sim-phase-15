import type { TelemetrySample } from '../flight/Telemetry';
import { formatMass } from '../math/Units';

/**
 * In-flight engineer readout (collapsible): live mass, thrust, TWR, dynamic
 * pressure, hottest part, rotation rate, and control authority. Everything
 * displayed comes from TelemetrySample — no math in the UI.
 */
export class FlightEngineerPanel {
  readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly toggleIcon: HTMLSpanElement;
  private readonly values = new Map<string, HTMLSpanElement>();
  private collapsed: boolean;

  private static readonly ROWS = [
    ['mass', 'Mass'],
    ['thrust', 'Thrust'],
    ['twr', 'TWR'],
    ['q', 'Dyn. press.'],
    ['heat', 'Hottest'],
    ['spin', 'Rotation'],
    ['authority', 'Ctrl torque'],
  ] as const;

  constructor(parent: HTMLElement) {
    this.collapsed = window.matchMedia('(max-width: 720px)').matches;

    this.root = document.createElement('div');
    this.root.className = 'flight-eng';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'eng-header';
    const title = document.createElement('span');
    title.textContent = 'ENGINEER';
    this.toggleIcon = document.createElement('span');
    header.append(title, this.toggleIcon);
    header.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.applyCollapsed();
      header.blur();
    });

    this.body = document.createElement('div');
    this.body.className = 'eng-body';
    for (const [key, label] of FlightEngineerPanel.ROWS) {
      const row = document.createElement('div');
      row.className = 'eng-row';
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      const valueEl = document.createElement('span');
      valueEl.textContent = '—';
      row.append(labelEl, valueEl);
      this.body.appendChild(row);
      this.values.set(key, valueEl);
    }

    this.root.append(header, this.body);
    parent.appendChild(this.root);
    this.applyCollapsed();
  }

  update(t: TelemetrySample): void {
    if (this.collapsed) return;
    this.set('mass', formatMass(t.massKg));
    this.set('thrust', `${(t.thrustN / 1000).toFixed(1)} kN`);
    this.set('twr', t.twr > 0 ? t.twr.toFixed(2) : '—');
    this.set('q', `${(t.dynamicPressurePa / 1000).toFixed(1)} kPa`);
    this.set(
      'heat',
      t.hottestPartName
        ? `${Math.round(t.hottestTempK)}/${Math.round(t.hottestMaxTempK)} K`
        : '—',
    );
    this.set('spin', `${((t.angularVelocityRadS * 180) / Math.PI).toFixed(1)}°/s`);
    this.set('authority', `${(t.controlAuthorityNm / 1000).toFixed(1)} kN·m`);
  }

  destroy(): void {
    this.root.remove();
  }

  private set(key: string, text: string): void {
    const el = this.values.get(key);
    if (el && el.textContent !== text) el.textContent = text;
  }

  private applyCollapsed(): void {
    this.body.hidden = this.collapsed;
    this.toggleIcon.textContent = this.collapsed ? '▸' : '▾';
  }
}
