import { formatDistance, formatMissionTime, formatSpeed } from '../math/Units';
import type { TelemetrySample } from '../flight/Telemetry';
import { createButton } from './Buttons';

/**
 * Flight HUD (SFS-like, compact):
 *   Ap / Pe stacked top-left
 *   Alt / Vel stacked top-right (opposite the engineer panel)
 *   Fuel / status / warp / time / stage / log in a collapsible "Flight" strip
 */
export class Hud {
  readonly root: HTMLDivElement;
  private readonly values = new Map<string, HTMLSpanElement>();
  private readonly moreBody: HTMLDivElement;
  private readonly moreToggle: HTMLButtonElement;
  private moreOpen = false;

  constructor(parent: HTMLElement, onLog?: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'hud-flight';

    const ape = document.createElement('div');
    ape.className = 'hud-ape';
    ape.append(this.metric('apo', 'Ap'), this.metric('per', 'Pe'));

    const more = document.createElement('div');
    more.className = 'hud-more';
    this.moreToggle = document.createElement('button');
    this.moreToggle.type = 'button';
    this.moreToggle.className = 'hud-more-toggle';
    this.moreToggle.addEventListener('click', () => {
      this.moreOpen = !this.moreOpen;
      this.applyMore();
      this.moreToggle.blur();
    });
    this.moreBody = document.createElement('div');
    this.moreBody.className = 'hud-more-body';
    this.moreBody.append(
      this.metric('fuel', 'Fuel'),
      this.metric('status', 'St'),
      this.metric('warp', 'Warp'),
      this.metric('time', 'T'),
      this.metric('stage', 'Stg'),
    );
    if (onLog) {
      this.moreBody.appendChild(
        createButton('☰', onLog, { className: 'icon hud-log', title: 'Log' }),
      );
    }
    more.append(this.moreToggle, this.moreBody);

    const av = document.createElement('div');
    av.className = 'hud-av';
    av.append(this.metric('alt', 'Alt'), this.metric('vel', 'Vel'));

    this.root.append(ape, more, av);
    parent.appendChild(this.root);
    this.applyMore();
  }

  update(t: TelemetrySample): void {
    this.set('alt', formatDistance(t.altitudeM));
    this.set('vel', formatSpeed(t.speedMS));
    this.set('apo', t.apoapsisAltM === null ? '—' : formatDistance(t.apoapsisAltM));
    this.set('per', formatDistance(t.periapsisAltM));
    this.set(
      'fuel',
      t.fuelCapacityKg > 0
        ? `${Math.round((100 * t.fuelKg) / t.fuelCapacityKg)}%`
        : '—',
    );
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

  private applyMore(): void {
    this.moreBody.hidden = !this.moreOpen;
    this.moreToggle.textContent = this.moreOpen ? 'Flight ▴' : 'Flight ▾';
    this.root.classList.toggle('is-more-open', this.moreOpen);
  }

  private metric(key: string, label: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'hud-metric';
    row.dataset.k = key;
    const labelEl = document.createElement('span');
    labelEl.className = 'label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'value';
    valueEl.textContent = '—';
    row.append(labelEl, valueEl);
    this.values.set(key, valueEl);
    return row;
  }

  private set(key: string, text: string): void {
    const el = this.values.get(key);
    if (el && el.textContent !== text) el.textContent = text;
  }
}
